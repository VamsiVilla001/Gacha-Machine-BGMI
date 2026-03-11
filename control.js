const connectionStatus = document.getElementById("connection-status");
const machineStatus = document.getElementById("machine-status");
const sessionRoomId = document.getElementById("session-room-id");
const broadcastLinkInput = document.getElementById("broadcast-link-input");
const generateLinkButton = document.getElementById("generate-link-button");
const openBroadcastButton = document.getElementById("open-broadcast-button");
const copyBroadcastLinkButton = document.getElementById("copy-broadcast-link-button");
const sessionHint = document.getElementById("session-hint");
const minNumberInput = document.getElementById("min-number-input");
const maxNumberInput = document.getElementById("max-number-input");
const scriptedNumberInput = document.getElementById("scripted-number-input");
const knobToggleButton = document.getElementById("knob-toggle-button");
const resetHistoryButton = document.getElementById("reset-history-button");
const controlHint = document.getElementById("control-hint");
const lastResultNumber = document.getElementById("last-result-number");
const resultModeCaption = document.getElementById("result-mode-caption");
const pickHistoryList = document.getElementById("pick-history-list");
const resolutionButtons = Array.from(document.querySelectorAll("[data-resolution-option]"));
const selectionModeButtons = Array.from(document.querySelectorAll("[data-selection-mode]"));
const FALLBACK_HTTP_ORIGIN = "http://127.0.0.1:3000";
const FALLBACK_WS_ORIGIN = "ws://127.0.0.1:3000";

const controlState = {
    socket: null,
    connectionId: 0,
    roomId: "",
    config: {
        resolution: "1920x1080",
        minNumber: 0,
        maxNumber: 999,
        selectionMode: "random",
        scriptedNumber: 777
    },
    machineRunning: false,
    lastResult: null,
    pickedNumbers: []
};

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function sanitizeRoomId(rawRoomId) {
    return String(rawRoomId || "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, "")
        .slice(0, 64);
}

function generateRoomId() {
    if (window.crypto?.randomUUID) {
        return sanitizeRoomId(window.crypto.randomUUID());
    }

    return sanitizeRoomId(`room-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);
}

function ensureRoomId() {
    const url = new URL(window.location.href);
    const existingRoomId = sanitizeRoomId(url.searchParams.get("room"));

    if (existingRoomId) {
        return existingRoomId;
    }

    const nextRoomId = generateRoomId();
    url.searchParams.set("room", nextRoomId);
    window.history.replaceState({}, "", url);
    return nextRoomId;
}

function getHttpOrigin() {
    if (location.protocol === "http:" || location.protocol === "https:") {
        return window.location.origin;
    }

    return FALLBACK_HTTP_ORIGIN;
}

function getWebSocketOrigin() {
    if (location.protocol === "https:") {
        return `wss://${location.host}`;
    }

    if (location.protocol === "http:") {
        return `ws://${location.host}`;
    }

    return FALLBACK_WS_ORIGIN;
}

function buildWebSocketUrl() {
    const url = new URL("/ws", `${getWebSocketOrigin()}/`);
    url.searchParams.set("role", "control");
    url.searchParams.set("room", controlState.roomId);
    return url.toString();
}

function getBroadcastUrl() {
    const url = new URL("/broadcastV2.html", `${getHttpOrigin()}/`);
    url.searchParams.set("room", controlState.roomId);
    return url.toString();
}

function updateSessionUI(message) {
    sessionRoomId.textContent = controlState.roomId;
    broadcastLinkInput.value = getBroadcastUrl();
    sessionHint.textContent =
        message ||
        "Use this generated link to open the broadcast page in any browser and join the same control room. Keep `npm start` running.";
}

function switchRoom(nextRoomId) {
    controlState.roomId = sanitizeRoomId(nextRoomId) || generateRoomId();

    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.set("room", controlState.roomId);
    window.history.replaceState({}, "", nextUrl);
    updateSessionUI();

    const previousSocket = controlState.socket;
    connectSocket();

    if (previousSocket && previousSocket.readyState < WebSocket.CLOSING) {
        previousSocket.close();
    }
}

function normalizeConfig(rawConfig) {
    const minNumber = clamp(Number.parseInt(rawConfig.minNumber ?? 0, 10) || 0, 0, 999);
    const maxNumber = clamp(Number.parseInt(rawConfig.maxNumber ?? 999, 10) || 999, 0, 999);
    const scriptedNumber = clamp(
        Number.parseInt(rawConfig.scriptedNumber ?? 777, 10) || 777,
        0,
        999
    );

    return {
        resolution: rawConfig.resolution === "3840x2160" ? "3840x2160" : "1920x1080",
        minNumber: Math.min(minNumber, maxNumber),
        maxNumber: Math.max(minNumber, maxNumber),
        selectionMode: rawConfig.selectionMode === "scripted" ? "scripted" : "random",
        scriptedNumber
    };
}

function sendMessage(message) {
    if (!controlState.socket || controlState.socket.readyState !== WebSocket.OPEN) {
        return;
    }

    controlState.socket.send(JSON.stringify(message));
}

function sendConfig() {
    sendMessage({
        type: "set_config",
        config: controlState.config
    });
}

function updateModeUI() {
    const scriptedMode = controlState.config.selectionMode === "scripted";
    scriptedNumberInput.disabled = !scriptedMode;
    controlHint.textContent = scriptedMode
        ? "Scripted mode sends the exact value entered. Press Knob On to trigger that number."
        : "Random mode uses the configured min and max range. Press Knob On to start the cycle.";

    for (const button of selectionModeButtons) {
        button.classList.toggle(
            "is-active",
            button.dataset.selectionMode === controlState.config.selectionMode
        );
    }
}

function updateResolutionUI() {
    for (const button of resolutionButtons) {
        button.classList.toggle(
            "is-active",
            button.dataset.resolutionOption === controlState.config.resolution
        );
    }
}

function updateStatusUI() {
    machineStatus.textContent = controlState.machineRunning ? "Running" : "Idle";
    knobToggleButton.textContent = controlState.machineRunning ? "Knob Off" : "Knob On";
    knobToggleButton.classList.toggle("is-running", controlState.machineRunning);
}

function updateResultUI() {
    if (typeof controlState.lastResult === "number") {
        lastResultNumber.textContent = String(controlState.lastResult).padStart(3, "0");
        lastResultNumber.classList.remove("is-pending");
        resultModeCaption.textContent =
            controlState.config.selectionMode === "scripted"
                ? "Latest scripted result received from the broadcast page."
                : "Latest random result received from the broadcast page.";
        return;
    }

    lastResultNumber.textContent = "---";
    lastResultNumber.classList.add("is-pending");
    resultModeCaption.textContent = "Waiting for the next run.";
}

function updateHistoryUI() {
    pickHistoryList.innerHTML = "";

    if (controlState.pickedNumbers.length === 0) {
        const emptyItem = document.createElement("li");
        emptyItem.className = "history-empty";
        emptyItem.textContent = "No picks yet.";
        pickHistoryList.appendChild(emptyItem);
        return;
    }

    controlState.pickedNumbers.forEach((value) => {
        const item = document.createElement("li");
        item.textContent = String(value).padStart(3, "0");
        pickHistoryList.appendChild(item);
    });
}

function applyState(state) {
    if (state.config) {
        controlState.config = normalizeConfig(state.config);
    } else {
        controlState.config = normalizeConfig(state);
    }

    controlState.machineRunning = Boolean(state.machineRunning);
    controlState.lastResult = typeof state.lastResult === "number" ? state.lastResult : null;
    controlState.pickedNumbers = Array.isArray(state.pickedNumbers)
        ? state.pickedNumbers.slice()
        : [];

    minNumberInput.value = String(controlState.config.minNumber);
    maxNumberInput.value = String(controlState.config.maxNumber);
    scriptedNumberInput.value = String(controlState.config.scriptedNumber);

    updateModeUI();
    updateResolutionUI();
    updateStatusUI();
    updateResultUI();
    updateHistoryUI();
}

function handleSocketMessage(event) {
    let message;
    try {
        message = JSON.parse(event.data);
    } catch {
        return;
    }

    if (message.type === "state_snapshot" || message.type === "config_update") {
        applyState(message.state || message.config || {});
        return;
    }

    if (message.type === "command_rejected") {
        resultModeCaption.textContent = message.reason || "Command rejected.";
    }
}

function connectSocket() {
    const connectionId = ++controlState.connectionId;
    const socket = new WebSocket(buildWebSocketUrl());
    controlState.socket = socket;
    connectionStatus.textContent = "Connecting";

    socket.addEventListener("open", () => {
        if (connectionId !== controlState.connectionId) {
            socket.close();
            return;
        }
        connectionStatus.textContent = "Connected";
    });

    socket.addEventListener("message", (event) => {
        if (connectionId !== controlState.connectionId) {
            return;
        }
        handleSocketMessage(event);
    });

    socket.addEventListener("close", () => {
        if (connectionId !== controlState.connectionId) {
            return;
        }
        connectionStatus.textContent = "Reconnecting";
        window.setTimeout(() => {
            if (connectionId !== controlState.connectionId) {
                return;
            }
            connectSocket();
        }, 1000);
    });
}

function normalizeRangeInputs(shouldSend = true) {
    controlState.config.minNumber = clamp(Number.parseInt(minNumberInput.value, 10) || 0, 0, 999);
    controlState.config.maxNumber = clamp(Number.parseInt(maxNumberInput.value, 10) || 999, 0, 999);

    if (controlState.config.minNumber > controlState.config.maxNumber) {
        [controlState.config.minNumber, controlState.config.maxNumber] = [
            controlState.config.maxNumber,
            controlState.config.minNumber
        ];
    }

    minNumberInput.value = String(controlState.config.minNumber);
    maxNumberInput.value = String(controlState.config.maxNumber);

    if (shouldSend) {
        sendConfig();
    }
}

function updateScriptedNumber(shouldSend = true) {
    controlState.config.scriptedNumber = clamp(
        Number.parseInt(scriptedNumberInput.value, 10) || 777,
        0,
        999
    );
    scriptedNumberInput.value = String(controlState.config.scriptedNumber);

    if (shouldSend) {
        sendConfig();
    }
}

function bindControls() {
    generateLinkButton.addEventListener("click", () => {
        switchRoom(generateRoomId());
    });

    openBroadcastButton.addEventListener("click", () => {
        window.open(getBroadcastUrl(), "_blank", "noopener");
    });

    copyBroadcastLinkButton.addEventListener("click", async () => {
        const link = getBroadcastUrl();

        try {
            await navigator.clipboard.writeText(link);
            updateSessionUI("Broadcast link copied. Open it in the other browser.");
        } catch {
            broadcastLinkInput.focus();
            broadcastLinkInput.select();
            updateSessionUI("Clipboard access failed. Copy the selected broadcast link manually.");
        }
    });

    resolutionButtons.forEach((button) => {
        button.addEventListener("click", () => {
            controlState.config.resolution = button.dataset.resolutionOption || "1920x1080";
            updateResolutionUI();
            sendConfig();
        });
    });

    selectionModeButtons.forEach((button) => {
        button.addEventListener("click", () => {
            controlState.config.selectionMode = button.dataset.selectionMode || "random";
            updateModeUI();
            sendConfig();
        });
    });

    minNumberInput.addEventListener("input", normalizeRangeInputs);
    maxNumberInput.addEventListener("input", normalizeRangeInputs);
    minNumberInput.addEventListener("change", normalizeRangeInputs);
    maxNumberInput.addEventListener("change", normalizeRangeInputs);
    scriptedNumberInput.addEventListener("input", updateScriptedNumber);
    scriptedNumberInput.addEventListener("change", updateScriptedNumber);

    knobToggleButton.addEventListener("click", () => {
        normalizeRangeInputs(false);
        updateScriptedNumber(false);
        sendConfig();

        sendMessage({
            type: "knob_command",
            action: controlState.machineRunning ? "stop" : "start",
            config: controlState.config
        });
    });

    resetHistoryButton.addEventListener("click", () => {
        sendMessage({ type: "reset_history" });
    });
}

controlState.roomId = ensureRoomId();
applyState({
    config: controlState.config,
    machineRunning: false,
    lastResult: null,
    pickedNumbers: []
});
updateSessionUI();
bindControls();
connectSocket();
