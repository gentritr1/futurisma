import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const out='.dream-loop/frostline';await mkdir(out,{recursive:true});
const mode=process.argv[2]??'capture';
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist','--autoplay-policy=no-user-gesture-required','--disable-background-timer-throttling','--disable-renderer-backgrounding',...(mode==='benchmark'?['--disable-frame-rate-limit','--disable-gpu-vsync']:[])]});
const page=await browser.newPage({viewport:{width:1536,height:864},deviceScaleFactor:1});
const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
await page.route('**/src/game/game.ts*',async route=>{
  const response=await route.fetch();let body=await response.text();
  body=body.replace('this.renderer.outputColorSpace = THREE.SRGBColorSpace;','this.renderer.outputColorSpace = THREE.SRGBColorSpace; window.__game=this; window.__frames=[]; const originalRender=this.renderer.render.bind(this.renderer);this.renderer.render=(...args)=>{const offscreen=this.renderer.getRenderTarget()!==null;const started=performance.now();originalRender(...args);if(!offscreen){window.__frames.push({time:performance.now(),cpu:performance.now()-started,calls:this.renderer.info.render.calls,triangles:this.renderer.info.render.triangles,phase:this.phase,progress:this.progress});if(window.__frames.length>30000)window.__frames.shift();}};');
  await route.fulfill({response,body});
});
const params=new URLSearchParams({map:'frostline',diagnostics:'1',music:'0',voice:'0',quality:'high'});
if(mode==='capture'){params.set('probe','boundary-hold');params.set('probeDistance',process.argv[3]??'10');params.set('probeLateral','0');params.set('start','manual');params.set('headless','1');}
else if(mode==='drive') {params.set('demo','1');params.set('laps',process.argv[3]??'3');}
else if(mode==='benchmark'){params.set('demo','1');params.set('laps','1');}
if(mode==='holiday'&&process.argv[3]==='reduce')params.set('motion','reduce');
await page.goto('http://127.0.0.1:5218/?'+params,{waitUntil:'domcontentloaded'});
await page.waitForFunction(()=>window.__game?.sceneAssets?.authoredEnvironment,{timeout:30000}).catch(()=>{});
await page.waitForTimeout(5000);
if(mode==='launch'){
  await page.waitForFunction(()=>Array.from(document.images).some(image=>image.src.includes('/launch/frostline.jpg')&&image.complete&&image.naturalWidth>0));
  assert.equal(await page.evaluate(()=>document.body.dataset.map),'frostline');
  assert.match(await page.title(),/Frostline/);
}
if(mode==='capture')await page.evaluate(()=>{
  for(const node of document.querySelectorAll('#app > *, .launch-top'))if(node.id!=='game-canvas'&&!node.classList.contains('image-treatment'))node.style.display='none';
  const game=window.__game;if(game){game.course.raceProgress=game.progress;game.updateCamera(0,0,0,game.poseProjection);game.sceneAssets.authoredEnvironment.updateVisibility(game.camera);game.renderer.render(game.scene,game.camera);}
});
await page.screenshot({path:out+'/'+mode+'-'+(process.argv[3]??'10')+'.png'});
if(mode==='capture'&&(process.argv[3]??'10')==='10')await page.screenshot({path:'public/assets/launch/frostline.jpg',type:'jpeg',quality:88});
const controls={};
if(mode==='winter'){
  await page.keyboard.press('Enter');await page.waitForFunction(()=>window.__game?.phase==='running',{},{timeout:20000});
  const place=async(progress,lateral,speed,lead=0)=>page.evaluate(({progress,lateral,speed,lead})=>{
    const g=window.__game,s=g.course.sample(progress);g.progress=progress;g.lateral=lateral;g.position.copy(s.position).addScaledVector(s.right,lateral);g.forward.copy(s.tangent);g.travelDirection.copy(s.tangent);g.speed=speed;g.circuitRuntime.speed=speed;
    g.nextCheckpointIndex=g.course.checkpointProgress(1)>progress?1:g.course.checkpointProgress(2)>progress?2:g.course.checkpointProgress(3)>progress?3:g.course.checkpointProgress(4)>progress?4:g.course.checkpointProgress(5)>progress?5:g.course.checkpointProgress(6)>progress?6:0;
    g.syncPresentationPose();const frame=g.rivalFleet.rivalFrameDistance(g.playerRaceDistance());g.rivalFleet.states.forEach((s,i)=>{s.raceDistanceMeters=frame-lead-i*15;});
  },{progress,lateral,speed,lead});
  await place(.069-4/3027.565,0,45);await page.keyboard.down('w');
  await page.waitForFunction(()=>window.__game.course.winter.collected===1);await page.waitForTimeout(200);
  const pickup=await page.evaluate(()=>({seconds:window.__game.course.winter.stabilizerSeconds,grip:window.__game.course.surfaceGripAt(.3,0)}));assert.ok(pickup.seconds>9);assert.equal(pickup.grip,1);
  await page.screenshot({path:out+'/stabilizer-active.png'});
  await page.evaluate(()=>window.__game.course.winter.reset());await place(.3,0,60);await page.waitForTimeout(500);
  assert.ok(await page.evaluate(()=>window.__game.surfaceGrip<.9),'Snow changes actual driving grip');
  await page.screenshot({path:out+'/snow-driving.png'});
  await page.evaluate(()=>window.__game.course.winter.reset());await place(.503,0,65,50);await page.waitForTimeout(120);assert.equal(await page.evaluate(()=>window.__game.course.winter.snowballPhase),'idle','Close leader is not attacked');
  await place(.503,0,65,220);await page.waitForFunction(()=>window.__game.course.winter.snowballPhase==='flight');
  assert.ok(!(await page.locator('body').innerText()).includes('SNOWBALL INCOMING'),'No advance warning');
  await page.screenshot({path:out+'/snowball-flight.png'});
  await page.waitForFunction(()=>window.__game.course.winter.snowballRemaining<.12);
  const target=await page.evaluate(()=>({p:window.__game.course.winter.snowballTarget,l:window.__game.course.winter.snowballLane}));
  await page.keyboard.up('w');await place(target.p,target.l,0,220);await page.waitForFunction(()=>window.__game.course.winter.snowballHits===1);
  const visor=page.locator('.winter-visor');await visor.waitFor({state:'visible'});await page.screenshot({path:out+'/snowball-visor.png'});
  await page.keyboard.press('p');await page.waitForTimeout(100);const held=await page.evaluate(()=>window.__game.course.winter.visorSeconds);await page.waitForTimeout(350);assert.equal(await page.evaluate(()=>window.__game.course.winter.visorSeconds),held,'Pause freezes visor clearing');
  await page.keyboard.press('p');await page.waitForFunction(()=>window.__game.phase==='running');await page.waitForTimeout(2700);assert.equal(await visor.isVisible(),false,'Visor clears smoothly');
  Object.assign(controls,{pickup,closeRaceSafe:true,leadThresholdMeters:150,unannouncedShot:true,visorHit:true,pauseHolds:true,visorClears:true});
}
if(mode==='holiday'){
  await page.keyboard.press('Enter');await page.waitForFunction(()=>window.__game?.phase==='running');
  const read=()=>page.evaluate(()=>{const e=window.__game.sceneAssets.authoredEnvironment,h=e.holidayLife;return {time:window.__game.course.visualTime,steam:h.steamTime.value,poses:h.actors.map(a=>[...a.pose.position.toArray(),...a.pose.rotation.toArray().slice(0,3)]),sites:h.sites,drawBatches:h.batches.size};});
  const before=await read();assert.ok(before.sites.some(s=>s.name==='gift express'));assert.ok(before.sites.some(s=>s.name==='lantern skating pond'));assert.ok(before.sites.filter(s=>s.name==='village gathering').length>=15);assert.ok(before.sites.every(s=>s.clearance-s.radius>=15));assert.ok(before.drawBatches<30);assert.ok(before.poses.length>70);
  await page.waitForTimeout(1100);const after=await read();
  if(process.argv[3]==='reduce')assert.deepEqual(after.poses,before.poses,'Reduced motion keeps residents, skating and train still');
  else {assert.notDeepEqual(after.poses,before.poses,'Residents, skaters and train animate');assert.ok(after.steam>before.steam);}
  await page.keyboard.press('p');await page.waitForTimeout(100);const paused=await read();await page.waitForTimeout(450);assert.deepEqual(await read(),paused,'Pause holds all holiday motion');
  await page.keyboard.press('p');await page.waitForFunction(()=>window.__game.phase==='running');
  const deterministic=await page.evaluate(()=>{const h=window.__game.sceneAssets.authoredEnvironment.holidayLife;h.update(42);const expected=h.actors.map(a=>a.pose.matrix.toArray());h.update(0);h.update(42);return JSON.stringify(expected)===JSON.stringify(h.actors.map(a=>a.pose.matrix.toArray()));});assert.equal(deterministic,true);
  if(process.argv[3]!=='reduce')for(const distance of [100,735,1080,1970]){
    await page.evaluate(distance=>{const g=window.__game,p=distance/g.course.length,s=g.course.sample(p);g.progress=p;g.position.copy(s.position);g.forward.copy(s.tangent);g.travelDirection.copy(s.tangent);g.speed=0;g.lateral=0;g.syncPresentationPose();},distance);
    await page.waitForTimeout(550);await page.screenshot({path:`${out}/holiday-${distance}.png`});
  }
  Object.assign(controls,{holidaySites:before.sites,actors:before.poses.length,drawBatches:before.drawBatches,motion:process.argv[3]==='reduce'?'reduced':'full',pauseHolds:true,deterministic});
}
if(mode==='alive'){
  await page.keyboard.press('Enter');await page.waitForFunction(()=>window.__game?.phase==='running',{},{timeout:20000});
  assert.equal(await page.locator('.hud').getAttribute('data-minimap'),'aplus');
  const read=()=>page.evaluate(()=>{const g=window.__game,e=g.sceneAssets.authoredEnvironment;return {time:g.course.visualTime,shaderTime:e.time.value,gondola:e.gondolas[0].position.x,celebration:e.celebration.value,ticks:g.circuitRuntime.ambience.ticks,audio:g.audio.environmentAudio()?.context.state};});
  const before=await read();await page.waitForTimeout(2400);const after=await read();
  assert.ok(after.time>before.time+2&&after.shaderTime>before.shaderTime+2,'Shared snow, windows, twinkle and smoke clock advances');
  assert.notEqual(after.gondola,before.gondola,'Gondolas travel');assert.ok(after.ticks>before.ticks,'Clock ticks near village');assert.equal(after.audio,'running','Sounds use the running game audio context');
  await page.keyboard.press('p');await page.waitForTimeout(180);const paused=await read();await page.waitForTimeout(500);assert.deepEqual(await read(),paused,'Pause freezes presentation and tick scheduling');
  await page.keyboard.press('p');await page.waitForFunction(()=>window.__game.phase==='running');
  await page.evaluate(()=>{window.__game.lap=3;});await page.waitForTimeout(500);const finale=await read();assert.equal(finale.celebration,1,'Final lap increases fireworks');
  assert.equal(await page.locator('canvas.minimap').getAttribute('data-signal'),'degraded','Final lap introduces snow fog');
  assert.ok(await page.evaluate(()=>window.__game.minimap.diagnostics().minimapInterference>.3));
  assert.ok(await page.evaluate(()=>window.__game.circuitRuntime.ambience.chimes>=4),'Midnight bells fire');
  await page.screenshot({path:out+'/midnight.png'});Object.assign(controls,{before,after,paused,finale});
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
const report=await page.evaluate(()=>({frames:window.__frames,diagnostics:document.getElementById('futurisma-diagnostics')?.textContent,body:document.body.innerText.slice(-3000),state:window.__game?{phase:window.__game.phase,progress:window.__game.progress,lap:window.__game.lap,ambience:window.__game.circuitRuntime.ambience}:null}));
report.errors=errors;report.controls=controls;await writeFile(out+'/'+mode+(mode==='holiday'&&process.argv[3]==='reduce'?'-reduce':'')+'-report.json',JSON.stringify(report,null,2));
assert.deepEqual(errors,[],'No browser or rendering errors');
console.log(JSON.stringify({errors,body:report.body,state:report.state,frames:report.frames?.length,diagnostics:report.diagnostics?.slice(0,1000)},null,2));
await browser.close();
