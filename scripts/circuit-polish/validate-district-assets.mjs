import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const buffer=await readFile('public/assets/circuit-districts/districts.glb');
assert.equal(buffer.toString('ascii',0,4),'glTF');assert.ok(buffer.length<2*1024*1024);
const length=buffer.readUInt32LE(12),gltf=JSON.parse(buffer.toString('utf8',20,20+length)),start=28+length;
assert.equal(gltf.images.length,1);assert.ok(!gltf.images[0].uri);
for(const type of ['works','silos','hall','tower','tug'])assert.ok(gltf.nodes.some(n=>n.name===`${type}_paint`));
let triangles=0;
for(const node of gltf.nodes){
 if(node.mesh===undefined)continue;
 assert.ok(!node.matrix&&!node.translation&&!node.rotation&&!node.scale,'Authored prototypes have identity transforms');
 const kind=node.name.split('_')[0],radius={works:24,silos:22.5,hall:15,tower:7,tug:4}[kind];
 assert.ok(radius);
 for(const primitive of gltf.meshes[node.mesh].primitives){
  assert.ok(primitive.attributes.TEXCOORD_0!==undefined);assert.ok(primitive.attributes.COLOR_0!==undefined);
  const a=gltf.accessors[primitive.attributes.POSITION],v=gltf.bufferViews[a.bufferView],offset=start+(v.byteOffset??0)+(a.byteOffset??0),stride=v.byteStride??12;
  for(let i=0;i<a.count;i++){
   let x=buffer.readFloatLE(offset+i*stride);const y=buffer.readFloatLE(offset+i*stride+4),z=buffer.readFloatLE(offset+i*stride+8);
   assert.ok([x,y,z].every(Number.isFinite));assert.ok(y>=-3&&y<=31);
   if(kind==='works')x*=1.4;if(kind==='silos')x*=1.35;
   assert.ok(Math.hypot(x,z-(kind==='works'?6:0))<=radius,`${node.name}: actual vertex stays in reserved footprint`);
  }
  triangles+=gltf.accessors[primitive.indices].count/3;
 }
}
assert.ok(triangles<20000);
console.log(JSON.stringify({bytes:buffer.length,triangles,nodes:gltf.nodes.length,embeddedAtlases:gltf.images.length,checked:'Every vertex against runtime footprint, including width variants'}));
