from pathlib import Path
import hashlib,json,subprocess
root=Path('art/evidence/ascension-v1/phase-e');files=[]
for p in sorted(root.rglob('*')):
 if p.is_file() and p.name!='file-manifest.json':files.append({'file':str(p.relative_to(root)),'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()})
sources=[]
for pattern in ['scripts/visual/ascension/*.mjs','scripts/visual/ascension/*.py','scripts/visual/ascension/*.ts','src/game/ascension*','public/assets/ascension/horizon.png']:
 for p in sorted(Path('.').glob(pattern)):
  if p.is_file():sources.append({'file':str(p),'sha256':hashlib.sha256(p.read_bytes()).hexdigest()})
assert not any('answer-key' in r['file'] for r in files)
(root/'file-manifest.json').write_text(json.dumps({'script':'scripts/visual/ascension/e-manifest.py','baseCommit':subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip(),'scope':'Hashes of final evidence and current capture sources; answer keys remain outside the checkout. The superseded solid-mask trial is retained as a labelled failed test, not accepted evidence.','files':files,'sources':sources},indent=2));print(f'{len(files)} evidence files hashed; no answer-key file included')
