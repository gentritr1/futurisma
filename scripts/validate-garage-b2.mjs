import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformWithOxc } from 'vite';
import * as THREE from 'three';
import { defaultGarage, defaultFit, FRAME_CODES, PART_CODES } from '../src/game/garage-rules.js';
import { buyFrame, buyPart } from '../src/game/garage-economy.js';
import { rewardFrame, rewardState } from '../src/game/garage-reward-rules.js';

// The real commerce rules drive offers; previews never mutate these inputs.
const garage=defaultGarage(); garage.credits=3421; garage.contracts.done=20;
for(const code of ['lance','sidewinder','bulwark']) garage.fleet[code]=defaultFit();
assert.equal(rewardFrame(garage,3000),'corona');
assert.equal(rewardState(garage,'corona').kind,'affordable');
const bought=buyFrame(garage,'corona');
assert.equal(bought.ok,true); assert.equal(bought.garage.credits,221);
assert.equal(rewardState(bought.garage,'corona').kind,'owned');
assert.equal(garage.credits,3421, 'offering or buying must not mutate the previous save');
const spent={...garage,credits:1921};
assert.deepEqual(rewardState(spent,'corona'),{kind:'short',short:1279});
assert.equal(buyFrame(spent,'corona').ok,false);
const poor=defaultGarage();poor.credits=10;
assert.equal(buyPart(poor,'engine').ok,false);assert.equal(poor.credits,10);

const moduleURL = code => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
const threeURL=import.meta.resolve('three');
async function compile(path, replacements={}) {
 let text=readFileSync(new URL(`../${path}`,import.meta.url),'utf8');
 for(const [from,to] of Object.entries({'"three"':JSON.stringify(threeURL),...replacements})) text=text.replaceAll(from,to);
 return moduleURL((await transformWithOxc(text,path)).code);
}
const anchorsURL=await compile('src/game/garage-anchors.ts');
const {partAnchor,FRAME_ANCHORS}=await import(anchorsURL);
const upgradesURL=await compile('src/game/garage-upgrades.ts',{'"./garage-anchors"':JSON.stringify(anchorsURL),'"three/addons/utils/BufferGeometryUtils.js"':JSON.stringify(import.meta.resolve('three/addons/utils/BufferGeometryUtils.js'))});
const {fitUpgradeHardware,seatPowerHardpoints}=await import(upgradesURL);
const hullModule=moduleURL('export const showroomHull=()=>globalThis.b2TestHull;');
const sceneURL=await compile('src/game/garage-scene.ts',{'"./garage-anchors"':JSON.stringify(anchorsURL),'"./garage-look"':JSON.stringify(hullModule)});

// Decode real shipped positions/indices and node matrices, without a WebGL
// context or a mock hull. Textures are irrelevant to projection/occlusion.
function model(path) {
 const file=readFileSync(new URL(`../public/assets/${path}`,import.meta.url));
 const length=file.readUInt32LE(12), gltf=JSON.parse(file.subarray(20,20+length));
 const binary=file.subarray(28+length);
 const sizes={SCALAR:1,VEC2:2,VEC3:3,VEC4:4};
 const types={5121:Uint8Array,5123:Uint16Array,5125:Uint32Array,5126:Float32Array};
 function attribute(index) {
  const acc=gltf.accessors[index],view=gltf.bufferViews[acc.bufferView],Type=types[acc.componentType],size=sizes[acc.type];
  const start=(view.byteOffset??0)+(acc.byteOffset??0),bytes=Type.BYTES_PER_ELEMENT;
  const values=new Type(acc.count*size);
  for(let i=0;i<acc.count;i++) for(let k=0;k<size;k++) {
   const at=start+i*(view.byteStride??size*bytes)+k*bytes;
   values[i*size+k]=new Type(binary.buffer.slice(binary.byteOffset+at,binary.byteOffset+at+bytes))[0];
  }
  return new THREE.BufferAttribute(values,size);
 }
 const nodes=gltf.nodes.map(n=>{
  const object=new THREE.Group();object.name=n.name??'';
  if(n.matrix) new THREE.Matrix4().fromArray(n.matrix).decompose(object.position,object.quaternion,object.scale);
  else {if(n.translation)object.position.fromArray(n.translation);if(n.rotation)object.quaternion.fromArray(n.rotation);if(n.scale)object.scale.fromArray(n.scale);}
  if(n.mesh!==undefined) for(const primitive of gltf.meshes[n.mesh].primitives){
   if(n.name==='collision_proxy'||gltf.materials?.[primitive.material]?.name==='TOTEM_collision')continue;
   const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',attribute(primitive.attributes.POSITION));
   if(primitive.indices!==undefined)geometry.setIndex(attribute(primitive.indices));
   const mesh=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({side:gltf.materials?.[primitive.material]?.doubleSided?THREE.DoubleSide:THREE.FrontSide}));mesh.name=object.name;object.add(mesh);
  }
  return object;
 });
 gltf.nodes.forEach((n,i)=>n.children?.forEach(child=>nodes[i].add(nodes[child])));
 const root=new THREE.Group();root.name=gltf.scenes[gltf.scene??0].name??'';for(const index of gltf.scenes[gltf.scene??0].nodes)root.add(nodes[index]);return root;
}
const context={clearRect(){},fillText(){}};
globalThis.document={createElement:()=>({width:0,height:0,getContext:()=>context})};
globalThis.window={innerWidth:1280,innerHeight:800};
const {GarageScene}=await import(sceneURL);
const failures=[];let projections=0, hardwareDraws=0, hardwareTriangles=0;
for(const frame of FRAME_CODES){
 const hull=new THREE.Group(), parent=new THREE.Group();parent.add(hull);globalThis.b2TestHull=hull;
 const body=model(frame==='totem'?'totem/models/totem_runtime.glb':`garage/frames/${frame}.glb`);
 if(frame==='totem')body.name='TOTEM_runtime';hull.add(body);
 if(frame==='totem')hull.add(model('totem-evolution/totem_evolution.glb'));
 // Every saved stage creates real hardware; stock removes it without leaving
 // parts in cached frames. Attachments inherit their parent pivot's motion.
 const counts=[];
 for(let stage=1;stage<=3;stage++){
  const fitted=defaultFit();for(const part of PART_CODES)fitted.parts[part]=stage;
  const groups=fitUpgradeHardware(hull,frame,fitted);
  assert.ok(groups.length>=7,`${frame}: all upgrade assemblies must exist`);
  let vertices=0;
  for(const group of groups){
   assert.ok(group.children.length,`${frame}/${group.userData.part}/${stage}: empty upgrade`);
   for(const mesh of group.children) vertices+=mesh.geometry.attributes.position.count;
   assert.equal(group.userData.stage,stage);
   if(['thrusters','stabilisers','skid'].includes(group.userData.part))assert.match(group.parent.name,/pivot$/, 'hardware must be a child of the actual articulated part');
  }
  counts.push(vertices);
  hardwareDraws=Math.max(hardwareDraws,groups.reduce((sum,group)=>sum+group.children.length,0));
  hardwareTriangles=Math.max(hardwareTriangles,groups.reduce((sum,group)=>sum+group.children.reduce((count,mesh)=>count+(mesh.geometry.index?.count??mesh.geometry.attributes.position.count)/3,0),0));
  assert.equal(fitUpgradeHardware(hull,frame,fitted),groups,'unchanged fit reuses hardware');
 }
 assert.ok(counts[1]>counts[0]&&counts[2]>counts[1],`${frame}: each stage must visibly add hardware`);
 fitUpgradeHardware(hull,frame,defaultFit());
 const leftover=[];hull.traverse(object=>{if(object.name.startsWith('garage_upgrade_'))leftover.push(object.name);});assert.deepEqual(leftover,[]);
 if(frame!=='totem'){
  seatPowerHardpoints(body,frame);body.updateMatrixWorld(true);
  for(const side of ['left','right']){
   const mount=body.getObjectByName(`HARDPOINT_${side}`).getWorldPosition(new THREE.Vector3());
   const hit=new THREE.Raycaster(mount.clone().add(new THREE.Vector3(0,.1,0)),new THREE.Vector3(0,-1,0)).intersectObject(body,true)[0];
   assert.ok(hit&&Math.abs(hit.point.y-mount.y)<.03,`${frame}/${side}: pickup support must touch the deck`);
  }
 }
 hull.position.set(2,.3,5);hull.rotation.y=.2;const original=hull.position.clone(),rotation=hull.quaternion.clone();
 let point;const scene=new GarageScene(()=>true,value=>point=value);scene.show();
 for(const [width,height] of [[1280,800],[390,844],[844,390]]){
  Object.assign(window,{innerWidth:width,innerHeight:height});
  for(const part of PART_CODES){
   scene.select(frame,part,false);scene.update();
   assert.ok(point.ready,`${frame}/${part} real anchor exists`);
   assert.ok(scene.camera.position.y > -1.275,`${frame}/${part} camera must stay above the apron`);
   assert.ok(point.x>0&&point.x<width&&point.y>0&&point.y<height,`${frame}/${part} inside viewport`);
   if(width/height<.85)assert.ok(point.y/height>=.4&&point.y/height<=.45,`${frame}/${part} phone safe height`);
   const target=new THREE.Vector3();partAnchor(hull,frame,part,target);
   const direction=target.clone().sub(scene.camera.position).normalize();
   const distance=scene.camera.position.distanceTo(target);
   const ray=new THREE.Raycaster(scene.camera.position,direction);
   const hit=ray.intersectObject(hull,true)[0];
   // Surface anchor must actually touch the craft; a hidden internal pivot or
   // a ray through empty space must fail rather than pass a projection check.
   const error=hit?Math.abs(hit.distance-distance):Infinity;
   if(error>.22)failures.push(`${frame}/${part}: surface error ${error.toFixed(3)} m`);
   projections++;
  }
 }
 scene.hide();assert.equal(hull.parent,parent);assert.ok(hull.position.equals(original));assert.ok(hull.quaternion.equals(rotation));
 scene.dispose();
}
assert.deepEqual([...new Set(failures)],[], 'part must be visible, on actual hardware, within 22 cm');
console.log(`B2 PASS: hardware peaks at ${hardwareDraws} draws / ${hardwareTriangles} triangles; ${projections} real-geometry views, desktop/portrait/landscape; surface occlusion, phone safe height, pose restoration, and reward purchase states.`);

// Music uses a media element, never a decoded recording or another context.
const musicURL=await compile('src/game/garage-music.ts');
let media;
class TestAudio {
 paused=true;volume=0;loop=false;preload='';dataset={};plays=0;
 constructor(){media=this;}
 play(){this.paused=false;this.plays++;return Promise.resolve();}
 pause(){this.paused=true;}
 removeAttribute(){} load(){}
}
globalThis.Audio=TestAudio;document.body={dataset:{}};document.hidden=false;window.location={search:''};
const {GarageMusic}=await import(musicURL);const levels={masterVolume:1,musicVolume:1};
const music=new GarageMusic(()=>levels);assert.equal(media,undefined,'music stays lazy');
music.show();await new Promise(resolve=>setImmediate(resolve));
music.sync(1,false);assert.ok(media.volume>.1&&!media.paused,'score plays at the bay level');
music.sync(-.1,true);assert.ok(media.volume>=0&&media.volume<=1,'late frame clocks cannot escape valid volume');
music.sync(1,true);assert.ok(media.volume<.03,'engine test ducks music');
music.interrupt();assert.equal(media.paused,true,'background pause is synchronous');
music.resume();await new Promise(resolve=>setImmediate(resolve));assert.equal(media.paused,false);
document.body.dataset.muted='true';music.sync(.1,false);assert.equal(media.paused,true);
document.body.dataset.muted='false';music.resume();await new Promise(resolve=>setImmediate(resolve));
music.hide();assert.equal(media.paused,true);music.sync(1,false);assert.equal(media.paused,true,'a closed bay cannot restart');
music.dispose();music.show();assert.equal(media.paused,true,'disposed player stays disposed');
console.log('Bay music PASS: lazy streaming, valid gain, test ducking, blur, mute, close and disposal.');
