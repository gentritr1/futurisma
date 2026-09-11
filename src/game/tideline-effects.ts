import * as THREE from "three";
import route from "./data/tideline/route.json";
import lamps from "../../public/assets/tideline-foundry/lights.json";
import type { TideUniforms } from "./tideline-materials";

type Station={p:number[];t:number[]};
const up=new THREE.Vector3(0,1,0);
const stations:Station[]=[...route.stations,...route.shortcut.stations];
function nearest(p:number[]):Station {return stations.reduce((a,b)=>Math.hypot(a.p[0]-p[0],a.p[2]-p[2])<Math.hypot(b.p[0]-p[0],b.p[2]-p[2])?a:b);}

/** Painted light footprints and reflections, batched independently of real lights. */
export function lampDecals(uniforms:TideUniforms):THREE.Group {
 const root=new THREE.Group();root.name='tideline_painted_lamp_pools';
 const geometry=new THREE.PlaneGeometry(1,1);
 const shader=(tile:number,opacity:number)=>new THREE.ShaderMaterial({
  uniforms:{effects:{value:uniforms.effects},water:uniforms.water,time:uniforms.time,tile:{value:new THREE.Vector2(tile%2,1-Math.floor(tile/2))},opacity:{value:opacity}},
  vertexShader:`varying vec2 vUv;varying float height;void main(){vUv=uv;vec4 p=modelMatrix*instanceMatrix*vec4(position,1.);height=p.y;gl_Position=projectionMatrix*viewMatrix*p;}`,
  fragmentShader:`uniform sampler2D effects;uniform float opacity,water,time;uniform vec2 tile;varying vec2 vUv;varying float height;
   void main(){vec3 c=texture2D(effects,tile*.5+vec2(.02)+vUv*.46).rgb;float exposure=mix(.6,1.,smoothstep(-.5,.5,height-water));gl_FragColor=vec4(c,opacity*exposure);#include <colorspace_fragment>}`.replace(';#include',';\n#include'),
  transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,side:THREE.DoubleSide});
 const pools=new THREE.InstancedMesh(geometry,shader(1,.32),lamps.length);
 const cones=new THREE.InstancedMesh(geometry,shader(2,.23),lamps.length);
 const puddles=new THREE.InstancedMesh(geometry,shader(3,.34),lamps.length);
 const pose=new THREE.Object3D();
 lamps.forEach((lamp,i)=>{
  const s=nearest(lamp.p),center=new THREE.Vector3(...s.p as [number,number,number]),tangent=new THREE.Vector3(...s.t as [number,number,number]),right=tangent.clone().cross(up).normalize();
  const gap=new THREE.Vector3(...lamp.p as [number,number,number]).sub(center),lateral=gap.dot(right),near=Math.abs(lateral)<27;
  pose.position.copy(near?center.clone().addScaledVector(right,THREE.MathUtils.clamp(lateral,-8.5,8.5)):new THREE.Vector3(lamp.p[0],lamp.ground,lamp.p[2]));
  pose.position.y=(near?s.p[1]:lamp.ground)+.045;
  pose.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(right,tangent,up));pose.scale.set(14,20,1);pose.updateMatrix();pools.setMatrixAt(i,pose.matrix);
  pose.position.addScaledVector(tangent,3).addScaledVector(up,.015);pose.scale.set(9,16,1);pose.updateMatrix();puddles.setMatrixAt(i,pose.matrix);
  pose.position.copy(center).addScaledVector(right,Math.sign(lateral||1)*15.7).addScaledVector(up,3.5);
  pose.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(tangent,up,right));pose.scale.set(near?9:0,near?6:0,1);pose.updateMatrix();cones.setMatrixAt(i,pose.matrix);
 });
 pools.name='tideline_road_light_pools';cones.name='tideline_wall_light_cones';puddles.name='tideline_lamp_puddle_reflections';
 for(const mesh of [pools,cones,puddles]){mesh.computeBoundingSphere();mesh.renderOrder=3;root.add(mesh);}
 return root;
}

/** Exterior particulate is tied to the chamber, never to the air around the pilot. */
export function exteriorParticles(uniforms:TideUniforms):THREE.Points {
 const positions:number[]=[];
 for(let i=0;i<route.stations.length;i+=5){const s=route.stations[i];if(s.p[1]>0)continue;const right=new THREE.Vector3(...s.t as [number,number,number]).cross(up).normalize();
  for(const side of [-1,1]) for(let n=0;n<2;n++){const p=new THREE.Vector3(...s.p as [number,number,number]).addScaledVector(right,side*(20+n*7)).addScaledVector(up,4+(i*13+n*7)%18);positions.push(...p);}}
 const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
 const material=new THREE.ShaderMaterial({uniforms:{time:uniforms.time,water:uniforms.water},transparent:true,depthWrite:false,
  vertexShader:`uniform float time,water;varying float fade;void main(){vec3 p=position;p.y+=sin(time*.18+position.z)*1.2;p.x+=sin(time*.1+position.y)*.7;vec4 mv=modelViewMatrix*vec4(p,1.);gl_Position=projectionMatrix*mv;gl_PointSize=clamp(1700./max(1.,-mv.z),10.,48.);fade=step(p.y,water)*(1.-smoothstep(12.,120.,-mv.z));}`,
  fragmentShader:`varying float fade;void main(){float r=length(gl_PointCoord-.5)*2.;float grain=exp(-r*r*9.);gl_FragColor=vec4(.19,.55,.5,grain*fade*.24);}`});
 const mesh=new THREE.Points(geometry,material);mesh.name='tideline_exterior_particulate';return mesh;
}

/** Five slow shafts stay outside the chamber, visible through the glazing. */
export function exteriorLightShafts(uniforms:TideUniforms):THREE.InstancedMesh {
 const geometry=new THREE.ConeGeometry(7,32,12,1,true);geometry.translate(0,-16,0);
 const material=new THREE.ShaderMaterial({uniforms:{time:uniforms.time,water:uniforms.water},transparent:true,depthWrite:false,side:THREE.DoubleSide,blending:THREE.AdditiveBlending,
  vertexShader:`varying vec2 vUv;varying float height;uniform float time;void main(){vUv=uv;vec3 p=position;p.x+=sin(time*.14+instanceMatrix[3].x)*p.y*.018;vec4 w=modelMatrix*instanceMatrix*vec4(p,1.);height=w.y;gl_Position=projectionMatrix*viewMatrix*w;}`,
  fragmentShader:`varying vec2 vUv;varying float height;uniform float water;void main(){float fade=sin(vUv.x*3.14159)*sin(vUv.y*3.14159);gl_FragColor=vec4(.08,.53,.49,fade*.06*step(height,water));}`});
 const mesh=new THREE.InstancedMesh(geometry,material,5),pose=new THREE.Object3D();
 [.015,.13,.78,.89,.965].forEach((p,i)=>{const s=route.stations[Math.floor(p*route.count)],right=new THREE.Vector3(...s.t as [number,number,number]).cross(up).normalize();pose.position.set(...s.p as [number,number,number]);pose.position.addScaledVector(right,(i%2?1:-1)*25);pose.position.y=2;pose.updateMatrix();mesh.setMatrixAt(i,pose.matrix);});
 mesh.name='tideline_exterior_light_shafts';mesh.frustumCulled=false;return mesh;
}
