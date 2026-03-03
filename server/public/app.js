const apiBaseInput = document.getElementById("apiBaseInput");
const tokenInput = document.getElementById("tokenInput");
const saveTokenBtn = document.getElementById("saveTokenBtn");
const loadDevicesBtn = document.getElementById("loadDevicesBtn");
const deviceSummary = document.getElementById("deviceSummary");
const deviceList = document.getElementById("deviceList");
const targetInput = document.getElementById("targetInput");
const actionSelect = document.getElementById("actionSelect");
const argInput = document.getElementById("argInput");
const composeBtn = document.getElementById("composeBtn");
const speakBtn = document.getElementById("speakBtn");
const sendBtn = document.getElementById("sendBtn");
const commandText = document.getElementById("commandText");
const resultBox = document.getElementById("resultBox");
const speechInfo = document.getElementById("speechInfo");

const TOKEN_KEY = "jarvis_phone_api_token";
const TARGET_KEY = "jarvis_last_target";
const API_BASE_KEY = "jarvis_api_base_url";

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

  const token = hash.get("token") || query.get("token");
  const api = hash.get("api") || query.get("api");

  let applied = false;

  if (api) {
    setApiBase(api);
    applied = true;
  }

  if (token) {
    setToken(token);
    applied = true;
  }

  if (applied) {
    const cleanPath = window.location.pathname;
    window.history.replaceState({}, document.title, cleanPath);
    setResult("Connection configured from pairing link.");
  }
}

function getToken() {
  return localStorage.getItem(TOKEN_KEY) || "";
}

function setToken(token) {
  localStorage.setItem(TOKEN_KEY, token);
}

function setResult(payload) {
  resultBox.textContent = typeof payload === "string" ? payload : JSON.stringify(payload, null, 2);
}

function composeCommand() {
  const target = (targetInput.value || "").trim().toLowerCase();
  const action = (actionSelect.value || "").trim().toLowerCase();
  const arg = (argInput.value || "").trim();

  if (!target || !action) {
    return "";
  }

  if (action === "notify") {
    return arg ? `${target} notify ${arg}` : `${target} notify hello`;
  }

  return `${target} ${action}`;
}

async function apiRequest(path, payload) {
  const token = getToken();
  if (!token) {
    throw new Error("Set your API token first.");
  }

  const endpoint = apiUrl(path);
  if (window.location.protocol === "https:" && endpoint.startsWith("http://")) {
    throw new Error("Mixed content blocked. Set API base URL to https://mpmc.ddns.net.");
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });

  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : { raw: text };
  } catch {
    data = { raw: text };
  }

  if (!response.ok) {
    const errorMessage = data && data.message ? data.message : `HTTP ${response.status}`;
    throw new Error(errorMessage);
  }

  return data;
}

async function loadDevices() {
  const token = getToken();
  if (!token) {
    throw new Error("Set your API token first.");
  }

  const endpoint = apiUrl("/api/devices");
  if (window.location.protocol === "https:" && endpoint.startsWith("http://")) {
    throw new Error("Mixed content blocked. Set API base URL to https://mpmc.ddns.net.");
  }

  const response = await fetch(endpoint, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  const data = await response.json();
  if (!response.ok || !data.ok) {
    throw new Error(data.message || `Failed (${response.status})`);
  }

  const devices = data.devices || [];
  deviceList.innerHTML = "";

  if (devices.length === 0) {
    deviceSummary.textContent = "No enrolled devices";
    return;
  }

  const online = devices.filter((d) => d.status === "online").length;
  deviceSummary.textContent = `${online}/${devices.length} online`;

  for (const device of devices) {
    const li = document.createElement("li");
    li.textContent = `${device.device_id} - ${device.status}`;
    deviceList.appendChild(li);
  }
}

async function sendCommand() {
  const text = (commandText.value || "").trim();
  if (!text) {
    throw new Error("Command text is empty.");
  }

  const payload = {
    request_id: nowRequestId(),
    text,
    source: "pwa",
    sent_at: new Date().toISOString(),
    client_version: "pwa-v1",
  };

  const result = await apiRequest("/api/command", payload);
  setResult(result);
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
    setResult(`Speech error: ${event.error || "unknown"}`);
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

  const lastTarget = localStorage.getItem(TARGET_KEY);
  if (lastTarget) {
    targetInput.value = lastTarget;
  }

  const initialCommand = composeCommand();
  if (initialCommand) {
    commandText.value = initialCommand;
  }

  actionSelect.addEventListener("change", () => {
    commandText.value = composeCommand();
  });

  targetInput.addEventListener("change", () => {
    localStorage.setItem(TARGET_KEY, targetInput.value.trim().toLowerCase());
    commandText.value = composeCommand();
  });

  argInput.addEventListener("change", () => {
    commandText.value = composeCommand();
  });

  composeBtn.addEventListener("click", () => {
    commandText.value = composeCommand();
  });

  saveTokenBtn.addEventListener("click", () => {
    const token = tokenInput.value.trim();
    const apiBase = apiBaseInput.value.trim();

    if (!token) {
      setResult("Token is empty.");
      return;
    }

    setToken(token);
    setApiBase(apiBase);
    apiBaseInput.value = getApiBase();
    setResult("Connection settings saved on this device.");
  });

  loadDevicesBtn.addEventListener("click", async () => {
    try {
      await loadDevices();
      setResult("Devices loaded.");
    } catch (error) {
      setResult(error instanceof Error ? error.message : String(error));
    }
  });

  sendBtn.addEventListener("click", async () => {
    try {
      sendBtn.disabled = true;
      sendBtn.textContent = "Sending...";
      await sendCommand();
    } catch (error) {
      setResult(error instanceof Error ? error.message : String(error));
    } finally {
      sendBtn.disabled = false;
      sendBtn.textContent = "Send";
    }
  });

  setupSpeech();

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
    loadDevices()
      .then(() => {
        if (!resultBox.textContent || resultBox.textContent === "No request yet.") {
          setResult("Devices loaded.");
        }
      })
      .catch((error) => {
        setResult(error instanceof Error ? error.message : String(error));
      });
  }
}

init();
