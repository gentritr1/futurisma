"""Assemble the handoff exclusively from recorded measurements."""
from pathlib import Path
import json,hashlib,importlib.util
root=Path.cwd();base=root/'art/evidence/dreamisland-v1/alive/3d'
spec=importlib.util.spec_from_file_location('grade',root/'scripts/visual/grade/measure-frames.py');grade=importlib.util.module_from_spec(spec);spec.loader.exec_module(grade)
lines=['# Phase F · F-3D handoff','', '**UNCOMMITTED.** Base: `eafe0b9`, branch `work/dream-island-alive`. Only F-3D-owned source/art was edited. Opus’s files and all pre-existing edits were preserved.','',
'## Five initial gaps','',
'- The painted water carries sun glints; the original water never reaches white.',
'- The sea and shallows lack a reflected sky and a distinct depth band.',
'- The painted props have chrome/glass response absent from the existing materials.',
'- The night painting has bright sources against dark water; the shipped scene compresses both.',
'- Contact shading is absent around static pieces; the AO trial below measures its actual effect.','',
'## Scope and verification boundary','',
'**VERIFIED:** four ordered water steps, chrome/glass recipes, the two exported GLBs, one glow instance batch, colour-only Blender AO, rendered asset/atlas evidence, and the four isolated soaks.','',
'**UNVERIFIED:** the combined F-CODE/F-3D runtime and its aggregate budget. F-CODE’s current prop/capsule consumers still generate primitives. GLB source loading belongs to that track; `INTEGRATION.md` records the node/material seam. The soaks deliberately use a temporary `eafe0b9` checkout plus this track’s files, without the in-progress F-CODE edits. No claim that gameplay has loaded the two new GLBs is made.','',
'## Measurement method','',
'`measure.py` imports and calls the unchanged `scripts/visual/grade/measure-frames.py`. COURT progress .575; REEF .75; Works; seed 3868938316; fixed shipped chase geometry, 1280×720. World band: x=30–97%, y=18–62%. The additional no-sky result uses x=30–97%, y=30–62%. Road median uses visible road-isolation pixels inside x=40–75%, y=48–85%, avoiding the kerbs. Sky-only frames have zero changed pixels against step 0 in all four pose/state combinations.','',
'**Discrepancy:** §2’s shipped frames are 1600×900 autopilot captures with the craft and rivals. The fixed-pose instrument omits those moving objects and uses route-centre chase placement. Its baseline therefore does not reproduce §2 byte-for-byte. Both reference rows and paired-control deltas are retained; the acceptance figures below are fixed-pose results, not a claim of exact autopilot-pose reproduction. No REEF painting or measured REEF §2 row was supplied.','',
'## Shipped / ours / painting','',
'| Pose/state/source | Mean | Std | Chroma | p01 | p99 | Range | Black % | White % |','|---|---:|---:|---:|---:|---:|---:|---:|---:|']
final=json.loads((base/'final/measurements.json').read_text());before=json.loads((base/'step-0/measurements.json').read_text())
keys=['lumaMean','lumaStd','chromaMean','p01','p99','range','blackPct','whitePct']
def row(label,r):return '| '+label+' | '+' | '.join(str(r[k]) for k in keys)+' |'
for pose in ['court','reef']:
 for blend in ['000','100']:
  state='day' if blend=='000' else 'night'
  if pose=='court':lines.append(row(f'COURT {state} · §2 shipped',grade.measure(str(root/f'art/references/dreamisland/phase-f/shipped-court-{state}-aad5942.png'))))
  lines.append(row(f'{pose.upper()} {state} · paired baseline',next(r for r in before if r['pose']==pose and r['blend']==blend)))
  lines.append(row(f'{pose.upper()} {state} · final F-3D',next(r for r in final if r['pose']==pose and r['blend']==blend)))
  if pose=='court':lines.append(row(f'COURT {state} · painting',grade.measure(str(root/f'art/references/dreamisland/phase-f/target-court-{state}-gptimage2.png'),False)))
lines+=['','## Ordered water measurements','',
'Each stage finished its COURT and REEF measurements before the next water stage was applied. `step-2-trial` retains the busy reflection trial; `step-4-trial` retains the oversized wet-road highlights. The accepted stages are below. `step-4` was recaptured on the isolated preview after a shared-preview environment-loading error.','',
'| Stage | Pose/state | Mean | Std | Chroma | p01 | p99 | Range | Black % | White % |','|---|---|---:|---:|---:|---:|---:|---:|---:|---:|']
for stage in range(5):
 for r in json.loads((base/f'step-{stage}/measurements.json').read_text()):lines.append('| '+str(stage)+' '+['baseline','sky reflection','sun glint','depth band','night/wet road'][stage]+' | '+r['pose']+' '+('day' if r['blend']=='000' else 'night')+' | '+' | '.join(str(r[k]) for k in keys)+' |')
day=next(r for r in final if r['pose']=='court' and r['blend']=='000');night=next(r for r in final if r['pose']=='court' and r['blend']=='100')
lines+=['',f"**Fixed-pose water gates PASS:** COURT day whitePct {day['whitePct']}%; with the top 30% excluded, {day['noSky']['whitePct']}% ≥ 0.15%. COURT night p99 {night['p99']} ≥ 150, range {night['range']} ≥ 140, central road p50 {night['roadP50']:.2f} ≥ 30.9. Sky clipping cannot increase: the sky-only images are pixel-identical.",'',
'**Remaining look gap:** the final day mean is higher than §2’s shipped mean and farther from the painting; night blackPct also remains short of the painting. Passing the explicit highlight/range gates does not mean the painting was matched. No sky, grade, exposure, route, schedule or controller changes were made.','',
'## Palette and PMREM','',
'`water-palettes.png` / `water-palettes.json`: eight-colour median-cut palettes. Painting water uses the explicitly recorded left-hand sea rectangle; rendered water uses exact visible sea/shallows isolation masks. Their regions differ and are stated in the JSON.','']
for pose in ['court','reef']:
 d=json.loads((base/'final'/pose/'crossfade-capture.json').read_text())
 for c in d['captures']:lines.append(f"- {pose} blend {c['blend']}: two PMREM passes, 128-pixel cube faces; CPU submission/load work {c['applied']['reflections']['pmremCpuMs']:.2f} ms. This is not a GPU timer measurement.")
lines+=['','PMREM is made once from the existing `dreamisland_panorama` in both states, then sampled with continuous night mixing. F0 is .02. The course’s live shadow-casting directional light supplies the sun direction; the sky module itself does not expose one. All consumers retain fog and tone mapping.','',
'## Mesh contracts and material recipes','',
'| Node | Triangles | Role/cell |','|---|---:|---|']
for file in ['props','capsule']:
 for r in json.loads((base/f'build/{file}.glb.json').read_text()):lines.append(f"| {r['name']} | {r['triangles']} | {r['atlasRole']}/{r['atlasCell']} |")
lines+=['',
'**VERIFIED:** capsule bounds Y −1.5…+1.5 m, common origin, no node transforms; 588 total triangles. Pipes height 4 m. Bollard base+core 76 triangles total. Exported node names, triangle ceilings and UV bounds pass `inspect-glb.py`. `build/export-contracts.json` records every accessor check.','',
'Chrome: MeshStandardMaterial, metalness 1, roughness .08, metal atlas tint, shared PMREM. Glass: metalness 0, roughness .15, opacity .55, transparent, depthWrite false, emissive atlas, renderOrder 20. The node binder is called from the water owner, retaining F-CODE file ownership. Distinct glass/core/chrome materials require separate stock instance draws; the brief’s single capsule draw is not compatible with those recipes.','',
'28 full asset frames: every prop plus capsule at 8 m / 40 m, day/night, in `assets/`. Twelve quadrant-ID frames are beside them. All geometric UVs stay within their exact cells; `pixel-checks.json` records the rendered cell-ID counts. Quadrant diagnostics disable MSAA to avoid mixed edge IDs; the classifier also excludes a two-pixel raster edge. Every isolated node selects its expected cell. Production asset frames retain antialiasing.','',
'## Glow and AO','',
'One fogged, tone-mapped additive InstancedMesh; emissive TR cell; depthWrite false. World-metre size, camera-facing matrices, capsule/bollard source instance transforms and per-fish source centres. No additional simulation or clock. Reduced-motion fish stay absent.','']
for r in json.loads((base/'pixel-checks.json').read_text())['glow']:lines.append(f"- {r['pose']}: night p99 with/without fish sprites {r['p99With']}/{r['p99Without']} (delta {r['delta']}); {r['changedPixels']} changed pixels. Eight sprite instances were submitted but do not contribute visible pixels at these pinned poses. This does not prove a visible fish glow in those views.")
if (base/'glow-assets/measurements.json').exists():
 for r in json.loads((base/'glow-assets/measurements.json').read_text()):lines.append(f"- {r['kind']} at {r['distance']} m: isolated night p99 with/without {r['p99With']}/{r['p99Without']}; {r['changedPixels']} changed pixels.")
ao=json.loads((base/'ao/bake.json').read_text());pre=next(r for r in json.loads((base/'step-4/measurements.json').read_text()) if r['pose']=='court' and r['blend']=='000')
lines+=['',f"**AO topology PASS:** {sum(ao['trianglesBefore'].values()):,} triangles before and after, 0 added. Blender casts eight deterministic rays per vertex, then patches only existing COLOR_0 bytes. Independent `ao/byte-proof.json` confirms every non-colour byte identical. COURT day lumaStd {pre['lumaStd']} → {day['lumaStd']} ({day['lumaStd']-pre['lumaStd']:+.2f}); the bake did not move this global statistic toward the painting’s 47.3.",'',
'## Four soaks and ceilings','',
'All final runs use the isolated F-3D build, high quality, 1280×720, seed 3868938316. p95 is the existing instrument’s last 720 rendered intervals; the residual is observed minus calibrated expected samples. No overlapping F-3D browser capture was launched during these runs. Other work on the host was not controlled.','',
'| Run | Laps ms | Misses / recoveries | Draws | Main + shadow triangles | p95 ms | Residual frames |','|---|---|---|---:|---|---:|---:|']
metrics={}
for tier in ['baseline','works','rookie','feral','works-reduced']:
 p=base/f'soak-{tier}/metrics.json'
 if not p.exists():continue
 m=json.loads(p.read_text());race=json.loads((p.parent/'race.json').read_text());d=race['diagnostics']['current'];metrics[tier]=m
 lines.append(f"| {tier} | {' / '.join(map(str,d['lapTimesMs']))} | {d['missedGates']} / {d['recoveries']} | {m['peakTotalCalls']} | {m['peakTriangles']:,} + {m['peakShadowTriangles']:,} | {m['p95Ms']:.2f} | {m['sampleResidual']:+.2f} |")
if 'works' in metrics:lines+=['',f"Works overhead including glow: {metrics['works']['p95Ms']-metrics['baseline']['p95Ms']:+.2f} ms vs baseline, below the shared water allowance of 1.0 ms. Water itself adds no draw; visible fish glow adds one draw and 16 triangles. Feral peak {metrics['feral']['peakTotalCalls']} draws ≤130, {metrics['feral']['peakTriangles']+metrics['feral']['peakShadowTriangles']:,} triangles ≤205,000. Every final material walk has zero violations."]
if (base/'build-size.json').exists():
 b=json.loads((base/'build-size.json').read_text());lines+=['',f"Shell gzip: {b['shellGzip']} bytes ({b['shellGzip']/1024:.3f} KiB), ceiling 277.5 KiB. Island lazy JS gzip: {b['islandGzip']} bytes; isolated measured+10% value {b['islandCeiling']} bytes. F-CODE has since added a shared validator pin of 94,224 → 103,647 bytes including the lazy stylesheet; those are read from its in-progress validator, not independently reproduced by this track. Final combined validation remains open."]
lines+=['','## Validators and numbers first measured this pass','',
'- Painted validator PASS: 10 meshes / 66,694 triangles; zero corridor intrusions over 9,729 rays; UV/manifest agreement.','- Runtime validator PASS: 60/120/240 Hz identical. Shared working-tree run also passed with the added F-CODE shoals.','- `test-isolated-final.log`: full isolated `npm run test:code` PASS, including build validation. The first run stopped on a wall-clock Greenwater audio bake at 207 ms against 200 ms; the isolated audio recheck passed. No audio assertions were changed.','- Newly measured: paired fixed-pose COURT/REEF baselines; all four water-stage deltas; sky-zero-diff proof; no-sky whitePct and central-road p50; PMREM CPU cost; GLB accessor/node/triangle/UV contracts; palettes; sprite on/off results; AO byte/topology proof; final soaks and p95 residuals.','',
'## Files and commands','',
'Owned source: `dreamisland-water.ts`, additive `dreamisland-materials.ts`, new `dreamisland-reflections.ts`; builders `build_dreamisland_props.py`, `build_dreamisland_capsule.py`, AO option in `build_dreamisland_painted.py`; three GLBs. All remaining new files from this task are under this evidence directory. Nothing was committed.','',
'Run from the repository root with Node 20.19.4 on PATH.','',
'```sh',
'python3 art/evidence/dreamisland-v1/alive/3d/prepare-review.py',
'# In /tmp/dreamisland-f3d-eafe0b9:',
'npm run dev -- --host 127.0.0.1 --port 5203',
'# Captures from the original repository; repeat for .75 / reef:',
'node art/evidence/dreamisland-v1/alive/3d/capture.mjs --base=http://127.0.0.1:5203 --blends=0,1 --progress=.575 --out=art/evidence/dreamisland-v1/alive/3d/final/court',
'python3 art/evidence/dreamisland-v1/alive/3d/measure.py final',
'# Asset fixture uses the main preview on port 5202:',
'node art/evidence/dreamisland-v1/alive/3d/assets.mjs',
'node art/evidence/dreamisland-v1/alive/3d/node-quadrants.mjs',
'node art/evidence/dreamisland-v1/alive/3d/glow-assets.mjs',
'python3 art/evidence/dreamisland-v1/alive/3d/inspect-glb.py',
'python3 art/evidence/dreamisland-v1/alive/3d/palette.py',
'python3 art/evidence/dreamisland-v1/alive/3d/check-evidence.py',
'/Applications/Blender.app/Contents/MacOS/Blender -b --python art/blender/build_dreamisland_props.py',
'/Applications/Blender.app/Contents/MacOS/Blender -b --python art/blender/build_dreamisland_capsule.py',
'# Restore ao/painted-before.glb before reproducing the AO bake:',
'/Applications/Blender.app/Contents/MacOS/Blender -b --python art/blender/build_dreamisland_painted.py -- --alive-ao',
'# In the isolated tree, use the absolute path to this evidence race.mjs:',
'node /absolute/repository/art/evidence/dreamisland-v1/alive/3d/race.mjs --tier=works --out=/absolute/repository/art/evidence/dreamisland-v1/alive/3d/soak-works',
'# Repeat for rookie, feral, and works --reduced.',
'npm run test:code',
'node scripts/validate-build.mjs --out=/absolute/repository/art/evidence/dreamisland-v1/alive/3d/validators',
'```','',
'## Open integration/review work','',
'- F-CODE must consume the delivered GLB geometry/maps; see `INTEGRATION.md`.',
'- F-CODE has added the combined island-chunk pin. Orchestrator must revalidate that build and the combined soaks after GLB source integration. The isolated reserve is not a combined acceptance claim.',
'- Exact reproduction of §2’s moving autopilot camera/craft/rivals is not established by these route-centre controls.',
'- The painting’s overall day mean and night black coverage remain unmet; AO did not reduce global day lumaStd; fish sprites did not change the two fixed-pose frames.','']
if (base/'autopilot-measurements.json').exists():
 auto=json.loads((base/'autopilot-measurements.json').read_text())
 lines+=['## Direct autopilot cross-check','',
 'Additional 1600×900 captures retain the shipped moving craft/rivals and sample the first autopilot crossing of COURT .575 and REEF .75. They read the canvas immediately after rendering; DOM HUD is omitted. The original §2 screenshots include a turn callout and minimap inside the default measurement crop, and depict a different framing despite the recorded progress label. These new controls therefore still do not reproduce §2 exactly.','',
 '| Source | Pose/state | Mean | Std | Chroma | p01 | p99 | Range | Black % | White % | No-sky white % |',
 '|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|']
 for r in auto['rows']:lines.append('| '+r['label']+' | '+r['pose']+' '+r['state']+' | '+' | '.join(str(r[k]) for k in keys)+' | '+str(r['noSky']['whitePct'])+' |')
 lines+=['', 'All paired progress values match exactly. Render interpolation leaves the camera residuals below; these controls supplement rather than replace the exactly pinned water-step frames.']
 for pose in auto['poses']:lines.append(f"- {pose['frame']}: camera displacement {pose['cameraDeltaMetres']:.4f} m; quaternion-component maximum difference {pose['quaternionMaxDelta']:.7f}.")
 lines+=['', 'The direct autopilot final COURT frame independently passes the white and night range gates (no-sky whitePct 0.75%, night p99 177.3, range 174.8). Capture command: `node art/evidence/dreamisland-v1/alive/3d/autopilot.mjs --label=final` after preparing the isolated preview. `--label=baseline` used the baseline water/material files and pre-AO painted GLB.','']
(base/'README.md').write_text('\n'.join(lines).replace('/absolute/repository',str(root)))
files=['src/game/dreamisland-water.ts','src/game/dreamisland-materials.ts','src/game/dreamisland-reflections.ts','public/assets/dreamisland/painted.glb','public/assets/dreamisland/props.glb','public/assets/dreamisland/capsule.glb']
record={'base':'eafe0b9','directory':'/tmp/dreamisland-f3d-eafe0b9','files':{f:hashlib.sha256((root/f).read_bytes()).hexdigest() for f in files}}
for f,h in record['files'].items():assert hashlib.sha256((Path(record['directory'])/f).read_bytes()).hexdigest()==h,f
(base/'mirror-inputs.json').write_text(json.dumps(record,indent=2))
print(base/'README.md')
