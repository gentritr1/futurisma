# FUTURISMA

First playable vertical slice for a PS2-inspired anti-gravity racer built with Three.js.

## Run locally

```sh
npm install
npm run dev
```

Open the local URL printed by Vite.

## Controls

- `W` / Up: thrust
- `A D` / Left Right: steer
- `S` / Down: brake
- `Shift` / gamepad A: boost
- `R` / gamepad Y: recover at the last cleared vector
- `Escape`, `P`, or gamepad Start: pause/resume
- `M` / gamepad Back: mute procedural engine audio

Standard gamepad triggers control thrust and braking. The Greenwater Strip time
trial defaults to five laps. Add `?laps=1` through `?laps=9` to override the
race length for testing.
TOTEM now uses player-controlled heading with speed-sensitive steering, grip, and
high-speed drift. Course vectors must be cleared in order for a lap to count.
The vehicle must also pass inside each authored gate span. Compatible gamepads
receive restrained boost, checkpoint, impact, recovery, and finish rumble.
The HUD calls upcoming turns, the next gate, corrective edge steering, and the
remaining distance to the finish.

## Visual test mode

Append `?demo=1&laps=1` to the URL to run an automated one-lap throttle,
steering, and boost pass for camera and rendering QA. The deterministic QA line
targets the authored 34–36 second lap window and still exercises edge impacts.

Add `&diagnostics=1` to print draw calls, triangles, GPU resource counts and a
frame-pacing, race-line, and heap summary once per second during a performance
pass. Use `&quality=low` or `&quality=high` to lock render scale; the default
scale steps down automatically only after sustained slow frames. Add
`&motion=reduce` to exercise the same reduced-motion path as the operating-system
preference.

## Verification

```sh
npm test
npm audit --audit-level=high
```

The local suite verifies accepted asset hashes, measured map invariants,
longitudinal handling at 60/120 Hz, strict browser security policy, pinned
package versions, the production build, and gzip budgets. Browser diagnostics
remain the source of truth for full-lap draw calls and frame pacing.

## Production asset

The accepted source handoff is preserved in `artifacts/TOTEM_Phase1_v1.0-patch1.zip`. Runtime copies are served from `public/assets/totem/`.

The accepted Greenwater map handoff is preserved in
`artifacts/GREENWATER_MAP01_v1.0.zip`. Its measured runtime centreline and
validation report live in `src/game/data/`.
