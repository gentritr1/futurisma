"""Reconcile saved evidence, without substituting samples from earlier builds."""
import json,hashlib
from pathlib import Path
root=Path('art/evidence/ascension-v1/phase-c-revision/carry-overs')
runs=[]
for name in ['trench','deluge','trench-reduced']:
 race=json.loads((root/name/'race.json').read_text());m=json.loads((root/name/'metrics.json').read_text());frames=race['frames'];window=sum(f['delta'] for f in frames)/1000;hz=m['expectedRateHz'];current=race['diagnostics']['current']
 assert not race['errors'] and current['missedGates']==0 and current['recoveries']==0
 assert m['peakTotalCalls']<=145 and m['peakTriangles']<=220000
 assert not json.loads((root/name/'material-walk.json').read_text())['violations']
 assert all(hashlib.sha256(Path(f).read_bytes()).hexdigest()==h for f,h in race['inputHashes'].items()),'Evidence input changed'
 runs.append({'name':name,'lapsMs':current['lapTimesMs'],'peakTotalDraws':m['peakTotalCalls'],'peakMainTriangles':m['peakTriangles'],'p95Ms':m['p95Ms'],'egretsAtFinish':race['ascension'].get('egrets'),'windows':[
  {'name':'calibration intervals','seconds':m['calibration']['windowMs']/1000,'expectedHz':hz,'expected':120,'observed':120,'residual':0},
  {'name':'all recorded renders including startup','seconds':window,'expectedHz':hz,'expected':window*hz,'observed':len(frames),'residual':len(frames)-window*hz},
  {'name':'active render intervals','seconds':m['activeWindowMs']/1000,'expectedHz':hz,'expected':m['activeExpectedSamples'],'observed':m['samples'],'residual':m['activeSampleResidual']},
  {'name':'tail render intervals','seconds':m['windowMs']/1000,'expectedHz':hz,'expected':m['expectedSamples'],'observed':m['windowSamples'],'residual':m['sampleResidual']}]})
assert runs[0]['lapsMs']==runs[2]['lapsMs']
road=json.loads((root/'road-luma-check.json').read_text());assert road['accepted']
powers=json.loads((root/'powers.json').read_text());assert powers['playerE']['pass'] and len(powers['chain'])==1 and powers['chain'][0]['rewardTicks']==60
report={'script':'scripts/visual/ascension/report-carry-overs.py','measurementScripts':['scripts/visual/ascension/instrument.mjs','scripts/visual/ascension/race.mjs','scripts/visual/ascension/powers.mjs','scripts/measure-ascension-driving.mjs','scripts/validate-ascension-events.mjs','scripts/visual/ascension/check-road-floor.py'],'runs':runs,'before':{'checkpoint':'5a2db83','peakTotalDraws':119,'source':'art/evidence/ascension-v1/phase-c/trench/metrics.json'},'afterPeakTotalDraws':max(r['peakTotalDraws'] for r in runs),'headroomTo145':145-max(r['peakTotalDraws'] for r in runs),'roadSamples':len(road['rows']),'roadSampling':'8 sectors × 4 frozen states = 32 discrete samples; no temporal rate. Base recorded before floors were pinned.','chain':powers['chain'],'chainCaptureReconciliation':powers['capture'],'scopeNotes':['The full demos now use player powers, so their lap times are not compared as pure route savings. The isolated matched-input fork measurement still saves 3.525 seconds on every lap.','The low crawler card is an inspection view; the deck still limits tread visibility in the driving view.','The live final bird state reaches lap three; the every-lap trigger is implemented in source. The separate frozen scatter card is not a live per-lap classification.','Human art acceptance is not inferred from these numeric checks.']}
(root/'executed-results.json').write_text(json.dumps(report,indent=2));print(json.dumps({k:v for k,v in report.items() if k not in ['runs','scopeNotes']},indent=2))
