"""Decide, on pixels, which atlas quadrant each Dream Island consumer drew.

    python3 scripts/visual/dreamisland/atlas-proof.py <atlas-proof dir>

`atlas-proof.mjs` leaves one isolation frame and one background frame per claim.
This masks the isolation frame against its background, takes the mean NORMALISED
CHROMATICITY of what the consumer drew - r/(r+g+b), g/(r+g+b), so lighting, fog
and tone mapping move luma without moving the answer - and compares it against
all four quadrants of that role decoded straight out of the served texture.

PASS = the nearest quadrant is the one the claim named. A claim that is nearest
to a quadrant it did not name is the teal-road defect, caught on pixels.
"""
import json,sys
from pathlib import Path
import numpy as np
from PIL import Image

root=Path(__file__).resolve().parents[3]
directory=Path(sys.argv[1] if len(sys.argv)>1 else root/'art/evidence/dreamisland-v1/phase-b/atlas-proof')
proof=json.loads((directory/'atlas-proof.json').read_text())
atlas=json.loads((root/'public/assets/dreamisland/atlas-manifest.json').read_text())
MASK_DELTA=40
MINIMUM_PIXELS=400

def chromaticity(pixels):
 total=pixels.sum(axis=1,keepdims=True);total[total==0]=1
 return (pixels/total)[:,:2].mean(axis=0)

BINS=14
def histogram(pixels):
 """Normalised 2-D chromaticity histogram. A mean alone cannot tell a bimodal
 white-and-turquoise caustic from a unimodal cobalt of the same average, which
 is what the first version of this decision got wrong."""
 total=pixels.sum(axis=1,keepdims=True);total[total==0]=1
 chroma=(pixels/total)[:,:2]
 counts,_,_=np.histogram2d(chroma[:,0],chroma[:,1],bins=BINS,range=[[0,1],[0,1]])
 return counts/max(1.,counts.sum())

def role_image(role):
 name='jungle-card.png' if role=='jungle-card' else 'textures/%s.jpg'%role
 return np.asarray(Image.open(root/'public/assets/dreamisland'/name).convert('RGB'),dtype=float)

QUADRANT_ORIGIN={'TL':(0.,0.),'TR':(.5,0.),'BL':(0.,.5),'BR':(.5,.5)}
def quadrant_pixels(role,claimed,rect=None):
 """Pixels of each quadrant, cropped to the sub-rect the geometry addresses.

 `rect` is absolute TOP-ORIGIN UV - the convention a flipY:false sampler uses
 and the one the shipped geometry carries. It is turned into coordinates
 RELATIVE to the claimed quadrant and then applied to all four, so a run that
 addresses the middle third of its cell is compared against the middle third of
 every candidate rather than against three whole cells."""
 image=role_image(role);height,width,_=image.shape
 if rect is None:
  low=(.02,.02);high=(.98,.98)
 else:
  origin=QUADRANT_ORIGIN[claimed]
  low=(min(.98,max(.02,(rect[0]-origin[0])*2)),min(.98,max(.02,(rect[1]-origin[1])*2)))
  high=(min(.98,max(low[0]+.04,(rect[2]-origin[0])*2)),min(.98,max(low[1]+.04,(rect[3]-origin[1])*2)))
 out={}
 for label,(ox,oy) in QUADRANT_ORIGIN.items():
  x0=int(round((ox+low[0]/2)*width));x1=int(round((ox+high[0]/2)*width))
  y0=int(round((oy+low[1]/2)*height));y1=int(round((oy+high[1]/2)*height))
  cell=image[y0:max(y0+2,y1),x0:max(x0+2,x1)].reshape(-1,3)
  if role=='jungle-card':
   keyed=(np.minimum(cell[:,0],cell[:,2])-cell[:,1])>6
   cell=cell[~keyed] if (~keyed).sum()>100 else cell
  out[label]=cell
 return out

QUADRANT_OF_RECT={}
for role,cells in atlas['roles'].items():
 for cell,entry in cells.items():QUADRANT_OF_RECT[(role,cell)]=entry['quadrant']

rows=[];failures=[]
for claim in proof['claims']:
 if claim.get('error'):
  failures.append({'id':claim['id'],'reason':claim['error']});continue
 shot=directory/(claim['id']+'.png');background=directory/(claim['id']+'-background.png')
 if not shot.exists() or not background.exists():
  failures.append({'id':claim['id'],'reason':'missing frame'});continue
 a=np.asarray(Image.open(shot).convert('RGB'),dtype=float)
 # The background is taken from the SAME camera on the SAME static scene, so
 # the mask is exactly the pixels the isolated run drew.
 b=np.asarray(Image.open(background).convert('RGB'),dtype=float)
 mask=np.abs(a-b).sum(axis=2)>MASK_DELTA
 # The keyed sheet renders its magenta because the runtime discard tests the
 # DIFFUSE colour, and the unlit proof render puts the map on emissive with a
 # black base. Those pixels are the key, not the sprite, and are dropped here
 # exactly as they are dropped from the reference.
 if claim['role']=='jungle-card':
  keyed=(np.minimum(a[:,:,0],a[:,:,2])-a[:,:,1])>6
  mask=mask&~keyed
 pixels=int(mask.sum())
 row={'id':claim['id'],'is':claim['is'],'role':claim['role'],'cell':claim['cell'],
  'capturedAtProgress':claim.get('capturedAtProgress'),
  'quadrant':QUADRANT_OF_RECT[(claim['role'],claim['cell'])],
  'manifestUv':claim['rect']['uv'],'maskPixels':pixels,
  'runTriangles':(claim.get('census') or {}).get('count',0)//3,
  'matchedTriangles':(claim.get('census') or {}).get('matchedTriangles'),
  'uniformCell':(claim.get('census') or {}).get('cell'),
  'addressedRect':(claim.get('census') or {}).get('addressedRect')}
 if pixels<MINIMUM_PIXELS:
  row['accepted']=False;row['reason']='only %d masked pixels; nothing to measure'%pixels
  rows.append(row);failures.append(row);continue
 addressed=(claim.get('census') or {}).get('addressedRect')
 drawn_pixels=a[mask]
 drawn=chromaticity(drawn_pixels);drawn_histogram=histogram(drawn_pixels)
 quadrants=quadrant_pixels(claim['role'],row['quadrant'],addressed)
 # Half the distance is where the colour sits, half is how it is distributed.
 distances={label:float(.5*np.hypot(*(drawn-chromaticity(pixels)))
   +.5*np.abs(drawn_histogram-histogram(pixels)).sum()/2)
  for label,pixels in quadrants.items()}
 nearest=min(distances,key=distances.get)
 row.update({'drawnChromaticity':[round(float(v),5) for v in drawn],
  'quadrantDistances':{k:round(v,5) for k,v in distances.items()},
  'nearestQuadrant':nearest,'accepted':nearest==row['quadrant'],
  'margin':round(sorted(distances.values())[1]-distances[nearest],5)})
 rows.append(row)
 if not row['accepted']:failures.append(row)
report={'script':'scripts/visual/dreamisland/atlas-proof.py','directory':str(directory),
 'maskDelta':MASK_DELTA,'minimumPixels':MINIMUM_PIXELS,
 'measure':'half mean normalised chromaticity distance plus half chromaticity-histogram L1/2, masked pixels against each quadrant of the same role, cropped to the sub-rect the geometry addresses',
 'claims':rows,'accepted':not failures,'failures':failures}
(directory/'atlas-proof-decision.json').write_text(json.dumps(report,indent=1))
print(json.dumps({'accepted':report['accepted'],
 'claims':[{k:r.get(k) for k in ('id','cell','quadrant','nearestQuadrant','margin','maskPixels','accepted')} for r in rows]},indent=1))
if failures:sys.exit(1)
