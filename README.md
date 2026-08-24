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
- `M` / gamepad Back: mute procedural audio

Standard gamepad triggers control thrust and braking. The Greenwater Strip time
trial defaults to five laps. Add `?laps=1` through `?laps=9` to override the
race length for testing. Emptying the boost reserve locks boost until the input
is released, preventing depleted thrust, audio, and effects from pulsing. The
reserve meter and drive-state readout both call for that release in amber.
TOTEM now uses player-controlled heading with speed-sensitive steering, grip, and
high-speed drift. Course vectors must be cleared in order for a lap to count.
The chase lens expands with speed, boost, and drift, then compresses slightly
under high-speed braking; reduced motion keeps the same states at lower range.
The vehicle must also pass inside each authored gate span. Compatible gamepads
receive restrained boost, checkpoint, impact, recovery, and finish rumble.
The HUD calls upcoming turns, the next gate, corrective edge steering, and the
remaining distance to the finish. Multi-lap trials also report the last lap in
the HUD, surface a dedicated lap/final-lap split at The Cradle, and retain a
lap-by-lap best-time ledger on the result screen. Airbrakes and the
standing-water grip loss feed the procedural noise layer as well as handling
feedback.
If a gate is missed, the HUD keeps the failure visible, offers the recovery
control, and includes the required extra circuit in the finish distance.
A sustained high-speed route reversal suppresses normal turn calls and displays
an explicit turn-around or recovery instruction; brief spins and low-speed
rotation do not trigger it.
Hangar Six restores the authored warning-cycle steam vents and cosmetic cargo
hook; the two outer-line cable coils now deliver a telegraphed hard trip without
interfering with the clean racing line. Fog zones crossfade over the authored
80 metres, while the trance, jungle, deep DnB, and techstep stem changes land on
174 BPM bar boundaries. Their shared four-bar tonal plan is locked to F minor;
boost opens both the music low-pass filter and a restrained high shelf without
starting another layer.

## Visual test mode

Append `?demo=1&laps=1` to the URL to run an automated one-lap throttle,
steering, and boost pass for camera and rendering QA. The deterministic QA line
targets the authored 34–36 second lap window without relying on wall contacts.
The HUD labels this path `AUTOPILOT`. Any deliberate thrust, steering, braking,
or boost input hands control to the player for the rest of the page session, so
the showcase controller never competes with manual driving.

Add `&diagnostics=1` to print draw calls, triangles, GPU resource counts and a
frame-pacing, race-line, lap-split, and heap summary once per second during a
performance pass. Use `&quality=low` or `&quality=high` to lock render scale.
The default targets a deliberately pixelated 540-line 3D layer, can step down
to 360 lines after sustained slow frames, and recovers after sustained fast
frames while racing. A presentation interpolation layer keeps the deterministic
120 Hz handling model visually even on 144/165/240 Hz displays. The HTML
telemetry remains full-resolution. Add
`&motion=reduce` to exercise the same reduced-motion path as the operating-system
preference.
Diagnostics also report course assembly, critical vehicle fetch/load, total
startup-ready, and optional asset-kit load timing. The production shell preloads
the required TOTEM runtime GLB so its transfer overlaps module parsing.

For focused QA, `&diagnostics=1&probe=recovery` starts TOTEM just beyond
Greenwater's open edge and exercises the production auto-recovery countdown and
reinsertion path. The probe is ignored unless diagnostics are enabled.
Use `&diagnostics=1&probe=wrong-way` to start TOTEM moving backward on the
opening straight and verify warning engagement plus manual recovery.
Use `&diagnostics=1&probe=context` to force one real WebGL context loss and
restore during the opening straight. The race remains paused after restoration
until the player explicitly resumes it. Focus, visibility, and graphics-link
interruptions also discard queued pause/reset/mute edges and require action
controls to be released before they can resume the simulation.
Use `&diagnostics=1&probe=focus` to queue an action around a production
focus-loss pause and verify that the race stays frozen until a fresh resume
press.
Use `?demo=1&diagnostics=1&start=manual` when audio diagnostics must run with
a user-activated AudioContext while retaining the showcase controller.

## Verification

```sh
npm test
npm audit --audit-level=high
```

`public/_headers` carries the production CSP, clickjacking, MIME-sniffing,
cross-origin, referrer, and browser-permission policy for static hosts that
support a `_headers` file. Configure equivalent response headers if the chosen
host uses another format.

The local suite verifies accepted asset hashes, measured map invariants,
longitudinal and steering response at 60/120 Hz, a 240-second mixed-control
physics soak, checkpoint, hazard, and finish-distance rules,
showcase-to-manual control intent, music timing, high-refresh presentation
cadence, render-resolution tiers,
strict browser security policy, pinned package versions, the production build,
and gzip budgets. Browser diagnostics remain the source of truth for full-lap
draw calls and frame pacing. The current five-lap adaptive and high-quality
soak results, plus the gates to rerun after environment integration, are locked
in [`docs/PERFORMANCE_BASELINE.md`](docs/PERFORMANCE_BASELINE.md).

## Production asset

The accepted source handoff is preserved in `artifacts/TOTEM_Phase1_v1.0-patch1.zip`. Runtime copies are served from `public/assets/totem/`.
The accepted prop kit is merged by material into the start-area pit display and
20 sparse course-dressing placements. It supplies the two cable-hazard meshes,
wetland reeds, canopy plants, and two off-track repair units without changing
collision or route logic. Procedural cable visuals remain the load-failure
fallback, while their gameplay warning posts stay active in both paths.

The accepted Greenwater map handoff is preserved in
`artifacts/GREENWATER_MAP01_v1.0.zip`. Its measured runtime centreline and
validation report live in `src/game/data/`.

The production contract for Greenwater's authored environment art is in
`docs/GREENWATER_ENVIRONMENT_ART_BRIEF.md`. It preserves the accepted route and
defines the modular kit, landmark anchors, navigation grammar, runtime budgets,
and validated export package required for integration.
