import fastify from "fastify";
import { registerApiRoutes } from "./api/routes";
import { registerPwaRoutes } from "./api/pwaRoutes";
import { loadConfig } from "./config/env";
import { Database } from "./db/database";
import { EventHub } from "./events/eventHub";
import { DeviceRegistry } from "./realtime/deviceRegistry";
import { registerRealtime } from "./realtime/realtimeServer";
import { CommandRouter } from "./router/commandRouter";
import { QueuedUpdateDispatcher } from "./update/queuedUpdateDispatcher";
import { log } from "./utils/logger";

function normalizeOrigin(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  try {
    const parsed = new URL(trimmed);
    return parsed.origin.toLowerCase();
  } catch {
    return trimmed.replace(/\/+$/, "").toLowerCase();
  }
}

function matchesWildcard(origin: string, pattern: string): boolean {
  const normalizedPattern = normalizeOrigin(pattern);

  if (!normalizedPattern.includes("*")) {
    return origin === normalizedPattern;
  }

  // Supports patterns like "https://*.github.io".
  const [prefix, suffix] = normalizedPattern.split("*");
  return origin.startsWith(prefix ?? "") && origin.endsWith(suffix ?? "");
}

function derivePublicHttpOrigin(publicWsUrl: string): string | null {
  try {
    const parsed = new URL(publicWsUrl);
    if (parsed.protocol === "wss:") {
      parsed.protocol = "https:";
    } else if (parsed.protocol === "ws:") {
      parsed.protocol = "http:";
    } else if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return null;
    }

    parsed.pathname = "";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

function derivePwaApiOrigin(publicWsUrl: string, pwaPublicUrl: string | null): string | null {
  const origin = derivePublicHttpOrigin(publicWsUrl);
  if (!origin) {
    return null;
  }

  if (!pwaPublicUrl) {
    return origin;
  }

  try {
    const pwa = new URL(pwaPublicUrl);
    const api = new URL(origin);

    if (pwa.protocol === "https:" && api.protocol === "http:") {
      api.protocol = "https:";
      if (api.port === "80" || api.port === "8080") {
        api.port = "";
      }
    }

    return api.toString().replace(/\/$/, "");
  } catch {
    return origin;
  }
}

function normalizePublicUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const parsed = new URL(trimmed);
    return parsed.toString();
  } catch {
    return null;
  }
}

function buildPairingFragment(apiOrigin: string, token: string): string {
  const params = new URLSearchParams({
    api: apiOrigin,
    token,
    target: "m1",
    action: "ping",
    update_target: "m1",
  });
  return params.toString();
}

function isOriginAllowed(origin: string, allowlist: string[]): boolean {
  const normalizedOrigin = normalizeOrigin(origin);
  if (!normalizedOrigin) {
    return false;
  }

  return allowlist.some((allowed) => {
    const candidate = allowed.trim();
    if (!candidate) {
      return false;
    }

    if (candidate === "*") {
      return true;
    }

    return matchesWildcard(normalizedOrigin, candidate);
  });
}

function applyCorsHeaders(origin: string, allowlist: string[], reply: { header: (name: string, value: string) => void }): boolean {
  if (!isOriginAllowed(origin, allowlist)) {
    return false;
  }

  reply.header("Access-Control-Allow-Origin", origin);
  reply.header("Vary", "Origin");
  reply.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  reply.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  reply.header("Access-Control-Max-Age", "86400");
  return true;
}

const FORCED_SHUTDOWN_TIMEOUT_MS = 10_000;

function registerProcessGuards(onFatal: (input: {
  reason: string;
  error?: unknown;
  exitCode?: number;
}) => void): void {
  process.on("unhandledRejection", (reason) => {
    log("error", "Unhandled rejection", {
      reason: reason instanceof Error ? reason.message : String(reason),
    });

    onFatal({
      reason: "unhandled rejection",
      error: reason,
      exitCode: 1,
    });
  });

  process.on("uncaughtException", (error) => {
    log("error", "Uncaught exception", {
      error: error.message,
      stack: error.stack ?? null,
    });

    onFatal({
      reason: "uncaught exception",
      error,
      exitCode: 1,
    });
  });
}

async function main(): Promise<void> {
  const config = loadConfig();
  const db = new Database(config.sqlitePath);
  const registry = new DeviceRegistry();
  const router = new CommandRouter(registry, config.commandTimeoutMs, config.maxPendingCommands);
  const eventHub = new EventHub();
  const queuedUpdateDispatcher = new QueuedUpdateDispatcher({
    db,
    eventHub,
    registry,
    router,
    updateCommandTimeoutMs: config.updateCommandTimeoutMs,
  });

  const server = fastify({
    logger: false,
    bodyLimit: 1_048_576,
  });

  server.setErrorHandler((error, request, reply) => {
    const statusCode =
      typeof (error as { statusCode?: unknown }).statusCode === "number"
        ? Math.max(400, Math.min(599, Math.floor((error as { statusCode: number }).statusCode)))
        : 500;
    const errorMessage = error instanceof Error ? error.message : String(error);

    log("error", "Unhandled server error", {
      path: request.url,
      method: request.method,
      status_code: statusCode,
      error: errorMessage,
    });

    if (reply.sent) {
      return;
    }

    reply.code(statusCode).send({
      ok: false,
      message: statusCode >= 500 ? "Internal server error" : errorMessage,
    });
  });

  server.addHook("onRequest", async (request, reply) => {
    const originHeader = request.headers.origin;
    const origin = typeof originHeader === "string" ? originHeader : "";

    if (!origin) {
      return;
    }

    const allowed = applyCorsHeaders(origin, config.corsAllowedOrigins, reply);
    if (!allowed) {
      reply.code(403).send({ ok: false, message: "Origin not allowed" });
      return;
    }

    if (request.method === "OPTIONS") {
      reply.code(204).send();
    }
  });

  await registerPwaRoutes(server);

  await registerApiRoutes(server, {
    config,
    db,
    registry,
    router,
    eventHub,
    queuedUpdateDispatcher,
  });

  await registerRealtime(server, {
    db,
    registry,
    router,
    eventHub,
    queuedUpdateDispatcher,
    wsAuthTimeoutMs: config.wsAuthTimeoutMs,
    wsPingIntervalMs: config.wsPingIntervalMs,
    wsMaxMessageBytes: config.wsMaxMessageBytes,
    allowAutomaticUpdates: config.allowAutomaticUpdates,
    updateRequireSignature: config.updateRequireSignature,
  });

  let heartbeatSweepTimer: NodeJS.Timeout | null = setInterval(() => {
    try {
      const timedOutDevices = registry.pruneExpired(config.heartbeatTtlMs);
      for (const deviceId of timedOutDevices) {
        db.markDeviceOffline(deviceId);
        router.clearDevicePending(deviceId);
        eventHub.publish("device_status", {
          device_id: deviceId,
          status: "offline",
          reason: "heartbeat_timeout",
        });
        log("warn", "Agent heartbeat expired", { device_id: deviceId });
      }

      const timedOutHeartbeatProcesses = registry.pruneExpiredHeartbeatProcesses(config.heartbeatTtlMs);
      for (const deviceId of timedOutHeartbeatProcesses) {
        db.markHeartbeatProcessOffline(deviceId);
        eventHub.publish("device_status", {
          device_id: deviceId,
          status: "offline",
          subprocess: "heartbeat",
          reason: "heartbeat_timeout",
        });
        log("warn", "Heartbeat process expired", { device_id: deviceId });
      }

      const timedOutDroneProcesses = registry.pruneExpiredDroneProcesses(config.heartbeatTtlMs);
      for (const { deviceId, role } of timedOutDroneProcesses) {
        eventHub.publish("device_status", {
          device_id: deviceId,
          status: "offline",
          subprocess: "drone",
          role,
          reason: "heartbeat_timeout",
        });
        log("warn", "Drone process expired", { device_id: deviceId, role });
      }
    } catch (error) {
      log("error", "Heartbeat sweep failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }, 30_000);

  heartbeatSweepTimer.unref?.();

  let shuttingDown: Promise<void> | null = null;
  let exitCode = 0;
  const shutdown = async (input?: {
    exitCode?: number;
    reason?: string;
    error?: unknown;
  }): Promise<void> => {
    exitCode = Math.max(exitCode, input?.exitCode ?? 0);

    if (shuttingDown) {
      return shuttingDown;
    }

    shuttingDown = (async () => {
      const forceExitTimer = setTimeout(() => {
        log("error", "Forced shutdown timeout exceeded", {
          exit_code: exitCode,
          reason: input?.reason ?? "shutdown",
        });
        process.exit(exitCode || 1);
      }, FORCED_SHUTDOWN_TIMEOUT_MS);
      forceExitTimer.unref?.();

      if (heartbeatSweepTimer) {
        clearInterval(heartbeatSweepTimer);
        heartbeatSweepTimer = null;
      }

      log("info", "Shutting down server", {
        reason: input?.reason ?? "signal",
        fatal: exitCode > 0,
        error: input?.error instanceof Error ? input.error.message : input?.error ? String(input.error) : null,
      });

      try {
        router.clearAllPending("server shutdown");
      } catch {
        // ignore pending cleanup errors during shutdown
      }

      try {
        const closedConnections = registry.closeAll(1001, "Server shutting down");
        db.clearTransientPresence();
        log("info", "Closed live realtime connections", {
          devices: closedConnections.devices.length,
          heartbeat_processes: closedConnections.heartbeatProcesses.length,
          drone_processes: closedConnections.droneProcesses.length,
        });
      } catch (error) {
        log("warn", "Realtime connection cleanup failed during shutdown", {
          error: error instanceof Error ? error.message : String(error),
        });
      }

      try {
        await server.close();
      } catch (error) {
        log("warn", "Server close failed during shutdown", {
          error: error instanceof Error ? error.message : String(error),
        });
      }

      try {
        db.close();
      } catch (error) {
        log("warn", "Database close failed during shutdown", {
          error: error instanceof Error ? error.message : String(error),
        });
      }

      clearTimeout(forceExitTimer);
      process.exit(exitCode);
    })();

    return shuttingDown;
  };

  registerProcessGuards((input) => {
    void shutdown(input);
  });

  try {
    await server.listen({ host: config.host, port: config.port });
  } catch (error) {
    if (heartbeatSweepTimer) {
      clearInterval(heartbeatSweepTimer);
      heartbeatSweepTimer = null;
    }
    throw error;
  }

  log("info", "Server started", {
    host: config.host,
    port: config.port,
    sqlite_path: config.sqlitePath,
    sqlite_path_source: config.sqlitePathSource,
    secrets_path: config.secretsPath,
    secrets_path_source: config.secretsPathSource,
    max_pending_commands: config.maxPendingCommands,
    command_timeout_ms: config.commandTimeoutMs,
    realtime_listeners: eventHub.listenerCount(),
    update_command_timeout_ms: config.updateCommandTimeoutMs,
    update_metadata_timeout_ms: config.updateMetadataTimeoutMs,
    update_max_package_bytes: config.updateMaxPackageBytes,
    enforce_https_update_url: config.enforceHttpsUpdateUrl,
    allow_automatic_updates: config.allowAutomaticUpdates,
    update_require_signature: config.updateRequireSignature,
    update_signing_key_ids: Object.keys(config.updateSigningKeys),
    cors_allowed_origins: config.corsAllowedOrigins,
    phone_token_source: config.phoneApiTokenSource,
    bootstrap_token_source: config.agentBootstrapTokenSource,
  });

  const pwaPublicUrl = normalizePublicUrl(config.pwaPublicUrl);
  const publicOrigin = derivePublicHttpOrigin(config.publicWsUrl);
  const pwaApiOrigin = derivePwaApiOrigin(config.publicWsUrl, pwaPublicUrl);
  if (publicOrigin && pwaApiOrigin) {
    const pwaUrl = `${publicOrigin}/app`;
    const pairingFragment = buildPairingFragment(pwaApiOrigin, config.phoneApiToken);
    const pairingUrl = `${pwaUrl}#${pairingFragment}`;

    log("info", "Quick start links", {
      pwa_url: pwaUrl,
      pwa_pairing_url: pairingUrl,
      external_pwa_url: pwaPublicUrl,
      external_pwa_pairing_url: pwaPublicUrl
        ? `${pwaPublicUrl}#${pairingFragment}`
        : null,
    });

    if (publicOrigin !== pwaApiOrigin) {
      log("warn", "Adjusted API origin for HTTPS PWA pairing links", {
        public_origin: publicOrigin,
        pwa_api_origin: pwaApiOrigin,
      });
    }
  }

  if (config.phoneApiTokenSource === "generated" || config.agentBootstrapTokenSource === "generated") {
    log("warn", "Generated tokens were used (auto-persisted)", {
      phone_api_token: config.phoneApiToken,
      agent_bootstrap_token: config.agentBootstrapToken,
    });
  }

  process.on("SIGINT", () => {
    void shutdown({ reason: "SIGINT" });
  });

  process.on("SIGTERM", () => {
    void shutdown({ reason: "SIGTERM" });
  });
}

main().catch((error) => {
  log("error", "Fatal startup error", { error: error instanceof Error ? error.message : String(error) });
  process.exit(1);
});
