# FUTURISMA — Browser Performance Baseline

Recorded: 2026-08-24

This is the regression baseline for the current Greenwater Strip vertical slice before the authored environment package is integrated. It records repeatable browser evidence from the local development build; it is not a universal hardware certification.

## Test setup

- Browser: Codex in-app Chromium browser.
- Race: deterministic TOTEM autopilot, five laps, 2,515.982 m per lap.
- Result: 02:52.825 total, 00:34.441 best lap.
- Lap times: 34.500 s, 34.442 s, 34.517 s, 34.683 s, 34.683 s.
- Audio was started by a real user-activation click before each soak.
- Diagnostics URL: `?demo=1&diagnostics=1&start=manual`.

## Five-lap results

| Measurement | Adaptive endurance run | High-quality GPU run |
| --- | ---: | ---: |
| Internal 3D resolution | 495 × 540 | 1280 × 720 |
| Device pixel ratio | 0.59 | 1.00 |
| p95 frame time | 9.9 ms | 9.9 ms |
| Maximum sampled frame time | 10.4 ms | 10.4 ms |
| Peak draw calls | 81 | 92 |
| Peak visible triangles | 41,532 | 42,688 |
| Geometry resources at finish | 87 | 87 |
| Texture resources at finish | 17 | 17 |
| Physics steps | 20,739 | 20,739 |
| Audio control updates | 5,185 | 5,185 |
| Measured audio control rate | 30 Hz | 30 Hz |
| Music transitions | 44 | 44 |
| Vehicle resource requests | 1 | 1 |
| Heap at finish | 52.3 MB | 59.3 MB |
| Maximum sampled heap | 57.5 MB | 70.0 MB |
| Heap change over run | 0.0 MB | -5.4 MB |

Both runs completed with zero impacts, missed gates, recoveries, wrong-way events, WebGL context losses, or context restores. The high-quality run held its requested 1280 × 720 internal resolution for the full race without adaptive fallback. Geometry and texture counts stayed fixed, the vehicle was requested once, and neither soak showed sustained heap growth.

## Idle and interruption results

The frame scheduler keeps input polling live while suppressing unchanged world work:

| State | Observation window | Extra WebGL draws | Extra physics steps | Extra audio control updates |
| --- | ---: | ---: | ---: | ---: |
| Ready screen | 1.5 s / 121 input frames | 0 | 0 | 0 |
| Focus-loss pause | 1.6 s / 120 input frames | 0 | 0 | 0 |

The focus-loss probe froze at 00:00.983 and only accepted a fresh Enter after interruption-safe input release. Its recovered one-lap run completed in 00:34.499 with a 9.9 ms p95 frame time, zero impacts or missed gates, 87 geometries, 17 textures, and one vehicle request. The result screen continues rendering during its visible vehicle coast, then becomes idle when speed reaches zero.

The post-scheduler five-lap high-quality acceptance rerun reproduced the exact locked lap sequence and renderer envelope: 9.9 ms p95 / 10.4 ms maximum, 92 peak calls, 42,688 peak triangles, 87 geometries, 17 textures, 20,739 physics steps, 5,185 audio updates at 30 Hz, and one vehicle request. Heap ended 0.3 MB below its race-start sample, with every gameplay and WebGL fault counter at zero.

The active-frame projection/allocation pass then removed the duplicate chase-camera course search and reused one audio filter-target object across all 30 Hz control updates. A normal-motion one-lap probe logged exactly 4,139 presentation projections for 4,139 rendered frames, completed in 00:34.499, and retained the approved 56.02–70.47° camera range. A five-lap reduced-motion soak logged exactly 20,739 projections for 20,739 rendered frames, reproduced the locked lap sequence, held 9.7 ms p95 / 10.4 ms maximum, and retained the same 92-call / 42,688-triangle peak envelope with zero gameplay or WebGL faults.

## Post-boost momentum acceptance

The boost-release physics pass removed the one-step non-boost speed clamp. At
120 Hz, a full-speed release now carries 379.9 km/h after 0.5 seconds and
decays to 346.2 km/h after 2 seconds before settling at the existing 330.0 km/h
cruise speed. The 60/120 Hz post-boost result differs by less than 0.2 m/s, and
the mixed-control 240-second physics soak remains within 0.017% distance drift.

A normal-motion, high-quality five-lap browser acceptance run completed in
02:52.816 with laps of 34.483, 34.442, 34.525, 34.683, and 34.683 seconds. It
held 9.8 ms p95 / 10.4 ms maximum frame time at a 1045 × 1138 internal buffer,
peaked at 81 draw calls and 41,544 visible triangles, and finished at 87
geometries / 17 textures. All eight gates cleared on every lap with zero
impacts, recoveries, wrong-way events, missed gates, or WebGL context faults.
The fresh package advisory check on 2026-08-24 reported zero vulnerabilities.

## Input and effect lifecycle acceptance

Keyboard launch now has one action owner: a real Enter press progresses from
countdown into racing without the same event immediately pausing the trial. A
forced WebGL loss/restoration then held the race paused, reported one loss and
one restore, and resumed into racing only after a fresh Enter press.

Inactive impact sparks are no longer submitted to the renderer. A clean
1440 × 900 high-quality lap completed in 34.483 seconds at 10.0 ms p95, peaked
at 90 draw calls / 42,664 triangles, reported zero point vertices, and uploaded
86 geometries / 17 textures. The diagnostics-only rail-impact probe separately
recorded one collision and one spark burst at 5 m, then returned to zero point
vertices after the burst expired. Six alternating portrait and landscape
resizes matched canvas dimensions exactly while the loaded standby scene stayed
fixed at 58 geometries / 8 textures.

## Wet-surface continuity acceptance

Water Table now consumes the authored `0.8` grip multiplier and `0.8 s`
recovery. The deterministic response reaches 0.805 grip after 0.2 seconds on
the sheet and recovers to 0.990 across the authored recovery window, with less
than 0.001 difference between 60 and 120 Hz. Dry frames return directly from
the neutral fast path without evaluating an exponential response.

The isolated browser probe reached 0.800 grip at 586 m and returned to 1.000 at
595 m without an impact. A subsequent normal-motion, high-quality five-lap run
repeated a 0.801 minimum and finished at 1.000 grip. It completed in
02:52.799 with laps of 34.483, 34.433, 34.517, 34.683, and 34.683 seconds,
held 9.7 ms p95 / 10.4 ms maximum frame time, peaked at 93 draw calls / 42,720
triangles, and retained 86 geometries / 17 textures. It recorded zero impacts,
missed gates, recoveries, wrong-way events, spark bursts, or WebGL faults.

## Ambient animation cadence acceptance

Steam puffs, vent warning lamps, and the Hangar Six cargo hook now sample their
absolute-time animation at 30 Hz. Vehicle motion, camera presentation, input,
and the fixed 120 Hz physics model remain independent. Both normal and reduced
motion measured exactly 30.0 Hz through Hangar Six.

The five-lap high-quality acceptance recorded 5,184 atmosphere updates across
20,736 rendered frames: one dynamic ambient upload for every four presented
frames, a 75% reduction from the previous per-frame path. It completed the
locked 02:52.799 lap sequence at 10.0 ms p95 / 10.4 ms maximum, peaked at 92
draw calls / 42,696 triangles, retained 86 geometries / 17 textures, and ended
with 1.2 MB sampled heap growth. All gameplay, particle, and WebGL fault
counters remained at zero.

## Suspended-audio lifecycle acceptance

Real-time engine automation, sector-profile lookup, music ramps, and transient
cue creation now require an advancing AudioContext clock. Autoplay/demo sessions
whose context remains `suspended` perform no audio-control work and create no
inaudible oscillator nodes. Sector music is evaluated only after a real 30 Hz
audio-control tick and remains on its final authored state during result-screen
coasting.

A click-started 1440 × 900 high-quality lap kept the context `running`, measured
exactly 30.0 Hz across 1,065 control updates, performed eight authored music
transitions, reached six concurrent transient voices, and settled at zero active
voices after the finish sting. It completed in 34.483 seconds at 9.8 ms p95 /
10.4 ms maximum with zero skipped cues, impacts, or recoveries.

The complementary suspended-context five-lap soak performed zero audio-control
updates and zero music transitions. It safely rejected 78 attempted cues while
active and peak transient-node counts remained zero for the entire run. The
locked 02:52.799 lap sequence held 9.7 ms p95 / 10.5 ms maximum, peaked at 92
draw calls / 42,696 triangles, and retained 86 geometries / 17 textures with
zero impacts, recoveries, or WebGL context faults. The diagnostics-enabled
browser reported 8.3 MB sampled heap growth; direct audio-node and GPU-resource
counters did not grow.

## Finish run-out acceptance

The previous fixed 5.5 m/s² result coast could carry an 86 m/s finish for nearly
16 seconds and roughly 680 metres after the result overlay appeared. The new
speed-dependent run-out preserves visible momentum for its first second, travels
98.1 metres in the deterministic 120 Hz model, and reaches a complete stop within
3.5 seconds. Its 60/120 Hz stopping-distance difference remains below 0.7 metres.

The result state also presents neutral driving input, so a held player control or
the showcase controller cannot leave throttle animation, exhaust plumes, braking,
or boost feedback latched after the finish. A high-quality browser lap stopped at
97 metres past The Cradle with fully retracted plumes, one clean idle-frame
handoff, zero active transient audio nodes, and stable 86-geometry / 17-texture
resource counts. The complete lap plus run-out rendered 4,516 frames at 9.9 ms
p95 / 10.4 ms maximum with zero impacts or recoveries.

## Runtime invariants

Keep these true while integrating the authored Greenwater environment:

- Deterministic clean laps remain inside the approved 34–36 second window.
- Physics remains fixed at 120 Hz and procedural audio control remains capped at 30 Hz.
- Vehicle resources load once; repeated laps must not create new geometry or textures.
- No missed gates, recoveries, wrong-way warnings, or impacts occur on the deterministic clean line.
- High-quality mode must not silently lower its requested render scale.
- WebGL context recovery, reduced motion, manual control handoff, and one-lap probes remain independently testable.
- Ready, paused, and settled-result screens perform no simulation, presentation, audio-control, or WebGL draw work until invalidated or resumed.
- Pose and chase-camera presentation share one course projection per rendered frame; real-time audio control reuses its filter-target storage.
- Water Table reaches the authored 0.8 grip floor and recovers over 0.8 seconds without a one-step handling snap.
- Ambient steam, warning lamps, and cargo-hook motion remain locked to 30 Hz without changing vehicle, camera, or input cadence.
- Suspended or interrupted audio clocks create no transient nodes or automation work; a running context releases every transient voice back to zero.
- Final driving input is neutral, and the visible run-out settles within 3.5 seconds and roughly 100 metres before simulation, audio control, and WebGL drawing become idle.

## Environment integration gates

The complete scene must remain at or below the production limits in `GREENWATER_ENVIRONMENT_ART_BRIEF.md`: 120 peak draw calls and 220,000 simultaneously visible triangles. The authored environment may contribute at most 24 simultaneously visible draw calls and 175,000 simultaneously visible triangles.

After integrating the authored environment package, rerun both five-lap soaks and compare:

1. Lap times, p95 and maximum frame time.
2. Peak draw calls and visible triangles.
3. Geometry, texture, and vehicle-request counts from lap one through lap five.
4. Heap at start, maximum sampled heap, and heap at finish.
5. Audio control rate, music transitions, and AudioContext state.
6. Impacts, missed gates, recoveries, wrong-way entries, and WebGL context failures.

A visual improvement is not accepted if it causes resource counts or heap use to grow per lap, breaks the deterministic line, exceeds the art brief's hard budgets, or forces high-quality mode to reduce its render scale.
