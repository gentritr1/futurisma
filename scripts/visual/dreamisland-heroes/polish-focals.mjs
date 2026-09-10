import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {launchReviewBrowser} from '../tideline-v4/browser.mjs';
import {instrument} from '../dreamisland/instrument.mjs';
const flag=name=>process.argv.find(x=>x.startsWith('--'+name+'='))?.split('=').slice(1).join('=');
const out=flag('out')??'art/evidence/dreamisland-v1/polish/focals';
const base=flag('base')??'http://127.0.0.1:5217';
const names=(flag('assets')??'clock-tower,watchtower,waterfall-cliff,sea-stack-set').split(',');
const distances=(flag('distances')??'40,300').split(',').map(Number);
const blends=(flag('blends')??'0,1').split(',').map(Number);
const painted=JSON.parse(await readFile('public/assets/dreamisland/painted.json','utf8'));
const sourceRoot=flag('sources')??'public/assets/dreamisland/heroes';
await mkdir(out,{recursive:true});
const browser=await launchReviewBrowser();
const report={status:'VERIFIED',script:'scripts/visual/dreamisland-heroes/polish-focals.mjs',frames:[],errors:[]};
try{
 const page=await browser.newPage();
 page.on('pageerror',error=>report.errors.push(String(error)));
 page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
 await instrument(page);
 const draw=async()=>{await page.evaluate(()=>window.dispatchEvent(new Event('resize')));await new Promise(r=>setTimeout(r,300));};
 await page.evaluateOnNewDocument(()=>{window.__diCaptureFrame=(renderer,args)=>{window.__polishCamera=args[1];window.__polishRenderer=renderer;};});
 for(const blend of blends){
  await page.goto(base+'/?map=dreamisland&seed=3868938316&tier=works&demo=1&headless=1&diagnostics=1&start=manual&quality=high&music=0&nightBlend='+blend,{waitUntil:'networkidle0',timeout:60000});
  await page.waitForSelector('#start-button',{visible:true});
  await page.waitForFunction(()=>!!window.__diScene&&!!window.__polishCamera);
  await page.evaluate(async()=>{
   const module=await import('/scripts/visual/dreamisland-heroes/polish-scene.mjs');
   window.__polish=module.prepare(window.__diScene,window.__polishCamera,window.__polishRenderer);
   const canvas=document.querySelector('canvas');for(const e of document.querySelectorAll('body *'))if(e!==canvas&&!e.contains(canvas)&&!canvas.contains(e))e.style.visibility='hidden';
  });
  const settle=await page.evaluate(async()=>{
   let prior='',stable=0,polls=0;
   while(polls++<200){const state=JSON.stringify(window.__polish.liveState());stable=state===prior?stable+1:0;prior=state;if(stable>=6)break;await new Promise(r=>setTimeout(r,50));}
   return {stable,polls,state:window.__polish.liveState()};
  });
  assert.ok(settle.stable>=6,'Lighting did not settle');
  for(const name of names){
   const source=sourceRoot+'/'+name+'.glb',bytes=await readFile(source);
   const scale=name==='clock-tower'?painted.placements.find(p=>p.asset==='clock-tower').hero.heroScale:1;
   const geometry=await page.evaluate((name,url,scale)=>window.__polish.loadFocal(name,url,scale),name,'/'+source,scale);
   for(const distance of distances){
    const pose=await page.evaluate((name,distance)=>window.__polish.focalPose(name,distance),name,distance);
    await draw();
    const prefix=name+'-'+distance+'m-'+(blend?'night':'day'),frames={full:prefix+'.png'};
    await page.screenshot({path:out+'/'+frames.full});
    if(name==='watchtower'&&distance===40){
     for(const [mode,stone] of [['lower',false],['stone',true]]){
      await page.evaluate(stone=>window.__polish.lowerBand(stone),stone);await draw();
      frames[mode]=prefix+'-'+mode+'.png';await page.screenshot({path:out+'/'+frames[mode]});
     }
     await page.evaluate(()=>window.__polish.blank());await draw();
     frames.blank=prefix+'-blank.png';await page.screenshot({path:out+'/'+frames.blank});
     await page.evaluate(()=>window.__polish.restoreFocal());
    }
    report.frames.push({asset:name,distance,blend,source,sourceSha256:createHash('sha256').update(bytes).digest('hex'),geometry,pose,settle,frames});
   }
  }
 }
 assert.deepEqual(report.errors,[]);
 await writeFile(out+'/focal-capture.json',JSON.stringify(report,null,2)+'\n');
 console.log('VERIFIED focal frames:',report.frames.length,'; browser errors:',report.errors.length);
}finally{await browser.close();}
