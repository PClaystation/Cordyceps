import { timingSafeEqual } from "node:crypto";

export function extractBearerToken(authorizationHeader?: string | string[]): string | null {
  if (!authorizationHeader) {
    return null;
  }

  if (Array.isArray(authorizationHeader)) {
    if (authorizationHeader.length !== 1) {
      return null;
    }

    return extractBearerToken(authorizationHeader[0]);
  }

  const trimmed = authorizationHeader.trim();
  if (!trimmed) {
    return null;
  }

  const parts = trimmed.split(/\s+/);
  if (parts.length !== 2) {
    return null;
  }

  const [scheme, token] = parts;
  if (scheme.toLowerCase() !== "bearer") {
    return null;
  }

  return token || null;
}

export function constantTimeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}
