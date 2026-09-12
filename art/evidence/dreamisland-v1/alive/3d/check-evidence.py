import json
from pathlib import Path
import numpy as np
from PIL import Image,ImageFilter
base=Path('art/evidence/dreamisland-v1/alive/3d');result={'sky':[],'quadrants':[],'glow':[]}
for pose in ['court','reef']:
 for state in ['000','100']:
  before=np.asarray(Image.open(base/'step-0'/pose/f'blend-{state}-sky.png'))
  after=np.asarray(Image.open(base/'final'/pose/f'blend-{state}-sky.png'))
  result['sky'].append(dict(pose=pose,state=state,changedPixels=int(np.any(before!=after,axis=2).sum())))
expected={'PR_ball':['BR'],'PR_ring':['BR'],'PR_sphere':['TR'],'PR_pipes':['TR'],'PR_bollard':['BR','TR'],'PR_plinth':['BR'],'capsule':['TR']}
for node in ['CAP_frame','CAP_glass','CAP_core','CAP_cap','PR_bollard_core']:expected[node]=['TR']
for name,cells in expected.items():
 a=np.asarray(Image.open(base/'assets'/f'{name}-quadrants.png').convert('RGB'))
 # Ignore unsaturated sky/background. These known ID colours prove the rendered consumer.
 r,g,b=a[:,:,0].astype(int),a[:,:,1].astype(int),a[:,:,2].astype(int)
 masks={'TL':(r-g>45)&(r-b>45),'TR':(g-r>45)&(g-b>45),'BL':(b-r>45)&(b-g>45),'BR':(r-b>45)&(g-b>45)}
 interior=np.asarray(Image.fromarray(np.logical_or.reduce(list(masks.values())).astype('uint8')*255).filter(ImageFilter.MinFilter(5)))>0
 counts={cell:int((mask&interior).sum()) for cell,mask in masks.items()}
 assert all(counts[cell]>0 for cell in cells),(name,counts)
 assert sum(counts[cell] for cell in counts if cell not in cells)<sum(counts.values())*.001,(name,counts)
 result['quadrants'].append(dict(name=name,expected=cells,pixels=counts))
import importlib.util
spec=importlib.util.spec_from_file_location('grade','scripts/visual/grade/measure-frames.py');grade=importlib.util.module_from_spec(spec);spec.loader.exec_module(grade)
for pose in ['court','reef']:
 full=grade.measure(str(base/'glow'/pose/'blend-100.png'));without=grade.measure(str(base/'glow'/pose/'blend-100-without-sprites.png'))
 a=np.asarray(Image.open(base/'glow'/pose/'blend-100.png'));b=np.asarray(Image.open(base/'glow'/pose/'blend-100-without-sprites.png'))
 result['glow'].append(dict(pose=pose,p99With=full['p99'],p99Without=without['p99'],delta=full['p99']-without['p99'],changedPixels=int(np.any(a!=b,axis=2).sum())))
(base/'pixel-checks.json').write_text(json.dumps(result,indent=2));print(json.dumps(result,indent=2))
