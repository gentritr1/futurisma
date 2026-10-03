import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {sourceModule} from '../visual/dreamisland/modules.mjs';
import {TRACK_CODES} from '../../src/game/save-schema.js';
import {CIRCUIT_CODES} from '../../src/game/garage-rules.js';
const {AfterglowCourse}=await import(await sourceModule('afterglow-course.ts'));
const course=new AfterglowCourse();
assert.ok(TRACK_CODES.includes(course.kind)&&CIRCUIT_CODES.includes(course.kind));
assert.equal(course.orderedCheckpointCount,course.checkpointCount+1);
assert.ok(course.length>2500&&course.length<2900);
assert.ok(course.sample(0).position.distanceTo(course.sample(1).position)<1e-7);
const step=course.length/960;
let minimumRoadSeparation=Infinity;
for(let i=0;i<960;i++){
  const p=i/960,s=course.sample(p),next=course.sample((i+1)/960);
  assert.ok(Math.abs(s.position.distanceTo(next.position)-step)<.12,'Equal-distance route stations');
  assert.ok(Math.abs(s.tangent.length()-1)<1e-7&&Math.abs(s.right.dot(s.tangent))<1e-7,'Orthonormal road basis');
  assert.ok(s.tangent.dot(next.tangent)>.98,'No tangent discontinuity');
  for(const lateral of [-10,0,10]){
    const point=s.position.clone().addScaledVector(s.right,lateral),projected=course.project(point,p);
    assert.ok(Math.abs(projected.lateral-lateral)<.14,'Projection must preserve lateral position');
    assert.ok(Math.abs(((projected.progress-p+1.5)%1)-.5)*course.length<(lateral===0?.001:step*.65),'Projection stays within its intended road segment');
    const apron=course.apronAt(s,lateral);assert.ok(apron.wall&&apron.lateralLimit>11,'Physical track boundary');
  }
  if(i%6===0)for(let j=i+24;j<960;j+=6){if(Math.min(j-i,960-j+i)<24)continue;minimumRoadSeparation=Math.min(minimumRoadSeparation,s.position.distanceTo(course.sample(j/960).position));}
}
assert.ok(minimumRoadSeparation>28,'Distant course sections must not overlap');
for(const tier of ['rookie','feral'])for(const id of Object.keys(course.rivalPace.profiles))assert.ok(tier==='rookie'?course.rivalPace.tiers[tier].profiles[id].cruiseSpeedMetersPerSecond<course.rivalPace.profiles[id].cruiseSpeedMetersPerSecond:course.rivalPace.tiers[tier].profiles[id].cruiseSpeedMetersPerSecond>course.rivalPace.profiles[id].cruiseSpeedMetersPerSecond);
for(const name of ['relay_dish','relay_terminal','relay_gate','relay_train','relay_palm']){
  const bytes=readFileSync('public/assets/afterglow/'+name+'.glb');assert.equal(bytes.toString('utf8',0,4),'glTF');
  const length=bytes.readUInt32LE(12),gltf=JSON.parse(bytes.toString('utf8',20,20+length));
  assert.ok(gltf.meshes.length>0&&gltf.nodes.some(n=>n.name===name),'Original Blender export identity: '+name);
  if(name==='relay_dish')assert.ok(gltf.nodes.some(n=>n.name==='dish_head'),'Dish animation pivot');
}
console.log(JSON.stringify({pass:true,length:course.length,stations:960,projectionChecks:2880,minimumRoadSeparation,models:5,gates:course.checkpointCount,tiers:3}));
