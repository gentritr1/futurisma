import {mkdir,writeFile} from 'node:fs/promises';
import {launchReviewBrowser} from '../tideline-v4/browser.mjs';
const out=process.argv.find(argument=>argument.startsWith('--out='))?.slice(6)??'art/evidence/dreamisland-v1/polish-3/audio';
await mkdir(out,{recursive:true});
const browser=await launchReviewBrowser();
try{
 const page=await browser.newPage();
 await page.goto('http://127.0.0.1:5200/?map=dreamisland&start=manual&headless=1&music=0&voice=0',{waitUntil:'networkidle0'});
 const report=await page.evaluate(async()=>{
  const {EngineAudio}=await import('/src/game/audio.ts');
  const {DreamIslandSoundGraph}=await import('/src/game/dreamisland-sound-graph.ts');
  const manifest=await (await fetch('/assets/dreamisland/painted.json')).json();
  const route=await (await fetch('/src/game/data/dreamisland/route.json')).json();
  const config=await (await fetch('/src/game/data/dreamisland/schedule.json')).json();
  const assert=(condition,message)=>{if(!condition)throw Error(message);};
  async function setup(seconds=8){
   const context=new OfflineAudioContext(2,seconds*24000,24000),original=window.AudioContext;
   context.resume=async()=>{};window.AudioContext=function(){return context;};
   const engine=new EngineAudio();engine.setMusicVolume(0);
   try{await engine.start();}finally{window.AudioContext=original;}
   const ports=engine.environmentAudio();
   assert(ports.context===context&&ports.effects===engine.otherBus&&ports.ambience===engine.ambienceBus,'Not using shared engine ports');
   const graph=new DreamIslandSoundGraph(ports,manifest.audioSources.sources);await graph.ready;
   return {context,engine,ports,graph};
  }
  function measure(buffer){
   const x=buffer.getChannelData(0),y=buffer.getChannelData(1);let energy=0,peak=0,block=0,strongest=0;
   for(let i=0;i<x.length;i++){
    const power=(x[i]*x[i]+y[i]*y[i])/2;energy+=power;block+=power;
    peak=Math.max(peak,Math.abs(x[i]),Math.abs(y[i]));
    if((i+1)%2400===0){strongest=Math.max(strongest,block/2400);block=0;}
   }
   return {rmsDb:10*Math.log10(energy/x.length),strongest100msDb:10*Math.log10(strongest),peakDb:20*Math.log10(peak)};
  }
  const spatial=[];
  for(const [district,progress] of [['BEACH',.05],['REEF',.75],['CUT',.90]]){
   const {context,ports,graph}=await setup();
   const station=route.stations[Math.round(progress*route.count)];
   ['X','Y','Z'].forEach((axis,i)=>{context.listener['position'+axis].value=station.p[i]+(i===1?.96:0);context.listener['forward'+axis].value=station.t[i];});
   const state={tick:config.chimeTick-1,nightBlend:0,sector:district,zone:'open',config};
   graph.update(state,0);graph.update({...state,tick:config.chimeTick},.1);
   // Isolate the bell through its actual effects path for a calibrated meter.
   ports.ambience.gain.cancelScheduledValues(0);ports.ambience.gain.setValueAtTime(0,0);
   const buffer=await context.startRendering();
   spatial.push({district,progress,listener:['X','Y','Z'].map(axis=>context.listener['position'+axis].value),
    clock:graph.records[0].position,...measure(buffer)});
   assert(graph.records.length===1&&graph.records[0].id==='chime-warning','Chime event count');
  }
  const waterfall=[];
  for(const nightBlend of [0,1]){
   const {context,ports,graph}=await setup();
   const position=manifest.audioSources.sources.find(s=>s.id==='waterfall').position;
   ['X','Y','Z'].forEach((axis,i)=>context.listener['position'+axis].value=position[i]);
   graph.update({tick:1,nightBlend,sector:'BASIN',zone:'open',config:null},0);
   for(const [id,loop] of graph.loops)if(id!=='waterfall'){loop.gain.gain.cancelScheduledValues(0);loop.gain.gain.setValueAtTime(0,0);}
   const buffer=await context.startRendering();
   const cutoff=graph.loops.get('waterfall').filter.frequency.value;
   const x=buffer.getChannelData(0),y=buffer.getChannelData(1);let difference=0,energy=0;
   for(let i=1;i<x.length;i++){difference+=(x[i]-x[i-1])**2+(y[i]-y[i-1])**2;energy+=x[i]**2+y[i]**2;}
   waterfall.push({nightBlend,position,cutoffHz:cutoff,...measure(buffer),differenceEnergyRatio:difference/energy});
  }
  assert(waterfall[1].rmsDb>waterfall[0].rmsDb,'Night waterfall is not louder');
  assert(waterfall[1].differenceEnergyRatio<waterfall[0].differenceEnergyRatio,'Night waterfall has not lost high-frequency energy');
  const {engine,graph,ports}=await setup();
  const targets={music:[],ambience:[]};
  for(const [id,node] of [['music',engine.musicBus],['ambience',engine.ambienceBus]]){
   const original=node.gain.setTargetAtTime.bind(node.gain);
   node.gain.setTargetAtTime=(value,...args)=>{targets[id].push(value);return original(value,...args);};
  }
  engine.setMusicVolume(.5);engine.applyRadioDuck(.5,.6);ports.duck(10**(-3/20),10**(-2/20));
  assert(targets.music.at(-1)===.25&&targets.ambience.at(-1)===.6,'Ducks multiplied instead of precedence');
  engine.applyRadioDuck(1,1);
  assert(Math.abs(targets.music.at(-1)-.5*10**(-3/20))<1e-12,'Radio release cancelled clock duck');
  ports.duck(1,1);engine.setMusicVolume(0);
  assert(targets.music.at(-1)===0,'music=0 changed by duck release');
  assert(engine.radio===null||engine.radio.enabled===false,'voice=0 is not respected');
  const state={tick:config.fishRiseTick,nightBlend:1,sector:'CUT',zone:'underpass',config};
  graph.update(state,0);graph.update(state,.01);
  const records=structuredClone(graph.records);
  assert(records.filter(r=>r.id==='strike').length===1,'Repeated strike');
  assert(records.filter(r=>r.id.startsWith('fish-rise:')).length===2,'Fish must fire once per shoal');
  assert(records.filter(r=>r.id==='tunnel-entry').length===1,'Repeated tunnel entry');
  const before={sources:graph.sources.size,nodes:graph.nodes.size};
  graph.reset();assert(graph.sources.size===0&&graph.nodes.size===0&&graph.records.length===0,'Reset leaked nodes/events');
  graph.update(state,.02);assert(graph.records.length===records.length,'Reset did not rearm events');
  graph.dispose();assert(graph.sources.size===0&&graph.nodes.size===0,'Dispose leaked nodes');
  const {DreamIslandAudio}=await import('/src/game/dreamisland-audio.ts');
  Object.defineProperty(ports.context,'state',{get:()=> 'running',configurable:true});
  const motion=[];
  for(const reduced of [false,true]){
   history.replaceState(null,'','?map=dreamisland&music=0&voice=0'+(reduced?'&motion=reduce':''));
   const course={schedule:{tick:0,config},sectorLabelAt:()=> 'BEACH',audioZoneAt:()=> 'open',
    get nightBlend(){throw Error('Audio read the reduced-motion visual blend');}};
   const wrapper=new DreamIslandAudio(engine,course);wrapper.update(.05);
   const deadline=performance.now()+15000;
   while(!wrapper.diagnostics.loaded){
    if(wrapper.diagnostics.error||performance.now()>deadline)throw Error(wrapper.diagnostics.error??'Audio wrapper load timeout');
    await new Promise(resolve=>setTimeout(resolve,20));
   }
   const samples=[];
   for(let i=0;i<=config.nightRampTicks;i++){
    course.schedule.tick=config.strikeTick+i;wrapper.update(.05);
    samples.push({...wrapper.diagnostics.levels});
   }
   motion.push(samples);wrapper.dispose();
  }
  assert(JSON.stringify(motion[0])===JSON.stringify(motion[1]),'Reduced motion changed audio ramp');
  return {script:'scripts/visual/dreamisland/audio-checks.mjs',spatial,waterfall,
   waterfallNightDeltaDb:waterfall[1].rmsDb-waterfall[0].rmsDb,
   duckTargets:targets,semantics:{musicZero:true,voiceZero:true,precedence:true,radioReleaseKeepsClockDuck:true},
   lifecycle:{before,reset:{sources:0,nodes:0},rearmedEvents:records.length,disposed:{sources:0,nodes:0}},
   records,motion:{samplesPerMode:motion[0].length,identical:true},passed:true};
 });
 await writeFile(out+'/checks.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}finally{await browser.close();}
