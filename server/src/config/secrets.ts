import fs from "node:fs";
import path from "node:path";

export interface StoredSecretsFile {
  phone_api_token: string;
  agent_bootstrap_token: string;
  created_at: string;
  updated_at: string;
}

export function tryReadSecretsFile(filePath: string): StoredSecretsFile | null {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<StoredSecretsFile>;

    if (
      typeof parsed.phone_api_token === "string" &&
      parsed.phone_api_token.length > 0 &&
      typeof parsed.agent_bootstrap_token === "string" &&
      parsed.agent_bootstrap_token.length > 0
    ) {
      const now = new Date().toISOString();
      return {
        phone_api_token: parsed.phone_api_token,
        agent_bootstrap_token: parsed.agent_bootstrap_token,
        created_at: typeof parsed.created_at === "string" ? parsed.created_at : now,
        updated_at: typeof parsed.updated_at === "string" ? parsed.updated_at : now,
      };
    }
  } catch {
    // ignore parse/read errors and let callers decide fallback behavior
  }

  return null;
}

export function writeSecretsFile(filePath: string, input: {
  phoneApiToken: string;
  agentBootstrapToken: string;
}): StoredSecretsFile {
  const existing = tryReadSecretsFile(filePath);
  const now = new Date().toISOString();
  const payload: StoredSecretsFile = {
    phone_api_token: input.phoneApiToken,
    agent_bootstrap_token: input.agentBootstrapToken,
    created_at: existing?.created_at ?? now,
    updated_at: now,
  };

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;

  try {
    fs.writeFileSync(tempPath, JSON.stringify(payload, null, 2), { mode: 0o600 });
    fs.renameSync(tempPath, filePath);
  } catch (error) {
    try {
      fs.unlinkSync(tempPath);
    } catch {
      // ignore cleanup failure for incomplete temp files
    }
    throw error;
  }

  return payload;
}
