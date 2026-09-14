"""Sparse sparkle, control-render noise, and explicit atlas consumer checks."""
from pathlib import Path
import importlib.util,json,struct,hashlib
import numpy as np
from PIL import Image
E=Path('art/evidence/dreamisland-v1/vs-design')
s=importlib.util.spec_from_file_location('grade','scripts/visual/grade/measure-frames.py');g=importlib.util.module_from_spec(s);s.loader.exec_module(g)
s=importlib.util.spec_from_file_location('ac','art/evidence/dreamisland-v1/alive/3d/autocorrelation.py');ac=importlib.util.module_from_spec(s);s.loader.exec_module(ac)
def img(p):return np.asarray(Image.open(p).convert('RGB'))
def largest(mask):
 pixels=set(zip(*np.where(mask)));biggest=0
 while pixels:
  stack=[pixels.pop()];count=0
  while stack:
   y,x=stack.pop();count+=1
   for dy,dx in [(-1,-1),(-1,0),(-1,1),(0,-1),(0,1),(1,-1),(1,0),(1,1)]:
    p=(y+dy,x+dx)
    if p in pixels:pixels.remove(p);stack.append(p)
  biggest=max(biggest,count)
 return biggest
rows=[];controls=[]
for pose in ['court','reef']:
 for stage in ['baseline','final']:
  full=img(E/stage/f'{pose}-day.png');sea=img(E/stage/f'{pose}-day-sea.png');blank=img(E/stage/f'{pose}-day-blank.png');mask=np.any(sea!=blank,2)&np.all(full==sea,2);l=full@np.array([.2126,.7152,.0722]);white=mask&(l>239);lab=g.lab(full[mask]/255)
  rows.append(dict(stage=stage,pose=pose,seaPixels=int(mask.sum()),chroma=float(np.hypot(lab[:,1],lab[:,2]).mean()),p50=float(np.median(l[mask])),whitePct=float(100*white.sum()/mask.sum()),maximumBlob=largest(white),autocorrelation=ac.autocorrelation_peak(white)))
 for state in ['day','night']:
  full=E/'final'/f'{pose}-{state}.png';control=E/'final'/f'{pose}-{state}-control.png'
  if control.exists():controls.append(dict(pose=pose,state=state,fullP99=g.measure(str(full),False)['p99'],controlP99=g.measure(str(control),False)['p99'],changedPixels=int(np.any(img(full)!=img(control),2).sum())))
 Image.fromarray(img(E/'final'/f'{pose}-day.png')).crop((0,280,400,480)).resize((800,400)).save(E/'final'/f'{pose}-sea-2x.png')
b=Path('public/assets/dreamisland/props.glb').read_bytes();n=struct.unpack_from('<I',b,12)[0];d=json.loads(b[20:20+n]);atlas=[]
for name in ['PR_ball','PR_ring']:
 node=next(x for x in d['nodes'] if x['name']==name);p=d['meshes'][node['mesh']]['primitives'][0];a=d['accessors'][p['attributes']['TEXCOORD_0']];v=d['bufferViews'][a['bufferView']];uv=np.ndarray((a['count'],2),dtype='<f4',buffer=b,offset=28+n+v.get('byteOffset',0)+a.get('byteOffset',0),strides=(v.get('byteStride',8),4));m=d['materials'][p['material']]
 atlas.append(dict(node=name,uvMin=uv.min(0).tolist(),uvMax=uv.max(0).tolist(),atlasRole=node['extras']['atlasRole'],atlasCell=node['extras']['atlasCell'],emissiveFactor=m.get('emissiveFactor',[0,0,0]),material=m['name']))
result=dict(sparkle=rows,controls=controls,atlas=atlas)
(E/'extra-checks.json').write_text(json.dumps(result,indent=2));print(json.dumps(result,indent=2))
