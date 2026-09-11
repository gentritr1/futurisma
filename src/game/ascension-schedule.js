import {ABILITY_TICK_RATE} from './polarity-simulation.js';
/** Same integer clock as the ability protocol. Build-produced lap measurements
 * configure this clock; a missing calibration deliberately disables events. */
/** @typedef {{id:string,tick:number}} ScheduleEvent */
/** @typedef {{events:ScheduleEvent[],launchTick:number,reopenTick:number,steamEndTick:number,rocketGoneTick:number,testTick:number}} ScheduleConfig */
export class AscensionSchedule {
  tick=0;lap=1;gravelLap=0;
  /** @type {(ScheduleEvent & {sequence:number})[]} */
  events=[];
  state={trenchOpen:true,steam:false,launched:false,rocketGone:false,deluge:false};
  /** @param {ScheduleConfig|null} config @param {number} seed */
  constructor(config = null, seed = 3868938316) { this.config=config; this.seed=seed>>>0; this.reset(); }
  reset() { this.tick=0; this.lap=1; this.gravelLap=0; this.events=/** @type {(ScheduleEvent & {sequence:number})[]} */([]); this.state={trenchOpen:true,steam:false,launched:false,rocketGone:false,deluge:false}; }
  /** @param {number} ticks @param {number} lap */
  advanceTicks(ticks,lap=this.lap) {
    if(!Number.isSafeInteger(ticks)||ticks<0)throw new Error('Schedule requires nonnegative integer ticks');
    const before=this.tick;this.tick+=ticks;this.lap=lap;
    if(!this.config)return;
    for(const event of this.config.events)if(event.tick>before&&event.tick<=this.tick){
      this.events.push({...event,sequence:this.events.length+1});
      if(event.id.startsWith('crawler-cross'))this.gravelLap=lap;
    }
    const c=this.config,t=this.tick;
    this.state={trenchOpen:t<c.launchTick||t>=c.reopenTick,steam:t>=c.launchTick&&t<c.steamEndTick,
      launched:t>=c.launchTick,rocketGone:t>=c.rocketGoneTick,
      deluge:t>=c.testTick&&t<c.testTick+4*ABILITY_TICK_RATE||t>=c.launchTick&&t<c.reopenTick};
  }
  /** @param {string} sector */
  grip(sector) {
    if(sector==='CRAWLERWAY'&&this.gravelLap===this.lap)return .90;
    if(sector!=='TRENCH'||!this.config)return 1;
    if(this.tick>=this.config.reopenTick)return .72;
    if(this.tick>=this.config.testTick&&this.tick<this.config.testTick+10*ABILITY_TICK_RATE)return .80;
    return 1;
  }
  snapshot() { return structuredClone({version:1,config:JSON.stringify(this.config),seed:this.seed,tick:this.tick,lap:this.lap,gravelLap:this.gravelLap,events:this.events,state:this.state}); }
  /** @param {ReturnType<AscensionSchedule["snapshot"]>} snapshot */
  restore(snapshot) {
    if(!snapshot||snapshot.version!==1||snapshot.config!==JSON.stringify(this.config)||snapshot.seed!==this.seed||!Number.isSafeInteger(snapshot.tick)||snapshot.tick<0
      ||!Number.isSafeInteger(snapshot.lap)||snapshot.lap<1||!Number.isSafeInteger(snapshot.gravelLap)||snapshot.gravelLap<0||snapshot.gravelLap>snapshot.lap)throw new Error('Incompatible schedule snapshot');
    const expected=(this.config?.events??[]).filter(e=>e.tick>0&&e.tick<=snapshot.tick).map((e,i)=>({...e,sequence:i+1}));
    if(JSON.stringify(expected)!==JSON.stringify(snapshot.events))throw new Error('Incompatible event history');
    const check=new AscensionSchedule(this.config,this.seed);check.advanceTicks(snapshot.tick,snapshot.lap);
    if(JSON.stringify(check.state)!==JSON.stringify(snapshot.state))throw new Error('Inconsistent schedule state');
    Object.assign(this,structuredClone({tick:snapshot.tick,lap:snapshot.lap,gravelLap:snapshot.gravelLap,events:snapshot.events,state:snapshot.state}));
  }
}
