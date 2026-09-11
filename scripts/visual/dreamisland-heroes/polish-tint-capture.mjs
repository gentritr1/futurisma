/** Shared-lighting tint calibration for stack stone/caps and the new shoulder. */
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {launchReviewBrowser} from '../tideline-v4/browser.mjs';
import {instrument} from '../dreamisland/instrument.mjs';
const out='art/evidence/dreamisland-v1/polish/tint-calibration';await mkdir(out,{recursive:true});
const browser=await launchReviewBrowser(),errors=[],captures=[];
try{
 const page=await browser.newPage();page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await instrument(page);await page.evaluateOnNewDocument(()=>{window.__diCaptureFrame=(r,args)=>{window.__tintCamera=args[1];window.__tintRenderer=r;};});
 const draw=async()=>{await page.evaluate(()=>window.dispatchEvent(new Event('resize')));await new Promise(r=>setTimeout(r,300));};
 const open=async()=>{
  await page.goto('http://127.0.0.1:5217/?map=dreamisland&seed=3868938316&tier=works&demo=1&headless=1&diagnostics=1&start=manual&quality=high&music=0&nightBlend=0',{waitUntil:'networkidle0',timeout:60000});
  await page.waitForSelector('#start-button',{visible:true});
  await page.evaluate(async()=>{const m=await import('/scripts/visual/dreamisland-heroes/polish-scene.mjs');window.__tintReview=m.prepare(window.__diScene,window.__tintCamera,window.__tintRenderer);const canvas=document.querySelector('canvas');for(const e of document.querySelectorAll('body *'))if(e!==canvas&&!e.contains(canvas)&&!canvas.contains(e))e.style.visibility='hidden';});
 };
 await open();
 for(const state of ['before','after']){
  const source=state==='before'?'art/evidence/dreamisland-v1/polish/before/heroes/sea-stack-set.glb':'public/assets/dreamisland/heroes/sea-stack-set.glb';
  const geometry=await page.evaluate(url=>window.__tintReview.loadFocal('sea-stack-set',url),'/'+source);
  const pose=await page.evaluate(()=>window.__tintReview.focalPose('sea-stack-set',40));const frames={};
  for(const mode of ['full','stone','cap','blank']){
   await page.evaluate(mode=>{
    const root=window.__diScene.getObjectByName('review_focal_sea-stack-set');root.visible=mode!=='blank';
    root.traverse(o=>{if(o.isMesh)o.visible=mode==='full'||o.material.name===(mode==='stone'?'DI_MAT_concrete':'DI_MAT_jungle');});
    window.__diScene.getObjectByName('dreamisland_panorama').visible=mode==='full';
   },mode);await draw();frames[mode]='stacks-'+state+'-'+mode+'.png';await page.screenshot({path:out+'/'+frames[mode]});
  }
  captures.push({name:'stacks-'+state,source,sha256:createHash('sha256').update(await readFile(source)).digest('hex'),geometry,pose,frames});
 }
 await open();
 const watchSource='public/assets/dreamisland/heroes/watchtower.glb';
 const watchGeometry=await page.evaluate(url=>window.__tintReview.loadFocal('watchtower',url),'/'+watchSource);
 const watchPose=await page.evaluate(()=>window.__tintReview.focalPose('watchtower',40));
 const watchFrames={};
 for(const mode of ['full','ivy','joints','blank']){
  await page.evaluate(mode=>{
   const root=window.__diScene.getObjectByName('review_focal_watchtower');root.visible=mode!=='blank';
   root.traverse(o=>{if(o.isMesh)o.visible=mode==='full'||o.name===(mode==='ivy'?'watchtower_ivy_strands':'watchtower_moss_in_course_joints');});
   window.__diScene.getObjectByName('dreamisland_panorama').visible=mode==='full';
  },mode);await draw();watchFrames[mode]='watchtower-'+mode+'.png';await page.screenshot({path:out+'/'+watchFrames[mode]});
 }
 captures.push({name:'watchtower-accents',source:watchSource,sha256:createHash('sha256').update(await readFile(watchSource)).digest('hex'),geometry:watchGeometry,pose:watchPose,frames:watchFrames});
 await open();
 const route=JSON.parse(await readFile('src/game/data/dreamisland/route.json','utf8')),station=route.stations[Math.round(.05*route.count)];
 const pose=await page.evaluate((p,t)=>window.__tintReview.pin(p,t),station.p.map((v,i)=>v-station.t[i]*11.5+(i===1?4.8:0)),station.p.map((v,i)=>v+station.t[i]*19+(i===1?1.15:0)));
 const frames={full:'shoulder-full.png',shoulder:'shoulder-isolated.png',blank:'shoulder-blank.png'};await draw();await page.screenshot({path:out+'/'+frames.full});
 const atlas=JSON.parse(await readFile('public/assets/dreamisland/atlas-manifest.json','utf8')),rect=atlas.roles.concrete['road-sand'].uv;
 const geometry=await page.evaluate(async r=>{
  const source=window.__diScene.getObjectByName('DI_STATIC_DI_MAT_concrete'),geometry=source.geometry.clone(),uv=geometry.attributes.uv,index=geometry.index,indices=[];
  for(let i=0;i<index.count;i+=3)if([0,1,2].every(k=>{const id=index.getX(i+k),u=uv.getX(id),v=1-uv.getY(id);return u>=r[0]-1e-4&&u<=r[2]+1e-4&&v>=r[1]-1e-4&&v<=r[3]+1e-4;}))for(let k=0;k<3;k++)indices.push(index.getX(i+k));
  window.__tintReview.only('blank');geometry.setIndex(indices);window.__shoulder=new source.constructor(geometry,source.material);window.__diScene.add(window.__shoulder);return {triangles:indices.length/3,cell:'road-sand',role:source.material.name};
 },rect);await draw();await page.screenshot({path:out+'/'+frames.shoulder});
 await page.evaluate(()=>window.__shoulder.visible=false);await draw();await page.screenshot({path:out+'/'+frames.blank});captures.push({name:'shoulder',pose,geometry,frames});
 assert.deepEqual(errors,[]);await writeFile(out+'/tint-capture.json',JSON.stringify({script:'scripts/visual/dreamisland-heroes/polish-tint-capture.mjs',captures,errors},null,2)+'\n');console.log('VERIFIED tint isolation captures');
}finally{await browser.close();}
