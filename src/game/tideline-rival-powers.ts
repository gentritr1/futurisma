import * as THREE from 'three';
import {TidelinePowerField} from './tideline-power-field';
export interface RivalPowerEvent {rival:string;lap:number;kind:'surge'|'shield';tick:number;scheduledProgress:number}
interface RivalPowerState {id:string;lap:number;courseDistanceMeters:number;elapsedSeconds:number;finished:boolean}
function scheduled(seed:number,index:number,lap:number,kind:'surge'|'shield'):number {
 let h=(seed^Math.imul(index+1,2654435761)^Math.imul(lap,2246822519))>>>0;
 h=Math.imul(h^(h>>>16),2246822519)>>>0;
 return (kind==='surge'?.35:.61)+(h%1000)/1000*.075;
}
/** Seeded presentation use, independently of the rival's existing pace driver.
 * No speed, lane, grip or boost reserve state is written by this component.
 */
export class TidelineRivalPowers {
 readonly root=new THREE.Group();readonly events:RivalPowerEvent[]=[];
 private readonly fields:TidelinePowerField[];
 private readonly activations:{surge:number;shield:number;lap:number}[];
 constructor(private readonly seed:number,private readonly length:number,count:number,private readonly reduced:boolean){
  this.root.name='tideline_seeded_rival_powers';this.fields=Array.from({length:count},()=>new TidelinePowerField());
  this.activations=Array.from({length:count},()=>({surge:-10000,shield:-10000,lap:0}));
  for(const field of this.fields){field.root.matrixAutoUpdate=false;this.root.add(field.root);}
 }
 reset():void {this.events.length=0;for(const a of this.activations){a.surge=a.shield=-10000;a.lap=0;}}
 step(index:number,state:RivalPowerState):void {
  const activation=this.activations[index];const tick=Math.round(state.elapsedSeconds*120);
  if(activation.lap!==state.lap){activation.lap=state.lap;activation.surge=activation.shield=-10000;}
  const progress=((state.courseDistanceMeters/this.length)%1+1)%1;
  for(const kind of ['surge','shield'] as const){const at=scheduled(this.seed,index,state.lap,kind);
   if(!state.finished&&activation[kind]===-10000&&progress>=at){activation[kind]=tick;this.events.push({rival:state.id,lap:state.lap,kind,tick,scheduledProgress:at});}
  }
  this.fields[index].update(tick/120,this.reduced,!state.finished&&tick-activation.surge<360,!state.finished&&tick-activation.shield<480,tick-activation.shield<=144);
 }
 pose(index:number,matrix:THREE.Matrix4):void {this.fields[index].root.matrix.copy(matrix);this.fields[index].root.matrixWorldNeedsUpdate=true;}
}
