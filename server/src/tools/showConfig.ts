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

const config = loadConfig();
const publicOrigin = derivePublicHttpOrigin(config.publicWsUrl);

const output = {
  host: config.host,
  port: config.port,
  sqlite_path: config.sqlitePath,
  secrets_path: config.secretsPath,
  phone_api_token: config.phoneApiToken,
  phone_api_token_source: config.phoneApiTokenSource,
  agent_bootstrap_token: config.agentBootstrapToken,
  agent_bootstrap_token_source: config.agentBootstrapTokenSource,
  cors_allowed_origins: config.corsAllowedOrigins,
  public_ws_url: config.publicWsUrl,
  pwa_public_url: config.pwaPublicUrl,
  pwa_url: publicOrigin ? `${publicOrigin}/app` : null,
  pwa_pairing_url: publicOrigin
    ? `${publicOrigin}/app#api=${encodeURIComponent(publicOrigin)}&token=${encodeURIComponent(config.phoneApiToken)}`
    : null,
  external_pwa_pairing_url:
    publicOrigin && config.pwaPublicUrl
      ? `${config.pwaPublicUrl}#api=${encodeURIComponent(publicOrigin)}&token=${encodeURIComponent(config.phoneApiToken)}`
      : null,
};

console.log(JSON.stringify(output, null, 2));
