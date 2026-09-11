import {mkdir,writeFile} from 'node:fs/promises';
import {launchReviewBrowser} from '../tideline-v4/browser.mjs';
const seconds=Number(process.argv.find(a=>a.startsWith('--seconds='))?.slice(10)??100);
const variants=process.argv.find(a=>a.startsWith('--variants='))?.slice(11).split(',')??['A','B','C'];
const out=process.argv.find(a=>a.startsWith('--out='))?.slice(6)??'art/evidence/ascension-v1/audio-instrument';await mkdir(out,{recursive:true});
function wav(pcm,channels,rate){const h=Buffer.alloc(44);h.write('RIFF');h.writeUInt32LE(pcm.length+36,4);h.write('WAVEfmt ',8);h.writeUInt32LE(16,16);h.writeUInt16LE(1,20);h.writeUInt16LE(channels,22);h.writeUInt32LE(rate,24);h.writeUInt32LE(rate*channels*2,28);h.writeUInt16LE(channels*2,32);h.writeUInt16LE(16,34);h.write('data',36);h.writeUInt32LE(pcm.length,40);return Buffer.concat([h,pcm]);}
const browser=await launchReviewBrowser();try{for(const variant of variants){
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(String(e)));
 await page.setRequestInterception(true);
 page.on('request',async request=>{
  if(new URL(request.url()).pathname!=='/src/game/audio.ts'){await request.continue();return;}
  const response=await fetch(request.url());let code=await response.text();
  const constructor='new AscensionSoundGraph(this.context, this.otherBus,';
  if(!code.includes(constructor)||!code.includes('await this.ascensionSound.ready;'))throw Error('Audio audit injection markers changed');
  code=code.replace('compressor.connect(context.destination);','compressor.connect(context.destination); window.__ascOutput=compressor;');
  code=code.replace(constructor,'new AscensionSoundGraph(this.context, window.__ascEventBus=this.context.createGain(),');
  code=code.replace('await this.ascensionSound.ready;',`await this.ascensionSound.ready;
   if(!window.__ascAuditEmitted){window.__ascAuditEmitted=true;window.__ascEventBus.connect(this.otherBus);window.dispatchEvent(new CustomEvent('ascension-audio-graph',{detail:{context:this.context,output:window.__ascOutput,music:this.musicBus,events:window.__ascEventBus,graph:this.ascensionSound}}));}`);
  await request.respond({status:200,contentType:'text/javascript',body:code});
 });
 await page.evaluateOnNewDocument(({variant,seconds})=>{
  const Original=window.AudioContext;window.AudioContext=class extends Original{constructor(options={}){super({...options,sampleRate:48000});}};
  let random=3868938316;Math.random=()=>{random^=random<<13;random^=random>>>17;random^=random<<5;return (random>>>0)/4294967296;};
  window.__pcmRows=[];window.__pcmReady=false;
  window.addEventListener('ascension-audio-graph',async({detail:d})=>{
   window.__pcmGraph=d;
   if(variant!=='B'){const play=d.graph.play.bind(d.graph),muted=variant==='A'?['launch']:['klaxon','deluge'];d.graph.play=(cue,distance)=>muted.includes(cue)?d.context.currentTime:play(cue,distance);if(variant==='A')d.graph.duck=()=>{};}
   await d.context.audioWorklet.addModule('/ascension-pcm-worklet.js');
   const tap=new AudioWorkletNode(d.context,'ascension-pcm',{numberOfInputs:3,numberOfOutputs:1,outputChannelCount:[1]});
   d.output.connect(tap,0,0);d.music.connect(tap,0,1);d.events.connect(tap,0,2);tap.connect(d.context.destination);
   window.__pcmDone=new Promise(resolve=>tap.port.onmessage=({data})=>{window.__pcmData=data;resolve(true);});
   const startFrame=Math.ceil((d.context.currentTime+.1)*48000/128)*128;tap.port.postMessage({startFrame,frames:seconds*48000});window.__pcmReady=true;
   const sample=()=>{try{const asc=JSON.parse(document.getElementById('ascension-diagnostics').textContent);window.__pcmRows.push({contextTime:d.context.currentTime,...asc});}catch{}if(!window.__pcmData)requestAnimationFrame(sample);};requestAnimationFrame(sample);
  });
 },{variant,seconds});
 await page.goto('http://127.0.0.1:5200/?map=ascension&seed=3868938316&tier=works&demo=1&demoTrench=0&headless=1&diagnostics=1&start=manual&quality=high&musictest=meridian-afterimage.mp3&audioAudit=1',{waitUntil:'networkidle0'});
 await page.click('#start-button');await page.waitForFunction(()=>window.__pcmReady,{timeout:30000});await page.waitForFunction(()=>!!window.__pcmData,{timeout:150000});
 const meta=await page.evaluate(()=>{const {pcm,...clock}=window.__pcmData;return {...clock,rows:window.__pcmRows.map((r,i,all)=>i===all.length-1?r:({contextTime:r.contextTime,tick:r.tick,progress:r.progress}))};});
 // Bounded transfers avoid a single enormous protocol message.
 const pieces=[];for(let offset=0;offset<seconds*48000*6;offset+=48000*6){const values=await page.evaluate(offset=>Array.from(window.__pcmData.pcm.subarray(offset,offset+48000*6)),offset);const bytes=Buffer.alloc(values.length*2);values.forEach((v,i)=>bytes.writeInt16LE(v,i*2));pieces.push(bytes);}
 await writeFile(out+'/'+variant+'.wav',wav(Buffer.concat(pieces),6,48000));await writeFile(out+'/'+variant+'.json',JSON.stringify({script:'scripts/visual/ascension/audio-capture.mjs',variant,seed:3868938316,channels:['master-L','master-R','music-L','music-R','events-L','events-R'],scope:'Live Works surface demo. A suppresses launch and launch duck only; B enables all; C suppresses klaxon and deluge only. Both use the shipped original soundtrack and seeded Math.random. Same AudioWorklet frame clock for all channels.',...meta,errors},null,2));if(errors.length)throw Error(errors.join());await page.close();console.log(variant+' PCM complete');
}}finally{await browser.close();}
