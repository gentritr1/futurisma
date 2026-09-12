import {INPUT_PROMPTS} from './input-prompt-map.js';
import {dreamIslandClockAngles} from './dreamisland-clock.js';
import {DREAMISLAND_ABILITY_CONFIG,DREAMISLAND_FIELDS} from './dreamisland-powers-config.js';
import type * as THREE from 'three';
import type {DreamIslandCourse} from './dreamisland-course';

/**
 * Phase F §4.5, §4.6 and §4.7 — the island's own screen.
 *
 * The playtest's third finding was that the screen reads as a dashboard rather
 * than a game: twelve static blocks where numbers change and nothing else does.
 * Three things answer that, and all three live here:
 *
 *  - §4.5 the SKIN and the TIMING TOWER. The skin is `src/style-dreamisland.css`,
 *    scoped under `:root[data-circuit="dreamisland"]`, restyling the HUD nodes
 *    the shell already has. This class owns only what CSS cannot do: the night
 *    switch (one custom property, from `nightBlend`) and the clock dial, whose
 *    hands come from `dreamIslandClockAngles` — the same function the tower's
 *    hands run on, imported rather than re-derived.
 *  - §4.6 the POWER SLOT: five states, one `data-power-state` each, plus a
 *    bubble projected from the capsule's world position into screen space.
 *  - §4.7 the three FEEL moments: the fire (camera and speed lines), the strike
 *    (flash, snap, one goldfish) and the overtake pill.
 *
 * NO MARKUP IN THE SHELL. Every node below is created here and removed on
 * dispose, so the island's HUD costs the shell zero bytes of HTML rather than
 * the handful `index.html` would have cost, and a race on any other circuit has
 * never had these nodes in its tree at all.
 *
 * NOTHING HERE CAN MOVE THE SIMULATION. Every animation is driven by
 * `performance.now()` or by the absolute tick, and the only value this class
 * hands back to the world is a camera FOV offset. That is why the first-pickup
 * moment in §4.6 is the pill growing to 120 px and not slow motion: the tick is
 * frozen at its 60/120/240 Hz-identical contract.
 */
type Powers={
 heldPowerKind:'surge'|'shield'|null;
 state:{activePower:'surge'|'shield'|null;tick:number;powerUntilTick:number;powerStartTick:number};
 powerSeconds:number;
 getPickupStates():{available:boolean;charge:number}[];
};
/** §4.7 fire: 62 -> 70 over 120 ms, back over 600 ms. */
const FOV_BASE=62,FOV_PEAK=70,FOV_RISE_MS=120,FOV_FALL_MS=600;
const STRIKE_FLASH_MS=300,GOLDFISH_MS=2400,OVERTAKE_MS=1600;
const COLLECTED_MS=400,FIRST_ARMED_MS=3000;
/** §4.6: the bubble appears inside this range. */
const IN_RANGE_METRES=120;
const KIND_LABEL={surge:'SURGE',shield:'PHASE SHIELD'} as const;

export class DreamIslandHud{
 /** Zero on every field if `attach` never ran, which is what makes a silent
  * no-op visible in the diagnostics blob. */
 readonly report={attached:0,slotStates:{} as Record<string,number>,
  firstArmedShown:0,bubbleFrames:0,overtakePills:0,
  /** The clock striking, and the two things §4.7 draws when it does. They are
   * counted separately on purpose: under `?motion=reduce` the strike still
   * happens and the flash still becomes a 0 ms cut, so a single counter would
   * read as "the flash fired" on exactly the run where it must not. */
  strikeEvents:0,strikeFlashesShown:0,fishSwims:0,
  clockDialFrames:0,stylesheet:'src/game/style-dreamisland.css',fonts:[] as string[],
  stylesheetHref:null as string|null};
 /** The live state, published for the frame harness so a capture can be keyed
  * on the state rather than on a guess about timing. */
 powerState:'hunting'|'in-range'|'collected'|'armed'|'active'='hunting';
 private root:HTMLDivElement|null=null;
 private slot:HTMLDivElement|null=null;
 private slotName:HTMLElement|null=null;
 private slotAdvice:HTMLElement|null=null;
 private slotKey:HTMLElement|null=null;
 private slotRing:SVGCircleElement|null=null;
 private bubble:HTMLDivElement|null=null;
 private dial:SVGSVGElement|null=null;
 private hourHand:SVGLineElement|null=null;
 private minuteHand:SVGLineElement|null=null;
 private lines:HTMLDivElement|null=null;
 private flash:HTMLDivElement|null=null;
 private fish:HTMLDivElement|null=null;
 private pills:HTMLDivElement|null=null;
 private fontLinks:HTMLLinkElement[]=[];
 private firedAt=-Infinity;
 private firedKind:'surge'|'shield'|null=null;
 private collectedAt=-Infinity;
 private armedAt=-Infinity;
 private firstArmedDone=false;
 private strikeAt=-Infinity;
 private lastStruck=false;
 private lastDevice='';
 private lastOrder:string[]=[];
 private lastPlayerIndex=-1;
 private lastNight=-1;
 private readonly reducedMotion:boolean;
 constructor(private readonly course:DreamIslandCourse,reducedMotion:boolean){
  this.reducedMotion=reducedMotion;
 }

 attach():void{
  if(this.root)return;
  const hud=document.querySelector('.hud');
  if(!hud)return;
  // THE SKIN, AS A FILE FROM THIS ORIGIN — round 2, item 1.
  //
  // It used to be `import '../style-dreamisland.css'` in the runtime. Vite
  // delivers an imported stylesheet in DEV by injecting a `<style>` element,
  // and the shipped `style-src 'self'` blocks exactly that, so the whole skin
  // was missing on `npm run dev`: raw bubble text, black discs where the chrome
  // roundels belong. A production build was fine and a dev build was not, which
  // is the worst possible split because the dev build is what a playtest sees.
  //
  // `new URL('./style-dreamisland.css', import.meta.url)` is a self URL in both:
  // in dev it is `/src/game/style-dreamisland.css`, which Vite serves as
  // `text/css` to a request whose `Sec-Fetch-Dest` is `style` (i.e. to this
  // link); in a build it is the hashed asset Vite emits beside the chunk.
  // Either way the CSP sees a stylesheet from the site's own origin, and the
  // shell still references none of it.
  const skin=document.createElement('link');
  skin.rel='stylesheet';
  skin.href=new URL('./style-dreamisland.css',import.meta.url).href;
  document.head.append(skin);
  this.fontLinks.push(skin);
  this.report.stylesheetHref=skin.href;
  // The two faces are served from `public/assets/dreamisland/fonts/`; the
  // `@font-face` rules are in the island stylesheet and nowhere else.
  this.report.fonts=['Michroma','Share Tech Mono'];

  // NO markup strings. `scripts/validate-security.mjs` bans assigning parsed
  // HTML in src/ outright, and it is right to: this is the only place in the
  // pass that builds markup, and a string template here would be the one place
  // a future label interpolated from a rival name could become markup.
  const el=<K extends keyof HTMLElementTagNameMap>(tag:K,className?:string,text?:string)=>{
   const node=document.createElement(tag);
   if(className)node.className=className;
   if(text!==undefined)node.textContent=text;
   return node;
  };
  // The SVG namespace is READ OFF THE SHELL's own `<svg>`, exactly as
  // `ability-slots.ts` reads it, rather than written as a literal: the security
  // validator bans an absolute URL anywhere in `src/`, and a namespace taken
  // from the document that is about to hold the node cannot be the wrong one.
  const namespace=document.querySelector('svg')?.namespaceURI??'';
  const svg=(tag:string,attributes:Record<string,string>)=>{
   const node=document.createElementNS(namespace,tag);
   for(const [name,value] of Object.entries(attributes))node.setAttribute(name,value);
   return node;
  };

  const root=el('div','di-layer');
  root.id='dreamisland-hud';root.setAttribute('aria-hidden','true');

  const lines=el('div','di-lines');lines.dataset.active='false';
  const flash=el('div','di-flash');flash.dataset.active='false';

  const fish=el('div','di-fish');fish.dataset.active='false';
  const fishSvg=svg('svg',{viewBox:'0 0 64 28',width:'64',height:'28'});
  fishSvg.append(
   svg('path',{d:'M4 14 Q18 2 40 8 Q54 12 60 14 Q54 16 40 20 Q18 26 4 14 Z',fill:'currentColor'}),
   svg('path',{d:'M4 14 L-6 6 L-4 14 L-6 22 Z',fill:'currentColor',opacity:'.8'}),
   svg('circle',{cx:'47',cy:'12.5',r:'1.8',fill:'#06202a'}));
  fish.append(fishSvg);

  const pills=el('div','di-pills');

  // Round 2, item 6. The bubble was a 26 px pill with 14 px type and it read as
  // a tooltip rather than as the callout the canvas board draws. It is now a
  // pill with its own chevron pointing down at the capsule, so the thing it
  // names is unambiguous even when two capsules are on screen.
  const bubble=el('div','di-bubble');bubble.dataset.active='false';
  const bubblePill=el('div','di-bubble__pill');
  bubblePill.append(el('b','di-bubble__name','SURGE'),
   el('span','di-bubble__advice','DRIVE THROUGH'),
   el('span','di-bubble__range','120 M'));
  const chevron=el('span','di-bubble__chevron');
  chevron.setAttribute('aria-hidden','true');
  bubble.append(bubblePill,chevron);

  const slot=el('div','di-slot');
  slot.id='di-power-slot';slot.dataset.powerState='hunting';slot.dataset.kind='';slot.dataset.teach='false';
  const orb=el('span','di-slot__orb');
  const orbSvg=svg('svg',{viewBox:'0 0 44 44',width:'44',height:'44','aria-hidden':'true'});
  orbSvg.append(
   svg('circle',{class:'di-slot__orbbase',cx:'22',cy:'22',r:'19'}),
   svg('circle',{class:'di-slot__ring',cx:'22',cy:'22',r:'19'}),
   svg('rect',{class:'di-slot__glyph',x:'17',y:'11',width:'10',height:'22',rx:'5'}),
   svg('rect',{class:'di-slot__glyphcore',x:'20',y:'15',width:'4',height:'14',rx:'2'}));
  orb.append(orbSvg);
  const text=el('span','di-slot__text');
  text.append(el('b','di-slot__name','SURGE'),
   el('span','di-slot__advice','DRIVE THROUGH THE CAPSULE'));
  const key=el('kbd','di-slot__key','E');
  key.dataset.prompt='power';
  slot.append(orb,text,key);

  root.append(lines,flash,fish,pills,bubble,slot);
  hud.append(root);
  this.root=root;
  this.slot=slot;
  this.slotName=text.querySelector('.di-slot__name');
  this.slotAdvice=text.querySelector('.di-slot__advice');
  this.slotKey=key;
  this.slotRing=orbSvg.querySelector('.di-slot__ring');
  this.bubble=bubble;
  this.lines=lines;
  this.flash=flash;
  this.fish=fish;
  this.pills=pills;

  // The clock dial goes beside the strike countdown, which is the shell's
  // `#polarity-route` line; the dial and that line say the same thing in two
  // registers, so they belong in one place.
  const route=document.getElementById('polarity-route');
  if(route?.parentElement){
   const holder=el('span','di-clock');
   const dial=svg('svg',{viewBox:'0 0 64 64',width:'64',height:'64','aria-hidden':'true'});
   dial.append(svg('circle',{class:'di-clock__face',cx:'32',cy:'32',r:'29'}),
    svg('circle',{class:'di-clock__rim',cx:'32',cy:'32',r:'29'}));
   const ticks=svg('g',{class:'di-clock__ticks'});
   for(let i=0;i<12;i++){
    const angle=i*Math.PI/6,inner=i%3===0?21:24;
    ticks.append(svg('line',{
     x1:(32+Math.sin(angle)*inner).toFixed(2),y1:(32-Math.cos(angle)*inner).toFixed(2),
     x2:(32+Math.sin(angle)*27).toFixed(2),y2:(32-Math.cos(angle)*27).toFixed(2)}));
   }
   const hour=svg('line',{class:'di-clock__hour',x1:'32',y1:'32',x2:'32',y2:'16'});
   const minute=svg('line',{class:'di-clock__minute',x1:'32',y1:'32',x2:'32',y2:'8'});
   dial.append(ticks,hour,minute,svg('circle',{class:'di-clock__pin',cx:'32',cy:'32',r:'2.4'}));
   holder.append(dial);
   route.parentElement.append(holder);
   this.dial=dial as SVGSVGElement;
   this.hourHand=hour as SVGLineElement;
   this.minuteHand=minute as SVGLineElement;
  }
  this.report.attached=1;
  this.refreshKeycap();
 }

 /** §4.7 fire: the camera's own share of the moment. Returns the offset the
  * runtime adds to its 62-degree chase FOV. Wall-clock, presentation only. */
 fovOffset():number{
  if(this.reducedMotion)return 0;
  const since=performance.now()-this.firedAt;
  if(!(since>=0))return 0;
  if(since<=FOV_RISE_MS)return (FOV_PEAK-FOV_BASE)*(since/FOV_RISE_MS);
  const falling=(since-FOV_RISE_MS)/FOV_FALL_MS;
  if(falling>=1)return 0;
  return (FOV_PEAK-FOV_BASE)*(1-falling)*(1-falling);
 }

 /**
  * One frame of the island's screen.
  *
  * @param powers the live ability simulation
  * @param progress the player's lap progress
  * @param camera the chase camera, for the world bubble's projection
  */
 update(powers:Powers,progress:number,camera:THREE.PerspectiveCamera|null,
  lap:number,now=performance.now()):void{
  if(!this.root)return;
  const blend=this.course.nightBlend;
  if(Math.abs(blend-this.lastNight)>=.004){
   this.lastNight=blend;
   this.root.style.setProperty('--di-night',blend.toFixed(3));
   document.documentElement.style.setProperty('--di-night',blend.toFixed(3));
  }
  this.updateClock();
  this.updateSlot(powers,progress,camera,lap,now);
  this.updateStrike(now);
  this.updateOvertakes(now);
  this.updateFire(powers,now);
 }

 private updateClock():void{
  if(!this.hourHand||!this.minuteHand)return;
  const angles=dreamIslandClockAngles(this.course.schedule.tick,this.course.schedule.config?.strikeTick??null);
  this.hourHand.setAttribute('transform',`rotate(${(angles.hour*180/Math.PI).toFixed(3)} 32 32)`);
  this.minuteHand.setAttribute('transform',`rotate(${(angles.minute*180/Math.PI).toFixed(3)} 32 32)`);
  this.report.clockDialFrames++;
 }

 /** The nearest uncollected pickup ahead of the player, in metres. */
 private nextPickup(powers:Powers,progress:number):{index:number;metres:number}|null{
  const states=powers.getPickupStates();
  let best:{index:number;metres:number}|null=null;
  DREAMISLAND_ABILITY_CONFIG.pickups.forEach((pickup,index)=>{
   if(!states[index]?.available)return;
   const ahead=((pickup.progress-progress)%1+1)%1;
   const metres=ahead*this.course.length;
   if(!best||metres<best.metres)best={index,metres};
  });
  return best;
 }

 /** The launch zone or field a held power is FOR, named in the driver's terms. */
 private adviceFor(kind:'surge'|'shield',progress:number):string{
  if(kind==='shield'){
   const field=DREAMISLAND_FIELDS[0];
   const ahead=((field.progress-progress)%1+1)%1*this.course.length;
   return `THE BORE IS NEXT · ${Math.round(ahead)} M`;
  }
  const zones=DREAMISLAND_ABILITY_CONFIG.launchZones;
  let best:{id:string;metres:number}|null=null;
  for(const zone of zones){
   const ahead=((zone.from-progress)%1+1)%1*this.course.length;
   if(!best||ahead<best.metres)best={id:zone.id,metres:ahead};
  }
  if(!best)return 'HOLD IT FOR THE STRAIGHT';
  const name=best.id==='beach-strip'?'THE BEACH STRAIGHT':'THE REEF STRIP';
  return `${name} IS NEXT · ${Math.round(best.metres)} M`;
 }

 private updateSlot(powers:Powers,progress:number,camera:THREE.PerspectiveCamera|null,
  lap:number,now:number):void{
  if(!this.slot||!this.slotName||!this.slotAdvice)return;
  const active=powers.state.activePower,held=powers.heldPowerKind;
  const next=this.nextPickup(powers,progress);
  let state:typeof this.powerState;
  if(active)state='active';
  else if(held){
   if(this.armedAt<0)this.armedAt=now;
   state=now-this.collectedAt<COLLECTED_MS?'collected':'armed';
  }else{
   this.armedAt=-Infinity;
   state=next&&next.metres<=IN_RANGE_METRES?'in-range':'hunting';
  }
  if(state!==this.powerState){
   this.powerState=state;
   this.report.slotStates[state]=(this.report.slotStates[state]??0)+1;
  }
  this.slot.dataset.powerState=state;
  this.slot.dataset.kind=active??held??(next?DREAMISLAND_ABILITY_CONFIG.pickups[next.index].kind??'':'');
  this.slot.dataset.lap=String(lap);
  let ring=0;
  // "then never again that race": the teach is retired when its three seconds
  // are up OR the moment the player fires, whichever comes first. Retiring it
  // only on the timer left it to show a second time for a driver who took the
  // lesson immediately and fired inside three seconds — the one driver who has
  // already proved they do not need it.
  if(state==='active'&&this.report.firstArmedShown===1)this.firstArmedDone=true;
  if(state==='active'&&active){
   // The teach attribute is cleared here as well as in the armed branch. It
   // was not, and the 120 px pill therefore stayed 120 px through the whole of
   // the first fire: the driver took the lesson, fired, and the slot kept
   // shouting it while the power ran.
   this.slot.dataset.teach='false';
   const total=Math.max(1,powers.state.powerUntilTick-powers.state.powerStartTick);
   ring=1-Math.min(1,Math.max(0,(powers.state.tick-powers.state.powerStartTick)/total));
   this.slotName.textContent=`${KIND_LABEL[active]} ${powers.powerSeconds.toFixed(1)} S`;
   this.slotAdvice.textContent=active==='surge'?'HOLD THE LINE':'THE FIELD CANNOT TOUCH YOU';
  }else if(state==='armed'||state==='collected'){
   const kind=held!;
   ring=state==='collected'?Math.min(1,(now-this.collectedAt)/COLLECTED_MS):1;
   const first=!this.firstArmedDone&&now-this.armedAt<FIRST_ARMED_MS;
   if(state==='armed'&&first){
    this.slot.dataset.teach='true';
    this.slotName.textContent='HOLD E TO FIRE';
    this.slotAdvice.textContent=this.adviceFor(kind,progress);
    if(this.report.firstArmedShown===0)this.report.firstArmedShown=1;
   }else{
    if(state==='armed'&&!this.firstArmedDone&&now-this.armedAt>=FIRST_ARMED_MS)this.firstArmedDone=true;
    this.slot.dataset.teach='false';
    this.slotName.textContent=state==='collected'?`${KIND_LABEL[kind]} COLLECTED`:`${KIND_LABEL[kind]} READY`;
    this.slotAdvice.textContent=this.adviceFor(kind,progress);
   }
  }else if(next){
   const kind=DREAMISLAND_ABILITY_CONFIG.pickups[next.index].kind as 'surge'|'shield';
   this.slot.dataset.teach='false';
   this.slotName.textContent=`${KIND_LABEL[kind]} · ${Math.round(next.metres)} M`;
   this.slotAdvice.textContent=state==='in-range'?'DRIVE THROUGH THE CAPSULE':'FIND A CAPSULE';
  }else{
   this.slot.dataset.teach='false';
   this.slotName.textContent='NO CAPSULE THIS LAP';
   this.slotAdvice.textContent='THE CAPSULES RETURN NEXT LAP';
  }
  if(this.slotRing){
   const circumference=2*Math.PI*19;
   this.slotRing.style.strokeDasharray=String(circumference);
   this.slotRing.style.strokeDashoffset=String(circumference*(1-ring));
  }
  this.refreshKeycap();
  this.updateBubble(state,next,camera);
 }

 /** §4.6 state 2: the capsule's own callout, projected every frame. */
 private updateBubble(state:string,next:{index:number;metres:number}|null,
  camera:THREE.PerspectiveCamera|null):void{
  const bubble=this.bubble;
  if(!bubble)return;
  if(state!=='in-range'||!next||!camera||!this.course.capsules){
   if(bubble.dataset.active!=='false')bubble.dataset.active='false';
   return;
  }
  const placement=this.course.capsules.report.placements[next.index];
  const pickup=DREAMISLAND_ABILITY_CONFIG.pickups[next.index];
  const sample=this.course.sample(pickup.progress);
  const point=sample.position.clone().addScaledVector(sample.right,pickup.lateral??0);
  point.y=placement.centreY+2.4;
  const projected=point.project(camera);
  if(projected.z>1||projected.x<-1.1||projected.x>1.1||projected.y<-1.1||projected.y>1.1){
   bubble.dataset.active='false';return;
  }
  const x=(projected.x*.5+.5)*window.innerWidth;
  const y=(-projected.y*.5+.5)*window.innerHeight;
  // The bob is presentation, so it runs on the wall clock, and it stops dead
  // under `?motion=reduce` like everything else in this file.
  const bob=this.reducedMotion?0:Math.sin(performance.now()/620)*5;
  bubble.style.transform=`translate(-50%,-100%) translate(${x.toFixed(1)}px,${(y+bob).toFixed(1)}px)`;
  bubble.dataset.active='true';
  bubble.dataset.kind=pickup.kind??'';
  const name=bubble.querySelector('.di-bubble__name');
  const range=bubble.querySelector('.di-bubble__range');
  // The bubble is anchored by its CHEVRON TIP, not its centre, so the pill sits
  // above the capsule and the chevron points at it.
  if(name)name.textContent=KIND_LABEL[pickup.kind as 'surge'|'shield'];
  if(range)range.textContent=`${Math.round(next.metres)} M`;
  this.report.bubbleFrames++;
 }

 /** §4.7 the strike: a flash, the hands already snapped by the clock function,
  * and one goldfish across the top of the screen. */
 private updateStrike(now:number):void{
  const struck=!!this.course.schedule.state.struck;
  if(struck&&!this.lastStruck){
   this.strikeAt=now;this.report.strikeEvents++;
   if(!this.reducedMotion)this.report.fishSwims++;
  }
  this.lastStruck=struck;
  const since=now-this.strikeAt;
  if(this.flash){
   // Under reduced motion the flash is a 0 ms cut: it never turns on at all.
   const on=!this.reducedMotion&&since>=0&&since<STRIKE_FLASH_MS;
   if(on&&this.flash.dataset.active!=='true')this.report.strikeFlashesShown++;
   this.flash.dataset.active=on?'true':'false';
   if(on)this.flash.style.opacity=String(1-since/STRIKE_FLASH_MS);
  }
  if(this.fish){
   const on=!this.reducedMotion&&since>=0&&since<GOLDFISH_MS;
   this.fish.dataset.active=on?'true':'false';
   if(on){
    const t=since/GOLDFISH_MS;
    this.fish.style.transform=`translateX(${(t*(window.innerWidth+220)-160).toFixed(1)}px)`
     +` translateY(${(Math.sin(t*Math.PI*3)*16).toFixed(1)}px)`;
   }
  }
 }

 /** §4.7 the overtake pill, read off the tower the HUD already draws. */
 private updateOvertakes(now:number):void{
  const rows=document.querySelectorAll<HTMLElement>('#field-order li');
  if(rows.length===0)return;
  const order:string[]=[];let player=-1;
  rows.forEach((row,index)=>{
   const name=row.querySelector('.n')?.textContent??'';
   order.push(name);
   if(row.dataset.player==='true')player=index;
  });
  if(this.lastPlayerIndex>=0&&player>=0&&player!==this.lastPlayerIndex
   &&order.length===this.lastOrder.length){
   const gained=player<this.lastPlayerIndex;
   const rival=(gained?this.lastOrder[player]:this.lastOrder[this.lastPlayerIndex])
    ?.replace(/ · YOU$/,'')??'';
   if(rival)this.pushPill(gained?`OVERTOOK ${rival}`:`${rival} PASSED YOU`,gained,now);
  }
  this.lastOrder=order;this.lastPlayerIndex=player;
  // Retire finished pills. They are removed rather than hidden, so a long race
  // cannot accumulate a thousand of them.
  if(this.pills){
   for(const pill of Array.from(this.pills.children) as HTMLElement[]){
    if(now-Number(pill.dataset.at)>=OVERTAKE_MS)pill.remove();
   }
  }
 }
 private pushPill(text:string,gained:boolean,now:number):void{
  if(!this.pills)return;
  const pill=document.createElement('div');
  pill.className='di-pill';pill.dataset.gained=String(gained);pill.dataset.at=String(now);
  pill.textContent=text;
  if(this.reducedMotion)pill.dataset.still='true';
  this.pills.append(pill);this.report.overtakePills++;
 }

 /** §4.7 the fire: speed lines and the edge sweep, for the power's duration. */
 private updateFire(powers:Powers,now:number):void{
  const active=powers.state.activePower;
  if(active&&this.firedKind!==active){
   this.firedKind=active;this.firedAt=now;
  }else if(!active&&this.firedKind){this.firedKind=null;}
  if(this.lines){
   const on=!!active&&!this.reducedMotion;
   this.lines.dataset.active=on?'true':'false';
   this.lines.dataset.kind=active??'';
  }
 }

 /** Called by the runtime when a pickup event fires, so the collected state is
  * driven by the simulation's own event rather than by a DOM poll. */
 onCollected(now=performance.now()):void{this.collectedAt=now;this.armedAt=now;}

 /** The keycap's label comes from the shared prompt map, and follows the
  * device the shell has already detected. */
 private refreshKeycap():void{
  const device=document.body.dataset.inputDevice==='gamepad'?'gamepad':'keyboard';
  if(device===this.lastDevice||!this.slotKey)return;
  this.lastDevice=device;
  this.slotKey.textContent=INPUT_PROMPTS.power[device];
 }

 reset():void{
  this.firedAt=-Infinity;this.firedKind=null;this.collectedAt=-Infinity;
  this.armedAt=-Infinity;this.firstArmedDone=false;this.strikeAt=-Infinity;
  this.lastStruck=false;this.lastOrder=[];this.lastPlayerIndex=-1;
  if(this.pills)this.pills.replaceChildren();
 }
 dispose():void{
  this.root?.remove();this.root=null;
  this.dial?.parentElement?.remove();this.dial=null;
  for(const link of this.fontLinks)link.remove();
  this.fontLinks=[];
  document.documentElement.style.removeProperty('--di-night');
 }
}
