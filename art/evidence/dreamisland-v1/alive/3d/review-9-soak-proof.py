"""Summarize ceilings and source hashes from the completed isolated soaks."""
from pathlib import Path
import json,hashlib
root=Path.cwd();out=root/'art/evidence/dreamisland-v1/alive/3d/review-9';rows=[]
expected={p:hashlib.sha256((root/p).read_bytes()).hexdigest() for p in ['src/game/dreamisland-water.ts','src/game/dreamisland-reflections.ts']}
for name in ['baseline','works','rookie','feral','works-reduced']:
 p=out/('soak-'+name);m=json.loads((p/'metrics.json').read_text());r=json.loads((p/'race.json').read_text());walk=json.loads((p/'material-walk.json').read_text());current=r['diagnostics']['current']
 row=dict(name=name,draws=m['peakTotalCalls'],triangles=m['peakTriangles']+m['peakShadowTriangles'],p95Ms=m['p95Ms'],sampleResidual=m['sampleResidual'],errors=r['errors'],materialViolations=len(walk['violations']),missedGates=current['missedGates'],recoveries=current['recoveries'],lapTimesMs=current['lapTimesMs'],finalSourceMatches=name=='baseline' or all(r['inputHashes'][p]==h for p,h in expected.items()))
 row['ceilingsPass']=row['draws']<=130 and row['triangles']<=205000 and row['p95Ms']<=11
 rows.append(row)
summary=dict(soaks=rows,worksDeltaMs=rows[1]['p95Ms']-rows[0]['p95Ms'],shaderBudgetPass=rows[1]['p95Ms']-rows[0]['p95Ms']<=1)
first=out/'soak-feral-first/metrics.json'
if first.exists():
 m=json.loads(first.read_text())
 summary['retainedFirstFeral']=dict(p95Ms=m['p95Ms'],sampleResidual=m['sampleResidual'],frameTimePass=m['p95Ms']<=11,path='soak-feral-first/metrics.json')
 summary['allObservedFrameTimesPass']=all(r['p95Ms']<=11 for r in rows) and m['p95Ms']<=11
(out/'soak-proof.json').write_text(json.dumps(summary,indent=2));print(json.dumps(summary,indent=2))
assert all(r['ceilingsPass'] and r['finalSourceMatches'] and not r['errors'] and not r['materialViolations'] and r['missedGates']==0 and r['recoveries']==0 for r in rows)
assert summary['shaderBudgetPass']
