const sheet = document.createElement('link');
sheet.rel = 'stylesheet';
sheet.href = new URL('./style-launch.css', import.meta.url).href;
export const stylesheetReady = new Promise<void>((resolve, reject) => {
  sheet.onload = () => resolve();
  sheet.onerror = () => reject(new Error('The launch menu stylesheet could not load. Please reload.'));
});
document.head.append(sheet);
import { TRACKS, trackFor, type MapSelection } from './map-selection';
import { save } from './persistence';
import { fieldLiveries, liveryFor } from './liveries.js';
import { craftNames } from './garage-rules.js';
import { bestRecordKey, normalizeRaceMode, normalizeRivalTier, startingGridRows, RACE_MODE_LABELS, type RaceMode, type RivalTier } from './race-modes-rules.js';
import { CIRCUIT_COLOURS, drawLaunchMap, launchFacts } from './launch-guide';
import { GarageMotion } from './garage-motion';
import { resolveReducedMotion } from './query-probes';
import { installLaunchPanels } from './launch-panels';
import { LaunchHeader, launchBadge } from './launch-header';

type Choice = 'map'|'mode'|'tier';
type Hooks = { sync:(track:MapSelection,mode:RaceMode,tier:RivalTier)=>void; suspend:()=>void; start:()=>Promise<void>; sound:()=>void };
function el<K extends keyof HTMLElementTagNameMap>(tag:K,className='',text=''):HTMLElementTagNameMap[K] {
  const node=document.createElement(tag);node.className=className;node.textContent=text;return node;
}
function required(id:string):HTMLElement {return document.getElementById(id)!;}
function button(id:string,label:string,action:()=>void):HTMLButtonElement {
  const node=el('button','launch-control',label);node.id=id;node.type='button';node.addEventListener('click',action);return node;
}
function time(ms:number):string {return `${Math.floor(ms/60000).toString().padStart(2,'0')}:${((ms%60000)/1000).toFixed(3).padStart(6,'0')}`;}

/** The menu owns a pending race choice. Runtime configuration stays immutable;
 * only LAUNCH dispatches a changed circuit, format or field. */
export class LaunchMenu {
  private readonly screen=required('start-screen');
  private readonly slab=el('aside','launch-slab');
  private readonly number=el('strong','launch-number');
  private readonly name=el('h1','launch-name');
  private readonly deck=el('p','launch-deck');
  private readonly map=el('div','launch-map');
  private readonly twist=el('h2','launch-twist');
  private readonly note=el('p','launch-note');
  private readonly feature=el('p','launch-feature');
  private readonly facts=el('p','launch-facts');
  private readonly detail=el('div','launch-detail');
  private readonly brief=el('p','launch-brief');
  private readonly backgrounds=el('div','launch-backgrounds');
  private readonly grid=el('div','launch-grid');
  private readonly gridButton:HTMLButtonElement;
  private readonly overlay=el('section','launch-sequence');
  private readonly lights=el('div','launch-lights');
  private readonly sequenceGrid=el('div','launch-grid launch-grid--sequence');
  private readonly sequenceStatus=el('p','launch-sequence__status','PREPARING THE GRID');
  private readonly startButton=required('start-button') as HTMLButtonElement;
  private readonly motion=new GarageMotion(resolveReducedMotion);
  private readonly syncPanels=installLaunchPanels();
  private readonly observer:MutationObserver;
  private readonly header:LaunchHeader;
  private track:MapSelection;
  private mode:RaceMode;
  private tier:RivalTier;
  private mapKey='';
  private busy=false;
  private disposed=false;
  private swipe:{x:number;y:number}|null=null;
  private readonly loaded:{track:MapSelection;mode:RaceMode;tier:RivalTier};

  constructor(track:MapSelection,mode:RaceMode,tier:RivalTier,private readonly hooks:Hooks) {
    this.track=track;this.mode=mode;this.tier=tier;this.loaded={track,mode,tier};
    this.screen.classList.add('launch-menu');
    this.screen.querySelector('.intro-panel')!.setAttribute('hidden','');
    this.screen.append(this.backgrounds);
    for(const entry of TRACKS) {
      const image=el('img','launch-background');image.alt='';image.src=`/assets/launch/${entry.selection}.jpg`;image.decoding='async';image.dataset.track=entry.selection;this.backgrounds.append(image);
    }
    this.slab.append(this.number,this.name,this.deck);this.screen.append(this.slab);
    this.header=new LaunchHeader(hooks.sound);
    document.body.append(this.header.node);
    const guide=el('aside','launch-guide');guide.setAttribute('aria-label','Track guide');guide.append(this.map,this.feature,this.twist,this.note,this.detail);
    const setup=el('div','launch-setup');
    for(const [id,label] of [['format-select','FORMAT'],['tier-select','FIELD']]) {
      const row=el('div','launch-setup__row');row.append(el('span','launch-label',label),required(id));setup.append(row);
    }
    this.gridButton=button('launch-grid-toggle','GRID · 4',()=>this.toggleGrid());this.gridButton.setAttribute('aria-expanded','false');this.gridButton.setAttribute('aria-controls','launch-grid');
    setup.append(this.gridButton,this.brief);
    this.grid.id='launch-grid';this.grid.hidden=true;this.grid.setAttribute('role','region');this.grid.setAttribute('aria-label','Starting grid');
    const cards=el('nav','launch-cards');cards.setAttribute('aria-label','Circuit selection');
    cards.append(button('launch-prev','‹',()=>this.step(-1)),required('track-select'),button('launch-next','›',()=>this.step(1)));
    this.screen.append(cards);
    required('launch-prev').setAttribute('aria-label','Previous circuit (Q / LB)');required('launch-next').setAttribute('aria-label','Next circuit (E / RB)');
    TRACKS.forEach((entry,i)=>{
      const chip=this.screen.querySelector<HTMLButtonElement>(`#track-select [data-value="${entry.selection}"]`)!;
      chip.style.setProperty('--card-colour',CIRCUIT_COLOURS[entry.selection]);
      const image=el('img');image.alt='';image.src=`/assets/launch/${entry.selection}.jpg`;image.decoding='async';
      chip.replaceChildren(image,el('b','',String(i+1).padStart(2,'0')),el('strong','',entry.label));
      if(entry.selection===this.loaded.track)chip.append(el('span','launch-card-tag','LAST'));
    });
    const dispatch=el('div','launch-dispatch');dispatch.append(this.facts,this.startButton);
    this.startButton.replaceChildren(el('span','launch-dispatch__label','LAUNCH'),launchBadge('A',true),launchBadge('↵'));
    this.screen.append(guide,setup,this.grid,cards,dispatch);
    const live=el('p','launch-live');live.id='launch-live';live.setAttribute('role','status');live.setAttribute('aria-live','polite');this.screen.append(live);
    this.overlay.id='launch-sequence';this.overlay.hidden=true;this.overlay.setAttribute('aria-label','Race launch');
    const identity=el('div','launch-sequence__identity');identity.append(el('b'),el('strong'));
    for(let i=0;i<5;i++)this.lights.append(el('i'));
    this.overlay.append(identity,this.lights,this.sequenceGrid,this.sequenceStatus);document.body.append(this.overlay);
    this.observer=new MutationObserver(()=>{this.syncSound();if(document.body.dataset.garage!=='true'){this.renderGrid(this.grid);this.renderGrid(this.sequenceGrid);}});this.observer.observe(document.body,{attributes:true,attributeFilter:['data-muted','data-audio','data-garage']});
    window.addEventListener('keydown',this.keyDown,{capture:true});
    this.backgrounds.addEventListener('pointerdown',this.pointerDown);
    this.backgrounds.addEventListener('pointerup',this.pointerUp);
    this.screen.addEventListener('click',this.outsideGrid);
    this.render(true);
    if(new URLSearchParams(location.search).get('launch')==='1')this.showSequence();
  }

  choose(key:Choice,value:string):boolean {
    if(this.busy)return true;
    const previous=this.track;
    if(key==='map'&&TRACKS.some(t=>t.selection===value))this.track=value as MapSelection;
    else if(key==='mode')this.mode=normalizeRaceMode(value);
    else if(key==='tier')this.tier=normalizeRivalTier(value);
    this.render(previous===this.track);
    return true;
  }

  private render(sameTrack:boolean):void {
    const track=trackFor(this.track),{data,laps,guide,distance}=launchFacts(this.track,this.mode);
    const colour=CIRCUIT_COLOURS[this.track];
    this.screen.style.setProperty('--circuit',colour);this.screen.dataset.track=this.track;
    this.screen.dataset.reduced=String(resolveReducedMotion());
    this.hooks.sync(this.track,this.mode,this.tier);
    this.number.textContent=track.mapCode.slice(-2);this.name.textContent=track.label;this.deck.textContent=track.deck;
    this.backgrounds.querySelectorAll<HTMLElement>('img').forEach(image=>image.dataset.selected=String(image.dataset.track===this.track));
    this.twist.textContent=guide.title;this.note.textContent=guide.note;this.feature.textContent=guide.feature;
    this.detail.replaceChildren(...[['LAP',`${(data.length/1000).toFixed(2)} KM`],['GATES',String(data.gates.length)],['TIME OF DAY',guide.time]].map(([label,value])=>{const pair=el('div');pair.append(el('small','',label),el('strong','',value));return pair;}));
    const mapKey=`${this.track}:${this.mode}`;
    if(mapKey!==this.mapKey){drawLaunchMap(this.map,this.track,this.mode);this.mapKey=mapKey;}
    this.syncPanels(this.track);
    const best=save.bestFor(track.mapCode,bestRecordKey(this.mode,this.tier)).bestLapMs;
    const nextFacts=`${laps} LAPS · ${distance} KM · ${best===null?'NO LAP YET':`BEST ${time(best)}`}`;
    if(this.facts.textContent!==nextFacts)this.updateFacts(nextFacts);
    const pace={rookie:'off the pace',works:'at factory pace',feral:'ahead of factory pace'}[this.tier];
    this.brief.textContent=this.mode==='timeattack'?`Solo against the clock. ${['polarity','tideline'].includes(this.track)?'Set your best lap.':'Chase your saved ghost.'}`:`Three rivals ${pace}. ${this.mode==='sprint'?'Two laps. Defend the lead.':'Finish first.'} Purse ×${{rookie:'0.8',works:'1.0',feral:'1.4'}[this.tier]}.`;
    required('tier-select').setAttribute('aria-label',this.mode==='timeattack'?'Record category (solo: no rival field)':'Field pace');
    this.screen.querySelectorAll<HTMLElement>('#format-select [data-value]').forEach(chip=>{
      const m=chip.dataset.value as RaceMode;chip.setAttribute('aria-label',`${RACE_MODE_LABELS[m]}, ${launchFacts(this.track,m).laps} laps`);
    });
    this.startButton.setAttribute('aria-label',`Launch ${track.label}, ${RACE_MODE_LABELS[this.mode]}, ${this.tier}, ${laps} laps`);
    this.gridButton.textContent=`GRID · ${this.mode==='timeattack'?1:4}`;this.renderGrid(this.grid);this.renderGrid(this.sequenceGrid);
    required('launch-live').textContent=`${track.label}. ${nextFacts}. ${guide.feature}.`;
    if(!sameTrack){this.motion.enter(this.number,-32,0,200);this.motion.enter(this.name,-32,0,200);}
    this.syncSound();
  }

  private updateFacts(text:string):void {
    const previous=this.facts.textContent ?? '';
    const fragment=document.createDocumentFragment();
    for(let i=0;i<text.length;i++) {
      const character=el('span','',text[i]);fragment.append(character);
      if(/\d/.test(text[i])&&text[i]!==previous[i])this.motion.enter(character,0,6,200);
    }
    this.facts.replaceChildren(fragment);
  }

  private renderGrid(host:HTMLElement):void {
    const craft=craftNames(save.garage);
    const field=[{position:1,name:craft.label,team:craft.team,player:true},...fieldLiveries(save.livery).map((code,i)=>({position:i+2,name:liveryFor(code).label,team:'FIELD',player:false}))];
    host.replaceChildren(...startingGridRows(this.mode,field,craft.team).map((r,i)=>{
      const item=el('div','launch-rival');item.dataset.player=String(r.player);item.style.setProperty('--order',String(i));
      item.append(el('small','',`P${r.position}${r.player?' · YOU':''}`),el('strong','',r.player?craft.label:r.name));return item;
    }));
  }

  private step(direction:number):void {
    this.choose('map',TRACKS[(TRACKS.findIndex(t=>t.selection===this.track)+direction+TRACKS.length)%TRACKS.length].selection);
    this.screen.querySelector<HTMLElement>(`#track-select [data-value="${this.track}"]`)?.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'});
  }

  private toggleGrid(close=false):void {
    this.grid.hidden=close||!this.grid.hidden;this.gridButton.setAttribute('aria-expanded',String(!this.grid.hidden));
    if(!this.grid.hidden)this.motion.enter(this.grid,0,8,180);
  }

  private showSequence():void {
    this.busy=true;this.hooks.suspend();this.screen.inert=true;this.overlay.hidden=false;
    this.overlay.style.setProperty('--circuit',CIRCUIT_COLOURS[this.track]);
    this.overlay.querySelector('b')!.textContent=trackFor(this.track).mapCode.slice(-2);
    this.overlay.querySelector('strong')!.textContent=trackFor(this.track).label;
    this.overlay.dataset.stage='loading';this.overlay.dataset.reduced=String(resolveReducedMotion());
    document.body.dataset.launch='loading';this.renderGrid(this.sequenceGrid);
  }

  async launch():Promise<void> {
    if(this.busy||this.disposed)return;
    this.showSequence();
    save.setTrack(this.track);save.setRaceMode(this.mode);save.setTier(this.tier);
    // Run the curtain once. Loading a different race happens behind it; there
    // is one real countdown, owned by the race clock, after the assets arrive.
    const still=resolveReducedMotion();
    const curtain=still?[{opacity:0},{opacity:1}]:[{clipPath:'polygon(0 0, 22% 0, 11% 100%, 0 100%)'},{clipPath:'polygon(0 0, 100% 0, 100% 100%, 0 100%)'}];
    await this.overlay.animate(curtain,{duration:still?120:320,easing:'cubic-bezier(0.23, 1, 0.32, 1)'}).finished.catch(()=>undefined);
    if(this.disposed)return;
    if(this.track!==this.loaded.track||this.mode!==this.loaded.mode||this.tier!==this.loaded.tier){
      const url=new URL(location.href);url.searchParams.set('map',this.track);url.searchParams.set('mode',this.mode);url.searchParams.set('tier',this.tier);url.searchParams.set('launch','1');url.searchParams.delete('demo');url.searchParams.delete('start');
      location.assign(url.href);return;
    }
    await this.startLoadedRace();
  }

  async ready():Promise<void> {
    if(new URLSearchParams(location.search).get('launch')==='1')await this.startLoadedRace();
  }

  fail():void {
    this.busy=false;this.screen.inert=false;this.overlay.hidden=true;delete document.body.dataset.launch;
  }

  private async startLoadedRace():Promise<void> {
    try {
      await this.hooks.start();
      const url=new URL(location.href);url.searchParams.delete('launch');history.replaceState(null,'',url);
      if(document.body.dataset.phase!=='race')throw new Error('The grid is not ready. Try launch again.');
    } catch {
      this.fail();
      this.brief.textContent='The grid could not start. Please try LAUNCH again.';this.startButton.focus();
    }
  }

  countdown(value:string):void {
    if(!this.busy||this.disposed||!['3','2','1','GO'].includes(value))return;
    this.lights.dataset.count=value;
    this.overlay.dataset.stage=value==='GO'?'go':'lights';document.body.dataset.launch=value==='GO'?'go':'lights';
    this.sequenceStatus.textContent=value==='GO'?'GO':`${trackFor(this.track).label} · ${RACE_MODE_LABELS[this.mode]}`;
    const count=value==='3'?1:value==='2'?3:value==='1'?5:0;
    Array.from(this.lights.children).forEach((light,i)=>light.setAttribute('data-on',String(i<count)));
    if(value==='GO') {
      const animation=this.overlay.animate([{opacity:1,transform:'translateX(0)'},{opacity:0,transform:resolveReducedMotion()?'none':'translateX(-105%)'}],{duration:resolveReducedMotion()?120:420,easing:'cubic-bezier(0.77, 0, 0.175, 1)',fill:'forwards'});
      void animation.finished.then(()=>{this.overlay.hidden=true;animation.cancel();this.busy=false;this.screen.inert=false;delete document.body.dataset.launch;},()=>undefined);
    }
  }

  private syncSound():void {this.header.sync();}
  private readonly outsideGrid=(event:MouseEvent):void=>{if(event.target instanceof Node&&!this.grid.contains(event.target)&&!this.gridButton.contains(event.target))this.toggleGrid(true);};
  private readonly keyDown=(event:KeyboardEvent):void=>{
    if(document.body.dataset.phase!=='intro'||document.body.dataset.garage==='true'||document.body.dataset.options==='true'||document.body.dataset.controls==='true'||event.altKey||event.ctrlKey||event.metaKey)return;
    if(this.busy){event.preventDefault();event.stopImmediatePropagation();return;}
    if(event.code==='KeyQ'||event.code==='KeyE'){event.preventDefault();event.stopImmediatePropagation();this.step(event.code==='KeyQ'?-1:1);}
    else if(event.code==='KeyR'){event.preventDefault();event.stopImmediatePropagation();if(!event.repeat)this.toggleGrid();}
    else if(event.key==='Escape'&&!this.grid.hidden){event.preventDefault();event.stopImmediatePropagation();this.toggleGrid(true);this.gridButton.focus();}
  };
  private readonly pointerDown=(e:PointerEvent):void=>{if(e.pointerType==='touch')this.swipe={x:e.clientX,y:e.clientY};};
  private readonly pointerUp=(e:PointerEvent):void=>{const start=this.swipe;this.swipe=null;if(start&&Math.abs(e.clientX-start.x)>50&&Math.abs(e.clientY-start.y)<60)this.step(e.clientX<start.x?1:-1);};
  dispose():void {this.disposed=true;this.observer.disconnect();this.motion.cancel();window.removeEventListener('keydown',this.keyDown,{capture:true});this.screen.removeEventListener('click',this.outsideGrid);this.backgrounds.removeEventListener('pointerdown',this.pointerDown);this.backgrounds.removeEventListener('pointerup',this.pointerUp);this.overlay.getAnimations().forEach(a=>a.cancel());this.overlay.remove();this.header.dispose();delete document.body.dataset.launch;}
}
