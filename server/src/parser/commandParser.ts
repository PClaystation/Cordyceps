import type { CommandType, ParseError, ParsedExternalCommand, TypedCommand } from "../types/protocol";

const MAX_NOTIFY_TEXT_LENGTH = 180;
const MAX_CLIPBOARD_TEXT_LENGTH = 1000;
const MAX_REPEAT_STEPS = 20;
const MAX_ADMIN_INPUT_LENGTH = 4000;
const MAX_ADMIN_FILE_TEXT_LENGTH = 128 * 1024;
const MAX_ADMIN_TAIL_LINES = 200;
const MAX_ADMIN_EVENT_LOG_LIMIT = 25;
const MAX_NETWORK_TEST_PORT = 65535;
const PUNCTUATION_EDGE_RE = /^[,.;:!?'"`]+|[,.;:!?'"`]+$/g;
const PUNCTUATION_LEADING_RE = /^[,.;:!?'"`]+/;
const PUNCTUATION_TRAILING_RE = /[,.;:!?'"`]+$/;
const POLITE_SUFFIX_TOKENS = new Set(["please", "pls", "now"]);

const STEP_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
};

const VOLUME_UP_PREFIXES = [
  "volume up",
  "vol up",
  "louder",
  "volume higher",
  "turn volume up",
  "turn up volume",
  "turn the volume up",
  "turn up the volume",
  "turn it up",
  "increase volume",
  "increase the volume",
  "raise volume",
  "raise the volume",
  "make it louder",
];

const VOLUME_DOWN_PREFIXES = [
  "volume down",
  "vol down",
  "quieter",
  "volume lower",
  "turn volume down",
  "turn down volume",
  "turn the volume down",
  "turn down the volume",
  "turn it down",
  "decrease volume",
  "decrease the volume",
  "lower volume",
  "lower the volume",
  "reduce volume",
  "reduce the volume",
  "make it quieter",
];
const BRIGHTNESS_UP_PREFIXES = [
  "brightness up",
  "increase brightness",
  "increase screen brightness",
  "increase display brightness",
  "raise brightness",
  "raise screen brightness",
  "raise display brightness",
  "make it brighter",
  "make screen brighter",
  "make display brighter",
];
const BRIGHTNESS_DOWN_PREFIXES = [
  "brightness down",
  "decrease brightness",
  "decrease screen brightness",
  "decrease display brightness",
  "lower brightness",
  "lower screen brightness",
  "lower display brightness",
  "dim screen",
  "dim display",
  "make it dimmer",
];

const MEDIA_NEXT_PREFIXES = ["next track", "skip track", "next", "skip"];
const MEDIA_PREVIOUS_PREFIXES = ["previous track", "previous", "prev", "back"];
const AGENT_REMOVE_BASE_PHRASES = ["remove agent", "uninstall agent", "decommission agent"];
const EMERGENCY_BASE_PHRASES = ["panic", "panic mode", "lockdown", "emergency", "emergency mode"];
const EMERGENCY_CONFIRM_SUFFIXES = ["confirm", "confirmed"];

const OPEN_APP_ALIASES: Record<string, string> = {
  spotify: "spotify",
  discord: "discord",
  chrome: "chrome",
  steam: "steam",
  explorer: "explorer",
  "file explorer": "explorer",
  vscode: "vscode",
  "vs code": "vscode",
  "visual studio code": "vscode",
  edge: "edge",
  "microsoft edge": "edge",
  firefox: "firefox",
  notepad: "notepad",
  calculator: "calculator",
  calc: "calculator",
  settings: "settings",
  slack: "slack",
  teams: "teams",
  taskmanager: "taskmanager",
  "task manager": "taskmanager",
  terminal: "terminal",
  "windows terminal": "terminal",
  powershell: "powershell",
  "power shell": "powershell",
  cmd: "cmd",
  "command prompt": "cmd",
  controlpanel: "controlpanel",
  "control panel": "controlpanel",
  paint: "paint",
  mspaint: "paint",
  snippingtool: "snippingtool",
  "snipping tool": "snippingtool",
};

const OPEN_APP_ALLOWLIST = new Set(Object.values(OPEN_APP_ALIASES));
const OPEN_PREFIXES = ["open ", "launch ", "start "];

const EXACT_COMMANDS: Record<string, CommandType> = {
  ping: "PING",
  status: "PING",
  play: "MEDIA_PLAY",
  resume: "MEDIA_PLAY",
  pause: "MEDIA_PAUSE",
  "play pause": "MEDIA_PLAY_PAUSE",
  toggle: "MEDIA_PLAY_PAUSE",
  brighter: "BRIGHTNESS_UP",
  dimmer: "BRIGHTNESS_DOWN",
  mute: "MUTE",
  "mute volume": "MUTE",
  "mute the volume": "MUTE",
  "mute audio": "MUTE",
  "mute the audio": "MUTE",
  "mute sound": "MUTE",
  "mute the sound": "MUTE",
  "volume mute": "MUTE",
  unmute: "MUTE",
  "un mute": "MUTE",
  silence: "MUTE",
  "silence audio": "MUTE",
  "silence sound": "MUTE",
  "silence volume": "MUTE",
  lock: "LOCK_PC",
  "lock pc": "LOCK_PC",
  sleep: "SYSTEM_SLEEP",
  "sleep pc": "SYSTEM_SLEEP",
  "display off": "SYSTEM_DISPLAY_OFF",
  "screen off": "SYSTEM_DISPLAY_OFF",
  "monitor off": "SYSTEM_DISPLAY_OFF",
  logout: "SYSTEM_SIGN_OUT",
  "log out": "SYSTEM_SIGN_OUT",
  "sign out": "SYSTEM_SIGN_OUT",
  shutdown: "SYSTEM_SHUTDOWN",
  "shut down": "SYSTEM_SHUTDOWN",
  "shutdown pc": "SYSTEM_SHUTDOWN",
  restart: "SYSTEM_RESTART",
  reboot: "SYSTEM_RESTART",
  "restart pc": "SYSTEM_RESTART",
  f1: "KEY_F1",
  "press f1": "KEY_F1",
  "function 1": "KEY_F1",
  f2: "KEY_F2",
  "press f2": "KEY_F2",
  "function 2": "KEY_F2",
  f3: "KEY_F3",
  "press f3": "KEY_F3",
  "function 3": "KEY_F3",
  f4: "KEY_F4",
  "press f4": "KEY_F4",
  "function 4": "KEY_F4",
  f5: "KEY_F5",
  "press f5": "KEY_F5",
  "function 5": "KEY_F5",
  f6: "KEY_F6",
  "press f6": "KEY_F6",
  "function 6": "KEY_F6",
  f7: "KEY_F7",
  "press f7": "KEY_F7",
  "function 7": "KEY_F7",
  f8: "KEY_F8",
  "press f8": "KEY_F8",
  "function 8": "KEY_F8",
  f9: "KEY_F9",
  "press f9": "KEY_F9",
  "function 9": "KEY_F9",
  f10: "KEY_F10",
  "press f10": "KEY_F10",
  "function 10": "KEY_F10",
  f11: "KEY_F11",
  "press f11": "KEY_F11",
  "function 11": "KEY_F11",
  f12: "KEY_F12",
  "press f12": "KEY_F12",
  "function 12": "KEY_F12",
  enter: "KEY_ENTER",
  "press enter": "KEY_ENTER",
  return: "KEY_ENTER",
  escape: "KEY_ESCAPE",
  esc: "KEY_ESCAPE",
  "press escape": "KEY_ESCAPE",
  "press esc": "KEY_ESCAPE",
  tab: "KEY_TAB",
  "press tab": "KEY_TAB",
  space: "KEY_SPACE",
  "press space": "KEY_SPACE",
  "space bar": "KEY_SPACE",
  up: "KEY_UP",
  "arrow up": "KEY_UP",
  "up arrow": "KEY_UP",
  down: "KEY_DOWN",
  "arrow down": "KEY_DOWN",
  "down arrow": "KEY_DOWN",
  left: "KEY_LEFT",
  "arrow left": "KEY_LEFT",
  "left arrow": "KEY_LEFT",
  right: "KEY_RIGHT",
  "arrow right": "KEY_RIGHT",
  "right arrow": "KEY_RIGHT",
  backspace: "KEY_BACKSPACE",
  "press backspace": "KEY_BACKSPACE",
  delete: "KEY_DELETE",
  del: "KEY_DELETE",
  "press delete": "KEY_DELETE",
  home: "KEY_HOME",
  "press home": "KEY_HOME",
  end: "KEY_END",
  "press end": "KEY_END",
  "page up": "KEY_PAGE_UP",
  pgup: "KEY_PAGE_UP",
  "page down": "KEY_PAGE_DOWN",
  pgdn: "KEY_PAGE_DOWN",
  "copy shortcut": "SHORTCUT_COPY",
  "ctrl c": "SHORTCUT_COPY",
  "paste shortcut": "SHORTCUT_PASTE",
  "ctrl v": "SHORTCUT_PASTE",
  "cut shortcut": "SHORTCUT_CUT",
  "ctrl x": "SHORTCUT_CUT",
  "undo shortcut": "SHORTCUT_UNDO",
  "ctrl z": "SHORTCUT_UNDO",
  "redo shortcut": "SHORTCUT_REDO",
  "ctrl y": "SHORTCUT_REDO",
  "select all shortcut": "SHORTCUT_SELECT_ALL",
  "ctrl a": "SHORTCUT_SELECT_ALL",
  "alt tab": "SHORTCUT_ALT_TAB",
  "press alt tab": "SHORTCUT_ALT_TAB",
  "alt f4": "SHORTCUT_ALT_F4",
  "press alt f4": "SHORTCUT_ALT_F4",
};

function normalized(text: string): string {
  return text.toLowerCase().trim().replace(/\s+/g, " ");
}

function stripEdgePunctuation(text: string): string {
  return text.replace(PUNCTUATION_EDGE_RE, "");
}

function stripTrailingPunctuation(text: string): string {
  return text.replace(PUNCTUATION_TRAILING_RE, "");
}

function stripLeadingPunctuation(text: string): string {
  return text.replace(PUNCTUATION_LEADING_RE, "");
}

function normalizeCommandPhrase(text: string): string {
  return stripLeadingPunctuation(text.trim()).replace(/\s+/g, " ");
}

function stripPoliteSuffix(text: string): string {
  const tokens = text
    .trim()
    .split(/\s+/)
    .filter((token) => token.length > 0);

  while (tokens.length > 0) {
    const tail = stripTrailingPunctuation(tokens[tokens.length - 1]).toLowerCase();
    if (!POLITE_SUFFIX_TOKENS.has(tail)) {
      break;
    }

    tokens.pop();
  }

  return tokens.join(" ");
}

function matchesWordPrefix(text: string, prefix: string): boolean {
  if (!text.startsWith(prefix)) {
    return false;
  }

  if (text.length === prefix.length) {
    return true;
  }

  return text.charAt(prefix.length) === " ";
}

function parseRepeatCount(value: string): number | null {
  const cleaned = stripTrailingPunctuation(value).trim();
  if (!cleaned) {
    return null;
  }

  const digitMatch = cleaned.match(/^(\d+)(?:\s*(?:x|times?|steps?))?$/);
  if (digitMatch) {
    return Number.parseInt(digitMatch[1], 10);
  }

  const wordMatch = cleaned.match(/^([a-z]+)(?:\s*(?:x|times?|steps?))?$/);
  if (wordMatch) {
    return STEP_WORDS[wordMatch[1]] ?? null;
  }

  return null;
}

function parseBrightnessAmount(value: string): number | null {
  const cleaned = stripTrailingPunctuation(value).trim();
  if (!cleaned) {
    return null;
  }

  const digitMatch = cleaned.match(/^(\d+)(?:\s*%)?$/);
  if (digitMatch) {
    return Number.parseInt(digitMatch[1], 10);
  }

  const wordMatch = cleaned.match(/^([a-z]+)$/);
  if (wordMatch) {
    return STEP_WORDS[wordMatch[1]] ?? null;
  }

  return null;
}

function buildNoArgCommand(type: CommandType): TypedCommand {
  return { type, args: {} };
}

function parseRepeatSteps(
  commandPhrase: string,
  prefixes: string[],
  type: "MEDIA_NEXT" | "MEDIA_PREVIOUS" | "VOLUME_UP" | "VOLUME_DOWN",
): TypedCommand | ParseError | null {
  for (const prefix of prefixes) {
    if (!matchesWordPrefix(commandPhrase, prefix)) {
      continue;
    }

    const suffix = stripPoliteSuffix(commandPhrase.slice(prefix.length).trim());
    if (!suffix) {
      return buildNoArgCommand(type);
    }

    const steps = parseRepeatCount(suffix);
    if (steps === null) {
      return {
        code: "MALFORMED_ARGUMENT",
        message: `${prefix.trim()} supports optional numeric steps only`,
      };
    }

    if (!Number.isFinite(steps) || steps < 1 || steps > MAX_REPEAT_STEPS) {
      return {
        code: "MALFORMED_ARGUMENT",
        message: `${prefix.trim()} steps must be between 1 and ${MAX_REPEAT_STEPS}`,
      };
    }

    return {
      type,
      args: steps > 1 ? { steps } : {},
    };
  }

  return null;
}

function parseBrightnessChange(
  commandPhrase: string,
  prefixes: string[],
  type: "BRIGHTNESS_UP" | "BRIGHTNESS_DOWN",
): TypedCommand | ParseError | null {
  for (const prefix of prefixes) {
    if (!matchesWordPrefix(commandPhrase, prefix)) {
      continue;
    }

    const suffix = stripPoliteSuffix(commandPhrase.slice(prefix.length).trim());
    if (!suffix) {
      return {
        type,
        args: { amount: 10 },
      };
    }

    const amount = parseBrightnessAmount(suffix);
    if (amount === null) {
      return {
        code: "MALFORMED_ARGUMENT",
        message: `${prefix.trim()} supports optional percentage only`,
      };
    }

    if (!Number.isFinite(amount) || amount < 1 || amount > 100) {
      return {
        code: "MALFORMED_ARGUMENT",
        message: `${prefix.trim()} amount must be between 1 and 100`,
      };
    }

    return {
      type,
      args: { amount },
    };
  }

  return null;
}

function parseOpenApp(commandPhrase: string): TypedCommand | ParseError | null {
  if (commandPhrase === "open" || commandPhrase === "launch" || commandPhrase === "start") {
    return {
      code: "MALFORMED_ARGUMENT",
      message: "open requires an app name",
    };
  }

  for (const prefix of OPEN_PREFIXES) {
    if (!commandPhrase.startsWith(prefix)) {
      continue;
    }

    const rawApp = stripPoliteSuffix(stripEdgePunctuation(commandPhrase.slice(prefix.length).trim()));
    if (!rawApp) {
      return {
        code: "MALFORMED_ARGUMENT",
        message: "open requires an app name",
      };
    }

    const app = OPEN_APP_ALIASES[rawApp] ?? rawApp;
    if (!OPEN_APP_ALLOWLIST.has(app)) {
      return {
        code: "UNKNOWN_COMMAND",
        message: `Unknown or blocked app: ${rawApp}`,
      };
    }

    return {
      type: "OPEN_APP",
      args: { app },
    };
  }

  return null;
}

function parseNotify(rawCommandPhrase: string): TypedCommand | ParseError | null {
  const trimmed = rawCommandPhrase.trim();
  if (/^notify[,.!?;:]*$/i.test(trimmed)) {
    return {
      code: "MALFORMED_ARGUMENT",
      message: "notify requires message text",
    };
  }

  const notifyMatch = trimmed.match(/^notify(?:[,.!?;:]+\s*|\s+)([\s\S]+)$/i);
  if (!notifyMatch) {
    return null;
  }

  const text = notifyMatch[1].trim();
  if (!text) {
    return {
      code: "MALFORMED_ARGUMENT",
      message: "notify requires message text",
    };
  }

  if (text.length > MAX_NOTIFY_TEXT_LENGTH) {
    return {
      code: "MALFORMED_ARGUMENT",
      message: `notify text too long (max ${MAX_NOTIFY_TEXT_LENGTH})`,
    };
  }

  return {
    type: "NOTIFY",
    args: { text },
  };
}

function parseClipboard(rawCommandPhrase: string): TypedCommand | ParseError | null {
  const trimmed = rawCommandPhrase.trim();
  if (/^(clipboard|copy)$/i.test(trimmed)) {
    return {
      code: "MALFORMED_ARGUMENT",
      message: "clipboard requires text",
    };
  }

  const clipboardMatch = trimmed.match(/^(clipboard|copy)\s+([\s\S]+)$/i);
  if (!clipboardMatch) {
    return null;
  }

  const text = clipboardMatch[2]?.trim() ?? "";
  if (!text) {
    return {
      code: "MALFORMED_ARGUMENT",
      message: "clipboard requires text",
    };
  }

  if (text.length > MAX_CLIPBOARD_TEXT_LENGTH) {
    return {
      code: "MALFORMED_ARGUMENT",
      message: `clipboard text too long (max ${MAX_CLIPBOARD_TEXT_LENGTH})`,
    };
  }

  return {
    type: "CLIPBOARD_SET",
    args: { text },
  };
}

function parseEmergencyLockdown(commandPhrase: string): TypedCommand | ParseError | null {
  const normalizedPhrase = stripTrailingPunctuation(stripPoliteSuffix(commandPhrase));
  if (!normalizedPhrase) {
    return null;
  }

  for (const phrase of EMERGENCY_BASE_PHRASES) {
    if (normalizedPhrase === phrase) {
      return {
        code: "MALFORMED_ARGUMENT",
        message: `${phrase} requires explicit confirmation (use: ${phrase} confirm)`,
      };
    }

    for (const suffix of EMERGENCY_CONFIRM_SUFFIXES) {
      if (normalizedPhrase === `${phrase} ${suffix}`) {
        return buildNoArgCommand("EMERGENCY_LOCKDOWN");
      }
    }
  }

  return null;
}

function parseAgentRemove(commandPhrase: string): TypedCommand | ParseError | null {
  const normalizedPhrase = stripTrailingPunctuation(stripPoliteSuffix(commandPhrase));
  if (!normalizedPhrase) {
    return null;
  }

  for (const phrase of AGENT_REMOVE_BASE_PHRASES) {
    if (normalizedPhrase === phrase) {
      return {
        code: "MALFORMED_ARGUMENT",
        message: `${phrase} requires explicit confirmation (use: ${phrase} confirm confirm)`,
      };
    }

    if (normalizedPhrase === `${phrase} confirm`) {
      return {
        code: "MALFORMED_ARGUMENT",
        message: `${phrase} requires a second confirmation (use: ${phrase} confirm confirm)`,
      };
    }

    if (normalizedPhrase === `${phrase} confirm confirm`) {
      return buildNoArgCommand("AGENT_REMOVE");
    }
  }

  return null;
}

function parseAdminCommand(rawCommandPhrase: string): TypedCommand | ParseError | null {
  const trimmed = rawCommandPhrase.trim();
  const adminPrefix = trimmed.match(/^admin\b/i);
  if (!adminPrefix) {
    return null;
  }

  const adminBody = trimmed.slice(adminPrefix[0].length).trim();
  if (!adminBody) {
    return {
      code: "MALFORMED_ARGUMENT",
      message: "admin command requires an action",
    };
  }

  const systemInfoMatch = adminBody.match(/^system\s+info$/i);
  if (systemInfoMatch) {
    return buildNoArgCommand("SYSTEM_INFO");
  }

  const cmdMatch = adminBody.match(/^cmd\s+(.+)$/i);
  if (cmdMatch) {
    const command = cmdMatch[1]?.trim() ?? "";
    if (!command) {
      return {
        code: "MALFORMED_ARGUMENT",
        message: "admin cmd requires command text",
      };
    }

    if (command.length > MAX_ADMIN_INPUT_LENGTH) {
      return {
        code: "MALFORMED_ARGUMENT",
        message: `admin cmd text too long (max ${MAX_ADMIN_INPUT_LENGTH})`,
      };
    }

    return {
      type: "ADMIN_EXEC_CMD",
      args: { command },
    };
  }

  const psMatch = adminBody.match(/^(?:ps|powershell)\s+(.+)$/i);
  if (psMatch) {
    const script = psMatch[1]?.trim() ?? "";
    if (!script) {
      return {
        code: "MALFORMED_ARGUMENT",
        message: "admin ps requires script text",
      };
    }

    if (script.length > MAX_ADMIN_INPUT_LENGTH) {
      return {
        code: "MALFORMED_ARGUMENT",
        message: `admin ps script too long (max ${MAX_ADMIN_INPUT_LENGTH})`,
      };
    }

    return {
      type: "ADMIN_EXEC_POWERSHELL",
      args: { script },
    };
  }

  const processListMatch = adminBody.match(/^process\s+list(?:\s+(.+))?$/i);
  if (processListMatch) {
    const filter = processListMatch[1]?.trim() ?? "";
    return {
      type: "PROCESS_LIST",
      args: filter ? { filter } : {},
    };
  }

  const processKillMatch = adminBody.match(/^process\s+kill\s+(.+)$/i);
  if (processKillMatch) {
    const target = processKillMatch[1]?.trim() ?? "";
    if (!target) {
      return {
        code: "MALFORMED_ARGUMENT",
        message: "admin process kill requires a process id or name",
      };
    }

    return {
      type: "PROCESS_KILL",
      args: { target, force: true },
    };
  }

  const processStartMatch = adminBody.match(/^process\s+start\s+(.+)$/i);
  if (processStartMatch) {
    const command = processStartMatch[1]?.trim() ?? "";
    if (!command) {
      return {
        code: "MALFORMED_ARGUMENT",
        message: "admin process start requires command text",
      };
    }

    if (command.length > MAX_ADMIN_INPUT_LENGTH) {
      return {
        code: "MALFORMED_ARGUMENT",
        message: `admin process start text too long (max ${MAX_ADMIN_INPUT_LENGTH})`,
      };
    }

    return {
      type: "PROCESS_START",
      args: { command },
    };
  }

  const processDetailsMatch = adminBody.match(/^process\s+details\s+(.+)$/i);
  if (processDetailsMatch) {
    const target = processDetailsMatch[1]?.trim() ?? "";
    if (!target) {
      return {
        code: "MALFORMED_ARGUMENT",
        message: "admin process details requires a process id or name",
      };
    }

    return {
      type: "PROCESS_DETAILS",
      args: { target },
    };
  }

  const serviceListMatch = adminBody.match(/^service\s+list(?:\s+(.+))?$/i);
  if (serviceListMatch) {
    const filter = serviceListMatch[1]?.trim() ?? "";
    return {
      type: "SERVICE_LIST",
      args: filter ? { filter } : {},
    };
  }

  const serviceControlMatch = adminBody.match(/^service\s+(start|stop|restart)\s+(.+)$/i);
  if (serviceControlMatch) {
    const action = (serviceControlMatch[1] ?? "").toLowerCase();
    const name = serviceControlMatch[2]?.trim() ?? "";
    if (!name) {
      return {
        code: "MALFORMED_ARGUMENT",
        message: "admin service requires a service name",
      };
    }

    return {
      type: "SERVICE_CONTROL",
      args: { action, name },
    };
  }

  const serviceDetailsMatch = adminBody.match(/^service\s+details\s+(.+)$/i);
  if (serviceDetailsMatch) {
    const name = serviceDetailsMatch[1]?.trim() ?? "";
    if (!name) {
      return {
        code: "MALFORMED_ARGUMENT",
        message: "admin service details requires a service name",
      };
    }

    return {
      type: "SERVICE_DETAILS",
      args: { name },
    };
  }

  const fileReadMatch = adminBody.match(/^file\s+read\s+(.+)$/i);
  if (fileReadMatch) {
    const path = fileReadMatch[1]?.trim() ?? "";
    if (!path) {
      return {
        code: "MALFORMED_ARGUMENT",
        message: "admin file read requires a path",
      };
    }

    return {
      type: "FILE_READ",
      args: { path },
    };
  }

  const fileListMatch = adminBody.match(/^file\s+list\s+(.+)$/i);
  if (fileListMatch) {
    const path = fileListMatch[1]?.trim() ?? "";
    if (!path) {
      return {
        code: "MALFORMED_ARGUMENT",
        message: "admin file list requires a path",
      };
    }

    return {
      type: "FILE_LIST",
      args: { path },
    };
  }

  const fileDeleteMatch = adminBody.match(/^file\s+delete\s+(.+)$/i);
  if (fileDeleteMatch) {
    const path = fileDeleteMatch[1]?.trim() ?? "";
    if (!path) {
      return {
        code: "MALFORMED_ARGUMENT",
        message: "admin file delete requires a path",
      };
    }

    return {
      type: "FILE_DELETE",
      args: { path },
    };
  }

  const fileMkdirMatch = adminBody.match(/^file\s+mkdir\s+(.+)$/i);
  if (fileMkdirMatch) {
    const path = fileMkdirMatch[1]?.trim() ?? "";
    if (!path) {
      return {
        code: "MALFORMED_ARGUMENT",
        message: "admin file mkdir requires a path",
      };
    }

    return {
      type: "FILE_MKDIR",
      args: { path },
    };
  }

  const fileWriteMatch = adminBody.match(/^file\s+(write|append)\s+(.+?)\s+::\s*([\s\S]+)$/i);
  if (fileWriteMatch) {
    const action = (fileWriteMatch[1] ?? "").toLowerCase();
    const path = fileWriteMatch[2]?.trim() ?? "";
    const text = fileWriteMatch[3] ?? "";

    if (!path) {
      return {
        code: "MALFORMED_ARGUMENT",
        message: "admin file write/append requires a path",
      };
    }

    if (!text) {
      return {
        code: "MALFORMED_ARGUMENT",
        message: "admin file write/append requires text after ::",
      };
    }

    if (text.length > MAX_ADMIN_FILE_TEXT_LENGTH) {
      return {
        code: "MALFORMED_ARGUMENT",
        message: `admin file text too long (max ${MAX_ADMIN_FILE_TEXT_LENGTH})`,
      };
    }

    return {
      type: action === "append" ? "FILE_APPEND" : "FILE_WRITE",
      args: { path, text },
    };
  }

  const fileCopyMoveMatch = adminBody.match(/^file\s+(copy|move)\s+(.+?)\s*->\s*(.+)$/i);
  if (fileCopyMoveMatch) {
    const action = (fileCopyMoveMatch[1] ?? "").toLowerCase();
    const source = fileCopyMoveMatch[2]?.trim() ?? "";
    const destination = fileCopyMoveMatch[3]?.trim() ?? "";
    if (!source || !destination) {
      return {
        code: "MALFORMED_ARGUMENT",
        message: "admin file copy/move requires source and destination separated by ->",
      };
    }

    return {
      type: action === "move" ? "FILE_MOVE" : "FILE_COPY",
      args: { source, destination },
    };
  }

  const fileExistsMatch = adminBody.match(/^file\s+exists\s+(.+)$/i);
  if (fileExistsMatch) {
    const path = fileExistsMatch[1]?.trim() ?? "";
    if (!path) {
      return {
        code: "MALFORMED_ARGUMENT",
        message: "admin file exists requires a path",
      };
    }

    return {
      type: "FILE_EXISTS",
      args: { path },
    };
  }

  const fileHashMatch = adminBody.match(/^file\s+hash(?:\s+(sha1|sha256|sha384|sha512|md5))?\s+(.+)$/i);
  if (fileHashMatch) {
    const algorithm = (fileHashMatch[1] ?? "sha256").toLowerCase();
    const path = fileHashMatch[2]?.trim() ?? "";
    if (!path) {
      return {
        code: "MALFORMED_ARGUMENT",
        message: "admin file hash requires a path",
      };
    }

    return {
      type: "FILE_HASH",
      args: { path, algorithm },
    };
  }

  const fileTailMatch = adminBody.match(/^file\s+tail\s+(.+?)(?:\s+(\d+))?$/i);
  if (fileTailMatch) {
    const path = fileTailMatch[1]?.trim() ?? "";
    if (!path) {
      return {
        code: "MALFORMED_ARGUMENT",
        message: "admin file tail requires a path",
      };
    }

    const rawLines = fileTailMatch[2];
    let lines: number | null = null;
    if (rawLines) {
      lines = Number.parseInt(rawLines, 10);
      if (!Number.isFinite(lines) || lines < 1 || lines > MAX_ADMIN_TAIL_LINES) {
        return {
          code: "MALFORMED_ARGUMENT",
          message: `admin file tail lines must be between 1 and ${MAX_ADMIN_TAIL_LINES}`,
        };
      }
    }

    return {
      type: "FILE_TAIL",
      args: lines ? { path, lines } : { path },
    };
  }

  const networkInfoMatch = adminBody.match(/^network\s+info$/i);
  if (networkInfoMatch) {
    return buildNoArgCommand("NETWORK_INFO");
  }

  const networkFlushMatch = adminBody.match(/^network\s+flushdns$/i);
  if (networkFlushMatch) {
    return buildNoArgCommand("NETWORK_FLUSH_DNS");
  }

  const networkTestMatch = adminBody.match(/^network\s+test\s+([^\s]+)(?:\s+(\d{1,5}))?$/i);
  if (networkTestMatch) {
    const host = networkTestMatch[1]?.trim() ?? "";
    if (!host) {
      return {
        code: "MALFORMED_ARGUMENT",
        message: "admin network test requires a host",
      };
    }

    const rawPort = networkTestMatch[2];
    let port: number | null = null;
    if (rawPort) {
      port = Number.parseInt(rawPort, 10);
      if (!Number.isFinite(port) || port < 1 || port > MAX_NETWORK_TEST_PORT) {
        return {
          code: "MALFORMED_ARGUMENT",
          message: `admin network test port must be between 1 and ${MAX_NETWORK_TEST_PORT}`,
        };
      }
    }

    return {
      type: "NETWORK_TEST",
      args: port ? { host, port } : { host },
    };
  }

  const eventLogMatch = adminBody.match(/^event\s+log\s+(.+?)(?:\s+limit\s+(\d+))?$/i);
  if (eventLogMatch) {
    const log = eventLogMatch[1]?.trim() ?? "";
    if (!log) {
      return {
        code: "MALFORMED_ARGUMENT",
        message: "admin event log requires a log name",
      };
    }

    const rawLimit = eventLogMatch[2];
    let limit: number | null = null;
    if (rawLimit) {
      limit = Number.parseInt(rawLimit, 10);
      if (!Number.isFinite(limit) || limit < 1 || limit > MAX_ADMIN_EVENT_LOG_LIMIT) {
        return {
          code: "MALFORMED_ARGUMENT",
          message: `admin event log limit must be between 1 and ${MAX_ADMIN_EVENT_LOG_LIMIT}`,
        };
      }
    }

    return {
      type: "EVENT_LOG_QUERY",
      args: limit ? { log, limit } : { log },
    };
  }

  const envListMatch = adminBody.match(/^env\s+list(?:\s+(.+))?$/i);
  if (envListMatch) {
    const prefix = envListMatch[1]?.trim() ?? "";
    return {
      type: "ENV_LIST",
      args: prefix ? { prefix } : {},
    };
  }

  const envGetMatch = adminBody.match(/^env\s+get\s+(.+)$/i);
  if (envGetMatch) {
    const key = envGetMatch[1]?.trim() ?? "";
    if (!key) {
      return {
        code: "MALFORMED_ARGUMENT",
        message: "admin env get requires a variable name",
      };
    }

    return {
      type: "ENV_GET",
      args: { key },
    };
  }

  return {
    code: "UNKNOWN_COMMAND",
    message:
      "Unknown admin command. Use: admin cmd|ps|process list|process kill|process start|process details|service list|service start|service stop|service restart|service details|file read|file list|file write <path> :: <text>|file append <path> :: <text>|file copy <source> -> <destination>|file move <source> -> <destination>|file exists|file hash [sha256|sha1|sha384|sha512|md5] <path>|file tail <path> [lines]|file delete|file mkdir|network info|network test <host> [port]|network flushdns|event log <name> [limit <n>]|env list [prefix]|env get <key>|system info",
  };
}

function parseCommandPhrase(rawCommandPhrase: string, normalizedCommandPhrase: string): TypedCommand | ParseError {
  const normalizedPhrase = normalizeCommandPhrase(normalizedCommandPhrase);

  const adminCommand = parseAdminCommand(rawCommandPhrase);
  if (adminCommand) {
    return adminCommand;
  }

  const repeatCommand =
    parseRepeatSteps(normalizedPhrase, VOLUME_UP_PREFIXES, "VOLUME_UP") ??
    parseRepeatSteps(normalizedPhrase, VOLUME_DOWN_PREFIXES, "VOLUME_DOWN") ??
    parseBrightnessChange(normalizedPhrase, BRIGHTNESS_UP_PREFIXES, "BRIGHTNESS_UP") ??
    parseBrightnessChange(normalizedPhrase, BRIGHTNESS_DOWN_PREFIXES, "BRIGHTNESS_DOWN") ??
    parseRepeatSteps(normalizedPhrase, MEDIA_NEXT_PREFIXES, "MEDIA_NEXT") ??
    parseRepeatSteps(normalizedPhrase, MEDIA_PREVIOUS_PREFIXES, "MEDIA_PREVIOUS");
  if (repeatCommand) {
    return repeatCommand;
  }

  const emergencyCommand = parseEmergencyLockdown(normalizedPhrase);
  if (emergencyCommand) {
    return emergencyCommand;
  }

  const agentRemoveCommand = parseAgentRemove(normalizedPhrase);
  if (agentRemoveCommand) {
    return agentRemoveCommand;
  }

  const exactType = EXACT_COMMANDS[stripTrailingPunctuation(stripPoliteSuffix(normalizedPhrase))];
  if (exactType) {
    return buildNoArgCommand(exactType);
  }

  const appCommand = parseOpenApp(normalizedPhrase);
  if (appCommand) {
    return appCommand;
  }

  const notifyCommand = parseNotify(rawCommandPhrase);
  if (notifyCommand) {
    return notifyCommand;
  }

  const clipboardCommand = parseClipboard(rawCommandPhrase);
  if (clipboardCommand) {
    return clipboardCommand;
  }

  return {
    code: "UNKNOWN_COMMAND",
    message: `Unknown command: ${normalizedPhrase}`,
  };
}

export function parseExternalCommand(text: string): ParsedExternalCommand | ParseError {
  const trimmedRawText = text.trim();
  const normalizedText = normalized(text);

  if (!normalizedText) {
    return {
      code: "EMPTY_COMMAND",
      message: "Command text is empty",
    };
  }

  const parts = normalizedText.split(" ");
  const target = stripEdgePunctuation(parts[0] ?? "");

  if (!/^(all|[a-z][a-z0-9_-]{1,31})$/.test(target)) {
    return {
      code: "UNKNOWN_TARGET",
      message: `Unknown target: ${target}`,
    };
  }

  const normalizedCommandPhrase = parts.slice(1).join(" ").trim();
  if (!normalizedCommandPhrase) {
    return {
      code: "UNKNOWN_COMMAND",
      message: "Missing command after target",
    };
  }

  const firstSpaceIndex = trimmedRawText.search(/\s/);
  const rawCommandPhrase = firstSpaceIndex >= 0 ? trimmedRawText.slice(firstSpaceIndex + 1).trim() : "";

  const parsedCommand = parseCommandPhrase(rawCommandPhrase, normalizedCommandPhrase);
  if ("code" in parsedCommand) {
    return parsedCommand;
  }

  return {
    rawText: text,
    normalizedText,
    target,
    command: parsedCommand,
  };
}
