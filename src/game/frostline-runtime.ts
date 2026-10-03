import * as THREE from 'three';
import type {CircuitRuntime} from './circuit-runtime';
import type {FrostlineCourse} from './frostline-course';
import type {EngineAudio} from './audio';
import type {GameUi} from './ui';
import type {InputFrame} from './input';
import type {CourseProjection} from './course';
import type {TotemVisualState} from './totem';
import {snowCoverageAt} from './frostline-snow';

/** Cozy environmental sounds share the game's existing audio buses and mute
 * controls. No downloaded clips, extra AudioContext or independent timer. */
export class FrostlineRuntime implements CircuitRuntime {
  readonly ready=Promise.resolve();readonly ceiling=false;readonly isFlipping=false;
  readonly surgeActive=false;readonly shieldActive=false;readonly boostRechargeScale=1;
  private readonly status = document.createElement('output');
  private readonly stylesheet = document.createElement('link');
  private readonly cyan = new THREE.Color(0x5ce8ff);
  private readonly amber = new THREE.Color(0xffb44b);
  private lastCollected = 0;
  private speed = 0;
  private lastHits = 0;
  private lastBlocks = 0;
  private readonly visor = document.createElement('div');
  private readonly look=new THREE.Vector3();
  private readonly sources=new Set<OscillatorNode>();
  private lastSecond=-1;private lastFirework=-1;private midnight=false;private icy=false;
  readonly ambience={ticks:0,chimes:0,fireworks:0,sleighBells:0};
  constructor(readonly course:FrostlineCourse,private readonly audio:EngineAudio,private readonly ui:GameUi){
    this.stylesheet.rel='stylesheet';this.stylesheet.href=new URL('./frostline-hud.css?no-inline',import.meta.url).href;document.head.append(this.stylesheet);
    this.visor.className='winter-visor';this.visor.setAttribute('aria-hidden','true');document.querySelector('#app')!.append(this.visor);
    this.status.className='winter-status';this.status.setAttribute('aria-label','Winter road and stabilizer status');document.querySelector('.hud')!.append(this.status);
  }
  handleActions(){return false;}
  step(delta:number,progress:number,lateral:number,lap:number,leadMeters=0){
    this.course.raceProgress=progress;this.course.lap=lap;
    const winter=this.course.winter;winter.step(delta,progress,lateral,lap,this.course.length);
    winter.stepSnowball(delta,progress,lateral,lap,leadMeters,this.course.length,this.speed);
    if(winter.snowballHits>this.lastHits){this.lastHits=winter.snowballHits;this.audio.playImpact(.3);this.ui.flashHazard('VISOR ICED · CLEARING',2000);}
    if(winter.snowballBlocks>this.lastBlocks){this.lastBlocks=winter.snowballBlocks;this.audio.playPowerPickup();this.ui.flashHazard('STABILIZERS · SNOWBALL DEFLECTED',1400);}
    if(winter.collected>this.lastCollected){
      this.lastCollected=winter.collected;
      const stabilizer=winter.lastPickup==='stabilizer';
      this.ui.flashHazard(stabilizer?'STABILIZERS LOCKED · 10s':'THERMAL DRIVE · GRIP + THRUST',1800);
      this.audio.playPowerPickup();this.audio.playDeviceClunk();
    }
  }
  advanceClocks(){}
  present(_sample:CourseProjection,position:THREE.Vector3,forward:THREE.Vector3,state:TotemVisualState){
    this.course.craftPosition.copy(position);this.course.craftForward.copy(forward);
    const winter=this.course.winter;
    state.shieldActive=winter.stabilizerSeconds>0;state.overdriveActive=winter.thermalSeconds>0;
    state.shieldColor=this.cyan;state.surgeColor=this.amber;
    state.powerCharge=Math.max(winter.stabilizerSeconds/10,winter.thermalSeconds/5.5);
    state.powerActivation=state.shieldActive||state.overdriveActive?1:0;
  }
  applySurge(previous:number,normal:number,input:InputFrame,delta:number){this.speed=normal;return this.course.winter.applySpeed(previous,normal,input.throttle,input.brake,delta);}
  onShieldImpact(){return 0;}
  recover(){this.course.winter.recover();}
  private note(frequency:number,volume:number,duration:number,delay=0,type:OscillatorType='sine'){
    const ports=this.audio.environmentAudio();if(!ports||ports.context.state!=='running')return;
    const now=ports.context.currentTime+delay,osc=ports.context.createOscillator(),gain=ports.context.createGain();
    osc.type=type;osc.frequency.setValueAtTime(frequency,now);gain.gain.setValueAtTime(.00001,now);gain.gain.exponentialRampToValueAtTime(Math.max(.00002,volume),now+.007);gain.gain.exponentialRampToValueAtTime(.00001,now+duration);
    osc.connect(gain);gain.connect(ports.ambience);osc.start(now);osc.stop(now+duration+.02);this.sources.add(osc);
    osc.onended=()=>{osc.disconnect();gain.disconnect();this.sources.delete(osc);};
  }
  updateHud(progress:number){
    const winter=this.course.winter;
    const frost=Math.min(1,winter.visorSeconds/1.7);
    this.visor.style.opacity=String(frost*frost*(3-2*frost));
    this.visor.hidden=winter.visorSeconds<=0;
    const active=[];
    if(winter.stabilizerSeconds>0)active.push(`STABILIZERS ${winter.stabilizerSeconds.toFixed(1)}s`);
    if(winter.thermalSeconds>0)active.push(`THERMAL ${winter.thermalSeconds.toFixed(1)}s`);
    const snowy=snowCoverageAt(progress,0)>.15;
    this.status.dataset.kind=winter.stabilizerSeconds>0?'stabilizer':winter.thermalSeconds>0?'thermal':snowy?'snow':'clear';
    this.status.textContent=active.length?active.join(' · '):snowy?'SNOW DRIFT · FOLLOW THE CLEARED TRACKS':'CYAN: STABILIZE  /  AMBER: THERMAL BOOST';
    const second=Math.floor(this.course.visualTime),nearClock=Math.exp(-Math.abs(((progress-.024+1.5)%1)-.5)*this.course.length/190);
    if(second!==this.lastSecond){
      if(this.lastSecond>=0&&nearClock>.06){this.note(second%2?1250:970,.023*nearClock,.035,0,'triangle');this.ambience.ticks++;}
      if(second>0&&second%20===0){for(const [i,pitch] of [659.25,783.99,987.77].entries())this.note(pitch,.032*nearClock,2,i*.28);this.ambience.chimes++;}
      const nearTrain=Math.exp(-Math.abs(((progress-.365+1.5)%1)-.5)*this.course.length/90);
      if(second>0&&second%7===0&&nearTrain>.15){
        for(const [i,pitch] of [1568,2093,2637].entries())this.note(pitch,.017*nearTrain,.35,i*.11,'triangle');
        this.ambience.sleighBells++;
      }
      this.lastSecond=second;
    }
    const midnight=this.course.lap>=this.course.totalLaps;
    if(midnight&&!this.midnight){
      this.ui.flashHazard('MIDNIGHT IN FROSTLINE · HAPPY NEW YEAR',3000);
      for(let i=0;i<4;i++){this.note(523.25,.075,2.5,i*.75);this.note(1046.5,.024,1.9,i*.75);}
      this.ambience.chimes+=4;this.midnight=true;
    }
    const firework=Math.floor(this.course.visualTime/8);
    if(midnight&&firework!==this.lastFirework){this.lastFirework=firework;this.note(62,.052,.9,.6);this.note(84,.019,.5,.72,'triangle');this.ambience.fireworks++;}
    const ice=progress>.64&&progress<.78;
    if(ice&&!this.icy)this.ui.flashHazard('SILVER LAKE · ICE / OUTSIDE LINE HAS GRIP',2200);this.icy=ice;
  }
  reset(){this.lastSecond=this.lastFirework=-1;this.midnight=this.icy=false;this.course.lap=1;this.course.winter.reset();this.lastCollected=this.lastHits=this.lastBlocks=0;this.visor.hidden=true;this.speed=0;this.stopNotes();}
  private stopNotes(){for(const source of this.sources){try{source.stop();}catch{/* Already ended. */}}this.sources.clear();}
  dispose(){this.stopNotes();this.status.remove();this.stylesheet.remove();this.visor.remove();}
  updateCamera(camera:THREE.PerspectiveCamera,_delta:number,position:THREE.Vector3,forward:THREE.Vector3,speed:number){
    camera.position.copy(position).addScaledVector(forward,-11);camera.position.y+=3.9;
    this.look.copy(position).addScaledVector(forward,33);this.look.y+=3.3;
    camera.up.set(0,1,0);camera.lookAt(this.look);camera.fov=62+Math.min(speed/100,1)*2;camera.updateProjectionMatrix();
  }
}
