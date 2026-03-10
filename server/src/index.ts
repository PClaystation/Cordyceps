import fastify from "fastify";
import { registerApiRoutes } from "./api/routes";
import { registerPwaRoutes } from "./api/pwaRoutes";
import { loadConfig } from "./config/env";
import { Database } from "./db/database";
import { DeviceRegistry } from "./realtime/deviceRegistry";
import { registerRealtime } from "./realtime/realtimeServer";
import { CommandRouter } from "./router/commandRouter";
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
  reply.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  reply.header("Access-Control-Max-Age", "86400");
  return true;
}

function registerProcessGuards(): void {
  process.on("unhandledRejection", (reason) => {
    log("error", "Unhandled rejection", {
      reason: reason instanceof Error ? reason.message : String(reason),
    });
  });

  process.on("uncaughtException", (error) => {
    log("error", "Uncaught exception", {
      error: error.message,
      stack: error.stack ?? null,
    });
  });
}

async function main(): Promise<void> {
  registerProcessGuards();

  const config = loadConfig();
  const db = new Database(config.sqlitePath);
  const registry = new DeviceRegistry();
  const router = new CommandRouter(registry, config.commandTimeoutMs, config.maxPendingCommands);

  const server = fastify({
    logger: false,
    bodyLimit: 1_048_576,
  });

  server.setErrorHandler((error, request, reply) => {
    log("error", "Unhandled server error", {
      path: request.url,
      method: request.method,
      error: error instanceof Error ? error.message : String(error),
    });

    reply.code(500).send({
      ok: false,
      message: "Internal server error",
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
  });

  await registerRealtime(server, {
    db,
    registry,
    router,
    wsAuthTimeoutMs: config.wsAuthTimeoutMs,
    wsPingIntervalMs: config.wsPingIntervalMs,
    wsMaxMessageBytes: config.wsMaxMessageBytes,
  });

  const heartbeatSweepTimer = setInterval(() => {
    try {
      const timedOutDevices = registry.pruneExpired(config.heartbeatTtlMs);
      for (const deviceId of timedOutDevices) {
        db.markDeviceOffline(deviceId);
        router.clearDevicePending(deviceId);
        log("warn", "Agent heartbeat expired", { device_id: deviceId });
      }
    } catch (error) {
      log("error", "Heartbeat sweep failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }, 30_000);

  heartbeatSweepTimer.unref?.();

  try {
    await server.listen({ host: config.host, port: config.port });
  } catch (error) {
    clearInterval(heartbeatSweepTimer);
    throw error;
  }

  log("info", "Server started", {
    host: config.host,
    port: config.port,
    sqlite_path: config.sqlitePath,
    secrets_path: config.secretsPath,
    max_pending_commands: config.maxPendingCommands,
    command_timeout_ms: config.commandTimeoutMs,
    update_command_timeout_ms: config.updateCommandTimeoutMs,
    update_metadata_timeout_ms: config.updateMetadataTimeoutMs,
    update_max_package_bytes: config.updateMaxPackageBytes,
    enforce_https_update_url: config.enforceHttpsUpdateUrl,
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

  let shuttingDown = false;
  const shutdown = async (): Promise<void> => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;

    clearInterval(heartbeatSweepTimer);
    log("info", "Shutting down server");

    try {
      router.clearAllPending("server shutdown");
    } catch {
      // ignore pending cleanup errors during shutdown
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

    process.exit(0);
  };

  process.on("SIGINT", () => {
    void shutdown();
  });

  process.on("SIGTERM", () => {
    void shutdown();
  });
}

main().catch((error) => {
  log("error", "Fatal startup error", { error: error instanceof Error ? error.message : String(error) });
  process.exit(1);
});
