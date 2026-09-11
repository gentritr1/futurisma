import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {AscensionCourse} from '../../../src/game/ascension-course';
import {AscensionPaintedEnvironment} from '../../../src/game/ascension-painted-environment';
import {configureToneMapping} from '../../../src/game/atmosphere';
import {applyAscensionOrganicCutout} from '../../../src/game/ascension-materials';

// Inspection only: production level and device, translated to the Tank Farm road edge.
// Signal geometry below is an explicitly unshipped proposal.
const query=new URLSearchParams(location.search),signal=query.has('signal'),far=query.has('far');
const course=new AscensionCourse(),world=await AscensionPaintedEnvironment.load(course);
const scene=new THREE.Scene();scene.add(course.group,world.root);
const station=course.sample(.94),fog=course.fogAt(.94),light=course.lightingAt(.94);
scene.fog=new THREE.FogExp2(fog.color,fog.density);scene.background=fog.color.clone();
const key=new THREE.DirectionalLight(light.key,light.keyIntensity),rim=new THREE.DirectionalLight(light.rim,light.rimIntensity);
key.position.copy(light.keyDirection).multiplyScalar(100);rim.position.copy(light.keyDirection).multiplyScalar(-100);
scene.add(new THREE.HemisphereLight(light.sky,light.ground,light.hemisphereIntensity),key,rim);
const loaded=(await new GLTFLoader().loadAsync('/assets/ascension/power-kit.glb')).scene;
const device=loaded.getObjectByName('PK_shield')!;device.removeFromParent();
device.traverse(o=>{if(o instanceof THREE.Mesh){const old=o.material as THREE.MeshStandardMaterial;
 o.material=new THREE.MeshLambertMaterial({name:old.name,color:old.color,map:old.map,emissive:old.emissive,emissiveMap:old.emissiveMap,emissiveIntensity:old.emissiveIntensity,vertexColors:true,side:THREE.DoubleSide});
 applyAscensionOrganicCutout(o.material);
 if(signal&&old.name==='AP_MAT_emissive'){o.material.color.setHex(0x69dce0);o.material.emissive.setHex(0x69dce0);}
}});
const box=new THREE.Box3().setFromObject(device),size=box.getSize(new THREE.Vector3()),center=box.getCenter(new THREE.Vector3());
device.position.sub(new THREE.Vector3(center.x,box.min.y,center.z));
const holder=new THREE.Group();holder.add(device);holder.position.copy(station.position).addScaledVector(station.right,8);
// Front faces the approaching road direction. Close inspection is 15 degrees off axis.
const facing=station.tangent.clone().negate();holder.rotation.y=Math.atan2(facing.x,facing.z);scene.add(holder);
if(signal){
 const paint=document.createElement('canvas');paint.width=256;paint.height=320;const c=paint.getContext('2d')!;
 c.fillStyle='#28332b';c.fillRect(0,0,256,320);c.strokeStyle='#f1eedb';c.lineWidth=24;
 c.beginPath();c.moveTo(40,40);c.lineTo(216,40);c.lineTo(216,168);c.quadraticCurveTo(216,230,128,280);c.quadraticCurveTo(40,230,40,168);c.closePath();c.fillStyle='#69dce0';c.fill();c.stroke();
 const texture=new THREE.CanvasTexture(paint);texture.colorSpace=THREE.SRGBColorSpace;
 const marker=new THREE.Mesh(new THREE.PlaneGeometry(2.4,3.2),new THREE.MeshLambertMaterial({map:texture,emissiveMap:texture,emissive:0x69dce0,emissiveIntensity:.3,side:THREE.DoubleSide}));marker.position.set(0,4.2,-.45);holder.add(marker);
 const metal=new THREE.MeshLambertMaterial({color:0x58614a});
 for(const x of [-1.15,1.15]){const post=new THREE.Mesh(new THREE.BoxGeometry(.08,5.9,.08),metal);post.position.set(x,2.95,-.5);holder.add(post);}
}
const camera=new THREE.PerspectiveCamera(62,1280/720,.1,2000);
const distance=far?120:2.35,eye=far?2.4:1.6;
const approach=facing.clone().applyAxisAngle(new THREE.Vector3(0,1,0),far?0:-25*Math.PI/180);
camera.position.copy(holder.position).addScaledVector(approach,distance);camera.position.y+=eye;
if(far){
 let low=0,high=.15;
 for(let i=0;i<40;i++){const gap=(low+high)/2,s=course.sample(.94-gap),p=s.position.clone().addScaledVector(s.right,8);p.y=holder.position.y;if(p.distanceTo(holder.position)<120)low=gap;else high=gap;}
 const s=course.sample(.94-(low+high)/2);camera.position.copy(s.position).addScaledVector(s.right,8);camera.position.y+=eye;
}
const target=holder.position.clone().add(new THREE.Vector3(0,far?1.6:.72,0));
if(!far)target.addScaledVector(station.right,.5);
camera.lookAt(target);
// Match the generated hero's full-device screen height and centre without scaling the model.
// These image-space anchors are a visual annotation, not recoverable hero camera metadata.
scene.updateMatrixWorld(true);
function devicePixels(){
 const points:THREE.Vector3[]=[];
 device.traverse(o=>{if(o instanceof THREE.Mesh){const p=o.geometry.getAttribute('position');for(let i=0;i<p.count;i++)points.push(new THREE.Vector3().fromBufferAttribute(p,i).applyMatrix4(o.matrixWorld).project(camera));}});
 return {left:Math.min(...points.map(p=>(p.x*.5+.5)*1280)),right:Math.max(...points.map(p=>(p.x*.5+.5)*1280)),top:Math.min(...points.map(p=>(.5-p.y*.5)*720)),bottom:Math.max(...points.map(p=>(.5-p.y*.5)*720))};
}
camera.updateMatrixWorld(true);
const renderer=new THREE.WebGLRenderer({antialias:true});renderer.setSize(1280,720);renderer.outputColorSpace=THREE.SRGBColorSpace;configureToneMapping(renderer);document.body.append(renderer.domElement);
scene.updateMatrixWorld(true);world.updateVisibility(camera);renderer.render(scene,camera);
const projected: number[][]=[];const worldBox=new THREE.Box3().setFromObject(device);
for(const x of [worldBox.min.x,worldBox.max.x])for(const y of [worldBox.min.y,worldBox.max.y])for(const z of [worldBox.min.z,worldBox.max.z]){const p=new THREE.Vector3(x,y,z).project(camera);projected.push([(p.x*.5+.5)*1280,(.5-p.y*.5)*720]);}
const violations:string[]=[];scene.traverse(o=>{if(o instanceof THREE.Mesh)for(const m of Array.isArray(o.material)?o.material:[o.material])if(o.name!=='ascension_dawn_panorama'&&(!m.fog||!m.toneMapped))violations.push(o.name);});
Object.assign(window,{__deviceReview:{script:'scripts/visual/ascension/device-review.ts',signal,far,progress:.94,eyeMetres:eye,horizontalStandOffMetres:Math.hypot(camera.position.x-holder.position.x,camera.position.z-holder.position.z),camera:camera.position.toArray(),target:target.toArray(),devicePosition:holder.position.toArray(),dimensions:size.toArray(),fovDegrees:62,fog:{color:fog.color.getHexString(),density:fog.density},projectedBounds:devicePixels(),heroFramingAnchor:far?null:{method:'Eye-level three-quarter inspection, manually matched to the generated hero. Original hero camera distance is unknown; no exact match claim.'},marker:signal?{widthMetres:2.4,heightMetres:3.2,centerHeightMetres:4.2}:null,violations,backgroundException:'Existing Ascension sky panorama uses its approved horizon haze blend.',scope:'Real level road, lights, fog and tone mapping; current device geometry/materials unchanged in control. Signal condition adds unshipped marker and cyan glass proposal. Near framing calibrated visually; generated hero has no recoverable camera metadata.'}});
