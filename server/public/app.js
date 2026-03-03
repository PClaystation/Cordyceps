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

function nowRequestId() {
  return "web-" + Date.now() + "-" + Math.random().toString(16).slice(2, 8);
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

  const response = await fetch(path, {
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

  const response = await fetch("/api/devices", {
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
    if (!token) {
      setResult("Token is empty.");
      return;
    }

    setToken(token);
    setResult("Token saved on this device.");
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
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Ignore service worker errors.
    });
  }
}

init();
