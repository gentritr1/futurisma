import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {TidelineCourse} from '../game/tideline-course';
import {TidelineWorld} from '../game/tideline-world';
import {TidelinePowerField} from '../game/tideline-power-field';
import {PowerKit} from '../game/power-kit';
import {applyTidelineRenderRule,auditTidelineGameplayMaterials} from '../game/tideline-render-rule';
const renderer=new THREE.WebGLRenderer({canvas:document.getElementById('canvas') as HTMLCanvasElement,antialias:true});renderer.setSize(1280,720);renderer.setPixelRatio(1);renderer.toneMapping=THREE.AgXToneMapping;renderer.toneMappingExposure=1.04;
const scene=new THREE.Scene(),course=new TidelineCourse(),world=new TidelineWorld(course);await world.ready;course.setLapBoard(3);course.advanceTide(8);world.update(8,false,[],.035,3868938316,1);world.root.updateMatrixWorld(true);course.group.updateMatrixWorld(true);
const kit=await PowerKit.load(true);const raw=(await new GLTFLoader().loadAsync('/assets/tideline-foundry/tidal-pump-gantry.glb')).scene;
raw.traverse(o=>{if(o instanceof THREE.Mesh){const m=o.material as THREE.MeshStandardMaterial;o.material=new THREE.MeshLambertMaterial({name:m.name,map:m.map,color:m.color,vertexColors:m.vertexColors,emissive:m.emissive,emissiveMap:m.emissiveMap,emissiveIntensity:m.emissiveIntensity,side:m.side});}});
const bounds=new THREE.Box3().setFromObject(raw),centre=bounds.getCenter(new THREE.Vector3());raw.position.set(-22-centre.x,-bounds.min.y,-centre.z);scene.add(raw);
const query=new URLSearchParams(location.search),kind=query.get('kind')??'cradle';let source:THREE.Object3D;let station:number|null=null;
if(kind==='cradle')source=world.devices.cradles[0].root;
else if(kind==='surge'||kind==='shield'){const device=kit.createPickupVisual(kind);device.update(8,false,1,1);source=device.root;}
else if(kind==='strip'){source=world.signals.strips[0].root;station=world.signals.strips[0].from;}
else if(kind==='launch-marker'||kind==='current-marker'){
 source=world.signals.root.getObjectByName('tideline_physical_road_identifiers')!;const index=kind==='launch-marker'?0:4;station=kind==='launch-marker'?.036:.025;
 for(const child of source.children)if(child instanceof THREE.Mesh){child.geometry=child.geometry.clone();const count=child.name.includes('plates')?6:180;child.geometry.setDrawRange(index*count,count);}
}
else if(kind==='lane'){
 source=world.signals.currents[0].root;station=.025;
 // One actual six-metre authored module, so distant route repeats cannot
 // project into the foreground of the comparison bay.
 for(const child of source.children)if(child instanceof THREE.Mesh){
  if(child instanceof THREE.InstancedMesh)child.count=child.name.includes('bubbles')?2:1;
  else {child.geometry=child.geometry.clone();child.geometry.setDrawRange(0,child.name==='submerged_cable_tray'?252:6);}
 }
}
else if(kind==='bulkhead')source=world.bulkheads.doors[0].root;
else if(kind==='dome'){const field=new TidelinePowerField();field.update(8,false,false,true,true);source=field.root;}
else {source=course.group.children.find(o=>o instanceof THREE.InstancedMesh)!.clone();(source as THREE.InstancedMesh).count=2;station=0;}
const specimen=new THREE.Group();scene.add(specimen);specimen.add(source);source.visible=true;
if(station!==null){const s=course.sample(station);specimen.matrixAutoUpdate=false;specimen.matrix.copy(new THREE.Matrix4().makeBasis(s.right,s.up,s.tangent.clone().negate()).setPosition(s.position).invert());specimen.matrix.premultiply(new THREE.Matrix4().makeTranslation(kind==='lane'?7:1,0,0));}
else {source.position.set(1,kind==='bulkhead'?1.85:0,0);source.quaternion.identity();}
const floor=new THREE.Mesh(new THREE.PlaneGeometry(1500,1500),new THREE.MeshLambertMaterial({map:(raw.children.find(o=>o instanceof THREE.Mesh) as THREE.Mesh)?.material instanceof THREE.MeshLambertMaterial?((raw.children.find(o=>o instanceof THREE.Mesh) as THREE.Mesh).material as THREE.MeshLambertMaterial).map:null,color:0x6f7168}));floor.rotation.x=-Math.PI/2;floor.position.y=-.09;scene.add(floor);
const profile=course.lightingAt(.40);scene.add(new THREE.HemisphereLight(profile.sky,profile.ground,profile.hemisphereIntensity*.88));const key=new THREE.DirectionalLight(profile.key,profile.keyIntensity);key.position.copy(profile.keyDirection).multiplyScalar(100);scene.add(key);
for(const x of [-35,-10,10,30]){const lamp=new THREE.PointLight(0xffbc75,500,42,2);lamp.position.set(x,9,5);scene.add(lamp);}
const fog=course.fogAt(.80);scene.fog=new THREE.FogExp2(fog.color,fog.density);scene.background=fog.color;
const camera=new THREE.PerspectiveCamera(20,1280/720,.1,1800);
const sync=applyTidelineRenderRule(specimen);sync();const walk=auditTidelineGameplayMaterials(scene);
Object.assign(window,{fogReview:{render(distance:number){camera.position.set(0,6.4,distance);camera.lookAt(0,3,0);camera.updateMatrixWorld();renderer.render(scene,camera);return {kind,distance,fogDensity:fog.density,materials:walk};}}});
document.getElementById('state')!.textContent='ready';
