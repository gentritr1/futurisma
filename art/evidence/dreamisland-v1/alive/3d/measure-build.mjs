import {readFile,readdir,writeFile} from 'node:fs/promises';
import {gzipSync} from 'node:zlib';
const dist='/tmp/dreamisland-f3d-eafe0b9/dist',out=process.argv[2]??'art/evidence/dreamisland-v1/alive/3d';
const html=await readFile(dist+'/index.html');
const initial=[...html.toString().matchAll(/(?:src|href)="\/assets\/([^"?]+\.(?:js|css))"/g)].map(m=>m[1]);
let shellGzip=gzipSync(html).byteLength;
for(const file of initial)shellGzip+=gzipSync(await readFile(dist+'/assets/'+file)).byteLength;
const island=[];
for(const file of await readdir(dist+'/assets'))if(/^dreamisland-.*\.js$/.test(file)){
 const data=await readFile(dist+'/assets/'+file);island.push({file,bytes:data.byteLength,gzip:gzipSync(data).byteLength,initial:initial.includes(file)});
}
if(island.some(x=>x.initial))throw Error('Island code entered the initial shell');
const prior=process.argv[2]?JSON.parse(await readFile('art/evidence/dreamisland-v1/alive/3d/build-size.json','utf8')):null;
const islandGzip=island.reduce((sum,x)=>sum+x.gzip,0),islandCeiling=prior?.islandCeiling??Math.ceil(islandGzip*1.1);
await writeFile(out+'/build-size.json',JSON.stringify({shellGzip,island,islandGzip,islandCeiling,referenceMeasurement:prior?.islandGzip??islandGzip,scope:'isolated eafe0b9 + F-3D, aggregate named island lazy JS; final combined pin belongs to orchestrator'},null,2));
console.log({shellGzip,islandGzip,islandCeiling,island});
