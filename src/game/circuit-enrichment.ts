import * as THREE from 'three';
import type {CircuitRuntime} from './circuit-runtime';
import type {RaceCourse, CourseProjection} from './course';
import type {InputFrame} from './input';
import type {TotemVisualState} from './totem';
import type {EngineAudio} from './audio';
import type {GameUi} from './ui';
import {CircuitLife} from './circuit-life';
import {CircuitAssists, ASSIST_MAPS, ASSIST_NAMES} from './circuit-assists';
import type {CircuitBoothKit} from './circuit-booth-kit';
import type {CircuitDistricts} from './circuit-districts';

/** Keeps each authored runtime intact while adding a common lifecycle for
 * roadside life. Legacy maps continue using Game's original chase camera. */
export class CircuitEnrichment implements CircuitRuntime {
  readonly ready:Promise<void>;
  readonly life:CircuitLife;
  readonly assists:CircuitAssists|null;
  readonly ownsCamera:boolean;
  private elapsed=0;
  private progress=0;
  private disposed=false;
  private lastCollected=0;
  private readonly originalGrip:RaceCourse['surfaceGripAt'];
  private readonly originalDrift:RaceCourse['lateralDriftAt'];
  private readonly cyan=new THREE.Color(0x8ceeff);
  private readonly amber=new THREE.Color(0xffbe68);
  private readonly roadRoot=new THREE.Group();
  private readonly roadGeometry:THREE.BufferGeometry[]=[];
  private readonly roadMaterial=new THREE.MeshStandardMaterial({color:0x4b667b,roughness:.18,metalness:.45,transparent:true,opacity:.32,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-1});
  private readonly hud:HTMLElement;

  constructor(readonly course:RaceCourse,private readonly base:CircuitRuntime|null,
    private readonly audio:EngineAudio,private readonly ui:GameUi,private readonly reducedMotion:boolean,boothKit:CircuitBoothKit|null=null,readonly districts:CircuitDistricts|null=null) {
    this.ownsCamera=base?.ownsCamera!==false&&base!==null;
    this.life=new CircuitLife(course,boothKit,districts?.sites);course.group.add(this.life.root);
    if(districts)course.group.add(districts.root);
    this.assists=ASSIST_MAPS.has(course.kind)?new CircuitAssists(course):null;
    this.hud=document.querySelector<HTMLElement>('.hud')!;
    this.originalGrip=course.surfaceGripAt;this.originalDrift=course.lateralDriftAt;
    if(this.assists){
      course.surfaceGripAt=(progress,lateral,halfWidth)=>{
        const original=this.originalGrip.call(course,progress,lateral,halfWidth);
        const wet=course.kind==='nightshift'&&nightshiftWet(progress,lateral)?Math.min(original,.82):original;
        return this.assists!.grip(wet);
      };
      course.lateralDriftAt=(progress,lateral,speed)=>this.assists!.gripSeconds>0?0:this.originalDrift?.call(course,progress,lateral,speed)??0;
    }
    if(course.kind==='nightshift')this.wetRoad();
    this.ready=Promise.all([base?.ready,this.assists?.field.ready]).then(()=>{});
  }
  get ceiling(){return this.base?.ceiling??false;}
  get isFlipping(){return this.base?.isFlipping??false;}
  get gravityBlend(){return this.base?.gravityBlend;}
  get surgeActive(){return this.base?.surgeActive??false;}
  get shieldActive(){return this.base?.shieldActive??false;}
  get boostRechargeScale(){return (this.base?.boostRechargeScale??1)*(this.assists&&this.assists.chargeSeconds>0?2.5:1);}
  handleActions(running:boolean,progress:number,position:THREE.Vector3,lateral:number,demo:boolean){return this.base?.handleActions(running,progress,position,lateral,demo)??false;}
  step(delta:number,progress:number,lateral:number,lap:number,leadMeters=0){
    this.base?.step(delta,progress,lateral,lap,leadMeters);this.elapsed+=delta;this.progress=progress;
    this.assists?.step(delta,progress,lateral,lap);
    if(this.assists&&this.assists.collected>this.lastCollected){
      this.lastCollected=this.assists.collected;
      const names=ASSIST_NAMES[this.course.kind],grip=this.assists.lastKind==='shield';
      this.ui.flashHazard(`${names[grip?0:1]} · ${grip?'8s GRIP':'6s RECHARGE + THRUST'}`,1800);
      this.audio.playPowerPickup();this.audio.playDeviceClunk();
    }
  }
  advanceClocks(delta:number){this.base?.advanceClocks(delta);}
  applySurge(previous:number,normal:number,input:InputFrame,delta:number){
    // Apply support before the relay, so an active charge cannot undo a strike.
    return this.base?.applySurge(previous,this.assists?.applySpeed(normal,input,delta)??normal,input,delta)??this.assists?.applySpeed(normal,input,delta)??normal;
  }
  present(sample:CourseProjection,position:THREE.Vector3,forward:THREE.Vector3,state:TotemVisualState){
    this.base?.present(sample,position,forward,state);
    this.life.update(this.elapsed,this.reducedMotion,sample.progress);
    this.districts?.update(this.elapsed,this.reducedMotion,sample.progress);
    if(this.assists){
      this.assists.field.update(this.elapsed,this.reducedMotion,this.assists.states,this.progress);
      this.assists.beacons.update(this.elapsed,this.reducedMotion,this.assists.states,this.progress);
      // Visual grip field only; it deliberately does not grant wall/beam immunity.
      state.shieldActive=this.assists.gripSeconds>0;state.overdriveActive=this.assists.chargeSeconds>0;
      state.shieldColor=this.cyan;state.surgeColor=this.amber;
      state.powerCharge=Math.max(this.assists.gripSeconds/8,this.assists.chargeSeconds/6);
      state.powerActivation=state.shieldActive||state.overdriveActive?1:0;
    }
  }
  updateCamera(camera:THREE.PerspectiveCamera,delta:number,position:THREE.Vector3,forward:THREE.Vector3,speed:number){this.base?.updateCamera(camera,delta,position,forward,speed);}
  updateHud(progress:number){
    this.base?.updateHud(progress);
    if(!this.assists)return;
    const grip=this.assists.gripSeconds,charge=this.assists.chargeSeconds;
    this.hud.dataset.assist=grip>0?'grip':charge>0?'charge':'';
    const names=ASSIST_NAMES[this.course.kind];
    this.hud.dataset.assistLabel=[grip>0?`${names[0]} ${grip.toFixed(1)}s`:'',charge>0?`${names[1]} ${charge.toFixed(1)}s`:''].filter(Boolean).join(' · ');
  }
  onShieldImpact(progress:number,lateral:number){return this.base?.onShieldImpact(progress,lateral)??0;}
  recover(progress:number){this.base?.recover(progress);this.assists?.recover();}
  reset(){this.base?.reset();this.assists?.reset();this.elapsed=0;this.lastCollected=0;this.progress=this.course.startProgress;delete this.hud.dataset.assist;delete this.hud.dataset.assistLabel;}
  dispose(){
    if(this.disposed)return;this.disposed=true;
    this.base?.dispose();this.assists?.dispose();this.life.dispose();this.districts?.dispose();
    this.course.surfaceGripAt=this.originalGrip;this.course.lateralDriftAt=this.originalDrift;
    this.roadRoot.removeFromParent();this.roadGeometry.forEach(g=>g.dispose());this.roadMaterial.dispose();
    delete this.hud.dataset.assist;delete this.hud.dataset.assistLabel;
  }
  private wetRoad(){
    this.roadRoot.name='nightshift_rain_sheets';
    for(const [from,to] of [[.18,.26],[.61,.70]]){
      const positions:number[]=[];
      for(const side of [-1,1])for(let i=0;i<42;i++){
        const a=this.course.sample(from+(to-from)*i/42),b=this.course.sample(from+(to-from)*(i+1)/42);
        const leftA=side<0?-a.halfWidth:1.8,rightA=side<0?-1.8:a.halfWidth;
        const leftB=side<0?-b.halfWidth:1.8,rightB=side<0?-1.8:b.halfWidth;
        const corners=[a.position.clone().addScaledVector(a.right,leftA),a.position.clone().addScaledVector(a.right,rightA),b.position.clone().addScaledVector(b.right,leftB),b.position.clone().addScaledVector(b.right,rightB)];
        corners.forEach(p=>p.y+=.025);
        for(const corner of [0,1,2,1,3,2])positions.push(...corners[corner].toArray());
      }
      const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.computeVertexNormals();
      this.roadGeometry.push(geometry);this.roadRoot.add(new THREE.Mesh(geometry,this.roadMaterial));
    }
    this.course.group.add(this.roadRoot);
  }
}
export function nightshiftWet(progress:number,lateral:number){const p=((progress%1)+1)%1;return ((p>.18&&p<.26)||(p>.61&&p<.70))&&Math.abs(lateral)>1.8;}
