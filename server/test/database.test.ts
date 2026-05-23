import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Database } from "../src/db/database";
import { sha256Hex } from "../src/utils/crypto";

function makeTempDbPath(): string {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return path.join(os.tmpdir(), `cordyceps-database-test-${suffix}.db`);
}

test("database startup clears transient online presence", () => {
  const sqlitePath = makeTempDbPath();

  try {
    const first = new Database(sqlitePath);
    first.enrollDevice({
      deviceId: "m1",
      tokenHash: sha256Hex("device-token"),
      displayName: "m1",
      version: "1.0.0",
      hostname: "host",
      username: "user",
      capabilities: ["media_control"],
    });
    first.markDeviceOnline({
      deviceId: "m1",
      version: "1.0.0",
      hostname: "host",
      username: "user",
      capabilities: ["media_control"],
    });
    first.markHeartbeatProcessOnline({
      deviceId: "m1",
      version: "1.0.0",
      hostname: "host",
      username: "user",
    });
    first.close();

    const reopened = new Database(sqlitePath);
    const device = reopened.getDevice("m1");
    reopened.close();

    assert.ok(device);
    assert.equal(device.status, "offline");
    assert.equal(device.subprocesses.heartbeat.status, "offline");
    assert.equal(device.subprocesses.heartbeat.connected_at, null);
  } finally {
    try {
      fs.unlinkSync(sqlitePath);
    } catch {
      // ignore cleanup races
    }
  }
});

test("clearTransientPresence immediately resets live status", () => {
  const sqlitePath = makeTempDbPath();

  try {
    const db = new Database(sqlitePath);
    db.enrollDevice({
      deviceId: "m1",
      tokenHash: sha256Hex("device-token"),
      displayName: "m1",
      version: "1.0.0",
      hostname: "host",
      username: "user",
      capabilities: ["media_control"],
    });
    db.markDeviceOnline({
      deviceId: "m1",
      version: "1.0.0",
      hostname: "host",
      username: "user",
      capabilities: ["media_control"],
    });
    db.markHeartbeatProcessOnline({
      deviceId: "m1",
      version: "1.0.0",
      hostname: "host",
      username: "user",
    });

    db.clearTransientPresence();

    const device = db.getDevice("m1");
    db.close();

    assert.ok(device);
    assert.equal(device.status, "offline");
    assert.equal(device.subprocesses.heartbeat.status, "offline");
    assert.equal(device.subprocesses.heartbeat.connected_at, null);
  } finally {
    try {
      fs.unlinkSync(sqlitePath);
    } catch {
      // ignore cleanup races
    }
  }
});

test("database close is idempotent", () => {
  const sqlitePath = makeTempDbPath();

  try {
    const db = new Database(sqlitePath);
    db.close();
    db.close();
  } finally {
    try {
      fs.unlinkSync(sqlitePath);
    } catch {
      // ignore cleanup races
    }
  }
});
