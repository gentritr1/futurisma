import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {DreamIslandSchedule} from '../src/game/dreamisland-schedule.js';
import {sourceModule} from './visual/dreamisland/modules.mjs';

const config=JSON.parse(readFileSync(new URL('../src/game/data/dreamisland/schedule.json',import.meta.url),'utf8'));
assert.ok(config&&!config.bootstrap,'Run build-dreamisland-route.mjs --calibration=<Works browser capture> first');

// --- Determinism across render rates. The window is 120 s of race at three
// render rates; every rate must land on the same absolute tick and the same
// event history, and the sample count is reconciled against window x rate.
const WINDOW_SECONDS=120,TICK_RATE=120;
const signatures=[],ticksSeen=[],framesSeen=[];
for(const hz of [60,120,240]){
  const clock=new DreamIslandSchedule(config);
  let remainder=0,frames=0;
  for(let frame=0;frame<hz*WINDOW_SECONDS;frame++){
    // Tideline's clamped derivation, which is what dreamisland-runtime.ts runs.
    remainder+=Math.max(0,Math.min(1/hz,.25))*TICK_RATE;
    const ticks=Math.floor(remainder+1e-7);
    remainder=Math.max(0,remainder-ticks);
    clock.advanceTicks(ticks,Math.floor(clock.tick/TICK_RATE/config.worksLapSeconds)+1);
    frames++;
  }
  signatures.push(clock.snapshot());ticksSeen.push(clock.tick);framesSeen.push(frames);
}
assert.deepEqual(signatures[0],signatures[1]);
assert.deepEqual(signatures[1],signatures[2]);
const expectedTicks=WINDOW_SECONDS*TICK_RATE;
for(const ticks of ticksSeen)assert.equal(ticks,expectedTicks,`Clocked ${ticks} ticks over ${WINDOW_SECONDS} s; expected ${expectedTicks}.`);
assert.equal(signatures[1].events.length,config.events.length,'Every published event must fire inside the window.');

// --- The tick contract itself.
const guard=new DreamIslandSchedule(config);
guard.advanceTicks(0,1);
assert.equal(guard.tick,0,'advanceTicks(0) is legal: the 240 Hz path calls it every other frame.');
assert.throws(()=>guard.advanceTicks(-1,1),/nonnegative integer/);
assert.throws(()=>guard.advanceTicks(1.5,1),/nonnegative integer/);
assert.ok(!config.events.some(e=>e.tick<=0),'An event at tick 0 can never fire and makes restore() throw.');

// --- Emission is a half-open window, and the derived state is rebuilt from the
// absolute tick, so a jump lands where a stepped clock would have.
const stepped=new DreamIslandSchedule(config);
for(let tick=0;tick<config.nightSettledTick+240;tick++)stepped.advanceTicks(1,1+Math.floor(tick/(config.worksLapSeconds*120)));
const jumped=new DreamIslandSchedule(config);
jumped.advanceTicks(config.nightSettledTick+240,stepped.lap);
assert.deepEqual(jumped.state,stepped.state,'A tick jump must land in the same derived state.');
assert.deepEqual(jumped.events.map(e=>e.id),stepped.events.map(e=>e.id));
const edge=new DreamIslandSchedule(config);
edge.advanceTicks(config.strikeTick-1,3);
assert.equal(edge.state.struck,false);
assert.equal(edge.events.filter(e=>e.id==='strike').length,0);
const saved=edge.snapshot();
edge.advanceTicks(1,3);
assert.equal(edge.state.struck,true,'The strike fires on its own tick, not the one after.');
assert.equal(edge.events.filter(e=>e.id==='strike').length,1);
edge.restore(saved);
assert.equal(edge.state.struck,false);
edge.advanceTicks(1,3);
assert.equal(edge.events.filter(e=>e.id==='strike').length,1,'Restore then replay must not double-fire an event.');
assert.throws(()=>edge.restore({...saved,tick:-1}),/Incompatible schedule snapshot/);
assert.throws(()=>edge.restore({...saved,events:[]}),/Incompatible event history/);

// --- Grip is a pure function of (sector, tick, lap) and reaches the craft only
// through course.surfaceGripAt.
const dry=new DreamIslandSchedule(config);
assert.equal(dry.grip('BASIN',config.strikeTick-1,3),1);
assert.equal(dry.grip('BASIN',config.strikeTick,3),.85);
for(const sector of ['BEACH','GROVE','POINT','COURT','REEF','CUT'])
  assert.equal(dry.grip(sector,config.nightSettledTick,3),1,`${sector} keeps full grip through the night.`);
assert.equal(new DreamIslandSchedule(null).grip('BASIN',10**6,3),1,'A calibrating race has no wet causeway.');

// --- The course drives the twelve-second ramp, and `?motion=reduce` steps it.
const {DreamIslandCourse}=await import(await sourceModule('dreamisland-course.ts'));
const course=new DreamIslandCourse();
const basin=course.sample(.45).sector;
assert.equal(basin,'BASIN');
assert.equal(course.nightBlend,0);
assert.equal(course.surfaceGripAt(.45),1);
course.advanceSchedule(config.strikeTick);
assert.equal(course.surfaceGripAt(.45),.85,'The wet causeway must reach the craft through surfaceGripAt.');
assert.equal(course.surfaceGripAt(.05),1);
assert.equal(course.nightBlend,0,'The ramp starts at the strike, not before it.');
const dayFog={...course.fogAt(0),color:course.fogAt(0).color.getHex()};
const dayLight=course.lightingAt(0).keyIntensity;
course.advanceSchedule(config.nightRampTicks/2);
const midBlend=course.nightBlend;
assert.ok(midBlend>.4&&midBlend<.6,`Half way through the ramp the blend is ${midBlend}.`);
const midLight=course.lightingAt(0).keyIntensity;
assert.ok(midLight<dayLight,'The key is already falling half way through the ramp.');
course.advanceSchedule(config.nightRampTicks/2);
assert.equal(course.nightBlend,1,'The ramp completes exactly at night-settled.');
const nightFog={...course.fogAt(0),color:course.fogAt(0).color.getHex()};
assert.ok(nightFog.density>dayFog.density,'Fog closes in at night.');
assert.notEqual(nightFog.color,dayFog.color);
assert.ok(course.lightingAt(0).keyIntensity<dayLight,'The key drops but is deliberately not zero: the shadow pass is armed once.');
assert.ok(course.lightingAt(0).keyIntensity>0,'A near-black key still pays a full shadow pass; keep it a moon.');

// Decision 6: under reduced motion the night arrives as a step at the SAME tick,
// so grip changes on the same tick in both modes and determinism holds.
globalThis.location={search:'?motion=reduce&seed=3868938316'};
const reduced=new DreamIslandCourse();
delete globalThis.location;
assert.equal(reduced.nightBlend,0);
reduced.advanceSchedule(config.strikeTick-1);
assert.equal(reduced.nightBlend,0);
assert.equal(reduced.surfaceGripAt(.45),1);
reduced.advanceSchedule(1);
assert.equal(reduced.nightBlend,1,'Reduced motion jumps 0 -> 1 at the strike with no ramp.');
assert.equal(reduced.surfaceGripAt(.45),.85,'Grip changes on the same tick in both motion modes.');

const out=new URL('../art/evidence/dreamisland-v1/phase-a/',import.meta.url);
mkdirSync(out,{recursive:true});
const report={script:'scripts/validate-dreamisland-runtime.mjs',config,
  determinism:{renderRates:[60,120,240],windowSeconds:WINDOW_SECONDS,tickRateHz:TICK_RATE,
    expectedTicks,ticks:ticksSeen,frames:framesSeen,
    expectedFrames:[60,120,240].map(hz=>hz*WINDOW_SECONDS),
    reconciliation:'frames = render rate x window seconds; ticks = 120 Hz x window seconds, identical at every render rate',
    identicalSnapshots:true},
  snapshotRestore:true,
  knownLimitation:'snapshot/restore has exactly one caller, this validator. Pause, resume and the save system do not snapshot the schedule; restore exists to make determinism provable, not to make pause deterministic.',
  grip:{sector:'BASIN',beforeStrike:1,afterStrike:.85,reachesCraftVia:'course.surfaceGripAt'},
  nightTurn:{rampTicks:config.nightRampTicks,midpointBlend:midBlend,settledBlend:1,
    reducedMotion:'step 0 -> 1 at strikeTick, same tick as the grip change'},
  scope:'Pure clock, grip and blend arithmetic in Node. Not a rendered crossfade: the sky and water are phases B and C and the five-point capture instrument does not exist yet.'};
writeFileSync(new URL('runtime-validation.json',out),JSON.stringify(report,null,2));
console.log(`Dream Island runtime PASS: 60/120/240 Hz identical over ${WINDOW_SECONDS} s (${framesSeen.join('/')} frames, ${ticksSeen.join('/')} ticks against an expected ${expectedTicks}); all ${config.events.length} events fired once; BASIN grip 1 -> .85 at tick ${config.strikeTick}; night blend 0 -> ${midBlend.toFixed(3)} -> 1 over ${config.nightRampTicks} ticks and a step at the same tick under ?motion=reduce.`);
