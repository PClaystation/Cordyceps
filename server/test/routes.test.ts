import test from "node:test";
import assert from "node:assert/strict";
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
  public dispatchedMany: Array<{ requestId: string; deviceIds: string[]; type: string }> = [];
  public dispatchedToDevice: Array<{ requestId: string; deviceId: string; type: string }> = [];

  public pendingCount(): number {
    return 0;
  }

  public async dispatchToDevice(input: {
    requestId: string;
    deviceId: string;
    command: { type: string };
  }): Promise<{
    request_id: string;
    device_id: string;
    ok: boolean;
    message: string;
    completed_at: string;
  }> {
    this.dispatchedToDevice.push({ requestId: input.requestId, deviceId: input.deviceId, type: input.command.type });
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
    command: { type: string };
  }): Promise<Array<{
    request_id: string;
    device_id: string;
    ok: boolean;
    message: string;
    completed_at: string;
  }>> {
    this.dispatchedMany.push({ requestId: input.requestId, deviceIds: [...input.deviceIds], type: input.command.type });
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

function makeConfig(): AppConfig {
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
    maxPendingCommands: 100,
    heartbeatTtlMs: 90_000,
    wsAuthTimeoutMs: 10_000,
    wsPingIntervalMs: 30_000,
    wsMaxMessageBytes: 65_536,
    updateCommandTimeoutMs: 10_000,
    updateMetadataTimeoutMs: 10_000,
    updateMaxPackageBytes: 10_000_000,
    enforceHttpsUpdateUrl: false,
    corsAllowedOrigins: ["*"],
    publicWsUrl: "ws://localhost/ws/agent",
    pwaPublicUrl: "http://localhost/app",
  };
}

function makeTempDbPath(): string {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return path.join(os.tmpdir(), `cordyceps-routes-test-${suffix}.db`);
}

async function createHarness() {
  const sqlitePath = makeTempDbPath();
  const db = new Database(sqlitePath);
  const registry = new DeviceRegistry();
  const router = new FakeRouter();
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
    config: makeConfig(),
    db,
    registry,
    router: router as unknown as CommandRouter,
    eventHub,
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

  return { server, db, registry, router, cleanup };
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
