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
  | "BRIGHTNESS_UP"
  | "BRIGHTNESS_DOWN"
  | "MUTE"
  | "KEY_F1"
  | "KEY_F2"
  | "KEY_F3"
  | "KEY_F4"
  | "KEY_F5"
  | "KEY_F6"
  | "KEY_F7"
  | "KEY_F8"
  | "KEY_F9"
  | "KEY_F10"
  | "KEY_F11"
  | "KEY_F12"
  | "KEY_ENTER"
  | "KEY_ESCAPE"
  | "KEY_TAB"
  | "KEY_SPACE"
  | "KEY_UP"
  | "KEY_DOWN"
  | "KEY_LEFT"
  | "KEY_RIGHT"
  | "KEY_BACKSPACE"
  | "KEY_DELETE"
  | "KEY_HOME"
  | "KEY_END"
  | "KEY_PAGE_UP"
  | "KEY_PAGE_DOWN"
  | "SHORTCUT_COPY"
  | "SHORTCUT_PASTE"
  | "SHORTCUT_CUT"
  | "SHORTCUT_UNDO"
  | "SHORTCUT_REDO"
  | "SHORTCUT_SELECT_ALL"
  | "SHORTCUT_ALT_TAB"
  | "SHORTCUT_ALT_F4"
  | "LOCK_PC"
  | "NOTIFY"
  | "CLIPBOARD_SET"
  | "SYSTEM_SLEEP"
  | "SYSTEM_DISPLAY_OFF"
  | "SYSTEM_SIGN_OUT"
  | "SYSTEM_SHUTDOWN"
  | "SYSTEM_RESTART"
  | "AGENT_REMOVE"
  | "EMERGENCY_LOCKDOWN"
  | "ADMIN_EXEC_CMD"
  | "ADMIN_EXEC_POWERSHELL"
  | "PROCESS_LIST"
  | "PROCESS_KILL"
  | "PROCESS_START"
  | "PROCESS_DETAILS"
  | "SERVICE_LIST"
  | "SERVICE_CONTROL"
  | "SERVICE_DETAILS"
  | "FILE_READ"
  | "FILE_WRITE"
  | "FILE_APPEND"
  | "FILE_COPY"
  | "FILE_MOVE"
  | "FILE_EXISTS"
  | "FILE_HASH"
  | "FILE_TAIL"
  | "FILE_DELETE"
  | "FILE_LIST"
  | "FILE_MKDIR"
  | "NETWORK_INFO"
  | "NETWORK_TEST"
  | "NETWORK_FLUSH_DNS"
  | "EVENT_LOG_QUERY"
  | "ENV_LIST"
  | "ENV_GET"
  | "SYSTEM_INFO"
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
  result_payload?: Record<string, unknown>;
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
  result_payload?: Record<string, unknown>;
  completed_at: string;
}

export type AgentProfile = "s" | "se" | "t" | "e" | "a" | "legacy";

export interface DeviceRecord {
  device_id: string;
  display_name: string | null;
  status: "online" | "offline";
  last_seen: string;
  version: string | null;
  hostname: string | null;
  username: string | null;
  capabilities: string[];
  profile?: AgentProfile;
  created_at: string;
  updated_at: string;
}
