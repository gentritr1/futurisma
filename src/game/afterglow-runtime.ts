import * as THREE from 'three';
import type {CircuitRuntime} from './circuit-runtime';
import type {AfterglowCourse} from './afterglow-course';
import type {InputController, InputFrame} from './input';
import type {EngineAudio} from './audio';
import type {GameUi} from './ui';
import type {CourseProjection} from './course';

export class AfterglowRuntime implements CircuitRuntime {
  readonly ready=Promise.resolve(); readonly ceiling=false; readonly isFlipping=false;
  readonly surgeActive=false; readonly shieldActive=false; readonly boostRechargeScale=1;
  private readonly look=new THREE.Vector3();
  private readonly hud=document.createElement('output');
  private readonly stylesheet=document.createElement('link');
  private lastPhase=''; private lastHits=0;
  constructor(readonly course:AfterglowCourse,private readonly input:InputController,
    private readonly audio:EngineAudio,private readonly ui:GameUi){
    this.stylesheet.rel='stylesheet';this.stylesheet.href=new URL('./afterglow-hud.css?no-inline',import.meta.url).href;
    document.head.append(this.stylesheet);
    this.hud.className='relay-status';this.hud.setAttribute('aria-label','Satellite and hull condition');
    document.querySelector('.hud')!.append(this.hud);
  }
  handleActions(){return false;}
  step(delta:number,progress:number,lateral:number,lap:number){
    const attack=this.course.relay;
    attack.step(delta,progress,lateral,lap,this.course.totalLaps,this.course.length);
    if(attack.hits>this.lastHits){
      this.lastHits=attack.hits;this.audio.playImpact(.8);this.input.pulse(.65,.85,150);
      this.ui.flashImpact(lateral<0?'LEFT':'RIGHT');this.ui.flashHazard(`RELAY HIT · HULL ${attack.integrity}%`,1600);
    }
  }
  // Recovery holds pause the attack; resuming grants a re-entry immunity.
  advanceClocks(){}
  present(_sample:CourseProjection,position:THREE.Vector3){this.course.relayCraftPosition.copy(position);}
  updateHud(){
    const attack=this.course.relay;
    const labels={idle:'RELAY STANDBY · FINAL LAP',sky:'RELAY CHARGING · WATCH THE ROAD',mark:'LANE LOCKED · CHANGE LANE',strike:'BEAM LIVE · AVOID THE MARK',cooldown:'RELAY COOLING'};
    this.hud.dataset.phase=attack.phase;this.hud.dataset.integrity=String(attack.integrity);
    this.hud.textContent=`${labels[attack.phase]}  /  HULL ${attack.integrity}%`;
    if(attack.phase!==this.lastPhase){
      if(attack.phase==='sky')this.ui.flashHazard('SATELLITE UPLINK · SKY BEAM',1300);
      if(attack.phase==='mark')this.ui.flashHazard('ROAD TARGET LOCKED · CHANGE LANE',1800);
      this.lastPhase=attack.phase;
    }
  }
  applySurge(previous:number,normal:number,_input:InputFrame,delta:number){return this.course.relay.applySpeed(previous,normal,delta);}
  recover(){this.course.relay.recover();}
  reset(){this.course.relay.reset();this.lastHits=0;this.lastPhase='';}
  dispose(){this.hud.remove();this.stylesheet.remove();}
  onShieldImpact(){return 0;}
  updateCamera(camera:THREE.PerspectiveCamera,_delta:number,position:THREE.Vector3,forward:THREE.Vector3,speed:number){
    camera.position.copy(position).addScaledVector(forward,-11);camera.position.y+=3.6;
    this.look.copy(position).addScaledVector(forward,34);this.look.y+=2.7;
    camera.up.set(0,1,0);camera.lookAt(this.look);
    camera.fov=62+Math.min(speed/100,1)*3;camera.updateProjectionMatrix();
  }
}
