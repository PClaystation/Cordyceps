import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Fastify from "fastify";
import { registerApiRoutes } from "../src/api/routes";
import { Database } from "../src/db/database";
import type { AppConfig } from "../src/config/env";
import { DeviceRegistry } from "../src/realtime/deviceRegistry";
import { EventHub } from "../src/events/eventHub";
import { sha256Hex } from "../src/utils/crypto";
import type { CommandRouter } from "../src/router/commandRouter";
import type { QueuedUpdateDispatcher } from "../src/update/queuedUpdateDispatcher";
import { buildUpdateSignaturePayload } from "../src/update/signatureVerifier";

class MockSocket {
  public readyState = 1;
  public OPEN = 1;

  public send(_data: string): void {
    // noop
  }

  public close(): void {
    // noop
  }
}

class FakeRouter {
  public dispatchedMany: Array<{ requestId: string; deviceIds: string[]; type: string; args: Record<string, unknown> }> = [];
  public dispatchedToDevice: Array<{ requestId: string; deviceId: string; type: string; args: Record<string, unknown> }> = [];

  public pendingCount(): number {
    return 0;
  }

  public async dispatchToDevice(input: {
    requestId: string;
    deviceId: string;
    command: { type: string; args?: Record<string, unknown> };
  }): Promise<{
    request_id: string;
    device_id: string;
    ok: boolean;
    message: string;
    completed_at: string;
  }> {
    this.dispatchedToDevice.push({
      requestId: input.requestId,
      deviceId: input.deviceId,
      type: input.command.type,
      args: input.command.args ?? {},
    });
    return {
      request_id: input.requestId,
      device_id: input.deviceId,
      ok: true,
      message: `${input.command.type} ok`,
      completed_at: new Date().toISOString(),
    };
  }

  public async dispatchToMany(input: {
    requestId: string;
    deviceIds: string[];
    command: { type: string; args?: Record<string, unknown> };
  }): Promise<Array<{
    request_id: string;
    device_id: string;
    ok: boolean;
    message: string;
    completed_at: string;
  }>> {
    this.dispatchedMany.push({
      requestId: input.requestId,
      deviceIds: [...input.deviceIds],
      type: input.command.type,
      args: input.command.args ?? {},
    });
    return input.deviceIds.map((deviceId) => ({
      request_id: input.requestId,
      device_id: deviceId,
      ok: true,
      message: `${input.command.type} ok`,
      completed_at: new Date().toISOString(),
    }));
  }

  public clearDevicePending(_deviceId: string): void {
    // noop
  }

  public clearAllPending(_reason = ""): void {
    // noop
  }
}

class FakeQueuedUpdateDispatcher {
  public kicked: string[] = [];

  public async kick(deviceId: string): Promise<void> {
    this.kicked.push(deviceId);
  }
}

function makeConfig(overrides?: Partial<AppConfig>): AppConfig {
  return {
    host: "127.0.0.1",
    port: 0,
    phoneApiToken: "owner-token",
    phoneApiTokenSource: "env",
    agentBootstrapToken: "bootstrap-token",
    agentBootstrapTokenSource: "env",
    secretsPath: "",
    secretsPathSource: "default",
    sqlitePath: "",
    sqlitePathSource: "default",
    commandTimeoutMs: 1000,
    adminCommandTimeoutMs: 60_000,
    powerCommandTimeoutMs: 15_000,
    maxPendingCommands: 100,
    heartbeatTtlMs: 90_000,
    wsAuthTimeoutMs: 10_000,
    wsPingIntervalMs: 30_000,
    wsMaxMessageBytes: 65_536,
    updateCommandTimeoutMs: 10_000,
    updateMetadataTimeoutMs: 10_000,
    updateMaxPackageBytes: 10_000_000,
    enforceHttpsUpdateUrl: false,
    allowAutomaticUpdates: false,
    updateRequireSignature: false,
    updateSigningKeys: {},
    corsAllowedOrigins: ["*"],
    publicWsUrl: "ws://localhost/ws/agent",
    pwaPublicUrl: "http://localhost/app",
    ...overrides,
  };
}

function makeTempDbPath(): string {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return path.join(os.tmpdir(), `cordyceps-routes-test-${suffix}.db`);
}

async function createHarness(options?: { configOverrides?: Partial<AppConfig> }) {
  const sqlitePath = makeTempDbPath();
  const db = new Database(sqlitePath);
  const registry = new DeviceRegistry();
  const router = new FakeRouter();
  const queuedUpdateDispatcher = new FakeQueuedUpdateDispatcher();
  const eventHub = new EventHub();

  db.enrollDevice({
    deviceId: "m1",
    tokenHash: sha256Hex("device-token"),
    displayName: "m1",
    version: "1.0.0",
    hostname: "host",
    username: "user",
    capabilities: ["media_control", "locking", "open_app", "notifications", "clipboard_control", "updater"],
  });

  registry.register({
    deviceId: "m1",
    socket: new MockSocket(),
    version: "1.0.0",
    hostname: "host",
    username: "user",
    capabilities: ["media_control", "locking", "open_app", "notifications", "clipboard_control", "updater"],
  });

  db.markDeviceOnline({
    deviceId: "m1",
    version: "1.0.0",
    hostname: "host",
    username: "user",
    capabilities: ["media_control", "locking", "open_app", "notifications", "clipboard_control", "updater"],
  });

  const server = Fastify({ logger: false });
  await registerApiRoutes(server, {
    config: makeConfig(options?.configOverrides),
    db,
    registry,
    router: router as unknown as CommandRouter,
    eventHub,
    queuedUpdateDispatcher: queuedUpdateDispatcher as unknown as QueuedUpdateDispatcher,
  });

  const cleanup = async () => {
    await server.close();
    db.close();
    try {
      fs.unlinkSync(sqlitePath);
    } catch {
      // ignore cleanup races
    }
  };

  return { server, db, registry, router, queuedUpdateDispatcher, cleanup };
}

function addOnlineDevice(
  harness: Awaited<ReturnType<typeof createHarness>>,
  input: { deviceId: string; capabilities: string[] },
): void {
  const { db, registry } = harness;
  const { deviceId, capabilities } = input;

  db.enrollDevice({
    deviceId,
    tokenHash: sha256Hex(`${deviceId}-token`),
    displayName: deviceId,
    version: "1.0.0",
    hostname: "host",
    username: "user",
    capabilities,
  });

  registry.register({
    deviceId,
    socket: new MockSocket(),
    version: "1.0.0",
    hostname: "host",
    username: "user",
    capabilities,
  });

  db.markDeviceOnline({
    deviceId,
    version: "1.0.0",
    hostname: "host",
    username: "user",
    capabilities,
  });
}

function authHeaders(token: string): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  };
}

test("scoped API key can read devices but cannot execute updates", async () => {
  const harness = await createHarness();
  const { server, cleanup } = harness;

  try {
    const createKey = await server.inject({
      method: "POST",
      url: "/api/auth/keys",
      headers: authHeaders("owner-token"),
      payload: {
        name: "viewer",
        scopes: ["devices:read", "history:read"],
      },
    });

    assert.equal(createKey.statusCode, 200);
    const createdBody = createKey.json();
    assert.equal(createdBody.ok, true);
    assert.equal(typeof createdBody.api_key, "string");

    const scopedToken = createdBody.api_key as string;

    const devices = await server.inject({
      method: "GET",
      url: "/api/devices",
      headers: {
        authorization: `Bearer ${scopedToken}`,
      },
    });

    assert.equal(devices.statusCode, 200);
    const devicesBody = devices.json();
    assert.equal(devicesBody.ok, true);
    assert.equal(Array.isArray(devicesBody.devices), true);

    const updateAttempt = await server.inject({
      method: "POST",
      url: "/api/update",
      headers: authHeaders(scopedToken),
      payload: {
        target: "m1",
        version: "1.0.1",
        package_url: "https://example.com/agent.exe",
      },
    });

    assert.equal(updateAttempt.statusCode, 403);
  } finally {
    await cleanup();
  }
});

test("API key rotation issues a replacement and revokes the old key", async () => {
  const harness = await createHarness();
  const { server, cleanup } = harness;

  try {
    const createKey = await server.inject({
      method: "POST",
      url: "/api/auth/keys",
      headers: authHeaders("owner-token"),
      payload: {
        name: "viewer",
        scopes: ["devices:read"],
      },
    });

    assert.equal(createKey.statusCode, 200);
    const created = createKey.json();
    const keyId = created.key?.key_id as string;
    const oldToken = created.api_key as string;

    const rotate = await server.inject({
      method: "POST",
      url: `/api/auth/keys/${encodeURIComponent(keyId)}/rotate`,
      headers: authHeaders("owner-token"),
      payload: {},
    });

    assert.equal(rotate.statusCode, 200);
    const rotated = rotate.json();
    assert.equal(rotated.ok, true);
    assert.equal(rotated.rotated_from, keyId);
    assert.equal(typeof rotated.api_key, "string");
    const newToken = rotated.api_key as string;

    const oldAccess = await server.inject({
      method: "GET",
      url: "/api/devices",
      headers: {
        authorization: `Bearer ${oldToken}`,
      },
    });
    assert.equal(oldAccess.statusCode, 401);

    const newAccess = await server.inject({
      method: "GET",
      url: "/api/devices",
      headers: {
        authorization: `Bearer ${newToken}`,
      },
    });
    assert.equal(newAccess.statusCode, 200);
  } finally {
    await cleanup();
  }
});

test("owner token rotation supports grace window when secrets are file-managed", async () => {
  const secretsPath = path.join(os.tmpdir(), `cordyceps-secrets-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
  const harness = await createHarness({
    configOverrides: {
      phoneApiTokenSource: "secrets_file",
      agentBootstrapTokenSource: "secrets_file",
      secretsPath,
      secretsPathSource: "env",
    },
  });
  const { server, cleanup } = harness;

  try {
    const rotate = await server.inject({
      method: "POST",
      url: "/api/auth/tokens/rotate",
      headers: authHeaders("owner-token"),
      payload: {
        rotate_owner_token: true,
        owner_grace_seconds: 30,
      },
    });

    assert.equal(rotate.statusCode, 200);
    const body = rotate.json();
    assert.equal(body.ok, true);
    assert.equal(typeof body.owner_token, "string");
    assert.equal(typeof body.previous_owner_token_valid_until, "string");
    const newOwnerToken = body.owner_token as string;

    const oldTokenAccess = await server.inject({
      method: "GET",
      url: "/api/devices",
      headers: {
        authorization: "Bearer owner-token",
      },
    });
    assert.equal(oldTokenAccess.statusCode, 200);

    const newTokenAccess = await server.inject({
      method: "GET",
      url: "/api/devices",
      headers: {
        authorization: `Bearer ${newOwnerToken}`,
      },
    });
    assert.equal(newTokenAccess.statusCode, 200);
  } finally {
    await cleanup();
    try {
      fs.unlinkSync(secretsPath);
    } catch {
      // ignore cleanup races
    }
  }
});

test("owner token rotation rejects env-managed owner token", async () => {
  const harness = await createHarness();
  const { server, cleanup } = harness;

  try {
    const rotate = await server.inject({
      method: "POST",
      url: "/api/auth/tokens/rotate",
      headers: authHeaders("owner-token"),
      payload: {
        rotate_owner_token: true,
      },
    });

    assert.equal(rotate.statusCode, 409);
    assert.equal(rotate.json().error_code, "OWNER_TOKEN_ENV_MANAGED");
  } finally {
    await cleanup();
  }
});

test("write endpoints require application/json content-type", async () => {
  const harness = await createHarness();
  const { server, cleanup } = harness;

  try {
    const response = await server.inject({
      method: "POST",
      url: "/api/command",
      headers: {
        authorization: "Bearer owner-token",
        "content-type": "text/plain; charset=utf-8",
      },
      payload: "m1 ping",
    });

    assert.equal(response.statusCode, 415);
    const body = response.json();
    assert.equal(body.ok, false);
    assert.equal(body.error_code, "UNSUPPORTED_MEDIA_TYPE");
  } finally {
    await cleanup();
  }
});

test("enroll endpoint is rate limited per client identity", async () => {
  const harness = await createHarness();
  const { server, cleanup } = harness;

  try {
    let limitedResponse: Awaited<ReturnType<typeof server.inject>> | null = null;

    for (let i = 0; i < 25; i += 1) {
      const response = await server.inject({
        method: "POST",
        url: "/api/enroll",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": "198.51.100.24",
        },
        payload: {
          bootstrap_token: "invalid-token",
        },
      });

      if (response.statusCode === 429) {
        limitedResponse = response;
        break;
      }
    }

    assert.ok(limitedResponse);
    assert.equal(limitedResponse.statusCode, 429);
    const body = limitedResponse.json();
    assert.equal(body.error_code, "RATE_LIMITED");
    assert.equal(typeof body.retry_after_seconds, "number");
    assert.equal(typeof limitedResponse.headers["retry-after"], "string");
    assert.equal(typeof limitedResponse.headers["x-ratelimit-limit"], "string");
    assert.equal(typeof limitedResponse.headers["x-ratelimit-remaining"], "string");
    assert.equal(typeof limitedResponse.headers["x-ratelimit-reset"], "string");
  } finally {
    await cleanup();
  }
});

test("api responses include hardening headers", async () => {
  const harness = await createHarness();
  const { server, cleanup } = harness;

  try {
    const response = await server.inject({
      method: "GET",
      url: "/api/health",
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.headers["x-content-type-options"], "nosniff");
    assert.equal(response.headers["x-frame-options"], "DENY");
    assert.equal(response.headers["referrer-policy"], "no-referrer");
    assert.equal(response.headers["permissions-policy"], "camera=(), microphone=(), geolocation=()");
    assert.equal(response.headers["cache-control"], "no-store");
    assert.equal(typeof response.headers["x-request-id"], "string");
    assert.equal((response.headers["x-request-id"] as string).length > 0, true);
  } finally {
    await cleanup();
  }
});

test("admin command execution requires admin scope", async () => {
  const harness = await createHarness();
  const { server, router, cleanup } = harness;

  try {
    addOnlineDevice(harness, {
      deviceId: "a1",
      capabilities: ["admin_ops"],
    });

    const createOperatorKey = await server.inject({
      method: "POST",
      url: "/api/auth/keys",
      headers: authHeaders("owner-token"),
      payload: {
        name: "operator",
        scopes: ["commands:execute"],
      },
    });

    assert.equal(createOperatorKey.statusCode, 200);
    const operatorToken = createOperatorKey.json().api_key as string;

    const forbiddenAdminRun = await server.inject({
      method: "POST",
      url: "/api/command",
      headers: authHeaders(operatorToken),
      payload: {
        text: "a1 admin cmd whoami",
      },
    });

    assert.equal(forbiddenAdminRun.statusCode, 403);
    assert.equal(router.dispatchedToDevice.length, 0);

    const createAdminKey = await server.inject({
      method: "POST",
      url: "/api/auth/keys",
      headers: authHeaders("owner-token"),
      payload: {
        name: "admin-operator",
        scopes: ["commands:execute", "admin:manage"],
      },
    });

    assert.equal(createAdminKey.statusCode, 200);
    const adminToken = createAdminKey.json().api_key as string;

    const allowedAdminRun = await server.inject({
      method: "POST",
      url: "/api/command",
      headers: authHeaders(adminToken),
      payload: {
        text: "a1 admin cmd whoami",
      },
    });

    assert.equal(allowedAdminRun.statusCode, 200);
    const allowedBody = allowedAdminRun.json();
    assert.equal(allowedBody.parsed_type, "ADMIN_EXEC_CMD");
    assert.equal(router.dispatchedToDevice.length, 1);
    assert.equal(router.dispatchedToDevice[0]?.deviceId, "a1");
    assert.equal(router.dispatchedToDevice[0]?.type, "ADMIN_EXEC_CMD");
  } finally {
    await cleanup();
  }
});

test("update can be queued for an offline device", async () => {
  const harness = await createHarness();
  const { server, db, registry, router, cleanup } = harness;

  try {
    registry.disconnect("m1");
    db.markDeviceOffline("m1");

    const response = await server.inject({
      method: "POST",
      url: "/api/update",
      headers: authHeaders("owner-token"),
      payload: {
        target: "m1",
        version: "1.0.1",
        package_url: "https://example.com/agent.exe",
        sha256: "a".repeat(64),
        queue_if_offline: true,
      },
    });

    assert.equal(response.statusCode, 202);
    const body = response.json();
    assert.equal(body.ok, true);
    assert.equal(body.queued, true);
    assert.equal(typeof body.request_id, "string");
    assert.equal(router.dispatchedToDevice.length, 0);

    const queued = db.listQueuedUpdatesForDevice("m1");
    assert.equal(queued.length, 1);
    assert.equal(queued[0]?.request_id, body.request_id);
    assert.equal(queued[0]?.version, "1.0.1");
    assert.equal(queued[0]?.package_url, "https://example.com/agent.exe");

    const logs = db.listCommandLogs({
      limit: 20,
      deviceId: "m1",
      parsedType: "AGENT_UPDATE",
    });
    assert.equal(logs.length, 1);
    assert.equal(logs[0]?.status, "queued");
  } finally {
    await cleanup();
  }
});

test("queue_if_offline requires a single target device", async () => {
  const harness = await createHarness();
  const { server, cleanup } = harness;

  try {
    const response = await server.inject({
      method: "POST",
      url: "/api/update",
      headers: authHeaders("owner-token"),
      payload: {
        target: "all",
        version: "1.0.1",
        package_url: "https://example.com/agent.exe",
        queue_if_offline: true,
      },
    });

    assert.equal(response.statusCode, 400);
    assert.equal(response.json().error_code, "INVALID_QUEUE_TARGET");
  } finally {
    await cleanup();
  }
});

test("update requires signature when configured and accepts valid signed payload", async () => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const publicKeyPem = publicKey.export({ format: "pem", type: "spki" }).toString();
  const harness = await createHarness({
    configOverrides: {
      updateRequireSignature: true,
      updateSigningKeys: {
        release: publicKeyPem,
      },
    },
  });
  const { server, router, cleanup } = harness;

  try {
    const unsigned = await server.inject({
      method: "POST",
      url: "/api/update",
      headers: authHeaders("owner-token"),
      payload: {
        target: "m1",
        version: "1.0.1",
        package_url: "https://example.com/agent.exe",
        sha256: "a".repeat(64),
      },
    });

    assert.equal(unsigned.statusCode, 400);
    assert.equal(unsigned.json().error_code, "SIGNATURE_REQUIRED");

    const signaturePayload = buildUpdateSignaturePayload({
      version: "1.0.1",
      packageUrl: "https://example.com/agent.exe",
      sha256: "a".repeat(64),
      sizeBytes: null,
    });
    const signature = sign(null, signaturePayload, privateKey).toString("base64");

    const signed = await server.inject({
      method: "POST",
      url: "/api/update",
      headers: authHeaders("owner-token"),
      payload: {
        target: "m1",
        version: "1.0.1",
        package_url: "https://example.com/agent.exe",
        sha256: "a".repeat(64),
        signature,
        signature_key_id: "release",
      },
    });

    assert.equal(signed.statusCode, 200);
    const body = signed.json();
    assert.equal(body.signature_verified, true);
    assert.equal(body.signature_key_id, "release");
    assert.equal(router.dispatchedToDevice.length, 1);
    assert.equal(router.dispatchedToDevice[0]?.args.signature, signature);
    assert.equal(router.dispatchedToDevice[0]?.args.signature_key_id, "release");
  } finally {
    await cleanup();
  }
});

test("privileged helper update requires device capability", async () => {
  const harness = await createHarness();
  const { server, router, cleanup } = harness;

  try {
    const unsupported = await server.inject({
      method: "POST",
      url: "/api/update",
      headers: authHeaders("owner-token"),
      payload: {
        target: "m1",
        version: "1.0.1",
        package_url: "https://example.com/agent.exe",
        sha256: "a".repeat(64),
        use_privileged_helper: true,
      },
    });

    assert.equal(unsupported.statusCode, 409);
    assert.equal(unsupported.json().error_code, "PRIVILEGED_HELPER_NOT_SUPPORTED");

    addOnlineDevice(harness, {
      deviceId: "t1",
      capabilities: ["updater", "privileged_helper_split"],
    });

    const supported = await server.inject({
      method: "POST",
      url: "/api/update",
      headers: authHeaders("owner-token"),
      payload: {
        target: "t1",
        version: "1.0.1",
        package_url: "https://example.com/agent.exe",
        sha256: "a".repeat(64),
        use_privileged_helper: true,
      },
    });

    assert.equal(supported.statusCode, 200);
    assert.equal(supported.json().use_privileged_helper, true);
    assert.equal(router.dispatchedToDevice.length, 1);
    assert.equal(router.dispatchedToDevice[0]?.deviceId, "t1");
    assert.equal(router.dispatchedToDevice[0]?.args.use_privileged_helper, true);
  } finally {
    await cleanup();
  }
});

test("update rejects package_url with credentials", async () => {
  const harness = await createHarness();
  const { server, cleanup } = harness;

  try {
    const response = await server.inject({
      method: "POST",
      url: "/api/update",
      headers: authHeaders("owner-token"),
      payload: {
        target: "m1",
        version: "1.0.1",
        package_url: "https://user:pass@example.com/agent.exe",
      },
    });

    assert.equal(response.statusCode, 400);
    const body = response.json();
    assert.equal(body.ok, false);
    assert.equal(body.error_code, "INVALID_UPDATE_URL");
  } finally {
    await cleanup();
  }
});

test("history endpoint returns command logs", async () => {
  const harness = await createHarness();
  const { server, db, cleanup } = harness;

  try {
    db.insertCommandLog({
      id: "req-1:m1",
      requestId: "req-1",
      deviceId: "m1",
      source: "test",
      rawText: "m1 ping",
      parsedTarget: "m1",
      parsedType: "PING",
      argsJson: "{}",
      status: "queued",
      resultMessage: null,
      errorCode: null,
    });

    db.completeCommandLog({
      id: "req-1:m1",
      status: "ok",
      resultMessage: "pong",
    });

    const response = await server.inject({
      method: "GET",
      url: "/api/command-logs?limit=10",
      headers: {
        authorization: "Bearer owner-token",
      },
    });

    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal(body.ok, true);
    assert.equal(body.count >= 1, true);
    assert.equal(Array.isArray(body.logs), true);
    assert.equal(body.logs[0].parsed_type, "PING");
  } finally {
    await cleanup();
  }
});

test("group command requires explicit bulk confirmation", async () => {
  const harness = await createHarness();
  const { server, router, cleanup } = harness;

  try {
    const createGroup = await server.inject({
      method: "PUT",
      url: "/api/groups/office",
      headers: authHeaders("owner-token"),
      payload: {
        display_name: "Office",
        description: "Office devices",
        device_ids: ["m1"],
      },
    });

    assert.equal(createGroup.statusCode, 200);

    const withoutConfirm = await server.inject({
      method: "POST",
      url: "/api/groups/office/command",
      headers: authHeaders("owner-token"),
      payload: {
        text: "lock",
        confirm_bulk: false,
      },
    });

    assert.equal(withoutConfirm.statusCode, 400);
    assert.equal(withoutConfirm.json().error_code, "BULK_CONFIRM_REQUIRED");

    const pingDispatch = await server.inject({
      method: "POST",
      url: "/api/groups/office/command",
      headers: authHeaders("owner-token"),
      payload: {
        text: "ping",
        confirm_bulk: false,
      },
    });

    assert.equal(pingDispatch.statusCode, 200);
    const body = pingDispatch.json();
    assert.equal(body.ok, true);
    assert.equal(router.dispatchedMany.length, 1);
    assert.deepEqual(router.dispatchedMany[0].deviceIds, ["m1"]);
  } finally {
    await cleanup();
  }
});

test("group command performs partial dispatch and reports skipped members", async () => {
  const harness = await createHarness();
  const { server, router, db, cleanup } = harness;

  try {
    db.enrollDevice({
      deviceId: "m2",
      tokenHash: sha256Hex("m2-token"),
      displayName: "m2",
      version: "1.0.0",
      hostname: "host",
      username: "user",
      capabilities: ["media_control", "locking", "open_app", "notifications", "clipboard_control", "updater"],
    });

    const createGroup = await server.inject({
      method: "PUT",
      url: "/api/groups/mixed",
      headers: authHeaders("owner-token"),
      payload: {
        display_name: "Mixed",
        description: "Mixed availability",
        device_ids: ["m1", "m2"],
      },
    });
    assert.equal(createGroup.statusCode, 200);

    const response = await server.inject({
      method: "POST",
      url: "/api/groups/mixed/command",
      headers: authHeaders("owner-token"),
      payload: {
        text: "ping",
        confirm_bulk: false,
      },
    });

    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal(body.ok, false);
    assert.equal(router.dispatchedMany.length, 1);
    assert.deepEqual(router.dispatchedMany[0].deviceIds, ["m1"]);
    assert.equal(Array.isArray(body.results), true);
    assert.equal(body.results.length, 2);
    assert.equal(body.results.some((item: { device_id: string; error_code?: string }) => item.device_id === "m2" && item.error_code === "DEVICE_OFFLINE"), true);
  } finally {
    await cleanup();
  }
});

test("device app aliases rewrite open command target", async () => {
  const harness = await createHarness();
  const { server, router, cleanup } = harness;

  try {
    const saveAliases = await server.inject({
      method: "PUT",
      url: "/api/devices/m1/app-aliases",
      headers: authHeaders("owner-token"),
      payload: {
        aliases: [{ alias: "browser work", app: "chrome" }],
      },
    });
    assert.equal(saveAliases.statusCode, 200);

    const dispatch = await server.inject({
      method: "POST",
      url: "/api/command",
      headers: authHeaders("owner-token"),
      payload: {
        text: "m1 open browser work",
      },
    });

    assert.equal(dispatch.statusCode, 200);
    assert.equal(router.dispatchedToDevice.length, 1);
    assert.equal(router.dispatchedToDevice[0].type, "OPEN_APP");
    assert.deepEqual(router.dispatchedToDevice[0].args, { app: "chrome" });
  } finally {
    await cleanup();
  }
});

test("single-device async dispatch returns accepted and job is queryable", async () => {
  const harness = await createHarness();
  const { server, cleanup } = harness;

  try {
    const requestId = "req-async-1";
    const accepted = await server.inject({
      method: "POST",
      url: "/api/command",
      headers: authHeaders("owner-token"),
      payload: {
        request_id: requestId,
        text: "m1 ping",
        async: true,
      },
    });

    assert.equal(accepted.statusCode, 202);
    const acceptedBody = accepted.json();
    assert.equal(acceptedBody.ok, true);
    assert.equal(acceptedBody.job_id, requestId);

    await new Promise((resolve) => setTimeout(resolve, 10));

    const job = await server.inject({
      method: "GET",
      url: `/api/command-jobs/${requestId}`,
      headers: {
        authorization: "Bearer owner-token",
      },
    });

    assert.equal(job.statusCode, 200);
    const jobBody = job.json();
    assert.equal(jobBody.request_id, requestId);
    assert.equal(jobBody.done, true);
    assert.equal(Array.isArray(jobBody.logs), true);
    assert.equal(jobBody.logs.length >= 1, true);
  } finally {
    await cleanup();
  }
});

test("devices endpoint includes derived agent profile", async () => {
  const harness = await createHarness();
  const { server, cleanup } = harness;

  try {
    addOnlineDevice(harness, {
      deviceId: "s1",
      capabilities: ["profile_s", "media_control", "locking", "open_app", "notifications", "clipboard_control", "updater"],
    });

    const response = await server.inject({
      method: "GET",
      url: "/api/devices",
      headers: {
        authorization: "Bearer owner-token",
      },
    });

    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal(body.ok, true);

    const devices = body.devices as Array<{ device_id: string; profile?: string }>;
    const s1 = devices.find((device) => device.device_id === "s1");
    assert.equal(s1?.profile, "s");

    const m1 = devices.find((device) => device.device_id === "m1");
    assert.equal(m1?.profile, "legacy");
  } finally {
    await cleanup();
  }
});

test("device detail endpoint returns control, aliases, queue, and recent logs", async () => {
  const harness = await createHarness();
  const { server, cleanup } = harness;

  try {
    harness.db.markDeviceOnline({
      deviceId: "m1",
      version: "1.0.0",
      hostname: "host",
      username: "user",
      capabilities: ["media_control", "locking", "open_app", "notifications", "clipboard_control", "updater"],
      deviceInfo: {
        runtime_os: "windows",
        runtime_arch: "amd64",
        local_ips: ["10.0.0.5"],
      },
    });

    const aliasSave = await server.inject({
      method: "PUT",
      url: "/api/devices/m1/app-aliases",
      headers: authHeaders("owner-token"),
      payload: {
        aliases: [{ alias: "browser work", app: "chrome" }],
      },
    });
    assert.equal(aliasSave.statusCode, 200);

    const ping = await server.inject({
      method: "POST",
      url: "/api/command",
      headers: authHeaders("owner-token"),
      payload: {
        text: "m1 ping",
      },
    });
    assert.equal(ping.statusCode, 200);

    const detail = await server.inject({
      method: "GET",
      url: "/api/devices/m1?logs_limit=5",
      headers: {
        authorization: "Bearer owner-token",
      },
    });

    assert.equal(detail.statusCode, 200);
    const body = detail.json();
    assert.equal(body.ok, true);
    assert.equal(body.device.device_id, "m1");
    assert.equal(Array.isArray(body.aliases), true);
    assert.equal(Array.isArray(body.queued_updates), true);
    assert.equal(Array.isArray(body.recent_logs), true);
    assert.equal(typeof body.realtime.connected, "boolean");
    assert.equal(body.device.device_info.runtime_os, "windows");
    assert.equal(body.realtime.device_info, null);
  } finally {
    await cleanup();
  }
});

test("device delete endpoint removes offline device records", async () => {
  const harness = await createHarness();
  const { server, db, cleanup } = harness;

  try {
    db.enrollDevice({
      deviceId: "t4",
      tokenHash: sha256Hex("t4-token"),
      displayName: "Old Laptop",
      version: "0.1.0",
      hostname: "old-host",
      username: "old-user",
      capabilities: ["updater"],
    });
    db.markDeviceOffline("t4");

    const response = await server.inject({
      method: "DELETE",
      url: "/api/devices/t4",
      headers: {
        authorization: "Bearer owner-token",
      },
    });

    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal(body.ok, true);
    assert.equal(body.device_id, "t4");
    assert.equal(db.getDevice("t4"), null);
  } finally {
    await cleanup();
  }
});

test("device delete endpoint rejects online devices", async () => {
  const harness = await createHarness();
  const { server, db, cleanup } = harness;

  try {
    const response = await server.inject({
      method: "DELETE",
      url: "/api/devices/m1",
      headers: {
        authorization: "Bearer owner-token",
      },
    });

    assert.equal(response.statusCode, 409);
    const body = response.json();
    assert.equal(body.ok, false);
    assert.equal(body.error_code, "DEVICE_ONLINE");
    assert.notEqual(db.getDevice("m1"), null);
  } finally {
    await cleanup();
  }
});

test("admin overview endpoint requires admin scope and returns aggregate data", async () => {
  const harness = await createHarness();
  const { server, cleanup } = harness;

  try {
    const ownerView = await server.inject({
      method: "GET",
      url: "/api/admin/overview",
      headers: {
        authorization: "Bearer owner-token",
      },
    });

    assert.equal(ownerView.statusCode, 200);
    const ownerBody = ownerView.json();
    assert.equal(ownerBody.ok, true);
    assert.equal(typeof ownerBody.health.devices_total, "number");
    assert.equal(typeof ownerBody.health.pending_commands, "number");
    assert.equal(typeof ownerBody.online_capabilities, "object");

    const createScoped = await server.inject({
      method: "POST",
      url: "/api/auth/keys",
      headers: authHeaders("owner-token"),
      payload: {
        name: "viewer",
        scopes: ["devices:read"],
      },
    });
    assert.equal(createScoped.statusCode, 200);
    const scopedToken = createScoped.json().api_key as string;

    const forbidden = await server.inject({
      method: "GET",
      url: "/api/admin/overview",
      headers: {
        authorization: `Bearer ${scopedToken}`,
      },
    });
    assert.equal(forbidden.statusCode, 403);
  } finally {
    await cleanup();
  }
});

test("quarantine policy blocks non-emergency commands", async () => {
  const harness = await createHarness();
  const { server, cleanup } = harness;

  try {
    const quarantine = await server.inject({
      method: "POST",
      url: "/api/devices/m1/control",
      headers: authHeaders("owner-token"),
      payload: {
        quarantine_enabled: true,
        reason: "investigation",
      },
    });

    assert.equal(quarantine.statusCode, 200);
    assert.equal(quarantine.json().control.quarantine_enabled, true);

    const blocked = await server.inject({
      method: "POST",
      url: "/api/command",
      headers: authHeaders("owner-token"),
      payload: {
        text: "m1 notify hello",
      },
    });

    assert.equal(blocked.statusCode, 409);
    assert.equal(blocked.json().error_code, "DEVICE_QUARANTINED");

    const allowed = await server.inject({
      method: "POST",
      url: "/api/command",
      headers: authHeaders("owner-token"),
      payload: {
        text: "m1 ping",
      },
    });

    assert.equal(allowed.statusCode, 200);
  } finally {
    await cleanup();
  }
});

test("kill-switch policy disconnects active device", async () => {
  const harness = await createHarness();
  const { server, registry, cleanup } = harness;

  try {
    const response = await server.inject({
      method: "POST",
      url: "/api/devices/m1/control",
      headers: authHeaders("owner-token"),
      payload: {
        kill_switch_enabled: true,
      },
    });

    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal(body.control.kill_switch_enabled, true);
    assert.equal(body.disconnected, true);
    assert.equal(registry.get("m1"), null);

    const commandAfterKillSwitch = await server.inject({
      method: "POST",
      url: "/api/command",
      headers: authHeaders("owner-token"),
      payload: {
        text: "m1 ping",
      },
    });

    assert.equal(commandAfterKillSwitch.statusCode, 409);
    assert.equal(commandAfterKillSwitch.json().error_code, "DEVICE_OFFLINE");
  } finally {
    await cleanup();
  }
});

test("device control lockdown forwards rollback minutes to emergency-capable agents", async () => {
  const harness = await createHarness();
  const { server, router, cleanup } = harness;

  try {
    addOnlineDevice(harness, {
      deviceId: "se1",
      capabilities: [
        "profile_se",
        "media_control",
        "locking",
        "open_app",
        "notifications",
        "clipboard_control",
        "display_control",
        "updater",
        "emergency_lockdown",
      ],
    });

    const response = await server.inject({
      method: "POST",
      url: "/api/devices/se1/control",
      headers: authHeaders("owner-token"),
      payload: {
        trigger_lockdown: true,
        lockdown_minutes: 45,
        reason: "operator request",
      },
    });

    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal(body.ok, true);
    assert.equal(body.lockdown.command_type, "EMERGENCY_LOCKDOWN");
    assert.equal(body.lockdown.lockdown_minutes, 45);
    assert.equal(
      router.dispatchedToDevice.some(
        (item) => item.deviceId === "se1" && item.type === "EMERGENCY_LOCKDOWN" && item.args.rollback_minutes === 45,
      ),
      true,
    );
  } finally {
    await cleanup();
  }
});

test("device control rejects lockdown minutes outside allowed range", async () => {
  const harness = await createHarness();
  const { server, cleanup } = harness;

  try {
    const response = await server.inject({
      method: "POST",
      url: "/api/devices/m1/control",
      headers: authHeaders("owner-token"),
      payload: {
        trigger_lockdown: true,
        lockdown_minutes: 0,
      },
    });

    assert.equal(response.statusCode, 400);
    assert.equal(response.json().error_code, "INVALID_LOCKDOWN_MINUTES");
  } finally {
    await cleanup();
  }
});

test("strict pinned version policy blocks command dispatch for stale agent", async () => {
  const harness = await createHarness();
  const { server, cleanup } = harness;

  try {
    const policy = await server.inject({
      method: "PUT",
      url: "/api/update/policy",
      headers: authHeaders("owner-token"),
      payload: {
        pinned_version: "2.0.0",
        strict_mode: true,
        auto_update: false,
      },
    });

    assert.equal(policy.statusCode, 200);
    assert.equal(policy.json().policy.pinned_version, "2.0.0");

    const command = await server.inject({
      method: "POST",
      url: "/api/command",
      headers: authHeaders("owner-token"),
      payload: {
        text: "m1 ping",
      },
    });

    assert.equal(command.statusCode, 409);
    assert.equal(command.json().error_code, "VERSION_PINNED_UPDATE_REQUIRED");
  } finally {
    await cleanup();
  }
});

test("auto-update policy queues update for online outdated devices", async () => {
  const harness = await createHarness({
    configOverrides: {
      allowAutomaticUpdates: true,
    },
  });
  const { server, db, queuedUpdateDispatcher, cleanup } = harness;

  try {
    const policy = await server.inject({
      method: "PUT",
      url: "/api/update/policy",
      headers: authHeaders("owner-token"),
      payload: {
        pinned_version: "2.0.0",
        strict_mode: true,
        auto_update: true,
        package_url: "https://example.com/agent-v2.exe",
        sha256: "a".repeat(64),
      },
    });

    assert.equal(policy.statusCode, 200);
    const body = policy.json();
    assert.equal(body.ok, true);
    assert.equal(Array.isArray(body.queued_updates), true);
    assert.equal(body.queued_updates.includes("m1"), true);

    const queued = db.listQueuedUpdatesForDevice("m1");
    assert.equal(queued.length, 1);
    assert.equal(queued[0]?.version, "2.0.0");
    assert.equal(queuedUpdateDispatcher.kicked.includes("m1"), true);
  } finally {
    await cleanup();
  }
});

test("auto-update remains disabled by default for operator safety", async () => {
  const harness = await createHarness();
  const { server, db, cleanup } = harness;

  try {
    const policy = await server.inject({
      method: "PUT",
      url: "/api/update/policy",
      headers: authHeaders("owner-token"),
      payload: {
        pinned_version: "2.0.0",
        strict_mode: true,
        auto_update: true,
        package_url: "https://example.com/agent-v2.exe",
        sha256: "a".repeat(64),
      },
    });

    assert.equal(policy.statusCode, 200);
    const body = policy.json();
    assert.equal(body.policy.auto_update, false);
    assert.equal(body.auto_update_enabled, false);
    assert.equal(Array.isArray(body.queued_updates), true);
    assert.equal(body.queued_updates.length, 0);
    assert.equal(db.listQueuedUpdatesForDevice("m1").length, 0);
  } finally {
    await cleanup();
  }
});

test("revoked version policy blocks stale device immediately", async () => {
  const harness = await createHarness();
  const { server, cleanup } = harness;

  try {
    const policy = await server.inject({
      method: "PUT",
      url: "/api/update/policy",
      headers: authHeaders("owner-token"),
      payload: {
        revoked_versions: ["1.0.0"],
        strict_mode: true,
        auto_update: false,
      },
    });

    assert.equal(policy.statusCode, 200);

    const command = await server.inject({
      method: "POST",
      url: "/api/command",
      headers: authHeaders("owner-token"),
      payload: {
        text: "m1 ping",
      },
    });

    assert.equal(command.statusCode, 409);
    assert.equal(command.json().error_code, "VERSION_REVOKED");
  } finally {
    await cleanup();
  }
});

test("profile policy blocks lite agents from standard power commands", async () => {
  const harness = await createHarness();
  const { server, router, cleanup } = harness;

  try {
    addOnlineDevice(harness, {
      deviceId: "s1",
      capabilities: ["profile_s", "media_control", "locking", "open_app", "notifications", "clipboard_control", "updater"],
    });

    const blocked = await server.inject({
      method: "POST",
      url: "/api/command",
      headers: authHeaders("owner-token"),
      payload: {
        text: "s1 sleep",
      },
    });

    assert.equal(blocked.statusCode, 409);
    const blockedBody = blocked.json();
    assert.equal(blockedBody.error_code, "COMMAND_NOT_ALLOWED_FOR_PROFILE");

    addOnlineDevice(harness, {
      deviceId: "e1",
      capabilities: [
        "profile_e",
        "media_control",
        "locking",
        "open_app",
        "notifications",
        "clipboard_control",
        "display_control",
        "power_control",
        "session_control",
        "updater",
        "emergency_lockdown",
      ],
    });

    const allowed = await server.inject({
      method: "POST",
      url: "/api/command",
      headers: authHeaders("owner-token"),
      payload: {
        text: "e1 sleep",
      },
    });

    assert.equal(allowed.statusCode, 200);
    const allowedBody = allowed.json();
    assert.equal(allowedBody.parsed_type, "SYSTEM_SLEEP");
    assert.equal(router.dispatchedToDevice.some((item) => item.deviceId === "e1" && item.type === "SYSTEM_SLEEP"), true);
  } finally {
    await cleanup();
  }
});

test("profile policy allows type text for t/e/a and blocks lite profiles", async () => {
  const harness = await createHarness();
  const { server, router, cleanup } = harness;

  try {
    addOnlineDevice(harness, {
      deviceId: "s1",
      capabilities: ["profile_s", "media_control", "locking", "open_app", "notifications", "clipboard_control", "updater"],
    });

    const blockedS = await server.inject({
      method: "POST",
      url: "/api/command",
      headers: authHeaders("owner-token"),
      payload: {
        text: "s1 type hello from remote",
      },
    });

    assert.equal(blockedS.statusCode, 409);
    assert.equal(blockedS.json().error_code, "COMMAND_NOT_ALLOWED_FOR_PROFILE");

    addOnlineDevice(harness, {
      deviceId: "se1",
      capabilities: [
        "profile_se",
        "media_control",
        "locking",
        "open_app",
        "notifications",
        "clipboard_control",
        "display_control",
        "updater",
        "emergency_lockdown",
      ],
    });

    const blockedSe = await server.inject({
      method: "POST",
      url: "/api/command",
      headers: authHeaders("owner-token"),
      payload: {
        text: "se1 type hello from remote",
      },
    });

    assert.equal(blockedSe.statusCode, 409);
    assert.equal(blockedSe.json().error_code, "COMMAND_NOT_ALLOWED_FOR_PROFILE");

    addOnlineDevice(harness, {
      deviceId: "t1",
      capabilities: [
        "profile_t",
        "media_control",
        "locking",
        "open_app",
        "notifications",
        "clipboard_control",
        "display_control",
        "keyboard_control",
        "advanced_keyboard_control",
        "power_control",
        "session_control",
        "updater",
      ],
    });

    const allowedT = await server.inject({
      method: "POST",
      url: "/api/command",
      headers: authHeaders("owner-token"),
      payload: {
        text: "t1 type Hello T",
      },
    });

    assert.equal(allowedT.statusCode, 200);
    assert.equal(allowedT.json().parsed_type, "TYPE_TEXT");
    assert.equal(
      router.dispatchedToDevice.some(
        (item) => item.deviceId === "t1" && item.type === "TYPE_TEXT" && item.args.text === "Hello T",
      ),
      true,
    );

    addOnlineDevice(harness, {
      deviceId: "e1",
      capabilities: [
        "profile_e",
        "media_control",
        "locking",
        "open_app",
        "notifications",
        "clipboard_control",
        "display_control",
        "keyboard_control",
        "advanced_keyboard_control",
        "power_control",
        "session_control",
        "updater",
        "emergency_lockdown",
      ],
    });

    const allowedE = await server.inject({
      method: "POST",
      url: "/api/command",
      headers: authHeaders("owner-token"),
      payload: {
        text: "e1 type Hello E",
      },
    });

    assert.equal(allowedE.statusCode, 200);
    assert.equal(allowedE.json().parsed_type, "TYPE_TEXT");
    assert.equal(
      router.dispatchedToDevice.some(
        (item) => item.deviceId === "e1" && item.type === "TYPE_TEXT" && item.args.text === "Hello E",
      ),
      true,
    );

    addOnlineDevice(harness, {
      deviceId: "a1",
      capabilities: [
        "profile_a",
        "admin_ops",
        "media_control",
        "locking",
        "open_app",
        "notifications",
        "clipboard_control",
        "display_control",
        "keyboard_control",
        "advanced_keyboard_control",
        "power_control",
        "session_control",
        "updater",
      ],
    });

    const allowedA = await server.inject({
      method: "POST",
      url: "/api/command",
      headers: authHeaders("owner-token"),
      payload: {
        text: "a1 type Hello A",
      },
    });

    assert.equal(allowedA.statusCode, 200);
    assert.equal(allowedA.json().parsed_type, "TYPE_TEXT");
    assert.equal(
      router.dispatchedToDevice.some(
        (item) => item.deviceId === "a1" && item.type === "TYPE_TEXT" && item.args.text === "Hello A",
      ),
      true,
    );
  } finally {
    await cleanup();
  }
});

test("profile policy keeps emergency command available to se profile", async () => {
  const harness = await createHarness();
  const { server, router, cleanup } = harness;

  try {
    addOnlineDevice(harness, {
      deviceId: "se1",
      capabilities: [
        "profile_se",
        "media_control",
        "locking",
        "open_app",
        "notifications",
        "clipboard_control",
        "display_control",
        "updater",
        "emergency_lockdown",
      ],
    });

    const response = await server.inject({
      method: "POST",
      url: "/api/command",
      headers: authHeaders("owner-token"),
      payload: {
        text: "se1 panic confirm",
      },
    });

    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal(body.parsed_type, "EMERGENCY_LOCKDOWN");
    assert.equal(
      router.dispatchedToDevice.some((item) => item.deviceId === "se1" && item.type === "EMERGENCY_LOCKDOWN"),
      true,
    );
  } finally {
    await cleanup();
  }
});
