import fs from "node:fs";
import path from "node:path";
import BetterSqlite3 from "better-sqlite3";
import type { DeviceRecord } from "../types/protocol";
import { sha256Hex } from "../utils/crypto";

export interface EnrollDeviceInput {
  deviceId: string;
  tokenHash: string;
  displayName?: string;
  version?: string;
  hostname?: string;
  username?: string;
  capabilities?: string[];
}

export interface CommandLogInsert {
  id: string;
  requestId: string;
  deviceId: string;
  source: string;
  rawText: string;
  parsedTarget: string;
  parsedType: string;
  argsJson: string;
  status: string;
  resultMessage: string | null;
  errorCode?: string | null;
}

export class Database {
  private readonly db: InstanceType<typeof BetterSqlite3>;

  public constructor(sqlitePath: string) {
    const dir = path.dirname(sqlitePath);
    fs.mkdirSync(dir, { recursive: true });

    this.db = new BetterSqlite3(sqlitePath);
    this.db.pragma("journal_mode = WAL");
    this.init();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS devices (
        device_id TEXT PRIMARY KEY,
        display_name TEXT,
        auth_token_hash TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'offline',
        last_seen TEXT NOT NULL,
        version TEXT,
        hostname TEXT,
        username TEXT,
        capabilities_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS command_logs (
        id TEXT PRIMARY KEY,
        request_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        source TEXT NOT NULL,
        raw_text TEXT NOT NULL,
        parsed_target TEXT NOT NULL,
        parsed_type TEXT NOT NULL,
        args_json TEXT NOT NULL,
        status TEXT NOT NULL,
        result_message TEXT,
        error_code TEXT,
        created_at TEXT NOT NULL,
        completed_at TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_command_logs_request_id ON command_logs(request_id);
      CREATE INDEX IF NOT EXISTS idx_command_logs_device_id ON command_logs(device_id);
      CREATE INDEX IF NOT EXISTS idx_devices_status ON devices(status);
    `);
  }

  public enrollDevice(input: EnrollDeviceInput): void {
    const now = new Date().toISOString();
    const capabilitiesJson = JSON.stringify(input.capabilities ?? []);

    const statement = this.db.prepare(`
      INSERT INTO devices (
        device_id,
        display_name,
        auth_token_hash,
        status,
        last_seen,
        version,
        hostname,
        username,
        capabilities_json,
        created_at,
        updated_at
      ) VALUES (
        @device_id,
        @display_name,
        @auth_token_hash,
        'offline',
        @last_seen,
        @version,
        @hostname,
        @username,
        @capabilities_json,
        @created_at,
        @updated_at
      )
      ON CONFLICT(device_id) DO UPDATE SET
        display_name = excluded.display_name,
        auth_token_hash = excluded.auth_token_hash,
        version = excluded.version,
        hostname = excluded.hostname,
        username = excluded.username,
        capabilities_json = excluded.capabilities_json,
        updated_at = excluded.updated_at
    `);

    statement.run({
      device_id: input.deviceId,
      display_name: input.displayName ?? null,
      auth_token_hash: input.tokenHash,
      last_seen: now,
      version: input.version ?? null,
      hostname: input.hostname ?? null,
      username: input.username ?? null,
      capabilities_json: capabilitiesJson,
      created_at: now,
      updated_at: now,
    });
  }

  public isValidDeviceToken(deviceId: string, rawToken: string): boolean {
    const row = this.db
      .prepare("SELECT auth_token_hash FROM devices WHERE device_id = ?")
      .get(deviceId) as { auth_token_hash: string } | undefined;

    if (!row) {
      return false;
    }

    return row.auth_token_hash === sha256Hex(rawToken);
  }

  public getDevice(deviceId: string): DeviceRecord | null {
    const row = this.db
      .prepare(
        "SELECT device_id, display_name, status, last_seen, version, hostname, username, created_at, updated_at FROM devices WHERE device_id = ?",
      )
      .get(deviceId) as DeviceRecord | undefined;

    return row ?? null;
  }

  public listDevices(): DeviceRecord[] {
    return this.db
      .prepare(
        "SELECT device_id, display_name, status, last_seen, version, hostname, username, created_at, updated_at FROM devices ORDER BY device_id ASC",
      )
      .all() as DeviceRecord[];
  }

  public markDeviceOnline(input: {
    deviceId: string;
    version?: string;
    hostname?: string;
    username?: string;
    capabilities?: string[];
  }): void {
    const now = new Date().toISOString();
    const capabilitiesJson = JSON.stringify(input.capabilities ?? []);

    const statement = this.db.prepare(`
      UPDATE devices
      SET status = 'online',
          last_seen = @last_seen,
          version = COALESCE(@version, version),
          hostname = COALESCE(@hostname, hostname),
          username = COALESCE(@username, username),
          capabilities_json = CASE WHEN @capabilities_json = '' THEN capabilities_json ELSE @capabilities_json END,
          updated_at = @updated_at
      WHERE device_id = @device_id
    `);

    statement.run({
      device_id: input.deviceId,
      last_seen: now,
      version: input.version ?? null,
      hostname: input.hostname ?? null,
      username: input.username ?? null,
      capabilities_json: capabilitiesJson,
      updated_at: now,
    });
  }

  public markDeviceOffline(deviceId: string): void {
    const now = new Date().toISOString();

    this.db
      .prepare(
        "UPDATE devices SET status = 'offline', updated_at = @updated_at WHERE device_id = @device_id",
      )
      .run({ device_id: deviceId, updated_at: now });
  }

  public touchHeartbeat(deviceId: string): void {
    const now = new Date().toISOString();

    this.db
      .prepare(
        "UPDATE devices SET last_seen = @last_seen, status = 'online', updated_at = @updated_at WHERE device_id = @device_id",
      )
      .run({ device_id: deviceId, last_seen: now, updated_at: now });
  }

  public insertCommandLog(input: CommandLogInsert): void {
    const now = new Date().toISOString();

    this.db
      .prepare(`
        INSERT OR REPLACE INTO command_logs (
          id,
          request_id,
          device_id,
          source,
          raw_text,
          parsed_target,
          parsed_type,
          args_json,
          status,
          result_message,
          error_code,
          created_at,
          completed_at
        ) VALUES (
          @id,
          @request_id,
          @device_id,
          @source,
          @raw_text,
          @parsed_target,
          @parsed_type,
          @args_json,
          @status,
          @result_message,
          @error_code,
          @created_at,
          @completed_at
        )
      `)
      .run({
        id: input.id,
        request_id: input.requestId,
        device_id: input.deviceId,
        source: input.source,
        raw_text: input.rawText,
        parsed_target: input.parsedTarget,
        parsed_type: input.parsedType,
        args_json: input.argsJson,
        status: input.status,
        result_message: input.resultMessage,
        error_code: input.errorCode ?? null,
        created_at: now,
        completed_at: null,
      });
  }

  public completeCommandLog(input: {
    id: string;
    status: string;
    resultMessage: string;
    errorCode?: string;
  }): void {
    const completedAt = new Date().toISOString();

    this.db
      .prepare(
        "UPDATE command_logs SET status = @status, result_message = @result_message, error_code = @error_code, completed_at = @completed_at WHERE id = @id",
      )
      .run({
        id: input.id,
        status: input.status,
        result_message: input.resultMessage,
        error_code: input.errorCode ?? null,
        completed_at: completedAt,
      });
  }
}
