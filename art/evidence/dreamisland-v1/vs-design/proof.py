"""The brief's full-frame grade, exact isolation masks, and GLB byte proofs."""
from pathlib import Path
import importlib.util,json,struct,hashlib,subprocess
import numpy as np
from PIL import Image
ROOT=Path.cwd();E=ROOT/'art/evidence/dreamisland-v1/vs-design'
spec=importlib.util.spec_from_file_location('grade',ROOT/'scripts/visual/grade/measure-frames.py')
g=importlib.util.module_from_spec(spec);spec.loader.exec_module(g)
def image(p):return np.asarray(Image.open(p).convert('RGB'))
def stats(p):
 l=p@np.array([.2126,.7152,.0722]);lab=g.lab(p/255)
 return dict(pixels=len(p),p50=float(np.median(l)),p99=float(np.percentile(l,99)),maximum=float(l.max()),whitePct=float((l>239).mean()*100),chroma=float(np.hypot(lab[:,1],lab[:,2]).mean()))
rows=[]
for stage in ['baseline','ao-only','g2-light','g2-before-canopy','final']:
 for pose in ['court','reef']:
  for state in ['day','night']:
   if stage!='final' and state=='night':continue
   p=E/stage/f'{pose}-{state}.png'
   if p.exists():rows.append(dict(stage=stage,pose=pose,state=state,**g.measure(str(p),False)))
for state in ['day','night']:
 p=ROOT/f'art/references/dreamisland/phase-f/target-court-{state}-gptimage2.png'
 rows.append(dict(stage='painting',pose='court',state=state,**g.measure(str(p),False)))
(E/'measurements.json').write_text(json.dumps(rows,indent=2))
sourceRows=[];waterRows=[]
for pose in ['court','reef']:
 p=E/'final'/f'{pose}-night.png'
 if not p.exists():continue
 full=image(p);blank=image(E/'final'/f'{pose}-night-blank.png')
 withP99=g.measure(str(p),False)['p99']
 for source in ['bollard','column','capsule','fish','glow']:
  without=E/'final'/f'{pose}-night-without-{source}.png'
  if without.exists():
   q=g.measure(str(without),False)['p99'];sourceRows.append(dict(pose=pose,source=source,withP99=withP99,withoutP99=q,delta=round(withP99-q,2),changedPixels=int(np.any(full!=image(without),2).sum())))
 for state in ['day','night']:
  full=image(E/'final'/f'{pose}-{state}.png');blank=image(E/'final'/f'{pose}-{state}-blank.png')
  for kind in ['sea','shallows','road']:
   isolated=image(E/'final'/f'{pose}-{state}-{kind}.png')
   visible=np.any(isolated!=blank,2)&np.all(full==isolated,2)
   if kind=='road':
    band=np.zeros(visible.shape,bool);band[int(.48*720):int(.85*720),int(.4*1280):int(.75*1280)]=True;visible&=band
   record=dict(pose=pose,state=state,kind=kind,visible=stats(full[visible]),isolated=stats(isolated[np.any(isolated!=blank,2)]))
   # Same-pose baseline visibility, sampled against the final composited pixels,
   # also catches light sprites drawn on top of an originally visible water pixel.
   if state=='night' and kind!='road':
    b=E/'g1-frozen';original=image(b/f'{pose}-night.png');alone=image(b/f'{pose}-night-{kind}.png');empty=image(b/f'{pose}-night-blank.png')
    mask=np.any(alone!=empty,2)&np.all(original==alone,2)
    record['baselineVisiblePixelsInFinal']=stats(full[mask]);record['baselineVisible']=stats(original[mask])
    without_glow=image(E/'final'/f'{pose}-night-without-glow.png')
    same_frame=np.any(isolated!=blank,2)&np.all(without_glow==isolated,2)
    record['sameFrameWaterWithGlow']=stats(full[same_frame]);record['sameFrameWaterWithoutGlow']=stats(without_glow[same_frame])
   waterRows.append(record)
(E/'sources.json').write_text(json.dumps(sourceRows,indent=2));(E/'water-road.json').write_text(json.dumps(waterRows,indent=2))
# Quantized ID masks identify actual rendered ball pixels and each authored stripe.
palette=np.array([[.03,.5,1],[1,1,1],[1,.14,.05],[1,.7,.02]])
srgb=np.where(palette<=.0031308,12.92*palette,1.055*palette**(1/2.4)-.055)*255
ball=[]
for stage in ['before','after']:
 folder=E/f'ball-{stage}';ids=image(folder/'ids.png');mask=ids.max(2)>250
 for variant in ['full','whiteLimit']:
  p=folder/f'{variant}.png'
  if not p.exists():continue
  a=image(p);stripes=[]
  for name,c,target in zip(['blue','white','orange','yellow'],[[255,0,0],[0,255,0],[0,0,255],[255,255,0]],srgb):
   pixels=a[np.all(ids==c,2)]
   stripes.append(dict(name=name,pixels=len(pixels),authoredSRGB=target.tolist(),screenMean=pixels.mean(0).tolist() if len(pixels) else None,maxChannelError=float(np.max(np.abs(pixels.mean(0)-target))) if len(pixels) else None))
  ball.append(dict(stage=stage,variant=variant,**stats(a[mask]),stripes=stripes))
  y,x=np.where(mask);Image.fromarray(a).crop((x.min()-4,y.min()-4,x.max()+5,y.max()+5)).save(folder/f'{variant}-crop.png')
(E/'ball.json').write_text(json.dumps(ball,indent=2))
# Decode accessors and compare every non-colour geometry attribute, not counts alone.
def glb(data):
 n=struct.unpack_from('<I',data,12)[0];doc=json.loads(data[20:20+n]);start=28+n
 def accessor(index):
  a=doc['accessors'][index];v=doc['bufferViews'][a['bufferView']];dtype={5126:'<f4',5125:'<u4',5123:'<u2',5121:'u1'}[a['componentType']];width={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4}[a['type']];item=np.dtype(dtype).itemsize
  return np.ndarray((a['count'],width),dtype=dtype,buffer=data,offset=start+v.get('byteOffset',0)+a.get('byteOffset',0),strides=(v.get('byteStride',item*width),item))
 def canonical(index,indices):
  triangles=accessor(index)[accessor(indices).ravel()].reshape(-1,3,accessor(index).shape[1])
  rows=[]
  for triangle in triangles:
   vertices=[tuple(float(x) for x in vertex) for vertex in triangle]
   rows.append(min(tuple(vertices[k:]+vertices[:k]) for k in range(3)))
  return hashlib.sha256(np.asarray(sorted(rows),dtype='<f8').tobytes()).hexdigest()
 nodes={} 
 for node in doc['nodes']:
  if 'mesh' not in node:continue
  primitives=[]
  for p in doc['meshes'][node['mesh']]['primitives']:
   primitives.append(dict(canonical={k:canonical(v,p['indices']) for k,v in p['attributes'].items()},attributes={k:hashlib.sha256(accessor(v).tobytes()).hexdigest() for k,v in p['attributes'].items()},expanded={k:hashlib.sha256(accessor(v)[accessor(p['indices']).ravel()].tobytes()).hexdigest() for k,v in p['attributes'].items()},indices=hashlib.sha256(accessor(p['indices']).tobytes()).hexdigest(),triangles=len(accessor(p['indices']))//3))
  nodes[node['name']]=primitives
 return doc,nodes,accessor
proof=[]
for asset in ['painted','props']:
 before=Path(f'/tmp/di-b59-{asset}.glb').read_bytes();after=(ROOT/f'public/assets/dreamisland/{asset}.glb').read_bytes();_,old,_=glb(before);doc,new,access=glb(after)
 assert old.keys()==new.keys()
 checks=[]
 for name,primitives in old.items():
  for i,(a,b) in enumerate(zip(primitives,new[name])):
   preserved=[k for k in a['attributes'] if k not in (['COLOR_0'] if asset=='painted' else ['TEXCOORD_0'])]
   ok=a['triangles']==b['triangles'] and (a['indices']==b['indices'] and all(a['attributes'][k]==b['attributes'][k] for k in preserved) if asset=='painted' else all(a['canonical'][k]==b['canonical'][k] for k in preserved))
   assert ok,(asset,name)
   checks.append(dict(node=name,primitive=i,triangles=a['triangles'],indicesIdentical=a['indices']==b['indices'],preservedTriangleAttributesIdentical=all(a['canonical'][k]==b['canonical'][k] for k in preserved),requiredInvariantPass=ok,preserved=preserved))
 proof.append(dict(asset=asset,sourceSha256=hashlib.sha256(before).hexdigest(),resultSha256=hashlib.sha256(after).hexdigest(),beforeBytes=len(before),afterBytes=len(after),trianglesBefore=sum(p['triangles'] for ps in old.values() for p in ps),trianglesAfter=sum(p['triangles'] for ps in new.values() for p in ps),checks=checks))
(E/'topology.json').write_text(json.dumps(proof,indent=2))
print(json.dumps(dict(world=rows,sources=sourceRows,waterRoad=waterRows,ball=ball,topology=[{k:v for k,v in r.items() if k!='checks'} for r in proof]),indent=2))
