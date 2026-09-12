/**
 * Phase F §4.5–§4.7 — the island's screen, photographed.
 *
 *   node scripts/visual/dreamisland/alive-hud.mjs [--out=DIR] [--base=URL] [--size=1280x720]
 *
 * RUN THIS AGAINST A PRODUCTION BUILD, NOT THE DEV SERVER:
 *
 *   npx vite build && npx vite preview --host 127.0.0.1 --port 5211 --strictPort
 *   node scripts/visual/dreamisland/alive-hud.mjs --base=http://127.0.0.1:5211
 *
 * The shipped Content-Security-Policy is `style-src 'self'` (index.html:11 and
 * public/_headers:2). Vite's dev server delivers an imported stylesheet by
 * injecting a `<style>` element, and the CSP blocks exactly that, so
 * `src/style-dreamisland.css` DOES NOT APPLY ON THE DEV SERVER — the skin is
 * simply absent and a dev screenshot of it would be a photograph of nothing.
 * The production build emits the same file as a linked stylesheet from 'self',
 * which the policy allows. This is a real and reproducible difference between
 * preview and shipped, of exactly the kind the harness rules warn about, and it
 * is why this script defaults to nothing and insists on a `--base`.
 *
 * Frames, all keyed on the runtime's own published state rather than on a
 * timer: the five `data-power-state` values of §4.6, the world bubble, the fire
 * and the strike of §4.7, an overtake pill, and the day and night skins.
 */
import {mkdir,writeFile} from 'node:fs/promises';
import {launchReviewBrowser} from '../tideline-v4/browser.mjs';

const flag=name=>process.argv.find(a=>a.startsWith('--'+name+'='))?.slice(name.length+3);
const out=flag('out')??'art/evidence/dreamisland-v1/alive/code/hud';
const base=flag('base');
if(!base)throw Error('--base= is required: this script must run against a production preview, not the dev server (see the header)');
const [width,height]=(flag('size')??'1280x720').split('x').map(Number);
const seed=flag('seed')??'3868938316';
await mkdir(out,{recursive:true});

const shots=[];
const browser=await launchReviewBrowser();
try{
 const page=await browser.newPage(),errors=[];
 await page.setViewport({width,height,deviceScaleFactor:1});
 page.on('pageerror',e=>{errors.push(String(e));console.log(String(e));});
 page.on('console',m=>{if(m.type()==='error'){errors.push(m.text());console.log(m.text());}});
 const url=base+'/?map=dreamisland&demo=1&headless=1&diagnostics=1&start=manual'
  +'&seed='+seed+'&tier=works&laps=5&quality=high&music=0&voice=0';
 /**
  * ONE FRESH PAGE PER FRAME, FROZEN THE INSTANT THE STATE APPEARS.
  *
  * Two of §4.6's five states are shorter than a screenshot. `collected` lasts
  * 400 ms by design, and the first armed state lasts only until the driver
  * fires - about a second, because the demo autopilot fires as soon as a launch
  * zone is ahead. Polling for them from node over CDP missed them repeatedly:
  * a round trip is tens of milliseconds on a quiet machine and hundreds on a
  * busy one, and the run before this one timed out on `collected` after three
  * minutes of watching five pickups a lap go past.
  *
  * So the decision is made IN THE PAGE. A watcher installed on the first frame
  * checks the runtime's own published state every animation frame and, the
  * first time it matches, cancels every pending animation frame - which stops
  * the race, the render loop and the HUD together and leaves the canvas holding
  * the frame it had just drawn. Node then waits on one boolean and takes its
  * time over the screenshot. The frozen state is read back out and stored
  * beside the frame, so what the picture shows is what the JSON says.
  */
 const frozen=async(name,label,predicate,{timeoutMs=240000,settleMs=400}={})=>{
  await page.goto(url,{waitUntil:'networkidle0',timeout:120000});
  await page.waitForSelector('#start-button',{visible:true});
  await page.click('#start-button');
  await page.evaluate(predicateSource=>{
   const matches=new Function('state','return ('+predicateSource+')(state);');
   window.__diFrozen=null;
   const raf=window.requestAnimationFrame.bind(window);
   let highest=0;
   const read=()=>{
    try{
     const island=JSON.parse(document.getElementById('dreamisland-diagnostics').textContent);
     const race=JSON.parse(document.getElementById('futurisma-diagnostics').textContent);
     const slot=document.getElementById('di-power-slot');
     return {powerState:island.hud?.powerState??null,teach:slot?.dataset.teach??null,
      kind:slot?.dataset.kind??null,
      slotText:slot?.textContent.replace(/\s+/g,' ').trim()??null,
      bubble:document.querySelector('.di-bubble')?.dataset.active??null,
      lines:document.querySelector('.di-lines')?.dataset.active??null,
      flash:document.querySelector('.di-flash')?.dataset.active??null,
      fish:document.querySelector('.di-fish')?.dataset.active??null,
      pills:document.querySelectorAll('.di-pill').length,
      night:Number(getComputedStyle(document.documentElement).getPropertyValue('--di-night'))||0,
      struck:!!island.state?.struck,nightBlend:island.nightBlend,progress:island.progress,
      tick:island.tick,report:island.hud,phase:race.current.phase,
      circuit:document.documentElement.dataset.circuit??null,
      skinApplied:(()=>{const plate=document.querySelector('.hud-standing__lap');
       return plate?getComputedStyle(plate).borderRadius:null;})()};
    }catch{return null;}
   };
   const watch=()=>{
    const state=read();
    if(state&&state.phase==='running'&&matches(state)){
     window.__diFrozen=state;
     // Freeze: nothing schedules another frame from here, so the canvas and
     // the HUD both hold the frame this state was seen on.
     for(let id=1;id<=highest+8192;id++)window.cancelAnimationFrame(id);
     window.requestAnimationFrame=()=>0;
     return;
    }
    highest=Math.max(highest,raf(watch));
   };
   highest=raf(watch);
  },predicate.toString());
// `polling: 100`, NOT `polling: 'raf'`. The in-page watcher freezes the tab by
  // cancelling every pending animation frame and replacing
  // `requestAnimationFrame` with a no-op, and puppeteer's own rAF-based poller
  // is one of the things that stops: the wait then never notices the flag it is
  // waiting for and dies on the protocol timeout instead.
  await page.waitForFunction(()=>window.__diFrozen!==null,{timeout:timeoutMs,polling:100});
  await new Promise(resolve=>setTimeout(resolve,settleMs));
  await page.screenshot({path:out+'/'+name+'.png'});
  const state=await page.evaluate(()=>window.__diFrozen);
  shots.push({frame:name+'.png',note:label,state});
  console.log(name,JSON.stringify({powerState:state.powerState,teach:state.teach,
   bubble:state.bubble,lines:state.lines,flash:state.flash,fish:state.fish,
   night:state.night,skin:state.skinApplied,progress:+state.progress.toFixed(4),tick:state.tick}));
  return state;
 };

 for(const [name,label,predicate] of [
  ['slot-hunting','§4.6 state 1: hunting the nearest uncollected capsule',
   state=>state.powerState==='hunting'],
  ['slot-in-range','§4.6 state 2: inside 120 m, with the world bubble projected on the capsule',
   state=>state.powerState==='in-range'&&state.bubble==='true'],
  ['slot-collected','§4.6 state 3: the 400 ms collect',
   state=>state.powerState==='collected'],
  ['slot-armed-first-time','§4.6 state 4, first time only: the pill at 120 px reading HOLD E TO FIRE',
   state=>state.powerState==='armed'&&state.teach==='true'],
  ['slot-armed','§4.6 state 4: armed, after the first-time teach has retired',
   state=>state.powerState==='armed'&&state.teach==='false'],
  ['slot-active','§4.6 state 5: a power firing, the orb ring draining',
   state=>state.powerState==='active'],
  ['feel-fire','§4.7 the fire: the speed-line overlay and the widened FOV',
   state=>state.powerState==='active'&&state.lines==='true'],
  ['feel-strike-flash','§4.7 the strike: the white-to-cyan flash, inside its 300 ms',
   state=>state.flash==='true'],
  ['feel-strike-fish','§4.7 the strike: the goldfish crossing the top of the HUD',
   state=>state.fish==='true'&&state.flash==='false'],
  ['skin-night','§4.5 the skin at nightBlend 1',
   state=>state.nightBlend>=.999],
  ['feel-overtake','§4.7 an overtake pill floating out of the timing tower',
   state=>state.pills>0],
 ]){
  try{
   const state=await frozen(name,label,predicate);
   if(state.skinApplied!=='999px'){
    throw Error('the island skin is not applied (lap plate border-radius is '
     +state.skinApplied+', expected 999px). Are you pointing at the dev server?');
   }
  }catch(error){
   shots.push({frame:name+'.png',note:label,missed:String(error.message)});
   console.log('MISSED '+name+': '+error.message);
  }
 }
 await writeFile(out+'/capture.json',JSON.stringify({
  script:'scripts/visual/dreamisland/alive-hud.mjs',base,url,viewport:width+'x'+height,shots,errors},null,2)+'\n');
 console.log('errors',errors.length);
}finally{await browser.close();}
