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
 field.dispose();assert.equal(cradle.devices.surge.root.parent,null);
}finally{PowerKit.load=original;}
const {TidelineRivalPowers}=await import(await typescriptModuleUrl(local('tideline-rival-powers.ts')));
function schedule(reduced){const powers=new TidelineRivalPowers(3868938316,2000,3,reduced);for(let lap=1;lap<=3;lap++)for(let step=0;step<100;step++)for(let rival=0;rival<3;rival++){const state={id:'rival-'+rival,lap,courseDistanceMeters:step*20,elapsedSeconds:(lap-1)*25+step*.25,finished:false};const before={...state};powers.step(rival,state);assert.deepEqual(state,before,'Power presentation must never write pace state.');}return powers.events;}
const normal=schedule(false),reduced=schedule(true);assert.deepEqual(normal,reduced);assert.equal(normal.length,18);assert.ok(normal.every(e=>e.scheduledProgress>=.35&&e.scheduledProgress<.685));
console.log('Tideline hardware PASS: hoist attachment during retraction, collect jaws/sparks/reset, reduced motion, and 18 seeded rival power cues without pace-state writes.');
