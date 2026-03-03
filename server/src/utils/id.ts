import { randomUUID } from "node:crypto";

export function makeRequestId(): string {
  return randomUUID();
}
