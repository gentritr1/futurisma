import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import type {RaceCourse} from './course';
import type {CircuitRuntime} from './circuit-runtime';
import type {TidelineCourse} from './tideline-course';
import type {AscensionCourse} from './ascension-course';
import type {DreamIslandCourse} from './dreamisland-course';
import type {AfterglowCourse} from './afterglow-course';
import type {EngineAudio} from './audio';
import {CircuitSignatureAudio} from './circuit-signature-audio';
import {restoreCircuitSignatureVegetation} from './circuit-signature-parcel';
import {disposeObject3DResources} from './graphics-resources.js';
import {CIRCUIT_SIGNATURE_SITES,circuitSignatureOrigin,circuitSignatureSignX} from './circuit-signature-sites';
import {addSignatureLighting} from './circuit-signature-lighting';
import {circuitSignaturePose} from './circuit-signature-pose.js';

const UP = new THREE.Vector3(0, 1, 0);
const READY = new THREE.Color(0xc8dccb);
const WORKING = new THREE.Color(0xe8b66e);
const WARNING = new THREE.Color(0xed7662);

/** A single authored working place, with race-clock motion and circuit-owned
 * signals. The map retains sole ownership of every gameplay consequence. */
class CircuitSignature {
  readonly root = new THREE.Group();
  private readonly site;
  private readonly pivots = new Map<string, {node:THREE.Object3D; position:THREE.Vector3; rotation:THREE.Euler}>();
  private readonly signCanvas = document.createElement('canvas');
  private readonly signTexture: THREE.CanvasTexture;
  private readonly lamps: THREE.MeshBasicMaterial;
  private readonly gauge: THREE.Mesh;
  private readonly flow: THREE.InstancedMesh;
  private elapsed = 0;
  private remainder = 0;
  private tick = 0;
  private lastStatus = '';
  private disposed = false;
  private readonly movedCanopy: {mesh:THREE.InstancedMesh;index:number;matrix:THREE.Matrix4}[]=[];
  private readonly sound:CircuitSignatureAudio;

  constructor(private readonly runtime: CircuitRuntime, source: THREE.Group, private readonly reduced: boolean,audio:EngineAudio) {
    const course = runtime.course;
    this.site = CIRCUIT_SIGNATURE_SITES[course.kind];
    this.root.name = 'circuit_signature';
    this.place(course);
    this.sound=new CircuitSignatureAudio(audio,course.kind);
    this.root.scale.setScalar(this.site.scale??1);
    this.root.add(source);
    source.traverse(node => {
      if (node instanceof THREE.Mesh) {
        const material = node.material as THREE.MeshStandardMaterial;
        if (material.map) material.map.anisotropy = 4;
        node.castShadow=material.name!=='signature_amber'&&material.name!=='signature_water';
        node.receiveShadow=true;
        // Restrained fill preserves the texture in recessed, overcast scenes.
        if (material.name === 'signature_paint') {material.emissive.set(0xffffff);material.emissiveMap=material.map;material.emissiveIntensity=.045;}
      }
      if (!(node instanceof THREE.Mesh) && node.name !== 'signature_scene')
        this.pivots.set(node.name, {node, position:node.position.clone(), rotation:node.rotation.clone()});
    });
    this.signCanvas.width=1024;this.signCanvas.height=256;
    this.signTexture = new THREE.CanvasTexture(this.signCanvas);this.signTexture.colorSpace=THREE.SRGBColorSpace;
    this.signTexture.anisotropy=4;
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(this.site.signWidth, 1.4), new THREE.MeshBasicMaterial({map:this.signTexture}));
    const signX=circuitSignatureSignX(this.site);
    sign.name='signature_service_sign';sign.position.set(signX,this.site.signHeight,-this.site.signFront);sign.rotation.y=Math.PI;
    this.root.add(sign);
    this.lamps = new THREE.MeshBasicMaterial({color:this.site.accent});
    // Two restrained indicators balance the sign. Neither casts extra light.
    const lamps = new THREE.InstancedMesh(new THREE.BoxGeometry(.2,.75,.15), this.lamps, 2);
    const matrix=new THREE.Matrix4();
    for(let i=0;i<2;i++)lamps.setMatrixAt(i,matrix.makeTranslation(signX+(i===0?-1:1)*(this.site.signWidth/2+.1),this.site.signHeight,-this.site.signFront-.08));
    lamps.name='signature_status_lamps';this.root.add(lamps);
    const gaugeMaterial=new THREE.MeshBasicMaterial({color:this.site.accent});
    this.gauge=new THREE.Mesh(new THREE.BoxGeometry(.2,1,.16),gaugeMaterial);
    this.gauge.name='signature_state_gauge';this.gauge.position.set(signX-this.site.signWidth/2+.5,2,-this.site.signFront-.08);
    this.gauge.visible=['tideline','ascension','afterglow','polarity'].includes(course.kind);this.root.add(this.gauge);
    // Supply flow stays inside the installation. It never covers racing cues.
    const flowMaterial=new THREE.MeshLambertMaterial({color:course.kind==='bitterpan'?0xd6cbbb:0xb1c9bf,transparent:true,opacity:.45,depthWrite:false});
    this.flow=new THREE.InstancedMesh(new THREE.SphereGeometry(.12,5,3),flowMaterial,20);
    this.flow.name='signature_contained_flow';this.flow.frustumCulled=false;this.flow.visible=false;this.root.add(this.flow);
    this.buildCrewAccess(course);
    addSignatureLighting(this.root,course.kind);
    this.reserveCanopy(course);
    let triangles=0,draws=0,maxRenderedTriangles=0;
    const hasFlow=['bitterpan','nightshift','ascension'].includes(course.kind)&&!reduced;
    this.root.traverse(node=>{
      if(!(node instanceof THREE.Mesh))return;
      const count=(node.geometry.index?.count??node.geometry.attributes.position.count)/3;
      triangles+=count;draws++;
      if(node===this.flow?!hasFlow:!node.visible)return;
      maxRenderedTriangles+=count*(node instanceof THREE.InstancedMesh?node.count:1);
    });
    Object.assign(this.root.userData,{circuit:course.kind,purpose:this.site.subtitle,triangles,drawCalls:draws,
      maxRenderedTriangles,reducedMotion:reduced});
    course.group.add(this.root);
    this.present();
  }

  private place(course:RaceCourse): void {
    const site=this.site,sample=course.sample(site.progress);
    const origin=circuitSignatureOrigin(course);
    // Face the service entrance toward the road and slightly into the approach.
    // This is a proper Y-up glTF frame, never a reflected model matrix.
    const forward=sample.right.clone().multiplyScalar(-site.side).addScaledVector(sample.tangent,-.28).setY(0).normalize();
    const right=new THREE.Vector3().crossVectors(forward,UP).normalize();
    this.root.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(right,UP,forward.clone().negate()));
    this.root.position.copy(origin);
    let clearance=Infinity;
    const count=Math.ceil(course.length/3);
    for(let i=0;i<count;i++){
      const s=course.sample(i/count);
      clearance=Math.min(clearance,Math.hypot(s.position.x-origin.x,s.position.z-origin.z)-s.halfWidth-Math.max(s.apronLeft,s.apronRight)-site.radius-1.5);
    }
    // Authored cut roads are also drivable; do not reserve only the main loop.
    const branch=course as RaceCourse & {sampleShortcut?:(p:number)=>ReturnType<RaceCourse['sample']>};
    if(branch.sampleShortcut)for(let i=0;i<count;i++){
      const s=branch.sampleShortcut(i/count);
      clearance=Math.min(clearance,Math.hypot(s.position.x-origin.x,s.position.z-origin.z)-s.halfWidth-site.radius-1.5);
    }
    if(clearance<5)throw new Error(`${course.kind}: signature footprint needs a safer authored site (${clearance.toFixed(1)}m)`);
    Object.assign(this.root.userData,{progress:site.progress,side:site.side,radius:site.radius,clearanceMeters:clearance,origin:origin.toArray()});
  }

  private buildCrewAccess(course:RaceCourse): void {
    const sample=course.sample(this.site.progress),apron=this.site.side<0?sample.apronLeft:sample.apronRight;
    this.root.updateMatrixWorld(true);
    const inverse=this.root.matrixWorld.clone().invert();
    const roadEnd=sample.position.clone().addScaledVector(sample.right,this.site.side*(sample.halfWidth+apron+5)).applyMatrix4(inverse);
    const doorEnd=new THREE.Vector3(0,.04,-this.site.signFront+.6);
    const direction=doorEnd.clone().sub(roadEnd),length=direction.length();
    if(length<2)return;
    const right=new THREE.Vector3().crossVectors(UP,direction).normalize();
    const basis=new THREE.Matrix4().makeBasis(right,UP,direction.clone().normalize());
    const geometries:THREE.BufferGeometry[]=[];
    const box=(position:THREE.Vector3,size:THREE.Vector3)=>{
      geometries.push(new THREE.BoxGeometry(1,1,1).applyMatrix4(basis.clone().setPosition(position).scale(size)));
    };
    const middle=roadEnd.clone().add(doorEnd).multiplyScalar(.5);
    box(middle.clone().addScaledVector(UP,-.16),new THREE.Vector3(2.4,.28,length));
    for(const side of [-1,1]){
      box(middle.clone().addScaledVector(right,side*1.12).addScaledVector(UP,1),new THREE.Vector3(.1,.1,length));
      for(let i=0;i<=4;i++)box(roadEnd.clone().lerp(doorEnd,i/4).addScaledVector(right,side*1.12).addScaledVector(UP,.5),new THREE.Vector3(.1,1,.1));
    }
    const geometry=mergeGeometries(geometries)!;geometries.forEach(g=>g.dispose());
    const material=new THREE.MeshLambertMaterial({color:this.runtime.course.kind==='frostline'?0x8b9da7:0x596b64});
    const bridge=new THREE.Mesh(geometry,material);bridge.name='signature_crew_access';this.root.add(bridge);
    this.root.userData.crewAccessLength=length;
  }

  private reserveCanopy(course:RaceCourse): void {
    if(course.kind!=='greenwater')return;
    const canopy=course.group.getObjectByName('greenwater_canopy');
    if(!canopy)return;
    const trees=canopy.children.filter((node):node is THREE.InstancedMesh=>node instanceof THREE.InstancedMesh);
    const sample=course.sample(this.site.progress),outward=sample.right.clone().multiplyScalar(this.site.side);
    const matrix=new THREE.Matrix4(),center=new THREE.Vector3();
    // Move a complete tree (trunk and crown together) beyond the working dock.
    // Counts, seeds and the surrounding forest remain intact; disposal restores.
    for(let index=0;index<(trees[0]?.count??0);index++){
      trees[0].getMatrixAt(index,matrix);center.setFromMatrixPosition(matrix);
      if(Math.hypot(center.x-this.root.position.x,center.z-this.root.position.z)>this.site.radius+7)continue;
      const distance=center.clone().sub(this.root.position).dot(outward);
      const displacement=outward.clone().multiplyScalar(this.site.radius+9-distance);
      for(const mesh of trees){
        mesh.getMatrixAt(index,matrix);this.movedCanopy.push({mesh,index,matrix:matrix.clone()});
        matrix.elements[12]+=displacement.x;matrix.elements[14]+=displacement.z;
        mesh.setMatrixAt(index,matrix);mesh.instanceMatrix.needsUpdate=true;mesh.computeBoundingSphere();
      }
    }
    this.root.userData.relocatedTrees=this.movedCanopy.length/2;
  }

  step(delta:number): void {
    if(this.disposed)return;
    // Both running and coast call this seam, pause calls neither. Integer ticks
    // make the same pose repeat on retry, independent of display frame rate.
    this.remainder+=delta*120;const ticks=Math.floor(this.remainder+1e-7);this.remainder-=ticks;
    this.tick+=ticks;this.elapsed=this.tick/120;
  }

  private rotate(name:string,axis:'x'|'y'|'z',angle:number): void {
    const pivot=this.pivots.get(name);if(pivot)pivot.node.rotation[axis]=pivot.rotation[axis]+angle;
  }

  private move(name:string,axis:'x'|'y'|'z',offset:number): void {
    const pivot=this.pivots.get(name);if(pivot)pivot.node.position[axis]=pivot.position[axis]+offset;
  }

  present(position?:THREE.Vector3,forward?:THREE.Vector3,up?:THREE.Vector3): void {
    if(this.disposed)return;
    const course=this.runtime.course,kind=course.kind;
    const tide=kind==='tideline'?(course as TidelineCourse).tide:null;
    const schedule=kind==='ascension'?(course as AscensionCourse).schedule:null;
    const signals={waterLevel:tide?.waterLevel??0,draining:tide?.draining??false,
      night:kind==='dreamisland'?(course as DreamIslandCourse).nightBlend:0,deluge:schedule?.state.deluge??false,
      ceiling:this.runtime.ceiling,flipping:this.runtime.isFlipping,gravityBlend:this.runtime.gravityBlend,
      relay:kind==='afterglow'?(course as AfterglowCourse).relay.phase:'idle'};
    const pose=circuitSignaturePose(kind,this.elapsed,this.reduced,signals);
    if(kind==='greenwater'){
      this.move('survey_plane','y',pose.planeBob);this.rotate('survey_plane','z',pose.planeRoll);
      this.rotate('prop_left','z',pose.time*2);this.rotate('prop_right','z',-pose.time*2);
    }else if(kind==='bitterpan'){
      this.rotate('bucket_wheel','x',pose.wheelAngle);
    }else if(kind==='nightshift'){
      for(let i=0;i<3;i++)this.rotate(`washer_${i}`,'z',pose.washerAngle*(i%2?-1:1)+i*.7);
      this.rotate('roof_fan','y',pose.time*.8);
    }else if(kind==='polarity'){
      this.rotate('gravity_cradle','x',pose.gravityTilt);
      this.rotate('gyro_inner','y',pose.time*.22+.6);this.rotate('gyro_core','x',pose.time*.35+.4);
    }else if(kind==='tideline'){
      this.move('inspection_rov','y',pose.rovLift+(signals.waterLevel>-.5?pose.planeBob:0));
      for(const name of ['rov_cable_left','rov_cable_right']){
        const cable=this.pivots.get(name);
        if(cable)cable.node.scale.y=(4.5-pose.rovLift-(signals.waterLevel>-.5?pose.planeBob:0))/4.5;
      }
      this.rotate('thruster_left','z',pose.time*.7);this.rotate('thruster_right','z',-pose.time*.7);
    }else if(kind==='ascension'){
      this.rotate('valve_left','z',pose.valveAngle);this.rotate('valve_right','z',-pose.valveAngle);
    }else if(kind==='dreamisland'){
      this.move('dome_left','x',-pose.domeOpen);this.move('dome_right','x',pose.domeOpen);
      this.rotate('star_lens','x',signals.night*.35);
      this.move('star_lens','y',-1.4*(1-signals.night));
    }else if(kind==='afterglow'){
      this.rotate('relay_fan_left','z',pose.fanAngle);this.rotate('relay_fan_right','z',-pose.fanAngle);
    }else if(kind==='frostline')this.rotate('groomer_blade','x',pose.bladeAngle);
    const fill=kind==='tideline'?Math.max(.08,(signals.waterLevel+27)/27):kind==='ascension'?signals.deluge?.35:1:kind==='afterglow'?signals.relay==='idle'?.15:signals.relay==='strike'?1:.65:signals.ceiling?1:.25;
    this.gauge.scale.y=fill*4;this.gauge.position.y=1+fill*2;
    this.lamps.color.copy(pose.alert?WARNING:pose.active?WORKING:READY);
    (this.gauge.material as THREE.MeshBasicMaterial).color.copy(this.lamps.color);
    this.updateFlow(pose.time,signals.deluge);
    if(position&&forward&&up)this.sound.update(this.tick,this.root.position,position,forward,up,pose.active);
    if(pose.status!==this.lastStatus){this.lastStatus=pose.status;this.paintSign(pose.status);}
    Object.assign(this.root.userData,{tick:this.tick,status:pose.status,signals,pose});
  }

  private updateFlow(time:number,deluge:boolean): void {
    const kind=this.runtime.course.kind;
    this.flow.visible=!this.reduced&&(kind==='bitterpan'||kind==='nightshift'||kind==='ascension'&&deluge);
    if(!this.flow.visible)return;
    const matrix=new THREE.Matrix4();
    for(let i=0;i<20;i++){
      const phase=(time*(kind==='nightshift'?.7:.35)+i/20)%1;
      if(kind==='bitterpan')matrix.makeTranslation(Math.sin(i*9)*2.1,2.65,4+phase*6);
      else if(kind==='nightshift')matrix.makeTranslation(i%2?11.6:-11.6,.5+phase*6.5,-6);
      else matrix.makeTranslation(i%2?7:-7,.6+phase*.5,-4-phase*3);
      this.flow.setMatrixAt(i,matrix);
    }
    this.flow.instanceMatrix.needsUpdate=true;
  }

  private paintSign(status:string): void {
    const ctx=this.signCanvas.getContext('2d')!;
    ctx.fillStyle='#1c2a2c';ctx.fillRect(0,0,1024,256);
    ctx.fillStyle='#e6dbc0';ctx.textAlign='center';ctx.font='bold 58px monospace';ctx.fillText(this.site.title,512,94);
    ctx.fillStyle='#c2bda6';ctx.font='23px monospace';ctx.fillText(this.site.subtitle,512,150);
    ctx.fillStyle='#e3ba7b';ctx.font='bold 28px monospace';ctx.fillText(status,512,214);
    ctx.fillRect(40,236,944,4);this.signTexture.needsUpdate=true;
  }

  reset(): void {this.tick=0;this.elapsed=0;this.remainder=0;this.sound.reset();this.present();}

  dispose(): void {
    if(this.disposed)return;this.disposed=true;
    this.sound.dispose();
    restoreCircuitSignatureVegetation(this.root);
    this.root.removeFromParent();this.root.traverse(node=>{if(node instanceof THREE.InstancedMesh)node.dispose();});
    for(const {mesh,index,matrix} of this.movedCanopy){mesh.setMatrixAt(index,matrix);mesh.instanceMatrix.needsUpdate=true;mesh.computeBoundingSphere();}
    disposeObject3DResources(this.root);this.root.clear();this.pivots.clear();
  }
}

/** Only the selected circuit's art downloads. Install after its gameplay
 * runtime is ready; failed optional art cannot prevent starting the race. */
export async function installCircuitSignature(runtime:CircuitRuntime,audio:EngineAudio,reduced:boolean,cancelled:()=>boolean):Promise<void> {
  const {scene}=await new GLTFLoader().loadAsync(`/assets/circuit-signatures/${runtime.course.kind}.glb`);
  if(cancelled()){disposeObject3DResources(scene);return;}
  const heroes={greenwater:'survey_plane',bitterpan:'bucket_wheel',nightshift:'washer_0',polarity:'gravity_cradle',tideline:'inspection_rov',ascension:'valve_left',dreamisland:'dome_left',afterglow:'relay_fan_left',frostline:'snow_groomer'};
  if(!scene.getObjectByName('signature_scene')||!scene.getObjectByName(heroes[runtime.course.kind])||!(scene.getObjectByName('static_signature_paint') instanceof THREE.Mesh)){
    disposeObject3DResources(scene);throw new Error('Incomplete circuit signature');
  }
  let signature:CircuitSignature;
  try{signature=new CircuitSignature(runtime,scene,reduced,audio);}catch(error){disposeObject3DResources(scene);throw error;}
  const step=runtime.step.bind(runtime),advance=runtime.advanceClocks.bind(runtime),present=runtime.present.bind(runtime),reset=runtime.reset.bind(runtime),dispose=runtime.dispose.bind(runtime);
  let stepCalls=0;
  runtime.step=(...args)=>{step(...args);signature.step(args[0]);stepCalls++;};
  // Some advanced runtimes implement advanceClocks by calling this.step.
  // Avoid counting that internal delegation as a second signature tick.
  runtime.advanceClocks=delta=>{const before=stepCalls;advance(delta);if(stepCalls===before)signature.step(delta);};
  runtime.present=(...args)=>{present(...args);signature.present(args[1],args[2],args[0].up);};
  runtime.reset=()=>{reset();signature.reset();};
  runtime.dispose=()=>{signature.dispose();dispose();};
}
