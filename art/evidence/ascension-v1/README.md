# Ascension Pad — Phase A

This is the route, schedule and flat material-ID blockout gate. It is not whole-level acceptance. The supplied art kit at `2da828c` is retained; no service connection or new image generation was used for Phase A.

## Executed and observed

- `scripts/build-ascension-route.mjs` builds the 2,600 m main route, eight ordered gates and the trench fork. `scripts/validate-ascension.mjs` checks station continuity, projection and fork endpoints; the branch bypasses no gate.
- `scripts/visual/ascension/race.mjs --trench --calibrate` captured three complete Works laps before schedule activation. The retained input is `phase-a/calibration/works-trench.json`. The build script defines **L = 28.0705 s**, the mean of flying laps two and three. Every event tick comes from this input; `phase-a/report.json` publishes each tick, seconds and measured-L ratio.
- `scripts/visual/ascension/matrix.mjs` executed nine private headless-Chrome races: three tiers at each of seeds 3868938316, 714 and 20260905. `scripts/validate-ascension-matrix.mjs` checks three laps, no missed gates/recoveries/browser errors, and Rookie/Works/Feral positions 1/2/4 for each seed. These captures precede the material-ID colour correction and replacement of literal 120 with the existing ability tick-rate constant. The authoritative seed is `ascension.seed`; the shared legacy `diagnostics.current.raceSeed` field still reports 714 and is not used by the matrix validator. Their input hashes remain in each capture; final reduced-motion and Deluge runs follow those changes.
- `scripts/measure-ascension-driving.mjs` exercises production handling and the demo controller without nitro, traffic or powers: mean whole-lap saving **3.441667 s/lap**. Between the fork boundaries, each of the three passes saves **3.525 s** (Deluge 14.308333 s, trench 10.783333 s). There is one isolated edge-clamp tick on the trench run; this is not a zero-contact claim. The full-browser fork comparison, which includes traffic and nitro, is in `phase-a/acceptance.json` and is asserted separately by `scripts/validate-ascension-evidence.mjs`.
- `scripts/validate-ascension-runtime.mjs` checks entry refusal, continued egress for an occupied trench, reopening, grip, snapshot/restore and identical schedule state at simulated render rates 60/120/240 Hz. The game uses the same fixed update and `ABILITY_TICK_RATE` as Tideline. Tideline's tide module itself has no reusable integer scheduler; Ascension owns its event state machine.
- `scripts/validate-ascension.mjs` measures **13 m** minimum clearance from the exported crawler hierarchy through two translated crossings. `scripts/validate-ascension-corridor.mjs` casts **15,179** upward road rays with zero hits below 9 m. This is a static spatial scan plus a translated crawler envelope, not the final spline/launch sweep.
- `scripts/visual/ascension/stations.mjs` captures eight stations in four schedule states and both countdown boards. `phase-a/stations/capture.json` gives actual camera positions, board distances and scope. Both board approach frames were inspected for legibility. These are static production-geometry views with shared tone mapping and course lighting/fog, not running launch screenshots.
- `scripts/visual/frame-metrics.py` records road-patch luma first in `phase-a/road-luma-base.json`; `scripts/visual/ascension/pin-road-floor.py` then pins each sector's floor to the greater of 85% of its base or the darkest measured accepted Tideline tunnel patch. The reference patches and hashes are recorded. These are future painted-art acceptance guards, not finished-art approval.
- `npm test` exits successfully. Its missing Greenwater archive checks say **ARCHIVES SKIPPED**, rather than failing or proving those absent archives valid. The exact output is in `phase-a/npm-test.txt`. All Ascension validators are run separately and their outputs are retained.

## Sampling and performance

`phase-a/acceptance.json` contains the same-geometry environment batching comparison, including shadow draws, triangles, resolution, frame-time p95 and all render-window arithmetic. The final blockout stays under half of the amended shadow-enabled 145-call ceiling and half of 220,000 triangles, even when main and shadow triangles are added. This leaves the required Phase A headroom; it is not a prediction of finished-art cost.

- Physics: the observed integer step count is compared with the sum of three rounded lap durations × 120 Hz. Three milliseconds rounded independently allow at most 0.18 tick residual. Every matrix row records the residual.
- Schedule determinism: 120 s × 120 Hz = 14,400 ticks for each simulated render cadence. There are 7,200/14,400/28,800 render-driving iterations respectively; render cadence does not change the event state.
- Crawler sweep: two directions × (6 s × 120 Hz + one inclusive endpoint) = 1,442 samples.
- Renderer: each retained interval covers one completed render. The last 720 intervals define the measured window; expected count is window seconds × an independent pre-start 120-interval RAF calibration. Actual and expected counts, their residual and actual Hz are reported. RAF calibration is not the 120 Hz physics rate. These are sequential runs on the local machine, not isolated laboratory frame-time measurements.
- Isolated fork timing: 42.925 s × 120 Hz = 5,151 eligible main-road ticks; 32.35 s × 120 Hz = 3,882 eligible trench ticks. These are simulation-time windows, not wall-clock samples.
- Corridor, board and road-luma probes are spatial samples, not periodic clocks. Road patches are 24 × 24 pixels; the luma script averages all 576 pixels. The four phases × eight stations yield 32 station images, plus two board frames.
- Raw legacy diagnostics also contain conditional free-deck probes and audio counters. They have different eligibility/audio-context windows; Phase A does not claim a whole-race rate for them. Exact audio-window reconciliation remains a Phase D gap. Event counts and impacts are event counters, not periodic samples.

`phase-a/*-before-batching` and the previous calibration are historical development captures with older geometry. They are retained as provenance and **must not** be used as controlled performance comparisons. `phase-a/trench-reduced-unbatched` versus `phase-a/trench-reduced` is the controlled geometry comparison. Raw captures record source and asset hashes; `index.json` hashes evidence and the current implementation.

## Inferred, not observed

The measured blockout clearance and entry latch support the feasibility of a non-obstructing final launch complex. They do not certify the future crawler spline, authored rocket ascent, particles, collision envelopes or steam readability at speed. The schedule's launch, deluge and rocket-gone flags are implemented; their finished audiovisual effects are not.

## Open gaps before whole-level acceptance

- Phase B: remaining GPT Image 2 sheets, material-ID passes and secondary heroes; prompts/job IDs; silhouette-only use and removal of both maquettes; eleven focal-asset five-detail comparisons; painted six-atlas art, signage manifest and original-rocket review. Current shapes are deliberately flat blockout geometry.
- Dedicated 4096×1024 one-state sky, luma-range profile, horizon haze blend and 24-frame turntable. The blockout currently borrows the existing Greenwater sky profile.
- Phase C: real crawler spline and tread rotation, beacons, gravel decals, water sheets/flooding, engine glow, flame and steam cards, ascent and persistent smoke, lamp flicker and birds. Repeat moving corridor sweeps and assess speed readability on the apron before accepting any of these.
- Player Surge/Phase Shield, two launch strips, two bulkheads, gravel/Mangrove drift charge and forced live CHAIN capture. Space/Shift nitro and shared rival power visuals are available, but the Phase A player device action is a placeholder.
- Device glass/rivet-scale bolts/metal bases and recessed launch-strip lamp housings; finished-phase road-luma checks against the pinned floors.
- Phase D audio: radio, klaxon, deluge, distance/343 delayed launch, four-second music duck, trench/egret ambience, audio-window accounting and the requested recordings.
- Phase E full launch phase pairs, pasted-on tests at three fog distances, finished material walk, reduced-motion steam/launch visibility and video evidence, stranger ten-frame phase classification and final performance acceptance.

No stranger review, hero acceptance, finished steam readability or whole-level approval is claimed here.
