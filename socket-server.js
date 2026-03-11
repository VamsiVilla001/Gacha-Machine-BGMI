const fs = require("fs");
const path = require("path");
const http = require("http");
const { WebSocketServer } = require("ws");

const PORT = Number.parseInt(process.env.PORT || "3000", 10);
const ROOT = __dirname;
const STORAGE_FILE = path.join(ROOT, "picked-history.json");
const DEFAULT_ROOM_ID = "default";

const rooms = new Map();

function sanitizeRoomId(rawRoomId) {
    const roomId = String(rawRoomId || "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, "")
        .slice(0, 64);

    return roomId || DEFAULT_ROOM_ID;
}

function normalizeTicket(rawTicket) {
    const digits = String(rawTicket || "")
        .replace(/\D/g, "")
        .slice(-3);

    return digits ? digits.padStart(3, "0") : null;
}

function createDefaultState() {
    return {
        lastTicket: null,
        history: []
    };
}

function normalizeRoomState(rawState = {}) {
    const lastTicket = normalizeTicket(rawState.lastTicket ?? rawState.lastResult);
    const historySource = Array.isArray(rawState.history)
        ? rawState.history
        : Array.isArray(rawState.pickedNumbers)
            ? rawState.pickedNumbers
            : [];

    return {
        lastTicket,
        history: historySource
            .map((value) => normalizeTicket(value))
            .filter(Boolean)
            .slice(0, 50)
    };
}

function getRoomState(roomId) {
    const normalizedRoomId = sanitizeRoomId(roomId);

    if (!rooms.has(normalizedRoomId)) {
        rooms.set(normalizedRoomId, createDefaultState());
    }

    return rooms.get(normalizedRoomId);
}

function loadStorage() {
    try {
        if (!fs.existsSync(STORAGE_FILE)) {
            return;
        }

        const raw = fs.readFileSync(STORAGE_FILE, "utf8");
        const parsed = JSON.parse(raw);

        if (parsed && typeof parsed === "object" && parsed.rooms && typeof parsed.rooms === "object") {
            for (const [roomId, roomState] of Object.entries(parsed.rooms)) {
                rooms.set(sanitizeRoomId(roomId), normalizeRoomState(roomState));
            }
            return;
        }

        rooms.set(DEFAULT_ROOM_ID, normalizeRoomState(parsed));
    } catch (error) {
        console.warn("Unable to read room storage:", error.message);
    }
}

function saveStorage() {
    const payload = { rooms: {} };

    for (const [roomId, roomState] of rooms.entries()) {
        payload.rooms[roomId] = {
            lastTicket: roomState.lastTicket,
            history: roomState.history
        };
    }

    try {
        fs.writeFileSync(STORAGE_FILE, JSON.stringify(payload, null, 2));
    } catch (error) {
        console.warn("Unable to write room storage:", error.message);
    }
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

function broadcastState(roomId) {
    const state = getRoomState(roomId);
    broadcast({
        event: "state",
        data: {
            roomId,
            lastTicket: state.lastTicket,
            history: state.history
        }
    }, (client) => client.roomId === roomId);
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
    socket.roomId = sanitizeRoomId(url.searchParams.get("room"));

    const roomState = getRoomState(socket.roomId);
    sendJson(socket, {
        event: "state",
        data: {
            roomId: socket.roomId,
            lastTicket: roomState.lastTicket,
            history: roomState.history
        }
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

        const activeRoomState = getRoomState(socket.roomId);

        if (message.event === "result") {
            const ticket = normalizeTicket(message.data?.ticket);

            if (!ticket) {
                sendJson(socket, {
                    event: "error",
                    data: { message: "A 3-digit ticket is required." }
                });
                return;
            }

            activeRoomState.lastTicket = ticket;
            activeRoomState.history.unshift(ticket);
            activeRoomState.history = activeRoomState.history.slice(0, 50);
            saveStorage();

            broadcast({
                event: "result",
                data: { ticket }
            }, (client) => client.role === "broadcast" && client.roomId === socket.roomId);

            broadcastState(socket.roomId);
            return;
        }

        if (message.event === "clear_history") {
            activeRoomState.lastTicket = null;
            activeRoomState.history = [];
            saveStorage();
            broadcastState(socket.roomId);
        }
    });
});

loadStorage();
server.listen(PORT, () => {
    console.log(`Giveaway socket server listening on http://localhost:${PORT}`);
});
