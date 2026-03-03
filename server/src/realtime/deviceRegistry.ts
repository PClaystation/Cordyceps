export interface SocketLike {
  send(data: string): void;
  close(code?: number, data?: Buffer | string): void;
}

export interface ConnectedDevice {
  deviceId: string;
  socket: SocketLike;
  version: string;
  hostname: string;
  username: string;
  capabilities: string[];
  connectedAt: number;
  lastSeenAt: number;
}

export class DeviceRegistry {
  private readonly devices = new Map<string, ConnectedDevice>();

  public register(device: Omit<ConnectedDevice, "connectedAt" | "lastSeenAt">): ConnectedDevice {
    const existing = this.devices.get(device.deviceId);
    if (existing) {
      existing.socket.close(4000, "Superseded by a new session");
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

  public pruneExpired(ttlMs: number): string[] {
    const now = Date.now();
    const removed: string[] = [];

    for (const [deviceId, device] of this.devices.entries()) {
      if (now - device.lastSeenAt <= ttlMs) {
        continue;
      }

      device.socket.close(4002, "Heartbeat timeout");
      this.devices.delete(deviceId);
      removed.push(deviceId);
    }

    return removed;
  }
}
