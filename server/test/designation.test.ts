import test from "node:test";
import assert from "node:assert/strict";

import {
  inferDesignationPrefixFromPackageUrl,
  shouldPreserveCurrentDeviceForDesignationChange,
} from "../src/update/designation";

test("d-family designation changes preserve the current device when switching strains", () => {
  assert.equal(shouldPreserveCurrentDeviceForDesignationChange("d1", "s1"), true);
  assert.equal(shouldPreserveCurrentDeviceForDesignationChange("d1", "t1"), true);
  assert.equal(shouldPreserveCurrentDeviceForDesignationChange("d1", "ds1"), true);
  assert.equal(shouldPreserveCurrentDeviceForDesignationChange("ds1", "d1"), true);
  assert.equal(shouldPreserveCurrentDeviceForDesignationChange("ds1", "ds2"), false);
  assert.equal(shouldPreserveCurrentDeviceForDesignationChange("d1", "d2"), false);
  assert.equal(shouldPreserveCurrentDeviceForDesignationChange("s1", "t1"), false);
});

test("designation prefix inference prefers ds before s", () => {
  assert.equal(inferDesignationPrefixFromPackageUrl("https://example.com/dist/ds1-agent-usb.exe"), "ds");
  assert.equal(inferDesignationPrefixFromPackageUrl("https://example.com/dist/s1-agent-usb.exe"), "s");
});
