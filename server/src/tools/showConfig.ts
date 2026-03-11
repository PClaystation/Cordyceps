import { loadConfig } from "../config/env";

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

const config = loadConfig();
const publicOrigin = derivePublicHttpOrigin(config.publicWsUrl);
const pairingFragment = publicOrigin ? buildPairingFragment(publicOrigin, config.phoneApiToken) : null;

const output = {
  host: config.host,
  port: config.port,
  sqlite_path: config.sqlitePath,
  sqlite_path_source: config.sqlitePathSource,
  secrets_path: config.secretsPath,
  secrets_path_source: config.secretsPathSource,
  phone_api_token: config.phoneApiToken,
  phone_api_token_source: config.phoneApiTokenSource,
  agent_bootstrap_token: config.agentBootstrapToken,
  agent_bootstrap_token_source: config.agentBootstrapTokenSource,
  cors_allowed_origins: config.corsAllowedOrigins,
  public_ws_url: config.publicWsUrl,
  pwa_public_url: config.pwaPublicUrl,
  command_timeout_ms: config.commandTimeoutMs,
  update_command_timeout_ms: config.updateCommandTimeoutMs,
  update_metadata_timeout_ms: config.updateMetadataTimeoutMs,
  update_max_package_bytes: config.updateMaxPackageBytes,
  enforce_https_update_url: config.enforceHttpsUpdateUrl,
  pwa_url: publicOrigin ? `${publicOrigin}/app` : null,
  pwa_pairing_url: publicOrigin
    ? `${publicOrigin}/app#${pairingFragment}`
    : null,
  external_pwa_pairing_url:
    publicOrigin && config.pwaPublicUrl
      ? `${config.pwaPublicUrl}#${pairingFragment}`
      : null,
};

console.log(JSON.stringify(output, null, 2));
