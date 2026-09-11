import * as THREE from "three";
import contract from "../../public/assets/tideline/manifest.json";
import {assertTidelineContract} from "./tideline-contract";
import type { TidelineCourse } from "./tideline-course";
import route from "./data/tideline/route.json";
import type { RaceEnvironment, RaceEnvironmentStats } from "./environment";
import { disposeObject3DResources } from "./graphics-resources";
import { NeonEnvironment } from "./neon-environment";
import { resolveReducedMotion } from "./query-probes";
import { installTideSurface, type TideUniforms } from "./tideline-materials";
import { chamberGeometry, chamberWaterMask, chamberFrames } from "./tideline-chamber";
import { lampDecals, exteriorParticles, exteriorLightShafts } from "./tideline-effects";
import { TIDELINE_FLARE_DIRECTION } from "./tideline-sky";
import { TidelineQuayGauges } from "./tideline-quay-gauges";
import { TidelineMotion } from "./tideline-motion";

/** Dry racing chamber within a visibly flooding and draining exterior basin. */
export class TidelineEnvironment implements RaceEnvironment {
 readonly root:THREE.Group;
 readonly stats:RaceEnvironmentStats;
 private readonly clock={value:0};
 private readonly waterLevel={value:0};
 private readonly reducedMotion=resolveReducedMotion();
 private readonly ocean:THREE.Mesh;
 private readonly glass:THREE.Mesh;
 private readonly particles:THREE.Points;
 private readonly shafts:THREE.InstancedMesh;
 private readonly steam:THREE.Points;
 private readonly motion:TidelineMotion;
 private readonly gauges:TidelineQuayGauges;
 private readonly extraTriangles:number;
 private readonly extraDraws:number;
 private constructor(private readonly scenery:NeonEnvironment,private readonly waterTexture:THREE.Texture,
   private readonly effectsTexture:THREE.Texture,private readonly mudTexture:THREE.Texture,private readonly course?:TidelineCourse){
  this.root=scenery.root;
  const flareRim=new THREE.DirectionalLight(0xffb26c,.24);
  flareRim.position.copy(TIDELINE_FLARE_DIRECTION).multiplyScalar(100);
  flareRim.name='tideline_refinery_flare_rim';
  this.root.add(flareRim);
  const uniforms:TideUniforms={time:this.clock,water:this.waterLevel,effects:effectsTexture};
  const seen=new Set<THREE.Material>();
  this.root.traverse(object=>{
   if(!(object instanceof THREE.Mesh))return;
   const material=object.material as THREE.MeshLambertMaterial;
   if(!seen.has(material)){seen.add(material);installTideSurface(material,uniforms);}
   if(object.name.includes('BASIN') || object.name.includes('floor')) {
    object.material=this.basinMaterial();
   }
  });
  this.ocean=this.createOcean();this.glass=this.createGlass();
  this.particles=exteriorParticles(uniforms);this.shafts=exteriorLightShafts(uniforms);this.steam=this.createSteam();
  let frameTexture:THREE.Texture|null=null;
  this.root.traverse(object=>{if(object instanceof THREE.Mesh&&object.name.includes('GW_MAT_metal'))frameTexture=(object.material as THREE.MeshLambertMaterial).map;});
  this.gauges=new TidelineQuayGauges(frameTexture);
  const frames=new THREE.Mesh(chamberFrames(),new THREE.MeshLambertMaterial({map:frameTexture,color:0x8d9990,side:THREE.DoubleSide}));
  frames.name='tideline_pressure_window_gaskets';
  this.motion=new TidelineMotion(this.root,uniforms);
  const extras=[this.ocean,this.glass,this.particles,this.shafts,this.steam,lampDecals(uniforms),this.motion.root,frames,this.gauges.root];
  this.root.add(...extras);
  let triangles=0,draws=0;
  for(const root of extras)root.traverse(object=>{if(object instanceof THREE.Mesh){draws++;triangles+=(object.geometry.index?.count??object.geometry.getAttribute('position').count)/3*(object instanceof THREE.InstancedMesh?object.count:1);}else if(object instanceof THREE.Points)draws++;});
  this.extraTriangles=triangles;this.extraDraws=draws;
  this.stats=scenery.stats;this.stats.meshes+=draws;this.stats.materials+=draws;this.stats.textures+=4;this.stats.triangles+=triangles;
 }
 static async load(course?:TidelineCourse):Promise<TidelineEnvironment>{
  const results=await Promise.allSettled([
   NeonEnvironment.load({rootName:'tideline_pump_works',modelUrl:'/assets/tideline-foundry/foundry_world.glb',lightsUrl:'/assets/tideline-foundry/lights.json',maximumDistance:240,opticalEffects:false,lightIntensity:500,preferLightsAhead:true,colors:{GW_MAT_emissive:0xffb15b}}),
   new THREE.TextureLoader().loadAsync('/assets/tideline-foundry/textures/water.jpg'),
   new THREE.TextureLoader().loadAsync('/assets/tideline-v3/waterlight.jpg'),
   new THREE.TextureLoader().loadAsync('/assets/tideline-v3/basin.jpg'),
  ]);
  if(results.some(r=>r.status==='rejected')){
   for(const result of results)if(result.status==='fulfilled'){
    if(result.value instanceof THREE.Texture)result.value.dispose();else disposeObject3DResources(result.value.root);
   }
   throw new Error('Tideline scenery or painted water could not be loaded.');
  }
  const [scenery,water,effects,mud]=results.map(r=>(r as PromiseFulfilledResult<unknown>).value) as [NeonEnvironment,THREE.Texture,THREE.Texture,THREE.Texture];
  try { assertTidelineContract(scenery.root,contract); }
  catch(error){disposeObject3DResources(scenery.root);for(const texture of [water,effects,mud])texture.dispose();throw error;}
  for(const texture of [water,effects,mud]){texture.colorSpace=THREE.SRGBColorSpace;texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.anisotropy=4;}
  return new TidelineEnvironment(scenery,water,effects,mud,course);
 }
 updateVisibility(camera:THREE.Camera):void{
  this.clock.value=this.reducedMotion?0:this.course?.tide.elapsed??0;
  this.waterLevel.value=this.course?.tide.waterLevel??0;
  this.motion.update(this.clock.value,this.course?.tide.lap??1,this.waterLevel.value,this.reducedMotion);
  this.scenery.updateVisibility(camera);
  this.motion.applyVisibility(this.course?.tide.lap??1);
  this.ocean.position.y=this.waterLevel.value;
  this.gauges.update(this.waterLevel.value);
  const flooded=camera.position.y<this.waterLevel.value+2;
  this.particles.visible=!this.reducedMotion&&flooded;
  this.shafts.visible=flooded;
  this.steam.visible=!this.reducedMotion&&this.waterLevel.value<-3;
  this.stats.visibleGroups+=this.extraDraws;this.stats.visibleTriangles+=this.extraTriangles;
 }
 private basinMaterial():THREE.MeshLambertMaterial {
  const material=new THREE.MeshLambertMaterial({map:this.mudTexture,color:0xb59c77});
  material.onBeforeCompile=shader=>{
   shader.vertexShader='varying vec3 basinWorld;\n'+shader.vertexShader;
   shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nbasinWorld=(modelMatrix*vec4(transformed,1.)).xyz;');
   shader.fragmentShader='varying vec3 basinWorld;\n'+shader.fragmentShader;
   shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',`vec2 flow=basinWorld.xz*.035;vec3 silt=texture2D(map,flow).rgb;vec3 macro=texture2D(map,flow*.19+vec2(.27)).rgb;diffuseColor.rgb*=silt*(.65+macro*.9);`);
  };
  material.customProgramCacheKey=()=>"tideline-wet-silt-v3";return material;
 }
 private createOcean():THREE.Mesh{
  const geometry=new THREE.PlaneGeometry(1800,1800,48,48);geometry.rotateX(-Math.PI/2);
  const material=new THREE.ShaderMaterial({uniforms:{...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),time:this.clock,waterLevel:this.waterLevel,waterAtlas:{value:this.waterTexture},chamberMask:{value:chamberWaterMask()}},fog:true,transparent:true,depthWrite:false,side:THREE.DoubleSide,
   vertexShader:`uniform float time;varying vec3 world;#include <fog_pars_vertex>
    void main(){vec3 p=position;p.y+=sin(p.x*.031+time*.3)*.14+sin(p.z*.041-time*.24)*.10;world=(modelMatrix*vec4(p,1.)).xyz;vec4 mvPosition=modelViewMatrix*vec4(p,1.);gl_Position=projectionMatrix*mvPosition;#include <fog_vertex>}`.replaceAll(';#include',';\n#include').replace('#include <fog_vertex>}','#include <fog_vertex>\n}'),
   fragmentShader:`uniform float time,waterLevel;uniform sampler2D waterAtlas,chamberMask;varying vec3 world;#include <fog_pars_fragment>
    void main(){vec4 chamber=texture2D(chamberMask,(world.xz+900.)/1800.);if(chamber.r>.5&&waterLevel>chamber.g*80.-40.&&waterLevel<chamber.b*80.-40.)discard;
     vec2 uv=fract(world.xz*.014+vec2(time*.002,-time*.003));vec3 paint=texture2D(waterAtlas,uv*.47+.015).rgb;
     float wave=pow(max(0.,sin(world.x*.13+time*.4)*cos(world.z*.16-time*.3)),8.);
     vec3 color=paint*vec3(.3,.7,.75)+vec3(.02,.12,.13)*wave;
     gl_FragColor=vec4(color,cameraPosition.y<waterLevel?.78:.9);
     #include <colorspace_fragment>
     #include <fog_fragment>
    }`.replaceAll(';#include',';\n#include')});
  const mesh=new THREE.Mesh(geometry,material);mesh.name='tideline_water_surface';mesh.renderOrder=1;return mesh;
 }
 private createGlass():THREE.Mesh{
  const material=new THREE.ShaderMaterial({uniforms:{water:this.waterLevel,time:this.clock,effects:{value:this.effectsTexture}},transparent:true,depthWrite:false,side:THREE.DoubleSide,
   vertexShader:`varying vec3 world,normal,view;void main(){world=(modelMatrix*vec4(position,1.)).xyz;normal=normalize(normalMatrix*normal);vec4 p=modelViewMatrix*vec4(position,1.);view=-p.xyz;gl_Position=projectionMatrix*p;}`.replaceAll('world,normal,view','world,vGlassNormal,view').replace('normal=normalize','vGlassNormal=normalize'),
   fragmentShader:`uniform float water,time;uniform sampler2D effects;varying vec3 world,vGlassNormal,view;
    void main(){float wet=1.-smoothstep(-.25,.25,world.y-water);float rim=pow(1.-abs(dot(normalize(vGlassNormal),normalize(view))),2.);
     vec2 flow=fract(world.xz*.038+vec2(time*.007,-time*.004));float caustic=texture2D(effects,flow*.46+vec2(.02,.52)).g;
     float seam=1.-smoothstep(.02,.065,abs(sin(world.x*.34+world.z*.31)));
     float waterline=1.-smoothstep(.08,.45,abs(world.y-water));
     vec3 tint=mix(vec3(.24,.18,.09),vec3(.012,.19,.22),wet)+vec3(.06,.30,.31)*caustic*wet;
     gl_FragColor=vec4(tint,clamp(.025+rim*.18+wet*.16+waterline*.42+seam*.018,0.,.65));
     #include <colorspace_fragment>
    }`});
  const mesh=new THREE.Mesh(chamberGeometry(),material);mesh.name='tideline_aqueduct_glazing';mesh.renderOrder=2;return mesh;
 }
 private createSteam():THREE.Points{
  const positions:number[]=[];
  for(const progress of [.035,.325,.645]){const s=route.stations[Math.floor(progress*route.count)];for(let i=0;i<32;i++)positions.push(s.p[0]-s.t[2]*25+(i%4)*.35,s.p[1]+9+i*.2,s.p[2]+s.t[0]*25);}
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  const material=new THREE.ShaderMaterial({uniforms:{time:this.clock},transparent:true,depthWrite:false,
   vertexShader:`uniform float time;varying float fade;void main(){float cycle=mod(time,3.1);vec3 p=position;p.y+=mod(time*1.8+position.y,9.);p.x+=sin(time*.3+position.y);vec4 mv=modelViewMatrix*vec4(p,1.);gl_Position=projectionMatrix*mv;gl_PointSize=clamp(1900./max(1.,-mv.z),4.,55.);fade=(1.-smoothstep(.3,1.8,cycle))*(1.-mod(time*1.8+position.y,9.)/9.);}`,
   fragmentShader:`varying float fade;void main(){float a=exp(-length(gl_PointCoord-.5)*8.);gl_FragColor=vec4(.6,.66,.6,a*fade*.25);}`});
  const mesh=new THREE.Points(geometry,material);mesh.name='tideline_pump_steam';mesh.frustumCulled=false;return mesh;
 }
}
