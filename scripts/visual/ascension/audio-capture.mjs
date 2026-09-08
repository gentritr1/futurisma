import {mkdir,writeFile} from 'node:fs/promises';
import {launchReviewBrowser} from '../tideline-v4/browser.mjs';
const out='art/evidence/ascension-v1/phase-d';await mkdir(out,{recursive:true});
const browser=await launchReviewBrowser(),errors=[];
try{
 for(const kind of ['trench','launch']){
  const page=await browser.newPage();page.on('pageerror',e=>errors.push(String(e)));
  await page.evaluateOnNewDocument(()=>{
   const Original=window.AudioContext;
   window.AudioContext=class extends Original{constructor(...args){super(...args);window.__ascAudioContext=this;window.__ascAudioTap=this.createMediaStreamDestination();}};
   const connect=AudioNode.prototype.connect;
   AudioNode.prototype.connect=function(destination,...args){const result=connect.call(this,destination,...args);if(destination===this.context.destination&&window.__ascAudioTap?.context===this.context)connect.call(this,window.__ascAudioTap);return result;};
  });
  await page.goto('http://127.0.0.1:5200/?map=ascension&seed=3868938316&tier=works&demo=1&headless=1&diagnostics=1&start=manual&quality=high&musictest=meridian-afterimage.mp3&demoTrench='+(kind==='trench'?'1':'0'),{waitUntil:'networkidle0',timeout:60000});await page.waitForSelector('#start-button',{visible:true});await page.click('#start-button');
  const seconds=kind==='trench'?10.3:23;
  await page.evaluate(({kind,seconds})=>{
   window.__ascAudioRecording=new Promise(resolve=>{
    const arm=()=>{let d;try{d=JSON.parse(document.getElementById('ascension-diagnostics').textContent);}catch{requestAnimationFrame(arm);return;}
     if(!(kind==='trench'?d.trenchOccupied:d.tick>=d.schedule.launchTick-240)){requestAnimationFrame(arm);return;}
     const context=window.__ascAudioContext,recorder=new MediaRecorder(window.__ascAudioTap.stream,{mimeType:'audio/webm;codecs=opus'}),chunks=[],wallStart=performance.now(),audioStart=context.currentTime;let wallStop=0,audioStop=0,stopState=null;
     window.__ascAudioRecordingStart=d;
     recorder.ondataavailable=e=>chunks.push(e.data);recorder.onstop=()=>{const callbackWall=performance.now(),reader=new FileReader();reader.onload=()=>resolve({base64:String(reader.result).split(',')[1],wallSeconds:(wallStop-wallStart)/1000,audioContextSeconds:audioStop-audioStart,encodingCallbackDelaySeconds:(callbackWall-wallStop)/1000,sampleRate:context.sampleRate,audioStart,audioStop,stopState});reader.readAsDataURL(new Blob(chunks,{type:'audio/webm'}));};
     recorder.start();setTimeout(()=>{wallStop=performance.now();audioStop=context.currentTime;stopState=JSON.parse(document.getElementById('ascension-diagnostics').textContent);recorder.stop();},seconds*1000);
    };requestAnimationFrame(arm);
   });
  },{kind,seconds});
  await page.waitForFunction(()=>!!window.__ascAudioRecordingStart,{timeout:120000});
  const start=await page.evaluate(()=>window.__ascAudioRecordingStart);await page.screenshot({path:out+'/'+kind+'-start.png'});
  const recording=await page.evaluate(()=>window.__ascAudioRecording);
  const finish=await page.$eval('#ascension-diagnostics',e=>JSON.parse(e.textContent));const soundtrack=await page.$eval('#futurisma-diagnostics',e=>JSON.parse(e.textContent).current.soundtrack);if(soundtrack.title!=='Futurisma · Meridian Afterimage')throw Error('Public evidence must use the shipped original soundtrack');await page.screenshot({path:out+'/'+kind+'-finish.png'});
  const {base64,...timing}=recording;await writeFile(out+'/'+kind+'.webm',Buffer.from(base64,'base64'));
  await writeFile(out+'/'+kind+'-capture.json',JSON.stringify({script:'scripts/visual/ascension/audio-capture.mjs',scope:'Live game output tapped after the master compressor, including the shipped original Meridian Afterimage selected through the existing musictest option. Private imported recordings are not copied into evidence. No separate synthetic evidence soundtrack.',requestedSeconds:seconds,soundtrack,timing,start,finish,errors},null,2));await page.close();
 }
 if(errors.length)throw Error(errors.join('\n'));
}finally{await browser.close();}
