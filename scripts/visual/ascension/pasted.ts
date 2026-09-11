import * as THREE from 'three';
import {applyTidelineRenderRule} from '../../../src/game/tideline-render-rule';
import {TidelinePowerField} from '../../../src/game/tideline-power-field';
import {TotemVehicle} from '../../../src/game/totem';
import {loadVehicleForRace} from '../../../src/game/race-presentation-setup';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {AscensionCourse} from '../../../src/game/ascension-course';
import {AscensionPaintedEnvironment} from '../../../src/game/ascension-painted-environment';
import {AscensionRuntime} from '../../../src/game/ascension-runtime';
import {InputController} from '../../../src/game/input';
import {applyAscensionOrganicCutout} from '../../../src/game/ascension-materials';
import {configureToneMapping} from '../../../src/game/atmosphere';
const q=new URLSearchParams(location.search),id=q.get('object')!,distanceIndex=Number(q.get('distance')??0);
const course=new AscensionCourse(),world=await AscensionPaintedEnvironment.load(course),runtime=new AscensionRuntime(course,new InputController());await runtime.ready;
const camera=new THREE.PerspectiveCamera(62,1280/720,.1,3000);camera.position.set(0,2.4,60);
const tick=id==='flood'?course.schedule.config!.reopenTick+120:course.schedule.config!.launchTick+120;course.advanceSchedule(tick);runtime.updateHud(.1);world.updateVisibility(camera);course.group.updateMatrixWorld(true);world.root.updateMatrixWorld(true);
const loader=new GLTFLoader();
function paint(root:THREE.Object3D){root.traverse(o=>{if(o instanceof THREE.Mesh){const m=o.material as THREE.MeshStandardMaterial;o.material=new THREE.MeshLambertMaterial({name:m.name,color:m.color,map:m.map,emissive:m.emissive,emissiveMap:m.emissiveMap,emissiveIntensity:m.emissiveIntensity,vertexColors:!!o.geometry.attributes.color,side:THREE.DoubleSide});applyAscensionOrganicCutout(o.material);}});}
const names:Record<string,string>={'cradle-pad':'tideline_cradle_0','cradle-trench':'tideline_cradle_1','cradle-causeway':'tideline_cradle_2','cradle-tank':'tideline_cradle_3','strip-pad':'launch_strip_pad-road','strip-causeway':'launch_strip_causeway','bulkhead-trench':'bulkhead_trench-exit','bulkhead-tank':'bulkhead_tank-farm','steam':'launch_apron_steam_wall','smoke':'persistent_launch_smoke','deluge':'deluge_water_sheets','flame':'launch_flame_column','engine-glow':'rocket_engine_glow','gravel':'crawler_shed_gravel','flood':'trench_flood_water'};
let asset:THREE.Object3D;
if(id.startsWith('rival-')){const field=new TidelinePowerField();field.update(1,false,id==='rival-surge',id==='rival-shield',true);asset=field.root;applyTidelineRenderRule(asset)();asset.updateMatrixWorld(true);}
else if(id.startsWith('craft-')){const vehicle=new TotemVehicle();await loadVehicleForRace(vehicle,'ascension');const sync=applyTidelineRenderRule(vehicle.root);vehicle.updateVisual({throttle:1,brake:0,speedRatio:1,boostActive:id==='craft-nitro',driftIntensity:id==='craft-wet-drift'?.8:0,surfaceGrip:id==='craft-wet-drift'?.72:1,reducedMotion:false,elapsed:2,delta:1/60,steer:0,lateralLoad:0,shieldActive:id==='craft-shield',overdriveActive:id==='craft-surge',heldPowerKind:id==='craft-shield'?'shield':'surge',powerCharge:1,powerActivation:1});sync();asset=vehicle.root;asset.updateMatrixWorld(true);}
else if(id==='entry-rail')asset=(runtime as any).entryRail;
else if(id==='gate-marker')asset=(course as any).gates;
else if(names[id])asset=course.group.getObjectByName(names[id])??world.root.getObjectByName(names[id])!;
else{const glb=(await loader.loadAsync('/assets/ascension/'+(['surge','shield'].includes(id)?'power-kit':id)+'.glb')).scene;paint(glb);asset=['surge','shield'].includes(id)?glb.getObjectByName('PK_'+id)!:glb;}
if(!asset)throw Error('Missing pasted-on object '+id);
let representativeInstance:number|null=null;
if(['steam','smoke','deluge','gravel','gate-marker'].includes(id)){
 const batch=asset as THREE.InstancedMesh;representativeInstance=0;const matrix=new THREE.Matrix4();batch.getMatrixAt(0,matrix);matrix.premultiply(batch.matrixWorld);const part=new THREE.Mesh(batch.geometry,batch.material);matrix.decompose(part.position,part.quaternion,part.scale);asset=part;
}else{const matrix=asset.matrixWorld.clone();asset.removeFromParent();matrix.decompose(asset.position,asset.quaternion,asset.scale);}
asset.visible=true;
const holder=new THREE.Group();holder.add(asset);holder.updateMatrixWorld(true);const box=new THREE.Box3().setFromObject(holder),size=box.getSize(new THREE.Vector3()),center=box.getCenter(new THREE.Vector3());holder.position.set(-center.x,-box.min.y,-center.z);
const board=(await loader.loadAsync('/assets/ascension/countdown-board.glb')).scene;paint(board);board.position.x=-(size.x/2+16);
const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=256;const ctx=canvas.getContext('2d')!;ctx.fillStyle='#263125';ctx.fillRect(0,0,1024,256);ctx.fillStyle='#ffda98';ctx.textAlign='center';ctx.font='bold 140px monospace';ctx.fillText('T−01:09',512,145);ctx.font='bold 55px monospace';ctx.fillText('PAD 09 / TRENCH OPEN',512,226);const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;const screen=new THREE.Mesh(new THREE.PlaneGeometry(8.8,3.5),new THREE.MeshLambertMaterial({map:texture,emissiveMap:texture,emissive:0xffffff,emissiveIntensity:.45}));screen.position.set(0,8,.96);board.add(screen);
const scene=new THREE.Scene();scene.add(holder,board);const light=course.lightingAt(),key=new THREE.DirectionalLight(light.key,light.keyIntensity),rim=new THREE.DirectionalLight(light.rim,light.rimIntensity);key.position.copy(light.keyDirection).multiplyScalar(100);rim.position.copy(light.keyDirection).multiplyScalar(-100);scene.add(new THREE.HemisphereLight(light.sky,light.ground,light.hemisphereIntensity),key,rim);
const fog=course.fogAt(0);scene.fog=new THREE.FogExp2(fog.color,fog.density);scene.background=fog.color.clone();const groundPaint=await new THREE.TextureLoader().loadAsync('/assets/ascension/textures/concrete.jpg');groundPaint.colorSpace=THREE.SRGBColorSpace;groundPaint.wrapS=groundPaint.wrapT=THREE.RepeatWrapping;groundPaint.repeat.set(60,60);const floor=new THREE.Mesh(new THREE.PlaneGeometry(3000,3000),new THREE.MeshLambertMaterial({map:groundPaint,color:0x8c8877}));floor.rotation.x=-Math.PI/2;floor.position.y=-.05;scene.add(floor);
const distance=Math.max(35,(size.x+32)*.8,size.y*1.3)+distanceIndex*75;camera.position.set(-8,2.4,distance);camera.lookAt(-8,Math.max(4,size.y*.35),0);
const renderer=new THREE.WebGLRenderer({antialias:true});renderer.setSize(1280,720);renderer.outputColorSpace=THREE.SRGBColorSpace;configureToneMapping(renderer);document.body.append(renderer.domElement);renderer.render(scene,camera);
const materials:unknown[]=[],violations:string[]=[];scene.traverse(o=>{if(o instanceof THREE.Mesh||o instanceof THREE.Points)for(const m of Array.isArray(o.material)?o.material:[o.material]){materials.push({object:o.name,material:m.name,fog:m.fog,toneMapped:m.toneMapped});if(m.fog===false||m.toneMapped===false)violations.push(o.name+':'+m.name);}});
Object.assign(window,{__pastedState:{script:'scripts/visual/ascension/pasted.ts',id,distanceIndex,distance,camera:camera.position.toArray(),dimensions:size.toArray(),representativeInstance,scope:'Production geometry/materials at original scale, translated beside the authored board. Camera height 2.4 m, shared course lights/fog/tone mapping. Instanced effects show one representative instance of their shared material.',materials,violations}});
if(violations.length)throw Error('Pasted-on material walk failed');
