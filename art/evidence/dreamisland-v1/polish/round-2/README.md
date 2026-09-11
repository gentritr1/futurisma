# Dream Island polish round 2

## Five biggest remaining gaps — recorded before production changes

1. **Water lacks the reference's cobalt/cyan separation.** The round-1 sea has surface variation, but its deep water and shallow edge do not have the confident colour blocks of reference 06. Reconciles with residual 1.
2. **The grove reads as roadside planting rather than an overhead canopy.** Open sky and evenly lit road dominate; the reference has overlapping fronds and broken shade. Reconciles with residual 2.
3. **Night cues are strongest only when already beside them.** The lit POINT bore works close up, but the BEACH view lacks a clear distant destination and its kerb stripe is subdued. Reconciles with residuals 3 and 6. The fixed route may not share the reference's direct tunnel sightline; prove visibility before tuning brightness.
4. **The transition reveals stars while the scene still reads as day.** The five frames have smoother brightness than phase C, but the overlap of clouds and stars remains visible. Reconciles with residual 4; T3 will repeat the newly measured baseline.
5. **Hero and sign details collapse into broad surfaces at speed.** Clock face, falling water, stack bases, crown tops and gate digits need selective contrast and shape. Reconciles with residuals 5 and 7. Small detail must earn its cost in the rendered 40 m views.

VERIFIED visual comparison: art/evidence/dreamisland-v1/polish/eyeball-before-after.png beside references 08, 06, 02, 01n and 03 in art/references/dreamisland/heroes/. No numerical claim is inferred from this eyeball pass. No disagreement with the seven requested residuals; the distant beacon sightline remains to be measured.

Starting state: work/dream-island at 40e5856. Concurrent pre-existing edits in index.html, src/game/ui.ts, src/game/race-modes-rules.js and scripts/validate-race-modes.mjs are outside this pass. No commits authorized.

<!-- MEASURED REPORT -->

## Outcome

**VERIFIED:** six residuals meet their requested rendered targets. **VERIFIED FAIL:** residual 3, the distant BEACH tunnel beacon, remains below its 4× / 12 px gate. No route, schedule, pace, powers, game.ts, validator assertions or budget was changed. No commit was made.

[Same 17 before/after tiles](eyeball-before-after.png) · [Strike flipbook](index.html) · [Eight hero views](heroes-day-night.png) · [Reference comparison made before editing](reference-comparison.png)

## Residuals, in brief order

| Item | Measured before → after | Result / evidence |
|---|---|---|
| 1. Sea | Deep-water chroma 0.59359 → 0.60025; reference 0.50417. Ratio 117.7% → 119.1%. Boundary step 0.24346 → 0.24403, maximum span 7 px. | PASS. The baseline already passed both numeric gates; the visible correction is cyan shallows/foam. [Before](before-reef/blend-0-full.png), [after](final-reef/blend-0-full.png). |
| 2. Grove | Top-third foliage columns 79.61% → 90.94%; road luma SD 0.04277 → 0.05147; mean 0.41439 → 0.37689 (-9.05%). | PASS. Crossed fronds from both banks; one continuous subdivided shade strip in the existing jungle-card batch, alpha 0.15. [Before](before-grove/blend-0-full.png), [after](after-grove/blend-0-full.png). |
| 3. Distant beacon | Baseline has no visible bore-lamp pixels. Final bore-only mask: 2 pixels, 4 px wide; luma 0.17755, drum 0.16804; ratio 1.05661. | FAIL. Shared night fog and the oblique fixed sightline remain binding. [Before lamps](before-beach/blend-1-lamps.png), [final full](final-beacon/blend-1-full.png), [final bore lamps](final-beacon/blend-1-lamps.png). |
| 4. Strike | Stars are suppressed until blend 0.6, then reveal with smoothstep over the final 40%. Sky step ratio 1.777×; road midpoint deviation 0.00833; all ten repeat deltas are zero. | PASS T1/T2/T3 on the new baseline. [Before midpoint](before-crossfade/blend-050.png), [after midpoint](crossfade-baseline/blend-050.png), [ten means](crossfade-baseline/ten-means.md). |
| 5. Heroes | Clock +444 source triangles; watchtower +140; waterfall +8 and +1 main draw; stack set +60 (+92 across the placed stacks). Every new feature has nonzero day and night rendered differences at 40 m. | PASS. Raised shadow-casting bezel, 12 ticks, nosings; fast 60% waterfall sheet and 24% mist; notch bands; moss tops and lit windows. [Before hero sheet](before-focals/contact-sheet.png), [eight new frames](heroes-day-night.png), [feature measurements](hero-features/feature-profile.json). |
| 6. Night kerb | At 40 m, baseline stripe luma 0.15178–0.15504 → 0.29261–0.31556; 6–7 px remain visible. Entire visible stripe mean 0.28344, below foam 0.37302. | PASS. The requested 0.4× foam trial was too bright; rendered calibration selected 0.08×. [Before](before-beach/blend-1-full.png), [after](after-beach/blend-1-full.png), [stripe mask](after-beach/blend-1-stripe.png). |
| 7. Gate 1 | Before: 0 visible digit pixels above the fixed 0.40 luma threshold (unreadable, not a claim of zero geometric height). After: digit 12 px, luma 0.45905; plate 0.04431; contrast 0.41474. | PASS. Six inside-corner plates, 15° off the approach-facing plane, 2.4 m earlier; maximum letters 0.5894 m. [Before](before-gate/blend-0-full.png), [after](final-gate/blend-0-full.png), [pixel crop](final-gate/gate-1-pixel-crop.png). |

The reference sea sample is the explicitly recorded rectangle (20, 275)–(370, 315), 14,000 pixels, in `06_reef_shallows_day.png`. Game water regions come from full/isolated equality masks; the boundary statistic uses every unoccluded qualifying column and skips antialias pixels. The first water trial lowered night edge brightness, so the final implementation restores the original night edge tints. Day foam chroma rose from 0.24639 to 0.33990; its luma changed from 0.57350 to 0.55568.

Grove clearance is **VERIFIED** on 432 exported overhanging vertices: minimum 10.95643 m above deck, 2.10643 m above the 8.85 m corridor ceiling. The quadrant census measures 168 canopy triangles and 74 shade-strip triangles (242 total); no extra foliage draw. The strip is tessellated to follow the curved, rising deck, while remaining one batched decal surface.

The BEACH beacon target is not closed by brighter close-range lamps. Its placement is 624.021 m from the pinned camera, 28.661° off axis; the shared night fog density remains 0.0034. Exterior arch lamps improve the POINT/40 m view but do not satisfy the long-range mask. Changing the fixed sightline or the night-fog readability contract needs a separate direction; neither was changed here.

## Discrepancies against the brief

The initial sea chroma/boundary and top-third foliage measurements already clear the round-2 numeric gates; the rendered reference comparison still justified the colour and overhead-shape changes. The grove shade uses one continuous subdivided surface instead of one planar quad, so it follows the curved and rising deck without floating or intersecting it (`art/blender/build_dreamisland_painted.py:454`). The BEACH beacon conflicts with the fixed, oblique route placement (`art/blender/build_dreamisland_painted.py:402`) and unchanged night fog (`src/game/dreamisland-course.ts:53`). Its target is left failed under the collision rule rather than changing those inputs.

## Ceiling table

| Axis | Round 1 | Round 2 measured | Ceiling |
|---|---:|---:|---:|
| Worst-tier total draws, main + shadow at one frame | 93 | 94 | 110 |
| Triangles, peak main + peak shadow | 151,404 | 128,778 + 28,872 = 157,650 | 180,000 |
| Feral p95 with sample residual | See round-1 soak | 8.40 ms / -2.561 frames | 11.0 ms, report only |
| Initial JS gzip | 264.8 KiB | 264.9 KiB | 266 KiB |
| Shell gzip | 276.8 KiB | 276.8 KiB | 277 KiB |
| Corridor intrusions | 0 | 0 over 9,729 rays; bore clearance 0.302 m | 0 |
| Material-rule violations | 0 | 0, live scene including hidden meshes | 0 |
| Environmental letter height | 0.4721 m | 0.5894 m | 0.59 m |
| Runtime determinism | PASS | PASS at 60/120/240 Hz | identical |
| game.ts seam | 2,577 lines | unchanged | 2,577 |
| Atlas consumers | Previous proof retained | 11/11 new consumers decided | every new consumer |

Draw and triangle accounting follows the named instrument: total draws use `peakTotalCalls`; the triangle gate conservatively adds the separately measured main/shadow maxima. Per-state peak columns are not assumed to occur on the same frame. Final shell and initial-JS values include the concurrent paddock implementation; all Dream Island additions stay behind the existing lazy load.

| Feral lighting state | Main draws peak | Shadow draws min–peak | Total draws peak | Main triangles peak | Shadow triangles peak |
|---|---:|---:|---:|---:|---:|
| day | 77 | 17–21 | 94 | 128,252 | 28,872 |
| crossfade | 77 | 17–17 | 94 | 128,778 | 23,624 |
| night | 74 | 17–21 | 94 | 122,284 | 28,872 |

## Per-hero cost and visibility

| Hero | Source triangles before → after | Placed main triangle delta | Main draw delta | Added shadow peak | Detail ceiling |
|---|---:|---:|---:|---:|---|
| Clock tower | 4,804 → 5,248 | +444 | 0 | +4 draws / +5,248 triangles | +1,500 triangles |
| Watchtower | 9,438 → 9,578 | +140 | 0 | 0 | +400 triangles |
| Waterfall cliff | 1,218 → 1,226 | +8 | +1 | 0 | +200 triangles / +1 draw |
| Sea-stack set | 1,304 → 1,364 | +92 across placed stacks | 0 | 0 | map reserve |

Source counts are the 40 m loader/render instrument before/after records. Placed counts and main/shadow calls are measured inside the feral race render hooks in `soak-feral/per-hero-render.json`; the round-1 sea draws total 1,880 triangles and the new placed set totals 1,972. The clock now casts and receives the shared key-light shadow. The waterfall overlays share one material/draw: 60% fast sheet at 0.37 UV cycles/s beside the original 0.18, with a 24% lamp-cell radial mist. Those rates and alphas are authored settings, not inferred pixel measurements.

| Feature | Day changed pixels / mean luma | Night changed pixels / mean luma |
|---|---:|---:|
| clock-tower / bezel | 1,460 / 0.31471 | 1,130 / 0.11198 |
| clock-tower / ticks | 93 / 0.36073 | 77 / 0.38318 |
| clock-tower / nosings | 795 / 0.45921 | 665 / 0.20649 |
| watchtower / moss-tops | 2,262 / 0.31193 | 2,262 / 0.08618 |
| watchtower / windows | 120 / 0.14607 | 90 / 0.22969 |
| watchtower / portal-lamps | 2,111 / 0.34019 | 2,111 / 0.41770 |
| waterfall-cliff / fast-sheet | 23,956 / 0.35160 | 24,404 / 0.50102 |
| waterfall-cliff / mist | 1,703 / 0.41133 | 1,631 / 0.53569 |
| sea-stack-set / notches | 6,817 / 0.12483 | 6,560 / 0.02074 |

| Hero | Before day / night | After day / night |
|---|---|---|
| clock-tower | [Day](before-focals/clock-tower-40m-day.png) / [night](before-focals/clock-tower-40m-night.png) | [Day](hero-features/clock-tower-40m-day.png) / [night](hero-features/clock-tower-40m-night.png) |
| watchtower | [Day](before-focals/watchtower-40m-day.png) / [night](before-focals/watchtower-40m-night.png) | [Day](hero-features/watchtower-40m-day.png) / [night](hero-features/watchtower-40m-night.png) |
| waterfall-cliff | [Day](before-focals/waterfall-cliff-40m-day.png) / [night](before-focals/waterfall-cliff-40m-night.png) | [Day](hero-features/waterfall-cliff-40m-day.png) / [night](hero-features/waterfall-cliff-40m-night.png) |
| sea-stack-set | [Day](before-focals/sea-stack-set-40m-day.png) / [night](before-focals/sea-stack-set-40m-night.png) | [Day](hero-features/sea-stack-set-40m-day.png) / [night](hero-features/sea-stack-set-40m-night.png) |

These are full-versus-feature-hidden renders at one pinned 40 m pose, through the shipped material, lights, fog and tone mapping. They measure visible contribution, including transparent mist against its actual background. The watchtower hero pose is elevated enough to see its crown tops; the chase poses remain unchanged.

## Crossfade ten means

| Region | Blend | BEFORE | New baseline | New repeat | Repeat delta |
|---|---:|---:|---:|---:|---:|
| sky | 0.000000 | 0.691854 | 0.691853 | 0.691853 | 0.000000 |
| sky | 0.250000 | 0.555639 | 0.555322 | 0.555322 | 0.000000 |
| sky | 0.500000 | 0.365635 | 0.364117 | 0.364117 | 0.000000 |
| sky | 0.750000 | 0.159134 | 0.156514 | 0.156514 | 0.000000 |
| sky | 1.000000 | 0.039718 | 0.039712 | 0.039712 | 0.000000 |
| road | 0.000000 | 0.410918 | 0.410918 | 0.410918 | 0.000000 |
| road | 0.250000 | 0.350308 | 0.351121 | 0.351121 | 0.000000 |
| road | 0.500000 | 0.282915 | 0.284691 | 0.284691 | 0.000000 |
| road | 0.750000 | 0.210117 | 0.213090 | 0.213090 | 0.000000 |
| road | 1.000000 | 0.137500 | 0.141806 | 0.141806 | 0.000000 |

VERIFIED T1: midpoint road deviation ≤ 0.030. T2: all four sky and road luma drops exceed 0.020. T3: independently repeat the **new** baseline within 0.004; all ten measured deltas are exactly zero. The previous baseline remains intact under `before-crossfade/`.

## Four soaks

| Soak | Laps (ms) | Missed gates / recoveries | p95 ms | Window samples / expected | Sample residual (frames) | Draws / triangles |
|---|---|---:|---:|---:|---:|---:|
| feral | 33158 / 32067 / 31900 | 0 / 0 | 8.40 | 720 / 722.561 | -2.561 | 94 / 157,650 |
| works | 33158 / 32125 / 31925 | 0 / 0 | 8.40 | 720 / 720.360 | -0.360 | 94 / 157,558 |
| rookie | 33158 / 32125 / 31925 | 0 / 0 | 8.40 | 720 / 721.699 | -1.699 | 94 / 157,558 |
| works-reduced | 33158 / 32125 / 31925 | 0 / 0 | 8.40 | 720 / 721.847 | -1.847 | 94 / 157,124 |

Each p95 uses the reconciled 720-frame window, with expected count derived from that run’s pre-start requestAnimationFrame calibration. The active-run counts and residuals are retained separately in each metrics file. VERIFIED: all four runs have zero browser errors, zero missed gates, minimum grip 0.85 with the BASIN trigger, settled night at the flag, and zero material violations. The reduced-motion run has zero visible fish and zero changes in settled emission. Runs are serial against the frozen preview recorded in `frozen-preview.json`.

## Validators, assets and provenance

- **VERIFIED:** `npm run test:code` exits 0 in the refreshed byte-checked snapshot, including the concurrent paddock validator and implementation together. [Final suite record](test-code-final/result.json), [full log](test-code-final/npm-test-code.log). The earlier concurrent missing-export failure and isolated-baseline pass are preserved, and are superseded by this final pass.
- **VERIFIED:** 11/11 new atlas consumers pass [quadrant-ID proof](atlas-final/atlas-quadrant-proof.json). The filters select new overhead normals, shade alpha, tick/nosing tints, crown/window height ranges and overlay UV cells. Diagnostic ID renders disable grading and the mist’s brightness-derived opacity only for identifying its quadrant; all luma/chroma captures use the shipped rendering path.
- **VERIFIED:** all four hero GLBs load, 9 placements, 15 merged hero meshes, 18,024 placed hero triangles; two panoramas, three water surfaces, two waterfall flow shaders. Materials use shared atlases; no new image or texture was generated.
- **VERIFIED:** both authored sky sources still pass the existing sky instrument; no panorama or texture files were edited. No route, schedule, powers or pace data was edited, so no pace re-solve is required.
- **VERIFIED:** final source hashes and frozen-preview hashes match for the tested application inputs. game.ts and the owned/excluded boundary are recorded in the final verification JSON. The other implementer committed the paddock fix as `23e6d8f` during this pass; the tested bytes still match. Root index.html and paddock files contain that implementer’s changes only.

## Producing commands

Commands run from the repository root, with Node v20.19.4 and python3/Pillow on PATH. Each JSON records its exact pose, frame names, sample counts and/or input hashes.

```text
/Applications/Blender.app/Contents/MacOS/Blender -b --python art/blender/build_dreamisland_heroes.py
/Applications/Blender.app/Contents/MacOS/Blender -b --python art/blender/build_dreamisland_painted.py
node scripts/visual/dreamisland-heroes/polish-poses.mjs --progress=.72 --blends=0,1 --modes=full,sea,shallows,foam,blank --out=<reef-directory>
python3 scripts/visual/dreamisland-heroes/polish-regions.py <pose-directory>
node scripts/visual/dreamisland-heroes/polish-canopy.mjs --out=<canopy-clearance.json>
python3 scripts/visual/dreamisland-heroes/polish-kerb.py <beach-directory>
python3 scripts/visual/dreamisland-heroes/polish2-gate-profile.py <gate-directory> <signage-manifest.json>
node scripts/visual/dreamisland/crossfade-profile.mjs --base=http://127.0.0.1:5227 --out=<baseline-or-repeat>
python3 scripts/visual/dreamisland/crossfade-profile.py <baseline-or-repeat>
python3 scripts/visual/dreamisland-heroes/polish-crossfade-check.py <baseline> <repeat> <before-crossfade>
node scripts/visual/dreamisland-heroes/polish-focals.mjs --distances=40 --features --out=<hero-features>
python3 scripts/visual/dreamisland-heroes/polish2-feature-profile.py <hero-features>
node scripts/visual/dreamisland-heroes/polish-atlas-quadrant-proof.mjs --claims=polish2-atlas-claims.mjs --out=<atlas-final>
node scripts/visual/dreamisland/race.mjs --tier=feral --out=<soak-feral>
node scripts/visual/dreamisland/race.mjs --tier=works --out=<soak-works>
node scripts/visual/dreamisland/race.mjs --tier=rookie --out=<soak-rookie>
node scripts/visual/dreamisland/race.mjs --tier=works --reduced --out=<soak-works-reduced>
node scripts/visual/dreamisland-heroes/polish-strike.mjs --base=http://127.0.0.1:5227 --out=<final-strike>
node scripts/visual/dreamisland/frames.mjs --base=http://127.0.0.1:5227 --out=<final-frames>
npm run test:code
python3 scripts/visual/dreamisland-heroes/polish2-compose.py
python3 scripts/visual/dreamisland-heroes/polish2-report.py
python3 scripts/visual/dreamisland-heroes/polish2-verify.py
```

The actual node captures use `polish-run.mjs` as an exit/cleanup wrapper. Soaks set `TIDELINE_PUPPETEER` to `polish-transport.mjs` and `DREAMISLAND_REVIEW_BASE=http://127.0.0.1:5227`; the adapter records the URL translation and per-hero render census. It does not change simulation or render settings. The final suite uses the frozen snapshot to keep validators’ historical output paths out of the shared worktree.

## Files added / changed

- Geometry authors: `art/blender/build_dreamisland_heroes.py`, `build_dreamisland_painted.py`; rebuilt four hero GLBs/manifest and painted GLB/manifest/signage manifest. Blender projects and build logs are in this evidence directory.
- Lazy runtime: `src/game/dreamisland-water.ts`, `dreamisland-sky.ts`, `dreamisland-heroes.ts`, `dreamisland-painted-environment.ts`.
- Review instruments: extensions under `scripts/visual/dreamisland-heroes/` for isolated feature/stripe/bore masks, canopy/decal clearance, counterfactual visibility, selectable atlas claims, report/composition, snapshot output paths, and per-hero shadow counts. Exact inventory is in `final-verification.json`.
- Evidence: this round-2 directory, preserving round-1 artifacts and the initial five-gap list.

## Open gaps / what remains undone

- **VERIFIED FAIL — distant beacon:** the required BEACH bore-lamp width/contrast gate is not met. The 40 m/POINT beacon is improved, but that is not substituted for the required distant pose.
- **UNVERIFIED — devices:** all visual and performance evidence is desktop Chrome at 1280×720. No physical-device claim is made.
- No AI image/texture/3D generation, no eager imports, no forbidden production-file edits, and no commit. The art changes and evidence are ready for review; the beacon residual needs a separate sightline/fog decision.
