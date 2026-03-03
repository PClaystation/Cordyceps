import cors from "@fastify/cors";
import fastify from "fastify";
import { registerApiRoutes } from "./api/routes";
import { registerPwaRoutes } from "./api/pwaRoutes";
import { loadConfig } from "./config/env";
import { Database } from "./db/database";
import { DeviceRegistry } from "./realtime/deviceRegistry";
import { registerRealtime } from "./realtime/realtimeServer";
import { CommandRouter } from "./router/commandRouter";
import { log } from "./utils/logger";

function isOriginAllowed(origin: string, allowlist: string[]): boolean {
  if (allowlist.includes("*")) {
    return true;
  }

  return allowlist.includes(origin);
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
      error: error.message,
    });

    reply.code(500).send({
      ok: false,
      message: "Internal server error",
    });
  });

  await server.register(cors, {
    origin: (origin, cb) => {
      if (!origin) {
        cb(null, true);
        return;
      }

      cb(null, isOriginAllowed(origin, config.corsAllowedOrigins));
    },
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    maxAge: 86_400,
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
    max_pending_commands: config.maxPendingCommands,
    cors_allowed_origins: config.corsAllowedOrigins,
  });

  const shutdown = async (): Promise<void> => {
    clearInterval(heartbeatSweepTimer);
    log("info", "Shutting down server");

    try {
      router.clearAllPending("server shutdown");
    } catch {
      // ignore pending cleanup errors during shutdown
    }

    await server.close();
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
