# Ascension Pad — Phase B repair submission

**Phase C has not started. Independent visual acceptance remains pending.** The five repair implementations are submitted for review; this document does not declare Phase B accepted.

## Executed and observed

- Replaced canopy slabs with Greenwater alpha canopy cards, thin trunks and root fans. The exact source texture and extraction are recorded in `fix-1/provenance.json`. Final station and board captures are in `stations/`. Canopy top is authored at 8.9 m, trunk diameter 0.4 m (`src/game/ascension-mangroves.ts`); this is geometry specification, not a timed measurement. Both final board camera distances are recorded by `scripts/visual/ascension/review.ts`, at 150 m. The older repair-one captures used a longer approach; those files are retained and superseded for the exact-distance check.
- Rebuilt the platform and crawler. `fix-2/geometry.json`, produced by `scripts/validate-ascension-heroes.mjs`, measures four exported tread units at 12 m long and 4 m tall, and records three swing-arm roots. `fix-2/comparison.html` and `fix-2/review.json` give reference comparisons and five proposed shared details per asset. Maquettes were removed before export; structural validation does not establish visual fidelity.
- Authored four contiguous trench zones. The route is unchanged. The ten evenly spaced tour anchors are retained, plus three boundary anchors; transition cameras sit 32 m before the boundary so both sides appear in one frame. `trench-tour/` holds the thirteen final no-HUD captures (`scripts/visual/ascension/stations.mjs`).

| Zone | Measured length, m |
|---|---:|
| ENTRY RAMP | 180.000 |
| PAD UNDERSIDE | 260.000 |
| SCORCHED ZONE | 260.000 |
| DELUGE EXIT | 206.336 |

Zone lengths above come from `art/blender/ascension_trench.py`, summing the accepted shortcut centreline. They are spatial measurements, not timed samples.

- Added painted mud, grass and gravel within the existing water-role atlas, with shaped land and continuous road shoulders. The built-in image generator produced `ground-water-atlas-v2.png`; exact prompt and artifact ID are in `art/references/ascension/generation.json`. It did not expose a service job ID. `src/game/ascension-terrain.ts` retains Tideline wave/flow equations under shared Lambert lighting, fog and tone mapping, with a subdued ripple highlight and a mask excluding baseline water from the excavated trench.
- Instanced mangroves, kerbs, recessed deck lamps, street lamps and repeated trench walls; frustum selection occurs before filling visible instance batches. Distant wall LODs begin beyond 160 m; the close modules remain unchanged. Static world props and board housings share a paint shader that retains their individual atlases (`ascension-instance-lamps.ts`, `ascension-static-paint.ts`, Blender build script). Rejected experiments remain in `fix-5/` and `experiment-ledger.json`.
- Road-luma base was recorded first with `record-road-base.py`, then floors pinned with the unchanged formula in `pin-road-floor.py`. Original blockout and previous painted base/floor pairs remain in `phase-a/` and `phase-b/`; the new pair is here. These floors do not certify future steam or launch lighting.

## Completed race measurements

All race figures below use `scripts/visual/ascension/race.mjs` and `instrument.mjs`, on the protocol in `fix-5/protocol.json`. No imported runtime or art was changed during a measured race. Main/shadow peaks are independent; total peak is measured per frame.

| Run | Lap times, ms | Peak main / shadow / total draws | Peak main triangles | Tail p95, ms |
|---|---|---:|---:|---:|
| fix-5/before | 30108, 28508, 28383 | 127 / 17 / 144 | 399,870 | 8.70 |
| fix-5/after | 30108, 28508, 28383 | 93 / 17 / 110 | 208,592 | 8.40 |
| deluge | 33958, 31300, 31308 | 84 / 17 / 101 | 198,786 | 8.40 |
| trench-reduced | 30108, 28508, 28383 | 93 / 17 / 110 | 208,592 | 8.40 |

Final budget gate passed: **True**. The requested reserve is measured against the inherited 145-draw total ceiling. No claim of future Phase C performance is inferred from that reserve.

Every completed race recorded the following fault counts (events, not Hz samples):

| Run | Impacts | Missed gates | Recoveries | Console errors |
|---|---:|---:|---:|---:|
| fix-5/before | 4 | 0 | 0 | 0 |
| fix-5/after | 4 | 0 | 0 | 0 |
| deluge | 1 | 0 | 0 | 0 |
| trench-reduced | 4 | 0 | 0 | 0 |

Whole-lap Deluge-minus-trench differences: 3.850 s, 2.792 s, 2.925 s (`reconcile-revision.mjs`). These include traffic and boost. The separately rerun isolated fork timings are in `driving.json`, from `scripts/measure-ascension-driving.mjs`; neither measure is substituted for the other.

## Sample reconciliation

`reconcile-revision.mjs` computes expected samples as window seconds × calibrated rate. The residual is observed minus expected; render residuals are not missing physics steps. Every retained attempt is included in `reconciliation.json`. Audio and atmosphere lack exported first/last control timestamps, so their residuals against the race window are disclosed rather than claimed to prove exact cadence. Conditional event counters have no fixed expected Hz.

| Run / window | Seconds × Hz | Expected | Observed | Residual |
|---|---:|---:|---:|---:|
| fix-5/before / activeRender | 86.404600 × 123.711340 | 10689.229 | 10664 | -25.229 |
| fix-5/before / tailRender | 5.835200 × 123.711340 | 721.880 | 720 | -1.880 |
| fix-5/before / physics | 87.000000 × 120.000000 | 10440.000 | 10440 | +0.000 |
| fix-5/before / rivalUpdates | 87.000000 × 120.000000 | 10440.000 | 10440 | +0.000 |
| fix-5/before / audioControlsAgainstRaceWindow | 87.000000 × 30.000000 | 2610.000 | 2609 | -1.000 |
| fix-5/before / atmosphereAgainstRaceWindow | 87.000000 × 30.000000 | 2610.000 | 2608 | -2.000 |
| fix-5/after / activeRender | 86.229100 × 124.249327 | 10713.908 | 10682 | -31.908 |
| fix-5/after / tailRender | 5.809300 × 124.249327 | 721.802 | 720 | -1.802 |
| fix-5/after / physics | 87.000000 × 120.000000 | 10440.000 | 10440 | +0.000 |
| fix-5/after / rivalUpdates | 87.000000 × 120.000000 | 10440.000 | 10440 | +0.000 |
| fix-5/after / audioControlsAgainstRaceWindow | 87.000000 × 30.000000 | 2610.000 | 2611 | +1.000 |
| fix-5/after / atmosphereAgainstRaceWindow | 87.000000 × 30.000000 | 2610.000 | 2609 | -1.000 |
| deluge / activeRender | 95.782100 × 124.545926 | 11929.270 | 11870 | -59.270 |
| deluge / tailRender | 5.787700 × 124.545926 | 720.834 | 720 | -0.834 |
| deluge / physics | 96.567000 × 120.000000 | 11588.040 | 11588 | -0.040 |
| deluge / rivalUpdates | 96.567000 × 120.000000 | 11588.040 | 11588 | -0.040 |
| deluge / audioControlsAgainstRaceWindow | 96.567000 × 30.000000 | 2897.010 | 2897 | -0.010 |
| deluge / atmosphereAgainstRaceWindow | 96.567000 × 30.000000 | 2897.010 | 2896 | -1.010 |
| trench-reduced / activeRender | 86.199300 × 124.197889 | 10705.771 | 10685 | -20.771 |
| trench-reduced / tailRender | 5.794800 × 124.197889 | 719.702 | 720 | +0.298 |
| trench-reduced / physics | 87.000000 × 120.000000 | 10440.000 | 10440 | +0.000 |
| trench-reduced / rivalUpdates | 87.000000 × 120.000000 | 10440.000 | 10440 | +0.000 |
| trench-reduced / audioControlsAgainstRaceWindow | 87.000000 × 30.000000 | 2610.000 | 2611 | +1.000 |
| trench-reduced / atmosphereAgainstRaceWindow | 87.000000 × 30.000000 | 2610.000 | 0 | -2610.000 |
| fix-5/attempt-sector-batch / activeRender | 86.193900 × 123.533045 | 10647.795 | 10692 | +44.205 |
| fix-5/attempt-sector-batch / tailRender | 5.799300 × 123.533045 | 716.405 | 720 | +3.595 |
| fix-5/attempt-sector-batch / physics | 87.000000 × 120.000000 | 10440.000 | 10440 | +0.000 |
| fix-5/attempt-sector-batch / rivalUpdates | 87.000000 × 120.000000 | 10440.000 | 10440 | +0.000 |
| fix-5/attempt-sector-batch / audioControlsAgainstRaceWindow | 87.000000 × 30.000000 | 2610.000 | 2610 | +0.000 |
| fix-5/attempt-sector-batch / atmosphereAgainstRaceWindow | 87.000000 × 30.000000 | 2610.000 | 2609 | -1.000 |
| fix-5/attempt-trench-cells / activeRender | 86.210100 × 124.365219 | 10721.538 | 10681 | -40.538 |
| fix-5/attempt-trench-cells / tailRender | 5.806000 × 124.365219 | 722.064 | 720 | -2.064 |
| fix-5/attempt-trench-cells / physics | 87.000000 × 120.000000 | 10440.000 | 10440 | +0.000 |
| fix-5/attempt-trench-cells / rivalUpdates | 87.000000 × 120.000000 | 10440.000 | 10440 | +0.000 |
| fix-5/attempt-trench-cells / audioControlsAgainstRaceWindow | 87.000000 × 30.000000 | 2610.000 | 2610 | +0.000 |
| fix-5/attempt-trench-cells / atmosphereAgainstRaceWindow | 87.000000 × 30.000000 | 2610.000 | 2609 | -1.000 |
| fix-5/attempt-wall-instances / activeRender | 86.189800 × 124.649424 | 10743.509 | 10686 | -57.509 |
| fix-5/attempt-wall-instances / tailRender | 5.808100 × 124.649424 | 723.976 | 720 | -3.976 |
| fix-5/attempt-wall-instances / physics | 87.000000 × 120.000000 | 10440.000 | 10440 | +0.000 |
| fix-5/attempt-wall-instances / rivalUpdates | 87.000000 × 120.000000 | 10440.000 | 10440 | +0.000 |
| fix-5/attempt-wall-instances / audioControlsAgainstRaceWindow | 87.000000 × 30.000000 | 2610.000 | 2610 | +0.000 |
| fix-5/attempt-wall-instances / atmosphereAgainstRaceWindow | 87.000000 × 30.000000 | 2610.000 | 2609 | -1.000 |
| fix-5/attempt-distant-wall-lod / activeRender | 86.191500 × 123.954137 | 10683.793 | 10675 | -8.793 |
| fix-5/attempt-distant-wall-lod / tailRender | 5.815800 × 123.954137 | 720.892 | 720 | -0.892 |
| fix-5/attempt-distant-wall-lod / physics | 87.000000 × 120.000000 | 10440.000 | 10440 | +0.000 |
| fix-5/attempt-distant-wall-lod / rivalUpdates | 87.000000 × 120.000000 | 10440.000 | 10440 | +0.000 |
| fix-5/attempt-distant-wall-lod / audioControlsAgainstRaceWindow | 87.000000 × 30.000000 | 2610.000 | 2610 | +0.000 |
| fix-5/attempt-distant-wall-lod / atmosphereAgainstRaceWindow | 87.000000 × 30.000000 | 2610.000 | 2609 | -1.000 |
| fix-5/attempt-before-hidden-caps / activeRender | 86.188900 × 124.856935 | 10761.282 | 10664 | -97.282 |
| fix-5/attempt-before-hidden-caps / tailRender | 5.818100 × 124.856935 | 726.430 | 720 | -6.430 |
| fix-5/attempt-before-hidden-caps / physics | 87.000000 × 120.000000 | 10440.000 | 10440 | +0.000 |
| fix-5/attempt-before-hidden-caps / rivalUpdates | 87.000000 × 120.000000 | 10440.000 | 10440 | +0.000 |
| fix-5/attempt-before-hidden-caps / audioControlsAgainstRaceWindow | 87.000000 × 30.000000 | 2610.000 | 2610 | +0.000 |
| fix-5/attempt-before-hidden-caps / atmosphereAgainstRaceWindow | 87.000000 × 30.000000 | 2610.000 | 2609 | -1.000 |
| fix-5/attempt-deluge-before-hidden-caps / activeRender | 95.782800 × 123.826231 | 11860.423 | 11871 | +10.577 |
| fix-5/attempt-deluge-before-hidden-caps / tailRender | 5.805400 × 123.826231 | 718.861 | 720 | +1.139 |
| fix-5/attempt-deluge-before-hidden-caps / physics | 96.567000 × 120.000000 | 11588.040 | 11588 | -0.040 |
| fix-5/attempt-deluge-before-hidden-caps / rivalUpdates | 96.567000 × 120.000000 | 11588.040 | 11588 | -0.040 |
| fix-5/attempt-deluge-before-hidden-caps / audioControlsAgainstRaceWindow | 96.567000 × 30.000000 | 2897.010 | 2897 | -0.010 |
| fix-5/attempt-deluge-before-hidden-caps / atmosphereAgainstRaceWindow | 96.567000 × 30.000000 | 2897.010 | 2896 | -1.010 |
| fix-5/attempt-before-key-fringe / activeRender | 86.196200 × 124.082308 | 10695.423 | 10677 | -18.423 |
| fix-5/attempt-before-key-fringe / tailRender | 5.800700 × 124.082308 | 719.764 | 720 | +0.236 |
| fix-5/attempt-before-key-fringe / physics | 87.000000 × 120.000000 | 10440.000 | 10440 | +0.000 |
| fix-5/attempt-before-key-fringe / rivalUpdates | 87.000000 × 120.000000 | 10440.000 | 10440 | +0.000 |
| fix-5/attempt-before-key-fringe / audioControlsAgainstRaceWindow | 87.000000 × 30.000000 | 2610.000 | 2610 | +0.000 |
| fix-5/attempt-before-key-fringe / atmosphereAgainstRaceWindow | 87.000000 × 30.000000 | 2610.000 | 2609 | -1.000 |
| fix-5/attempt-deluge-before-key-fringe / activeRender | 95.816900 × 124.804992 | 11958.427 | 11868 | -90.427 |
| fix-5/attempt-deluge-before-key-fringe / tailRender | 5.808900 × 124.804992 | 724.980 | 720 | -4.980 |
| fix-5/attempt-deluge-before-key-fringe / physics | 96.567000 × 120.000000 | 11588.040 | 11588 | -0.040 |
| fix-5/attempt-deluge-before-key-fringe / rivalUpdates | 96.567000 × 120.000000 | 11588.040 | 11588 | -0.040 |
| fix-5/attempt-deluge-before-key-fringe / audioControlsAgainstRaceWindow | 96.567000 × 30.000000 | 2897.010 | 2897 | -0.010 |
| fix-5/attempt-deluge-before-key-fringe / atmosphereAgainstRaceWindow | 96.567000 × 30.000000 | 2897.010 | 2896 | -1.010 |
| fix-5/attempt-reduced-before-key-fringe / activeRender | 86.208500 × 123.839009 | 10675.975 | 10675 | -0.975 |
| fix-5/attempt-reduced-before-key-fringe / tailRender | 5.820000 × 123.839009 | 720.743 | 720 | -0.743 |
| fix-5/attempt-reduced-before-key-fringe / physics | 87.000000 × 120.000000 | 10440.000 | 10440 | +0.000 |
| fix-5/attempt-reduced-before-key-fringe / rivalUpdates | 87.000000 × 120.000000 | 10440.000 | 10440 | +0.000 |
| fix-5/attempt-reduced-before-key-fringe / audioControlsAgainstRaceWindow | 87.000000 × 30.000000 | 2610.000 | 2611 | +1.000 |
| fix-5/attempt-reduced-before-key-fringe / atmosphereAgainstRaceWindow | 87.000000 × 30.000000 | 2610.000 | 0 | -2610.000 |

Isolated fork savings (`scripts/measure-ascension-driving.mjs`): 3.525 s, 3.525 s, 3.525 s. Its 120 Hz simulation sample windows reconcile as follows:
- Branch False: 42.925 s × 120 Hz = 5151 expected, 5151 observed, residual +0.000.
- Branch True: 32.350 s × 120 Hz = 3882 expected, 3882 observed, residual +0.000.

## Painted road-luma base and pins

Recorded by `record-road-base.py` before `pin-road-floor.py`, both using `frame-metrics.py`. Discrete sector patches, not a temporal sampling window.

| Sector | Base luma | Pinned floor |
|---|---:|---:|
| PAD_ROAD | 121.869177 | 103.588801 |
| APRON_SWEEP | 127.650500 | 108.502925 |
| DELUGE_ROAD | 125.177851 | 106.401174 |
| CRAWLERWAY | 121.927882 | 103.638700 |
| MANGROVE_CUT | 124.503832 | 105.828257 |
| CAUSEWAY | 126.825049 | 107.801292 |
| TANK_FARM | 97.977856 | 83.281177 |
| TRENCH | 123.822174 | 105.248848 |

The scene schedule continues during the short post-finish coast. `reconciliation.json` separates the captured schedule tick from completed race physics steps. Station images and clearance rays are spatial/discrete samples, not frame-rate windows.

## Inferences and open acceptance

- The new forms and zone transitions appear more distinct in author inspection. This is not the required source-blind classification. The image-only pack is `blind-review/index.html`; the answer key is stored separately. Mangrove identification, hero-quality wording and all thirteen trench classifications remain pending.
- A no-obstruction static ray result does not certify the moving painted crawler or launch sequence. Full spline/ascent clearance and steam speed readability remain Phase C requirements. No inability to meet them was observed in this static repair, and no success in motion is claimed.
- The four Tideline residuals retain their existing scope: new luma pairs are pinned; device glass/bolts/bases and recessed housings retain prior physical evidence; live CHAIN and unfinished power behavior stay open for the later phases specified in `OPEN-GAPS.md`.
- All unrelated prior gaps remain open, including reference/material-ID compliance, missing service job IDs, native sky resolution, other focal assets, device cradles, activation/pasted-on/at-speed evidence, effects/audio, and missing archive validation. See `OPEN-GAPS.md`.

Route/schedule equality against approved `2ebd9d5`: {"src/game/data/ascension/route.json": true, "src/game/data/ascension/schedule.json": true}.
