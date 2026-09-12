import * as THREE from 'three';
import fishPaths from './data/dreamisland/fish-paths.json';
import type {DreamIslandCourse} from './dreamisland-course';

/** Per-water-owner resources: the existing dome is captured once in each state. */
export class DreamIslandReflections {
 readonly day={value:null as THREE.Texture|null};
 readonly night={value:null as THREE.Texture|null};
 readonly blend={value:0};
 readonly sun={value:new THREE.Vector3()};
 readonly enabled={value:0};
 private pending=false;
 private targets:THREE.WebGLRenderTarget[]=[];
 initialize(renderer:THREE.WebGLRenderer,scene:THREE.Scene){
  if(this.pending||this.targets.length)return;
  const dome=scene.getObjectByName('dreamisland_panorama') as THREE.Mesh<THREE.SphereGeometry,THREE.ShaderMaterial>;
  if(!dome?.material.uniforms.dayPanorama.value||!dome.material.uniforms.nightPanorama.value)return;
  this.pending=true;
  // Capture at the first water draw after loading; subsequent frames only sample the maps.
  {
   const start=performance.now(),generator=new THREE.PMREMGenerator(renderer);
   const capture=new THREE.Scene(),material=dome.material.clone();
   // The PMREM contains linear radiance; tone mapping happens on the consumer.
   material.fragmentShader=material.fragmentShader.replace('#include <tonemapping_fragment>','').replace('#include <colorspace_fragment>','');
   const sky=new THREE.Mesh(dome.geometry,material);sky.frustumCulled=false;capture.add(sky);
   try{
    for(const value of [0,1]){
     material.uniforms.nightBlend.value=value;material.uniforms.starReveal.value=value;
     material.uniforms.haze.value.set(value?0x08141e:0xb9dbe4);
     this.targets.push(generator.fromScene(capture,0,.1,1000,{size:128}));
    }
    this.day.value=this.targets[0].texture;this.night.value=this.targets[1].texture;this.enabled.value=1;
    scene.userData.dreamIslandReflections={pmremCpuMs:performance.now()-start,size:128,passes:2};
   }finally{material.dispose();generator.dispose();}
  }
 }
 update(scene:THREE.Scene,blend:number){
  this.blend.value=blend;
  scene.traverse(object=>{if(object instanceof THREE.DirectionalLight&&object.castShadow)
   this.sun.value.copy(object.position).sub(object.target.position).normalize();});
 }
 dispose(){for(const target of this.targets)target.dispose();this.targets=[];}
}

/** Layer reflection onto the existing lit shader, after atlas flow has installed. */
export function applyDreamIslandReflection(material:THREE.MeshLambertMaterial,reflection:DreamIslandReflections,time:{value:number},kind:'water'|'road'='water'){
 const previous=material.onBeforeCompile,cache=material.customProgramCacheKey();
 material.onBeforeCompile=(shader,renderer)=>{
  previous.call(material,shader,renderer);
  Object.assign(shader.uniforms,{diEnvDay:reflection.day,diEnvNight:reflection.night,
   diReflectionBlend:reflection.blend,diReflectionReady:reflection.enabled,diReflectionTime:time,diSun:reflection.sun});
  shader.vertexShader='varying vec3 diReflectionWorld;\n'+shader.vertexShader.replace('#include <project_vertex>',
   'diReflectionWorld=(modelMatrix*vec4(transformed,1.)).xyz;\n#include <project_vertex>');
  shader.fragmentShader=`varying vec3 diReflectionWorld;
   uniform sampler2D diEnvDay,diEnvNight;
   uniform float diReflectionBlend,diReflectionReady,diReflectionTime;
   uniform vec3 diSun;
   #define ENVMAP_TYPE_CUBE_UV
   #define CUBEUV_TEXEL_WIDTH 0.0026041666666666665
   #define CUBEUV_TEXEL_HEIGHT 0.001953125
   #define CUBEUV_MAX_MIP 7.0
   `+shader.fragmentShader.replace('#include <opaque_fragment>',`
    vec3 diView=normalize(cameraPosition-diReflectionWorld);
    vec2 diDetail=diReflectionWorld.xz*${kind==='road'?'18.':'1.'};
    vec3 diNormal=normalize(vec3(
     2.4*sin(diDetail.x*.72+diDetail.y*.31+diReflectionTime*.8),1.,
     2.4*sin(diDetail.y*.83-diDetail.x*.23-diReflectionTime*.57)));
    vec3 diSurface=normalize(vec3(diNormal.x*.04,1.,diNormal.z*.04));
    vec3 diRay=reflect(-diView,diSurface);
    vec3 diEnvironment=mix(textureCubeUV(diEnvDay,diRay,.15).rgb,
      textureCubeUV(diEnvNight,diRay,.15).rgb,1.-pow(1.-diReflectionBlend,2.8));
    float diFresnel=.02+.98*pow(1.-max(dot(diSurface,diView),0.),5.);
    ${kind==='water'?`diEnvironment*=mix(1.,.20,diReflectionBlend);
    outgoingLight=mix(outgoingLight,diEnvironment,diFresnel*diReflectionReady);`:
    `outgoingLight=mix(outgoingLight,diEnvironment,diFresnel*diReflectionReady*diReflectionBlend*.35);`}
    vec3 diHalf=normalize(diView+diSun);
    float diGlint=pow(max(dot(diNormal,diHalf),0.),128.);
    ${kind==='water'?`outgoingLight+=vec3(1.,.98,.91)*diGlint*60.*(1.-diReflectionBlend)*diReflectionReady;`:
    `vec3 diLampHalf=normalize(diView+normalize(vec3(.55,.62,-.55)));
    float diLamp=pow(max(dot(diNormal,diLampHalf),0.),24.);
    outgoingLight+=vec3(.12,1.,1.25)*diLamp*1.1*diReflectionBlend*diReflectionReady;`}
    #include <opaque_fragment>`);
 };
 material.customProgramCacheKey=()=>cache+'-reflection-4-'+kind;material.needsUpdate=true;
}

/** The two node recipes. Source UVs already point inside their atlas cells. */
export function createDreamIslandChrome(map:THREE.Texture|null,envMap:THREE.Texture|null){
 return new THREE.MeshStandardMaterial({name:'DI_chrome',map,envMap,metalness:1,roughness:.08,vertexColors:true});
}
export function createDreamIslandGlass(emissiveMap:THREE.Texture|null,envMap:THREE.Texture|null){
 return new THREE.MeshStandardMaterial({name:'DI_glass',color:0x9ce9ed,envMap,metalness:0,roughness:.15,
  transparent:true,opacity:.55,depthWrite:false,emissive:0x76efff,emissiveMap,emissiveIntensity:.12});
}

/** Preserve continuous night mixing for the standard chrome/glass response. */
export function bindDreamIslandEnvironment(material:THREE.MeshStandardMaterial,reflections:DreamIslandReflections){
 material.envMap=reflections.day.value;
 material.onBeforeCompile=shader=>{
  shader.uniforms.diNightEnv=reflections.night;shader.uniforms.diEnvBlend=reflections.blend;
  shader.fragmentShader='uniform sampler2D diNightEnv;uniform float diEnvBlend;\n'+shader.fragmentShader
   .replace('#include <envmap_common_pars_fragment>',`#include <envmap_common_pars_fragment>
    vec4 diBlendedEnv(vec3 direction,float roughness){return mix(textureCubeUV(envMap,direction,roughness),
     textureCubeUV(diNightEnv,direction,roughness),1.-pow(1.-diEnvBlend,2.8));}`)
   .replace('#include <envmap_physical_pars_fragment>',THREE.ShaderChunk.envmap_physical_pars_fragment.replaceAll('textureCubeUV( envMap,','diBlendedEnv('));
 };
 material.customProgramCacheKey=()=> 'dreamisland-standard-env-v1';material.needsUpdate=true;
}

/** Bind contracted GLB node names without changing the placement system. */
export function bindDreamIslandNodeMaterials(scene:THREE.Scene,reflections:DreamIslandReflections){
 if(!reflections.day.value)return;
 scene.traverse(object=>{
  if(!(object instanceof THREE.Mesh)||object.userData.diRecipeBound)return;
  const chrome=/^(PR_sphere|PR_pipes|CAP_frame|CAP_cap)$/.test(object.name);
  const glass=object.name==='CAP_glass';
  if(!chrome&&!glass)return;
  const source=object.material as THREE.MeshStandardMaterial;
  const material=chrome?createDreamIslandChrome(source.map,reflections.day.value)
   :createDreamIslandGlass(source.emissiveMap??source.map,reflections.day.value);
  bindDreamIslandEnvironment(material,reflections);object.material=material;
  object.renderOrder=glass?20:0;object.userData.diRecipeBound=true;
 });
}

/** One additive, fogged, tone-mapped instance batch. Sizes stay in world metres. */
export class DreamIslandGlow {
 readonly mesh:THREE.InstancedMesh;
 readonly ready:Promise<void>;
 private readonly material=new THREE.MeshLambertMaterial({name:'DI_glow_sprites',color:0x000000,
  emissive:0x74eaff,emissiveIntensity:4,transparent:true,depthWrite:false,blending:THREE.AdditiveBlending});
 private readonly sources:{mesh:THREE.Mesh;centres:THREE.Vector3[];size:number}[]=[];
 private scanFrame=0;
 private readonly matrix=new THREE.Matrix4();
 private readonly world=new THREE.Matrix4();
 private readonly inverse=new THREE.Matrix4();
 private readonly position=new THREE.Vector3();
 private readonly scale=new THREE.Vector3();
 private readonly rotation=new THREE.Quaternion();
 constructor(private readonly course:DreamIslandCourse){
  const geometry=new THREE.PlaneGeometry(1,1);
  // The radial alpha is procedural; the colour still consumes the emissive TR cell.
  const uv=geometry.attributes.uv;
  for(let i=0;i<uv.count;i++)uv.setXY(i,.504+.492*uv.getX(i),.004+.492*uv.getY(i));
  this.material.onBeforeCompile=shader=>{
   shader.vertexShader='varying vec2 diGlowPoint;\n'+shader.vertexShader.replace('#include <begin_vertex>',
    '#include <begin_vertex>\ndiGlowPoint=position.xy*2.;');
   shader.fragmentShader='varying vec2 diGlowPoint;\n'+shader.fragmentShader.replace('#include <opaque_fragment>',
    'diffuseColor.a*=pow(max(0.,1.-dot(diGlowPoint,diGlowPoint)),3.);\n#include <opaque_fragment>');
  };
  this.material.customProgramCacheKey=()=> 'dreamisland-glow-v1';
  this.mesh=new THREE.InstancedMesh(geometry,this.material,512);this.mesh.name='dreamisland_glow_sprites';
  this.mesh.count=0;this.mesh.frustumCulled=false;this.mesh.renderOrder=30;
  this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  this.mesh.userData.atlasCell='emissive/shallows-glow';this.mesh.userData.worldMetres=true;
  this.ready=typeof Image==='undefined'?Promise.resolve():new THREE.TextureLoader().loadAsync('/assets/dreamisland/textures/emissive.jpg').then(t=>{
   t.colorSpace=THREE.SRGBColorSpace;t.flipY=false;t.anisotropy=16;this.material.emissiveMap=t;this.material.needsUpdate=true;
  });
 }
 /** Optional explicit centres for merged shoal geometry, supplied in mesh-local space. */
 addSource(mesh:THREE.Mesh,centres:THREE.Vector3[],size:number){
  if(!this.sources.some(source=>source.mesh===mesh))this.sources.push({mesh,centres,size});
 }
 update(scene:THREE.Scene,camera:THREE.Camera,nightBlend:number){
  if(this.scanFrame++%60===0){
   scene.traverse(object=>{
    if(!(object instanceof THREE.Mesh))return;
    if(/^DI_FISH.*_DI_MAT_emissive$/.test(object.name)){
     const data=fishPaths.shoals.find(shoal=>object.name.startsWith('DI_'+shoal.batch+'_'))
      ??(object.name.startsWith('DI_FISHADDED_')?fishPaths.shoals[0]:undefined);
     if(data){
      const point=(p:{progress:number;lateral:number;rise:number})=>{
       const sample=this.course.sample(p.progress),right=sample.tangent.clone().cross(new THREE.Vector3(0,1,0)).normalize();
       return sample.position.clone().addScaledVector(right,p.lateral).add(new THREE.Vector3(0,p.rise,0));
      };
      const rest=point(data.rest);this.addSource(object,data.fish.map(fish=>point(fish).sub(rest)),4.5);
     }
     return;
    }
    if(!['CAP_core','PR_bollard_core'].includes(object.name))return;
    object.geometry.computeBoundingBox();
    this.addSource(object,[object.geometry.boundingBox!.getCenter(new THREE.Vector3())],object.name==='CAP_core'?3.8:1.8);
   });
  }
  let count=0;
  this.mesh.updateWorldMatrix(true,false);this.inverse.copy(this.mesh.matrixWorld).invert();
  camera.getWorldQuaternion(this.rotation);
  for(const source of this.sources){
   let visible=true;for(let object:THREE.Object3D|null=source.mesh;object;object=object.parent)visible&&=object.visible;
   if(!visible||nightBlend===0)continue;
   source.mesh.updateWorldMatrix(true,false);
   const instances=source.mesh instanceof THREE.InstancedMesh?source.mesh.count:1;
   for(let instance=0;instance<instances;instance++){
    if(source.mesh instanceof THREE.InstancedMesh){source.mesh.getMatrixAt(instance,this.matrix);this.world.multiplyMatrices(source.mesh.matrixWorld,this.matrix);}
    else this.world.copy(source.mesh.matrixWorld);
    // Pickup collect scale must remove its halo with the capsule.
    const scale=this.scale.setFromMatrixScale(this.world);const visibility=Math.min(1,Math.max(scale.x,scale.y,scale.z));
    if(visibility<.001)continue;
    for(const centre of source.centres){
     if(count===this.mesh.instanceMatrix.count)throw Error('Dream Island glow instance capacity exceeded');
     this.position.copy(centre).applyMatrix4(this.world);
     this.scale.setScalar(source.size*visibility);
     this.matrix.compose(this.position,this.rotation,this.scale).premultiply(this.inverse);
     this.mesh.setMatrixAt(count,this.matrix);count++;
    }
   }
  }
  this.mesh.count=count;this.mesh.instanceMatrix.needsUpdate=true;this.material.opacity=nightBlend*.65;
  this.mesh.userData.sources=this.sources.length;this.mesh.userData.instances=count;
 }
 dispose(){this.mesh.geometry.dispose();this.material.emissiveMap?.dispose();this.material.dispose();}
}
