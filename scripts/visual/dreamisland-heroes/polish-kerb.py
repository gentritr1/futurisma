"""Scan the projected top-face cross-section of the kerb nearest 40 m."""
import json,sys
from pathlib import Path
from PIL import Image
import numpy as np
atlas=json.loads(Path('public/assets/dreamisland/atlas-manifest.json').read_text())
cell=atlas['roles']['concrete']['kerb-cyan']
x0,y0,x1,y1=cell['pixels']
texture=np.asarray(Image.open('public/assets/dreamisland/textures/concrete.jpg').convert('RGB'),dtype=float)/255
row=texture[(y0+y1)//2,x0:x1];cyan=(row[:,1]-row[:,0]>.1)&(row[:,2]-row[:,0]>.1)
columns=np.where(cyan)[0];stripe=[(columns.min()+x0)/texture.shape[1],(columns.max()+x0+1)/texture.shape[1]]
u0,_,u1,_=cell['uv'];fractions=[(u-u0)/(u1-u0) for u in stripe]
out=Path(sys.argv[1]);capture=json.loads((out/'pose-capture.json').read_text());results=[]
for frame in capture['frames']:
 image=np.asarray(Image.open(out/frame['frames']['full']).convert('RGB'),dtype=float)/255
 probes=[]
 for probe in frame['kerbs']:
  outer_a,outer_b=np.asarray(probe['line']);a=outer_a+(outer_b-outer_a)*fractions[0];b=outer_a+(outer_b-outer_a)*fractions[1];length=np.linalg.norm(b-a);count=int(np.ceil(length))+1
  coordinates=np.linspace(a,b,count);pixels=image[np.rint(coordinates[:,1]).astype(int),np.rint(coordinates[:,0]).astype(int)]
  cyan=(pixels[:,1]-pixels[:,0]>.025)&(pixels[:,2]-pixels[:,0]>.025)
  longest=run=0
  for yes in cyan:run=run+1 if yes else 0;longest=max(longest,run)
  probes.append({**probe,'stripeProjectedWidthPixels':float(length),'scanPixels':count,'cyanWidthPixels':longest,'samplesRGB':pixels.tolist()})
 results.append({'blend':frame['blend'],'probes':probes})
report={'instrument':__file__,'atlasStripeURange':stripe,'method':'Cyan U interval measured from the kerb atlas centre row (green and blue each exceed red by .1). Project that interval on the live top face at exactly 40 m, then count visible cyan samples (green and blue above red by .025). No broad night tint outside that source interval is counted.','results':results}
(out/'kerb-profile.json').write_text(json.dumps(report,indent=2)+'\n');print([(r['blend'],[(p['distance'],p['cyanWidthPixels']) for p in r['probes']]) for r in results])
