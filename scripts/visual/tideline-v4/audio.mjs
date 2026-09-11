import {mkdir,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {launchReviewBrowser} from './browser.mjs';
const out='art/evidence/tideline-v4/audio';await mkdir(out,{recursive:true});
const browser=await launchReviewBrowser();const errors=[];
async function tap(page){await page.evaluateOnNewDocument(()=>{
 const connect=AudioNode.prototype.connect;
 AudioNode.prototype.connect=function(destination,...args){const result=connect.call(this,destination,...args);if(destination===this.context.destination){const tap=this.context.createMediaStreamDestination();connect.call(this,tap);window.__audioTap=tap;}return result;};
 window.__record=duration=>new Promise(resolve=>{const chunks=[],recorder=new MediaRecorder(window.__audioTap.stream,{mimeType:'audio/webm;codecs=opus',audioBitsPerSecond:192000});recorder.ondataavailable=e=>chunks.push(e.data);recorder.onstop=async()=>{const bytes=new Uint8Array(await new Blob(chunks).arrayBuffer());let binary='';for(const byte of bytes)binary+=String.fromCharCode(byte);resolve(btoa(binary));};recorder.start();setTimeout(()=>recorder.stop(),duration*1000);});
});}
async function save(page,name,seconds){const data=await page.evaluate(seconds=>window.__record(seconds+.15),seconds);await writeFile(`${out}/${name}.webm`,Buffer.from(data,'base64'));execFileSync('/opt/homebrew/bin/ffmpeg',['-y','-i',`${out}/${name}.webm`,'-af',`aresample=48000,atrim=end_sample=${seconds*48000}`,'-ar','48000','-acodec','pcm_s16le',`${out}/${name}.wav`],{stdio:'ignore'});}
try{
 const page=await browser.newPage();page.on('pageerror',e=>errors.push(String(e)));await tap(page);
 await page.setRequestInterception(true);page.on('request',async r=>{if(new URL(r.url()).pathname==='/src/game/game.ts'){const response=await fetch(r.url());const code=(await response.text()).replace('this.renderer.outputColorSpace = THREE.SRGBColorSpace;','this.renderer.outputColorSpace = THREE.SRGBColorSpace;window.__reviewGame=this;');await r.respond({status:200,contentType:'text/javascript',body:code});}else await r.continue();});
 await page.goto('http://127.0.0.1:5215/?map=tideline&seed=3868938316&demo=1&demoPumpHall=1&headless=1&diagnostics=1&start=manual&quality=high&music=0',{waitUntil:'networkidle0'});await page.click('#start-button');
 await page.waitForFunction(()=>{const text=document.getElementById('time-value')?.textContent??'';return text.startsWith('00:17.');},{timeout:50000,polling:25});
 const start=await page.$eval('#time-value',e=>e.textContent);await save(page,'drain-transition',20);const end=await page.$eval('#time-value',e=>e.textContent);
 // Capture the real demo on the opened route, without camera or driver overrides.
 const frames=[];for(const progress of [.10,.15,.20]){
  await page.waitForFunction(p=>window.__reviewGame.course.tide.lap===3&&window.__reviewGame.progress>=p&&window.__reviewGame.progress<p+.025,{timeout:50000,polling:8},progress);
  const state=await page.evaluate(()=>({liveProgress:window.__reviewGame.progress,liveLap:window.__reviewGame.course.tide.lap,position:window.__reviewGame.vehicle.root.position.toArray(),race:JSON.parse(document.getElementById('futurisma-diagnostics').textContent).current,tide:JSON.parse(document.getElementById('tideline-diagnostics').textContent)}));
  await page.screenshot({path:`${out}/../pump-hall-${progress}.png`});frames.push({requestedProgress:progress,...state});
 }
 await writeFile(`${out}/../pump-hall-capture.json`,JSON.stringify({script:'scripts/visual/tideline-v4/audio.mjs',frames},null,2));
 await page.goto('http://127.0.0.1:5215/tideline-audio-review.html?music=0',{waitUntil:'networkidle0'});await page.click('#start');await page.waitForFunction(()=>document.getElementById('state').textContent.includes('ready'));
 await save(page,'pump-hall-stationary',10);
 await writeFile(`${out}/capture.json`,JSON.stringify({script:'scripts/visual/tideline-v4/audio.mjs',capture:'Actual Web Audio master output through MediaStreamDestination and MediaRecorder; ffmpeg decodes to PCM WAV.',drain:{seconds:20,start,end},pumpHall:{seconds:10,mode:'Stationary audition at lap 3 progress .15; engine idles, normal audio clock, real game ambience. Not a slowed or looped race pass.'},errors},null,2));if(errors.length)throw Error(errors.join('\n'));
}finally{await browser.close();}
