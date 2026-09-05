import {readFileSync,writeFileSync} from 'node:fs';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
const route=JSON.parse(readFileSync('src/game/data/ascension/route.json'));
const buffer=readFileSync('public/assets/ascension/blockout.glb');
const {scene}=await new GLTFLoader().parseAsync(buffer.buffer.slice(buffer.byteOffset,buffer.byteOffset+buffer.byteLength),'');
scene.updateMatrixWorld(true);scene.traverse(o=>{if(o instanceof THREE.Mesh)for(const m of Array.isArray(o.material)?o.material:[o.material])m.side=THREE.DoubleSide;});
const ray=new THREE.Raycaster(),up=new THREE.Vector3(0,1,0),hits=[];let samples=0;
for(const [name,stations] of [['main',route.stations],['trench',route.shortcut.stations]])for(let i=0;i<stations.length;i++){
 const st=stations[i],p=new THREE.Vector3(...st.p),right=new THREE.Vector3(...st.t).cross(up).normalize();
 const half=name==='main'?st.width/2:10;
 for(let lateral=-half;lateral<=half;lateral+=2){
  const origin=p.clone().addScaledVector(right,lateral);origin.y+=.15;ray.set(origin,up);ray.near=0;ray.far=8.85;
  const hit=ray.intersectObject(scene,true)[0];samples++;
  if(hit)hits.push({route:name,station:i,lateral,object:hit.object.name,clearance:hit.distance+.15,position:origin.toArray()});
 }
}
const report={script:'scripts/validate-ascension-corridor.mjs',sampleMethod:'Upward 9m rays every route station and 2m across the road. Static blockout only, no hull envelope or moving event sweep.',samples,hits,accepted:hits.length===0};
writeFileSync('art/evidence/ascension-v1/phase-a/corridor.json',JSON.stringify(report,null,2));console.log(JSON.stringify({samples,hits:hits.length,first:hits.slice(0,8)}));if(hits.length)process.exitCode=1;
