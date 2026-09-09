import {PolaritySimulation,ABILITY_TICK_RATE} from './polarity-simulation.js';
import {integrateSurgeSpeed} from './polarity-rules.js';
import {TidelinePowerChain} from './tideline-power-chain.js';
import {TidelineCradles} from './tideline-cradles';
import {TidelineBulkheads} from './tideline-bulkheads';
import {ASCENSION_ABILITY_CONFIG,ASCENSION_FIELDS,ascensionFieldAt} from './ascension-powers-config.js';
import type {AscensionCourse} from './ascension-course';
import type {AscensionRoadSignals} from './ascension-road-signals';
import type {InputFrame} from './input';
import type {TotemVisualState} from './totem';
import type {EngineAudio} from './audio';
import type {GameUi} from './ui';

/** Ascension placement uses the existing fixed-tick Surge, Shield and CHAIN rules. */
export class AscensionPowers {
 readonly simulation:PolaritySimulation;
 readonly devices:TidelineCradles;
 readonly bulkheads:TidelineBulkheads;
 readonly ready:Promise<void>;
 readonly chain=new TidelinePowerChain();
 private sequence=0;
 private readonly forceChain=new URLSearchParams(location.search).get('demoChain')==='1';
 private forced=false;
 private chainUntil=0;
 constructor(private readonly course:AscensionCourse,private readonly signals:AscensionRoadSignals,private readonly audio?:EngineAudio,private readonly ui?:GameUi){
  this.simulation=new PolaritySimulation(ASCENSION_ABILITY_CONFIG,course.schedule.seed);
  const sampler={length:course.length,sample:(progress:number)=>progress>.16&&progress<.635?course.sampleShortcut(progress):course.sample(progress)};
  this.devices=new TidelineCradles(sampler,ASCENSION_ABILITY_CONFIG.pickups,'/assets/ascension/power-kit.glb','/assets/ascension/textures','DEVICE');
  this.bulkheads=new TidelineBulkheads(sampler,ASCENSION_FIELDS,'/assets/ascension/textures');
  course.group.add(this.devices.root,this.bulkheads.root);this.ready=this.devices.ready;
 }
 handleActions(power:boolean,running:boolean,progress:number,demo:boolean){
  if(!running)return;
  if(power)this.use(progress);
  const s=this.simulation;
  // The explicit evidence flag supplies a shield for one real field contact.
  // Absorption still comes from the production collision path, never a fabricated event.
  if(demo&&this.forceChain&&!this.forced&&progress>ASCENSION_FIELDS[0].progress-.02&&progress<ASCENSION_FIELDS[0].progress-.01&&this.course.trenchOccupied){
   this.forced=true;s.state.heldPower='shield';s.state.heldCharge=1;s.state.activePower=null;this.use(progress);
  }
  if(demo&&s.heldPowerKind){
   const fieldAhead=ASCENSION_FIELDS.some(f=>f.trench===this.course.trenchOccupied&&f.progress>progress&&f.progress-progress<.018);
   // Save the Pad Road Surge when taking the nearby trench fork; the surface demo can use that strip.
   const safeStrip=!!s.launchZoneAt(progress)&&(!this.course.demoTrench||progress>.7);
   if(s.heldPowerKind==='shield'?fieldAhead:safeStrip||(s.state.tick-this.chain.absorbedAt>12&&s.state.tick-this.chain.absorbedAt<=240))this.use(progress);
  }
 }
 step(ticks:number,progress:number,lateral:number,lap:number){for(let i=0;i<ticks;i++)this.simulation.step(progress,lateral,lap,[true,this.course.trenchOccupied,true,true]);this.dispatch();}
 applySurge(previous:number,normal:number,input:InputFrame,delta:number){return integrateSurgeSpeed(previous,normal,input.throttle,input.brake,this.simulation.surgeActive,delta);}
 absorb(progress:number,lateral:number){const field=ascensionFieldAt(progress,lateral,this.course.length,this.course.trenchOccupied);const refund=field?this.simulation.onShieldImpact(field.id):0;this.dispatch();return refund;}
 present(state:TotemVisualState){const s=this.simulation.state;state.shieldActive=this.simulation.shieldActive;state.overdriveActive=this.simulation.surgeActive;state.shieldRefundWindow=state.shieldActive&&s.tick-s.powerStartTick<=144;state.powerReady=!!s.heldPower;state.heldPowerKind=s.heldPower;state.powerCharge=s.activePower?s.activeCharge:s.heldCharge;state.powerActivation=s.activePower?Math.min(1,(s.tick-s.powerStartTick)/26.4):0;}
 update(time:number,reduced:boolean,progress:number){
  this.devices.update(time,reduced,this.simulation.getPickupStates(),progress);this.bulkheads.update(time,reduced,progress);
  const held=this.simulation.heldPowerKind,active=this.simulation.state.activePower;
  const label=document.getElementById('polarity-power');if(label)label.textContent=this.simulation.state.tick<this.chainUntil?'CHAIN · BULKHEAD → SURGE / +0.5s':active?`${active==='surge'?'SURGE':'PHASE SHIELD'} ${this.simulation.powerSeconds.toFixed(1)}s`:held?`E / ${held==='surge'?'SURGE':'PHASE SHIELD'}`:'COLLECT A DEVICE';
  if(label){
   const chain=this.simulation.state.tick<this.chainUntil;
   label.dataset.device=chain?'perfect':active?'active':held?'held':'empty';
   label.dataset.kind=chain?'surge':active??held??'';
   label.dataset.charge=String(active?this.simulation.state.activeCharge:this.simulation.heldPowerCharge);
  }
  const deck=document.getElementById('polarity-deck');if(deck)deck.dataset.deck='none';
  const transfer=document.getElementById('polarity-flip');if(transfer)transfer.dataset.transfer='ready';
  const fill=document.getElementById('power-charge-fill');if(fill)fill.style.transform=`scaleX(${active?this.simulation.state.activeCharge:this.simulation.heldPowerCharge})`;
 }
 private use(progress:number){const result=this.chain.request(this.simulation,progress);if(result.chain){this.chainUntil=this.simulation.state.tick+240;this.ui?.flashHazard('CHAIN · BULKHEAD → SURGE / +0.5s',2000);}if(!result.ok)this.audio?.playPowerDenied();this.dispatch();}
 private dispatch(){for(const e of this.simulation.state.events){if(e.sequence<=this.sequence)continue;this.sequence=e.sequence;
  if(e.type==='pickup'){this.audio?.playDeviceClunk();this.audio?.playPowerPickup();}
  if(e.type==='power'&&e.kind){this.audio?.playPowerActivate(e.kind);if(e.kind==='surge')this.signals.fireSurge(this.simulation.state.progress,e.tick/ABILITY_TICK_RATE);}
  if(e.type==='absorb'){this.chain.absorb(e.tick);this.bulkheads.absorb(e.index,e.tick/ABILITY_TICK_RATE);if(this.forceChain&&this.forced&&!this.chain.events.length){this.simulation.state.heldPower='surge';this.simulation.state.heldCharge=1;}}
 }}
 reset(){this.simulation.reset();this.chain.reset();this.sequence=0;this.forced=false;this.chainUntil=0;this.bulkheads.reset();}
 dispose(){this.devices.dispose();this.devices.root.removeFromParent();this.bulkheads.root.removeFromParent();}
}
