const apiBaseInput = document.getElementById("apiBaseInput");
const tokenInput = document.getElementById("tokenInput");
const saveTokenBtn = document.getElementById("saveTokenBtn");
const testTokenBtn = document.getElementById("testTokenBtn");
const loadDevicesBtn = document.getElementById("loadDevicesBtn");
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
const pushUpdateBtn = document.getElementById("pushUpdateBtn");

const TOKEN_KEY = "cordyceps_phone_api_token";
const TARGET_KEY = "cordyceps_last_target";
const API_BASE_KEY = "cordyceps_api_base_url";
const UPDATE_TARGET_KEY = "cordyceps_update_target";
const UPDATE_VERSION_KEY = "cordyceps_update_version";
const UPDATE_URL_KEY = "cordyceps_update_url";
const UPDATE_SHA_KEY = "cordyceps_update_sha";
const UPDATE_SIZE_KEY = "cordyceps_update_size";
const LAST_COMMAND_SUCCESS_KEY = "cordyceps_last_command_success";
const BOOTSTRAP_COMMAND_KEY = "cordyceps_bootstrap_command";
const BOOTSTRAP_ACTION_KEY = "cordyceps_bootstrap_action";
const BOOTSTRAP_ARG_KEY = "cordyceps_bootstrap_arg";
const LAST_ACTION_KEY = "cordyceps_last_action";
const SHA256_HEX_RE = /^[a-f0-9]{64}$/;

const POLL_INTERVAL_MS = 30000;

const COMMAND_LIBRARY = [
  { value: "ping", label: "ping", category: "Connectivity", keywords: ["status", "health", "check"] },
  { value: "play", label: "play", category: "Media", keywords: ["resume"] },
  { value: "pause", label: "pause", category: "Media", keywords: ["stop"] },
  { value: "play pause", label: "play pause", category: "Media", keywords: ["toggle"] },
  { value: "next", label: "next", category: "Media", keywords: ["skip", "next track", "repeat"] },
  { value: "previous", label: "previous", category: "Media", keywords: ["back", "prev", "previous track", "repeat"] },
  { value: "volume up", label: "volume up", category: "Volume", keywords: ["louder", "vol up", "volume higher", "repeat"] },
  { value: "volume down", label: "volume down", category: "Volume", keywords: ["quieter", "vol down", "volume lower", "repeat"] },
  { value: "mute", label: "mute", category: "Volume", keywords: ["mute volume", "silence", "unmute"] },
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
  ["mute volume", "mute"],
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
const REPEATABLE_ACTIONS = new Set([
  "volume up",
  "volume down",
  "next",
  "previous",
]);
const dangerousActions = new Set(["shutdown", "shut down", "shutdown pc", "restart", "reboot", "restart pc", "sleep", "sleep pc", "sign out", "log out", "logout", "panic confirm"]);

let pollTimer = null;

class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

function nowRequestId() {
  return "web-" + Date.now() + "-" + Math.random().toString(16).slice(2, 8);
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
    localStorage.setItem(TARGET_KEY, target.trim().toLowerCase());
    applied = true;
  }

  if (updateTarget) {
    localStorage.setItem(UPDATE_TARGET_KEY, updateTarget.trim().toLowerCase());
    applied = true;
  } else if (target) {
    localStorage.setItem(UPDATE_TARGET_KEY, target.trim().toLowerCase());
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
    localStorage.setItem(UPDATE_SHA_KEY, updateSha.trim().toLowerCase());
    applied = true;
  }

  if (updateSize) {
    localStorage.setItem(UPDATE_SIZE_KEY, updateSize.trim());
    applied = true;
  }

  if (command) {
    localStorage.setItem(BOOTSTRAP_COMMAND_KEY, command.trim().toLowerCase());
    applied = true;
  } else if (target && action) {
    const pairArg = arg ? ` ${arg.trim()}` : "";
    localStorage.setItem(BOOTSTRAP_COMMAND_KEY, `${target.trim().toLowerCase()} ${action.trim().toLowerCase()}${pairArg}`);
    applied = true;
  }

  if (action) {
    localStorage.setItem(BOOTSTRAP_ACTION_KEY, action.trim().toLowerCase());
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

function getToken() {
  return localStorage.getItem(TOKEN_KEY) || "";
}

function setToken(token) {
  localStorage.setItem(TOKEN_KEY, token);
}

function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
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
    const okValue = payload.ok;
    if (okValue === false) {
      statusLabel = "error";
    }
    if (okValue === true && !isError) {
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

function normalizeActionText(text) {
  return (text || "")
    .toString()
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

function filterCommandLibrary(query) {
  const normalizedQuery = normalizeActionText(query);
  if (!normalizedQuery) {
    return COMMAND_LIBRARY_INDEX;
  }

  const terms = normalizedQuery.split(" ");
  return COMMAND_LIBRARY_INDEX.filter((entry) => terms.every((term) => entry.searchText.includes(term)));
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
}

function setSelectedAction(action) {
  const normalized = normalizeActionText(action);
  const canonical = ACTION_VALUE_ALIASES.get(normalized) || normalized;
  if (!canonical || !KNOWN_ACTION_VALUES.has(canonical)) {
    return false;
  }

  actionSelect.value = canonical;
  localStorage.setItem(LAST_ACTION_KEY, canonical);
  return true;
}

function composeCommand() {
  const target = (targetInput.value || "").trim().toLowerCase();
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

function updateDangerZone() {
  const action = normalizeActionText(actionSelect.value);
  dangerZone.classList.toggle("hidden", !dangerousActions.has(action));
}

function parseApiErrorMessage(status, dataMessage) {
  if (status === 401 || status === 403) {
    return "Authentication failed. Check PHONE_API_TOKEN and save again.";
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
  let response;
  try {
    response = await fetch(endpoint, {
      method,
      headers: {
        ...(payload ? { "Content-Type": "application/json" } : {}),
        Authorization: `Bearer ${token}`,
      },
      ...(payload ? { body: JSON.stringify(payload) } : {}),
    });
  } catch {
    setConnectionStatus("retrying");
    throw new Error("Cannot reach server. Connection is retrying.");
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
    } else {
      setConnectionStatus("retrying");
    }
    throw new ApiError(message, response.status);
  }

  setConnectionStatus("connected");
  return { data, latencyMs };
}

function setTarget(deviceId) {
  targetInput.value = deviceId;
  localStorage.setItem(TARGET_KEY, deviceId);
  commandText.value = composeCommand();
  if (updateTargetInput) {
    updateTargetInput.value = deviceId;
    localStorage.setItem(UPDATE_TARGET_KEY, deviceId);
  }
}

function renderDeviceCards(devices) {
  deviceCards.innerHTML = "";
  deviceList.innerHTML = "";

  if (devices.length === 0) {
    deviceSummary.textContent = "No enrolled devices";
    return;
  }

  const online = devices.filter((d) => (d.status || "").toLowerCase() === "online").length;
  deviceSummary.textContent = `${online}/${devices.length} online`;

  for (const device of devices) {
    const deviceId = String(device.device_id || "").trim();
    const status = String(device.status || "unknown").trim().toLowerCase();

    const card = document.createElement("article");
    card.className = "device-card";
    const heading = document.createElement("h3");
    heading.textContent = deviceId || "unknown-device";

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
    card.appendChild(meta);

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
    li.textContent = `${deviceId} - ${status}`;
    deviceList.appendChild(li);
  }
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

async function sendCommand() {
  const text = (commandText.value || "").trim();
  if (!text) {
    throw new Error("Command text is empty.");
  }

  const requestId = nowRequestId();
  const payload = {
    request_id: requestId,
    text,
    source: "pwa",
    sent_at: new Date().toISOString(),
    client_version: "pwa-v1",
  };

  const { data, latencyMs } = await apiRequest("/api/command", payload);
  if (data && data.ok === true) {
    setLastCommandSuccess();
  }
  setResult(data, { requestId, latencyMs });
}

function persistUpdateSettings() {
  if (!updateTargetInput || !updateVersionInput || !updateUrlInput || !updateShaInput || !updateSizeInput) {
    return;
  }

  localStorage.setItem(UPDATE_TARGET_KEY, (updateTargetInput.value || "").trim().toLowerCase());
  localStorage.setItem(UPDATE_VERSION_KEY, (updateVersionInput.value || "").trim());
  localStorage.setItem(UPDATE_URL_KEY, (updateUrlInput.value || "").trim());
  localStorage.setItem(UPDATE_SHA_KEY, (updateShaInput.value || "").trim().toLowerCase());
  localStorage.setItem(UPDATE_SIZE_KEY, (updateSizeInput.value || "").trim());
}

async function pushUpdate() {
  if (!updateTargetInput || !updateVersionInput || !updateUrlInput || !updateShaInput || !updateSizeInput) {
    throw new Error("Update controls are not available in this app build.");
  }

  const target = (updateTargetInput.value || "").trim().toLowerCase();
  const version = (updateVersionInput.value || "").trim();
  const packageUrl = (updateUrlInput.value || "").trim();
  const sha256 = (updateShaInput.value || "").trim().toLowerCase();
  const sizeRaw = (updateSizeInput.value || "").trim();

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
    ...(sha256 ? { sha256 } : {}),
    ...(sizeBytes ? { size_bytes: sizeBytes } : {}),
  };

  const { data, latencyMs } = await apiRequest("/api/update", payload);
  setResult(data, { requestId, latencyMs });
}

async function testToken() {
  try {
    setAuthHint("Testing token...");
    await loadDevices({ silent: true });
    setAuthHint("Token valid. Device list loaded.");
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
    } catch (error) {
      if (!(error instanceof ApiError) || (error.status !== 401 && error.status !== 403)) {
        setConnectionStatus("retrying");
      }
    }
  }, POLL_INTERVAL_MS);
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

  if (updateTargetInput && updateVersionInput && updateUrlInput && updateShaInput && updateSizeInput) {
    updateTargetInput.value = localStorage.getItem(UPDATE_TARGET_KEY) || targetInput.value || "m1";
    updateVersionInput.value = localStorage.getItem(UPDATE_VERSION_KEY) || "";
    updateUrlInput.value = localStorage.getItem(UPDATE_URL_KEY) || "";
    updateShaInput.value = localStorage.getItem(UPDATE_SHA_KEY) || "";
    updateSizeInput.value = localStorage.getItem(UPDATE_SIZE_KEY) || "";
  }

  renderActionOptions("");

  const bootstrapAction = localStorage.getItem(BOOTSTRAP_ACTION_KEY);
  const rememberedAction = localStorage.getItem(LAST_ACTION_KEY);
  setSelectedAction(bootstrapAction) || setSelectedAction(rememberedAction) || setSelectedAction("ping");
  updateDangerZone();

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

  if (actionSearchInput) {
    actionSearchInput.addEventListener("input", () => {
      renderActionOptions(actionSearchInput.value);
      localStorage.setItem(LAST_ACTION_KEY, normalizeActionText(actionSelect.value));
      updateDangerZone();
      commandText.value = composeCommand();
    });

    actionSearchInput.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        actionSearchInput.value = "";
        renderActionOptions("");
        updateDangerZone();
        commandText.value = composeCommand();
        event.preventDefault();
      } else if (event.key === "ArrowDown") {
        actionSelect.focus();
        event.preventDefault();
      }
    });
  }

  actionSelect.addEventListener("change", () => {
    localStorage.setItem(LAST_ACTION_KEY, normalizeActionText(actionSelect.value));
    updateDangerZone();
    commandText.value = composeCommand();
  });

  targetInput.addEventListener("change", () => {
    localStorage.setItem(TARGET_KEY, targetInput.value.trim().toLowerCase());
    if (updateTargetInput && !localStorage.getItem(UPDATE_TARGET_KEY) && updateTargetInput.value.trim() === "") {
      updateTargetInput.value = targetInput.value.trim().toLowerCase();
    }
    commandText.value = composeCommand();
  });

  argInput.addEventListener("input", () => {
    commandText.value = composeCommand();
  });

  composeBtn.addEventListener("click", () => {
    commandText.value = composeCommand();
  });

  saveTokenBtn.addEventListener("click", () => {
    const token = tokenInput.value.trim();
    const apiBase = apiBaseInput.value.trim();

    if (!token) {
      clearToken();
      setAuthHint("Token is empty.", true);
      setResult("Token is empty.", { isError: true });
      setConnectionStatus("disconnected");
      schedulePolling();
      return;
    }

    setToken(token);
    setApiBase(apiBase);
    apiBaseInput.value = getApiBase();
    setAuthHint("Connection settings saved.");
    setResult("Connection settings saved on this device.");
    schedulePolling();
  });

  if (testTokenBtn) {
    testTokenBtn.addEventListener("click", async () => {
      await testToken();
    });
  }

  if (updateTargetInput && updateVersionInput && updateUrlInput && updateShaInput && updateSizeInput) {
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
  }

  loadDevicesBtn.addEventListener("click", async () => {
    try {
      await loadDevices();
      setAuthHint("Device list refreshed.");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setAuthHint(message, true);
      setResult(message, { isError: true });
    }
  });

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

  setupSpeech();
  schedulePolling();

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
    loadDevices({ silent: true })
      .then(() => {
        if (!resultBox.textContent || resultBox.textContent === "No request yet.") {
          setResult("Devices loaded.");
        }
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        setAuthHint(message, true);
        setResult(message, { isError: true });
      });
  }
}

init();
