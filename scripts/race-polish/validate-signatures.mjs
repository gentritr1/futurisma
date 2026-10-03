import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {circuitSignaturePose} from '../../src/game/circuit-signature-pose.js';

const baseline={waterLevel:0,draining:false,night:0,deluge:false,ceiling:false,flipping:false,relay:'idle'};
const pose=(kind,t=12,signals={})=>circuitSignaturePose(kind,t,false,{...baseline,...signals});
assert.equal(pose('tideline').status,'SUBMERGED SURVEY');
assert.equal(pose('tideline',12,{waterLevel:-27}).rovLift,0,'Drained dock rests the ROV');
assert.equal(pose('tideline',12,{draining:true}).status,'DRAINING');
assert.equal(pose('ascension').valveAngle,0);assert.ok(pose('ascension',12,{deluge:true}).valveAngle>1);
assert.ok(pose('polarity').gravityTilt>0);assert.ok(pose('polarity',12,{ceiling:true}).gravityTilt<0);
assert.equal(pose('polarity',12,{flipping:true}).status,'TRANSFERRING');
assert.equal(pose('polarity',12,{flipping:true,ceiling:true,gravityBlend:.5}).gravityTilt,0,'The cradle follows the halfway transfer, not the destination flag');
assert.equal(pose('polarity',12,{gravityBlend:2}).gravityTilt,-.48,'Transfer blend is bounded');
assert.equal(circuitSignaturePose('polarity',12,true,{...baseline,ceiling:true,gravityBlend:.49}).gravityTilt,.48,'Reduced motion stays on the source deck before the camera cut');
assert.equal(circuitSignaturePose('polarity',12,true,{...baseline,ceiling:true,gravityBlend:.5}).gravityTilt,-.48,'Reduced motion cuts to the destination with the camera at the transfer midpoint');
assert.equal(pose('dreamisland').domeOpen,0);assert.equal(pose('dreamisland',12,{night:1}).domeOpen,5.8);
assert.equal(pose('afterglow',12,{relay:'strike'}).alert,true);assert.equal(pose('afterglow').alert,false);
for(const kind of ['greenwater','bitterpan','nightshift','polarity','tideline','ascension','dreamisland','afterglow','frostline']){
  const a=circuitSignaturePose(kind,10,true,baseline),b=circuitSignaturePose(kind,100,true,baseline);
  assert.deepEqual(a,b,`${kind}: reduced motion freezes ambient cycles`);
  assert.deepEqual(pose(kind),pose(kind),`${kind}: clock pose repeats`);
}
const manifest=JSON.parse(readFileSync('public/assets/circuit-signatures/manifest.json','utf8'));
const heroes={greenwater:'survey_plane',bitterpan:'bucket_wheel',nightshift:'washer_0',polarity:'gravity_cradle',tideline:'inspection_rov',ascension:'valve_left',dreamisland:'dome_left',afterglow:'relay_fan_left',frostline:'snow_groomer'};
assert.equal(manifest.length,9);
for(const row of manifest){
  const b=readFileSync(`public/assets/circuit-signatures/${row.circuit}.glb`);
  assert.equal(b.toString('ascii',0,4),'glTF');assert.equal(b.readUInt32LE(4),2);assert.equal(b.length,row.bytes);
  const j=JSON.parse(b.toString('utf8',20,20+b.readUInt32LE(12)));
  assert.ok(j.nodes.some(n=>n.name===heroes[row.circuit]&&n.children?.length));
  assert.ok(j.nodes.some(n=>n.name==='static_signature_paint'));
  const triangles=j.meshes.flatMap(m=>m.primitives).reduce((total,p)=>total+j.accessors[p.indices].count/3,0);
  assert.equal(triangles,row.triangles);assert.ok(triangles<6000);assert.ok(b.length<660000);
  assert.ok(j.images.some(i=>i.mimeType==='image/jpeg'),'Shared generated atlas is embedded');
  assert.ok(j.nodes.every(n=>!n.scale||n.scale.every(v=>v>0)),'No mirrored/negative-scale models');
}
console.log('Circuit signatures PASS: nine articulated originals, bounded GLBs, deterministic/reduced motion, gravity, drain, deluge, day/night and relay presentation.');
