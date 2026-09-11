export type AscensionCue='minus-sixty'|'deluge-armed'|'clear-trench'|'klaxon'|'deluge'|'launch'|'egrets'|'drip';
export class AscensionSoundGraph {
 readonly ready:Promise<void>;
 private readonly clips=new Map<string,AudioBuffer>();
 private readonly noise:AudioBuffer;
 private readonly sources=new Set<AudioScheduledSourceNode>();
 constructor(private readonly context:AudioContext,private readonly bus:AudioNode,readonly duck:(scale:number)=>void,private readonly voiceEnabled:()=>boolean){
  this.ready=Promise.all(['minus-sixty','deluge-armed','clear-trench'].map(async id=>{const response=await fetch(`/assets/ascension/audio/${id}.wav`);if(!response.ok)throw Error(`Missing Ascension radio ${id}`);this.clips.set(id,await context.decodeAudioData(await response.arrayBuffer()));})).then(()=>undefined);
  this.noise=context.createBuffer(1,context.sampleRate*2,context.sampleRate);const samples=this.noise.getChannelData(0);let seed=0x50414409;
  for(let i=0;i<samples.length;i++){seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;samples[i]=(seed>>>0)/2147483648-1;}
 }
 private track(source:AudioScheduledSourceNode,nodes:AudioNode[]=[]){this.sources.add(source);source.onended=()=>{this.sources.delete(source);source.disconnect();nodes.forEach(node=>node.disconnect());};}
 private tone(frequency:number,seconds:number,level:number,delay=0,end=frequency){
  const now=this.context.currentTime+delay,source=this.context.createOscillator(),gain=this.context.createGain();source.type='triangle';source.frequency.setValueAtTime(frequency,now);source.frequency.exponentialRampToValueAtTime(end,now+seconds);gain.gain.setValueAtTime(.0001,now);gain.gain.linearRampToValueAtTime(level,now+.012);gain.gain.exponentialRampToValueAtTime(.0001,now+seconds);source.connect(gain);gain.connect(this.bus);source.start(now);source.stop(now+seconds+.02);this.track(source,[gain]);
 }
 private hiss(seconds:number,cutoff:number,level:number){
  const now=this.context.currentTime,source=this.context.createBufferSource(),filter=this.context.createBiquadFilter(),gain=this.context.createGain();source.buffer=this.noise;source.loop=true;filter.type='lowpass';filter.frequency.value=cutoff;gain.gain.setValueAtTime(.0001,now);gain.gain.linearRampToValueAtTime(level,now+.08);gain.gain.setValueAtTime(level,now+seconds*.25);gain.gain.exponentialRampToValueAtTime(.0001,now+seconds);source.connect(filter);filter.connect(gain);gain.connect(this.bus);source.start(now);source.stop(now+seconds+.05);this.track(source,[filter,gain]);
 }
 play(cue:AscensionCue,distance=0):number|null{
  if(this.context.state!=='running')return null;
  const clip=this.clips.get(cue),now=this.context.currentTime;
  if(clip){if(!this.voiceEnabled())return now;const source=this.context.createBufferSource(),high=this.context.createBiquadFilter(),low=this.context.createBiquadFilter(),gain=this.context.createGain();source.buffer=clip;high.type='highpass';high.frequency.value=300;low.type='lowpass';low.frequency.value=3400;gain.gain.value=.3;source.connect(high);high.connect(low);low.connect(gain);gain.connect(this.bus);source.start(now);this.track(source,[high,low,gain]);return now;}
  if(cue==='klaxon'){for(let i=0;i<3;i++){this.tone(260,.35,.04,i*.8,350);this.tone(350,.35,.035,i*.8+.4,260);}}
  if(cue==='deluge')this.hiss(4,5500,.055);
  if(cue==='launch'){const scale=1/(1+distance/700);this.hiss(10,230,.3*scale);this.tone(58,7,.08*scale,0,27);this.hiss(5,2800,.05*scale);}
  if(cue==='egrets')for(let i=0;i<5;i++)this.tone(1600+i*110,.19,.009,i*.16,2400-i*70);
  if(cue==='drip'){this.tone(1700,.09,.009,0,900);this.tone(1700,.09,.003,.13,900);this.tone(1700,.09,.0015,.26,900);}
  return now;
 }
 dispose(){for(const source of this.sources){try{source.stop();}catch{}source.disconnect();}this.sources.clear();this.duck(1);}
}
