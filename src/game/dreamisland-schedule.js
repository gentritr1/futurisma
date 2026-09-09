/** The clock tower's hands are the race schedule. Same integer clock as the
 * ability protocol, same shape as `ascension-schedule.js`: a build-produced JSON
 * of absolute ticks configures it, a missing calibration deliberately disables
 * every event, and the derived booleans are rebuilt from the absolute tick on
 * every call rather than toggled, so any tick jump lands in the right state.
 *
 * The 12 s day->night interpolation is NOT here. This class only publishes the
 * strike tick; the course owns the ramp (atmosphere.ts smooths lights over about
 * a second, so a schedule that flipped a profile would be smoothed into a 1 s
 * crossfade instead of a 12 s one). */
/** @typedef {{id:string,tick:number}} ScheduleEvent */
/** @typedef {{events:ScheduleEvent[],chimeTick:number,strikeTick:number,fishRiseTick:number,nightSettledTick:number,nightRampTicks:number}} ScheduleConfig */
/** A bootstrap config carries null ticks and is as inert as no config at all.
 * @param {ScheduleConfig|null|undefined} config @returns {config is ScheduleConfig} */
const armed = config => !!config && Number.isSafeInteger(config.strikeTick);
export class DreamIslandSchedule {
  tick=0;lap=1;
  /** @type {(ScheduleEvent & {sequence:number})[]} */
  events=[];
  state={chimed:false,struck:false,fishRisen:false,nightSettled:false};
  /** @param {ScheduleConfig|null} config @param {number} seed */
  constructor(config = null, seed = 3868938316) { this.config=armed(config)?config:null; this.seed=seed>>>0; this.reset(); }
  reset() { this.tick=0; this.lap=1; this.events=/** @type {(ScheduleEvent & {sequence:number})[]} */([]); this.state={chimed:false,struck:false,fishRisen:false,nightSettled:false}; }
  /** @param {number} ticks @param {number} lap */
  advanceTicks(ticks,lap=this.lap) {
    if(!Number.isSafeInteger(ticks)||ticks<0)throw new Error('Schedule requires nonnegative integer ticks');
    const before=this.tick;this.tick+=ticks;this.lap=lap;
    if(!this.config)return;
    // Half-open window on the tick delta. An event at tick 0 could never fire
    // and restore() filters it out, so the builder never authors one.
    for(const event of this.config.events)if(event.tick>before&&event.tick<=this.tick)this.events.push({...event,sequence:this.events.length+1});
    const c=this.config,t=this.tick;
    this.state={chimed:t>=c.chimeTick,struck:t>=c.strikeTick,fishRisen:t>=c.fishRiseTick,nightSettled:t>=c.nightSettledTick};
  }
  /** Waterfall spray wets the causeway from the strike on. Pure in (sector, tick).
   * @param {string} sector @param {number} tick @param {number} _lap */
  grip(sector,tick=this.tick,_lap=this.lap) {
    if(sector!=='BASIN'||!this.config)return 1;
    return tick>=this.config.strikeTick ? .85 : 1;
  }
  snapshot() { return structuredClone({version:1,config:JSON.stringify(this.config),seed:this.seed,tick:this.tick,lap:this.lap,events:this.events,state:this.state}); }
  /** @param {ReturnType<DreamIslandSchedule["snapshot"]>} snapshot */
  restore(snapshot) {
    if(!snapshot||snapshot.version!==1||snapshot.config!==JSON.stringify(this.config)||snapshot.seed!==this.seed||!Number.isSafeInteger(snapshot.tick)||snapshot.tick<0
      ||!Number.isSafeInteger(snapshot.lap)||snapshot.lap<1)throw new Error('Incompatible schedule snapshot');
    const expected=(this.config?.events??[]).filter(e=>e.tick>0&&e.tick<=snapshot.tick).map((e,i)=>({...e,sequence:i+1}));
    if(JSON.stringify(expected)!==JSON.stringify(snapshot.events))throw new Error('Incompatible event history');
    const check=new DreamIslandSchedule(this.config,this.seed);check.advanceTicks(snapshot.tick,snapshot.lap);
    if(JSON.stringify(check.state)!==JSON.stringify(snapshot.state))throw new Error('Inconsistent schedule state');
    Object.assign(this,structuredClone({tick:snapshot.tick,lap:snapshot.lap,events:snapshot.events,state:snapshot.state}));
  }
}
