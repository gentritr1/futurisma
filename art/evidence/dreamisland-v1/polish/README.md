# Dream Island — polish pass

## 1. Five biggest gaps, recorded before implementation

VERIFIED (`git status --short`, `git log -3`): inspection began from the clean `work/dream-island` tree at `947f193`. The list below was written before changing any model, material or runtime source. VERIFIED (`DREAM-ISLAND-CODEX-POLISH.md`): task status is FINAL.

1. **Sea and sky form graphic bands instead of a continuous seascape.** VERIFIED (Phase C contact sheet BEACH/BASIN/REEF day tiles; `08_the_strike.png`): the sea has repeated flat horizontal marks, with a second broad pale band above it. The reference uses distinct cobalt water beneath a soft sky join. The water needs broad swell and a controlled horizon, rather than more small texture detail.
2. **The watchtower's lower masonry disappears behind a green covering.** VERIFIED (POINT day/night tiles, `03_watchtower_point_day.png`, `s6_watchtower_ortho.png`): the current mouth and tunnel read as leaves on a solid green surface. The reference keeps stone courses continuous beneath sparse vertical ivy streaks, and makes the night mouth a warm beacon.
3. **Night loses the road and distant landmarks instead of trading distant visibility for clear edges.** VERIFIED (BEACH/REEF night tiles, `01n_beach_straight_night.png`, `06n_reef_shallows_night.png`): the current road and palms are dark green against near-black surroundings. The references retain a readable neutral road, distinct silhouettes and bright cyan edges. The day REEF stacks also blend into the pale horizon. UNVERIFIED (entry pose not yet captured): the required COURT-entry clock diameter; the existing closer COURT frame already shows both hands clearly.
4. **The road corridor lacks the canopy and verge depth that frame the references.** VERIFIED (`phase-c/frames/day-grove.png`, `02_palm_grove_day.png`): current palms mainly line the sides and leave open sky across the road; understory clumps are isolated on a flat strip. The road/verge seam is sharp and its kerb does little to frame the racing line at distance. The reference uses overhead crowns, crowded understory and a clear pale kerb.
5. **The night turn holds its daylight appearance too long and then drops at the end.** VERIFIED (five crossfade tiles and `08_the_strike.png`): the first four captures remain visibly daytime, while the fifth is suddenly a starfield with a dark road. The final sequence needs a steady perceptual change while retaining the reference's clean day blue / night cyan separation.

## Result and before/after frames

VERIFIED (`polish-report.py`, original instruments listed below): the nine residual checks and all mandatory automated gates pass. [Open the review and strike flipbook](/Users/gentlegen/Desktop/futurisma-race/polarity_work/art/evidence/dreamisland-v1/polish/index.html) · [17-slot before/after sheet](/Users/gentlegen/Desktop/futurisma-race/polarity_work/art/evidence/dreamisland-v1/polish/eyeball-before-after.png).

| Original gap | BEFORE | AFTER |
|---|---|---|
| Sea / sky join | [VERIFIED frame](/Users/gentlegen/Desktop/futurisma-race/polarity_work/art/evidence/dreamisland-v1/phase-c/frames/day-beach.png) | [VERIFIED frame](/Users/gentlegen/Desktop/futurisma-race/polarity_work/art/evidence/dreamisland-v1/polish/frames/day-beach.png) |
| Stone tower / moss | [VERIFIED frame](/Users/gentlegen/Desktop/futurisma-race/polarity_work/art/evidence/dreamisland-v1/polish/before/watchtower/watchtower-40m-day.png) | [VERIFIED frame](/Users/gentlegen/Desktop/futurisma-race/polarity_work/art/evidence/dreamisland-v1/polish/focals/watchtower-40m-day.png) |
| Night road / distant forms | [VERIFIED frame](/Users/gentlegen/Desktop/futurisma-race/polarity_work/art/evidence/dreamisland-v1/phase-c/frames/night-reef.png) | [VERIFIED frame](/Users/gentlegen/Desktop/futurisma-race/polarity_work/art/evidence/dreamisland-v1/polish/frames/night-reef.png) |
| Canopy / verge / kerb | [VERIFIED frame](/Users/gentlegen/Desktop/futurisma-race/polarity_work/art/evidence/dreamisland-v1/phase-c/frames/day-grove.png) | [VERIFIED frame](/Users/gentlegen/Desktop/futurisma-race/polarity_work/art/evidence/dreamisland-v1/polish/frames/day-grove.png) |
| Ramp pacing | [VERIFIED frame](/Users/gentlegen/Desktop/futurisma-race/polarity_work/art/evidence/dreamisland-v1/phase-c/crossfade-shipped/blend-075.png) | [VERIFIED frame](/Users/gentlegen/Desktop/futurisma-race/polarity_work/art/evidence/dreamisland-v1/polish/crossfade-baseline/blend-075.png) |

VERIFIED (`polish-compose.py`): all seventeen source slots are paired on one sheet. The historical pier/shore BEFORE and AFTER slots used identical cameras; each corresponding new pair therefore reuses its fresh endpoint frame. Phase C stays untouched.

## Files and asset checks

VERIFIED (`git diff --name-only`, `polish-report.py`): changes are confined to the owned Blender builders, hero assets, painted GLB/manifest, four Dream Island visual modules, review checks and polish evidence. Route, schedule, powers, pace, references, atlases, original validators and Phase C evidence are unchanged. HEAD remains `947f193`; no commit was made.

VERIFIED (Blender build logs; `check.mjs --out=.../polish/loader`): the watchtower uses stone-cell vertex moss, sparse keyed ivy, course joints and two lamps; the waterfall has full-drop sheet cards and a foam ring; the stacks use darker stone/cap tints. The clock GLB is unchanged and placed at the revised scale. All four GLBs load with shared `DI_MAT_<role>` names and no embedded textures.

| Hero GLB | Triangles / asset ceiling | Exported bounds, metres | Evidence |
|---|---:|---|---|
| clock-tower | 4,804 / 6,000 | 8.000 × 14.000 × 8.000 | VERIFIED (`loader/loader-check.json`) |
| watchtower | 9,438 / 10,000 | 28.000 × 30.000 × 28.503 | VERIFIED (`loader/loader-check.json`) |
| waterfall-cliff | 1,218 / 5,000 | 21.945 × 16.045 × 12.210 | VERIFIED (`loader/loader-check.json`) |
| sea-stack-set | 1,304 / 6,000 | 68.528 × 40.000 × 11.643 | VERIFIED (`loader/loader-check.json`) |

VERIFIED (loader anchors and painted validator): the waterfall sheet drop is 16.000 m; the full AABB includes the cap above it. The clock source is 14 m and the live placement is 18.000 m. The watchtower retains the accepted 1.10 runtime scale and its true arched clearance: rectangle to the spring line plus curved cap, with zero intersecting triangles.

## Measured ceilings

| Axis | Phase C record | Polish | Ceiling | Evidence |
|---|---:|---:|---:|---|
| Total draws | 92 | 93 | 110 | VERIFIED (`race.mjs --tier=feral`) |
| Main + shadow triangles | 148,002 | 151,404 | 180,000 | VERIFIED (same metrics) |
| p95 ms; sample residual | 8.500; -5.362 | 8.500; -5.549 | report; 11 ms target | VERIFIED (same metrics) |
| Initial JS / shell gzip, KiB | 264.8 / 276.7 | 264.8 / 276.7 | 266 / 277 | VERIFIED (`npx vite build && node scripts/validate-build.mjs`) |
| Corridor intrusions | 0 | 0 | 0 | VERIFIED (`validate:dreamisland-painted`) |
| Material-walk violations | 0 | 0 | 0 | VERIFIED (all four `race.mjs` walks) |
| Maximum letter height, m | 0.4721 | 0.4721 | 0.59 | VERIFIED (painted validator glyph fractions) |
| Determinism | 60 / 120 / 240 Hz identical=True | 60 / 120 / 240 Hz identical=True | identical | VERIFIED (`validate:dreamisland-runtime`) |
| Atlas decisions | 14 / 14 | 23 / 23 | every consumer | VERIFIED (original + added quadrant-ID probes) |

VERIFIED (`soak-feral/metrics.json`, wrapped shadow pass):

| Lighting state | Main / shadow draws | Main / shadow triangles |
|---|---:|---:|
| day | 76 / 17 | 127,254 / 23,624 |
| crossfade | 76 / 17 | 127,780 / 23,624 |
| night | 73 / 17 | 121,738 / 23,624 |

## Ordered residual measurements

1. VERIFIED (`crossfade-profile` + `polish-profile.py`): sea luma standard deviation 0.079814 → 0.144712; mean horizon step 0.278854 → 0.060826, maximum 0.066510. The near patch adds 1,800 triangles in the existing sea draw (district-frame water counters before/after).
2. VERIFIED (`polish-tint.py`, shared-light 40 m frame): lower-band chroma, neutral stone / original moss / polish = 0.161949 / 0.232384 / 0.162602. Corresponding luma = 0.414843 / 0.226310 / 0.332973. The POINT approach mouth/drum ratio is 3.193231.
3. VERIFIED (`polish-kerb.py`): cyan stripe widths at exactly 40 m = day 5/6 px; night 6/7 px. Real top faces have upward normals; the mesh receives shadows; the inner boundary is retained. The new shoulder uses the existing concrete batch.
4. VERIFIED (`polish-canopy.mjs`, `polish-regions.py`, manifests): foliage covers 1012/1280 columns above the GROVE horizon (79.1%); minimum canopy clearance above the corridor ceiling is 2.106429 m. GROVE/CUT understory placements 64 → 128, adding 2,432 triangles (7.6% of the brief’s 32k reserve) in the existing batch. Painted GLB total 64,944 → 66,380, with 10 → 10 material batches.
5. VERIFIED (original crossfade instrument, matched cameras): BEACH night road luma 0.085392 → 0.137500; BEACH edge contrast 0.412206 → 0.416124; REEF edge contrast at the Phase C .72 pose 0.399895 → 0.417924.
6. VERIFIED (`polish-crossfade-check.py`): maximum/minimum sky step ratio 1.729257; T1 road midpoint deviation 0.008706; T2 and T3 pass.
7. VERIFIED (`polish-regions.py`): COURT-entry face 78 × 70 px, with 110 visible hand pixels. The waterfall’s shared-water sheet and foam are visible in both lighting states; its animation clock advances normally and stays zero under reduced motion.
8. VERIFIED (`polish-stacks.py`): qualifying REEF silhouettes = 2; sea_stack_32m at 162.722 m, contrast 0.604653; sea_stack_26m at 221.101 m, contrast 0.620829.
9. VERIFIED (`polish-horizons.py`, four day frames): the panorama samples above the measured painted shoreline; the second panorama horizon is gone. Full-frame and isolated-dome row profiles are recorded in `horizon-row-profiles.json`. Occluded sea/sky boundaries remain null rather than being reported as zero.

VERIFIED (`polish-focals.mjs`): sixteen 40 m / 300 m day/night focal frames, gathered in `focals/contact-sheet.png`, use the game’s shared lighting, fog and tone mapping. The clock uses its revised placed scale; other review assets retain source metres, with the larger accepted watchtower runtime placement checked separately. VERIFIED (`frames.mjs`): fourteen district frames provide both-state verge/card evidence in `frames/verge-contact-sheet.png`.

## Ten means: preserved BEFORE, new baseline, independent repeat

VERIFIED (unchanged `crossfade-profile.mjs` + `.py`, then `polish-crossfade-check.py`): same camera and five blend values. T1 uses the new endpoints; T2 checks both regions; T3 checks the new baseline against the independent repeat.

| Region | Blend | Phase C BEFORE | Polish baseline | Polish repeat | Repeat delta |
|---|---:|---:|---:|---:|---:|
| sky | 0.000000 | 0.709730 | 0.691854 | 0.691854 | 0.000000 |
| sky | 0.250000 | 0.648325 | 0.555639 | 0.555639 | 0.000000 |
| sky | 0.500000 | 0.563906 | 0.365635 | 0.365635 | 0.000000 |
| sky | 0.750000 | 0.427373 | 0.159134 | 0.159134 | 0.000000 |
| sky | 1.000000 | 0.023456 | 0.039718 | 0.039718 | 0.000000 |
| road | 0.000000 | 0.423789 | 0.410918 | 0.410918 | 0.000000 |
| road | 0.250000 | 0.357360 | 0.350308 | 0.350308 | 0.000000 |
| road | 0.500000 | 0.279997 | 0.282915 | 0.282915 | 0.000000 |
| road | 0.750000 | 0.189665 | 0.210117 | 0.210117 | 0.000000 |
| road | 1.000000 | 0.085392 | 0.137500 | 0.137500 | 0.000000 |

## Palette and tint calibration

VERIFIED (`polish-palette.py`): eight Pillow median-cut dominants from each half of `08_the_strike.png` and each complete HUD-free BEACH endpoint. Different compositions change proportions. The road is neutral by day and grey at night, with the cyan water cue preserved. The full-frame dominant lists still differ: the game’s large road area weights greys and dark greens, while the reference weights more pale blue by day and warm stone at night. This is a palette comparison, not a claim of identical gamut or composition.

| Frame | Eight dominant colours, in pixel-share order |
|---|---|
| Reference day | #5b9ee1 (20.0%), #bfdaea (19.6%), #919da2 (17.8%), #f1f7f8 (13.3%), #3f4c84 (12.9%), #d9e1e5 (10.0%), #8fd6e5 (4.1%), #777f97 (2.2%) |
| Game day | #7ab3d1 (21.0%), #6d7067 (20.4%), #616458 (15.6%), #a6cddb (12.9%), #626b63 (9.0%), #65a4c4 (7.7%), #314d4f (7.3%), #829186 (6.1%) |
| Reference night | #000000 (32.0%), #bab19e (22.1%), #344339 (12.6%), #94613c (10.8%), #1b0920 (6.7%), #000005 (5.9%), #000605 (5.5%), #5fbaad (4.6%) |
| Game night | #202420 (26.1%), #000001 (19.5%), #1e282c (16.9%), #141c1d (11.4%), #070c0f (8.4%), #304334 (7.2%), #020204 (6.7%), #172225 (3.8%) |

VERIFIED (`tint-calibration/tint-profile.json`): additional rendered-luma calibrations at the recorded poses:

| Consumer | Mean luma | Mean chroma |
|---|---:|---:|
| stacks-before / cap | 0.280724 | 0.281235 |
| stacks-before / stone | 0.366951 | 0.129881 |
| stacks-after / cap | 0.204247 | 0.215028 |
| stacks-after / stone | 0.222612 | 0.082448 |
| watchtower-accents / ivy | 0.297811 | 0.211953 |
| watchtower-accents / joints | 0.203600 | 0.234938 |
| shoulder / shoulder | 0.432090 | 0.069717 |

VERIFIED (`waterfall/region-profile.json`):

| Waterfall region / state | Visible pixels | Mean luma |
|---|---:|---:|
| waterfallsheets / day | 7839 | 0.318421 |
| waterfallfoam / day | 108 | 0.649872 |
| waterfallsheets / night | 7839 | 0.633284 |
| waterfallfoam / night | 108 | 0.647611 |

VERIFIED (`polish-motion.mjs`, `waterfall-motion/motion.json`): reduced-motion sheet UV time remains [0, 0] and emissive intensity remains [0.7, 0.7]. The shared lighting is still active; the isolated reduced-motion frames are not pixel-identical (1173 pixels differ by more than two display levels). This verifies parked UV motion and constant emission, not a frozen rendered frame.

## Soaks, suite and rendered atlas checks

VERIFIED (original `race.mjs` + `instrument.mjs`):

| Tier | Lap times, ms | Missed / recoveries | Draws | Main + shadow triangles | p95 ms | Sample residual |
|---|---|---|---:|---:|---:|---:|
| works | 33158 / 32125 / 31925 | 0 / 0 | 93 | 151,312 | 8.500 | -2.931 |
| rookie | 33158 / 32125 / 31925 | 0 / 0 | 93 | 151,312 | 8.500 | -0.670 |
| feral | 33158 / 32067 / 31900 | 0 / 0 | 93 | 151,404 | 8.500 | -5.549 |
| works-reduced | 33158 / 32125 / 31925 | 0 / 0 | 93 | 150,878 | 8.500 | -6.138 |

VERIFIED (`polish-report.py`): sampled intervals, expected samples and residuals in `sample-reconciliation.json` reconcile exactly with the original frame records. Timing is a local 1280×720 ANGLE/Metal result. All material walks and browser error lists are clean.

VERIFIED (`test-code/test-code.json`): unchanged `npm run test:code` passes on a byte-checked temporary snapshot. Its original evidence-writing defaults stay inside that snapshot; read-only Git index access supports the unchanged security/soundtrack checks. Source hashes are rechecked against this final tree.

VERIFIED (`atlas-original`, `atlas-added`, both quadrant-ID directories): the original fourteen and nine added consumers are rendered against their source cells and unambiguous quadrant colours. [Atlas contact sheet](/Users/gentlegen/Desktop/futurisma-race/polarity_work/art/evidence/dreamisland-v1/polish/atlas-cells.png). `palette-attribute-proof.json` proves the final shoulder tint edit left every index, position, normal and UV unchanged; the quadrant probes deliberately disable vertex colours.

## Commands and report limits

VERIFIED (command logs and source hashes): the named original visual scripts run through `node scripts/visual/dreamisland-heroes/polish-run.mjs SCRIPT ...`, with `TIDELINE_PUPPETEER` pointing to `polish-transport.mjs`. This wrapper bounds browser cleanup and exits after the instrument finishes. For `race.mjs` only, its hard-coded port 5200 is redirected to this task’s private 5217 server; `transport.json` records both URLs. No rendering, physics, timing algorithm or validator assertion changes.

VERIFIED (scope audit): no AI image, texture or 3D generator was used. Geometry was authored in Blender/Python; evidence is rendered geometry, direct pixel measurement, and labelled composites. No commits.

VERIFIED (discrepancies): the baseline sea variation and GROVE coverage already exceeded the brief’s rough estimates; the report uses the measured BEFORE values. The clock source remains 14 m while its placement is 18 m. The full waterfall AABB is taller than its exact 16 m sheet drop. POINT contact-sheet cameras are inside the tunnel, so the mouth ratio uses the recorded .32 approach. The original material walk exempts its two existing sky names. The original colour-equality masks retain their recorded overlap counts; no mean or assertion was edited to hide that measurement limit.

VERIFIED (source discrepancies): [handoff:18](/Users/gentlegen/Desktop/futurisma-race/polarity_work/docs/briefs/DREAM-ISLAND-HANDOFF.md:18) quotes a different reviewer residual. The BEFORE timing column uses the committed `phase-c/soak-feral/metrics.json`, and [race.mjs:48](/Users/gentlegen/Desktop/futurisma-race/polarity_work/scripts/visual/dreamisland/race.mjs:48) is the unchanged two-name sky exemption.

VERIFIED (`strike/strike.json`): the final strike sequence is [here](/Users/gentlegen/Desktop/futurisma-race/polarity_work/art/evidence/dreamisland-v1/polish/strike); the local [flipbook](/Users/gentlegen/Desktop/futurisma-race/polarity_work/art/evidence/dreamisland-v1/polish/index.html) (images, slider and playback verified by `polish-review-check.mjs`) lets the reviewer step through all ten frames.

UNVERIFIED (requires the user’s visual judgement): final art acceptance. All requested builds, measurements, the suite and four soaks are recorded above.
