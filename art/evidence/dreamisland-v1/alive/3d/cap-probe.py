"""Diagnostic upper-bound render; restore the isolated shader even on failure."""
from pathlib import Path
import subprocess,json,hashlib
import numpy as np
from PIL import Image
root=Path.cwd();base=root/'art/evidence/dreamisland-v1/alive/3d';out=base/'review-8/cap-probe';out.mkdir(exist_ok=True)
source=root/'src/game/dreamisland-reflections.ts';target=Path('/tmp/dreamisland-f3d-eafe0b9/src/game/dreamisland-reflections.ts')
original=source.read_bytes();probe=original.decode().replace('min(1.,pow(max(dot(diNormal,diHalf),0.),64.)*4.)','1.');assert probe!=original.decode()
try:
 target.write_text(probe);(out/'dreamisland-reflections.ts').write_text(probe)
 subprocess.run(['node',str(base/'capture.mjs'),'--base=http://127.0.0.1:5204','--source-root=/tmp/dreamisland-f3d-eafe0b9','--progress=.575','--blends=0','--out='+str(out/'court')],check=True)
finally:target.write_bytes(original)
subprocess.run(['python3',str(base/'measure-review.py'),'review-8/cap-probe','--available'],check=True)
p=out/'court';im=np.array(Image.open(p/'blend-000.png').convert('RGB'));mask=np.array(Image.open(p/'blend-000-sea-mask.png')).astype(bool);luma=im[mask]@np.array([.2126,.7152,.0722])
record=dict(diagnostic='Glint = 1 on every water fragment; unchanged AgX 1.04, fog, camera, atlas and corrected tint. Diagnostic only.',finalSourceSha256=hashlib.sha256(original).hexdigest(),probeSourceSha256=hashlib.sha256(probe.encode()).hexdigest(),whiteThreshold=239,seaMaximumLuma=float(luma.max()),seaWhitePct=float((luma>239).mean()*100),p99=float(np.percentile(luma,99)))
(out/'bound.json').write_text(json.dumps(record,indent=2));print(record)
