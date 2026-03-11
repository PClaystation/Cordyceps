import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { extractBearerToken, constantTimeEqual } from "../auth/auth";
import type { AppConfig } from "../config/env";
import type { Database } from "../db/database";
import { parseExternalCommand } from "../parser/commandParser";
import { DeviceRegistry } from "../realtime/deviceRegistry";
import { CommandRouter, DispatchError } from "../router/commandRouter";
import type { CommandDispatchResult } from "../types/protocol";
import { randomToken, sha256Hex } from "../utils/crypto";
import { makeRequestId } from "../utils/id";
import { log } from "../utils/logger";
import { inspectPackageFromUrl, PackageInspectionError } from "../update/packageInspector";

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
  designation_prefix?: string;
}

interface UpdateRequestBody {
  request_id?: string;
  source?: string;
  target?: string;
  version?: string;
  package_url?: string;
  sha256?: string;
  size_bytes?: unknown;
}

interface PreparedDesignationChange {
  currentDeviceId: string;
  nextDeviceId: string;
}

interface RenameDeviceBody {
  display_name?: string;
}

const MAX_TEXT_LEN = 4096;
const MAX_SOURCE_LEN = 40;
const MAX_UPDATE_VERSION_LEN = 64;
const MAX_CAPABILITIES = 50;
const ADMIN_ONLY_COMMANDS = new Set([
  "ADMIN_EXEC_CMD",
  "ADMIN_EXEC_POWERSHELL",
  "PROCESS_LIST",
  "PROCESS_KILL",
  "SERVICE_LIST",
  "SERVICE_CONTROL",
  "FILE_READ",
  "FILE_WRITE",
  "FILE_APPEND",
  "FILE_DELETE",
  "FILE_LIST",
  "FILE_MKDIR",
  "SYSTEM_INFO",
]);

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

function asTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}


function normalizeDesignationPrefix(candidate: unknown): string {
  const value = asTrimmedString(candidate).toLowerCase();
  if (!value) {
    return "";
  }

  const safeValue = value.replace(/[^a-z]/g, "");
  if (!safeValue) {
    return "";
  }

  return safeValue.slice(0, 4);
}

function normalizeRequestId(candidate: unknown): string {
  const value = asTrimmedString(candidate);
  if (!value) {
    return makeRequestId();
  }

  if (!/^[A-Za-z0-9_.:-]{1,100}$/.test(value)) {
    return makeRequestId();
  }

  return value;
}

function normalizeSource(candidate: unknown): string {
  const value = asTrimmedString(candidate).toLowerCase();
  if (!value) {
    return "iphone";
  }

  const safeValue = value.replace(/[^a-z0-9_.:-]/g, "");
  if (!safeValue) {
    return "iphone";
  }

  return safeValue.slice(0, MAX_SOURCE_LEN);
}

function requiredCapabilityForCommand(type: string): string | null {
  if (ADMIN_ONLY_COMMANDS.has(type)) {
    return "admin_ops";
  }

  if (type === "EMERGENCY_LOCKDOWN") {
    return "emergency_lockdown";
  }

  return null;
}

function parseDispatchError(error: unknown): { code: string; message: string; httpStatus: number } {
  if (!(error instanceof DispatchError)) {
    const message = error instanceof Error ? error.message : "Unknown routing error";
    return {
      code: "ROUTING_ERROR",
      message,
      httpStatus: 502,
    };
  }

  switch (error.code) {
    case "TIMEOUT":
      return { code: error.code, message: error.message, httpStatus: 504 };
    case "ROUTER_OVERLOADED":
      return { code: error.code, message: error.message, httpStatus: 503 };
    case "DEVICE_OFFLINE":
    case "DEVICE_DISCONNECTED":
    case "DUPLICATE_REQUEST":
      return { code: error.code, message: error.message, httpStatus: 409 };
    case "SEND_FAILED":
      return { code: error.code, message: error.message, httpStatus: 502 };
    default:
      return { code: error.code, message: error.message, httpStatus: 500 };
  }
}

function parsePackageInspectionFailure(error: unknown): { code: string; message: string; httpStatus: number } {
  if (!(error instanceof PackageInspectionError)) {
    const message = error instanceof Error ? error.message : "Failed to inspect package URL";
    return {
      code: "UPDATE_FETCH_FAILED",
      message,
      httpStatus: 502,
    };
  }

  switch (error.code) {
    case "INVALID_UPDATE_URL":
      return { code: error.code, message: error.message, httpStatus: 400 };
    case "UPDATE_FETCH_TIMEOUT":
      return { code: error.code, message: error.message, httpStatus: 504 };
    case "UPDATE_PACKAGE_TOO_LARGE":
      return { code: error.code, message: error.message, httpStatus: 413 };
    default:
      return { code: error.code, message: error.message, httpStatus: 502 };
  }
}

function asCommandBody(body: unknown): CommandRequestBody {
  if (!body || typeof body !== "object") {
    return {};
  }

  return body as CommandRequestBody;
}

function asEnrollBody(body: unknown): EnrollRequestBody {
  if (!body || typeof body !== "object") {
    return {};
  }

  return body as EnrollRequestBody;
}

function asUpdateBody(body: unknown): UpdateRequestBody {
  if (!body || typeof body !== "object") {
    return {};
  }

  return body as UpdateRequestBody;
}

function asRenameDeviceBody(body: unknown): RenameDeviceBody {
  if (!body || typeof body !== "object") {
    return {};
  }

  return body as RenameDeviceBody;
}

function normalizeUpdateTarget(candidate: unknown): string {
  return asTrimmedString(candidate).toLowerCase();
}

function isValidTargetFormat(value: string): boolean {
  return /^(all|[a-z][a-z0-9_-]{1,31})$/.test(value);
}

function normalizeUpdateVersion(candidate: unknown): string {
  return asTrimmedString(candidate);
}

function isValidUpdateVersion(value: string): boolean {
  return /^[A-Za-z0-9._-]{1,64}$/.test(value);
}

function normalizeSha256(candidate: unknown): string {
  return asTrimmedString(candidate).toLowerCase();
}

function isValidSha256(value: string): boolean {
  return /^[a-f0-9]{64}$/.test(value);
}

function normalizeUpdatePackageUrl(candidate: unknown, enforceHttps = true): string | null {
  const value = asTrimmedString(candidate);
  if (!value) {
    return null;
  }

  try {
    const parsed = new URL(value);
    if (enforceHttps && parsed.protocol !== "https:") {
      return null;
    }

    if (!enforceHttps && parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return null;
    }

    return parsed.toString();
  } catch {
    return null;
  }
}

function normalizeOptionalSizeBytes(value: unknown, maxBytes: number): number | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0 || !Number.isInteger(parsed)) {
    return null;
  }

  if (parsed > maxBytes) {
    return null;
  }

  return parsed;
}

function inferDesignationPrefixFromPackageUrl(packageUrl: string): string | null {
  const value = packageUrl.trim().toLowerCase();
  if (!value) {
    return null;
  }

  if (value.includes("e1-agent")) {
    return "e";
  }

  if (value.includes("t1-agent")) {
    return "t";
  }

  if (value.includes("s1-agent")) {
    return "s";
  }

  if (value.includes("a1-agent")) {
    return "a";
  }

  if (value.includes("cordyceps-agent") || value.includes("jarvis-agent")) {
    return "m";
  }

  return null;
}

function deviceIdPrefix(deviceId: string): string {
  const match = deviceId.trim().toLowerCase().match(/^[a-z]+/);
  return match ? match[0].slice(0, 1) : "";
}

function prepareDesignationChange(
  db: Database,
  deviceId: string,
  nextPrefix: string | null,
): PreparedDesignationChange | null {
  if (!nextPrefix) {
    return null;
  }

  const currentPrefix = deviceIdPrefix(deviceId);
  if (!currentPrefix || currentPrefix === nextPrefix) {
    return null;
  }

  const nextDeviceId = db.allocateNextDeviceId(nextPrefix);
  if (!db.cloneDeviceWithNewId(deviceId, nextDeviceId)) {
    return null;
  }

  return {
    currentDeviceId: deviceId,
    nextDeviceId,
  };
}

function makeUpdateRawText(target: string, version: string, packageUrl: string): string {
  return `${target} update ${version} ${packageUrl}`;
}

function normalizeOptionalText(value: unknown, maxLength: number): string | undefined {
  const normalized = asTrimmedString(value);
  if (!normalized) {
    return undefined;
  }

  return normalized.slice(0, maxLength);
}

function normalizeCapabilities(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const capabilities: string[] = [];
  const seen = new Set<string>();

  for (const item of value) {
    const normalized = asTrimmedString(item).toLowerCase();
    if (!normalized || normalized.length > 40) {
      continue;
    }

    if (!/^[a-z0-9_-]+$/.test(normalized)) {
      continue;
    }

    if (!seen.has(normalized)) {
      seen.add(normalized);
      capabilities.push(normalized);
    }

    if (capabilities.length >= MAX_CAPABILITIES) {
      break;
    }
  }

  return capabilities;
}

export async function registerApiRoutes(server: FastifyInstance, deps: ApiDeps): Promise<void> {
  server.get("/api/health", async () => {
    const dbStats = deps.db.healthSnapshot();

    return {
      ok: true,
      service: "cordyceps-server",
      ts: new Date().toISOString(),
      uptime_seconds: Math.floor(process.uptime()),
      online_connections: deps.registry.countOnline(),
      pending_commands: deps.router.pendingCount(),
      devices_total: dbStats.deviceCount,
      devices_online: dbStats.onlineDeviceCount,
      command_logs_total: dbStats.commandLogCount,
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

  server.post("/api/devices/:deviceId/display-name", async (request, reply) => {
    if (!isPhoneAuthorized(request, deps.config)) {
      unauthorized(reply);
      return;
    }

    const params = request.params as { deviceId?: string } | undefined;
    const deviceId = asTrimmedString(params?.deviceId).toLowerCase();
    if (!deviceId || !/^[a-z0-9_-]{2,32}$/.test(deviceId)) {
      reply.code(400).send({
        ok: false,
        message: "device_id must be 2-32 chars and use a-z, 0-9, _ or -",
      });
      return;
    }

    const body = asRenameDeviceBody(request.body);
    const displayName = normalizeOptionalText(body.display_name, 80);
    if (!deps.db.updateDeviceDisplayName(deviceId, displayName)) {
      reply.code(404).send({
        ok: false,
        message: `Unknown device: ${deviceId}`,
        error_code: "UNKNOWN_DEVICE",
      });
      return;
    }

    reply.send({
      ok: true,
      device: deps.db.getDevice(deviceId),
      message: displayName ? `Saved name for ${deviceId}` : `Cleared name for ${deviceId}`,
    });
  });

  server.post("/api/enroll", async (request, reply) => {
    const body = asEnrollBody(request.body);
    const bootstrapToken = asTrimmedString(body.bootstrap_token);
    if (!bootstrapToken || !constantTimeEqual(bootstrapToken, deps.config.agentBootstrapToken)) {
      unauthorized(reply);
      return;
    }

    const inputDeviceId = asTrimmedString(body.device_id).toLowerCase();
    const designationPrefix = normalizeDesignationPrefix(body.designation_prefix) || "m";

    if (inputDeviceId && !/^[a-z0-9_-]{2,32}$/.test(inputDeviceId)) {
      reply.code(400).send({
        ok: false,
        message: "device_id must be 2-32 chars and use a-z, 0-9, _ or -",
      });
      return;
    }

    const token = randomToken();
    const tokenHash = sha256Hex(token);
    const displayName = normalizeOptionalText(body.display_name, 80);
    const version = normalizeOptionalText(body.version, 40);
    const hostname = normalizeOptionalText(body.hostname, 120);
    const username = normalizeOptionalText(body.username, 120);
    const capabilities = normalizeCapabilities(body.capabilities);

    let deviceId = inputDeviceId;
    if (deviceId) {
      deps.db.enrollDevice({
        deviceId,
        tokenHash,
        displayName,
        version,
        hostname,
        username,
        capabilities,
      });
    } else {
      const maxAttempts = 5;
      let enrolled = false;
      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        const candidateId = deps.db.allocateNextDeviceId(designationPrefix);
        const created = deps.db.enrollDeviceIfAbsent({
          deviceId: candidateId,
          tokenHash,
          displayName,
          version,
          hostname,
          username,
          capabilities,
        });

        if (created) {
          deviceId = candidateId;
          enrolled = true;
          break;
        }
      }

      if (!enrolled || !deviceId) {
        reply.code(503).send({
          ok: false,
          message: "Unable to allocate device designation",
        });
        return;
      }
    }

    log("info", "Device enrolled", {
      device_id: deviceId,
      hostname: normalizeOptionalText(body.hostname, 120) ?? null,
      username: normalizeOptionalText(body.username, 120) ?? null,
    });

    reply.send({
      ok: true,
      device_id: deviceId,
      device_token: token,
      ws_url: deps.config.publicWsUrl,
      message: "Enrollment complete",
    });
  });

  server.post("/api/update", async (request, reply) => {
    if (!isPhoneAuthorized(request, deps.config)) {
      unauthorized(reply);
      return;
    }

    const body = asUpdateBody(request.body);
    const requestId = normalizeRequestId(body.request_id);
    const source = normalizeSource(asTrimmedString(body.source) || "server-update");
    const target = normalizeUpdateTarget(body.target);
    const version = normalizeUpdateVersion(body.version);
    const packageUrl = normalizeUpdatePackageUrl(body.package_url, deps.config.enforceHttpsUpdateUrl);
    const providedSha256 = normalizeSha256(body.sha256);

    if (!isValidTargetFormat(target)) {
      reply.code(400).send({
        ok: false,
        request_id: requestId,
        message: "target must be a device id like t1 or all",
        error_code: "INVALID_TARGET",
      });
      return;
    }

    if (!version) {
      reply.code(400).send({
        ok: false,
        request_id: requestId,
        message: "version is required",
        error_code: "INVALID_UPDATE_VERSION",
      });
      return;
    }

    if (version.length > MAX_UPDATE_VERSION_LEN || !isValidUpdateVersion(version)) {
      reply.code(400).send({
        ok: false,
        request_id: requestId,
        message: "version must match [A-Za-z0-9._-] and be at most 64 chars",
        error_code: "INVALID_UPDATE_VERSION",
      });
      return;
    }

    if (!packageUrl) {
      reply.code(400).send({
        ok: false,
        request_id: requestId,
        message: deps.config.enforceHttpsUpdateUrl
          ? "package_url must be a valid https URL"
          : "package_url must be a valid http/https URL",
        error_code: "INVALID_UPDATE_URL",
      });
      return;
    }

    if (providedSha256 && !isValidSha256(providedSha256)) {
      reply.code(400).send({
        ok: false,
        request_id: requestId,
        message: "sha256 must be a 64-character lowercase or uppercase hex string",
        error_code: "INVALID_SHA256",
      });
      return;
    }

    const providedSizeBytes = normalizeOptionalSizeBytes(body.size_bytes, deps.config.updateMaxPackageBytes);
    if (body.size_bytes !== undefined && providedSizeBytes === null) {
      reply.code(400).send({
        ok: false,
        request_id: requestId,
        message: `size_bytes must be a positive integer <= ${deps.config.updateMaxPackageBytes}`,
        error_code: "INVALID_UPDATE_SIZE",
      });
      return;
    }

    let sha256 = providedSha256;
    let packageSizeBytes = providedSizeBytes;
    let resolvedPackageUrl = packageUrl;
    let hashSource: "provided" | "server_inspected" = providedSha256 ? "provided" : "server_inspected";

    if (!sha256) {
      try {
        const inspected = await inspectPackageFromUrl({
          url: packageUrl,
          timeoutMs: deps.config.updateMetadataTimeoutMs,
          maxBytes: deps.config.updateMaxPackageBytes,
          requireHttps: deps.config.enforceHttpsUpdateUrl,
        });

        sha256 = inspected.sha256;
        resolvedPackageUrl = inspected.finalUrl;
        if (!packageSizeBytes) {
          packageSizeBytes = inspected.sizeBytes;
        }
      } catch (error) {
        const failure = parsePackageInspectionFailure(error);
        reply.code(failure.httpStatus).send({
          ok: false,
          request_id: requestId,
          message: failure.message,
          error_code: failure.code,
        });
        return;
      }
    }

    log("info", "Update dispatch requested", {
      request_id: requestId,
      target,
      version,
      package_url: resolvedPackageUrl,
      hash_source: hashSource,
      package_size_bytes: packageSizeBytes ?? null,
    });

    const nextDesignationPrefix = inferDesignationPrefixFromPackageUrl(resolvedPackageUrl);

    const targetDeviceIds = target === "all" ? deps.registry.listOnlineDeviceIds() : [target];
    if (targetDeviceIds.length === 0) {
      reply.code(409).send({
        ok: false,
        request_id: requestId,
        message: "No online devices available",
        error_code: "NO_ONLINE_DEVICES",
      });
      return;
    }

    const preparedDesignationChanges = new Map<string, PreparedDesignationChange>();
    const rollbackPreparedDesignationChanges = (): void => {
      for (const designationChange of preparedDesignationChanges.values()) {
        deps.db.deleteDevice(designationChange.nextDeviceId);
      }
    };

    for (const deviceId of targetDeviceIds) {
      const knownDevice = deps.db.getDevice(deviceId) ?? deps.registry.get(deviceId);
      if (!knownDevice) {
        rollbackPreparedDesignationChanges();
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
        rollbackPreparedDesignationChanges();
        reply.code(409).send({
          ok: false,
          request_id: requestId,
          message: `${deviceId} is offline`,
          error_code: "DEVICE_OFFLINE",
        });
        return;
      }

      const hasUpdater = Array.isArray(connected.capabilities) && connected.capabilities.includes("updater");
      if (!hasUpdater) {
        rollbackPreparedDesignationChanges();
        reply.code(409).send({
          ok: false,
          request_id: requestId,
          message: `${deviceId} does not support remote updates yet. Update this device manually once with the latest agent.`,
          error_code: "UPDATER_NOT_SUPPORTED",
        });
        return;
      }

      const designationChange = prepareDesignationChange(deps.db, deviceId, nextDesignationPrefix);
      if (designationChange) {
        preparedDesignationChanges.set(deviceId, designationChange);
      }

      deps.db.insertCommandLog({
        id: makeLogId(requestId, deviceId),
        requestId,
        deviceId,
        source,
        rawText: makeUpdateRawText(target, version, resolvedPackageUrl),
        parsedTarget: target,
        parsedType: "AGENT_UPDATE",
        argsJson: JSON.stringify({
          version,
          url: resolvedPackageUrl,
          sha256,
          ...(packageSizeBytes ? { size_bytes: packageSizeBytes } : {}),
        }),
        status: "queued",
        resultMessage: null,
        errorCode: null,
      });
    }

    const command = {
      type: "AGENT_UPDATE" as const,
      args: {
        version,
        url: resolvedPackageUrl,
        sha256,
        ...(packageSizeBytes ? { size_bytes: packageSizeBytes } : {}),
      },
    };

    if (target !== "all") {
      const deviceId = targetDeviceIds[0];
      try {
        const designationChange = preparedDesignationChanges.get(deviceId);
        const commandWithDesignationChange = designationChange
          ? {
              ...command,
              args: {
                ...command.args,
                next_device_id: designationChange.nextDeviceId,
              },
            }
          : command;

        const result = await deps.router.dispatchToDevice({
          requestId,
          deviceId,
          command: commandWithDesignationChange,
          timeoutMs: deps.config.updateCommandTimeoutMs,
        });

        deps.db.completeCommandLog({
          id: makeLogId(requestId, deviceId),
          status: result.ok ? "ok" : "failed",
          resultMessage: result.message,
          errorCode: result.error_code,
        });

        if (designationChange) {
          if (result.ok) {
            deps.db.deleteDevice(designationChange.currentDeviceId);
          } else {
            deps.db.deleteDevice(designationChange.nextDeviceId);
          }
        }

        reply.send({
          ok: result.ok,
          request_id: requestId,
          target: deviceId,
          parsed_type: "AGENT_UPDATE",
          message: result.message,
          version,
          package_url: resolvedPackageUrl,
          sha256,
          hash_source: hashSource,
          package_size_bytes: packageSizeBytes ?? null,
          designation_change: designationChange
            ? {
                previous_device_id: designationChange.currentDeviceId,
                next_device_id: designationChange.nextDeviceId,
              }
            : null,
          result,
        });
      } catch (error) {
        const dispatch = parseDispatchError(error);
        const designationChange = preparedDesignationChanges.get(deviceId);

        deps.db.completeCommandLog({
          id: makeLogId(requestId, deviceId),
          status: dispatch.code === "TIMEOUT" ? "timeout" : "failed",
          resultMessage: dispatch.message,
          errorCode: dispatch.code,
        });

        if (designationChange) {
          deps.db.deleteDevice(designationChange.nextDeviceId);
        }

        reply.code(dispatch.httpStatus).send({
          ok: false,
          request_id: requestId,
          target: deviceId,
          parsed_type: "AGENT_UPDATE",
          message: dispatch.message,
          error_code: dispatch.code,
          version,
          package_url: resolvedPackageUrl,
          sha256,
          hash_source: hashSource,
          package_size_bytes: packageSizeBytes ?? null,
        });
      }

      return;
    }

    const results = await Promise.all(
      targetDeviceIds.map(async (deviceId) => {
        const designationChange = preparedDesignationChanges.get(deviceId);
        const commandForDevice = designationChange
          ? {
              ...command,
              args: {
                ...command.args,
                next_device_id: designationChange.nextDeviceId,
              },
            }
          : command;

        try {
          return await deps.router.dispatchToDevice({
            requestId,
            deviceId,
            command: commandForDevice,
            timeoutMs: deps.config.updateCommandTimeoutMs,
          });
        } catch (error) {
          const dispatch = parseDispatchError(error);
          return {
            request_id: requestId,
            device_id: deviceId,
            ok: false,
            message: dispatch.message,
            error_code: dispatch.code,
            completed_at: new Date().toISOString(),
          };
        }
      }),
    );

    for (const result of results) {
      deps.db.completeCommandLog({
        id: makeLogId(requestId, result.device_id),
        status: result.ok ? "ok" : "failed",
        resultMessage: result.message,
        errorCode: result.error_code,
      });

      const designationChange = preparedDesignationChanges.get(result.device_id);
      if (designationChange) {
        if (result.ok) {
          deps.db.deleteDevice(designationChange.currentDeviceId);
        } else {
          deps.db.deleteDevice(designationChange.nextDeviceId);
        }
      }
    }

    const okCount = results.filter((result) => result.ok).length;
    const total = results.length;

    reply.send({
      ok: okCount === total,
      request_id: requestId,
      target: "all",
      parsed_type: "AGENT_UPDATE",
      message: `Update dispatched ${okCount}/${total}`,
      version,
      package_url: resolvedPackageUrl,
      sha256,
      hash_source: hashSource,
      package_size_bytes: packageSizeBytes ?? null,
      results: results.map((result: CommandDispatchResult) => ({
        device_id: result.device_id,
        ok: result.ok,
        message: result.message,
        error_code: result.error_code,
        designation_change: preparedDesignationChanges.has(result.device_id)
          ? {
              previous_device_id: preparedDesignationChanges.get(result.device_id)?.currentDeviceId,
              next_device_id: preparedDesignationChanges.get(result.device_id)?.nextDeviceId,
            }
          : null,
      })),
    });
  });

  server.post("/api/command", async (request, reply) => {
    if (!isPhoneAuthorized(request, deps.config)) {
      unauthorized(reply);
      return;
    }

    const body = asCommandBody(request.body);
    const rawText = typeof body.text === "string" ? body.text : "";
    const text = rawText.trim();
    const requestId = normalizeRequestId(body.request_id);
    const source = normalizeSource(body.source);

    if (text.length === 0) {
      reply.code(400).send({
        ok: false,
        request_id: requestId,
        message: "Command rejected: command text is empty",
        error_code: "EMPTY_COMMAND",
      });
      return;
    }

    if (text.length > MAX_TEXT_LEN) {
      reply.code(400).send({
        ok: false,
        request_id: requestId,
        message: `Command rejected: command text too long (max ${MAX_TEXT_LEN})`,
        error_code: "COMMAND_TOO_LONG",
      });
      return;
    }

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

    const requiredCapability = requiredCapabilityForCommand(parsed.command.type);

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

      if (requiredCapability && !connected.capabilities.includes(requiredCapability)) {
        reply.code(409).send({
          ok: false,
          request_id: requestId,
          message: `${deviceId} does not support ${parsed.command.type.toLowerCase()} yet`,
          error_code: "COMMAND_NOT_SUPPORTED",
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
        const dispatch = parseDispatchError(error);

        deps.db.completeCommandLog({
          id: makeLogId(requestId, deviceId),
          status: dispatch.code === "TIMEOUT" ? "timeout" : "failed",
          resultMessage: dispatch.message,
          errorCode: dispatch.code,
        });

        reply.code(dispatch.httpStatus).send({
          ok: false,
          request_id: requestId,
          target: deviceId,
          parsed_type: parsed.command.type,
          message: dispatch.message,
          error_code: dispatch.code,
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
