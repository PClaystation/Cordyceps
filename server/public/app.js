const apiBaseInput = document.getElementById("apiBaseInput");
const tokenInput = document.getElementById("tokenInput");
const saveTokenBtn = document.getElementById("saveTokenBtn");
const testTokenBtn = document.getElementById("testTokenBtn");
const loadDevicesBtn = document.getElementById("loadDevicesBtn");
const renameDeviceInput = document.getElementById("renameDeviceInput");
const renameDisplayNameInput = document.getElementById("renameDisplayNameInput");
const renameDeviceBtn = document.getElementById("renameDeviceBtn");
const aliasDeviceInput = document.getElementById("aliasDeviceInput");
const aliasKeyInput = document.getElementById("aliasKeyInput");
const aliasAppInput = document.getElementById("aliasAppInput");
const saveAliasBtn = document.getElementById("saveAliasBtn");
const deviceSummary = document.getElementById("deviceSummary");
const deviceCards = document.getElementById("deviceCards");
const deviceList = document.getElementById("deviceList");
const authHint = document.getElementById("authHint");
const connectionBadge = document.getElementById("connectionBadge");
const lastSuccessLabel = document.getElementById("lastSuccessLabel");
const targetInput = document.getElementById("targetInput");
const actionSelect = document.getElementById("actionSelect");
const actionSearchInput = document.getElementById("actionSearchInput");
const actionSearchInfo = document.getElementById("actionSearchInfo");
const argInput = document.getElementById("argInput");
const dangerZone = document.getElementById("dangerZone");
const composeBtn = document.getElementById("composeBtn");
const speakBtn = document.getElementById("speakBtn");
const sendBtn = document.getElementById("sendBtn");
const commandText = document.getElementById("commandText");
const resultBox = document.getElementById("resultBox");
const resultStatus = document.getElementById("resultStatus");
const resultRequestId = document.getElementById("resultRequestId");
const resultLatency = document.getElementById("resultLatency");
const resultMessage = document.getElementById("resultMessage");
const speechInfo = document.getElementById("speechInfo");
const updateTargetInput = document.getElementById("updateTargetInput");
const updateVersionInput = document.getElementById("updateVersionInput");
const updateUrlInput = document.getElementById("updateUrlInput");
const updateShaInput = document.getElementById("updateShaInput");
const updateSizeInput = document.getElementById("updateSizeInput");
const updateQueueOfflineInput = document.getElementById("updateQueueOfflineInput");
const pushUpdateBtn = document.getElementById("pushUpdateBtn");
const adminTargetInput = document.getElementById("adminTargetInput");
const adminShellSelect = document.getElementById("adminShellSelect");
const adminCommandInput = document.getElementById("adminCommandInput");
const sendAdminCommandBtn = document.getElementById("sendAdminCommandBtn");

const groupIdInput = document.getElementById("groupIdInput");
const groupDisplayNameInput = document.getElementById("groupDisplayNameInput");
const groupDescriptionInput = document.getElementById("groupDescriptionInput");
const groupMembersInput = document.getElementById("groupMembersInput");
const saveGroupBtn = document.getElementById("saveGroupBtn");
const deleteGroupBtn = document.getElementById("deleteGroupBtn");
const loadGroupsBtn = document.getElementById("loadGroupsBtn");
const groupCards = document.getElementById("groupCards");

const historyDeviceFilterInput = document.getElementById("historyDeviceFilterInput");
const loadHistoryBtn = document.getElementById("loadHistoryBtn");
const moreHistoryBtn = document.getElementById("moreHistoryBtn");
const historySummary = document.getElementById("historySummary");
const historyTimeline = document.getElementById("historyTimeline");

const apiKeyNameInput = document.getElementById("apiKeyNameInput");
const apiKeyScopesInput = document.getElementById("apiKeyScopesInput");
const createApiKeyBtn = document.getElementById("createApiKeyBtn");
const loadApiKeysBtn = document.getElementById("loadApiKeysBtn");
const newApiKeyBox = document.getElementById("newApiKeyBox");
const apiKeyList = document.getElementById("apiKeyList");

const TOKEN_KEY = "cordyceps_phone_api_token";
const TARGET_KEY = "cordyceps_last_target";
const API_BASE_KEY = "cordyceps_api_base_url";
const UPDATE_TARGET_KEY = "cordyceps_update_target";
const UPDATE_VERSION_KEY = "cordyceps_update_version";
const UPDATE_URL_KEY = "cordyceps_update_url";
const UPDATE_SHA_KEY = "cordyceps_update_sha";
const UPDATE_SIZE_KEY = "cordyceps_update_size";
const UPDATE_QUEUE_OFFLINE_KEY = "cordyceps_update_queue_offline";
const ADMIN_TARGET_KEY = "cordyceps_admin_target";
const ADMIN_SHELL_KEY = "cordyceps_admin_shell";
const LAST_COMMAND_SUCCESS_KEY = "cordyceps_last_command_success";
const BOOTSTRAP_COMMAND_KEY = "cordyceps_bootstrap_command";
const BOOTSTRAP_ACTION_KEY = "cordyceps_bootstrap_action";
const BOOTSTRAP_ARG_KEY = "cordyceps_bootstrap_arg";
const LAST_ACTION_KEY = "cordyceps_last_action";
const ALIAS_DEVICE_KEY = "cordyceps_alias_device";
const SHA256_HEX_RE = /^[a-f0-9]{64}$/;
const GROUP_TARGET_RE = /^group:([a-z][a-z0-9_-]{1,31})$/;

const POLL_INTERVAL_MS = 300000;
const EVENTS_RECONNECT_DELAY_MS = 4000;
const HISTORY_PAGE_SIZE = 40;
const HISTORY_MAX_RENDER = 120;
const REQUEST_TIMEOUT_MS = 25000;

const COMMAND_LIBRARY = [
  { value: "ping", label: "ping", category: "Connectivity", keywords: ["status", "health", "check"] },
  { value: "play", label: "play", category: "Media", keywords: ["resume"] },
  { value: "pause", label: "pause", category: "Media", keywords: ["stop"] },
  { value: "play pause", label: "play pause", category: "Media", keywords: ["toggle"] },
  { value: "next", label: "next", category: "Media", keywords: ["skip", "next track", "repeat"] },
  { value: "previous", label: "previous", category: "Media", keywords: ["back", "prev", "previous track", "repeat"] },
  { value: "volume up", label: "volume up", category: "Volume", keywords: ["louder", "vol up", "volume higher", "repeat"] },
  { value: "volume down", label: "volume down", category: "Volume", keywords: ["quieter", "vol down", "volume lower", "repeat"] },
  { value: "brightness up", label: "brightness up", category: "Display", keywords: ["brighter", "increase brightness", "screen brighter", "optional percent"] },
  { value: "brightness down", label: "brightness down", category: "Display", keywords: ["dimmer", "decrease brightness", "dim screen", "optional percent"] },
  { value: "mute", label: "mute", category: "Volume", keywords: ["mute volume", "silence", "unmute"] },
  { value: "f1", label: "f1", category: "Keyboard", keywords: ["press f1", "function key"] },
  { value: "f2", label: "f2", category: "Keyboard", keywords: ["press f2", "function key"] },
  { value: "f3", label: "f3", category: "Keyboard", keywords: ["press f3", "function key"] },
  { value: "f4", label: "f4", category: "Keyboard", keywords: ["press f4", "function key"] },
  { value: "f5", label: "f5", category: "Keyboard", keywords: ["press f5", "function key"] },
  { value: "f6", label: "f6", category: "Keyboard", keywords: ["press f6", "function key"] },
  { value: "f7", label: "f7", category: "Keyboard", keywords: ["press f7", "function key"] },
  { value: "f8", label: "f8", category: "Keyboard", keywords: ["press f8", "function key"] },
  { value: "f9", label: "f9", category: "Keyboard", keywords: ["press f9", "function key"] },
  { value: "f10", label: "f10", category: "Keyboard", keywords: ["press f10", "function key"] },
  { value: "f11", label: "f11", category: "Keyboard", keywords: ["press f11", "function key"] },
  { value: "f12", label: "f12", category: "Keyboard", keywords: ["press f12", "function key"] },
  { value: "enter", label: "enter", category: "Keyboard", keywords: ["return", "press enter"] },
  { value: "escape", label: "escape", category: "Keyboard", keywords: ["esc", "press escape"] },
  { value: "tab", label: "tab", category: "Keyboard", keywords: ["press tab"] },
  { value: "space", label: "space", category: "Keyboard", keywords: ["space bar", "press space"] },
  { value: "up", label: "up", category: "Keyboard", keywords: ["arrow up", "up arrow"] },
  { value: "down", label: "down", category: "Keyboard", keywords: ["arrow down", "down arrow"] },
  { value: "left", label: "left", category: "Keyboard", keywords: ["arrow left", "left arrow"] },
  { value: "right", label: "right", category: "Keyboard", keywords: ["arrow right", "right arrow"] },
  { value: "backspace", label: "backspace", category: "Keyboard", keywords: ["press backspace"] },
  { value: "delete", label: "delete", category: "Keyboard", keywords: ["del", "press delete"] },
  { value: "home", label: "home", category: "Keyboard", keywords: ["press home"] },
  { value: "end", label: "end", category: "Keyboard", keywords: ["press end"] },
  { value: "page up", label: "page up", category: "Keyboard", keywords: ["pgup"] },
  { value: "page down", label: "page down", category: "Keyboard", keywords: ["pgdn"] },
  { value: "copy shortcut", label: "copy shortcut", category: "Keyboard", keywords: ["ctrl c"] },
  { value: "paste shortcut", label: "paste shortcut", category: "Keyboard", keywords: ["ctrl v"] },
  { value: "cut shortcut", label: "cut shortcut", category: "Keyboard", keywords: ["ctrl x"] },
  { value: "undo shortcut", label: "undo shortcut", category: "Keyboard", keywords: ["ctrl z"] },
  { value: "redo shortcut", label: "redo shortcut", category: "Keyboard", keywords: ["ctrl y"] },
  { value: "select all shortcut", label: "select all shortcut", category: "Keyboard", keywords: ["ctrl a"] },
  { value: "alt tab", label: "alt tab", category: "Keyboard", keywords: ["switch app", "task switch"] },
  { value: "alt f4", label: "alt f4", category: "Keyboard", keywords: ["close window", "quit app"] },
  { value: "open spotify", label: "open spotify", category: "Apps", keywords: ["launch spotify"] },
  { value: "open discord", label: "open discord", category: "Apps", keywords: ["launch discord"] },
  { value: "open chrome", label: "open chrome", category: "Apps", keywords: ["browser"] },
  { value: "open steam", label: "open steam", category: "Apps", keywords: ["games"] },
  { value: "open explorer", label: "open explorer", category: "Apps", keywords: ["file explorer", "windows explorer", "files"] },
  { value: "open vscode", label: "open vscode", category: "Apps", keywords: ["vs code", "visual studio code", "editor", "code"] },
  { value: "open edge", label: "open edge", category: "Apps", keywords: ["microsoft edge", "browser"] },
  { value: "open firefox", label: "open firefox", category: "Apps", keywords: ["browser"] },
  { value: "open notepad", label: "open notepad", category: "Apps", keywords: ["text"] },
  { value: "open calculator", label: "open calculator", category: "Apps", keywords: ["calc"] },
  { value: "open settings", label: "open settings", category: "Apps", keywords: ["windows settings"] },
  { value: "open slack", label: "open slack", category: "Apps", keywords: ["chat"] },
  { value: "open teams", label: "open teams", category: "Apps", keywords: ["meeting", "chat"] },
  { value: "open task manager", label: "open task manager", category: "Apps", keywords: ["taskmanager", "process"] },
  { value: "open terminal", label: "open terminal", category: "Apps", keywords: ["windows terminal", "wt"] },
  { value: "open powershell", label: "open powershell", category: "Apps", keywords: ["power shell", "shell"] },
  { value: "open cmd", label: "open cmd", category: "Apps", keywords: ["command prompt"] },
  { value: "open control panel", label: "open control panel", category: "Apps", keywords: ["controlpanel"] },
  { value: "open paint", label: "open paint", category: "Apps", keywords: ["mspaint"] },
  { value: "open snipping tool", label: "open snipping tool", category: "Apps", keywords: ["snippingtool", "screenshot"] },
  { value: "lock", label: "lock", category: "Power", keywords: ["lock pc"] },
  { value: "lock pc", label: "lock pc", category: "Power", keywords: ["lock"] },
  { value: "panic confirm", label: "panic confirm", category: "Emergency", keywords: ["lockdown confirm", "emergency confirm", "isolate"] },
  { value: "display off", label: "display off", category: "Power", keywords: ["screen off", "monitor off"] },
  { value: "screen off", label: "screen off", category: "Power", keywords: ["display off", "monitor off"] },
  { value: "monitor off", label: "monitor off", category: "Power", keywords: ["display off", "screen off"] },
  { value: "sleep", label: "sleep", category: "Power", keywords: ["sleep pc"] },
  { value: "sleep pc", label: "sleep pc", category: "Power", keywords: ["sleep"] },
  { value: "sign out", label: "sign out", category: "Power", keywords: ["log out", "logout"] },
  { value: "log out", label: "log out", category: "Power", keywords: ["sign out", "logout"] },
  { value: "logout", label: "logout", category: "Power", keywords: ["sign out", "log out"] },
  { value: "shutdown", label: "shutdown", category: "Power", keywords: ["shut down", "shutdown pc"] },
  { value: "restart", label: "restart", category: "Power", keywords: ["reboot", "restart pc"] },
  { value: "notify", label: "notify (requires message)", category: "Messaging", keywords: ["alert", "notification"] },
  { value: "clipboard", label: "clipboard (requires text)", category: "Messaging", keywords: ["copy", "copy text"] },
  { value: "copy", label: "copy (requires text)", category: "Messaging", keywords: ["clipboard", "copy text"] },
];

const COMMAND_LIBRARY_INDEX = COMMAND_LIBRARY.map((entry) => {
  const value = entry.value.trim().toLowerCase();
  return {
    value,
    label: entry.label,
    category: entry.category,
    searchText: `${value} ${entry.label} ${entry.category} ${entry.keywords.join(" ")}`.toLowerCase(),
  };
});

const KNOWN_ACTION_VALUES = new Set(COMMAND_LIBRARY_INDEX.map((entry) => entry.value));
const ACTION_VALUE_ALIASES = new Map([
  ["status", "ping"],
  ["resume", "play"],
  ["toggle", "play pause"],
  ["next track", "next"],
  ["skip", "next"],
  ["skip track", "next"],
  ["previous track", "previous"],
  ["prev", "previous"],
  ["back", "previous"],
  ["vol up", "volume up"],
  ["louder", "volume up"],
  ["volume higher", "volume up"],
  ["vol down", "volume down"],
  ["quieter", "volume down"],
  ["volume lower", "volume down"],
  ["brighter", "brightness up"],
  ["increase brightness", "brightness up"],
  ["raise brightness", "brightness up"],
  ["dimmer", "brightness down"],
  ["decrease brightness", "brightness down"],
  ["lower brightness", "brightness down"],
  ["dim screen", "brightness down"],
  ["mute volume", "mute"],
  ["press f1", "f1"],
  ["press f2", "f2"],
  ["press f3", "f3"],
  ["press f4", "f4"],
  ["press f5", "f5"],
  ["press f6", "f6"],
  ["press f7", "f7"],
  ["press f8", "f8"],
  ["press f9", "f9"],
  ["press f10", "f10"],
  ["press f11", "f11"],
  ["press f12", "f12"],
  ["return", "enter"],
  ["press enter", "enter"],
  ["esc", "escape"],
  ["press escape", "escape"],
  ["press esc", "escape"],
  ["press tab", "tab"],
  ["space bar", "space"],
  ["press space", "space"],
  ["arrow up", "up"],
  ["up arrow", "up"],
  ["arrow down", "down"],
  ["down arrow", "down"],
  ["arrow left", "left"],
  ["left arrow", "left"],
  ["arrow right", "right"],
  ["right arrow", "right"],
  ["press backspace", "backspace"],
  ["del", "delete"],
  ["press delete", "delete"],
  ["press home", "home"],
  ["press end", "end"],
  ["pgup", "page up"],
  ["pgdn", "page down"],
  ["ctrl c", "copy shortcut"],
  ["ctrl v", "paste shortcut"],
  ["ctrl x", "cut shortcut"],
  ["ctrl z", "undo shortcut"],
  ["ctrl y", "redo shortcut"],
  ["ctrl a", "select all shortcut"],
  ["switch app", "alt tab"],
  ["task switch", "alt tab"],
  ["close window", "alt f4"],
  ["quit app", "alt f4"],
  ["open file explorer", "open explorer"],
  ["open vs code", "open vscode"],
  ["open visual studio code", "open vscode"],
  ["open microsoft edge", "open edge"],
  ["open calc", "open calculator"],
  ["open taskmanager", "open task manager"],
  ["open windows terminal", "open terminal"],
  ["open power shell", "open powershell"],
  ["open command prompt", "open cmd"],
  ["open mspaint", "open paint"],
  ["lock pc", "lock"],
  ["panic confirmed", "panic confirm"],
  ["panic mode confirm", "panic confirm"],
  ["lockdown confirm", "panic confirm"],
  ["emergency confirm", "panic confirm"],
  ["emergency mode confirm", "panic confirm"],
  ["sleep pc", "sleep"],
  ["shut down", "shutdown"],
  ["shutdown pc", "shutdown"],
  ["reboot", "restart"],
  ["restart pc", "restart"],
]);

const REPEATABLE_ACTIONS = new Set(["volume up", "volume down", "brightness up", "brightness down", "next", "previous"]);
const DANGEROUS_ACTIONS = new Set([
  "shutdown",
  "shut down",
  "shutdown pc",
  "restart",
  "reboot",
  "restart pc",
  "sleep",
  "sleep pc",
  "sign out",
  "log out",
  "logout",
  "panic confirm",
]);

const ACTION_REQUIRED_CAPABILITY = new Map([
  ["play", "media_control"],
  ["pause", "media_control"],
  ["play pause", "media_control"],
  ["next", "media_control"],
  ["previous", "media_control"],
  ["volume up", "media_control"],
  ["volume down", "media_control"],
  ["mute", "media_control"],
  ["brightness up", "display_control"],
  ["brightness down", "display_control"],
  ["f1", "keyboard_control"],
  ["f2", "keyboard_control"],
  ["f3", "keyboard_control"],
  ["f4", "keyboard_control"],
  ["f5", "keyboard_control"],
  ["f6", "keyboard_control"],
  ["f7", "keyboard_control"],
  ["f8", "keyboard_control"],
  ["f9", "keyboard_control"],
  ["f10", "keyboard_control"],
  ["f11", "keyboard_control"],
  ["f12", "keyboard_control"],
  ["enter", "advanced_keyboard_control"],
  ["escape", "advanced_keyboard_control"],
  ["tab", "advanced_keyboard_control"],
  ["space", "advanced_keyboard_control"],
  ["up", "advanced_keyboard_control"],
  ["down", "advanced_keyboard_control"],
  ["left", "advanced_keyboard_control"],
  ["right", "advanced_keyboard_control"],
  ["backspace", "advanced_keyboard_control"],
  ["delete", "advanced_keyboard_control"],
  ["home", "advanced_keyboard_control"],
  ["end", "advanced_keyboard_control"],
  ["page up", "advanced_keyboard_control"],
  ["page down", "advanced_keyboard_control"],
  ["copy shortcut", "advanced_keyboard_control"],
  ["paste shortcut", "advanced_keyboard_control"],
  ["cut shortcut", "advanced_keyboard_control"],
  ["undo shortcut", "advanced_keyboard_control"],
  ["redo shortcut", "advanced_keyboard_control"],
  ["select all shortcut", "advanced_keyboard_control"],
  ["alt tab", "advanced_keyboard_control"],
  ["alt f4", "advanced_keyboard_control"],
  ["open spotify", "open_app"],
  ["open discord", "open_app"],
  ["open chrome", "open_app"],
  ["open steam", "open_app"],
  ["open explorer", "open_app"],
  ["open vscode", "open_app"],
  ["open edge", "open_app"],
  ["open firefox", "open_app"],
  ["open notepad", "open_app"],
  ["open calculator", "open_app"],
  ["open settings", "open_app"],
  ["open slack", "open_app"],
  ["open teams", "open_app"],
  ["open task manager", "open_app"],
  ["open terminal", "open_app"],
  ["open powershell", "open_app"],
  ["open cmd", "open_app"],
  ["open control panel", "open_app"],
  ["open paint", "open_app"],
  ["open snipping tool", "open_app"],
  ["lock", "locking"],
  ["lock pc", "locking"],
  ["notify", "notifications"],
  ["clipboard", "clipboard_control"],
  ["copy", "clipboard_control"],
  ["display off", "display_control"],
  ["screen off", "display_control"],
  ["monitor off", "display_control"],
  ["sleep", "power_control"],
  ["sleep pc", "power_control"],
  ["shutdown", "power_control"],
  ["restart", "power_control"],
  ["sign out", "session_control"],
  ["log out", "session_control"],
  ["logout", "session_control"],
  ["panic confirm", "emergency_lockdown"],
]);

let pollTimer = null;
let eventSource = null;
let eventsReconnectTimer = null;
let eventDrivenDeviceRefreshTimer = null;

let knownDevices = [];
let devicesById = new Map();
let knownGroups = [];
let groupsById = new Map();
let commandHistoryEntries = [];
let commandHistoryNextBefore = null;
let apiKeys = [];

class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

function nowRequestId(prefix = "web") {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function normalizeBase(input) {
  const value = (input || "").trim();
  if (!value) {
    return "";
  }

  const wsMapped = value.replace(/^wss?:\/\//i, (scheme) => (scheme.toLowerCase() === "wss://" ? "https://" : "http://"));
  const hasScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(wsMapped);
  const candidate = hasScheme ? wsMapped : `${window.location.protocol === "https:" ? "https://" : "http://"}${wsMapped}`;

  try {
    const url = new URL(candidate);
    return `${url.protocol}//${url.host}`;
  } catch {
    return wsMapped.replace(/\/+$/, "");
  }
}

function coerceApiBaseForContext(input) {
  const normalized = normalizeBase(input);
  if (!normalized) {
    return "";
  }

  try {
    const url = new URL(normalized);

    if (window.location.protocol === "https:" && url.protocol === "http:") {
      url.protocol = "https:";
      if (url.port === "80" || url.port === "8080") {
        url.port = "";
      }
    }

    return `${url.protocol}//${url.host}`;
  } catch {
    return normalized;
  }
}

function defaultApiBase() {
  if (window.location.hostname.endsWith("github.io")) {
    return "https://mpmc.ddns.net";
  }

  return window.location.origin;
}

function getApiBase() {
  const stored = localStorage.getItem(API_BASE_KEY);
  let resolved;

  if (stored) {
    resolved = coerceApiBaseForContext(stored);
    if (resolved && resolved !== stored) {
      localStorage.setItem(API_BASE_KEY, resolved);
    }
    return resolved;
  }

  resolved = coerceApiBaseForContext(defaultApiBase());
  if (resolved) {
    localStorage.setItem(API_BASE_KEY, resolved);
  }
  return resolved;
}

function setApiBase(value) {
  const normalized = coerceApiBaseForContext(value);
  if (!normalized) {
    localStorage.removeItem(API_BASE_KEY);
    return;
  }

  localStorage.setItem(API_BASE_KEY, normalized);
}

function apiUrl(path) {
  const base = coerceApiBaseForContext(apiBaseInput.value || getApiBase());
  if (!base) {
    return path;
  }

  return `${base}${path}`;
}

function getToken() {
  return localStorage.getItem(TOKEN_KEY) || "";
}

function setToken(token) {
  localStorage.setItem(TOKEN_KEY, token);
}

function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

function normalizeActionText(text) {
  return (text || "")
    .toString()
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

function canonicalActionValue(action) {
  const normalized = normalizeActionText(action);
  return ACTION_VALUE_ALIASES.get(normalized) || normalized;
}

function parseGroupTarget(value) {
  const match = normalizeActionText(value).match(GROUP_TARGET_RE);
  return match ? match[1] : "";
}

function toLocalTimestamp(isoTime) {
  if (!isoTime) {
    return "never";
  }

  const date = new Date(isoTime);
  if (Number.isNaN(date.getTime())) {
    return "never";
  }

  return date.toLocaleString();
}

function setLastCommandSuccess(isoTime) {
  const value = isoTime || new Date().toISOString();
  localStorage.setItem(LAST_COMMAND_SUCCESS_KEY, value);
  lastSuccessLabel.textContent = `Last success: ${toLocalTimestamp(value)}`;
}

function loadLastCommandSuccess() {
  const value = localStorage.getItem(LAST_COMMAND_SUCCESS_KEY);
  lastSuccessLabel.textContent = `Last success: ${toLocalTimestamp(value)}`;
}

function setConnectionStatus(status) {
  connectionBadge.classList.remove("connected", "disconnected", "retrying");

  if (status === "connected") {
    connectionBadge.textContent = "Connected";
    connectionBadge.classList.add("connected");
    return;
  }

  if (status === "retrying") {
    connectionBadge.textContent = "Retrying";
    connectionBadge.classList.add("retrying");
    return;
  }

  connectionBadge.textContent = "Disconnected";
  connectionBadge.classList.add("disconnected");
}

function setAuthHint(text, isError = false) {
  authHint.textContent = text || "";
  authHint.style.color = isError ? "#ffb4b8" : "";
}

function setResult(payload, context = {}) {
  const isError = context.isError === true;
  let message = typeof payload === "string" ? payload : "";
  let requestId = context.requestId || "-";
  let statusLabel = isError ? "error" : "ok";
  let latencyLabel = context.latencyMs != null ? `${Math.round(context.latencyMs)} ms` : "-";

  if (typeof payload === "object" && payload) {
    if (payload.ok === false) {
      statusLabel = "error";
    }
    if (payload.ok === true && !isError) {
      statusLabel = "ok";
    }

    if (!message) {
      message = payload.message || payload.error || payload.raw || JSON.stringify(payload);
    }

    if (!context.requestId) {
      requestId = payload.request_id || payload.requestId || "-";
    }
  }

  if (!message) {
    message = isError ? "Request failed." : "Done.";
  }

  resultStatus.textContent = statusLabel;
  resultStatus.className = `result-val ${statusLabel === "error" ? "error" : "ok"}`;
  resultRequestId.textContent = requestId;
  resultLatency.textContent = latencyLabel;
  resultMessage.textContent = message;
  resultBox.textContent = typeof payload === "string" ? payload : JSON.stringify(payload, null, 2);
}

function parseApiErrorMessage(status, dataMessage) {
  if (status === 401 || status === 403) {
    return "Authentication failed or insufficient scope. Check your API key/token.";
  }
  if (status === 404) {
    return "API endpoint not found. Verify API base URL.";
  }
  return dataMessage || `HTTP ${status}`;
}

async function apiRequest(path, payload, options = {}) {
  const token = getToken();
  if (!token) {
    setConnectionStatus("disconnected");
    throw new Error("Set your API token first.");
  }

  const endpoint = apiUrl(path);
  if (window.location.protocol === "https:" && endpoint.startsWith("http://")) {
    setConnectionStatus("disconnected");
    throw new Error("Mixed content blocked. Set API base URL to an HTTPS endpoint.");
  }

  const method = options.method || "POST";
  const start = performance.now();
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(endpoint, {
      method,
      headers: {
        ...(payload ? { "Content-Type": "application/json" } : {}),
        Authorization: `Bearer ${token}`,
      },
      ...(payload ? { body: JSON.stringify(payload) } : {}),
      signal: controller.signal,
    });
  } catch (error) {
    if (error && typeof error === "object" && error.name === "AbortError") {
      setConnectionStatus("retrying");
      throw new Error("Request timed out. Check server connectivity.");
    }

    setConnectionStatus("retrying");
    throw new Error("Cannot reach server. Connection is retrying.");
  } finally {
    window.clearTimeout(timeoutId);
  }

  const latencyMs = performance.now() - start;
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : { raw: text };
  } catch {
    data = { raw: text };
  }

  if (!response.ok) {
    const message = parseApiErrorMessage(response.status, data && data.message);
    if (response.status === 401 || response.status === 403) {
      setConnectionStatus("disconnected");
    } else if (response.status >= 500) {
      setConnectionStatus("retrying");
    } else {
      setConnectionStatus("connected");
    }
    throw new ApiError(message, response.status);
  }

  setConnectionStatus("connected");
  return { data, latencyMs };
}

function filterCommandLibrary(query) {
  const normalizedQuery = normalizeActionText(query);
  if (!normalizedQuery) {
    return COMMAND_LIBRARY_INDEX;
  }

  const terms = normalizedQuery.split(" ");
  return COMMAND_LIBRARY_INDEX.filter((entry) => terms.every((term) => entry.searchText.includes(term)));
}

function requiredCapabilityForAction(actionValue) {
  return ACTION_REQUIRED_CAPABILITY.get(canonicalActionValue(actionValue)) || null;
}

function selectedTargetCapabilities() {
  const target = normalizeActionText(targetInput.value);
  if (!target || target === "all") {
    return null;
  }

  const groupId = parseGroupTarget(target);
  if (groupId) {
    const group = groupsById.get(groupId);
    if (!group || !Array.isArray(group.device_ids) || group.device_ids.length === 0) {
      return null;
    }

    const sets = group.device_ids
      .map((deviceId) => devicesById.get(normalizeActionText(deviceId)))
      .filter(Boolean)
      .map((device) => new Set(Array.isArray(device.capabilities) ? device.capabilities : []));

    if (sets.length === 0) {
      return null;
    }

    const intersection = new Set(sets[0]);
    for (let index = 1; index < sets.length; index += 1) {
      for (const capability of intersection) {
        if (!sets[index].has(capability)) {
          intersection.delete(capability);
        }
      }
    }

    return intersection;
  }

  const device = devicesById.get(target);
  if (!device) {
    return null;
  }

  return new Set(Array.isArray(device.capabilities) ? device.capabilities : []);
}

function actionSupportedOnTarget(actionValue) {
  const requiredCapability = requiredCapabilityForAction(actionValue);
  if (!requiredCapability) {
    return true;
  }

  const caps = selectedTargetCapabilities();
  if (!caps) {
    return true;
  }

  return caps.has(requiredCapability);
}

function refreshActionAvailability() {
  const options = actionSelect.querySelectorAll("option");
  let hasSelectedEnabled = false;

  for (const option of options) {
    if (!option.dataset.baseLabel) {
      option.dataset.baseLabel = option.textContent;
    }

    const supported = actionSupportedOnTarget(option.value);
    option.disabled = !supported;
    option.textContent = supported
      ? option.dataset.baseLabel
      : `${option.dataset.baseLabel.replace(/ \(unsupported\)$/, "")} (unsupported)`;

    if (option.value === actionSelect.value && !option.disabled) {
      hasSelectedEnabled = true;
    }
  }

  if (!hasSelectedEnabled) {
    const firstEnabled = [...options].find((item) => !item.disabled);
    if (firstEnabled) {
      actionSelect.value = firstEnabled.value;
      localStorage.setItem(LAST_ACTION_KEY, normalizeActionText(firstEnabled.value));
    }
  }

  updateDangerZone();
  commandText.value = composeCommand();
}

function renderActionOptions(query = "") {
  const normalizedQuery = normalizeActionText(query);
  const currentValue = normalizeActionText(actionSelect.value);
  const filteredEntries = filterCommandLibrary(normalizedQuery);

  if (filteredEntries.length === 0) {
    if (actionSearchInfo) {
      actionSearchInfo.textContent = `No matches for "${normalizedQuery}".`;
    }
    return;
  }

  actionSelect.innerHTML = "";
  const groups = new Map();

  for (const entry of filteredEntries) {
    let group = groups.get(entry.category);
    if (!group) {
      group = document.createElement("optgroup");
      group.label = entry.category;
      groups.set(entry.category, group);
      actionSelect.appendChild(group);
    }

    const option = document.createElement("option");
    option.value = entry.value;
    option.textContent = entry.label;
    option.dataset.baseLabel = entry.label;
    group.appendChild(option);
  }

  const hasCurrent = filteredEntries.some((entry) => entry.value === currentValue);
  const fallback = filteredEntries.find((entry) => entry.value === "ping") ?? filteredEntries[0];
  actionSelect.value = hasCurrent ? currentValue : fallback.value;

  if (actionSearchInfo) {
    if (normalizedQuery) {
      actionSearchInfo.textContent = `Showing ${filteredEntries.length} of ${COMMAND_LIBRARY_INDEX.length} commands.`;
    } else {
      actionSearchInfo.textContent = `Showing all ${COMMAND_LIBRARY_INDEX.length} commands.`;
    }
  }

  refreshActionAvailability();
}

function setSelectedAction(action) {
  const normalized = normalizeActionText(action);
  const canonical = ACTION_VALUE_ALIASES.get(normalized) || normalized;
  if (!canonical || !KNOWN_ACTION_VALUES.has(canonical)) {
    return false;
  }

  actionSelect.value = canonical;
  localStorage.setItem(LAST_ACTION_KEY, canonical);
  refreshActionAvailability();
  return true;
}

function composeCommand() {
  const target = normalizeActionText(targetInput.value);
  const action = normalizeActionText(actionSelect.value);
  const arg = (argInput.value || "").trim();

  if (!target || !action) {
    return "";
  }

  if (action === "notify") {
    return arg ? `${target} notify ${arg}` : `${target} notify hello`;
  }

  if (action === "clipboard" || action === "copy") {
    return arg ? `${target} ${action} ${arg}` : `${target} ${action} copied from jarvis`;
  }

  if (arg && REPEATABLE_ACTIONS.has(action)) {
    return `${target} ${action} ${arg}`;
  }

  return `${target} ${action}`;
}

function normalizeAdminShell(value) {
  return normalizeActionText(value) === "powershell" ? "powershell" : "cmd";
}

function persistAdminSettings() {
  if (!adminTargetInput || !adminShellSelect) {
    return;
  }

  localStorage.setItem(ADMIN_TARGET_KEY, normalizeActionText(adminTargetInput.value));
  localStorage.setItem(ADMIN_SHELL_KEY, normalizeAdminShell(adminShellSelect.value));
}

function updateDangerZone() {
  const action = normalizeActionText(actionSelect.value);
  const isGroup = Boolean(parseGroupTarget(targetInput.value));
  const bulkGuarded = isGroup && action !== "ping";
  dangerZone.classList.toggle("hidden", !DANGEROUS_ACTIONS.has(action) && !bulkGuarded);
}

function setTarget(deviceId) {
  targetInput.value = deviceId;
  localStorage.setItem(TARGET_KEY, deviceId);
  commandText.value = composeCommand();
  if (updateTargetInput) {
    updateTargetInput.value = deviceId;
    localStorage.setItem(UPDATE_TARGET_KEY, deviceId);
  }
  if (renameDeviceInput) {
    renameDeviceInput.value = deviceId;
  }
  if (aliasDeviceInput && !parseGroupTarget(deviceId) && deviceId !== "all") {
    aliasDeviceInput.value = deviceId;
    localStorage.setItem(ALIAS_DEVICE_KEY, deviceId);
  }
  refreshActionAvailability();
}

function renderCapabilityChips(capabilities) {
  const wrap = document.createElement("div");
  wrap.className = "chip-list";

  if (!Array.isArray(capabilities) || capabilities.length === 0) {
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.textContent = "no capabilities";
    wrap.appendChild(chip);
    return wrap;
  }

  for (const capability of capabilities.slice(0, 6)) {
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.textContent = capability;
    wrap.appendChild(chip);
  }

  if (capabilities.length > 6) {
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.textContent = `+${capabilities.length - 6} more`;
    wrap.appendChild(chip);
  }

  return wrap;
}

function renderDeviceCards(devices) {
  knownDevices = Array.isArray(devices) ? devices : [];
  devicesById = new Map(knownDevices.map((device) => [normalizeActionText(device.device_id), device]));

  deviceCards.innerHTML = "";
  deviceList.innerHTML = "";

  if (knownDevices.length === 0) {
    deviceSummary.textContent = "No enrolled devices";
    refreshActionAvailability();
    return;
  }

  const online = knownDevices.filter((d) => (d.status || "").toLowerCase() === "online").length;
  deviceSummary.textContent = `${online}/${knownDevices.length} online`;

  for (const device of knownDevices) {
    const deviceId = String(device.device_id || "").trim();
    const displayName = String(device.display_name || "").trim();
    const status = String(device.status || "unknown").trim().toLowerCase();

    const card = document.createElement("article");
    card.className = "device-card";
    const heading = document.createElement("h3");
    heading.textContent = displayName || deviceId || "unknown-device";

    const meta = document.createElement("div");
    meta.className = "meta";

    const statusPill = document.createElement("span");
    statusPill.className = `device-status ${status === "online" ? "online" : "offline"}`;
    statusPill.textContent = status;

    const seen = document.createElement("span");
    seen.textContent = device.last_seen ? toLocalTimestamp(device.last_seen) : "no heartbeat";

    meta.appendChild(statusPill);
    meta.appendChild(seen);
    card.appendChild(heading);

    if (displayName && displayName.toLowerCase() !== deviceId.toLowerCase()) {
      const identity = document.createElement("p");
      identity.className = "muted";
      identity.textContent = deviceId;
      card.appendChild(identity);
    }

    card.appendChild(meta);
    card.appendChild(renderCapabilityChips(device.capabilities));

    const useButton = document.createElement("button");
    useButton.type = "button";
    useButton.textContent = "Use Device";
    useButton.addEventListener("click", () => {
      if (!deviceId) {
        return;
      }
      setTarget(deviceId.toLowerCase());
      setResult(`Target set to ${deviceId}.`);
    });
    card.appendChild(useButton);
    deviceCards.appendChild(card);

    const li = document.createElement("li");
    li.textContent = `${displayName || deviceId} - ${status}`;
    deviceList.appendChild(li);
  }

  refreshActionAvailability();
}

function renderGroupCards(groups) {
  knownGroups = Array.isArray(groups) ? groups : [];
  groupsById = new Map(knownGroups.map((group) => [normalizeActionText(group.group_id), group]));

  if (!groupCards) {
    return;
  }

  groupCards.innerHTML = "";

  if (knownGroups.length === 0) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "No groups yet.";
    groupCards.appendChild(empty);
    refreshActionAvailability();
    return;
  }

  for (const group of knownGroups) {
    const card = document.createElement("article");
    card.className = "device-card";

    const title = document.createElement("h3");
    title.textContent = `${group.display_name || group.group_id}`;
    card.appendChild(title);

    const subtitle = document.createElement("p");
    subtitle.className = "muted";
    subtitle.textContent = `${group.group_id} • ${Array.isArray(group.device_ids) ? group.device_ids.length : 0} members`;
    card.appendChild(subtitle);

    if (group.description) {
      const desc = document.createElement("p");
      desc.className = "muted";
      desc.textContent = group.description;
      card.appendChild(desc);
    }

    const meta = document.createElement("div");
    meta.className = "meta";
    const online = document.createElement("span");
    online.textContent = `${group.online_count || 0} online`;
    meta.appendChild(online);
    card.appendChild(meta);

    const useButton = document.createElement("button");
    useButton.type = "button";
    useButton.textContent = "Target Group";
    useButton.addEventListener("click", () => {
      setTarget(`group:${group.group_id}`);
      setResult(`Target set to group:${group.group_id}.`);
    });
    card.appendChild(useButton);

    const editButton = document.createElement("button");
    editButton.type = "button";
    editButton.textContent = "Edit";
    editButton.addEventListener("click", () => {
      groupIdInput.value = group.group_id || "";
      groupDisplayNameInput.value = group.display_name || "";
      groupDescriptionInput.value = group.description || "";
      groupMembersInput.value = Array.isArray(group.device_ids) ? group.device_ids.join(",") : "";
    });
    card.appendChild(editButton);

    groupCards.appendChild(card);
  }

  refreshActionAvailability();
}

function renderHistoryEntries() {
  if (!historyTimeline) {
    return;
  }

  historyTimeline.innerHTML = "";

  if (!Array.isArray(commandHistoryEntries) || commandHistoryEntries.length === 0) {
    historySummary.textContent = "No history loaded.";
    return;
  }

  historySummary.textContent = `Showing ${commandHistoryEntries.length} latest command logs.`;

  for (const entry of commandHistoryEntries.slice(0, HISTORY_MAX_RENDER)) {
    const article = document.createElement("article");
    article.className = `history-item ${entry.status || "unknown"}`;

    const top = document.createElement("div");
    top.className = "history-top";

    const title = document.createElement("strong");
    title.textContent = `${entry.device_id} • ${entry.parsed_type}`;

    const badge = document.createElement("span");
    badge.className = `device-status ${entry.status === "ok" ? "online" : "offline"}`;
    badge.textContent = entry.status || "unknown";

    top.appendChild(title);
    top.appendChild(badge);

    const meta = document.createElement("div");
    meta.className = "history-meta";
    meta.innerHTML = `<span>${toLocalTimestamp(entry.created_at)}</span><span>${entry.request_id}</span><span>${entry.parsed_target}</span>`;

    const message = document.createElement("div");
    message.className = "history-message";
    message.textContent = entry.result_message || entry.raw_text || "(no message)";

    article.appendChild(top);
    article.appendChild(meta);
    article.appendChild(message);
    historyTimeline.appendChild(article);
  }
}

function upsertHistoryEntry(entry) {
  if (!entry || !entry.request_id || !entry.device_id) {
    return;
  }

  const id = entry.id || `${entry.request_id}:${entry.device_id}`;
  const existingIndex = commandHistoryEntries.findIndex((item) => (item.id || `${item.request_id}:${item.device_id}`) === id);
  if (existingIndex >= 0) {
    commandHistoryEntries[existingIndex] = { ...commandHistoryEntries[existingIndex], ...entry };
  } else {
    commandHistoryEntries.unshift(entry);
  }

  if (commandHistoryEntries.length > HISTORY_MAX_RENDER) {
    commandHistoryEntries = commandHistoryEntries.slice(0, HISTORY_MAX_RENDER);
  }

  renderHistoryEntries();
}

function renderApiKeys(keys) {
  apiKeys = Array.isArray(keys) ? keys : [];
  if (!apiKeyList) {
    return;
  }

  apiKeyList.innerHTML = "";

  if (apiKeys.length === 0) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "No API keys available.";
    apiKeyList.appendChild(empty);
    return;
  }

  for (const key of apiKeys) {
    const article = document.createElement("article");
    article.className = "history-item";

    const top = document.createElement("div");
    top.className = "history-top";

    const title = document.createElement("strong");
    title.textContent = key.name || key.key_id;

    const status = document.createElement("span");
    status.className = `device-status ${key.status === "active" ? "online" : "offline"}`;
    status.textContent = key.status;

    top.appendChild(title);
    top.appendChild(status);

    const meta = document.createElement("div");
    meta.className = "history-meta";
    meta.textContent = `${key.key_id} • ${Array.isArray(key.scopes) ? key.scopes.join(", ") : ""}`;

    const footer = document.createElement("div");
    footer.className = "history-meta";
    footer.textContent = `Created ${toLocalTimestamp(key.created_at)}${key.last_used_at ? ` • Last used ${toLocalTimestamp(key.last_used_at)}` : ""}`;

    article.appendChild(top);
    article.appendChild(meta);
    article.appendChild(footer);

    if (key.status === "active") {
      const revoke = document.createElement("button");
      revoke.type = "button";
      revoke.textContent = "Revoke";
      revoke.addEventListener("click", async () => {
        try {
          await apiRequest(`/api/auth/keys/${encodeURIComponent(key.key_id)}/revoke`, {}, { method: "POST" });
          await loadApiKeys({ silent: true });
          setResult(`Revoked ${key.key_id}.`);
        } catch (error) {
          setResult(error instanceof Error ? error.message : String(error), { isError: true });
        }
      });
      article.appendChild(revoke);
    }

    apiKeyList.appendChild(article);
  }
}

function extractGroupCommandText(rawText, target) {
  const trimmed = (rawText || "").trim();
  if (!trimmed) {
    return "";
  }

  const normalizedTarget = normalizeActionText(target);
  const normalized = normalizeActionText(trimmed);

  if (normalized.startsWith(`${normalizedTarget} `)) {
    const firstSpace = trimmed.indexOf(" ");
    if (firstSpace > -1) {
      return trimmed.slice(firstSpace + 1).trim();
    }
  }

  return trimmed;
}

async function renameDevice() {
  if (!renameDeviceInput || !renameDisplayNameInput) {
    throw new Error("Rename controls are not available in this app build.");
  }

  const deviceId = normalizeActionText(renameDeviceInput.value);
  const displayName = (renameDisplayNameInput.value || "").trim();
  if (!deviceId) {
    throw new Error("Device ID is required.");
  }

  const { data, latencyMs } = await apiRequest(`/api/devices/${encodeURIComponent(deviceId)}/display-name`, {
    display_name: displayName,
  });
  await loadDevices({ silent: true });
  setResult(data, { requestId: deviceId, latencyMs });
}

async function saveDeviceAlias() {
  if (!aliasDeviceInput || !aliasKeyInput || !aliasAppInput) {
    throw new Error("Alias controls are not available in this app build.");
  }

  const deviceId = normalizeActionText(aliasDeviceInput.value);
  const alias = normalizeActionText(aliasKeyInput.value);
  const app = normalizeActionText(aliasAppInput.value);
  if (!deviceId) {
    throw new Error("Alias device ID is required.");
  }
  if (!alias) {
    throw new Error("Alias phrase is required.");
  }
  if (!app) {
    throw new Error("Canonical app is required.");
  }

  localStorage.setItem(ALIAS_DEVICE_KEY, deviceId);

  const existing = await apiRequest(`/api/devices/${encodeURIComponent(deviceId)}/app-aliases`, null, { method: "GET" });
  const existingAliases = Array.isArray(existing.data?.aliases) ? existing.data.aliases : [];
  const merged = [];
  let updated = false;

  for (const entry of existingAliases) {
    const entryAlias = normalizeActionText(entry.alias);
    if (!entryAlias) {
      continue;
    }

    if (entryAlias === alias) {
      merged.push({ alias, app });
      updated = true;
    } else {
      merged.push({ alias: entryAlias, app: normalizeActionText(entry.app) });
    }
  }

  if (!updated) {
    merged.push({ alias, app });
  }

  const { data, latencyMs } = await apiRequest(`/api/devices/${encodeURIComponent(deviceId)}/app-aliases`, {
    aliases: merged,
  }, { method: "PUT" });

  setResult(data, { requestId: deviceId, latencyMs });
}

async function loadDevices(options = {}) {
  const { data } = await apiRequest("/api/devices", null, { method: "GET" });
  if (!data.ok) {
    throw new Error(data.message || "Failed to load devices.");
  }

  renderDeviceCards(data.devices || []);
  if (!options.silent) {
    setResult("Devices loaded.");
  }
}

async function loadGroups(options = {}) {
  const { data, latencyMs } = await apiRequest("/api/groups", null, { method: "GET" });
  if (!data.ok) {
    throw new Error(data.message || "Failed to load groups.");
  }

  renderGroupCards(data.groups || []);
  if (!options.silent) {
    setResult(data, { latencyMs });
  }
}

async function saveGroup() {
  const groupId = normalizeActionText(groupIdInput.value);
  const displayName = (groupDisplayNameInput.value || "").trim();
  const description = (groupDescriptionInput.value || "").trim();
  const members = (groupMembersInput.value || "")
    .split(",")
    .map((item) => normalizeActionText(item))
    .filter((item) => item.length > 0);

  if (!groupId) {
    throw new Error("Group ID is required.");
  }

  if (!displayName) {
    throw new Error("Group name is required.");
  }

  const { data, latencyMs } = await apiRequest(`/api/groups/${encodeURIComponent(groupId)}`, {
    display_name: displayName,
    description,
    device_ids: members,
  }, { method: "PUT" });

  await loadGroups({ silent: true });
  setResult(data, { latencyMs });
}

async function deleteGroup() {
  const groupId = normalizeActionText(groupIdInput.value);
  if (!groupId) {
    throw new Error("Group ID is required.");
  }

  const { data, latencyMs } = await apiRequest(`/api/groups/${encodeURIComponent(groupId)}`, null, { method: "DELETE" });
  await loadGroups({ silent: true });
  setResult(data, { latencyMs });
}

async function loadHistory(options = {}) {
  const append = options.append === true;
  const deviceFilter = normalizeActionText(historyDeviceFilterInput ? historyDeviceFilterInput.value : "");
  const params = new URLSearchParams();
  params.set("limit", String(HISTORY_PAGE_SIZE));

  if (deviceFilter) {
    params.set("device_id", deviceFilter);
  }

  if (append && commandHistoryNextBefore) {
    params.set("before", commandHistoryNextBefore);
  }

  const { data, latencyMs } = await apiRequest(`/api/command-logs?${params.toString()}`, null, { method: "GET" });
  if (!data.ok) {
    throw new Error(data.message || "Failed to load command history.");
  }

  const logs = Array.isArray(data.logs) ? data.logs : [];

  if (!append) {
    commandHistoryEntries = logs;
  } else {
    const existingIds = new Set(commandHistoryEntries.map((entry) => entry.id || `${entry.request_id}:${entry.device_id}`));
    for (const log of logs) {
      const id = log.id || `${log.request_id}:${log.device_id}`;
      if (!existingIds.has(id)) {
        commandHistoryEntries.push(log);
      }
    }
  }

  commandHistoryNextBefore = data.next_before || null;
  renderHistoryEntries();

  if (!options.silent) {
    setResult(data, { latencyMs });
  }
}

async function loadApiKeys(options = {}) {
  const { data, latencyMs } = await apiRequest("/api/auth/keys", null, { method: "GET" });
  if (!data.ok) {
    throw new Error(data.message || "Failed to load API keys.");
  }

  renderApiKeys(data.keys || []);
  if (!options.silent) {
    setResult(data, { latencyMs });
  }
}

async function createApiKey() {
  const name = (apiKeyNameInput.value || "").trim();
  const scopes = (apiKeyScopesInput.value || "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter((item) => item.length > 0);

  if (!name) {
    throw new Error("Key name is required.");
  }

  if (scopes.length === 0) {
    throw new Error("At least one scope is required.");
  }

  const { data, latencyMs } = await apiRequest("/api/auth/keys", {
    name,
    scopes,
  });

  if (newApiKeyBox) {
    newApiKeyBox.value = data.api_key || "";
  }

  await loadApiKeys({ silent: true });
  setResult(data, { latencyMs });
}

function persistUpdateSettings() {
  if (
    !updateTargetInput ||
    !updateVersionInput ||
    !updateUrlInput ||
    !updateShaInput ||
    !updateSizeInput ||
    !updateQueueOfflineInput
  ) {
    return;
  }

  localStorage.setItem(UPDATE_TARGET_KEY, normalizeActionText(updateTargetInput.value));
  localStorage.setItem(UPDATE_VERSION_KEY, (updateVersionInput.value || "").trim());
  localStorage.setItem(UPDATE_URL_KEY, (updateUrlInput.value || "").trim());
  localStorage.setItem(UPDATE_SHA_KEY, normalizeActionText(updateShaInput.value));
  localStorage.setItem(UPDATE_SIZE_KEY, (updateSizeInput.value || "").trim());
  localStorage.setItem(UPDATE_QUEUE_OFFLINE_KEY, updateQueueOfflineInput.checked ? "1" : "0");
}

async function pushUpdate() {
  if (
    !updateTargetInput ||
    !updateVersionInput ||
    !updateUrlInput ||
    !updateShaInput ||
    !updateSizeInput ||
    !updateQueueOfflineInput
  ) {
    throw new Error("Update controls are not available in this app build.");
  }

  const target = normalizeActionText(updateTargetInput.value);
  const version = (updateVersionInput.value || "").trim();
  const packageUrl = (updateUrlInput.value || "").trim();
  const sha256 = normalizeActionText(updateShaInput.value);
  const sizeRaw = (updateSizeInput.value || "").trim();
  const queueIfOffline = updateQueueOfflineInput.checked && target !== "all";

  if (!target) {
    throw new Error("Update target is required.");
  }

  if (!version) {
    throw new Error("Update version is required.");
  }

  if (!packageUrl) {
    throw new Error("Update package URL is required.");
  }

  try {
    const parsed = new URL(packageUrl);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      throw new Error("protocol");
    }
  } catch {
    throw new Error("Update package URL must be an absolute http/https URL.");
  }

  if (sha256 && !SHA256_HEX_RE.test(sha256)) {
    throw new Error("SHA256 must be a 64-character hex string.");
  }

  let sizeBytes;
  if (sizeRaw) {
    const parsedSize = Number.parseInt(sizeRaw, 10);
    if (!Number.isFinite(parsedSize) || parsedSize <= 0) {
      throw new Error("Update size must be a positive integer.");
    }
    sizeBytes = parsedSize;
  }

  persistUpdateSettings();

  const requestId = nowRequestId();
  const payload = {
    request_id: requestId,
    source: "pwa",
    target,
    version,
    package_url: packageUrl,
    queue_if_offline: queueIfOffline,
    ...(sha256 ? { sha256 } : {}),
    ...(sizeBytes ? { size_bytes: sizeBytes } : {}),
  };

  const { data, latencyMs } = await apiRequest("/api/update", payload);
  setResult(data, { requestId, latencyMs });
}

async function sendAdminCommand() {
  if (!adminTargetInput || !adminShellSelect || !adminCommandInput) {
    throw new Error("Admin command controls are not available in this app build.");
  }

  const target = normalizeActionText(adminTargetInput.value);
  const shell = normalizeAdminShell(adminShellSelect.value);
  const commandValue = (adminCommandInput.value || "").trim();
  if (!target) {
    throw new Error("Admin target is required.");
  }

  if (target === "all" || parseGroupTarget(target)) {
    throw new Error("Admin command must target one device.");
  }

  if (!commandValue) {
    throw new Error("Admin command text is empty.");
  }

  persistAdminSettings();

  const requestId = nowRequestId();
  const action = shell === "powershell" ? "ps" : "cmd";
  const payload = {
    request_id: requestId,
    text: `${target} admin ${action} ${commandValue}`,
    source: "pwa-admin",
    async: true,
    timeout_ms: 120000,
    sent_at: new Date().toISOString(),
    client_version: "pwa-v2",
  };

  const { data, latencyMs } = await apiRequest("/api/command", payload);
  if (data && data.ok === true) {
    setLastCommandSuccess();
  }

  setResult(data, { requestId, latencyMs });
}

async function sendCommand() {
  const text = (commandText.value || "").trim();
  if (!text) {
    throw new Error("Command text is empty.");
  }

  const target = normalizeActionText(targetInput.value);
  const requestId = nowRequestId();
  const groupId = parseGroupTarget(target);

  if (groupId) {
    const groupCommandText = extractGroupCommandText(text, target);
    if (!groupCommandText) {
      throw new Error("Group command text is empty.");
    }

    const selectedAction = canonicalActionValue(actionSelect.value);
    const requiresConfirm = selectedAction !== "ping";

    if (requiresConfirm) {
      const confirmed = window.confirm(`Send bulk command to group:${groupId}?`);
      if (!confirmed) {
        setResult("Bulk command cancelled.");
        return;
      }
    }

    const payload = {
      request_id: requestId,
      text: groupCommandText,
      source: "pwa-group",
      confirm_bulk: requiresConfirm,
    };

    const { data, latencyMs } = await apiRequest(`/api/groups/${encodeURIComponent(groupId)}/command`, payload);
    if (data && data.ok === true) {
      setLastCommandSuccess();
    }
    setResult(data, { requestId, latencyMs });
    return;
  }

  const payload = {
    request_id: requestId,
    text,
    source: "pwa",
    async: true,
    sent_at: new Date().toISOString(),
    client_version: "pwa-v2",
  };

  const { data, latencyMs } = await apiRequest("/api/command", payload);
  if (data && data.ok === true) {
    setLastCommandSuccess();
  }
  setResult(data, { requestId, latencyMs });
}

async function testToken() {
  try {
    setAuthHint("Testing token...");
    await loadDevices({ silent: true });
    await loadGroups({ silent: true });
    setAuthHint("Token valid. Devices and groups loaded.");
    setResult("Token test passed.");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setAuthHint(message, true);
    setResult(message, { isError: true });
  }
}

function schedulePolling() {
  if (pollTimer) {
    window.clearInterval(pollTimer);
    pollTimer = null;
  }

  if (!getToken()) {
    return;
  }

  pollTimer = window.setInterval(async () => {
    try {
      await loadDevices({ silent: true });
      await loadGroups({ silent: true });
    } catch (error) {
      if (!(error instanceof ApiError) || (error.status !== 401 && error.status !== 403)) {
        setConnectionStatus("retrying");
      }
    }
  }, POLL_INTERVAL_MS);
}

function closeEventStream() {
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }

  if (eventsReconnectTimer) {
    window.clearTimeout(eventsReconnectTimer);
    eventsReconnectTimer = null;
  }
}

function scheduleEventDrivenDeviceRefresh() {
  if (eventDrivenDeviceRefreshTimer) {
    return;
  }

  eventDrivenDeviceRefreshTimer = window.setTimeout(async () => {
    eventDrivenDeviceRefreshTimer = null;
    try {
      await loadDevices({ silent: true });
      await loadGroups({ silent: true });
    } catch {
      // ignore transient event refresh failures
    }
  }, 250);
}

function parseEventData(event) {
  if (!event || typeof event.data !== "string" || !event.data) {
    return null;
  }

  try {
    return JSON.parse(event.data);
  } catch {
    return null;
  }
}

function connectEventStream() {
  closeEventStream();

  const token = getToken();
  if (!token) {
    return;
  }

  const endpoint = apiUrl(`/api/events?token=${encodeURIComponent(token)}`);
  if (!endpoint) {
    return;
  }

  if (window.location.protocol === "https:" && endpoint.startsWith("http://")) {
    return;
  }

  try {
    eventSource = new EventSource(endpoint);
  } catch {
    eventSource = null;
    return;
  }

  eventSource.addEventListener("ready", () => {
    setConnectionStatus("connected");
  });

  eventSource.addEventListener("device_status", () => {
    scheduleEventDrivenDeviceRefresh();
  });

  eventSource.addEventListener("command_log", (event) => {
    const payload = parseEventData(event);
    if (!payload) {
      return;
    }

    upsertHistoryEntry({
      id: payload.id || `${payload.request_id}:${payload.device_id}`,
      request_id: payload.request_id,
      device_id: payload.device_id,
      parsed_target: payload.parsed_target,
      parsed_type: payload.parsed_type,
      raw_text: payload.raw_text,
      status: payload.status,
      result_message: payload.message,
      result_payload: payload.result_payload,
      error_code: payload.error_code,
      created_at: payload.ts,
      completed_at: payload.ts,
    });
  });

  eventSource.addEventListener("ping", () => {
    if (connectionBadge.textContent !== "Connected") {
      setConnectionStatus("connected");
    }
  });

  eventSource.onerror = () => {
    setConnectionStatus("retrying");
    closeEventStream();
    eventsReconnectTimer = window.setTimeout(() => {
      connectEventStream();
    }, EVENTS_RECONNECT_DELAY_MS);
  };
}

function setupSpeech() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

  if (!SpeechRecognition) {
    speechInfo.textContent = "Speech not supported in this browser. Use keyboard dictation.";
    speakBtn.disabled = true;
    return;
  }

  speechInfo.textContent = "Speech supported.";

  const recognition = new SpeechRecognition();
  recognition.lang = "en-US";
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;

  recognition.onresult = (event) => {
    const transcript = event.results[0][0].transcript || "";
    commandText.value = transcript.trim().toLowerCase();
  };

  recognition.onerror = (event) => {
    setResult(`Speech error: ${event.error || "unknown"}`, { isError: true });
  };

  speakBtn.addEventListener("click", () => {
    recognition.start();
  });
}

function applyBootstrapLink() {
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const query = new URLSearchParams(window.location.search);
  const read = (key) => {
    const fromHash = hash.get(key);
    if (fromHash != null && fromHash !== "") {
      return fromHash;
    }
    const fromQuery = query.get(key);
    if (fromQuery != null && fromQuery !== "") {
      return fromQuery;
    }
    return "";
  };

  const token = read("token");
  const api = read("api");
  const target = read("target");
  const action = read("action");
  const arg = read("arg");
  const command = read("command");
  const updateTarget = read("update_target");
  const updateVersion = read("update_version");
  const updateUrl = read("update_url");
  const updateSha = read("update_sha");
  const updateSize = read("update_size");
  const updateQueueOffline = read("update_queue_offline");

  let applied = false;

  if (api) {
    setApiBase(api);
    applied = true;
  }

  if (token) {
    setToken(token);
    applied = true;
  }

  if (target) {
    localStorage.setItem(TARGET_KEY, normalizeActionText(target));
    applied = true;
  }

  if (updateTarget) {
    localStorage.setItem(UPDATE_TARGET_KEY, normalizeActionText(updateTarget));
    applied = true;
  } else if (target) {
    localStorage.setItem(UPDATE_TARGET_KEY, normalizeActionText(target));
  }

  if (updateVersion) {
    localStorage.setItem(UPDATE_VERSION_KEY, updateVersion.trim());
    applied = true;
  }

  if (updateUrl) {
    localStorage.setItem(UPDATE_URL_KEY, updateUrl.trim());
    applied = true;
  }

  if (updateSha) {
    localStorage.setItem(UPDATE_SHA_KEY, normalizeActionText(updateSha));
    applied = true;
  }

  if (updateSize) {
    localStorage.setItem(UPDATE_SIZE_KEY, updateSize.trim());
    applied = true;
  }

  if (updateQueueOffline) {
    const normalized = updateQueueOffline.trim().toLowerCase();
    const enabled = normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
    localStorage.setItem(UPDATE_QUEUE_OFFLINE_KEY, enabled ? "1" : "0");
    applied = true;
  }

  if (command) {
    localStorage.setItem(BOOTSTRAP_COMMAND_KEY, command.trim().toLowerCase());
    applied = true;
  } else if (target && action) {
    const pairArg = arg ? ` ${arg.trim()}` : "";
    localStorage.setItem(BOOTSTRAP_COMMAND_KEY, `${normalizeActionText(target)} ${normalizeActionText(action)}${pairArg}`);
    applied = true;
  }

  if (action) {
    localStorage.setItem(BOOTSTRAP_ACTION_KEY, normalizeActionText(action));
    applied = true;
  }

  if (arg) {
    localStorage.setItem(BOOTSTRAP_ARG_KEY, arg.trim());
    applied = true;
  }

  if (applied) {
    const cleanPath = window.location.pathname;
    window.history.replaceState({}, document.title, cleanPath);
    setResult("Connection configured from pairing link. Fields were auto-filled.");
  }
}

function init() {
  applyBootstrapLink();
  apiBaseInput.value = getApiBase();
  setApiBase(apiBaseInput.value);
  apiBaseInput.value = getApiBase();
  tokenInput.value = getToken();
  loadLastCommandSuccess();
  setConnectionStatus(getToken() ? "retrying" : "disconnected");

  const lastTarget = localStorage.getItem(TARGET_KEY);
  if (lastTarget) {
    targetInput.value = lastTarget;
  }

  if (updateTargetInput && updateVersionInput && updateUrlInput && updateShaInput && updateSizeInput && updateQueueOfflineInput) {
    updateTargetInput.value = localStorage.getItem(UPDATE_TARGET_KEY) || targetInput.value || "m1";
    updateVersionInput.value = localStorage.getItem(UPDATE_VERSION_KEY) || "";
    updateUrlInput.value = localStorage.getItem(UPDATE_URL_KEY) || "";
    updateShaInput.value = localStorage.getItem(UPDATE_SHA_KEY) || "";
    updateSizeInput.value = localStorage.getItem(UPDATE_SIZE_KEY) || "";
    updateQueueOfflineInput.checked = localStorage.getItem(UPDATE_QUEUE_OFFLINE_KEY) !== "0";
  }

  if (adminTargetInput && adminShellSelect) {
    adminTargetInput.value = localStorage.getItem(ADMIN_TARGET_KEY) || "a1";
    adminShellSelect.value = normalizeAdminShell(localStorage.getItem(ADMIN_SHELL_KEY) || "cmd");
  }

  if (aliasDeviceInput) {
    aliasDeviceInput.value = localStorage.getItem(ALIAS_DEVICE_KEY) || targetInput.value || "m1";
  }

  renderActionOptions("");

  const bootstrapAction = localStorage.getItem(BOOTSTRAP_ACTION_KEY);
  const rememberedAction = localStorage.getItem(LAST_ACTION_KEY);
  setSelectedAction(bootstrapAction) || setSelectedAction(rememberedAction) || setSelectedAction("ping");

  const bootstrapArg = localStorage.getItem(BOOTSTRAP_ARG_KEY);
  if (bootstrapArg) {
    argInput.value = bootstrapArg;
  }

  const bootstrapCommand = localStorage.getItem(BOOTSTRAP_COMMAND_KEY);
  if (bootstrapCommand) {
    commandText.value = bootstrapCommand;
    localStorage.removeItem(BOOTSTRAP_COMMAND_KEY);
  } else {
    commandText.value = composeCommand();
  }

  localStorage.removeItem(BOOTSTRAP_ACTION_KEY);
  localStorage.removeItem(BOOTSTRAP_ARG_KEY);

  actionSearchInput.addEventListener("input", () => {
    renderActionOptions(actionSearchInput.value);
    localStorage.setItem(LAST_ACTION_KEY, normalizeActionText(actionSelect.value));
    commandText.value = composeCommand();
  });

  actionSearchInput.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      actionSearchInput.value = "";
      renderActionOptions("");
      commandText.value = composeCommand();
      event.preventDefault();
    } else if (event.key === "ArrowDown") {
      actionSelect.focus();
      event.preventDefault();
    }
  });

  actionSelect.addEventListener("change", () => {
    localStorage.setItem(LAST_ACTION_KEY, normalizeActionText(actionSelect.value));
    updateDangerZone();
    commandText.value = composeCommand();
  });

  targetInput.addEventListener("change", () => {
    localStorage.setItem(TARGET_KEY, normalizeActionText(targetInput.value));
    if (aliasDeviceInput && !parseGroupTarget(targetInput.value) && normalizeActionText(targetInput.value) !== "all") {
      aliasDeviceInput.value = normalizeActionText(targetInput.value);
      localStorage.setItem(ALIAS_DEVICE_KEY, normalizeActionText(targetInput.value));
    }
    if (updateTargetInput && !localStorage.getItem(UPDATE_TARGET_KEY) && updateTargetInput.value.trim() === "") {
      updateTargetInput.value = normalizeActionText(targetInput.value);
    }
    refreshActionAvailability();
    commandText.value = composeCommand();
  });

  argInput.addEventListener("input", () => {
    commandText.value = composeCommand();
  });

  composeBtn.addEventListener("click", () => {
    commandText.value = composeCommand();
  });

  saveTokenBtn.addEventListener("click", () => {
    const token = (tokenInput.value || "").trim();
    const apiBase = (apiBaseInput.value || "").trim();

    if (!token) {
      clearToken();
      setAuthHint("Token is empty.", true);
      setResult("Token is empty.", { isError: true });
      setConnectionStatus("disconnected");
      closeEventStream();
      schedulePolling();
      return;
    }

    setToken(token);
    setApiBase(apiBase);
    apiBaseInput.value = getApiBase();
    setAuthHint("Connection settings saved.");
    setResult("Connection settings saved on this device.");
    schedulePolling();
    connectEventStream();
  });

  testTokenBtn.addEventListener("click", async () => {
    await testToken();
  });

  loadDevicesBtn.addEventListener("click", async () => {
    try {
      await loadDevices();
      await loadGroups({ silent: true });
      setAuthHint("Device list refreshed.");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setAuthHint(message, true);
      setResult(message, { isError: true });
    }
  });

  if (renameDeviceBtn) {
    renameDeviceBtn.addEventListener("click", async () => {
      try {
        renameDeviceBtn.disabled = true;
        renameDeviceBtn.textContent = "Saving...";
        await renameDevice();
        setAuthHint("Shared device name saved.");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setAuthHint(message, true);
        setResult(message, { isError: true });
      } finally {
        renameDeviceBtn.disabled = false;
        renameDeviceBtn.textContent = "Save Name";
      }
    });
  }

  if (saveAliasBtn) {
    saveAliasBtn.addEventListener("click", async () => {
      try {
        saveAliasBtn.disabled = true;
        saveAliasBtn.textContent = "Saving...";
        await saveDeviceAlias();
        setAuthHint("Device app alias saved.");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setAuthHint(message, true);
        setResult(message, { isError: true });
      } finally {
        saveAliasBtn.disabled = false;
        saveAliasBtn.textContent = "Save Alias";
      }
    });
  }

  sendBtn.addEventListener("click", async () => {
    try {
      sendBtn.disabled = true;
      sendBtn.textContent = "Sending...";
      await sendCommand();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setAuthHint(message, true);
      setResult(message, { isError: true });
    } finally {
      sendBtn.disabled = false;
      sendBtn.textContent = "Send";
    }
  });

  if (pushUpdateBtn) {
    pushUpdateBtn.addEventListener("click", async () => {
      try {
        pushUpdateBtn.disabled = true;
        pushUpdateBtn.textContent = "Pushing...";
        await pushUpdate();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setAuthHint(message, true);
        setResult(message, { isError: true });
      } finally {
        pushUpdateBtn.disabled = false;
        pushUpdateBtn.textContent = "Push Update";
      }
    });
  }

  if (saveGroupBtn) {
    saveGroupBtn.addEventListener("click", async () => {
      try {
        saveGroupBtn.disabled = true;
        saveGroupBtn.textContent = "Saving...";
        await saveGroup();
      } catch (error) {
        setResult(error instanceof Error ? error.message : String(error), { isError: true });
      } finally {
        saveGroupBtn.disabled = false;
        saveGroupBtn.textContent = "Save Group";
      }
    });
  }

  if (deleteGroupBtn) {
    deleteGroupBtn.addEventListener("click", async () => {
      try {
        if (!window.confirm("Delete this group?")) {
          return;
        }
        deleteGroupBtn.disabled = true;
        deleteGroupBtn.textContent = "Deleting...";
        await deleteGroup();
      } catch (error) {
        setResult(error instanceof Error ? error.message : String(error), { isError: true });
      } finally {
        deleteGroupBtn.disabled = false;
        deleteGroupBtn.textContent = "Delete Group";
      }
    });
  }

  if (loadGroupsBtn) {
    loadGroupsBtn.addEventListener("click", async () => {
      try {
        await loadGroups();
      } catch (error) {
        setResult(error instanceof Error ? error.message : String(error), { isError: true });
      }
    });
  }

  if (loadHistoryBtn) {
    loadHistoryBtn.addEventListener("click", async () => {
      try {
        commandHistoryNextBefore = null;
        await loadHistory();
      } catch (error) {
        setResult(error instanceof Error ? error.message : String(error), { isError: true });
      }
    });
  }

  if (moreHistoryBtn) {
    moreHistoryBtn.addEventListener("click", async () => {
      try {
        await loadHistory({ append: true });
      } catch (error) {
        setResult(error instanceof Error ? error.message : String(error), { isError: true });
      }
    });
  }

  if (createApiKeyBtn) {
    createApiKeyBtn.addEventListener("click", async () => {
      try {
        createApiKeyBtn.disabled = true;
        createApiKeyBtn.textContent = "Creating...";
        await createApiKey();
      } catch (error) {
        setResult(error instanceof Error ? error.message : String(error), { isError: true });
      } finally {
        createApiKeyBtn.disabled = false;
        createApiKeyBtn.textContent = "Create Key";
      }
    });
  }

  if (loadApiKeysBtn) {
    loadApiKeysBtn.addEventListener("click", async () => {
      try {
        await loadApiKeys();
      } catch (error) {
        setResult(error instanceof Error ? error.message : String(error), { isError: true });
      }
    });
  }

  if (updateTargetInput && updateVersionInput && updateUrlInput && updateShaInput && updateSizeInput && updateQueueOfflineInput) {
    updateTargetInput.addEventListener("change", () => {
      persistUpdateSettings();
    });
    updateVersionInput.addEventListener("change", () => {
      persistUpdateSettings();
    });
    updateUrlInput.addEventListener("change", () => {
      persistUpdateSettings();
    });
    updateShaInput.addEventListener("change", () => {
      persistUpdateSettings();
    });
    updateSizeInput.addEventListener("change", () => {
      persistUpdateSettings();
    });
    updateQueueOfflineInput.addEventListener("change", () => {
      persistUpdateSettings();
    });
  }

  if (adminTargetInput && adminShellSelect && adminCommandInput && sendAdminCommandBtn) {
    adminTargetInput.addEventListener("change", () => {
      persistAdminSettings();
    });
    adminShellSelect.addEventListener("change", () => {
      adminShellSelect.value = normalizeAdminShell(adminShellSelect.value);
      persistAdminSettings();
    });
    sendAdminCommandBtn.addEventListener("click", async () => {
      try {
        sendAdminCommandBtn.disabled = true;
        sendAdminCommandBtn.textContent = "Running...";
        await sendAdminCommand();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setAuthHint(message, true);
        setResult(message, { isError: true });
      } finally {
        sendAdminCommandBtn.disabled = false;
        sendAdminCommandBtn.textContent = "Run Admin Command";
      }
    });
  }

  setupSpeech();
  schedulePolling();
  connectEventStream();

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker
      .register("sw.js", { updateViaCache: "none" })
      .then((registration) => {
        registration.update().catch(() => {
          // Ignore update errors.
        });
      })
      .catch(() => {
        // Ignore service worker errors.
      });
  }

  if (getToken()) {
    Promise.allSettled([
      loadDevices({ silent: true }),
      loadGroups({ silent: true }),
      loadHistory({ silent: true }),
      loadApiKeys({ silent: true }),
    ]).then(() => {
      if (!resultBox.textContent || resultBox.textContent === "No request yet.") {
        setResult("Initial data loaded.");
      }
    });
  }
}

window.addEventListener("beforeunload", () => {
  closeEventStream();
  if (pollTimer) {
    window.clearInterval(pollTimer);
  }
});

init();
