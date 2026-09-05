import * as THREE from "three";
import route from "./data/tideline/route.json";
import type { TideUniforms } from "./tideline-materials";

/** Motion uses the race clock, so pause and replay cadence cannot drift. */
export class TidelineMotion {
 readonly root=new THREE.Group();
 private readonly cranes:THREE.Object3D[]=[];
 private readonly ferries:{object:THREE.Object3D;base:THREE.Vector3}[]=[];
 private readonly gulls:{body:THREE.Group;wings:THREE.Mesh[];phase:number}[]=[];
 private readonly drain:THREE.InstancedMesh;
 constructor(scenery:THREE.Group,uniforms:TideUniforms){
  scenery.traverse(object=>{
   if(object.name.includes('MOTION_CRANE'))this.cranes.push(object);
   if(object.name.includes('MOTION_FERRY'))this.ferries.push({object,base:object.position.clone()});
   if(object instanceof THREE.Mesh&&object.name.includes('MOTION_CABLES'))this.prepareCables(object,uniforms);
  });
  // Water sheets fall from OUTSIDE sluice outlets, beyond the chamber walls.
  const material=new THREE.ShaderMaterial({uniforms:{time:uniforms.time,effects:{value:uniforms.effects}},transparent:true,depthWrite:false,side:THREE.DoubleSide,
   vertexShader:`varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*instanceMatrix*vec4(position,1.);}`,
   fragmentShader:`uniform float time;uniform sampler2D effects;varying vec2 vUv;void main(){vec2 uv=vec2(vUv.x,fract(vUv.y+time*.7))*.46+vec2(.02,.52);float foam=texture2D(effects,uv).g;float edge=smoothstep(0.,.12,vUv.x)*(1.-smoothstep(.88,1.,vUv.x));gl_FragColor=vec4(vec3(.12,.36,.34)+foam*.3,(.12+foam*.35)*edge);\n#include <colorspace_fragment>\n}`});
  this.drain=new THREE.InstancedMesh(new THREE.PlaneGeometry(5,23),material,6);
  const pose=new THREE.Object3D();let index=0;
  for(const progress of [.035,.325,.645])for(const side of [-1,1]) {
   const s=route.stations[Math.floor(progress*route.count)];
   pose.position.set(s.p[0]-s.t[2]*side*31,-11,s.p[2]+s.t[0]*side*31);
   pose.rotation.y=Math.atan2(s.t[0],s.t[2]);pose.updateMatrix();this.drain.setMatrixAt(index++,pose.matrix);
  }
  this.drain.name='tideline_exterior_sluice_water';this.drain.computeBoundingSphere();this.root.add(this.drain);
  const wingGeometry=new THREE.BufferGeometry();wingGeometry.setAttribute('position',new THREE.Float32BufferAttribute([0,0,0,2.5,-.2,.2,1,-.15,1],3));wingGeometry.computeVertexNormals();
  wingGeometry.setAttribute('uv',new THREE.Float32BufferAttribute([.52,.52,.98,.52,.75,.98],2));
  let featherTexture:THREE.Texture|null=null;
  scenery.traverse(object=>{if(object instanceof THREE.Mesh&&object.name.includes('GW_MAT_metal'))featherTexture=(object.material as THREE.MeshLambertMaterial).map;});
  const wingMaterial=new THREE.MeshLambertMaterial({map:featherTexture,color:0xb6baa6,side:THREE.DoubleSide});
  for(let i=0;i<7;i++){
   const body=new THREE.Group(),wings=[new THREE.Mesh(wingGeometry,wingMaterial),new THREE.Mesh(wingGeometry,wingMaterial)];
   wings[1].scale.x=-1;body.add(...wings);this.root.add(body);this.gulls.push({body,wings,phase:i*1.47});
  }
  this.root.name='tideline_working_port';
 }
 update(seconds:number,lap:number,waterLevel:number,reduced:boolean):void {
  const time=reduced?0:seconds;
  this.cranes.forEach(crane=>{const index=Number(crane.name.match(/CRANE_(\d+)/)?.[1]??0);crane.rotation.y=Math.sin(time*.095+index*1.8)*.19;});
  for(const {object,base} of this.ferries){object.position.copy(base);object.position.x+=Math.sin(time*.012)*130;object.position.y=waterLevel+.7;}
  this.drain.visible=!reduced&&lap>1&&seconds<5;
  for(const {body,wings,phase} of this.gulls){
   body.position.set(190+Math.sin(time*.12+phase)*65,34+Math.sin(time*.3+phase)*3,180+Math.cos(time*.12+phase)*65);
   body.rotation.y=time*.12+phase;wings[0].rotation.z=Math.sin(time*3.1+phase)*.35;wings[1].rotation.z=-wings[0].rotation.z;
  }
 }
 applyVisibility(lap:number):void {for(const {object} of this.ferries)object.visible=object.visible&&lap>=3;}
 private prepareCables(mesh:THREE.Mesh,uniforms:TideUniforms):void {
  const position=mesh.geometry.getAttribute('position'),sway:number[]=[];
  for(let i=0;i<position.count;i++){
   const x=position.getX(i),y=position.getY(i),z=position.getZ(i);
   let nearest=route.stations[0],distance=Infinity;
   for(const station of route.stations){const d=(station.p[0]-x)**2+(station.p[2]-z)**2;if(d<distance){distance=d;nearest=station;}}
   const weight=THREE.MathUtils.clamp((9.2-(y-nearest.p[1]))/.8,0,1);
   sway.push(-nearest.t[2]*weight,0,nearest.t[0]*weight);
  }
  mesh.geometry.setAttribute('tideSway',new THREE.Float32BufferAttribute(sway,3));
  const source=mesh.material as THREE.MeshLambertMaterial,material=source.clone();
  const surfaceCompile=source.onBeforeCompile;
  material.onBeforeCompile=(shader,renderer)=>{
   surfaceCompile.call(material,shader,renderer);shader.uniforms.tideTime=uniforms.time;
   shader.vertexShader='attribute vec3 tideSway;uniform float tideTime;\n'+shader.vertexShader;
   shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\ntransformed+=tideSway*sin(tideTime*.65+position.x*.01)*.32;');
  };
  material.customProgramCacheKey=()=>"tideline-swaying-cables-v3";mesh.material=material;
 }
}
