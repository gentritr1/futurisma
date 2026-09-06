import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {AscensionCourse} from '../../../src/game/ascension-course';
import {applyAscensionOrganicCutout} from '../../../src/game/ascension-materials';
import {AscensionSky} from '../../../src/game/ascension-sky';
import {configureToneMapping} from '../../../src/game/atmosphere';
const parameters=new URLSearchParams(location.search),id=parameters.get('asset')??'crawler-transporter',device=parameters.get('device');
const course=new AscensionCourse(),scene=new THREE.Scene(),renderer=new THREE.WebGLRenderer({antialias:true});
renderer.setSize(1280,720);renderer.outputColorSpace=THREE.SRGBColorSpace;configureToneMapping(renderer);document.body.append(renderer.domElement);
const loaded=(await new GLTFLoader().loadAsync('/assets/ascension/'+id+'.glb')).scene;
const asset=device?loaded.getObjectByName('PK_'+device)!:loaded;asset.removeFromParent();
const materials:object[]=[];asset.traverse(o=>{if(o instanceof THREE.Mesh){const m=o.material as THREE.MeshStandardMaterial;o.material=new THREE.MeshLambertMaterial({name:m.name,color:m.color,map:m.map,emissive:m.emissive,emissiveMap:m.emissiveMap,emissiveIntensity:m.emissiveIntensity,vertexColors:true,side:THREE.DoubleSide});applyAscensionOrganicCutout(o.material);materials.push({name:m.name,toneMapped:o.material.toneMapped,fog:o.material.fog});}});scene.add(asset);
if(id==='countdown-board'){
 const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=256;const c=canvas.getContext('2d')!;
 c.fillStyle='#263125';c.fillRect(0,0,1024,256);c.fillStyle='#ffda98';c.textAlign='center';c.font='bold 140px monospace';c.fillText('T−01:09',512,145);c.font='bold 55px monospace';c.fillText('PAD 09 / TRENCH OPEN',512,226);
 const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
 const display=new THREE.Mesh(new THREE.PlaneGeometry(8.8,3.5),new THREE.MeshLambertMaterial({map:texture,emissiveMap:texture,emissive:0xffffff,emissiveIntensity:.45}));display.position.set(0,8,.96);asset.add(display);
}
const light=course.lightingAt(),hemi=new THREE.HemisphereLight(light.sky,light.ground,light.hemisphereIntensity),key=new THREE.DirectionalLight(light.key,light.keyIntensity),rim=new THREE.DirectionalLight(light.rim,light.rimIntensity);key.position.copy(light.keyDirection).multiplyScalar(100);rim.position.copy(light.keyDirection).multiplyScalar(-100);scene.add(hemi,key,rim);
const box=new THREE.Box3().setFromObject(asset),size=box.getSize(new THREE.Vector3()),center=box.getCenter(new THREE.Vector3());
const camera=new THREE.PerspectiveCamera(62,1280/720,.1,2000),distance=Math.max(size.x*.65,size.y*.95,size.z*.4);
if(id==='egret-card-set')asset.position.y=2.2;
camera.position.set(center.x+size.x*.22,2.4,box.max.z+distance);camera.lookAt(center.x,id==='egret-card-set'?2.3:Math.max(1,center.y),center.z);
const fog=course.fogAt(0);scene.fog=new THREE.FogExp2(fog.color,fog.density);scene.background=fog.color.clone();
const ground=new THREE.Mesh(new THREE.PlaneGeometry(500,500),new THREE.MeshLambertMaterial({color:0x85867b}));ground.rotation.x=-Math.PI/2;ground.position.y=box.min.y-.15;scene.add(ground);
const sky=new AscensionSky();await sky.ready;scene.add(sky.root);sky.update(camera,fog.color);scene.updateMatrixWorld(true);renderer.render(scene,camera);
const output=document.createElement('output');output.id='asset-state';output.hidden=true;output.textContent=JSON.stringify({script:'scripts/visual/ascension/assets.ts',asset:device??id,camera:camera.position.toArray(),dimensions:size.toArray(),materials,render:{calls:renderer.info.render.calls,triangles:renderer.info.render.triangles}});document.body.append(output);
