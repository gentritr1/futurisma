# Phase E — review packs and final measurements

The audio instrument is committed separately as `8ad5931`. Its PCM waveform gates pass; see [the instrument report](../audio-instrument/README.md). C3 measured plume coverage and C4/C5 retain the user's acceptance. This phase supplies evidence and capture tooling; gameplay, route, accepted art and schedule are unchanged.

## Review packs — keys withheld

- [Ten-frame pre/post-launch blind pack](phase-blind/index.html): five frames per state, shuffled without source labels. Classify before viewing the key.
- [Three-distance fog comparisons](pasted-on/index.html): 36 object families × three distances = 108 frames, including devices, four cradles, both strips, both bulkheads, markers, event effects, craft states and rival power fields.
- [Hero/model comparisons](focal/index.html): 13 pairs. Authored five-detail checklists are withheld. Previously accepted assets are included for context. The two device references are the inherited approved Tideline kit hero, identified in the gallery.
- [Fixed 300 km/h recognition bursts](feature-bursts/index.html): eight camera traverses of the production route, with an approach frame at least 120 m from each object. These isolate visual recognition rather than controller behavior.
- [Live driving bursts](live-feature-bursts/index.html): the same eight feature approaches in unmodified Works demos. Actual speeds are recorded; they are not forced to 300 km/h.
- [Live rival power inspection](rival-powers/index.html): auxiliary chase-height views of the actual seeded events. Simultaneous grid-start activations produce combined states, not separate visible actions.
- [Phase pairs at three stations](phase-pairs/index.html): six additional frames, with state labels withheld.

Keys are outside the checkout and are not included in the commit or gallery. Each pack publishes a SHA-256 commitment to its key. `check-e-packs.py --check-private` verifies those commitments without printing answers. No visual verdict or five-detail pass is inferred from the artifact checks.

## Executed and observed

`race.mjs` and `instrument.mjs`, reconciled by `report-phase-e.py`, reproduce the accepted carry-over lap times. Trench: 29,975 / 28,100 / 27,983 ms. Deluge Road: 33,408 / 29,992 / 29,867 ms. Reduced motion exactly matches the trench run. All three runs have zero missed gates, recoveries and browser errors.

Peak total draws remain 127, including shadows, against the 145 ceiling. Main-pass triangles peak at 213,808; shadow triangles are reported separately. Frame p95 is 8.6 ms at 1280×720. [BUDGET.md](BUDGET.md) contains the before/after table. [final-measurements.json](final-measurements.json) reconciles calibration, all recorded intervals, active intervals and the tail window against each run's measured calibration rate. These benchmark runs were isolated from other captures and build work.

`stations.mjs` captures eight sectors in four states plus both boards in all four states: 32 road frames and eight board frames. `record-road-base.py` uses `frame-metrics.py` for current road samples; `check-road-floor.py` compares them against the unchanged accepted carry-over floors. All 32 pass. The earlier blockout, painted and carry-over bases and floors remain intact. All eight board digit-luma assertions pass at the 150 m fixture distance.

`sky-profile.py` passes the unchanged panorama. `sky-turntable.mjs` records 24 post-launch azimuths, 15 degrees apart; `check-sky-frames.py` passes all 24. The initial solid-card visibility masks incorrectly hid sky behind transparent smoke. That failed trial is preserved in `sky-turntable-solid-mask-trial/`; the accepted mask preserves the real material alpha and discard behavior. The correction changes only the evidence mask, not the sky or game rendering.

The final route, runtime, painted-asset, painted-corridor, event-clearance and power-kit validations pass. The code suite passes. The separate archive test entry point retains its pre-existing missing-archive skips; those archives are not represented as validated.

## Counts and timing scope

`check-e-packs.py` writes [pack-check.json](pack-check.json). Static packs use Cartesian or angular sample counts, not frame rates. Each fixed-camera burst has 2 s × 10 Hz + one endpoint = 21 stills; its video uses the first 20 frames for exactly two seconds. Each live burst uses the half-open interval [0,2): 2 s × 10 Hz = 20 captures. Actual simulation and wall spans, including capture overhead, are reconciled separately. `finish-e-bursts.py` checks the two-second videos with the artifact checker; no video is a performance benchmark.

The rival pack has 3 rivals × 2 power types × 3 laps = 18 event records. It has 15 unique image hashes because the grid-start power pairs coincide. This is disclosed in its manifest. Recognition of the rendered effects remains a human review gate.

`measure-ascension-driving.mjs` rechecks isolated matched-input fork savings; this is distinct from full lap differences with powers and traffic. `validate-ascension-events.mjs` reports corridor-clearance samples and their expected counts. The schedule still comes from `build-ascension-route.mjs` and the accepted Phase A Works calibration; it was not recalibrated from the powered laps.

## Acceptance status

Numerical and artifact checks pass. Human classification, remaining focal fidelity and the recorded carry-over limitations remain open in [OPEN-GAPS.md](OPEN-GAPS.md). The final source and artifact hashes are in [file-manifest.json](file-manifest.json). Whole-level acceptance is not claimed before the user's review.
