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
- `R` / gamepad Y: reset the trial
- `M` / gamepad Back: mute procedural engine audio

Standard gamepad triggers control thrust and braking. The time trial is two laps.

## Visual test mode

Append `?demo=1` to the URL to run an automated throttle, steering, and boost pass for camera and rendering QA.

## Production asset

The accepted source handoff is preserved in `artifacts/TOTEM_Phase1_v1.0-patch1.zip`. Runtime copies are served from `public/assets/totem/`.
