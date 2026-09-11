import {readFileSync,writeFileSync} from 'node:fs';
import {sourceModule} from './visual/ascension/modules.mjs';
import {simulateRivalField} from './lib/rival-field-sim.mjs';
const {AscensionCourse}=await import(await sourceModule('ascension-course.ts'));
const course=new AscensionCourse();course.gridStart=()=>null;
const calibration=JSON.parse(readFileSync('art/evidence/ascension-v1/phase-a/calibration/works-trench.json'));
const playerSeconds=calibration.diagnostics.current.lapTimesMs.reduce((a,b)=>a+b,0)/1000;
const pace={cornerSpeedGain:.25,cornerSpeedFloor:.72,noBlockSide:-1,driftCurvature:.55,straightCurvature:.13,profiles:{},tiers:{}};
const ids=['rival-privateer','rival-nightform','rival-needle'];
const measurements=[];
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
  profiles[ids[index]]={cruiseSpeedMetersPerSecond:(lo+hi)/2,padUse:false,boostWindows:[]};measurements.push({tier,id:ids[index],target,measured});
 }
 if(tier==='works')pace.profiles=profiles;else pace.tiers[tier]={profiles};
}
writeFileSync('src/game/data/ascension/rival-pace.json',JSON.stringify(pace,null,2));
writeFileSync('art/evidence/ascension-v1/phase-a/pace-solve.json',JSON.stringify({script:'scripts/solve-ascension-pace.mjs',playerSeconds,scope:'Isolated production rival model, calibration targets; browser tier classification still required',measurements},null,2));console.log(JSON.stringify(measurements));
