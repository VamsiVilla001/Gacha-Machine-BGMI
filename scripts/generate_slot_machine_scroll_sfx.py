from __future__ import annotations

import math
import os
import random
import struct
import wave
from pathlib import Path


SAMPLE_RATE = 48_000
DURATION_SECONDS = 2.95
TOTAL_SAMPLES = int(SAMPLE_RATE * DURATION_SECONDS)
OUTPUT_PATH = Path("assets/audio/slot-machine-reel-scroll.wav")
RNG = random.Random(20260312)


def clamp(value: float, minimum: float, maximum: float) -> float:
    return max(minimum, min(maximum, value))


def smoothstep(edge0: float, edge1: float, value: float) -> float:
    if edge0 == edge1:
        return 0.0
    amount = clamp((value - edge0) / (edge1 - edge0), 0.0, 1.0)
    return amount * amount * (3.0 - (2.0 * amount))


def equal_power_pan(pan: float) -> tuple[float, float]:
    pan = clamp(pan, -1.0, 1.0)
    left = math.sqrt((1.0 - pan) * 0.5)
    right = math.sqrt((1.0 + pan) * 0.5)
    return left, right


def add_event(left: list[float], right: list[float], start_time: float, pan: float, samples: list[float]) -> None:
    start_index = int(start_time * SAMPLE_RATE)
    left_gain, right_gain = equal_power_pan(pan)

    for offset, sample in enumerate(samples):
        index = start_index + offset
        if index >= TOTAL_SAMPLES:
            break
        left[index] += sample * left_gain
        right[index] += sample * right_gain


def render_click(amplitude: float, brightness: float, stop_click: bool = False) -> list[float]:
    duration = 0.08 if not stop_click else 0.34
    sample_count = int(duration * SAMPLE_RATE)
    base_noise = [RNG.uniform(-1.0, 1.0) for _ in range(sample_count)]
    output = [0.0] * sample_count

    metallic_partials = [
        (780.0, 0.12, 0.040),
        (1650.0, 0.18, 0.032),
        (2840.0, 0.12, 0.028),
        (4020.0, 0.08, 0.022),
    ]

    if stop_click:
        metallic_partials = [
            (240.0, 0.26, 0.200),
            (520.0, 0.18, 0.170),
            (980.0, 0.20, 0.130),
            (2140.0, 0.14, 0.085),
            (3620.0, 0.07, 0.060),
        ]

    partial_states = [
        (frequency * (1.0 + RNG.uniform(-0.0035, 0.0035)), weight, decay, RNG.uniform(0.0, math.tau))
        for frequency, weight, decay in metallic_partials
    ]

    for index in range(sample_count):
        time_seconds = index / SAMPLE_RATE
        click_burst = math.exp(-time_seconds * (240.0 if not stop_click else 92.0))
        metal_mix = 0.0

        for frequency, weight, decay, phase in partial_states:
            metal_mix += (
                weight
                * math.exp(-time_seconds / decay)
                * math.sin((math.tau * frequency * time_seconds) + phase)
            )

        body = 0.0
        if not stop_click:
            body = 0.12 * math.exp(-time_seconds / 0.030) * math.sin(math.tau * 280.0 * time_seconds)
        else:
            body = (
                0.26 * math.exp(-time_seconds / 0.220) * math.sin(math.tau * 118.0 * time_seconds)
                + 0.12 * math.exp(-time_seconds / 0.160) * math.sin(math.tau * 242.0 * time_seconds)
            )

        noise_shape = base_noise[index] * click_burst * (0.34 + (0.28 * brightness))
        output[index] = amplitude * ((noise_shape * 0.55) + (metal_mix * brightness) + body)

    return output


def render_rotor_bed() -> tuple[list[float], list[float]]:
    left = [0.0] * TOTAL_SAMPLES
    right = [0.0] * TOTAL_SAMPLES
    filtered_noise = 0.0

    for index in range(TOTAL_SAMPLES):
        time_seconds = index / SAMPLE_RATE
        spin_amount = 1.0 - smoothstep(1.62, 2.46, time_seconds)
        fade_out = 1.0 - smoothstep(2.38, DURATION_SECONDS, time_seconds)
        amplitude = spin_amount * fade_out

        rotor = (
            0.020 * math.sin(math.tau * 76.0 * time_seconds)
            + 0.012 * math.sin(math.tau * 152.0 * time_seconds + 0.6)
            + 0.007 * math.sin(math.tau * 228.0 * time_seconds + 1.1)
        )

        noise = RNG.uniform(-1.0, 1.0)
        filtered_noise = (filtered_noise * 0.985) + (noise * 0.015)
        gear = (noise - filtered_noise) * 0.020 * amplitude * (0.45 + (0.55 * spin_amount))
        flutter = 0.62 + (0.38 * math.sin(math.tau * (11.0 + (spin_amount * 4.0)) * time_seconds))
        bed_sample = amplitude * ((rotor * 0.85) + (gear * flutter))

        left[index] = bed_sample * 0.98
        right[index] = bed_sample * 1.02

    return left, right


def build_feedback_reverb(source: list[float], tap_specs: list[tuple[float, float, float]]) -> list[float]:
    wet = [0.0] * TOTAL_SAMPLES

    for delay_seconds, feedback, gain in tap_specs:
        delay_samples = max(1, int(delay_seconds * SAMPLE_RATE))
        line = [0.0] * TOTAL_SAMPLES

        for index in range(delay_samples, TOTAL_SAMPLES):
            delayed = source[index - delay_samples] + (line[index - delay_samples] * feedback)
            line[index] = delayed
            wet[index] += delayed * gain

    smoothed = [0.0] * TOTAL_SAMPLES
    accumulator = 0.0
    for index, sample in enumerate(wet):
        accumulator = (accumulator * 0.79) + (sample * 0.21)
        smoothed[index] = accumulator

    return smoothed


def apply_stereo_reverb(left: list[float], right: list[float]) -> tuple[list[float], list[float]]:
    left_source = [(left[index] * 0.86) + (right[index] * 0.14) for index in range(TOTAL_SAMPLES)]
    right_source = [(right[index] * 0.86) + (left[index] * 0.14) for index in range(TOTAL_SAMPLES)]

    left_taps = [
        (0.024, 0.68, 0.16),
        (0.039, 0.63, 0.14),
        (0.061, 0.58, 0.12),
        (0.087, 0.54, 0.10),
    ]
    right_taps = [
        (0.029, 0.67, 0.16),
        (0.043, 0.61, 0.14),
        (0.067, 0.57, 0.12),
        (0.094, 0.52, 0.10),
    ]

    wet_left = build_feedback_reverb(left_source, left_taps)
    wet_right = build_feedback_reverb(right_source, right_taps)

    for index in range(TOTAL_SAMPLES):
        time_seconds = index / SAMPLE_RATE
        bloom = 0.24 + (0.18 * smoothstep(2.18, 2.72, time_seconds))
        left[index] += wet_left[index] * bloom
        right[index] += wet_right[index] * bloom

    return left, right


def build_click_schedule() -> list[tuple[float, float, float, bool]]:
    schedule: list[tuple[float, float, float, bool]] = []

    time_seconds = 0.045
    while time_seconds < 1.62:
        pan = RNG.uniform(-0.26, 0.26)
        amp = RNG.uniform(0.23, 0.32)
        brightness = RNG.uniform(0.92, 1.12)
        schedule.append((time_seconds, pan, amp * brightness, False))

        if RNG.random() < 0.24:
            schedule.append((time_seconds + RNG.uniform(0.004, 0.007), pan * 0.6, amp * 0.42, False))

        time_seconds += 0.031 + RNG.uniform(-0.0028, 0.0028)

    interval = 0.038
    while time_seconds < 2.34:
        progress = smoothstep(1.62, 2.34, time_seconds)
        pan = RNG.uniform(-0.20, 0.20)
        amp = (0.25 + (0.12 * (1.0 - progress))) * RNG.uniform(0.9, 1.08)
        brightness = 1.0 - (0.22 * progress)
        schedule.append((time_seconds, pan, amp * brightness, False))

        if RNG.random() < (0.22 * (1.0 - progress)):
            schedule.append((time_seconds + RNG.uniform(0.003, 0.006), pan * 0.55, amp * 0.34, False))

        interval += 0.008 + (0.020 * progress)
        time_seconds += interval + RNG.uniform(-0.003, 0.004)

    schedule.append((2.42, 0.0, 0.52, True))
    return schedule


def normalize_stereo(left: list[float], right: list[float]) -> tuple[list[float], list[float]]:
    peak = max(
        max(abs(sample) for sample in left),
        max(abs(sample) for sample in right),
        1e-9,
    )
    target_peak = 0.92
    scale = target_peak / peak
    return ([sample * scale for sample in left], [sample * scale for sample in right])


def write_wav(left: list[float], right: list[float], destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)

    with wave.open(str(destination), "wb") as wav_file:
        wav_file.setnchannels(2)
        wav_file.setsampwidth(2)
        wav_file.setframerate(SAMPLE_RATE)

        frame_data = bytearray()
        for left_sample, right_sample in zip(left, right):
            left_int = int(clamp(left_sample, -1.0, 1.0) * 32767.0)
            right_int = int(clamp(right_sample, -1.0, 1.0) * 32767.0)
            frame_data.extend(struct.pack("<hh", left_int, right_int))

        wav_file.writeframes(frame_data)


def main() -> None:
    left, right = render_rotor_bed()

    for start_time, pan, amplitude, stop_click in build_click_schedule():
        brightness = 0.92 if stop_click else clamp(0.78 + (amplitude * 0.9), 0.7, 1.18)
        click = render_click(amplitude, brightness, stop_click=stop_click)
        add_event(left, right, start_time, pan, click)

    left, right = apply_stereo_reverb(left, right)

    fade_samples = int(0.090 * SAMPLE_RATE)
    for index in range(fade_samples):
        fade_amount = index / max(1, fade_samples - 1)
        left[index] *= fade_amount
        right[index] *= fade_amount

    tail_start = TOTAL_SAMPLES - fade_samples
    for index in range(fade_samples):
        fade_amount = 1.0 - (index / max(1, fade_samples - 1))
        left[tail_start + index] *= fade_amount
        right[tail_start + index] *= fade_amount

    left, right = normalize_stereo(left, right)
    write_wav(left, right, OUTPUT_PATH)

    print(f"Wrote {OUTPUT_PATH} ({DURATION_SECONDS:.2f}s, {SAMPLE_RATE} Hz stereo)")


if __name__ == "__main__":
    os.chdir(Path(__file__).resolve().parents[1])
    main()
