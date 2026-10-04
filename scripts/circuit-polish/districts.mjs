import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const out='.dream-loop/districts';await mkdir(out,{recursive:true});
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist']});
const reports=[];
try{
 for(const map of ['bitterpan','greenwater']){
  const page=await browser.newPage({viewport:{width:1536,height:864},deviceScaleFactor:1});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/src/game/game.ts*',async route=>{
   const response=await route.fetch();await route.fulfill({response,body:(await response.text()).replace('this.renderer.outputColorSpace = THREE.SRGBColorSpace;','this.renderer.outputColorSpace = THREE.SRGBColorSpace;window.__game=this;')});
  });
  await page.goto(`http://127.0.0.1:5218/?map=${map}&quality=high&music=0&voice=0&diagnostics=1`);
  await page.waitForFunction(()=>window.__game?.circuitRuntime?.districts&&window.__game.sceneAssets?.authoredEnvironment);
  await page.waitForTimeout(2500);await page.keyboard.press('Enter');await page.waitForFunction(()=>window.__game.phase==='running');
  await page.keyboard.press('p');await page.waitForFunction(()=>window.__game.phase==='paused');
  const details=await page.evaluate(()=>{
   const g=window.__game,d=g.circuitRuntime.districts;
   const snapshot=()=>d.batches.filter(b=>b.moving).map(b=>Array.from(b.mesh.instanceMatrix.array));
   const initial=snapshot();d.update(8,false);const changed=JSON.stringify(initial)!==JSON.stringify(snapshot());
   d.update(0,true);const reduced=snapshot();d.update(15,true);const held=JSON.stringify(reduced)===JSON.stringify(snapshot());
   const bounds=[];
   for(const group of d.source.children){
    group.updateMatrixWorld(true);
    for(let time=0;time<=60;time+=10){
     d.update(time,false);
     group.traverse(mesh=>{
      if(!mesh.geometry)return;
      mesh.geometry.computeBoundingBox();const b=mesh.geometry.boundingBox;
      for(const x of [b.min.x,b.max.x])for(const y of [b.min.y,b.max.y])for(const z of [b.min.z,b.max.z]){
       const p=g.position.clone().set(x,y,z).applyMatrix4(mesh.matrixWorld);
       for(let sample=0;sample<g.course.length/4;sample++){
        const s=g.course.sample(sample/Math.ceil(g.course.length/4));
        if(Math.abs(s.position.y-p.y)>36)continue;
        const distance=Math.hypot(p.x-s.position.x,p.z-s.position.z)-s.halfWidth;
        if(distance<6)bounds.push(distance);
       }
      }
     });
    }
   }
   d.update(0,true);
   return {sites:d.sites.map(s=>({progress:s.progress,clearance:s.clearance,landmark:s.landmark})),draws:d.batches.length,activities:d.activities.length,changed,held,bounds};
  });
  assert.ok(details.sites.length>35,'A sustained second layer around the lap');assert.ok(details.sites.every(s=>s.clearance>=8));
  assert.equal(details.bounds.length,0,'Actual geometry and full motion envelope stay outside road');
  assert.ok(details.changed&&details.held);assert.ok(details.draws<=24,'Shared authored scenery stays batched');
  for(const progress of [.02,.18,.35,.52,.69,.86]){
   await page.evaluate(progress=>{
    const g=window.__game,s=g.course.sample(progress);
    g.progress=progress;g.lateral=0;g.position.copy(s.position);g.forward.copy(s.tangent);g.travelDirection.copy(s.tangent);g.speed=0;
    g.syncPresentationPose();g.updatePose({throttle:0,brake:0,steer:0,boost:false},0);g.updateCamera(1,0,0,g.poseProjection);
    g.atmosphere.updateFog(0,progress,g.lap,g.totalLaps,g.phase);g.sceneAssets.authoredEnvironment.updateVisibility(g.camera);
    g.renderer.render(g.scene,g.camera);document.querySelector('#pause-panel').style.display='none';
   },progress);
   await page.screenshot({path:`${out}/${map}-${progress}.png`});
  }
  const choices=await page.evaluate(()=>{
   const a=window.__game.circuitRuntime.assists,g=window.__game;
   const results=[];
   for(let i=0;i<a.definitions.length;i+=2){
    const pair=a.definitions.slice(i,i+2),width=g.course.sample(pair[0].progress).halfWidth;
    const outcomes=[];
    for(const def of pair){a.reset();a.step(1/120,def.progress,def.lateral,1);outcomes.push({collected:a.collected,grip:a.gripSeconds,charge:a.chargeSeconds});}
    results.push({separation:Math.abs(pair[0].lateral-pair[1].lateral),margins:pair.map(d=>width-Math.abs(d.lateral)),sameStation:pair[0].progress===pair[1].progress,outcomes});
   }
   a.reset();return results;
  });
  assert.equal(choices.length,4);
  for(const choice of choices){
   assert.ok(choice.sameStation&&choice.separation>4.3);assert.ok(choice.margins.every(m=>m>=3.8));
   assert.deepEqual(choice.outcomes,[{collected:1,grip:8,charge:0},{collected:1,grip:0,charge:6}]);
  }
  const disposal=await page.evaluate(()=>{
   const d=window.__game.circuitRuntime.districts,counts={geometry:0,material:0,texture:0,instances:0};
   for(const [type,set] of [['geometry',d.geometries],['material',d.materials],['texture',d.textures],['instances',d.batches.map(b=>b.mesh)]]){
    for(const resource of set)resource.addEventListener('dispose',()=>counts[type]++);
   }
   const expected={geometry:d.geometries.size,material:d.materials.size,texture:d.textures.size,instances:d.batches.length};
   d.dispose();d.dispose();return {counts,expected,detached:!d.root.parent};
  });
  assert.deepEqual(disposal.counts,disposal.expected);assert.ok(disposal.detached);assert.deepEqual(errors,[]);
  reports.push({map,...details,choices,disposal,errors});console.log(JSON.stringify({map,sites:details.sites.length,draws:details.draws,activities:details.activities,clearance:Math.min(...details.sites.map(s=>s.clearance)),errors}));
  await page.close();
 }
 const fallback=await browser.newPage();
 await fallback.route('**/assets/circuit-districts/districts.glb',route=>route.fulfill({status:503,body:'Optional landmark asset unavailable'}));
 await fallback.route('**/src/game/game.ts*',async route=>{
  const response=await route.fetch();await route.fulfill({response,body:(await response.text()).replace('this.renderer.outputColorSpace = THREE.SRGBColorSpace;','this.renderer.outputColorSpace = THREE.SRGBColorSpace;window.__game=this;')});
 });
 await fallback.goto('http://127.0.0.1:5218/?map=bitterpan&music=0&voice=0');
 await fallback.waitForFunction(()=>window.__game?.circuitRuntime?.life&&window.__game.sceneAssets?.authoredEnvironment);
 await fallback.waitForTimeout(2500);await fallback.keyboard.press('Enter');await fallback.waitForFunction(()=>window.__game.phase==='running');
 assert.equal(await fallback.evaluate(()=>window.__game.circuitRuntime.districts),null);
 reports.push({assetFailure:'race remains playable with original scenery'});await fallback.close();
 await writeFile(`${out}/validation.json`,JSON.stringify(reports,null,2));
}finally{await browser.close();}
