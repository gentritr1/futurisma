# Dream Island Phase G handoff — main at b59a635; no commits

**VERIFIED:** G1's night range, road and water gates pass; G2's COURT day gates pass. **G3's atlas fault is corrected, but its two numerical targets are NOT MET.** The neutral-atlas limit and on-screen palette below explain the remaining gap. Scope is G1–G3 only.

## Files added / changed

- `src/game/dreamisland-props.ts`: night core emission 1.6 → 16.
- `src/game/dreamisland-capsules.ts`: night tint ×3, opacity `mean * nightBlend`, matching §1 instead of the old ×0.7. The day normal-blend material and shared squared vertex fade stay unchanged.
- `src/game/dreamisland-reflections.ts`: bollard halo size 1.8 → 3.4 m; glow opacity 0.65 → 0.30; pavement-only night response ×0.74 before the existing reflection. The kerb UV cell is excluded. Island material binding installs the day-light response.
- `src/game/dreamisland-materials.ts`: island-only ambient ×0.22 / direct ×1.2 by day, both ×1 at night. No global light or grade changes.
- `art/blender/build_dreamisland_painted.py` and `public/assets/dreamisland/painted.glb`: 24-ray, 14 m AO at strength 0.88, then the requested sand tint under palm canopies (3.5 m × palm scale, maximum 28%, 496 affected vertices). Default AO source is the committed pre-AO fixture, so repeated bakes do not compound.
- `art/blender/build_dreamisland_props.py` and `public/assets/dreamisland/props.glb`: ball/ring consume a neutral white patch in `emissive/clock-face`, with effective emission zero.
- Evidence, capture tools and this report live under `art/evidence/dreamisland-v1/vs-design/`.

The water shader file, reflections on the sea, shallows/foam emission, capsule GLB, route, schedule, powers, pace, autopilot and `game.ts` on disk were not edited. Unrelated pre-existing edits remain in place.

## Numbers measured with §1, including the “yours” rows

**VERIFIED:** 1280×720, the exact demo query in §1, COURT progress 0.56014 and REEF 0.73515, chase camera supplied by the running autopilot, all `#app` children except `#game-canvas` hidden. Every world/painting row below comes from `scripts/visual/grade/measure-frames.py --full`; no HUD crop. Paintings are measured at their supplied 1344×752 resolution, reproducing the brief's rows. No REEF painting exists: the repeated painting rows below are explicitly the COURT benchmark, not a fabricated pose match.

The evidence harness extends the named `nohud-capture.mjs` capture with a post-render hold, injected into the served module in memory only. It asserts that camera and progress do not change during the screenshot/isolation sequence. `final/captures.json` records both camera transforms and queries. Early unfrozen/reloaded and ineffective sizing trials were discarded; they are not acceptance evidence.

| Pose / source | Mean | Std | Chroma | p01 | p50 | p99 | Range | Black % | White % |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| COURT day — painting | 117.19 | 47.34 | 22.12 | 27.20 | 110.40 | 219.20 | 192.00 | 0.41 | 0.35 |
| **yours** | 130.90 | 46.55 | 20.46 | 29.40 | 117.80 | 208.50 | 179.10 | 0.28 | 0.09 |
| COURT night — painting | 31.03 | 34.87 | 8.85 | 2.10 | 19.90 | 193.50 | 191.50 | 38.92 | 0.06 |
| **yours** | 37.32 | 32.96 | 9.49 | 0.00 | 35.50 | 161.40 | 161.40 | 29.79 | 0.08 |
| REEF day — painting (COURT reference only) | 117.19 | 47.34 | 22.12 | 27.20 | 110.40 | 219.20 | 192.00 | 0.41 | 0.35 |
| **yours** | 134.13 | 42.92 | 17.50 | 42.50 | 132.40 | 208.50 | 166.00 | 0.30 | 0.12 |
| REEF night — painting (COURT reference only) | 31.03 | 34.87 | 8.85 | 2.10 | 19.90 | 193.50 | 191.50 | 38.92 | 0.06 |
| **yours** | 37.46 | 37.73 | 7.88 | 0.00 | 31.70 | 174.20 | 174.20 | 30.98 | 0.05 |

## G1 — source contributions and water gates

**VERIFIED:** Each source is removed from the same held frame; its own halo disappears with it. Deltas are quantile changes and are not additive. The control redraw measures repeat-render noise. The capsule and fish do not measurably move p99 at these poses; no emissive claim is inferred from their draw counts. Source frames are `final/*-without-*.png`.

| Pose | Source removed, including its halo | With p99 | Without p99 | Delta |
|---|---|---:|---:|---:|
| COURT | bollard | 161.4 | 157.0 | 4.4 |
| COURT | column | 161.4 | 123.5 | 37.9 |
| COURT | capsule | 161.4 | 161.4 | 0.0 |
| COURT | fish | 161.4 | 161.4 | 0.0 |
| COURT | glow | 161.4 | 157.0 | 4.4 |
| REEF | bollard | 174.2 | 173.4 | 0.8 |
| REEF | column | 174.2 | 174.2 | 0.0 |
| REEF | capsule | 174.2 | 174.2 | 0.0 |
| REEF | fish | 174.2 | 174.2 | 0.0 |
| REEF | glow | 174.2 | 173.4 | 0.8 |

**VERIFIED:** Road samples use the phase-C isolation method and its central band (x 40–75%, y 48–85%). Water visibility is derived from **the same frame without glow**, then measured in the composited full frame. This catches halo light on water; measuring the isolated water material alone missed it. The final halos keep cyan chroma and zero water pixels above 239. Both road medians are inside the combined 30.9–45 range; road p99 is below the previously measured painting road p99 of 222.18 (Phase F review-9).

| Pose | Road p50 | Road p99 | Sea max | Shallows max | Water white % | Shallows chroma, without → with halo |
|---|---:|---:|---:|---:|---:|---|
| COURT | 40.74 | 85.89 | 67.26 | 145.39 | 0.00 | 18.95 → 18.98 |
| REEF | 32.58 | 82.74 | 68.50 | 232.49 | 0.00 | 23.44 → 23.54 |

Sea day sparkle coverage is 0.266% / 0.377% (COURT / REEF), maximum connected blob 4 / 5 pixels, autocorrelation 0.036 / 0.054; all inside the inherited sparsity bounds. Sea p50 is unchanged at 85.191 / 86.191. **Strict sea-chroma floor not demonstrated:** cross-run means are 55.745 → 55.721 and 56.113 → 56.097, tiny negative deltas despite the untouched sea shader. These numbers are reported without declaring the exact no-decrease comparison a pass. No sea or foam emission was raised. Exact masks and controls are in `water-road.json` / `extra-checks.json`.

## G2 — ordered before / after and topology

**VERIFIED:** The AO-only result missed the gate. The ambient/direct response supplied the remaining floor. The canopy-only addition is small relative to frame-to-frame camera settling; no isolated perceptual improvement is claimed for its percentile delta. All requested levers were measured in order.

| COURT day, ordered lever | Mean | Std | Chroma | p01 | White % |
|---|---:|---:|---:|---:|---:|
| b59a635 baseline | 137.56 | 41.52 | 20.54 | 47.50 | 0.10 |
| (a) 14 m AO | 136.05 | 42.42 | 20.47 | 44.10 | 0.09 |
| (b) ambient/direct response, before G3 | 130.30 | 46.40 | 21.13 | 30.00 | 0.09 |
| G3 neutral atlas, before (c) | 130.93 | 46.51 | 20.48 | 29.20 | 0.10 |
| (c) canopy tint; final | 130.90 | 46.55 | 20.46 | 29.40 | 0.09 |

**VERIFIED:** `topology.json` compares decoded GLB accessors against b59a635. Painted geometry remains **66,694 triangles**; all non-COLOR_0 attributes and indices are byte-identical. The props remain **1,092 triangles**, including ball 168 / ring 256. Collapsing UV seams causes Blender to reorder vertex/index buffers; canonical triangles, normals and stripe colours are identical. No geometry was added. `capsule.glb` is byte-identical to b59a635. The AO ray caster covers the static painted geometry; separately instanced toys and capsule hardware are not baked occluders. That contact-shadow coverage remains a limitation of this bake, rather than a claimed completed result.

## G3 — atlas correction, isolated ball, and the unmet targets

**VERIFIED:** Both toys sample `(690/1024, 690/1024)` in uploaded texture space, inside the clock-face quadrant and clear of the hands. Pixel RGB is (254,254,254); its bilinear neighbourhood is (253.75,253.75,253.75). The exported pigment material has zero emissive factor. The old jungle/sand quadrant averaged (241.8,200.9,82.7). `build/props.glb.json`, the rendered 8 m crops, and `ball.json` record the consumer and palette.

The primary phase-C-style 8 m isolation contains 34,232 ball pixels in both versions. **Mean chroma: 40.472 → 22.393 (−44.7%); required ≥52.614.** A perfect-white texture override produces **22.398**, so a whiter atlas cannot close this gap with the same palette, lighting and tone mapping. A hypothetical flat rendering of the authored linear palette, converted correctly to sRGB on the same visible stripe area, measures 33.288. The old yellow tint on the nominally white stripes inflated the whole-ball chroma metric.

The primary-view on-screen stripe means are blue (30.6,109.4,138.1), white (119.7,135.4,130.7), orange (139.4,67.4,39.6). Authored linear colours converted to sRGB are (48.4,187.5,255), (255,255,255), (255,104.6,63.2); these plainly miss ±20 per channel. Even the ideal white texture leaves the white stripe at (120.3,135.9,131.2). Changing the atlas alone cannot undo the scene lighting/tone response. Yellow is on the far side in this primary view; supplementary 8 m views, when present, are labelled separately.

**UNMET / left undone:** +30% whole-ball chroma and ±20 screen-channel agreement. The correction keeps the authored palette and zero emission; it does not compensate by tinting white stripes yellow again or changing the shared grade. The script's authored colours are blue/white/orange/yellow, and the ring is unstriped; the brief's description of green stripes and striped rings differs from the source.

## Registration / asset checklist

**VERIFIED:** Existing node names retained; no route/data registration or new draw batches. Painted 10 meshes / 593 placements; props seven named nodes; ball/ring UV cell checked on the exported consumer. Props bytes 1,338,352 → 919,012; painted bytes remain 8,268,880; capsule bytes remain 433,544. All island modules remain lazy. Source hashes and triangle checks are in `topology.json` and the final validation artifacts.

## Budget and soaks

The published Phase F baseline is historical (before this brief's column fix), not a new b59a635 timing run: peak 124 draws / 192,268 triangles; shell 277.2 KiB; island chunk 99.9 KiB. The final measured rows below are the acceptance evidence.

| Tier | Laps (ms) | Missed gates | Draws | Triangles | p95 ms | Observed / expected samples (residual) | Material violations |
|---|---|---:|---:|---:|---:|---|---:|
| rookie | 33158, 32125, 31925 | 0 | 125 | 192,292 | 8.90 | 720 / 726.21 (-6.21) | 0 |
| works | 33158, 32125, 31925 | 0 | 125 | 192,292 | 8.70 | 720 / 727.43 (-7.43) | 0 |
| feral | 33158, 32067, 31900 | 0 | 126 | 192,388 | 8.70 | 720 / 721.38 (-1.38) | 0 |
| works-reduced | 33158, 32125, 31925 | 0 | 122 | 188,644 | 8.60 | 720 / 722.17 (-2.17) | 0 |

Ceilings: **130 draws / 205,000 triangles / p95 11 ms**, shell **277.5 KiB gzip**, island **109.89 KiB gzip**. Percentiles use 720 observed frames; every expected sample count and residual above comes from the soak's measured pre-start rAF rate. The four soaks run sequentially. Full race records, lighting-state splits and material walks are in `soak-{rookie,works,feral,works-reduced}/`.

| Budget | Published Phase F before | Yours, final | Ceiling |
|---|---:|---:|---:|
| Peak draws | 124 | 126 | 130 |
| Peak triangles | 192,268 | 192,388 | 205,000 |
| Worst p95 ms | 8.9 | 8.9 | 11.0 |
| Shell gzip KiB | 277.2 | 276.8 | 277.5 |
| Island gzip KiB | 99.90 | 101.12 | 109.89 |

**VERIFIED:** Final `npm run test:code` exited 0. Initial JS is 972.9 KiB raw / 264.8 KiB gzip; shell is 276.8 KiB gzip and the island is 101.12 KiB. Four soaks have zero missed gates and zero material violations.

## Validators, discrepancies, and open verification gaps

The final `verification.json` / `test-code.log` records `npm run test:code`; `build-summary.json` records final byte budgets. The island validator checks 9,729 corridor rays, atlas quadrants and 60/120/240 Hz deterministic runtime behavior. Each material walk includes hidden meshes and checks tone mapping/fog exemptions by name.

Discrepancies found and handled:

- The supplied capture script waits at .550/.725, while §1 specifies .560/.735. The evidence follows the written pose windows and records actual capture transforms.
- The brief's “road p50 37.8” is its full-frame median. Actual baseline COURT road isolation measured 49.02; the pavement-only trim brings it below 45.
- The night-column code had an extra ×0.7 opacity factor despite §1 stating `opacity = nightBlend`; the final numeric correction follows §1.
- The glow lookup expects `CAP_core`, while the runtime capsule is named `DI_CAPSULE_CAP_core`; the capsule halo is absent. Node names and structure were left within the stated ownership boundary.
- Same-frame water masks were necessary: cross-run shoreline masks missed some clipped halo pixels. Final acceptance uses the stricter same-frame mask and a control redraw.

**UNVERIFIED:** The strict cross-run sea-chroma no-decrease comparison (small negative deltas stated above), real controller playtest, browser/GPU matrix, and pixel equality of the other six circuits. Only island files were changed by this pass; unrelated local shared-environment edits preclude attributing a comparison with main to this pass. Static AO does not include the separate instanced toys/hardware as occluders. G3's numerical targets remain unmet for the measured reasons above. No target has been silently withdrawn and no commit was made.

## Commands / reproduction

Run from the repository root. Baseline fixtures are read from the requested commit; the in-memory baseline responses avoid resetting the working tree.

```sh
git show b59a635:docs/briefs/DREAM-ISLAND-VS-DESIGN.md
git show b59a635:public/assets/dreamisland/painted.glb > /tmp/di-b59-painted.glb
git show b59a635:public/assets/dreamisland/props.glb > /tmp/di-b59-props.glb
node art/evidence/dreamisland-v1/vs-design/capture.mjs --label=baseline --day-only --masks
/Applications/Blender.app/Contents/MacOS/Blender -b --python art/blender/build_dreamisland_painted.py -- --alive-ao --ao-source=art/evidence/dreamisland-v1/alive/3d/ao/painted-before.glb
node art/evidence/dreamisland-v1/vs-design/capture.mjs --label=ao-only --day-only --masks
node art/evidence/dreamisland-v1/vs-design/capture.mjs --label=g2-light --day-only --masks
node art/evidence/dreamisland-v1/vs-design/ball.mjs before
/Applications/Blender.app/Contents/MacOS/Blender -b --python art/blender/build_dreamisland_props.py
node art/evidence/dreamisland-v1/vs-design/ball.mjs after
/Applications/Blender.app/Contents/MacOS/Blender -b --python art/blender/build_dreamisland_painted.py -- --alive-ao --canopy-tint
node art/evidence/dreamisland-v1/vs-design/verify.mjs
python3 scripts/visual/grade/measure-frames.py --full art/evidence/dreamisland-v1/vs-design/final/court-day.png art/evidence/dreamisland-v1/vs-design/final/court-night.png art/evidence/dreamisland-v1/vs-design/final/reef-day.png art/evidence/dreamisland-v1/vs-design/final/reef-night.png art/references/dreamisland/phase-f/target-court-day-gptimage2.png art/references/dreamisland/phase-f/target-court-night-gptimage2.png
python3 art/evidence/dreamisland-v1/vs-design/proof.py
python3 art/evidence/dreamisland-v1/vs-design/extra-checks.py
python3 art/evidence/dreamisland-v1/vs-design/report.py
```

`verify.mjs` runs the final capture, `proof.py`, the pixel gates, `soaks.mjs`, then `npm run test:code`. `soaks.mjs` expands to `node scripts/visual/dreamisland/race.mjs --tier=rookie|works|feral --out=…` plus a fourth `--tier=works --reduced` run, with the full arguments in `soak-runs.json`. G1 exploration used `capture.mjs --night-only --trials --sources --masks` with labels `g1-composite-trials` and `g1-opacity-trials`; each saved filename names the trial's size/tint/opacity. The trials are exploratory; only `final/` decides acceptance. Intermediate step captures record the code/asset stage in their label; regenerating them requires the corresponding build stage above. The final test-generated painted validation is copied here and the unrelated historical validation file is restored to its initial contents.
