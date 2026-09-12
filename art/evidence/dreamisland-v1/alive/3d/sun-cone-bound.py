"""Bound the specular response using camera rays and the allowed normal cone."""
import numpy as np,json
from pathlib import Path
from PIL import Image
base=Path('art/evidence/dreamisland-v1/alive/3d');out={}
for pose in ['court','reef']:
 c=json.loads((base/'step-0'/pose/'crossfade-capture.json').read_text())['captures'][0]['pinned'];x,y,z,w=c['quaternion']
 rotation=np.array([[1-2*(y*y+z*z),2*(x*y-z*w),2*(x*z+y*w)],[2*(x*y+z*w),1-2*(x*x+z*z),2*(y*z-x*w)],[2*(x*z-y*w),2*(y*z+x*w),1-2*(x*x+y*y)]])
 mask=np.array(Image.open(base/'step-0'/pose/'blend-000-sea-mask.png')).astype(bool);ys,xs=np.nonzero(mask)
 scale=np.tan(np.deg2rad(62)/2)
 rays=np.stack([((xs+.5)/1280*2-1)*1280/720*scale,(1-(ys+.5)/720*2)*scale,np.full(len(xs),-1)],axis=1)@rotation.T
 rays/=np.linalg.norm(rays,axis=1)[:,None]
 sun=np.array([.55,.62,-.55]);sun/=np.linalg.norm(sun)
 half=sun-rays;half/=np.linalg.norm(half,axis=1)[:,None]
 closest=np.rad2deg(np.arccos(np.clip(half[:,1],-1,1))).min()
 response=4*np.cos(np.deg2rad(max(0,closest-8)))**64
 out[pose]=dict(closestRequiredNormalTiltDegrees=float(closest),allowedTiltDegrees=8,upperBoundBlinnBeforeClamp=float(response),method='Pinned camera rays at every visible sea-mask pixel centre; normalized DAY_LIGHTING direction (.55,.62,-.55). An 8-degree cone about up bounds every shader normal.')
(base/'review-8/sun-cone-bound.json').write_text(json.dumps(out,indent=2));print(out)
