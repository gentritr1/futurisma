import {mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {launchReviewBrowser} from '../tideline-v4/browser.mjs';
import {instrument} from './instrument.mjs';
const out='art/evidence/ascension-v1/phase-e/rival-powers';await mkdir(out,{recursive:true});const browser=await launchReviewBrowser(),key=[],writes=[],errors=[];
try{const page=await browser.newPage();page.on('pageerror',e=>errors.push(String(e)));await instrument(page);
 await page.exposeFunction('saveRivalPower',row=>{const {image,...data}=row;const file='view-'+String(key.length+1).padStart(2,'0')+'.png';key.push({file,imageSha256:createHash('sha256').update(Buffer.from(image.split(',')[1],'base64')).digest('hex'),...data});writes.push(writeFile(out+'/'+file,Buffer.from(image.split(',')[1],'base64')));});
 await page.evaluateOnNewDocument(()=>{
  const seen=new Set(),pending=[];window.__rivalPowerCount=0;
  window.__ascCaptureFrame=(renderer,args,render)=>{let d,c;try{d=JSON.parse(document.getElementById('ascension-diagnostics').textContent);c=JSON.parse(document.getElementById('futurisma-diagnostics').textContent).current;}catch{return;}
   for(const event of c.rivalPowerEvents??[]){const id=event.rival+':'+event.lap+':'+event.kind;if(!seen.has(id)){seen.add(id);pending.push({event,at:d.tick+24});}}
   const root=args[0].getObjectByName('tideline_seeded_rival_powers');if(!root)return;
   for(let i=pending.length-1;i>=0;i--){const item=pending[i];if(d.tick<item.at)continue;const index=c.rivals.findIndex(r=>r.id===item.event.rival),field=root.children[index];if(!field)throw Error('Missing live rival power field');
    const camera=args[1].clone();camera.position.set(-8,4.8,14).applyMatrix4(field.matrixWorld);camera.lookAt(camera.position.clone().set(0,1,0).applyMatrix4(field.matrixWorld));render(args[0],camera);
    window.saveRivalPower({simultaneousEventKinds:(c.rivalPowerEvents??[]).filter(e=>e.rival===item.event.rival&&e.lap===item.event.lap&&e.tick===item.event.tick).map(e=>e.kind),event:item.event,tick:d.tick,camera:camera.position.toArray(),image:renderer.domElement.toDataURL('image/png')});render(...args);pending.splice(i,1);window.__rivalPowerCount++;
   }
  };
 });
 await page.goto('http://127.0.0.1:5200/?map=ascension&seed=3868938316&tier=works&demo=1&demoTrench=0&headless=1&diagnostics=1&start=manual&quality=high&music=0',{waitUntil:'networkidle0'});await page.click('#start-button');await page.waitForFunction(()=>window.__rivalPowerCount>=18,{timeout:180000});await Promise.all(writes);
 const secret=JSON.stringify(key,null,2);await writeFile('/Users/gentlegen/Desktop/futurisma-race/ascension-private-review-keys/rival-powers.json',secret);
 await writeFile(out+'/manifest.json',JSON.stringify({script:'scripts/visual/ascension/rival-powers-capture.mjs',scope:'Live seeded rival events, inspected from an auxiliary chase-height camera while the normal demo continues. Gameplay and event state are unchanged. Simultaneous launch-grid powers can yield paired images of the same combined state; these are not separate visual activations. This is not the player driving camera or a performance benchmark.',rivals:3,powerTypes:2,laps:3,expected:18,observed:key.length,uniqueImageHashes:new Set(key.map(r=>r.imageSha256)).size,residual:key.length-18,keySha256:createHash('sha256').update(secret).digest('hex'),errors},null,2));
 await writeFile(out+'/index.html','<!doctype html><meta charset="utf-8"><title>Live rival powers</title><style>body{background:#20241f;color:#eee;font:18px system-ui;max-width:1280px;margin:auto}img{width:100%}textarea{width:95%;height:70px}</style><h1>Live rival power recognition</h1><p>Name the visible power or powers in each image. These are auxiliary inspection views of actual seeded race events; the event labels are withheld.</p>'+key.map((r,i)=>`<section><h2>View ${i+1}</h2><img src="${r.file}"><textarea></textarea></section>`).join(''));if(errors.length)throw Error(errors.join());
}finally{await browser.close();}
