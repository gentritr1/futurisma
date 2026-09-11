import {readFileSync,writeFileSync} from 'node:fs';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';

const path='public/assets/dreamisland/painted.json';
const painted=JSON.parse(readFileSync(path,'utf8'));
const sources=[];
async function anchor(asset,node,id){
 const index=painted.placements.findIndex(p=>p.asset===asset),p=painted.placements[index];
 const bytes=readFileSync('public/assets/dreamisland/'+p.hero.glb);
 const gltf=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
 const object=gltf.scene.getObjectByName(node);if(!object)throw Error('Missing sound anchor '+node);
 gltf.scene.updateMatrixWorld(true);
 const local=object.getWorldPosition(new THREE.Vector3());
 const world=local.clone().multiplyScalar(p.hero.heroScale??p.scale)
  .applyAxisAngle(new THREE.Vector3(0,1,0),p.yaw).add(new THREE.Vector3(...p.position));
 sources.push({id,position:world.toArray(),placement:index,asset,anchor:node,local:local.toArray()});
}
await anchor('clock-tower','clock_hand_pivot','clock');
await anchor('waterfall-cliff','waterfall_sheet_anchor','waterfall');
const bore=painted.placements.findIndex(p=>p.asset==='watchtower-ruin');
sources.push({id:'tunnel',placement:bore,position:painted.placements[bore].position});
for(const sector of ['GROVE','CUT']){
 const index=painted.placements.findIndex(p=>p.sector===sector&&p.asset==='palm-tall');
 if(index<0)throw Error('No bird source in '+sector);
 sources.push({id:'birds-'+sector,placement:index,position:painted.placements[index].position});
}
for(const shoal of painted.fishPaths.shoals){
 const members=painted.placements.filter(p=>p.batch===shoal.batch);
 if(!members.length)throw Error('No painted shoal '+shoal.id);
 const position=[0,1,2].map(axis=>members.reduce((sum,p)=>sum+p.position[axis],0)/members.length);
 sources.push({id:'fish-'+shoal.id,batch:shoal.batch,position});
}
painted.audioSources={script:'scripts/prepare-dreamisland-audio-positions.mjs',sources};
let original=readFileSync(path,'utf8');
if(process.argv.includes('--check')){
 if(JSON.stringify(JSON.parse(original).audioSources)!==JSON.stringify(painted.audioSources))
  throw Error('painted.json audio positions are stale; run prepare-dreamisland-audio-positions.mjs');
 console.log('Dream Island audio positions: '+sources.length+' measured anchors match painted.json.');
}else{
const existing=original.lastIndexOf('\n \"audioSources\":');
if(existing>=0)original=original.slice(0,existing-1)+'\n}';
writeFileSync(path,original.trimEnd().slice(0,-1).trimEnd()+',\n \"audioSources\": '+JSON.stringify(painted.audioSources,null,1).replaceAll('\n','\n ')+'\n}\n');
console.log(JSON.stringify(painted.audioSources,null,2));
}
