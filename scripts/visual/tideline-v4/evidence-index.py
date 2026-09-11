"""Write a complete file/hash inventory for the saved V4 acceptance evidence."""
import hashlib,json,subprocess
from pathlib import Path
root=Path.cwd();evidence=Path('art/evidence/tideline-v4')
revision=subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip()
files=set(evidence.rglob('*'))
for folder in ['scripts/visual/tideline-v4','art/references/power-kit-v2','art/textures/tideline-v4']:
 files.update(Path(folder).rglob('*'))
changed=subprocess.check_output(['git','diff','--name-only','054d013','HEAD'],text=True).splitlines()
files.update(Path(path) for path in changed)
files.update([Path('README.md'),Path('docs/briefs/TIDELINE-V4-POLISH.md')])
excluded={evidence/'INDEX.md',evidence/'index.json'}
rows=[]
for path in sorted(files):
 if not path.is_file() or path in excluded or '__pycache__' in str(path):continue
 data=path.read_bytes()
 rows.append({'file':str(path),'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()})
manifest={'script':'scripts/visual/tideline-v4/evidence-index.py','implementationRevision':revision,'baseRevision':'054d013','selfExclusion':'INDEX.md and index.json are excluded to avoid recursive hashes. Git records their final contents.','files':rows}
(evidence/'index.json').write_text(json.dumps(manifest,indent=2)+'\n')
lines=['# V4 file inventory','',f'Implementation/evidence parent revision: `{revision}`. SHA-256 hashes describe the files, independently of browser availability.','',
       'Commands and interpretation are in [README.md](README.md). This table includes every saved frame, measurement, review, source script and delivered asset changed in the V4 packages. Intermediate failed rounds are retained and identified in the README. INDEX.md and index.json exclude themselves to avoid recursive hashes.','',
       '| File | Bytes | SHA-256 |','|---|---:|---|']
for row in rows:lines.append(f"| `{row['file']}` | {row['bytes']} | `{row['sha256']}` |")
(evidence/'INDEX.md').write_text('\n'.join(lines)+'\n')
print(f'Indexed {len(rows)} files with SHA-256; parent {revision}.')
