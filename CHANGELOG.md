# Gacha Machine — Audio & Reveal Changes

## 1. Audio Engine Fix (broadcast.html / script.js)

### Problem
After switching to Tone.js, no audio was playing on the broadcast page. The "Enable Sound" button had no explicit click handler — it was only caught by a window-level `pointerdown` listener, which wasn't reliably triggering the Tone.js audio context unlock.

### Changes
- **Added explicit click handler** on `#audio-unlock-button` → calls `unlockAudio()` directly.
- **Added auto-start on page load** — `startToneContext(false)` is called at init so OBS browser sources and other autoplay-friendly environments can start audio without user interaction.

---

## 2. Gacha-Authentic Sound Redesign (script.js)

Rewrote the entire `ensureAudioEngine()` function with gacha-tuned sounds:

### Ball Impact Sounds
- **Before**: Generic percussion hits.
- **After**: Soft, lightweight plastic capsule taps using `MembraneSynth` at high frequency (320+ Hz), very short decay (0.08s), quiet volume (-26 dB). Designed to sound like hollow plastic balls tapping against each other.

### Wall Impact Sounds
- Slightly heavier taps than ball-on-ball, using `MembraneSynth` at ~280 Hz with bandpass-filtered noise burst at 1800 Hz for a subtle "clack" character.

### Blower / Wind Sound
- **Before**: Simple filtered noise.
- **After**: Realistic air blower using:
  - **Pink noise** through a lowpass filter (cutoff 320 Hz) for the rumbling air body.
  - **Turbulence layer** — white noise through a bandpass filter (900 Hz) for high-frequency air turbulence.
  - **Motor oscillator** — sawtooth wave at 52 Hz for the mechanical motor hum.
- `updateAudioMix()` rewritten to scale blower intensity with airflow speed, ramping filter cutoff (320–700 Hz) and turbulence gain dynamically.

### Audio Bus
- All sounds routed through: `masterBus` → `Compressor` (-18 dB threshold) → `Limiter` (-3 dB) → `Tone.Destination`.

---

## 3. Slot-Machine Digit-by-Digit Reveal (script.js)

### `showResult(number, color)`
Replaced the instant text update with a slot-machine reveal animation:

1. **Digit containers** — Creates `<span class="reveal-digit">` elements inside `#sidebar-result-number`, one per digit.
2. **Spin phase** — Each digit rapidly cycles through random characters (`0–9`) at 50 ms intervals.
3. **Staggered landing** — Digits land left-to-right with 280 ms delay between each. Later digits spin longer (180 ms + 60 ms × digit index) for dramatic buildup.
4. **Result ball sync** — The `#result-ball-number` text inside the SVG ball updates in parallel.

### `setDigitAt(index, char, isFinal)`
New helper that updates both the sidebar span and the result ball SVG text for a given digit position. When `isFinal` is true, adds the `is-revealed` CSS class to trigger the pop animation.

---

## 4. Reveal Sound Effects (script.js)

### `playRevealTick(digitIndex, isLast)`
New function that plays sound for each digit landing:

- **Per-digit tick** — Ascending note sequence: C5 → E5 → G5 → C6 → E6 (one per digit index), played on a triangle-wave `Synth` with very short envelope (60 ms).
- **Noise accent** — Brief white noise burst (20 ms) through a highpass filter at 4800 Hz for a mechanical "click" feel.
- **Final fanfare** — On the last digit, a triumphant arpeggio plays on a `PolySynth` (4-voice polyphony):
  - C5 at +80 ms
  - E5 at +160 ms
  - G5 at +240 ms
  - C6 at +320 ms

### New Tone.js Nodes Added
| Node | Type | Purpose |
|------|------|---------|
| `revealTickSynth` | `Synth` (triangle) | Per-digit landing tick |
| `revealFanfareSynth` | `PolySynth` (sine, 4-voice) | Final digit arpeggio fanfare |
| `revealNoise` | `NoiseSynth` (white) | Mechanical click accent |
| `revealNoiseFilter` | `Filter` (highpass, 4800 Hz) | Shapes the click noise |

---

## 5. CSS Reveal Animation (style.css)

### `.reveal-digit`
```css
display: inline-block;
opacity: 0.5;
transform: translateY(4px);
transition: opacity 0.15s, transform 0.15s;
```

### `.reveal-digit.is-revealed`
```css
opacity: 1;
transform: translateY(0);
animation: digit-pop 0.32s cubic-bezier(0.34, 1.56, 0.64, 1);
```

### `@keyframes digit-pop`
```css
0%   { transform: translateY(12px); opacity: 0.3; }
50%  { transform: translateY(-6px); opacity: 1; scale: 1.15; }
100% { transform: translateY(0); opacity: 1; scale: 1; }
```

---

## Files Modified
| File | Changes |
|------|---------|
| `script.js` | Audio engine rewrite, slot-machine reveal, reveal sounds, auto-start, click handler |
| `style.css` | Added `.reveal-digit`, `.reveal-digit.is-revealed`, `@keyframes digit-pop` |
| `broadcast.html` | No structural changes (Tone.js script tag was already present) |
