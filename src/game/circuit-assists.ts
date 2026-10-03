import {CircuitAssistBeacons} from './circuit-assist-beacons';
import type {RaceCourse} from './course';
import type {InputFrame} from './input';
import {PowerPickupField, type PickupDefinition} from './power-pickup-field';

export const ASSIST_MAPS = new Set(['greenwater','bitterpan','nightshift','afterglow']);
export const ASSIST_NAMES: Record<string,[string,string]> = {
  greenwater:['AQUA GRIP','DYNAMO'], bitterpan:['SALT ANCHOR','SOLAR CHARGE'],
  nightshift:['RAIN LOCK','NEON CHARGE'], afterglow:['ROAD ANCHOR','RELAY CHARGE'],
};

/** Automatic contact pickups. They supplement the four circuits without an
 * inventory; circuits with fitted E/B devices keep their own ability rules. */
export class CircuitAssists {
  readonly definitions: PickupDefinition[];
  readonly field: PowerPickupField;
  readonly beacons: CircuitAssistBeacons;
  readonly states: {kind:'shield'|'surge';available:boolean;charge:number}[];
  gripSeconds=0;
  chargeSeconds=0;
  collected=0;
  lastKind:'shield'|'surge'='shield';
  private readonly collectedLap:number[];
  private previousProgress:number|null=null;
  private immunity=0;
  constructor(private readonly course:RaceCourse) {
    this.definitions=course.kind==='greenwater'||course.kind==='bitterpan'
      ? [.075,.305,.535,.765].flatMap((progress,index):PickupDefinition[]=>{
        const sample=course.sample(progress);
        const before=course.sample(progress-12/course.length).tangent;
        const after=course.sample(progress+12/course.length).tangent;
        const bend=after.clone().sub(before).dot(sample.right);
        const inside=Math.abs(bend)>.008?Math.sign(bend):(index%2?1:-1);
        // Two distinct racing lines: protection near the middle, recharge on
        // the wider line. Both leave room to pass and recover by the barrier.
        const wide=Math.min(5.6,sample.halfWidth-3.8);
        const safe=Math.min(3.2,sample.halfWidth-3.8);
        return [
          {progress,lane:0,lateral:inside*safe,kind:'shield'},
          {progress,lane:0,lateral:-inside*wide,kind:'surge'},
        ];
      })
      : Array.from({length:8},(_,i)=>({progress:.075+i*.115,lane:0 as const,lateral:(i%3-1)*2.8,kind:i%2?'surge':'shield'}));
    this.collectedLap=this.definitions.map(()=>-1);
    this.states=this.definitions.map(def=>({kind:def.kind,available:true,charge:1}));
    this.field=new PowerPickupField(this.definitions,course.length,def=>course.sample(def.progress));
    this.beacons=new CircuitAssistBeacons(course,this.definitions);
    course.group.add(this.field.root,this.beacons.root);
  }
  step(delta:number,progress:number,lateral:number,lap:number) {
    this.gripSeconds=Math.max(0,this.gripSeconds-delta);this.chargeSeconds=Math.max(0,this.chargeSeconds-delta);this.immunity=Math.max(0,this.immunity-delta);
    const travel=this.previousProgress===null?0:((progress-this.previousProgress+1.5)%1)-.5;
    // A recovery/teleport is never a swept pickup across half the circuit.
    const canSweep=travel>0&&travel*this.course.length<20;
    this.definitions.forEach((def,index)=>{
      this.states[index].available=this.collectedLap[index]!==lap;
      if(!this.states[index].available||this.immunity>0||Math.abs(lateral-def.lateral)>2.15)return;
      const distance=Math.abs(((progress-def.progress+1.5)%1)-.5)*this.course.length;
      const fromPrevious=this.previousProgress===null?Infinity:(def.progress-this.previousProgress+1)%1;
      if(distance>2.3&&!(canSweep&&fromPrevious<=travel))return;
      this.collectedLap[index]=lap;this.states[index].available=false;this.collected++;this.lastKind=def.kind;
      if(def.kind==='shield')this.gripSeconds=8;else this.chargeSeconds=6;
    });
    this.previousProgress=progress;
  }
  grip(normal:number) {return this.gripSeconds>0?1:normal;}
  applySpeed(normal:number,input:InputFrame,delta:number) {
    if(this.chargeSeconds<=0||input.brake>.05||input.throttle<=0)return normal;
    // A gentle assist below cruise, never a cap on an already faster boost.
    return normal+Math.min(Math.max(0,78-normal),delta*6*input.throttle);
  }
  recover() {this.gripSeconds=this.chargeSeconds=0;this.previousProgress=null;this.immunity=2;}
  reset() {this.recover();this.immunity=0;this.collectedLap.fill(-1);this.collected=0;this.states.forEach(state=>state.available=true);}
  dispose() {this.field.dispose();this.field.root.removeFromParent();this.beacons.dispose();}
}
