import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";

import {
  CIRCUIT_CODES,
  CONTRACT_SLOTS,
  DAILY_FIELDS,
  DEFAULT_FRAME,
  FRAMES,
  FRAME_CODES,
  MAX_PART_STAGE,
  NEUTRAL_HANDLING,
  PAINT_CODES,
  PARTS,
  PART_CODES,
  PATTERN_CODES,
  STARTING_CREDITS,
  STAT_LIMITS,
  activeHandling,
  bodySchemes,
  craftNames,
  defaultGarage,
  handlingFor,
  installHandling,
  normalizeGarage,
} from "../src/game/garage-rules.js";
import {
  FRAME_CARDS,
  PAINT_CARDS,
  PART_CARDS,
  PATTERN_CARDS,
  SCHEME_CARDS,
  SCRAP_PRICE,
  frameCard,
  resolvePaint,
  schemeCard,
} from "../src/game/garage-catalog.js";
import {
  CONTRACT_KINDS,
  STREAK_PAY,
  SWEEP_BONUS,
  WEEKLY_PAY,
  buyFrame,
  buyPart,
  contractFor,
  contractMet,
  dailyJobs,
  describeContract,
  describeJob,
  fitBody,
  fitPaint,
  fitPattern,
  hasNews,
  jobDone,
  liveStreak,
  racePurse,
  readDaily,
  scrapContract,
  seenDaily,
  selectFrame,
  settleRace,
  sweptToday,
  weekOf,
  weeklyDone,
  weeklyJob,
} from "../src/game/garage-economy.js";
import {
  BOOST_MAX_SPEED,
  calculateGripRate,
  calculateTurnRate,
  integrateBoostReserve,
  integrateDriftCharge,
  integrateSpeed,
} from "../src/game/physics.js";
import { TRACK_CODES } from "../src/game/save-schema.js";

/**
 * Garage — the craft layer must change the player's craft and nothing else,
 * and the loop it hangs off must actually loop.
 *
 * Five claims, each proved rather than sampled:
 *
 *   1. STOCK PARITY. The works TOTEM with nothing fitted integrates
 *      bit-for-bit as the race loop did before the garage existed. Every
 *      physics test, soak and ghost recorded before this phase stays valid.
 *   2. REAL DIFFERENCES. Every frame is measurably different on the axis its
 *      deck claims, trades something for it, and no shipped build — any frame,
 *      any parts — ever reaches a handling clamp.
 *   3. A SAVE CANNOT LIE. `normalizeGarage` turns any input into a garage that
 *      names only authored frames, parts, paints and circuits, and contracts
 *      are serials, so a save cannot carry a reward the build did not author.
 *   4. THE BOARD COVERS THE GAME. Contracts are deterministic, every seven
 *      consecutive serials visit all seven circuits, every kind is reachable,
 *      and every target is inside what the race can measure.
 *   5. THE LOOP PAYS. A synthetic career settled race by race reaches its first
 *      upgrade, first new frame and the HALO licence inside stated bounds,
 *      and nothing — a demo, a scrapped contract, a one-lap race — farms.
 *   6. DAILY OPS ARE BOUNDED. The day's jobs are a pure function of the day;
 *      a year of perfect days never pays more than the stated cap; each job,
 *      the sweep and the weekly pay once; the streak climbs one rung a
 *      counted day, loops at seven and unlocks GOLD LEAF once; and a clock
 *      wound back or forward can neither freeze the board nor bank a streak.
 *      Body paint and patterns are bought once and worn only when owned.
 */

const report = [];

// ---------------------------------------------------------------------------
// 0. The two halves agree
// ---------------------------------------------------------------------------

assert.deepEqual(CIRCUIT_CODES, TRACK_CODES, "garage-rules.js CIRCUIT_CODES must equal save-schema.js TRACK_CODES.");
assert.deepEqual(FRAME_CARDS.map((card) => card.code), FRAME_CODES, "Showroom frames drift from the rules.");
assert.deepEqual(PART_CARDS.map((card) => card.code), PART_CODES, "Parts drift from the rules.");
assert.deepEqual(
  [...PAINT_CARDS.map((card) => card.code)].sort(),
  [...PAINT_CODES].sort(),
  "Paints drift from the rules.",
);
assert.equal(FRAME_CODES[0], DEFAULT_FRAME, "The works frame must be first in the bay.");
for (const card of PART_CARDS) {
  assert.equal(card.prices.length, MAX_PART_STAGE, `${card.code} has a price per stage.`);
  assert.ok(card.prices.every((price, index) => index === 0 || price > card.prices[index - 1]), `${card.code} stages get dearer.`);
}

// ---------------------------------------------------------------------------
// 1. Stock parity
// ---------------------------------------------------------------------------

assert.equal(handlingFor(defaultGarage()), NEUTRAL_HANDLING, "The default garage must race the NEUTRAL object itself.");
assert.equal(activeHandling(), NEUTRAL_HANDLING, "Before install, the race loop reads the works craft.");
assert.ok(Object.isFrozen(NEUTRAL_HANDLING), "NEUTRAL_HANDLING must be frozen.");

let parityCases = 0;
const speeds = [0, 0.35, 12, 47.5, 85.9, 86, 91.2, 100, 111.99, 112];
for (const speed of speeds) {
  for (const throttle of [0, 0.4, 1]) {
    for (const brake of [0, 0.6, 1]) {
      for (const boost of [false, true]) {
        for (const drift of [0, 0.5, 1]) {
          for (const tow of [0, 0.7, 1]) {
            const before = integrateSpeed(speed, throttle, brake, boost, drift, 1 / 120, tow);
            const after = integrateSpeed(speed, throttle, brake, boost, drift, 1 / 120, tow, NEUTRAL_HANDLING);
            assert.ok(Object.is(before, after), `integrateSpeed drifted at ${speed} m/s.`);
            parityCases += 1;
          }
        }
      }
    }
  }
  for (const drift of [0, 0.3, 1]) {
    const ratio = speed / BOOST_MAX_SPEED;
    assert.ok(Object.is(calculateTurnRate(ratio, drift), calculateTurnRate(ratio, drift, NEUTRAL_HANDLING)));
    for (const grip of [0.62, 1]) {
      assert.ok(Object.is(
        calculateGripRate(ratio, drift, grip, 0.4, 0.7),
        calculateGripRate(ratio, drift, grip, 0.4, 0.7, NEUTRAL_HANDLING.grip),
      ));
    }
    parityCases += 3;
  }
}
for (const reserve of [0, 0.011, 0.5, 1]) {
  for (const active of [false, true]) {
    for (const chain of [1, 1.4, 2]) {
      assert.ok(Object.is(
        integrateBoostReserve(reserve, active, 1 / 120, 0.3, 0.5, chain),
        integrateBoostReserve(reserve, active, 1 / 120, 0.3, 0.5, chain, NEUTRAL_HANDLING.plasma),
      ));
      parityCases += 1;
    }
  }
}
for (const charge of [0, 0.4, 1]) {
  for (const intensity of [0, 0.5, 1]) {
    assert.ok(Object.is(
      integrateDriftCharge(charge, intensity, 1 / 120),
      integrateDriftCharge(charge, intensity, 1 / 120, NEUTRAL_HANDLING.drift),
    ));
    parityCases += 1;
  }
}
report.push(`stock parity bit-exact over ${parityCases} integrator cases`);

// ---------------------------------------------------------------------------
// 2. Real differences, inside the clamps
// ---------------------------------------------------------------------------

/** Every frame, fitted with every combination of stages 0 and 3. */
function* builds() {
  for (const frame of FRAME_CODES) {
    for (let mask = 0; mask < 1 << PART_CODES.length; mask += 1) {
      const parts = Object.fromEntries(PART_CODES.map((code, bit) => [code, mask & (1 << bit) ? MAX_PART_STAGE : 0]));
      yield { frame, garage: { ...defaultGarage(), chassis: frame, fleet: { [frame]: { parts, glow: "stock", flame: "stock", under: "off" } } } };
    }
  }
}
let buildCount = 0;
for (const { frame, garage } of builds()) {
  const handling = handlingFor(garage);
  for (const [stat, [floor, ceiling]] of Object.entries(STAT_LIMITS)) {
    assert.ok(
      handling[stat] > floor && handling[stat] < ceiling,
      `${frame} ${JSON.stringify(garage.fleet[frame].parts)} reaches the ${stat} clamp (${handling[stat]}).`,
    );
  }
  buildCount += 1;
}

/** Simple measured traits, so "faster" and "better at drifting" are numbers. */
function traits(handling) {
  const step = 1 / 120;
  let speed = 0;
  let seconds = 0;
  while (speed < 300 / 3.6 && seconds < 30) {
    speed = integrateSpeed(speed, 1, 0, false, 0, step, 0, handling);
    seconds += step;
  }
  const toThreeHundred = seconds;
  for (let tick = 0; tick < 120 * 20; tick += 1) speed = integrateSpeed(speed, 1, 0, true, 0, step, 0, handling);
  const boostTop = speed * 3.6;
  let charge = 0;
  let driftFull = 0;
  while (charge < 1 && driftFull < 10) {
    charge = integrateDriftCharge(charge, 0.8, step, handling.drift);
    driftFull += step;
  }
  let reserve = 0;
  let refill = 0;
  while (reserve < 1 && refill < 60) {
    reserve = integrateBoostReserve(reserve, false, step, 0, 0, 1, handling.plasma);
    refill += step;
  }
  return {
    toThreeHundred,
    boostTop,
    turn: calculateTurnRate(0.7, 0, handling),
    driftTurn: calculateTurnRate(0.7, 1, handling),
    grip: calculateGripRate(0.7, 0, 1, 0, 0.5, handling.grip),
    driftFull,
    refill,
  };
}
const stock = traits(NEUTRAL_HANDLING);
const measured = Object.fromEntries(FRAMES.map((frame) => [frame.code, traits(frame.stats)]));
assert.ok(stock.boostTop > 400 && stock.boostTop < 404, `works boost top ${stock.boostTop.toFixed(1)} km/h moved.`);
// Each specialist beats the works craft on the axis its deck names.
assert.ok(measured.lance.boostTop > stock.boostTop + 10, "LANCE is not faster at the top.");
assert.ok(measured.lance.toThreeHundred < stock.toThreeHundred, "LANCE does not pull harder.");
assert.ok(measured.lance.grip < stock.grip, "LANCE gives nothing back in the turns.");
assert.ok(measured.sidewinder.driftFull < stock.driftFull * 0.75, "SIDEWINDER does not bank a drift faster.");
assert.ok(measured.sidewinder.driftTurn > stock.driftTurn, "SIDEWINDER does not rotate harder in a drift.");
assert.ok(measured.sidewinder.boostTop < stock.boostTop, "SIDEWINDER gives nothing back at the top.");
assert.ok(measured.bulwark.grip > stock.grip * 1.15, "BULWARK does not hold a line better.");
assert.ok(measured.bulwark.toThreeHundred > stock.toThreeHundred, "BULWARK is not heavier off the line.");
assert.ok(measured.corona.refill < stock.refill * 0.8, "CORONA does not refill the reserve faster.");
assert.ok(measured.corona.toThreeHundred > stock.toThreeHundred, "CORONA gives nothing back off the line.");
// Every non-prototype frame trades: at least one stat under works and one over.
for (const frame of FRAMES.filter((entry) => !["totem", "halo"].includes(entry.code))) {
  const values = Object.values(frame.stats);
  assert.ok(values.some((value) => value < 1) && values.some((value) => value > 1), `${frame.code} makes no trade.`);
}
assert.ok(Object.values(FRAMES.find((frame) => frame.code === "halo").stats).every((value) => value >= 1), "HALO is the reward; it trades nothing.");
// Parts move the craft the way their card says.
for (const part of PARTS) {
  const staged = handlingFor({
    ...defaultGarage(),
    fleet: { totem: { parts: { engine: 0, thrusters: 0, stabilisers: 0, skid: 0, plasma: 0, [part.code]: 2 }, glow: "stock", flame: "stock", under: "off" } },
  });
  assert.ok(Math.abs(staged[part.stat] - (1 + 2 * part.step)) < 1e-12, `${part.code} stage II is not two steps.`);
}
const halo = traits(handlingFor({ ...defaultGarage(), chassis: "halo", fleet: { halo: { parts: Object.fromEntries(PART_CODES.map((code) => [code, 3])), glow: "stock", flame: "stock", under: "off" } } }));
report.push(
  `${buildCount} builds inside every clamp; works boost ${stock.boostTop.toFixed(0)} km/h, `
    + `LANCE ${measured.lance.boostTop.toFixed(0)}, fully built HALO ${halo.boostTop.toFixed(0)}; `
    + `0-300 works ${stock.toThreeHundred.toFixed(2)} s vs LANCE ${measured.lance.toThreeHundred.toFixed(2)} s; `
    + `drift bank full works ${stock.driftFull.toFixed(2)} s vs SIDEWINDER ${measured.sidewinder.driftFull.toFixed(2)} s; `
    + `reserve refill works ${stock.refill.toFixed(1)} s vs CORONA ${measured.corona.refill.toFixed(1)} s; `
    + `grip rate works ${stock.grip.toFixed(2)} vs BULWARK ${measured.bulwark.grip.toFixed(2)}`,
);

// Install is a swap, never a mutation.
installHandling(handlingFor({ ...defaultGarage(), chassis: "lance", fleet: { ...defaultGarage().fleet, lance: defaultGarage().fleet.totem } }));
assert.ok(Object.isFrozen(activeHandling()) && activeHandling().topSpeed > 1, "install did not swap the handling.");
installHandling(NEUTRAL_HANDLING);

// ---------------------------------------------------------------------------
// 3. A save cannot lie
// ---------------------------------------------------------------------------

function assertSane(garage, label) {
  assert.ok(Number.isInteger(garage.credits) && garage.credits >= 0 && garage.credits <= 9_999_999, `${label}: credits ${garage.credits}.`);
  assert.ok(FRAME_CODES.includes(garage.chassis) && Object.hasOwn(garage.fleet, garage.chassis), `${label}: chassis.`);
  assert.ok(Object.hasOwn(garage.fleet, "totem"), `${label}: works frame not owned.`);
  assert.equal(Object.getPrototypeOf(garage), Object.prototype, `${label}: garage prototype.`);
  for (const [code, fit] of Object.entries(garage.fleet)) {
    assert.ok(FRAME_CODES.includes(code), `${label}: frame ${code}.`);
    assert.deepEqual(Object.keys(fit.parts), PART_CODES, `${label}: ${code} parts.`);
    for (const stage of Object.values(fit.parts)) assert.ok(Number.isInteger(stage) && stage >= 0 && stage <= MAX_PART_STAGE, `${label}: stage ${stage}.`);
    for (const slot of ["glow", "flame", "under"]) assert.ok(PAINT_CODES.includes(fit[slot]), `${label}: ${slot}.`);
    assert.ok(bodySchemes(code).includes(fit.body), `${label}: ${code} body ${fit.body}.`);
    assert.ok(fit.body === "factory" || (fit.body === "gold" ? garage.goldLeaf : garage.schemes.includes(`${code}:${fit.body}`)),
      `${label}: ${code} wears ${fit.body} unowned.`);
    assert.ok(garage.patterns.includes(fit.pattern), `${label}: ${code} pattern ${fit.pattern} unowned.`);
  }
  assert.ok(garage.patterns.includes("steady") && garage.patterns.every((code) => PATTERN_CODES.includes(code)), `${label}: patterns.`);
  assert.equal(typeof garage.goldLeaf, "boolean", `${label}: goldLeaf.`);
  assert.ok(garage.daily.length === DAILY_FIELDS && garage.daily.every((value) => Number.isInteger(value) && value >= 0), `${label}: daily.`);
  assert.ok(garage.paints.includes("stock") && garage.paints.includes("off"), `${label}: free paints missing.`);
  assert.ok(garage.paints.every((code) => PAINT_CODES.includes(code)), `${label}: paints.`);
  assert.ok(garage.circuits.every((code) => CIRCUIT_CODES.includes(code)), `${label}: circuits.`);
  const board = garage.contracts;
  assert.equal(board.active.length, CONTRACT_SLOTS, `${label}: slots.`);
  assert.equal(new Set(board.active).size, CONTRACT_SLOTS, `${label}: duplicate serials.`);
  assert.ok(board.active.every((serial) => Number.isInteger(serial) && serial >= 0 && serial < board.next), `${label}: serials vs next.`);
  assert.ok(Number.isInteger(board.done) && board.done >= 0, `${label}: done.`);
  // Normalizing a normalized garage changes nothing, and JSON cannot move it.
  assert.deepEqual(normalizeGarage(garage), garage, `${label}: normalize is not idempotent.`);
  assert.deepEqual(normalizeGarage(JSON.parse(JSON.stringify(garage))), garage, `${label}: JSON round trip moved it.`);
}
const hostile = [
  ["unowned body", { chassis: "lance", fleet: { lance: { body: "strike" } } }],
  ["gold without the streak", { chassis: "lance", fleet: { lance: { body: "gold" } }, schemes: ["lance:gold"] }],
  ["another frame's scheme", { chassis: "lance", fleet: { lance: { body: "dazzle" } }, schemes: ["lance:dazzle", "halo:dazzle"] }],
  ["unowned pattern", { fleet: { totem: { pattern: "chase" } } }],
  ["daily wrong length", { daily: [1, 2, 3] }],
  ["daily hostile values", { daily: [1, -2, 3.5, "x", null, 1e12, 0, 0, 0] }],
  ["goldLeaf as a string", { goldLeaf: "true" }],
  ["null", null],
  ["array", [1, 2, 3]],
  ["string", "rich"],
  ["NaN credits", { credits: Number.NaN }],
  ["negative credits", { credits: -5_000 }],
  ["huge credits", { credits: 1e300 }],
  ["fractional credits", { credits: 12.9 }],
  ["string credits", { credits: "9999" }],
  ["unowned chassis", { chassis: "halo", fleet: { totem: {} } }],
  ["unknown chassis", { chassis: "batmobile", fleet: { batmobile: {} } }],
  ["prototype fleet", { fleet: JSON.parse('{"__proto__":{"engine":3},"constructor":{}}') }],
  ["class instance", new (class Garage { credits = 5; })()],
  ["over-staged parts", { fleet: { totem: { parts: { engine: 4, thrusters: -1, stabilisers: 1.5, skid: "3", plasma: null, turbo: 9 } } } }],
  ["unknown paints", { fleet: { totem: { glow: "gold", flame: "<script>", under: 7 } }, paints: ["gold", "cyan", "cyan"] }],
  ["unknown circuits", { circuits: ["monaco", "tideline", "tideline", 3] }],
  ["duplicate board", { contracts: { next: 9, active: [4, 4, 5], done: 2 } }],
  ["board past next", { contracts: { next: 3, active: [1, 2, 7], done: 1 } }],
  ["short board", { contracts: { next: 40, active: [38], done: 12 } }],
  ["hostile board", { contracts: { next: -1, active: "all", done: 1e9 } }],
];
for (const [label, raw] of hostile) {
  let garage;
  assert.doesNotThrow(() => {
    garage = normalizeGarage(raw);
  }, `${label} threw.`);
  assertSane(garage, label);
}
assert.equal(normalizeGarage({ credits: 12.9 }).credits, 12, "credits floor.");
assert.equal(normalizeGarage({ credits: -5_000 }).credits, 0, "credits floor at 0.");
assert.equal(normalizeGarage({ chassis: "halo", fleet: { totem: {} } }).chassis, "totem", "an unowned chassis races the works frame.");
// A corrupt board is re-dealt FORWARD from next, so a veteran never sees the
// starter contracts again.
assert.deepEqual(normalizeGarage({ contracts: { next: 40, active: [38], done: 12 } }).contracts, { next: 43, active: [40, 41, 42], done: 12 });
report.push(`${hostile.length} hostile garages normalized, idempotent and JSON-stable`);

// ---------------------------------------------------------------------------
// 4. The board covers the game
// ---------------------------------------------------------------------------

const SERIALS = 700;
const seenKinds = new Set();
const seenLevels = new Map(CONTRACT_KINDS.map((kind) => [kind, new Set()]));
for (let serial = 0; serial < SERIALS; serial += 1) {
  const contract = contractFor(serial);
  assert.deepEqual(contractFor(serial), contract, "contracts must be deterministic.");
  assert.ok(CIRCUIT_CODES.includes(contract.track), `serial ${serial} names ${contract.track}.`);
  assert.ok(contract.reward > 0 && Number.isInteger(contract.reward), `serial ${serial} reward.`);
  assert.ok(describeContract(contract).length > 0, `serial ${serial} has no objective text.`);
  seenKinds.add(contract.kind);
  if (contract.kind === "speed") assert.ok(contract.target <= stock.boostTop, "a top-speed target the works craft cannot reach.");
  if (serial % CIRCUIT_CODES.length === CIRCUIT_CODES.length - 1) {
    const block = Array.from({ length: CIRCUIT_CODES.length }, (_, index) => contractFor(serial - index).track);
    assert.deepEqual([...block].sort(), [...CIRCUIT_CODES].sort(), `serials ${serial - 6}..${serial} miss a circuit.`);
  }
  // Early contracts are the easy ones: level 0, or at most one level up.
  if (serial < 9) assert.ok(contract.reward <= 650 && contract.tier !== "feral" || contract.kind === "podium", `opening serial ${serial} is a late-game contract.`);
}
assert.deepEqual([...seenKinds].sort(), [...CONTRACT_KINDS].sort(), "a contract kind is never dealt.");
const starter = defaultGarage().contracts.active.map((serial) => contractFor(serial));
assert.equal(new Set(starter.map((contract) => contract.track)).size, CONTRACT_SLOTS, "the starting board repeats a circuit.");
assert.equal(new Set(starter.map((contract) => contract.kind)).size, CONTRACT_SLOTS, "the starting board repeats an objective.");
for (let block = 0; block < SERIALS / CONTRACT_KINDS.length - 1; block += 1) {
  const kinds = Array.from({ length: CONTRACT_KINDS.length }, (_, index) => contractFor(block * CONTRACT_KINDS.length + index).kind);
  assert.deepEqual([...kinds].sort(), [...CONTRACT_KINDS].sort(), `kind block ${block} repeats an objective.`);
}

// Every clause of contractMet can fail on its own.
const winning = (contract) => ({
  track: contract.track,
  mode: contract.mode === "field" || contract.mode === null ? "race" : contract.mode,
  tier: contract.tier ?? "works",
  position: contract.kind === "podium" ? contract.target : 1,
  racerCount: contract.mode === "timeattack" ? 1 : 4,
  laps: 3,
  newBestLap: true,
  topSpeedKph: 400,
  nearMisses: 10,
  cleanGateChain: 24,
  slipstreamSeconds: 12,
  driftCashes: 12,
  demo: false,
});
for (let serial = 0; serial < 60; serial += 1) {
  const contract = contractFor(serial);
  const facts = winning(contract);
  assert.ok(contractMet(contract, facts), `serial ${serial} (${contract.kind}) cannot be met.`);
  assert.ok(!contractMet(contract, { ...facts, demo: true }), "a demo closed a contract.");
  const elsewhere = CIRCUIT_CODES.find((code) => code !== contract.track);
  assert.ok(!contractMet(contract, { ...facts, track: elsewhere }), "a contract closed on the wrong circuit.");
  if (contract.tier && contract.tier !== "rookie") {
    assert.ok(!contractMet(contract, { ...facts, tier: "rookie" }), "a contract closed below its field.");
  }
  if (contract.mode === "race" || contract.mode === "sprint") {
    assert.ok(!contractMet(contract, { ...facts, mode: "timeattack", racerCount: 1 }), "a race contract closed solo.");
  }
}
report.push(`${SERIALS} serials deterministic, every block of ${CIRCUIT_CODES.length} visits all ${CIRCUIT_CODES.length} circuits, every block of ${CONTRACT_KINDS.length} deals all ${CONTRACT_KINDS.length} objectives`);

// ---------------------------------------------------------------------------
// 5. The purse and the loop
// ---------------------------------------------------------------------------

const baseFacts = {
  track: "tideline", mode: "race", tier: "works", position: 1, racerCount: 4, laps: 3,
  newBestLap: false, topSpeedKph: 350, nearMisses: 0, cleanGateChain: 0, slipstreamSeconds: 0,
  driftCashes: 0, demo: false,
};
const place = (facts) => racePurse(facts, false).find((line) => line.code === "place").amount;
assert.deepEqual(racePurse({ ...baseFacts, demo: true }, true), [], "a demo was paid.");
assert.ok([1, 2, 3, 4].map((position) => place({ ...baseFacts, position })).every((amount, index, all) => index === 0 || amount < all[index - 1]), "places do not pay in order.");
assert.ok(place({ ...baseFacts, tier: "feral" }) > place(baseFacts) && place(baseFacts) > place({ ...baseFacts, tier: "rookie" }), "the field does not scale the purse.");
// No farming by distance: one lap is a third of three, give or take rounding.
assert.ok(Math.abs(place({ ...baseFacts, laps: 1 }) * 3 - place(baseFacts)) <= 15, "a one-lap race pays more than its share.");
assert.equal(place({ ...baseFacts, laps: 9 }), place({ ...baseFacts, laps: 5 }), "the distance clamp moved.");
const loaded = racePurse({ ...baseFacts, newBestLap: true, cleanGateChain: 99, nearMisses: 99, driftCashes: 99 }, true);
for (const [code, cap] of [["chain", 160], ["close", 150], ["drift", 120]]) {
  assert.equal(loaded.find((line) => line.code === code).amount, cap, `${code} is uncapped.`);
}
assert.ok(loaded.some((line) => line.code === "circuit") && loaded.some((line) => line.code === "best"));
// Settlement is pure and pays the first finish on a circuit once.
const before = defaultGarage();
const frozen = JSON.stringify(before);
const first = settleRace(before, baseFacts);
assert.equal(JSON.stringify(before), frozen, "settleRace mutated its input.");
assert.equal(first.garage.credits, STARTING_CREDITS + first.total);
assert.ok(first.garage.circuits.includes("tideline"));
assert.ok(!settleRace(first.garage, baseFacts).lines.some((line) => line.code === "circuit"), "a circuit paid its first-finish bonus twice.");
assert.deepEqual(settleRace(before, { ...baseFacts, demo: true }).garage, before, "a demo moved the garage.");

// Transactions.
const broke = { ...defaultGarage(), credits: 0 };
assert.deepEqual(buyFrame(broke, "lance"), { ok: false, garage: broke, reason: "credits" });
assert.equal(buyFrame({ ...defaultGarage(), credits: 99_999 }, "halo").reason, "licence", "HALO sold without its licence.");
const licensed = { ...defaultGarage(), credits: 99_999, contracts: { ...defaultGarage().contracts, done: 8 } };
const haloBuy = buyFrame(licensed, "halo");
assert.ok(haloBuy.ok && haloBuy.garage.chassis === "halo" && haloBuy.garage.credits === 99_999 - frameCard("halo").price);
assert.equal(buyFrame(haloBuy.garage, "halo").reason, "owned");
assert.equal(selectFrame(defaultGarage(), "lance").reason, "unowned");
let staged = { ...defaultGarage(), credits: 99_999 };
for (let stage = 0; stage < MAX_PART_STAGE; stage += 1) {
  const result = buyPart(staged, "skid");
  assert.ok(result.ok, `skid stage ${stage + 1} refused.`);
  staged = result.garage;
}
assert.equal(staged.fleet.totem.parts.skid, MAX_PART_STAGE);
assert.equal(buyPart(staged, "skid").reason, "maxed");
assert.equal(staged.credits, 99_999 - PART_CARDS.find((card) => card.code === "skid").prices.reduce((a, b) => a + b, 0));
const painted = fitPaint(staged, "glow", "violet");
assert.ok(painted.ok && painted.spent > 0 && painted.garage.paints.includes("violet"));
const repainted = fitPaint(painted.garage, "under", "violet");
assert.ok(repainted.ok && repainted.spent === 0, "a colour was charged twice.");
assert.equal(fitPaint(staged, "glow", "off").reason, "slot", "the lights were switched off.");
assert.equal(resolvePaint("totem", "glow", "stock"), null, "works lights must stay the painted map.");
assert.equal(resolvePaint("lance", "glow", "stock"), 0x49e2ff, "a frame's signature did not resolve.");
const scrapped = scrapContract(staged, 1);
assert.ok(scrapped.ok && scrapped.spent === SCRAP_PRICE && scrapped.garage.contracts.active[1] === staged.contracts.next);
assert.equal(scrapContract(staged, 3).reason, "unknown");
for (const result of [haloBuy, painted, repainted, scrapped]) assertSane(normalizeGarage(result.garage), "transaction");

/**
 * A synthetic career. The driver works the board in rotation, racing each
 * contract with the format and field it asks for, closes it on two races in three (a
 * deterministic cycle, not a random one), finishes P2 and retries otherwise,
 * and spends
 * greedily: the cheapest part on the grid frame, then the cheapest frame.
 */
function career(races) {
  let garage = defaultGarage();
  const milestones = { firstUpgrade: null, firstFrame: null, haloLicence: null, allCircuits: null };
  for (let race = 1; race <= races; race += 1) {
    const contract = contractFor(garage.contracts.active[race % CONTRACT_SLOTS]);
    const facts = winning(contract);
    const closes = race % 3 !== 0;
    const settled = settleRace(garage, closes ? facts : {
      ...facts, position: 2, newBestLap: false, topSpeedKph: 300, nearMisses: 0, cleanGateChain: 3,
      slipstreamSeconds: 0, driftCashes: 0,
    });
    // A miss leaves the contract on the board; the driver goes again.
    garage = normalizeGarage(settled.garage);
    for (;;) {
      const fit = garage.fleet[garage.chassis];
      const part = PART_CARDS.filter((card) => fit.parts[card.code] < MAX_PART_STAGE)
        .sort((a, b) => a.prices[fit.parts[a.code]] - b.prices[fit.parts[b.code]])[0];
      const frame = FRAME_CARDS.filter((card) => !Object.hasOwn(garage.fleet, card.code) && garage.contracts.done >= card.licence)
        .sort((a, b) => a.price - b.price)[0];
      const next = part ? buyPart(garage, part.code) : frame ? buyFrame(garage, frame.code) : null;
      if (!next?.ok) break;
      if (part) milestones.firstUpgrade ??= race;
      else milestones.firstFrame ??= race;
      garage = normalizeGarage(next.garage);
    }
    if (garage.contracts.done >= frameCard("halo").licence) milestones.haloLicence ??= race;
    if (garage.circuits.length === CIRCUIT_CODES.length) milestones.allCircuits ??= race;
  }
  return { garage, milestones };
}
const { garage: veteran, milestones } = career(120);
assertSane(veteran, "career");
assert.ok(milestones.firstUpgrade !== null && milestones.firstUpgrade <= 1, `first upgrade at race ${milestones.firstUpgrade}.`);
assert.ok(milestones.firstFrame !== null && milestones.firstFrame <= 15, `first new frame at race ${milestones.firstFrame}.`);
assert.ok(milestones.haloLicence !== null && milestones.haloLicence >= 8 && milestones.haloLicence <= 20, `HALO licence at race ${milestones.haloLicence}.`);
assert.ok(milestones.allCircuits !== null && milestones.allCircuits <= 14, `all circuits logged at race ${milestones.allCircuits}.`);
assert.ok(Object.hasOwn(veteran.fleet, "halo"), "a 120-race career never signed the HALO.");
report.push(
  `career: first upgrade race ${milestones.firstUpgrade}, first new frame race ${milestones.firstFrame}, `
    + `all ${CIRCUIT_CODES.length} circuits by race ${milestones.allCircuits}, HALO licence race ${milestones.haloLicence}, `
    + `${Object.keys(veteran.fleet).length} frames in the bay after 120`,
);

// ---------------------------------------------------------------------------
// 6. Daily ops and body paint
// ---------------------------------------------------------------------------

const DAY = 20_400;
/** A race that does every job there is, on the day's circuit. */
const perfect = (day, extra = {}) => ({
  ...baseFacts, track: dailyJobs(day)[2].track, laps: 9, topSpeedKph: 420, nearMisses: 20, cleanGateChain: 30,
  slipstreamSeconds: 40, driftCashes: 20, position: 1, racerCount: 4, day, ...extra,
});
const paidBy = (settlement, codes) => settlement.lines.filter((line) => codes.includes(line.code))
  .reduce((sum, line) => sum + line.amount, 0);

// Deterministic, three distinct kinds, the third always the circuit of the day,
// and seven block-aligned days visit all seven circuits.
for (let day = 1; day < 800; day += 1) {
  const jobs = dailyJobs(day);
  assert.deepEqual(jobs, dailyJobs(day), "dailyJobs is not a pure function of the day.");
  assert.equal(new Set(jobs.map((job) => job.kind)).size, 3, `day ${day} repeats a job.`);
  assert.equal(jobs[2].kind, "circuit");
  assert.ok(CIRCUIT_CODES.includes(jobs[2].track ?? ""), `day ${day} circuit ${jobs[2].track}.`);
  assert.deepEqual(jobs.map((job) => job.reward), [150, 200, 250], `day ${day} pays off-table.`);
  assert.ok(jobs.every((job) => typeof describeJob(job) === "string" && describeJob(job).length > 0));
}
// Every Monday-to-Sunday week tours all seven circuits.
for (let week = weekOf(DAY); week < weekOf(DAY) + 60; week += 1) {
  const monday = week * 7 - 3;
  assert.equal(weekOf(monday), week);
  assert.equal(weekOf(monday - 1), week - 1, "weeks do not start on Monday.");
  const seen = new Set(Array.from({ length: 7 }, (_, index) => dailyJobs(monday + index)[2].track));
  assert.equal(seen.size, 7, `week ${week} skips a circuit of the day.`);
}

// A year of perfect days, one race a day: the cap holds, the streak climbs a
// rung a day and loops, GOLD LEAF unlocks once, the weekly pays once a week.
{
  let garage = defaultGarage();
  let dayMax = 0;
  let weeklies = 0;
  let unlocks = 0;
  /** @type {Map<number, number>} */
  const weeksPaid = new Map();
  const payWeek = (settlement, day) => {
    const paid = settlement.lines.filter((line) => line.code === "weekly").length;
    if (paid > 0) weeksPaid.set(weekOf(day), (weeksPaid.get(weekOf(day)) ?? 0) + paid);
    return paid;
  };
  for (let day = DAY; day < DAY + 365; day += 1) {
    const settled = settleRace(garage, perfect(day));
    const daily = paidBy(settled, ["daily", "sweep", "streak"]);
    dayMax = Math.max(dayMax, daily);
    weeklies += payWeek(settled, day);
    unlocks += settled.goldLeaf ? 1 : 0;
    const state = readDaily(settled.garage.daily, day);
    const rung = ((day - DAY) % STREAK_PAY.length);
    assert.equal(settled.lines.find((line) => line.code === "streak")?.amount, STREAK_PAY[rung], `day ${day - DAY}: streak rung.`);
    assert.equal(liveStreak(state), day - DAY + 1, "the streak skipped a counted day.");
    assert.ok(sweptToday(state) && [0, 1, 2].every((slot) => jobDone(state, slot)));
    // Racing again the same day pays nothing more from the day's board (the
    // weekly may legitimately close on it, and is counted).
    const again = settleRace(settled.garage, perfect(day));
    assert.equal(paidBy(again, ["daily", "sweep", "streak"]), 0, `day ${day - DAY}: the board paid twice.`);
    weeklies += payWeek(again, day);
    garage = normalizeGarage(again.garage);
  }
  const cap = 150 + 200 + 250 + SWEEP_BONUS + Math.max(...STREAK_PAY);
  assert.ok(dayMax <= cap && cap === 1_350, `a day paid ${dayMax} from the board; the cap is ${cap}.`);
  assert.equal(unlocks, 1, "GOLD LEAF unlocked more than once, or never.");
  assert.ok(garage.goldLeaf, "a 365-day streak never unlocked GOLD LEAF.");
  assert.ok([...weeksPaid.values()].every((count) => count === 1), "a week paid its weekly twice.");
  // Every whole week whose job this driver can do (it never closes a
  // contract: it races the circuit of the day) paid.
  for (let week = weekOf(DAY) + 1; week < weekOf(DAY + 364); week += 1) {
    if (weeklyJob(week).kind !== "contracts") assert.ok(weeksPaid.has(week), `week ${week} (${weeklyJob(week).kind}) never paid.`);
  }
  report.push(`daily: ${365} perfect days pay at most CR ${dayMax} a day from the board (cap ${cap}; ${cap + WEEKLY_PAY} with the weekly), ${weeklies} weeklies, GOLD LEAF once`);
}

// The streak counts a day with ONE job done; a missed day restarts the ladder.
{
  const lapsOnly = (day) => ({ ...baseFacts, track: "nowhere", laps: 3, racerCount: 1, mode: "timeattack", day,
    topSpeedKph: 0, cleanGateChain: 0, driftCashes: 0, nearMisses: 0, slipstreamSeconds: 0 });
  // Find a day whose total job is laps; three 3-lap races close it.
  const lapDay = Array.from({ length: 50 }, (_, index) => DAY + index).find((day) => dailyJobs(day)[0].kind === "laps");
  let garage = defaultGarage();
  for (let race = 0; race < 3; race += 1) garage = settleRace(garage, lapsOnly(lapDay)).garage;
  const state = readDaily(garage.daily, lapDay);
  assert.ok(jobDone(state, 0) && !sweptToday(state) && liveStreak(state) === 1, "one job did not count the day.");
  // A missed day: the next counted day is day 1 of the ladder again.
  const later = settleRace(garage, perfect(lapDay + 2));
  assert.equal(later.lines.find((line) => line.code === "streak")?.amount, STREAK_PAY[0], "a missed day kept the ladder.");
  assert.equal(liveStreak(readDaily(garage.daily, lapDay + 2)), 0, "a missed day still reads as a live streak.");
  // A one-lap race advances a lap total by one lap, never by a race's worth.
  const oneLap = settleRace(defaultGarage(), { ...lapsOnly(lapDay), laps: 1 });
  assert.equal(readDaily(oneLap.garage.daily, lapDay).progress[0], 1, "a one-lap race counted as more than a lap.");
  // A demo and a race without a day leave the board alone.
  assert.deepEqual(settleRace(garage, { ...perfect(lapDay), demo: true }).garage.daily, garage.daily, "a demo moved the board.");
  const { day: _day, ...undated } = perfect(lapDay);
  assert.deepEqual(settleRace(garage, undated).garage.daily, garage.daily, "an undated race moved the board.");
}

// Clock rollback and a stored future day.
{
  const ahead = settleRace(defaultGarage(), perfect(DAY + 30)).garage;
  // Wound back: the stored future day neither freezes the board nor keeps its streak.
  const back = settleRace(ahead, perfect(DAY));
  assert.ok(paidBy(back, ["daily"]) === 600, "a stored future day froze today's jobs.");
  assert.equal(back.lines.find((line) => line.code === "streak")?.amount, STREAK_PAY[0], "a rolled-back clock kept a streak from the future.");
  const readBack = readDaily(ahead.daily, DAY);
  assert.ok(readBack.streak === 0 && readBack.lastDay === 0 && readBack.progress.every((value) => value === 0));
  // Then forward again: the ladder restarts rather than resuming the future one.
  const forward = settleRace(back.garage, perfect(DAY + 1));
  assert.equal(forward.lines.find((line) => line.code === "streak")?.amount, STREAK_PAY[1], "the ladder did not resume from the rolled-back day.");
  // A new week re-deals the weekly; the old week's pay flag does not carry.
  const nextWeek = readDaily(forward.garage.daily, DAY + 14);
  assert.ok(!weeklyDone(nextWeek) && nextWeek.weekly === 0 && nextWeek.week === weekOf(DAY + 14));
  assert.ok(weeklyJob(weekOf(DAY)).reward === WEEKLY_PAY);
  // The bay's once-only DAILY landing clears.
  assert.ok(hasNews(readDaily(forward.garage.daily, DAY + 1)) && !hasNews(readDaily(seenDaily(forward.garage).daily, DAY + 1)));
}

// Body paint and patterns.
{
  assert.deepEqual(bodySchemes("totem"), ["factory"], "TOTEM gained body schemes; its paint is the livery.");
  for (const frame of FRAMES.filter((entry) => entry.signature)) {
    assert.deepEqual(bodySchemes(frame.code), ["factory", "noir", "arctic", frame.signature, "gold"]);
    for (const code of bodySchemes(frame.code)) assert.equal(schemeCard(code).code, code, `${code} has no card.`);
    assert.ok(craftNames({ ...defaultGarage(), chassis: frame.code, fleet: { [frame.code]: { body: "factory" } } }).label === frame.name);
    assert.equal(frameCard(frame.code).label, frame.name, `${frame.code}: the rules name the frame differently from its card.`);
  }
  assert.deepEqual(PATTERN_CARDS.map((card) => card.code), PATTERN_CODES, "Pattern cards drift from the rules.");
  assert.equal(schemeCard("gold").price, null, "GOLD LEAF is for sale.");
  const lance = normalizeGarage({ ...buyFrame({ ...defaultGarage(), credits: 99_999 }, "lance").garage });
  const noir = fitBody(lance, "noir");
  assert.ok(noir.ok && noir.spent === schemeCard("noir").price && noir.garage.schemes.includes("lance:noir"));
  const backToFactory = fitBody(noir.garage, "factory");
  const noirAgain = fitBody(backToFactory.garage, "noir");
  assert.ok(backToFactory.ok && backToFactory.spent === 0 && noirAgain.ok && noirAgain.spent === 0, "a scheme was charged twice on one frame.");
  assert.equal(fitBody(lance, "gold").reason, "streak", "GOLD LEAF fitted without the streak.");
  const gilded = fitBody({ ...lance, goldLeaf: true }, "gold");
  assert.ok(gilded.ok && gilded.spent === 0 && gilded.garage.fleet.lance.body === "gold");
  assert.equal(fitBody(lance, "dazzle").reason, "unknown", "another frame's signature was sold to the LANCE.");
  assert.equal(fitBody(defaultGarage(), "noir").reason, "unknown", "TOTEM was sold body paint.");
  // Owned per frame: the BULWARK has not bought the LANCE's NOIR.
  const bulwark = normalizeGarage({ ...buyFrame(noir.garage, "bulwark").garage });
  assert.ok(fitBody(bulwark, "noir").spent === schemeCard("noir").price, "a scheme bought for one frame fitted another free.");
  const chase = fitPattern(lance, "chase");
  assert.ok(chase.ok && chase.spent === 350 && chase.garage.patterns.includes("chase"));
  const chaseElsewhere = fitPattern({ ...chase.garage, chassis: "totem" }, "chase");
  assert.ok(chaseElsewhere.ok && chaseElsewhere.spent === 0, "a pattern was charged twice.");
  assert.equal(fitPattern(lance, "strobe").reason, "unknown");
  // A garage that loses its streak flag loses the gold, never the frame.
  const stripped = normalizeGarage({ ...gilded.garage, goldLeaf: false });
  assert.equal(stripped.fleet.lance.body, "factory");
  for (const result of [noir, backToFactory, gilded, chase, chaseElsewhere]) assertSane(normalizeGarage(result.garage), "paint");
  assert.ok(SCHEME_CARDS.every((card) => card.price === null || card.price > 0 || card.code === "factory"));
  report.push("body paint bought once per frame, patterns once per driver, GOLD LEAF only by the streak");
}

// The career again, with a day passing every three races and the dailies on:
// the first frame arrives sooner, the HALO stays contract-gated.
{
  let garage = defaultGarage();
  const milestones = { firstFrame: null, haloLicence: null };
  for (let race = 1; race <= 120; race += 1) {
    const contract = contractFor(garage.contracts.active[race % CONTRACT_SLOTS]);
    const day = DAY + Math.floor(race / 3);
    const facts = { ...winning(contract), day };
    const settled = settleRace(garage, race % 3 !== 0 ? facts : { ...facts, position: 2, newBestLap: false, topSpeedKph: 300, nearMisses: 0, cleanGateChain: 3, slipstreamSeconds: 0, driftCashes: 0 });
    garage = normalizeGarage(settled.garage);
    for (;;) {
      const fit = garage.fleet[garage.chassis];
      const part = PART_CARDS.filter((card) => fit.parts[card.code] < MAX_PART_STAGE)
        .sort((a, b) => a.prices[fit.parts[a.code]] - b.prices[fit.parts[b.code]])[0];
      const frame = FRAME_CARDS.filter((card) => !Object.hasOwn(garage.fleet, card.code) && garage.contracts.done >= card.licence)
        .sort((a, b) => a.price - b.price)[0];
      const next = part ? buyPart(garage, part.code) : frame ? buyFrame(garage, frame.code) : null;
      if (!next?.ok) break;
      if (!part) milestones.firstFrame ??= race;
      garage = normalizeGarage(next.garage);
    }
    if (garage.contracts.done >= frameCard("halo").licence) milestones.haloLicence ??= race;
  }
  assertSane(garage, "daily career");
  assert.ok(milestones.firstFrame !== null && milestones.firstFrame <= 12, `with dailies, first new frame at race ${milestones.firstFrame}.`);
  assert.ok(milestones.haloLicence !== null && milestones.haloLicence >= 8, `with dailies, the HALO licence at race ${milestones.haloLicence}: credits bought it.`);
  report.push(`daily career: first new frame race ${milestones.firstFrame}, HALO licence race ${milestones.haloLicence} (still contracts)`);
}

// ---------------------------------------------------------------------------
// 6. Wiring and the lazy boundary
// ---------------------------------------------------------------------------

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const game = await read("src/game/game.ts");
for (const needle of [
  "slipstream, activeHandling(),",
  "calculateTurnRate(speedRatio, driftIntent, activeHandling())",
  "input.steer, activeHandling().grip,",
  "activeHandling().plasma,",
  "delta, activeHandling().drift)",
]) {
  assert.ok(game.includes(needle), `game.ts no longer passes the fitted handling: ${needle}`);
}
const main = await read("src/main.ts");
assert.match(main, /if \(!stockCraft\) installHandling\(handlingFor\(save\.garage\)\);/, "main.ts must install the fitted handling at boot.");
assert.match(main, /has\("demo"\)/, "a demo must race the works craft.");
const lazy = /^garage-(bay|ui|look|purse|economy|catalog)\b/;
const sourceRoot = new URL("../src/", import.meta.url);
async function* sources(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = new URL(entry.name + (entry.isDirectory() ? "/" : ""), directory);
    if (entry.isDirectory()) yield* sources(path);
    else if (/\.(ts|js)$/.test(entry.name)) yield { name: entry.name, path };
  }
}
for await (const { name, path } of sources(sourceRoot)) {
  if (lazy.test(name)) continue;
  const source = await readFile(path, "utf8");
  for (const match of source.matchAll(/^import\s+(?!type\b)[^;]*?from\s+["']\.\/(?:game\/)?(garage-[\w-]+)/gm)) {
    assert.ok(!lazy.test(match[1]), `${name} statically imports the lazy ${match[1]}; the garage must stay out of the shell.`);
  }
}
const bayImporters = [];
for await (const { name, path } of sources(sourceRoot)) {
  if (lazy.test(name)) continue;
  if ((await readFile(path, "utf8")).includes('import("./garage-bay")') || (await readFile(path, "utf8")).includes('import("./game/garage-bay")')) bayImporters.push(name);
}
assert.deepEqual(bayImporters, ["meta-runtime.ts"], "garage-bay must be reached through one memoized loader.");
report.push("race loop passes the fitted handling at all five sites; the showroom, purse and catalog stay behind one lazy import");

console.log(`Garage PASS: ${report.join("; ")}.`);
