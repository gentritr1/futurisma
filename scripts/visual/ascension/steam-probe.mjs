import {mkdir,writeFile} from 'node:fs/promises';
import {launchReviewBrowser} from '../tideline-v4/browser.mjs';
import {instrument} from './instrument.mjs';
const out=process.argv.find(a=>a.startsWith('--out='))?.slice(6)??'art/evidence/ascension-v1/phase-c/steam-speed';await mkdir(out,{recursive:true});
const browser=await launchReviewBrowser(),errors=[];
try{
 const page=await browser.newPage();page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});await instrument(page);
 await page.goto('http://127.0.0.1:5200/?map=ascension&seed=3868938316&tier=works&demo=1&headless=1&diagnostics=1&start=manual&quality=high&music=0',{waitUntil:'networkidle0'});await page.waitForSelector('#start-button',{visible:true});
 // Controlled visual fixture: move the real schedule to its generated launch tick
 // on the first simulation step. No source edits, driving changes or benchmark claims.
 await page.evaluate(async()=>{
  const moduleURL=performance.getEntriesByType('resource').find(e=>e.name.includes('/src/game/ascension-course'))?.name;if(!moduleURL)throw Error('Course module URL unavailable');const {AscensionCourse}=await import(moduleURL);const advance=AscensionCourse.prototype.advanceSchedule;let armed=true;
  AscensionCourse.prototype.advanceSchedule=function(ticks){if(armed&&ticks>0){armed=false;advance.call(this,Math.max(0,this.schedule.config.launchTick-this.schedule.tick));}return advance.call(this,ticks);};
  const canvas=document.querySelector('canvas'),stream=canvas.captureStream(30),recorder=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp9'}),chunks=[],start=performance.now();
  window.__steamRecording=new Promise(resolve=>{recorder.ondataavailable=e=>chunks.push(e.data);recorder.onstop=async()=>{const durationMs=performance.now()-start,reader=new FileReader();reader.onload=()=>resolve({base64:String(reader.result).split(',')[1],durationMs,requestedRateHz:30});reader.readAsDataURL(new Blob(chunks,{type:'video/webm'}));stream.getTracks().forEach(t=>t.stop());};});recorder.start();setTimeout(()=>recorder.stop(),8000);
 });
 await page.click('#start-button');
 await page.waitForFunction(()=>{try{const d=JSON.parse(document.getElementById('ascension-diagnostics').textContent);return d.progress>.065&&d.progress<.13&&d.state.steam;}catch{return false;}},{timeout:12000}).catch(async error=>{console.error(await page.$eval('#ascension-diagnostics',e=>e.textContent));throw error;});
 await page.screenshot({path:out+'/apron-live.png'});
 const state=await page.evaluate(()=>({race:JSON.parse(document.getElementById('futurisma-diagnostics').textContent),ascension:JSON.parse(document.getElementById('ascension-diagnostics').textContent),hud:document.body.innerText}));
 const recording=await page.evaluate(()=>window.__steamRecording);await writeFile(out+'/apron-live.webm',Buffer.from(recording.base64,'base64'));
 await writeFile(out+'/capture.json',JSON.stringify({script:'scripts/visual/ascension/steam-probe.mjs',scope:'Controlled schedule-offset fixture with production driving, camera, HUD, materials and effects. Launch begins on the first simulation step using config.launchTick. This is not a normal lap-time or performance benchmark.',recording:{durationMs:recording.durationMs,requestedRateHz:recording.requestedRateHz,expectedFrames:recording.durationMs/1000*recording.requestedRateHz,decodedFrameCount:'Measure with ffprobe and reconcile separately.'},state,errors},null,2));if(errors.length)throw Error(errors.join('\n'));
}finally{await browser.close();}
