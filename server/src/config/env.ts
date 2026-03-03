import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const DEFAULT_CORS_ALLOWED_ORIGINS = [
  "https://pclaystation.github.io",
  "https://mpmc.ddns.net",
].join(",");
const DEFAULT_PWA_PUBLIC_URL = "https://pclaystation.github.io/Jarvis/";

const PHONE_PLACEHOLDER = "change-me-phone-token";
const BOOTSTRAP_PLACEHOLDER = "change-me-bootstrap-token";

type SecretSource = "env" | "secrets_file" | "generated";

interface StoredSecretsFile {
  phone_api_token: string;
  agent_bootstrap_token: string;
  created_at: string;
  updated_at: string;
}

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

function isRealToken(value: string | undefined, placeholder: string): value is string {
  const normalized = value?.trim() ?? "";
  return normalized.length > 0 && normalized !== placeholder;
}

function randomToken(length = 32): string {
  return randomBytes(length).toString("base64url");
}

function tryReadSecretsFile(filePath: string): StoredSecretsFile | null {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<StoredSecretsFile>;

    if (
      typeof parsed.phone_api_token === "string" &&
      parsed.phone_api_token.length > 0 &&
      typeof parsed.agent_bootstrap_token === "string" &&
      parsed.agent_bootstrap_token.length > 0
    ) {
      return {
        phone_api_token: parsed.phone_api_token,
        agent_bootstrap_token: parsed.agent_bootstrap_token,
        created_at: typeof parsed.created_at === "string" ? parsed.created_at : new Date().toISOString(),
        updated_at: typeof parsed.updated_at === "string" ? parsed.updated_at : new Date().toISOString(),
      };
    }
  } catch {
    // ignore parse/read errors and generate fresh secrets below
  }

  return null;
}

function writeSecretsFile(filePath: string, payload: StoredSecretsFile): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const body = JSON.stringify(payload, null, 2);
  fs.writeFileSync(filePath, body, { mode: 0o600 });
}

interface ResolvedSecrets {
  phoneApiToken: string;
  agentBootstrapToken: string;
  secretsPath: string;
  phoneApiTokenSource: SecretSource;
  agentBootstrapTokenSource: SecretSource;
}

function resolveSecrets(sqlitePath: string): ResolvedSecrets {
  const secretsPath = process.env.SECRETS_PATH?.trim() || path.join(path.dirname(sqlitePath), "secrets.json");
  const existing = tryReadSecretsFile(secretsPath);

  const explicitPhoneToken = process.env.PHONE_API_TOKEN;
  const explicitBootstrapToken = process.env.AGENT_BOOTSTRAP_TOKEN;

  let phoneApiToken = "";
  let agentBootstrapToken = "";
  let phoneApiTokenSource: SecretSource = "generated";
  let agentBootstrapTokenSource: SecretSource = "generated";

  if (isRealToken(explicitPhoneToken, PHONE_PLACEHOLDER)) {
    phoneApiToken = explicitPhoneToken.trim();
    phoneApiTokenSource = "env";
  } else if (existing?.phone_api_token) {
    phoneApiToken = existing.phone_api_token;
    phoneApiTokenSource = "secrets_file";
  } else {
    phoneApiToken = randomToken(32);
    phoneApiTokenSource = "generated";
  }

  if (isRealToken(explicitBootstrapToken, BOOTSTRAP_PLACEHOLDER)) {
    agentBootstrapToken = explicitBootstrapToken.trim();
    agentBootstrapTokenSource = "env";
  } else if (existing?.agent_bootstrap_token) {
    agentBootstrapToken = existing.agent_bootstrap_token;
    agentBootstrapTokenSource = "secrets_file";
  } else {
    agentBootstrapToken = randomToken(24);
    agentBootstrapTokenSource = "generated";
  }

  const mustPersist =
    !existing ||
    existing.phone_api_token !== phoneApiToken ||
    existing.agent_bootstrap_token !== agentBootstrapToken;

  if (mustPersist) {
    const now = new Date().toISOString();
    try {
      writeSecretsFile(secretsPath, {
        phone_api_token: phoneApiToken,
        agent_bootstrap_token: agentBootstrapToken,
        created_at: existing?.created_at ?? now,
        updated_at: now,
      });
    } catch {
      // Keep running even when secrets cannot be persisted.
    }
  }

  return {
    phoneApiToken,
    agentBootstrapToken,
    secretsPath,
    phoneApiTokenSource,
    agentBootstrapTokenSource,
  };
}

export interface AppConfig {
  host: string;
  port: number;
  phoneApiToken: string;
  phoneApiTokenSource: SecretSource;
  agentBootstrapToken: string;
  agentBootstrapTokenSource: SecretSource;
  secretsPath: string;
  sqlitePath: string;
  commandTimeoutMs: number;
  maxPendingCommands: number;
  heartbeatTtlMs: number;
  wsAuthTimeoutMs: number;
  wsPingIntervalMs: number;
  wsMaxMessageBytes: number;
  corsAllowedOrigins: string[];
  publicWsUrl: string;
  pwaPublicUrl: string;
}

export function loadConfig(): AppConfig {
  const host = process.env.HOST ?? "0.0.0.0";
  const port = readInt("PORT", 8080);
  const sqlitePath = process.env.SQLITE_PATH ?? path.join(process.cwd(), "data", "jarvis.db");
  const secrets = resolveSecrets(sqlitePath);
  const commandTimeoutMs = readInt("COMMAND_TIMEOUT_MS", 5000);
  const maxPendingCommands = readInt("MAX_PENDING_COMMANDS", 1000);
  const heartbeatTtlMs = readInt("HEARTBEAT_TTL_MS", 90000);
  const wsAuthTimeoutMs = readInt("WS_AUTH_TIMEOUT_MS", 10000);
  const wsPingIntervalMs = readInt("WS_PING_INTERVAL_MS", 30000);
  const wsMaxMessageBytes = readInt("WS_MAX_MESSAGE_BYTES", 65536);
  const corsAllowedOrigins = readCsv("CORS_ALLOWED_ORIGINS", DEFAULT_CORS_ALLOWED_ORIGINS);
  const publicWsUrl = process.env.PUBLIC_WS_URL ?? `ws://localhost:${port}/ws/agent`;
  const pwaPublicUrl = process.env.PWA_PUBLIC_URL ?? DEFAULT_PWA_PUBLIC_URL;

  return {
    host,
    port,
    phoneApiToken: secrets.phoneApiToken,
    phoneApiTokenSource: secrets.phoneApiTokenSource,
    agentBootstrapToken: secrets.agentBootstrapToken,
    agentBootstrapTokenSource: secrets.agentBootstrapTokenSource,
    secretsPath: secrets.secretsPath,
    sqlitePath,
    commandTimeoutMs,
    maxPendingCommands,
    heartbeatTtlMs,
    wsAuthTimeoutMs,
    wsPingIntervalMs,
    wsMaxMessageBytes,
    corsAllowedOrigins,
    publicWsUrl,
    pwaPublicUrl,
  };
}
