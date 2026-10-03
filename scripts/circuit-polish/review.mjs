import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const mode=process.argv[2]??'smoke';
const maps=process.argv.slice(3).length?process.argv.slice(3):['greenwater','bitterpan','nightshift','polarity','tideline','ascension','dreamisland','afterglow'];
const out='.dream-loop/circuit-polish';await mkdir(out,{recursive:true});
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist','--autoplay-policy=no-user-gesture-required',...(mode==='benchmark'?['--disable-frame-rate-limit','--disable-gpu-vsync']:[])]});
const results=[];
try {
for(const map of maps){
  const page=await browser.newPage({viewport:{width:1536,height:864},deviceScaleFactor:1});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.route('**/src/game/game.ts*',async route=>{
    const response=await route.fetch();let body=await response.text();
    body=body.replace('this.renderer.outputColorSpace = THREE.SRGBColorSpace;','this.renderer.outputColorSpace = THREE.SRGBColorSpace; window.__game=this;window.__times=[]; const oldRender=this.renderer.render.bind(this.renderer);this.renderer.render=(...args)=>{oldRender(...args);if(!this.renderer.getRenderTarget()&&this.phase==="running")window.__times.push(performance.now());};');
    await route.fulfill({response,body});
  });
  await page.goto(`http://127.0.0.1:5218/?map=${map}&quality=high&music=0&voice=0&diagnostics=1&laps=1${mode==='drive'||mode==='benchmark'?'&demo=1':''}${mode==='reduce'?'&motion=reduce':''}`,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.__game?.circuitRuntime?.life&&window.__game?.sceneAssets?.authoredEnvironment,{}, {timeout:45000});
  await page.waitForTimeout(2500);
  if(mode!=='drive'&&mode!=='benchmark')await page.keyboard.press('Enter');
  await page.waitForFunction(()=>window.__game?.phase==='running',{}, {timeout:20000}).catch(async error=>{await page.screenshot({path:`${out}/failed-${map}.png`});console.log({map,errors,state:await page.evaluate(()=>({phase:window.__game?.phase,body:document.body.innerText.slice(-1500)}))});throw error;});
  await page.waitForTimeout(1000);
  const details=await page.evaluate(()=>{
    const g=window.__game,r=g.circuitRuntime;
    return {districtSites:r.districts?.sites??[],sites:r.life.sites,verges:r.life.vergeSites,midground:r.life.midgroundSites,draws:r.life.root.userData.drawCalls,authoredBooths:r.life.root.userData.authoredBooths,animated:r.life.root.userData.animatedElements,base:r.base?.constructor.name??null,ownsCamera:r.ownsCamera,assists:!!r.assists};
  });
  const authored=['greenwater','bitterpan','nightshift'].includes(map);
  assert.equal(details.authoredBooths,authored,'Blender kit loads on its intended maps');
  assert.ok(details.sites.length>=3,`${map}: inhabited scenes`);assert.ok(details.sites.every(s=>s.clearance>=3),'Road remains clear');assert.ok(details.draws<(authored?44:30),'Batched scenery');assert.ok(details.verges.length>10,'Dressed intervals between stops');assert.ok(details.verges.every(v=>v.clearance>=2.5),'Roadside clusters clear the route');if(['greenwater','bitterpan'].includes(map)){assert.ok(details.midground.length+details.districtSites.length>60,'Older maps have a composed second scenery layer');assert.ok(details.districtSites.every(v=>v.clearance>=8),'Landmark compounds clear the road');assert.ok(details.midground.every(v=>v.clearance>=8));}
  if(mode==='drive'||mode==='benchmark'){
    const monitor=setInterval(async()=>{try{console.log(JSON.stringify(await page.evaluate(()=>({phase:window.__game.phase,progress:window.__game.progress,speed:window.__game.speed,lap:window.__game.lap,gate:window.__game.nextCheckpointIndex,recoveries:window.__game.diagnosticRecoveries,errors:window.__game.course.relay?.hits}))));}catch{}},10000);
    try{await page.waitForFunction(()=>window.__game?.phase==='finished',{}, {timeout:150000});}finally{clearInterval(monitor);}
    details.finish=await page.evaluate(()=>({lap:window.__game.lap,progress:window.__game.progress,recoveries:window.__game.diagnosticRecoveries,missedGates:window.__game.diagnosticMissedGates,diagnostics:document.querySelector('#futurisma-diagnostics')?.textContent}));
  }else{
    // Freeze real race before deterministic pickup/lifecycle checks.
    await page.keyboard.press('p');await page.waitForFunction(()=>window.__game.phase==='paused');
    details.rules=await page.evaluate(()=>{
      const g=window.__game,r=g.circuitRuntime,a=r.assists;
      if(!a)return {authoredRuntime:r.base.constructor.name};
      a.reset();const d=a.definitions[0];a.step(1/120,d.progress,d.lateral,1);
      const grip=a.gripSeconds,gripValue=g.course.surfaceGripAt(.22,4,g.course.halfWidth),count=a.collected;
      a.step(1/120,d.progress,d.lateral,1);const noDuplicate=a.collected===count;
      a.gripSeconds=0;a.step(1/120,d.progress,d.lateral,2);const nextLap=a.collected===count+1;
      const charge=a.definitions[1];a.step(1/120,charge.progress,charge.lateral,2);
      const braking=a.applySpeed(40,{throttle:1,brake:1,steer:0,boost:false},.1);
      const fast=a.applySpeed(100,{throttle:1,brake:0,steer:0,boost:true},.1);
      const thrust=a.applySpeed(40,{throttle:1,brake:0,steer:0,boost:false},.1);
      a.recover();const recovery=a.gripSeconds===0&&a.chargeSeconds===0;
      a.step(.1,d.progress,d.lateral,3);const immunity=a.gripSeconds===0;
      a.reset();a.beacons.update(0,false,a.states,d.progress);
      const beforeBeacon=Array.from(a.beacons.grip.instanceColor.array.slice(0,3));
      a.step(1/120,d.progress,d.lateral,1);a.beacons.update(0,false,a.states,d.progress);
      const afterBeacon=Array.from(a.beacons.grip.instanceColor.array.slice(0,3));
      const spentDim=afterBeacon.every((v,i)=>v<beforeBeacon[i]*.2);
      const spentArrowHidden=a.beacons.arrows.instanceMatrix.array.slice(0,3).every(v=>v===0);
      a.step(1/120,0,d.lateral,2);a.beacons.update(0,false,a.states,d.progress);
      const nextLapArrow=Array.from(a.beacons.arrows.instanceMatrix.array.slice(0,3)).some(v=>Math.abs(v)>.1);
      a.beacons.update(2,true,a.states,d.progress);const held=Array.from(a.beacons.grip.instanceColor.array);
      a.beacons.update(8,true,a.states,d.progress);const still=Array.from(a.beacons.grip.instanceColor.array).every((v,i)=>v===held[i]);
      a.reset();const wet=g.course.surfaceGripAt(.22,4,g.course.halfWidth),center=g.course.surfaceGripAt(.22,0,g.course.halfWidth);
      return {spentDim,spentArrowHidden,nextLapArrow,still,grip,gripValue,noDuplicate,nextLap,braking,fast,thrust,recovery,immunity,wet,center};
    });
    if(details.assists){const r=details.rules;assert.ok(r.spentDim&&r.spentArrowHidden&&r.nextLapArrow&&r.still,'Road beacons follow collection, laps and reduced motion');assert.equal(r.grip,8);assert.equal(r.gripValue,1);assert.ok(r.noDuplicate&&r.nextLap&&r.recovery&&r.immunity);assert.equal(r.braking,40);assert.equal(r.fast,100);assert.ok(r.thrust>40);if(map==='nightshift'){assert.equal(r.wet,.82);assert.equal(r.center,1);}}
    const pose=()=>page.evaluate(()=>{const r=window.__game.circuitRuntime;return {time:r.elapsed,matrices:r.life.batches.filter(b=>b.moving).map(b=>Array.from(b.mesh.instanceMatrix.array))};});
    const frozen=await pose();await page.waitForTimeout(300);assert.deepEqual(await pose(),frozen,'Pause freezes scenery');
    await page.keyboard.press('p');await page.waitForFunction(()=>window.__game.phase==='running');await page.keyboard.down('w');await page.waitForTimeout(1500);await page.keyboard.up('w');
    const moving=await pose();assert.ok(moving.time>frozen.time);if(mode==='reduce')assert.deepEqual(moving.matrices,frozen.matrices);else assert.notDeepEqual(moving.matrices,frozen.matrices);
    details.manual=await page.evaluate(()=>({speed:window.__game.speed,progress:window.__game.progress}));assert.ok(details.manual.speed>5,'Manual throttle works');
    if(details.assists){
      await page.evaluate(()=>{
        const g=window.__game,a=g.circuitRuntime.assists;a.reset();
        const pickup=a.definitions[0],progress=pickup.progress-5/g.course.length,s=g.course.sample(progress);
        g.progress=progress;g.lateral=pickup.lateral;g.position.copy(s.position).addScaledVector(s.right,pickup.lateral);
        g.forward.copy(s.tangent);g.travelDirection.copy(s.tangent);g.speed=30;g.syncPresentationPose();
      });
      await page.keyboard.down('w');
      await page.waitForFunction(()=>window.__game.circuitRuntime.assists.collected===1,{}, {timeout:2500});
      await page.keyboard.up('w');await page.waitForTimeout(1900);
      assert.equal(await page.locator('.hud').getAttribute('data-assist'),'grip','Real driving contact updates the HUD');
      await page.screenshot({path:`${out}/pickup-${map}.png`});details.actualPickup=true;
    }
    if(map==='afterglow'){
      await page.evaluate(()=>{
        const g=window.__game,s=g.course.sample(.4575);g.course.relay.reset();g.course.relay.integrity=28;g.course.relay.recover();
        g.progress=.4575;g.lateral=12.1;g.position.copy(s.position).addScaledVector(s.right,g.lateral);
        g.forward.copy(s.tangent);g.travelDirection.copy(s.tangent);g.speed=0;g.syncPresentationPose();
      });
      await page.keyboard.down('w');await page.keyboard.down('a');await page.waitForTimeout(1300);
      await page.keyboard.up('a');await page.keyboard.up('w');
      details.wallEscape=await page.evaluate(()=>({speed:window.__game.speed,lateral:window.__game.lateral,integrity:window.__game.course.relay.integrity}));
      assert.ok(details.wallEscape.speed>5,'A severely damaged craft can pull away from a barrier');
    }
    await page.keyboard.press('p');await page.waitForFunction(()=>window.__game.phase==='paused');
    // Place the driving camera just before a roadside scene for visual review.
    await page.evaluate(()=>{
      const g=window.__game,r=g.circuitRuntime,progress=r.life.sites[0].progress-55/g.course.length,s=g.course.sample(progress);
      g.progress=progress;g.position.copy(s.position);g.forward.copy(s.tangent);g.travelDirection.copy(s.tangent);g.speed=0;g.syncPresentationPose();g.updatePose({throttle:0,brake:0,steer:0,boost:false},0);
      g.updateCamera(1,0,0,g.poseProjection);g.atmosphere.updateFog(0,g.progress,g.lap,g.totalLaps,g.phase);g.sceneAssets.authoredEnvironment.updateVisibility(g.camera);g.renderer.render(g.scene,g.camera);
      document.querySelector('#pause-panel').style.display='none';
    });
  }
  await page.screenshot({path:`${out}/${mode}-${map}.png`});
  if(mode==='detail'){
    for(let index=0;index<3;index++){
      await page.evaluate(index=>{
        const g=window.__game,site=g.circuitRuntime.life.source.children[index],angle=site.rotation.y;
        g.camera.position.set(site.position.x-Math.sin(angle)*14,site.position.y+6,site.position.z-Math.cos(angle)*14);
        g.camera.up.set(0,1,0);g.camera.lookAt(site.position.x,site.position.y+1.7,site.position.z);
        g.atmosphere.updateFog(0,g.circuitRuntime.life.sites[index].progress,g.lap,g.totalLaps,g.phase);
        g.sceneAssets.authoredEnvironment.updateVisibility(g.camera);g.renderer.render(g.scene,g.camera);
      },index);
      await page.screenshot({path:`${out}/detail-${map}-site-${index}.png`});
    }
    if(details.assists){
      await page.evaluate(()=>{
        const g=window.__game,r=g.circuitRuntime;r.assists.reset();
        const progress=r.assists.definitions[0].progress-18/g.course.length,s=g.course.sample(progress);
        g.progress=progress;r.progress=progress;g.lateral=0;g.position.copy(s.position);g.forward.copy(s.tangent);g.travelDirection.copy(s.tangent);g.speed=0;
        g.syncPresentationPose();g.updatePose({throttle:0,brake:0,steer:0,boost:false},0);g.updateCamera(1,0,0,g.poseProjection);
        g.atmosphere.updateFog(0,progress,g.lap,g.totalLaps,g.phase);g.renderer.render(g.scene,g.camera);
      });
      await page.screenshot({path:`${out}/detail-${map}-beacon.png`});
    }
  }
  const perf=await page.evaluate(()=>{const t=window.__times,d=t.slice(1).map((v,i)=>v-t[i]).filter(v=>v>0);d.sort((a,b)=>a-b);return {frames:t.length,median:d[Math.floor(d.length*.5)],p95:d[Math.floor(d.length*.95)],fps:1000/(d.reduce((a,b)=>a+b,0)/d.length),calls:window.__game.renderer.info.render.calls};});
  assert.deepEqual(errors,[]);results.push({map,...details,perf,errors});console.log(JSON.stringify({map,sites:details.sites.length,perf,finish:details.finish?{recoveries:details.finish.recoveries,missedGates:details.finish.missedGates}:null,errors}));await writeFile(`${out}/${mode}-${map}.json`,JSON.stringify(results.at(-1),null,2));await writeFile(`${out}/${mode}-report.json`,JSON.stringify(results,null,2));
  await page.close();
}
}finally{await browser.close();}
