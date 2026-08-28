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
- brake + steer at speed: drift
- `Shift` / gamepad A: boost
- `R` / gamepad Y: recover at the last cleared vector
- `Escape`, `P`, or gamepad Start: pause/resume
- `M` / gamepad Back: mute procedural audio

Standard gamepad triggers control thrust and braking. The four-ship Greenwater
race defaults to five laps. Add `?laps=1` through `?laps=9` to override the
race length for testing. Emptying the boost reserve locks boost until the input
is released, preventing depleted thrust, audio, and effects from pulsing. The
reserve meter and drive-state readout both call for that release in amber.
Releasing boost or leaving a boost pad preserves the earned overspeed briefly,
then bleeds it back into the cruise envelope instead of snapping the vehicle to
a lower cap in one physics step.
Gamepad axes use a rescaled 16% deadzone and reject invalid driver values;
while a keyboard direction is held it wins over an opposing analogue axis.
TOTEM now uses player-controlled heading with speed-sensitive steering, grip, and
high-speed drift. Course vectors must be cleared in order for a lap to count.
The chase lens expands with speed, boost, and drift, then compresses slightly
under high-speed braking; reduced motion keeps the same states at lower range.
TOTEM's accepted model now drives a restrained runtime ambience layer from its
authored effect anchors: short polygonal cyan exhaust, a low-poly hover shadow,
and two instanced wet wake strips. Its authored steering fins are seated directly
on the forward boom mounts at runtime, preserving the intended connected
silhouette without changing the accepted GLB. Boost changes the streak colour
and plume read without bloom; reduced motion disables rapid plume pulsing while
preserving the feedback.
The vehicle must also pass inside each authored gate span. Compatible gamepads
receive restrained boost, checkpoint, impact, recovery, and finish rumble.
The HUD calls upcoming turns, the next gate, corrective edge steering, live
position/gap, and the remaining distance to the finish. Multi-lap races also
report the last lap in the HUD, surface a dedicated lap/final-lap split at The
Cradle, and finish with the full four-ship classification plus the player's
best lap. Airbrakes and the
standing-water grip loss feed the procedural noise layer as well as handling
feedback. Water Table now uses its authored 80% grip floor and 0.8-second
recovery instead of switching lateral response instantly at the sheet boundary.
Crossing the final gantry neutralizes held driving input, carries a short
speed-dependent run-out, and settles TOTEM near The Cradle before the world
enters its idle result state. “Race Again” rebuilds the canonical launch input,
camera framing, and transient-effect buffers while reusing the loaded vehicle,
course, audio graph, and GPU resources.
If a gate is missed, the HUD keeps the failure visible, offers the recovery
control, and includes the required extra circuit in the finish distance.
A sustained high-speed route reversal suppresses normal turn calls and displays
an explicit turn-around or recovery instruction; brief spins and low-speed
rotation do not trigger it.
Hangar Six restores the authored warning-cycle steam vents and cosmetic cargo
hook; the two outer-line cable coils now deliver a telegraphed hard trip without
interfering with the clean racing line. Fog zones crossfade over the authored
80 metres. Sector lighting follows the same course structure: the open runway
stays pale and acid-lit, Hangar Six drops into a colder shell with an oxide rim,
the Sweep and Canopy turn humid green, and Fuel Row warms toward sodium service
light before the final cool return. The trance, jungle, deep DnB, and techstep
stem changes land on 174 BPM bar boundaries. Their shared four-bar tonal plan is
locked to F minor, and the eight gate confirmations now climb through that same
scale instead of using unrelated pitches;
boost opens both the music low-pass filter and a restrained high shelf without
starting another layer. If browser policy suspends the AudioContext, transient
cues and real-time automation are skipped until its clock is running; this
prevents inaudible oscillator nodes from accumulating behind autoplay blocks.

Three deterministic rivals reuse the already-loaded TOTEM model through three
merged material batches plus one shared engine-glow batch. They add no second
vehicle request, use fixed authored pace rather than rubber-banding, stay clear
of the sampled track edge, and vary their lateral line only for readable
passing. A restrained visual-only bank follows lateral motion and course bends,
while per-rival exhaust tones preserve the same shared geometry and draw-call
budget. The accepted Privateer 13, Nightform 24 and base decal atlases give the
field authored low-resolution identity without turning Greenwater into neon
cyberpunk. Position changes,
final lap and classification use sparse F-minor cues; the same state remains
fully readable with audio muted.

## Visual test mode

Append `?demo=1&laps=1` to the URL to run an automated one-lap throttle,
steering, and boost pass for camera and rendering QA. The deterministic QA line
targets the authored 34–36 second lap window without relying on wall contacts.
The HUD labels this path `AUTOPILOT`. Any deliberate thrust, steering, braking,
or boost input hands control to the player for the rest of the page session, so
the showcase controller never competes with manual driving.

Add `&diagnostics=1` to print draw calls, triangles, GPU resource counts and a
frame-pacing, race-line, rival-field, classification, lap-split, and heap summary once per second during a
performance pass. Use `&quality=low` or `&quality=high` to lock render scale.
The default targets a deliberately pixelated 540-line 3D layer, can step down
to 360 lines after sustained slow frames, and recovers after sustained fast
frames while racing. A presentation interpolation layer keeps the deterministic
120 Hz handling model visually even on 144/165/240 Hz displays. The HTML
telemetry remains full-resolution. Steam, warning-lamp, and cargo-hook ambience
uses an absolute-time 30 Hz cadence, reducing dynamic instance uploads without
lowering vehicle, camera, or input presentation rates. Add
`&motion=reduce` to exercise the same reduced-motion path as the operating-system
preference.
Diagnostics also report course assembly, critical vehicle fetch/load, total
startup-ready, optional asset-kit load timing, and the measured atmosphere
update rate. Audio diagnostics include the context state, 30 Hz control cadence,
music-transition count, active/peak transient voices, and safely skipped cues.
They also include race-event cue count, player position changes, rival laps,
unwrapped distances, finish times, minimum separation, fixed-pace multiplier,
and the exact rival draw-call/triangle contribution.
The production shell preloads
the required TOTEM runtime GLB so its transfer overlaps module parsing.

For focused QA, `&diagnostics=1&probe=recovery` starts TOTEM just beyond
Greenwater's open edge and exercises the production auto-recovery countdown and
reinsertion path. The probe is ignored unless diagnostics are enabled.
Use `&diagnostics=1&probe=wrong-way` to start TOTEM moving backward on the
opening straight and verify warning engagement plus manual recovery.
Use `&diagnostics=1&probe=impact` to start against the opening rail and verify
impact feedback, spark emission, and automatic spark-buffer culling.
Use `&diagnostics=1&probe=water` to cross the authored Water Table sheet and
verify the 80% grip floor plus the 0.8-second recovery response.
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
npm run validate:environment -- /absolute/path/to/GREENWATER_ENVIRONMENT_STAGE1.zip
npm run validate:environment -- /absolute/path/to/GREENWATER_ENVIRONMENT_STAGE2.zip /absolute/path/to/GREENWATER_ENVIRONMENT_STAGE1.zip
npm run validate:environment -- /absolute/path/to/GREENWATER_ENVIRONMENT_v1.0.zip /absolute/path/to/GREENWATER_ENVIRONMENT_STAGE2.zip
```

`public/_headers` carries the production CSP, clickjacking, MIME-sniffing,
cross-origin, HSTS, referrer, and browser-permission policy for static hosts that
support a `_headers` file. Configure equivalent response headers if the chosen
host uses another format.

The local suite verifies accepted asset hashes, measured map invariants,
longitudinal and steering response at 60/120 Hz, a 240-second mixed-control
physics soak, checkpoint, hazard, and finish-distance rules,
showcase-to-manual control intent, music timing, high-refresh presentation
cadence, render-resolution tiers,
strict browser security policy, pinned package versions, the production build,
raw and gzip startup budgets across every HTML-referenced asset, and hostile
asset-package fixtures. The Greenwater package
validator reads the ZIP without extracting it, rejects traversal, duplicate,
encrypted, overlapping, over-expanded, corrupt, or undeclared entries, then
checks every manifest hash, PNG structure, embedded GLB image, accessor range,
node transform, material role, required Stage 1 kit-root contract, Stage 2
placement vector, runtime hierarchy, sector/material merge, measured budget,
Stage 3 render set, acceptance report, and the upward-facing deck audit. When
successive packages are supplied, it proves both that Stage 2 preserves the
accepted Stage 1 art contract and that final v1.0 preserves the accepted Stage 2
placements, budgets, atlases, and unchanged geometry payloads. The only allowed
final runtime geometry delta is the corrected normals and triangle winding on
exactly the twelve sector deck meshes. Browser
diagnostics remain the source of truth for full-lap
draw calls and frame pacing. The current five-lap adaptive and high-quality
soak results, plus the gates to rerun after environment integration, are locked
in [`docs/PERFORMANCE_BASELINE.md`](docs/PERFORMANCE_BASELINE.md).
The requirement-by-requirement closeout for this core-runtime phase is in
[`docs/CORE_RUNTIME_COMPLETION_AUDIT.md`](docs/CORE_RUNTIME_COMPLETION_AUDIT.md).

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

The accepted environment history is preserved in
`artifacts/GREENWATER_ENVIRONMENT_STAGE1.zip`,
`artifacts/GREENWATER_ENVIRONMENT_STAGE2.zip`, and the accepted final
`artifacts/GREENWATER_ENVIRONMENT_v1.0.zip`. The accepted visual-production
freeze is preserved in `artifacts/GREENWATER_VISUAL_IDENTITY_v1.2.zip`, and the
accepted living-world freeze is preserved in
`artifacts/GREENWATER_LIVING_WORLD_v1.3.zip`. These successive contracts are
checked by the normal test suite. The final v1.2 runtime is served from
`public/assets/greenwater/`; the procedural course continues to own
collision, projection, checkpoints, hazards and recovery. The Phase 1 prop kit
remains a visual load-failure fallback. Visual Identity v1.2 bakes the approved
signage state into the GLB atlas: the duplicate authored distance faces and lap
numeral are absent, while the dark lap plate and header remain. The game's
correctly placed 200M/150M/100M/50M boards are therefore the sole braking-
distance language, with no runtime texture alteration.

The accepted Living World v1.3 freeze is integrated as a non-colliding sibling
of that frozen environment. It adds the reviewed 12-sector lighting/FogExp2
palette plus mist, rain, steam, water glints, selective foliage sway and small
industrial lamps. The layer is fixed at four draw calls / 310 triangles, runs
from one 30 Hz updater, reuses the loaded jungle and emissive atlases, and adds
only `greenwater_motion_512.png`. The deterministic 70-file archive is locked at
SHA-256
`72984328ef3005619e4c69991da46c1c9e21282a113d1b3ffc873a57e9b3191c`;
the accepted v1.2 archive remains unchanged and is not re-baselined.

The accepted Surface Character v1.4 final freeze is integrated as one more
static, non-colliding sibling. Its one unlit mesh adds 388 coarse patina decals,
776 triangles, one draw call and one 512 × 512 nearest-filtered texture without
an updater, lighting, collision or gameplay data. The deterministic 111-file
final archive is preserved in `artifacts/GREENWATER_SURFACE_CHARACTER_v1.4.zip`
and locked at SHA-256
`3e5f21868be3274116e096dc6b4a3bcc5c0011a7c7a5d8ef9ee93b759740458b`.
Its accepted review provenance remains
`3d92dc8fc69425eb71e8a1072469e2ec5756911163c912432438d9b25e3d12c3`;
all v1.2, v1.3 and v1.4 freeze flags are true.

The accepted Facility Story v1.5 final freeze is integrated into the served
environment GLB. The deterministic 185-file final archive is preserved in
`artifacts/GREENWATER_FACILITY_STORY_v1.5.zip` and locked at SHA-256
`118bc6f00f4db5d5ec18ec805d0738aa672765a849b2f2169ccb1a47ad8ca2a9`.
Its final manifest records production-byte identity with accepted review archive
`4c1b2ddd9cd5fc1fd50899c5caa5f1cc3440d6d4a824acd17c235f2e61723123`;
its runtime GLB is locked at
`5b711fb7bc46533fa6eb6a4ce9b455efe7866061e4f6ea10f82eb0996da20177`.
It contains 60 merged environment meshes and 61,798 authored triangles, and
paints only `reserved_c15` and `reserved_m15`.
The accepted v1.2 signage atlas and the v1.3/v1.4 sibling layers remain
unchanged. Native one- and five-lap browser gates are complete and
`final_v15_freeze` is true.

The exact accepted v1.5 review archive is not retained locally. A later ZIP
with the same filename is explicitly quarantined because it packages the final
source HTML rather than the original review source. The historical review hash
is not re-baselined; the accepted final freeze remains the local runtime
authority. See `docs/GREENWATER_FACILITY_STORY_V1_5_PROVENANCE_GAP.md`.

The accepted Race Presence v1.6 final freeze is integrated into TOTEM and the
four-craft field. Its deterministic 65-entry archive is preserved in
`artifacts/GREENWATER_RACE_PRESENCE_v1.6.zip` and locked at SHA-256
`2bd5adfd1350b2fd2a9302a8f4139918d1e1d0fe3a1b88b4b80f4cffeb4a6b8a`.
The baked runtime GLB, 256 × 256 effects atlas and NEEDLE 16 livery remain
byte-identical to the accepted review at SHA-256
`4bec092f1c85c78b00a4974532b0dda5f1f89f756d9741535820368e3cfd35ec`,
`d5562ae064c9532fd447c89ae013642dc03f72f7354293caa952972ad5af8aa3`
and `2f8b3528845eaa7167062e93ae43fedf74e0d6c2ddc14cea14d565e8ec95dc1c`.
The included builder reproduces the final archive byte-for-byte, all integration
gates pass, `final_v16_freeze` is true and Map 02 has not started.

The production contract for Greenwater's authored environment art is in
`docs/GREENWATER_ENVIRONMENT_ART_BRIEF.md`. It preserves the accepted route and
defines the modular kit, landmark anchors, navigation grammar, runtime budgets,
and validated export package required for integration.
The Stage 3 presentation freeze and Stage 4 deck-winding correction are complete.
Greenwater's Production Pass 1 and deterministic Visual Identity v1.2 freeze are
also accepted and integrated. Living World v1.3 has passed package, full-suite
and high-quality browser integration checks, and its deterministic final freeze
is now accepted and byte-locked. Surface Character v1.4 has passed package,
full-suite and native 1600 × 900 browser integration checks; its deterministic
final freeze is also accepted and byte-locked. The
completed prompt is retained in `docs/GREENWATER_ENVIRONMENT_DESIGN_AGENT_PROMPT.md`
as the production decision record. The signage brief and its diagnostic history
remain in `docs/GREENWATER_SIGNAGE_V1_1_DESIGN_AGENT_PROMPT.md`; the implementation
now resolves that issue directly. The completed visual-identity prompt remains in
`docs/GREENWATER_VISUAL_IDENTITY_LOCK_DESIGN_AGENT_PROMPT.md` as a decision record.
