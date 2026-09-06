import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
globalThis.ProgressEvent??=class ProgressEvent{constructor(type,data){this.type=type;Object.assign(this,data);}};
async function geometry(name){
 const bytes=readFileSync(`public/assets/ascension/${name}.glb`),length=bytes.readUInt32LE(12),gltf=JSON.parse(bytes.subarray(20,20+length));
 gltf.buffers[0].uri='data:application/octet-stream;base64,'+bytes.subarray(28+length).toString('base64');delete gltf.images;delete gltf.textures;delete gltf.samplers;gltf.materials=[{}];for(const m of gltf.meshes)for(const p of m.primitives)p.material=0;
 const loaded=await new GLTFLoader().parseAsync(JSON.stringify(gltf),'');loaded.scene.updateMatrixWorld(true);return {scene:loaded.scene,sha256:createHash('sha256').update(bytes).digest('hex')};
}
const crawler=await geometry('crawler-transporter'),tracks=[];
crawler.scene.traverse(o=>{if(!o.isMesh&&/^crawler-tread-\d$/.test(o.name)){const size=new THREE.Box3().setFromObject(o).getSize(new THREE.Vector3());tracks.push({name:o.name,size:size.toArray()});assert(Math.abs(size.z-12)<.0001,`Track length ${size.z}`);assert(Math.abs(size.y-4)<.0001,`Track height ${size.y}`);}});assert.equal(tracks.length,4);
const platform=await geometry('rocket-platform'),arms=[];
platform.scene.traverse(o=>{if(!o.isMesh&&o.name.startsWith('swing-arm-pivot-')){const box=new THREE.Box3().setFromObject(o);arms.push({name:o.name,contactX:o.userData.contactX,maximumX:box.max.x});assert.equal(o.userData.contactX,-4.3);}});assert.equal(arms.length,3);
const out='art/evidence/ascension-v1/phase-b-revision/fix-2';mkdirSync(out,{recursive:true});
writeFileSync(out+'/geometry.json',JSON.stringify({script:'scripts/validate-ascension-heroes.mjs',crawlerSha256:crawler.sha256,platformSha256:platform.sha256,tracks,arms,scope:'Exported track bounds and named arm contacts; visual acceptance is a separate image review.'},null,2));console.log(JSON.stringify({tracks,arms}));
