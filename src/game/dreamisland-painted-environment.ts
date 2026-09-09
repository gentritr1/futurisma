import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import type {RaceEnvironment,RaceEnvironmentStats} from './environment';
import type {DreamIslandCourse} from './dreamisland-course';
import {applyDreamIslandCardCutout,dreamIslandFlowInstallations} from './dreamisland-materials';
import {DreamIslandSky} from './dreamisland-sky';
import {DreamIslandWater} from './dreamisland-water';

/**
 * Phase B replaces the procedural blockout with the painted GLB.
 *
 * `painted.glb` carries the island batched by material, so the whole island is
 * one draw per role. The road ribbon, the kerbs and the marker instances stay
 * exactly where phase A put them - same geometry, same two draws - and are
 * re-skinned onto the concrete and metal atlases the GLB already carries, so
 * the re-skin costs no extra download and no extra draw.
 *
 * `painted.json` is FETCHED, never imported: a static import would put the
 * manifest in the JS bundle, and `validate-build.mjs` leaves 2.2 KiB of gzip
 * headroom for the whole map. It is used, not decorative - `manifest` below
 * feeds the diagnostics counters, so a silent no-op reads as zero rather than
 * as a green soak.
 */
export class DreamIslandPaintedEnvironment implements RaceEnvironment {
 readonly stats:RaceEnvironmentStats={meshes:0,triangles:0,materials:0,textures:0,visibleGroups:0,
  visibleTriangles:0,shaderModel:'lambert',signageSource:'baked',contractDrift:[]};
 /** Every counter here reads zero if the module quietly did nothing. */
 readonly counters={paintedMeshes:0,paintedTriangles:0,manifestTriangles:0,emissiveMaterials:0,
  cardMaterials:0,fishMeshes:0,fishVisible:0,reskinnedCourseDraws:0,waterSurfaces:0,waterTriangles:0,
  skyPanoramas:0,flowShaders:0};
 private readonly sky=new DreamIslandSky();
 private readonly water:DreamIslandWater;
 private readonly meshes:THREE.Mesh[]=[];
 private readonly emissive:THREE.MeshLambertMaterial[]=[];
 private readonly fish:THREE.Mesh[]=[];
 private readonly frustum=new THREE.Frustum();
 private readonly projection=new THREE.Matrix4();
 private constructor(readonly root:THREE.Group,private readonly course:DreamIslandCourse,
  manifest:{triangles?:number;meshes?:number}){
  root.name='dreamisland_painted_world';
  const converted=new Map<THREE.Material,THREE.MeshLambertMaterial>(),textures=new Set<THREE.Texture>();
  const byRole=new Map<string,THREE.MeshLambertMaterial>();
  root.traverse(object=>{
   if(!(object instanceof THREE.Mesh))return;
   const source=object.material as THREE.MeshStandardMaterial;
   let material=converted.get(source);
   if(!material){
    material=new THREE.MeshLambertMaterial({name:source.name,color:source.color,map:source.map,
     emissive:source.emissive,emissiveMap:source.emissiveMap,emissiveIntensity:source.emissiveIntensity,
     vertexColors:!!object.geometry.attributes.color,side:THREE.DoubleSide});
    applyDreamIslandCardCutout(material);
    converted.set(source,material);byRole.set(source.name,material);
    // An atlas plus mipmaps is a trap: past mip level 8 a 1024 sheet's levels
    // average ACROSS the quadrant boundaries, so at a grazing angle the sand
    // road sampled the whole concrete sheet - moss, kerb cyan and all - and came
    // back teal. The .004 UV inset only covers bilinear bleed, not that.
    // Anisotropic filtering is what keeps the chosen mip low enough at the
    // angles a road is actually seen at.
    for(const texture of [source.map,source.emissiveMap]){
     if(!texture)continue;
     texture.anisotropy=Math.max(texture.anisotropy,16);texture.needsUpdate=true;
    }
    if(source.map)textures.add(source.map);
    if(material.name.endsWith('jungle-card'))this.counters.cardMaterials++;
    // The glow is driven by nightBlend every frame, so it starts dark.
    if(material.emissiveMap){material.emissiveIntensity=0;this.emissive.push(material);this.counters.emissiveMaterials++;}
   }
   object.material=material;object.castShadow=false;object.receiveShadow=false;
   object.geometry.computeBoundingSphere();
   this.meshes.push(object);
   // The shoal rests in the basin until `fish-rise`; it batches on its own so
   // one `visible = false` hides all four liveries.
   if(object.name.startsWith('DI_FISH_')){this.fish.push(object);object.visible=false;this.counters.fishMeshes++;}
  });
  for(const mesh of this.meshes){
   this.stats.triangles+=(mesh.geometry.index?.count??mesh.geometry.attributes.position.count)/3;
  }
  this.stats.meshes=this.meshes.length;this.stats.materials=converted.size;this.stats.textures=textures.size;
  this.counters.paintedMeshes=this.meshes.length;this.counters.paintedTriangles=this.stats.triangles;
  this.counters.manifestTriangles=manifest.triangles??0;
  // The road and the markers keep their phase-A draws and take the GLB's own
  // concrete and metal maps, so nothing new is downloaded for them.
  const concrete=byRole.get('DI_MAT_concrete')?.map,metal=byRole.get('DI_MAT_metal')?.map;
  if(concrete&&metal)this.counters.reskinnedCourseDraws=course.applyPaintedAtlases(concrete,metal);
  this.water=new DreamIslandWater(course);
  this.counters.waterSurfaces=this.water.surfaces;
  this.counters.waterTriangles=this.water.triangles;
  root.add(this.sky.root,this.water.root);
  // The acceptance rule for this phase is that a module which silently no-ops
  // must READ ZERO somewhere, because a green soak cannot tell the difference:
  // decoration is non-interactive, so lap times and p95 are identical with the
  // art loaded and with it missing. The counters ride out on the course group,
  // which is what `dreamisland-runtime.ts` already publishes diagnostics from.
  course.group.userData.paintedCounters=this.counters;
  if(manifest.meshes&&manifest.meshes!==this.counters.paintedMeshes){
   this.stats.contractDrift.push(`painted.json declares ${manifest.meshes} meshes; the GLB carries ${this.counters.paintedMeshes}`);
  }
 }
 static async load(course:DreamIslandCourse):Promise<DreamIslandPaintedEnvironment>{
  const [gltf,manifest]=await Promise.all([
   new GLTFLoader().loadAsync('/assets/dreamisland/painted.glb'),
   fetch('/assets/dreamisland/painted.json').then(response=>response.json()).catch(()=>({})),
  ]);
  const environment=new DreamIslandPaintedEnvironment(gltf.scene as THREE.Group,course,manifest);
  await Promise.all([environment.sky.ready,environment.water.ready]);
  environment.counters.skyPanoramas=environment.sky.loadedPanoramas;
  return environment;
 }
 updateVisibility(camera:THREE.Camera){
  camera.updateMatrixWorld(true);
  const blend=this.course.nightBlend,reduced=this.course.reducedMotion;
  this.sky.update(camera,this.root.parent instanceof THREE.Scene?this.root.parent.fog?.color:undefined,blend);
  this.water.update(this.course.tide.elapsed,blend,reduced);
  for(const material of this.emissive)material.emissiveIntensity=blend*1.25;
  const risen=this.course.schedule.state.fishRisen;
  for(const mesh of this.fish)mesh.visible=risen;
  this.counters.fishVisible=risen?this.fish.length:0;
  this.counters.flowShaders=dreamIslandFlowInstallations();
  this.frustum.setFromProjectionMatrix(this.projection.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse));
  this.stats.visibleGroups=0;this.stats.visibleTriangles=0;
  for(const mesh of this.meshes){
   if(!mesh.visible||!this.frustum.intersectsObject(mesh))continue;
   this.stats.visibleGroups++;
   this.stats.visibleTriangles+=(mesh.geometry.index?.count??mesh.geometry.attributes.position.count)/3;
  }
 }
}
