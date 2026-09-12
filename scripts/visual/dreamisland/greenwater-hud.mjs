/**
 * The six-other-circuits HUD guard for the Dream Island ALIVE pass.
 *
 *   node scripts/visual/dreamisland/greenwater-hud.mjs --out=DIR [--base=URL]
 *
 * The island's skin ships in `src/style-dreamisland.css`, scoped under
 * `:root[data-circuit="dreamisland"]` and imported only from the island's lazy
 * chunk, and `circuit-runtime.ts` now stamps that attribute. Both of those are
 * shared-surface changes, so the other circuits have to be shown unchanged.
 *
 * WHY THIS IS NOT A RACE SCREENSHOT. A running race writes a new clock, a new
 * speed and a new field order every frame, and the WebGL canvas behind them is
 * never two frames the same; a pixel diff of that measures the weather. So the
 * capture is DETERMINISTIC BY CONSTRUCTION:
 *
 *   - the canvas is hidden, because the shell's HUD is what the attribute and
 *     the stylesheet can reach and the canvas is not,
 *   - every HUD node is written a FIXED string from the table below, and
 *     `ui.updateFieldOrder` is driven with a fixed ladder, so the timing tower
 *     rows this pass rebuilds are in the frame,
 *   - the page is Greenwater, which never loads the island chunk at all, so the
 *     `data-circuit` value under test is the one a Greenwater race really has.
 *
 * Run it before the pass and after it and diff the two PNGs byte for byte.
 */
import {mkdir,writeFile} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {launchReviewBrowser} from '../tideline-v4/browser.mjs';

const flag=name=>process.argv.find(a=>a.startsWith('--'+name+'='))?.slice(name.length+3);
const out=flag('out')??'art/evidence/dreamisland-v1/alive/code/greenwater';
const base=flag('base')??'http://127.0.0.1:5200';
await mkdir(out,{recursive:true});

/** Fixed HUD copy. Every id the shell owns that a circuit runtime or the race
 * loop writes, pinned so the frame cannot move between two runs. */
const TEXT={
 'position-value':'P2 / 4','lap-value':'LAP 2 / 5','gap-value':'+1.4 S TO P1',
 'time-value':'01:12.480','delta-chip-value':'-0.412','sector-delta':'-0.412',
 'checkpoint-value':'NEXT GATE 04 / 08','sector-value':'RUNWAY 09','finish-value':'6.2 KM TO FINISH',
 'speed-value':'412','drive-state':'SKIDS DOWN','boost-value':'68%','boost-label':'PLASMA RESERVE',
 'turn-label':'TURN LEFT','turn-distance':'120 M','system-status':'TOTEM READY',
};
const LADDER=[
 {position:1,name:'VESPER',player:false,gapMs:-1400},
 {position:2,name:'YOU',player:true,gapMs:0},
 {position:3,name:'KESTREL',player:false,gapMs:2300},
 {position:4,name:'ORACLE',player:false,gapMs:9100},
];

const browser=await launchReviewBrowser();
try{
 const page=await browser.newPage(),errors=[];
 page.on('pageerror',e=>{errors.push(String(e));console.log(String(e));});
 page.on('console',m=>{if(m.type()==='error'){errors.push(m.text());console.log(m.text());}});
 const url=base+'/?map=greenwater&seed=714&tier=works&demo=1&headless=1&diagnostics=1'
  +'&start=manual&quality=high&music=0&voice=0';
 await page.goto(url,{waitUntil:'networkidle0',timeout:90000});
 await page.waitForSelector('#start-button',{visible:true});
 // The race has to actually start for the HUD blocks to be shown; it is then
 // frozen by cancelling every animation frame the page owns, so nothing the
 // loop writes can land after the fixed strings below.
 await page.click('#start-button');
 // 'running', not 'not countdown': the countdown's own numeral is a HUD node,
 // and freezing while it is up put a "3" in the frame on some runs and not on
 // others. The first capture of this harness differed from its own repeat on
 // 3,877 pixels for exactly that reason, plus a lap-pip row and a plasma
 // segment that the race had had time to write in one run and not the other.
 await page.waitForFunction(()=>{try{return JSON.parse(document.getElementById('futurisma-diagnostics').textContent).current.phase==='running';}catch{return false;}},{timeout:90000});
 const applied=await page.evaluate(({text,ladder})=>{
  // Freeze: from here nothing schedules another frame, so the DOM below is the
  // DOM the screenshot sees.
  const raf=window.requestAnimationFrame;
  let highest=0;
  window.requestAnimationFrame=cb=>{const id=raf(cb);highest=Math.max(highest,id);return id;};
  for(let id=1;id<=highest+4096;id++)window.cancelAnimationFrame(id);
  window.requestAnimationFrame=()=>0;
  // EVERY canvas, not the first one: `document.querySelector('canvas')` picks
  // the minimap in this shell, which left the WebGL canvas in the frame and
  // made two runs of this harness differ on 401,018 pixels.
  for(const canvas of document.querySelectorAll('canvas'))canvas.style.visibility='hidden';
  document.body.style.background='#000';
  const missing=[];
  for(const [id,value] of Object.entries(text)){
   const node=document.getElementById(id);
   if(!node){missing.push(id);continue;}
   node.textContent=value;
  }
  const fill=document.getElementById('boost-fill');if(fill)fill.style.transform='scaleX(0.68)';
  // THE STATE ATTRIBUTES, not just the text. The plasma bar is cyan while the
  // craft is boosting and acid green while it is not, and `drive-state` and the
  // speed read follow the same flag; the demo car's boost is a function of how
  // far it happens to have driven, so two runs of this harness disagreed on
  // 8,851 pixels of bar colour with every string already pinned. Every
  // attribute the drive cluster keys its look on is written here.
  const attributes=[['boost-meter',{state:'ready',active:'false'}],
   ['drive-state',{state:'nominal'}],['speed-value',{boost:'false'}],
   ['boost-fill',{active:'false'}]];
  for(const [id,data] of attributes){
   const node=document.getElementById(id);
   if(!node)continue;
   for(const [key,value] of Object.entries(data))node.dataset[key]=value;
  }
  document.body.dataset.boost='false';
  // Everything else the race writes into the HUD and this harness does not own.
  document.getElementById('lap-pips')?.replaceChildren();
  const countdown=document.getElementById('countdown');if(countdown)countdown.textContent='';
  const drift=document.getElementById('drift-charge');if(drift)drift.style.transform='scaleX(0)';
  // The three full-screen glows. Their opacity is written by the race loop from
  // live contact and slipstream, and a stray 0.04 of cushion glow in the corner
  // of one run was 381,703 differing pixels of "not byte-identical". They are
  // pinned off; `setAttribute('style', ...)` is NOT used for any of this,
  // because the shipped CSP is `style-src 'self'` and an inline style attribute
  // is blocked by it (a CSSOM property write is not).
  // Generic, not a list of ids: ANY element that covers most of the viewport
  // and is not part of the HUD is removed from the frame. Naming them one at a
  // time found three and missed a fourth, and "missed a fourth" reads exactly
  // like a regression in the diff this harness exists to make trustworthy.
  // CSS animations and transitions are wall-clock, and the freeze above only
  // stops the game's own frames. A pulsing plasma bar and a transitioning speed
  // read left a 10,178-pixel difference between two runs of this harness.
  for(const node of document.querySelectorAll('*')){
   if(!(node instanceof HTMLElement||node instanceof SVGElement))continue;
   node.style.animation='none';node.style.transition='none';
  }
  const hudRoot=document.querySelector('.hud');
  const header=document.querySelector('header');
  for(const node of document.querySelectorAll('body *')){
   if(!(node instanceof HTMLElement))continue;
   if(hudRoot?.contains(node)||node.contains(hudRoot)||header?.contains(node))continue;
   const box=node.getBoundingClientRect();
   if(box.width>=innerWidth*.6&&box.height>=innerHeight*.5)node.style.display='none';
  }
  for(const id of ['delta-chip','sector-delta','last-lap-value','clean-chain'])
   document.getElementById(id)?.removeAttribute('hidden');
  for(const id of ['track-event-chip','slipstream-chip','edge-warning','lap-event'])
   document.getElementById(id)?.setAttribute('aria-hidden','true');
  const progress=document.getElementById('progress-fill');if(progress)progress.style.transform='scaleX(0.42)';
  // The timing-tower rows, through the shared method this pass edits.
  const list=document.getElementById('field-order');
  const rows=ladder.map(entry=>{
   const row=document.createElement('li'),bar=document.createElement('i');
   const position=document.createElement('span'),name=document.createElement('span'),gap=document.createElement('span');
   name.className='n';gap.className='gap';
   position.textContent='P'+entry.position;
   name.textContent=entry.player?entry.name+' · YOU':entry.name;
   gap.textContent=entry.player?'':(entry.gapMs>0?'+':'')+(entry.gapMs/1000).toFixed(1);
   row.dataset.best=String(entry.player);row.dataset.player=String(entry.player);
   row.append(bar,position,name,gap);return row;
  });
  list.replaceChildren(...rows);
  return {missing,circuit:document.documentElement.dataset.circuit??null,
   hudHidden:document.querySelector('.hud')?.hidden??null,
   islandStylesheet:[...document.styleSheets].some(sheet=>/style-dreamisland/.test(sheet.href??'')),
   islandLink:[...document.querySelectorAll('link')].map(l=>l.href).filter(h=>/dreamisland|fonts\.googleapis|fonts\.gstatic/.test(h)),
   scripts:[...document.querySelectorAll('script[src]')].map(s=>s.src).filter(h=>/dreamisland/.test(h))};
 },{text:TEXT,ladder:LADDER});
 await new Promise(resolve=>setTimeout(resolve,400));
 await page.screenshot({path:out+'/greenwater-hud.png'});
 const hash=createHash('sha256').update(readFileSync(out+'/greenwater-hud.png')).digest('hex');
 await writeFile(out+'/greenwater-hud.json',JSON.stringify({
  script:'scripts/visual/dreamisland/greenwater-hud.mjs',url,applied,errors,
  frame:'greenwater-hud.png',sha256:hash},null,2)+'\n');
 console.log(JSON.stringify({sha256:hash,...applied,errors:errors.length}));
}finally{await browser.close();}
