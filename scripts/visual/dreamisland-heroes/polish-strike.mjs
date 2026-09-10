/** Capture ten actual rendered frames on the shipped integer-tick strike ramp. */
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {launchReviewBrowser} from '../tideline-v4/browser.mjs';
import {instrument} from '../dreamisland/instrument.mjs';
const out='art/evidence/dreamisland-v1/polish/strike',base='http://127.0.0.1:5217';
await mkdir(out,{recursive:true});
const schedule=JSON.parse(await readFile('src/game/data/dreamisland/schedule.json','utf8'));
const route=JSON.parse(await readFile('src/game/data/dreamisland/route.json','utf8')),station=route.stations[Math.round(.05*route.count)];
const position=station.p.map((v,i)=>v-station.t[i]*11.5+(i===1?4.8:0)),target=station.p.map((v,i)=>v+station.t[i]*19+(i===1?1.15:0));
const targets=Array.from({length:10},(_,i)=>Math.round(schedule.strikeTick+i*schedule.nightRampTicks/9));
const browser=await launchReviewBrowser(),errors=[];
try{
 const page=await browser.newPage();page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await instrument(page);await page.evaluateOnNewDocument(()=>{window.__diCaptureFrame=(r,args)=>{window.__strikeCamera=args[1];window.__strikeRenderer=r;};});
 const url=base+'/?map=dreamisland&seed=3868938316&tier=works&demo=1&headless=1&diagnostics=1&start=manual&quality=high&music=0';
 await page.goto(url,{waitUntil:'networkidle0',timeout:60000});await page.waitForSelector('#start-button',{visible:true});
 const pose=await page.evaluate(async(position,target)=>{
  const m=await import('/scripts/visual/dreamisland-heroes/polish-scene.mjs');window.__strikeReview=m.prepare(window.__diScene,window.__strikeCamera,window.__strikeRenderer);return window.__strikeReview.pin(position,target);
 },position,target);
 await page.click('#start-button');
 await page.evaluate(targets=>{
  const canvas=document.querySelector('canvas');for(const e of document.querySelectorAll('body *'))if(e!==canvas&&!e.contains(canvas)&&!canvas.contains(e))e.style.visibility='hidden';
  window.__strikeFrames=[];
  window.__diCaptureFrame=renderer=>{
   const index=window.__strikeFrames.length;if(index===targets.length)return;
   const text=document.getElementById('dreamisland-diagnostics')?.textContent;if(!text)return;const d=JSON.parse(text);
   const blend=window.__diScene.getObjectByName('dreamisland_panorama').material.uniforms.nightBlend.value;
   if(d.tick<targets[index]||(index===targets.length-1&&blend!==1))return;
   const copy=document.createElement('canvas');copy.width=renderer.domElement.width;copy.height=renderer.domElement.height;copy.getContext('2d').drawImage(renderer.domElement,0,0);
   window.__strikeFrames.push({targetTick:targets[index],tick:d.tick,nightBlend:blend,now:performance.now(),state:window.__strikeReview.liveState(),png:copy.toDataURL('image/png')});
  };
 },targets);
 await page.waitForFunction(()=>window.__strikeFrames?.length===10,{timeout:180000,polling:100});
 const frames=await page.evaluate(()=>window.__strikeFrames);
 for(const [i,frame] of frames.entries()){frame.file=String(i).padStart(2,'0')+'.png';await writeFile(out+'/'+frame.file,Buffer.from(frame.png.split(',')[1],'base64'));delete frame.png;frame.secondsFromStrike=(frame.tick-schedule.strikeTick)/120;}
 assert.deepEqual(errors,[]);assert.equal(frames.length,10);assert.equal(frames.at(-1).nightBlend,1);
 await writeFile(out+'/strike.json',JSON.stringify({script:'scripts/visual/dreamisland-heroes/polish-strike.mjs',url,schedule,pose,frames,errors,method:'Canvas readback inside the actual render hook, at ten evenly spaced authored schedule ticks. Shared atmosphere smoothing and shipped schedule remain active; no diagnostic blend override.'},null,2)+'\n');
 console.log('VERIFIED strike frames',frames.map(f=>[f.tick,f.nightBlend]));
}finally{await browser.close();}
