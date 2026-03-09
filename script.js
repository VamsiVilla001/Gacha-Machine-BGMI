/**
 * Gacha machine physics and result display.
 */

const container = document.getElementById("balls-container");
const knobGroup = document.getElementById("knob-group");
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

const balls = [];
const machineState = {
    running: false,
    startTime: 0,
    selectedBall: null
};

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

            // Lightweight balls are quickly accelerated toward the local air velocity.
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
    if (!machineState.running) {
        return 0;
    }

    const elapsed = now - machineState.startTime;
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

                    // Keep enough sideways energy for airborne mixing while damping jitter.
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

function generateUniqueNumbers(count, min, max) {
    const numbers = new Set();
    while (numbers.size < count) {
        numbers.add(Math.floor(Math.random() * (max - min + 1)) + min);
    }
    return Array.from(numbers);
}

function formatBallNumber(value) {
    return String(value).padStart(3, "0");
}

function getRandomResultBallColor() {
    return RESULT_BALL_COLORS[Math.floor(Math.random() * RESULT_BALL_COLORS.length)];
}

function setPendingResult() {
    resultBallNumber.textContent = "---";
    sidebarResultNumber.textContent = "---";
    resultBallColor.style.fill = "#9aa2af";
    resultBall.classList.add("is-pending");
    sidebarResultNumber.classList.add("is-pending");
}

function showResult(ball) {
    if (!ball) {
        return;
    }

    const resultColor = getRandomResultBallColor();

    resultBallNumber.textContent = formatBallNumber(ball.number);
    sidebarResultNumber.textContent = formatBallNumber(ball.number);
    resultBallColor.style.fill = resultColor;
    resultBall.classList.remove("is-pending");
    sidebarResultNumber.classList.remove("is-pending");
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

    const numbers = generateUniqueNumbers(allBallElements.length, 0, 999);

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

function finishCycle() {
    if (!machineState.running) {
        return;
    }

    machineState.running = false;
    knobGroup.classList.remove("knob-active");
    showResult(machineState.selectedBall);
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

    if (machineState.running && now - machineState.startTime >= TOTAL_CYCLE_MS) {
        finishCycle();
    }

    requestAnimationFrame(animate);
}

function startCycle(now) {
    if (machineState.running || balls.length === 0) {
        return;
    }

    machineState.running = true;
    machineState.startTime = now;
    machineState.selectedBall = balls[Math.floor(Math.random() * balls.length)];

    // Launch the balls into the circulation loop immediately on click.
    for (const ball of balls) {
        const airflow = sampleAirflowField(ball, now, BLOWER_FORCE_MULTIPLIER);
        ball.vx += airflow.vx * 0.45;
        ball.vy += airflow.vy * 0.45;
        ball.angularVelocity += airflow.spin * 6;
    }

    knobGroup.classList.add("knob-active");
    setPendingResult();
}

knobGroup.addEventListener("click", () => {
    startCycle(performance.now());
});

initBalls();
setPendingResult();
requestAnimationFrame(animate);
