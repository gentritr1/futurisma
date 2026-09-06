import * as THREE from 'three';
import type {AscensionCourse} from './ascension-course';
import {AscensionEffects} from './ascension-effects';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import type {RaceEnvironment,RaceEnvironmentStats} from './environment';
import {applyAscensionOrganicCutout} from './ascension-materials';
import {mergeAscensionStaticPaint} from './ascension-static-paint';
import {instanceAscensionProps} from './ascension-instance-lamps';
import {AscensionMangroves} from './ascension-mangroves';
import {AscensionTerrain} from './ascension-terrain';
import {AscensionSky} from './ascension-sky';
/** Painted authored geometry, with moving roots preserved for the event phase. */
export class AscensionPaintedEnvironment implements RaceEnvironment {
 readonly stats:RaceEnvironmentStats={meshes:0,triangles:0,materials:0,textures:0,visibleGroups:0,visibleTriangles:0,shaderModel:'lambert',signageSource:'baked',contractDrift:[]};
 private readonly effects:AscensionEffects|null;
 private readonly terrain=new AscensionTerrain();
 private readonly updateInstances:(camera:THREE.Camera)=>void;
 private readonly sky=new AscensionSky();
 private readonly mangroves=new AscensionMangroves();
 private readonly meshes:THREE.Mesh[]=[];
 private readonly frustum=new THREE.Frustum();
 private constructor(readonly root:THREE.Group,course?:AscensionCourse){
  this.updateInstances=instanceAscensionProps(root);
  const materials=new Map<THREE.Material,THREE.MeshLambertMaterial>(),textures=new Set<THREE.Texture>();
  root.traverse(object=>{if(!(object instanceof THREE.Mesh))return;
   const source=object.material as THREE.MeshStandardMaterial;
   let material=materials.get(source);
   if(!material){material=new THREE.MeshLambertMaterial({name:source.name,color:source.color,map:source.map,emissive:source.emissive,emissiveMap:source.emissiveMap,emissiveIntensity:source.emissiveIntensity,vertexColors:!!object.geometry.attributes.color,side:THREE.DoubleSide});applyAscensionOrganicCutout(material);materials.set(source,material);if(source.map)textures.add(source.map);}
   object.material=material;object.geometry.computeBoundingSphere();this.meshes.push(object);this.stats.triangles+=(object.geometry.index?.count??object.geometry.attributes.position.count)/3;
  });mergeAscensionStaticPaint(root);this.meshes.length=0;this.stats.triangles=0;
  root.traverse(o=>{if(o instanceof THREE.Mesh){this.meshes.push(o);this.stats.triangles+=(o.geometry.index?.count??o.geometry.attributes.position.count)/3;}});this.stats.meshes=this.meshes.length;this.stats.materials=materials.size;this.stats.textures=textures.size;root.add(this.sky.root,this.mangroves.root,this.terrain.root);
  this.effects=course?.schedule.config?new AscensionEffects(root,course):null;if(this.effects)root.add(this.effects.root);
 }
 static async load(course?:AscensionCourse){const environment=new AscensionPaintedEnvironment((await new GLTFLoader().loadAsync('/assets/ascension/painted.glb')).scene,course);await Promise.all([environment.sky.ready,environment.mangroves.ready,environment.terrain.ready,environment.effects?.ready]);return environment;}
 updateVisibility(camera:THREE.Camera){
  camera.updateMatrixWorld(true);this.effects?.update(camera);this.root.updateMatrixWorld(true);this.updateInstances(camera);this.mangroves.update(camera);this.terrain.update();
  this.sky.update(camera,this.root.parent instanceof THREE.Scene?this.root.parent.fog?.color:undefined);
  this.frustum.setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse));
  this.stats.visibleGroups=0;this.stats.visibleTriangles=0;
  for(const mesh of this.meshes)if(this.frustum.intersectsObject(mesh)){this.stats.visibleGroups++;this.stats.visibleTriangles+=(mesh.geometry.index?.count??mesh.geometry.attributes.position.count)/3;}
 }
}
