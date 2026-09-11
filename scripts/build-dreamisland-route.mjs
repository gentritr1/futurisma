import * as THREE from 'three';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {RACE_MODES,SPRINT_LAP_COUNT} from '../src/game/race-modes-rules.js';
// Dream Island: a closed 2,400 m island loop authored as a curvature schedule
// rather than a ring of hand-placed points, because the districts are specified
// by ARC LENGTH (300/380/260/300/340/460/360 m) and only an arc-length
// parameterisation puts the straight, the esses and the sweep on the metres the
// brief names. Each section's net turn below is a pinned authored constant: the
// design intent was 30/90/30/130/40/40 degrees, and the minimum-norm correction
// that makes the loop close in position and heading was solved once, offline,
// and written here. This script integrates it; it does not solve anything.
//
// Phase B revision (GROVE esses). Phase A's grove measured a minimum radius of
// 87.8 m — a sweeper, not the esses the district table asks for. The wave below
// is five half-lobes instead of three, at amplitude .0172 instead of .011.
// Raising the amplitude moves where the loop ends, so the six constants were
// re-solved for closure by `node scripts/design/solve-dreamisland-closure.mjs
// --grove-lobes=5 --grove-amplitude=0.0172`, started from the phase-A constants
// so the correction is the smallest one that closes: every other district's net
// turn moved by less than 0.13 degrees and its arc length is unchanged.
const TURN={GROVE:58.892214,POINT:69.333471,BASIN:-7.766680,COURT:108.726051,REEF:53.439587,CUT:77.375347};
// GROVE wave: half-lobe count and radians-per-metre amplitude. `2/(k*pi)` is the
// mean of `sin(k*pi*t)` over the district for odd k and is subtracted so the wave
// stays zero-mean and TURN.GROVE remains the district's entire net turn.
const GROVE_LOBES=5,GROVE_AMPLITUDE=.0172;
const LENGTH=2400,BOUNDS=[0,300,680,940,1240,1580,2040];
const smooth=t=>t<=0?0:t>=1?1:t*t*(3-2*t),rad=deg=>deg*Math.PI/180;
// Sea level across the beach and the reef pier; +22 m at the watchtower bore,
// +14 m along the basin causeway, back down through the clock court. Every ramp
// is a smoothstep, so the pitch is zero at each junction and peaks at 1.5x the
// mean grade: 3.7, 5.3 and 3.5 degrees, all inside the 10.5 degree guard.
const height=s=>s<300?0:s<810?22*smooth((s-300)/510):s<940?22-8*smooth((s-810)/130)
 :s<1240?14:s<1580?14-14*smooth((s-1240)/340):0;
// Plan curvature in radians per metre of 3D arc length. Positive turns right in
// the emitted route (the emitted sign is the negated heading rate), so the court
// is a right-hand sweep and the cut is a left-then-right chicane.
function curvature(s){
 if(s<300)return 0;                                                              // BEACH: the surf-line straight
 if(s<680){const t=(s-300)/380;                                                  // GROVE: five-phase esses, zero-mean wave
  return rad(TURN.GROVE)/380+GROVE_AMPLITUDE*(Math.sin(GROVE_LOBES*Math.PI*t)-2/(GROVE_LOBES*Math.PI));}
 if(s<940){const t=(s-680)/260;return rad(TURN.POINT)*Math.PI/(2*260)*Math.sin(Math.PI*t);}            // POINT: one shaped corner under the tower
 if(s<1240)return rad(TURN.BASIN)/300;                                           // BASIN: the causeway runs nearly straight
 if(s<1580)return rad(TURN.COURT)/340;                                           // COURT: constant-radius banked right sweep
 if(s<2040)return rad(TURN.REEF)/460;                                            // REEF: flat out over the shallows
 const t=(s-2040)/360;return rad(TURN.CUT)/360-.017*Math.sin(2*Math.PI*t);       // CUT: tight left-right between the mossy blocks
}
const STEPS=48000,step=LENGTH/STEPS;
const controls=[];
let heading=0,x=0,z=0;
for(let i=0;i<STEPS;i++){
 const s=i*step,mid=(i+.5)*step;
 if(i%120===0)controls.push(new THREE.Vector3(x,height(s),z));
 // s is 3D arc length, so the plan-view advance is the horizontal component.
 const rise=height(mid+step/2)-height(mid-step/2);
 const plan=Math.sqrt(Math.max(0,step*step-rise*rise));
 x+=Math.cos(heading)*plan;z+=Math.sin(heading)*plan;heading+=curvature(mid)*step;
}
// Two fixed-point passes: the spline through the control points is marginally
// longer than the polyline, and the horizontal scale is what corrects it.
let path=new THREE.CatmullRomCurve3(controls,true,'centripetal');path.arcLengthDivisions=200000;
for(let pass=0;pass<2;pass++){
 const scale=LENGTH/path.getLength();for(const p of controls){p.x*=scale;p.z*=scale;}
 path=new THREE.CatmullRomCurve3(controls,true,'centripetal');path.arcLengthDivisions=200000;
}
const length=path.getLength(),count=Math.ceil(length/3);
const districts=[['BEACH','BEACH STRAIGHT',26,'#d8c79a'],['GROVE','PALM GROVE',22,'#b9c489'],
 ['POINT','WATCHTOWER POINT',14,'#a79c8c'],['BASIN','BASIN CAUSEWAY',20,'#a9b6b2'],
 ['COURT','CLOCK COURT',24,'#c6b9a2'],['REEF','REEF SHALLOWS',26,'#8fc6c6'],['CUT','MOSSY CUT',22,'#8ba377']]
 .map(([id,name,width,color],i)=>({id,name,from:BOUNDS[i]/LENGTH,width,color}));
// Width is authored per district, but a 22 -> 14 m step at the watchtower would
// put the craft outside the road inside one station. Each boundary tapers over
// 40 m, which is still the district table and not a second width source.
const TAPER=40;
const seams=districts.map((d,i)=>({at:d.from*length,before:districts[(i+districts.length-1)%districts.length].width,after:d.width}));
function widthAt(distance){
 for(const seam of seams){
  const delta=((distance-seam.at+length*1.5)%length)-length/2;
  if(Math.abs(delta)<TAPER/2)return seam.before+(seam.after-seam.before)*smooth(delta/TAPER+.5);
 }
 return districts.findLast(d=>distance/length>=d.from).width;
}
const stations=Array.from({length:count},(_,i)=>{
 const u=i/count,a=path.getTangentAt((u-.0008+1)%1),b=path.getTangentAt((u+.0008)%1);
 const district=districts.findLast(d=>u>=d.from);
 return {d:u*length,p:path.getPointAt(u).toArray(),t:path.getTangentAt(u).toArray(),
  curvature:Math.atan2(a.clone().cross(b).y,a.dot(b))/(length*.0016),width:widthAt(u*length),sector:district.id};
});
const out=new URL('../src/game/data/dreamisland/',import.meta.url);mkdirSync(out,{recursive:true});
const data={name:'Dream Island',revision:'esses-b',length,count,districts,flightArcs:[],
 checkpoints:[0,.125,.283,.392,.517,.658,.750,.850],stations};
writeFileSync(new URL('route.json',out),JSON.stringify(data));
const spacing=stations.map((s,i)=>Math.hypot(...s.p.map((v,axis)=>v-stations[(i+1)%count].p[axis])));
console.log(JSON.stringify({script:'scripts/build-dreamisland-route.mjs',length,count,
 spacingMin:Math.min(...spacing),spacingMax:Math.max(...spacing),
 curvatureMax:Math.max(...stations.map(s=>Math.abs(s.curvature))),
 pitchMaxDegrees:Math.max(...stations.map(s=>Math.abs(Math.asin(s.t[1]))))*180/Math.PI}));
// The schedule is never typed by hand: it is a multiple of the Works lap time
// measured in a real `?calibrate=1` browser race, guarded exactly as the
// Ascension builder guards its own capture.
const calibrationFile=process.argv.find(a=>a.startsWith('--calibration='))?.slice(14);
// `--bootstrap` writes an INERT schedule so the course module can be imported
// before any lap has been measured. Every tick is null, the schedule treats that
// exactly as "no calibration", and the calibration run then overwrites it. No
// tick is ever typed by hand, not even a placeholder one.
if(process.argv.includes('--bootstrap')){
 const config={script:'scripts/build-dreamisland-route.mjs',bootstrap:true,measurementScript:null,measurement:null,
  worksLapSeconds:null,definition:'Inert bootstrap: no lap has been measured yet',
  chimeTick:null,strikeTick:null,fishRiseTick:null,nightSettledTick:null,nightRampTicks:12*120,events:[],
  modes:Object.fromEntries(RACE_MODES.map(mode=>[mode,{laps:null,honoursLapOverride:mode!=='sprint',chimeFactor:null,strikeFactor:null,
   chimeTick:null,strikeTick:null,fishRiseTick:null,nightSettledTick:null,nightRampTicks:12*120,events:[]}]))};
 writeFileSync(new URL('schedule.json',out),JSON.stringify(config,null,2));console.log('bootstrap schedule written');
}
// Phase D. The two authored factors below are LAP FRACTIONS of the race, not
// of the clock: 1.85 L and 2.05 L put the warning late in lap 2 and the strike
// just after the lap-2/lap-3 boundary of a three-lap race, so the last lap is
// the night lap. A sprint is two laps, and 2.05 L of a two-lap race never
// arrives — the race is over 0.95 L before the clock would strike, so the map's
// whole identity would be missing from the format. The sprint therefore races
// the same schedule expressed as the same FRACTION OF THE RACE: every factor is
// scaled by SPRINT_LAP_COUNT / defaultLapCount, which puts the strike at
// 2.05 x 2/3 = 1.3667 L, i.e. 0.37 into lap 2, and keeps the night lap.
//
// What is deliberately NOT scaled is the twelve-second ramp and the four-second
// fish delay. Those are durations in seconds, authored against how a crossfade
// reads on screen (brief section 5), not against how long a race is; scaling
// them would change the look of the turn rather than where it lands.
//
// `?laps=` on `race` is left alone on purpose: race is the format that honours
// the override, and a one- or two-lap race finishing in daylight is the honest
// consequence of an absolute schedule. Sprint is the format whose lap count is
// fixed, which is exactly why its schedule can be pinned to a fraction of it.
const RACE_MODE_LAP_FACTORS={chime:1.85,strike:2.05};
const FISH_RISE_SECONDS=4,NIGHT_RAMP_SECONDS=12;
// Never typed: read back out of the course that declares it, so the factor
// table cannot drift from the lap count it is scaled against. `validate-
// dreamisland.mjs` asserts the two agree.
const courseSource=readFileSync(new URL('../src/game/dreamisland-course.ts',import.meta.url),'utf8');
const defaultLapCount=Number(/readonly defaultLapCount = (\d+)/.exec(courseSource)?.[1]);
if(!Number.isSafeInteger(defaultLapCount)||defaultLapCount<1)throw Error('Could not read defaultLapCount from dreamisland-course.ts');
const modeLapCount=mode=>mode==='sprint'?SPRINT_LAP_COUNT:defaultLapCount;
if(calibrationFile){
 const race=JSON.parse(readFileSync(calibrationFile,'utf8'));
 if(race.errors.length)throw Error('Calibration contains browser errors');
 const laps=race.diagnostics.current.lapTimesMs;
 if(laps.length!==3)throw Error('Calibration must complete three laps');
 const L=(laps[1]+laps[2])/2000,tick=factor=>Math.round(factor*L*120);
 const table=mode=>{
  const scale=modeLapCount(mode)/defaultLapCount;
  const chimeFactor=RACE_MODE_LAP_FACTORS.chime*scale,strikeFactor=RACE_MODE_LAP_FACTORS.strike*scale;
  const strikeTick=tick(strikeFactor);
  return {laps:modeLapCount(mode),honoursLapOverride:mode!=='sprint',chimeFactor,strikeFactor,
   chimeTick:tick(chimeFactor),strikeTick,fishRiseTick:strikeTick+FISH_RISE_SECONDS*120,
   nightSettledTick:strikeTick+NIGHT_RAMP_SECONDS*120,nightRampTicks:NIGHT_RAMP_SECONDS*120,
   events:[{id:'chime-warning',tick:tick(chimeFactor)},{id:'strike',tick:strikeTick},
    {id:'fish-rise',tick:strikeTick+FISH_RISE_SECONDS*120},{id:'night-settled',tick:strikeTick+NIGHT_RAMP_SECONDS*120}].sort((a,b)=>a.tick-b.tick)};
 };
 const modes=Object.fromEntries(RACE_MODES.map(mode=>[mode,table(mode)]));
 // The top level stays exactly what it was before phase D — the race table —
 // so every existing reader (the course's static import, both validators, the
 // HUD) keeps working unchanged and `modes` is purely additive.
 const config={script:'scripts/build-dreamisland-route.mjs',measurementScript:race.script,measurement:calibrationFile,
  worksLapSeconds:L,definition:'Mean of flying laps two and three in the full Works demo with the schedule inert',
  modeDefinition:'Sprint scales both lap factors by SPRINT_LAP_COUNT / defaultLapCount so the strike lands at the same fraction of the race; the 12 s ramp and the 4 s fish delay are durations and are not scaled.',
  defaultLapCount,
  ...modes.race,
  modes};
 writeFileSync(new URL('schedule.json',out),JSON.stringify(config,null,2));console.log(JSON.stringify(config,null,2));
}
