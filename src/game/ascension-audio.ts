import type * as THREE from 'three';
import type {EngineAudio} from './audio';
import type {AscensionCourse} from './ascension-course';
import type {AscensionCue} from './ascension-sound-graph';
/** Cue decisions use the same schedule clock and distance law as the visible pressure wave. */
export class AscensionAudio {
 readonly records:{id:string,cue:AscensionCue,tick:number,contextTime:number,distance:number,delaySeconds?:number,expectedDelaySeconds?:number,residualSeconds?:number}[]=[];
 readonly ready:Promise<void>;
 readonly duckEvents:{tick:number,scale:number}[]=[];
 private readonly fired=new Set<string>();
 private lastTick=0;
 private lastBirdLap=0;
 private nextDrip=0;
 private ducked=false;
 constructor(private readonly audio:EngineAudio){this.ready=audio.enableAscension();}
 update(course:AscensionCourse,camera:THREE.Camera){
  const graph=this.audio.ascensionSound,c=course.schedule.config,tick=course.schedule.tick;if(!graph||!c)return;
  if(tick<this.lastTick){graph.dispose();this.ducked=false;this.fired.clear();this.records.length=0;this.duckEvents.length=0;this.lastBirdLap=0;this.nextDrip=0;}this.lastTick=tick;
  const fire=(id:string,cue:AscensionCue,distance=0)=>{if(this.fired.has(id))return;const contextTime=graph.play(cue,distance);if(contextTime===null)return;this.fired.add(id);this.records.push({id,cue,tick,contextTime,distance,...(cue==='launch'?{delaySeconds:(tick-c.launchTick)/120,expectedDelaySeconds:distance/343,residualSeconds:(tick-c.launchTick)/120-distance/343}:{})});};
  if(tick>=c.launchTick-60*120)fire('radio-sixty','minus-sixty');
  if(tick>=c.testTick-2*120)fire('radio-deluge','deluge-armed');
  if(tick>=c.launchTick-5*120)fire('radio-clear','clear-trench');
  for(const e of c.events)if(e.id.startsWith('crawler-klaxon')&&tick>=e.tick)fire(e.id,'klaxon');
  if(tick>=c.testTick)fire('rehearsal','deluge');
  if(tick>=c.launchTick)fire('launch-deluge','deluge');
  const duck=tick>=c.launchTick&&tick<c.launchTick+4*120;if(duck!==this.ducked){this.ducked=duck;graph.duck(duck?.25:1);this.duckEvents.push({tick,scale:duck?.25:1});}
  const pad=course.group.userData.eventState?.pad as number[]|undefined;
  if(pad){const distance=Math.hypot(camera.position.x-pad[0],camera.position.y-pad[1],camera.position.z-pad[2]);if((tick-c.launchTick)/120>=distance/343){fire('pressure-arrival','launch',distance);fire('launch-birds','egrets');}}
  const birdLap=course.group.userData.egrets?.risenLap??0;if(birdLap>0&&birdLap!==this.lastBirdLap){this.lastBirdLap=birdLap;fire('bird-lap-'+birdLap,'egrets');}
  if(course.trenchOccupied&&tick>=this.nextDrip){this.nextDrip=tick+84;fire('drip-'+tick,'drip');}
 }
 get diagnostics(){return {script:'src/game/ascension-audio.ts',ducked:this.ducked,duckEvents:this.duckEvents,records:this.records};}
 dispose(){this.audio.ascensionSound?.dispose();}
}
