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

const REEL_ROW_HEIGHT = 118;
const REEL_CENTER_Y = 176;
const REEL_BASE_INDEX = 20;
const REEL_REPEAT_COUNT = 9;
const DEFAULT_PENDING_RESULT = "000";
const SPIN_UP_MS = 900;
const MIX_MS = 3000;
const SPIN_DOWN_MS = 900;
const TOTAL_CYCLE_MS = SPIN_UP_MS + MIX_MS + SPIN_DOWN_MS;
const RESULT_DRAW_DURATION_MS = 1400;
const RESULT_REEL_STAGGER_MS = 80;
const RESULT_REEL_STOP_GAP_MS = 2000;
const RESULT_DRAW_ROLL_BASE_MS = 120;
const RESULT_DRAW_ROLL_DECEL_MS = 180;
const REEL_SPIN_RATES = [0.014, 0.016, 0.018];
const ToneLib = window.Tone || null;
const AUDIO_UNLOCK_EVENTS = ["pointerdown", "keydown", "touchstart"];
const SVG_NS = "http://www.w3.org/2000/svg";

const reels = Array.from({ length: 3 }, (_, index) => ({
    index,
    strip: document.getElementById(`reel-strip-${index + 1}`),
    currentIndex: REEL_BASE_INDEX,
    spinIndex: REEL_BASE_INDEX,
    phase: index * 1.7
}));

const titleNode = document.querySelector(".broadcast-v2-title");
const audioControl = document.getElementById("audio-control");
const audioUnlockButton = document.getElementById("audio-unlock-button");
const audioStatus = document.getElementById("audio-status");

const broadcastState = {
    socket: null,
    connected: false,
    running: false,
    startTime: 0,
    lastFrameAt: 0,
    animationId: 0,
    config: {
        resolution: "1920x1080",
        minNumber: 0,
        maxNumber: 999,
        selectionMode: "random",
        scriptedNumber: 777
    },
    selectedNumber: null,
    isPending: true
};

const soundState = {
    masterBus: null,
    compressor: null,
    limiter: null,
    scrollSynth: null,
    scrollNoise: null,
    revealTickSynth: null,
    revealNoise: null,
    revealFanfareSynth: null,
    resultSynth: null,
    unlockSynth: null,
    unlocked: false,
    lastScrollAt: 0,
    scrollStep: 0
};

const resultDrawState = {
    timeoutIds: new Set()
};

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function easeOutCubic(value) {
    return 1 - Math.pow(1 - value, 3);
}

function easeInOutSine(value) {
    return -(Math.cos(Math.PI * value) - 1) / 2;
}

function positiveModulo(value, divisor) {
    return ((value % divisor) + divisor) % divisor;
}

function formatTicket(value) {
    return String(value ?? DEFAULT_PENDING_RESULT)
        .replace(/\D/g, "")
        .padStart(3, "0")
        .slice(-3);
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
    document.body.dataset.resolution = broadcastState.config.resolution;
}

function offsetFor(index) {
    return REEL_CENTER_Y - (index * REEL_ROW_HEIGHT);
}

function setStripPosition(reel, index) {
    if (!reel.strip) {
        return;
    }

    reel.strip.setAttribute("transform", `translate(0 ${offsetFor(index)})`);
}

function normalizeSpinIndex(index) {
    while (index >= REEL_BASE_INDEX + 10) {
        index -= 10;
    }

    while (index < REEL_BASE_INDEX) {
        index += 10;
    }

    return index;
}

function createSvgNode(tagName, attributes = {}) {
    const node = document.createElementNS(SVG_NS, tagName);

    Object.entries(attributes).forEach(([name, value]) => {
        node.setAttribute(name, String(value));
    });

    return node;
}

function populateReelStrips() {
    reels.forEach((reel) => {
        if (!reel.strip || reel.strip.childNodes.length > 0) {
            return;
        }

        for (let digitIndex = 0; digitIndex < REEL_REPEAT_COUNT * 10; digitIndex += 1) {
            const digitNode = createSvgNode("text", {
                class: "broadcast-v2-strip-digit",
                x: 109,
                y: digitIndex * REEL_ROW_HEIGHT,
                "text-anchor": "middle",
                "dominant-baseline": "middle"
            });
            digitNode.textContent = String(digitIndex % 10);
            reel.strip.appendChild(digitNode);
        }
    });
}

function queueResultTimeout(callback, delay) {
    const timeoutId = window.setTimeout(() => {
        resultDrawState.timeoutIds.delete(timeoutId);
        callback();
    }, delay);

    resultDrawState.timeoutIds.add(timeoutId);
    return timeoutId;
}

function clearResultDrawTimers() {
    for (const timeoutId of resultDrawState.timeoutIds) {
        window.clearTimeout(timeoutId);
    }

    resultDrawState.timeoutIds.clear();
}

function ensureAudioEngine() {
    if (!ToneLib) {
        return null;
    }

    if (soundState.masterBus) {
        return ToneLib;
    }

    const masterBus = new ToneLib.Gain(0.8);
    const compressor = new ToneLib.Compressor(-18, 3);
    const limiter = new ToneLib.Limiter(-1);

    const scrollSynth = new ToneLib.Synth({
        oscillator: { type: "triangle" },
        envelope: { attack: 0.001, decay: 0.035, sustain: 0, release: 0.01 },
        volume: -18
    });
    const scrollNoise = new ToneLib.NoiseSynth({
        noise: { type: "white" },
        envelope: { attack: 0.001, decay: 0.018, sustain: 0, release: 0.01 },
        volume: -40
    });

    const revealTickSynth = new ToneLib.Synth({
        oscillator: { type: "triangle" },
        envelope: { attack: 0.001, decay: 0.04, sustain: 0, release: 0.02 },
        volume: -16
    });
    const revealNoise = new ToneLib.NoiseSynth({
        noise: { type: "white" },
        envelope: { attack: 0.001, decay: 0.02, sustain: 0, release: 0.01 },
        volume: -38
    });
    const revealFanfareSynth = new ToneLib.PolySynth(ToneLib.Synth, {
        maxPolyphony: 4,
        volume: -12
    });
    revealFanfareSynth.set({
        oscillator: { type: "triangle" },
        envelope: { attack: 0.004, decay: 0.16, sustain: 0.05, release: 0.12 }
    });
    const resultSynth = new ToneLib.PolySynth(ToneLib.Synth, {
        maxPolyphony: 4,
        volume: -10
    });
    resultSynth.set({
        oscillator: { type: "triangle" },
        envelope: { attack: 0.004, decay: 0.18, sustain: 0.06, release: 0.16 }
    });
    const unlockSynth = new ToneLib.Synth({
        oscillator: { type: "sine" },
        envelope: { attack: 0.003, decay: 0.12, sustain: 0, release: 0.06 },
        volume: -16
    });

    masterBus.chain(compressor, limiter, ToneLib.Destination);
    scrollSynth.connect(masterBus);
    scrollNoise.connect(masterBus);
    revealTickSynth.connect(masterBus);
    revealNoise.connect(masterBus);
    revealFanfareSynth.connect(masterBus);
    resultSynth.connect(masterBus);
    unlockSynth.connect(masterBus);

    soundState.masterBus = masterBus;
    soundState.compressor = compressor;
    soundState.limiter = limiter;
    soundState.scrollSynth = scrollSynth;
    soundState.scrollNoise = scrollNoise;
    soundState.revealTickSynth = revealTickSynth;
    soundState.revealNoise = revealNoise;
    soundState.revealFanfareSynth = revealFanfareSynth;
    soundState.resultSynth = resultSynth;
    soundState.unlockSynth = unlockSynth;

    return ToneLib;
}

function isAudioRunning() {
    return Boolean(ToneLib && ToneLib.context && ToneLib.context.state === "running");
}

function updateAudioUI() {
    if (!audioControl) {
        return;
    }

    if (!ToneLib) {
        audioControl.classList.remove("is-hidden");
        if (audioStatus) {
            audioStatus.textContent = "Audio engine unavailable";
        }
        if (audioUnlockButton) {
            audioUnlockButton.disabled = true;
        }
        return;
    }

    const unlocked = soundState.unlocked && isAudioRunning();
    audioControl.classList.toggle("is-hidden", unlocked);

    if (audioStatus) {
        audioStatus.textContent = unlocked ? "Sound enabled" : "Audio locked by browser";
    }

    if (audioUnlockButton) {
        audioUnlockButton.disabled = false;
    }
}

async function unlockAudio() {
    if (!ToneLib) {
        updateAudioUI();
        return false;
    }

    ensureAudioEngine();

    try {
        await ToneLib.start();
        if (ToneLib.context?.resume) {
            await ToneLib.context.resume();
        }

        soundState.unlocked = true;
        const now = ToneLib.now();
        soundState.unlockSynth.triggerAttackRelease("E5", 0.07, now, 0.26);
        soundState.unlockSynth.triggerAttackRelease("A5", 0.1, now + 0.08, 0.22);
        updateAudioUI();
        return true;
    } catch {
        updateAudioUI();
        return false;
    }
}

function bindAudioUnlock() {
    if (audioUnlockButton) {
        audioUnlockButton.addEventListener("click", () => {
            unlockAudio();
        });
    }

    const tryUnlock = () => {
        if (soundState.unlocked) {
            return;
        }

        unlockAudio();
    };

    AUDIO_UNLOCK_EVENTS.forEach((eventName) => {
        window.addEventListener(eventName, tryUnlock, { passive: true });
    });

    updateAudioUI();
}

function playScrollTick(strength) {
    if (!soundState.unlocked || !isAudioRunning() || !ToneLib) {
        return;
    }

    const time = ToneLib.now();
    const notes = ["A4", "C5", "D5", "E5", "G5"];
    const note = notes[soundState.scrollStep % notes.length];
    const velocity = 0.08 + strength * 0.1;

    soundState.scrollSynth.triggerAttackRelease(note, 0.025, time, velocity);
    soundState.scrollNoise.triggerAttackRelease("128n", time, 0.01 + strength * 0.014);
    soundState.scrollStep += 1;
}

function updateScrollAudio(now, strength) {
    if (!broadcastState.running || !soundState.unlocked || !isAudioRunning() || !ToneLib) {
        return;
    }

    const intervalMs = 170 - (strength * 95);
    if (now - soundState.lastScrollAt < intervalMs) {
        return;
    }

    soundState.lastScrollAt = now;
    playScrollTick(strength);
}

function playRevealSpinTick(progress) {
    if (!soundState.unlocked || !isAudioRunning() || !ToneLib) {
        return;
    }

    const time = ToneLib.now();
    const notes = ["C5", "D5", "E5", "G5"];
    const note = notes[Math.min(notes.length - 1, Math.floor(progress * notes.length))];

    soundState.revealTickSynth.triggerAttackRelease(note, 0.03, time, 0.12 + progress * 0.08);
    soundState.revealNoise.triggerAttackRelease("64n", time, 0.02 + progress * 0.02);
}

function playRevealLanding(digitIndex, isLast) {
    if (!soundState.unlocked || !isAudioRunning() || !ToneLib) {
        return;
    }

    const time = ToneLib.now();
    const note = ["C5", "E5", "G5", "C6", "E6"][digitIndex] || "G5";

    soundState.revealTickSynth.triggerAttackRelease(note, 0.05, time, 0.34);
    soundState.revealNoise.triggerAttackRelease("32n", time, 0.04);

    if (!isLast) {
        return;
    }

    soundState.revealFanfareSynth.triggerAttackRelease("C5", 0.08, time + 0.08, 0.35);
    soundState.revealFanfareSynth.triggerAttackRelease("E5", 0.08, time + 0.16, 0.3);
    soundState.revealFanfareSynth.triggerAttackRelease("G5", 0.12, time + 0.24, 0.32);
}

function playResultCue() {
    if (!soundState.unlocked || !isAudioRunning() || !ToneLib) {
        return;
    }

    const time = ToneLib.now();
    soundState.resultSynth.triggerAttackRelease("C5", 0.08, time, 0.42);
    soundState.resultSynth.triggerAttackRelease("E5", 0.08, time + 0.1, 0.34);
    soundState.resultSynth.triggerAttackRelease("G5", 0.16, time + 0.2, 0.38);
}

function startResultRollAudio(animationId, totalDurationMs) {
    const startedAt = performance.now();

    const tick = () => {
        if (animationId !== broadcastState.animationId) {
            return;
        }

        const elapsed = performance.now() - startedAt;
        const progress = clamp(elapsed / totalDurationMs, 0, 1);
        playRevealSpinTick(progress);

        if (progress >= 0.98) {
            return;
        }

        queueResultTimeout(
            tick,
            Math.round(RESULT_DRAW_ROLL_BASE_MS + progress * RESULT_DRAW_ROLL_DECEL_MS)
        );
    };

    tick();
}

function cancelAnimations() {
    broadcastState.animationId += 1;
    clearResultDrawTimers();
}

function setTitlePending() {
    if (titleNode) {
        titleNode.classList.remove("is-result");
    }
}

function setTitleResult() {
    if (titleNode) {
        titleNode.classList.add("is-result");
    }
}

function setTicketStatic(value) {
    const ticket = formatTicket(value);

    ticket.split("").forEach((digit, index) => {
        const reel = reels[index];
        if (!reel || !reel.strip) {
            return;
        }

        const settledIndex = REEL_BASE_INDEX + Number(digit);
        reel.currentIndex = settledIndex;
        reel.spinIndex = settledIndex;
        setStripPosition(reel, settledIndex);
    });
}

function setPendingResult() {
    cancelAnimations();
    broadcastState.isPending = true;
    setTitlePending();
    setTicketStatic(DEFAULT_PENDING_RESULT);
}

function getResultDigitSettleAt(index) {
    return RESULT_DRAW_DURATION_MS + index * RESULT_REEL_STOP_GAP_MS;
}

function getResultAnimationTotalDuration(digitCount) {
    return getResultDigitSettleAt(Math.max(0, digitCount - 1));
}

function animateReelTo(reel, targetDigit, extraTurns, delayMs, durationMs, animationId) {
    const startIndex = reel.currentIndex;
    const startAt = performance.now() + delayMs;
    const delta = positiveModulo(targetDigit - positiveModulo(startIndex, 10), 10);
    const endIndex = startIndex + (extraTurns * 10) + delta;

    function step(now) {
        if (animationId !== broadcastState.animationId) {
            return;
        }

        if (now < startAt) {
            requestAnimationFrame(step);
            return;
        }

        const elapsed = Math.min(1, (now - startAt) / durationMs);
        const eased = 1 - Math.pow(1 - elapsed, 3);
        const current = startIndex + ((endIndex - startIndex) * eased);

        reel.currentIndex = current;
        reel.spinIndex = normalizeSpinIndex(current);
        setStripPosition(reel, current);

        if (elapsed < 1) {
            requestAnimationFrame(step);
            return;
        }

        const settledIndex = REEL_BASE_INDEX + targetDigit;
        reel.currentIndex = settledIndex;
        reel.spinIndex = settledIndex;
        setStripPosition(reel, settledIndex);
    }

    requestAnimationFrame(step);
}

function showResult(value, options = {}) {
    const ticket = formatTicket(value);
    const animate = options.animate !== false;

    cancelAnimations();
    broadcastState.isPending = false;
    setTitleResult();

    if (!animate) {
        setTicketStatic(ticket);
        return;
    }

    const animationId = broadcastState.animationId;
    const digits = ticket.split("");
    const totalDurationMs = getResultAnimationTotalDuration(digits.length);

    startResultRollAudio(animationId, totalDurationMs);

    digits.forEach((digit, index) => {
        const reel = reels[index];
        if (!reel || !reel.strip) {
            return;
        }

        const loopCount = 3 + (digits.length - index - 1);
        const settleAt = getResultDigitSettleAt(index);
        const delayMs = Math.min(
            index * RESULT_REEL_STAGGER_MS,
            Math.max(0, settleAt - 360)
        );
        const durationMs = Math.max(360, settleAt - delayMs);

        animateReelTo(reel, Number(digit), loopCount, delayMs, durationMs, animationId);

        queueResultTimeout(() => {
            if (animationId !== broadcastState.animationId) {
                return;
            }

            playRevealLanding(index, index === digits.length - 1);
        }, delayMs + durationMs);
    });

    queueResultTimeout(() => {
        if (animationId !== broadcastState.animationId) {
            return;
        }

        playResultCue();
    }, totalDurationMs + RESULT_REEL_STAGGER_MS + 40);
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

function getCycleStrength(now) {
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

    return 1 - easeInOutSine((elapsed - SPIN_UP_MS - MIX_MS) / SPIN_DOWN_MS);
}

function startCycle(now = performance.now(), forcedNumber = null) {
    if (broadcastState.running) {
        return;
    }

    const parsedForcedNumber = Number.isFinite(forcedNumber)
        ? forcedNumber
        : Number.parseInt(forcedNumber, 10);

    broadcastState.running = true;
    broadcastState.startTime = now;
    broadcastState.selectedNumber = Number.isFinite(parsedForcedNumber)
        ? clamp(parsedForcedNumber, 0, 999)
        : resolveSelectedNumber();
    soundState.lastScrollAt = 0;
    soundState.scrollStep = 0;

    setPendingResult();
    sendStatus();
}

function stopCycle(revealResult = true) {
    if (!broadcastState.running && !revealResult) {
        return;
    }

    const selectedNumber = broadcastState.selectedNumber;
    broadcastState.running = false;

    if (revealResult && typeof selectedNumber === "number") {
        showResult(selectedNumber, { animate: true });
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

        if (message.state?.machineRunning) {
            if (broadcastState.isPending) {
                setPendingResult();
            }
            return;
        }

        if (typeof message.state?.lastResult === "number" && broadcastState.isPending) {
            broadcastState.selectedNumber = message.state.lastResult;
            showResult(message.state.lastResult, { animate: false });
            return;
        }

        if (message.state?.lastResult == null) {
            setPendingResult();
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
                startCycle(performance.now(), message.selectedNumber);
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
    if (!broadcastState.lastFrameAt) {
        broadcastState.lastFrameAt = now;
    }

    const deltaMs = Math.min(40, now - broadcastState.lastFrameAt);
    broadcastState.lastFrameAt = now;
    const strength = getCycleStrength(now);

    if (broadcastState.running) {
        reels.forEach((reel, index) => {
            if (!reel.strip) {
                return;
            }

            const wave = 1 + (Math.sin((now * 0.008) + reel.phase) * 0.08);
            const step = deltaMs * (0.002 + (REEL_SPIN_RATES[index] * strength * wave));

            reel.spinIndex = normalizeSpinIndex(reel.spinIndex + step);
            reel.currentIndex = reel.spinIndex;
            setStripPosition(reel, reel.spinIndex);
        });

        if (now - broadcastState.startTime >= TOTAL_CYCLE_MS) {
            stopCycle(true);
        }
    }

    updateScrollAudio(now, strength);

    requestAnimationFrame(animate);
}

populateReelStrips();

reels.forEach((reel) => {
    if (reel.strip) {
        setStripPosition(reel, reel.currentIndex);
    }
});

applyConfig(broadcastState.config);
setPendingResult();
bindAudioUnlock();
connectSocket();
requestAnimationFrame(animate);

window.setBroadcastV2Ticket = function setBroadcastV2Ticket(value, options) {
    const ticket = formatTicket(value);

    if (options && options.animate === false) {
        showResult(ticket, { animate: false });
        return;
    }

    showResult(ticket, { animate: true });
};

window.startBroadcastV2Cycle = function startBroadcastV2Cycle(value) {
    startCycle(performance.now(), value);
};

window.stopBroadcastV2Cycle = function stopBroadcastV2Cycle() {
    stopCycle(true);
};
