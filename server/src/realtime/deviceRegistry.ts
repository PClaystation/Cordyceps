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

export interface ConnectedHeartbeatProcess {
  deviceId: string;
  socket: SocketLike;
  version: string;
  hostname: string;
  username: string;
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
  private readonly heartbeatProcesses = new Map<string, ConnectedHeartbeatProcess>();

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

  public registerHeartbeatProcess(
    process: Omit<ConnectedHeartbeatProcess, "connectedAt" | "lastSeenAt">,
  ): ConnectedHeartbeatProcess {
    const existing = this.heartbeatProcesses.get(process.deviceId);
    if (existing) {
      closeSocketQuietly(existing.socket, 4000, "Superseded by a new session");
    }

    const now = Date.now();
    const entry: ConnectedHeartbeatProcess = {
      ...process,
      connectedAt: now,
      lastSeenAt: now,
    };

    this.heartbeatProcesses.set(process.deviceId, entry);
    return entry;
  }

  public disconnectHeartbeatProcess(deviceId: string): void {
    this.heartbeatProcesses.delete(deviceId);
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

  public markHeartbeatProcess(deviceId: string): void {
    const entry = this.heartbeatProcesses.get(deviceId);
    if (!entry) {
      return;
    }

    entry.lastSeenAt = Date.now();
  }

  public get(deviceId: string): ConnectedDevice | null {
    return this.devices.get(deviceId) ?? null;
  }

  public getHeartbeatProcess(deviceId: string): ConnectedHeartbeatProcess | null {
    return this.heartbeatProcesses.get(deviceId) ?? null;
  }

  public isCurrentSocket(deviceId: string, socket: SocketLike): boolean {
    const entry = this.devices.get(deviceId);
    if (!entry) {
      return false;
    }

    return entry.socket === socket;
  }

  public isCurrentHeartbeatSocket(deviceId: string, socket: SocketLike): boolean {
    const entry = this.heartbeatProcesses.get(deviceId);
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

  public pruneExpiredHeartbeatProcesses(ttlMs: number): string[] {
    const now = Date.now();
    const removed: string[] = [];

    for (const [deviceId, process] of this.heartbeatProcesses.entries()) {
      if (now - process.lastSeenAt <= ttlMs) {
        continue;
      }

      closeSocketQuietly(process.socket, 4002, "Heartbeat timeout");
      this.heartbeatProcesses.delete(deviceId);
      removed.push(deviceId);
    }

    return removed;
  }
}
