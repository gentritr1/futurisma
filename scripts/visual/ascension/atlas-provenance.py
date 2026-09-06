from pathlib import Path
import json,hashlib
root=Path('public/assets/ascension/textures');generated={'concrete':'atlas-concrete-gptimage2.png','metal':'atlas-metal-gptimage2.png','jungle':'atlas-jungle-card-gptimage2.png','signage':'atlas-signage-devices-gptimage2.png'}
rows=[]
for role in ['concrete','metal','jungle','water','signage','emissive']:
 file=root/(role+'.jpg');source=Path('art/references/ascension')/generated[role] if role in generated else Path('public/assets/tideline-foundry/textures')/(role+'.jpg')
 rows.append({'role':role,'file':str(file),'source':str(source),'sha256':hashlib.sha256(file.read_bytes()).hexdigest(),'sourceSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'conversion':'sips JPEG conversion' if role in generated else 'unchanged shared painted atlas'})
Path('art/evidence/ascension-v1/phase-b/atlas-provenance.json').write_text(json.dumps({'script':'scripts/visual/ascension/atlas-provenance.py','atlases':rows},indent=2))
