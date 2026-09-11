"""Compare matched visible lower-drum pixels; display RGB chroma = max-min."""
import json,sys
from pathlib import Path
import numpy as np
from PIL import Image
before,after=map(Path,sys.argv[1:3])
def load(folder,mode):
 return np.asarray(Image.open(folder/('watchtower-40m-day'+('-'+mode if mode else '')+'.png')).convert('RGB'),dtype=float)/255
luma=np.array([.2126,.7152,.0722])
old=load(before,'lower');new=load(after,'lower');stone=load(after,'stone')
mask=np.all(np.abs(load(before,'')-old)<=2/255,axis=2)&np.any(np.abs(old-load(before,'blank'))>6/255,axis=2)
mask&=np.all(np.abs(load(after,'')-new)<=2/255,axis=2)&np.any(np.abs(new-load(after,'blank'))>6/255,axis=2)
assert mask.sum()>1000,'No matched visible lower-drum region'
report={'instrument':__file__,'method':'Intersection of exact full/lower-only masks in both captures, RGB display chroma max(channel)-min(channel); same pixels for neutral stone, original moss, and polished stone tint. Neutral stone uses remapped wall-block UVs with vertex tint disabled.','pixels':int(mask.sum()),'before':str(before),'after':str(after),'measurements':{}}
for label,pixels in [('neutralStone',stone),('originalMoss',old),('polishedTint',new)]:
 p=pixels[mask];report['measurements'][label]={'meanChroma':float(np.mean(p.max(1)-p.min(1))),'meanLuma':float(np.mean(p@luma)),'lumaStd':float(np.std(p@luma))}
c=report['measurements'];report['chromaBetween']=min(c['neutralStone']['meanChroma'],c['originalMoss']['meanChroma'])<c['polishedTint']['meanChroma']<max(c['neutralStone']['meanChroma'],c['originalMoss']['meanChroma'])
(after/'tint-profile.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2));assert report['chromaBetween']
