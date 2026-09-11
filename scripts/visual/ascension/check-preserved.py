"""Check the explicitly retained art and approved route/schedule against the pre-repair commit."""
from pathlib import Path
import subprocess,json,hashlib
files=['public/assets/ascension/textures/concrete.jpg','public/assets/ascension/trench-wall-module.glb','public/assets/ascension/horizon.png','src/game/ascension-sky.ts','src/game/data/ascension/route.json','src/game/data/ascension/schedule.json']
rows=[]
for file in files:
 old=subprocess.check_output(['git','show','d72e820:'+file]);current=Path(file).read_bytes()
 rows.append({'file':file,'unchangedFromD72e820':old==current,'sha256':hashlib.sha256(current).hexdigest()})
assert all(row['unchangedFromD72e820'] for row in rows)
Path('art/evidence/ascension-v1/phase-b-revision/preserved-inputs.json').write_text(json.dumps({'script':'scripts/visual/ascension/check-preserved.py','files':rows},indent=2))
