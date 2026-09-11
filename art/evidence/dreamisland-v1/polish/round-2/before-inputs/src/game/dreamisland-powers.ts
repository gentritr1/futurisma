import {PolaritySimulation} from './polarity-simulation.js';
import {integrateSurgeSpeed} from './polarity-rules.js';
import {DREAMISLAND_ABILITY_CONFIG,DREAMISLAND_FIELDS,dreamislandFieldAt} from './dreamisland-powers-config.js';
import {DEVICE_COLORS} from './dreamisland-course';
import type {DreamIslandCourse} from './dreamisland-course';
import type {InputFrame} from './input';
import type {TotemVisualState} from './totem';
import type {EngineAudio} from './audio';

/**
 * Dream Island placement on the existing fixed-tick Surge/Shield rules. Phase A
 * ships the rules and the HUD attributes the ability slots read; the authored
 * device hardware is a phase B asset, so this module owns no geometry at all —
 * it tints the course's shared marker draw.
 */
export class DreamIslandPowers {
 readonly simulation:PolaritySimulation;
 readonly ready:Promise<void>=Promise.resolve();
 private sequence=0;
 constructor(private readonly course:DreamIslandCourse,private readonly audio?:EngineAudio){
  this.simulation=new PolaritySimulation(DREAMISLAND_ABILITY_CONFIG,course.schedule.seed);
 }
 handleActions(power:boolean,running:boolean,progress:number,demo:boolean){
  if(!running)return;
  if(power)this.use(progress);
  const s=this.simulation;
  if(demo&&s.heldPowerKind){
   const fieldAhead=DREAMISLAND_FIELDS.some(f=>f.progress>progress&&f.progress-progress<.018);
   if(s.heldPowerKind==='shield'?fieldAhead:!!s.launchZoneAt(progress))this.use(progress);
  }
 }
 step(ticks:number,progress:number,lateral:number,lap:number){for(let i=0;i<ticks;i++)this.simulation.step(progress,lateral,lap);this.dispatch();}
 applySurge(previous:number,normal:number,input:InputFrame,delta:number){return integrateSurgeSpeed(previous,normal,input.throttle,input.brake,this.simulation.surgeActive,delta);}
 absorb(progress:number,lateral:number){const field=dreamislandFieldAt(progress,lateral,this.course.length);const refund=field?this.simulation.onShieldImpact(field.id):0;this.dispatch();return refund;}
 present(state:TotemVisualState){const s=this.simulation.state;state.shieldActive=this.simulation.shieldActive;state.overdriveActive=this.simulation.surgeActive;state.shieldRefundWindow=state.shieldActive&&s.tick-s.powerStartTick<=144;state.powerReady=!!s.heldPower;state.heldPowerKind=s.heldPower;state.powerCharge=s.activePower?s.activeCharge:s.heldCharge;state.powerActivation=s.activePower?Math.min(1,(s.tick-s.powerStartTick)/26.4):0;}
 update(){
  const held=this.simulation.heldPowerKind,active=this.simulation.state.activePower;
  const label=document.getElementById('polarity-power');
  if(label){
   label.textContent=active?`${active==='surge'?'SURGE':'PHASE SHIELD'} ${this.simulation.powerSeconds.toFixed(1)}s`:held?`E / ${held==='surge'?'SURGE':'PHASE SHIELD'}`:'COLLECT A DEVICE';
   label.dataset.device=active?'active':held?'held':'empty';
   label.dataset.kind=active??held??'';
   label.dataset.charge=String(active?this.simulation.state.activeCharge:this.simulation.heldPowerCharge);
  }
  const transfer=document.getElementById('polarity-flip');if(transfer)transfer.dataset.transfer='ready';
  const fill=document.getElementById('power-charge-fill');if(fill)fill.style.transform=`scaleX(${active?this.simulation.state.activeCharge:this.simulation.heldPowerCharge})`;
  // The course owns every lit marker on the road, so a collected device goes
  // dark in the shared instanced draw rather than costing one of its own.
  const available=this.simulation.getPickupStates(),markers=this.course.markers;
  for(let i=0;i<available.length;i++)markers.setColorAt(this.course.deviceMarkerOffset+i,DEVICE_COLORS[available[i].available?available[i].kind:'spent']);
  if(markers.instanceColor)markers.instanceColor.needsUpdate=true;
 }
 private use(progress:number){const result=this.simulation.requestPower(progress);if(!result.ok)this.audio?.playPowerDenied();this.dispatch();}
 private dispatch(){for(const e of this.simulation.state.events){if(e.sequence<=this.sequence)continue;this.sequence=e.sequence;
  if(e.type==='pickup'){this.audio?.playDeviceClunk();this.audio?.playPowerPickup();}
  if(e.type==='power'&&e.kind)this.audio?.playPowerActivate(e.kind);
 }}
 reset(){this.simulation.reset();this.sequence=0;}
 dispose(){}
}
