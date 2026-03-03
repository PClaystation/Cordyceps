import websocketPlugin from "@fastify/websocket";
import type { FastifyInstance } from "fastify";
import type {
  AgentHeartbeatMessage,
  AgentHelloMessage,
  AgentResultMessage,
} from "../types/protocol";
import type { Database } from "../db/database";
import { CommandRouter } from "../router/commandRouter";
import { DeviceRegistry } from "./deviceRegistry";
import { log } from "../utils/logger";

interface RealtimeDeps {
  db: Database;
  registry: DeviceRegistry;
  router: CommandRouter;
}

function parseJson(input: unknown): Record<string, unknown> | null {
  const text = typeof input === "string" ? input : input instanceof Buffer ? input.toString("utf8") : "";
  if (!text) {
    return null;
  }

  try {
    const parsed = JSON.parse(text) as unknown;
    if (typeof parsed !== "object" || parsed === null) {
      return null;
    }

    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function asHelloMessage(value: Record<string, unknown>): AgentHelloMessage | null {
  if (value.kind !== "hello") {
    return null;
  }

  if (
    !isString(value.device_id) ||
    !isString(value.token) ||
    !isString(value.version) ||
    !isString(value.hostname) ||
    !isString(value.username) ||
    !isStringArray(value.capabilities)
  ) {
    return null;
  }

  return {
    kind: "hello",
    device_id: value.device_id,
    token: value.token,
    version: value.version,
    hostname: value.hostname,
    username: value.username,
    capabilities: value.capabilities,
  };
}

function asHeartbeatMessage(value: Record<string, unknown>): AgentHeartbeatMessage | null {
  if (value.kind !== "heartbeat") {
    return null;
  }

  if (!isString(value.device_id) || !isString(value.sent_at)) {
    return null;
  }

  return {
    kind: "heartbeat",
    device_id: value.device_id,
    sent_at: value.sent_at,
  };
}

function asResultMessage(value: Record<string, unknown>): AgentResultMessage | null {
  if (value.kind !== "result") {
    return null;
  }

  if (
    !isString(value.request_id) ||
    !isString(value.device_id) ||
    typeof value.ok !== "boolean" ||
    !isString(value.message) ||
    !isString(value.completed_at)
  ) {
    return null;
  }

  if (value.error_code !== undefined && typeof value.error_code !== "string") {
    return null;
  }

  if (value.version !== undefined && typeof value.version !== "string") {
    return null;
  }

  return {
    kind: "result",
    request_id: value.request_id,
    device_id: value.device_id,
    ok: value.ok,
    message: value.message,
    error_code: value.error_code,
    completed_at: value.completed_at,
    version: value.version,
  };
}

export async function registerRealtime(server: FastifyInstance, deps: RealtimeDeps): Promise<void> {
  await server.register(websocketPlugin);

  server.get("/ws/agent", { websocket: true }, (connection) => {
    let authenticated = false;
    let activeDeviceId: string | null = null;

    const authTimer = setTimeout(() => {
      if (!authenticated) {
        connection.socket.close(4001, "Authentication timeout");
      }
    }, 10_000);

    connection.socket.on("message", (raw) => {
      const payload = parseJson(raw);
      if (!payload) {
        connection.socket.close(4004, "Invalid JSON message");
        return;
      }

      if (!authenticated) {
        const hello = asHelloMessage(payload);
        if (!hello) {
          connection.socket.close(4003, "Expected hello handshake");
          return;
        }

        const validToken = deps.db.isValidDeviceToken(hello.device_id, hello.token);
        if (!validToken) {
          connection.socket.close(4003, "Invalid device token");
          return;
        }

        authenticated = true;
        activeDeviceId = hello.device_id;
        clearTimeout(authTimer);

        deps.registry.register({
          deviceId: hello.device_id,
          socket: connection.socket,
          version: hello.version,
          hostname: hello.hostname,
          username: hello.username,
          capabilities: hello.capabilities,
        });

        deps.db.markDeviceOnline({
          deviceId: hello.device_id,
          version: hello.version,
          hostname: hello.hostname,
          username: hello.username,
          capabilities: hello.capabilities,
        });

        connection.socket.send(
          JSON.stringify({
            kind: "hello_ack",
            server_time: new Date().toISOString(),
          }),
        );

        log("info", "Agent connected", {
          device_id: hello.device_id,
          version: hello.version,
          hostname: hello.hostname,
        });
        return;
      }

      if (!activeDeviceId) {
        connection.socket.close(4003, "Authentication state error");
        return;
      }

      const heartbeat = asHeartbeatMessage(payload);
      if (heartbeat) {
        if (heartbeat.device_id !== activeDeviceId) {
          connection.socket.close(4003, "Device mismatch");
          return;
        }

        deps.registry.markHeartbeat(activeDeviceId);
        deps.db.touchHeartbeat(activeDeviceId);
        return;
      }

      const result = asResultMessage(payload);
      if (result) {
        if (result.device_id !== activeDeviceId) {
          connection.socket.close(4003, "Device mismatch");
          return;
        }

        deps.registry.markHeartbeat(activeDeviceId);
        deps.db.touchHeartbeat(activeDeviceId);

        const matched = deps.router.handleAgentResult(result);
        if (!matched) {
          log("warn", "Unmatched command result", {
            device_id: result.device_id,
            request_id: result.request_id,
          });
        }

        return;
      }

      log("warn", "Unknown message kind", {
        device_id: activeDeviceId,
        payload,
      });
    });

    connection.socket.on("close", () => {
      clearTimeout(authTimer);

      if (!activeDeviceId) {
        return;
      }

      const stillCurrent = deps.registry.isCurrentSocket(activeDeviceId, connection.socket);
      if (!stillCurrent) {
        return;
      }

      deps.registry.disconnect(activeDeviceId);
      deps.db.markDeviceOffline(activeDeviceId);
      deps.router.clearDevicePending(activeDeviceId);

      log("info", "Agent disconnected", {
        device_id: activeDeviceId,
      });
    });

    connection.socket.on("error", (error) => {
      log("warn", "Agent socket error", {
        device_id: activeDeviceId ?? "unknown",
        error: error.message,
      });
    });
  });
}
