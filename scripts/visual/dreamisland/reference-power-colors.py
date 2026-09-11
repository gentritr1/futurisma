"""Sample named core/bronze regions in the supplied orthographic reference."""
import json
from pathlib import Path
import numpy as np
from PIL import Image
root=Path(__file__).resolve().parents[3]
source=root/'art/references/dreamisland/phase-e/power-kit-ortho-gptimage2.png'
im=np.asarray(Image.open(source).convert('RGB'))/255
samples={}
for name,box in [('surge',[110,215,178,300]),('shield',[629,231,688,330]),('bronze',[587,180,618,265]),('moss',[542,388,778,456])]:
    x0,y0,x1,y1=box;pixels=im[y0:y1,x0:x1].reshape(-1,3)
    if name=='surge': pixels=pixels[(pixels[:,0]>pixels[:,1]*1.3)&(pixels[:,0]>pixels[:,2]*2.5)]
    if name=='shield': pixels=pixels[pixels[:,1]>pixels[:,0]*1.2]
    if name=='moss': pixels=pixels[(pixels[:,1]>pixels[:,0]*1.04)&(pixels[:,1]>pixels[:,2]*1.5)]
    mean=pixels.mean(axis=0)
    linear=np.where(mean<=.04045,mean/12.92,((mean+.055)/1.055)**2.4)
    samples[name]=dict(box=box,pixels=len(pixels),rgb=mean.tolist(),linear=linear.tolist(),chroma=(linear/linear.max()).tolist())
(root/'art/evidence/dreamisland-v1/polish-3/hardware/reference-colors.json').write_text(json.dumps(samples,indent=2)+'\n')
