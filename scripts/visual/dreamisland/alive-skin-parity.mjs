/**
 * Phase F round 2, item 1 — the island's skin renders the same on the dev
 * server as it does on a production build.
 *
 *   node scripts/visual/dreamisland/alive-skin-parity.mjs --base=http://127.0.0.1:5210 --out=DIR/dev
 *   node scripts/visual/dreamisland/alive-skin-parity.mjs --base=http://127.0.0.1:5211 --out=DIR/preview
 *   # then diff the two PNGs
 *
 * WHAT THIS CAN AND CANNOT PROVE. Two live races on two servers never reach the
 * same frame: the freeze fires on the first frame that matches a state, and
 * which frame that is depends on wall-clock timing, so a full-frame diff of the
 * two would be a diff of two different moments of the world. What item 1 is
 * about is the STYLESHEET reaching the page, and that is provable exactly:
 * freeze the race, hide the canvas, write every HUD node a fixed string, pin
 * the state attributes the shell keys its colours on, switch off every CSS
 * animation and transition, and photograph the HUD. Anything the skin does
 * differently between the two servers shows up; nothing the world does can.
 *
 * It is the same construction `greenwater-hud.mjs` uses, for the same reason,
 * and it was made deterministic the same way: by running it twice on one server
 * before it was used to compare two.
 */
import {mkdir,writeFile} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {launchReviewBrowser} from '../tideline-v4/browser.mjs';

const flag=name=>process.argv.find(a=>a.startsWith('--'+name+'='))?.slice(name.length+3);
const out=flag('out')??'art/evidence/dreamisland-v1/alive/code/round-2/skin/dev';
const base=flag('base');
if(!base)throw Error('--base= is required');
const [width,height]=(flag('size')??'1440x810').split('x').map(Number);
await mkdir(out,{recursive:true});

const TEXT={
 'position-value':'P2 / 4','lap-value':'LAP 2 / 9','gap-value':'+1.4 S TO P1',
 'time-value':'01:12.480','checkpoint-value':'NEXT GATE 04 / 08','sector-value':'CLOCK COURT',
 'finish-value':'6.2 KM TO FINISH','speed-value':'412','drive-state':'SKIDS DOWN',
 'boost-value':'68%','boost-label':'PLASMA RESERVE','turn-label':'TURN LEFT',
 'turn-distance':'120 M','system-status':'RACE ACTIVE','course-name':'DREAM ISLAND / MAP 07',
 'polarity-flip':'SPACE / SHIFT · NITRO','polarity-deck':'DREAM ISLAND / DAY INTO NIGHT',
 'polarity-route':'THE STRIKE IN 01:00',
};

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
 // The island's own HUD nodes only exist once the runtime has attached, and the
 // power slot only reaches its states in a running race.
 for(const started=Date.now();Date.now()-started<180000;){
  const ready=await page.evaluate(()=>{
   try{
    const race=JSON.parse(document.getElementById('futurisma-diagnostics').textContent);
    return race.current.phase==='running'&&!!document.getElementById('di-power-slot');
   }catch{return false;}
  });
  if(ready)break;
  await new Promise(resolve=>setTimeout(resolve,80));
 }
 const applied=await page.evaluate(({text})=>{
  const raf=window.requestAnimationFrame;
  let highest=0;
  window.requestAnimationFrame=cb=>{const id=raf(cb);highest=Math.max(highest,id);return id;};
  for(let id=1;id<=highest+8192;id++)window.cancelAnimationFrame(id);
  window.requestAnimationFrame=()=>0;
  for(const canvas of document.querySelectorAll('canvas'))canvas.style.visibility='hidden';
  document.body.style.background='#000';
  for(const node of document.querySelectorAll('*')){
   if(!(node instanceof HTMLElement||node instanceof SVGElement))continue;
   node.style.animation='none';node.style.transition='none';
  }
  const hudRoot=document.querySelector('.hud'),header=document.querySelector('header');
  for(const node of document.querySelectorAll('body *')){
   if(!(node instanceof HTMLElement))continue;
   if(hudRoot?.contains(node)||node.contains(hudRoot)||header?.contains(node))continue;
   const box=node.getBoundingClientRect();
   if(box.width>=innerWidth*.6&&box.height>=innerHeight*.5)node.style.display='none';
  }
  const missing=[];
  for(const [id,value] of Object.entries(text)){
   const node=document.getElementById(id);
   if(!node){missing.push(id);continue;}
   node.textContent=value;
  }
  const fill=document.getElementById('boost-fill');if(fill)fill.style.transform='scaleX(0.68)';
  const drift=document.getElementById('drift-charge');if(drift)drift.style.transform='scaleX(0)';
  const progress=document.getElementById('progress-fill');if(progress)progress.style.transform='scaleX(0.42)';
  document.getElementById('lap-pips')?.replaceChildren();
  const countdown=document.getElementById('countdown');if(countdown)countdown.textContent='';
  for(const [id,data] of [['boost-meter',{state:'ready',active:'false'}],
   ['drive-state',{state:'nominal'}],['speed-value',{boost:'false'}],['boost-fill',{active:'false'}]]){
   const node=document.getElementById(id);
   if(node)for(const [key,value] of Object.entries(data))node.dataset[key]=value;
  }
  document.body.dataset.boost='false';
  // The island's own nodes, pinned to one state so the two servers draw the
  // same slot rather than whatever each race had reached.
  const slot=document.getElementById('di-power-slot');
  if(slot){
   slot.dataset.powerState='armed';slot.dataset.kind='surge';slot.dataset.teach='false';
   slot.querySelector('.di-slot__name').textContent='SURGE READY';
   slot.querySelector('.di-slot__advice').textContent='THE BEACH STRAIGHT IS NEXT · 220 M';
   slot.querySelector('.di-slot__key').textContent='E';
  }
  const bubble=document.querySelector('.di-bubble');
  if(bubble){
   bubble.dataset.active='true';bubble.dataset.kind='surge';
   bubble.style.transform='translate(-50%,-100%) translate(720px,300px)';
   bubble.querySelector('.di-bubble__name').textContent='SURGE';
   bubble.querySelector('.di-bubble__range').textContent='96 M';
  }
  const list=document.getElementById('field-order');
  if(list){
   const rows=[['P1','VESPER',false,'-1.4'],['P2','TOTEM · YOU',true,''],
    ['P3','KESTREL',false,'+2.3'],['P4','ORACLE',false,'+9.1']].map(([p,name,player,gap])=>{
    const row=document.createElement('li'),bar=document.createElement('i');
    const position=document.createElement('span'),label=document.createElement('span'),g=document.createElement('span');
    label.className='n';g.className='gap';
    position.textContent=p;label.textContent=name;g.textContent=gap;
    row.dataset.best=String(player);row.dataset.player=String(player);
    row.append(bar,position,label,g);return row;
   });
   list.replaceChildren(...rows);
  }
  // The clock hands are a function of the tick; pin them so the dial matches.
  for(const [selector,angle] of [['.di-clock__hour',120],['.di-clock__minute',210]]){
   document.querySelector(selector)?.setAttribute('transform','rotate('+angle+' 32 32)');
  }
  document.documentElement.style.setProperty('--di-night','0');
  return {missing,circuit:document.documentElement.dataset.circuit??null,
   skinLinks:[...document.querySelectorAll('link[rel=stylesheet]')].map(l=>l.href)
    .filter(h=>/style-dreamisland/.test(h)).length,
   styleTags:document.querySelectorAll('style').length,
   lapPlateRadius:getComputedStyle(document.querySelector('.hud-standing__lap')).borderRadius,
   slotFont:getComputedStyle(document.querySelector('.di-slot__name')).fontFamily.split(',')[0].replace(/"/g,''),
   bubblePillHeight:getComputedStyle(document.querySelector('.di-bubble__pill')).height};
 },{text:TEXT});
 // Fonts must be loaded before the shot or the two servers can differ on which
 // face drew the text.
 await page.evaluate(()=>document.fonts.ready);
 await new Promise(resolve=>setTimeout(resolve,600));
 await page.screenshot({path:out+'/skin.png'});
 const hash=createHash('sha256').update(readFileSync(out+'/skin.png')).digest('hex');
 await writeFile(out+'/skin.json',JSON.stringify({
  script:'scripts/visual/dreamisland/alive-skin-parity.mjs',base,viewport:width+'x'+height,
  applied,errors,frame:'skin.png',sha256:hash},null,2)+'\n');
 console.log(JSON.stringify({base,sha256:hash,...applied,errors:errors.length}));
}finally{await browser.close();}
