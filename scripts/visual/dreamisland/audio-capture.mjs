import {mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {launchReviewBrowser} from '../tideline-v4/browser.mjs';
const out=process.argv.find(a=>a.startsWith('--out='))?.slice(6)??'art/evidence/dreamisland-v1/polish-3/audio';
await mkdir(out,{recursive:true});
const browser=await launchReviewBrowser();
const rate=24000;
function wav(pcm,channels){
 const h=Buffer.alloc(44);h.write('RIFF');h.writeUInt32LE(pcm.length+36,4);h.write('WAVEfmt ',8);
 h.writeUInt32LE(16,16);h.writeUInt16LE(3,20);h.writeUInt16LE(channels,22);h.writeUInt32LE(rate,24);
 h.writeUInt32LE(rate*channels*4,28);h.writeUInt16LE(channels*4,32);h.writeUInt16LE(32,34);
 h.write('data',36);h.writeUInt32LE(pcm.length,40);return Buffer.concat([h,pcm]);
}
try{
 const page=await browser.newPage();
 await page.goto('http://127.0.0.1:5200/?map=dreamisland&diagnostics=1&start=manual&headless=1&music=0&voice=0',{waitUntil:'networkidle0'});
 const report=await page.evaluate(async()=>{
  const {EngineAudio}=await import('/src/game/audio.ts');
  const {DreamIslandSoundGraph}=await import('/src/game/dreamisland-sound-graph.ts');
  const {renderDreamIslandBed}=await import('/src/game/dreamisland-beds.js');
  const route=await (await fetch('/src/game/data/dreamisland/route.json')).json();
  const manifest=await (await fetch('/assets/dreamisland/painted.json')).json();
  const schedule=await (await fetch('/src/game/data/dreamisland/schedule.json')).json();
  const station=route.stations[Math.round(.05*route.count)];
  const position=station.p.map((v,i)=>v-station.t[i]*11.5+(i===1?4.8:0));
  const original=window.AudioContext;
  const context=new OfflineAudioContext(2,30*24000,24000);
  let now=0;
  // Only the context's JS-facing clock is virtual. WebAudio's renderer and
  // every installed EngineAudio node are unchanged. Advancing this clock lets
  // the shipped control tick schedule its automation before offline rendering.
  Object.defineProperty(context,'currentTime',{get:()=>now,configurable:true});
  Object.defineProperty(context,'state',{get:()=> 'running',configurable:true});
  context.resume=async()=>{};
  window.AudioContext=function(){return context;};
  const engine=new EngineAudio();engine.setMusicVolume(0);
  try{await engine.start();}finally{window.AudioContext=original;}
  context.listener.positionX.value=position[0];context.listener.positionY.value=position[1];context.listener.positionZ.value=position[2];
  context.listener.forwardX.value=station.t[0];context.listener.forwardY.value=station.t[1];context.listener.forwardZ.value=station.t[2];
  context.listener.upX.value=0;context.listener.upY.value=1;context.listener.upZ.value=0;
  const ports=engine.environmentAudio();
  const duckEvents=[],duck=ports.duck;
  ports.duck=(music,ambience)=>{duckEvents.push({when:now,music,ambience});duck(music,ambience);};
  const graph=new DreamIslandSoundGraph(ports,manifest.audioSources.sources);
  await graph.ready;
  for(let frame=0;frame<30*120;frame++){
   now=frame/120;
   const tick=schedule.strikeTick-1200+frame,t=Math.max(0,Math.min(1,(tick-schedule.strikeTick)/schedule.nightRampTicks));
   engine.update(0,0,0,false,1,0,'open',false);
   graph.update({tick,nightBlend:t*t*(3-2*t),sector:'BEACH STRAIGHT',zone:'open',config:schedule},now);
  }
  delete context.currentTime;delete context.state;
  const mix=await context.startRendering();
  window.__diAudioBuffers={'strike-beach-30s':mix};
  for(const kind of ['surf','night']){
   const bedContext=new OfflineAudioContext(1,8*24000,24000),samples=renderDreamIslandBed(kind);
   const buffer=bedContext.createBuffer(1,samples.length,24000);buffer.copyToChannel(samples,0);
   const source=bedContext.createBufferSource();source.buffer=buffer;source.connect(bedContext.destination);source.start();
   window.__diAudioBuffers[kind+'-bed-offline']=await bedContext.startRendering();
  }
  const measure=(buffer,from=0,to=buffer.duration)=>{
   let squares=0,peak=0,count=0;
   for(let c=0;c<buffer.numberOfChannels;c++)for(const sample of buffer.getChannelData(c).subarray(Math.round(from*buffer.sampleRate),Math.round(to*buffer.sampleRate))){
    squares+=sample*sample;peak=Math.max(peak,Math.abs(sample));count++;
   }
   return {rmsDb:10*Math.log10(squares/count),peak,peakDb:20*Math.log10(peak),samples:count};
  };
  const result={script:'scripts/visual/dreamisland/audio-capture.mjs',seconds:30,sampleRate:24000,
   channels:2,pose:{district:'BEACH',progress:.05,position,forward:station.t},
   scope:'Shipped EngineAudio master, compressor, idle engine and shared buses; DreamIslandSoundGraph is the live circuit graph. Stationary BEACH chase pose, music=0, voice=0. No alternative audio renderer or post-normalization.',
   startTick:schedule.strikeTick-1200,strikeTick:schedule.strikeTick,records:graph.records,
   duckEvents,decoded:graph.decoded,levels:graph.levels,
   mix:measure(mix),windows:{day:measure(mix,0,3),strike:measure(mix,10,18),night:measure(mix,23,30)},
   files:Object.fromEntries(Object.entries(window.__diAudioBuffers).map(([id,buffer])=>[id,{channels:buffer.numberOfChannels,frames:buffer.length,...measure(buffer)}]))};
  if(result.mix.peak>=1)throw Error('Offline strike mix clips');
  return result;
 });
 for(const [id,meta] of Object.entries(report.files)){
  const chunks=[];
  for(let start=0;start<meta.frames;start+=rate){
   const encoded=await page.evaluate(({id,start,rate})=>{
    const buffer=window.__diAudioBuffers[id],frames=Math.min(rate,buffer.length-start);
    const samples=new Float32Array(frames*buffer.numberOfChannels);
    for(let i=0;i<frames;i++)for(let c=0;c<buffer.numberOfChannels;c++)samples[i*buffer.numberOfChannels+c]=buffer.getChannelData(c)[start+i];
    const bytes=new Uint8Array(samples.buffer);let binary='';
    for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
    return btoa(binary);
   },{id,start,rate});
   chunks.push(Buffer.from(encoded,'base64'));
  }
  await writeFile(out+'/'+id+'.wav',wav(Buffer.concat(chunks),meta.channels));
 }
 report.hashes=Object.fromEntries(['src/game/audio.ts','src/game/dreamisland-sound-graph.ts','src/game/dreamisland-beds.js','src/game/data/dreamisland/bed-profile.json','public/assets/dreamisland/painted.json'].map(file=>[file,createHash('sha256').update(readFileSync(file)).digest('hex')]));
 await writeFile(out+'/offline-capture.json',JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({mix:report.mix,windows:report.windows,records:report.records,duckEvents:report.duckEvents}));
}finally{await browser.close();}
