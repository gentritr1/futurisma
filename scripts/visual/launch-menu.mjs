import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {chromium} from 'playwright';
import {createServer} from 'vite';

const server=await createServer({server:{host:'127.0.0.1',port:5359,strictPort:true,hmr:false,watch:null},logLevel:'error'});
await server.listen();
const browser=await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--ignore-gpu-blocklist']});
await mkdir('shots/launch-menu',{recursive:true});
const errors=[];
const context=await browser.newContext({viewport:{width:1440,height:900},deviceScaleFactor:1,hasTouch:true});
const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
await page.addInitScript(()=>{
  window.__policyViolations=[];
  document.addEventListener('securitypolicyviolation',event=>window.__policyViolations.push(event.violatedDirective));
  window.__launchTestPad=null;
  Object.defineProperty(navigator,'getGamepads',{value:()=>window.__launchTestPad?[window.__launchTestPad]:[]});
});
const padPress=async(index,check)=>{
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  await page.evaluate(i=>Object.assign(window.__launchTestPad.buttons[i],{pressed:true,value:1}),index);
  await check();
  await page.evaluate(i=>Object.assign(window.__launchTestPad.buttons[i],{pressed:false,value:0}),index);
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
};
const ready=async(query='')=>{
  await page.goto(`http://127.0.0.1:5359/?map=nightshift&minimap=aplus${query}`);
  await page.waitForFunction(()=>document.body.dataset.phase==='intro'&&document.querySelector('.launch-menu #start-button')&&getComputedStyle(document.querySelector('.launch-background')).position==='absolute',null,{timeout:180000});
  await page.waitForFunction(()=>[...document.querySelectorAll('.launch-background')].every(i=>i.complete&&i.naturalWidth>0));
  await page.evaluate(()=>document.fonts.ready);
};
const choose=async(group,value)=>{await page.locator(`#${group}-select [data-value="${value}"]`).click();};
try {
  await ready();console.log("Ready");
  // Back must not dispatch, on either a focused control or the bare canvas.
  await page.keyboard.press('Escape');await page.keyboard.press('KeyP');
  assert.equal(await page.locator('body').getAttribute('data-phase'),'intro');
  const url=page.url();
  for(const map of ['greenwater','bitterpan','nightshift','polarity','tideline','ascension','dreamisland']) {
    await choose('track',map);
    for(const mode of ['race','sprint','timeattack']) {
      await choose('format',mode);
      for(const tier of ['rookie','works','feral']) {
        await choose('tier',tier);
        assert.equal(page.url(),url,'Browsing must never reload or navigate.');
        assert.equal(await page.locator('.launch-menu').getAttribute('data-track'),map);
        assert.equal(await page.locator(`#format-select [aria-checked="true"]`).getAttribute('data-value'),mode);
        const fact=await page.locator('.launch-facts').innerText();
        const expected=mode==='sprint'?2:['greenwater','bitterpan'].includes(map)?5:3;
        assert.ok(fact.startsWith(`${expected} LAPS`),`${map}/${mode}: ${fact}`);
        assert.ok(!(await page.locator('.launch-map svg').getAttribute('aria-label')).includes('undefined'));
      }
    }
  }
  console.log('63 choices passed');
  assert.deepEqual(await page.evaluate(()=>window.__policyViolations),[],'Circuit switches must respect CSP.');
  const delays=await page.locator('.launch-map__gate').evaluateAll(gates=>gates.map(g=>parseFloat(getComputedStyle(g).animationDelay)));
  assert.ok(delays.every((delay,i)=>i===0||delay>delays[i-1]),'Gate delays actually stagger under CSP.');
  for(const width of [1440,1920]) {
    await page.setViewportSize({width,height:900});
    for(const map of ['greenwater','bitterpan','nightshift','polarity','tideline','ascension','dreamisland']) {
      await choose('track',map);
      await page.locator('.launch-name').evaluate(el=>Promise.all(el.getAnimations().map(animation=>animation.finished)));
      const words=await page.locator('.launch-name').evaluate(name=>{
        const slab=document.querySelector('.launch-slab').getBoundingClientRect();
        return [...name.children].map(word=>{
          const range=document.createRange();range.selectNodeContents(word);
          const r=range.getBoundingClientRect();
          return {word:word.textContent,left:r.left,right:r.right,edge:slab.right-slab.width*.5*(r.bottom-slab.top)/slab.height};
        });
      });
      assert.ok(words.every(w=>w.left>=0&&w.right<=w.edge-4),`${map} name leaves its colour strip at ${width}: ${JSON.stringify(words)}`);
    }
  }
  console.log('All seven names fit the angled strip at 1440 and 1920.');
  await choose('track','tideline');await choose('format','sprint');
  assert.match(await page.locator('.launch-note').innerText(),/before the pump hall opens/);
  await page.keyboard.press('KeyR');
  assert.deepEqual(await page.locator('#launch-grid strong').allTextContents(),['TOTEM','NEEDLE 16','NIGHTFORM 24','PRIVATEER 13']);
  await page.keyboard.press('Escape');assert.equal(await page.locator('#launch-grid').isVisible(),false);
  await choose('format','timeattack');await page.keyboard.press('KeyR');
  assert.equal(await page.locator('#launch-grid .launch-rival').count(),1);
  assert.match(await page.locator('.launch-brief').innerText(),/^Solo against the clock/);
  await page.keyboard.press('Escape');
  for(let i=0;i<15;i++)await page.keyboard.press('KeyE');
  assert.equal(await page.locator('.launch-menu').getAttribute('data-track'),'ascension');
  await choose('track','nightshift');await choose('format','race');await choose('tier','works');
  for(const [width,height] of [[1440,900],[1280,720],[390,844],[390,680],[844,390]]) {
    await page.setViewportSize({width,height});await page.waitForTimeout(350);
    const bounds=await page.evaluate(()=>{
      const box=s=>{const r=document.querySelector(s).getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height};};
      return {start:box('#start-button'),setup:box('.launch-setup'),guide:box('.launch-guide'),cards:box('.launch-cards'),facts:box('.launch-facts'),overflow:document.documentElement.scrollWidth>innerWidth};
    });
    assert.ok(bounds.start.y>=0&&bounds.start.bottom<=height&&bounds.start.right<=width,JSON.stringify(bounds));
    assert.ok(bounds.setup.bottom<=bounds.start.y+4||bounds.setup.right<=bounds.start.x,`Setup obscures launch: ${width}×${height}`);
    assert.ok(!bounds.overflow);
    if(width===390)assert.ok(bounds.facts.y>=bounds.guide.bottom&&bounds.facts.bottom<=bounds.setup.y,`Phone facts overlap: ${JSON.stringify(bounds)}`);
    await page.screenshot({path:`shots/launch-menu/menu-${width}x${height}.png`});
    for(const menu of ['controls','options']) {
      await page.locator(`#${menu}-button`).click();
      await page.waitForSelector(`#${menu}-screen:not([hidden])`);
      await page.waitForTimeout(240);
      assert.equal(await page.locator(`#${menu}-screen .launch-paper`).evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(243, 244, 241)');
      assert.equal(await page.locator(`#${menu}-screen .launch-paper`).evaluate(el=>el.scrollWidth>el.clientWidth),false,`${menu} sheet overflows at ${width}`);
      await page.screenshot({path:`shots/launch-menu/${menu}-${width}x${height}.png`});
      if(width===390)await page.locator(`#${menu}-screen .launch-paper`).evaluate(el=>{el.scrollTop=el.scrollHeight;});
      const close=await page.locator(`#${menu}-close`).boundingBox();
      const x=close.x+close.width/2,y=close.y+close.height/2;
      assert.equal(await page.evaluate(({x,y})=>document.elementFromPoint(x,y)?.closest('button')?.id,{x,y}),`${menu}-close`,`${menu} RETURN must own its touch target at ${width}×${height}`);
      await page.touchscreen.tap(x,y);
      await page.waitForSelector(`#${menu}-screen[hidden]`,{state:'attached'});
      assert.notEqual(await page.locator('body').getAttribute('data-garage'),'true','RETURN must not open the garage.');
    }
  }
  if(process.argv.includes('--layout-only')) { assert.deepEqual(errors,[]);console.log('Layout PASS: five sizes, readable facts, controls/options sheets.'); } else {
  await page.setViewportSize({width:1440,height:900});
  await choose('track','polarity');await page.keyboard.press('KeyC');
  assert.equal(await page.getByRole('row',{name:'FLIP GRAVITY SPACE X'}).isVisible(),true);
  assert.equal(await page.getByRole('row',{name:'BOOST SHIFT A',exact:true}).isVisible(),true);
  await page.keyboard.press('Escape');await choose('track','nightshift');await page.keyboard.press('KeyC');
  assert.equal(await page.getByRole('row',{name:'FLIP GRAVITY SPACE X'}).isVisible(),false);
  assert.equal(await page.getByRole('row',{name:'BOOST SHIFT or SPACE A'}).isVisible(),true);
  await page.keyboard.press('Escape');
  await page.keyboard.press('KeyO');await page.waitForSelector('#options-screen:not([hidden])');await page.keyboard.press('Escape');
  await page.keyboard.press('KeyC');await page.waitForSelector('#controls-screen:not([hidden])');await page.keyboard.press('Escape');
  // Real menu routing receives a standard-pad edge, not a direct button click.
  await page.evaluate(()=>{window.__launchTestPad={index:0,id:'Launch test pad',connected:true,mapping:'standard',axes:[0,0,0,0],buttons:Array.from({length:17},()=>({pressed:false,touched:false,value:0}))};window.dispatchEvent(new Event('gamepadconnected'));});
  await padPress(5,()=>page.waitForFunction(()=>document.querySelector('.launch-menu').dataset.track==='polarity'));
  await padPress(4,()=>page.waitForFunction(()=>document.querySelector('.launch-menu').dataset.track==='nightshift'));
  await padPress(2,()=>page.waitForFunction(()=>document.body.dataset.controls==='true'));
  await padPress(1,()=>page.waitForFunction(()=>document.body.dataset.controls==='false'));
  await padPress(3,()=>page.waitForFunction(()=>document.body.dataset.options==='true'));
  await padPress(1,()=>page.waitForFunction(()=>document.body.dataset.options==='false'));
  await page.evaluate(()=>{window.__launchTestPad=null;window.dispatchEvent(new Event('gamepaddisconnected'));});
  await page.setViewportSize({width:390,height:844});
  const touch=await context.newCDPSession(page);
  await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:310,y:180}]});
  await touch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:100,y:184}]});
  await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await page.waitForFunction(()=>document.querySelector('.launch-menu').dataset.track==='polarity');
  await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:310,y:392}]});
  await touch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:100,y:394}]});
  await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  assert.equal(await page.locator('.launch-menu').getAttribute('data-track'),'polarity','Card-shelf swipe scrolls, without choosing.');
  await touch.detach();await page.setViewportSize({width:1440,height:900});await choose('track','nightshift');
  console.log('Controls, controller and touch passed');
  await page.keyboard.press('KeyG');await page.waitForFunction(()=>document.body.dataset.garage==='true');await page.keyboard.press('Escape');await page.waitForFunction(()=>document.body.dataset.garage==='false');
  // The whole launch animation is keyed to the real countdown, with no race
  // input possible until its exit. A second click cannot start a second run.
  console.log('Launching',await page.locator('body').getAttribute('data-phase'));
  await page.locator('#start-button').click();
  await page.waitForFunction(()=>document.body.dataset.launch==='lights');
  await page.screenshot({path:'shots/launch-menu/start-lights.png'});
  await page.waitForFunction(()=>!document.body.dataset.launch&&document.body.dataset.phase==='race',null,{timeout:60000});
  assert.equal(await page.locator('#launch-sequence').isVisible(),false);
  await page.screenshot({path:'shots/launch-menu/race.png'});
  console.log('Real countdown passed');
  await ready('&motion=reduce');
  assert.equal(await page.locator('.launch-map__line').evaluate(el=>getComputedStyle(el).animationName),'none');
  await choose('track','ascension');await choose('format','sprint');await choose('tier','rookie');
  // Hold the real entry module back on the changed-circuit navigation. The
  // same-origin boot script must colour the loader before menu code exists.
  let releaseEntry;
  const entryHeld=new Promise(resolve=>{releaseEntry=resolve;});
  await page.route(/\/src\/main\.ts(?:\?|$)/,async route=>{await entryHeld;await route.continue();});
  await page.locator('#start-button').click();
  await page.waitForURL(/map=ascension.*mode=sprint.*tier=rookie/,{timeout:30000,waitUntil:'commit'});
  try {
    await page.waitForSelector('html[data-launch-boot]');
    await page.waitForSelector('#loading-screen');
    assert.equal(await page.locator('#loading-screen').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(255, 111, 79)');
    assert.equal(await page.locator('#loading-screen p').isVisible(),false,'The default assembly loader must not flash.');
    assert.equal(await page.locator('#launch-sequence').count(),0,'Check happens before the menu module runs.');
    await page.screenshot({path:'shots/launch-menu/cross-circuit-early-paint.png'});
  } finally { releaseEntry(); }
  await page.waitForFunction(()=>document.body.dataset.phase==='race'&&!document.body.dataset.launch,null,{timeout:180000});
  assert.match(await page.locator('#lap-value').innerText(),/\/ 2/);
  assert.match(await page.locator('#course-name').innerText(),/ASCENSION/);
  assert.equal(new URL(page.url()).searchParams.has('launch'),false,'Auto-launch is consumed once.');
  assert.deepEqual(errors,[]);
  console.log('Launch PASS: 63 choices without reload, exact lap facts, sprint/solo grids, newest-pick wins, five layouts, options/controls/garage, real countdown, cross-circuit dispatch, reduced motion.');
  }
} catch(error) {console.error('Failure state',await page.evaluate(()=>({body:{...document.body.dataset},countdown:document.getElementById('countdown')?.textContent,overlay:document.getElementById('launch-sequence')?.dataset,errors:document.getElementById('error-message')?.textContent})),errors);await page.screenshot({path:'shots/launch-menu/failure.png'});throw error;} finally {await context.close();await browser.close();await server.close();}
