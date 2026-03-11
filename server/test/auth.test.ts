import test from "node:test";
import assert from "node:assert/strict";
import { constantTimeEqual, extractBearerToken } from "../src/auth/auth";

test("extractBearerToken parses valid bearer tokens", () => {
  assert.equal(extractBearerToken("Bearer abc123"), "abc123");
  assert.equal(extractBearerToken("bearer token-value"), "token-value");
  assert.equal(extractBearerToken(["Bearer one-token"]), "one-token");
});

test("extractBearerToken rejects malformed or oversized tokens", () => {
  assert.equal(extractBearerToken(undefined), null);
  assert.equal(extractBearerToken("Basic abc123"), null);
  assert.equal(extractBearerToken("Bearer"), null);
  assert.equal(extractBearerToken("Bearer a b"), null);
  assert.equal(extractBearerToken(["Bearer t1", "Bearer t2"]), null);

  const oversized = `Bearer ${"x".repeat(513)}`;
  assert.equal(extractBearerToken(oversized), null);
});

test("constantTimeEqual compares exact values", () => {
  assert.equal(constantTimeEqual("same-value", "same-value"), true);
  assert.equal(constantTimeEqual("same-value", "different-value"), false);
  assert.equal(constantTimeEqual("short", "longer"), false);
});
