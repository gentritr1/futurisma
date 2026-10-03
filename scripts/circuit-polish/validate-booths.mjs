import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';

const buffer=await readFile('public/assets/circuit-booths/booths.glb');
assert.equal(buffer.toString('ascii',0,4),'glTF');
assert.ok(buffer.length<3*1024*1024,'Optional booth kit stays below 3 MiB');
const jsonLength=buffer.readUInt32LE(12);
const gltf=JSON.parse(buffer.toString('utf8',20,20+jsonLength));
const binaryStart=20+jsonLength+8;
assert.equal(gltf.images.length,1,'One embedded generated atlas');
assert.ok(!gltf.images[0].uri,'Texture travels with the model');
const names=new Set(gltf.nodes.map(node=>node.name));
for(const variant of ['cafe','market','service'])for(const role of ['paint','metal','glow'])assert.ok(names.has(`${variant}_${role}`));
assert.ok(names.has('rotor_metal'),'Independent fan animation mesh');
let triangles=0;
for(const mesh of gltf.meshes)for(const primitive of mesh.primitives){
  const accessor=gltf.accessors[primitive.attributes.POSITION];
  const view=gltf.bufferViews[accessor.bufferView];
  const offset=binaryStart+(view.byteOffset??0)+(accessor.byteOffset??0);
  assert.equal(accessor.componentType,5126);
  const stride=view.byteStride??12;
  for(let i=0;i<accessor.count;i++){
    const x=buffer.readFloatLE(offset+i*stride),y=buffer.readFloatLE(offset+i*stride+4),z=buffer.readFloatLE(offset+i*stride+8);
    assert.ok([x,y,z].every(Number.isFinite));
    // Nightshift's 1.35x width is the widest placement; it must remain inside
    // CircuitLife's checked 12x11 m site footprint, including seats/cabinet.
    assert.ok(Math.abs(x)*1.35<=6&&Math.abs(z)<=5.5,'Actual mesh fits checked road-clearance footprint');
    assert.ok(y>=-.5&&y<=5.5,'Booth and rotor have bounded heights');
  }
  triangles+=gltf.accessors[primitive.indices].count/3;
}
assert.ok(triangles<35000,'Shared prototype triangle budget');
console.log(JSON.stringify({bytes:buffer.length,triangles,nodes:names.size,atlasCount:gltf.images.length,footprint:'12x11m maximum'}));
