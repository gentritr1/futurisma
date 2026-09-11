import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {sourceModule} from './visual/dreamisland/modules.mjs';
import {simulateRivalField} from './lib/rival-field-sim.mjs';
const {DreamIslandCourse}=await import(await sourceModule('dreamisland-course.ts'));
const course=new DreamIslandCourse();course.gridStart=()=>null;
const flag=(name,fallback)=>process.argv.find(a=>a.startsWith('--'+name+'='))?.slice(name.length+3)??fallback;
// The calibration is whichever capture the PUBLISHED schedule names, so a route
// revision can never leave the rival field solved against a lap that no longer
// exists. `--calibration=` overrides it; `--out=` moves the evidence file.
const schedule=JSON.parse(readFileSync('src/game/data/dreamisland/schedule.json','utf8'));
const calibrationFile=flag('calibration',schedule.measurement);
if(!calibrationFile)throw Error('The published schedule names no calibration; run the calibration race first');
const calibration=JSON.parse(readFileSync(calibrationFile));
if(calibration.errors.length)throw Error('Calibration contains browser errors');
const laps=calibration.diagnostics.current.lapTimesMs;
if(laps.length!==3)throw Error('Calibration must complete three laps');
const playerSeconds=laps.reduce((a,b)=>a+b,0)/1000;
const pace={cornerSpeedGain:.25,cornerSpeedFloor:.72,noBlockSide:-1,driftCurvature:.55,straightCurvature:.13,profiles:{},tiers:{}};
const ids=['rival-privateer','rival-nightform','rival-needle'];
const measurements=[];let converged=true;
for(const [tier,shift] of [['rookie',4],['works',0],['feral',-4]]){
 const profiles={};
 for(let index=0;index<ids.length;index++){
  const target=playerSeconds+shift+[-1,1,3][index];let lo=75,hi=115,measured=0;
  for(let iteration=0;iteration<18;iteration++){
   const speed=(lo+hi)/2,profile={cruiseSpeedMetersPerSecond:speed,padUse:false,boostWindows:[]};
   const result=simulateRivalField({course,pace:{...pace,profiles:{[ids[index]]:profile}},totalLaps:3,onlyProfileIndex:index,contest:false});
   measured=result.states[0].finishTimeSeconds;
   if(!Number.isFinite(measured))throw Error('No rival finish');
   if(measured>target)lo=speed;else hi=speed;
  }
  // A bisection that ends pinned to an endpoint never bracketed the target.
  const solved=(lo+hi)/2;
  if(Math.abs(measured-target)>.75||solved<=75.01||solved>=114.99)converged=false;
  profiles[ids[index]]={cruiseSpeedMetersPerSecond:solved,padUse:false,boostWindows:[]};
  measurements.push({tier,id:ids[index],target,measured,solved});
 }
 if(tier==='works')pace.profiles=profiles;else pace.tiers[tier]={profiles};
}
if(!converged)pace.unsolved=true;
writeFileSync('src/game/data/dreamisland/rival-pace.json',JSON.stringify(pace,null,2));
const out=flag('out','art/evidence/dreamisland-v1/phase-a');mkdirSync(out,{recursive:true});
writeFileSync(out+'/pace-solve.json',JSON.stringify({script:'scripts/solve-dreamisland-pace.mjs',
 measurement:calibrationFile,playerSeconds,playerLapTimesMs:laps,
 bisection:{low:75,high:115,iterations:18},tierShiftSeconds:{rookie:4,works:0,feral:-4},profileOffsetSeconds:[-1,1,3],
 converged,scope:'Isolated production rival model against the measured player race total; browser tier classification is the separate soak.',
 measurements},null,2));
console.log(JSON.stringify({playerSeconds,converged,measurements}));
