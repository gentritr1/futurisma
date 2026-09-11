import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import * as THREE from 'three';
import {DreamIslandSchedule} from '../src/game/dreamisland-schedule.js';
import {dreamIslandClockAngles} from '../src/game/dreamisland-clock.js';
import {RACE_MODES,SPRINT_LAP_COUNT,bestRecordKey,ghostRecordKey,resolveModeLapCount} from '../src/game/race-modes-rules.js';
import {GhostRecorder,MAX_GHOST_CHARACTERS} from '../src/game/ghost.js';
import {createSaveStore,parseSave} from '../src/game/save-schema.js';
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

// Phase C: `--out=` so a route revision cannot overwrite the evidence of an
// earlier phase. Default stays the phase directory this validator was written
// for, and a relative path is resolved against the repo root, which is where
// every validator here is run from.
// --- Decision 3: the fish are ambience and never an obstacle. The paths are
// authored in ROUTE space, so where one is over the road its `rise` is its
// height above the deck - but a Catmull-Rom overshoots between waypoints and a
// goldfish hangs 1.507 m below its own origin, so the floor is MEASURED here
// rather than read off the waypoints. This is a second implementation of the
// same rule from the same authored file: it repeats the spline and the two
// ramps in plain arithmetic and takes only the road geometry from the course,
// so a bug in `dreamisland-fish.ts` shows up as a disagreement rather than as
// two copies of one mistake agreeing.
const fishPaths=JSON.parse(readFileSync(new URL('../src/game/data/dreamisland/fish-paths.json',import.meta.url),'utf8'));
const clampUnit=t=>t<0?0:t>1?1:t;
const smoothstep=t=>{const x=clampUnit(t);return x*x*(3-2*x);};
const closedSpline=(values,u)=>{
  const count=values.length,scaled=((u%1)+1)%1*count;
  const i=Math.floor(scaled),t=scaled-i;
  const p0=values[(i-1+count)%count],p1=values[i%count],p2=values[(i+1)%count],p3=values[(i+2)%count];
  return .5*((2*p1)+(-p0+p2)*t+(2*p0-5*p1+4*p2-p3)*t*t+(-p0+3*p1-3*p2+p3)*t*t*t);
};
const FISH_HALF_WIDTH=3.013,FISH_LOWEST=fishPaths.fishLowestPointMetres;
const RISE_WINDOW=fishPaths.riseSeconds*TICK_RATE;
const worldOf=(progress,lateral,rise)=>{
  const sample=course.sample(((progress%1)+1)%1);
  const right=new THREE.Vector3().copy(sample.tangent).cross(new THREE.Vector3(0,1,0)).normalize();
  return {point:sample.position.clone().addScaledVector(right,lateral).setY(sample.position.y+rise),
    right,deck:sample.position.y,halfWidth:sample.halfWidth,centre:sample.position.clone()};
};
const fishReport=[];
let worstClearance=Infinity,worstRow=null,deckSamples=0;
for(const shoal of fishPaths.shoals){
  const progresses=shoal.path.map(p=>p.progress),laterals=shoal.path.map(p=>p.lateral),rises=shoal.path.map(p=>p.rise);
  // The whole rise plus two full circuits, one tick at a time: 120 Hz is the
  // finest the runtime can ever sample this at, so nothing can hide between
  // two samples of this sweep.
  const span=Math.ceil(RISE_WINDOW+shoal.periodSeconds*TICK_RATE*2);
  const offsets=shoal.fish.map(fish=>{
    const rest=worldOf(shoal.rest.progress,shoal.rest.lateral,shoal.rest.rise);
    const here=worldOf(fish.progress,fish.lateral,fish.rise);
    return {offset:here.point.clone().sub(rest.point),progressOffset:fish.progress-shoal.rest.progress,livery:fish.livery};
  });
  let shoalWorst=Infinity,shoalRow=null,shoalSamples=0;
  for(let since=0;since<=span;since++){
    const lift=smoothstep(since/(RISE_WINDOW*.6)),swim=smoothstep((since-RISE_WINDOW*.4)/(RISE_WINDOW*.6));
    const u=since/(shoal.periodSeconds*TICK_RATE);
    const progress=shoal.rest.progress+(closedSpline(progresses,u)-shoal.rest.progress)*swim;
    const lateral=shoal.rest.lateral+(closedSpline(laterals,u)-shoal.rest.lateral)*swim;
    const rise=shoal.rest.rise+(closedSpline(rises,u)-shoal.rest.rise)*lift;
    const centre=worldOf(progress,lateral,rise);
    const ahead=(()=>{
      const s2=since+6;
      const lift2=smoothstep(s2/(RISE_WINDOW*.6)),swim2=smoothstep((s2-RISE_WINDOW*.4)/(RISE_WINDOW*.6));
      const u2=s2/(shoal.periodSeconds*TICK_RATE);
      return worldOf(shoal.rest.progress+(closedSpline(progresses,u2)-shoal.rest.progress)*swim2,
        shoal.rest.lateral+(closedSpline(laterals,u2)-shoal.rest.lateral)*swim2,
        shoal.rest.rise+(closedSpline(rises,u2)-shoal.rest.rise)*lift2).point;
    })();
    const heading=Math.atan2(ahead.x-centre.point.x,ahead.z-centre.point.z);
    const turn=(((heading-shoal.startHeadingYaw+Math.PI)%(Math.PI*2))+Math.PI*2)%(Math.PI*2)-Math.PI;
    const rotation=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),turn*swim);
    for(const fish of offsets){
      const world=fish.offset.clone().applyQuaternion(rotation).add(centre.point);
      const at=worldOf(progress+fish.progressOffset,0,0);
      const offset=world.clone().sub(at.centre).dot(at.right);
      if(Math.abs(offset)>at.halfWidth+FISH_HALF_WIDTH)continue;
      shoalSamples++;deckSamples++;
      const clearance=world.y+FISH_LOWEST-at.deck;
      if(clearance<shoalWorst){shoalWorst=clearance;shoalRow={since,livery:fish.livery,lateral:+offset.toFixed(3),clearance:+clearance.toFixed(3)};}
    }
  }
  if(shoalWorst<worstClearance){worstClearance=shoalWorst;worstRow={shoal:shoal.id,...shoalRow};}
  fishReport.push({id:shoal.id,batch:shoal.batch,fish:shoal.fish.length,periodSeconds:shoal.periodSeconds,
    ticksSwept:span+1,deckSamples:shoalSamples,
    minimumDeckClearanceMetres:Number.isFinite(shoalWorst)?+shoalWorst.toFixed(3):null,worst:shoalRow});
}
assert.ok(deckSamples>0,'No shoal ever passes over the deck, so the six metre rule was never tested. '
  +'Either the paths do not cross the road or the sweep is not measuring what it thinks.');
assert.ok(worstClearance>=fishPaths.minimumDeckClearanceMetres,
  `Decision 3 puts the fish at least ${fishPaths.minimumDeckClearanceMetres} m above the deck wherever a path crosses `
  +`the road; the worst point of the drift measures ${worstClearance.toFixed(3)} m: ${JSON.stringify(worstRow)}`);

// --- Phase D. The schedule per RACE FORMAT.
//
// The failure this section exists to catch is silent and total: a schedule
// authored as 2.05 lap-times fires nowhere inside a two-lap sprint, so the map
// loses the day-into-night turn that is its whole identity and every headless
// check still passes, because a race that never strikes has no missed gates and
// no slow laps. Every assertion below is therefore about WHEN an event lands
// relative to the end of the race it is running in, not about the tick itself.
const worksLapTicks=config.worksLapSeconds*TICK_RATE;
/** Runs one format's table for exactly the number of laps that format races,
 * one tick at a time, and reports what fired and in which lap. A real race is
 * not a metronome, so this is the schedule's own clock rather than a claim
 * about lap times; the lap boundary is the measured Works lap the whole file
 * was calibrated from, which is the same number every tick in it came from. */
const raceOut=(table,laps)=>{
  const clock=new DreamIslandSchedule({...table,modes:undefined});
  const fired=[];
  const total=Math.round(laps*worksLapTicks);
  for(let tick=1;tick<=total;tick++){
    const lap=Math.min(laps,Math.floor((tick-1)/worksLapTicks)+1);
    const before=clock.events.length;
    clock.advanceTicks(1,lap);
    for(const event of clock.events.slice(before))fired.push({id:event.id,tick:clock.tick,lap});
  }
  return {fired,totalTicks:total,state:clock.state};
};
const modeReport={};
for(const mode of RACE_MODES){
  const table=config.modes[mode];
  assert.deepEqual(dreamIslandClockAngles(0,table.strikeTick),{minute:0,hour:-Math.PI/2});
  assert.deepEqual(dreamIslandClockAngles(table.strikeTick,table.strikeTick),{minute:0,hour:0},
    `${mode}: the clock must be exactly 12:00 on the strike tick.`);
  assert.deepEqual(dreamIslandClockAngles(table.strikeTick+600,table.strikeTick),{minute:0,hour:0});
  assert.ok(table&&Number.isSafeInteger(table.strikeTick),`No ${mode} table in schedule.json.`);
  const run=raceOut(table,table.laps);
  const strikes=run.fired.filter(e=>e.id==='strike');
  assert.equal(strikes.length,1,`${mode}: the strike must fire exactly once in a ${table.laps}-lap race; it fired ${strikes.length} times.`);
  assert.deepEqual(run.fired.map(e=>e.id),['chime-warning','strike','fish-rise','night-settled'],
    `${mode}: every published event must land inside the race it is authored for.`);
  assert.equal(run.state.nightSettled,true,`${mode}: the night must be fully settled before the flag.`);
  // The night lap exists in every format. Sprint's is lap 2 of 2 by
  // construction (2.05/3 of a two-lap race is 1.367 L); race and time attack
  // keep lap 3 of 3.
  assert.equal(strikes[0].lap,mode==='sprint'?2:3,
    `${mode}: the strike landed in lap ${strikes[0].lap}, not the last lap.`);
  const settledTicks=run.totalTicks-table.nightSettledTick;
  assert.ok(settledTicks>0,`${mode}: the twelve-second ramp does not finish before the flag.`);
  modeReport[mode]={laps:table.laps,honoursLapOverride:table.honoursLapOverride,
    chimeFactor:table.chimeFactor,strikeFactor:table.strikeFactor,
    strikeTick:table.strikeTick,strikeSeconds:+(table.strikeTick/TICK_RATE).toFixed(3),
    strikeLap:strikes[0].lap,strikeLapFraction:+(table.strikeTick/worksLapTicks%1).toFixed(4),
    fractionOfRace:+(table.strikeTick/run.totalTicks).toFixed(4),
    raceTicks:run.totalTicks,settledNightTicks:settledTicks,
    settledNightSeconds:+(settledTicks/TICK_RATE).toFixed(2),
    fired:run.fired.map(e=>`${e.id}@lap${e.lap}`)};
}
// Every format strikes at the same fraction of its own race. That is the
// decision this phase made, stated as a number rather than as prose.
const fractions=RACE_MODES.map(mode=>modeReport[mode].fractionOfRace);
for(const fraction of fractions)assert.ok(Math.abs(fraction-fractions[0])<2e-4,
  `The strike must land at the same fraction of every format's race; got ${JSON.stringify(fractions)}.`);
// Time attack races the race table outright: same laps, same ticks. The solo
// run keeps the night turn because there is no field to hide it behind.
assert.deepEqual(config.modes.timeattack,config.modes.race,'Time attack races the race schedule.');

// `?laps=` on RACE, and why a short race is deliberately a day race. The
// override reaches `race` and `timeattack` and is clamped by the course's own
// bounds; it does NOT reach `sprint`, whose two laps are the format. An
// absolute schedule plus a one- or two-lap race therefore finishes in daylight,
// and that is the design rather than an oversight: the alternative is a night
// turn that arrives at a different moment every time the player changes a
// query parameter, which is not a schedule at all.
const lapClamp={defaultLapCount:course.defaultLapCount,minimumLapCount:course.minimumLapCount,maximumLapCount:course.maximumLapCount};
assert.equal(resolveModeLapCount('race',lapClamp,1),1,'?laps=1 must reach race.');
assert.equal(resolveModeLapCount('race',lapClamp,9),9,'?laps=9 must reach race.');
assert.equal(resolveModeLapCount('race',lapClamp,0),1,'?laps= must clamp to the course minimum.');
assert.equal(resolveModeLapCount('race',lapClamp,99),9,'?laps= must clamp to the course maximum.');
assert.equal(resolveModeLapCount('race',lapClamp,Number.NaN),3);
assert.equal(resolveModeLapCount('timeattack',lapClamp,9),9,'?laps= must reach time attack.');
assert.equal(resolveModeLapCount('sprint',lapClamp,9),SPRINT_LAP_COUNT,'?laps= must not move the sprint.');
assert.equal(resolveModeLapCount('sprint',lapClamp,Number.NaN),SPRINT_LAP_COUNT);
const raceLapReach={};
for(const laps of [1,2,3,4,9]){
  const run=raceOut(config.modes.race,laps);
  const struck=run.fired.some(e=>e.id==='strike');
  assert.equal(struck,laps>=3,`race at ${laps} lap(s): expected struck=${laps>=3}, got ${struck}.`);
  // The margin, not just the boolean. `?laps=2` is the close one — the strike
  // lands about a second and a half after a two-lap race is already over — and
  // a reviewer has to be able to see that rather than read a bare false. The
  // model races `laps x` the MEASURED Works lap; a real demo race is a little
  // slower than that (the calibration's own three laps total 0.58 s more than
  // 3 L), so the margin below is the conservative side of the real one.
  raceLapReach[laps]={raceTicks:run.totalTicks,struck,fired:run.fired.map(e=>e.id),
    marginTicks:run.totalTicks-config.modes.race.strikeTick,
    marginSeconds:+((run.totalTicks-config.modes.race.strikeTick)/TICK_RATE).toFixed(2)};
}
// And the same override arithmetic against the sprint's own table, so a future
// change that let `?laps=` reach the sprint fails here rather than on the road.
assert.ok(config.modes.sprint.strikeTick<Math.round(SPRINT_LAP_COUNT*worksLapTicks),
  'The sprint strike must fall inside the sprint.');
assert.ok(config.modes.race.strikeTick>Math.round(2*worksLapTicks),
  'The race strike is authored past the two-lap mark; if it were not, a two-lap race would strike and the sprint table would be pointless.');

// The course hands the table down rather than re-deriving the format, so what
// the schedule runs and what the lap counter counts can never disagree.
for(const mode of RACE_MODES){
  const formatted=new DreamIslandCourse();
  formatted.selectRaceFormat(mode,config.modes[mode].laps);
  assert.equal(formatted.schedule.config.strikeTick,config.modes[mode].strikeTick,
    `selectRaceFormat('${mode}') must load the ${mode} table.`);
  assert.equal(formatted.schedule.tick,0,'A table swap rewinds the clock.');
  formatted.advanceSchedule(config.modes[mode].strikeTick);
  assert.equal(formatted.surfaceGripAt(.45),.85,`${mode}: the wet causeway must reach the craft through surfaceGripAt.`);
  assert.ok(formatted.scheduleLabel.startsWith(mode==='sprint'?'SPRINT · THE STRIKE IN':'THE STRIKE IN'),
    `${mode}: the intro panel must name the schedule; got "${formatted.scheduleLabel}".`);
  assert.equal(formatted.strikeLap,mode==='sprint'?2:3);
}
// A short race says so on the panel rather than promising a strike that cannot
// come. Same course, same table, one different lap count.
const shortRace=new DreamIslandCourse();
shortRace.selectRaceFormat('race',2);
assert.equal(shortRace.strikeLap,null,'A two-lap race ends before the strike.');
assert.ok(shortRace.scheduleLabel.includes('stays day'),
  `A race that cannot strike must say so; got "${shortRace.scheduleLabel}".`);
// An unknown format keeps the default table rather than disarming the clock.
const unknown=new DreamIslandCourse();
unknown.selectRaceFormat('endurance',3);
assert.equal(unknown.schedule.config.strikeTick,config.strikeTick,'An unnamed format races the default table.');

// --- Phase D. The save file, with Dream Island's ghost in it.
//
// validate-persistence.mjs owns the general shape; this owns the one question
// that is Dream Island's: does adding a seventh circuit's time-attack record
// and its replay keep the written file inside the 64 KiB `parseSave` refuses
// past. A file the game writes and then refuses on the next load is a total
// wipe, which is what MAX_STORED_GHOSTS exists to prevent, and a seventh map is
// exactly the kind of addition that quietly spends the last of that budget.
//
// The ghost below is a WORST CASE for this circuit, not a sample: the recorder
// is driven for the full measured Works lap at its own sample rate, so it holds
// every frame a real Dream Island lap can produce.
const ghostFor=lapMs=>{
  const recorder=new GhostRecorder();
  const steps=Math.round(lapMs/1000*120);
  for(let step=0;step<steps;step++){
    const t=step/steps;
    recorder.step(t*2400,Math.sin(t*40)*8.5,88+Math.sin(t*17)*24,Math.sin(t*23)*.9);
  }
  return recorder.toRecording(lapMs);
};
const dreamIslandGhost=ghostFor(Math.round(config.worksLapSeconds*1000));
assert.ok(dreamIslandGhost,'The synthetic Dream Island lap did not produce a recording.');
const ghostCharacters=JSON.stringify(dreamIslandGhost).length;
assert.ok(ghostCharacters<=MAX_GHOST_CHARACTERS,
  `A full Dream Island lap serializes to ${ghostCharacters} characters against a ${MAX_GHOST_CHARACTERS} ceiling.`);

// The three ceilings are read out of the modules that declare them rather than
// restated here, so this suite cannot drift from the file the browser loads.
const saveSource=readFileSync(new URL('../src/game/save-schema.js',import.meta.url),'utf8');
const readConst=(source,name)=>{
  const raw=new RegExp(`const ${name} = ([^;]+);`).exec(source)?.[1];
  const value=raw===undefined?Number.NaN:Number(new Function(`return (${raw})`)());
  assert.ok(Number.isSafeInteger(value)&&value>0,`Could not read ${name}.`);
  return value;
};
const MAX_PAYLOAD_CHARACTERS=readConst(saveSource,'MAX_PAYLOAD_CHARACTERS');
const MAX_STORED_GHOSTS=readConst(saveSource,'MAX_STORED_GHOSTS');
const SCHEMA_VERSION=Number(/\bSCHEMA_VERSION = (\d+)\b/
  .exec(readFileSync(new URL('../src/game/persistence.ts',import.meta.url),'utf8'))?.[1]);
assert.ok(Number.isSafeInteger(SCHEMA_VERSION)&&SCHEMA_VERSION>=1,'Could not read SCHEMA_VERSION.');

const COURSE_KEY=course.mapCode;
const timeAttackKey=bestRecordKey('timeattack','works');
const store=createSaveStore(null,SCHEMA_VERSION);
// Fill the two-ghost budget with two OTHER slots first, so the time attack has
// to evict something to be stored — which is the case that actually decides
// whether a seventh map can hold a ghost at all.
store.recordRace('MAP 05',{bestLapMs:41_000,raceMs:123_000,laps:3,ghost:ghostFor(41_000),
  modeKey:bestRecordKey('race','works'),ghostKey:'race',gateSplitsMs:[]});
store.recordRace('MAP 06',{bestLapMs:39_000,raceMs:117_000,laps:3,ghost:ghostFor(39_000),
  modeKey:bestRecordKey('race','works'),ghostKey:'race',gateSplitsMs:[]});
const beforeCharacters=store.snapshot().length;
const applied=store.recordRace(COURSE_KEY,{bestLapMs:Math.round(config.worksLapSeconds*1000),
  raceMs:Math.round(config.worksLapSeconds*3000),laps:3,ghost:dreamIslandGhost,
  modeKey:timeAttackKey,ghostKey:'timeattack',gateSplitsMs:[]});
const afterCharacters=store.snapshot().length;
assert.equal(applied.newBestLap,true,'A first Dream Island time-attack lap must set the mode record.');
const stored=parseSave(store.snapshot(),SCHEMA_VERSION);
assert.ok(stored.records[COURSE_KEY],`No record written for ${COURSE_KEY}.`);
assert.equal(stored.records[COURSE_KEY].bests[timeAttackKey].bestLapMs,Math.round(config.worksLapSeconds*1000),
  `The (dreamisland, timeattack) best lap must land in bests["${timeAttackKey}"].`);
const ghostSlots=Object.entries(stored.records).flatMap(([key,record])=>Object.keys(record.ghosts).map(mode=>`${key}:${mode}`));
assert.ok(ghostSlots.includes(`${COURSE_KEY}:timeattack`),
  'The mode just raced must keep its replay; capGhostBudget visits it first.');
assert.equal(ghostSlots.length,MAX_STORED_GHOSTS,
  `The global ghost budget is ${MAX_STORED_GHOSTS}; the file holds ${ghostSlots.length}.`);
// Written and read back: the round trip is the assertion, because the failure
// this guards is a save the game writes and then refuses.
assert.ok(afterCharacters<=MAX_PAYLOAD_CHARACTERS,
  `The written save is ${afterCharacters} characters against the ${MAX_PAYLOAD_CHARACTERS} parseSave refuses past.`);
const reread=parseSave(store.snapshot(),SCHEMA_VERSION);
assert.equal(reread.records[COURSE_KEY].bests[timeAttackKey].bestLapMs,Math.round(config.worksLapSeconds*1000),
  'The Dream Island time-attack record did not survive a write/read round trip.');
assert.ok(reread.records[COURSE_KEY].ghosts.timeattack,'The Dream Island time-attack ghost did not survive the round trip.');
const evicted=['MAP 05:race','MAP 06:race'].filter(slot=>!ghostSlots.includes(slot));
// The ghost slot is per mode and NOT per tier, which is why one Dream Island
// ghost is one slot rather than three.
assert.equal(ghostRecordKey('timeattack'),'timeattack');

const outFlag=process.argv.find(a=>a.startsWith('--out='))?.slice(6);
const out=outFlag?new URL(outFlag.replace(/\/?$/,'/'),new URL('../',import.meta.url))
 :new URL('../art/evidence/dreamisland-v1/phase-a/',import.meta.url);
mkdirSync(out,{recursive:true});
const report={script:'scripts/validate-dreamisland-runtime.mjs',config,
  clockHands:Object.fromEntries(RACE_MODES.map(mode=>[mode,{
    before:dreamIslandClockAngles(config.modes[mode].strikeTick-600,config.modes[mode].strikeTick),
    strike:dreamIslandClockAngles(config.modes[mode].strikeTick,config.modes[mode].strikeTick)}])),
  determinism:{renderRates:[60,120,240],windowSeconds:WINDOW_SECONDS,tickRateHz:TICK_RATE,
    expectedTicks,ticks:ticksSeen,frames:framesSeen,
    expectedFrames:[60,120,240].map(hz=>hz*WINDOW_SECONDS),
    reconciliation:'frames = render rate x window seconds; ticks = 120 Hz x window seconds, identical at every render rate',
    identicalSnapshots:true},
  snapshotRestore:true,
  knownLimitation:'snapshot/restore has exactly one caller, this validator. Pause, resume and the save system do not snapshot the schedule; restore exists to make determinism provable, not to make pause deterministic.',
  grip:{sector:'BASIN',beforeStrike:1,afterStrike:.85,reachesCraftVia:'course.surfaceGripAt'},
  fish:{source:'src/game/data/dreamisland/fish-paths.json',
    floorMetres:fishPaths.minimumDeckClearanceMetres,fishLowestPointMetres:FISH_LOWEST,
    riseSeconds:fishPaths.riseSeconds,deckSamples,
    minimumDeckClearanceMetres:+worstClearance.toFixed(3),worst:worstRow,shoals:fishReport,
    method:'Every tick of the rise plus two full circuits per shoal, per fish, with the fish turned by the shoal turn; lateral measured against the road at that fish own progress and height against the deck under it. A second implementation of the rule in the validator, not a call into dreamisland-fish.ts.'},
  nightTurn:{rampTicks:config.nightRampTicks,midpointBlend:midBlend,settledBlend:1,
    reducedMotion:'step 0 -> 1 at strikeTick, same tick as the grip change'},
  modes:{worksLapSeconds:config.worksLapSeconds,worksLapTicks,defaultLapCount:config.defaultLapCount,
    sprintLapCount:SPRINT_LAP_COUNT,
    definition:config.modeDefinition,
    table:modeReport,
    lapOverride:{clamp:lapClamp,
      note:'?laps= reaches race and timeattack and is clamped to the course bounds; sprint ignores it.',
      raceReach:raceLapReach,
      byDesign:'An absolute schedule plus a short race finishes in daylight. Sprint is the format whose lap count is fixed, which is why its schedule is pinned to a fraction of the race instead.'}},
  save:{courseKey:COURSE_KEY,schemaVersion:SCHEMA_VERSION,
    modeRecordKey:timeAttackKey,ghostKey:ghostRecordKey('timeattack'),
    ghostCharacters,ghostCeilingCharacters:MAX_GHOST_CHARACTERS,
    charactersBefore:beforeCharacters,charactersAfter:afterCharacters,
    ceilingCharacters:MAX_PAYLOAD_CHARACTERS,
    ghostBudget:MAX_STORED_GHOSTS,ghostSlotsAfter:ghostSlots,evictedSlots:evicted,
    method:'A synthetic worst-case Dream Island lap (the full measured Works lap at the recorder own sample rate) written into an in-memory save that already held two other circuits ghosts, then read back through parseSave. Characters, not bytes: MAX_PAYLOAD_CHARACTERS counts the stored text. The sizes a real browser wrote are in the phase-D soak evidence.'},
  scope:'Pure clock, grip and blend arithmetic in Node. Not a rendered crossfade: the sky and water are phases B and C and the five-point capture instrument does not exist yet.'};
writeFileSync(new URL('runtime-validation.json',out),JSON.stringify(report,null,2));
console.log(`Dream Island modes PASS: ${RACE_MODES.map(m=>`${m} ${modeReport[m].laps}L strike lap ${modeReport[m].strikeLap} at ${modeReport[m].fractionOfRace} of the race`).join('; ')}; race strikes only at laps >= 3 (${Object.entries(raceLapReach).map(([laps,r])=>`${laps}:${r.struck}`).join(' ')}); save ${beforeCharacters} -> ${afterCharacters} characters of ${MAX_PAYLOAD_CHARACTERS} with the ${COURSE_KEY} timeattack ghost (${ghostCharacters} chars) kept and ${evicted.length?evicted.join(', '):'nothing'} evicted.`);
console.log(`Dream Island runtime PASS: fish clear the deck by ${worstClearance.toFixed(3)} m over ${deckSamples} on-deck samples (floor ${fishPaths.minimumDeckClearanceMetres} m);  60/120/240 Hz identical over ${WINDOW_SECONDS} s (${framesSeen.join('/')} frames, ${ticksSeen.join('/')} ticks against an expected ${expectedTicks}); all ${config.events.length} events fired once; BASIN grip 1 -> .85 at tick ${config.strikeTick}; night blend 0 -> ${midBlend.toFixed(3)} -> 1 over ${config.nightRampTicks} ticks and a step at the same tick under ?motion=reduce.`);
