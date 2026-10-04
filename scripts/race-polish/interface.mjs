import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
const output='art/evidence/interface-polish';
await mkdir(output,{recursive:true});
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist']});
const report={viewports:[],errors:[],finish:'Controlled finish fixture after real input and restart checks.'};
try {
 const page=await browser.newPage({viewport:{width:1280,height:720}});
 page.on('pageerror',e=>report.errors.push(e.message));
 await page.routeWebSocket('**',socket=>socket.send(JSON.stringify({type:'connected'})));
 await page.route('**/src/game/game.ts*',async route=>{const response=await route.fetch();await route.fulfill({response,body:(await response.text()).replace('this.renderer.outputColorSpace = THREE.SRGBColorSpace;','this.renderer.outputColorSpace = THREE.SRGBColorSpace; window.__game = this;')});});
 await page.goto('http://127.0.0.1:5218/?map=greenwater&mode=sprint&tier=rookie&motion=reduce&music=0&voice=0');
 await page.waitForSelector('.launch-reward');
 await page.evaluate(()=>document.fonts.ready);
 if (process.argv.includes('--focus-only')) {
  await page.waitForFunction(()=>window.__game?.running);
  await page.evaluate(()=>{const g=window.__game;g.lapTimesMs=[64000,61000];g.elapsedMs=125000;g.bestLapMs=61000;g.finishRace();});
  await page.waitForSelector('.garage__reward');
  await page.locator('#result-garage-button').click();await page.waitForSelector('#garage-screen:not([hidden])');
  await page.locator('[data-key="tab-parts"]').click();await page.locator('.garage__part').first().click();
  await page.setViewportSize({width:390,height:680});await page.waitForTimeout(300);
  await page.setViewportSize({width:844,height:390});await page.waitForTimeout(300);
  await page.locator('#garage-close').click();
  for (let step=0;step<3;step++) {
   console.log(await page.evaluate(()=>{const e=document.getElementById('result-garage-button');e.focus();return {focused:document.activeElement.id,inert:e.closest('[inert]')?.id,visibility:getComputedStyle(e).visibility,parents:[...function*(e){while(e){yield {id:e.id,hidden:e.hidden,inert:e.inert,visibility:getComputedStyle(e).visibility};e=e.parentElement}}(e)]};}));
   await page.waitForTimeout(300);
  }
  await page.keyboard.press('Tab');console.log('Tab target',await page.evaluate(()=>document.activeElement.outerHTML));
  await browser.close();process.exit(0);
 }
 if (process.argv.includes('--backdrop')) {
  await page.waitForFunction(()=>window.__game?.running);
  await page.waitForTimeout(1800);
  const image=await page.evaluate(()=>{
   const g=window.__game, camera=g.camera.clone();
   const point=g.course.sample((g.course.startProgress+.025)%1).position.clone();
   const target=g.course.sample((g.course.startProgress+.065)%1).position.clone();
   camera.position.copy(point);camera.position.y+=10;
   target.y+=5;camera.lookAt(target);camera.updateMatrixWorld();
   g.sceneAssets.authoredEnvironment?.updateVisibility(camera);
   g.renderer.render(g.scene,camera);
   return g.renderer.domElement.toDataURL('image/jpeg',.9).split(',')[1];
  });
  await writeFile(`${output}/greenwater-backdrop.jpg`,Buffer.from(image,'base64'));
  await browser.close();process.exit(0);
 }

 for(const [width,height] of [[1280,720],[390,680],[844,390]]) {
  await page.setViewportSize({width,height});
  await page.screenshot({path:`${output}/launch-${width}x${height}.png`});
  for (const panel of ['controls','options']) {
   await page.locator(`#${panel}-button`).click();
   await page.waitForSelector(`#${panel}-screen:not([hidden])`);
   await page.waitForTimeout(650);
   const bg=await page.locator(`#${panel}-screen .launch-paper`).evaluate(el=>getComputedStyle(el).backgroundColor);
   assert.equal(bg,'rgb(243, 244, 241)');
   await page.screenshot({path:`${output}/${panel}-${width}x${height}.png`});
   await page.locator(`#${panel}-screen .launch-paper`).evaluate(el=>el.scrollTop=el.scrollHeight);
   const close=await page.locator(`#${panel}-close`).boundingBox();
   assert.ok(close.y>=0&&close.y+close.height<=height,`Return offscreen: ${panel} ${width}x${height}`);
   await page.keyboard.press('Escape');
  }
 }
 await page.setViewportSize({width:1280,height:720});
 await page.locator('#start-button').click();
 await page.waitForFunction(()=>window.__game?.phase==='running'&&!document.body.dataset.launch,null,{timeout:60000});
 await page.keyboard.down('w');await page.waitForTimeout(1600);await page.keyboard.up('w');
 assert.ok(await page.evaluate(()=>window.__game.speed>10));
 await page.screenshot({path:`${output}/hud.png`});
 await page.keyboard.press('p');
 await page.waitForFunction(()=>window.__game.phase==='paused');
 for(const [width,height] of [[1280,720],[390,680],[844,390]]) {
  await page.setViewportSize({width,height});
  const quit=await page.locator('#pause-quit').boundingBox();
  assert.ok(quit.y>=0&&quit.y+quit.height<=height,`Quit offscreen: ${width}x${height}`);
  await page.screenshot({path:`${output}/pause-${width}x${height}.png`});
 }
 await page.setViewportSize({width:1280,height:720});
 await page.locator('#pause-quit').focus();
 await page.keyboard.down('Enter');await page.waitForTimeout(250);await page.keyboard.press('Tab');await page.waitForTimeout(1100);await page.keyboard.up('Enter');
 assert.equal(await page.evaluate(()=>window.__game.phase),'paused');
 assert.equal(await page.locator('#pause-quit').getAttribute('data-holding'),'false');
 report.quitBlurCancels=true;
 await page.locator('#pause-restart').click();assert.match(await page.locator('#pause-restart').innerText(),/CONFIRM/);
 await page.locator('#pause-resume').focus();assert.equal(await page.locator('#pause-restart').innerText(),'RESTART RACE');
 await page.locator('#pause-restart').click();await page.locator('#pause-restart').click();
 await page.waitForFunction(()=>window.__game.phase==='countdown');
 const restarted=await page.evaluate(()=>({lap:window.__game.lap,elapsed:window.__game.elapsedMs,course:window.__game.course.kind,laps:window.__game.totalLaps}));
 assert.deepEqual(restarted,{lap:1,elapsed:0,course:'greenwater',laps:2});report.restart=restarted;
 await page.waitForFunction(()=>window.__game.phase==='running');
 await page.keyboard.press('p');await page.waitForFunction(()=>window.__game.phase==='paused');await page.locator('#pause-quit').focus();await page.keyboard.down('Escape');await page.waitForTimeout(1200);await page.keyboard.up('Escape');
 assert.notEqual(await page.evaluate(()=>window.__game.phase),'paused');report.escapeResumes=true;
 await page.waitForFunction(()=>window.__game.phase==='running');
 await page.evaluate(()=>{const g=window.__game;g.lapTimesMs=[64000,61000];g.elapsedMs=125000;g.bestLapMs=61000;g.finishRace();});
 await page.waitForSelector('.garage__reward');await page.waitForTimeout(650);
 assert.equal(await page.locator('#result-circuit').innerText(),'MAP 01 / GREENWATER STRIP');
 assert.equal(await page.locator('.garage__reward button').count(),0);
 assert.equal(await page.locator('.garage__reward progress').count(),1);
 assert.doesNotMatch(await page.locator('#result-purse').innerText(),/NOT BOUGHT|SHORT|OPEN THE GARAGE/);
 for(const [width,height] of [[1280,720],[390,680],[844,390]]) {
  await page.setViewportSize({width,height});
  await page.locator('#restart-button').focus();
  await page.locator('.result-content').evaluate(el=>el.scrollTop=0);
  const action=await page.locator('#restart-button').boundingBox();
  assert.ok(action.y>=0&&action.y+action.height<=height&&action.x>=0&&action.x+action.width<=width,`Race Again offscreen ${width}x${height}`);
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
  const row=await page.locator('#result-laps li').first().boundingBox();assert.ok(row.height<=60,'Standings must remain horizontal');
  assert.equal(overflow,false);
  report.viewports.push({width,height,action});
  await page.screenshot({path:`${output}/result-${width}x${height}.png`});
  await page.locator('.race-debrief__next').focus();
  const next=await page.locator('.race-debrief__next').boundingBox();
  const content=await page.locator('.result-content').boundingBox();
  assert.ok(next.y>=content.y-1&&next.y+next.height<=content.y+content.height+1,'Focused secondary must scroll into view');
 }
 await page.setViewportSize({width:1280,height:720});
 await page.locator('#result-garage-button').click();
 await page.waitForSelector('#garage-screen:not([hidden])');await page.waitForTimeout(650);
 await page.screenshot({path:`${output}/garage.png`});
 await page.locator('[data-key="tab-parts"]').click();
 await page.locator('.garage__part').first().click();
 for(const [width,height] of [[1280,720],[390,680],[844,390]]) {
  await page.setViewportSize({width,height});await page.waitForTimeout(300);
  await page.screenshot({path:`${output}/work-order-${width}x${height}.png`});
  assert.equal(await page.locator('.garage__work-order').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(243, 244, 241)');
 }
 await page.locator('#garage-close').click();
 await page.locator('#result-garage-button').focus();
 report.focusBefore=await page.evaluate(()=>({focused:document.activeElement.id,phase:document.body.dataset.phase,garage:document.body.dataset.garage,targets:[...document.querySelectorAll('#result-screen button:not(:disabled),#result-screen summary')].filter(el=>el.getClientRects().length).map(el=>el.id||el.tagName)}));
 await page.keyboard.press('Tab');
 assert.equal(await page.evaluate(()=>document.activeElement.tagName),'SUMMARY');
 await page.locator('#restart-button').click();await page.waitForFunction(()=>window.__game.phase==='running');
 await page.keyboard.press('p');await page.waitForFunction(()=>window.__game.phase==='paused');
 // Synthetic standard pad exercises the production polling and menu routing.
 await page.evaluate(()=>{
  window.__pad={index:0,id:'Synthetic standard pad',connected:true,mapping:'standard',axes:[0,0,0,0],buttons:Array.from({length:17},()=>({pressed:false,touched:false,value:0}))};
  Object.defineProperty(navigator,'getGamepads',{value:()=>[window.__pad]});
 });
 await page.locator('#pause-quit').focus();
 await page.evaluate(()=>Object.assign(window.__pad.buttons[1],{pressed:true,value:1}));
 await page.waitForFunction(()=>window.__game.phase==='resuming');
 await page.evaluate(()=>Object.assign(window.__pad.buttons[1],{pressed:false,value:0}));
 report.gamepadBResumesFromQuit=true;
 await page.waitForFunction(()=>window.__game.phase==='running');
 await page.keyboard.press('p');await page.waitForFunction(()=>window.__game.phase==='paused');
 await page.locator('#pause-quit').focus();
 await page.evaluate(()=>Object.assign(window.__pad.buttons[0],{pressed:true,value:1}));
 await page.waitForFunction(()=>document.getElementById('pause-quit').dataset.holding==='true');
 await page.waitForEvent('load',{timeout:15000});
 await page.waitForSelector('.launch-reward');
 assert.equal(await page.evaluate(()=>document.body.dataset.phase),'intro');
 report.gamepadAHoldQuits=true;

 assert.deepEqual(report.errors,[]);
} finally {await browser.close();await writeFile(`${output}/report.json`,JSON.stringify(report,null,2));}
console.log('Interface checks passed: sheets, pinned result actions, restart reset, Escape resume and quit cancellation.');
