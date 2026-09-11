import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {sourceModule} from './visual/ascension/modules.mjs';
const {AscensionCourse}=await import(await sourceModule('ascension-course.ts'));
const course=new AscensionCourse(),route=JSON.parse(readFileSync('src/game/data/ascension/route.json'));
assert.ok(route.length>=2400&&route.length<=2800);assert.equal(route.checkpoints.length,8);
assert.ok(route.checkpoints.every((p,i)=>i===0||p>route.checkpoints[i-1]));
assert.ok(!route.checkpoints.some(p=>p>route.shortcut.from&&p<route.shortcut.to));
let maxProjectionError=0;
for(let i=0;i<route.count;i++){
 const s=course.sample(i/route.count),p=course.project(s.position,i/route.count);
 maxProjectionError=Math.max(maxProjectionError,p.position.distanceTo(s.position));
 assert.ok(Math.abs(p.lateral)<.01);assert.ok(s.up.y>.98);
 const next=course.sample((i+1)/route.count);assert.ok(next.position.distanceTo(s.position)<3.1);
}
const first=course.sampleShortcut(route.shortcut.from),last=course.sampleShortcut(route.shortcut.to);
assert.ok(first.position.distanceTo(course.sample(route.shortcut.from).position)<.02);
assert.ok(last.position.distanceTo(course.sample(route.shortcut.to).position)<.02);
const blob=readFileSync('public/assets/ascension/blockout.glb');
const gltf=await new GLTFLoader().parseAsync(blob.buffer.slice(blob.byteOffset,blob.byteOffset+blob.byteLength),'');
gltf.scene.updateMatrixWorld(true);
const materialIds=new Map();
gltf.scene.traverse(o=>{if(o.isMesh)for(const m of Array.isArray(o.material)?o.material:[o.material])materialIds.set(m.name,m.color.toArray());});
assert.ok(new Set([...materialIds.values()].map(c=>JSON.stringify(c))).size>=5,'Export must preserve distinct material-ID colours');
const crawler=gltf.scene.getObjectByName('crawler_CT2');assert.ok(crawler);
let minimumCrawlerClearance=Infinity,samples=0;
// Both directions, including endpoints, on a 120 Hz six-second crossing.
// Phase A sweep translates the exported hierarchy; Phase C must use this path.
const origin=crawler.position.clone();
for(const direction of [-1,1])for(let tick=0;tick<=6*120;tick++){
 crawler.position.copy(origin);crawler.position.x+=direction*((tick/(6*120))-.5)*100;
 crawler.updateMatrixWorld(true);const bounds=new THREE.Box3().setFromObject(crawler);
 minimumCrawlerClearance=Math.min(minimumCrawlerClearance,bounds.min.y-4);samples++;
}
assert.ok(minimumCrawlerClearance>=9,`Crawler clearance ${minimumCrawlerClearance}`);
const report={script:'scripts/validate-ascension.mjs',materialIds:Object.fromEntries(materialIds),routeMetres:route.length,orderedGates:8,maxProjectionError,minimumCrawlerClearance,sweep:{directions:2,secondsPerDirection:6,hz:120,inclusiveEndpoints:true,expectedSamples:2*(6*120+1),samples},scope:'Flat-ID crawler hierarchy translation; not a rendered animation or launch corridor acceptance'};
writeFileSync(process.argv.find(a=>a.startsWith('--out='))?.slice(6)??'art/evidence/ascension-v1/phase-a/route-validation.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
