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
REFERENCE_BASELINE_SECONDS = 10.057125
SPIN_BED_WAV_PATH = Path("assets/audio/slot-machine-spin-bed.wav")
SPIN_BED_MP3_PATH = Path("assets/audio/slot-machine-spin-bed.mp3")
LEVER_WAV_PATH = Path("assets/audio/slot-machine-lever-pull.wav")
LEVER_MP3_PATH = Path("assets/audio/slot-machine-lever-pull.mp3")
REEL_STOP_WAV_PATH = Path("assets/audio/slot-machine-reel-stop.wav")
REEL_STOP_MP3_PATH = Path("assets/audio/slot-machine-reel-stop.mp3")
FINAL_STOP_WAV_PATH = Path("assets/audio/slot-machine-final-stop-win.wav")
FINAL_STOP_MP3_PATH = Path("assets/audio/slot-machine-final-stop-win.mp3")
RNG = random.Random(20260313)


def clamp(value: float, minimum: float, maximum: float) -> float:
    return max(minimum, min(maximum, value))


def smoothstep(edge0: float, edge1: float, value: float) -> float:
    if edge0 == edge1:
        return 0.0
    amount = clamp((value - edge0) / (edge1 - edge0), 0.0, 1.0)
    return amount * amount * (3.0 - (2.0 * amount))


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


def render_spin_bed(reference_scale: float) -> list[float]:
    duration = 8.2
    sample_count = int(duration * SAMPLE_RATE)
    output = [0.0] * sample_count
    filtered_noise = 0.0
    base_interval = 0.0615 * reference_scale
    next_tick_time = 0.26
    current_interval = base_interval

    for index in range(sample_count):
        time_seconds = index / SAMPLE_RATE
        amplitude = 1.0 - (0.16 * smoothstep(6.2, duration, time_seconds))
        rotor = (
            0.015 * math.sin(math.tau * 68.0 * time_seconds)
            + 0.010 * math.sin(math.tau * 136.0 * time_seconds + 0.5)
            + 0.006 * math.sin(math.tau * 204.0 * time_seconds + 1.1)
        )

        noise = RNG.uniform(-1.0, 1.0)
        filtered_noise = (filtered_noise * 0.982) + (noise * 0.018)
        gear = (noise - filtered_noise) * 0.018 * amplitude * (0.65 + (0.35 * reference_scale))
        output[index] += ((rotor * 0.88) + gear) * amplitude

        if time_seconds >= next_tick_time:
            click = render_noise_click(0.24, 0.050, 1.0, 234.0, stop_style=False)
            for offset, sample in enumerate(click):
                target = index + offset
                if target >= sample_count:
                    break
                output[target] += sample * (0.76 + (0.24 * amplitude))

            if RNG.random() < 0.38:
                flam_offset = int(0.006 * SAMPLE_RATE)
                for offset, sample in enumerate(click):
                    target = index + flam_offset + offset
                    if target >= sample_count:
                        break
                    output[target] += sample * 0.34

            current_interval += RNG.uniform(-0.0018, 0.0018)
            current_interval = clamp(current_interval, base_interval * 0.94, base_interval * 1.09)
            next_tick_time += current_interval

    return output


def render_final_stop_win() -> list[float]:
    duration = 2.6
    sample_count = int(duration * SAMPLE_RATE)
    output = [0.0] * sample_count

    stop_click = render_noise_click(1.06, 0.34, 1.0, 118.0, stop_style=True)
    for index, sample in enumerate(stop_click):
        output[index] += sample

    celebration_start = 0.08
    coin_times = []
    cursor = celebration_start + 0.16
    while cursor < duration - 0.55:
        coin_times.append(cursor)
        cursor += 0.14 + RNG.uniform(-0.018, 0.026)

    for time_seconds in coin_times:
        coin = render_noise_click(0.40, 0.11, 1.12, 680.0, stop_style=False)
        start_index = int(time_seconds * SAMPLE_RATE)
        for offset, sample in enumerate(coin):
            target = start_index + offset
            if target >= sample_count:
                break
            output[target] += sample * 0.9

    lead_sting = render_tone_burst([1046.5, 1318.5, 1568.0], 0.62, 0.32, 0.02, 0.16)
    arp_specs = [
        (0.24, [659.3, 987.8]),
        (0.46, [783.99, 1174.66]),
        (0.70, [1046.5, 1568.0]),
        (0.96, [1318.5, 1760.0]),
    ]
    bass = render_tone_burst([164.8, 246.9], 1.4, 0.18, 0.03, 0.28)

    def add_tone(start_time: float, tone: list[float], gain: float = 1.0) -> None:
        start_index = int(start_time * SAMPLE_RATE)
        for offset, sample in enumerate(tone):
            target = start_index + offset
            if target >= sample_count:
                break
            output[target] += sample * gain

    add_tone(celebration_start, lead_sting)
    add_tone(celebration_start + 0.04, bass)
    for offset, frequencies in arp_specs:
        add_tone(celebration_start + offset, render_tone_burst(frequencies, 0.42, 0.24, 0.01, 0.14))

    return output


def apply_reverb(samples: list[float], wet_gain: float) -> list[float]:
    taps = [(0.026, 0.64, 0.12), (0.043, 0.59, 0.10), (0.071, 0.54, 0.08)]
    total_samples = len(samples)
    wet = [0.0] * total_samples

    for delay_seconds, feedback, gain in taps:
        delay_samples = max(1, int(delay_seconds * SAMPLE_RATE))
        line = [0.0] * total_samples
        for index in range(delay_samples, total_samples):
            delayed = samples[index - delay_samples] + (line[index - delay_samples] * feedback)
            line[index] = delayed
            wet[index] += delayed * gain

    return [samples[index] + (wet[index] * wet_gain) for index in range(total_samples)]


def normalize_mono(samples: list[float]) -> list[float]:
    peak = max(max(abs(sample) for sample in samples), 1e-9)
    scale = 0.92 / peak
    return [sample * scale for sample in samples]


def mono_to_stereo(samples: list[float], left_gain: float = 1.0, right_gain: float = 1.0) -> tuple[list[float], list[float]]:
    return ([sample * left_gain for sample in samples], [sample * right_gain for sample in samples])


def apply_fades(left: list[float], right: list[float]) -> None:
    total_samples = len(left)
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


def render_and_write(mono_samples: list[float], wav_path: Path, mp3_path: Path, left_gain: float = 1.0, right_gain: float = 1.0) -> None:
    processed = normalize_mono(apply_reverb(mono_samples, 0.28))
    left, right = mono_to_stereo(processed, left_gain=left_gain, right_gain=right_gain)
    apply_fades(left, right)
    write_wav(left, right, wav_path)
    encode_mp3(wav_path, mp3_path)


def main() -> None:
    reference_duration = get_reference_duration_seconds(REFERENCE_PATH)
    reference_scale = reference_duration / REFERENCE_BASELINE_SECONDS

    render_and_write(render_spin_bed(reference_scale), SPIN_BED_WAV_PATH, SPIN_BED_MP3_PATH, 0.98, 1.02)
    render_and_write(render_lever_pull(), LEVER_WAV_PATH, LEVER_MP3_PATH, 0.99, 1.01)
    render_and_write(render_noise_click(1.0, 0.26, 0.98, 136.0, stop_style=True), REEL_STOP_WAV_PATH, REEL_STOP_MP3_PATH, 1.0, 1.0)
    render_and_write(render_final_stop_win(), FINAL_STOP_WAV_PATH, FINAL_STOP_MP3_PATH, 0.99, 1.01)

    print("Wrote synced slot assets:")
    print(f"  {SPIN_BED_MP3_PATH}")
    print(f"  {LEVER_MP3_PATH}")
    print(f"  {REEL_STOP_MP3_PATH}")
    print(f"  {FINAL_STOP_MP3_PATH}")


if __name__ == "__main__":
    os.chdir(Path(__file__).resolve().parents[1])
    main()
