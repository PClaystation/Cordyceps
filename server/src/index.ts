import fastify from "fastify";
import { registerApiRoutes } from "./api/routes";
import { loadConfig } from "./config/env";
import { Database } from "./db/database";
import { DeviceRegistry } from "./realtime/deviceRegistry";
import { registerRealtime } from "./realtime/realtimeServer";
import { CommandRouter } from "./router/commandRouter";
import { log } from "./utils/logger";

async function main(): Promise<void> {
  const config = loadConfig();
  const db = new Database(config.sqlitePath);
  const registry = new DeviceRegistry();
  const router = new CommandRouter(registry, config.commandTimeoutMs);

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
  });

  const heartbeatSweepTimer = setInterval(() => {
    const timedOutDevices = registry.pruneExpired(config.heartbeatTtlMs);
    for (const deviceId of timedOutDevices) {
      db.markDeviceOffline(deviceId);
      router.clearDevicePending(deviceId);
      log("warn", "Agent heartbeat expired", { device_id: deviceId });
    }
  }, 30_000);

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
  });

  const shutdown = async (): Promise<void> => {
    clearInterval(heartbeatSweepTimer);
    log("info", "Shutting down server");
    await server.close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error) => {
  log("error", "Fatal startup error", { error: error instanceof Error ? error.message : String(error) });
  process.exit(1);
});
