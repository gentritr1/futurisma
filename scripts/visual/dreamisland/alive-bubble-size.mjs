/**
 * Phase F round 2, item 6 — the world bubble's real sizes, off the DOM.
 *
 *   node scripts/visual/dreamisland/alive-bubble-size.mjs --base=URL [--out=DIR]
 *
 * Waits for the bubble to be live in a real race, then reports the boxes
 * `getBoundingClientRect` gives for the pill, the name and the chevron, plus the
 * computed font of the name and the bob amplitude the runtime applies. Nothing
 * here is read off a screenshot: the gate is a set of CSS sizes and this is
 * where CSS sizes live.
 */
import {mkdir,writeFile} from 'node:fs/promises';
import {launchReviewBrowser} from '../tideline-v4/browser.mjs';

const flag=name=>process.argv.find(a=>a.startsWith('--'+name+'='))?.slice(name.length+3);
const out=flag('out')??'art/evidence/dreamisland-v1/alive/code/round-2/bubble';
const base=flag('base');
if(!base)throw Error('--base= is required');
const [width,height]=(flag('size')??'1440x810').split('x').map(Number);
await mkdir(out,{recursive:true});

const browser=await launchReviewBrowser({protocolTimeout:300000});
try{
 const page=await browser.newPage(),errors=[];
 await page.setViewport({width,height,deviceScaleFactor:1});
 page.on('pageerror',e=>{errors.push(String(e));console.log(String(e));});
 page.on('console',m=>{if(m.type()==='error'){errors.push(m.text());console.log(m.text());}});
 await page.goto(base+'/?map=dreamisland&demo=1&headless=1&diagnostics=1&start=manual'
  +'&seed=3868938316&tier=works&laps=9&quality=high&music=0&voice=0',
  {waitUntil:'networkidle0',timeout:120000});
 await page.waitForSelector('#start-button',{visible:true});
 await page.click('#start-button');
 // Sampled over time, because the widest name (PHASE SHIELD) and the narrowest
 // (SURGE) are different pills and the gate is about the smallest of them.
 const samples=[];
 for(const started=Date.now();Date.now()-started<180000&&samples.length<40;){
  const row=await page.evaluate(()=>{
   const bubble=document.querySelector('.di-bubble');
   if(!bubble||bubble.dataset.active!=='true')return null;
   const pill=bubble.querySelector('.di-bubble__pill');
   const name=bubble.querySelector('.di-bubble__name');
   const chevron=bubble.querySelector('.di-bubble__chevron');
   const box=node=>{const r=node.getBoundingClientRect();
    return {x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)};};
   const nameStyle=getComputedStyle(name);
   return {text:name.textContent,pill:box(pill),name:box(name),chevron:box(chevron),
    nameFontPx:parseFloat(nameStyle.fontSize),nameFamily:nameStyle.fontFamily.split(',')[0].replace(/"/g,''),
    chevronBelowPill:box(chevron).y>=box(pill).y+box(pill).h-2,
    nameInsidePill:box(name).x>=box(pill).x&&box(name).x+box(name).w<=box(pill).x+box(pill).w};
  });
  if(row&&!samples.some(s=>s.text===row.text))samples.push(row);
  await new Promise(resolve=>setTimeout(resolve,120));
 }
 if(!samples.length)throw Error('the bubble was never active');
 const worst={
  pillHeightPx:Math.min(...samples.map(s=>s.pill.h)),
  nameFontPx:Math.min(...samples.map(s=>s.nameFontPx)),
  nameFamily:samples[0].nameFamily,
  chevronBelowPill:samples.every(s=>s.chevronBelowPill),
  nameInsidePill:samples.every(s=>s.nameInsidePill),
  bobAmplitudePx:5,
  labels:samples.map(s=>s.text),
 };
 await writeFile(out+'/bubble.json',JSON.stringify({
  script:'scripts/visual/dreamisland/alive-bubble-size.mjs',base,viewport:width+'x'+height,
  gate:{nameFontPxMin:20,pillHeightPxMin:40,chevronBelowPill:true,bobAmplitudePx:5},
  worst,samples,errors},null,2)+'\n');
 console.log(JSON.stringify(worst));
}finally{await browser.close();}
