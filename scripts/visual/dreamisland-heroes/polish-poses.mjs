import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {launchReviewBrowser} from '../tideline-v4/browser.mjs';
import {instrument} from '../dreamisland/instrument.mjs';
const flag=name=>process.argv.find(x=>x.startsWith('--'+name+'='))?.slice(name.length+3);
const out=flag('out'),base=flag('base')??'http://127.0.0.1:5217',progress=Number(flag('progress')??.32);
const modes=(flag('modes')??'full,mouth,drum,blank').split(','),blends=(flag('blends')??'0,1').split(',').map(Number);
assert.ok(out);await mkdir(out,{recursive:true});
const route=JSON.parse(await readFile('src/game/data/dreamisland/route.json','utf8'));
const painted=JSON.parse(await readFile('public/assets/dreamisland/painted.json','utf8'));
const station=route.stations[Math.round(progress*route.count)%route.count];
const position=station.p.map((v,i)=>v-station.t[i]*11.5+(i===1?4.8:0)),target=station.p.map((v,i)=>v+station.t[i]*19+(i===1?1.15:0));
const inputHashes={};
for(const file of ['public/assets/dreamisland/painted.json','public/assets/dreamisland/painted.glb',...['clock-tower','watchtower','waterfall-cliff','sea-stack-set'].map(n=>'public/assets/dreamisland/heroes/'+n+'.glb'),...['sky','water','materials','painted-environment'].map(n=>'src/game/dreamisland-'+n+'.ts')])inputHashes[file]=createHash('sha256').update(await readFile(file)).digest('hex');
const browser=await launchReviewBrowser(),report={script:'scripts/visual/dreamisland-heroes/polish-poses.mjs',progress,inputHashes,frames:[],errors:[]};
try{
 const page=await browser.newPage();page.on('pageerror',e=>report.errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
 await instrument(page);await page.evaluateOnNewDocument(()=>{window.__diCaptureFrame=(r,args)=>{window.__reviewCamera=args[1];window.__reviewRenderer=r;};});
 const draw=async()=>{await page.evaluate(()=>window.dispatchEvent(new Event('resize')));await new Promise(r=>setTimeout(r,300));};
 for(const blend of blends){
  await page.goto(base+'/?map=dreamisland&seed=3868938316&tier=works&demo=1&headless=1&diagnostics=1&start=manual&quality=high&music=0&nightBlend='+blend,{waitUntil:'networkidle0',timeout:60000});
  await page.waitForSelector('#start-button',{visible:true});
  const pose=await page.evaluate(async(position,target)=>{
   const m=await import('/scripts/visual/dreamisland-heroes/polish-scene.mjs');window.__review=m.prepare(window.__diScene,window.__reviewCamera,window.__reviewRenderer);
   const canvas=document.querySelector('canvas');for(const e of document.querySelectorAll('body *'))if(e!==canvas&&!e.contains(canvas)&&!canvas.contains(e))e.style.visibility='hidden';
   return window.__review.pin(position,target);
  },position,target);
  const frames={},regions={};
  for(const mode of modes){regions[mode]=await page.evaluate((mode,tower)=>window.__review.only(mode,tower),mode,painted.placements.find(p=>p.asset==='watchtower-ruin'));await draw();frames[mode]='blend-'+blend+'-'+mode+'.png';await page.screenshot({path:out+'/'+frames[mode]});}
  report.frames.push({blend,pose,frames,regions,kerbs:modes.includes('kerb')?await page.evaluate(()=>window.__review.kerbProbe()):null,stackPlacements:modes.includes('stacks')?await page.evaluate(p=>window.__review.stackPlacements(p),painted.placements):null,state:await page.evaluate(()=>window.__review.liveState())});
 }
 assert.deepEqual(report.errors,[]);await writeFile(out+'/pose-capture.json',JSON.stringify(report,null,2)+'\n');console.log('VERIFIED',out,report.frames.length);
}finally{await browser.close();}
