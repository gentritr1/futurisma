**Current water verdict (§9): measured water checks PASS.** The ordered table, night-water chroma/brightness proof, 2× crops and validation are in [the §9 re-report](review-9/README.md). Feral timing measured 12.2 ms initially and 9.3 ms on one unchanged-source repeat; both results are retained. The earlier water reports below are historical. Accepted §5.2–§5.6 evidence remains unchanged.

---

# Phase F · F-3D handoff

**UNCOMMITTED.** Base: `eafe0b9`, branch `work/dream-island-alive`. Only F-3D-owned source/art was edited. Opus’s files and all pre-existing edits were preserved.

## Five initial gaps

- The painted water carries sun glints; the original water never reaches white.
- The sea and shallows lack a reflected sky and a distinct depth band.
- The painted props have chrome/glass response absent from the existing materials.
- The night painting has bright sources against dark water; the shipped scene compresses both.
- Contact shading is absent around static pieces; the AO trial below measures its actual effect.

## Scope and verification boundary

**VERIFIED:** four ordered water steps, chrome/glass recipes, the two exported GLBs, one glow instance batch, colour-only Blender AO, rendered asset/atlas evidence, and the four isolated soaks.

**UNVERIFIED:** the combined F-CODE/F-3D runtime and its aggregate budget. F-CODE’s current prop/capsule consumers still generate primitives. GLB source loading belongs to that track; `INTEGRATION.md` records the node/material seam. The soaks deliberately use a temporary `eafe0b9` checkout plus this track’s files, without the in-progress F-CODE edits. No claim that gameplay has loaded the two new GLBs is made.

## Measurement method

`measure.py` imports and calls the unchanged `scripts/visual/grade/measure-frames.py`. COURT progress .575; REEF .75; Works; seed 3868938316; fixed shipped chase geometry, 1280×720. World band: x=30–97%, y=18–62%. The additional no-sky result uses x=30–97%, y=30–62%. Road median uses visible road-isolation pixels inside x=40–75%, y=48–85%, avoiding the kerbs. Sky-only frames have zero changed pixels against step 0 in all four pose/state combinations.

**Discrepancy:** §2’s shipped frames are 1600×900 autopilot captures with the craft and rivals. The fixed-pose instrument omits those moving objects and uses route-centre chase placement. Its baseline therefore does not reproduce §2 byte-for-byte. Both reference rows and paired-control deltas are retained; the acceptance figures below are fixed-pose results, not a claim of exact autopilot-pose reproduction. No REEF painting or measured REEF §2 row was supplied.

## Shipped / ours / painting

| Pose/state/source | Mean | Std | Chroma | p01 | p99 | Range | Black % | White % |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| COURT day · §2 shipped | 132.89 | 52.65 | 18.97 | 17.3 | 207.3 | 190.0 | 0.35 | 0.0 |
| COURT day · paired baseline | 141.93 | 51.52 | 21.8 | 32.8 | 209.2 | 176.4 | 0.09 | 0.0 |
| COURT day · final F-3D | 151.33 | 50.19 | 16.75 | 32.5 | 212.4 | 180.0 | 0.09 | 0.5 |
| COURT day · painting | 117.19 | 47.34 | 22.12 | 27.2 | 219.2 | 192.0 | 0.41 | 0.35 |
| COURT night · §2 shipped | 30.42 | 18.07 | 10.65 | 3.5 | 79.1 | 75.6 | 23.3 | 0.0 |
| COURT night · paired baseline | 31.51 | 19.77 | 10.97 | 2.4 | 92.2 | 89.8 | 25.09 | 0.0 |
| COURT night · final F-3D | 35.85 | 32.76 | 11.38 | 2.4 | 183.8 | 181.4 | 25.32 | 0.0 |
| COURT night · painting | 31.03 | 34.87 | 8.85 | 2.1 | 193.5 | 191.5 | 38.92 | 0.06 |
| REEF day · paired baseline | 152.94 | 41.06 | 17.58 | 65.0 | 208.5 | 143.5 | 0.0 | 0.0 |
| REEF day · final F-3D | 160.61 | 39.85 | 13.86 | 65.1 | 208.5 | 143.4 | 0.0 | 0.15 |
| REEF night · paired baseline | 40.28 | 40.27 | 10.14 | 0.0 | 178.4 | 178.4 | 26.1 | 0.0 |
| REEF night · final F-3D | 46.64 | 54.88 | 10.19 | 0.0 | 227.4 | 227.4 | 26.27 | 0.02 |

## Ordered water measurements

Each stage finished its COURT and REEF measurements before the next water stage was applied. `step-2-trial` retains the busy reflection trial; `step-4-trial` retains the oversized wet-road highlights. The accepted stages are below. `step-4` was recaptured on the isolated preview after a shared-preview environment-loading error.

| Stage | Pose/state | Mean | Std | Chroma | p01 | p99 | Range | Black % | White % |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 0 baseline | court day | 141.93 | 51.52 | 21.8 | 32.8 | 209.2 | 176.4 | 0.09 | 0.0 |
| 0 baseline | court night | 31.51 | 19.77 | 10.97 | 2.4 | 92.2 | 89.8 | 25.09 | 0.0 |
| 0 baseline | reef day | 152.94 | 41.06 | 17.58 | 65.0 | 208.5 | 143.5 | 0.0 | 0.0 |
| 0 baseline | reef night | 40.28 | 40.27 | 10.14 | 0.0 | 178.4 | 178.4 | 26.1 | 0.0 |
| 1 sky reflection | court day | 151.22 | 49.21 | 16.89 | 32.8 | 210.6 | 177.8 | 0.09 | 0.0 |
| 1 sky reflection | court night | 31.2 | 18.22 | 11.19 | 2.4 | 76.7 | 74.3 | 24.5 | 0.0 |
| 1 sky reflection | reef day | 160.82 | 39.55 | 13.82 | 65.1 | 208.5 | 143.4 | 0.0 | 0.0 |
| 1 sky reflection | reef night | 34.88 | 29.41 | 10.16 | 0.0 | 146.8 | 146.8 | 25.58 | 0.0 |
| 2 sun glint | court day | 151.9 | 49.95 | 16.77 | 32.8 | 212.4 | 179.6 | 0.09 | 0.5 |
| 2 sun glint | court night | 31.19 | 18.17 | 11.19 | 2.4 | 76.6 | 74.3 | 24.43 | 0.0 |
| 2 sun glint | reef day | 160.94 | 39.8 | 13.86 | 65.1 | 208.5 | 143.4 | 0.0 | 0.15 |
| 2 sun glint | reef night | 34.62 | 29.17 | 10.1 | 0.0 | 146.0 | 146.0 | 25.56 | 0.0 |
| 3 depth band | court day | 151.87 | 49.94 | 16.77 | 32.8 | 212.4 | 179.6 | 0.09 | 0.5 |
| 3 depth band | court night | 31.16 | 18.12 | 11.2 | 2.4 | 76.2 | 73.8 | 24.43 | 0.0 |
| 3 depth band | reef day | 160.67 | 39.77 | 13.87 | 65.1 | 208.5 | 143.4 | 0.0 | 0.15 |
| 3 depth band | reef night | 34.23 | 28.77 | 10.14 | 0.0 | 145.2 | 145.2 | 25.69 | 0.0 |
| 4 night/wet road | court day | 151.87 | 49.94 | 16.77 | 32.8 | 212.4 | 179.6 | 0.09 | 0.5 |
| 4 night/wet road | court night | 36.27 | 33.05 | 11.47 | 2.4 | 183.8 | 181.4 | 25.11 | 0.0 |
| 4 night/wet road | reef day | 160.67 | 39.77 | 13.87 | 65.1 | 208.5 | 143.4 | 0.0 | 0.15 |
| 4 night/wet road | reef night | 46.66 | 54.88 | 10.19 | 0.0 | 227.4 | 227.4 | 26.27 | 0.02 |

**Fixed-pose water gates PASS:** COURT day whitePct 0.5%; with the top 30% excluded, 0.69% ≥ 0.15%. COURT night p99 183.8 ≥ 150, range 181.4 ≥ 140, central road p50 38.79 ≥ 30.9. Sky clipping cannot increase: the sky-only images are pixel-identical.

**Remaining look gap:** the final day mean is higher than §2’s shipped mean and farther from the painting; night blackPct also remains short of the painting. Passing the explicit highlight/range gates does not mean the painting was matched. No sky, grade, exposure, route, schedule or controller changes were made.

## Palette and PMREM

`water-palettes.png` / `water-palettes.json`: eight-colour median-cut palettes. Painting water uses the explicitly recorded left-hand sea rectangle; rendered water uses exact visible sea/shallows isolation masks. Their regions differ and are stated in the JSON.

- court blend 0: two PMREM passes, 128-pixel cube faces; CPU submission/load work 127.50 ms. This is not a GPU timer measurement.
- court blend 1: two PMREM passes, 128-pixel cube faces; CPU submission/load work 132.60 ms. This is not a GPU timer measurement.
- reef blend 0: two PMREM passes, 128-pixel cube faces; CPU submission/load work 140.90 ms. This is not a GPU timer measurement.
- reef blend 1: two PMREM passes, 128-pixel cube faces; CPU submission/load work 128.20 ms. This is not a GPU timer measurement.

PMREM is made once from the existing `dreamisland_panorama` in both states, then sampled with continuous night mixing. F0 is .02. The course’s live shadow-casting directional light supplies the sun direction; the sky module itself does not expose one. All consumers retain fog and tone mapping.

## Mesh contracts and material recipes

| Node | Triangles | Role/cell |
|---|---:|---|
| PR_ball | 168 | jungle/sand |
| PR_ring | 256 | jungle/sand |
| PR_sphere | 216 | metal/rail |
| PR_pipes | 340 | metal/rail |
| PR_bollard | 64 | concrete/wall-block |
| PR_bollard_core | 12 | emissive/shallows-glow |
| PR_plinth | 36 | concrete/wall-block |
| CAP_frame | 240 | metal/rail |
| CAP_glass | 216 | emissive/shallows-glow |
| CAP_core | 44 | emissive/shallows-glow |
| CAP_cap | 88 | metal/rail |

**VERIFIED:** capsule bounds Y −1.5…+1.5 m, common origin, no node transforms; 588 total triangles. Pipes height 4 m. Bollard base+core 76 triangles total. Exported node names, triangle ceilings and UV bounds pass `inspect-glb.py`. `build/export-contracts.json` records every accessor check.

Chrome: MeshStandardMaterial, metalness 1, roughness .08, metal atlas tint, shared PMREM. Glass: metalness 0, roughness .15, opacity .55, transparent, depthWrite false, emissive atlas, renderOrder 20. The node binder is called from the water owner, retaining F-CODE file ownership. Distinct glass/core/chrome materials require separate stock instance draws; the brief’s single capsule draw is not compatible with those recipes.

28 full asset frames: every prop plus capsule at 8 m / 40 m, day/night, in `assets/`. Twelve quadrant-ID frames are beside them. All geometric UVs stay within their exact cells; `pixel-checks.json` records the rendered cell-ID counts. Quadrant diagnostics disable MSAA to avoid mixed edge IDs; the classifier also excludes a two-pixel raster edge. Every isolated node selects its expected cell. Production asset frames retain antialiasing.

## Glow and AO

One fogged, tone-mapped additive InstancedMesh; emissive TR cell; depthWrite false. World-metre size, camera-facing matrices, capsule/bollard source instance transforms and per-fish source centres. No additional simulation or clock. Reduced-motion fish stay absent.

- court: night p99 with/without fish sprites 183.8/183.8 (delta 0.0); 0 changed pixels. Eight sprite instances were submitted but do not contribute visible pixels at these pinned poses. This does not prove a visible fish glow in those views.
- reef: night p99 with/without fish sprites 227.4/227.4 (delta 0.0); 0 changed pixels. Eight sprite instances were submitted but do not contribute visible pixels at these pinned poses. This does not prove a visible fish glow in those views.
- capsule at 8 m: isolated night p99 with/without 149.1/112.7; 156812 changed pixels.
- capsule at 40 m: isolated night p99 with/without 19.8/18.1; 6408 changed pixels.
- PR_bollard at 8 m: isolated night p99 with/without 76.3/18.1; 37546 changed pixels.
- PR_bollard at 40 m: isolated night p99 with/without 18.1/18.0; 1514 changed pixels.

**AO topology PASS:** 66,694 triangles before and after, 0 added. Blender casts eight deterministic rays per vertex, then patches only existing COLOR_0 bytes. Independent `ao/byte-proof.json` confirms every non-colour byte identical. COURT day lumaStd 49.94 → 50.19 (+0.25); the bake did not move this global statistic toward the painting’s 47.3.

## Four soaks and ceilings

All final runs use the isolated F-3D build, high quality, 1280×720, seed 3868938316. p95 is the existing instrument’s last 720 rendered intervals; the residual is observed minus calibrated expected samples. No overlapping F-3D browser capture was launched during these runs. Other work on the host was not controlled.

| Run | Laps ms | Misses / recoveries | Draws | Main + shadow triangles | p95 ms | Residual frames |
|---|---|---|---:|---|---:|---:|
| baseline | 33158 / 32125 / 31925 | 0 / 0 | 104 | 133,370 + 28,872 | 8.60 | +3.32 |
| works | 33158 / 32125 / 31925 | 0 / 0 | 105 | 133,386 + 28,872 | 8.90 | -7.13 |
| rookie | 33158 / 32125 / 31925 | 0 / 0 | 105 | 133,386 + 28,872 | 9.00 | -6.44 |
| feral | 33158 / 32067 / 31900 | 0 / 0 | 106 | 133,478 + 28,872 | 8.60 | -0.92 |
| works-reduced | 33158 / 32125 / 31925 | 0 / 0 | 103 | 132,936 + 28,872 | 8.50 | -7.10 |

Works overhead including glow: +0.30 ms vs baseline, below the shared water allowance of 1.0 ms. Water itself adds no draw; visible fish glow adds one draw and 16 triangles. Feral peak 106 draws ≤130, 162,350 triangles ≤205,000. Every final material walk has zero violations.

Shell gzip: 283640 bytes (276.992 KiB), ceiling 277.5 KiB. Island lazy JS gzip: 78018 bytes; isolated measured+10% value 85820 bytes. F-CODE has since added a shared validator pin of 94,224 → 103,647 bytes including the lazy stylesheet; those are read from its in-progress validator, not independently reproduced by this track. Final combined validation remains open.

## Validators and numbers first measured this pass

- Painted validator PASS: 10 meshes / 66,694 triangles; zero corridor intrusions over 9,729 rays; UV/manifest agreement.
- Runtime validator PASS: 60/120/240 Hz identical. Shared working-tree run also passed with the added F-CODE shoals.
- `test-isolated-final.log`: full isolated `npm run test:code` PASS, including build validation. The first run stopped on a wall-clock Greenwater audio bake at 207 ms against 200 ms; the isolated audio recheck passed. No audio assertions were changed.
- Newly measured: paired fixed-pose COURT/REEF baselines; all four water-stage deltas; sky-zero-diff proof; no-sky whitePct and central-road p50; PMREM CPU cost; GLB accessor/node/triangle/UV contracts; palettes; sprite on/off results; AO byte/topology proof; final soaks and p95 residuals.

## Files and commands

Owned source: `dreamisland-water.ts`, additive `dreamisland-materials.ts`, new `dreamisland-reflections.ts`; builders `build_dreamisland_props.py`, `build_dreamisland_capsule.py`, AO option in `build_dreamisland_painted.py`; three GLBs. All remaining new files from this task are under this evidence directory. Nothing was committed.

Run from the repository root with Node 20.19.4 on PATH.

```sh
python3 art/evidence/dreamisland-v1/alive/3d/prepare-review.py
# In /tmp/dreamisland-f3d-eafe0b9:
npm run dev -- --host 127.0.0.1 --port 5203
# Captures from the original repository; repeat for .75 / reef:
node art/evidence/dreamisland-v1/alive/3d/capture.mjs --base=http://127.0.0.1:5203 --blends=0,1 --progress=.575 --out=art/evidence/dreamisland-v1/alive/3d/final/court
python3 art/evidence/dreamisland-v1/alive/3d/measure.py final
# Asset fixture uses the main preview on port 5202:
node art/evidence/dreamisland-v1/alive/3d/assets.mjs
node art/evidence/dreamisland-v1/alive/3d/node-quadrants.mjs
node art/evidence/dreamisland-v1/alive/3d/glow-assets.mjs
python3 art/evidence/dreamisland-v1/alive/3d/inspect-glb.py
python3 art/evidence/dreamisland-v1/alive/3d/palette.py
python3 art/evidence/dreamisland-v1/alive/3d/check-evidence.py
/Applications/Blender.app/Contents/MacOS/Blender -b --python art/blender/build_dreamisland_props.py
/Applications/Blender.app/Contents/MacOS/Blender -b --python art/blender/build_dreamisland_capsule.py
# Restore ao/painted-before.glb before reproducing the AO bake:
/Applications/Blender.app/Contents/MacOS/Blender -b --python art/blender/build_dreamisland_painted.py -- --alive-ao
# In the isolated tree, use the absolute path to this evidence race.mjs:
node /Users/gentlegen/Desktop/futurisma-race/polarity_work/art/evidence/dreamisland-v1/alive/3d/race.mjs --tier=works --out=/Users/gentlegen/Desktop/futurisma-race/polarity_work/art/evidence/dreamisland-v1/alive/3d/soak-works
# Repeat for rookie, feral, and works --reduced.
npm run test:code
node scripts/validate-build.mjs --out=/Users/gentlegen/Desktop/futurisma-race/polarity_work/art/evidence/dreamisland-v1/alive/3d/validators
```

## Open integration/review work

- F-CODE must consume the delivered GLB geometry/maps; see `INTEGRATION.md`.
- F-CODE has added the combined island-chunk pin. Orchestrator must revalidate that build and the combined soaks after GLB source integration. The isolated reserve is not a combined acceptance claim.
- Exact reproduction of §2’s moving autopilot camera/craft/rivals is not established by these route-centre controls.
- The painting’s overall day mean and night black coverage remain unmet; AO did not reduce global day lumaStd; fish sprites did not change the two fixed-pose frames.

## Direct autopilot cross-check

Additional 1600×900 captures retain the shipped moving craft/rivals and sample the first autopilot crossing of COURT .575 and REEF .75. They read the canvas immediately after rendering; DOM HUD is omitted. The original §2 screenshots include a turn callout and minimap inside the default measurement crop, and depict a different framing despite the recorded progress label. These new controls therefore still do not reproduce §2 exactly.

| Source | Pose/state | Mean | Std | Chroma | p01 | p99 | Range | Black % | White % | No-sky white % |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| baseline | court day | 143.62 | 52.04 | 23.12 | 33.5 | 209.4 | 175.8 | 0.1 | 0.0 | 0.0 |
| baseline | court night | 32.3 | 20.34 | 11.41 | 2.5 | 93.9 | 91.4 | 25.01 | 0.0 | 0.0 |
| baseline | reef day | 154.89 | 40.04 | 18.54 | 70.4 | 208.5 | 138.1 | 0.0 | 0.01 | 0.02 |
| baseline | reef night | 41.26 | 41.18 | 10.53 | 0.0 | 179.1 | 179.1 | 26.06 | 0.0 | 0.0 |
| final | court day | 155.2 | 48.36 | 16.78 | 33.7 | 213.6 | 180.0 | 0.11 | 0.55 | 0.75 |
| final | court night | 35.85 | 31.02 | 11.7 | 2.5 | 177.3 | 174.8 | 25.16 | 0.0 | 0.0 |
| final | reef day | 163.71 | 37.53 | 14.17 | 86.2 | 208.5 | 122.3 | 0.0 | 0.17 | 0.23 |
| final | reef night | 48.01 | 56.59 | 10.45 | 0.0 | 229.4 | 229.4 | 26.19 | 0.04 | 0.06 |

All paired progress values match exactly. Render interpolation leaves the camera residuals below; these controls supplement rather than replace the exactly pinned water-step frames.
- court-day.png: camera displacement 0.4652 m; quaternion-component maximum difference 0.0007845.
- reef-day.png: camera displacement 0.0971 m; quaternion-component maximum difference 0.0001190.
- court-night.png: camera displacement 0.3738 m; quaternion-component maximum difference 0.0006303.
- reef-night.png: camera displacement 0.2736 m; quaternion-component maximum difference 0.0003354.

The direct autopilot final COURT frame independently passes the white and night range gates (no-sky whitePct 0.75%, night p99 177.3, range 174.8). Capture command: `node art/evidence/dreamisland-v1/alive/3d/autopilot.mjs --label=final` after preparing the isolated preview. `--label=baseline` used the baseline water/material files and pre-AO painted GLB.
