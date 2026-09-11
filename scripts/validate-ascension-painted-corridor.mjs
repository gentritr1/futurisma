import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
const route=JSON.parse(readFileSync('src/game/data/ascension/route.json'));
const file='public/assets/ascension/painted.glb',buffer=readFileSync(file),jsonLength=buffer.readUInt32LE(12),json=JSON.parse(buffer.subarray(20,20+jsonLength));
// Texture decoding cannot affect a geometric ray. Preserve positions, indices and transforms.
const binaryStart=20+jsonLength+8,binary=buffer.subarray(binaryStart);
json.buffers[0].uri='data:application/octet-stream;base64,'+binary.toString('base64');
json.materials=[{doubleSided:true}];delete json.images;delete json.textures;delete json.samplers;
for(const mesh of json.meshes)for(const primitive of mesh.primitives)primitive.material=0;
globalThis.ProgressEvent??=class ProgressEvent{constructor(type,values){this.type=type;Object.assign(this,values);}};
const {scene}=await new GLTFLoader().parseAsync(JSON.stringify(json),'');scene.updateMatrixWorld(true);
const ray=new THREE.Raycaster(),up=new THREE.Vector3(0,1,0),hits=[];let samples=0;
for(const [name,stations] of [['main',route.stations],['trench',route.shortcut.stations]])for(let i=0;i<stations.length;i++){
 const st=stations[i],p=new THREE.Vector3(...st.p),right=new THREE.Vector3(...st.t).cross(up).normalize(),half=name==='main'?st.width/2:10;
 const progress=i/route.count,bank=name==='main'&&progress>.08&&progress<.16?.04*Math.sin((progress-.08)/.08*Math.PI):0;right.applyAxisAngle(new THREE.Vector3(...st.t),bank);
 for(let lateral=-half;lateral<=half;lateral+=2){
  const origin=p.clone().addScaledVector(right,lateral);origin.y+=.15;ray.set(origin,up);ray.near=0;ray.far=8.85;
  const hit=ray.intersectObject(scene,true)[0];samples++;
  if(hit)hits.push({route:name,station:i,lateral,object:hit.object.name,clearance:hit.distance+.15,position:origin.toArray()});
 }
}
const report={script:'scripts/validate-ascension-painted-corridor.mjs',input:file,sha256:createHash('sha256').update(buffer).digest('hex'),scope:'Static authored environment only. Upward 9m rays at every accepted route station and every 2m across each road, with the main-road bank applied to lateral probe positions. Moving crossings and ascent require Phase C sweeps.',sampling:'Spatial grid, not a timed sample window.',samples,hits,accepted:hits.length===0};
writeFileSync(process.argv.find(a=>a.startsWith('--out='))?.slice(6)??'art/evidence/ascension-v1/phase-b/painted-corridor.json',JSON.stringify(report,null,2));console.log(JSON.stringify({samples,hits:hits.length,first:hits.slice(0,8)}));if(hits.length)process.exitCode=1;
