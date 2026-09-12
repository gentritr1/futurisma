"""Rebuild the isolated eafe0b9 + F-3D review tree without changing this checkout."""
from pathlib import Path
import subprocess,shutil,hashlib,json
root=Path.cwd();target=Path('/tmp/dreamisland-f3d-eafe0b9');target.mkdir(exist_ok=True)
archive=subprocess.Popen(['git','archive','eafe0b9'],stdout=subprocess.PIPE)
subprocess.run(['tar','-x','--exclude=art/evidence','-C',str(target)],stdin=archive.stdout,check=True)
archive.stdout.close();assert archive.wait()==0
if not (target/'node_modules').exists():(target/'node_modules').symlink_to(root/'node_modules',target_is_directory=True)
if not (target/'.git').exists():(target/'.git').symlink_to(root/'.git',target_is_directory=True)
files=['src/game/dreamisland-water.ts','src/game/dreamisland-materials.ts','src/game/dreamisland-reflections.ts','public/assets/dreamisland/painted.glb','public/assets/dreamisland/props.glb','public/assets/dreamisland/capsule.glb']
for f in files:shutil.copy2(root/f,target/f)
record={'base':'eafe0b9','directory':str(target),'files':{f:hashlib.sha256((root/f).read_bytes()).hexdigest() for f in files}}
(root/'art/evidence/dreamisland-v1/alive/3d/mirror-inputs.json').write_text(json.dumps(record,indent=2));print(target)
