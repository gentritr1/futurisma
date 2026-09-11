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
    const featureFrames={};
    if(process.argv.includes('--features')&&distance===40){
     const features={'clock-tower':['bezel','ticks','nosings'],watchtower:['moss-tops','windows','portal-lamps'],
      'waterfall-cliff':['fast-sheet','mist'],'sea-stack-set':['notches']}[name];
     for(const feature of features){
      const removed=await page.evaluate((name,feature)=>{
       const root=window.__diScene.getObjectByName('review_focal_'+name),saved=[];
       const names={bezel:'clock_bezel',ticks:'clock_twelve_hour_ticks',nosings:'clock_winding_stair_treads',
        'moss-tops':'watchtower_merlon_moss_tops','portal-lamps':'watchtower_portal_lamp_arches',
        'fast-sheet':'waterfall_fast_sheet_and_mist',mist:'waterfall_fast_sheet_and_mist'};
       root.traverse(o=>{
        if(!o.isMesh)return;
        const wanted=feature==='windows'?o.name.endsWith('_window_lamp'):feature==='notches'?o.name.endsWith('_wave_cut_notch'):o.name===names[feature];
        if(!wanted)return;saved.push({o,geometry:o.geometry,visible:o.visible});
        if(['nosings','fast-sheet','mist'].includes(feature)){
         const g=o.geometry.clone(),index=g.index,color=g.attributes.color,uv=g.attributes.uv,keep=[];
         for(let i=0;i<index.count;i+=3){const selected=[0,1,2].every(k=>{const j=index.getX(i+k);return feature==='nosings'?color.getX(j)>.9:feature==='mist'?uv.getX(j)<.5:uv.getX(j)>.5;});if(!selected)for(let k=0;k<3;k++)keep.push(index.getX(i+k));}
         g.setIndex(keep);o.geometry=g;
        }else o.visible=false;
       });
       window.__restoreHeroFeature=()=>{for(const s of saved){if(s.o.geometry!==s.geometry)s.o.geometry.dispose();s.o.geometry=s.geometry;s.o.visible=s.visible;}};
       return saved.length;
      },name,feature);
      await draw();const file=prefix+'-without-'+feature+'.png';await page.screenshot({path:out+'/'+file});
      featureFrames[feature]={without:file,sourceMeshes:removed};await page.evaluate(()=>window.__restoreHeroFeature());
     }
    }
    if(name==='watchtower'&&distance===40){
     for(const [mode,stone] of [['lower',false],['stone',true]]){
      await page.evaluate(stone=>window.__polish.lowerBand(stone),stone);await draw();
      frames[mode]=prefix+'-'+mode+'.png';await page.screenshot({path:out+'/'+frames[mode]});
     }
     await page.evaluate(()=>window.__polish.blank());await draw();
     frames.blank=prefix+'-blank.png';await page.screenshot({path:out+'/'+frames.blank});
     await page.evaluate(()=>window.__polish.restoreFocal());
    }
    report.frames.push({asset:name,distance,blend,source,sourceSha256:createHash('sha256').update(bytes).digest('hex'),geometry,pose,settle,frames,featureFrames});
   }
  }
 }
 assert.deepEqual(report.errors,[]);
 await writeFile(out+'/focal-capture.json',JSON.stringify(report,null,2)+'\n');
 console.log('VERIFIED focal frames:',report.frames.length,'; browser errors:',report.errors.length);
}finally{await browser.close();}
