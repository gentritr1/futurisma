import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as THREE from 'three';
import {typescriptModuleUrl} from './lib/typescript-module.mjs';
import {parseGeometry} from './lib/glb-geometry.mjs';
import {TIDELINE_ABILITY_CONFIG} from '../src/game/tideline-rules.js';
const local=name=>new URL('../src/game/'+name,import.meta.url);
const {PowerKit}=await import(await typescriptModuleUrl(local('power-kit.ts')));
const {TidelineCradles}=await import(await typescriptModuleUrl(local('tideline-cradles.ts')));
const bytes=await readFile(new URL('../public/assets/power-kit-v2/power_kit.glb',import.meta.url));
const original=PowerKit.load;PowerKit.load=async()=>new PowerKit((await parseGeometry(bytes)).scene);
try {
 const course={length:2073.797598046593,sample:p=>({position:new THREE.Vector3(0,0,-p*2073.797598046593),right:new THREE.Vector3(1,0,0),up:new THREE.Vector3(0,1,0),tangent:new THREE.Vector3(0,0,-1),halfWidth:12,width:24})};
 const field=new TidelineCradles(course,TIDELINE_ABILITY_CONFIG.pickups);await field.ready;
 const states=TIDELINE_ABILITY_CONFIG.pickups.map(p=>({kind:p.kind,available:true,charge:1}));
 field.update(1,false,states,.03);const cradle=field.cradles[0];
 assert.ok(Math.abs(cradle.carrier.position.y+cradle.cables.scale.y+.9)<1e-9,'Wire ends exactly at the carrier beam.');
 const swing=cradle.swing.rotation.z;field.update(1,false,states,.03);assert.equal(cradle.swing.rotation.z,swing,'Pause freezes the hoist.');
 states[0].available=false;field.update(2,false,states,.03);field.update(2.3,false,states,.03);
 assert.ok(cradle.jaws[0].rotation.z>1&&cradle.jaws[1].rotation.z< -1);assert.ok(cradle.carrier.position.y> -5.8);assert.equal(cradle.sparks.visible,true);
 assert.ok(Math.abs(cradle.carrier.position.y+cradle.cables.scale.y+.9)<1e-9,'Retraction cannot detach the wire.');
 field.update(2.35,true,states,.03);assert.equal(cradle.swing.rotation.z,0);assert.equal(cradle.beacon.rotation.y,0);assert.equal(cradle.sparks.visible,false);
 states[0].available=true;field.update(3,true,states,.03);assert.equal(cradle.carrier.position.y,-5.8);assert.equal(cradle.jaws[0].rotation.z,0);
 // The far presentation keeps identical bounds and painted roles while the
 // close mechanism remains independently animated. Both disappear on collect.
 field.update(4,false,states,.03+100/course.length);
 assert.equal(cradle.devices.surge.root.visible,false);assert.equal(cradle.distant.surge.visible,true);
 const near=new THREE.Box3().setFromObject(cradle.devices.surge.root);
 const far=new THREE.Box3().setFromObject(cradle.distant.surge);
 assert.ok(near.min.distanceTo(far.min)<1e-5&&near.max.distanceTo(far.max)<1e-5,'LOD preserves the painted device silhouette.');
 assert.equal(cradle.distant.surge.children.length,4,'Distant device uses one mesh per material role.');
 states[0].available=false;field.update(5,false,states,.03+100/course.length);
 assert.equal(cradle.devices.surge.root.visible,false);assert.equal(cradle.distant.surge.visible,false);
 field.dispose();assert.equal(cradle.devices.surge.root.parent,null);
}finally{PowerKit.load=original;}
const {TidelineRivalPowers}=await import(await typescriptModuleUrl(local('tideline-rival-powers.ts')));
function schedule(reduced){const powers=new TidelineRivalPowers(3868938316,2000,3,reduced);for(let lap=1;lap<=3;lap++)for(let step=0;step<100;step++)for(let rival=0;rival<3;rival++){const state={id:'rival-'+rival,lap,courseDistanceMeters:step*20,elapsedSeconds:(lap-1)*25+step*.25,finished:false};const before={...state};powers.step(rival,state);assert.deepEqual(state,before,'Power presentation must never write pace state.');}return powers.events;}
const normal=schedule(false),reduced=schedule(true);assert.deepEqual(normal,reduced);assert.equal(normal.length,18);assert.ok(normal.every(e=>e.scheduledProgress>=.35&&e.scheduledProgress<.685));
console.log('Tideline hardware PASS: hoist attachment during retraction, collect jaws/sparks/reset, reduced motion, and 18 seeded rival power cues without pace-state writes.');

const {TidelinePowerField}=await import(await typescriptModuleUrl(local('tideline-power-field.ts')));
const presentation=new TidelinePowerField();
presentation.update(1,true,true,true,true);
const dome=presentation.root.getObjectByName('tideline_refund_hex_dome');
const steady={opacity:dome.material.opacity,emission:dome.material.emissiveIntensity};
presentation.update(1.7,true,true,true,true);
assert.deepEqual({opacity:dome.material.opacity,emission:dome.material.emissiveIntensity},steady,'Reduced refund window must not pulse.');
assert.equal(presentation.root.getObjectByName('surge_trailing_heat_cone').visible,false);
presentation.update(1.8,true,false,true,false);
assert.ok(dome.material.opacity<steady.opacity,'Refund expiry remains readable with motion reduced.');
console.log('Tideline hardware PASS: distant silhouette, role batching, collection visibility, and steady reduced-motion dome.');

const {TidelineDeviceBatch}=await import(await typescriptModuleUrl(local('tideline-device-batch.ts')));
const batchedKit=new PowerKit((await parseGeometry(bytes)).scene,(root,lamp)=>new TidelineDeviceBatch(root,lamp));
for(const kind of ['surge','shield']) {
 const device=batchedKit.createPickupVisual(kind);
 for(const activation of [0,.5,1]) {
  device.update(.1+activation,false,1,activation);
  for(const {mesh,parts} of device.batch.batches) {
   const positions=mesh.geometry.getAttribute('position');
   for(const part of parts) {
    const source=part.source.geometry.getAttribute('position');
    for(let i=0;i<source.count;i++) {
     const expected=new THREE.Vector3().fromBufferAttribute(source,i).applyMatrix4(part.matrix);
     const actual=new THREE.Vector3().fromBufferAttribute(positions,part.offset+i);
     assert.ok(expected.distanceTo(actual)<1e-5,'Batch preserves each animated vertex.');
    }
   }
  }
 }
 let visibleMeshes=0;device.root.traverseVisible(o=>{if(o.isMesh)visibleMeshes++;});
 assert.equal(visibleMeshes,4,'Animated device remains one draw per painted role.');
 device.dispose();
}
batchedKit.dispose();
console.log('Tideline hardware PASS: all animated batch vertices match their authored pivots, at rest and partial/full activation.');
