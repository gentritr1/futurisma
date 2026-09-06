"""Reconcile stored render windows against the separately measured presentation rate."""
from pathlib import Path
import json,math
root=Path('art/evidence/ascension-v1/phase-b');rows=[]
for file in sorted(root.glob('*/metrics.json')):
 m=json.loads(file.read_text());rate=m['expectedRateHz'];windows=[]
 for name,count,ms,expected,residual in [('active',m['samples'],m['activeWindowMs'],m['activeExpectedSamples'],m['activeSampleResidual']),('p95',m['windowSamples'],m['windowMs'],m['expectedSamples'],m['sampleResidual'])]:
  calculated=ms/1000*rate
  assert math.isclose(calculated,expected,abs_tol=1e-6)
  assert math.isclose(count-calculated,residual,abs_tol=1e-6)
  windows.append({'name':name,'seconds':ms/1000,'expectedRateHz':rate,'expectedSamples':calculated,'observedSamples':count,'residual':residual})
 rows.append({'run':file.parent.name,'measurementScript':'scripts/visual/ascension/instrument.mjs','calibration':m['calibration'],'windows':windows})
report={'script':'scripts/visual/ascension/reconcile-phase-b.py','interpretation':'Render sampling uses measured pre-start requestAnimationFrame rate, not the 120 Hz physics rate. Differences are missed or extra presentation intervals relative to calibration; they are not dropped physics ticks. Host scheduling is not isolated. Draft runs are retained separately.','runs':rows}
(root/'sample-reconciliation.json').write_text(json.dumps(report,indent=2));print(json.dumps({'reconciledRuns':len(rows),'windows':sum(len(r['windows']) for r in rows)}))
