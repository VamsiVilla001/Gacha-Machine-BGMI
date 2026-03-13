const connectionStatus = document.getElementById("connection-status");
const machineStatus = document.getElementById("machine-status");
const sessionRoomId = document.getElementById("session-room-id");
const broadcastLinkInput = document.getElementById("broadcast-link-input");
const generateLinkButton = document.getElementById("generate-link-button");
const openBroadcastButton = document.getElementById("open-broadcast-button");
const copyBroadcastLinkButton = document.getElementById("copy-broadcast-link-button");
const sessionHint = document.getElementById("session-hint");
const scriptedModeButton = document.getElementById("mode-scripted-button");
const randomModeButton = document.getElementById("mode-random-button");
const rangeMinInput = document.getElementById("range-min-input");
const rangeMaxInput = document.getElementById("range-max-input");
const ticketInput = document.getElementById("ticket-input");
const ticketHelp = document.getElementById("ticket-help");
const rangeHelp = document.getElementById("range-help");
const sendResultButton = document.getElementById("send-result-button");
const clearHistoryButton = document.getElementById("clear-history-button");
const controlHint = document.getElementById("control-hint");
const lastResultNumber = document.getElementById("last-result-number");
const resultModeCaption = document.getElementById("result-mode-caption");
const pickHistoryList = document.getElementById("pick-history-list");

const FALLBACK_HTTP_ORIGIN = "http://127.0.0.1:3000";
const FALLBACK_WS_ORIGIN = "ws://127.0.0.1:3000";
const MIN_TICKET_VALUE = 0;
const MAX_TICKET_VALUE = 999;
const DEFAULT_MODE = "random";

const controlState = {
    roomId: "",
    lastTicket: null,
    history: [],
    usedTickets: [],
    mode: DEFAULT_MODE,
    rangeMin: MIN_TICKET_VALUE,
    rangeMax: MAX_TICKET_VALUE,
    usedCount: 0,
    remainingCount: MAX_TICKET_VALUE - MIN_TICKET_VALUE + 1
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

function normalizeTicket(rawTicket) {
    const digits = String(rawTicket || "")
        .replace(/\D/g, "")
        .slice(-3);

    return digits ? digits.padStart(3, "0") : null;
}

function normalizeMode(rawMode) {
    return rawMode === "scripted" ? "scripted" : "random";
}

function normalizeRangeValue(rawValue, fallbackValue) {
    const digits = String(rawValue ?? "")
        .replace(/\D/g, "")
        .slice(-3);

    if (!digits) {
        return fallbackValue;
    }

    return clamp(Number.parseInt(digits, 10), MIN_TICKET_VALUE, MAX_TICKET_VALUE);
}

function normalizeRangePair(minValue, maxValue) {
    let nextMin = normalizeRangeValue(minValue, controlState.rangeMin);
    let nextMax = normalizeRangeValue(maxValue, controlState.rangeMax);

    if (nextMin > nextMax) {
        [nextMin, nextMax] = [nextMax, nextMin];
    }

    return {
        min: nextMin,
        max: nextMax
    };
}

function formatTicketValue(value) {
    return String(clamp(Number(value) || 0, MIN_TICKET_VALUE, MAX_TICKET_VALUE)).padStart(3, "0");
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

function buildWebSocketUrl(role, roomId) {
    const url = new URL("/ws", `${getWebSocketOrigin()}/`);
    url.searchParams.set("role", role);
    url.searchParams.set("room", roomId);
    return url.toString();
}

function createSocketClient({ role, roomId, onConnectionChange }) {
    const listeners = new Map();
    let socket = null;
    let connectionId = 0;

    function dispatch(eventName, payload) {
        const handlers = listeners.get(eventName) || [];
        handlers.forEach((handler) => handler(payload));
    }

    function connect() {
        const nextConnectionId = ++connectionId;
        socket = new WebSocket(buildWebSocketUrl(role, roomId));

        if (typeof onConnectionChange === "function") {
            onConnectionChange("connecting");
        }

        socket.addEventListener("open", () => {
            if (nextConnectionId !== connectionId) {
                socket.close();
                return;
            }

            if (typeof onConnectionChange === "function") {
                onConnectionChange("connected");
            }
        });

        socket.addEventListener("message", (event) => {
            if (nextConnectionId !== connectionId) {
                return;
            }

            let message;
            try {
                message = JSON.parse(event.data);
            } catch {
                return;
            }

            if (message && typeof message.event === "string") {
                dispatch(message.event, message.data);
            }
        });

        socket.addEventListener("close", () => {
            if (nextConnectionId !== connectionId) {
                return;
            }

            if (typeof onConnectionChange === "function") {
                onConnectionChange("reconnecting");
            }

            window.setTimeout(() => {
                if (nextConnectionId !== connectionId) {
                    return;
                }

                connect();
            }, 1000);
        });
    }

    connect();

    return {
        emit(eventName, payload) {
            if (!socket || socket.readyState !== WebSocket.OPEN) {
                return false;
            }

            socket.send(JSON.stringify({
                event: eventName,
                data: payload
            }));
            return true;
        },
        on(eventName, handler) {
            const handlers = listeners.get(eventName) || [];
            handlers.push(handler);
            listeners.set(eventName, handlers);
        }
    };
}

function getBroadcastUrl() {
    const url = new URL("/broadcastV2.html", `${getHttpOrigin()}/`);
    url.searchParams.set("room", controlState.roomId);
    return url.toString();
}

function getRangeLabel() {
    return `${formatTicketValue(controlState.rangeMin)}-${formatTicketValue(controlState.rangeMax)}`;
}

function countRemainingTicketsForRange(min, max) {
    const usedTicketSet = new Set(controlState.usedTickets);
    let remainingCount = 0;

    for (let value = min; value <= max; value += 1) {
        if (!usedTicketSet.has(formatTicketValue(value))) {
            remainingCount += 1;
        }
    }

    return remainingCount;
}

function syncRangeInputs() {
    rangeMinInput.value = formatTicketValue(controlState.rangeMin);
    rangeMaxInput.value = formatTicketValue(controlState.rangeMax);
}

function updateSessionUI(message) {
    sessionRoomId.textContent = controlState.roomId;
    broadcastLinkInput.value = getBroadcastUrl();
    sessionHint.textContent =
        message ||
        "Use this generated link to open the slot-reel broadcast page in any browser or OBS browser source.";
}

function switchRoom(nextRoomId) {
    controlState.roomId = sanitizeRoomId(nextRoomId) || generateRoomId();
    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.set("room", controlState.roomId);
    window.history.replaceState({}, "", nextUrl);
    window.location.reload();
}

function setConnectionStatus(status) {
    const labelByStatus = {
        connecting: "Connecting",
        connected: "Connected",
        reconnecting: "Reconnecting"
    };

    connectionStatus.textContent = labelByStatus[status] || "Disconnected";
    machineStatus.textContent = status === "connected" ? "Ready" : "Waiting";
}

function updateModeUI() {
    const isRandom = controlState.mode === "random";

    scriptedModeButton.classList.toggle("is-active", !isRandom);
    scriptedModeButton.setAttribute("aria-pressed", String(!isRandom));
    randomModeButton.classList.toggle("is-active", isRandom);
    randomModeButton.setAttribute("aria-pressed", String(isRandom));

    ticketInput.disabled = isRandom;
    ticketInput.placeholder = isRandom ? "Auto draw" : "781";
    sendResultButton.textContent = isRandom ? "Draw Random Result" : "Send Scripted Result";

    if (isRandom) {
        ticketHelp.textContent = `Random mode draws one unused ticket from ${getRangeLabel()}.`;
        rangeHelp.textContent =
            controlState.remainingCount > 0
                ? `${controlState.remainingCount} unique ticket${controlState.remainingCount === 1 ? "" : "s"} remaining before the current range is exhausted.`
                : `No tickets remain in ${getRangeLabel()}. Clear pick memory or change the range.`;
        return;
    }

    ticketHelp.textContent = "Scripted mode sends the exact 3-digit ticket you enter to the broadcast room.";
    rangeHelp.textContent =
        controlState.usedCount > 0
            ? `Persistent pick memory currently tracks ${controlState.usedCount} used ticket${controlState.usedCount === 1 ? "" : "s"} for future random draws.`
            : "Persistent pick memory is empty. Random mode can use the full active range.";
}

function updateResultUI() {
    if (controlState.lastTicket) {
        lastResultNumber.textContent = controlState.lastTicket;
        lastResultNumber.classList.remove("is-pending");

        if (controlState.mode === "random") {
            resultModeCaption.textContent = `Latest random draw from ${getRangeLabel()}. ${controlState.remainingCount} unique ticket${controlState.remainingCount === 1 ? "" : "s"} remaining.`;
            return;
        }

        resultModeCaption.textContent = "Latest scripted ticket sent to the broadcast room.";
        return;
    }

    lastResultNumber.textContent = "---";
    lastResultNumber.classList.add("is-pending");

    if (controlState.mode === "random") {
        resultModeCaption.textContent = `Waiting for a random draw. ${controlState.remainingCount} ticket${controlState.remainingCount === 1 ? "" : "s"} available in ${getRangeLabel()}.`;
        return;
    }

    resultModeCaption.textContent = "Waiting for the next scripted ticket.";
}

function updateHistoryUI() {
    pickHistoryList.innerHTML = "";

    if (controlState.history.length === 0) {
        const emptyItem = document.createElement("li");
        emptyItem.className = "history-empty";
        emptyItem.textContent = "No tickets sent yet.";
        pickHistoryList.appendChild(emptyItem);
        return;
    }

    controlState.history.forEach((ticket) => {
        const item = document.createElement("li");
        item.textContent = ticket;
        pickHistoryList.appendChild(item);
    });
}

function applyState(state) {
    if (!state || typeof state !== "object") {
        return;
    }

    controlState.lastTicket = typeof state.lastTicket === "string" ? normalizeTicket(state.lastTicket) : null;
    controlState.history = Array.isArray(state.history)
        ? state.history.map((ticket) => normalizeTicket(ticket)).filter(Boolean)
        : [];
    controlState.usedTickets = Array.isArray(state.usedTickets)
        ? Array.from(new Set(state.usedTickets.map((ticket) => normalizeTicket(ticket)).filter(Boolean)))
        : Array.from(new Set(controlState.history));

    controlState.mode = normalizeMode(state.settings?.mode ?? controlState.mode);

    const nextRange = normalizeRangePair(
        state.settings?.min ?? controlState.rangeMin,
        state.settings?.max ?? controlState.rangeMax
    );

    controlState.rangeMin = nextRange.min;
    controlState.rangeMax = nextRange.max;

    const parsedUsedCount = Number.parseInt(String(state.usedCount ?? ""), 10);
    const fallbackUsedCount = controlState.usedTickets.length;
    controlState.usedCount = Number.isFinite(parsedUsedCount) ? Math.max(0, parsedUsedCount) : fallbackUsedCount;

    const parsedRemainingCount = Number.parseInt(String(state.remainingCount ?? ""), 10);
    const fallbackRemainingCount = countRemainingTicketsForRange(controlState.rangeMin, controlState.rangeMax);
    controlState.remainingCount = Number.isFinite(parsedRemainingCount)
        ? Math.max(0, parsedRemainingCount)
        : fallbackRemainingCount;

    syncRangeInputs();
    updateModeUI();
    updateResultUI();
    updateHistoryUI();

    if (connectionStatus.textContent === "Connected") {
        machineStatus.textContent = "Ready";
    }
}

function commitRangeInputs() {
    const nextRange = normalizeRangePair(rangeMinInput.value, rangeMaxInput.value);
    controlState.rangeMin = nextRange.min;
    controlState.rangeMax = nextRange.max;
    controlState.remainingCount = countRemainingTicketsForRange(controlState.rangeMin, controlState.rangeMax);
    syncRangeInputs();
    updateModeUI();
    updateResultUI();
}

function sanitizeNumericInput(inputNode) {
    inputNode.value = String(inputNode.value || "")
        .replace(/\D/g, "")
        .slice(0, 3);
}

function bindControls(socket) {
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
            updateSessionUI("Broadcast link copied. Open it in the other window.");
        } catch {
            broadcastLinkInput.focus();
            broadcastLinkInput.select();
            updateSessionUI("Clipboard access failed. Copy the selected broadcast link manually.");
        }
    });

    scriptedModeButton.addEventListener("click", () => {
        controlState.mode = "scripted";
        updateModeUI();
        updateResultUI();
    });

    randomModeButton.addEventListener("click", () => {
        controlState.mode = "random";
        updateModeUI();
        updateResultUI();
    });

    [rangeMinInput, rangeMaxInput].forEach((inputNode) => {
        inputNode.addEventListener("input", () => {
            sanitizeNumericInput(inputNode);
        });

        inputNode.addEventListener("blur", () => {
            commitRangeInputs();
        });
    });

    ticketInput.addEventListener("input", () => {
        sanitizeNumericInput(ticketInput);
    });

    ticketInput.addEventListener("blur", () => {
        const normalizedTicket = normalizeTicket(ticketInput.value);
        if (normalizedTicket) {
            ticketInput.value = normalizedTicket;
        }
    });

    ticketInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
            event.preventDefault();
            sendResultButton.click();
        }
    });

    sendResultButton.addEventListener("click", () => {
        commitRangeInputs();

        if (controlState.mode === "random" && controlState.remainingCount === 0) {
            controlHint.textContent = `No tickets remain in ${getRangeLabel()}. Clear pick memory or change the range.`;
            return;
        }

        const payload = {
            mode: controlState.mode,
            min: controlState.rangeMin,
            max: controlState.rangeMax
        };

        if (controlState.mode === "scripted") {
            const normalizedTicket = normalizeTicket(ticketInput.value);
            if (!normalizedTicket) {
                controlHint.textContent = "Enter a scripted ticket before sending it to the broadcast room.";
                ticketInput.focus();
                return;
            }

            ticketInput.value = normalizedTicket;
            payload.ticket = normalizedTicket;
        }

        const sent = socket.emit("result", payload);
        if (!sent) {
            controlHint.textContent = "Socket is still reconnecting. Wait for the connection to return.";
            return;
        }

        machineStatus.textContent = "Drawing";
        controlHint.textContent = controlState.mode === "random"
            ? `Random draw requested for ${getRangeLabel()} in room ${controlState.roomId}.`
            : `Scripted ticket ${payload.ticket} sent to room ${controlState.roomId}.`;
    });

    clearHistoryButton.addEventListener("click", () => {
        const sent = socket.emit("clear_history", {});
        if (!sent) {
            controlHint.textContent = "Socket is still reconnecting. Wait before clearing pick memory.";
            return;
        }

        controlHint.textContent = "Pick history and persistent random memory reset requested for this room.";
    });
}

controlState.roomId = ensureRoomId();
updateSessionUI();
syncRangeInputs();
updateModeUI();
updateResultUI();
updateHistoryUI();

const socket = createSocketClient({
    role: "control",
    roomId: controlState.roomId,
    onConnectionChange: setConnectionStatus
});

socket.on("state", (state) => {
    applyState(state);
});

socket.on("error", (payload) => {
    machineStatus.textContent = "Blocked";
    controlHint.textContent = payload?.message || "Unable to send the current result.";
});

bindControls(socket);
