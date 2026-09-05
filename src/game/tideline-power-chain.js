import {ABILITY_TICK_RATE} from './polarity-simulation.js';

/** Tideline's follow-through command. It never changes shared Polarity rules.
 * An absorbed shield may be cancelled into a held Surge during the next 2 s.
 */
export class TidelinePowerChain {
  constructor() {
    this.absorbedAt = -10000;
    /** @type {{tick:number,lap:number,absorbedAt:number,rewardTicks:number}[]} */
    this.events = [];
  }
  reset() { this.absorbedAt = -10000; this.events.length = 0; }
  /** @param {number} tick */
  absorb(tick) { this.absorbedAt = tick; }
  /** @param {import('./polarity-simulation.js').PolaritySimulation} simulation
   * @param {number} progress */
  request(simulation, progress) {
    if (!Number.isFinite(progress)) return {...simulation.requestPower(progress), chain:false};
    const state = simulation.state;
    const eligible = state.heldPower === 'surge' && state.tick >= this.absorbedAt
      && state.tick - this.absorbedAt <= 2 * ABILITY_TICK_RATE;
    if (eligible && state.activePower === 'shield') {
      state.activePower = null; state.activeCharge = 0;
      state.powerPerfect = false; state.powerUntilTick = state.tick;
    }
    const result = simulation.requestPower(progress);
    if (result.ok && eligible && state.activePower === 'surge') {
      state.powerUntilTick += ABILITY_TICK_RATE / 2;
      this.events.push({tick:state.tick, lap:state.lap, absorbedAt:this.absorbedAt, rewardTicks:ABILITY_TICK_RATE / 2});
      this.absorbedAt = -10000;
      return {...result, chain:true};
    }
    return {...result, chain:false};
  }
}
