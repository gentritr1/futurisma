import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
const path=process.argv[2];
if(!path)throw Error('Usage: node feel.mjs <soak-folder>');
const capture=JSON.parse(readFileSync(path+'/race.json','utf8'));
const route=JSON.parse(readFileSync('src/game/data/dreamisland/route.json','utf8'));
const rows=capture.driving;
assert.ok(rows?.length,'Soak has no physics-step driving samples');
let wraps=0;
for(let i=0;i<rows.length;i++){
 if(i&&rows[i].progress<rows[i-1].progress-.5)wraps++;
 rows[i].courseDistance=wraps+rows[i].progress;
}
function crossing(lap,progress){
 for(let i=1;i<rows.length;i++){
  const a=rows[i-1],b=rows[i],pa=a.courseDistance,pb=b.courseDistance,target=lap-1+progress;
  if(pa<=target&&pb>=target&&pb>pa)return {ms:a.elapsedMs+(b.elapsedMs-a.elapsedMs)*(target-pa)/(pb-pa),
   sampleIntervalMs:b.elapsedMs-a.elapsedMs,nightBlend:b.nightBlend};
 }
 return null;
}
const laps=[...new Set(rows.map(row=>row.lap))].filter(lap=>lap<=capture.diagnostics.current.lapTimesMs.length);
const splits=[];
for(const lap of laps)for(let i=0;i<route.districts.length;i++){
 const district=route.districts[i],end=route.districts[i+1]?.from??1;
 const entry=crossing(lap,district.from),exit=crossing(lap,end);
 // Lap one's BEACH starts at the grid's progress, not at the timing line.
 if(!entry||!exit)continue;
 splits.push({lap,sector:district.id,entryMs:entry.ms,exitMs:exit.ms,milliseconds:exit.ms-entry.ms,
  entryBlend:entry.nightBlend,exitBlend:exit.nightBlend,maxBoundarySampleIntervalMs:Math.max(entry.sampleIntervalMs,exit.sampleIntervalMs)});
}
const basin=splits.filter(row=>row.sector==='BASIN'),day=basin.filter(row=>row.exitBlend===0),night=basin.filter(row=>row.entryBlend>0);
const dayMean=day.reduce((sum,row)=>sum+row.milliseconds,0)/day.length;
const basinDelta=night.length?night[0].milliseconds-dayMean:null;
const braking=[];
for(const lap of laps){
 const lapRows=rows.filter(row=>Math.floor(row.courseDistance)+1===lap);
 // Literal first nonzero brake after the authored CUT boundary; also expose
 // the turn-limited approach so cruise-control brake pulses cannot be hidden.
 const boundary=lapRows.find(row=>row.progress>=.85&&row.brake>0);
 const turn=lapRows.find(row=>row.progress>=.75&&row.progress<.95&&row.brake>0&&row.decision?.approachingTurnLimit
  &&row.decision.turnCue&&row.decision.turnCue.radius<=85
  &&row.progress+row.decision.turnCue.distance/route.length>=.85);
 const record=row=>row?{progress:row.progress,metres:row.progress*route.length,tick:row.tick,brake:row.brake,
  speed:row.speed,fogDensity:row.fogDensity,nightBlend:row.nightBlend,decision:row.decision??null}:null;
 braking.push({lap,firstBrakeAfterCutBoundary:record(boundary),turnLimitedApproach:record(turn)});
}
const dayBrakes=braking.filter(row=>row.firstBrakeAfterCutBoundary?.nightBlend===0);
const nightBrake=braking.find(row=>row.firstBrakeAfterCutBoundary?.nightBlend===1);
const dayBrakeMean=dayBrakes.reduce((sum,row)=>sum+row.firstBrakeAfterCutBoundary.metres,0)/dayBrakes.length;
const boundaryDelta=nightBrake?dayBrakeMean-nightBrake.firstBrakeAfterCutBoundary.metres:null;
const dayApproaches=braking.map(row=>row.turnLimitedApproach).filter(row=>row?.nightBlend===0);
const nightApproach=braking.map(row=>row.turnLimitedApproach).find(row=>row?.nightBlend===1);
const brakeDelta=nightApproach&&dayApproaches.length
 ?dayApproaches.reduce((sum,row)=>sum+row.metres,0)/dayApproaches.length-nightApproach.metres:null;
const report={script:'scripts/visual/dreamisland/feel.mjs',source:path+'/race.json',physicsSamples:rows.length,
 splitMethod:'Linear interpolation at authored district boundaries using actual 120 Hz driver input samples. Lap-one BEACH and the final CUT tail are incomplete and omitted. Progress is unwrapped at the geometric seam, independently of the lap UI which increments before progress wraps.',
 brakingMethod:'Primary: first nonzero brake during the actual turn-limited approach to the first CUT turn. Also report first brake at/after the district boundary (.85), where braking is already in progress. Positive shift means earlier at night. Older baseline captures have no decision samples and leave the primary result null.',
 splits,basin:{dayMeanMs:dayMean,nightMs:night[0]?.milliseconds??null,deltaMs:basinDelta,targetMs:[250,400],passed:basinDelta>=250&&basinDelta<=400},
 braking,firstBrakeAfterBoundaryShiftMetres:boundaryDelta,brakeShiftMetres:brakeDelta,brakingTargetMetres:8,brakingPassed:brakeDelta>=8};
writeFileSync(path+'/feel.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({source:path,basin:report.basin,brakeShiftMetres:brakeDelta,brakingPassed:report.brakingPassed}));
