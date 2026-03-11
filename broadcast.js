const DIGITS = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];
const DIGIT_COUNT = DIGITS.length;
const REPEAT_COUNT = 12;
const BASE_CYCLE = 4;
const DEFAULT_ROW_HEIGHT = 96;
const MIN_SPIN_DURATION_MS = 1500;
const MAX_SPIN_DURATION_MS = 2500;
const REEL_STAGGER_MS = 180;
const MIN_EXTRA_LOOPS = 4;
const MAX_EXTRA_LOOPS = 6;

const roomLabel = document.getElementById("room-label");
const connectionStatus = document.getElementById("connection-status");

const reelState = Array.from({ length: 3 }, (_, index) => ({
    index,
    strip: document.getElementById(`reel-strip-${index + 1}`),
    currentIndex: getBaseIndex(0),
    animationId: 0
}));

const broadcastState = {
    roomId: getRoomId(),
    lastTicket: null
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

function getRoomId() {
    return sanitizeRoomId(new URL(window.location.href).searchParams.get("room")) || "default";
}

function getWebSocketOrigin() {
    if (location.protocol === "https:") {
        return `wss://${location.host}`;
    }

    if (location.protocol === "http:") {
        return `ws://${location.host}`;
    }

    return "ws://127.0.0.1:3000";
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

function normalizeTicket(rawTicket) {
    const digits = String(rawTicket || "")
        .replace(/\D/g, "")
        .slice(-3);

    return digits ? digits.padStart(3, "0") : null;
}

function getBaseIndex(digit) {
    return (BASE_CYCLE * DIGIT_COUNT) + digit;
}

function getRowHeight(reel) {
    const firstDigit = reel.strip?.firstElementChild;
    if (firstDigit instanceof HTMLElement) {
        const measuredHeight = firstDigit.getBoundingClientRect().height;
        if (measuredHeight > 0) {
            return measuredHeight;
        }
    }

    return DEFAULT_ROW_HEIGHT;
}

function getStripOffset(reel, index) {
    const rowHeight = getRowHeight(reel);
    return rowHeight - (index * rowHeight);
}

function setConnectionStatus(status) {
    const labelByStatus = {
        connecting: "Connecting",
        connected: "Connected",
        reconnecting: "Reconnecting"
    };

    connectionStatus.textContent = labelByStatus[status] || "Disconnected";
}

function setReelPosition(reel, index) {
    reel.currentIndex = index;
    reel.strip.style.transform = `translate3d(0, ${getStripOffset(reel, index)}px, 0)`;
}

function populateReels() {
    reelState.forEach((reel) => {
        if (!reel.strip || reel.strip.childElementCount > 0) {
            return;
        }

        for (let repeatIndex = 0; repeatIndex < REPEAT_COUNT; repeatIndex += 1) {
            DIGITS.forEach((digit) => {
                const digitNode = document.createElement("div");
                digitNode.className = "reel-digit";
                digitNode.textContent = digit;
                reel.strip.appendChild(digitNode);
            });
        }

        setReelPosition(reel, getBaseIndex(0));
    });
}

function easeOutQuint(value) {
    return 1 - Math.pow(1 - value, 5);
}

function setTicketInstant(ticket) {
    const normalizedTicket = normalizeTicket(ticket);
    if (!normalizedTicket) {
        return;
    }

    broadcastState.lastTicket = normalizedTicket;
    normalizedTicket.split("").forEach((digit, index) => {
        const reel = reelState[index];
        if (!reel) {
            return;
        }

        setReelPosition(reel, getBaseIndex(Number(digit)));
    });
}

function animateReel(reel, targetDigit, durationMs, extraLoops) {
    const animationId = reel.animationId + 1;
    reel.animationId = animationId;

    const startIndex = reel.currentIndex;
    let endIndex = getBaseIndex(targetDigit) + (extraLoops * DIGIT_COUNT);
    while (endIndex <= startIndex) {
        endIndex += DIGIT_COUNT;
    }

    const startedAt = performance.now();

    function frame(now) {
        if (animationId !== reel.animationId) {
            return;
        }

        const progress = clamp((now - startedAt) / durationMs, 0, 1);
        const nextIndex = startIndex + ((endIndex - startIndex) * easeOutQuint(progress));
        setReelPosition(reel, nextIndex);

        if (progress < 1) {
            requestAnimationFrame(frame);
            return;
        }

        setReelPosition(reel, getBaseIndex(targetDigit));
    }

    requestAnimationFrame(frame);
}

function spinReels(ticket) {
    const normalizedTicket = normalizeTicket(ticket);
    if (!normalizedTicket) {
        return;
    }

    broadcastState.lastTicket = normalizedTicket;

    normalizedTicket.split("").forEach((digit, index) => {
        const reel = reelState[index];
        if (!reel) {
            return;
        }

        const durationMs = clamp(
            MIN_SPIN_DURATION_MS + REEL_STAGGER_MS + (index * REEL_STAGGER_MS) + Math.random() * 320,
            MIN_SPIN_DURATION_MS,
            MAX_SPIN_DURATION_MS
        );
        const extraLoops =
            MIN_EXTRA_LOOPS +
            index +
            Math.floor(Math.random() * ((MAX_EXTRA_LOOPS - MIN_EXTRA_LOOPS) + 1));

        animateReel(reel, Number(digit), durationMs, extraLoops);
    });
}

roomLabel.textContent = broadcastState.roomId;
populateReels();
setConnectionStatus("connecting");

const socket = createSocketClient({
    role: "broadcast",
    roomId: broadcastState.roomId,
    onConnectionChange: setConnectionStatus
});

socket.on("state", (state) => {
    if (!state || typeof state !== "object") {
        return;
    }

    if (typeof state.roomId === "string") {
        roomLabel.textContent = state.roomId;
    }

    if (typeof state.lastTicket === "string" && state.lastTicket !== broadcastState.lastTicket) {
        setTicketInstant(state.lastTicket);
    }
});

socket.on("result", (payload) => {
    spinReels(payload?.ticket);
});

window.spinReels = spinReels;
