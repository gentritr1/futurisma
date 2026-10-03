import type {HudFrame} from './ui';
import {resolveReducedMotion} from './query-probes';
import {DriverGuidance} from './driver-guidance.js';

interface MapInstruments {
  name: string;
  condition: string;
  advice: string;
  mechanic: string;
}
const MAPS: Record<string, MapInstruments> = {
  greenwater: {name:'Wetland instruments',condition:'WET ASPHALT',advice:'Cyan: aqua grip · Amber: dynamo',mechanic:'Standing water reduces grip. Drive over cyan devices for 8 seconds of restored grip; amber gives 6 seconds of faster boost recharge and thrust.'},
  bitterpan: {name:'Saltworks instruments',condition:'SALT & CROSSWIND',advice:'Cyan: salt anchor · Amber: solar charge',mechanic:'Salt and gusts disturb the craft. Cyan pickups restore surface grip for 8 seconds; amber adds recharge and thrust for 6 seconds. Leave a margin for crosswinds.'},
  nightshift: {name:'Night instruments',condition:'MIDNIGHT EXPRESS',advice:'Rain sheets · center strip has grip',mechanic:'Rain sheets lower grip in two sections. The center strip stays grippy. Cyan rain locks restore grip for 8 seconds; amber recharges boost and adds thrust for 6 seconds.'},
  polarity: {name:'Gravity instruments',condition:'GRAVITY LINK',advice:'Space: flip · E: use power',mechanic:'Space / X flips gravity. E / B activates the fitted power.'},
  tideline: {name:'Tidal instruments',condition:'TIDAL SYSTEM',advice:'E: use the fitted device',mechanic:'E / B activates the fitted power. Watch the flood and drain cycle.'},
  ascension: {name:'Launch instruments',condition:'LAUNCH CORRIDOR',advice:'E: use the fitted device',mechanic:'E / B activates the fitted power. Read the launch sequence and route warnings.'},
  dreamisland: {name:'Island instruments',condition:'COASTAL LINK',advice:'E: use the fitted device',mechanic:'E / B activates the fitted power. Wet causeways need measured steering.'},
  afterglow: {name:'Relay instruments',condition:'RELAY NETWORK',advice:'Final lap: avoid marked strikes.',mechanic:'Cyan road anchors restore grip for 8 seconds; amber adds recharge and thrust for 6 seconds. Final-lap satellite strikes still damage the hull: move clear of the marked lane.'},
  frostline: {name:'Winter instruments',condition:'ALPINE SNOW',advice:'Follow the darker cleared tracks.',mechanic:'Drive over cyan stabilizers for grip and snowball protection. Amber pickups add thermal thrust. A lead of 150 m attracts unannounced snowballs.'},
};

/** One persistent instrument skin. Its clock is the race clock, never a new RAF. */
class MapHud {
  private readonly hud = document.querySelector<HTMLElement>('.hud')!;
  private readonly panel = document.createElement('aside');
  private readonly condition = document.createElement('strong');
  private readonly advice = document.createElement('span');
  private readonly keys = document.createElement('span');
  private readonly emblem = document.createElement('img');
  private readonly motion = document.createElement('span');
  private readonly reducedMotion = resolveReducedMotion();
  private winterStatus: HTMLElement | null = null;
  private relayStatus: HTMLElement | null = null;
  private visor: HTMLElement | null = null;
  private kind = '';
  private instruments = MAPS.greenwater;
  private previousLabel = '';
  private previousDevice = '';
  private fade: Animation | null = null;
  private readonly guidance = new DriverGuidance();

  constructor() {
    const stylesheet=document.createElement('link');
    stylesheet.rel='stylesheet';stylesheet.href=new URL('./map-hud.css?no-inline',import.meta.url).href;
    document.head.append(stylesheet);
    this.panel.className='map-hud-environment';this.panel.dataset.block='environment';
    this.emblem.alt='';this.emblem.width=38;this.emblem.height=38;
    this.motion.className='map-hud-atmosphere';this.motion.setAttribute('aria-hidden','true');
    this.condition.className='map-hud-condition';this.advice.className='map-hud-advice';this.keys.className='map-hud-keys';
    this.panel.append(this.motion,this.emblem,this.condition,this.advice,this.keys);this.hud.append(this.panel);
  }

  select(kind: string): void {
    if(this.kind===kind)return;
    this.kind=MAPS[kind]?kind:'greenwater';this.instruments=MAPS[this.kind];
    this.guidance.reset();
    this.hud.dataset.mapTheme=this.kind;this.hud.dataset.themeMotion=this.reducedMotion?'reduce':'full';
    this.panel.setAttribute('aria-label',this.instruments.name);
    this.emblem.src=`/assets/hud/${this.kind}.svg`;
    this.advice.textContent=this.instruments.advice;
    this.previousLabel='';this.previousDevice='';this.winterStatus=this.relayStatus=this.visor=null;
    this.hud.dataset.mapState='calm';this.condition.textContent=this.instruments.condition;
    const controls=document.querySelector<HTMLElement>('#controls-screen')!;
    controls.dataset.mapTheme=this.kind;
    let note=controls.querySelector<HTMLElement>('.map-controls-note');
    if(!note){note=document.createElement('p');note.className='map-controls-note';controls.querySelector('.controls-list, .control-chart')!.before(note);}
    note.textContent=this.instruments.mechanic;
    controls.querySelector<HTMLElement>('.options-title')!.textContent='CONTROLS';
  }

  update(frame: HudFrame): void {
    let label=this.instruments.condition,state='calm',advice=this.instruments.advice;
    if(frame.lowGrip){label=this.kind==='frostline'?'SNOW · LOW GRIP':'LOW GRIP';state='weather';}
    if(frame.trackEvent){label=frame.trackEvent;state='weather';}
    if(this.kind==='frostline'){
      this.winterStatus??=document.querySelector('.winter-status');this.visor??=document.querySelector('.winter-visor');
      const power=this.winterStatus?.dataset.kind;
      if(power==='snow'){label='SNOW · FOLLOW TRACKS';state='weather';}
      if(power==='stabilizer'){label='STABILIZERS LOCKED';state='protected';advice='Full grip · snowball protection.';}
      if(power==='thermal'){label='THERMAL DRIVE';state='thermal';advice='Extra thrust · grip restored.';}
      if(this.visor&&!this.visor.hidden){label='VISOR · DEFROSTING';state='weather';advice='Frost is clearing. Keep your line.';}
      if(frame.lap>=frame.totalLaps&&state==='calm'){label='MIDNIGHT · SNOW FOG';advice='Follow the road lighting.';}
    }
    if(this.hud.dataset.assist){
      label=this.hud.dataset.assistLabel??label;state=this.hud.dataset.assist==='grip'?'protected':'thermal';
      advice=this.hud.dataset.assist==='grip'?'Surface grip restored. Keep clear of hazards.':'Boost recharging faster · extra thrust.';
    }
    if(this.kind==='afterglow'){
      this.relayStatus??=document.querySelector('.relay-status');
      const phase=this.relayStatus?.dataset.phase;
      if(phase==='mark'||phase==='strike'){label='RELAY · STRIKE ACTIVE';state='weather';advice='Move clear of the marked strike lane.';}
    }
    const device=document.body.dataset.inputDevice??'keyboard';
    if(['polarity','tideline','ascension','dreamisland'].includes(this.kind))advice=this.kind==='polarity'?(device==='gamepad'?'X: flip · B: use power':'Space: flip · E: use power'):(device==='gamepad'?'B: use the fitted device':'E: use the fitted device');
    const hint=this.guidance.update(frame,device==='gamepad');
    // Circuit hazards and active powers keep priority over driving lessons.
    const teach=hint&&(state==='calm'||hint.action==='thrust'&&frame.lowGrip)&&document.body.dataset.controlMode!=='autopilot';
    this.panel.dataset.guidance=teach?'true':'false';
    if(teach){label=hint.title;advice=hint.detail;}
    if(this.advice.textContent!==advice)this.advice.textContent=advice;
    if(label!==this.previousLabel){
      this.previousLabel=label;this.condition.textContent=label;this.fade?.cancel();
      if(!this.reducedMotion&&frame.raceActive&&!this.hud.dataset.assist)this.fade=this.condition.animate([{opacity:.45},{opacity:1}],{duration:180,easing:'cubic-bezier(0.23, 1, 0.32, 1)'});
    }
    if(this.hud.dataset.mapState!==state)this.hud.dataset.mapState=state;
    if(device!==this.previousDevice){
      this.previousDevice=device;
      this.keys.textContent=device==='gamepad'?'RT THRUST  ·  LT BRAKE  ·  A BOOST':'W / S DRIVE  ·  A D STEER  ·  ⇧ BOOST';
    }
    // Confined to the instrument's decoration; text and numbers remain still.
    const time=this.reducedMotion?0:frame.elapsedMs/1000;
    this.motion.style.transform=`translateY(${Math.sin(time*.45)*3}px)`;
    this.motion.style.opacity=String(.35+.12*Math.sin(time*.65));
  }
}
let instruments: MapHud | undefined;
export function applyMapHud(kind: string): MapHud {
  instruments??=new MapHud();instruments.select(kind);return instruments;
}
