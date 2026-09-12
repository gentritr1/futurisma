import {mkdir,writeFile} from 'node:fs/promises';
import {instrument} from '../../../../../scripts/visual/dreamisland/instrument.mjs';
import {launchReviewBrowser} from '../../../../../scripts/visual/tideline-v4/browser.mjs';
const label=process.argv.find(a=>a.startsWith('--label='))?.slice(8);if(!label)throw Error('--label required');
const out=`art/evidence/dreamisland-v1/alive/3d/autopilot-${label}`;await mkdir(out,{recursive:true});
const browser=await launchReviewBrowser();const rows=[],errors=[];
try{
 const page=await browser.newPage();await page.setViewport({width:1600,height:900,deviceScaleFactor:1});
 await instrument(page);page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.evaluateOnNewDocument(()=>{
  window.__diPoseShots=[];
  window.__diCaptureFrame=(renderer,args)=>{
   const drive=window.__diDriving.at(-1);if(!drive)return;
   const next=[['court',.575],['reef',.75]][window.__diPoseShots.length];if(!next||drive.progress<next[1]||drive.progress>next[1]+.01)return;
   const camera=args[1];window.__diPoseShots.push({pose:next[0],progress:drive.progress,tick:drive.tick,
    camera:camera.position.toArray(),quaternion:camera.quaternion.toArray(),fov:camera.fov,
    data:renderer.domElement.toDataURL('image/png')});
  };
 });
 for(const blend of [0,1]){
  await page.goto(`http://127.0.0.1:5203/?map=dreamisland&seed=3868938316&tier=works&demo=1&headless=1&diagnostics=1&start=manual&quality=high&music=0&nightBlend=${blend}`,{waitUntil:'networkidle0'});
  await page.click('#start-button');await page.waitForFunction(()=>window.__diPoseShots.length===2,{timeout:120000});
  for(const shot of await page.evaluate(()=>window.__diPoseShots)){
   const {data,...meta}=shot;const frame=`${shot.pose}-${blend?'night':'day'}.png`;
   await writeFile(out+'/'+frame,Buffer.from(data.split(',')[1],'base64'));rows.push({...meta,blend,frame});console.log(frame,meta.progress);
  }
 }
 await writeFile(out+'/captures.json',JSON.stringify({viewport:[1600,900],label,rows,errors,note:'Canvas read immediately after the shipped autopilot render at the first progress crossing; world/craft/rivals retained, DOM HUD omitted. Same instrument world crop.'},null,2));
 if(errors.length)throw Error(errors.join('\n'));
}finally{await browser.close();}
