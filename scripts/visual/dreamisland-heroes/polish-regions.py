"""Rendered luma and silhouette occupancy on exact geometry-isolation masks."""
import json,sys
from pathlib import Path
import numpy as np
from PIL import Image
out=Path(sys.argv[1]);capture=json.loads((out/'pose-capture.json').read_text());results=[]
for item in capture['frames']:
 images={k:np.asarray(Image.open(out/v).convert('RGB'),dtype=float)/255 for k,v in item['frames'].items()}
 full,blank=images['full'],images['blank'];metrics={}
 for name,image in images.items():
  if name in ['full','blank','sky']:continue
  mask=(np.max(abs(full-image),2)<=2/255)&(np.max(abs(image-blank),2)>6/255)
  pixels=full[mask]
  if not len(pixels):
   metrics[name]={'pixels':0,'meanLuma':None,'meanChroma':None,'widthPixels':0,'heightPixels':0};continue
  metrics[name]={'pixels':int(mask.sum()),'meanLuma':float((pixels@np.array([.2126,.7152,.0722])).mean()),'lumaStd':float((pixels@np.array([.2126,.7152,.0722])).std()),'meanChroma':float((pixels.max(1)-pixels.min(1)).mean())}
  yy,xx=np.where(mask);metrics[name]['visibleBoundsPixels']=[int(xx.min()),int(yy.min()),int(xx.max()+1),int(yy.max()+1)]
  metrics[name]['widthPixels']=int(xx.max()-xx.min()+1);metrics[name]['heightPixels']=int(yy.max()-yy.min()+1)
  if name=='foliage':
   # The geometric horizon comes from the pinned camera, not the painted
   # panorama's extra horizon band. Older baseline captures predate this field.
   pose=item['pose'];direction=np.asarray(pose['target'])-np.asarray(pose['position'])
   horizon=pose.get('horizonRow',360+360/np.tan(np.radians(pose['fov']/2))*direction[1]/np.linalg.norm(direction[[0,2]]))
   columns=np.any(mask[:int(horizon)],axis=0)
   metrics[name].update(horizonRow=float(horizon),columnsAboveHorizon=int(columns.sum()),frameColumns=mask.shape[1],columnCoverage=float(columns.mean()))
   metrics[name]['topThirdColumnCoverage']=float(np.any(mask[:mask.shape[0]//3],axis=0).mean())
 if 'mouth' in metrics:metrics['mouthToDrum']=metrics['mouth']['meanLuma']/metrics['drum']['meanLuma'] if metrics['mouth']['pixels'] and metrics['drum']['pixels'] else None
 if 'lamps' in metrics:metrics['lampsToDrum']=metrics['lamps']['meanLuma']/metrics['drum']['meanLuma'] if metrics['lamps']['pixels'] and metrics['drum']['pixels'] else None
 if 'sea' in images and 'shallows' in images and 'foam' in images:
  y=full@np.array([.2126,.7152,.0722]);masks={}
  for name in ['sea','shallows','foam']:
   masks[name]=(np.max(abs(full-images[name]),2)<=2/255)&(np.max(abs(images[name]-blank),2)>6/255)
  edges=[]
  for x in range(full.shape[1]):
   # Adjacent unoccluded deep/edge pixels, at most 12 rows apart. Count every
   # column with the boundary; skip a two-pixel antialias margin on both sides.
   deep=np.where(masks['sea'][:,x])[0]
   if not len(deep):continue
   edge=np.where((masks['foam']|masks['shallows'])[:,x])[0]
   if not len(edge):continue
   near=edge[edge>deep.max()]
   if not len(near):continue
   a,b=int(deep.max()-2),int(near.min()+2)
   if b-a<=12 and a>=0 and b<full.shape[0] and masks['sea'][a,x] and (masks['foam']|masks['shallows'])[b,x]:edges.append({'x':x,'deepRow':a,'edgeRow':b,'width':b-a,'step':float(y[b,x]-y[a,x])})
  metrics['boundary']={'columns':len(edges),'medianLumaStep':float(np.median([e['step'] for e in edges])) if edges else None,'maximumWidthPixels':max([e['width'] for e in edges],default=None),'samples':edges}
  ref=Path('art/references/dreamisland/heroes/06_reef_shallows_day.png');im=np.asarray(Image.open(ref).convert('RGB'),float)/255
  # Named before tuning: unobstructed deep water below the reference horizon,
  # left of the pier, above its cyan boundary. No sky or shallows in this ROI.
  ref_pixels=im[275:315,20:370].reshape(-1,3)
  chroma=float((ref_pixels.max(1)-ref_pixels.min(1)).mean())
  metrics['referenceSea']={'frame':str(ref),'rectangleXYXY':[20,275,370,315],'pixels':len(ref_pixels),'meanChroma':chroma,'meanLuma':float((ref_pixels@np.array([.2126,.7152,.0722])).mean()),'gameToReferenceChroma':metrics['sea']['meanChroma']/chroma}
 results.append({'blend':item['blend'],'metrics':metrics})
report={'instrument':__file__,'capture':str(out/'pose-capture.json'),'method':'Full/isolated render equality at 2/255; isolated/blank difference above 6/255; display luma .2126/.7152/.0722','results':results}
(out/'region-profile.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))
