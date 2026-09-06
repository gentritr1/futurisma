import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const roles=['concrete','metal','jungle','water','signage','emissive'];
const names=['rocket-platform','crawler-transporter','countdown-board','trench-wall-module','deluge-water-tower','propellant-tank','vent-stack','crawlerway-gravel-bed','mangrove-pier','egret-card-set','service-tower-swing-arm','power-kit','painted'];
const records=[];
for(const name of names){
 const path=`public/assets/ascension/${name}.glb`,bytes=readFileSync(path);
 assert.equal(bytes.readUInt32LE(0),0x46546c67);
 const gltf=JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)));
 assert(!gltf.nodes.some(n=>/maquette|tripo/i.test(n.name??'')),`${name}: retained maquette node`);
 let triangles=0,primitives=0;
 for(const mesh of gltf.meshes)for(const primitive of mesh.primitives){
  assert(primitive.attributes.TEXCOORD_0!==undefined,`${name}: missing UV0`);
  assert(primitive.attributes.COLOR_0!==undefined,`${name}: missing painted vertex tint`);
  const count=gltf.accessors[primitive.indices??primitive.attributes.POSITION].count;
  assert.equal(count%3,0);triangles+=count/3;primitives++;
 }
 const materials=gltf.materials.map(m=>m.name);
 assert(materials.every(m=>roles.some(role=>m.endsWith(role))),`${name}: foreign material role`);
 if(name==='power-kit')for(const kind of ['surge','shield'])assert(gltf.nodes.some(n=>n.name===`PK_${kind}`&&n.extras?.pumpHardware===true));
 records.push({path,sha256:createHash('sha256').update(bytes).digest('hex'),triangles,primitives,materials});
}
const manifest=JSON.parse(readFileSync('public/assets/ascension/painted.json'));
assert.equal(records.at(-1).triangles,manifest.triangles);
assert.equal(records.at(-1).primitives,manifest.meshes);
const atlas=roles.map(role=>{const path=`public/assets/ascension/textures/${role}.jpg`,bytes=readFileSync(path);return {role,path,sha256:createHash('sha256').update(bytes).digest('hex')};});
const result={script:'scripts/validate-ascension-painted.mjs',scope:'GLB structure, material roles, UV0, vertex tint, named device pivots, manifest counts and no named maquette nodes. Does not certify visual fidelity or infer geometry provenance from names.',accepted:true,records,atlas};
writeFileSync('art/evidence/ascension-v1/phase-b/painted-validation.json',JSON.stringify(result,null,2));
console.log(JSON.stringify({assets:records.length,worldTriangles:manifest.triangles,worldPrimitives:manifest.meshes,accepted:true}));
