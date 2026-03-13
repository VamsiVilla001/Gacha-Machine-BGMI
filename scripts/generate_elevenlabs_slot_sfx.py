from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path


API_URL = "https://api.elevenlabs.io/v1/sound-generation"
DEFAULT_OUTPUT_FORMAT = "mp3_44100_128"


@dataclass(frozen=True)
class SoundPreset:
    key: str
    output_path: Path
    duration_seconds: float
    prompt_influence: float
    text: str
    loop: bool = False


PRESETS: dict[str, SoundPreset] = {
    "lever-pull": SoundPreset(
        key="lever-pull",
        output_path=Path("assets/audio/slot-machine-lever-pull-elevenlabs.mp3"),
        duration_seconds=1.2,
        prompt_influence=0.82,
        text=(
            "One-shot premium slot machine lever pull for broadcast. "
            "Heavy chrome handle grab, downward mechanical pull, spring tension, "
            "clean metallic clack on release, subtle internal gear movement, "
            "tight transient, no voice, no music, no ambience, studio-clean SFX."
        ),
    ),
    "reel-stop-click": SoundPreset(
        key="reel-stop-click",
        output_path=Path("assets/audio/slot-machine-reel-stop-click-elevenlabs.mp3"),
        duration_seconds=0.9,
        prompt_influence=0.86,
        text=(
            "One-shot slot machine reel stop click. "
            "Sharp mechanical halt, polished metal and plastic impact, "
            "small gear lock, punchy transient, short decay, broadcast-ready, "
            "no voice, no music bed, no ambience."
        ),
    ),
    "final-stop-win": SoundPreset(
        key="final-stop-win",
        output_path=Path("assets/audio/slot-machine-final-stop-win-elevenlabs.mp3"),
        duration_seconds=2.4,
        prompt_influence=0.9,
        text=(
            "Slot machine final reel stop followed immediately by a short winning celebration. "
            "Start with a crisp mechanical reel halt, then a bright jackpot-style victory sting "
            "with sparkling chimes and energetic casino payoff, triumphant but tasteful, "
            "no spoken words, no announcer, no crowd, no long music bed, clean esports broadcast SFX."
        ),
    ),
    "win-celebration": SoundPreset(
        key="win-celebration",
        output_path=Path("assets/audio/slot-machine-win-celebration-elevenlabs.mp3"),
        duration_seconds=1.8,
        prompt_influence=0.88,
        text=(
            "Short slot machine winning celebration sting. "
            "Bright casino jackpot chime, sparkling high-end accents, rising triumph, "
            "clean finish, high energy but not cheesy, no voice, no ambience, broadcast-ready."
        ),
    ),
    "stop-sequence": SoundPreset(
        key="stop-sequence",
        output_path=Path("assets/audio/slot-machine-stop-sequence-elevenlabs.mp3"),
        duration_seconds=5.0,
        prompt_influence=0.93,
        text=(
            "Complete slot machine result reveal sequence for broadcast. "
            "Start with a heavy lever pull and spring release. "
            "Then three distinct reel halts revealing final symbols, each stop separated by a short dramatic pause. "
            "First stop is crisp and mechanical, second stop slightly heavier with rising tension, "
            "third stop is the final lock followed instantly by a short winning celebration sting with bright jackpot chimes. "
            "No voice, no announcer, no dialogue, no crowd, minimal background texture, "
            "clean cinematic esports sound design."
        ),
    ),
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Generate slot machine SFX assets via the ElevenLabs sound generation API."
    )
    parser.add_argument(
        "--preset",
        action="append",
        dest="presets",
        help=(
            "Preset name to generate. Repeat for multiple presets. "
            "Available: all, " + ", ".join(sorted(PRESETS))
        ),
    )
    parser.add_argument(
        "--output-format",
        default=DEFAULT_OUTPUT_FORMAT,
        help=f"ElevenLabs output_format query parameter. Default: {DEFAULT_OUTPUT_FORMAT}",
    )
    parser.add_argument(
        "--overwrite",
        action="store_true",
        help="Overwrite existing files instead of skipping them.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print the selected requests without calling the API.",
    )
    return parser.parse_args()


def resolve_presets(selected: list[str] | None) -> list[SoundPreset]:
    if not selected:
        return [PRESETS["stop-sequence"], PRESETS["lever-pull"], PRESETS["reel-stop-click"], PRESETS["final-stop-win"]]

    resolved: list[SoundPreset] = []
    for item in selected:
        if item == "all":
            resolved.extend(PRESETS.values())
            continue
        preset = PRESETS.get(item)
        if not preset:
            available = ", ".join(["all", *sorted(PRESETS)])
            raise SystemExit(f"Unknown preset '{item}'. Available presets: {available}")
        resolved.append(preset)

    seen: set[str] = set()
    unique: list[SoundPreset] = []
    for preset in resolved:
        if preset.key in seen:
            continue
        seen.add(preset.key)
        unique.append(preset)
    return unique


def request_sound_effect(api_key: str, preset: SoundPreset, output_format: str) -> bytes:
    request_url = f"{API_URL}?{urllib.parse.urlencode({'output_format': output_format})}"
    body = json.dumps(
        {
            "text": preset.text,
            "duration_seconds": preset.duration_seconds,
            "prompt_influence": preset.prompt_influence,
            "loop": preset.loop,
            "model_id": "eleven_text_to_sound_v2",
        }
    ).encode("utf-8")

    request = urllib.request.Request(
        request_url,
        data=body,
        method="POST",
        headers={
            "Accept": "audio/mpeg",
            "Content-Type": "application/json",
            "xi-api-key": api_key,
        },
    )

    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            return response.read()
    except urllib.error.HTTPError as error:
        details = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(
            f"ElevenLabs request failed for '{preset.key}' with HTTP {error.code}: {details}"
        ) from error
    except urllib.error.URLError as error:
        raise RuntimeError(f"Unable to reach ElevenLabs for '{preset.key}': {error}") from error


def write_output(destination: Path, audio_bytes: bytes) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(audio_bytes)


def main() -> None:
    os.chdir(Path(__file__).resolve().parents[1])
    args = parse_args()
    presets = resolve_presets(args.presets)

    if args.dry_run:
        for preset in presets:
            print(
                json.dumps(
                    {
                        "preset": preset.key,
                        "output_path": str(preset.output_path),
                        "duration_seconds": preset.duration_seconds,
                        "prompt_influence": preset.prompt_influence,
                        "text": preset.text,
                    },
                    ensure_ascii=True,
                )
            )
        return

    api_key = os.getenv("ELEVENLABS_API_KEY")
    if not api_key:
        raise SystemExit("Missing ELEVENLABS_API_KEY in the environment.")

    for preset in presets:
        if preset.output_path.exists() and not args.overwrite:
            print(f"Skipping existing {preset.output_path}")
            continue

        print(f"Generating {preset.key} -> {preset.output_path}")
        audio_bytes = request_sound_effect(api_key, preset, args.output_format)
        write_output(preset.output_path, audio_bytes)
        print(f"Wrote {preset.output_path}")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("Interrupted", file=sys.stderr)
        raise SystemExit(130)
