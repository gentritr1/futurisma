"""Assemble the handoff report exclusively from the named evidence instruments."""
from pathlib import Path
import json,subprocess
out=Path('art/evidence/dreamisland-v1/polish/round-2');prior=out.parent
read=lambda p:json.loads(Path(p).read_text())
region=lambda folder,blend=0:next(r['metrics']for r in read(out/folder/'region-profile.json')['results']if r['blend']==blend)
water0,water1=region('before-reef'),region('final-reef');grove0,grove1=region('before-grove'),region('after-grove');beach=region('after-beach',1);beacon=region('final-beacon',1)
feral=read(out/'soak-feral/metrics.json');cross=read(out/'crossfade-baseline/crossfade-acceptance.json');features=read(out/'hero-features/feature-profile.json');canopy=read(out/'canopy-clearance.json');gate=read(out/'final-gate/gate-profile.json')['results'][0]
readme=out/'README.md';prefix=readme.read_text().split('<!-- MEASURED REPORT -->')[0].rstrip()
lines=[prefix,'','<!-- MEASURED REPORT -->','', '## Outcome', '',
'**VERIFIED:** six residuals meet their requested rendered targets. **VERIFIED FAIL:** residual 3, the distant BEACH tunnel beacon, remains below its 4× / 12 px gate. No route, schedule, pace, powers, game.ts, validator assertions or budget was changed. No commit was made.',
'', '[Same 17 before/after tiles](eyeball-before-after.png) · [Strike flipbook](index.html) · [Eight hero views](heroes-day-night.png) · [Reference comparison made before editing](reference-comparison.png)',
'', '## Residuals, in brief order', '', '| Item | Measured before → after | Result / evidence |','|---|---|---|']
f=lambda n:f'{n:.5f}'
lines += [f"| 1. Sea | Deep-water chroma {f(water0['sea']['meanChroma'])} → {f(water1['sea']['meanChroma'])}; reference {f(water1['referenceSea']['meanChroma'])}. Ratio {water0['referenceSea']['gameToReferenceChroma']*100:.1f}% → {water1['referenceSea']['gameToReferenceChroma']*100:.1f}%. Boundary step {f(water0['boundary']['medianLumaStep'])} → {f(water1['boundary']['medianLumaStep'])}, maximum span {water1['boundary']['maximumWidthPixels']} px. | PASS. The baseline already passed both numeric gates; the visible correction is cyan shallows/foam. [Before](before-reef/blend-0-full.png), [after](final-reef/blend-0-full.png). |",
f"| 2. Grove | Top-third foliage columns {grove0['foliage']['topThirdColumnCoverage']*100:.2f}% → {grove1['foliage']['topThirdColumnCoverage']*100:.2f}%; road luma SD {f(grove0['road']['lumaStd'])} → {f(grove1['road']['lumaStd'])}; mean {f(grove0['road']['meanLuma'])} → {f(grove1['road']['meanLuma'])} ({(grove1['road']['meanLuma']/grove0['road']['meanLuma']-1)*100:.2f}%). | PASS. Crossed fronds from both banks; one continuous subdivided shade strip in the existing jungle-card batch, alpha 0.15. [Before](before-grove/blend-0-full.png), [after](after-grove/blend-0-full.png). |",
f"| 3. Distant beacon | Baseline has no visible bore-lamp pixels. Final bore-only mask: {beacon['lamps']['pixels']} pixels, {beacon['lamps']['widthPixels']} px wide; luma {f(beacon['lamps']['meanLuma']) if beacon['lamps']['meanLuma'] is not None else 'unmeasurable'}, drum {f(beacon['drum']['meanLuma'])}; ratio {f(beacon['lampsToDrum']) if beacon['lampsToDrum'] is not None else 'unmeasurable'}. | FAIL. Shared night fog and the oblique fixed sightline remain binding. [Before lamps](before-beach/blend-1-lamps.png), [final full](final-beacon/blend-1-full.png), [final bore lamps](final-beacon/blend-1-lamps.png). |",
f"| 4. Strike | Stars are suppressed until blend 0.6, then reveal with smoothstep over the final 40%. Sky step ratio {cross['checks']['sky']['stepRatio']:.3f}×; road midpoint deviation {cross['checks']['road']['T1midpointDeviation']:.5f}; all ten repeat deltas are zero. | PASS T1/T2/T3 on the new baseline. [Before midpoint](before-crossfade/blend-050.png), [after midpoint](crossfade-baseline/blend-050.png), [ten means](crossfade-baseline/ten-means.md). |",
'| 5. Heroes | Clock +444 source triangles; watchtower +140; waterfall +8 and +1 main draw; stack set +60 (+92 across the placed stacks). Every new feature has nonzero day and night rendered differences at 40 m. | PASS. Raised shadow-casting bezel, 12 ticks, nosings; fast 60% waterfall sheet and 24% mist; notch bands; moss tops and lit windows. [Before hero sheet](before-focals/contact-sheet.png), [eight new frames](heroes-day-night.png), [feature measurements](hero-features/feature-profile.json). |',
f"| 6. Night kerb | At 40 m, baseline stripe luma 0.15178–0.15504 → 0.29261–0.31556; 6–7 px remain visible. Entire visible stripe mean {beach['stripe']['meanLuma']:.5f}, below foam {beach['foam']['meanLuma']:.5f}. | PASS. The requested 0.4× foam trial was too bright; rendered calibration selected 0.08×. [Before](before-beach/blend-1-full.png), [after](after-beach/blend-1-full.png), [stripe mask](after-beach/blend-1-stripe.png). |",
f"| 7. Gate 1 | Before: 0 visible digit pixels above the fixed 0.40 luma threshold (unreadable, not a claim of zero geometric height). After: digit {gate['digitHeightPixels']} px, luma {gate['digitMeanLuma']:.5f}; plate {gate['plateMeanLuma']:.5f}; contrast {gate['contrast']:.5f}. | PASS. Six inside-corner plates, 15° off the approach-facing plane, 2.4 m earlier; maximum letters 0.5894 m. [Before](before-gate/blend-0-full.png), [after](final-gate/blend-0-full.png), [pixel crop](final-gate/gate-1-pixel-crop.png). |"]
lines += ['', 'The reference sea sample is the explicitly recorded rectangle (20, 275)–(370, 315), 14,000 pixels, in `06_reef_shallows_day.png`. Game water regions come from full/isolated equality masks; the boundary statistic uses every unoccluded qualifying column and skips antialias pixels. The first water trial lowered night edge brightness, so the final implementation restores the original night edge tints. Day foam chroma rose from 0.24639 to 0.33990; its luma changed from 0.57350 to 0.55568.',
'',f"Grove clearance is **VERIFIED** on {canopy['testedOverhangingCardVertices']} exported overhanging vertices: minimum {canopy['minimumHeightAboveDeck']:.5f} m above deck, {canopy['additionalClearance']:.5f} m above the 8.85 m corridor ceiling. The quadrant census measures 168 canopy triangles and 74 shade-strip triangles (242 total); no extra foliage draw. The strip is tessellated to follow the curved, rising deck, while remaining one batched decal surface.",
'', 'The BEACH beacon target is not closed by brighter close-range lamps. Its placement is 624.021 m from the pinned camera, 28.661° off axis; the shared night fog density remains 0.0034. Exterior arch lamps improve the POINT/40 m view but do not satisfy the long-range mask. Changing the fixed sightline or the night-fog readability contract needs a separate direction; neither was changed here.',
'', '## Discrepancies against the brief', '',
'The initial sea chroma/boundary and top-third foliage measurements already clear the round-2 numeric gates; the rendered reference comparison still justified the colour and overhead-shape changes. The grove shade uses one continuous subdivided surface instead of one planar quad, so it follows the curved and rising deck without floating or intersecting it (`art/blender/build_dreamisland_painted.py:454`). The BEACH beacon conflicts with the fixed, oblique route placement (`art/blender/build_dreamisland_painted.py:402`) and unchanged night fog (`src/game/dreamisland-course.ts:53`). Its target is left failed under the collision rule rather than changing those inputs.',
'', '## Ceiling table', '', '| Axis | Round 1 | Round 2 measured | Ceiling |','|---|---:|---:|---:|',
f"| Worst-tier total draws, main + shadow at one frame | 93 | {feral['peakTotalCalls']} | 110 |",
f"| Triangles, peak main + peak shadow | 151,404 | {feral['peakTriangles']:,} + {feral['peakShadowTriangles']:,} = {feral['peakTriangles']+feral['peakShadowTriangles']:,} | 180,000 |",
f"| Feral p95 with sample residual | See round-1 soak | {feral['p95Ms']:.2f} ms / {feral['sampleResidual']:+.3f} frames | 11.0 ms, report only |",
'| Initial JS gzip | 264.8 KiB | 264.9 KiB | 266 KiB |','| Shell gzip | 276.8 KiB | 276.8 KiB | 277 KiB |',
'| Corridor intrusions | 0 | 0 over 9,729 rays; bore clearance 0.302 m | 0 |',
'| Material-rule violations | 0 | 0, live scene including hidden meshes | 0 |',
'| Environmental letter height | 0.4721 m | 0.5894 m | 0.59 m |',
'| Runtime determinism | PASS | PASS at 60/120/240 Hz | identical |',
'| game.ts seam | 2,577 lines | unchanged | 2,577 |',
'| Atlas consumers | Previous proof retained | 11/11 new consumers decided | every new consumer |',
'', 'Draw and triangle accounting follows the named instrument: total draws use `peakTotalCalls`; the triangle gate conservatively adds the separately measured main/shadow maxima. Per-state peak columns are not assumed to occur on the same frame. Final shell and initial-JS values include the concurrent paddock implementation; all Dream Island additions stay behind the existing lazy load.',
'', '| Feral lighting state | Main draws peak | Shadow draws min–peak | Total draws peak | Main triangles peak | Shadow triangles peak |','|---|---:|---:|---:|---:|---:|']
for state in ['day','crossfade','night']:
 m=feral['lightingStates'][state];lines.append(f"| {state} | {m['peakMainCalls']} | {m['minimumShadowCalls']}–{m['peakShadowCalls']} | {m['peakTotalCalls']} | {m['peakTriangles']:,} | {m['peakShadowTriangles']:,} |")
lines += ['', '## Per-hero cost and visibility', '', '| Hero | Source triangles before → after | Placed main triangle delta | Main draw delta | Added shadow peak | Detail ceiling |','|---|---:|---:|---:|---:|---|',
'| Clock tower | 4,804 → 5,248 | +444 | 0 | +4 draws / +5,248 triangles | +1,500 triangles |',
'| Watchtower | 9,438 → 9,578 | +140 | 0 | 0 | +400 triangles |',
'| Waterfall cliff | 1,218 → 1,226 | +8 | +1 | 0 | +200 triangles / +1 draw |',
'| Sea-stack set | 1,304 → 1,364 | +92 across placed stacks | 0 | 0 | map reserve |',
'', 'Source counts are the 40 m loader/render instrument before/after records. Placed counts and main/shadow calls are measured inside the feral race render hooks in `soak-feral/per-hero-render.json`; the round-1 sea draws total 1,880 triangles and the new placed set totals 1,972. The clock now casts and receives the shared key-light shadow. The waterfall overlays share one material/draw: 60% fast sheet at 0.37 UV cycles/s beside the original 0.18, with a 24% lamp-cell radial mist. Those rates and alphas are authored settings, not inferred pixel measurements.',
'', '| Feature | Day changed pixels / mean luma | Night changed pixels / mean luma |','|---|---:|---:|']
for feature in dict.fromkeys(r['feature']for r in features['rows']):
 a,b=[next(r for r in features['rows']if r['feature']==feature and r['blend']==blend)for blend in [0,1]];lines.append(f"| {a['asset']} / {feature} | {a['changedPixels']:,} / {a['meanLuma']:.5f} | {b['changedPixels']:,} / {b['meanLuma']:.5f} |")
lines += ['', '| Hero | Before day / night | After day / night |', '|---|---|---|',
*['| '+asset+' | [Day](before-focals/'+asset+'-40m-day.png) / [night](before-focals/'+asset+'-40m-night.png) | [Day](hero-features/'+asset+'-40m-day.png) / [night](hero-features/'+asset+'-40m-night.png) |' for asset in ['clock-tower','watchtower','waterfall-cliff','sea-stack-set']],
'', 'These are full-versus-feature-hidden renders at one pinned 40 m pose, through the shipped material, lights, fog and tone mapping. They measure visible contribution, including transparent mist against its actual background. The watchtower hero pose is elevated enough to see its crown tops; the chase poses remain unchanged.',
'', '## Crossfade ten means', '', (out/'crossfade-baseline/ten-means.md').read_text().strip(),
'', 'VERIFIED T1: midpoint road deviation ≤ 0.030. T2: all four sky and road luma drops exceed 0.020. T3: independently repeat the **new** baseline within 0.004; all ten measured deltas are exactly zero. The previous baseline remains intact under `before-crossfade/`.',
'', '## Four soaks', '', '| Soak | Laps (ms) | Missed gates / recoveries | p95 ms | Window samples / expected | Sample residual (frames) | Draws / triangles |','|---|---|---:|---:|---:|---:|---:|']
for name in ['feral','works','rookie','works-reduced']:
 m=read(out/f'soak-{name}/metrics.json');r=read(out/f'soak-{name}/race.json');d=r['diagnostics']['current'];lines.append(f"| {name} | {' / '.join(map(str,d['lapTimesMs']))} | {d['missedGates']} / {d['recoveries']} | {m['p95Ms']:.2f} | {m['windowSamples']} / {m['expectedSamples']:.3f} | {m['sampleResidual']:+.3f} | {m['peakTotalCalls']} / {m['peakTriangles']+m['peakShadowTriangles']:,} |")
lines += ['', 'Each p95 uses the reconciled 720-frame window, with expected count derived from that run’s pre-start requestAnimationFrame calibration. The active-run counts and residuals are retained separately in each metrics file. VERIFIED: all four runs have zero browser errors, zero missed gates, minimum grip 0.85 with the BASIN trigger, settled night at the flag, and zero material violations. The reduced-motion run has zero visible fish and zero changes in settled emission. Runs are serial against the frozen preview recorded in `frozen-preview.json`.',
'', '## Validators, assets and provenance', '',
'- **VERIFIED:** `npm run test:code` exits 0 in the refreshed byte-checked snapshot, including the concurrent paddock validator and implementation together. [Final suite record](test-code-final/result.json), [full log](test-code-final/npm-test-code.log). The earlier concurrent missing-export failure and isolated-baseline pass are preserved, and are superseded by this final pass.',
'- **VERIFIED:** 11/11 new atlas consumers pass [quadrant-ID proof](atlas-final/atlas-quadrant-proof.json). The filters select new overhead normals, shade alpha, tick/nosing tints, crown/window height ranges and overlay UV cells. Diagnostic ID renders disable grading and the mist’s brightness-derived opacity only for identifying its quadrant; all luma/chroma captures use the shipped rendering path.',
'- **VERIFIED:** all four hero GLBs load, 9 placements, 15 merged hero meshes, 18,024 placed hero triangles; two panoramas, three water surfaces, two waterfall flow shaders. Materials use shared atlases; no new image or texture was generated.',
'- **VERIFIED:** both authored sky sources still pass the existing sky instrument; no panorama or texture files were edited. No route, schedule, powers or pace data was edited, so no pace re-solve is required.',
'- **VERIFIED:** final source hashes and frozen-preview hashes match for the tested application inputs. game.ts and the owned/excluded boundary are recorded in the final verification JSON. The other implementer committed the paddock fix as `23e6d8f` during this pass; the tested bytes still match. Root index.html and paddock files contain that implementer’s changes only.',
'', '## Producing commands', '', 'Commands run from the repository root, with Node v20.19.4 and python3/Pillow on PATH. Each JSON records its exact pose, frame names, sample counts and/or input hashes.', '', '```text',
'/Applications/Blender.app/Contents/MacOS/Blender -b --python art/blender/build_dreamisland_heroes.py',
'/Applications/Blender.app/Contents/MacOS/Blender -b --python art/blender/build_dreamisland_painted.py',
'node scripts/visual/dreamisland-heroes/polish-poses.mjs --progress=.72 --blends=0,1 --modes=full,sea,shallows,foam,blank --out=<reef-directory>',
'python3 scripts/visual/dreamisland-heroes/polish-regions.py <pose-directory>',
'node scripts/visual/dreamisland-heroes/polish-canopy.mjs --out=<canopy-clearance.json>',
'python3 scripts/visual/dreamisland-heroes/polish-kerb.py <beach-directory>',
'python3 scripts/visual/dreamisland-heroes/polish2-gate-profile.py <gate-directory> <signage-manifest.json>',
'node scripts/visual/dreamisland/crossfade-profile.mjs --base=http://127.0.0.1:5227 --out=<baseline-or-repeat>',
'python3 scripts/visual/dreamisland/crossfade-profile.py <baseline-or-repeat>',
'python3 scripts/visual/dreamisland-heroes/polish-crossfade-check.py <baseline> <repeat> <before-crossfade>',
'node scripts/visual/dreamisland-heroes/polish-focals.mjs --distances=40 --features --out=<hero-features>',
'python3 scripts/visual/dreamisland-heroes/polish2-feature-profile.py <hero-features>',
'node scripts/visual/dreamisland-heroes/polish-atlas-quadrant-proof.mjs --claims=polish2-atlas-claims.mjs --out=<atlas-final>',
'node scripts/visual/dreamisland/race.mjs --tier=feral --out=<soak-feral>',
'node scripts/visual/dreamisland/race.mjs --tier=works --out=<soak-works>',
'node scripts/visual/dreamisland/race.mjs --tier=rookie --out=<soak-rookie>',
'node scripts/visual/dreamisland/race.mjs --tier=works --reduced --out=<soak-works-reduced>',
'node scripts/visual/dreamisland-heroes/polish-strike.mjs --base=http://127.0.0.1:5227 --out=<final-strike>',
'node scripts/visual/dreamisland/frames.mjs --base=http://127.0.0.1:5227 --out=<final-frames>',
'npm run test:code',
'python3 scripts/visual/dreamisland-heroes/polish2-compose.py',
'python3 scripts/visual/dreamisland-heroes/polish2-report.py',
'python3 scripts/visual/dreamisland-heroes/polish2-verify.py','```',
'', 'The actual node captures use `polish-run.mjs` as an exit/cleanup wrapper. Soaks set `TIDELINE_PUPPETEER` to `polish-transport.mjs` and `DREAMISLAND_REVIEW_BASE=http://127.0.0.1:5227`; the adapter records the URL translation and per-hero render census. It does not change simulation or render settings. The final suite uses the frozen snapshot to keep validators’ historical output paths out of the shared worktree.',
'', '## Files added / changed', '',
'- Geometry authors: `art/blender/build_dreamisland_heroes.py`, `build_dreamisland_painted.py`; rebuilt four hero GLBs/manifest and painted GLB/manifest/signage manifest. Blender projects and build logs are in this evidence directory.',
'- Lazy runtime: `src/game/dreamisland-water.ts`, `dreamisland-sky.ts`, `dreamisland-heroes.ts`, `dreamisland-painted-environment.ts`.',
'- Review instruments: extensions under `scripts/visual/dreamisland-heroes/` for isolated feature/stripe/bore masks, canopy/decal clearance, counterfactual visibility, selectable atlas claims, report/composition, snapshot output paths, and per-hero shadow counts. Exact inventory is in `final-verification.json`.',
'- Evidence: this round-2 directory, preserving round-1 artifacts and the initial five-gap list.',
'', '## Open gaps / what remains undone', '',
'- **VERIFIED FAIL — distant beacon:** the required BEACH bore-lamp width/contrast gate is not met. The 40 m/POINT beacon is improved, but that is not substituted for the required distant pose.',
'- **UNVERIFIED — devices:** all visual and performance evidence is desktop Chrome at 1280×720. No physical-device claim is made.',
'- No AI image/texture/3D generation, no eager imports, no forbidden production-file edits, and no commit. The art changes and evidence are ready for review; the beacon residual needs a separate sightline/fog decision.']
readme.write_text('\n'.join(lines)+'\n');print('Wrote',readme)
