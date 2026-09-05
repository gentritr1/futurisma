import * as THREE from 'three';
import {refractingSurface,captureRefraction} from './tideline-refraction';
import type {TidelineCourse} from './tideline-course';
import {TIDELINE_FIELDS} from './tideline-rules.js';
import {atlasTile,hardwareAtlas,hardwareMaterial,HardwareBatch} from './tideline-hardware';
interface Door {root:THREE.Group;membrane:THREE.Mesh;lamps:THREE.InstancedMesh;droplets:THREE.InstancedMesh;burstAt:number;clock:{value:number}}
export class TidelineBulkheads {
 readonly root=new THREE.Group();readonly doors:Door[]=[];
 private readonly pose=new THREE.Object3D();private readonly color=new THREE.Color();
 constructor(private readonly course:TidelineCourse) {
  this.root.name='tideline_phase_bulkheads';
  const steel=hardwareMaterial(hardwareAtlas('metal')),hazard=hardwareMaterial(hardwareAtlas('signage'));
  for(const field of TIDELINE_FIELDS) {
   const s=course.sample(field.progress),root=new THREE.Group();root.name=`bulkhead_${field.id}`;
   root.position.copy(s.position).addScaledVector(s.right,field.lateral).addScaledVector(s.up,1.85);
   root.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(s.right,s.up,s.tangent.clone().negate()));
   const structure=new HardwareBatch();
   structure.add(atlasTile(new THREE.TorusGeometry(1.045,.085,5,32),1).scale(field.halfWidth,1.94,2));
   for(const side of [-1,1])structure.box(side*(field.halfWidth+.18),-.88,0,.35,2.15,.7);
   root.add(structure.mesh('bulkhead_pressure_flange',steel));
   const stripes=new THREE.Mesh(atlasTile(new THREE.RingGeometry(.96,1.10,32),3),hazard);stripes.scale.set(field.halfWidth,1.94,1);stripes.position.z=.18;stripes.name='bulkhead_iris_hazard_ring';root.add(stripes);
   const clock={value:0};
   const membraneMaterial=refractingSurface('bulkhead_refracting_membrane',clock);
   const membrane=new THREE.Mesh(new THREE.CircleGeometry(1,32),membraneMaterial);membrane.name='bulkhead_refracting_scan_membrane';membrane.scale.set(field.halfWidth,1.82,1);root.add(membrane);captureRefraction(membrane);
   const lamps=new THREE.InstancedMesh(new THREE.BoxGeometry(.23,.16,.16),hardwareMaterial(null,0xffffff,1.3),12);lamps.name='bulkhead_warning_status_lamps';
   for(let i=0;i<12;i++){const a=i*Math.PI/6;this.pose.position.set(Math.cos(a)*field.halfWidth*1.06,Math.sin(a)*2.04,.25);this.pose.rotation.set(0,0,a+Math.PI/2);this.pose.scale.setScalar(1);this.pose.updateMatrix();lamps.setMatrixAt(i,this.pose.matrix);lamps.setColorAt(i,new THREE.Color(1,.45,.1));}lamps.computeBoundingSphere();root.add(lamps);
   const drops=new THREE.InstancedMesh(new THREE.SphereGeometry(.07,5,3),new THREE.MeshLambertMaterial({color:0x8dacb0,emissive:0x40595b,emissiveIntensity:.25,transparent:true,opacity:.65}),32);drops.name='bulkhead_membrane_burst_droplets';drops.frustumCulled=false;drops.visible=false;root.add(drops);
   this.root.add(root);this.doors.push({root,membrane,lamps,droplets:drops,burstAt:-100,clock});
  }
 }
 absorb(index:number,time:number):void {const door=this.doors[index];if(door)door.burstAt=time;}
 reset():void {for(const door of this.doors)door.burstAt=-100;}
 update(time:number,reduced:boolean,progress:number):void {
  for(const [index,door] of this.doors.entries()) {
   const field=TIDELINE_FIELDS[index],distance=Math.abs(((field.progress-progress+1.5)%1)-.5)*this.course.length;
   door.root.visible=distance<280;door.clock.value=reduced?0:time;
   const age=time-door.burstAt,burst=age>=0&&age<2.5;door.membrane.visible=!burst;
   for(let i=0;i<12;i++){
    const strobe=reduced?1:(Math.floor(time*3)+i)%2===0?1:.25;
    this.color.setRGB(burst?.15:strobe,burst?1:strobe*.38,burst?.28:strobe*.055);door.lamps.setColorAt(i,this.color);
   }
   door.lamps.instanceColor!.needsUpdate=true;door.droplets.visible=burst&&age<.75&&!reduced;
   if(door.droplets.visible){for(let i=0;i<32;i++){const a=i*2.399,r=.25+(i%7)/7;this.pose.position.set(Math.cos(a)*field.halfWidth*r*(1+age),Math.sin(a)*1.8*r-age*age*3,age*(1+i%3));this.pose.rotation.set(0,0,0);this.pose.scale.setScalar(1-age/.75);this.pose.updateMatrix();door.droplets.setMatrixAt(i,this.pose.matrix);}door.droplets.instanceMatrix.needsUpdate=true;}
  }
 }
}
