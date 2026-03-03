import path from "node:path";

function readInt(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid integer for ${name}`);
  }

  return parsed;
}

function readCsv(name: string, fallback: string): string[] {
  const raw = process.env[name] ?? fallback;
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

export interface AppConfig {
  host: string;
  port: number;
  phoneApiToken: string;
  agentBootstrapToken: string;
  sqlitePath: string;
  commandTimeoutMs: number;
  maxPendingCommands: number;
  heartbeatTtlMs: number;
  wsAuthTimeoutMs: number;
  wsPingIntervalMs: number;
  wsMaxMessageBytes: number;
  corsAllowedOrigins: string[];
  publicWsUrl: string;
}

export function loadConfig(): AppConfig {
  const host = process.env.HOST ?? "0.0.0.0";
  const port = readInt("PORT", 8080);
  const phoneApiToken = process.env.PHONE_API_TOKEN ?? "change-me-phone-token";
  const agentBootstrapToken = process.env.AGENT_BOOTSTRAP_TOKEN ?? "change-me-bootstrap-token";
  const sqlitePath = process.env.SQLITE_PATH ?? path.join(process.cwd(), "data", "jarvis.db");
  const commandTimeoutMs = readInt("COMMAND_TIMEOUT_MS", 5000);
  const maxPendingCommands = readInt("MAX_PENDING_COMMANDS", 1000);
  const heartbeatTtlMs = readInt("HEARTBEAT_TTL_MS", 90000);
  const wsAuthTimeoutMs = readInt("WS_AUTH_TIMEOUT_MS", 10000);
  const wsPingIntervalMs = readInt("WS_PING_INTERVAL_MS", 30000);
  const wsMaxMessageBytes = readInt("WS_MAX_MESSAGE_BYTES", 65536);
  const corsAllowedOrigins = readCsv("CORS_ALLOWED_ORIGINS", "*");
  const publicWsUrl = process.env.PUBLIC_WS_URL ?? `ws://localhost:${port}/ws/agent`;

  return {
    host,
    port,
    phoneApiToken,
    agentBootstrapToken,
    sqlitePath,
    commandTimeoutMs,
    maxPendingCommands,
    heartbeatTtlMs,
    wsAuthTimeoutMs,
    wsPingIntervalMs,
    wsMaxMessageBytes,
    corsAllowedOrigins,
    publicWsUrl,
  };
}
