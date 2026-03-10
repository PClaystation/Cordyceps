export type CommandType =
  | "PING"
  | "OPEN_APP"
  | "MEDIA_PLAY"
  | "MEDIA_PAUSE"
  | "MEDIA_PLAY_PAUSE"
  | "MEDIA_NEXT"
  | "MEDIA_PREVIOUS"
  | "VOLUME_UP"
  | "VOLUME_DOWN"
  | "MUTE"
  | "LOCK_PC"
  | "NOTIFY"
  | "CLIPBOARD_SET"
  | "SYSTEM_SLEEP"
  | "SYSTEM_DISPLAY_OFF"
  | "SYSTEM_SIGN_OUT"
  | "SYSTEM_SHUTDOWN"
  | "SYSTEM_RESTART"
  | "AGENT_UPDATE";

export interface TypedCommand {
  type: CommandType;
  args: Record<string, unknown>;
}

export interface ParsedExternalCommand {
  rawText: string;
  normalizedText: string;
  target: string;
  command: TypedCommand;
}

export interface ParseError {
  code: "EMPTY_COMMAND" | "UNKNOWN_TARGET" | "UNKNOWN_COMMAND" | "MALFORMED_ARGUMENT";
  message: string;
}

export interface ServerToAgentCommandMessage {
  kind: "command";
  request_id: string;
  device_id: string;
  type: CommandType;
  args: Record<string, unknown>;
  issued_at: string;
}

export interface AgentResultMessage {
  kind: "result";
  request_id: string;
  device_id: string;
  ok: boolean;
  message: string;
  error_code?: string;
  completed_at: string;
  version?: string;
}

export interface AgentHelloMessage {
  kind: "hello";
  device_id: string;
  token: string;
  version: string;
  hostname: string;
  username: string;
  capabilities: string[];
}

export interface AgentHeartbeatMessage {
  kind: "heartbeat";
  device_id: string;
  sent_at: string;
}

export interface CommandDispatchResult {
  request_id: string;
  device_id: string;
  ok: boolean;
  message: string;
  error_code?: string;
  completed_at: string;
}

export interface DeviceRecord {
  device_id: string;
  display_name: string | null;
  status: "online" | "offline";
  last_seen: string;
  version: string | null;
  hostname: string | null;
  username: string | null;
  created_at: string;
  updated_at: string;
}
