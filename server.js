const fs = require("fs");
const path = require("path");
const http = require("http");
const { WebSocketServer } = require("ws");

const PORT = Number.parseInt(process.env.PORT || "3000", 10);
const ROOT = __dirname;
const STORAGE_FILE = path.join(ROOT, "picked-history.json");

const state = {
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

function loadStorage() {
    try {
        if (!fs.existsSync(STORAGE_FILE)) {
            return;
        }

        const raw = fs.readFileSync(STORAGE_FILE, "utf8");
        const parsed = JSON.parse(raw);

        if (Array.isArray(parsed.pickedNumbers)) {
            state.pickedNumbers = parsed.pickedNumbers
                .map((value) => clamp(Number.parseInt(value, 10) || 0, 0, 999))
                .filter((value, index, values) => values.indexOf(value) === index);
        }

        if (typeof parsed.lastResult === "number") {
            state.lastResult = clamp(parsed.lastResult, 0, 999);
        }
    } catch (error) {
        console.warn("Unable to read picked-history storage:", error.message);
    }
}

function saveStorage() {
    const payload = {
        pickedNumbers: state.pickedNumbers,
        lastResult: state.lastResult
    };

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

function broadcastSnapshot() {
    broadcast({
        type: "state_snapshot",
        state
    });
}

function resolveNextNumber() {
    if (state.config.selectionMode === "scripted") {
        if (state.pickedNumbers.includes(state.config.scriptedNumber)) {
            return null;
        }
        return state.config.scriptedNumber;
    }

    const availableNumbers = [];
    for (let value = state.config.minNumber; value <= state.config.maxNumber; value++) {
        if (!state.pickedNumbers.includes(value)) {
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

    sendJson(socket, {
        type: "state_snapshot",
        state
    });

    socket.on("message", (rawMessage) => {
        let message;
        try {
            message = JSON.parse(String(rawMessage));
        } catch {
            return;
        }

        if (message.type === "set_config") {
            state.config = normalizeConfig(message.config);
            broadcastSnapshot();
            return;
        }

        if (message.type === "knob_command") {
            const nextConfig = normalizeConfig(message.config || state.config);
            state.config = nextConfig;

            if (message.action !== "stop") {
                const selectedNumber = resolveNextNumber();
                if (selectedNumber === null) {
                    sendJson(socket, {
                        type: "command_rejected",
                        reason:
                            nextConfig.selectionMode === "scripted"
                                ? "That scripted number has already been picked."
                                : "No unused numbers remain in the current range."
                    });
                    broadcastSnapshot();
                    return;
                }

                broadcast(
                    {
                        type: "knob_command",
                        action: "start",
                        config: nextConfig,
                        selectedNumber
                    },
                    (client) => client.role === "broadcast"
                );
                return;
            }

            broadcast(
                {
                    type: "knob_command",
                    action: "stop",
                    config: nextConfig
                },
                (client) => client.role === "broadcast"
            );
            return;
        }

        if (message.type === "broadcast_status") {
            state.machineRunning = Boolean(message.machineRunning);
            broadcastSnapshot();
            return;
        }

        if (message.type === "broadcast_result") {
            if (typeof message.resultNumber === "number") {
                state.lastResult = clamp(message.resultNumber, 0, 999);
                if (!state.pickedNumbers.includes(state.lastResult)) {
                    state.pickedNumbers.push(state.lastResult);
                }
                saveStorage();
            }
            state.machineRunning = false;
            broadcastSnapshot();
            return;
        }

        if (message.type === "reset_history") {
            state.lastResult = null;
            state.pickedNumbers = [];
            saveStorage();
            broadcastSnapshot();
        }
    });
});

loadStorage();
server.listen(PORT, () => {
    console.log(`Gacha server listening on http://localhost:${PORT}`);
});
