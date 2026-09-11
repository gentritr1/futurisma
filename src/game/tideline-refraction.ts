import * as THREE from 'three';
/** Copy the rendered background instead of submitting the whole world again.
 * The refracted colour still enters Lambert lighting, AgX and distance fog. */
export function refractingSurface(name:string,clock:{value:number},heat=false):THREE.MeshLambertMaterial {
 const material=new THREE.MeshLambertMaterial({name,color:heat?0xb8c4b9:0x82aca3,transparent:true,opacity:heat?.16:.42,depthWrite:false,side:THREE.DoubleSide});
 material.forceSinglePass=true;
 const image={value:null as THREE.FramebufferTexture|null},size={value:new THREE.Vector2(1,1)};
 Object.assign(material,{refractionImage:image,refractionSize:size});
 material.onBeforeCompile=shader=>{
  shader.uniforms.refractionImage=image;shader.uniforms.refractionSize=size;shader.uniforms.refractionClock=clock;
  shader.vertexShader='varying vec2 vRefractUv;\n'+shader.vertexShader;
  shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvRefractUv=uv;');
  shader.fragmentShader='uniform sampler2D refractionImage;uniform vec2 refractionSize;uniform float refractionClock;varying vec2 vRefractUv;\n'+shader.fragmentShader;
  shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
   vec2 screen=gl_FragCoord.xy/refractionSize;
   vec2 warp=vec2(sin(vRefractUv.y*43.+refractionClock*${heat?'15.':'2.'}),cos(vRefractUv.x*37.-refractionClock*${heat?'11.':'1.'}))*${heat?'2.8':'1.7'}/refractionSize;
   vec3 behind=texture2D(refractionImage,clamp(screen+warp,vec2(.001),vec2(.999))).rgb;
   diffuseColor.rgb=mix(diffuseColor.rgb,pow(behind,vec3(2.2)),.8);
   ${heat?'diffuseColor.a*=sin(vRefractUv.y*3.14159);':'float scan=step(.90,fract(vRefractUv.y*34.-refractionClock*.18));diffuseColor.a*=.75+.25*scan;'}
  `);
 };
 material.customProgramCacheKey=()=>name;
 material.addEventListener('dispose',()=>image.value?.dispose());return material;
}
export function captureRefraction(mesh:THREE.Mesh):void {
 const material=mesh.material as THREE.Material&{refractionImage:{value:THREE.FramebufferTexture|null};refractionSize:{value:THREE.Vector2}};
 mesh.onBeforeRender=renderer=>{
  const size=renderer.getDrawingBufferSize(new THREE.Vector2()),image=material.refractionImage;
  if(!image.value||image.value.image.width!==size.x||image.value.image.height!==size.y){image.value?.dispose();image.value=new THREE.FramebufferTexture(size.x,size.y);image.value.minFilter=image.value.magFilter=THREE.LinearFilter;material.refractionSize.value.copy(size);}
  renderer.copyFramebufferToTexture(image.value);
 };
}
