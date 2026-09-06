import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {AscensionEventPose,CRAWLER_CROSSING_TICKS,BELT_LENGTH,beltPose} from '../src/game/ascension-event-pose.js';
const out='art/evidence/ascension-v1/phase-c';mkdirSync(out,{recursive:true});
const route=JSON.parse(readFileSync('src/game/data/ascension/route.json')),config=JSON.parse(readFileSync('src/game/data/ascension/schedule.json'));
const buffer=readFileSync('public/assets/ascension/painted.glb'),size=buffer.readUInt32LE(12),json=JSON.parse(buffer.subarray(20,20+size));
json.buffers[0].uri='data:application/octet-stream;base64,'+buffer.subarray(28+size).toString('base64');json.materials=[{doubleSided:true}];delete json.images;delete json.textures;delete json.samplers;for(const m of json.meshes)for(const p of m.primitives)p.material=0;
globalThis.ProgressEvent??=class{constructor(type,values){Object.assign(this,{type},values);}};
const {scene}=await new GLTFLoader().parseAsync(JSON.stringify(json),'');scene.updateMatrixWorld(true);
const crawler=scene.getObjectByName('crawler-transporter_1'),platform=scene.getObjectByName('rocket-platform_0'),rocket=platform.children.find(o=>o.name.startsWith('rocket-ascent'));
assert.ok(crawler&&platform&&rocket);const pose=new AscensionEventPose(config,crawler.position.clone()),rocketBase=rocket.position.clone();
assert.ok(readFileSync('src/game/ascension-course.ts','utf8').includes('target.bank=wrapped>.08&&wrapped<.16 ? .04*Math.sin'), 'Review the bank envelope if the course banking changes');
const bankEdgeAllowance=Math.max(...route.stations.map(s=>s.width/2))*Math.sin(.04);
const maxRoadHeight=Math.max(...route.stations.map(s=>s.p[1]),...route.shortcut.stations.map(s=>s.p[1]))+bankEdgeAllowance;
let crawlerMinimum=Infinity,crawlerSamples=0;const box=new THREE.Box3();
for(const event of pose.crossings)for(let offset=0;offset<=CRAWLER_CROSSING_TICKS;offset++){
 const p=pose.at(event.tick+offset);crawler.position.copy(p.crawler);crawler.rotation.y=Math.PI/2;crawler.updateMatrixWorld(true);box.setFromObject(crawler);crawlerMinimum=Math.min(crawlerMinimum,box.min.y-maxRoadHeight);crawlerSamples++;
}
// A conservative projected AABB over every corridor sample, expanded by the road's
// half-width, cannot miss a solid overlap. False positives fail rather than pass.
let launchMinimum=Infinity,launchSamples=0,overlappingProbes=0;const violations=[];
for(let tick=config.launchTick;tick<=config.rocketGoneTick;tick++){
 const p=pose.at(tick);rocket.position.copy(rocketBase);rocket.position.y+=p.rocketHeight;rocket.updateMatrixWorld(true);box.setFromObject(rocket);
 for(const [name,stations] of [['main',route.stations],['trench',route.shortcut.stations]])for(const st of stations){
  const half=name==='trench'?10:st.width/2;
  if(st.p[0]+half<box.min.x||st.p[0]-half>box.max.x||st.p[2]+half<box.min.z||st.p[2]-half>box.max.z)continue;
  const clearance=box.min.y-st.p[1];launchMinimum=Math.min(launchMinimum,clearance);overlappingProbes++;if(clearance<9)violations.push({tick,name,clearance});
 }
 launchSamples++;
}
// Every plate corner stays within the 4 m tall, 12 m long envelope throughout
// one complete belt revolution. Sampling includes both equal endpoints.
let beltMinimum=Infinity,beltMaximum=-Infinity,beltExtent=0;
const radius=Math.hypot(2,.255),fy=2/radius,fz=6/(4+radius);
for(let sample=0;sample<=720;sample++)for(let j=0;j<48;j++){
 const p=beltPose((sample/720+j/48)*BELT_LENGTH);
 for(const y of [-.1,.1])for(const z of [-.255,.255]){
  const py=2+(p.y-2+y*Math.cos(p.angle)-z*Math.sin(p.angle))*fy;
  const pz=(p.z+y*Math.sin(p.angle)+z*Math.cos(p.angle))*fz;
  beltMinimum=Math.min(beltMinimum,py);beltMaximum=Math.max(beltMaximum,py);beltExtent=Math.max(beltExtent,Math.abs(pz));
 }
}
assert.ok(beltMinimum>=-1e-8&&beltMaximum<=4+1e-8&&beltExtent<=6+1e-8);
const snapshotA=JSON.stringify(pose.at(config.launchTick+120)),snapshotB=JSON.stringify(pose.at(config.launchTick+120));assert.equal(snapshotA,snapshotB);
const armMinimum=Math.min(...platform.children.filter(o=>o.name.startsWith('swing-arm-pivot')).map(o=>new THREE.Box3().setFromObject(o).min.y-maxRoadHeight));assert.ok(armMinimum>=9);
const flameBase=new THREE.Box3().setFromObject(rocket).min.y-pose.at(config.rocketGoneTick).rocketHeight-2;
const flameRoad=route.shortcut.stations.filter(st=>Math.hypot(st.p[0]-platform.position.x,st.p[2]-platform.position.z)<20);
const flameMinimum=Math.min(...flameRoad.map(st=>flameBase-st.p[1]));assert.ok(flameMinimum>=9);
const report={swingArms:{minimumClearanceMetres:armMinimum,note:'Rotation is about the vertical hinge axis, so the measured minimum Y is invariant over the entire swing; compared conservatively with the highest road anywhere.'},flame:{minimumClearanceMetres:flameMinimum,baseY:flameBase,note:'Flame and engine glow begin two metres below the measured authored nozzle envelope, entirely above the running lane.'},script:'scripts/validate-ascension-events.mjs',sha256:createHash('sha256').update(buffer).digest('hex'),scope:'Exported painted crawler and rocket geometry using production spline/ascent pose. Crawler vertical AABB is checked against the maximum centreline height plus the widest half-road times sin(maximum bank), a conservative global edge-height bound. Rocket projected AABB is checked against every route station expanded by full road half-width. Transparent effects are not solid obstructions. Runtime belt bounds are separately constrained to the approved 4m envelope.',belt:{minimumY:beltMinimum,maximumY:beltMaximum,maximumAbsoluteZ:beltExtent,phaseSamples:721,platesPerTrack:48,note:'Spatial phase samples over a full revolution, including repeated endpoint; not a timed rendering sample.'},crawler:{bankEdgeAllowanceMetres:bankEdgeAllowance,minimumClearanceMetres:crawlerMinimum,samples:crawlerSamples,windowSecondsPerCrossing:CRAWLER_CROSSING_TICKS/120,hz:120,crossings:2,expectedSamples:2*(CRAWLER_CROSSING_TICKS+1),reconciliation:'2 × (6 seconds × 120 Hz + 1 inclusive endpoint)'},launch:{minimumClearanceMetres:launchMinimum,samples:launchSamples,windowSeconds:(config.rocketGoneTick-config.launchTick)/120,hz:120,expectedSamples:config.rocketGoneTick-config.launchTick+1,overlappingSpatialProbes:overlappingProbes,reconciliation:'window seconds × 120 Hz + 1 inclusive endpoint'},violations,accepted:crawlerMinimum>=9&&launchMinimum>=9&&!violations.length};
writeFileSync(out+'/event-clearance.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));assert.ok(report.accepted);assert.equal(crawlerSamples,report.crawler.expectedSamples);assert.equal(launchSamples,report.launch.expectedSamples);
