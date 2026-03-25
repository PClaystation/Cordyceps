import type { Database } from "../db/database";

export interface PreparedDesignationChange {
  currentDeviceId: string;
  nextDeviceId: string;
}

export function shouldPreserveCurrentDeviceForDesignationChange(
  currentDeviceId: string,
  nextDeviceId: string,
): boolean {
  const currentPrefix = deviceIdPrefix(currentDeviceId);
  const nextPrefix = deviceIdPrefix(nextDeviceId);
  return (currentPrefix === "d" || currentPrefix === "ds") && nextPrefix !== "" && nextPrefix !== currentPrefix;
}

export function inferDesignationPrefixFromPackageUrl(packageUrl: string): string | null {
  const value = packageUrl.trim().toLowerCase();
  if (!value) {
    return null;
  }

  if (value.includes("se1-agent")) {
    return "se";
  }

  if (value.includes("ds1-agent")) {
    return "ds";
  }

  if (value.includes("e1-agent")) {
    return "e";
  }

  if (value.includes("t1-agent")) {
    return "t";
  }

  if (value.includes("s1-agent")) {
    return "s";
  }

  if (value.includes("d1-agent")) {
    return "d";
  }

  if (value.includes("a1-agent")) {
    return "a";
  }

  if (value.includes("cordyceps-agent") || value.includes("jarvis-agent")) {
    return "m";
  }

  return null;
}

function deviceIdPrefix(deviceId: string): string {
  const normalized = deviceId.trim().toLowerCase();
  const knownPrefixes = ["se", "ds", "s", "d", "t", "e", "a", "m"];
  for (const prefix of knownPrefixes) {
    if (normalized.startsWith(prefix)) {
      return prefix;
    }
  }
  return "";
}

export function prepareDesignationChange(
  db: Database,
  deviceId: string,
  nextPrefix: string | null,
): PreparedDesignationChange | null {
  if (!nextPrefix) {
    return null;
  }

  const currentPrefix = deviceIdPrefix(deviceId);
  if (!currentPrefix || currentPrefix === nextPrefix) {
    return null;
  }

  const nextDeviceId = db.allocateNextDeviceId(nextPrefix);
  if (!db.cloneDeviceWithNewId(deviceId, nextDeviceId)) {
    return null;
  }

  return {
    currentDeviceId: deviceId,
    nextDeviceId,
  };
}
