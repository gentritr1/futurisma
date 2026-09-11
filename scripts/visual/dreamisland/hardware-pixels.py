"""Measure visible object pixels against isolation/blank renders at a pinned pose."""
import json
import sys
from pathlib import Path
import numpy as np
from PIL import Image

folder=Path(sys.argv[1])
rows=[]
for capture in json.loads((folder/'capture.json').read_text())['captures']:
    region=capture.get('pixelRegion')
    if not region: continue
    full,isolated,blank=[np.asarray(Image.open(folder/region[key]).convert('RGB')).astype(float) for key in ['full','isolation','blank']]
    mask=(np.max(abs(full-isolated),axis=2)<=2)&(np.max(abs(isolated-blank),axis=2)>5)
    rgb=full[mask]/255
    if len(rgb)==0: raise RuntimeError('No visible pixels: '+capture['shot']['id'])
    linear=np.where(rgb<=.04045,rgb/12.92,((rgb+.055)/1.055)**2.4)
    rows.append(dict(id=capture['shot']['id'],pixels=len(rgb),rgb=rgb.mean(axis=0).tolist(),
        linear=linear.mean(axis=0).tolist(),luma=float((linear@[.2126,.7152,.0722]).mean())))
report=dict(script='scripts/visual/dreamisland/hardware-pixels.py',mask='full matches isolation within 2/255; isolation differs from blank by >5/255',rows=rows)
(folder/'pixels.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(rows,indent=2))
