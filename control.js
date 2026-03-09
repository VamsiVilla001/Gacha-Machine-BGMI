const WS_URL = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws?role=control`;

const connectionStatus = document.getElementById("connection-status");
const machineStatus = document.getElementById("machine-status");
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

const controlState = {
    socket: null,
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
    controlState.lastResult =
        typeof state.lastResult === "number" ? state.lastResult : controlState.lastResult;
    controlState.pickedNumbers = Array.isArray(state.pickedNumbers)
        ? state.pickedNumbers.slice()
        : controlState.pickedNumbers;

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
    const socket = new WebSocket(WS_URL);
    controlState.socket = socket;

    socket.addEventListener("open", () => {
        connectionStatus.textContent = "Connected";
    });

    socket.addEventListener("message", handleSocketMessage);

    socket.addEventListener("close", () => {
        connectionStatus.textContent = "Reconnecting";
        window.setTimeout(connectSocket, 1000);
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

applyState({
    config: controlState.config,
    machineRunning: false,
    lastResult: null,
    pickedNumbers: []
});
bindControls();
connectSocket();
