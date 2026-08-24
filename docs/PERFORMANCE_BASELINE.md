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
