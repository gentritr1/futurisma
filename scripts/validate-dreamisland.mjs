import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import * as THREE from 'three';
import {sourceModule} from './visual/dreamisland/modules.mjs';
import {simulateRivalField} from './lib/rival-field-sim.mjs';
import {applyPaceTier} from '../src/game/race-modes-rules.js';
import {VEHICLE_CLEARANCE_METERS} from '../src/game/rival-race.js';
import {DREAMISLAND_ABILITY_CONFIG,DREAMISLAND_FIELDS,dreamislandFieldAt} from '../src/game/dreamisland-powers-config.js';
import {disposeObject3DResources} from '../src/game/graphics-resources.js';

const read=name=>JSON.parse(readFileSync(new URL(name,import.meta.url),'utf8'));
const route=read('../src/game/data/dreamisland/route.json');
const schedule=read('../src/game/data/dreamisland/schedule.json');
const pace=read('../src/game/data/dreamisland/rival-pace.json');
const {DreamIslandCourse}=await import(await sourceModule('dreamisland-course.ts'));
const course=new DreamIslandCourse();
const close=(actual,expected,tolerance,label)=>assert.ok(Math.abs(actual-expected)<=tolerance,`${label}: ${actual} versus ${expected}.`);
const circularGap=(a,b)=>Math.abs(((a-b+1.5)%1)-.5);

// --- Identity and the seven authored districts.
assert.equal(course.kind,'dreamisland');
assert.equal(course.mapCode,'MAP 07');
assert.equal(course.halfWidth,12);
assert.equal(course.defaultLapCount,3);
assert.equal(course.minimumLapCount,1);
assert.equal(course.maximumLapCount,9);
assert.equal(course.startProgress,.002);
assert.equal(course.timeOfDayStops,null);
assert.equal(course.orderedCheckpointCount,8);
assert.equal(course.checkpointCount,7);
assert.equal(route.stations.length,route.count);
assert.equal(route.flightArcs.length,0);
close(route.length,2400,25,'Authored lap length');
assert.equal(route.districts.length,7);
assert.equal(route.districts[0].from,0,'The first district must start the lap.');
const WIDTHS={BEACH:26,GROVE:22,POINT:14,BASIN:20,COURT:24,REEF:26,CUT:22};
const LENGTHS={BEACH:300,GROVE:380,POINT:260,BASIN:300,COURT:340,REEF:460,CUT:360};
route.districts.forEach((district,index)=>{
  assert.equal(district.width,WIDTHS[district.id],`${district.id} authored width`);
  const to=route.districts[index+1]?.from??1;
  assert.ok(to>district.from,'Districts must run forward around the lap.');
  close((to-district.from)*route.length,LENGTHS[district.id],4,`${district.id} district length`);
});

// --- The route data itself: continuity, unit tangents, the fold guard, pitch.
let physicalLength=0,maximumPitch=0,maximumCurvature=0,minimumGap=Infinity,maximumGap=0;
for(let index=0;index<route.count;index++){
  const station=route.stations[index],next=route.stations[(index+1)%route.count];
  assert.ok([...station.p,...station.t,station.d,station.width,station.curvature].every(Number.isFinite),
    `Station ${index} carries a non-finite value.`);
  const gap=Math.hypot(...station.p.map((value,axis)=>value-next.p[axis]));
  // The closing seam is included: index count-1 wraps to station 0.
  assert.ok(gap>2.8&&gap<3.05,`Broken route seam at ${index}: ${gap} m.`);
  minimumGap=Math.min(minimumGap,gap);maximumGap=Math.max(maximumGap,gap);
  physicalLength+=gap;
  close(Math.hypot(...station.t),1,1e-6,`Normalized route tangent at ${index}`);
  maximumPitch=Math.max(maximumPitch,Math.abs(Math.asin(station.t[1])));
  maximumCurvature=Math.max(maximumCurvature,Math.abs(station.curvature));
  assert.ok(Math.abs(station.curvature)*station.width/2<.8,`Road inner edge folds at ${index}.`);
  assert.ok(WIDTHS[station.sector]!==undefined,`Station ${index} names an unknown district.`);
  assert.ok(station.width>=13.9&&station.width<=26.1,`Station ${index} width ${station.width} leaves the authored table.`);
}
close(physicalLength,route.length,1,'Physical route length');
assert.ok(maximumPitch*180/Math.PI<10.5,`Maximum pitch ${maximumPitch*180/Math.PI} degrees.`);
const minimumRadius=1/maximumCurvature;
assert.ok(minimumRadius>30,`Minimum turn radius ${minimumRadius} m is under the absolute floor.`);

// --- The sampled road: orthonormal basis, the Clock Court bank, and nothing
// anywhere else. Bank is RADIANS here, applied by rotating about the tangent.
const sample=course.createSampleScratch(),projection=course.createProjectionScratch(),point=new THREE.Vector3();
const COURT_FROM=route.districts[4].from,COURT_TO=route.districts[5].from;
let maximumBank=0,maximumProjectionError=0,maximumLateralError=0,projections=0;
for(let index=0;index<route.count;index++){
  const progress=(index+.37)/route.count;
  course.sample(progress,sample);
  close(sample.tangent.length(),1,1e-7,'Unit tangent');
  close(sample.right.length(),1,1e-7,'Unit right');
  close(sample.up.length(),1,1e-7,'Unit up');
  close(sample.tangent.dot(sample.right),0,1e-7,'Tangent/right orthogonality');
  close(sample.tangent.dot(sample.up),0,1e-7,'Tangent/up orthogonality');
  close(sample.right.dot(sample.up),0,1e-7,'Right/up orthogonality');
  close(new THREE.Matrix4().makeBasis(sample.right,sample.up,sample.tangent.clone().negate()).determinant(),1,1e-7,
    'Craft basis remains a rotation');
  assert.ok(sample.up.y>.98,'The road roll and pitch are too steep for a stable horizon.');
  const inCourt=progress>COURT_FROM&&progress<COURT_TO;
  if(!inCourt)close(sample.bank,0,1e-12,'Only the Clock Court banks');
  else assert.ok(sample.bank>0&&sample.bank<=.055+1e-12,`Court bank ${sample.bank} rad out of range`);
  maximumBank=Math.max(maximumBank,sample.bank);
  // `right` starts horizontal, so after the roll its vertical component is
  // exactly cos(pitch)*sin(bank). Any other roll would be an authoring mistake.
  close(Math.abs(sample.right.y),Math.cos(Math.asin(sample.tangent.y))*Math.sin(sample.bank),1e-9,
    'Roll comes from the bank alone');
  for(const lateral of [-6,0,6])for(const vertical of [-20,.96,20]){
    // Height lag during a hop must not distort the nearest XZ route. On the
    // banked court the recovered lateral picks up the roll of `right`, which is
    // exactly `vertical * right.y` and is predicted rather than tolerated.
    point.copy(sample.position).addScaledVector(sample.right,lateral);
    point.y+=vertical;
    course.project(point,progress,projection);
    const expected=lateral+vertical*sample.right.y;
    maximumLateralError=Math.max(maximumLateralError,Math.abs(projection.lateral-expected));
    close(projection.lateral,expected,.09,'Lateral projection');
    const error=circularGap(projection.progress,progress)*route.length;
    maximumProjectionError=Math.max(maximumProjectionError,error);
    assert.ok(error<.35,`Projection drifts ${error} m at ${index}.`);
    projections++;
  }
}
close(maximumBank,.055,2e-3,'Clock Court peak bank');
for(const progress of [.001,.15,.29,.49,.69,.81,.999]){
  const at=course.sample(progress);
  course.project(at.position,(progress+.4)%1,projection);
  assert.ok(circularGap(projection.progress,progress)*route.length<.1,'A stale hint must recover globally.');
}

// --- Eight ordered gates and a recovery that cannot skip one.
assert.equal(route.checkpoints.length,8);
assert.equal(route.checkpoints[0],0);
for(let i=0;i<route.checkpoints.length;i++){
  const checkpoint=route.checkpoints[i],next=route.checkpoints[i+1]??1;
  assert.ok(next>checkpoint,'Gates must ascend around the lap.');
  close(course.checkpointProgress(i),checkpoint,1e-12,'Gate identity');
  assert.ok(course.checkpointHalfWidth(i)>0);
  for(const progress of [-.2,.1,.55,.99,1.7]){
    const recovered=course.recoveryProgressFor(progress,i);
    assert.ok(recovered>checkpoint&&recovered<next,'Recovery cannot skip the next required checkpoint.');
  }
}

// --- The apron table and the boundary it draws.
const apron=course.apronAt(course.sample(0),20);
assert.equal(apron.wall,true);
close(apron.lateralLimit,course.sample(0).halfWidth-2.05,1e-9,'Deck margin');
assert.equal(course.edgeType(),'A');
assert.equal(course.travelModeAt(0),'surface');
assert.ok(Number.isNaN(course.cablePassLateralMeters()));
assert.equal(course.boostPadLaneAt(),null);
assert.equal(course.rivalGridStart(),null);
assert.equal(course.audioZoneAt(.3375),'underpass','The watchtower bore is an enclosed room.');
assert.equal(course.audioZoneAt(.05),'open');

// --- The published schedule reproduces from the capture it names.
assert.ok(!schedule.bootstrap,'A bootstrap schedule is inert; run the calibration and rebuild.');
const capture=JSON.parse(readFileSync(new URL('../'+schedule.measurement,import.meta.url),'utf8'));
assert.equal(capture.errors.length,0,'The named calibration contains browser errors.');
const laps=capture.diagnostics.current.lapTimesMs;
assert.equal(laps.length,3,'The named calibration did not complete three laps.');
const worksLap=(laps[1]+laps[2])/2000;
close(schedule.worksLapSeconds,worksLap,1e-9,'Works lap time');
const tick=factor=>Math.round(factor*worksLap*120);
assert.equal(schedule.chimeTick,tick(1.85));
assert.equal(schedule.strikeTick,tick(2.05));
assert.equal(schedule.fishRiseTick,schedule.strikeTick+4*120);
assert.equal(schedule.nightSettledTick,schedule.strikeTick+12*120);
assert.equal(schedule.nightRampTicks,12*120);
assert.deepEqual(schedule.events.map(e=>e.id),['chime-warning','strike','fish-rise','night-settled']);
for(let i=0;i<schedule.events.length;i++){
  assert.ok(schedule.events[i].tick>0,'An event at tick 0 can never fire and breaks restore().');
  assert.ok(i===0||schedule.events[i].tick>=schedule.events[i-1].tick,'restore() rebuilds sequence from array order.');
  assert.ok(Number.isSafeInteger(schedule.events[i].tick));
}
// The final lap is the night lap: the strike lands after the second flying lap.
assert.ok(schedule.strikeTick/120>laps[0]/1000+laps[1]/1000,'The strike must fall inside the last lap.');

// --- Powers. `validConfig` throws at construction, so the shape is asserted here.
assert.equal(DREAMISLAND_ABILITY_CONFIG.id,'dream-island-powers-v1');
assert.ok(/^[a-z0-9-]{1,80}$/.test(DREAMISLAND_ABILITY_CONFIG.id));
assert.equal(DREAMISLAND_ABILITY_CONFIG.allowGravity,false);
assert.deepEqual(DREAMISLAND_ABILITY_CONFIG.transferWindows,[]);
assert.equal(DREAMISLAND_ABILITY_CONFIG.pickups.length,5);
assert.equal(DREAMISLAND_ABILITY_CONFIG.launchZones.length,2);
assert.equal(DREAMISLAND_FIELDS.length,1);
assert.equal(DREAMISLAND_FIELDS[0].halfWidth,3.8);
assert.deepEqual(DREAMISLAND_ABILITY_CONFIG.fieldIds,DREAMISLAND_FIELDS.map(f=>f.id));
for(const pickup of DREAMISLAND_ABILITY_CONFIG.pickups){
  const at=course.sample(pickup.progress);
  assert.equal(pickup.lane,0);
  assert.ok(Math.abs(pickup.lateral)<=at.halfWidth-2.05,`${pickup.id} sits outside the drivable deck.`);
}
const pickupSectors=new Set(DREAMISLAND_ABILITY_CONFIG.pickups.map(p=>course.sample(p.progress).sector));
assert.equal(pickupSectors.size,5);
assert.ok(!pickupSectors.has('POINT')&&!pickupSectors.has('BASIN'),'The pinch and the causeway carry no device.');
for(const zone of DREAMISLAND_ABILITY_CONFIG.launchZones){
  close(zone.to-zone.from,.02,1e-9,`${zone.id} strip width`);
  assert.equal(zone.lane,0);
}
assert.deepEqual(DREAMISLAND_ABILITY_CONFIG.launchZones.map(z=>course.sample(z.from).sector),['BEACH','REEF']);
const field=DREAMISLAND_FIELDS[0];
assert.equal(course.sample(field.progress).sector,'POINT','The bulkhead belongs to the watchtower bore.');
assert.ok(field.halfWidth+2.3<course.sample(field.progress).halfWidth,'A rival must be able to clear the bulkhead inside the bore.');
assert.ok(dreamislandFieldAt(field.progress,0,route.length));
assert.equal(dreamislandFieldAt(field.progress,9,route.length),undefined);
assert.equal(dreamislandFieldAt(.5,0,route.length),undefined);

// --- Rival pace: the shared constants, and three tiers that finish in order.
assert.equal(pace.cornerSpeedGain,.25);
assert.equal(pace.cornerSpeedFloor,.72);
assert.equal(pace.noBlockSide,-1);
assert.equal(pace.driftCurvature,.55);
assert.equal(pace.straightCurvature,.13);
assert.deepEqual(Object.keys(pace.profiles),['rival-privateer','rival-nightform','rival-needle']);
assert.deepEqual(Object.keys(pace.tiers),['rookie','feral']);
if(pace.unsolved)console.warn('Dream Island rival pace is UNSOLVED: carried-over speeds are in place.');
const fieldCourse={
  kind:course.kind,length:course.length,startProgress:course.startProgress,startLateral:course.startLateral,
  sample(progress){const s=course.sample(progress,sample);return {curvature:s.curvature,halfWidth:s.halfWidth};},
  gridStart:identity=>course.rivalGridStart(identity),
  boostPadLaneAt:(...args)=>course.boostPadLaneAt(...args),
  isOnBoostPad:()=>false,
  rivalHazardLaneAt:(...args)=>course.rivalHazardLaneAt(...args),
};
const times=[];
for(const tier of ['rookie','works','feral']){
  const tiered=applyPaceTier(course.rivalPace,tier);
  const runs=[60,120,240].map(hz=>simulateRivalField({course:fieldCourse,pace:tiered,totalLaps:3,
    renderDeltaSeconds:1/hz,maximumSeconds:220}));
  const reference=runs[1];
  for(const run of runs){
    assert.ok(run.minimumRivalSeparationMeters>=VEHICLE_CLEARANCE_METERS,`${tier}: rival hulls overlap.`);
    assert.deepEqual(run.states.map(s=>s.finishTimeSeconds),reference.states.map(s=>s.finishTimeSeconds),
      `${tier}: the fleet is not render-rate independent.`);
    for(const state of run.states)assert.ok(state.finished&&Number.isFinite(state.finishTimeSeconds));
  }
  times.push(Math.min(...reference.states.map(s=>s.finishTimeSeconds)));
  console.log(`Dream Island ${tier}: ${reference.states.map(s=>s.finishTimeSeconds.toFixed(2)).join(' / ')} s; fleet separation ${reference.minimumRivalSeparationMeters.toFixed(2)} m.`);
}
assert.ok(times[0]>times[1]+1&&times[1]>times[2]+1,'The three tiers must finish in order.');

// --- The blockout the course itself owns.
const road=course.group.getObjectByName('dreamisland_blockout_road');
assert.ok(road?.isMesh&&road.material.isMeshLambertMaterial,'The road must respond to the real lights.');
assert.equal(road.material.toneMapped,true);
assert.notEqual(road.material.fog,false);
const markers=course.group.getObjectByName('dreamisland_blockout_markers');
assert.ok(markers?.isInstancedMesh);
const stripMarks=DREAMISLAND_ABILITY_CONFIG.launchZones.reduce((total,zone)=>{
  let marks=0;for(let d=Math.ceil(zone.from*route.length);d<zone.to*route.length;d+=7)marks++;return total+marks;},0);
assert.equal(markers.count,(route.checkpoints.length+stripMarks+DREAMISLAND_FIELDS.length)*2+DREAMISLAND_ABILITY_CONFIG.pickups.length,
  'Gates, both launch strips, the bulkhead posts and the five devices share one instanced draw.');
assert.equal(course.deviceMarkerOffset,(route.checkpoints.length+stripMarks+DREAMISLAND_FIELDS.length)*2,
  'The device markers the powers module tints must be the last block of instances.');
assert.equal(course.group.children.filter(child=>child.isMesh||child.isInstancedMesh).length,2,
  'The course spends two draws; the painted island is nine more in dreamisland-painted-environment.ts.');

// Phase C: `--out=` so a route revision cannot overwrite the evidence of an
// earlier phase. Default stays the phase directory this validator was written
// for, and a relative path is resolved against the repo root, which is where
// every validator here is run from.
const outFlag=process.argv.find(a=>a.startsWith('--out='))?.slice(6);
const out=outFlag?new URL(outFlag.replace(/\/?$/,'/'),new URL('../',import.meta.url))
 :new URL('../art/evidence/dreamisland-v1/phase-a/',import.meta.url);
mkdirSync(out,{recursive:true});
const report={script:'scripts/validate-dreamisland.mjs',routeMetres:route.length,stations:route.count,
  spacing:{minimum:minimumGap,maximum:maximumGap,summedMetres:physicalLength},
  maximumCurvature,minimumRadiusMetres:minimumRadius,maximumPitchDegrees:maximumPitch*180/Math.PI,
  courtPeakBankRadians:maximumBank,orderedGates:route.checkpoints.length,
  projection:{samples:projections,expectedSamples:route.count*9,worstProgressErrorMetres:maximumProjectionError,
    worstLateralErrorMetres:maximumLateralError,note:'Spatial sweep over every station at three laterals and three heights; not a timed sample window.'},
  schedule:{reproducedFrom:schedule.measurement,worksLapSeconds:schedule.worksLapSeconds,
    ticks:{chime:schedule.chimeTick,strike:schedule.strikeTick,fishRise:schedule.fishRiseTick,nightSettled:schedule.nightSettledTick}},
  pace:{unsolved:!!pace.unsolved,tierFinishSeconds:times},
  scope:'Route geometry, sampling, gates, apron, powers configuration, published schedule provenance and the isolated rival model. Not a rendered frame and not a browser soak.'};
writeFileSync(new URL('route-validation.json',out),JSON.stringify(report,null,2));
disposeObject3DResources(course.group);
console.log(`Dream Island course PASS: ${route.length.toFixed(1)} m over ${route.count} stations, gaps ${minimumGap.toFixed(4)}-${maximumGap.toFixed(4)} m including the closing seam; 8 ordered gates; minimum radius ${minimumRadius.toFixed(1)} m, max pitch ${(maximumPitch*180/Math.PI).toFixed(2)} degrees, court bank ${maximumBank.toFixed(4)} rad and no roll elsewhere; ${projections} height-independent projections, worst error ${maximumProjectionError.toFixed(3)} m; schedule reproduces from ${schedule.measurement}.`);
