import * as THREE from 'three';
import {AscensionCourse} from '../../../src/game/ascension-course';
import {AscensionPaintedEnvironment as AscensionEnvironment} from '../../../src/game/ascension-painted-environment';
import {AscensionRuntime} from '../../../src/game/ascension-runtime';
import {InputController} from '../../../src/game/input';
import {configureToneMapping} from '../../../src/game/atmosphere';
const course=new AscensionCourse(),scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(62,1280/720,.1,2000);
const renderer=new THREE.WebGLRenderer({antialias:true});renderer.setSize(1280,720);renderer.outputColorSpace=THREE.SRGBColorSpace;configureToneMapping(renderer);document.body.append(renderer.domElement);
const environment=await AscensionEnvironment.load(),runtime=new AscensionRuntime(course,new InputController());scene.add(course.group,environment.root);await runtime.ready;
const light=course.lightingAt(),hemi=new THREE.HemisphereLight(light.sky,light.ground,light.hemisphereIntensity),key=new THREE.DirectionalLight(light.key,light.keyIntensity),rim=new THREE.DirectionalLight(light.rim,light.rimIntensity);key.position.copy(light.keyDirection).multiplyScalar(100);rim.position.copy(light.keyDirection).multiplyScalar(-100);scene.add(hemi,key,rim);
const parameters=new URLSearchParams(location.search),progress=Number(parameters.get('progress')??.04),tick=Number(parameters.get('tick')??0),board=parameters.get('board');
course.advanceSchedule(tick);
const s=parameters.has('trench')?course.sampleShortcut(progress):course.sample(progress);
if(board){const b=course.sample(board==='1'?150/course.length:.8);const approach=course.sample(((board==='1'?150/course.length:.8)-165/course.length+1)%1);camera.position.copy(approach.position);camera.position.y+=2.4;camera.lookAt(camera.position.clone().addScaledVector(approach.tangent,100));}
else{camera.position.copy(s.position).addScaledVector(s.tangent,-11.5);camera.position.y+=5.76;camera.lookAt(s.position.clone().addScaledVector(s.tangent,19).addScaledVector(s.up,2.11));}
if(parameters.has('yaw')){camera.position.copy(s.position).addScaledVector(s.up,2.4);const yaw=Number(parameters.get('yaw'))*Math.PI/180;camera.lookAt(camera.position.clone().add(new THREE.Vector3(Math.sin(yaw),.08,-Math.cos(yaw))));}
const fog=course.fogAt(progress);scene.fog=new THREE.FogExp2(fog.color,fog.density);scene.background=fog.color.clone();course.project(s.position,progress);runtime.updateHud(progress);scene.updateMatrixWorld(true);environment.updateVisibility(camera);if(parameters.has('skyMask')){scene.background=new THREE.Color(0xffffff);scene.fog=null;scene.traverse(o=>{if(o instanceof THREE.Mesh){if(o.name==='ascension_dawn_panorama')o.visible=false;else o.material=new THREE.MeshBasicMaterial({color:0x000000,side:THREE.DoubleSide,toneMapped:false,fog:false});}});}
renderer.render(scene,camera);
const state={script:'scripts/visual/ascension/review.ts',scope:'Static painted evidence station; production course, board and environment geometry, course lights, fog and tone mapping. No running race or vehicle.',progress,tick,sector:course.sectorLabelAt(progress),trench:parameters.has('trench'),board,boardDistance:board?camera.position.distanceTo(course.sample(board==='1'?150/course.length:.8).position):null,camera:camera.position.toArray(),schedule:course.schedule.state,render:{calls:renderer.info.render.calls,triangles:renderer.info.render.triangles}};
const output=document.createElement('output');output.id='review-state';output.textContent=JSON.stringify(state);document.body.append(output);
