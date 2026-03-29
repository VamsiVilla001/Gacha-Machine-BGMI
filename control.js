const controlShell = document.getElementById("control-shell");
const connectionStatus = document.getElementById("connection-status");
const machineStatus = document.getElementById("machine-status");
const sessionRoomLabel = document.getElementById("session-room-label");
const sessionRoomId = document.getElementById("session-room-id");
const broadcastLinkLabel = document.getElementById("broadcast-link-label");
const broadcastLinkInput = document.getElementById("broadcast-link-input");
const generateLinkButton = document.getElementById("generate-link-button");
const openBroadcastGoldButton = document.getElementById("open-broadcast-gold-button");
const openBroadcastSilverButton = document.getElementById("open-broadcast-silver-button");
const copyBroadcastLinkButton = document.getElementById("copy-broadcast-link-button");
const sessionHint = document.getElementById("session-hint");
const showGoldButton = document.getElementById("show-gold-button");
const showSilverButton = document.getElementById("show-silver-button");
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
const subtitlePanel = document.getElementById("subtitle-panel");
const subtitleInput = document.getElementById("subtitle-input");
const sendSubtitleButton = document.getElementById("send-subtitle-button");
const clearSubtitleButton = document.getElementById("clear-subtitle-button");
const subtitleHint = document.getElementById("subtitle-hint");

const FALLBACK_HTTP_ORIGIN = "http://127.0.0.1:3000";
const FALLBACK_WS_ORIGIN = "ws://127.0.0.1:3000";
const MIN_TICKET_VALUE = 0;
const MAX_TICKET_VALUE = 9999;
const DEFAULT_MODE = "random";
const DEFAULT_SHOW_KEY = "gold";
const SHOW_CONFIG = Object.freeze({
    gold: {
        label: "Gold",
        queryKey: "goldRoom",
        broadcastPath: "/broadcastV2.html"
    },
    silver: {
        label: "Silver",
        queryKey: "silverRoom",
        broadcastPath: "/broadcastV3.html"
    }
});

function createShowState() {
    return {
        roomId: "",
        lastTicket: null,
        history: [],
        usedTickets: [],
        mode: DEFAULT_MODE,
        rangeMin: MIN_TICKET_VALUE,
        rangeMax: MAX_TICKET_VALUE,
        usedCount: 0,
        remainingCount: MAX_TICKET_VALUE - MIN_TICKET_VALUE + 1,
        subtitle: "",
        connectionStatus: "connecting",
        machineStatus: "Waiting"
    };
}

const controlState = {
    activeShow: DEFAULT_SHOW_KEY,
    shows: {
        gold: createShowState(),
        silver: createShowState()
    }
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

function sanitizeShowKey(rawShowKey) {
    return rawShowKey === "silver" ? "silver" : DEFAULT_SHOW_KEY;
}

function normalizeTicket(rawTicket) {
    const digits = String(rawTicket || "")
        .replace(/\D/g, "")
        .slice(-4);

    return digits ? digits.padStart(4, "0") : null;
}

function normalizeMode(rawMode) {
    return rawMode === "scripted" ? "scripted" : "random";
}

function normalizeRangeValue(rawValue, fallbackValue) {
    const digits = String(rawValue ?? "")
        .replace(/\D/g, "")
        .slice(-4);

    if (!digits) {
        return fallbackValue;
    }

    return clamp(Number.parseInt(digits, 10), MIN_TICKET_VALUE, MAX_TICKET_VALUE);
}

function normalizeRangePair(minValue, maxValue, fallbackMin, fallbackMax) {
    let nextMin = normalizeRangeValue(minValue, fallbackMin);
    let nextMax = normalizeRangeValue(maxValue, fallbackMax);

    if (nextMin > nextMax) {
        [nextMin, nextMax] = [nextMax, nextMin];
    }

    return {
        min: nextMin,
        max: nextMax
    };
}

function formatTicketValue(value) {
    return String(clamp(Number(value) || 0, MIN_TICKET_VALUE, MAX_TICKET_VALUE)).padStart(4, "0");
}

function generateRoomId() {
    if (window.crypto?.randomUUID) {
        return sanitizeRoomId(window.crypto.randomUUID());
    }

    return sanitizeRoomId(`room-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);
}

function getShowState(showKey) {
    return controlState.shows[sanitizeShowKey(showKey)];
}

function getActiveShowState() {
    return getShowState(controlState.activeShow);
}

function ensureShowContext() {
    const url = new URL(window.location.href);
    let changed = false;

    const legacyRoomId = sanitizeRoomId(url.searchParams.get("room"));
    if (legacyRoomId && !sanitizeRoomId(url.searchParams.get(SHOW_CONFIG.gold.queryKey))) {
        url.searchParams.set(SHOW_CONFIG.gold.queryKey, legacyRoomId);
        changed = true;
    }

    if (url.searchParams.has("room")) {
        url.searchParams.delete("room");
        changed = true;
    }

    Object.entries(SHOW_CONFIG).forEach(([showKey, config]) => {
        const existingRoomId = sanitizeRoomId(url.searchParams.get(config.queryKey));
        const nextRoomId = existingRoomId || generateRoomId();
        controlState.shows[showKey].roomId = nextRoomId;

        if (existingRoomId !== nextRoomId) {
            url.searchParams.set(config.queryKey, nextRoomId);
            changed = true;
        }
    });

    const activeShow = sanitizeShowKey(url.searchParams.get("show"));
    controlState.activeShow = activeShow;

    if (url.searchParams.get("show") !== activeShow) {
        url.searchParams.set("show", activeShow);
        changed = true;
    }

    if (changed) {
        window.history.replaceState({}, "", url);
    }
}

function updateUrlForActiveShow() {
    const url = new URL(window.location.href);
    url.searchParams.set("show", controlState.activeShow);
    window.history.replaceState({}, "", url);
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

function buildWebSocketUrl(role, showKey, roomId) {
    const url = new URL("/ws", `${getWebSocketOrigin()}/`);
    url.searchParams.set("role", role);
    url.searchParams.set("show", sanitizeShowKey(showKey));
    url.searchParams.set("room", roomId);
    return url.toString();
}

function createSocketClient({ role, showKey, roomId, onConnectionChange }) {
    const listeners = new Map();
    let socket = null;
    let connectionId = 0;

    function dispatch(eventName, payload) {
        const handlers = listeners.get(eventName) || [];
        handlers.forEach((handler) => handler(payload));
    }

    function connect() {
        const nextConnectionId = ++connectionId;
        socket = new WebSocket(buildWebSocketUrl(role, showKey, roomId));

        if (typeof onConnectionChange === "function") {
            onConnectionChange(showKey, "connecting");
        }

        socket.addEventListener("open", () => {
            if (nextConnectionId !== connectionId) {
                socket.close();
                return;
            }

            if (typeof onConnectionChange === "function") {
                onConnectionChange(showKey, "connected");
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
                onConnectionChange(showKey, "reconnecting");
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

function getBroadcastUrl(showKey) {
    const normalizedShowKey = sanitizeShowKey(showKey);
    const showState = getShowState(normalizedShowKey);
    const url = new URL(SHOW_CONFIG[normalizedShowKey].broadcastPath, `${getHttpOrigin()}/`);
    url.searchParams.set("room", showState.roomId);
    url.searchParams.set("show", normalizedShowKey);
    return url.toString();
}

function getRangeLabel(showState) {
    return `${formatTicketValue(showState.rangeMin)}-${formatTicketValue(showState.rangeMax)}`;
}

function countRemainingTicketsForRange(showState, minValue = showState.rangeMin, maxValue = showState.rangeMax) {
    const usedTicketSet = new Set(showState.usedTickets);
    let remainingCount = 0;

    for (let value = minValue; value <= maxValue; value += 1) {
        if (!usedTicketSet.has(formatTicketValue(value))) {
            remainingCount += 1;
        }
    }

    return remainingCount;
}

function syncRangeInputs() {
    const showState = getActiveShowState();
    rangeMinInput.value = formatTicketValue(showState.rangeMin);
    rangeMaxInput.value = formatTicketValue(showState.rangeMax);
}

function updateSessionUI(message) {
    const activeShowKey = controlState.activeShow;
    const activeShowConfig = SHOW_CONFIG[activeShowKey];
    const activeShowState = getActiveShowState();

    sessionRoomLabel.textContent = `${activeShowConfig.label} Room ID`;
    broadcastLinkLabel.textContent = `${activeShowConfig.label} Broadcast Link`;
    sessionRoomId.textContent = activeShowState.roomId;
    broadcastLinkInput.value = getBroadcastUrl(activeShowKey);
    sessionHint.textContent =
        message ||
        `${activeShowConfig.label} is active. Gold uses broadcastV2 and Silver uses broadcastV3. Each show has its own room and pick memory.`;
}

function updateStatusUI() {
    const showState = getActiveShowState();
    const labelByStatus = {
        connecting: "Connecting",
        connected: "Connected",
        reconnecting: "Reconnecting"
    };

    connectionStatus.textContent = labelByStatus[showState.connectionStatus] || "Disconnected";
    machineStatus.textContent = showState.machineStatus;
}

function updateShowButtonsUI() {
    if (controlShell) {
        controlShell.dataset.activeShow = controlState.activeShow;
    }

    showGoldButton.classList.toggle("is-active", controlState.activeShow === "gold");
    showGoldButton.setAttribute("aria-pressed", String(controlState.activeShow === "gold"));
    showSilverButton.classList.toggle("is-active", controlState.activeShow === "silver");
    showSilverButton.setAttribute("aria-pressed", String(controlState.activeShow === "silver"));
}

function updateModeUI() {
    const showKey = controlState.activeShow;
    const showState = getActiveShowState();
    const showLabel = SHOW_CONFIG[showKey].label;
    const isRandom = showState.mode === "random";

    scriptedModeButton.classList.toggle("is-active", !isRandom);
    scriptedModeButton.setAttribute("aria-pressed", String(!isRandom));
    randomModeButton.classList.toggle("is-active", isRandom);
    randomModeButton.setAttribute("aria-pressed", String(isRandom));

    ticketInput.disabled = isRandom;
    ticketInput.placeholder = isRandom ? "Auto draw" : "0781";
    sendResultButton.textContent = isRandom ? `Draw ${showLabel} Result` : `Send ${showLabel} Ticket`;

    if (isRandom) {
        ticketHelp.textContent = `${showLabel} random mode draws one unused ticket from ${getRangeLabel(showState)}.`;
        rangeHelp.textContent =
            showState.remainingCount > 0
                ? `${showState.remainingCount} unique ticket${showState.remainingCount === 1 ? "" : "s"} remaining for ${showLabel.toLowerCase()}.`
                : `No tickets remain in ${getRangeLabel(showState)} for ${showLabel.toLowerCase()}. Clear pick memory or change the range.`;
        return;
    }

    ticketHelp.textContent = `${showLabel} scripted mode sends the exact 4-digit ticket you enter to that broadcast room.`;
    rangeHelp.textContent =
        showState.usedCount > 0
            ? `${showLabel} pick memory currently tracks ${showState.usedCount} used ticket${showState.usedCount === 1 ? "" : "s"} for future random draws.`
            : `${showLabel} pick memory is empty. Random mode can use the full active range.`;
}

function updateResultUI() {
    const showKey = controlState.activeShow;
    const showState = getActiveShowState();
    const showLabel = SHOW_CONFIG[showKey].label;

    if (showState.lastTicket) {
        lastResultNumber.textContent = showState.lastTicket;
        lastResultNumber.classList.remove("is-pending");

        if (showState.mode === "random") {
            resultModeCaption.textContent = `${showLabel} latest random draw from ${getRangeLabel(showState)}. ${showState.remainingCount} unique ticket${showState.remainingCount === 1 ? "" : "s"} remaining.`;
            return;
        }

        resultModeCaption.textContent = `${showLabel} latest scripted ticket sent to the broadcast room.`;
        return;
    }

    lastResultNumber.textContent = "---";
    lastResultNumber.classList.add("is-pending");

    if (showState.mode === "random") {
        resultModeCaption.textContent = `Waiting for a ${showLabel.toLowerCase()} random draw. ${showState.remainingCount} ticket${showState.remainingCount === 1 ? "" : "s"} available in ${getRangeLabel(showState)}.`;
        return;
    }

    resultModeCaption.textContent = `Waiting for the next ${showLabel.toLowerCase()} scripted ticket.`;
}

function updateHistoryUI() {
    const showState = getActiveShowState();
    pickHistoryList.innerHTML = "";

    if (showState.history.length === 0) {
        const emptyItem = document.createElement("li");
        emptyItem.className = "history-empty";
        emptyItem.textContent = "No tickets sent yet.";
        pickHistoryList.appendChild(emptyItem);
        return;
    }

    showState.history.forEach((ticket) => {
        const item = document.createElement("li");
        item.textContent = ticket;
        pickHistoryList.appendChild(item);
    });
}

function updateSubtitleUI() {
    subtitlePanel.hidden = false;
    subtitleInput.disabled = false;
    sendSubtitleButton.disabled = false;
    clearSubtitleButton.disabled = false;
    subtitleInput.value = getActiveShowState().subtitle || "";
}

function refreshActiveShowUI(sessionMessage) {
    updateShowButtonsUI();
    syncRangeInputs();
    updateSessionUI(sessionMessage);
    updateModeUI();
    updateResultUI();
    updateHistoryUI();
    updateStatusUI();
    updateSubtitleUI();
}

function applyState(showKey, state) {
    if (!state || typeof state !== "object") {
        return;
    }

    const showState = getShowState(showKey);

    if (typeof state.roomId === "string") {
        showState.roomId = sanitizeRoomId(state.roomId) || showState.roomId;
    }

    showState.lastTicket = typeof state.lastTicket === "string" ? normalizeTicket(state.lastTicket) : null;
    showState.history = Array.isArray(state.history)
        ? state.history.map((ticket) => normalizeTicket(ticket)).filter(Boolean)
        : [];
    showState.usedTickets = Array.isArray(state.usedTickets)
        ? Array.from(new Set(state.usedTickets.map((ticket) => normalizeTicket(ticket)).filter(Boolean)))
        : Array.from(new Set(showState.history));
    showState.subtitle = typeof state.subtitle === "string" ? state.subtitle : "";
    showState.mode = normalizeMode(state.settings?.mode ?? showState.mode);

    const nextRange = normalizeRangePair(
        state.settings?.min ?? showState.rangeMin,
        state.settings?.max ?? showState.rangeMax,
        showState.rangeMin,
        showState.rangeMax
    );

    showState.rangeMin = nextRange.min;
    showState.rangeMax = nextRange.max;

    const parsedUsedCount = Number.parseInt(String(state.usedCount ?? ""), 10);
    showState.usedCount = Number.isFinite(parsedUsedCount) ? Math.max(0, parsedUsedCount) : showState.usedTickets.length;

    const parsedRemainingCount = Number.parseInt(String(state.remainingCount ?? ""), 10);
    showState.remainingCount = Number.isFinite(parsedRemainingCount)
        ? Math.max(0, parsedRemainingCount)
        : countRemainingTicketsForRange(showState);

    if (showState.connectionStatus === "connected") {
        showState.machineStatus = "Ready";
    }

    if (controlState.activeShow === sanitizeShowKey(showKey)) {
        refreshActiveShowUI();
    }
}

function commitRangeInputs() {
    const showState = getActiveShowState();
    const nextRange = normalizeRangePair(
        rangeMinInput.value,
        rangeMaxInput.value,
        showState.rangeMin,
        showState.rangeMax
    );

    showState.rangeMin = nextRange.min;
    showState.rangeMax = nextRange.max;
    showState.remainingCount = countRemainingTicketsForRange(showState);
    syncRangeInputs();
    updateModeUI();
    updateResultUI();
}

function sanitizeNumericInput(inputNode) {
    inputNode.value = String(inputNode.value || "")
        .replace(/\D/g, "")
        .slice(0, 4);
}

function setActiveShow(showKey) {
    controlState.activeShow = sanitizeShowKey(showKey);
    updateUrlForActiveShow();
    refreshActiveShowUI();
    controlHint.textContent = `This panel is ready to send results to the ${SHOW_CONFIG[controlState.activeShow].label.toLowerCase()} room.`;
    subtitleHint.textContent = "Sets the subtitle text shown on the broadcast overlay.";
}

function setConnectionStatus(showKey, status) {
    const showState = getShowState(showKey);
    showState.connectionStatus = status;

    if (status === "connected") {
        showState.machineStatus = "Ready";
    } else if (showState.machineStatus !== "Blocked") {
        showState.machineStatus = "Waiting";
    }

    if (controlState.activeShow === sanitizeShowKey(showKey)) {
        updateStatusUI();
    }
}

function bindControls(sockets) {
    generateLinkButton.addEventListener("click", () => {
        const url = new URL(window.location.href);

        Object.entries(SHOW_CONFIG).forEach(([showKey, config]) => {
            const nextRoomId = generateRoomId();
            controlState.shows[showKey].roomId = nextRoomId;
            url.searchParams.set(config.queryKey, nextRoomId);
        });

        url.searchParams.set("show", controlState.activeShow);
        window.history.replaceState({}, "", url);
        window.location.reload();
    });

    openBroadcastGoldButton.addEventListener("click", () => {
        window.open(getBroadcastUrl("gold"), "_blank", "noopener");
    });

    openBroadcastSilverButton.addEventListener("click", () => {
        window.open(getBroadcastUrl("silver"), "_blank", "noopener");
    });

    copyBroadcastLinkButton.addEventListener("click", async () => {
        const link = getBroadcastUrl(controlState.activeShow);

        try {
            await navigator.clipboard.writeText(link);
            updateSessionUI(`${SHOW_CONFIG[controlState.activeShow].label} broadcast link copied.`);
        } catch {
            broadcastLinkInput.focus();
            broadcastLinkInput.select();
            updateSessionUI("Clipboard access failed. Copy the selected broadcast link manually.");
        }
    });

    showGoldButton.addEventListener("click", () => {
        setActiveShow("gold");
    });

    showSilverButton.addEventListener("click", () => {
        setActiveShow("silver");
    });

    scriptedModeButton.addEventListener("click", () => {
        getActiveShowState().mode = "scripted";
        updateModeUI();
        updateResultUI();
    });

    randomModeButton.addEventListener("click", () => {
        getActiveShowState().mode = "random";
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
        const showKey = controlState.activeShow;
        const showLabel = SHOW_CONFIG[showKey].label;
        const showState = getActiveShowState();
        commitRangeInputs();

        if (showState.mode === "random" && showState.remainingCount === 0) {
            controlHint.textContent = `No tickets remain in ${getRangeLabel(showState)} for ${showLabel.toLowerCase()}. Clear pick memory or change the range.`;
            return;
        }

        const payload = {
            mode: showState.mode,
            min: showState.rangeMin,
            max: showState.rangeMax
        };

        if (showState.mode === "scripted") {
            const normalizedTicket = normalizeTicket(ticketInput.value);
            if (!normalizedTicket) {
                controlHint.textContent = `Enter a scripted ticket before sending it to the ${showLabel.toLowerCase()} broadcast room.`;
                ticketInput.focus();
                return;
            }

            ticketInput.value = normalizedTicket;
            payload.ticket = normalizedTicket;
        }

        const sent = sockets[showKey].emit("result", payload);
        if (!sent) {
            controlHint.textContent = `${showLabel} socket is still reconnecting. Wait for the connection to return.`;
            return;
        }

        showState.machineStatus = "Drawing";
        updateStatusUI();
        controlHint.textContent = showState.mode === "random"
            ? `${showLabel} random draw requested for ${getRangeLabel(showState)} in room ${showState.roomId}.`
            : `${showLabel} scripted ticket ${payload.ticket} sent to room ${showState.roomId}.`;
    });

    clearHistoryButton.addEventListener("click", () => {
        const showKey = controlState.activeShow;
        const showLabel = SHOW_CONFIG[showKey].label;
        const sent = sockets[showKey].emit("clear_history", {});

        if (!sent) {
            controlHint.textContent = `${showLabel} socket is still reconnecting. Wait before clearing pick memory.`;
            return;
        }

        controlHint.textContent = `${showLabel} pick history and random memory reset requested for this room.`;
    });

    sendSubtitleButton.addEventListener("click", () => {
        const showKey = controlState.activeShow;
        const showLabel = SHOW_CONFIG[showKey].label;
        const showState = getActiveShowState();
        const text = (subtitleInput.value || "").trim();
        const sent = sockets[showKey].emit("subtitle", { text });

        if (!sent) {
            subtitleHint.textContent = `${showLabel} socket is still reconnecting. Wait for the connection to return.`;
            return;
        }

        showState.subtitle = text;
        subtitleHint.textContent = text ? `${showLabel} subtitle updated.` : `${showLabel} subtitle cleared.`;
    });

    clearSubtitleButton.addEventListener("click", () => {
        const showKey = controlState.activeShow;
        const showLabel = SHOW_CONFIG[showKey].label;
        subtitleInput.value = "";

        const sent = sockets[showKey].emit("subtitle", { text: "" });
        if (!sent) {
            subtitleHint.textContent = `${showLabel} socket is still reconnecting. Wait for the connection to return.`;
            return;
        }

        getActiveShowState().subtitle = "";
        subtitleHint.textContent = `${showLabel} subtitle cleared on the broadcast.`;
    });

    subtitleInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
            event.preventDefault();
            sendSubtitleButton.click();
        }
    });
}

ensureShowContext();
refreshActiveShowUI();
controlHint.textContent = `This panel is ready to send results to the ${SHOW_CONFIG[controlState.activeShow].label.toLowerCase()} room.`;

const sockets = Object.fromEntries(Object.keys(SHOW_CONFIG).map((showKey) => ([
    showKey,
    createSocketClient({
        role: "control",
        showKey,
        roomId: getShowState(showKey).roomId,
        onConnectionChange: setConnectionStatus
    })
])));

Object.keys(SHOW_CONFIG).forEach((showKey) => {
    sockets[showKey].on("state", (state) => {
        applyState(showKey, state);
    });

    sockets[showKey].on("error", (payload) => {
        const showState = getShowState(showKey);
        showState.machineStatus = "Blocked";

        if (controlState.activeShow === showKey) {
            updateStatusUI();
            controlHint.textContent = payload?.message || `Unable to send the current ${SHOW_CONFIG[showKey].label.toLowerCase()} result.`;
        }
    });
});

bindControls(sockets);

// ── CCV Counter ───────────────────────────────────────────────────────────────

const ccvTitleInput        = document.getElementById("ccv-title-input");
const ccvSendTitleButton   = document.getElementById("ccv-send-title-button");
const ccvClearTitleButton  = document.getElementById("ccv-clear-title-button");
const ccvTargetInput       = document.getElementById("ccv-target-input");
const ccvStartButton       = document.getElementById("ccv-start-button");
const ccvStopButton        = document.getElementById("ccv-stop-button");
const ccvBroadcastLinkInput = document.getElementById("ccv-broadcast-link");
const ccvOpenButton        = document.getElementById("ccv-open-button");
const ccvCopyButton        = document.getElementById("ccv-copy-button");
const ccvConnectionStatus  = document.getElementById("ccv-connection-status");
const ccvHint              = document.getElementById("ccv-hint");

const ccvControlState = {
    roomId: "",
    target: 0,
    running: false,
    connectionStatus: "connecting"
};

function initCcvRoom() {
    const url = new URL(window.location.href);
    let roomId = sanitizeRoomId(url.searchParams.get("ccvRoom"));
    if (!roomId) {
        roomId = generateRoomId();
        url.searchParams.set("ccvRoom", roomId);
        window.history.replaceState({}, "", url);
    }
    ccvControlState.roomId = roomId;
}

function buildCcvBroadcastUrl() {
    const url = new URL("/broadcastCCV.html", `${getHttpOrigin()}/`);
    url.searchParams.set("room", ccvControlState.roomId);
    url.searchParams.set("show", "ccv");
    return url.toString();
}

function buildCcvWsUrl() {
    const url = new URL("/ws", `${getWebSocketOrigin()}/`);
    url.searchParams.set("role", "control");
    url.searchParams.set("show", "ccv");
    url.searchParams.set("room", ccvControlState.roomId);
    return url.toString();
}

function updateCcvStatusUI() {
    const labels = { connecting: "Connecting", connected: "Connected", reconnecting: "Reconnecting" };
    ccvConnectionStatus.textContent = labels[ccvControlState.connectionStatus] || "Disconnected";
    ccvBroadcastLinkInput.value = buildCcvBroadcastUrl();
}

function createCcvSocket() {
    let socket = null;
    let connId = 0;

    function connect() {
        const thisId = ++connId;
        socket = new WebSocket(buildCcvWsUrl());
        ccvControlState.connectionStatus = "connecting";
        updateCcvStatusUI();

        socket.addEventListener("open", () => {
            if (thisId !== connId) { socket.close(); return; }
            ccvControlState.connectionStatus = "connected";
            updateCcvStatusUI();
        });

        socket.addEventListener("message", (event) => {
            if (thisId !== connId) return;
            let msg;
            try { msg = JSON.parse(event.data); } catch { return; }
            if (msg && msg.event === "ccv_state" && msg.data) {
                ccvControlState.target  = msg.data.target  || 0;
                ccvControlState.running = msg.data.running || false;
                if (typeof msg.data.title === "string" && ccvTitleInput.value === "") {
                    ccvTitleInput.value = msg.data.title;
                }
            }
        });

        socket.addEventListener("close", () => {
            if (thisId !== connId) return;
            ccvControlState.connectionStatus = "reconnecting";
            updateCcvStatusUI();
            window.setTimeout(() => { if (thisId === connId) connect(); }, 1000);
        });
    }

    connect();

    return {
        emit(data) {
            if (!socket || socket.readyState !== WebSocket.OPEN) return false;
            socket.send(JSON.stringify({ event: "ccv_update", data }));
            return true;
        }
    };
}

initCcvRoom();
updateCcvStatusUI();
const ccvSocket = createCcvSocket();

ccvSendTitleButton.addEventListener("click", () => {
    const title = (ccvTitleInput.value || "").trim();
    if (!ccvSocket.emit({ title, target: ccvControlState.target, running: ccvControlState.running })) {
        ccvHint.textContent = "CCV socket is reconnecting. Try again shortly.";
        return;
    }
    ccvHint.textContent = title ? `Title updated: "${title}"` : "Title cleared on broadcast.";
});

ccvClearTitleButton.addEventListener("click", () => {
    ccvTitleInput.value = "";
    if (!ccvSocket.emit({ title: "", target: ccvControlState.target, running: ccvControlState.running })) {
        ccvHint.textContent = "CCV socket is reconnecting. Try again shortly.";
        return;
    }
    ccvHint.textContent = "Title cleared on broadcast.";
});

ccvTitleInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") { event.preventDefault(); ccvSendTitleButton.click(); }
});

ccvTargetInput.addEventListener("input", () => {
    ccvTargetInput.value = ccvTargetInput.value.replace(/\D/g, "").slice(0, 8);
});

ccvStartButton.addEventListener("click", () => {
    const raw    = (ccvTargetInput.value || "").replace(/\D/g, "");
    const target = Math.max(0, parseInt(raw, 10) || 0);

    if (!target) {
        ccvHint.textContent = "Enter a target viewer count before starting.";
        ccvTargetInput.focus();
        return;
    }

    if (!ccvSocket.emit({ target, running: true })) {
        ccvHint.textContent = "CCV socket is reconnecting. Try again shortly.";
        return;
    }

    ccvControlState.target  = target;
    ccvControlState.running = true;
    ccvHint.textContent = `Counter started — counting up to ${target.toLocaleString()} viewers on the broadcast screen.`;
});

ccvStopButton.addEventListener("click", () => {
    const sent = ccvSocket.emit({ target: ccvControlState.target, running: false });
    if (!sent) {
        ccvHint.textContent = "CCV socket is reconnecting. Try again shortly.";
        return;
    }
    ccvControlState.running = false;
    ccvHint.textContent = "Counter stopped.";
});

ccvOpenButton.addEventListener("click", () => {
    window.open(buildCcvBroadcastUrl(), "_blank", "noopener");
});

ccvCopyButton.addEventListener("click", async () => {
    const link = buildCcvBroadcastUrl();
    try {
        await navigator.clipboard.writeText(link);
        ccvHint.textContent = "CCV broadcast link copied to clipboard.";
    } catch {
        ccvBroadcastLinkInput.focus();
        ccvBroadcastLinkInput.select();
        ccvHint.textContent = "Clipboard access failed — copy the selected link manually.";
    }
});

// ─────────────────────────────────────────────────────────────────────────────
