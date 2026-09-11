/** Transport-only adapter for the unchanged race.mjs, which pins port 5200.
 * Keep another process's listener untouched; route page navigation to our own
 * Vite instance. No frame, physics, browser option or instrument is changed. */
import puppeteer from '/tmp/futurisma-v4-harness/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
export default {...puppeteer,launch:async options=>{
 const browser=await puppeteer.launch(options),newPage=browser.newPage.bind(browser),close=browser.close.bind(browser);
 browser.close=async()=>{
  const out=process.argv.find(a=>a.startsWith('--out='))?.slice(6);
  if(out?.includes('/round-2/soak-'))for(const page of await browser.pages()){
   const measured=await page.evaluate(()=>window.__roundTwoHeroPeaks??null).catch(()=>null);
   if(measured)await writeFile(out+'/per-hero-render.json',JSON.stringify({instrument:'scripts/visual/dreamisland/race.mjs with polish-transport.mjs render census',method:'Main calls from the existing draw hook; shadow calls from each hero mesh onBeforeShadow. Peak submitted geometry per asset and lighting state.',states:measured},null,2)+'\n');
  }
  let timer;
  try{await Promise.race([close(),new Promise(resolve=>{timer=setTimeout(()=>{browser.disconnect();browser.process()?.kill('SIGTERM');resolve();},10000);})]);}
  finally{clearTimeout(timer);}
 };
 browser.newPage=async()=>{
  const page=await newPage(),goto=page.goto.bind(page);
  await page.evaluateOnNewDocument(()=>{
   const tagged=new WeakSet();let shadows={};window.__roundTwoHeroPeaks={};
   const asset=name=>name.slice(8,name.indexOf('_DI_MAT_'));
   window.__diCaptureFrame=(renderer,args)=>{
    const scene=args[0],blend=scene.getObjectByName('dreamisland_panorama')?.material.uniforms.nightBlend.value??0;
    const state=blend===0?'day':blend===1?'night':'crossfade',current={};
    scene.traverse(o=>{if(!o.isMesh||!o.name.startsWith('DI_HERO_')||tagged.has(o))return;tagged.add(o);
     const previous=o.onBeforeShadow;o.onBeforeShadow=function(...a){previous.apply(this,a);const key=asset(o.name),value=shadows[key]??={calls:0,triangles:0};value.calls++;value.triangles+=(o.geometry.index?.count??o.geometry.attributes.position.count)/3;};
    });
    for(const draw of window.__diDraws??[]){if(!draw.name.startsWith('DI_HERO_'))continue;
     const key=asset(draw.name),value=current[key]??={mainCalls:0,mainTriangles:0};value.mainCalls++;value.mainTriangles+=draw.triangles;}
    const peaks=window.__roundTwoHeroPeaks[state]??={};
    for(const key of new Set([...Object.keys(current),...Object.keys(shadows)])){
     const value={...current[key],shadowCalls:shadows[key]?.calls??0,shadowTriangles:shadows[key]?.triangles??0},peak=peaks[key]??={};
     for(const field of ['mainCalls','mainTriangles','shadowCalls','shadowTriangles'])peak[field]=Math.max(peak[field]??0,value[field]??0);
    }
    shadows={};
   };
  });
  page.goto=async(url,options)=>{
   const effective=url.replace('http://127.0.0.1:5200/',(process.env.DREAMISLAND_REVIEW_BASE??'http://127.0.0.1:5217')+'/');
   if(effective===url)return goto(url,options);
   const out=process.argv.find(a=>a.startsWith('--out='))?.slice(6);
   assert.ok(out?.startsWith('art/evidence/dreamisland-v1/polish/soak-')||out?.startsWith('art/evidence/dreamisland-v1/polish/round-2/soak-'));
   await mkdir(out,{recursive:true});await writeFile(out+'/transport.json',JSON.stringify({adapter:'scripts/visual/dreamisland-heroes/polish-transport.mjs',instrument:'scripts/visual/dreamisland/race.mjs',requestedUrl:url,effectiveUrl:effective,reason:'Port 5200 was already occupied. Only page navigation is redirected to this task’s private server.'},null,2)+'\n');
   return goto(effective,options);
  };
  return page;
 };
 return browser;
}};
