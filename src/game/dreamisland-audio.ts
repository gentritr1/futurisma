import {DreamIslandSoundGraph,type IslandAudioSource} from './dreamisland-sound-graph';
import {dreamIslandAudioNightBlend} from './dreamisland-audio-plan.js';
import type {EngineAudio} from './audio';
import type {DreamIslandCourse} from './dreamisland-course';

/** Attach once the shared AudioContext exists. Standby never opens a second
 * context, and music/voice switches continue to belong to EngineAudio. */
export class DreamIslandAudio {
 private graph:DreamIslandSoundGraph|null=null;
 private pending=false;
 private disposed=false;
 readonly diagnostics:{loaded:boolean;error:string|null;records:unknown[];levels:Record<string,number>}={loaded:false,error:null,records:[],levels:{}};
 constructor(private readonly engine:EngineAudio,private readonly course:DreamIslandCourse){}
 update(progress:number){
  if(this.disposed)return;
  const ports=this.engine.environmentAudio();
  if(!this.graph&&!this.pending&&ports){
   this.pending=true;
   void fetch('/assets/dreamisland/painted.json').then(response=>{
    if(!response.ok)throw Error('Missing Dream Island sound positions');return response.json();
   }).then(async manifest=>{
    if(this.disposed)return;
    this.graph=new DreamIslandSoundGraph(ports,manifest.audioSources.sources as IslandAudioSource[]);
    await this.graph.ready;this.diagnostics.loaded=true;
    this.diagnostics.records=this.graph.records;this.diagnostics.levels=this.graph.levels;
   }).catch(error=>{this.diagnostics.error=String(error);console.error(error);});
  }
  if(ports?.context.state==='running')this.graph?.update({tick:this.course.schedule.tick,
   config:this.course.schedule.config,nightBlend:dreamIslandAudioNightBlend(this.course.schedule.tick,this.course.schedule.config),
   sector:this.course.sectorLabelAt(progress),zone:this.course.audioZoneAt(progress)});
 }
 reset(){this.graph?.reset();}
 dispose(){this.disposed=true;this.graph?.dispose();}
}
