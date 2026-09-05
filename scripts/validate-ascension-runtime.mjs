import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {AscensionSchedule} from '../src/game/ascension-schedule.js';
import {sourceModule} from './visual/ascension/modules.mjs';
const config=JSON.parse(readFileSync('src/game/data/ascension/schedule.json'));
assert.ok(config,'Run build-ascension-route.mjs --calibration=<Works browser capture> first');
const signatures=[];
for(const hz of [60,120,240]){
 const s=new AscensionSchedule(config);let remainder=0;
 for(let frame=0;frame<hz*120;frame++){remainder+=120/hz;const ticks=Math.floor(remainder);remainder-=ticks;s.advanceTicks(ticks,Math.floor(s.tick/120/config.worksLapSeconds)+1);}
 signatures.push(s.snapshot());
}
assert.deepEqual(signatures[0],signatures[1]);assert.deepEqual(signatures[1],signatures[2]);
const clock=new AscensionSchedule(config);clock.advanceTicks(config.launchTick-1,3);
const saved=clock.snapshot();clock.advanceTicks(1,3);assert.equal(clock.state.trenchOpen,false);assert.equal(clock.state.steam,true);
clock.restore(saved);clock.advanceTicks(1,3);assert.equal(clock.events.filter(e=>e.id==='launch').length,1);
clock.advanceTicks(20*120,3);assert.equal(clock.state.trenchOpen,true);assert.equal(clock.grip('TRENCH'),.72);
const {AscensionCourse}=await import(await sourceModule('ascension-course.ts'));
const c=new AscensionCourse(),middle=(c.shortcut.from+c.shortcut.to)/2;
const inside=c.sampleShortcut(middle).position.clone();assert.equal(c.project(inside,middle).alternateRoad,true);
c.advanceSchedule(config.launchTick);assert.equal(c.project(inside,middle).alternateRoad,true,'Driver inside must retain the trench at closure');
for(let u=middle;u<c.shortcut.to;u+=.001){const p=c.sampleShortcut(u).position;c.project(p,u);}
c.project(c.sample(c.shortcut.to+.02).position,c.shortcut.to+.02);
assert.equal(c.project(inside,middle).alternateRoad,false,'Closed entry must refuse new traversal');
const report={script:'scripts/validate-ascension-runtime.mjs',config,renderRates:[60,120,240],windowSeconds:120,expectedTicks:120*120,ticks:signatures.map(s=>s.tick),snapshotRestore:true,insideAtClosure:true,entryRefused:true};
writeFileSync('art/evidence/ascension-v1/phase-a/runtime-validation.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
