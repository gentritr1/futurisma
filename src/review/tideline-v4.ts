import * as THREE from "three";
import { TidelineCourse } from "../game/tideline-course";
import { TidelineEnvironment } from "../game/tideline-environment";
import { TidelineWorld } from "../game/tideline-world";
import type { RaceCourse } from "../game/course";

// A public, fixed-camera review surface. It uses the actual course, materials,
// world and environment; it never changes the player's race or saved records.
const query=new URLSearchParams(location.search);
const lap=Math.max(1,Math.min(3,Number(query.get("lap")??1)));
const station=Math.max(0,Math.min(4,Number(query.get("station")??0)));
const elapsed=Math.max(0,Number(query.get("seconds")??8));
const progress=query.has("progress")?Number(query.get("progress")):query.get("view")==="lamp"?.004:[0,.125,.785,.94,.53][station];
const renderer=new THREE.WebGLRenderer({canvas:document.getElementById("review-canvas") as HTMLCanvasElement,antialias:true});
renderer.setSize(1280,720,false);renderer.setPixelRatio(1);
renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.AgXToneMapping;renderer.toneMappingExposure=1.04;
const scene=new THREE.Scene(),course=new TidelineCourse();
course.setLapBoard(lap);course.advanceTide(elapsed);course.updateAtmosphere(elapsed,false);
const world=new TidelineWorld(course);course.group.add(world.root);scene.add(course.group);
const environment=await TidelineEnvironment.load(course);scene.add(environment.root);await world.ready;
world.update(elapsed,false,[],progress,3868938316,lap);
const sample=course.sample(progress);
const camera=new THREE.PerspectiveCamera(57,1280/720,.1,1800);
const meter=query.get("view")==="lamp";
if(meter) {
  camera.position.copy(sample.position).addScaledVector(sample.up,35);
  camera.up.copy(sample.tangent);camera.lookAt(sample.position);
} else {
  camera.position.copy(sample.position).addScaledVector(sample.tangent,-16).addScaledVector(sample.up,6.4);
  camera.lookAt(sample.position.clone().addScaledVector(sample.tangent,30).addScaledVector(sample.up,3));
}
const profile=(course as RaceCourse).lightingAt(progress);
scene.add(new THREE.HemisphereLight(profile.sky,profile.ground,profile.hemisphereIntensity*.88));
const key=new THREE.DirectionalLight(profile.key,profile.keyIntensity);key.position.copy(profile.keyDirection).multiplyScalar(100);scene.add(key);
const rim=new THREE.DirectionalLight(profile.rim,profile.rimIntensity*1.35);rim.position.set(-100,25,-80);scene.add(rim);
const fog=course.fogAt(progress);scene.fog=new THREE.FogExp2(fog.color,fog.density);scene.background=fog.color;
world.sky.update(camera,course.tide.waterLevel,0,fog.color);
camera.updateMatrixWorld();environment.updateVisibility(camera);
if(query.has('hideWater'))scene.getObjectByName('tideline_water_surface')!.visible=false;
if(meter) {
  // Measure road response alone: identical top-down geometry, real lights, no
  // transparent roof/water occlusion. This is explicitly not a gameplay frame.
  for(const name of ["tideline_aqueduct_glazing","tideline_water_surface","tideline_exterior_particulate"]) {
    const object=scene.getObjectByName(name);if(object)object.visible=false;
  }
}
await renderer.compileAsync(scene,camera);renderer.render(scene,camera);
const lights:THREE.PointLight[]=[];scene.traverse(o=>{if(o instanceof THREE.PointLight)lights.push(o);});
const pixels=(lateral:number,forward:number)=>{
 const point=sample.position.clone().addScaledVector(sample.right,lateral).addScaledVector(sample.tangent,forward).project(camera);
 return {x:Math.round((point.x*.5+.5)*1280),y:Math.round((-.5*point.y+.5)*720)};
};
document.getElementById("review-state")!.textContent=JSON.stringify({ready:true,lap,station,progress,elapsed,seed:3868938316,meter,camera:camera.position.toArray(),waterLevel:course.tide.waterLevel,pointLights:lights.length,lightIntensities:lights.map(l=>l.intensity),roadPatches:{under:pixels(8,0),between:pixels(8,15)},calls:renderer.info.render.calls,triangles:renderer.info.render.triangles});

// Isolated V4 evidence surface: the same AgX exposure as gameplay.
const aim=camera.getWorldDirection(new THREE.Vector3());
Object.assign(window,{tidelineReview:{scene,course,world,environment,renderer,camera,
 render(yaw=0,skyOnly=false) {
  const direction=aim.clone().applyAxisAngle(new THREE.Vector3(0,1,0),yaw);
  camera.lookAt(camera.position.clone().add(direction));camera.updateMatrixWorld();
  environment.updateVisibility(camera);world.sky.update(camera,course.tide.waterLevel,0,fog.color);
  if(skyOnly){const isolated=new THREE.Scene();isolated.add(world.sky.root);renderer.render(isolated,camera);world.root.add(world.sky.root);}
  else renderer.render(scene,camera);
 }
}});
