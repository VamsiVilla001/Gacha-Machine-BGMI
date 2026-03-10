const fs = require("fs");
const path = require("path");
const http = require("http");
const { WebSocketServer } = require("ws");

const PORT = Number.parseInt(process.env.PORT || "3000", 10);
const ROOT = __dirname;
const STORAGE_FILE = path.join(ROOT, "picked-history.json");
const DEFAULT_ROOM_ID = "default";

const rooms = new Map();

function createDefaultState() {
    return {
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
}

function sanitizeRoomId(rawRoomId) {
    const roomId = String(rawRoomId || "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, "")
        .slice(0, 64);

    return roomId || DEFAULT_ROOM_ID;
}

function normalizeRoomState(rawState = {}) {
    const nextState = createDefaultState();

    if (rawState.config) {
        nextState.config = normalizeConfig(rawState.config);
    }

    if (Array.isArray(rawState.pickedNumbers)) {
        nextState.pickedNumbers = rawState.pickedNumbers
            .map((value) => clamp(Number.parseInt(value, 10) || 0, 0, 999))
            .filter((value, index, values) => values.indexOf(value) === index);
    }

    if (typeof rawState.lastResult === "number") {
        nextState.lastResult = clamp(rawState.lastResult, 0, 999);
    }

    return nextState;
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
        console.warn("Unable to read picked-history storage:", error.message);
    }
}

function saveStorage() {
    const payload = { rooms: {} };

    for (const [roomId, roomState] of rooms.entries()) {
        payload.rooms[roomId] = {
            config: roomState.config,
            lastResult: roomState.lastResult,
            pickedNumbers: roomState.pickedNumbers
        };
    }

    try {
        fs.writeFileSync(STORAGE_FILE, JSON.stringify(payload, null, 2));
    } catch (error) {
        console.warn("Unable to write picked-history storage:", error.message);
    }
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function normalizeConfig(rawConfig = {}) {
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

function getContentType(filePath) {
    const extension = path.extname(filePath).toLowerCase();
    const contentTypes = {
        ".html": "text/html; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".js": "application/javascript; charset=utf-8",
        ".svg": "image/svg+xml",
        ".json": "application/json; charset=utf-8",
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

function broadcastSnapshot(roomId) {
    broadcast({
        type: "state_snapshot",
        roomId,
        state: getRoomState(roomId)
    }, (client) => client.roomId === roomId);
}

function resolveNextNumber(roomState) {
    if (roomState.config.selectionMode === "scripted") {
        if (roomState.pickedNumbers.includes(roomState.config.scriptedNumber)) {
            return null;
        }
        return roomState.config.scriptedNumber;
    }

    const availableNumbers = [];
    for (let value = roomState.config.minNumber; value <= roomState.config.maxNumber; value++) {
        if (!roomState.pickedNumbers.includes(value)) {
            availableNumbers.push(value);
        }
    }

    if (availableNumbers.length === 0) {
        return null;
    }

    return availableNumbers[Math.floor(Math.random() * availableNumbers.length)];
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
        type: "state_snapshot",
        roomId: socket.roomId,
        state: roomState
    });

    socket.on("message", (rawMessage) => {
        let message;
        try {
            message = JSON.parse(String(rawMessage));
        } catch {
            return;
        }

        const activeRoomState = getRoomState(socket.roomId);

        if (message.type === "set_config") {
            activeRoomState.config = normalizeConfig(message.config);
            saveStorage();
            broadcastSnapshot(socket.roomId);
            return;
        }

        if (message.type === "knob_command") {
            const nextConfig = normalizeConfig(message.config || activeRoomState.config);
            activeRoomState.config = nextConfig;

            if (message.action !== "stop") {
                const selectedNumber = resolveNextNumber(activeRoomState);
                if (selectedNumber === null) {
                    sendJson(socket, {
                        type: "command_rejected",
                        reason:
                            nextConfig.selectionMode === "scripted"
                                ? "That scripted number has already been picked."
                                : "No unused numbers remain in the current range."
                    });
                    broadcastSnapshot(socket.roomId);
                    return;
                }

                broadcast(
                    {
                        type: "knob_command",
                        action: "start",
                        config: nextConfig,
                        selectedNumber
                    },
                    (client) => client.role === "broadcast" && client.roomId === socket.roomId
                );
                return;
            }

            broadcast(
                {
                    type: "knob_command",
                    action: "stop",
                    config: nextConfig
                },
                (client) => client.role === "broadcast" && client.roomId === socket.roomId
            );
            return;
        }

        if (message.type === "broadcast_status") {
            activeRoomState.machineRunning = Boolean(message.machineRunning);
            broadcastSnapshot(socket.roomId);
            return;
        }

        if (message.type === "broadcast_result") {
            if (typeof message.resultNumber === "number") {
                activeRoomState.lastResult = clamp(message.resultNumber, 0, 999);
                if (!activeRoomState.pickedNumbers.includes(activeRoomState.lastResult)) {
                    activeRoomState.pickedNumbers.push(activeRoomState.lastResult);
                }
                saveStorage();
            }
            activeRoomState.machineRunning = false;
            broadcastSnapshot(socket.roomId);
            return;
        }

        if (message.type === "reset_history") {
            activeRoomState.lastResult = null;
            activeRoomState.pickedNumbers = [];
            saveStorage();
            broadcastSnapshot(socket.roomId);
        }
    });
});

loadStorage();
server.listen(PORT, () => {
    console.log(`Gacha server listening on http://localhost:${PORT}`);
});
