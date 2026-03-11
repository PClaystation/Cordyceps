import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import BetterSqlite3 from "better-sqlite3";

const DEFAULT_CORS_ALLOWED_ORIGINS = [
  "https://pclaystation.github.io",
  "https://mpmc.ddns.net",
].join(",");
const DEFAULT_PWA_PUBLIC_URL = "https://pclaystation.github.io/Cordyceps/";

const PHONE_PLACEHOLDER = "change-me-phone-token";
const BOOTSTRAP_PLACEHOLDER = "change-me-bootstrap-token";

type SecretSource = "env" | "secrets_file" | "generated";
type PathSource = "env" | "default" | "legacy";

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

function readBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }

  const normalized = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }

  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  throw new Error(`Invalid boolean for ${name}`);
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
  secretsPathSource: PathSource;
}

function resolveServerRoot(): string {
  return path.resolve(__dirname, "..", "..");
}

function resolveConfiguredPath(rawValue: string, serverRoot: string): string {
  const trimmed = rawValue.trim();
  if (!trimmed) {
    return trimmed;
  }

  if (path.isAbsolute(trimmed)) {
    return trimmed;
  }

  return path.resolve(serverRoot, trimmed);
}

function tryReadDeviceCount(filePath: string): number | null {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  let db: InstanceType<typeof BetterSqlite3> | null = null;
  try {
    db = new BetterSqlite3(filePath, { readonly: true, fileMustExist: true });
    const table = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'devices'")
      .get() as { name?: string } | undefined;
    if (!table?.name) {
      return 0;
    }

    const row = db.prepare("SELECT COUNT(1) AS count FROM devices").get() as { count?: number } | undefined;
    return typeof row?.count === "number" ? row.count : 0;
  } catch {
    return null;
  } finally {
    try {
      db?.close();
    } catch {
      // ignore close failures during config resolution
    }
  }
}

function chooseBestSqlitePath(candidates: Array<{ path: string; source: PathSource }>): { path: string; source: PathSource } {
  const uniqueCandidates: Array<{ path: string; source: PathSource }> = [];
  const seen = new Set<string>();

  for (const candidate of candidates) {
    if (seen.has(candidate.path)) {
      continue;
    }
    seen.add(candidate.path);
    uniqueCandidates.push(candidate);
  }

  let best: { path: string; source: PathSource; count: number } | null = null;
  for (const candidate of uniqueCandidates) {
    const count = tryReadDeviceCount(candidate.path);
    if (count === null) {
      continue;
    }

    if (!best || count > best.count) {
      best = { ...candidate, count };
    }
  }

  if (best && best.count > 0) {
    return { path: best.path, source: best.source };
  }

  for (const candidate of uniqueCandidates) {
    if (fs.existsSync(candidate.path)) {
      return candidate;
    }
  }

  return uniqueCandidates[0];
}

function resolveDefaultSqlitePath(serverRoot: string): { path: string; source: PathSource } {
  const preferredPath = path.join(serverRoot, "data", "cordyceps.db");
  const candidates = [
    { path: preferredPath, source: "default" as const },
    { path: path.join(serverRoot, "data", "jarvis.db"), source: "legacy" as const },
    { path: path.join(process.cwd(), "data", "cordyceps.db"), source: "legacy" as const },
    { path: path.join(process.cwd(), "data", "jarvis.db"), source: "legacy" as const },
  ];

  return chooseBestSqlitePath(candidates);
}

function resolveSecrets(sqlitePath: string, serverRoot: string): ResolvedSecrets {
  const explicitSecretsPath = process.env.SECRETS_PATH?.trim();
  const secretsPath = explicitSecretsPath
    ? resolveConfiguredPath(explicitSecretsPath, serverRoot)
    : path.join(path.dirname(sqlitePath), "secrets.json");
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
    secretsPathSource: explicitSecretsPath ? "env" : "default",
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
  secretsPathSource: PathSource;
  sqlitePath: string;
  sqlitePathSource: PathSource;
  commandTimeoutMs: number;
  maxPendingCommands: number;
  heartbeatTtlMs: number;
  wsAuthTimeoutMs: number;
  wsPingIntervalMs: number;
  wsMaxMessageBytes: number;
  updateCommandTimeoutMs: number;
  updateMetadataTimeoutMs: number;
  updateMaxPackageBytes: number;
  enforceHttpsUpdateUrl: boolean;
  corsAllowedOrigins: string[];
  publicWsUrl: string;
  pwaPublicUrl: string;
}

export function loadConfig(): AppConfig {
  const host = process.env.HOST ?? "0.0.0.0";
  const port = readInt("PORT", 8080);
  const serverRoot = resolveServerRoot();
  const explicitSqlitePath = process.env.SQLITE_PATH?.trim();
  const sqliteResolution = explicitSqlitePath
    ? chooseBestSqlitePath([
        { path: resolveConfiguredPath(explicitSqlitePath, serverRoot), source: "env" as const },
        { path: resolveConfiguredPath(explicitSqlitePath.replace(/cordyceps\.db$/i, "jarvis.db"), serverRoot), source: "legacy" as const },
        { path: resolveConfiguredPath(explicitSqlitePath.replace(/jarvis\.db$/i, "cordyceps.db"), serverRoot), source: "legacy" as const },
      ])
    : resolveDefaultSqlitePath(serverRoot);
  const secrets = resolveSecrets(sqliteResolution.path, serverRoot);
  const commandTimeoutMs = readInt("COMMAND_TIMEOUT_MS", 5000);
  const maxPendingCommands = readInt("MAX_PENDING_COMMANDS", 1000);
  const heartbeatTtlMs = readInt("HEARTBEAT_TTL_MS", 90000);
  const wsAuthTimeoutMs = readInt("WS_AUTH_TIMEOUT_MS", 10000);
  const wsPingIntervalMs = readInt("WS_PING_INTERVAL_MS", 30000);
  const wsMaxMessageBytes = readInt("WS_MAX_MESSAGE_BYTES", 65536);
  const updateCommandTimeoutMs = readInt("UPDATE_COMMAND_TIMEOUT_MS", 300000);
  const updateMetadataTimeoutMs = readInt("UPDATE_METADATA_TIMEOUT_MS", 120000);
  const updateMaxPackageBytes = readInt("UPDATE_MAX_PACKAGE_BYTES", 314572800);
  const enforceHttpsUpdateUrl = readBool("ENFORCE_HTTPS_UPDATE_URL", true);
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
    secretsPathSource: secrets.secretsPathSource,
    sqlitePath: sqliteResolution.path,
    sqlitePathSource: sqliteResolution.source,
    commandTimeoutMs,
    maxPendingCommands,
    heartbeatTtlMs,
    wsAuthTimeoutMs,
    wsPingIntervalMs,
    wsMaxMessageBytes,
    updateCommandTimeoutMs,
    updateMetadataTimeoutMs,
    updateMaxPackageBytes,
    enforceHttpsUpdateUrl,
    corsAllowedOrigins,
    publicWsUrl,
    pwaPublicUrl,
  };
}
