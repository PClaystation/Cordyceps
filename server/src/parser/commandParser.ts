import type { CommandType, ParseError, ParsedExternalCommand, TypedCommand } from "../types/protocol";

const MAX_NOTIFY_TEXT_LENGTH = 180;
const MAX_CLIPBOARD_TEXT_LENGTH = 1000;
const MAX_REPEAT_STEPS = 20;
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

const MEDIA_NEXT_PREFIXES = ["next track", "skip track", "next", "skip"];
const MEDIA_PREVIOUS_PREFIXES = ["previous track", "previous", "prev", "back"];
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

function parseNotify(commandPhrase: string): TypedCommand | ParseError | null {
  const normalizedPhrase = commandPhrase.trim();
  if (/^notify[,.!?;:]*$/.test(normalizedPhrase)) {
    return {
      code: "MALFORMED_ARGUMENT",
      message: "notify requires message text",
    };
  }

  const notifyMatch = normalizedPhrase.match(/^notify(?:[,.!?;:]+\s*|\s+)(.+)$/);
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

function parseCommandPhrase(commandPhrase: string): TypedCommand | ParseError {
  const normalizedPhrase = normalizeCommandPhrase(commandPhrase);

  const repeatCommand =
    parseRepeatSteps(normalizedPhrase, VOLUME_UP_PREFIXES, "VOLUME_UP") ??
    parseRepeatSteps(normalizedPhrase, VOLUME_DOWN_PREFIXES, "VOLUME_DOWN") ??
    parseRepeatSteps(normalizedPhrase, MEDIA_NEXT_PREFIXES, "MEDIA_NEXT") ??
    parseRepeatSteps(normalizedPhrase, MEDIA_PREVIOUS_PREFIXES, "MEDIA_PREVIOUS");
  if (repeatCommand) {
    return repeatCommand;
  }

  const emergencyCommand = parseEmergencyLockdown(normalizedPhrase);
  if (emergencyCommand) {
    return emergencyCommand;
  }

  const exactType = EXACT_COMMANDS[stripTrailingPunctuation(stripPoliteSuffix(normalizedPhrase))];
  if (exactType) {
    return buildNoArgCommand(exactType);
  }

  const appCommand = parseOpenApp(normalizedPhrase);
  if (appCommand) {
    return appCommand;
  }

  const notifyCommand = parseNotify(normalizedPhrase);
  if (notifyCommand) {
    return notifyCommand;
  }

  const clipboardCommand = parseClipboard(commandPhrase);
  if (clipboardCommand) {
    return clipboardCommand;
  }

  return {
    code: "UNKNOWN_COMMAND",
    message: `Unknown command: ${normalizedPhrase}`,
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
  const target = stripEdgePunctuation(parts[0] ?? "");

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
