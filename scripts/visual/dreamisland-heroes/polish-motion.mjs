/** Verify the added waterfall shader flows normally and parks under motion=reduce. */
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {launchReviewBrowser} from '../tideline-v4/browser.mjs';
import {instrument} from '../dreamisland/instrument.mjs';
const out='art/evidence/dreamisland-v1/polish/waterfall-motion';await mkdir(out,{recursive:true});
const route=JSON.parse(await readFile('src/game/data/dreamisland/route.json','utf8')),station=route.stations[Math.round(.455*route.count)];
const position=station.p.map((v,i)=>v-station.t[i]*11.5+(i===1?4.8:0)),target=station.p.map((v,i)=>v+station.t[i]*19+(i===1?1.15:0));
const browser=await launchReviewBrowser(),errors=[],results=[];
try{
 for(const reduced of [false,true]){
  const page=await browser.newPage();await page.bringToFront();page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await instrument(page);await page.evaluateOnNewDocument(()=>{window.__diCaptureFrame=(r,args)=>{window.__motionCamera=args[1];window.__motionRenderer=r;};});
  await page.goto('http://127.0.0.1:5217/?map=dreamisland&seed=3868938316&tier=works&demo=1&headless=1&diagnostics=1&start=manual&quality=high&music=0&nightBlend=1'+(reduced?'&motion=reduce':''),{waitUntil:'networkidle0',timeout:60000});
  await page.waitForSelector('#start-button',{visible:true});
  const pose=await page.evaluate(async(position,target)=>{const m=await import('/scripts/visual/dreamisland-heroes/polish-scene.mjs');window.__motionReview=m.prepare(window.__diScene,window.__motionCamera,window.__motionRenderer);return window.__motionReview.pin(position,target);},position,target);
  await page.click('#start-button');
  await page.evaluate(()=>{const canvas=document.querySelector('canvas');for(const e of document.querySelectorAll('body *'))if(e!==canvas&&!e.contains(canvas)&&!canvas.contains(e))e.style.visibility='hidden';window.__motionReview.only('waterfallsheets');});
  const samples=[];
  for(const tick of [600,720]){
   try{await page.waitForFunction(t=>{try{return JSON.parse(document.getElementById('dreamisland-diagnostics').textContent).tick>=t;}catch{return false;}},{polling:10,timeout:60000},tick);}
   catch(error){await writeFile(out+'/failed-state.json',JSON.stringify({reduced,targetTick:tick,errors,state:await page.evaluate(()=>({visibility:document.visibilityState,race:document.getElementById('futurisma-diagnostics')?.textContent,map:document.getElementById('dreamisland-diagnostics')?.textContent}))},null,2));throw error;}
   const sample=await page.evaluate(()=>{const m=window.__diScene.getObjectByName('DI_HERO_waterfall-cliff_DI_MAT_water').material;return {tick:JSON.parse(document.getElementById('dreamisland-diagnostics').textContent).tick,time:m.userData.diFallTime.value,emissiveIntensity:m.emissiveIntensity,lighting:window.__motionReview.liveState()};});
   sample.file=(reduced?'reduced':'normal')+'-'+tick+'.png';await page.screenshot({path:out+'/'+sample.file});samples.push(sample);
  }
  if(reduced){assert.equal(samples[0].time,0);assert.equal(samples[1].time,0);}else assert.ok(samples[1].time>samples[0].time);
  assert.equal(samples[0].emissiveIntensity,samples[1].emissiveIntensity);results.push({reduced,pose,samples});await page.close();
 }
 assert.deepEqual(errors,[]);await writeFile(out+'/motion.json',JSON.stringify({script:'scripts/visual/dreamisland-heroes/polish-motion.mjs',results,errors},null,2)+'\n');console.log('VERIFIED waterfall clock and reduced-motion freeze');
}finally{await browser.close();}
