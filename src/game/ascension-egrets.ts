import * as THREE from 'three';
import type {AscensionCourse} from './ascension-course';
/** Animate the twelve authored painted cards without replacing their atlas silhouettes. */
export class AscensionEgrets {
 private readonly mesh:THREE.Mesh;
 private readonly base:Float32Array;
 private readonly centers:THREE.Vector3[]=[];
 private riseTick=-10000;
 private risenLap=0;
 private lastTick=0;
 constructor(root:THREE.Group,private readonly course:AscensionCourse){
  let source:THREE.Mesh|undefined;
  root.traverse(o=>{if(o instanceof THREE.Mesh&&o.name.startsWith('AP_STATIC_')&&(o.material as THREE.Material).name.endsWith('jungle'))source=o;});
  if(!source||source.geometry.attributes.position.count!==48)throw Error('Expected twelve authored egret quads');
  this.mesh=source;source.name='ascension_animated_egrets';source.frustumCulled=false;
  this.base=new Float32Array(source.geometry.attributes.position.array);
  for(let bird=0;bird<12;bird++){const center=new THREE.Vector3();for(let v=0;v<4;v++)center.add(new THREE.Vector3().fromArray(this.base,(bird*4+v)*3));this.centers.push(center.multiplyScalar(.25));}
 }
 update(reduced:boolean){
  const tick=this.course.schedule.tick,progress=this.course.group.userData.playerProgress??0,lap=this.course.tide.lap;
  if(tick<this.lastTick){this.risenLap=0;this.riseTick=-10000;}this.lastTick=tick;
  if(progress>.68&&progress<.79&&lap!==this.risenLap){this.risenLap=lap;this.riseTick=tick;}
  const age=Math.max(0,(tick-this.riseTick)/120),launched=this.course.schedule.state.launched;
  const launchAge=Math.max(0,(tick-(this.course.schedule.config?.launchTick??Infinity))/120);
  const p=this.mesh.geometry.attributes.position;
  for(let bird=0;bird<12;bird++){
   const center=this.centers[bird],angle=bird*2.399;
   const rise=launched?Math.min(80,launchAge*9):age<6?Math.sin(Math.min(1,age/6)*Math.PI)*12:0;
   const scatter=launched?Math.min(180,launchAge*15):Math.sin(Math.min(1,age/6)*Math.PI)*4;
   const flap=reduced?0:Math.sin(tick/120*7+bird)*.18;
   for(let v=0;v<4;v++){const at=(bird*4+v)*3,x=this.base[at]-center.x,y=this.base[at+1]-center.y;
    p.setXYZ(bird*4+v,center.x+x*Math.cos(flap)-y*Math.sin(flap)+Math.cos(angle)*scatter,center.y+x*Math.sin(flap)+y*Math.cos(flap)+rise,this.base[at+2]+Math.sin(angle)*scatter);
   }
  }p.needsUpdate=true;this.mesh.userData.motion={tick,risenLap:this.risenLap,riseTick:this.riseTick,launched,launchAge,firstBirdPosition:[p.getX(0),p.getY(0),p.getZ(0)]};this.course.group.userData.egrets=this.mesh.userData.motion;
 }
}
