import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ABILITY_TICK_RATE, PolaritySimulation, POLARITY_ABILITY_CONFIG, POLARITY_PICKUPS } from '../src/game/polarity-simulation.js';
import { TRANSFER_WINDOWS, FLIP_COOLDOWN_SECONDS, FLIP_SECONDS } from '../src/game/polarity-rules.js';

const create = (seed = 714, config = POLARITY_ABILITY_CONFIG) => new PolaritySimulation(config, seed);
const clone = value => JSON.parse(JSON.stringify(value));
const pickup = (sim, index, lap = sim.state.lap) => {
  const anchor = sim.config.pickups[index];
  sim.recover(anchor.progress - .002);
  sim.step(anchor.progress + .002, anchor.lateral, lap);
  assert.equal(sim.state.heldPower, sim.pickupKind(index, lap));
};
const collectSurge = sim => pickup(sim, 0);
const shieldIndex = sim => sim.config.pickups.findIndex((anchor, index) => !anchor.lane && sim.pickupKind(index, sim.state.lap) === 'shield');

// Route choices are directed, committed and shared by geometry/signage/rules.
assert.equal(FLIP_SECONDS, 1.05);
assert.equal(FLIP_COOLDOWN_SECONDS, 6);
assert.deepEqual(TRANSFER_WINDOWS.map(w => w.fromLane), [0, 1, 0, 1]);
let sim = create();
assert.equal(sim.requestFlip(.05, 6).ok, false);
assert.equal(sim.requestFlip(.05, NaN).ok, false);
assert.equal(sim.requestFlip(.05, 0, false).ok, false);
assert.equal(sim.requestFlip(.05, 0).ok, true);
assert.equal(sim.state.lane, 1);
assert.equal(sim.blend, 0);
sim.advanceTicks(126);
assert.equal(sim.isFlipping, false);
assert.equal(sim.blend, 1);
assert.equal(sim.requestFlip(.445, 0).ok, false);
sim.advanceTicks(593);
assert.equal(sim.requestFlip(.445, 0).ok, false, 'Five seconds and 119 ticks is still below the six-second hold.');
sim.advanceTicks(1);
assert.equal(sim.requestFlip(.05, 0).ok, false, 'A used entry cannot be reversed or reused.');
assert.equal(sim.requestFlip(.445, 0).ok, true);
sim.advanceTicks(720);
assert.equal(sim.requestFlip(.445, 0).ok, false);
assert.equal(sim.requestFlip(.05, 0).ok, false, 'Recovery/backtracking cannot reuse a junction this lap.');
sim.recover(.04);
assert.equal(sim.state.usedWindowLaps[0], 1);
assert.equal(sim.cooldownSeconds, 6);

// One selected express excursion per lap yields exactly six rolls for a race.
// Even the fastest sustained pace still finds its exit after the six-second hold.
for (const seed of [0, 714, 0xffffffff]) for (const speed of [65, 95, 140]) {
  const race = create(seed);
  const transitions = [];
  const progressPerTick = speed / 2173.8848 / ABILITY_TICK_RATE;
  let distance = .002;
  while (distance < 3) {
    const lap = Math.floor(distance) + 1, progress = distance % 1;
    race.step(progress, 0, lap);
    const status = race.getTransferStatus(progress);
    if (status.ready && (race.state.lane || status.window.excursion === race.demoExcursion(lap))) {
      assert.equal(race.requestFlip(progress, 0).ok, true);
      transitions.push({ lap, tick: race.state.tick, lane: race.state.lane, index: status.index });
    }
    // Upper geometry has a meaningful short line: approximate its 6.5% gain.
    distance += progressPerTick * (race.state.lane ? 1.065 : 1);
  }
  assert.equal(transitions.length, 6, `Seed ${seed} at ${speed} m/s should use one excursion/lap.`);
  for (let lap = 1; lap <= 3; lap++) {
    const pair = transitions.filter(event => event.lap === lap);
    assert.deepEqual(pair.map(event => event.lane), [1, 0]);
    assert.equal(TRANSFER_WINDOWS[pair[0].index].excursion, race.demoExcursion(lap));
  }
  transitions.slice(1).forEach((event, index) => assert.ok(event.tick - transitions[index].tick >= 720));
}

// There is no hidden hazard randomness; supply is a stable, visible two-pattern plan.
for (const seed of [0, 1, 714, 1234567890]) {
  const a = create(seed), b = create(seed);
  assert.deepEqual(a.getPickupStates(1), b.getPickupStates(1));
  assert.notDeepEqual(a.getPickupStates(1).map(p => p.kind), a.getPickupStates(2).map(p => p.kind));
  assert.deepEqual(a.getPickupStates(1).map(p => p.kind), a.getPickupStates(3).map(p => p.kind));
  assert.equal(a.demoExcursion(1), a.demoExcursion(2), 'A race keeps one express choice so the lower-deck hold remains safe.');
}
assert.notEqual(create(0).demoExcursion(1), create(1).demoExcursion(1), 'New race seeds can choose the other express route.');
assert.ok(POLARITY_PICKUPS.filter(p => p.lane === 0).every(p => p.charge === 1));
assert.ok(POLARITY_PICKUPS.filter(p => p.lane === 1).every(p => p.charge === .65));
assert.equal(create().boostRechargeScale, 1.15);
const upper = create(); upper.requestFlip(.05, 0); assert.equal(upper.boostRechargeScale, .55);

// Exact activation timing is a skill reward, while early activation remains useful.
sim = create(); collectSurge(sim); assert.equal(sim.requestPower(.08).ok, true);
assert.equal(sim.powerSeconds, 3);
sim.advanceTicks(359); assert.equal(sim.surgeActive, true);
sim.advanceTicks(1); assert.equal(sim.surgeActive, false);
sim = create(); collectSurge(sim); const perfect = sim.requestPower(.11);
assert.equal(perfect.event.perfect, true); assert.equal(sim.powerSeconds, 4);
assert.equal(sim.state.perfectActivations, 1); assert.equal(sim.requestPower(.11).ok, false);
sim.advanceTicks(480); assert.equal(sim.surgeActive, false);

sim = create(); pickup(sim, shieldIndex(sim)); sim.requestPower(.215); sim.advanceTicks(60);
assert.equal(sim.onShieldImpact('unknown-field'), 0);
assert.equal(sim.onShieldImpact('phase-0'), .18);
assert.equal(sim.powerSeconds, 6.5);
assert.equal(sim.state.shieldAbsorptions, 1);
assert.equal(sim.onShieldImpact('phase-0'), 0, 'A field cannot grant another reward on every contact tick.');
sim.advanceTicks(780); assert.equal(sim.shieldActive, false);
sim = create(); pickup(sim, shieldIndex(sim)); sim.requestPower(.18); sim.advanceTicks(145);
assert.equal(sim.onShieldImpact('phase-0'), .06);
assert.equal(sim.state.perfectActivations, 0);
assert.equal(sim.state.powerUntilTick - sim.state.powerStartTick, 600);

// Crossing, lateral miss, pause, lap replenishment and recovery cannot farm rewards.
sim = create(); sim.recover(.034); sim.step(.036, 10, 1); assert.equal(sim.state.pickups, 0);
sim.recover(.034); sim.step(.034, 0, 1); assert.equal(sim.state.pickups, 0);
sim.step(.030, 0, 1); assert.equal(sim.state.pickups, 0, 'Backwards movement is not a pickup crossing.');
collectSurge(sim); assert.equal(sim.state.pickups, 1); sim.requestPower(.04);
sim.recover(.034); sim.step(.036, 0, 1); assert.equal(sim.state.pickups, 1);
sim.recover(.034); sim.step(.036, 0, 2); assert.equal(sim.state.pickups, 2);
assert.equal(sim.getPickupStates(2)[0].available, false);
assert.equal(sim.getPickupStates(3)[0].available, true);
assert.throws(() => sim.step(.036, 0, 1), 'A stale lap packet cannot reset pickup availability.');
assert.throws(() => sim.step(.036, 0, 4), 'A command cannot skip the next lap.');

// Same fixed commands produce identical events and snapshots under different
// host scheduling. JSON restore mid-transfer and mid-power continues bit for bit.
function tickTrace(race, from, to, grouping = 1) {
  for (let frame = from; frame < to; frame += grouping) for (let tick = frame; tick < Math.min(to, frame + grouping); tick++) {
    const distance = .002 + tick / 6000;
    race.step(distance % 1, 0, Math.floor(distance) + 1);
    if (tick === 220) race.requestFlip(distance, 0);
    if (tick === 310) race.requestPower(distance);
    if (tick === 2600) race.requestFlip(distance, 0);
    if (tick === 3100 && race.state.heldPower) race.requestPower(distance);
  }
}
const reference = create(77); tickTrace(reference, 0, 7200);
for (const group of [1, 2, 4, 8]) {
  const replay = create(77); tickTrace(replay, 0, 7200, group);
  assert.deepEqual(replay.snapshot(), reference.snapshot());
}
for (const stop of [250, 400, 3000, 6100]) {
  const original = create(77); tickTrace(original, 0, stop);
  const resumed = create(999); resumed.restore(clone(original.snapshot()));
  tickTrace(original, stop, 7200); tickTrace(resumed, stop, 7200, 4);
  assert.deepEqual(resumed.snapshot(), original.snapshot());
}
const ids = reference.state.events.map(event => event.id);
assert.equal(new Set(ids).size, ids.length);
assert.ok(reference.state.events.every((event, index, events) => !index || event.sequence > events[index - 1].sequence));

// Invalid/incompatible packets fail atomically; no partial ability state escapes.
const target = create(); collectSurge(target); target.requestPower(.11);
const good = target.snapshot();
for (const damage of [
  s => s.seed = -1, s => s.tick = NaN, s => s.configId = 'other-course', s => s.configHash = 'wrong',
  s => s.progress = Infinity, s => s.lane = 2, s => s.heldPower = 'weapon',
  s => s.activeCharge = 2, s => s.powerUntilTick = s.tick - 1, s => s.collectedLaps.push(0),
  s => s.usedWindowLaps[0] = 999, s => s.shieldRewardLaps.unknown = 1,
  s => s.events[0].id = 'forged', s => s.eventSequence = -1,
]) {
  const bad = clone(good); damage(bad);
  assert.throws(() => target.restore(bad)); assert.deepEqual(target.snapshot(), good);
}
assert.throws(() => new PolaritySimulation({ ...POLARITY_ABILITY_CONFIG, pickups: [{ ...POLARITY_PICKUPS[0], progress: 2 }] }));
assert.throws(() => target.step(.1, NaN, 1));

// The same explicit ability rules support a non-gravity course, with its own
// anchors, launch reward and config identity. No online transport is implied.
const harborConfig = { id: 'tideline-test', allowGravity: false,
  pickups: [{ id: 'launch', progress: .1, lane: 0, lateral: 0, kind: 'surge', charge: 1 }],
  launchZones: [{ id: 'water-launch', from: .2, to: .24, lane: 0 }], fieldIds: [] };
const harbor = create(714, harborConfig); pickup(harbor, 0);
assert.equal(harbor.requestFlip(.05, 0).ok, false);
assert.equal(harbor.requestPower(.22).event.perfect, true); assert.equal(harbor.powerSeconds, 4);
const harborSnapshot = harbor.snapshot();
const harborCopy = create(0, harborConfig); harborCopy.restore(harborSnapshot);
assert.deepEqual(harborCopy.snapshot(), harborSnapshot);
assert.throws(() => create().restore(harborSnapshot));
harbor.reset(); assert.equal(harbor.state.seed, 714); assert.equal(harbor.state.pickups, 0);

const source = await readFile(new URL('../src/game/polarity-simulation.js', import.meta.url), 'utf8');
assert.doesNotMatch(source, /Math\.random|Date\.|performance\.|document\.|globalThis\.|fetch\(/, 'Ability state must not depend on a browser or ambient randomness.');
console.log('Polarity simulation PASS: deliberate route commitments, six demo flips/race at varied pace, seeded visible supply, skilled power timing, deterministic grouped replay, mid-action JSON restore, invalid snapshot rejection, and non-gravity map reuse.');
