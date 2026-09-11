"""Measure the visible effect contribution against an otherwise identical frame."""
import json
import sys
from pathlib import Path
import numpy as np
from PIL import Image
folder=Path(sys.argv[1] if len(sys.argv)>1 else 'art/evidence/dreamisland-v1/polish-3/hardware/effects')
rows=[]
for kind in ['surge','shield']:
    a,b=[np.asarray(Image.open(folder/(kind+suffix+'.png')).convert('RGB')).astype(float)/255 for suffix in ['', '-off']]
    delta=np.maximum(0,a-b)
    mask=(delta.max(axis=2)>.025)&(delta.sum(axis=2)>.075)
    color=delta[mask].mean(axis=0)
    passed=bool(color[0]>color[1]>color[2]) if kind=='surge' else bool(color[1]>color[0] and color[2]>color[0])
    rows.append(dict(kind=kind,pixels=int(mask.sum()),meanPositiveSrgbContribution=color.tolist(),passed=passed))
assert all(row['pixels']>0 and row['passed'] for row in rows),rows
(folder/'pixels.json').write_text(json.dumps(dict(script='scripts/visual/dreamisland/effect-pixels.py',rows=rows),indent=2)+'\n')
print(json.dumps(rows))
