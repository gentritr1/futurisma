"""Separate visible stack silhouettes above the geometric horizon, then compare
those exact pixels with the unobstructed sky and match them to live placements.
"""
import json,sys
from pathlib import Path
import numpy as np
from PIL import Image,ImageFilter
out=Path(sys.argv[1]);capture=json.loads((out/'pose-capture.json').read_text());results=[]
for item in capture['frames']:
 a={k:np.asarray(Image.open(out/v).convert('RGB'),dtype=float)/255 for k,v in item['frames'].items()}
 mask=(np.max(abs(a['full']-a['stacks']),2)<=2/255)&(np.max(abs(a['stacks']-a['blank']),2)>6/255)
 mask[int(item['pose']['horizonRow']):]=False
 joined=np.asarray(Image.fromarray((mask*255).astype('uint8')).filter(ImageFilter.MaxFilter(3)))>0
 labels=np.zeros(mask.shape,dtype=int);h,w=mask.shape;components=[];label=0
 for y,x in zip(*np.where(joined)):
  if labels[y,x]:continue
  label+=1;queue=[(y,x)];labels[y,x]=label;points=[]
  while queue:
   cy,cx=queue.pop()
   if mask[cy,cx]:points.append((cy,cx))
   for yy,xx in [(cy-1,cx),(cy+1,cx),(cy,cx-1),(cy,cx+1)]:
    if 0<=yy<h and 0<=xx<w and joined[yy,xx] and not labels[yy,xx]:labels[yy,xx]=label;queue.append((yy,xx))
  if len(points)<9:continue
  pixels=np.asarray(points);yy,xx=pixels[:,0],pixels[:,1]
  center=np.array([xx.mean(),yy.mean()]);visible=[p for p in item['stackPlacements'] if p['inFront']]
  nearest=min(visible,key=lambda p:np.linalg.norm(center-np.asarray(p['screen'])))
  foreground=a['full'][yy,xx]@np.array([.2126,.7152,.0722]);background=a['sky'][yy,xx]@np.array([.2126,.7152,.0722])
  components.append({'pixels':len(points),'bounds':[int(xx.min()),int(yy.min()),int(xx.max()+1),int(yy.max()+1)],'meanLuma':float(foreground.mean()),'skyMeanLuma':float(background.mean()),'silhouetteContrast':float((background-foreground).mean()),'placement':nearest})
 results.append({'blend':item['blend'],'components':components,'qualifyingPlacements':sorted(set(p['placement']['index'] for p in components if p['silhouetteContrast']>=.15 and p['placement']['distance']<=250))})
report={'instrument':__file__,'method':'Exact stack/full and stack/blank masks above the camera horizon; 3x3 dilation joins course gaps for connected-component labeling only. All luma uses original undilated pixels. Background is the sky-only frame at identical pixels. Components are associated with the nearest projected live placement centre.','results':results}
(out/'stack-profile.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))
