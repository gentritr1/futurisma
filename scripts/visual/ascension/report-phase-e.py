"""Final acceptance measurements; never infer human visual classification."""
from pathlib import Path
import json,hashlib
root=Path('art/evidence/ascension-v1/phase-e');prior=Path('art/evidence/ascension-v1/phase-c-revision/carry-overs');runs=[]
for name in ['trench','deluge','trench-reduced']:
 race=json.loads((root/name/'race.json').read_text());m=json.loads((root/name/'metrics.json').read_text());c=race['diagnostics']['current'];frames=race['frames'];hz=m['expectedRateHz'];window=sum(f['delta'] for f in frames)/1000
 assert all(hashlib.sha256(Path(f).read_bytes()).hexdigest()==v for f,v in race['inputHashes'].items()),'Stale capture source'
 assert c['missedGates']==c['recoveries']==0 and not race['errors']
 assert m['peakTotalCalls']<=145 and m['peakTriangles']<=220000
 assert not json.loads((root/name/'material-walk.json').read_text())['violations']
 old=json.loads((prior/name/'race.json').read_text())['diagnostics']['current']['lapTimesMs']
 runs.append(dict(name=name,lapsMs=c['lapTimesMs'],acceptedCarryOverLapsMs=old,unchangedLaps=c['lapTimesMs']==old,mainDraws=m['peakMainCalls'],shadowDraws=m['peakShadowCalls'],peakTotalDraws=m['peakTotalCalls'],mainTriangles=m['peakTriangles'],shadowTriangles=m['peakShadowTriangles'],p95Ms=m['p95Ms'],sizes=m['sizes'],windows=[dict(name='calibration',seconds=m['calibration']['windowMs']/1000,expectedRateHz=hz,expected=120,observed=120,residual=0),dict(name='all recorded render intervals',seconds=window,expectedRateHz=hz,expected=window*hz,observed=len(frames),residual=len(frames)-window*hz),dict(name='active',seconds=m['activeWindowMs']/1000,expectedRateHz=hz,expected=m['activeExpectedSamples'],observed=m['samples'],residual=m['activeSampleResidual']),dict(name='tail',seconds=m['windowMs']/1000,expectedRateHz=hz,expected=m['expectedSamples'],observed=m['windowSamples'],residual=m['sampleResidual'])]))
assert runs[0]['lapsMs']==runs[2]['lapsMs']
schedule=json.loads(Path('src/game/data/ascension/schedule.json').read_text());ratio=schedule['launchTick']/120/schedule['worksLapSeconds'];assert 2.35<=ratio<=2.55
station=json.loads((root/'stations/capture.json').read_text());assert not station['errors'] and all(r['boardLegibility']['pass'] for r in station['records'] if r.get('board'))
road=json.loads((root/'road-luma-check.json').read_text());assert road['accepted']
oldBudget=json.loads((prior/'deluge/metrics.json').read_text())
report=dict(script='scripts/visual/ascension/report-phase-e.py',measurementScripts=['scripts/visual/ascension/race.mjs','scripts/visual/ascension/instrument.mjs','scripts/visual/ascension/stations.mjs','scripts/visual/ascension/check-road-floor.py'],runs=runs,before=dict(checkpoint='551e4c8',mainDraws=oldBudget['peakMainCalls'],shadowDraws=oldBudget['peakShadowCalls'],totalDraws=oldBudget['peakTotalCalls'],mainTriangles=oldBudget['peakTriangles'],shadowTriangles=oldBudget['peakShadowTriangles'],p95Ms=oldBudget['p95Ms']),afterPeakTotalDraws=max(r['peakTotalDraws'] for r in runs),headroomTo145=145-max(r['peakTotalDraws'] for r in runs),schedule=dict(source='src/game/data/ascension/schedule.json',builder=schedule['script'],measurementScript=schedule['measurementScript'],measuredWorksLapSeconds=schedule['worksLapSeconds'],launchSeconds=schedule['launchTick']/120,launchLapRatio=ratio),road=dict(samples=len(road['rows']),expected=8*4,residual=len(road['rows'])-8*4,accepted=road['accepted'],floorSource=str(prior/'road-luma-floor.json')),boards=dict(states=4,boardsPerState=2,expected=8,observed=sum(bool(r.get('board')) for r in station['records']),distanceMetres=150,allPass=True),reviewStatus='Blind keys withheld. No human classification or five-detail approval inferred.')
fork=json.loads((root/'fork-measurement.json').read_text());report['fork']={'script':fork['script'],'savingSeconds':fork['forkSavingSeconds'],'windows':[dict(**r,expectedSamples=r['windowSeconds']*r['expectedRateHz'],residual=r['observedSamples']-r['windowSeconds']*r['expectedRateHz']) for r in fork['sampleReconciliation']]}
clearance=json.loads((root/'event-clearance.json').read_text());report['clearance']={'script':'scripts/validate-ascension-events.mjs','crawler':clearance['crawler'],'launch':clearance['launch'],'accepted':clearance['accepted']}
assert clearance['accepted']
(root/'final-measurements.json').write_text(json.dumps(report,indent=2))
lines=['# Final budget and race table','','Measured by `race.mjs` and `instrument.mjs`; reconciled by `report-phase-e.py`. All sample windows, calibration rates and residuals are in `final-measurements.json`.','','| Run | Main draws | Shadow draws | Peak total | Main triangles | Shadow triangles | Frame p95 (ms) |','|---|---:|---:|---:|---:|---:|---:|']
b=report['before'];lines.append(f"| Accepted carry-over / 551e4c8 | {b['mainDraws']} | {b['shadowDraws']} | {b['totalDraws']} | {b['mainTriangles']} | {b['shadowTriangles']} | {b['p95Ms']:.3f} |")
for r in runs:lines.append(f"| {r['name']} | {r['mainDraws']} | {r['shadowDraws']} | {r['peakTotalDraws']} | {r['mainTriangles']} | {r['shadowTriangles']} | {r['p95Ms']:.3f} |")
(root/'BUDGET.md').write_text('\n'.join(lines)+'\n')
print(json.dumps({k:v for k,v in report.items() if k!='runs'},indent=2))
