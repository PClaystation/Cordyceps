import type { DeviceInfoRecord } from "../types/protocol";

export interface SocketLike {
  send(data: string): void;
  ping?(data?: Buffer | string, cb?: (error?: Error) => void): void;
  close(code?: number, data?: Buffer | string): void;
  readyState?: number;
  OPEN?: number;
}

export interface ConnectedDevice {
  deviceId: string;
  socket: SocketLike;
  version: string;
  hostname: string;
  username: string;
  capabilities: string[];
  deviceInfo?: DeviceInfoRecord;
  connectedAt: number;
  lastSeenAt: number;
}

function closeSocketQuietly(socket: SocketLike, code: number, reason: string): void {
  try {
    socket.close(code, reason);
  } catch {
    // Socket may already be closed or invalid.
  }
}

export class DeviceRegistry {
  private readonly devices = new Map<string, ConnectedDevice>();

  public register(device: Omit<ConnectedDevice, "connectedAt" | "lastSeenAt">): ConnectedDevice {
    const existing = this.devices.get(device.deviceId);
    if (existing) {
      closeSocketQuietly(existing.socket, 4000, "Superseded by a new session");
    }

    const now = Date.now();
    const entry: ConnectedDevice = {
      ...device,
      connectedAt: now,
      lastSeenAt: now,
    };

    this.devices.set(device.deviceId, entry);
    return entry;
  }

  public disconnect(deviceId: string): void {
    this.devices.delete(deviceId);
  }

  public forceDisconnect(deviceId: string, code = 4008, reason = "Disconnected by server policy"): boolean {
    const entry = this.devices.get(deviceId);
    if (!entry) {
      return false;
    }

    this.devices.delete(deviceId);
    closeSocketQuietly(entry.socket, code, reason);
    return true;
  }

  public markHeartbeat(deviceId: string): void {
    const entry = this.devices.get(deviceId);
    if (!entry) {
      return;
    }

    entry.lastSeenAt = Date.now();
  }

  public get(deviceId: string): ConnectedDevice | null {
    return this.devices.get(deviceId) ?? null;
  }

  public isCurrentSocket(deviceId: string, socket: SocketLike): boolean {
    const entry = this.devices.get(deviceId);
    if (!entry) {
      return false;
    }

    return entry.socket === socket;
  }

  public listOnlineDeviceIds(): string[] {
    return [...this.devices.keys()];
  }

  public countOnline(): number {
    return this.devices.size;
  }

  public pruneExpired(ttlMs: number): string[] {
    const now = Date.now();
    const removed: string[] = [];

    for (const [deviceId, device] of this.devices.entries()) {
      if (now - device.lastSeenAt <= ttlMs) {
        continue;
      }

      closeSocketQuietly(device.socket, 4002, "Heartbeat timeout");
      this.devices.delete(deviceId);
      removed.push(deviceId);
    }

    return removed;
  }
}
