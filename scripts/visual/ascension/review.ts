import * as THREE from 'three';
import {AscensionEventPose} from '../../../src/game/ascension-event-pose.js';
import {AscensionCourse} from '../../../src/game/ascension-course';
import {AscensionPaintedEnvironment as AscensionEnvironment} from '../../../src/game/ascension-painted-environment';
import {AscensionRuntime} from '../../../src/game/ascension-runtime';
import {InputController} from '../../../src/game/input';
import {configureToneMapping} from '../../../src/game/atmosphere';
const course=new AscensionCourse(),scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(62,1280/720,.1,2000);
const renderer=new THREE.WebGLRenderer({antialias:true});renderer.setSize(1280,720);renderer.outputColorSpace=THREE.SRGBColorSpace;configureToneMapping(renderer);document.body.append(renderer.domElement);
const environment=await AscensionEnvironment.load(course),runtime=new AscensionRuntime(course,new InputController());scene.add(course.group,environment.root);await runtime.ready;
const light=course.lightingAt(),hemi=new THREE.HemisphereLight(light.sky,light.ground,light.hemisphereIntensity),key=new THREE.DirectionalLight(light.key,light.keyIntensity),rim=new THREE.DirectionalLight(light.rim,light.rimIntensity);key.position.copy(light.keyDirection).multiplyScalar(100);rim.position.copy(light.keyDirection).multiplyScalar(-100);scene.add(hemi,key,rim);
const parameters=new URLSearchParams(location.search),progress=Number(parameters.get('progress')??.04),tick=Number(parameters.get('tick')??0),board=parameters.get('board');
course.advanceSchedule(tick);
const s=parameters.has('trench')?course.sampleShortcut(progress):course.sample(progress);
if(board){const b=course.sample(board==='1'?150/course.length:.8);const approach=course.sample(((board==='1'?150/course.length:.8)-150/course.length+1)%1);camera.position.copy(b.position).addScaledVector(approach.position.clone().sub(b.position).normalize(),Math.sqrt(150*150-2.4*2.4));camera.position.y+=2.4;camera.lookAt(camera.position.clone().addScaledVector(approach.tangent,100));}
else{camera.position.copy(s.position).addScaledVector(s.tangent,parameters.has('transition')?-32:-11.5);camera.position.y+=5.76;camera.lookAt(s.position.clone().addScaledVector(s.tangent,19).addScaledVector(s.up,2.11));}
if(parameters.get('target')==='pad'){const pad=environment.root.getObjectByName('rocket-platform_0')!;camera.position.copy(s.position).addScaledVector(s.up,2.4);camera.lookAt(pad.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0,80+(course.schedule.state.rocketGone?0:new AscensionEventPose(course.schedule.config!,new THREE.Vector3()).at(tick).rocketHeight*.5),0)));}
if(parameters.has('yaw')){camera.position.copy(s.position).addScaledVector(s.up,2.4);const yaw=Number(parameters.get('yaw'))*Math.PI/180;camera.lookAt(camera.position.clone().add(new THREE.Vector3(Math.sin(yaw),.08,-Math.cos(yaw))));}
const fog=course.fogAt(progress);scene.fog=new THREE.FogExp2(fog.color,fog.density);scene.background=fog.color.clone();course.project(s.position,progress);runtime.updateHud(progress);scene.updateMatrixWorld(true);environment.updateVisibility(camera);if(parameters.has('skyMask')){scene.background=new THREE.Color(0xffffff);scene.fog=null;scene.traverse(o=>{if(o instanceof THREE.Mesh){if(o.name==='ascension_dawn_panorama')o.visible=false;else{const source=o.material as THREE.Material;const mask=source.clone();mask.toneMapped=false;(mask as any).fog=false;const original=source.onBeforeCompile.bind(source);mask.customProgramCacheKey=()=>source.customProgramCacheKey()+'-alpha-preserving-sky-mask';mask.onBeforeCompile=(shader,r)=>{original(shader,r);const end=shader.fragmentShader.lastIndexOf('}');shader.fragmentShader=shader.fragmentShader.slice(0,end)+'\ngl_FragColor.rgb=vec3(0.0);\n'+shader.fragmentShader.slice(end);};o.material=mask;}}});}
renderer.render(scene,camera);
// Read actual GPU pixels at projected digit and background texels, after the first render.
// The expected glyph mask selects samples; it cannot make a black GPU board pass.
let boardLegibility:unknown=null;
if(board){
 const display=scene.getObjectByName('ascension_board_displays') as THREE.InstancedMesh;
 const paint=(display.material as THREE.MeshLambertMaterial).map!.image as HTMLCanvasElement;
 const glyph=paint.getContext('2d')!.getImageData(0,0,1024,256).data;
 const matrix=new THREE.Matrix4();display.getMatrixAt(Number(board)-1,matrix);matrix.premultiply(display.matrixWorld);
 const gl=renderer.getContext(),pixels=new Uint8Array(1280*720*4);gl.readPixels(0,0,1280,720,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
 const bright:number[]=[],dark:number[]=[],seen=new Set<number>();
 for(let y=48;y<142;y+=3)for(let x=180;x<844;x+=3){
  const point=new THREE.Vector3((x/1024-.5)*26.4,(.5-y/256)*7,0).applyMatrix4(matrix).project(camera);
  const px=Math.round((point.x*.5+.5)*1280),py=Math.round((point.y*.5+.5)*720);
  if(px<0||px>=1280||py<0||py>=720||point.z>1)continue;
  const at=(py*1280+px)*4;if(seen.has(at))continue;seen.add(at);
  const luma=.2126*pixels[at]+.7152*pixels[at+1]+.0722*pixels[at+2];
  (glyph[(y*1024+x)*4]>200?bright:dark).push(luma);
 }
 const mean=(values:number[])=>values.reduce((a,b)=>a+b,0)/Math.max(1,values.length);
 boardLegibility={digitSamples:bright.length,backgroundSamples:dark.length,digitLuma:mean(bright),backgroundLuma:mean(dark),contrast:mean(bright)-mean(dark),pass:bright.length>=15&&mean(bright)>80&&mean(bright)-mean(dark)>8};
}
const instances:unknown[]=[];scene.traverse(o=>{if(o instanceof THREE.InstancedMesh)instances.push({name:o.name,count:o.count,trianglesPerInstance:(o.geometry.index?.count??o.geometry.attributes.position.count)/3});});
const state={egrets:course.group.userData.egrets,boardLegibility,cameraTarget:parameters.get('target')??'road',effects:environment.root.getObjectByName('ascension_scheduled_effects')?.userData.eventState,instances,script:'scripts/visual/ascension/review.ts',scope:'Schedule-frozen evidence station; production course, board, authored environment and event poses, course lights, fog and tone mapping. No running race or vehicle. The optional pad camera tracks ascent from a fixed chase-height station and is not the driving camera.',progress,tick,sector:course.sectorLabelAt(progress),trench:parameters.has('trench'),board,boardDistance:board?camera.position.distanceTo(course.sample(board==='1'?150/course.length:.8).position):null,camera:camera.position.toArray(),schedule:course.schedule.state,render:{calls:renderer.info.render.calls,triangles:renderer.info.render.triangles}};
const output=document.createElement('output');output.id='review-state';output.textContent=JSON.stringify(state);document.body.append(output);

Object.assign(window,{__ascReview:{course,scene,camera,renderer,environment,runtime}});
