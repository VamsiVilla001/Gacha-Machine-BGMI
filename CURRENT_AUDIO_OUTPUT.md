# Current Audio Output

This document describes the current audio behavior implemented in `broadcastV2.html`.

## Runtime Source

- Page: `broadcastV2.html`
- Audio controller entry point: `createSlotAudio()`
- Runtime cue folder: `assets/audio/`
- Audio element type: multiple `HTMLAudioElement` instances

## Runtime Cues In Use

The page now uses these cue files:

- `assets/audio/slot-machine-spin-bed.mp3`
- `assets/audio/lever.mp3`
- `assets/audio/numberstop.mp3`
- `assets/audio/final.mp3`

These cues are loaded into four dedicated audio nodes:

- `spin`
- `lever`
- `stop`
- `final`

## Event-to-Cue Mapping

The page still emits these events during reel animation:

- `lever-pull`
- `reel-spin-start`
- `reel-tick`
- `reel-stop`
- `spin-start`

The current audio controller maps them like this:

- `spin-start` -> plays `slot-machine-spin-bed.mp3`
- `lever-pull` -> plays `lever.mp3`
- `reel-stop` with `isFinal === false` -> plays `numberstop.mp3`
- `reel-stop` with `isFinal === true` -> stops the spin bed, then plays `final.mp3`

The current audio controller ignores:

- `reel-spin-start`
- `reel-tick`

That means there is still no separate tick-per-row sound, but there are now separate cues for:

- lever pull
- spin bed
- intermediate reel stop
- final stop / end cue

## Unlock Behavior

Audio is unlocked by the first real user interaction on the broadcast page.

The page listens once for:

- `click`
- `keydown`
- `touchstart`
- `pointerdown`

When the first one happens, `unlock()` runs.

## How `unlock()` Works

`unlock()` primes all runtime cue nodes, not just one file.

Flow:

1. Reset every cue node to time `0`.
2. Temporarily set every cue node to:
   - `muted = true`
   - `volume = 0`
3. Call `play()` on all cue nodes.
4. Pause and reset each node immediately after successful play.
5. If at least one cue resolves successfully:
   - set `audioUnlocked = true`
   - set `mediaPrimed = true`
6. Restore the normal mute/volume state for every cue node.

Important:

- `audioUnlocked` is only set to `true` after `play()` succeeds.
- Remote socket activity alone does not unlock audio.

## Cue Playback Flow During a Spin

When a result is drawn:

1. Reels begin spinning visually.
2. `animateLeverPull()` emits `lever-pull`.
3. The lever cue plays through `lever.mp3`.
4. `spin()` emits `spin-start`.
5. The spin bed starts with `slot-machine-spin-bed.mp3`.
6. Each non-final `reel-stop` plays `numberstop.mp3`.
7. The final `reel-stop` stops the spin bed and plays `final.mp3`.

## Spin Bed Behavior

The spin bed is treated as a dedicated background cue for the spin.

Current behavior:

- it starts from time `0` on each `spin-start`
- it is not looped
- it is stopped/reset when the final stop cue fires
- it is also stopped/reset by `setTicketInstant()` and `slotAudio.stopSpin()`

## Volumes

Current configured cue volumes:

- spin bed: `0.88`
- lever: `0.92`
- stop: `0.94`
- final: `0.96`

When muted, every cue volume is forced to `0`.

## Audio State Model

`getAudioState()` returns one of these values:

- `muted`
- `armed`
- `awaiting-user-gesture`

Meaning:

- `muted`: audio has been disabled through the API
- `armed`: unlock succeeded and the page can attempt playback
- `awaiting-user-gesture`: the page has not yet received a successful unlock gesture

`getStatus()` returns:

- `muted`
- `state`
- `unlocked`
- `mediaPrimed`
- `spinLoopPlaying`

In this implementation, `spinLoopPlaying` refers to whether the spin bed cue is currently playing.

## Public API Exposed on `window`

These helpers are available:

- `window.slotMachineAudio`
- `window.setBroadcastAudioEnabled(enabled, options)`
- `window.getBroadcastAudioStatus()`

Current behavior:

- `setBroadcastAudioEnabled(true)` unmutes and calls `unlock()`
- `setBroadcastAudioEnabled(false)` mutes audio and stops all current cue playback
- `getBroadcastAudioStatus()` returns the current status object

## Sound Prompt Behavior

The page still has a top-center sound prompt in the DOM:

- container id: `sound-prompt`
- button id: `enable-sound-button`

Functionally:

- it is shown while audio is still waiting for a user gesture
- clicking the button calls the same unlock path

Visually:

- the prompt container currently has `opacity: 0`
- the button also currently has `opacity: 0`

So the prompt logic still exists, but the UI is effectively invisible.

## Stop and Reset Behavior

`setTicketInstant()` and `slotAudio.stopSpin()` stop audio by:

- pausing every cue node
- resetting every cue node to `currentTime = 0`
- clearing `spinLoopPlaying`

This is used when the reels are forced into a settled state without a full animated spin.

## Current Limitations

1. Remote socket-triggered spins do not unlock audio by themselves.
2. If the broadcast page never receives one real user interaction, audio will stay silent.
3. `reel-tick` and `reel-spin-start` are emitted but still do not have dedicated runtime cues.
4. The prompt exists in logic but is intentionally invisible because its opacity is set to `0`.
5. The implementation now uses modular cues, but it still depends on the quality and timing of the supplied MP3 assets.

## Summary

The current audio output is a modular cue system:

- unlock once from the first real user interaction
- play a dedicated lever cue on lever pull
- play a dedicated spin bed on `spin-start`
- play a stop cue on each intermediate reel stop
- stop the bed and play a final cue on the last reel stop

That means the page currently provides:

- browser-safe one-time unlock behavior
- separate lever, spin, stop, and final cues

It does not currently provide:

- a dedicated `reel-tick` cue
- a dedicated `reel-spin-start` cue
