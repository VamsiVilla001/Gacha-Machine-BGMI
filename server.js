const fs = require("fs");
const path = require("path");
const http = require("http");
const { WebSocketServer } = require("ws");

const PORT = Number.parseInt(process.env.PORT || "3000", 10);
const ROOT = __dirname;

const state = {
    config: {
        resolution: "1920x1080",
        minNumber: 0,
        maxNumber: 999,
        selectionMode: "random",
        scriptedNumber: 777
    },
    machineRunning: false,
    lastResult: null
};

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
            broadcast(
                {
                    type: "knob_command",
                    action: message.action === "stop" ? "stop" : "start"
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
            }
            state.machineRunning = false;
            broadcastSnapshot();
        }
    });
});

server.listen(PORT, () => {
    console.log(`Gacha server listening on http://localhost:${PORT}`);
});
