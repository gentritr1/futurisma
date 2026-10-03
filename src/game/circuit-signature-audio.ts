import * as THREE from 'three';
import type {EngineAudio} from './audio';
import type {CourseKind} from './course';

const BEDS: Record<CourseKind,{frequency:number;noise:number;volume:number}>={
  greenwater:{frequency:88,noise:.035,volume:.013},
  bitterpan:{frequency:48,noise:.13,volume:.018},
  nightshift:{frequency:72,noise:.025,volume:.012},
  polarity:{frequency:110,noise:.015,volume:.012},
  tideline:{frequency:42,noise:.08,volume:.015},
  ascension:{frequency:56,noise:.22,volume:.016},
  dreamisland:{frequency:34,noise:.015,volume:.008},
  afterglow:{frequency:60,noise:.05,volume:.014},
  frostline:{frequency:46,noise:.045,volume:.013},
};

/** One quiet, local machinery bed on the existing ambience bus. It inherits
 * pause, mute, radio ducking and user volume; no autoplay or new global mix. */
export class CircuitSignatureAudio {
  private source:AudioBufferSourceNode|null=null;
  private gain:GainNode|null=null;
  private panner:StereoPannerNode|null=null;
  private context:AudioContext|null=null;
  private readonly offset=new THREE.Vector3();
  private readonly right=new THREE.Vector3();
  private disposed=false;
  private lastTick=-1;

  constructor(private readonly audio:EngineAudio,private readonly kind:CourseKind){}

  update(tick:number,origin:THREE.Vector3,position:THREE.Vector3,forward:THREE.Vector3,up:THREE.Vector3,active:boolean):void {
    if(this.disposed||tick===this.lastTick)return;
    const ports=this.audio.environmentAudio();if(!ports)return;
    this.lastTick=tick;
    const bed=BEDS[this.kind];
    if(!this.source){
      const context=ports.context,rate=context.sampleRate;
      const buffer=context.createBuffer(1,rate*2,rate),samples=buffer.getChannelData(0);
      let seed=1701+this.kind.length,noise=0;
      for(let i=0;i<samples.length;i++){
        seed=(Math.imul(seed,1664525)+1013904223)>>>0;
        noise=.93*noise+.07*(seed/4294967296*2-1);
        const phase=i/rate*Math.PI*2*bed.frequency;
        samples[i]=Math.sin(phase)*.55+Math.sin(phase*2)*.12+noise*bed.noise;
      }
      this.context=context;this.source=context.createBufferSource();this.source.buffer=buffer;this.source.loop=true;
      this.gain=context.createGain();this.gain.gain.value=0;
      this.panner=context.createStereoPanner();
      this.source.connect(this.gain);this.gain.connect(this.panner);this.panner.connect(ports.ambience);this.source.start();
    }
    this.offset.subVectors(origin,position);
    const distance=this.offset.length(),falloff=Math.max(0,1-distance/95)**2;
    const strength=this.kind==='ascension'?(active?1:.15):this.kind==='dreamisland'?(active?1:.12):active?1:.65;
    const pulse=1+.08*Math.sin(tick/120*(this.kind==='nightshift'?1.2:.7));
    const now=this.context!.currentTime;
    this.gain!.gain.setTargetAtTime(bed.volume*strength*falloff*pulse,now,.16);
    this.right.crossVectors(forward,up).normalize();
    this.panner!.pan.setTargetAtTime(THREE.MathUtils.clamp(this.offset.dot(this.right)/Math.max(15,distance),-.8,.8),now,.12);
  }

  reset():void {this.lastTick=-1;}
  dispose():void {
    if(this.disposed)return;this.disposed=true;
    this.source?.stop();this.source?.disconnect();this.gain?.disconnect();this.panner?.disconnect();
    this.source=null;this.gain=null;this.panner=null;this.context=null;
  }
}
