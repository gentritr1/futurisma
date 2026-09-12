"""Build the §9 handoff from retained measurements and explicit gates."""
import json
from pathlib import Path
root=Path.cwd();e=root/'art/evidence/dreamisland-v1/alive/3d';out=e/'review-9'
def read(name):return json.loads((out/name).read_text())
proof=read('proof.json');rows=read('step-4/review-measurements.json');baseline=read('step-0/review-measurements.json')
failed=[r['pose']+' '+r['blend']+': '+k for r in proof['gates'] for k,v in r['checks'].items() if not v]
lines=['# §9 water revision — uncommitted','',
'**'+('PASS: all isolated §9 water checks.' if not failed else 'REQUEST CHANGES remains open: '+', '.join(failed))+ '** Timing caveat: Feral first measured 12.2 ms p95, then 9.3 ms on an unchanged-source repeat; both are retained. The combined-build COURT night range is not claimed here. Accepted §5.2–§5.6 work is unchanged. No git commit was made.','',
'## Changes','',
'- The single sparkle-direction uniform is normalized `(0.055479, 0.996917, -0.055479)`: the shadow sun’s +X/−Z azimuth and an art-directed 85.5° elevation. It is shared by both poses. The facet-facing lobe uses exponent 20,000, smoothstep 0.12–0.5 and gain 64; a view-elevation gate fades it between 0.08 and 0.22. This is a painterly normal-facing sparkle, not a physical sun half-vector. Removing its dim fringe preserves the sea cell’s chroma. The accepted four-wave normal field remains bounded below 8°; no lattice texture or extra geometry is introduced.',
'- Reflection stays tinted by the atlas cell and normalized cell hue, with Schlick F0 0.02. Grazing weight is 0.20 and normal-incidence weight 0.004, within the 0.35/0.08 caps. The small increase from 0.14 leaves chroma room for white facets.',
'- The 64/96 distance boost and its shader hook are removed. Shallows/foam emission is 1.2/1.5 × nightBlend at every distance. Shallows use cyan `0x48f4ec`; the atlas, fog and tone mapping remain active. The sea retains its dark night tint.',
'- Accepted smooth-normal road streak, exponent 8 and kerb exclusion are unchanged. The accepted depth band is replayed as step 3. No accepted recipes, GLBs, glow or AO code was revised.',
'', '## Measurement method','',
'Brief `216bafe` on `work/dream-island-alive`; isolated `eafe0b9` renderer plus F-3D resources, without concurrent §4 integration. Stage 0 retains the accepted AO and original water recipe. Stage 1 adds reflection; 2 adds glints; 3 replays the accepted depth band; 4 adds the dark night/cyan emission recipe and wet road. Both poses and both states are captured and measured before advancing. Stage snapshots and served-file hashes are retained.',
'',
'1280×720, Works, seed 3868938316, COURT .575 and REEF .75, fixed shipped chase camera. The unchanged `measure.py` invokes `scripts/visual/grade/measure-frames.py`. Its world band is x30–97%, y18–62%. Sea and shallows use exact visible isolation pixels within that band; road uses x40–75%, y48–85%. The all-water maximum additionally checks the union of visible sea, shallows and foam over the entire frame, including near water outside the grade band. White means BT.709 luma >239. Blob area uses eight-neighbour connectivity. The accepted zero-padded FFT script reports the largest normalized secondary local peak, excluding the central peak. Empty masks score zero but cannot pass the daytime white-coverage floor.',
'',
f'The painting is resized with Lanczos to 1280×720 and sampled using the same COURT road mask: p99 **{proof["paintingRoadP99"]:.2f}**. This is a screen-coordinate comparison. No REEF painting was supplied. §2 used a different moving/HUD framing; its rows below remain a reference, while exact per-pose step-0 deltas control acceptance.',
'', '## Ordered table','',
'“AC” means the normalized secondary autocorrelation peak. World columns are the grade instrument’s HUD-excluded band.',
'', '| Step | Pose/state | Mean | Std | Chroma | p99 | Range | Sea chroma | Sea p50 | Sea white % | Blob px | Sea AC | Road p50 | Road p99 / painting | Road white % | Road AC |',
'|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|']
for stage in range(5):
 for row in read(f'step-{stage}/review-measurements.json'):
  sea,road=row['sea'],row['road'];state='day' if row['blend']=='000' else 'night'
  target=f'{proof["paintingRoadP99"]:.2f}' if row['pose']=='court' and state=='night' else '—'
  values=[str(stage),row['pose']+' '+state,*[f'{row[k]:.2f}' for k in ['lumaMean','lumaStd','chromaMean','p99','range']],f'{sea["chroma"]:.3f}',f'{sea["p50"]:.2f}',f'{sea["whitePct"]:.3f}',str(sea['maxWhiteBlob']),f'{sea["autocorrelationPeak"]:.3f}',f'{road["p50"]:.2f}',f'{road["p99"]:.2f} / {target}',f'{road["whitePct"]:.3f}',f'{road["autocorrelationPeak"]:.3f}']
  lines.append('| '+' | '.join(values)+' |')
lines+=['','The intermediate REEF step-2 world chroma is 17.56 (0.01 below its floor) before the accepted depth band is restored. Steps 3 and 4 recover to 17.87; final acceptance uses step 4. Sea chroma and sparkle gates pass at both poses from step 2 onward.','','## Night water and sources','','| Step | Pose | Shallows chroma | Step-0 floor | All-water max luma | All-water white % |','|---|---|---:|---:|---:|---:|']
for stage in range(5):
 for row in read(f'step-{stage}/review-measurements.json'):
  if row['blend']!='100':continue
  b=next(r for r in baseline if r['pose']==row['pose'] and r['blend']=='100')
  lines.append(f'| {stage} | {row["pose"]} | {row["shallows"]["chroma"]:.3f} | {b["shallows"]["chroma"]:.3f} | {row["allWater"]["maxLuma"]:.2f} | {row["allWater"]["whitePct"]:.3f} |')
lines+=['','| Pose | Night p99 with emission | Range | p99 without water emission | Range without |','|---|---:|---:|---:|---:|']
for row in proof['emission']:
 a,b=row['withEmission'],row['withoutWaterEmission'];lines.append(f'| {row["pose"]} | {a["p99"]:.1f} | {a["range"]:.1f} | {b["p99"]:.1f} | {b["range"]:.1f} |')
court=next(r for r in rows if r['pose']=='court' and r['blend']=='100')
lines+=['',f'**Isolated COURT night p99: {court["p99"]:.1f}.** This is a reported number, not a gate. The combined build owns the p99 ≥150 / range ≥140 acceptance and must earn it from its bollards, capsule and foam. Those §4 placements are absent here. The counterfactual suppresses only foam/shallows emission, retaining diffuse water, geometry, sky, camera and road.','', '## Final gate results','']
for row in proof['gates']:
 misses=[k for k,v in row['checks'].items() if not v]
 lines.append(f'- {row["pose"]} {"day" if row["blend"]=="000" else "night"}: '+('PASS.' if not misses else '**UNMET: '+', '.join(misses)+'**.'))
lines+=['','Per-pose day world-chroma floors: COURT 21.79, REEF 17.57. Sea chroma and median use each pose’s own step 0. Sea white coverage must be 0.15–1.0%, largest blob ≤60 px and AC ≤0.30. Night requires all-water maximum ≤239 and shallows chroma ≥its own step 0. Road keeps p50≥30.9, p99≤the painting, no white and AC≤0.30.','',
f'Sky comparisons changed {sum(r["changedPixels"] for r in proof["sky"])} pixels. Rails maximum channel delta: {max(r["maxChannelDelta"] for r in proof["rails"])}; pixels above the §9 two-level tolerance: {sum(r["pixelsAboveTwo"] for r in proof["rails"])}. See `proof.json` for each pose/state.',
'', '## Reference deltas','','| COURT state/source | Mean | Std | Chroma | p99 | Range | Black % | White % |','|---|---:|---:|---:|---:|---:|---:|---:|']
refs={'000':[[132.9,52.7,19,207.3,190,.35,0],[117.2,47.3,22.1,219.2,192,.41,.35]],'100':[[30.4,18.1,10.7,79.1,75.6,23.3,0],[31,34.9,8.9,193.5,191.5,38.9,.06]]}
for blend in ['000','100']:
 row=next(r for r in rows if r['pose']=='court' and r['blend']==blend)
 for label,values in [('§2 shipped',refs[blend][0]),('revised',[row[k] for k in ['lumaMean','lumaStd','chromaMean','p99','range','blackPct','whitePct']]),('painting',refs[blend][1])]:
  lines.append('| '+('day' if blend=='000' else 'night')+' '+label+' | '+' | '.join(f'{v:.2f}' for v in values)+' |')
 delta=[row[k]-v for k,v in zip(['lumaMean','lumaStd','chromaMean','p99','range','blackPct','whitePct'],refs[blend][0])]
 lines.append('| '+('day' if blend=='000' else 'night')+' revised − §2 | '+' | '.join(f'{v:+.2f}' for v in delta)+' |')
lines+=['','## Frames and crops','','Sea crops are the same 400×200 source rectangle at (0,260), enlarged 2× with nearest-neighbour sampling. They include adjacent sky/shore because neither chase pose contains a contiguous 400×200 sea-only rectangle. These visual crops are distinct from the metric masks.','',
'![COURT before, 2×](step-0/court/blend-000-sea-2x.png)','',
'![COURT revised, 2×](step-4/court/blend-000-sea-2x.png)','',
'![REEF revised, 2×](step-4/reef/blend-000-sea-2x.png)','',
'![COURT night](step-4/court/blend-100.png)','',
'![REEF night](step-4/reef/blend-100.png)','',
'![Water palette comparison](water-palettes.png)','', '## Performance and validation','']
soak=read('soak-proof.json')
for r in soak['soaks']:lines.append(f'- {r["name"]}: {r["draws"]} draws; {r["triangles"]} main+shadow triangles; p95 {r["p95Ms"]:.2f} ms; sampleResidual {r["sampleResidual"]:+.3f}.')
first=out/'soak-feral-first/metrics.json'
if first.exists():
 m=json.loads(first.read_text());lines.append(f'\nThe first Feral run exceeded the ceiling: {m["p95Ms"]:.2f} ms p95, residual {m["sampleResidual"]:+.3f}. It is preserved in `soak-feral-first/`. The Feral row above is one unchanged-source repeat after the remaining tier run. A passing repeat does not erase the first result; the cause of the timing variation was not established on this shared host.')
lines+=['',f'Matched Works shader delta: **{soak["worksDeltaMs"]:+.2f} ms**. The control retains accepted resources, geometry and final emission; only water/road reflection and glints are disabled. Runs are sequential with no overlapping F-3D captures or builds. Other activity on the shared host is uncontrolled. `soak-proof.json` records source hashes, errors, material walk, gates and recoveries.', '']
build=read('build-size.json');prior=json.loads((e/'build-size.json').read_text())
lines.append(f'Build/type, build ceilings, runtime determinism and painted/corridor validation: '+('PASS.' if all(r['exitCode']==0 for r in read('validation.json')) else 'FAIL; see validation.json.'))
lines+=[f'Shell gzip {build["shellGzip"]:,} B ({build["shellGzip"]/1024:.2f} KiB), ceiling 277.5 KiB. Island lazy JS {build["islandGzip"]:,} B, retained isolated allowance {prior["islandCeiling"]:,} B (prior {prior["islandGzip"]:,} B +10%). Combined F-CODE JS/CSS and gameplay validation remain outside this isolated run.','', 'PMREM CPU submission (not GPU timing), two 128-face captures once per load:','']
for pose in ['court','reef']:
 for c in read(f'step-4/{pose}/crossfade-capture.json')['captures']:
  lines.append(f'- {pose}, blend {c["blend"]}: {c["applied"]["reflections"]["pmremCpuMs"]:.2f} ms.')
lines+=['',f'Accepted recipe/glow tail unchanged: {proof["acceptedRecipesAndGlowUnchanged"]}. Accepted asset hashes are retained in `accepted-inputs.json`; their earlier contracts, atlas proofs, AO topology and 8m/40m views remain in the parent evidence.','', '## Commands','', 'Run from the project root; the isolated server uses port 5204. `prepare-review.py` reconstructs the isolated eafe0b9 renderer, and the server command runs in that directory.','', '```sh','python3 art/evidence/dreamisland-v1/alive/3d/prepare-review.py','node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5204','python3 art/evidence/dreamisland-v1/alive/3d/ordered-review-9.py 0 4','python3 art/evidence/dreamisland-v1/alive/3d/review-9-proof.py','python3 art/evidence/dreamisland-v1/alive/3d/review-9-validate.py','python3 art/evidence/dreamisland-v1/alive/3d/review-9-soaks.py','python3 art/evidence/dreamisland-v1/alive/3d/review-9-soak-proof.py','python3 art/evidence/dreamisland-v1/alive/3d/palette.py review-9/step-4 review-9','python3 art/evidence/dreamisland-v1/alive/3d/review-9-report.py','```','', 'The unchanged-source Feral repeat ran from `/tmp/dreamisland-f3d-eafe0b9`: `node /Users/gentlegen/Desktop/futurisma-race/polarity_work/art/evidence/dreamisland-v1/alive/3d/race.mjs --base=http://127.0.0.1:5204 --tier=feral --out=/Users/gentlegen/Desktop/futurisma-race/polarity_work/art/evidence/dreamisland-v1/alive/3d/review-9/soak-feral`, after preserving the first folder as `soak-feral-first/` and its proof as `soak-proof-first.json`. `review-9-soak-proof.py` and this report generator were then rerun.\n\n`ordered-review-9.py` expands the exact `capture-9.mjs`, unchanged `measure.py` and `measure-9.py` commands for each stage. `trial-1/` through `trial-3/` preserve rejected glint trials and source snapshots. The accepted autocorrelation script remains beside `measure.py`, uncommitted as requested.','', '## Numbers first measured in this revision','', 'White sparkle coverage at both poses under the single art-directed direction; separate per-pose shallows chroma floors and deltas; maximum luma over all visible water; the revised emission-disabled night result; the §9 rail tolerance proof; refreshed ordered rows and shader timings.']
(out/'README.md').write_text('\n'.join(lines)+'\n')
