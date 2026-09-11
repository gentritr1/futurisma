import assert from 'node:assert/strict';
import {TidelinePowerChain} from '../src/game/tideline-power-chain.js';
import {PolaritySimulation} from '../src/game/polarity-simulation.js';
import {TIDELINE_ABILITY_CONFIG,TIDELINE_FIELDS} from '../src/game/tideline-rules.js';
for(const delay of [0,144,239,240,241]) {
 const simulation=new PolaritySimulation(TIDELINE_ABILITY_CONFIG,3868938316),chain=new TidelinePowerChain();
 simulation.state.heldPower='shield';simulation.state.heldCharge=1;simulation.requestPower(.30);
 simulation.advanceTicks(60);assert.ok(simulation.onShieldImpact(TIDELINE_FIELDS[0].id)>0);chain.absorb(simulation.state.tick);
 simulation.advanceTicks(delay);simulation.state.heldPower='surge';simulation.state.heldCharge=1;
 const before=simulation.snapshot();assert.equal(chain.request(simulation,NaN).ok,false);assert.deepEqual(simulation.snapshot(),before,'Invalid input cannot silently cancel Shield.');
 const result=chain.request(simulation,.335);assert.equal(result.chain,delay<=240);assert.equal(result.ok,delay<=240);
 if(result.chain){assert.equal(chain.events.length,1);assert.equal(chain.events[0].rewardTicks,60);const expires=simulation.state.powerUntilTick;assert.equal(chain.request(simulation,.335).ok,false);assert.equal(simulation.state.powerUntilTick,expires,'No repeated reward.');}
 chain.reset();assert.equal(chain.events.length,0);assert.equal(chain.absorbedAt,-10000);
}
console.log('Tideline CHAIN PASS: inclusive 240-tick window, 60-tick reward, invalid-command atomicity, no repeated reward and reset.');
