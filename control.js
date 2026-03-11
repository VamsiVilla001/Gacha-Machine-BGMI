const connectionStatus = document.getElementById("connection-status");
const machineStatus = document.getElementById("machine-status");
const sessionRoomId = document.getElementById("session-room-id");
const broadcastLinkInput = document.getElementById("broadcast-link-input");
const generateLinkButton = document.getElementById("generate-link-button");
const openBroadcastButton = document.getElementById("open-broadcast-button");
const copyBroadcastLinkButton = document.getElementById("copy-broadcast-link-button");
const sessionHint = document.getElementById("session-hint");
const ticketInput = document.getElementById("ticket-input");
const sendResultButton = document.getElementById("send-result-button");
const clearHistoryButton = document.getElementById("clear-history-button");
const controlHint = document.getElementById("control-hint");
const lastResultNumber = document.getElementById("last-result-number");
const resultModeCaption = document.getElementById("result-mode-caption");
const pickHistoryList = document.getElementById("pick-history-list");

const FALLBACK_HTTP_ORIGIN = "http://127.0.0.1:3000";
const FALLBACK_WS_ORIGIN = "ws://127.0.0.1:3000";

const controlState = {
    roomId: "",
    lastTicket: null,
    history: []
};

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

function updateResultUI() {
    if (controlState.lastTicket) {
        lastResultNumber.textContent = controlState.lastTicket;
        lastResultNumber.classList.remove("is-pending");
        resultModeCaption.textContent = "Latest ticket sent to the broadcast room.";
        return;
    }

    lastResultNumber.textContent = "---";
    lastResultNumber.classList.add("is-pending");
    resultModeCaption.textContent = "Waiting for the next result.";
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

    controlState.lastTicket = typeof state.lastTicket === "string" ? state.lastTicket : null;
    controlState.history = Array.isArray(state.history)
        ? state.history.map((ticket) => normalizeTicket(ticket)).filter(Boolean)
        : [];

    updateResultUI();
    updateHistoryUI();
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

    ticketInput.addEventListener("input", () => {
        ticketInput.value = String(ticketInput.value || "")
            .replace(/\D/g, "")
            .slice(0, 3);
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
        const normalizedTicket = normalizeTicket(ticketInput.value);
        if (!normalizedTicket) {
            controlHint.textContent = "Enter a ticket before sending it to the broadcast room.";
            ticketInput.focus();
            return;
        }

        ticketInput.value = normalizedTicket;
        const sent = socket.emit("result", { ticket: normalizedTicket });
        if (!sent) {
            controlHint.textContent = "Socket is still reconnecting. Wait for the connection to return.";
            return;
        }

        machineStatus.textContent = "Sent";
        controlHint.textContent = `Result ${normalizedTicket} sent to room ${controlState.roomId}.`;
    });

    clearHistoryButton.addEventListener("click", () => {
        socket.emit("clear_history", {});
        controlHint.textContent = "History reset requested for this room.";
    });
}

controlState.roomId = ensureRoomId();
updateSessionUI();
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
    controlHint.textContent = payload?.message || "Unable to send the current result.";
});

bindControls(socket);
