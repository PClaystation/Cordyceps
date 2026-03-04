import { createHash } from "node:crypto";

export class PackageInspectionError extends Error {
  public readonly code: string;

  public constructor(code: string, message: string) {
    super(message);
    this.name = "PackageInspectionError";
    this.code = code;
  }
}

export interface PackageInspectionResult {
  sha256: string;
  sizeBytes: number;
  finalUrl: string;
}

export async function inspectPackageFromUrl(input: {
  url: string;
  timeoutMs: number;
  maxBytes: number;
  requireHttps: boolean;
}): Promise<PackageInspectionResult> {
  const parsed = parseAndValidateUrl(input.url, input.requireHttps);
  const timeoutMs = normalizePositiveInt(input.timeoutMs, 120000);
  const maxBytes = normalizePositiveInt(input.maxBytes, 314572800);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();

  try {
    const response = await fetch(parsed.toString(), {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        Accept: "application/octet-stream",
      },
    });

    if (!response.ok) {
      throw new PackageInspectionError("UPDATE_FETCH_FAILED", `Package URL returned HTTP ${response.status}`);
    }

    const finalUrl = parseAndValidateUrl(response.url || parsed.toString(), input.requireHttps);

    const lengthHeader = response.headers.get("content-length");
    if (lengthHeader) {
      const length = Number.parseInt(lengthHeader, 10);
      if (Number.isFinite(length) && length > maxBytes) {
        throw new PackageInspectionError(
          "UPDATE_PACKAGE_TOO_LARGE",
          `Package is too large (${length} bytes, max ${maxBytes})`,
        );
      }
    }

    if (!response.body) {
      throw new PackageInspectionError("UPDATE_FETCH_FAILED", "Package response had no body");
    }

    const reader = response.body.getReader();
    const hash = createHash("sha256");
    let sizeBytes = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      if (!value || value.byteLength === 0) {
        continue;
      }

      sizeBytes += value.byteLength;
      if (sizeBytes > maxBytes) {
        throw new PackageInspectionError(
          "UPDATE_PACKAGE_TOO_LARGE",
          `Package is too large (${sizeBytes} bytes, max ${maxBytes})`,
        );
      }

      hash.update(value);
    }

    if (sizeBytes <= 0) {
      throw new PackageInspectionError("UPDATE_FETCH_FAILED", "Package download was empty");
    }

    return {
      sha256: hash.digest("hex"),
      sizeBytes,
      finalUrl: finalUrl.toString(),
    };
  } catch (error) {
    if (error instanceof PackageInspectionError) {
      throw error;
    }

    if (error instanceof Error && error.name === "AbortError") {
      throw new PackageInspectionError("UPDATE_FETCH_TIMEOUT", "Timed out while downloading package metadata");
    }

    const message = error instanceof Error ? error.message : String(error);
    throw new PackageInspectionError("UPDATE_FETCH_FAILED", `Failed to inspect package URL: ${message}`);
  } finally {
    clearTimeout(timer);
  }
}

function parseAndValidateUrl(input: string, requireHttps: boolean): URL {
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    throw new PackageInspectionError("INVALID_UPDATE_URL", "package_url must be a valid absolute URL");
  }

  if (requireHttps && parsed.protocol !== "https:") {
    throw new PackageInspectionError("INVALID_UPDATE_URL", "package_url must use https");
  }

  if (!requireHttps && parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new PackageInspectionError("INVALID_UPDATE_URL", "package_url must use http or https");
  }

  if (!parsed.hostname) {
    throw new PackageInspectionError("INVALID_UPDATE_URL", "package_url must include a valid host");
  }

  if (parsed.username || parsed.password) {
    throw new PackageInspectionError("INVALID_UPDATE_URL", "package_url must not include credentials");
  }

  return parsed;
}

function normalizePositiveInt(value: number, fallback: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return fallback;
  }

  return Math.floor(value);
}
