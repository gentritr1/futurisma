"""Inspect exported accessors, node names, geometry dimensions and atlas cells."""
import struct,json,numpy as np
from pathlib import Path
root=Path.cwd();out=root/'art/evidence/dreamisland-v1/alive/3d/build'
rows=[]
for name in ['props','capsule']:
 b=(root/f'public/assets/dreamisland/{name}.glb').read_bytes();length=struct.unpack_from('<I',b,12)[0];g=json.loads(b[20:20+length]);offset=20+length;binary=b[offset+8:]
 def acc(i):
  a=g['accessors'][i];v=g['bufferViews'][a['bufferView']];n={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4}[a['type']];dtype={5126:'<f4',5125:'<u4',5123:'<u2',5121:'u1'}[a['componentType']]
  return np.ndarray((a['count'],n),dtype=dtype,buffer=binary,offset=v.get('byteOffset',0)+a.get('byteOffset',0),strides=(v.get('byteStride',np.dtype(dtype).itemsize*n),np.dtype(dtype).itemsize))
 for node in g['nodes']:
  if 'mesh' not in node:continue
  primitives=g['meshes'][node['mesh']]['primitives'];assert len(primitives)==1
  p=primitives[0];uv=acc(p['attributes']['TEXCOORD_0']);pos=acc(p['attributes']['POSITION']);rect=node['extras']['atlasRect'];u0,v0,u1,v1=rect
  expected=[u0,1-v1,u1,1-v0]
  assert uv[:,0].min()>=u0-1e-6 and uv[:,0].max()<=u1+1e-6
  assert uv[:,1].min()>=1-v1-1e-6 and uv[:,1].max()<=1-v0+1e-6
  rows.append(dict(file=name,node=node['name'],triangles=g['accessors'][p['indices']]['count']//3,uvMin=uv.min(0).tolist(),uvMax=uv.max(0).tolist(),expected=expected,positionMin=pos.min(0).tolist(),positionMax=pos.max(0).tolist(),transform={k:node[k] for k in ['translation','rotation','scale'] if k in node}))
(out/'export-contracts.json').write_text(json.dumps(rows,indent=2));print(json.dumps(rows,indent=2))
