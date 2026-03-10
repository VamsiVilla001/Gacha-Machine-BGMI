/**
 * Broadcast page runtime.
 * Runs the machine animation and reacts to live control commands over WebSocket.
 */

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

function buildWebSocketUrl() {
    const url = new URL("/ws", `${getWebSocketOrigin()}/`);
    url.searchParams.set("role", "broadcast");
    url.searchParams.set("room", getRoomId());
    return url.toString();
}

const container = document.getElementById("balls-container");
const knobGroup = document.getElementById("knob-group");
const broadcastCanvas = document.getElementById("broadcast-canvas");
const resolutionReadout = document.getElementById("resolution-readout");
const resultBall = document.getElementById("result-ball");
const resultBallColor = document.getElementById("result-ball-color");
const resultBallNumber = document.getElementById("result-ball-number");
const sidebarResultNumber = document.getElementById("sidebar-result-number");

const CONTAINER_CX = 366.3;
const CONTAINER_CY = 375.6;
const CONTAINER_RADIUS = 300;
const NOZZLE_X = CONTAINER_CX;
const NOZZLE_Y = CONTAINER_CY + CONTAINER_RADIUS - 18;

const GRAVITY = 0.12;
const RESTITUTION = 0.46;
const WALL_RESTITUTION = 0.5;
const BLOWER_FORCE_MULTIPLIER = 15;
const ACTIVE_DRAG = 0.9985;
const SETTLE_DRAG = 0.952;
const SLEEP_VELOCITY = 0.045;
const ACTIVE_SPEED_LIMIT = 8.4 * BLOWER_FORCE_MULTIPLIER;
const SETTLE_SPEED_LIMIT = 3.3;

const SPIN_UP_MS = 900;
const MIX_MS = 3000;
const SPIN_DOWN_MS = 900;
const TOTAL_CYCLE_MS = SPIN_UP_MS + MIX_MS + SPIN_DOWN_MS;
const RESULT_BALL_COLORS = [
    "#d32f2f",
    "#ed9d0f",
    "#5894c4",
    "#798c44",
    "#ffb923",
    "#8bb6e0",
    "#f04b47",
    "#ef4a43"
];

const balls = [];
const broadcastState = {
    socket: null,
    connected: false,
    running: false,
    startTime: 0,
    config: {
        resolution: "1920x1080",
        minNumber: 0,
        maxNumber: 999,
        selectionMode: "random",
        scriptedNumber: 777
    },
    selectedNumber: null,
    selectedColor: "#9aa2af"
};

class Ball {
    constructor(gElement, x, y, radius, number) {
        this.x = x;
        this.y = y;
        this.initialX = x;
        this.initialY = y;
        this.radius = radius;
        this.number = number;
        this.vx = 0;
        this.vy = 0;
        this.angle = 0;
        this.angularVelocity = 0;
        this.flowPhase = Math.random() * Math.PI * 10;
        this.flowBias = (Math.random() - 0.5) * 0.6;
        this.g = gElement;

        this.updateTransform();
    }

    updateTransform() {
        const dx = this.x - this.initialX;
        const dy = this.y - this.initialY;
        this.g.setAttribute(
            "transform",
            `translate(${dx}, ${dy}) rotate(${this.angle}, ${this.initialX}, ${this.initialY})`
        );
    }

    applyPhysics(now, blowerStrength) {
        this.vy += GRAVITY;

        if (blowerStrength > 0.01) {
            const effectiveStrength = blowerStrength * BLOWER_FORCE_MULTIPLIER;
            const airflow = sampleAirflowField(this, now, effectiveStrength);
            const coupling = 0.16 * blowerStrength;

            this.vx += (airflow.vx - this.vx) * coupling;
            this.vy += (airflow.vy - this.vy) * coupling;
            this.angularVelocity += airflow.spin;
        }

        const drag = blowerStrength > 0.01 ? ACTIVE_DRAG : SETTLE_DRAG;
        this.vx *= drag;
        this.vy *= drag;
        this.angularVelocity *= blowerStrength > 0.01 ? 0.93 : 0.8;

        limitVelocity(this, blowerStrength > 0.01 ? ACTIVE_SPEED_LIMIT : SETTLE_SPEED_LIMIT);

        if (blowerStrength < 0.01) {
            if (Math.abs(this.vx) < SLEEP_VELOCITY) {
                this.vx = 0;
            }
            if (Math.abs(this.vy) < SLEEP_VELOCITY) {
                this.vy = 0;
            }
            if (Math.abs(this.angularVelocity) < 0.08) {
                this.angularVelocity = 0;
            }
        }

        this.x += this.vx;
        this.y += this.vy;
        this.angle += this.angularVelocity;
    }

    checkWallCollision() {
        const dx = this.x - CONTAINER_CX;
        const dy = this.y - CONTAINER_CY;
        const dist2 = dx * dx + dy * dy;
        const maxDist = CONTAINER_RADIUS - this.radius;

        if (dist2 > maxDist * maxDist) {
            const dist = Math.sqrt(dist2) || 1;
            const nx = -dx / dist;
            const ny = -dy / dist;
            const overlap = dist - maxDist;

            this.x += nx * overlap;
            this.y += ny * overlap;

            const normalVelocity = this.vx * nx + this.vy * ny;
            if (normalVelocity < 0) {
                this.vx = (this.vx - 2 * normalVelocity * nx) * WALL_RESTITUTION;
                this.vy = (this.vy - 2 * normalVelocity * ny) * WALL_RESTITUTION;
                this.angularVelocity += (this.vx * ny - this.vy * nx) * 0.1;
            }
        }
    }
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function limitVelocity(ball, maxSpeed) {
    const speed = Math.hypot(ball.vx, ball.vy);
    if (speed > maxSpeed) {
        const scale = maxSpeed / speed;
        ball.vx *= scale;
        ball.vy *= scale;
    }
}

function easeOutCubic(value) {
    return 1 - Math.pow(1 - value, 3);
}

function easeInOutSine(value) {
    return -(Math.cos(Math.PI * value) - 1) / 2;
}

function normalizeConfig(config) {
    const minNumber = clamp(Number.parseInt(config.minNumber ?? 0, 10) || 0, 0, 999);
    const maxNumber = clamp(Number.parseInt(config.maxNumber ?? 999, 10) || 999, 0, 999);
    const scriptedNumber = clamp(
        Number.parseInt(config.scriptedNumber ?? 777, 10) || 777,
        0,
        999
    );

    return {
        resolution: config.resolution === "3840x2160" ? "3840x2160" : "1920x1080",
        minNumber: Math.min(minNumber, maxNumber),
        maxNumber: Math.max(minNumber, maxNumber),
        selectionMode: config.selectionMode === "scripted" ? "scripted" : "random",
        scriptedNumber
    };
}

function applyConfig(config) {
    broadcastState.config = normalizeConfig(config);
    if (resolutionReadout) {
        resolutionReadout.textContent =
            broadcastState.config.resolution === "3840x2160" ? "3840 x 2160" : "1920 x 1080";
    }
    broadcastCanvas.dataset.resolution = broadcastState.config.resolution;
}

function formatBallNumber(value) {
    return String(value).padStart(3, "0");
}

function getRandomResultBallColor() {
    return RESULT_BALL_COLORS[Math.floor(Math.random() * RESULT_BALL_COLORS.length)];
}

function setPendingResult() {
    resultBallNumber.textContent = "---";
    if (sidebarResultNumber) {
        sidebarResultNumber.textContent = "---";
    }
    resultBallColor.style.fill = "#9aa2af";
    resultBall.classList.add("is-pending");
    if (sidebarResultNumber) {
        sidebarResultNumber.classList.add("is-pending");
    }
}

function showResult(number, color) {
    if (typeof number !== "number") {
        return;
    }

    resultBallNumber.textContent = formatBallNumber(number);
    if (sidebarResultNumber) {
        sidebarResultNumber.textContent = formatBallNumber(number);
    }
    resultBallColor.style.fill = color;
    resultBall.classList.remove("is-pending");
    if (sidebarResultNumber) {
        sidebarResultNumber.classList.remove("is-pending");
    }
}

function clearResult() {
    setPendingResult();
}

function sampleAirflowField(ball, now, blowerStrength) {
    const relX = (ball.x - CONTAINER_CX) / CONTAINER_RADIUS;
    const relY = (ball.y - CONTAINER_CY) / CONTAINER_RADIUS;
    const radial = Math.max(0.001, Math.hypot(relX, relY));
    const edgeBand = clamp((radial - 0.42) / 0.58, 0, 1);
    const coreBand = 1 - clamp(radial / 0.9, 0, 1);
    const lowerHalf = clamp((ball.y - CONTAINER_CY) / CONTAINER_RADIUS, -1, 1);
    const nozzleDx = ball.x - NOZZLE_X;
    const nozzleDy = NOZZLE_Y - ball.y;
    const plumeWidth = CONTAINER_RADIUS * 0.34;
    const plumeHeight = CONTAINER_RADIUS * 1.32;
    const plumeCore = Math.exp(-(nozzleDx * nozzleDx) / (plumeWidth * plumeWidth));
    const plumeRise = clamp(nozzleDy / plumeHeight, 0, 1);
    const plumeStrength = plumeCore * plumeRise;
    const spreadDirection =
        Math.abs(nozzleDx) < plumeWidth * 0.12
            ? (Math.sign(ball.flowBias) || 1)
            : Math.sign(nozzleDx);

    const tangentX = -relY / radial;
    const tangentY = relX / radial;
    const updraft = (2.8 + plumeRise * 3.6) * plumeStrength;
    const sidewaysJet = spreadDirection * plumeStrength * (1.7 + plumeRise * 1.25);
    const vortexStrength = 1.0 + edgeBand * 1.8 + Math.max(0, lowerHalf) * 0.7;
    const edgeDownwash = edgeBand * (1.3 + Math.max(0, -lowerHalf) * 1.9);
    const centerSuction = -relX * (0.55 + coreBand * 0.35);
    const hoverLift = coreBand * (0.8 + Math.max(0, lowerHalf) * 0.5);
    const turbulenceX =
        Math.sin(now * 0.006 + ball.flowPhase + ball.y * 0.012) * 0.28 +
        Math.cos(now * 0.004 + ball.flowPhase * 1.8) * 0.2;
    const turbulenceY =
        Math.sin(now * 0.008 + ball.flowPhase * 1.3 + ball.x * 0.01) * 0.2 +
        Math.cos(now * 0.005 + ball.flowPhase) * 0.12;
    const sideSweep =
        Math.cos(now * 0.005 + ball.flowPhase * 0.7) *
        (1 - Math.abs(relY) * 0.55) *
        0.45;

    return {
        vx:
            (
                sidewaysJet +
                tangentX * vortexStrength +
                centerSuction +
                sideSweep +
                turbulenceX +
                ball.flowBias * 0.45
            ) * blowerStrength,
        vy:
            (
                -updraft -
                hoverLift +
                tangentY * vortexStrength +
                edgeDownwash +
                turbulenceY
            ) * blowerStrength,
        spin:
            (
                sidewaysJet * 0.07 +
                tangentX * vortexStrength * 0.08 +
                turbulenceX * 0.05
            ) * blowerStrength
    };
}

function getBlowerStrength(now) {
    if (!broadcastState.running) {
        return 0;
    }

    const elapsed = now - broadcastState.startTime;
    if (elapsed >= TOTAL_CYCLE_MS) {
        return 0;
    }

    if (elapsed < SPIN_UP_MS) {
        return easeOutCubic(elapsed / SPIN_UP_MS);
    }

    if (elapsed < SPIN_UP_MS + MIX_MS) {
        return 1;
    }

    const spinDownProgress = (elapsed - SPIN_UP_MS - MIX_MS) / SPIN_DOWN_MS;
    return 1 - easeInOutSine(spinDownProgress);
}

function checkBallCollisions() {
    for (let i = 0; i < balls.length; i++) {
        for (let j = i + 1; j < balls.length; j++) {
            const b1 = balls[i];
            const b2 = balls[j];

            const dx = b2.x - b1.x;
            const dy = b2.y - b1.y;
            const dist2 = dx * dx + dy * dy;
            const minDist = b1.radius + b2.radius;

            if (dist2 < minDist * minDist) {
                const dist = Math.sqrt(dist2) || 0.001;
                const nx = dx / dist;
                const ny = dy / dist;
                const overlap = minDist - dist;
                const pushX = nx * (overlap * 0.5);
                const pushY = ny * (overlap * 0.5);

                b1.x -= pushX;
                b1.y -= pushY;
                b2.x += pushX;
                b2.y += pushY;

                const relativeVx = b1.vx - b2.vx;
                const relativeVy = b1.vy - b2.vy;
                const normalVelocity = relativeVx * nx + relativeVy * ny;

                if (normalVelocity > 0) {
                    const impulse = ((1 + RESTITUTION) * normalVelocity) / 2;
                    const tangentX = -ny;
                    const tangentY = nx;
                    const tangentVelocity = relativeVx * tangentX + relativeVy * tangentY;

                    b1.vx -= impulse * nx;
                    b1.vy -= impulse * ny;
                    b2.vx += impulse * nx;
                    b2.vy += impulse * ny;

                    b1.vx -= tangentVelocity * tangentX * 0.018;
                    b1.vy -= tangentVelocity * tangentY * 0.018;
                    b2.vx += tangentVelocity * tangentX * 0.018;
                    b2.vy += tangentVelocity * tangentY * 0.018;

                    const spinTransfer = tangentVelocity * 0.1;
                    b1.angularVelocity += spinTransfer;
                    b2.angularVelocity -= spinTransfer;
                }
            }
        }
    }
}

function initBalls() {
    container.innerHTML = "";
    balls.length = 0;

    const baseBallElements = Array.from(document.querySelectorAll(".cls-31 > g > g"));
    if (baseBallElements.length === 0) {
        return;
    }

    const extraBallCount = Math.round(baseBallElements.length * 0.5);
    const allBallElements = [...baseBallElements];

    for (let i = 0; i < extraBallCount; i++) {
        const clone = baseBallElements[i % baseBallElements.length].cloneNode(true);
        allBallElements.push(clone);
    }

    const uniqueNumbers = new Set();
    while (uniqueNumbers.size < allBallElements.length) {
        uniqueNumbers.add(Math.floor(Math.random() * 1000));
    }
    const numbers = Array.from(uniqueNumbers);

    allBallElements.forEach((g, index) => {
        container.appendChild(g);

        const bbox = g.getBBox();
        const cx = bbox.x + bbox.width / 2;
        const cy = bbox.y + bbox.height / 2;
        const radius = bbox.width / 2;
        const isExtraBall = index >= baseBallElements.length;
        const offsetAngle = Math.random() * Math.PI * 2;
        const offsetDistance = isExtraBall ? radius * (0.45 + Math.random() * 0.65) : 0;
        const startX = cx + Math.cos(offsetAngle) * offsetDistance;
        const startY = cy + Math.sin(offsetAngle) * offsetDistance;

        balls.push(new Ball(g, startX, startY, radius, numbers[index]));
    });
}

function sendMessage(message) {
    if (!broadcastState.socket || broadcastState.socket.readyState !== WebSocket.OPEN) {
        return;
    }

    broadcastState.socket.send(JSON.stringify(message));
}

function sendStatus() {
    sendMessage({
        type: "broadcast_status",
        machineRunning: broadcastState.running
    });
}

function sendResult(number) {
    sendMessage({
        type: "broadcast_result",
        resultNumber: number
    });
}

function resolveSelectedNumber() {
    if (broadcastState.config.selectionMode === "scripted") {
        return broadcastState.config.scriptedNumber;
    }

    const { minNumber, maxNumber } = broadcastState.config;
    return Math.floor(Math.random() * (maxNumber - minNumber + 1)) + minNumber;
}

function launchBallsIntoAirflow(now) {
    for (const ball of balls) {
        const airflow = sampleAirflowField(ball, now, BLOWER_FORCE_MULTIPLIER);
        ball.vx += airflow.vx * 0.45;
        ball.vy += airflow.vy * 0.45;
        ball.angularVelocity += airflow.spin * 6;
    }
}

function startCycle(now = performance.now(), forcedNumber = null) {
    if (broadcastState.running || balls.length === 0) {
        return;
    }

    broadcastState.running = true;
    broadcastState.startTime = now;
    broadcastState.selectedNumber =
        typeof forcedNumber === "number" ? forcedNumber : resolveSelectedNumber();
    broadcastState.selectedColor = getRandomResultBallColor();

    knobGroup.classList.add("knob-active");
    setPendingResult();
    launchBallsIntoAirflow(now);
    sendStatus();
}

function stopCycle(revealResult = true) {
    if (!broadcastState.running && !revealResult) {
        return;
    }

    const selectedNumber = broadcastState.selectedNumber;
    const selectedColor = broadcastState.selectedColor;

    broadcastState.running = false;
    knobGroup.classList.remove("knob-active");

    if (revealResult && typeof selectedNumber === "number") {
        showResult(selectedNumber, selectedColor);
        sendResult(selectedNumber);
    }

    sendStatus();
}

function handleSocketMessage(event) {
    let message;
    try {
        message = JSON.parse(event.data);
    } catch {
        return;
    }

    if (message.type === "state_snapshot" || message.type === "config_update") {
        const nextConfig =
            message.state?.config ||
            message.config?.config ||
            message.config ||
            {};

        applyConfig(nextConfig);

        if (
            typeof message.state?.lastResult === "number" &&
            !broadcastState.running &&
            resultBall.classList.contains("is-pending")
        ) {
            showResult(message.state.lastResult, broadcastState.selectedColor);
        } else if (message.state?.lastResult == null && !broadcastState.running) {
            clearResult();
        }
        return;
    }

    if (message.type === "knob_command") {
        if (message.config) {
            applyConfig(message.config);
        }

        if (message.action === "start") {
            startCycle(performance.now(), message.selectedNumber);
        } else if (message.action === "stop") {
            stopCycle(true);
        } else if (message.action === "toggle") {
            if (broadcastState.running) {
                stopCycle(true);
            } else {
                startCycle();
            }
        }
    }
}

function connectSocket() {
    const socket = new WebSocket(buildWebSocketUrl());
    broadcastState.socket = socket;

    socket.addEventListener("open", () => {
        broadcastState.connected = true;
        sendStatus();
    });

    socket.addEventListener("message", handleSocketMessage);

    socket.addEventListener("close", () => {
        broadcastState.connected = false;
        window.setTimeout(connectSocket, 1000);
    });
}

function animate(now) {
    const blowerStrength = getBlowerStrength(now);

    for (const ball of balls) {
        ball.applyPhysics(now, blowerStrength);
        ball.checkWallCollision();
    }

    checkBallCollisions();
    checkBallCollisions();
    if (blowerStrength > 0.35) {
        checkBallCollisions();
    }

    for (const ball of balls) {
        ball.updateTransform();
    }

    if (broadcastState.running && now - broadcastState.startTime >= TOTAL_CYCLE_MS) {
        stopCycle(true);
    }

    requestAnimationFrame(animate);
}

initBalls();
applyConfig(broadcastState.config);
setPendingResult();
connectSocket();
requestAnimationFrame(animate);
