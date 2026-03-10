import type { CommandType, ParseError, ParsedExternalCommand, TypedCommand } from "../types/protocol";

const MAX_NOTIFY_TEXT_LENGTH = 180;
const MAX_CLIPBOARD_TEXT_LENGTH = 1000;
const MAX_REPEAT_STEPS = 20;

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
  mute: "MUTE",
  "mute volume": "MUTE",
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
};

function normalized(text: string): string {
  return text.toLowerCase().trim().replace(/\s+/g, " ");
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
    if (!commandPhrase.startsWith(prefix)) {
      continue;
    }

    const suffix = commandPhrase.slice(prefix.length).trim();
    if (!suffix) {
      return buildNoArgCommand(type);
    }

    if (!/^\d+$/.test(suffix)) {
      return {
        code: "MALFORMED_ARGUMENT",
        message: `${prefix.trim()} supports optional numeric steps only`,
      };
    }

    const steps = Number.parseInt(suffix, 10);
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

    const rawApp = commandPhrase.slice(prefix.length).trim();
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

function parseNotify(commandPhrase: string): TypedCommand | ParseError | null {
  if (commandPhrase === "notify") {
    return {
      code: "MALFORMED_ARGUMENT",
      message: "notify requires message text",
    };
  }

  if (!commandPhrase.startsWith("notify ")) {
    return null;
  }

  const text = commandPhrase.slice(7).trim();
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

function parseClipboard(commandPhrase: string): TypedCommand | ParseError | null {
  if (commandPhrase === "clipboard" || commandPhrase === "copy") {
    return {
      code: "MALFORMED_ARGUMENT",
      message: "clipboard requires text",
    };
  }

  let text = "";
  if (commandPhrase.startsWith("clipboard ")) {
    text = commandPhrase.slice("clipboard ".length).trim();
  } else if (commandPhrase.startsWith("copy ")) {
    text = commandPhrase.slice("copy ".length).trim();
  } else {
    return null;
  }

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

function parseCommandPhrase(commandPhrase: string): TypedCommand | ParseError {
  const repeatCommand =
    parseRepeatSteps(commandPhrase, ["volume up", "vol up", "louder", "volume higher"], "VOLUME_UP") ??
    parseRepeatSteps(commandPhrase, ["volume down", "vol down", "quieter", "volume lower"], "VOLUME_DOWN") ??
    parseRepeatSteps(commandPhrase, ["next track", "skip track", "next", "skip"], "MEDIA_NEXT") ??
    parseRepeatSteps(commandPhrase, ["previous track", "previous", "prev", "back"], "MEDIA_PREVIOUS");
  if (repeatCommand) {
    return repeatCommand;
  }

  const exactType = EXACT_COMMANDS[commandPhrase];
  if (exactType) {
    return buildNoArgCommand(exactType);
  }

  const appCommand = parseOpenApp(commandPhrase);
  if (appCommand) {
    return appCommand;
  }

  const notifyCommand = parseNotify(commandPhrase);
  if (notifyCommand) {
    return notifyCommand;
  }

  const clipboardCommand = parseClipboard(commandPhrase);
  if (clipboardCommand) {
    return clipboardCommand;
  }

  return {
    code: "UNKNOWN_COMMAND",
    message: `Unknown command: ${commandPhrase}`,
  };
}

export function parseExternalCommand(text: string): ParsedExternalCommand | ParseError {
  const normalizedText = normalized(text);

  if (!normalizedText) {
    return {
      code: "EMPTY_COMMAND",
      message: "Command text is empty",
    };
  }

  const parts = normalizedText.split(" ");
  const target = parts[0] ?? "";

  if (!/^(all|[a-z][a-z0-9_-]{1,31})$/.test(target)) {
    return {
      code: "UNKNOWN_TARGET",
      message: `Unknown target: ${target}`,
    };
  }

  const commandPhrase = parts.slice(1).join(" ").trim();
  if (!commandPhrase) {
    return {
      code: "UNKNOWN_COMMAND",
      message: "Missing command after target",
    };
  }

  const parsedCommand = parseCommandPhrase(commandPhrase);
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
