import * as THREE from 'three';
import {PowerKit} from './power-kit';
import {mergeInto} from './dreamisland-heroes';
import {DREAMISLAND_ABILITY_CONFIG} from './dreamisland-powers-config.js';
import {dreamIslandHardwareLateral,dreamIslandHardwareYaw,dreamIslandHardwareFoot,dreamIslandHardwareSupport} from './dreamisland-hardware-layout.js';
import colors from './data/dreamisland/power-colors.json';
import {CELL} from './dreamisland-materials';
import type {DreamIslandCourse} from './dreamisland-course';

type PickupState={available:boolean;charge:number};
type Part={geometry:THREE.BufferGeometry;matrix:THREE.Matrix4};

/** Five devices, seven draws: stone, metal, two core kinds hinged petals and two plate batches.
 * The tall mechanism sits on the verge; its flat target plate keeps the
 * original trigger position, without occupying the vehicle corridor.
 */
export class DreamIslandHardware {
 readonly root=new THREE.Group();
 readonly report={devices:0,meshes:0,triangles:0,petalOpeningTicks:30,
  source:'/assets/dreamisland/power-kit.glb',placements:[] as {id:string;position:number[];height:number;groundY:number|null;hardwareLateral:number;triggerLateral:number;lateralOffset:number}[]};
 private readonly cores:{mesh:THREE.InstancedMesh;indices:number[]}[]=[];
 private readonly plates:{mesh:THREE.InstancedMesh;indices:number[]}[]=[];
 private petals:THREE.InstancedMesh|null=null;
 private readonly hinges:{base:THREE.Matrix4;pickup:number}[]=[];
 private readonly collectedAt=new Map<number,number>();
 private readonly rotation=new THREE.Matrix4();
 private readonly matrix=new THREE.Matrix4();
 private readonly color=new THREE.Color();
 private readonly ownedMaterials:THREE.Material[]=[];
 private constructor(private readonly kit:PowerKit,private readonly course:DreamIslandCourse){}

 static async load(course:DreamIslandCourse,materials:Map<string,THREE.MeshLambertMaterial>,world:THREE.Object3D){
  const kit=await PowerKit.load(false,'/assets/dreamisland/power-kit.glb');
  const hardware=new DreamIslandHardware(kit,course);
  hardware.build(materials,world);
  return hardware;
 }
 private build(materials:Map<string,THREE.MeshLambertMaterial>,world:THREE.Object3D){
  this.root.name='dreamisland_power_hardware';
  const staticParts=new Map<string,Part[]>(),coreParts=new Map<string,{geometry:THREE.BufferGeometry;parts:{matrix:THREE.Matrix4;pickup:number}[]}>();
  const plateParts=new Map<string,{matrix:THREE.Matrix4;pickup:number}[]>();
  let petalGeometry:THREE.BufferGeometry|null=null;
  const tintedGeometry:THREE.BufferGeometry[]=[];
  DREAMISLAND_ABILITY_CONFIG.pickups.forEach((pickup,index)=>{
   const kind=pickup.kind!,source=this.kit.templates[kind].clone(true);
   const sample=this.course.sample(pickup.progress);
   const lateral=dreamIslandHardwareLateral(sample.halfWidth,pickup.lateral??0,this.course.sectorLabelAt(pickup.progress));
   const {position,groundY}=dreamIslandHardwareFoot(sample,lateral,world);
   const basis=new THREE.Matrix4().makeBasis(sample.right,sample.up,sample.tangent.clone().negate());
   basis.multiply(new THREE.Matrix4().makeRotationY(dreamIslandHardwareYaw(lateral))).setPosition(position);
   if(groundY===null){
    const parts=staticParts.get('DI_MAT_concrete')??[];
    parts.push(dreamIslandHardwareSupport(sample,lateral));staticParts.set('DI_MAT_concrete',parts);
   }
   source.updateMatrixWorld(true);
   const box=new THREE.Box3().setFromObject(source);
   this.report.placements.push({id:pickup.id,position:position.toArray(),height:box.max.y-box.min.y,groundY,
    hardwareLateral:lateral,triggerLateral:pickup.lateral??0,lateralOffset:lateral-(pickup.lateral??0)});
   const plates=plateParts.get(kind)??[];
   const plateMatrix=new THREE.Matrix4().makeBasis(sample.right,sample.up,sample.tangent.clone().negate()).setPosition(sample.position.clone().addScaledVector(sample.right,pickup.lateral??0)
    .addScaledVector(sample.up,.045));
   plates.push({matrix:plateMatrix,pickup:index});plateParts.set(kind,plates);
   source.traverse(object=>{
    if(!(object instanceof THREE.Mesh))return;
    if(object.userData.metalFinish==='bronze'){
     // glTF normalized vertex colors clamp at one. Apply the measured light
     // compensation in a float attribute, still through the shared Lambert pass.
     const geometry=object.geometry.clone(),tint=new Float32Array(geometry.attributes.position.count*3);
     for(let i=0;i<tint.length;i+=3)tint.set(colors.bronze,i);
     geometry.setAttribute('color',new THREE.BufferAttribute(tint,3));
     object.geometry=geometry;tintedGeometry.push(geometry);
    }
    const world=new THREE.Matrix4().multiplyMatrices(basis,object.matrixWorld);
    if(object.name.startsWith('PK_shield_petal_')){
     petalGeometry??=object.geometry.clone();
     this.hinges.push({base:world,pickup:index});return;
    }
    if(object.name===`PK_${kind}_core`){
     const entry=coreParts.get(kind)??{geometry:object.geometry.clone(),parts:[] as {matrix:THREE.Matrix4;pickup:number}[]};
     entry.parts.push({matrix:world,pickup:index});
     // Matching lamp on the front of the mount, in the same core batch.
     const lamp=basis.clone().multiply(new THREE.Matrix4().makeTranslation(0,.30,-.43))
      .multiply(new THREE.Matrix4().makeScale(.22,.22,.22));
     entry.parts.push({matrix:lamp,pickup:index});coreParts.set(kind,entry);return;
    }
    const role=(object.material as THREE.Material).name;
    const parts=staticParts.get(role)??[];
    parts.push({geometry:object.geometry,matrix:world});staticParts.set(role,parts);
   });
  });
  for(const [role,parts] of staticParts){
   const material=materials.get(role);if(!material)throw Error('Missing power-kit atlas '+role);
   const mesh=new THREE.Mesh(mergeInto(parts),material);
   mesh.name='DI_POWER_'+role;mesh.receiveShadow=true;this.root.add(mesh);
  }
  for(const [kind,{geometry,parts}] of coreParts){
   const material=materials.get('DI_MAT_emissive')!.clone();
   material.name='DI_POWER_core_'+kind;material.emissiveMap=material.map;
   material.emissive.setRGB(1,1,1);material.vertexColors=true;
   // Charge is per instance. Apply it to emission as well as diffuse light.
   material.onBeforeCompile=shader=>{shader.fragmentShader=shader.fragmentShader.replace(
    '#include <emissivemap_fragment>','#include <emissivemap_fragment>\n#ifdef USE_COLOR\ntotalEmissiveRadiance*=vColor.rgb;\n#endif');};
   material.customProgramCacheKey=()=> 'dreamisland-power-core-v1';
   this.ownedMaterials.push(material);
   const mesh=new THREE.InstancedMesh(geometry,material,parts.length);
   mesh.name='DI_POWER_core_'+kind;mesh.frustumCulled=false;
   parts.forEach((part,i)=>mesh.setMatrixAt(i,part.matrix));
   this.cores.push({mesh,indices:parts.map(p=>p.pickup)});this.root.add(mesh);
  }
  for(const [kind,parts] of plateParts){
   const geometry=new THREE.BoxGeometry(2.8,.08,3.6),uv=geometry.attributes.uv;
   for(let i=0;i<uv.count;i++)uv.setXY(i,CELL.roadSand[0]+uv.getX(i)*CELL.roadSand[2],CELL.roadSand[1]+uv.getY(i)*CELL.roadSand[3]);
   const material=materials.get('DI_MAT_concrete')!.clone();
   material.name='DI_POWER_plate_'+kind;material.vertexColors=false;material.emissiveMap=material.map;
   material.emissive.setRGB(1,1,1);
   material.onBeforeCompile=shader=>{shader.fragmentShader=shader.fragmentShader.replace(
    '#include <emissivemap_fragment>','#include <emissivemap_fragment>\n#ifdef USE_COLOR\ntotalEmissiveRadiance*=vColor.rgb;\n#endif');};
   material.customProgramCacheKey=()=> 'dreamisland-power-plate-v1';
   this.ownedMaterials.push(material);
   const mesh=new THREE.InstancedMesh(geometry,material,parts.length);
   mesh.name='DI_POWER_plate_'+kind;mesh.frustumCulled=false;mesh.receiveShadow=true;
   mesh.userData.atlasCell='road-sand';mesh.userData.heightMetres=.08;
   parts.forEach((part,i)=>mesh.setMatrixAt(i,part.matrix));
   this.plates.push({mesh,indices:parts.map(p=>p.pickup)});this.root.add(mesh);
  }
  if(petalGeometry){
   const mesh=new THREE.InstancedMesh(petalGeometry,materials.get('DI_MAT_metal')!,this.hinges.length);
   mesh.name='DI_POWER_petals';mesh.frustumCulled=false;mesh.receiveShadow=true;
   this.petals=mesh;this.root.add(mesh);
  }
  tintedGeometry.forEach(geometry=>geometry.dispose());
  this.report.devices=DREAMISLAND_ABILITY_CONFIG.pickups.length;
  this.root.traverse(object=>{
   if(!(object instanceof THREE.Mesh))return;
   this.report.meshes++;
   this.report.triangles+=(object.geometry.index?.count??object.geometry.attributes.position.count)/3
    *(object instanceof THREE.InstancedMesh?object.count:1);
  });
  this.course.markers.count=this.course.deviceMarkerOffset;
  this.update(DREAMISLAND_ABILITY_CONFIG.pickups.map(()=>({available:true,charge:1})),0,0);
 }
 update(states:PickupState[],tick:number,nightBlend:number){
  states.forEach((state,i)=>{
   if(state.available)this.collectedAt.delete(i);
   else if(!this.collectedAt.has(i))this.collectedAt.set(i,tick);
  });
  for(const core of this.cores){
   const material=core.mesh.material as THREE.MeshLambertMaterial;
   material.emissiveIntensity=.35+nightBlend*.65;
   core.indices.forEach((index,i)=>{
    const state=states[index];
    const kind=DREAMISLAND_ABILITY_CONFIG.pickups[index].kind!;
    this.color.fromArray(colors[kind]).multiplyScalar(state.available?state.charge:0);
    core.mesh.setColorAt(i,this.color);
   });
   if(core.mesh.instanceColor)core.mesh.instanceColor.needsUpdate=true;
  }
  for(const plate of this.plates){
   const material=plate.mesh.material as THREE.MeshLambertMaterial;
   material.emissiveIntensity=.15+nightBlend*.65;
   plate.indices.forEach((index,i)=>{
    const state=states[index],kind=DREAMISLAND_ABILITY_CONFIG.pickups[index].kind;
    this.color.fromArray(kind==='surge'?colors.plateSurge:colors.plateShield);
    this.color.multiplyScalar(state.available?state.charge:0);
    plate.mesh.setColorAt(i,this.color);
   });
   if(plate.mesh.instanceColor)plate.mesh.instanceColor.needsUpdate=true;
  }
  this.hinges.forEach((hinge,i)=>{
   const collected=this.collectedAt.get(hinge.pickup);
   const amount=collected===undefined?0:THREE.MathUtils.clamp((tick-collected)/this.report.petalOpeningTicks,0,1);
   const eased=1-(1-amount)**3;
   this.matrix.multiplyMatrices(hinge.base,this.rotation.makeRotationZ(eased*.70));
   this.petals!.setMatrixAt(i,this.matrix);
  });
  if(this.petals)this.petals.instanceMatrix.needsUpdate=true;
 }
 reset(){this.collectedAt.clear();}
 dispose(){
  this.root.removeFromParent();
  this.root.traverse(object=>{if(object instanceof THREE.Mesh)object.geometry.dispose();});
  this.ownedMaterials.forEach(material=>material.dispose());this.kit.dispose();
 }
}
