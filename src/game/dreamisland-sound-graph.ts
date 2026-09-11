import {renderDreamIslandBed,DREAMISLAND_AUDIO_RATE} from './dreamisland-beds.js';
import {DREAMISLAND_AUDIO_CLIPS} from './dreamisland-audio-plan.js';
import levels from './data/dreamisland/sound-levels.json';

export type IslandAudioSource={id:string;position:[number,number,number]};
export type IslandAudioPorts={context:BaseAudioContext;effects:AudioNode;ambience:AudioNode;
 duck:(music:number,ambience:number,when?:number)=>void};
export type IslandAudioState={tick:number;nightBlend:number;sector:string;zone:string;
 config:{events:{id:string;tick:number}[]}|null};
type Loop={source:AudioBufferSourceNode;gain:GainNode;filter:BiquadFilterNode};

/** The runtime and offline evidence use this exact graph. All destinations
 * are supplied by EngineAudio; this class never opens a context or connects
 * to a device destination. The tunnel clip already contains its short echo,
 * so it takes the dry effects path while the engine retains its underpass send.
 */
export class DreamIslandSoundGraph {
 readonly ready:Promise<void>;
 readonly records:{id:string;tick:number;when:number;source:string;position:number[]|null;gain:number}[]=[];
 readonly levels:Record<string,number>={};
 readonly decoded:Record<string,{seconds:number;rms:number;peak:number}>={};
 private readonly clips=new Map<string,AudioBuffer>();
 private readonly sources=new Set<AudioBufferSourceNode>();
 private readonly nodes=new Set<AudioNode>();
 private readonly loops=new Map<string,Loop>();
 private readonly fired=new Set<string>();
 private loaded=false;
 private lastTick=0;
 private lastZone='open';
 private duckUntil=0;
 private ducked=false;
 private disposed=false;
 private readonly locations=new Map<string,IslandAudioSource>();

 constructor(private readonly ports:IslandAudioPorts,positions:IslandAudioSource[]){
  positions.forEach(source=>this.locations.set(source.id,source));
  for(const required of ['clock','waterfall','tunnel','birds-GROVE','birds-CUT'])
   if(!this.locations.has(required))throw Error('painted.json is missing audio source '+required);
  this.ready=Promise.all(DREAMISLAND_AUDIO_CLIPS.map(async id=>{
   const response=await fetch('/assets/dreamisland/audio/'+id+'.mp3');
   if(!response.ok)throw Error('Missing Dream Island clip '+id);
   const buffer=await ports.context.decodeAudioData(await response.arrayBuffer());
   this.clips.set(id,buffer);
   const samples=buffer.getChannelData(0);let square=0,peak=0;
   for(const sample of samples){square+=sample*sample;peak=Math.max(peak,Math.abs(sample));}
   this.decoded[id]={seconds:buffer.duration,rms:Math.sqrt(square/samples.length),peak};
  })).then(()=>{this.loaded=!this.disposed;});
 }
 private voice(buffer:AudioBuffer,destination:AudioNode,location:string|null,level:number,when:number,loop=false){
  const {context}=this.ports;
  const source=context.createBufferSource(),gain=context.createGain(),filter=context.createBiquadFilter();
  source.buffer=buffer;source.loop=loop;
  filter.type='lowpass';filter.frequency.value=11000;filter.Q.value=.707;
  gain.gain.value=level;source.connect(filter);filter.connect(gain);
  const chain:AudioNode[]=[source,filter,gain];
  if(location){
   const position=this.locations.get(location);if(!position)throw Error('Unknown island audio position '+location);
   const panner=context.createPanner();panner.panningModel='equalpower';panner.distanceModel='inverse';
   panner.refDistance=location==='clock'?300:24;panner.rolloffFactor=location==='clock'?.25:1;
   panner.positionX.value=position.position[0];panner.positionY.value=position.position[1];panner.positionZ.value=position.position[2];
   gain.connect(panner);panner.connect(destination);chain.push(panner);
  }else gain.connect(destination);
  chain.forEach(node=>this.nodes.add(node));this.sources.add(source);
  source.onended=()=>{this.sources.delete(source);chain.forEach(node=>{node.disconnect();this.nodes.delete(node);});};
  source.start(when);
  return {source,gain,filter};
 }
 private startLoops(when:number){
  const context=this.ports.context;
  for(const kind of ['surf','night'] as const){
   const samples=renderDreamIslandBed(kind),buffer=context.createBuffer(1,samples.length,DREAMISLAND_AUDIO_RATE);
   buffer.copyToChannel(samples,0);
   this.loops.set(kind,this.voice(buffer,this.ports.ambience,null,0,when,true));
  }
  this.loops.set('waterfall',this.voice(this.clips.get('waterfall-loop')!,this.ports.ambience,'waterfall',0,when,true));
  // The supplied sparse bird clip is repeated with a full silent clip between
  // calls. Two offsets keep the two verges from answering in perfect unison.
  const birds=this.clips.get('day-birds')!,spaced=context.createBuffer(1,birds.length*2,birds.sampleRate);
  spaced.copyToChannel(birds.getChannelData(0),0);
  for(const sector of ['GROVE','CUT'])this.loops.set('birds-'+sector,
   this.voice(spaced,this.ports.ambience,'birds-'+sector,0,when+(sector==='CUT'?birds.duration:0),true));
 }
 private play(id:string,clip:string,location:string,tick:number,when:number,gain:number){
  this.voice(this.clips.get(clip)!,this.ports.effects,location,gain,when);
  this.records.push({id,tick,when,source:location,position:this.locations.get(location)!.position,gain});
 }
 update(state:IslandAudioState,when=this.ports.context.currentTime){
  if(!this.loaded||this.disposed)return;
  if(state.tick<this.lastTick)this.reset();
  if(!this.loops.size)this.startLoops(when);
  const night=state.nightBlend,coast=/BEACH|REEF/.test(state.sector);
  const gains:Record<string,number>={surf:levels.surf*(coast?1:.2)*(1-night),night:levels.night*night,
   waterfall:levels['waterfall-loop']*(1+night),
   'birds-GROVE':levels['day-birds']*(1-night),'birds-CUT':levels['day-birds']*(1-night)};
  for(const [id,loop] of this.loops){
   const level=gains[id];this.levels[id]=level;
   loop.gain.gain.setValueAtTime(level,when);
   if(id==='waterfall')loop.filter.frequency.setValueAtTime(11000*(1-night)+2600*night,when);
  }
  for(const event of state.config?.events??[]){
   if(event.tick<=this.lastTick||event.tick>state.tick||this.fired.has(event.id))continue;
   this.fired.add(event.id);
   if(event.id==='chime-warning'||event.id==='strike'){
    const clip=event.id==='strike'?'clock-strike-three-tolls':'clock-quarter-chime';
    this.play(event.id,clip,'clock',event.tick,when,levels[clip]);
    this.duckUntil=Math.max(this.duckUntil,when+this.clips.get(clip)!.duration);
   }
   if(event.id==='fish-rise')for(const location of this.locations.keys())if(location.startsWith('fish-'))
    this.play(event.id+':'+location,'fish-rise',location,event.tick,when,levels['fish-rise']);
  }
  if(state.zone==='underpass'&&this.lastZone!=='underpass')
   this.play('tunnel-entry','tunnel-pass','tunnel',state.tick,when,levels['tunnel-pass']);
  this.lastZone=state.zone;this.lastTick=state.tick;
  const duck=when<this.duckUntil;
  if(duck!==this.ducked){this.ducked=duck;this.ports.duck(duck?10**(-3/20):1,duck?10**(-2/20):1,when);}
 }
 reset(){
  for(const source of this.sources){try{source.stop();}catch{}source.disconnect();}
  this.sources.clear();this.nodes.forEach(node=>node.disconnect());this.nodes.clear();this.loops.clear();
  this.fired.clear();this.records.length=0;this.lastTick=0;this.lastZone='open';this.duckUntil=0;this.ducked=false;
  this.ports.duck(1,1);
 }
 dispose(){this.disposed=true;this.reset();}
}
