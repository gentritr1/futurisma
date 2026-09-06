# Ascension Phase C checkpoint

The requested review corrections were committed first as `8515a1e`, then pushed through the specified local origin to GitHub. The thirteen-frame pack is `trench-revision/blind-review/index.html`; it has not changed during event work. The key is outside the pack and has not been presented. Awaiting the user's classification before any 13/13 claim.

## Executed and observed

`art/blender/ascension_trench.py` replaces algae-based scorched walls with dry cracked lining, vertically resolved heat/soot bands, sealed metal drain covers, three dead lamps of four, and a blackened floor with a pale scoured centre. Physical portals mark all three boundaries. `stations.mjs` and `blind-pack.mjs` retain the ten evenly spaced camera positions and the three transition cameras 32 m back. These are thirteen discrete views, not a timed sample window. The first-commit README records the unchanged measured zone lengths.

The first commit also applies olive boosters, four smaller fins, exhaust-hole soot, muted canopy paint and deterministic placement jitter. The six existing solid-surface atlases, accepted road, kerbs, source trench module, sky and branch-aware labels remain. Focal captures are in `focal/`.

The event implementation uses `src/game/ascension-event-pose.js` and `src/game/ascension-effects.ts`: the approved crawler path represented as a spline, circulating tread links, a rotating beacon, gravel decals, deluge sheets, flooding, retracting swing arms, mapped engine emission and plume, ascent, growing persistent smoke, and apron steam. Entry rails lower only to refuse new entry; an occupied trench keeps its exit and rail clearance. Reduced motion freezes nonessential card/beacon motion and disables lamp flicker while leaving launch and steam visible. All effect materials use Lambert lighting, scene fog and tone mapping.

`events.mjs` captures frozen event poses from the generated schedule. Its pad-target inspection camera remains at chase height but aims upward during ascent; it is explicitly not the forward driving camera. The Causeway sightline gap is recorded in `OPEN-GAPS.md`.

`race.mjs --phase-b --phase-c` ran both forks and the reduced-motion trench race at the review seed. The final three runs share identical recorded source/asset hashes. `instrument.mjs` counts main and shadow passes, including instances. `executed-results.json` gives every lap result, draw/triangle peak, p95, calibration, active window and tail-window reconciliation. The all-recorded window includes startup intervals with no continuous rendering; applying the pre-start calibration rate to that entire window produces large deficits, which are retained explicitly. The p95 uses the separate trailing 720-render interval window, not startup time. The accepted B comparison comes from `phase-b-revision/fix-5/after/metrics.json`. Trial directories are explicitly superseded measurements, not final acceptance evidence.

`validate-ascension-events.mjs` sweeps both crossings at 120 Hz, including endpoints: 2 × (6 s × 120 Hz + 1) = 1,442 samples. The ascent window comes from the generated launch/gone ticks, with one inclusive endpoint. Its exported geometry bounds include a conservative global allowance for banked road edges. Flame/glow clearance and the vertical-invariant arm bound are separate. The belt is checked over one complete revolution as spatial phase samples, not a timed render window. `validate-ascension-painted-corridor.mjs` checks 15,179 spatial probes with bank applied to main-road lateral positions. These checks concern solids; transparent fog/water is assessed by rendered visibility.

`steam-probe.mjs` records production driving, camera and HUD with the real schedule deliberately advanced to its generated launch tick at the first fixture step. Road markings, kerbs, turn cue and speed display remain visible through steam in `steam-speed/apron-live.png` and `.webm`. This is a controlled visual test, not a normal race benchmark. `reconcile-steam-video.py` records decoded frames against both recorder wall time and video-container duration, at the requested capture rate; its deficits are retained rather than described as a fixed-rate recording.

`record-road-base.py` records all 32 sector/phase patches using `frame-metrics.py` before `pin-road-floor.py` pins the new set. They are discrete image samples. Both previous B sets and the blockout set are retained. The requested scorched floor changes the trench base; the report does not silently apply the old B floor to different paint.

The schedule remains the output of `build-ascension-route.mjs`, calibrated from the Phase A Works measurement. No absolute event time was typed into the effect code. `measure-ascension-driving.mjs` separately measures isolated fork savings, with its 120 Hz window reconciliation; those savings are not conflated with whole-lap differences.

The full code/build test suite passed. The accepted Greenwater archive checks explicitly skipped missing archives. Event, runtime, painted-asset, branch-label and corridor validation evidence is retained in this directory.

A dedicated transparent steam sprite was generated with built-in GPT Image 2. The exact prompt is `art/references/ascension/steam-vfx.prompt.txt`; the actual artifact ID and null service job ID are recorded in `art/references/ascension/generation.json`. The consumed asset is `public/assets/ascension/textures/steam.png`. No Higgsfield connection was used.

## Interpretation and outstanding acceptance

Author inspection supports the revised dry/wet distinction and steam road readability. It is not the requested source-blind classification or independent whole-level acceptance. `OPEN-GAPS.md` lists every carried gap, including the Causeway sightline, road-view crawler legibility, remaining reference/device/power work, ambience/audio, outstanding E evidence and missing archives. This is a Phase C implementation checkpoint, not a claim that the level is finished.
