/**
 * Phase F round 2, item 3 — is every HUD text legible against what is behind it?
 *
 *   node scripts/visual/dreamisland/alive-contrast.mjs --base=URL [--out=DIR] [--size=1440x810]
 *   python3 scripts/visual/dreamisland/alive-contrast.py [DIR]
 *
 * Four poses: the autopilot chase camera in BEACH, COURT and REEF by day, and
 * COURT at settled night. At each one the page is frozen the way `alive-hud.mjs`
 * freezes it, and then photographed TWICE:
 *
 *   `<pose>.png`        the frame as it ships;
 *   `<pose>-nohud.png`  the same frame with every HUD text element's `color`
 *                       set to `transparent`.
 *
 * The second frame is what makes this a measurement rather than an estimate.
 * "The colour behind the text" cannot be read off the shipped frame, because
 * the text is in it and its own ink drags the mean towards itself - a white
 * label on white sky would score well against a mean it had whitened. With the
 * ink turned transparent, every other pixel is untouched (the glass pill, the
 * road, the sky) and the mean inside the element's own rect is exactly the
 * background the reader's eye has to separate the glyphs from.
 *
 * The rects and the computed ink colours come from the DOM at the same frozen
 * moment. `alive-contrast.py` does the WCAG 2.1 relative-luminance arithmetic.
 */
import {mkdir,writeFile} from 'node:fs/promises';
import {launchReviewBrowser} from '../tideline-v4/browser.mjs';

const flag=name=>process.argv.find(a=>a.startsWith('--'+name+'='))?.slice(name.length+3);
const out=flag('out')??'art/evidence/dreamisland-v1/alive/code/round-2/contrast';
const base=flag('base');
if(!base)throw Error('--base= is required');
const [width,height]=(flag('size')??'1440x810').split('x').map(Number);
const seed=flag('seed')??'3868938316';
await mkdir(out,{recursive:true});

/** district mid-points from route.json, and whether to wait for the night. */
const POSES=[
 {id:'day-beach',district:'BEACH',from:.0,to:.125,night:false},
 {id:'day-court',district:'COURT',from:.5167,to:.6583,night:false},
 {id:'day-reef',district:'REEF',from:.6583,to:.85,night:false},
 {id:'night-court',district:'COURT',from:.5167,to:.6583,night:true},
];

const browser=await launchReviewBrowser();
const poses=[];
try{
 const page=await browser.newPage(),errors=[];
 await page.setViewport({width,height,deviceScaleFactor:1});
 page.on('pageerror',e=>{errors.push(String(e));console.log(String(e));});
 page.on('console',m=>{if(m.type()==='error'){errors.push(m.text());console.log(m.text());}});
 for(const pose of POSES){
  const url=base+'/?map=dreamisland&demo=1&headless=1&diagnostics=1&start=manual'
   +'&seed='+seed+'&tier=works&laps=9&quality=high&music=0&voice=0';
  await page.goto(url,{waitUntil:'networkidle0',timeout:120000});
  await page.waitForSelector('#start-button',{visible:true});
  await page.click('#start-button');
  await page.evaluate(({from,to,night})=>{
   window.__diFrozen=null;
   const raf=window.requestAnimationFrame.bind(window);
   let highest=0;
   const watch=()=>{
    try{
     const island=JSON.parse(document.getElementById('dreamisland-diagnostics').textContent);
     const race=JSON.parse(document.getElementById('futurisma-diagnostics').textContent);
     const at=(from+to)/2;
     const inDistrict=island.progress>at-.018&&island.progress<at+.018;
     const lit=night?island.nightBlend>=.999:island.nightBlend===0;
     if(race.current.phase==='running'&&inDistrict&&lit){
      window.__diFrozen={progress:island.progress,nightBlend:island.nightBlend,
       sector:island.sector,tick:island.tick};
      for(let id=1;id<=highest+8192;id++)window.cancelAnimationFrame(id);
      window.requestAnimationFrame=()=>0;
      return;
     }
    }catch{}
    highest=Math.max(highest,raf(watch));
   };
   highest=raf(watch);
  },pose);
// `polling: 100`, NOT `polling: 'raf'`. The in-page watcher freezes the tab by
  // cancelling every pending animation frame and replacing
  // `requestAnimationFrame` with a no-op, and puppeteer's own rAF-based poller
  // is one of the things that stops: the wait then never notices the flag it is
  // waiting for and dies on the protocol timeout instead.
  await page.waitForFunction(()=>window.__diFrozen!==null,{timeout:400000,polling:100});
  await new Promise(resolve=>setTimeout(resolve,300));
  await page.screenshot({path:out+'/'+pose.id+'.png'});
  // Every HUD text node that is visible, has ink, and has a non-empty rect.
  const texts=await page.evaluate(()=>{
   const rows=[];
   // THE INK IS RESOLVED TO sRGB BY THE BROWSER, not parsed out of the CSS
   // string. Every colour in this skin is a `color-mix(in oklab, ...)`, and
   // Chrome hands that back from `getComputedStyle` as `oklab(0.94 0.06 0.02)`.
   // Reading three numbers out of that and calling them R, G and B produced
   // contrast ratios of 1.01 for bright cyan on a near-black night road - the
   // first run of this script "failed" fourteen elements that were fine.
   const probe=document.createElement('canvas').getContext('2d',{willReadFrequently:true});
   const srgb=css=>{
    probe.clearRect(0,0,1,1);probe.fillStyle='#000';probe.fillStyle=css;
    probe.fillRect(0,0,1,1);
    const [r,g,b]=probe.getImageData(0,0,1,1).data;
    return [r,g,b];
   };
   const roots=[document.querySelector('.hud'),document.querySelector('header'),
    document.getElementById('dreamisland-hud')].filter(Boolean);
   // `#dreamisland-hud` is a child of `.hud`, so every island element is found
   // twice unless the walk remembers what it has seen; the first run of this
   // script duly reported every bubble and slot row twice.
   const seen=new Set();
   for(const root of roots){
    for(const node of root.querySelectorAll('*')){
     if(!(node instanceof HTMLElement)||seen.has(node))continue;
     seen.add(node);
     const own=[...node.childNodes].some(child=>child.nodeType===3&&child.textContent.trim());
     if(!own)continue;
     const style=getComputedStyle(node);
     // EFFECTIVE visibility, walked up the tree. `.di-bubble` carries
     // `opacity: 0` until it is active while its children stay at opacity 1, so
     // a check on the element alone measured the hidden bubble's stale text
     // against the sky behind it and reported it as the frame's worst contrast.
     let hidden=false;
     for(let up=node;up&&up!==document.documentElement;up=up.parentElement){
      const upStyle=getComputedStyle(up);
      if(upStyle.visibility==='hidden'||upStyle.display==='none'||Number(upStyle.opacity)===0){
       hidden=true;break;
      }
     }
     if(hidden)continue;
     if(node.closest('[aria-hidden="true"],[hidden]')&&!node.closest('#dreamisland-hud'))continue;
     const rect=node.getBoundingClientRect();
     if(rect.width<4||rect.height<4)continue;
     if(rect.bottom<=0||rect.top>=innerHeight||rect.right<=0||rect.left>=innerWidth)continue;
     rows.push({id:node.id||null,className:node.className.toString(),
      text:node.textContent.replace(/\s+/g,' ').trim().slice(0,48),
      color:style.color,inkRgb:srgb(style.color),
      fontSize:style.fontSize,fontFamily:style.fontFamily.split(',')[0],
      rect:{x:Math.round(rect.x),y:Math.round(rect.y),
       width:Math.round(rect.width),height:Math.round(rect.height)}});
    }
   }
   // The ink goes transparent; nothing else in the page is touched.
   window.__diInked=[];
   for(const node of roots.flatMap(root=>[...root.querySelectorAll('*')])){
    if(!(node instanceof HTMLElement))continue;
    window.__diInked.push([node,node.style.color]);
    node.style.color='transparent';
   }
   return rows;
  });
  await new Promise(resolve=>setTimeout(resolve,200));
  await page.screenshot({path:out+'/'+pose.id+'-nohud.png'});
  const frozen=await page.evaluate(()=>window.__diFrozen);
  poses.push({...pose,frame:pose.id+'.png',background:pose.id+'-nohud.png',frozen,texts});
  console.log(pose.id,'progress',frozen.progress.toFixed(4),'nightBlend',frozen.nightBlend,
   'texts',texts.length);
 }
 await writeFile(out+'/capture.json',JSON.stringify({
  script:'scripts/visual/dreamisland/alive-contrast.mjs',base,viewport:width+'x'+height,
  method:'the background frame is the same frozen pose with every HUD element\'s color set to transparent, so the mean inside a text rect is the background and not the text itself',
  poses,errors},null,2)+'\n');
 console.log('errors',errors.length);
}finally{await browser.close();}
