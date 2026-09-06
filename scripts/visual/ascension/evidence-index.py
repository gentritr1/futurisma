"""Hash every retained Phase B evidence file; this index excludes only itself."""
from pathlib import Path
import json,hashlib
root=Path('art/evidence/ascension-v1/phase-b')
files=[]
for p in sorted(root.rglob('*')):
 if p.is_file() and p.name!='evidence-index.json':files.append({'file':str(p.relative_to(root)),'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()})
(root/'evidence-index.json').write_text(json.dumps({'script':'scripts/visual/ascension/evidence-index.py','files':files},indent=2))
print(json.dumps({'files':len(files)}))
