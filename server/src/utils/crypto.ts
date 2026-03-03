import { createHash, randomBytes } from "node:crypto";

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

export function randomToken(length = 32): string {
  return randomBytes(length).toString("base64url");
}
