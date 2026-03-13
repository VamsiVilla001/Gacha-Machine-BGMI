from __future__ import annotations

import math
import os
import random
import struct
import subprocess
import wave
from pathlib import Path


SAMPLE_RATE = 48_000
REFERENCE_PATH = Path("audioref/Slot Machine 6.mp3")
OUTPUT_WAV_PATH = Path("assets/audio/slot-machine-sequence.wav")
OUTPUT_MP3_PATH = Path("assets/audio/slot-machine-sequence.mp3")
REFERENCE_BASELINE_SECONDS = 10.057125
REEL_STOP_TIMES = [2.0, 4.0, 6.0]
RNG = random.Random(20260313)


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


def get_reference_duration_seconds(reference_path: Path) -> float:
    command = [
        "ffprobe",
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        str(reference_path),
    ]
    result = subprocess.run(command, capture_output=True, check=True, text=True)
    return float(result.stdout.strip())


def add_mono_event(left: list[float], right: list[float], start_time: float, pan: float, samples: list[float]) -> None:
    start_index = int(start_time * SAMPLE_RATE)
    left_gain, right_gain = equal_power_pan(pan)

    for offset, sample in enumerate(samples):
        index = start_index + offset
        if index >= len(left):
            break
        left[index] += sample * left_gain
        right[index] += sample * right_gain


def render_noise_click(
    amplitude: float,
    duration: float,
    brightness: float,
    body_frequency: float,
    stop_style: bool = False,
) -> list[float]:
    sample_count = int(duration * SAMPLE_RATE)
    output = [0.0] * sample_count
    noise_memory = 0.0
    partials = [
        (820.0, 0.12, 0.040),
        (1540.0, 0.16, 0.030),
        (2860.0, 0.10, 0.020),
    ]

    if stop_style:
        partials = [
            (220.0, 0.24, 0.180),
            (510.0, 0.18, 0.140),
            (980.0, 0.16, 0.100),
            (1840.0, 0.10, 0.080),
        ]

    for index in range(sample_count):
        time_seconds = index / SAMPLE_RATE
        decay = math.exp(-time_seconds * (180.0 if not stop_style else 44.0))
        noise = RNG.uniform(-1.0, 1.0)
        noise_memory = (noise_memory * 0.86) + (noise * 0.14)
        click_noise = (noise - noise_memory) * decay * (0.64 + (0.22 * brightness))

        metal = 0.0
        for frequency, weight, release in partials:
            metal += weight * math.exp(-time_seconds / release) * math.sin(math.tau * frequency * time_seconds)

        body = (
            0.18 * math.exp(-time_seconds / (0.050 if not stop_style else 0.220))
            * math.sin(math.tau * body_frequency * time_seconds)
        )

        output[index] = amplitude * ((click_noise * 0.50) + (metal * brightness) + body)

    return output


def render_lever_pull() -> list[float]:
    duration = 0.68
    sample_count = int(duration * SAMPLE_RATE)
    output = [0.0] * sample_count
    filtered_noise = 0.0

    for index in range(sample_count):
        time_seconds = index / SAMPLE_RATE
        motion = 1.0 - smoothstep(0.28, 0.62, time_seconds)
        noise = RNG.uniform(-1.0, 1.0)
        filtered_noise = (filtered_noise * 0.93) + (noise * 0.07)
        scrape = (noise - filtered_noise) * 0.22 * motion
        pull_tone = (
            0.18 * math.exp(-time_seconds / 0.22) * math.sin(math.tau * (160.0 - (time_seconds * 90.0)) * time_seconds)
            + 0.11 * math.exp(-time_seconds / 0.14) * math.sin(math.tau * 320.0 * time_seconds)
        )
        spring = 0.0
        if time_seconds > 0.36:
            spring_time = time_seconds - 0.36
            spring = 0.20 * math.exp(-spring_time / 0.11) * math.sin(math.tau * 10.5 * spring_time)

        output[index] = (scrape * 0.45) + pull_tone + spring

    latch = render_noise_click(0.85, 0.14, 1.0, 210.0, stop_style=True)
    release = render_noise_click(0.72, 0.12, 1.05, 260.0, stop_style=False)
    for idx, sample in enumerate(latch):
        output[idx] += sample
    release_start = int(0.39 * SAMPLE_RATE)
    for idx, sample in enumerate(release):
        target = release_start + idx
        if target >= sample_count:
            break
        output[target] += sample * 0.82

    return output


def render_spin_bed(total_samples: int, reference_scale: float) -> tuple[list[float], list[float]]:
    left = [0.0] * total_samples
    right = [0.0] * total_samples
    filtered_noise = 0.0

    for index in range(total_samples):
        time_seconds = index / SAMPLE_RATE
        if time_seconds < 0.42:
            continue

        if time_seconds > REEL_STOP_TIMES[-1] + 0.10:
            break

        active_reels = 3
        if time_seconds >= REEL_STOP_TIMES[1]:
            active_reels = 1
        elif time_seconds >= REEL_STOP_TIMES[0]:
            active_reels = 2

        intensity = active_reels / 3.0
        pre_stop_duck = 1.0
        for stop_time in REEL_STOP_TIMES:
            distance = stop_time - time_seconds
            if -0.05 <= distance <= 0.26:
                pre_stop_duck *= 1.0 - (0.38 * (1.0 - smoothstep(-0.05, 0.26, distance)))

        fade_after_final = 1.0 - smoothstep(REEL_STOP_TIMES[-1], REEL_STOP_TIMES[-1] + 0.22, time_seconds)
        amplitude = intensity * pre_stop_duck * fade_after_final

        rotor = (
            0.015 * math.sin(math.tau * 68.0 * time_seconds)
            + 0.010 * math.sin(math.tau * 136.0 * time_seconds + 0.5)
            + 0.006 * math.sin(math.tau * 204.0 * time_seconds + 1.1)
        )

        noise = RNG.uniform(-1.0, 1.0)
        filtered_noise = (filtered_noise * 0.982) + (noise * 0.018)
        gear = (noise - filtered_noise) * 0.018 * amplitude * (0.65 + (0.35 * reference_scale))

        left[index] += ((rotor * 0.88) + gear) * amplitude * 0.96
        right[index] += ((rotor * 0.84) + gear) * amplitude * 1.04

    return left, right


def add_spin_clicks(left: list[float], right: list[float], reference_scale: float) -> None:
    base_interval = 0.0615 * reference_scale
    reel_pans = (-0.58, 0.0, 0.58)

    stages = [
        (0.58, REEL_STOP_TIMES[0] - 0.12, 3, base_interval * 0.96, base_interval * 1.06),
        (REEL_STOP_TIMES[0] + 0.06, REEL_STOP_TIMES[1] - 0.14, 2, base_interval * 1.02, base_interval * 1.18),
        (REEL_STOP_TIMES[1] + 0.08, REEL_STOP_TIMES[2] - 0.18, 1, base_interval * 1.10, base_interval * 1.34),
    ]

    for start_time, end_time, active_reels, interval_start, interval_end in stages:
        tick_time = start_time
        while tick_time < end_time:
            progress = smoothstep(start_time, end_time, tick_time)
            active_pan = reel_pans[:active_reels]
            pan = active_pan[int(progress * len(active_pan)) % len(active_pan)]
            amplitude = (0.18 + (0.06 * active_reels)) * (1.0 - (0.14 * progress))
            brightness = 1.02 - (0.16 * progress)
            body_frequency = 250.0 - (active_reels * 16.0)
            click = render_noise_click(amplitude, 0.055, brightness, body_frequency, stop_style=False)
            add_mono_event(left, right, tick_time, pan, click)

            doubled = 0.45 if active_reels == 3 else 0.28
            if RNG.random() < doubled:
                add_mono_event(left, right, tick_time + (0.006 * reference_scale), pan * 0.7, [sample * 0.46 for sample in click])

            interval = interval_start + ((interval_end - interval_start) * progress) + RNG.uniform(-0.0024, 0.0024)
            tick_time += interval


def add_reel_stops(left: list[float], right: list[float]) -> None:
    stop_specs = [
        (REEL_STOP_TIMES[0], -0.56, 0.92, 146.0, False),
        (REEL_STOP_TIMES[1], 0.0, 1.02, 132.0, False),
        (REEL_STOP_TIMES[2], 0.54, 1.16, 118.0, True),
    ]

    for stop_time, pan, amplitude, body_frequency, is_final in stop_specs:
        stop_click = render_noise_click(amplitude, 0.34 if is_final else 0.26, 0.98, body_frequency, stop_style=True)
        add_mono_event(left, right, stop_time, pan, stop_click)


def render_tone_burst(frequencies: list[float], duration: float, amplitude: float, attack: float, release: float) -> list[float]:
    sample_count = int(duration * SAMPLE_RATE)
    output = [0.0] * sample_count

    for index in range(sample_count):
        time_seconds = index / SAMPLE_RATE
        attack_gain = smoothstep(0.0, attack, time_seconds) if attack > 0 else 1.0
        release_gain = 1.0 - smoothstep(duration - release, duration, time_seconds)
        envelope = attack_gain * release_gain
        sample = 0.0
        for frequency in frequencies:
            sample += math.sin(math.tau * frequency * time_seconds)
        output[index] = amplitude * envelope * (sample / len(frequencies))

    return output


def add_win_celebration(left: list[float], right: list[float], total_duration: float) -> None:
    celebration_start = REEL_STOP_TIMES[-1] + 0.08
    celebration_end = min(total_duration - 0.35, celebration_start + 2.8)

    coin_times = []
    time_cursor = celebration_start + 0.16
    while time_cursor < celebration_end - 0.6:
        coin_times.append(time_cursor)
        time_cursor += 0.14 + RNG.uniform(-0.018, 0.026)

    for time_seconds in coin_times:
        coin = render_noise_click(0.40, 0.11, 1.12, 680.0, stop_style=False)
        add_mono_event(left, right, time_seconds, RNG.uniform(-0.24, 0.24), coin)

    lead_sting = render_tone_burst([1046.5, 1318.5, 1568.0], 0.62, 0.32, 0.02, 0.16)
    add_mono_event(left, right, celebration_start, 0.0, lead_sting)

    arp_frequencies = [
        (0.24, [659.3, 987.8]),
        (0.46, [783.99, 1174.66]),
        (0.70, [1046.5, 1568.0]),
        (0.96, [1318.5, 1760.0]),
    ]
    for offset, frequencies in arp_frequencies:
        tone = render_tone_burst(frequencies, 0.42, 0.24, 0.01, 0.14)
        add_mono_event(left, right, celebration_start + offset, RNG.uniform(-0.18, 0.18), tone)

    bass = render_tone_burst([164.8, 246.9], 1.4, 0.18, 0.03, 0.28)
    add_mono_event(left, right, celebration_start + 0.04, 0.0, bass)


def apply_stereo_reverb(left: list[float], right: list[float]) -> tuple[list[float], list[float]]:
    total_samples = len(left)
    taps_left = [(0.026, 0.64, 0.12), (0.043, 0.59, 0.10), (0.071, 0.54, 0.08)]
    taps_right = [(0.031, 0.63, 0.12), (0.049, 0.58, 0.10), (0.078, 0.52, 0.08)]

    def apply_channel(source: list[float], taps: list[tuple[float, float, float]]) -> list[float]:
        wet = [0.0] * total_samples
        for delay_seconds, feedback, gain in taps:
            delay_samples = max(1, int(delay_seconds * SAMPLE_RATE))
            line = [0.0] * total_samples
            for index in range(delay_samples, total_samples):
                delayed = source[index - delay_samples] + (line[index - delay_samples] * feedback)
                line[index] = delayed
                wet[index] += delayed * gain
        return wet

    wet_left = apply_channel(left, taps_left)
    wet_right = apply_channel(right, taps_right)
    for index in range(total_samples):
        left[index] += wet_left[index] * 0.34
        right[index] += wet_right[index] * 0.34
    return left, right


def normalize_stereo(left: list[float], right: list[float]) -> tuple[list[float], list[float]]:
    peak = max(
        max(abs(sample) for sample in left),
        max(abs(sample) for sample in right),
        1e-9,
    )
    target_peak = 0.92
    scale = target_peak / peak
    return ([sample * scale for sample in left], [sample * scale for sample in right])


def apply_fades(left: list[float], right: list[float], total_samples: int) -> None:
    fade_in_samples = int(0.018 * SAMPLE_RATE)
    fade_out_samples = int(0.12 * SAMPLE_RATE)

    for index in range(fade_in_samples):
        amount = index / max(1, fade_in_samples - 1)
        left[index] *= amount
        right[index] *= amount

    tail_start = total_samples - fade_out_samples
    for index in range(fade_out_samples):
        amount = 1.0 - (index / max(1, fade_out_samples - 1))
        left[tail_start + index] *= amount
        right[tail_start + index] *= amount


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


def encode_mp3(source_wav: Path, destination_mp3: Path) -> None:
    destination_mp3.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-i",
            str(source_wav),
            "-codec:a",
            "libmp3lame",
            "-q:a",
            "2",
            str(destination_mp3),
        ],
        check=True,
        capture_output=True,
    )


def main() -> None:
    reference_duration = get_reference_duration_seconds(REFERENCE_PATH)
    total_duration = max(reference_duration, REEL_STOP_TIMES[-1] + 2.8)
    total_samples = int(total_duration * SAMPLE_RATE)
    reference_scale = reference_duration / REFERENCE_BASELINE_SECONDS

    left, right = render_spin_bed(total_samples, reference_scale)
    add_spin_clicks(left, right, reference_scale)
    add_reel_stops(left, right)
    add_win_celebration(left, right, total_duration)

    lever = render_lever_pull()
    add_mono_event(left, right, 0.0, -0.14, lever)

    left, right = apply_stereo_reverb(left, right)
    apply_fades(left, right, total_samples)
    left, right = normalize_stereo(left, right)

    write_wav(left, right, OUTPUT_WAV_PATH)
    encode_mp3(OUTPUT_WAV_PATH, OUTPUT_MP3_PATH)

    print(
        f"Wrote {OUTPUT_WAV_PATH} and {OUTPUT_MP3_PATH} "
        f"({total_duration:.2f}s, reference {reference_duration:.2f}s)"
    )


if __name__ == "__main__":
    os.chdir(Path(__file__).resolve().parents[1])
    main()
