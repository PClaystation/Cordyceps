import test from "node:test";
import assert from "node:assert/strict";
import { DeviceRegistry } from "../src/realtime/deviceRegistry";

class MockSocket {
  public closeCalls: Array<{ code?: number; reason?: Buffer | string }> = [];
  public readyState = 1;
  public OPEN = 1;

  public send(_data: string): void {
    // noop
  }

  public close(code?: number, reason?: Buffer | string): void {
    this.closeCalls.push({ code, reason });
    this.readyState = 3;
  }
}

test("device registry closeAll closes and clears active connections", () => {
  const registry = new DeviceRegistry();
  const agentSocket = new MockSocket();
  const heartbeatSocket = new MockSocket();
  const droneSocket = new MockSocket();

  registry.register({
    deviceId: "m1",
    socket: agentSocket,
    version: "1.0.0",
    hostname: "host",
    username: "user",
    capabilities: ["media_control"],
  });
  registry.registerHeartbeatProcess({
    deviceId: "m1",
    socket: heartbeatSocket,
    version: "1.0.0",
    hostname: "host",
    username: "user",
  });
  registry.registerDroneProcess({
    deviceId: "m1",
    role: "alpha",
    socket: droneSocket,
    version: "1.0.0",
    hostname: "host",
    username: "user",
  });

  const closed = registry.closeAll(1001, "Server shutting down");

  assert.deepEqual(closed.devices, ["m1"]);
  assert.deepEqual(closed.heartbeatProcesses, ["m1"]);
  assert.deepEqual(closed.droneProcesses, [{ deviceId: "m1", role: "alpha" }]);
  assert.equal(agentSocket.closeCalls.length, 1);
  assert.equal(heartbeatSocket.closeCalls.length, 1);
  assert.equal(droneSocket.closeCalls.length, 1);
  assert.equal(registry.get("m1"), null);
  assert.equal(registry.getHeartbeatProcess("m1"), null);
  assert.deepEqual(registry.getDroneProcesses("m1"), []);
});

test("device registry can refresh live device_info after registration", () => {
  const registry = new DeviceRegistry();

  registry.register({
    deviceId: "m1",
    socket: new MockSocket(),
    version: "1.0.0",
    hostname: "host",
    username: "user",
    capabilities: ["updater"],
    deviceInfo: {
      runtime_os: "windows",
    },
  });

  registry.updateDeviceInfo("m1", {
    runtime_os: "windows",
    local_ips: ["10.0.0.5"],
    network_adapters: [{ name: "ethernet0", mac: "aa:bb:cc:dd:ee:ff" }],
  });

  const connected = registry.get("m1");
  assert.ok(connected);
  assert.deepEqual(connected.deviceInfo?.local_ips, ["10.0.0.5"]);
  assert.equal(Array.isArray(connected.deviceInfo?.network_adapters), true);
});
