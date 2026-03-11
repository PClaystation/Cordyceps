import test from "node:test";
import assert from "node:assert/strict";
import { parseExternalCommand } from "../src/parser/commandParser";

test("parser accepts repeat-step commands", () => {
  const parsed = parseExternalCommand("m1 volume up 3");
  assert.ok(!("code" in parsed));
  assert.equal(parsed.target, "m1");
  assert.equal(parsed.command.type, "VOLUME_UP");
  assert.deepEqual(parsed.command.args, { steps: 3 });
});

test("parser supports admin command family", () => {
  const parsed = parseExternalCommand("a1 admin system info");
  assert.ok(!("code" in parsed));
  assert.equal(parsed.target, "a1");
  assert.equal(parsed.command.type, "SYSTEM_INFO");
});

test("parser supports expanded admin process and filesystem commands", () => {
  const processParsed = parseExternalCommand("a1 admin process start notepad.exe");
  assert.ok(!("code" in processParsed));
  assert.equal(processParsed.command.type, "PROCESS_START");
  assert.deepEqual(processParsed.command.args, { command: "notepad.exe" });

  const hashParsed = parseExternalCommand("a1 admin file hash sha512 C:\\Temp\\notes.txt");
  assert.ok(!("code" in hashParsed));
  assert.equal(hashParsed.command.type, "FILE_HASH");
  assert.deepEqual(hashParsed.command.args, { path: "C:\\Temp\\notes.txt", algorithm: "sha512" });
});

test("parser supports expanded admin network and event commands", () => {
  const networkParsed = parseExternalCommand("a1 admin network test 1.1.1.1 443");
  assert.ok(!("code" in networkParsed));
  assert.equal(networkParsed.command.type, "NETWORK_TEST");
  assert.deepEqual(networkParsed.command.args, { host: "1.1.1.1", port: 443 });

  const eventParsed = parseExternalCommand("a1 admin event log System limit 5");
  assert.ok(!("code" in eventParsed));
  assert.equal(eventParsed.command.type, "EVENT_LOG_QUERY");
  assert.deepEqual(eventParsed.command.args, { log: "System", limit: 5 });
});

test("parser rejects unconfirmed emergency command", () => {
  const parsed = parseExternalCommand("e1 panic");
  assert.ok("code" in parsed);
  assert.equal(parsed.code, "MALFORMED_ARGUMENT");
  assert.match(parsed.message, /requires explicit confirmation/i);
});

test("parser preserves notify and clipboard text payload casing", () => {
  const notifyParsed = parseExternalCommand("m1 notify: Hello WORLD!");
  assert.ok(!("code" in notifyParsed));
  assert.equal(notifyParsed.command.type, "NOTIFY");
  assert.deepEqual(notifyParsed.command.args, { text: "Hello WORLD!" });

  const clipboardParsed = parseExternalCommand("m1 clipboard Keep  CASE  x");
  assert.ok(!("code" in clipboardParsed));
  assert.equal(clipboardParsed.command.type, "CLIPBOARD_SET");
  assert.deepEqual(clipboardParsed.command.args, { text: "Keep  CASE  x" });
});
