import test from "node:test";
import assert from "node:assert/strict";
import { DeviceRegistry } from "../src/realtime/deviceRegistry";

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
