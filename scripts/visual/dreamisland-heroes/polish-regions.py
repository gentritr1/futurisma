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
  pixels=full[mask];assert len(pixels)>0,name+' not visible'
  metrics[name]={'pixels':int(mask.sum()),'meanLuma':float((pixels@np.array([.2126,.7152,.0722])).mean()),'meanChroma':float((pixels.max(1)-pixels.min(1)).mean())}
  yy,xx=np.where(mask);metrics[name]['visibleBoundsPixels']=[int(xx.min()),int(yy.min()),int(xx.max()+1),int(yy.max()+1)]
  metrics[name]['widthPixels']=int(xx.max()-xx.min()+1);metrics[name]['heightPixels']=int(yy.max()-yy.min()+1)
  if name=='foliage':
   # The geometric horizon comes from the pinned camera, not the painted
   # panorama's extra horizon band. Older baseline captures predate this field.
   pose=item['pose'];direction=np.asarray(pose['target'])-np.asarray(pose['position'])
   horizon=pose.get('horizonRow',360+360/np.tan(np.radians(pose['fov']/2))*direction[1]/np.linalg.norm(direction[[0,2]]))
   columns=np.any(mask[:int(horizon)],axis=0)
   metrics[name].update(horizonRow=float(horizon),columnsAboveHorizon=int(columns.sum()),frameColumns=mask.shape[1],columnCoverage=float(columns.mean()))
 if 'mouth' in metrics:metrics['mouthToDrum']=metrics['mouth']['meanLuma']/metrics['drum']['meanLuma']
 results.append({'blend':item['blend'],'metrics':metrics})
report={'instrument':__file__,'capture':str(out/'pose-capture.json'),'method':'Full/isolated render equality at 2/255; isolated/blank difference above 6/255; display luma .2126/.7152/.0722','results':results}
(out/'region-profile.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))
