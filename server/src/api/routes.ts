import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { extractBearerToken, constantTimeEqual } from "../auth/auth";
import type { AppConfig } from "../config/env";
import type { Database } from "../db/database";
import { parseExternalCommand } from "../parser/commandParser";
import { DeviceRegistry } from "../realtime/deviceRegistry";
import { CommandRouter } from "../router/commandRouter";
import type { CommandDispatchResult } from "../types/protocol";
import { randomToken, sha256Hex } from "../utils/crypto";
import { makeRequestId } from "../utils/id";
import { log } from "../utils/logger";

interface ApiDeps {
  config: AppConfig;
  db: Database;
  registry: DeviceRegistry;
  router: CommandRouter;
}

interface CommandRequestBody {
  request_id?: string;
  text?: string;
  source?: string;
  sent_at?: string;
  client_version?: string;
  user_id?: string;
  shortcut_name?: string;
}

interface EnrollRequestBody {
  bootstrap_token?: string;
  device_id?: string;
  display_name?: string;
  version?: string;
  hostname?: string;
  username?: string;
  capabilities?: string[];
}

function makeLogId(requestId: string, deviceId: string): string {
  return `${requestId}:${deviceId}`;
}

function unauthorized(reply: FastifyReply): void {
  reply.code(401).send({ ok: false, message: "Unauthorized" });
}

function isPhoneAuthorized(request: FastifyRequest, config: AppConfig): boolean {
  const token = extractBearerToken(request.headers.authorization);
  if (!token) {
    return false;
  }

  return constantTimeEqual(token, config.phoneApiToken);
}

export async function registerApiRoutes(server: FastifyInstance, deps: ApiDeps): Promise<void> {
  server.get("/api/health", async () => {
    return {
      ok: true,
      service: "jarvis-server",
      ts: new Date().toISOString(),
    };
  });

  server.get("/api/devices", async (request, reply) => {
    if (!isPhoneAuthorized(request, deps.config)) {
      unauthorized(reply);
      return;
    }

    return {
      ok: true,
      devices: deps.db.listDevices(),
    };
  });

  server.post("/api/enroll", async (request, reply) => {
    const body = (request.body ?? {}) as EnrollRequestBody;
    if (!body.bootstrap_token || !constantTimeEqual(body.bootstrap_token, deps.config.agentBootstrapToken)) {
      unauthorized(reply);
      return;
    }

    const deviceId = body.device_id?.trim().toLowerCase() ?? "";
    if (!/^[a-z0-9_-]{2,32}$/.test(deviceId)) {
      reply.code(400).send({
        ok: false,
        message: "device_id must be 2-32 chars and use a-z, 0-9, _ or -",
      });
      return;
    }

    const token = randomToken();
    const tokenHash = sha256Hex(token);

    deps.db.enrollDevice({
      deviceId,
      tokenHash,
      displayName: body.display_name,
      version: body.version,
      hostname: body.hostname,
      username: body.username,
      capabilities: Array.isArray(body.capabilities) ? body.capabilities : [],
    });

    log("info", "Device enrolled", {
      device_id: deviceId,
      hostname: body.hostname ?? null,
      username: body.username ?? null,
    });

    reply.send({
      ok: true,
      device_id: deviceId,
      device_token: token,
      ws_url: deps.config.publicWsUrl,
      message: "Enrollment complete",
    });
  });

  server.post("/api/command", async (request, reply) => {
    if (!isPhoneAuthorized(request, deps.config)) {
      unauthorized(reply);
      return;
    }

    const body = (request.body ?? {}) as CommandRequestBody;
    const text = body.text?.toString() ?? "";
    const requestId = body.request_id && body.request_id.trim() ? body.request_id : makeRequestId();
    const source = body.source?.trim() || "iphone";

    const parsed = parseExternalCommand(text);
    if ("code" in parsed) {
      reply.code(400).send({
        ok: false,
        request_id: requestId,
        message: `Command rejected: ${parsed.message}`,
        error_code: parsed.code,
      });
      return;
    }

    if (parsed.target === "all" && parsed.command.type !== "PING") {
      reply.code(400).send({
        ok: false,
        request_id: requestId,
        message: "Command rejected: target all supports only ping in MVP",
        error_code: "GROUP_COMMAND_NOT_ALLOWED",
      });
      return;
    }

    const targetDeviceIds =
      parsed.target === "all" ? deps.registry.listOnlineDeviceIds() : [parsed.target];

    if (targetDeviceIds.length === 0) {
      reply.code(409).send({
        ok: false,
        request_id: requestId,
        message: "No online devices available",
        error_code: "NO_ONLINE_DEVICES",
      });
      return;
    }

    for (const deviceId of targetDeviceIds) {
      const knownDevice = deps.db.getDevice(deviceId) ?? deps.registry.get(deviceId);
      if (!knownDevice) {
        reply.code(404).send({
          ok: false,
          request_id: requestId,
          message: `Unknown device: ${deviceId}`,
          error_code: "UNKNOWN_DEVICE",
        });
        return;
      }

      const connected = deps.registry.get(deviceId);
      if (!connected) {
        reply.code(409).send({
          ok: false,
          request_id: requestId,
          message: `${deviceId} is offline`,
          error_code: "DEVICE_OFFLINE",
        });
        return;
      }

      deps.db.insertCommandLog({
        id: makeLogId(requestId, deviceId),
        requestId,
        deviceId,
        source,
        rawText: parsed.rawText,
        parsedTarget: parsed.target,
        parsedType: parsed.command.type,
        argsJson: JSON.stringify(parsed.command.args),
        status: "queued",
        resultMessage: null,
        errorCode: null,
      });
    }

    if (parsed.target !== "all") {
      const deviceId = targetDeviceIds[0];
      try {
        const result = await deps.router.dispatchToDevice({
          requestId,
          deviceId,
          command: parsed.command,
        });

        deps.db.completeCommandLog({
          id: makeLogId(requestId, deviceId),
          status: result.ok ? "ok" : "failed",
          resultMessage: result.message,
          errorCode: result.error_code,
        });

        reply.send({
          ok: result.ok,
          request_id: requestId,
          target: deviceId,
          parsed_type: parsed.command.type,
          message: result.message,
          result,
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown routing error";

        deps.db.completeCommandLog({
          id: makeLogId(requestId, deviceId),
          status: "timeout",
          resultMessage: errorMessage,
          errorCode: "TIMEOUT",
        });

        reply.code(504).send({
          ok: false,
          request_id: requestId,
          target: deviceId,
          parsed_type: parsed.command.type,
          message: errorMessage,
          error_code: "TIMEOUT",
        });
      }

      return;
    }

    const results = await deps.router.dispatchToMany({
      requestId,
      deviceIds: targetDeviceIds,
      command: parsed.command,
    });

    for (const result of results) {
      deps.db.completeCommandLog({
        id: makeLogId(requestId, result.device_id),
        status: result.ok ? "ok" : "failed",
        resultMessage: result.message,
        errorCode: result.error_code,
      });
    }

    const okCount = results.filter((result) => result.ok).length;
    const total = results.length;

    reply.send({
      ok: okCount === total,
      request_id: requestId,
      target: "all",
      parsed_type: parsed.command.type,
      message: `Completed ${okCount}/${total}`,
      results: results.map((result: CommandDispatchResult) => ({
        device_id: result.device_id,
        ok: result.ok,
        message: result.message,
        error_code: result.error_code,
      })),
    });
  });
}
