import {chromium} from 'playwright';
import {writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist']});
const errors=[],reports=[];
try{
 const page=await browser.newPage({viewport:{width:1536,height:864}});
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.goto('http://127.0.0.1:5218/?map=frostline&music=0&voice=0');
 await page.waitForSelector('.hud[data-map-theme="frostline"]',{state:'attached'});
 assert.match(await page.locator('.map-controls-note').textContent(),/cyan stabilizers/);
 await page.waitForSelector('.control-chart',{state:'attached'});await page.locator('#controls-button').click();await page.locator('#controls-screen').waitFor({state:'visible'});await page.waitForTimeout(300);await page.screenshot({path:'.dream-loop/frostline/themed-controls.png'});assert.match(await page.locator('.control-note').textContent(),/cyan stabilizers/);await page.locator('#controls-close').click();
 await page.locator('#start-button').click();await page.waitForFunction(()=>document.body.dataset.phase==='race');await page.waitForFunction(()=>document.getElementById('time-value').textContent>'00:00.200');
 await page.screenshot({path:'.dream-loop/frostline/themed-hud.png'});
 const motion=()=>page.locator('.map-hud-atmosphere').getAttribute('style');
 const moving=await motion();await page.waitForTimeout(300);assert.notEqual(await motion(),moving);
 await page.keyboard.press('p');await page.waitForTimeout(100);const paused=await motion();await page.waitForTimeout(400);assert.equal(await motion(),paused);
 await page.keyboard.press('p');await page.waitForFunction(()=>document.body.dataset.phase==='race');
 for(const map of ['greenwater','bitterpan','nightshift','polarity','tideline','ascension','dreamisland','afterglow','frostline']){
  await page.evaluate(async map=>{const {applyMapHud}=await import(performance.getEntriesByType('resource').find(e=>e.name.includes('/src/game/map-hud.ts')).name);applyMapHud(map);},map);
  await page.waitForFunction(map=>document.querySelector('.map-hud-environment img').src.endsWith(`/assets/hud/${map}.svg`)&&document.querySelector('.map-hud-environment img').complete&&document.querySelector('.map-hud-environment img').naturalWidth>0,map);
  assert.equal(await page.locator('.map-hud-environment').count(),1);
  assert.equal(await page.locator('#controls-screen').getAttribute('data-map-theme'),map);
  reports.push({map,accent:await page.locator('.hud').evaluate(e=>getComputedStyle(e).getPropertyValue('--map-accent')),assetLoaded:true});
 }
 await page.evaluate(()=>document.body.dataset.inputDevice='gamepad');await page.waitForFunction(()=>document.querySelector('.map-hud-keys').textContent.includes('RT THRUST'));assert.match(await page.locator('.map-hud-keys').textContent(),/RT THRUST/);
 await page.evaluate(()=>document.body.dataset.inputDevice='keyboard');
 for(const [width,height] of [[844,390],[390,844]]){
  await page.setViewportSize({width,height});await page.waitForTimeout(250);
  const bounds=await page.evaluate(()=>{const p=document.querySelector('.map-hud-environment').getBoundingClientRect(),d=document.querySelector('.hud-drive').getBoundingClientRect(),w=document.querySelector('.winter-status').getBoundingClientRect();return {panel:{left:p.left,right:p.right,top:p.top,bottom:p.bottom},overlapDrive:p.left<d.right&&p.right>d.left&&p.top<d.bottom&&p.bottom>d.top,overlapWinter:p.left<w.right&&p.right>w.left&&p.top<w.bottom&&p.bottom>w.top};});
  assert.ok(bounds.panel.left>=0&&bounds.panel.right<=width&&bounds.panel.bottom<=height);assert.equal(bounds.overlapDrive,false,`Drive cluster overlap at ${width}`);assert.equal(bounds.overlapWinter,false,`Winter status overlap at ${width}`);
  await page.screenshot({path:`.dream-loop/frostline/hud-${width}.png`});
 }
 await page.close();
 for(const motionSetting of ['query','os']){
  const reduced=await browser.newPage({viewport:{width:1536,height:864},...(motionSetting==='os'?{reducedMotion:'reduce'}:{})});
  reduced.on('pageerror',e=>errors.push(e.message));
  await reduced.goto('http://127.0.0.1:5218/?map=frostline&music=0&voice=0'+(motionSetting==='query'?'&motion=reduce':''));
  await reduced.waitForSelector('.hud[data-theme-motion="reduce"]',{state:'attached'});await reduced.keyboard.press('Enter');await reduced.waitForFunction(()=>document.body.dataset.phase==='race');await reduced.waitForFunction(()=>document.getElementById('time-value').textContent>'00:00.200');
  const before=await reduced.locator('.map-hud-atmosphere').getAttribute('style');await reduced.waitForTimeout(400);assert.equal(await reduced.locator('.map-hud-atmosphere').getAttribute('style'),before);await reduced.close();
 }
 for(const map of ['afterglow','dreamisland','polarity']){
  const other=await browser.newPage({viewport:{width:1536,height:864}});other.on('pageerror',e=>errors.push(e.message));
  await other.goto(`http://127.0.0.1:5218/?map=${map}&music=0&voice=0`);await other.waitForSelector(`.hud[data-map-theme="${map}"]`,{state:'attached'});await other.keyboard.press('Enter');await other.waitForFunction(()=>document.getElementById('time-value').textContent>'00:00.200');
  await other.screenshot({path:`.dream-loop/frostline/hud-${map}.png`});
  if(map==='dreamisland')assert.equal(await other.locator('html').getAttribute('data-circuit'),'dreamisland','Existing day/night island skin stays active');
  if(map==='polarity')assert.equal(await other.locator('.control-row').filter({hasText:'FLIP GRAVITY'}).getAttribute('hidden'),null,'Gravity controls remain enabled');
  await other.close();
 }
 assert.deepEqual(errors,[]);await writeFile('scripts/frostline/map-hud-validation.json',JSON.stringify({themes:reports,pauseFreezes:true,keyboardAndGamepad:true,mobileLayouts:true,reducedMotion:['query','os'],errors},null,2)+'\n');console.log('Map HUD PASS: nine palettes/assets/controls, live clock, pause, keyboard/gamepad, compact layouts, query/OS reduced motion and real Afterglow/Frostline starts.');
}finally{await browser.close();}
