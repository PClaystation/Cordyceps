import type { ParseError, ParsedExternalCommand, TypedCommand } from "../types/protocol";

const OPEN_APP_ALLOWLIST = new Set(["spotify", "discord", "chrome"]);

function normalized(text: string): string {
  return text.toLowerCase().trim().replace(/\s+/g, " ");
}

function parseCommandPhrase(commandPhrase: string): TypedCommand | ParseError {
  if (commandPhrase === "ping") {
    return { type: "PING", args: {} };
  }

  if (commandPhrase === "play") {
    return { type: "MEDIA_PLAY", args: {} };
  }

  if (commandPhrase === "pause") {
    return { type: "MEDIA_PAUSE", args: {} };
  }

  if (commandPhrase === "next") {
    return { type: "MEDIA_NEXT", args: {} };
  }

  if (commandPhrase === "previous") {
    return { type: "MEDIA_PREVIOUS", args: {} };
  }

  if (commandPhrase === "volume up") {
    return { type: "VOLUME_UP", args: {} };
  }

  if (commandPhrase === "volume down") {
    return { type: "VOLUME_DOWN", args: {} };
  }

  if (commandPhrase === "mute") {
    return { type: "MUTE", args: {} };
  }

  if (commandPhrase === "lock") {
    return { type: "LOCK_PC", args: {} };
  }

  if (commandPhrase.startsWith("open ")) {
    const app = commandPhrase.slice(5).trim();
    if (!OPEN_APP_ALLOWLIST.has(app)) {
      return {
        code: "UNKNOWN_COMMAND",
        message: `Unknown or blocked app: ${app}`,
      };
    }

    return {
      type: "OPEN_APP",
      args: { app },
    };
  }

  if (commandPhrase.startsWith("notify ")) {
    const text = commandPhrase.slice(7).trim();
    if (!text) {
      return {
        code: "MALFORMED_ARGUMENT",
        message: "notify requires message text",
      };
    }

    return {
      type: "NOTIFY",
      args: { text },
    };
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

  if (!/^(all|m[a-z0-9_-]+)$/.test(target)) {
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
