import * as THREE from 'three';
import {ABILITY_TICK_RATE} from './polarity-simulation.js';
import {DreamIslandPowers} from './dreamisland-powers';
import colors from './data/dreamisland/power-colors.json';
import {DreamIslandAudio} from './dreamisland-audio';
import {DreamIslandHud} from './dreamisland-hud';
import type {EngineAudio} from './audio';
import type {GameUi} from './ui';
import type {CircuitRuntime} from './circuit-runtime';
import type {DreamIslandCourse} from './dreamisland-course';
import type {CourseProjection} from './course';
import type {InputController,InputFrame} from './input';
import type {TotemVisualState} from './totem';

/** Phase A clock, camera and HUD. The clock tower's hands are the schedule, so
 * the HUD reads the time to the strike; `?calibrate=1` leaves the scheduler
 * inert and the readout says CALIBRATING, which is what the measuring run sees. */
export class DreamIslandRuntime implements CircuitRuntime {
 readonly ready:Promise<void>;readonly ceiling=false;readonly isFlipping=false;
 readonly boostRechargeScale=1;readonly powers:DreamIslandPowers;
 get surgeActive(){return this.powers.simulation.surgeActive;}
 get shieldActive(){return this.powers.simulation.shieldActive;}
 private readonly powerColors={surge:new THREE.Color().fromArray(colors.effectSurge),shield:new THREE.Color().fromArray(colors.effectShield)};
 private tickRemainder=0;
 private lastSecond:number|null|undefined=undefined;
 private readonly sound:DreamIslandAudio|null;
 private calloutSequence=0;
 private readonly reducedMotion=new URLSearchParams(location.search).get('motion')==='reduce';
 private readonly output=document.createElement('output');
 /** §4.5-§4.7. Built here so the skin, the slot and the feel moments load with
  * the island's chunk and with nothing else. */
 private readonly hud:DreamIslandHud;
 private camera:THREE.PerspectiveCamera|null=null;
 private hudSequence=0;
 constructor(readonly course:DreamIslandCourse,private readonly input:InputController,audio?:EngineAudio,private readonly ui?:GameUi){
  this.powers=new DreamIslandPowers(course,audio);
  this.hud=new DreamIslandHud(course,this.reducedMotion);
  this.sound=audio?new DreamIslandAudio(audio,course):null;
  input.setPowerControls(true);document.getElementById('polarity-hud')!.hidden=false;
  this.output.id='dreamisland-diagnostics';this.output.hidden=true;document.body.append(this.output);
  this.hud.attach();
  this.ready=this.powers.ready;
 }
 handleActions(running:boolean,progress:number,_position:THREE.Vector3,_lateral:number,demo:boolean){
  this.powers.handleActions(this.input.consumePower(),running,progress,demo);return false;
 }
 /** Tideline's clamped derivation, not Ascension's: a long frame or a tab-away
  * must not inject a burst of ticks, and the remainder never goes negative. */
 private takeTicks(delta:number):number{
  this.tickRemainder+=Math.max(0,Math.min(delta,.25))*ABILITY_TICK_RATE;
  const ticks=Math.floor(this.tickRemainder+1e-7);
  this.tickRemainder=Math.max(0,this.tickRemainder-ticks);
  return ticks;
 }
 step(delta:number,progress:number,lateral:number,lap:number){
  const ticks=this.takeTicks(delta);
  this.course.setLapBoard(lap);this.course.advanceSchedule(ticks);
  this.powers.step(ticks,progress,lateral,lap);
 }
 advanceClocks(delta:number){this.step(delta,0,0,this.course.tide.lap);}
 applySurge(previous:number,normal:number,input:InputFrame,delta:number){return this.powers.applySurge(previous,normal,input,delta);}
 present(_sample:CourseProjection,_position:THREE.Vector3,_forward:THREE.Vector3,state:TotemVisualState){
  this.powers.present(state);state.surgeColor=this.powerColors.surge;state.shieldColor=this.powerColors.shield;state.gravitySign=1;state.gravityTransition=0;
 }
 updateCamera(camera:THREE.PerspectiveCamera,_delta:number,position:THREE.Vector3,forward:THREE.Vector3,_speed:number){
  camera.position.copy(position).addScaledVector(forward,-11.5);camera.position.y+=4.8;
  const look=position.clone().addScaledVector(forward,19);look.y+=1.15;
  camera.up.set(0,1,0);camera.lookAt(look);
  // §4.7 the fire. The offset is wall-clock and presentation only: the camera
  // is not an input to anything the simulation reads.
  camera.fov=62+this.hud.fovOffset();camera.updateProjectionMatrix();
  this.camera=camera;
 }
 updateHud(progress:number){
  this.powers.update();
  // The collected state is driven by the simulation's own pickup event rather
  // than by watching the DOM: the event is the thing that happened.
  for(const event of this.powers.simulation.state.events){
   if(event.sequence<=this.hudSequence)continue;
   this.hudSequence=event.sequence;
   if(event.type==='pickup')this.hud.onCollected();
  }
  this.hud.update(this.powers.simulation,progress,this.camera,this.course.tide.lap);
  this.sound?.update(progress);
  const clock=this.course.schedule,config=clock.config;
  for(const event of clock.events){
   if(event.sequence<=this.calloutSequence)continue;
   this.calloutSequence=event.sequence;
   if(event.id==='chime-warning')this.ui?.flashHazard('THE CLOCK — ONE LAP',2200);
   if(event.id==='strike')this.ui?.flashHazard('NIGHT — CAUSEWAY WET',2200);
  }
  const seconds=config?Math.ceil((config.strikeTick-clock.tick)/ABILITY_TICK_RATE):null;
  if(seconds!==this.lastSecond){
   this.lastSecond=seconds;
   const text=seconds===null?'CALIBRATING'
    :seconds>0?`THE STRIKE IN ${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`
    :clock.state.nightSettled?'NIGHT · THE BASIN IS WET':'THE CLOCK HAS STRUCK';
   const line=document.getElementById('polarity-route');if(line)line.textContent=text;
  }
  document.getElementById('polarity-deck')!.textContent='DREAM ISLAND / DAY INTO NIGHT';
  document.getElementById('polarity-flip')!.textContent='SPACE / SHIFT · NITRO';
  this.course.group.userData.playerProgress=progress;
  this.output.textContent=JSON.stringify({script:'src/game/dreamisland-runtime.ts',seed:clock.seed,tick:clock.tick,progress,
   sector:this.course.sectorLabelAt(progress),nightBlend:this.course.nightBlend,nightBlendPinned:this.course.nightBlendPinned,reducedMotion:this.reducedMotion,
   grip:this.course.surfaceGripAt(progress),powers:this.powers.simulation.state,schedule:config,state:clock.state,events:clock.events,
   audio:this.sound?.diagnostics??null,clockHands:this.course.group.userData.clockHands??null,hardware:this.course.group.userData.hardware??null,
   hud:{...this.hud.report,powerState:this.hud.powerState},
   roadPaint:this.course.group.userData.roadPaint??null,props:this.course.group.userData.props??null,
   capsules:this.course.capsules?{...this.course.capsules.report,presence:[...this.course.capsules.presence]}:null,
   // Phase B's painted world, water and sky publish their own counters here.
   // Every one of them reads zero if the module loaded and did nothing.
   painted:this.course.group.userData.paintedCounters??null});
 }
 onShieldImpact(progress:number,lateral:number){return this.powers.absorb(progress,lateral);}
 recover(progress:number){this.powers.simulation.recover(progress);}
 reset(){this.powers.reset();this.sound?.reset();this.hud.reset();this.hudSequence=0;this.calloutSequence=0;this.lastSecond=undefined;this.tickRemainder=0;this.course.resetSchedule();}
 dispose(){this.powers.dispose();this.sound?.dispose();this.hud.dispose();this.output.remove();}
}
