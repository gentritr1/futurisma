import {pathToFileURL} from 'node:url';
import {readFileSync} from 'node:fs';
import {mkdir,copyFile,writeFile} from 'node:fs/promises';
/** Regular anchors retain their zone, but never sit within 40 m of an internal boundary. */
export function trenchAnchors(zones, count=10){
 const length=zones.measuredLengthMetres;
 return Array.from({length:count},(_,i)=>{
  const nominal=(i+.5)/count*length;
  const zone=zones.zones.find(z=>nominal>=z.fromMetres&&nominal<=z.toMetres);
  const metres=Math.max(zone.fromMetres===0?0:zone.fromMetres+40,
   Math.min(zone.toMetres===length?length:zone.toMetres-40,nominal));
  return {metres,nominalMetres:nominal,expected:zone.name,
   progress:zone.fromProgress+(zone.toProgress-zone.fromProgress)*(metres-zone.fromMetres)/zone.lengthMetres};
 });
}
if(import.meta.url===pathToFileURL(process.argv[1]).href){
const root=process.argv.find(a=>a.startsWith('--root='))?.slice(7)??'art/evidence/ascension-v1/phase-b-revision',out=root+'/blind-review';
const trenchOnly=process.argv.includes('--trench-only');await mkdir(out,{recursive:true});
const key=JSON.parse(readFileSync(root+'/fix-3/acceptance-key.json')).frames;
const order=[7,11,2,9,0,12,4,8,1,10,6,3,5];
let html='<!doctype html><meta charset="utf-8"><title>Ascension image review</title><style>body{background:#18201e;color:#eee;font:18px system-ui;max-width:1280px;margin:32px auto}img{width:100%}textarea{width:95%;height:90px;margin:10px}section{margin:50px 0}</style><h1>Image-only review</h1><p>Use only these images. Record answers before viewing any source or answer key. Responses remain in your browser; copy them into the review report.</p>';
if(!trenchOnly)html+='<h2>Landscape</h2><p>Name the tree species or family that the two images communicate. Describe any canopy obstruction of the countdown boards.</p>';
if(!trenchOnly)for(const [i,sector] of ['MANGROVE_CUT','CAUSEWAY'].entries()){await copyFile(`${root}/stations/base-${sector}.png`,`${out}/landscape-${i}.png`);html+=`<section><h3>Landscape ${i+1}</h3><img src="landscape-${i}.png"><textarea></textarea></section>`;}
if(!trenchOnly)html+='<h2>Focal models</h2><p>Judge each model on visual detail and construction quality. Would you describe it as simpler than a PS2 asset? Explain using visible evidence.</p>';
if(!trenchOnly)for(const [i,asset] of ['rocket-platform','crawler-transporter'].entries()){await copyFile(`${root}/fix-2/${asset}.png`,`${out}/model-${i}.png`);html+=`<section><h3>Model ${i+1}</h3><img src="model-${i}.png"><textarea></textarea></section>`;}
html+='<h2>Trench classification</h2><p>Assign each image to ENTRY RAMP, PAD UNDERSIDE, SCORCHED ZONE or DELUGE EXIT. The pack includes three dedicated transition captures. Whenever a change is visible, also describe it as “the change from X to Y”. There is no HUD. Images are shuffled.</p>';
const answerKey=[];
for(const [i,index] of order.entries()){const item=key[index],name=`view-${String(i+1).padStart(2,'0')}.png`;await copyFile(`${root}/trench-tour/${item.file}`,`${out}/${name}`);answerKey.push({image:name,expected:item.expected});html+=`<section><h3>View ${i+1}</h3><img src="${name}"><textarea></textarea></section>`;}
await writeFile(out+'/index.html',html);await writeFile(root+'/blind-review-answer-key.json',JSON.stringify({script:'scripts/visual/ascension/blind-pack.mjs',status:'Awaiting independent image-only review',answerKey},null,2));

}
