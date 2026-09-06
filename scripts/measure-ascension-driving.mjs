import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {sourceModule} from './visual/ascension/modules.mjs';
import {BOOST_MAX_SPEED,calculateDriftIntent,integrateSpeed,integrateSteering,calculateTurnAuthority,calculateTurnRate,calculateGripRate,integrateSurfaceGrip} from '../src/game/physics.js';
const {AscensionCourse}=await import(await sourceModule('ascension-course.ts'));
const {DemoAutopilot,alignDirectionToSurface}=await import(await sourceModule('autopilot.ts'));
const results=[];
for (const lateral of [0]) for (const branch of [false,true]) {
  const course=new AscensionCourse();course.setLapBoard(1);
  course.demoTrench=branch;
  const driver=new DemoAutopilot(course);
  const start=course.sample(course.startProgress),position=start.position.clone().addScaledVector(start.right,lateral),forward=start.tangent.clone(),travel=forward.clone();
  const projection=course.createProjectionScratch();
  let progress=course.startProgress,speed=0,steer=0,grip=1,seconds=0,branchSeconds=0,edgeSteps=0,minimumBranchProgress=1,maximumBranchProgress=0;
  const dt=1/120;
  // Use the production control and handling functions. Powers and traffic are
  // excluded to isolate whether the physical fork can be driven at race speed.
  let lastLog = -1,completed=0,previousProgress=progress,nextGate=1,missedGates=0;const lapTimes=[],forkTicks=[0,0,0];let lapStart=0;
  while(completed<3&&seconds<180) {
    if(progress>=course.shortcut.from&&progress<course.shortcut.to)forkTicks[completed]++;
    const input=driver.read(position,forward,travel,progress,speed,completed+1,nextGate,seconds*1000);
    const before=course.project(position,progress,projection),ratio=speed/BOOST_MAX_SPEED;
    const drift=calculateDriftIntent(ratio,input.brake,input.steer);
    speed=integrateSpeed(speed,input.throttle,input.brake,false,drift,dt,0);
    steer=integrateSteering(steer,input.steer,dt);
    forward.applyAxisAngle(before.up,-steer*calculateTurnRate(ratio,drift)*calculateTurnAuthority(ratio)*dt);
    alignDirectionToSurface(forward,before.up,before.tangent);
    grip=integrateSurfaceGrip(grip,course.surfaceGripAt(progress,before.lateral),.8,dt);
    const response=1-Math.exp(-dt*calculateGripRate(ratio,drift,grip,input.brake,input.steer));
    travel.lerp(forward,response);alignDirectionToSurface(travel,before.up,forward);
    position.addScaledVector(travel,speed*dt);
    const after=course.project(position,progress,projection);progress=after.progress;position.y=after.position.y;
    const wrapped=(progress-previousProgress+1)%1;
    const gate=(course.checkpointProgress(nextGate)-previousProgress+1)%1;
    if(wrapped<.05 && gate<=wrapped){nextGate=(nextGate+1)%course.orderedCheckpointCount;}
    if(previousProgress>.9&&progress<.1){if(nextGate!==1)missedGates++;completed++;lapTimes.push(seconds+dt-lapStart);lapStart=seconds+dt;}
    previousProgress=progress;
    if(after.alternateRoad){branchSeconds+=dt;minimumBranchProgress=Math.min(minimumBranchProgress,progress);maximumBranchProgress=Math.max(maximumBranchProgress,progress);}
    const apron=course.apronAt(after,after.lateral);
    if(Math.abs(after.lateral)>apron.lateralLimit) {
      edgeSteps++;
      if(process.env.TRACE_TIDELINE) console.log('EDGE', {entry:lateral,branch,progress,speed,lateral:after.lateral,limit:apron.lateralLimit,alternateRoad:after.alternateRoad,position:position.toArray()});
      position.copy(after.position).addScaledVector(after.right,Math.sign(after.lateral)*apron.lateralLimit);
      const outward=after.right.clone().multiplyScalar(Math.sign(after.lateral));
      if(travel.dot(outward)>0)travel.addScaledVector(outward,-travel.dot(outward)*1.45).normalize();
    }
    if(branch && process.env.TRACE_TIDELINE && Math.floor(progress*100)!==lastLog) {
      lastLog=Math.floor(progress*100); const line=course.sampleShortcut(progress);
      console.log({p:progress.toFixed(3),lat:after.lateral.toFixed(1),steer:input.steer.toFixed(2),speed:speed.toFixed(1),branch:after.alternateRoad,pos:position.toArray().map(n=>n.toFixed(1)),line:line.position.toArray().map(n=>n.toFixed(1))});
    }
    seconds+=dt;
  }
  results.push({lateral,branch,seconds,branchSeconds,minimumBranchProgress,maximumBranchProgress,edgeSteps,lapTimes,forkTicks,forkSeconds:forkTicks.map(t=>t/120),completed,missedGates});
}

const report={script:'scripts/measure-ascension-driving.mjs',clockHz:120,controller:'Production DemoAutopilot and handling; isolated no nitro, powers or traffic. Not a browser Works calibration.',results,forkSavingSeconds:results[0].forkSeconds.map((s,i)=>s-results[1].forkSeconds[i]),sampleReconciliation:results.map(r=>({branch:r.branch,windowSeconds:r.forkTicks.reduce((a,b)=>a+b,0)/120,expectedRateHz:120,observedSamples:r.forkTicks.reduce((a,b)=>a+b,0)})),savingSeconds:(results[0].seconds-results[1].seconds)/3};
assert.ok(report.forkSavingSeconds.every(seconds=>seconds>=3&&seconds<=6));
writeFileSync(process.argv.find(a=>a.startsWith('--out='))?.slice(6)??'art/evidence/ascension-v1/phase-a/driving.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
