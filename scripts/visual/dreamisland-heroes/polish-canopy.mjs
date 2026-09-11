import {readFileSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
const out=process.argv.find(a=>a.startsWith('--out='))?.slice(6)??'art/evidence/dreamisland-v1/polish/canopy-clearance.json';
const route=JSON.parse(readFileSync('src/game/data/dreamisland/route.json'));
const data=readFileSync('public/assets/dreamisland/painted.glb'),length=data.readUInt32LE(12),doc=JSON.parse(data.subarray(20,20+length));
doc.buffers[0].uri='data:application/octet-stream;base64,'+data.subarray(28+length).toString('base64');
doc.materials=doc.materials.map(m=>({name:m.name,doubleSided:true}));delete doc.images;delete doc.textures;delete doc.samplers;
globalThis.ProgressEvent??=class ProgressEvent{constructor(type,values){Object.assign(this,values);}};
const {scene}=await new GLTFLoader().parseAsync(JSON.stringify(doc),'');scene.updateMatrixWorld(true);
const stations=route.stations.map((s,index)=>({index,p:new THREE.Vector3(...s.p),t:new THREE.Vector3(...s.t),right:new THREE.Vector3(...s.t).cross(new THREE.Vector3(0,1,0)).normalize(),width:s.width,sector:s.sector}));
let tested=0,minimum=Infinity;const samples=[];
scene.traverse(mesh=>{
 if(!mesh.isMesh||!mesh.material.name.endsWith('jungle-card'))return;
 const p=mesh.geometry.attributes.position,point=new THREE.Vector3(),offset=new THREE.Vector3();
 for(let i=0;i<p.count;i++){
  const color=mesh.geometry.attributes.color;
  if(color?.itemSize===4&&color.getW(i)<.5)continue; // Ground decal, not an overhead frond.
  point.fromBufferAttribute(p,i).applyMatrix4(mesh.matrixWorld);
  let nearest=null,distance=Infinity;
  for(const s of stations){const d=(s.p.x-point.x)**2+(s.p.z-point.z)**2;if(d<distance){distance=d;nearest=s;}}
  if(nearest.sector!=='GROVE')continue;
  offset.copy(point).sub(nearest.p);const lateral=offset.dot(nearest.right);
  if(Math.abs(lateral)>nearest.width/2)continue;
  const rise=point.y-nearest.p.y;tested++;minimum=Math.min(minimum,rise);
  if(samples.length<32)samples.push({station:nearest.index,lateral,rise});
 }
});
assert.ok(tested>0,'No canopy projects into the grove corridor');
const report={instrument:'scripts/visual/dreamisland-heroes/polish-canopy.mjs',testedOverhangingCardVertices:tested,minimumHeightAboveDeck:minimum,openCorridorCeiling:8.85,additionalClearance:minimum-8.85,samples,method:'Exported card vertices, world transforms, nearest route station in XZ, inside the full road half-width; opaque card rectangles are conservative for keyed fronds.'};
writeFileSync(out,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));assert.ok(minimum-8.85>=2);
