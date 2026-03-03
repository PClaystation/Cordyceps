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

export interface AppConfig {
  host: string;
  port: number;
  phoneApiToken: string;
  agentBootstrapToken: string;
  sqlitePath: string;
  commandTimeoutMs: number;
  heartbeatTtlMs: number;
  publicWsUrl: string;
}

export function loadConfig(): AppConfig {
  const host = process.env.HOST ?? "0.0.0.0";
  const port = readInt("PORT", 8080);
  const phoneApiToken = process.env.PHONE_API_TOKEN ?? "change-me-phone-token";
  const agentBootstrapToken = process.env.AGENT_BOOTSTRAP_TOKEN ?? "change-me-bootstrap-token";
  const sqlitePath = process.env.SQLITE_PATH ?? path.join(process.cwd(), "data", "jarvis.db");
  const commandTimeoutMs = readInt("COMMAND_TIMEOUT_MS", 5000);
  const heartbeatTtlMs = readInt("HEARTBEAT_TTL_MS", 90000);
  const publicWsUrl = process.env.PUBLIC_WS_URL ?? `ws://localhost:${port}/ws/agent`;

  return {
    host,
    port,
    phoneApiToken,
    agentBootstrapToken,
    sqlitePath,
    commandTimeoutMs,
    heartbeatTtlMs,
    publicWsUrl,
  };
}
