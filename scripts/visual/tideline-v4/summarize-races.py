"""Reconcile captured renderer samples; never add independent peaks together."""
import json
from pathlib import Path
root=Path('art/evidence/tideline-v4')
rows=[]
for name in ['baseline','final-race','reduced-race']:
 capture=json.loads((root/name/'capture.json').read_text())
 metrics=json.loads((root/name/'metrics.json').read_text())
 result=capture['diagnostics']['current']
 frames=[f for f in capture['frames'] if 500<f['raceMs']<sum(result['lapTimesMs'])]
 material_file=root/name/'material-walk.json'
 materials=json.loads(material_file.read_text()) if material_file.exists() else {'materials':[], 'accepted':None}
 row={'run':name, 'metrics':metrics, 'totalDrawPeak':max(f['mainCalls']+f['shadowCalls'] for f in frames),
      'totalTrianglePeak':max(f['mainTriangles']+f['shadowTriangles'] for f in frames),
      'sampleDifference':metrics['windowSamples']-metrics['expectedSamples'],
      'lapTimesMs':result['lapTimesMs'],'classification':result['finalClassification'],
      'materialBindings':len(materials['materials']) if material_file.exists() else None,'materialWalkAccepted':materials['accepted'],
      'rivalPowerEventCount':len(result.get('rivalPowerEvents',[])),
      'chainCount':len(capture['tide'].get('chains',[])),
      'warningCount':len(capture['tide'].get('bulkheadWarnings',[])),
      'minimumWarningLeadSeconds':min((w['secondsAhead'] for w in capture['tide'].get('bulkheadWarnings',[])),default=None)}
 rows.append(row)
assert all(r['lapTimesMs']==rows[0]['lapTimesMs'] and r['classification']==rows[0]['classification'] for r in rows)
for r in rows[1:]:
 assert r['totalDrawPeak']<=145
 assert r['totalTrianglePeak']<=220000
 assert r['materialWalkAccepted'] and not r['metrics']['errors']
 assert r['metrics']['internalSizes']==['1280x720']
report={'script':'scripts/visual/tideline-v4/summarize-races.py','sourceScript':'scripts/visual/tideline-v4/race.mjs','drawCeiling':145,'triangleCeiling':220000,'runs':rows}
(root/'race-summary.json').write_text(json.dumps(report,indent=2)+'\n')
for row in rows:
 print(row['run'],row['totalDrawPeak'],row['totalTrianglePeak'],row['metrics']['p95Ms'],row['sampleDifference'],row['materialBindings'])
