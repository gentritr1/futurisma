import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as THREE from 'three';
import {transformWithOxc} from 'vite';
import {BOOST_MAX_SPEED, calculateDriftIntent, integrateSpeed, integrateSteering, calculateTurnAuthority,
  calculateTurnRate, calculateGripRate, integrateSurfaceGrip} from '../src/game/physics.js';
const local = name => new URL(`../src/game/${name}`, import.meta.url).href;
async function moduleUrl(name, replacements = {}) {
  const url = new URL(`../src/game/${name}`, import.meta.url);
  let {code} = await transformWithOxc(await readFile(url,'utf8'),url.pathname);
  for (const [specifier,target] of Object.entries({three:import.meta.resolve('three'),
    './tideline-tide.js':local('tideline-tide.js'),'./tideline-rules.js':local('tideline-rules.js'),
    './apron.js':local('apron.js'),'./physics':local('physics.js'),...replacements})) {
    code=code.replaceAll(`from ${JSON.stringify(specifier)}`,`from ${JSON.stringify(target)}`);
  }
  for (const [binding,file] of [['route','route'],['rivalPace','rival-pace']]) {
    code=code.replace(`import ${binding} from "./data/tideline/${file}.json";`,
      `const ${binding} = ${await readFile(new URL(`../src/game/data/tideline/${file}.json`,import.meta.url),'utf8')};`);
  }
  return `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
}
const {TidelineCourse}=await import(await moduleUrl('tideline-course.ts'));
const {DemoAutopilot,alignDirectionToSurface}=await import(await moduleUrl('autopilot.ts'));
const results=[];
for (const lateral of [-3,0,3]) for (const branch of [false,true]) {
  const course=new TidelineCourse();course.setLapBoard(3);course.advanceTide(5);
  if(!branch)course.demoSample=course.sample;
  const driver=new DemoAutopilot(course);
  const start=course.sample(.02),position=start.position.clone().addScaledVector(start.right,lateral),forward=start.tangent.clone(),travel=forward.clone();
  const projection=course.createProjectionScratch();
  let progress=.02,speed=82,steer=0,grip=.94,seconds=0,branchSeconds=0,edgeSteps=0,minimumBranchProgress=1,maximumBranchProgress=0;
  const dt=1/120;
  // Use the production control and handling functions. Powers and traffic are
  // excluded to isolate whether the physical fork can be driven at race speed.
  let lastLog = -1;
  while(progress<.29&&seconds<20) {
    const input=driver.read(position,forward,travel,progress,speed,3,1,seconds*1000);
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
  results.push({lateral,branch,seconds,branchSeconds,minimumBranchProgress,maximumBranchProgress,edgeSteps});
}
for (let i=0;i<results.length;i+=2) {
  const [main,cut]=results.slice(i,i+2);
  if(process.env.TRACE_TIDELINE) console.log('RESULT', {main,cut});
  assert.equal(cut.edgeSteps,0,`The pump hall must clear the edge from entry lateral ${cut.lateral} m.`);
  // Both roads overlap beyond .23; projection may correctly select the main
  // road there. Require the separate hall and both sluices, not that overlap.
  assert.ok(cut.branchSeconds>3&&cut.minimumBranchProgress<.10&&cut.maximumBranchProgress>.23,'Drive the complete separate hall, not just its entrance.');
  assert.ok(cut.seconds<main.seconds,'The narrower pump hall must offer an actual time advantage.');
  console.log(`Tideline driving PASS / entry ${cut.lateral} m: main ${main.seconds.toFixed(3)} s, pump hall ${cut.seconds.toFixed(3)} s; full branch without edge contacts.`);
}
