/** Render candidate vertex tints without changing the shipped map. */
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {launchReviewBrowser} from '../tideline-v4/browser.mjs';
import {instrument} from '../dreamisland/instrument.mjs';
import assert from 'node:assert/strict';
const out='art/evidence/dreamisland-v1/polish/fill-trials';await mkdir(out,{recursive:true});
const candidates=[{name:'current',rgb:null},{name:'warm',rgb:[.3,.18,.035]},{name:'soft',rgb:[.2,.14,.08]}];
const route=JSON.parse(await readFile('src/game/data/dreamisland/route.json','utf8')),s=route.stations[Math.round(.05*route.count)];
const position=s.p.map((v,i)=>v-s.t[i]*11.5+(i===1?4.8:0)),target=s.p.map((v,i)=>v+s.t[i]*19+(i===1?1.15:0));
const browser=await launchReviewBrowser(),errors=[],frames=[];
try{
 const page=await browser.newPage();page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await instrument(page);await page.evaluateOnNewDocument(()=>{window.__diCaptureFrame=(r,args)=>{window.__roadCamera=args[1];window.__roadRenderer=r;};});
 const draw=async()=>{await page.evaluate(()=>window.dispatchEvent(new Event('resize')));await new Promise(r=>setTimeout(r,300));};
 for(const blend of [1]){
  await page.goto('http://127.0.0.1:5217/?map=dreamisland&seed=3868938316&tier=works&demo=1&headless=1&diagnostics=1&start=manual&quality=high&music=0&nightBlend='+blend,{waitUntil:'networkidle0',timeout:60000});await page.waitForSelector('#start-button',{visible:true});
  const pose=await page.evaluate(async(p,t)=>{const m=await import('/scripts/visual/dreamisland-heroes/polish-scene.mjs');window.__roadReview=m.prepare(window.__diScene,window.__roadCamera,window.__roadRenderer);const canvas=document.querySelector('canvas');for(const e of document.querySelectorAll('body *'))if(e!==canvas&&!e.contains(canvas)&&!canvas.contains(e))e.style.visibility='hidden';return window.__roadReview.pin(p,t);},position,target);
  for(const candidate of candidates){
   const fill=await page.evaluate(rgb=>{const light=window.__diScene.getObjectByName('dreamisland_night_ground_fill');if(rgb){light.color.setRGB(...rgb);light.groundColor.setRGB(...rgb.map(v=>v*.5));}return {sky:light.color.toArray(),ground:light.groundColor.toArray(),intensity:light.intensity};},candidate.rgb);
   const captures={};for(const mode of ['full','kerb','blank']){await page.evaluate(mode=>window.__roadReview.only(mode),mode);await draw();captures[mode]=candidate.name+'-'+blend+'-'+mode+'.png';await page.screenshot({path:out+'/'+captures[mode]});}
   frames.push({blend,candidate,fill,pose,frames:captures});
  }
 }
 assert.deepEqual(errors,[]);await writeFile(out+'/pose-capture.json',JSON.stringify({script:'scripts/visual/dreamisland-heroes/polish-fill-trials.mjs',frames,errors},null,2)+'\n');console.log('VERIFIED road tint trials');
}finally{await browser.close();}
