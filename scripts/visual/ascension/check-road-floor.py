"""Compare painted schedule samples against the separately recorded and pinned base."""
from pathlib import Path
import json
root=Path('art/evidence/ascension-v1/phase-b')
base=json.loads((root/'road-luma-base.json').read_text())
floors={row['sector']:row['floor'] for row in json.loads((root/'road-luma-floor.json').read_text())['floors']}
rows=[]
for sample in base:
 phase,sector=sample['file'].removesuffix('.png').split('-',1)
 rows.append({'file':sample['file'],'phase':phase,'sector':sector,'luma':sample['lamp_luma_under'],'floor':floors[sector],'passes':sample['lamp_luma_under']>=floors[sector]})
report={'script':'scripts/visual/ascension/check-road-floor.py','measurementScript':'scripts/visual/frame-metrics.py','pinScript':'scripts/visual/ascension/pin-road-floor.py','sampling':'8 sectors × 4 static schedule states = 32 frames; no temporal rate. Effects are not implemented yet, so this is painted-base compliance, not final steam compliance.','accepted':all(r['passes'] for r in rows),'rows':rows}
(root/'road-luma-check.json').write_text(json.dumps(report,indent=2))
print(json.dumps({'samples':len(rows),'accepted':report['accepted']}))
if not report['accepted']:raise SystemExit(1)
