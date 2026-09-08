import {mkdir,writeFile} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {instrument} from './instrument.mjs';
import {launchReviewBrowser} from '../tideline-v4/browser.mjs';
const out=process.argv.find(a=>a.startsWith('--out='))?.slice(6)??'art/evidence/ascension-v1/phase-c-revision/visibility';
const schedule=JSON.parse(readFileSync('src/game/data/ascension/schedule.json'));
await mkdir(out+'/frames',{recursive:true});await mkdir(out+'/masks',{recursive:true});
const browser=await launchReviewBrowser(),records=[],writes=[],errors=[];
try{
 const page=await browser.newPage();page.on('pageerror',e=>errors.push(String(e)));
 await instrument(page);
 await page.exposeFunction('saveLaunchFrame',record=>{
  const {frame,mask,...row}=record;const name=String(records.length).padStart(4,'0');row.file=name+'.png';records.push(row);
  writes.push(writeFile(out+'/frames/'+row.file,Buffer.from(frame.split(',')[1],'base64')),writeFile(out+'/masks/'+row.file,Buffer.from(mask.split(',')[1],'base64')));
 });
 await page.evaluateOnNewDocument(({launchTick})=>{
  let next=launchTick;
  const canvas=document.createElement('canvas');canvas.width=1280;canvas.height=720;
  const ctx=canvas.getContext('2d',{willReadFrequently:true});
  window.__ascCaptureFrame=(renderer,args,render)=>{
   const effect=args[0].getObjectByName('ascension_scheduled_effects');const state=effect?.userData.eventState;
   if(!state||state.tick<next||state.tick>launchTick+2400)return;
   // Ten scheduled captures/second. Save actual ticks; missed slots are reported, never duplicated.
   next=launchTick+(Math.floor((state.tick-launchTick)/12)+1)*12;
   const plume=args[0].getObjectByName('persistent_launch_smoke');
   ctx.drawImage(renderer.domElement,0,0,1280,720);const normal=ctx.getImageData(0,0,1280,720),frame=canvas.toDataURL('image/png');
   plume.visible=false;render(...args);ctx.drawImage(renderer.domElement,0,0,1280,720);const absent=ctx.getImageData(0,0,1280,720);plume.visible=true;
   const mask=ctx.createImageData(1280,720);let pixels=0;
   // Difference from exactly the same lit/fogged scene with only the plume removed.
   // Require >= 3/255 in a colour channel; glow, steam, HUD and canopy movement are unchanged.
   for(let i=0;i<mask.data.length;i+=4){const visible=Math.max(...[0,1,2].map(c=>Math.abs(normal.data[i+c]-absent.data[i+c])))>=3;const value=visible?255:0;if(visible)pixels++;mask.data[i]=mask.data[i+1]=mask.data[i+2]=value;mask.data[i+3]=255;}
   ctx.putImageData(mask,0,0);const maskUrl=canvas.toDataURL('image/png');
   render(...args);
   const camera=args[1],pad=state.pad,dx=camera.position.x-pad[0],dz=camera.position.z-pad[2];
   const elevation=Math.atan2(pad[1]+state.smokeTop-camera.position.y,Math.hypot(dx,dz))*180/Math.PI;
   const driving=JSON.parse(document.getElementById('futurisma-diagnostics').textContent).current;
   window.saveLaunchFrame({driving,tick:state.tick,secondsAfterT0:(state.tick-launchTick)/120,now:performance.now(),pixels,columnTopElevationDegrees:elevation,cloudGlow:state.cloudGlow,camera:camera.position.toArray(),frame,mask:maskUrl});
  };
 },schedule);
 await page.goto('http://127.0.0.1:5200/?map=ascension&seed=3868938316&tier=works&demo=1&headless=1&diagnostics=1&start=manual&quality=high&music=0&demoTrench=0',{waitUntil:'networkidle0',timeout:60000});
 await page.waitForSelector('#start-button',{visible:true});await page.click('#start-button');
 await page.waitForFunction(()=>{try{const d=JSON.parse(document.getElementById('ascension-diagnostics').textContent);return d.tick>d.schedule.launchTick+2400;}catch{return false;}},{timeout:180000});
 await page.screenshot({path:out+'/T-plus-20-live.png'});await Promise.all(writes);
 const positive=records.filter(r=>r.pixels>0).length,first=records[0],last=records.at(-1),expected=20*10+1;
 const report={script:'scripts/visual/ascension/launch-visibility.mjs',maskDefinition:'Same-frame RGB difference >=3/255, plume enabled versus disabled. Only persistent_launch_smoke changes. One binary mask per captured driving frame.',scope:'Unmodified seeded Works Deluge Road three-lap demo, normal chase camera. Capture passes are not performance benchmarks.',inputHashes:Object.fromEntries(['src/game/ascension-runtime.ts','src/game/ascension-powers.ts','src/game/ascension-egrets.ts','src/game/ascension-audio.ts','src/game/ascension-sound-graph.ts','src/game/ascension-effects.ts','src/game/ascension-mangroves.ts','src/game/ascension-sky.ts','src/game/data/ascension/route.json'].map(f=>[f,createHash('sha256').update(readFileSync(f)).digest('hex')])),windowSeconds:20,expectedRateHz:10,inclusiveEndpointSamples:1,expectedSamples:expected,captured:records.length,residual:records.length-expected,plumeFrames:positive,fraction:positive/records.length,firstTickOffset:first?.tick-schedule.launchTick,lastTickOffset:last?.tick-schedule.launchTick,observedWallWindowSeconds:(last?.now-first?.now)/1000,errors,records};
 await writeFile(out+'/claim.json',JSON.stringify(report,null,2));console.log(JSON.stringify({...report,records:undefined}));
 if(errors.length||positive/records.length<.6)throw Error('Launch visibility acceptance failed');
}finally{await browser.close();}
