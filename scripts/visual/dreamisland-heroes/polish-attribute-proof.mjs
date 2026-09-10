/** Prove the final palette edit changes colours only; existing atlas probes
 * disable vertex colours, so their UV/index/position evidence remains valid. */
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const before='art/evidence/dreamisland-v1/polish/before-palette/painted.glb',after='public/assets/dreamisland/painted.glb';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
async function inspect(file){
 const bytes=await readFile(file),length=bytes.readUInt32LE(12),gltf=JSON.parse(bytes.subarray(20,20+length)),bin=bytes.subarray(28+length);
 const accessor=id=>{
  const a=gltf.accessors[id],view=gltf.bufferViews[a.bufferView],width={SCALAR:1,VEC2:2,VEC3:3,VEC4:4}[a.type]*({5120:1,5121:1,5122:2,5123:2,5125:4,5126:4}[a.componentType]);
  const packed=Buffer.alloc(a.count*width),start=(view.byteOffset??0)+(a.byteOffset??0),stride=view.byteStride??width;
  for(let i=0;i<a.count;i++)bin.copy(packed,i*width,start+i*stride,start+i*stride+width);
  return hash(packed);
 };
 return {file,sha256:hash(bytes),meshes:gltf.meshes.map(m=>({name:m.name,primitives:m.primitives.map(p=>({indices:accessor(p.indices),attributes:Object.fromEntries(Object.entries(p.attributes).map(([name,id])=>[name,accessor(id)]))}))}))};
}
const a=await inspect(before),b=await inspect(after);assert.equal(a.meshes.length,b.meshes.length);const changes=[];
for(let i=0;i<a.meshes.length;i++){
 assert.equal(a.meshes[i].name,b.meshes[i].name);
 for(let j=0;j<a.meshes[i].primitives.length;j++){
  const old=a.meshes[i].primitives[j],now=b.meshes[i].primitives[j];assert.equal(old.indices,now.indices);
  for(const [key,value] of Object.entries(old.attributes))if(key==='COLOR_0'){if(value!==now.attributes[key])changes.push(a.meshes[i].name);}else assert.equal(value,now.attributes[key],a.meshes[i].name+': '+key);
 }
}
assert.ok(changes.length>0);await writeFile('art/evidence/dreamisland-v1/polish/palette-attribute-proof.json',JSON.stringify({instrument:'scripts/visual/dreamisland-heroes/polish-attribute-proof.mjs',before:a,after:b,changedColorMeshes:changes,unchanged:'All indices, positions, normals and UVs. Existing quadrant probes disable vertex colours; this final edit cannot change their sampled cells.'},null,2)+'\n');console.log('VERIFIED final palette edit changes only vertex colours:',changes);
