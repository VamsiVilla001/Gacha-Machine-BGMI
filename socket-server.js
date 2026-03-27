const fs = require("fs");
const path = require("path");
const http = require("http");
const { WebSocketServer } = require("ws");

const PORT = Number.parseInt(process.env.PORT || "3000", 10);
const ROOT = __dirname;
const DEFAULT_ROOM_ID = "default";
const DEFAULT_SHOW_KEY = "gold";
const SHOW_KEYS = Object.freeze({
    gold: "gold",
    silver: "silver"
});
const STORAGE_FILES = Object.freeze({
    [SHOW_KEYS.gold]: path.join(ROOT, "picked-history-gold.json"),
    [SHOW_KEYS.silver]: path.join(ROOT, "picked-history-silver.json")
});
const LEGACY_STORAGE_FILE = path.join(ROOT, "picked-history.json");
const MIN_TICKET_VALUE = 0;
const MAX_TICKET_VALUE = 9999;
const MAX_HISTORY_ITEMS = 50;

const roomStores = new Map([
    [SHOW_KEYS.gold, new Map()],
    [SHOW_KEYS.silver, new Map()]
]);

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function sanitizeRoomId(rawRoomId) {
    const roomId = String(rawRoomId || "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, "")
        .slice(0, 64);

    return roomId || DEFAULT_ROOM_ID;
}

function sanitizeShowKey(rawShowKey) {
    return rawShowKey === SHOW_KEYS.silver ? SHOW_KEYS.silver : DEFAULT_SHOW_KEY;
}

function normalizeTicket(rawTicket) {
    const digits = String(rawTicket || "")
        .replace(/\D/g, "")
        .slice(-4);

    return digits ? digits.padStart(4, "0") : null;
}

function formatTicketValue(value) {
    return String(clamp(Number(value) || 0, MIN_TICKET_VALUE, MAX_TICKET_VALUE)).padStart(4, "0");
}

function normalizeMode(rawMode) {
    return rawMode === "scripted" ? "scripted" : "random";
}

function normalizeRangeValue(rawValue, fallbackValue) {
    const parsedValue = Number.parseInt(String(rawValue ?? ""), 10);
    if (Number.isNaN(parsedValue)) {
        return fallbackValue;
    }

    return clamp(parsedValue, MIN_TICKET_VALUE, MAX_TICKET_VALUE);
}

function normalizeSettings(rawSettings = {}) {
    let min = normalizeRangeValue(rawSettings.min, MIN_TICKET_VALUE);
    let max = normalizeRangeValue(rawSettings.max, MAX_TICKET_VALUE);

    if (min > max) {
        [min, max] = [max, min];
    }

    return {
        mode: normalizeMode(rawSettings.mode),
        min,
        max
    };
}

function createDefaultState() {
    return {
        lastTicket: null,
        history: [],
        usedTickets: [],
        subtitle: "",
        settings: normalizeSettings()
    };
}

function normalizeRoomState(rawState = {}) {
    const lastTicket = normalizeTicket(rawState.lastTicket ?? rawState.lastResult);
    const historySource = Array.isArray(rawState.history)
        ? rawState.history
        : Array.isArray(rawState.pickedNumbers)
            ? rawState.pickedNumbers
            : [];
    const usedTicketsSource = Array.isArray(rawState.usedTickets)
        ? rawState.usedTickets
        : historySource;

    return {
        lastTicket,
        history: historySource
            .map((value) => normalizeTicket(value))
            .filter(Boolean)
            .slice(0, MAX_HISTORY_ITEMS),
        usedTickets: Array.from(new Set(
            usedTicketsSource
                .map((value) => normalizeTicket(value))
                .filter(Boolean)
        )),
        subtitle: typeof rawState.subtitle === "string" ? rawState.subtitle.slice(0, 120) : "",
        settings: normalizeSettings(rawState.settings || rawState)
    };
}

function getStore(showKey) {
    return roomStores.get(sanitizeShowKey(showKey));
}

function getRoomState(showKey, roomId) {
    const store = getStore(showKey);
    const normalizedRoomId = sanitizeRoomId(roomId);

    if (!store.has(normalizedRoomId)) {
        store.set(normalizedRoomId, createDefaultState());
    }

    return store.get(normalizedRoomId);
}

function readStorageFile(filePath) {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);

    if (parsed && typeof parsed === "object" && parsed.rooms && typeof parsed.rooms === "object") {
        return parsed.rooms;
    }

    return {
        [DEFAULT_ROOM_ID]: parsed
    };
}

function loadStorage(showKey) {
    const normalizedShowKey = sanitizeShowKey(showKey);
    const storageFile = STORAGE_FILES[normalizedShowKey];
    const store = getStore(normalizedShowKey);

    try {
        let sourceFile = storageFile;

        if (!fs.existsSync(sourceFile)) {
            if (normalizedShowKey === SHOW_KEYS.gold && fs.existsSync(LEGACY_STORAGE_FILE)) {
                sourceFile = LEGACY_STORAGE_FILE;
            } else {
                return;
            }
        }

        const roomsFromDisk = readStorageFile(sourceFile);
        for (const [roomId, roomState] of Object.entries(roomsFromDisk)) {
            store.set(sanitizeRoomId(roomId), normalizeRoomState(roomState));
        }
    } catch (error) {
        console.warn(`Unable to read ${normalizedShowKey} room storage:`, error.message);
    }
}

function saveStorage(showKey) {
    const normalizedShowKey = sanitizeShowKey(showKey);
    const store = getStore(normalizedShowKey);
    const payload = { rooms: {} };

    for (const [roomId, roomState] of store.entries()) {
        payload.rooms[roomId] = {
            lastTicket: roomState.lastTicket,
            history: roomState.history,
            usedTickets: roomState.usedTickets,
            subtitle: roomState.subtitle || "",
            settings: roomState.settings
        };
    }

    try {
        fs.writeFileSync(STORAGE_FILES[normalizedShowKey], JSON.stringify(payload, null, 2));
    } catch (error) {
        console.warn(`Unable to write ${normalizedShowKey} room storage:`, error.message);
    }
}

function loadAllStorage() {
    Object.values(SHOW_KEYS).forEach((showKey) => {
        loadStorage(showKey);
    });
}

function getContentType(filePath) {
    const extension = path.extname(filePath).toLowerCase();
    const contentTypes = {
        ".html": "text/html; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".js": "application/javascript; charset=utf-8",
        ".json": "application/json; charset=utf-8",
        ".svg": "image/svg+xml",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".mp3": "audio/mpeg",
        ".wav": "audio/wav",
        ".otf": "font/otf",
        ".ai": "application/postscript"
    };

    return contentTypes[extension] || "application/octet-stream";
}

function sendJson(socket, payload) {
    if (socket.readyState === 1) {
        socket.send(JSON.stringify(payload));
    }
}

function broadcast(payload, predicate = () => true) {
    for (const client of wss.clients) {
        if (!predicate(client)) {
            continue;
        }

        sendJson(client, payload);
    }
}

function countRemainingTickets(roomState) {
    const usedTicketSet = new Set(roomState.usedTickets);
    let remainingCount = 0;

    for (let value = roomState.settings.min; value <= roomState.settings.max; value += 1) {
        if (!usedTicketSet.has(formatTicketValue(value))) {
            remainingCount += 1;
        }
    }

    return remainingCount;
}

function buildStatePayload(showKey, roomId) {
    const normalizedShowKey = sanitizeShowKey(showKey);
    const state = getRoomState(normalizedShowKey, roomId);

    return {
        showKey: normalizedShowKey,
        roomId,
        lastTicket: state.lastTicket,
        history: state.history,
        usedTickets: state.usedTickets,
        settings: state.settings,
        subtitle: state.subtitle || "",
        usedCount: state.usedTickets.length,
        remainingCount: countRemainingTickets(state)
    };
}

function broadcastState(showKey, roomId) {
    const normalizedShowKey = sanitizeShowKey(showKey);

    broadcast({
        event: "state",
        data: buildStatePayload(normalizedShowKey, roomId)
    }, (client) => client.showKey === normalizedShowKey && client.roomId === roomId);
}

function recordTicket(roomState, ticket) {
    roomState.lastTicket = ticket;
    roomState.history.unshift(ticket);
    roomState.history = roomState.history.slice(0, MAX_HISTORY_ITEMS);

    if (!roomState.usedTickets.includes(ticket)) {
        roomState.usedTickets.push(ticket);
    }
}

function drawRandomTicket(roomState) {
    const usedTicketSet = new Set(roomState.usedTickets);
    const availableTickets = [];

    for (let value = roomState.settings.min; value <= roomState.settings.max; value += 1) {
        const ticket = formatTicketValue(value);
        if (!usedTicketSet.has(ticket)) {
            availableTickets.push(ticket);
        }
    }

    if (availableTickets.length === 0) {
        return null;
    }

    const selectedIndex = Math.floor(Math.random() * availableTickets.length);
    return availableTickets[selectedIndex];
}

function resolveResultTicket(roomState, payload = {}) {
    roomState.settings = normalizeSettings({
        mode: payload.mode ?? roomState.settings.mode,
        min: payload.min ?? roomState.settings.min,
        max: payload.max ?? roomState.settings.max
    });

    if (roomState.settings.mode === "random") {
        const ticket = drawRandomTicket(roomState);
        if (!ticket) {
            return {
                error: `No tickets remaining between ${formatTicketValue(roomState.settings.min)} and ${formatTicketValue(roomState.settings.max)}. Clear pick memory or change the range.`
            };
        }

        return { ticket };
    }

    const ticket = normalizeTicket(payload.ticket);
    if (!ticket) {
        return {
            error: "A 4-digit ticket is required in scripted mode."
        };
    }

    return { ticket };
}

const server = http.createServer((request, response) => {
    const url = new URL(request.url, `http://${request.headers.host}`);
    let requestedPath = url.pathname === "/" ? "index.html" : url.pathname.replace(/^\/+/, "");
    requestedPath = path.normalize(requestedPath).replace(/^(\.\.[/\\])+/, "");
    const filePath = path.join(ROOT, requestedPath);

    if (!filePath.startsWith(ROOT)) {
        response.writeHead(403);
        response.end("Forbidden");
        return;
    }

    fs.readFile(filePath, (error, data) => {
        if (error) {
            response.writeHead(error.code === "ENOENT" ? 404 : 500);
            response.end(error.code === "ENOENT" ? "Not found" : "Server error");
            return;
        }

        response.writeHead(200, { "Content-Type": getContentType(filePath) });
        response.end(data);
    });
});

const wss = new WebSocketServer({ server, path: "/ws" });

wss.on("connection", (socket, request) => {
    const url = new URL(request.url, `http://${request.headers.host}`);
    socket.role = url.searchParams.get("role") || "unknown";
    socket.showKey = sanitizeShowKey(url.searchParams.get("show"));
    socket.roomId = sanitizeRoomId(url.searchParams.get("room"));

    sendJson(socket, {
        event: "state",
        data: buildStatePayload(socket.showKey, socket.roomId)
    });

    socket.on("message", (rawMessage) => {
        let message;
        try {
            message = JSON.parse(String(rawMessage));
        } catch {
            return;
        }

        if (!message || typeof message.event !== "string") {
            return;
        }

        const activeRoomState = getRoomState(socket.showKey, socket.roomId);

        if (message.event === "result") {
            const resolution = resolveResultTicket(activeRoomState, message.data || {});

            if (resolution.error) {
                sendJson(socket, {
                    event: "error",
                    data: { message: resolution.error }
                });
                broadcastState(socket.showKey, socket.roomId);
                return;
            }

            recordTicket(activeRoomState, resolution.ticket);
            saveStorage(socket.showKey);

            broadcast({
                event: "result",
                data: { ticket: resolution.ticket }
            }, (client) => (
                client.role === "broadcast" &&
                client.showKey === socket.showKey &&
                client.roomId === socket.roomId
            ));

            broadcastState(socket.showKey, socket.roomId);
            return;
        }

        if (message.event === "subtitle") {
            const text = String(message.data && message.data.text != null ? message.data.text : "").slice(0, 120);
            activeRoomState.subtitle = text;
            saveStorage(socket.showKey);

            broadcast({
                event: "subtitle",
                data: { text }
            }, (client) => client.showKey === socket.showKey && client.roomId === socket.roomId);
            return;
        }

        if (message.event === "clear_history") {
            activeRoomState.lastTicket = null;
            activeRoomState.history = [];
            activeRoomState.usedTickets = [];
            saveStorage(socket.showKey);
            broadcastState(socket.showKey, socket.roomId);
        }
    });
});

loadAllStorage();
Object.values(SHOW_KEYS).forEach((showKey) => {
    saveStorage(showKey);
});
server.listen(PORT, () => {
    console.log(`Giveaway socket server listening on http://localhost:${PORT}`);
});
