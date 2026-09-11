import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import type {RaceEnvironment,RaceEnvironmentStats} from './environment';
import type {DreamIslandCourse} from './dreamisland-course';
import {applyDreamIslandCardCutout,dreamIslandFlowInstallations,CELL} from './dreamisland-materials';
import {loadDreamIslandHeroes,type HeroBuild,type HeroPlacement} from './dreamisland-heroes';
import {DreamIslandShoals} from './dreamisland-fish';
import {DreamIslandSky} from './dreamisland-sky';
import {DreamIslandWater} from './dreamisland-water';

/**
 * Phase B replaces the procedural blockout with the painted GLB.
 *
 * `painted.glb` carries the island batched by material, so the whole island is
 * one draw per role. The road centre and marker instances keep their authored placement.
 * The polish kerb expands outward in the existing road buffers; both draws are
 * re-skinned onto the concrete and metal atlases the GLB already carries, so
 * the re-skin costs no extra download and no extra draw.
 *
 * `painted.json` is FETCHED, never imported: a static import would put the
 * manifest in the initial JS bundle, which `validate-build.mjs` guards. It is used, not decorative - `manifest` below
 * feeds the diagnostics counters, so a silent no-op reads as zero rather than
 * as a green soak.
 *
 * Phase C adds two things on top of that world:
 *
 *  * THE HEROES. Four focal assets are no longer inside `painted.glb`; they are
 *    separate GLBs placed from the same `painted.json` placement list, merged by
 *    material at load and bound to the materials this class already built. See
 *    `dreamisland-heroes.ts`.
 *  * THE SHOALS. The goldfish are batched into named shoals rather than one
 *    heap, and each shoal is translated along an authored closed path in ROUTE
 *    space, so "at least six metres above the deck" is a property of the
 *    authored data rather than something to hope for. See
 *    `dreamisland-fish.ts`.
 */
export class DreamIslandPaintedEnvironment implements RaceEnvironment {
 readonly stats:RaceEnvironmentStats={meshes:0,triangles:0,materials:0,textures:0,visibleGroups:0,
  visibleTriangles:0,shaderModel:'lambert',signageSource:'baked',contractDrift:[]};
 /** Every counter here reads zero if the module quietly did nothing. */
 readonly counters={paintedMeshes:0,paintedTriangles:0,manifestTriangles:0,emissiveMaterials:0,
  cardMaterials:0,fishMeshes:0,fishVisible:0,reskinnedCourseDraws:0,waterSurfaces:0,waterTriangles:0,
  skyPanoramas:0,flowShaders:0,waterfallFlowShaders:0,heroPlacements:0,heroSourceMeshes:0,heroMeshes:0,heroTriangles:0,
  fishShoals:0,fishShoalMeshes:0,fishDeckSamples:0,
  /** Metres, over the whole race. `null` until a shoal has actually been over
   * the deck, so a race that never saw one reads as unmeasured rather than as
   * a comfortable number. */
  fishMinimumDeckClearance:null as number|null};
 /** What the hero merge actually did, so the phase report quotes a measurement
  * instead of restating the brief. Null until `attachHeroes` has run. */
 heroReport:HeroBuild['report']|null=null;
 private readonly sky=new DreamIslandSky();
 private readonly water:DreamIslandWater;
 private readonly meshes:THREE.Mesh[]=[];
 private readonly emissive:THREE.MeshLambertMaterial[]=[];
 private readonly tunnelLights:THREE.PointLight[]=[];
 private readonly nightFill=new THREE.HemisphereLight(
  new THREE.Color().setRGB(.3,.18,.035),new THREE.Color().setRGB(.15,.09,.0175),0);
 private readonly nightFogLift=new THREE.Color(0x152e4a).sub(new THREE.Color(0x0b1524));
 private readonly waterfallTime={value:0};
 private readonly kerbGlow={value:0};
 private waterfallMaterial:THREE.MeshLambertMaterial|null=null;
 private waterfallOverlay:THREE.MeshLambertMaterial|null=null;
 private readonly fish:THREE.Mesh[]=[];
 private shoals:DreamIslandShoals|null=null;
 private readonly byRole=new Map<string,THREE.MeshLambertMaterial>();
 private readonly frustum=new THREE.Frustum();
 private readonly projection=new THREE.Matrix4();
 private constructor(readonly root:THREE.Group,private readonly course:DreamIslandCourse,
  manifest:{triangles?:number;meshes?:number}){
  root.name='dreamisland_painted_world';
  const converted=new Map<THREE.Material,THREE.MeshLambertMaterial>(),textures=new Set<THREE.Texture>();
  root.traverse(object=>{
   if(!(object instanceof THREE.Mesh))return;
   const source=object.material as THREE.MeshStandardMaterial;
   let material=converted.get(source);
   if(!material){
    material=new THREE.MeshLambertMaterial({name:source.name,color:source.color,map:source.map,
     emissive:source.emissive,emissiveMap:source.emissiveMap,emissiveIntensity:source.emissiveIntensity,
     vertexColors:!!object.geometry.attributes.color,side:THREE.DoubleSide});
    applyDreamIslandCardCutout(material);
    if(material.name.endsWith('jungle-card')){
     // Opaque keyed fronds and the low-alpha road shade share one draw. The
     // decal's alpha is authored per vertex; depth writes retain solid leaves.
     material.transparent=true;material.forceSinglePass=true;
    }
    if(material.name==='DI_MAT_signage'){
     material.onBeforeCompile=shader=>{
      shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',`#include <map_fragment>
       float diInk=smoothstep(.10,.45,dot(sampledDiffuseColor.rgb,vec3(.2126,.7152,.0722)));
       diffuseColor.rgb*=mix(.10,1.80,diInk);`);
     };
     material.customProgramCacheKey=()=> 'dreamisland-signage-contrast-v2';
    }
    converted.set(source,material);this.byRole.set(source.name,material);
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
   // Each shoal batches on its own so it can be moved as one whole-mesh
   // transform; `visible = false` on all of them hides the lot.
   if(object.name.startsWith('DI_FISH')){this.fish.push(object);object.visible=false;this.counters.fishMeshes++;}
  });
  for(const mesh of this.meshes){
   this.stats.triangles+=(mesh.geometry.index?.count??mesh.geometry.attributes.position.count)/3;
  }
  this.stats.meshes=this.meshes.length;this.stats.materials=converted.size;this.stats.textures=textures.size;
  this.counters.paintedMeshes=this.meshes.length;this.counters.paintedTriangles=this.stats.triangles;
  this.counters.manifestTriangles=manifest.triangles??0;
  // The road and the markers keep their phase-A draws and take the GLB's own
  // concrete and metal maps, so nothing new is downloaded for them.
  const concrete=this.byRole.get('DI_MAT_concrete')?.map,metal=this.byRole.get('DI_MAT_metal')?.map;
  if(concrete&&metal)this.counters.reskinnedCourseDraws=course.applyPaintedAtlases(concrete,metal);
  this.shapeKerbs();
  this.water=new DreamIslandWater(course);
  this.counters.waterSurfaces=this.water.surfaces;
  this.counters.waterTriangles=this.water.triangles;
  root.add(this.sky.root,this.water.root);
  this.nightFill.name='dreamisland_night_ground_fill';root.add(this.nightFill);
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
 /** Expand the visual kerb outward, keeping its inner contact edge fixed.
  * The course still owns the route and collision boundary. Reuse its buffers
  * so the top, lip and continuous stripe remain in the existing road draw. */
 private shapeKerbs():void{
  const road=this.course.group.getObjectByName('dreamisland_blockout_road') as THREE.Mesh;
  road.receiveShadow=true;
  const geometry=road.geometry,p=geometry.attributes.position,uv=geometry.attributes.uv;
  let first=0;
  while(first<uv.count&&uv.getY(first)<CELL.kerbCyan[1]-.0001)first++;
  // Neutral stone-sand calibration: road-trials measured day chroma and
  // night luma at the pinned BEACH pose before this vertex tint was selected.
  const colors=geometry.attributes.color;
  for(let i=0;i<first;i++)colors.setXYZ(i,.42,.53,1);
  colors.needsUpdate=true;
  const point=new THREE.Vector3(),offset=new THREE.Vector3();
  for(let base=first,box=0;base<p.count;base+=24,box++){
   const sample=this.course.sampleAtDistance(Math.floor(box/2)*7),side=box%2?1:-1;
   const local:THREE.Vector3[]=[];
   for(let i=0;i<24;i++){
    offset.fromBufferAttribute(p,base+i).sub(sample.position);
    local.push(new THREE.Vector3(offset.dot(sample.right)*side,offset.dot(sample.up),offset.dot(sample.tangent)));
   }
   const min=new THREE.Vector3(Infinity,Infinity,Infinity),max=new THREE.Vector3(-Infinity,-Infinity,-Infinity);
   for(const v of local){min.min(v);max.max(v);}
   for(let i=0;i<24;i++){
    const v=local[i],s=(v.x-min.x)/(max.x-min.x),height=(v.y-min.y)/(max.y-min.y);
    point.copy(sample.position).addScaledVector(sample.right,side*(min.x+s*1.2))
     .addScaledVector(sample.up,min.y+height*.72).addScaledVector(sample.tangent,v.z);
    p.setXYZ(base+i,point.x,point.y,point.z);
    const face=local.slice(Math.floor(i/4)*4,Math.floor(i/4)*4+4);
    const horizontal=face.every(q=>Math.abs(q.y-v.y)<.001);
    uv.setXY(base+i,CELL.kerbCyan[0]+CELL.kerbCyan[2]*(horizontal?s:height),
     CELL.kerbCyan[1]+CELL.kerbCyan[3]*(v.z-min.z)/(max.z-min.z));
   }
   // The route tangent reverses the authored box's Z axis. Correct inward
   // winding from actual face normals, otherwise its top receives ground light.
   const center=sample.position.clone().addScaledVector(sample.right,side*(min.x+.6))
    .addScaledVector(sample.up,min.y+.36).addScaledVector(sample.tangent,(min.z+max.z)/2);
   const indices=geometry.index!,a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3();
   for(let i=first/4*6+box*36;i<first/4*6+(box+1)*36;i+=3){
    a.fromBufferAttribute(p,indices.getX(i));b.fromBufferAttribute(p,indices.getX(i+1));c.fromBufferAttribute(p,indices.getX(i+2));
    const outward=a.clone().add(b).add(c).multiplyScalar(1/3).sub(center);
    if(b.sub(a).cross(c.sub(a)).dot(outward)<0){const second=indices.getX(i+1);indices.setX(i+1,indices.getX(i+2));indices.setX(i+2,second);}
   }
  }
  p.needsUpdate=true;uv.needsUpdate=true;geometry.index!.needsUpdate=true;geometry.computeVertexNormals();geometry.computeBoundingSphere();
  road.userData.polishKerb={boxes:(p.count-first)/24,widthMetres:1.2,heightMetres:.72,innerEdgePreserved:true};
  const material=road.material as THREE.MeshLambertMaterial;
  material.onBeforeCompile=shader=>{
   shader.uniforms.diKerbGlow=this.kerbGlow;
   shader.fragmentShader='uniform float diKerbGlow;\n'+shader.fragmentShader
    .replace('#include <emissivemap_fragment>',`#include <emissivemap_fragment>
     // Restrict the cue to the cyan texels of the kerb quadrant. Stone lips
     // and road pavement retain their ordinary shared lighting.
     float diStripe=step(.504,vMapUv.y)*step(vMapUv.x,.496)
       *smoothstep(.02,.08,min(sampledDiffuseColor.g,sampledDiffuseColor.b)-sampledDiffuseColor.r);
     totalEmissiveRadiance+=diStripe*diKerbGlow*sampledDiffuseColor.rgb;`);
  };
  material.customProgramCacheKey=()=> 'dreamisland-kerb-glow-v2';material.needsUpdate=true;
 }
 /** The shoals need the fish meshes converted and hidden first, which the
  * constructor has just done, and they re-origin those meshes' buffers, which
  * has to happen once and before anything reads a bounding sphere. */
 private buildShoals():void{
  this.shoals=new DreamIslandShoals(this.course,this.fish);
  this.counters.fishShoals=this.shoals.shoals.length;
  // Deliberately a SECOND count. `fishMeshes` is what the GLB carried; this is
  // what the paths file claimed. They differ only if a shoal's batch name and
  // its meshes have drifted apart, which is exactly the silent failure a single
  // number would hide.
  this.counters.fishShoalMeshes=this.shoals.meshCount;
 }
 /**
  * The four hero GLBs, merged by material and bound to the materials above.
  * Runs after the constructor because it needs those materials to exist; a
  * placement list with no `batch: "HERO"` rows leaves every counter at zero,
  * which is what a silent no-op has to look like.
  */
 private async attachHeroes(placements:HeroPlacement[]):Promise<void>{
  const built=await loadDreamIslandHeroes(placements,this.byRole,material=>{
   applyDreamIslandCardCutout(material);
   if(material.emissiveMap){material.emissiveIntensity=0;this.emissive.push(material);this.counters.emissiveMaterials++;}
   this.stats.materials+=1;
  });
  this.heroReport=built.report;
  for(const mesh of built.meshes){this.root.add(mesh);this.meshes.push(mesh);}
  this.counters.heroPlacements=built.report.placements;
  this.counters.heroSourceMeshes=built.report.sourceMeshes;
  this.counters.heroMeshes=built.report.mergedMeshes;
  this.counters.heroTriangles=built.report.triangles;
  this.stats.meshes=this.meshes.length;
  this.stats.triangles+=built.report.triangles;
  const waterfall=built.meshes.find(m=>m.name==='DI_HERO_waterfall-cliff_DI_MAT_water');
  if(waterfall){
   const material=waterfall.material as THREE.MeshLambertMaterial;
   material.emissive.set(0x8ddae8);material.emissiveMap=material.map;
   material.onBeforeCompile=shader=>{
    shader.uniforms.diFallTime=this.waterfallTime;
    // Foam occupies BL, the sheets BR. Scroll only sheet V, inside its cell;
    // both retain the stock texture decode, Lambert light, fog and AgX path.
    const uv='vec2 diFallUv=vMapUv;if(diFallUv.x>.5)diFallUv.y=.504+.492*fract((diFallUv.y-.504)/.492+diFallTime*.18);\n';
    shader.fragmentShader='uniform float diFallTime;\n'+shader.fragmentShader
     .replace('#include <map_fragment>',uv+THREE.ShaderChunk.map_fragment.replaceAll('vMapUv','diFallUv'))
     .replace('#include <emissivemap_fragment>',THREE.ShaderChunk.emissivemap_fragment.replaceAll('vEmissiveMapUv','diFallUv'));
    this.counters.waterfallFlowShaders++;
   };
   material.customProgramCacheKey=()=> 'dreamisland-waterfall-flow-v1';material.needsUpdate=true;
   material.userData.diFallTime=this.waterfallTime;
   this.waterfallMaterial=material;
   this.counters.emissiveMaterials++;
  }
  const overlay=built.meshes.find(m=>m.name==='DI_HERO_waterfall-cliff_DI_MAT_water-overlay');
  if(overlay){
   const material=overlay.material as THREE.MeshLambertMaterial;
   material.transparent=true;material.forceSinglePass=true;material.depthWrite=false;
   material.emissive.setRGB(.25,.65,.75);
   material.emissiveMap=this.byRole.get('DI_MAT_emissive')!.map;
   material.onBeforeCompile=shader=>{
    shader.uniforms.diFallTime=this.waterfallTime;
    shader.fragmentShader='uniform float diFallTime;\n'+shader.fragmentShader
     .replace('#include <map_fragment>',`vec2 diFastUv=vMapUv;
      bool diMist=vMapUv.x<.5;
      if(!diMist)diFastUv.y=.504+.492*fract((diFastUv.y-.504)/.492+diFallTime*.37);
      vec4 sampledDiffuseColor=diMist?texture2D(emissiveMap,diFastUv):texture2D(map,diFastUv);
      if(diMist){float lamp=dot(sampledDiffuseColor.rgb,vec3(.2126,.7152,.0722));
       sampledDiffuseColor.rgb=vec3(lamp);diffuseColor.a*=smoothstep(.05,.7,lamp);}
      diffuseColor*=sampledDiffuseColor;`)
     .replace('#include <emissivemap_fragment>',`totalEmissiveRadiance*=sampledDiffuseColor.rgb;`);
    this.counters.waterfallFlowShaders++;
   };
   material.customProgramCacheKey=()=> 'dreamisland-waterfall-overlay-v1';
   material.userData.diFallTime=this.waterfallTime;
   material.needsUpdate=true;this.waterfallOverlay=material;
  }
  const tower=placements.find(p=>p.asset==='watchtower-ruin');
  if(tower){
   const scale=tower.hero?.heroScale??tower.scale;
   const transform=new THREE.Matrix4().compose(new THREE.Vector3(...tower.position),
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),tower.yaw),new THREE.Vector3(scale,scale,scale));
   for(const side of [-1,1]){
    const light=new THREE.PointLight(0xffe8ab,0,38,2);
    light.name='dreamisland_tunnel_lamp_'+side;
    light.position.set(side*6.6,6,0).applyMatrix4(transform);
    this.root.add(light);this.tunnelLights.push(light);
   }
  }
  if(built.report.missingChildren.length){
   this.stats.contractDrift.push('hero set children missing: '+built.report.missingChildren.join(', '));
  }
 }
 static async load(course:DreamIslandCourse):Promise<DreamIslandPaintedEnvironment>{
  const [gltf,manifest]=await Promise.all([
   new GLTFLoader().loadAsync('/assets/dreamisland/painted.glb'),
   fetch('/assets/dreamisland/painted.json').then(response=>response.json()).catch(()=>({})),
  ]);
  const environment=new DreamIslandPaintedEnvironment(gltf.scene as THREE.Group,course,manifest);
  environment.buildShoals();
  await Promise.all([environment.sky.ready,environment.water.ready,
   environment.attachHeroes((manifest.placements??[]) as HeroPlacement[])]);
  environment.counters.skyPanoramas=environment.sky.loadedPanoramas;
  return environment;
 }
 updateVisibility(camera:THREE.Camera){
  camera.updateMatrixWorld(true);
  const blend=this.course.nightBlend,reduced=this.course.reducedMotion;
  this.kerbGlow.value=blend*.12; // BEACH calibration: the 0.6 trial outshone the foam.
  this.nightFill.intensity=blend*.5;
  const fog=this.root.parent instanceof THREE.Scene?this.root.parent.fog:undefined;
  if(fog){
   // Start from the course profile every frame so the lift cannot accumulate
   // through the atmosphere's exponential tracking. All objects use this fog.
   fog.color.copy(this.course.fogAt(0).color);
   fog.color.r+=this.nightFogLift.r*blend;
   fog.color.g+=this.nightFogLift.g*blend;
   fog.color.b+=this.nightFogLift.b*blend;
  }
  this.sky.update(camera,this.root.parent instanceof THREE.Scene?this.root.parent.fog?.color:undefined,blend);
  this.water.update(this.course.tide.elapsed,blend,reduced);
  for(const material of this.emissive)material.emissiveIntensity=blend*1.25;
  for(const light of this.tunnelLights)light.intensity=blend*1100;
  this.waterfallTime.value=reduced?0:this.course.tide.elapsed;
  if(this.waterfallMaterial)this.waterfallMaterial.emissiveIntensity=blend*.7;
  if(this.waterfallOverlay)this.waterfallOverlay.emissiveIntensity=blend*.7;
  // Decision 3 and decision 6 both live here: the shoals drift on authored
  // closed paths from `fish-rise`, and under reduced motion they never spawn.
  this.shoals?.update(this.course.schedule.tick,this.course.schedule.config?.fishRiseTick??null,reduced);
  this.counters.fishVisible=this.shoals?.visibleMeshes??0;
  this.counters.fishDeckSamples=this.shoals?.deckSamples??0;
  this.counters.fishMinimumDeckClearance=this.shoals&&this.shoals.deckSamples>0
   ?Math.round(this.shoals.minimumDeckClearance*1000)/1000:null;
  this.counters.flowShaders=dreamIslandFlowInstallations()+this.counters.waterfallFlowShaders;
  this.frustum.setFromProjectionMatrix(this.projection.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse));
  this.stats.visibleGroups=0;this.stats.visibleTriangles=0;
  for(const mesh of this.meshes){
   if(!mesh.visible||!this.frustum.intersectsObject(mesh))continue;
   this.stats.visibleGroups++;
   this.stats.visibleTriangles+=(mesh.geometry.index?.count??mesh.geometry.attributes.position.count)/3;
  }
 }
}
