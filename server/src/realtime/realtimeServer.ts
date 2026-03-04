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
  wsAuthTimeoutMs: number;
  wsPingIntervalMs: number;
  wsMaxMessageBytes: number;
}

interface WsLike {
  send(data: string): void;
  ping?(data?: Buffer | string, cb?: (error?: Error) => void): void;
  close(code?: number, reason?: Buffer | string): void;
  on(event: "message", listener: (data: unknown) => void): void;
  on(event: "close", listener: () => void): void;
  on(event: "error", listener: (error: unknown) => void): void;
  readyState?: number;
  OPEN?: number;
}

function isWsLike(value: unknown): value is WsLike {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.send === "function" &&
    typeof candidate.close === "function" &&
    typeof candidate.on === "function"
  );
}

function resolveSocket(connection: unknown): WsLike | null {
  if (isWsLike(connection)) {
    return connection;
  }

  if (!connection || typeof connection !== "object") {
    return null;
  }

  const maybeSocket = (connection as { socket?: unknown }).socket;
  if (isWsLike(maybeSocket)) {
    return maybeSocket;
  }

  return null;
}

function isSocketOpen(socket: WsLike): boolean {
  if (typeof socket.readyState !== "number") {
    return true;
  }

  const openState = typeof socket.OPEN === "number" ? socket.OPEN : 1;
  return socket.readyState === openState;
}

function closeQuietly(socket: WsLike, code: number, reason: string): void {
  try {
    socket.close(code, reason);
  } catch {
    // socket already closing/closed
  }
}

function parseJson(input: unknown): Record<string, unknown> | null {
  const text = decodePayload(input);
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

function payloadSizeBytes(input: unknown): number {
  if (typeof input === "string") {
    return Buffer.byteLength(input, "utf8");
  }

  if (input instanceof Buffer) {
    return input.byteLength;
  }

  if (input instanceof ArrayBuffer) {
    return input.byteLength;
  }

  if (ArrayBuffer.isView(input)) {
    return input.byteLength;
  }

  return 0;
}

function safeSendJson(socket: WsLike, payload: Record<string, unknown>): void {
  if (!isSocketOpen(socket)) {
    return;
  }

  try {
    socket.send(JSON.stringify(payload));
  } catch {
    // ignore send errors here, read/write loop will close eventually
  }
}

function decodePayload(input: unknown): string {
  if (typeof input === "string") {
    return input;
  }

  if (input instanceof Buffer) {
    return input.toString("utf8");
  }

  if (input instanceof ArrayBuffer) {
    return Buffer.from(input).toString("utf8");
  }

  if (ArrayBuffer.isView(input)) {
    return Buffer.from(input.buffer, input.byteOffset, input.byteLength).toString("utf8");
  }

  return "";
}

function normalizeRequiredString(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength) {
    return null;
  }

  return trimmed;
}

function normalizeCapabilities(value: unknown): string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const normalized: string[] = [];
  const seen = new Set<string>();

  for (const item of value) {
    if (typeof item !== "string") {
      continue;
    }

    const capability = item.trim().toLowerCase();
    if (!capability || capability.length > 40) {
      continue;
    }

    if (!/^[a-z0-9_-]+$/.test(capability)) {
      continue;
    }

    if (!seen.has(capability)) {
      seen.add(capability);
      normalized.push(capability);
    }

    if (normalized.length >= 50) {
      break;
    }
  }

  return normalized;
}

function isValidDeviceId(value: string): boolean {
  return /^[a-z0-9_-]{2,32}$/.test(value);
}

function asHelloMessage(value: Record<string, unknown>): AgentHelloMessage | null {
  if (value.kind !== "hello") {
    return null;
  }

  const deviceId = normalizeRequiredString(value.device_id, 32);
  const token = normalizeRequiredString(value.token, 256);
  const version = normalizeRequiredString(value.version, 64);
  const hostname = normalizeRequiredString(value.hostname, 120);
  const username = normalizeRequiredString(value.username, 120);
  const capabilities = normalizeCapabilities(value.capabilities);

  if (!deviceId || !token || !version || !hostname || !username || !capabilities) {
    return null;
  }

  if (!isValidDeviceId(deviceId)) {
    return null;
  }

  return {
    kind: "hello",
    device_id: deviceId,
    token,
    version,
    hostname,
    username,
    capabilities,
  };
}

function asHeartbeatMessage(value: Record<string, unknown>): AgentHeartbeatMessage | null {
  if (value.kind !== "heartbeat") {
    return null;
  }

  const deviceId = normalizeRequiredString(value.device_id, 32);
  const sentAt = normalizeRequiredString(value.sent_at, 80);
  if (!deviceId || !sentAt || !isValidDeviceId(deviceId)) {
    return null;
  }

  return {
    kind: "heartbeat",
    device_id: deviceId,
    sent_at: sentAt,
  };
}

function asResultMessage(value: Record<string, unknown>): AgentResultMessage | null {
  if (value.kind !== "result") {
    return null;
  }

  const requestId = normalizeRequiredString(value.request_id, 100);
  const deviceId = normalizeRequiredString(value.device_id, 32);
  const message = normalizeRequiredString(value.message, 1000);
  const completedAt = normalizeRequiredString(value.completed_at, 80);

  if (
    !requestId ||
    !deviceId ||
    typeof value.ok !== "boolean" ||
    !message ||
    !completedAt
  ) {
    return null;
  }

  if (!isValidDeviceId(deviceId)) {
    return null;
  }

  if (value.error_code !== undefined && normalizeRequiredString(value.error_code, 100) === null) {
    return null;
  }

  if (value.version !== undefined && normalizeRequiredString(value.version, 64) === null) {
    return null;
  }

  return {
    kind: "result",
    request_id: requestId,
    device_id: deviceId,
    ok: value.ok,
    message,
    error_code:
      value.error_code === undefined ? undefined : normalizeRequiredString(value.error_code, 100) ?? undefined,
    completed_at: completedAt,
    version: value.version === undefined ? undefined : normalizeRequiredString(value.version, 64) ?? undefined,
  };
}

export async function registerRealtime(server: FastifyInstance, deps: RealtimeDeps): Promise<void> {
  await server.register(websocketPlugin);

  server.get("/ws/agent", { websocket: true }, (connection) => {
    const socket = resolveSocket(connection);
    if (!socket) {
      log("error", "Failed to resolve websocket socket instance");
      return;
    }

    let authenticated = false;
    let activeDeviceId: string | null = null;
    let pingTimer: NodeJS.Timeout | null = null;

    const authTimer = setTimeout(() => {
      if (!authenticated) {
        closeQuietly(socket, 4001, "Authentication timeout");
      }
    }, deps.wsAuthTimeoutMs);

    authTimer.unref?.();

    socket.on("message", (raw) => {
      try {
        if (payloadSizeBytes(raw) > deps.wsMaxMessageBytes) {
          closeQuietly(socket, 1009, "Message too large");
          return;
        }

        const payload = parseJson(raw);
        if (!payload) {
          closeQuietly(socket, 4004, "Invalid JSON message");
          return;
        }

        if (!authenticated) {
          const hello = asHelloMessage(payload);
          if (!hello) {
            closeQuietly(socket, 4003, "Expected hello handshake");
            return;
          }

          const validToken = deps.db.isValidDeviceToken(hello.device_id, hello.token);
          if (!validToken) {
            closeQuietly(socket, 4003, "Invalid device token");
            return;
          }

          authenticated = true;
          activeDeviceId = hello.device_id;
          clearTimeout(authTimer);

          deps.registry.register({
            deviceId: hello.device_id,
            socket,
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

          safeSendJson(socket, {
            kind: "hello_ack",
            server_time: new Date().toISOString(),
          });

          pingTimer = setInterval(() => {
            if (!isSocketOpen(socket)) {
              return;
            }

            if (typeof socket.ping !== "function") {
              return;
            }

            try {
              socket.ping();
            } catch {
              closeQuietly(socket, 1011, "Ping failure");
            }
          }, deps.wsPingIntervalMs);

          pingTimer.unref?.();

          log("info", "Agent connected", {
            device_id: hello.device_id,
            version: hello.version,
            hostname: hello.hostname,
          });
          return;
        }

        if (!activeDeviceId) {
          closeQuietly(socket, 4003, "Authentication state error");
          return;
        }

        const heartbeat = asHeartbeatMessage(payload);
        if (heartbeat) {
          if (heartbeat.device_id !== activeDeviceId) {
            closeQuietly(socket, 4003, "Device mismatch");
            return;
          }

          deps.registry.markHeartbeat(activeDeviceId);
          deps.db.touchHeartbeat(activeDeviceId);
          safeSendJson(socket, { kind: "heartbeat_ack", server_time: new Date().toISOString() });
          return;
        }

        const result = asResultMessage(payload);
        if (result) {
          if (result.device_id !== activeDeviceId) {
            closeQuietly(socket, 4003, "Device mismatch");
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
      } catch (error) {
        log("error", "Unhandled websocket message error", {
          device_id: activeDeviceId ?? "unknown",
          error: error instanceof Error ? error.message : String(error),
        });

        closeQuietly(socket, 1011, "Internal error");
      }
    });

    socket.on("close", () => {
      clearTimeout(authTimer);
      if (pingTimer) {
        clearInterval(pingTimer);
      }

      if (!activeDeviceId) {
        return;
      }

      const stillCurrent = deps.registry.isCurrentSocket(activeDeviceId, socket);
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

    socket.on("error", (error) => {
      log("warn", "Agent socket error", {
        device_id: activeDeviceId ?? "unknown",
        error: error instanceof Error ? error.message : String(error),
      });
    });
  });
}
