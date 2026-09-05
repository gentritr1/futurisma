import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as THREE from 'three';
import {parseGeometry} from './lib/glb-geometry.mjs';
import {typescriptModuleUrl} from './lib/typescript-module.mjs';
const root=new URL('../',import.meta.url);
const bytes=await readFile(new URL('public/assets/power-kit-v2/power_kit.glb',root));
const json=JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)));
const manifest=JSON.parse(await readFile(new URL('public/assets/power-kit-v2/manifest.json',root),'utf8'));
const triangles=json.meshes.reduce((sum,m)=>sum+m.primitives.reduce((n,p)=>n+json.accessors[p.indices??p.attributes.POSITION].count/3,0),0);
assert.equal(triangles,manifest.triangles);assert.ok(triangles<=4000);
assert.deepEqual(json.materials.map(m=>m.name).sort(),manifest.materialRoles.map(r=>'GW_MAT_'+r).sort());
assert.equal(json.images.length,4);assert.ok(json.images.every(i=>i.bufferView!==undefined),'Painted atlases are embedded in the real GLB.');
assert.ok(json.meshes.every(m=>m.primitives.every(p=>p.attributes.TEXCOORD_0!==undefined&&p.attributes.COLOR_0!==undefined)),'Paint and contact AO both reach the model.');
const {PowerKit}=await import(await typescriptModuleUrl(new URL('src/game/power-kit.ts',root)));
const asset=await parseGeometry(bytes);const kit=new PowerKit(asset.scene);
for(const kind of ['surge','shield']) {
 const device=kit.createPickupVisual(kind);assert.equal(device.root.userData.pumpHardware,true);
 const core=device.root.getObjectByName('PK_'+kind+'_core');assert.ok(core.isMesh,'One caged lamp mesh per device.');
 const size=new THREE.Box3().setFromObject(device.root).getSize(new THREE.Vector3());assert.ok(size.y>1.6&&size.y<2);
 const pivot=device.root.getObjectByName('PK_'+kind+(kind==='surge'?'_cage':'_petals'));
 device.update(.1,false,1,0);const angle=pivot.rotation.z;device.update(.2,false,1,0);
 if(kind==='surge'){assert.ok(pivot.rotation.z>angle);const paused=pivot.rotation.z;device.update(.3,true,1,1);assert.equal(pivot.rotation.z,paused);}
 else {assert.equal(pivot.children.length,6);device.update(.3,true,1,1);assert.ok(pivot.children.every(b=>b.rotation.z===.68));device.update(.4,true,1,0);assert.ok(pivot.children.every(b=>b.rotation.z===0));}
 let lamps=0;core.traverse(o=>{if(o.isMesh){lamps++;assert.notEqual(o.material,kit.templates[kind].getObjectByName('PK_'+kind+'_core').material);}});assert.equal(lamps,1);
 device.dispose();
}
kit.dispose();
console.log(`Pump kit V2 PASS: ${triangles} triangles, four embedded painted atlases, contact AO, six role allowlist, turbine/iris pivots, independent lamp controls and reduced motion.`);
