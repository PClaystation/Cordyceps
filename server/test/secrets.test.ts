import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { tryReadSecretsFile, writeSecretsFile } from "../src/config/secrets";

function makeTempSecretsPath(): string {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return path.join(os.tmpdir(), `cordyceps-secrets-test-${suffix}.json`);
}

test("secrets writes preserve created_at and do not leave temp files behind", () => {
  const secretsPath = makeTempSecretsPath();

  try {
    const first = writeSecretsFile(secretsPath, {
      phoneApiToken: "owner-token-1",
      agentBootstrapToken: "bootstrap-token-1",
    });
    const second = writeSecretsFile(secretsPath, {
      phoneApiToken: "owner-token-2",
      agentBootstrapToken: "bootstrap-token-2",
    });
    const stored = tryReadSecretsFile(secretsPath);
    const siblingFiles = fs.readdirSync(path.dirname(secretsPath));
    const tempFiles = siblingFiles.filter((name) => name.startsWith(path.basename(secretsPath)) && name.endsWith(".tmp"));

    assert.ok(stored);
    assert.equal(second.created_at, first.created_at);
    assert.equal(stored?.created_at, first.created_at);
    assert.equal(stored?.phone_api_token, "owner-token-2");
    assert.equal(stored?.agent_bootstrap_token, "bootstrap-token-2");
    assert.deepEqual(tempFiles, []);
  } finally {
    try {
      fs.unlinkSync(secretsPath);
    } catch {
      // ignore cleanup races
    }
  }
});
