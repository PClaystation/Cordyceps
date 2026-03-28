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

export interface ConnectedDroneProcess extends ConnectedHeartbeatProcess {
  role: string;
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
  private readonly droneProcesses = new Map<string, Map<string, ConnectedDroneProcess>>();

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

  public registerDroneProcess(
    process: Omit<ConnectedDroneProcess, "connectedAt" | "lastSeenAt">,
  ): ConnectedDroneProcess {
    const role = process.role.trim();
    const deviceProcesses = this.droneProcesses.get(process.deviceId) ?? new Map<string, ConnectedDroneProcess>();
    const existing = deviceProcesses.get(role);
    if (existing) {
      closeSocketQuietly(existing.socket, 4000, "Superseded by a new session");
    }

    const now = Date.now();
    const entry: ConnectedDroneProcess = {
      ...process,
      role,
      connectedAt: now,
      lastSeenAt: now,
    };

    deviceProcesses.set(role, entry);
    this.droneProcesses.set(process.deviceId, deviceProcesses);
    return entry;
  }

  public disconnectDroneProcess(deviceId: string, role: string): void {
    const deviceProcesses = this.droneProcesses.get(deviceId);
    if (!deviceProcesses) {
      return;
    }

    deviceProcesses.delete(role);
    if (deviceProcesses.size === 0) {
      this.droneProcesses.delete(deviceId);
    }
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

  public markDroneProcess(deviceId: string, role: string): void {
    const entry = this.droneProcesses.get(deviceId)?.get(role);
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

  public getDroneProcesses(deviceId: string): ConnectedDroneProcess[] {
    const entries = [...(this.droneProcesses.get(deviceId)?.values() ?? [])];
    entries.sort((left, right) => left.role.localeCompare(right.role, undefined, { numeric: true }));
    return entries;
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

  public isCurrentDroneSocket(deviceId: string, role: string, socket: SocketLike): boolean {
    const entry = this.droneProcesses.get(deviceId)?.get(role);
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

  public pruneExpiredDroneProcesses(ttlMs: number): Array<{ deviceId: string; role: string }> {
    const now = Date.now();
    const removed: Array<{ deviceId: string; role: string }> = [];

    for (const [deviceId, processes] of this.droneProcesses.entries()) {
      for (const [role, process] of processes.entries()) {
        if (now - process.lastSeenAt <= ttlMs) {
          continue;
        }

        closeSocketQuietly(process.socket, 4002, "Heartbeat timeout");
        processes.delete(role);
        removed.push({ deviceId, role });
      }

      if (processes.size === 0) {
        this.droneProcesses.delete(deviceId);
      }
    }

    return removed;
  }
}
