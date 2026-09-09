import {mkdir,writeFile,readFile,copyFile,unlink} from 'node:fs/promises';
import {createHash,randomInt} from 'node:crypto';
import {launchReviewBrowser} from '../tideline-v4/browser.mjs';
const out='art/evidence/ascension-v1/post-e-followups/device-road-pair-v3';
const privatePath='/Users/gentlegen/Desktop/futurisma-race/ascension-private-review-keys/device-road-pair-v3.json';
try{await readFile(privatePath);throw Error('Existing review key: use a new pack path before recapturing.');}catch(error){if(error.code!=='ENOENT')throw error;}
await mkdir(out,{recursive:true});
const browser=await launchReviewBrowser(),errors=[],records=[];
try{
 const page=await browser.newPage();page.on('pageerror',e=>errors.push(String(e)));
 for(const mode of ['near','far','signal-far']){
  await page.goto('http://127.0.0.1:5200/ascension-device-review.html?'+(mode.includes('far')?'far':'')+(mode.startsWith('signal')?'&signal':''),{waitUntil:'networkidle0'});
  await page.waitForFunction(()=>!!window.__deviceReview,{timeout:30000});
  records.push({mode,...await page.evaluate(()=>window.__deviceReview)});
  await page.screenshot({path:out+'/'+mode+'.png'});
 }
 const b=records[0].projectedBounds;if(b.left<0||b.top<0||b.right>1280||b.bottom>720)throw Error('Device is clipped: '+JSON.stringify(b));
 if(errors.length||records.some(r=>r.violations.length))throw Error(JSON.stringify({errors,records}));
}finally{await browser.close();}
const pairs=[['near.png','art/references/ascension/hero-shield-proposal-v2.png'],['far.png','signal-far.png']];
const key=[];
for(const [i,pair] of pairs.entries()){
 if(randomInt(2))pair.reverse();
 for(const [j,source] of pair.entries()){
  const file=`pair-${i+1}-${j?'B':'A'}.png`;
  await copyFile(source.startsWith('art/')?source:out+'/'+source,out+'/'+file);
  key.push({file,source});
 }
}
const secret=JSON.stringify({key,records},null,2)+'\n';
await writeFile(privatePath,secret,{flag:'wx'});
await writeFile(out+'/manifest.json',JSON.stringify({script:'scripts/visual/ascension/device-review.mjs',frames:4,expected:4,residual:0,keySha256:createHash('sha256').update(secret).digest('hex'),errors,scope:'Pair 1: proposal and current model road inspection. Pair 2: control and proposed Shield cue at 120 m, identical camera. Source mapping and per-frame metadata withheld.'},null,2));
await writeFile(out+'/index.html','<!doctype html><meta charset="utf-8"><title>Device road comparison</title><style>body{background:#20241f;color:#eee;font:18px system-ui;max-width:1280px;margin:30px auto}img{width:100%}textarea{width:98%;height:80px}</style><h1>Device road comparison</h1><p>Pair 1: compare the device construction. Pair 2: identify what power the device gives at 120 m and report confidence. Labels and mapping withheld. Pair 1 camera match is estimated from a generated hero; Pair 2 uses an identical measured camera. No runtime changes shipped.</p>'+[1,2].map(i=>`<h2>Pair ${i}</h2>`+['A','B'].map(l=>`<h3>${l}</h3><img src="pair-${i}-${l}.png"><textarea aria-label="Pair ${i} ${l}"></textarea>`).join('')).join(''));
for(const file of ['near.png','far.png','signal-far.png'])await unlink(out+'/'+file);
console.log('Four review frames; zero count residual; no material exceptions or page errors. Key withheld.');
