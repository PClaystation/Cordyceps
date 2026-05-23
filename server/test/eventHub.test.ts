import test from "node:test";
import assert from "node:assert/strict";
import { EventHub } from "../src/events/eventHub";

test("event hub removes listeners that throw", () => {
  const hub = new EventHub();
  let healthyCount = 0;
  let failingCount = 0;

  hub.subscribe(() => {
    failingCount += 1;
    throw new Error("listener failed");
  });
  hub.subscribe(() => {
    healthyCount += 1;
  });

  hub.publish("device_status", { device_id: "m1", status: "online" });
  assert.equal(hub.listenerCount(), 1);
  assert.equal(failingCount, 1);
  assert.equal(healthyCount, 1);

  hub.publish("device_status", { device_id: "m1", status: "offline" });
  assert.equal(hub.listenerCount(), 1);
  assert.equal(failingCount, 1);
  assert.equal(healthyCount, 2);
});
