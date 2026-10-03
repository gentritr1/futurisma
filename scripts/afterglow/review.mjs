import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const out='.dream-loop/afterglow';await mkdir(out,{recursive:true});
const mode=process.argv[2]??'capture';
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist','--autoplay-policy=no-user-gesture-required','--disable-background-timer-throttling','--disable-renderer-backgrounding',...(mode==='benchmark'?['--disable-frame-rate-limit','--disable-gpu-vsync']:[])]});
const page=await browser.newPage({viewport:{width:1536,height:864},deviceScaleFactor:1});
const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
await page.route('**/src/game/game.ts*',async route=>{
  const response=await route.fetch();let body=await response.text();
  body=body.replace('this.renderer.outputColorSpace = THREE.SRGBColorSpace;','this.renderer.outputColorSpace = THREE.SRGBColorSpace; window.__game=this; window.__frames=[]; const originalRender=this.renderer.render.bind(this.renderer);this.renderer.render=(...args)=>{const offscreen=this.renderer.getRenderTarget()!==null;const started=performance.now();originalRender(...args);if(!offscreen){window.__frames.push({time:performance.now(),cpu:performance.now()-started,calls:this.renderer.info.render.calls,triangles:this.renderer.info.render.triangles,phase:this.phase,progress:this.progress});if(window.__frames.length>30000)window.__frames.shift();}};');
  await route.fulfill({response,body});
});
const params=new URLSearchParams({map:'afterglow',diagnostics:'1',music:'0',voice:'0',quality:'high'});
if(mode==='interference'&&process.argv[3]==='reduce')params.set('motion','reduce');
if(mode==='capture'){params.set('probe','boundary-hold');params.set('probeDistance',process.argv[3]??'10');params.set('probeLateral','0');params.set('start','manual');params.set('headless','1');}
else if(mode==='drive') {params.set('demo','1');params.set('laps',process.argv[3]??'3');}
else if(mode==='benchmark'){params.set('demo','1');params.set('laps','1');}
else if(mode==='relay'||mode==='interference'){params.set('demo','1');params.set('laps','3');}
await page.goto('http://127.0.0.1:5218/?'+params,{waitUntil:'domcontentloaded'});
await page.waitForFunction(()=>window.__game?.sceneAssets?.authoredEnvironment,{timeout:30000}).catch(()=>{});
await page.waitForTimeout(5000);
if(mode==='launch'){
  await page.waitForFunction(()=>Array.from(document.images).some(image=>image.src.includes('/launch/afterglow.jpg')&&image.complete&&image.naturalWidth>0));
  assert.equal(await page.evaluate(()=>document.body.dataset.map),'afterglow');
  assert.match(await page.title(),/Afterglow/);
}
if(mode==='capture')await page.evaluate(()=>{
  for(const node of document.querySelectorAll('#app > *, .launch-top'))if(node.id!=='game-canvas'&&!node.classList.contains('image-treatment'))node.style.display='none';
  const game=window.__game;if(game){game.updateCamera(0,0,0,game.poseProjection);game.sceneAssets.authoredEnvironment.updateVisibility(game.camera);game.renderer.render(game.scene,game.camera);}
});
await page.screenshot({path:out+'/'+mode+'-'+(process.argv[3]??'10')+'.png'});
if(mode==='capture'&&(process.argv[3]??'10')==='10')await page.screenshot({path:'public/assets/launch/afterglow.jpg',type:'jpeg',quality:88});
const controls={};
if(mode==='interference'){
  await page.waitForFunction(()=>window.__game.phase==='running');
  const read=()=>page.evaluate(()=>({phase:window.__game.course.relay.phase,...window.__game.minimap.diagnostics()}));
  const clear=await read();assert.equal(clear.minimapInterference,0);
  await page.locator('canvas.minimap').screenshot({path:out+'/minimap-clear.png'});
  await page.evaluate(()=>{window.__game.lap=3;});
  await page.waitForFunction(()=>window.__game.course.relay.phase==='strike');
  await page.waitForTimeout(550);
  const disturbed=await read();assert.ok(disturbed.minimapInterference>.75);
  if(process.argv[3]==='reduce')assert.equal(disturbed.minimapInterferenceTime,0,'Reduced motion holds the interference pattern still');
  else assert.ok(disturbed.minimapInterferenceTime>0,'Full motion drifts slowly');
  await page.locator('canvas.minimap').screenshot({path:out+'/minimap-interference'+(process.argv[3]==='reduce'?'-reduced':'')+'.png'});
  await page.screenshot({path:out+'/minimap-interference-gameplay.png'});
  assert.equal(await page.locator('canvas.minimap').getAttribute('data-signal'),'degraded');
  await page.keyboard.press('p');await page.waitForTimeout(150);const paused=await read();await page.waitForTimeout(450);assert.deepEqual(await read(),paused,'Pause holds interference');
  await page.evaluate(()=>{const g=window.__game;g.course.relay.reset();g.minimap.update(0,0,g.progress,0,0);});
  assert.equal((await read()).minimapInterference,0,'Restart clears fog');
  Object.assign(controls,{clear,disturbed,pauseHolds:true,resetClears:true});
}
if(mode==='relay'){
  await page.waitForFunction(()=>window.__game.phase==='running');
  assert.equal(await page.evaluate(()=>window.__game.course.relay.phase),'idle');
  assert.equal(await page.locator('.hud').getAttribute('data-minimap'),'aplus');
  await page.evaluate(()=>{window.__game.lap=3;});
  await page.waitForFunction(()=>window.__game.course.relay.phase==='sky');
  await page.waitForTimeout(350);await page.screenshot({path:out+'/relay-sky.png'});
  await page.waitForFunction(()=>window.__game.course.relay.phase==='mark');
  await page.evaluate(()=>{window.__game.course.relay.immunity=5;});
  await page.waitForTimeout(800);await page.screenshot({path:out+'/relay-warning.png'});
  await page.waitForFunction(()=>window.__game.course.relay.phase==='strike');
  await page.screenshot({path:out+'/relay-strike.png'});
  await page.evaluate(()=>{const g=window.__game,a=g.course.relay,s=g.course.sample(a.targetProgress);a.immunity=0;g.progress=a.targetProgress;g.position.copy(s.position).addScaledVector(s.right,a.targetLateral);g.forward.copy(s.tangent);g.travelDirection.copy(s.tangent);g.lateral=a.targetLateral;g.speed=80;});
  await page.waitForFunction(()=>window.__game.course.relay.hits===1);
  const hit=await page.evaluate(()=>({speed:window.__game.speed,integrity:window.__game.course.relay.integrity}));
  assert.ok(hit.speed<55);assert.equal(hit.integrity,82);
  await page.waitForTimeout(500);await page.screenshot({path:out+'/relay-hit.png'});
  const pausedBefore=await page.evaluate(()=>window.__game.course.relay.remaining);await page.keyboard.press('p');await page.waitForTimeout(350);
  const pausedAfter=await page.evaluate(()=>window.__game.course.relay.remaining);assert.ok(Math.abs(pausedBefore-pausedAfter)<.1,'Pause freezes the hazard');
  Object.assign(controls,{hit,minimap:'aplus',pauseHolds:true});
}
if(mode==='manual'){
  await page.keyboard.press('Enter');await page.waitForFunction(()=>window.__game?.phase==='running',{},{timeout:20000});
  const read=()=>page.evaluate(()=>({speed:window.__game.speed,progress:window.__game.progress,lateral:window.__game.lateral,phase:window.__game.phase,boost:window.__game.boostActive}));
  const start=await read();await page.keyboard.down('w');await page.waitForTimeout(1700);const accelerating=await read();assert.ok(accelerating.speed>start.speed+10,'W accelerates');
  await page.keyboard.down('a');await page.waitForTimeout(160);await page.keyboard.up('a');const steering=await read();assert.ok(Math.abs(steering.lateral-accelerating.lateral)>.03,'A steers');
  await page.keyboard.down('Shift');await page.waitForTimeout(650);const boost=await read();await page.keyboard.up('Shift');assert.ok(boost.speed>steering.speed,'Shift boosts');
  await page.keyboard.up('w');await page.keyboard.down('s');await page.waitForTimeout(650);const brake=await read();await page.keyboard.up('s');assert.ok(brake.speed<boost.speed,'S brakes');
  await page.keyboard.press('p');await page.waitForTimeout(250);const paused=await read();assert.equal(paused.phase,'paused');await page.waitForTimeout(400);const held=await read();assert.equal(held.progress,paused.progress,'Pause holds physics');
  await page.keyboard.press('p');await page.waitForFunction(()=>window.__game.phase==='running',{},{timeout:10000});
  await page.keyboard.press('r');await page.waitForTimeout(1800);const recovered=await read();assert.ok(Number.isFinite(recovered.progress)&&recovered.speed>=0,'R recovers');
  Object.assign(controls,{start,accelerating,steering,boost,brake,paused,recovered});
  await page.screenshot({path:out+'/manual-controls.png'});
}
if(mode==='drive'||mode==='benchmark')await page.waitForFunction(()=>window.__game?.phase==='finished',{},{timeout:180000});
const report=await page.evaluate(()=>({frames:window.__frames,diagnostics:document.getElementById('futurisma-diagnostics')?.textContent,body:document.body.innerText.slice(-3000),state:window.__game?{phase:window.__game.phase,progress:window.__game.progress,lap:window.__game.lap}:null}));
report.errors=errors;report.controls=controls;await writeFile(out+'/'+mode+(mode==='interference'&&process.argv[3]==='reduce'?'-reduced':'')+'-report.json',JSON.stringify(report,null,2));
assert.deepEqual(errors,[],'No browser or rendering errors');
console.log(JSON.stringify({errors,body:report.body,state:report.state,frames:report.frames?.length,diagnostics:report.diagnostics?.slice(0,1000)},null,2));
await browser.close();
