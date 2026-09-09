import * as THREE from 'three';
import {ABILITY_TICK_RATE} from './polarity-simulation.js';
import {DreamIslandPowers} from './dreamisland-powers';
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
 private tickRemainder=0;
 private lastSecond:number|null|undefined=undefined;
 private readonly reducedMotion=new URLSearchParams(location.search).get('motion')==='reduce';
 private readonly output=document.createElement('output');
 constructor(readonly course:DreamIslandCourse,private readonly input:InputController,audio?:EngineAudio,private readonly ui?:GameUi){
  this.powers=new DreamIslandPowers(course,audio);
  input.setPowerControls(true);document.getElementById('polarity-hud')!.hidden=false;
  this.output.id='dreamisland-diagnostics';this.output.hidden=true;document.body.append(this.output);
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
  this.powers.present(state);state.gravitySign=1;state.gravityTransition=0;
 }
 updateCamera(camera:THREE.PerspectiveCamera,_delta:number,position:THREE.Vector3,forward:THREE.Vector3,_speed:number){
  camera.position.copy(position).addScaledVector(forward,-11.5);camera.position.y+=4.8;
  const look=position.clone().addScaledVector(forward,19);look.y+=1.15;
  camera.up.set(0,1,0);camera.lookAt(look);camera.fov=62;camera.updateProjectionMatrix();
 }
 updateHud(progress:number){
  this.powers.update();
  const clock=this.course.schedule,config=clock.config;
  const seconds=config?Math.ceil((config.strikeTick-clock.tick)/ABILITY_TICK_RATE):null;
  if(seconds!==this.lastSecond){
   this.lastSecond=seconds;
   const text=seconds===null?'CALIBRATING'
    :seconds>0?`THE STRIKE IN ${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`
    :clock.state.nightSettled?'NIGHT · THE BASIN IS WET':'THE CLOCK HAS STRUCK';
   const line=document.getElementById('polarity-route');if(line)line.textContent=text;
   if(config&&seconds===0)this.ui?.flashHazard('THE CLOCK STRIKES · BASIN GRIP DROPS',2200);
  }
  document.getElementById('polarity-deck')!.textContent='DREAM ISLAND / DAY INTO NIGHT';
  document.getElementById('polarity-flip')!.textContent='SPACE / SHIFT · NITRO';
  this.course.group.userData.playerProgress=progress;
  this.output.textContent=JSON.stringify({script:'src/game/dreamisland-runtime.ts',seed:clock.seed,tick:clock.tick,progress,
   sector:this.course.sectorLabelAt(progress),nightBlend:this.course.nightBlend,reducedMotion:this.reducedMotion,
   grip:this.course.surfaceGripAt(progress),powers:this.powers.simulation.state,schedule:config,state:clock.state,events:clock.events,
   // Phase B's painted world, water and sky publish their own counters here.
   // Every one of them reads zero if the module loaded and did nothing.
   painted:this.course.group.userData.paintedCounters??null});
 }
 onShieldImpact(progress:number,lateral:number){return this.powers.absorb(progress,lateral);}
 recover(progress:number){this.powers.simulation.recover(progress);}
 reset(){this.powers.reset();this.lastSecond=undefined;this.tickRemainder=0;this.course.resetSchedule();}
 dispose(){this.powers.dispose();this.output.remove();}
}
