import assert from "node:assert/strict";
import {
  BITTERPAN_WIND_BEARING_DEGREES,
  GUST_BASE_PEAK_MPS2,
  GUST_CHIP_LEAD_SECONDS,
  GUST_END_SECONDS,
  GUST_HOLD_END_SECONDS,
  GUST_HOLD_SECONDS,
  GUST_HOLD_START_SECONDS,
  GUST_MAXIMUM_BASE_PER_LAP,
  GUST_MINIMUM_PER_LAP,
  GUST_PEAK_CEILING_MPS2,
  GUST_RAMP_IN_SECONDS,
  GUST_RAMP_OUT_SECONDS,
  GUST_RAMP_START_SECONDS,
  GUST_RIVAL_LANE_BIAS_METERS,
  GUST_SCUD_ALPHA_SCALE,
  GUST_SCUD_TRAVERSE_SECONDS,
  GUST_TELEGRAPH_SECONDS,
  GUST_WINDOWS,
  FREE_SAWTOOTH_ON_ROAD_ALPHA,
  SALT_ARM_DISTANCE_METERS,
  SALT_FIRST_ELIGIBLE_LAP,
  SALT_PATCH_FROM_METERS,
  SALT_PATCH_GRIP,
  SALT_PATCH_SECONDS,
  SALT_PATCH_TO_METERS,
  SALT_WARNING_SECONDS,
  SQUALL_FIRST_ELIGIBLE_LAP,
  SQUALL_FROM_METERS,
  SQUALL_GRIP,
  SQUALL_LAST_ELIGIBLE_LAP,
  SQUALL_SECONDS,
  SQUALL_TO_METERS,
  TENSION_ARC_FIRST_LAP,
  buildTrackEventSchedule,
  eventFogMultiplier,
  eventSurfaceGrip,
  gustCountForLap,
  gustEnvelope,
  gustPeakForLap,
  gustScudTraverse,
  gustTelegraphLeadSeconds,
  isInsideSaltPatch,
  isInsideSquallSectors,
  saltPatchAlpha,
  squallEnvelope,
} from "../src/game/track-events-rules.js";
import {
  GUST_VELOCITY_CAP_MPS,
  GUST_VELOCITY_TIME_CONSTANT_SECONDS,
  integrateGustVelocity,
  resolveTargetSurfaceGrip,
} from "../src/game/physics.js";

/**
 * G3 — live track events.
 *
 * The three things this file exists to stop, in the order they would actually
 * happen:
 *
 *   1. AN EVENT THAT IS NOT A FUNCTION OF THE SEED. The whole phase rests on
 *      "same map, same seed, same race" — the ghost, the rival identity proof
 *      and every soak comparison all assume it. A schedule that reached for
 *      `Math.random`, wall-clock time or live state would still LOOK right in a
 *      soak, and would quietly make every A/B in this repo meaningless.
 *
 *   2. A PUSH THAT IS RATE DEPENDENT. The gust is the first thing in this game
 *      to integrate an acceleration onto the lateral outside the cushion, and
 *      the cushion's own integrator is deliberately NOT the one it uses. A
 *      60 Hz / 120 Hz split here is invisible to every other validator.
 *
 *   3. THE TENSION ARC EATEN BY THE CEILING. `2.0 * 1.2 = 2.4` is exactly the
 *      ceiling, so any future tuning of the base peak silently either breaks
 *      the arc or breaks the cap. Both directions are asserted.
 */

const BITTERPAN_LENGTH = 3050;
const GREENWATER_LENGTH = 2516;
const TOTAL_LAPS = 5;
const RACE_SEED = 714;

// --- 1. the envelope shapes ------------------------------------------------

assert.equal(
  GUST_HOLD_START_SECONDS - GUST_RAMP_START_SECONDS,
  GUST_RAMP_IN_SECONDS,
  "The gust ramp-in must be GUST_RAMP_IN_SECONDS long.",
);
assert.equal(
  GUST_HOLD_END_SECONDS - GUST_HOLD_START_SECONDS,
  GUST_HOLD_SECONDS,
  "The gust hold must be GUST_HOLD_SECONDS long.",
);
assert.ok(
  Math.abs((GUST_END_SECONDS - GUST_HOLD_END_SECONDS) - GUST_RAMP_OUT_SECONDS) < 1e-9,
  "The gust ramp-out must be GUST_RAMP_OUT_SECONDS long.",
);
assert.equal(gustEnvelope(GUST_RAMP_START_SECONDS), 0, "A gust starts at zero.");
assert.equal(gustEnvelope(GUST_HOLD_START_SECONDS), 1, "The hold is the peak.");
assert.equal(gustEnvelope(GUST_HOLD_END_SECONDS), 1, "The hold holds.");
assert.equal(gustEnvelope(GUST_END_SECONDS), 0, "A gust ends at zero.");
assert.equal(gustEnvelope(-1), 0, "A gust is zero before it arms.");
assert.equal(gustEnvelope(99), 0, "A gust is zero long after it ends.");
// Monotone up then down: a gust that dipped mid-ramp would read as two gusts.
let previous = 0;
for (let t = GUST_RAMP_START_SECONDS; t <= GUST_HOLD_START_SECONDS; t += 0.01) {
  const level = gustEnvelope(t);
  assert.ok(level >= previous - 1e-9, `The gust ramp-in dips at t=${t.toFixed(2)}.`);
  previous = level;
}
previous = 1;
for (let t = GUST_HOLD_END_SECONDS; t <= GUST_END_SECONDS; t += 0.01) {
  const level = gustEnvelope(t);
  assert.ok(level <= previous + 1e-9, `The gust ramp-out rises at t=${t.toFixed(2)}.`);
  previous = level;
}

// The tension arc, from both sides. This is the pair that a base-peak tune
// breaks silently: raise the base and the cap goes, lower it and the arc does.
assert.equal(gustPeakForLap(1), GUST_BASE_PEAK_MPS2, "Lap 1 gusts at the base peak.");
assert.equal(gustPeakForLap(TENSION_ARC_FIRST_LAP - 1), GUST_BASE_PEAK_MPS2);
assert.equal(
  gustPeakForLap(TENSION_ARC_FIRST_LAP),
  GUST_PEAK_CEILING_MPS2,
  "From lap 3 a gust must reach the full 2.4 m/s^2 ceiling — that IS the arc.",
);
assert.ok(
  gustPeakForLap(TENSION_ARC_FIRST_LAP) > gustPeakForLap(1) * 1.15,
  "The lap-3 gust must be meaningfully harder than the lap-1 gust, not 3% harder.",
);
for (let lap = 1; lap <= 12; lap += 1) {
  assert.ok(
    gustPeakForLap(lap) <= GUST_PEAK_CEILING_MPS2 + 1e-9,
    `Lap ${lap} peaks at ${gustPeakForLap(lap)}, over the 2.4 m/s^2 ceiling.`,
  );
}
assert.equal(gustCountForLap(6, 1), 6, "Lap 1 carries the base gust count.");
assert.equal(gustCountForLap(6, 2), 6, "Lap 2 carries the base gust count.");
assert.equal(gustCountForLap(6, 3), 7, "Lap 3 adds one gust.");

// The squall ramps at both ends and holds in the middle.
assert.equal(squallEnvelope(-0.01), 0, "A squall is zero before it arms.");
assert.equal(squallEnvelope(0), 0, "A squall starts at zero.");
assert.equal(squallEnvelope(SQUALL_SECONDS), 0, "A squall ends at zero.");
assert.equal(squallEnvelope(SQUALL_SECONDS / 2), 1, "A squall holds at full.");
assert.ok(
  squallEnvelope(SQUALL_SECONDS + 0.01) === 0,
  "A squall is zero after it ends.",
);

// The salt decal fades; the grip window does not.
assert.equal(saltPatchAlpha(-0.01), 0, "No decal before the salt lands.");
assert.equal(saltPatchAlpha(SALT_PATCH_SECONDS), 0, "The decal is gone at the end.");
assert.ok(saltPatchAlpha(0.4) > 0.9, "The decal is up almost immediately.");
assert.ok(
  saltPatchAlpha(1) > saltPatchAlpha(5),
  "The salt decal must fade, not brighten.",
);

// --- 2. the telegraph ------------------------------------------------------
//
// The acceptance band, asserted over the WHOLE card population rather than over
// the one phase that was spot-checked: every crossing card must reach the road
// between 0.8 and 1.6 s before the hold.

for (let phase = 0; phase <= 1; phase += 0.01) {
  const lead = gustTelegraphLeadSeconds(phase);
  assert.ok(
    lead >= 0.8 && lead <= 1.6,
    `A crossing card at phase ${phase.toFixed(2)} leads the hold by `
      + `${lead.toFixed(3)} s; the telegraph band is 0.8-1.6 s.`,
  );
  // And the schedule's own traverse has to agree with the closed-form lead: the
  // card is on the centreline at progress 0.5, so the traverse evaluated at
  // (hold - lead) must be 0.5. Two expressions, one fact.
  const at = gustScudTraverse(GUST_HOLD_START_SECONDS - lead, phase);
  assert.ok(
    Math.abs(at - 0.5) < 1e-9,
    `gustScudTraverse and gustTelegraphLeadSeconds disagree at phase `
      + `${phase.toFixed(2)}: traverse says ${at.toFixed(4)}, not 0.5.`,
  );
}
// THE ON-ROAD ALPHA, which is what the re-centring actually changed.
//
// Re-centring moved the card's brightest instant onto the racing line. That is
// the point - the free sawtooth reached the centreline at ~0.15 of its traverse
// where the envelope is still climbing, so the telegraph drew at 45% of its own
// peak and on the widest stations never crossed at all. But it is also how a
// telegraph becomes a lens wash, so the band is asserted from BOTH sides
// against the value the map already shipped, recomputed here rather than
// quoted.
{
  const CROSS_PEAK = 0.32;          // ALPHA_ENVELOPES.cross[1]
  const AMPLITUDE = 34;             // PAN_SCUD_CROSSING `amplitude`
  const WIDEST_HALF_WIDTH = 11.5;   // validate-map02.mjs
  let lowest = Infinity;
  let highest = 0;
  for (let lateral = 8; lateral <= 14; lateral += 0.1) {
    const offset = WIDEST_HALF_WIDTH + lateral;
    const progress = (1 - offset / AMPLITUDE) / 2;
    const alpha = Math.sin(Math.PI * progress) * CROSS_PEAK;
    lowest = Math.min(lowest, alpha);
    highest = Math.max(highest, alpha);
  }
  assert.ok(
    lowest > 0 && highest < CROSS_PEAK,
    "The free-sawtooth on-road alpha derivation is wrong: it should land "
      + `strictly between 0 and the ${CROSS_PEAK} envelope peak, and it gave `
      + `[${lowest.toFixed(3)}, ${highest.toFixed(3)}].`,
  );
  assert.ok(
    FREE_SAWTOOTH_ON_ROAD_ALPHA >= lowest && FREE_SAWTOOTH_ON_ROAD_ALPHA <= highest,
    `FREE_SAWTOOTH_ON_ROAD_ALPHA is ${FREE_SAWTOOTH_ON_ROAD_ALPHA}, outside the `
      + `[${lowest.toFixed(3)}, ${highest.toFixed(3)}] band the authored zone `
      + "actually produces. GUST_SCUD_ALPHA_SCALE is set against this number, so "
      + "a drift here silently re-tunes the telegraph.",
  );
  const drivenOnRoad = CROSS_PEAK * GUST_SCUD_ALPHA_SCALE;
  assert.ok(
    drivenOnRoad > highest,
    `A gust-driven card draws ${drivenOnRoad.toFixed(3)} over the racing line `
      + `against the free sawtooth's ${highest.toFixed(3)} at its most visible. `
      + "The whole point of re-phasing the zone was a telegraph the driver can "
      + "see; one that is DIMMER than what shipped is not that.",
  );
  assert.ok(
    drivenOnRoad <= CROSS_PEAK * 0.7,
    `A gust-driven card draws ${drivenOnRoad.toFixed(3)} over the racing line, `
      + `which is ${(drivenOnRoad / highest).toFixed(2)}x what the free sawtooth `
      + "draws there. Re-centring the traverse is a TIMING change; it is not "
      + "entitled to multiply the on-road alpha as a side effect. A stronger "
      + "telegraph is a number somebody chooses, in GUST_SCUD_ALPHA_SCALE.",
  );
  assert.ok(
    drivenOnRoad <= 0.35,
    "A gust-driven card must still respect the 0.35 corridor ceiling that "
      + "validate-living-world.mjs asserts the authored envelope against.",
  );
}

// Both ends of a traverse are alpha 0 in living-world.ts, which is what makes
// entering and leaving the event clock pop-free. Assert the window is closed.
assert.equal(gustScudTraverse(-5, 0.5), -1, "No traverse long before the gust.");
assert.equal(gustScudTraverse(50, 0.5), -1, "No traverse long after the gust.");
assert.ok(
  gustScudTraverse(GUST_HOLD_START_SECONDS - GUST_TELEGRAPH_SECONDS, 0.5) === 0.5,
  "The median card is on the centreline exactly GUST_TELEGRAPH_SECONDS early.",
);
// The traverse has to be over BEFORE the push arrives, or the picture is
// simultaneous with the shove instead of ahead of it.
assert.ok(
  GUST_TELEGRAPH_SECONDS > GUST_SCUD_TRAVERSE_SECONDS / 2 - 0.35,
  "The crossing traverse must be centred early enough to precede the hold.",
);
assert.ok(
  GUST_CHIP_LEAD_SECONDS < GUST_TELEGRAPH_SECONDS,
  "The picture must lead the words: the scud crosses before the chip lights.",
);
// The lamps' own lead. Latched as a constant because the drop is scheduled off
// it, but asserted here against the acceptance floor rather than trusted.
assert.ok(
  SALT_WARNING_SECONDS >= 1.8,
  `The underpass lamps go solid ${SALT_WARNING_SECONDS} s before the salt; the `
    + "acceptance floor is 1.8 s.",
);

// --- 3. schedule determinism ----------------------------------------------

const bitterpanInput = {
  kind: "bitterpan",
  seed: RACE_SEED,
  totalLaps: TOTAL_LAPS,
  courseLengthMeters: BITTERPAN_LENGTH,
  // A stub sign resolver: the runtime one reads the course tangent, which this
  // harness has no business loading. Alternating signs are enough to prove the
  // schedule threads the resolver's answer through unchanged.
  resolveGustSign: (distance) => (Math.floor(distance / 100) % 2 === 0 ? 1 : -1),
};
const first = buildTrackEventSchedule(bitterpanInput);
const second = buildTrackEventSchedule(bitterpanInput);
assert.deepEqual(
  second,
  first,
  "Two builds of the same seed produced different schedules. Every event in G3 "
    + "must be a pure function of (map, seed, lap count).",
);
const other = buildTrackEventSchedule({ ...bitterpanInput, seed: RACE_SEED + 1 });
assert.notDeepEqual(
  other.gusts.map((gust) => Math.round(gust.courseDistanceMeters)),
  first.gusts.map((gust) => Math.round(gust.courseDistanceMeters)),
  "Two different seeds produced the same gust stations. The seed is not "
    + "reaching the schedule.",
);
// The sign really is the resolver's, not a coin.
for (const gust of first.gusts) {
  assert.equal(
    gust.sign,
    bitterpanInput.resolveGustSign(gust.courseDistanceMeters),
    `Gust ${gust.id} did not take the resolved wind sign at its own station.`,
  );
}
assert.ok(
  BITTERPAN_WIND_BEARING_DEGREES === 292,
  "The gust must resolve from the map's own authored 292-degree wind.",
);

// --- 4. the gust population ------------------------------------------------

const perLap = new Map();
for (const gust of first.gusts) {
  perLap.set(gust.lap, (perLap.get(gust.lap) ?? 0) + 1);
}
for (let lap = 1; lap <= TOTAL_LAPS; lap += 1) {
  const count = perLap.get(lap) ?? 0;
  assert.ok(
    count >= 5 && count <= 8,
    `Lap ${lap} carries ${count} gusts; the phase authors 5-8 per lap.`,
  );
}
assert.ok(
  (perLap.get(TENSION_ARC_FIRST_LAP) ?? 0) === (perLap.get(1) ?? 0) + 1,
  "The tension arc must add exactly one gust from lap 3.",
);
assert.ok(
  first.gusts.length >= 27 && first.gusts.length <= 40,
  `A five-lap Bitterpan race schedules ${first.gusts.length} gusts; the `
    + "acceptance band is 27-40.",
);
// And that holds for EVERY seed, not just this one — the count is what the
// acceptance is stated against, so a seed that fell outside it would be a
// latent acceptance failure rather than a variation.
for (let seed = 1; seed <= 200; seed += 1) {
  const run = buildTrackEventSchedule({ ...bitterpanInput, seed });
  assert.ok(
    run.gusts.length >= 27 && run.gusts.length <= 40,
    `Seed ${seed} schedules ${run.gusts.length} gusts, outside the 27-40 band.`,
  );
  assert.ok(
    run.saltDrops.length >= 2 && run.saltDrops.length <= 3,
    `Seed ${seed} schedules ${run.saltDrops.length} salt drops; 2-3 is the band.`,
  );
  for (const drop of run.saltDrops) {
    assert.ok(
      drop.lap >= SALT_FIRST_ELIGIBLE_LAP,
      `Seed ${seed} drops salt on lap ${drop.lap}. Lap 1 must stay clean so a `
        + "first-time driver learns the track.",
    );
  }
  const laps = run.saltDrops.map((drop) => drop.lap);
  assert.equal(new Set(laps).size, laps.length, `Seed ${seed} drops twice on one lap.`);
}
// Every gust arms inside an authored open sector.
for (const gust of first.gusts) {
  const inside = GUST_WINDOWS.some(
    (window) => gust.courseDistanceMeters >= window.from
      && gust.courseDistanceMeters <= window.to,
  );
  assert.ok(
    inside,
    `Gust ${gust.id} arms at ${gust.courseDistanceMeters.toFixed(1)} m, outside `
      + "THE LONG PAN / CONE ROW SWEEP / RETURN LEG. A lateral shove between the "
      + "harvester rigs is a cheap shot, not weather.",
  );
  assert.equal(
    gust.armDistanceMeters,
    (gust.lap - 1) * BITTERPAN_LENGTH + gust.courseDistanceMeters,
    `Gust ${gust.id} arms at the wrong race distance for its lap.`,
  );
}
// Arm distances are monotone, because the runtime arms with a forward-only
// cursor over the list and a mis-sorted schedule would silently drop events.
for (let index = 1; index < first.gusts.length; index += 1) {
  assert.ok(
    first.gusts[index].armDistanceMeters >= first.gusts[index - 1].armDistanceMeters,
    "The gust schedule must be sorted by race distance.",
  );
}
for (let index = 1; index < first.saltDrops.length; index += 1) {
  assert.ok(
    first.saltDrops[index].armDistanceMeters
      > first.saltDrops[index - 1].armDistanceMeters,
    "The salt schedule must be sorted by race distance.",
  );
}
assert.ok(
  GUST_MINIMUM_PER_LAP >= 5 && GUST_MAXIMUM_BASE_PER_LAP + 1 <= 8,
  "The seeded base count must keep every lap inside the authored 5-8 band.",
);

// --- 5. the salt patch -----------------------------------------------------

assert.ok(
  SALT_ARM_DISTANCE_METERS < SALT_PATCH_FROM_METERS,
  "The salt drop must arm before the span it drops from.",
);
assert.ok(isInsideSaltPatch(SALT_PATCH_FROM_METERS), "The patch starts at 3005 m.");
assert.ok(isInsideSaltPatch(SALT_PATCH_TO_METERS), "The patch ends at 3040 m.");
assert.ok(!isInsideSaltPatch(SALT_PATCH_FROM_METERS - 1), "The patch has a near edge.");
assert.ok(!isInsideSaltPatch(SALT_PATCH_TO_METERS + 1), "The patch has a far edge.");
assert.equal(
  eventSurfaceGrip(3020, 1, 0),
  SALT_PATCH_GRIP,
  "A live salt patch must cost exactly the map's own salt-drift grip, 0.74.",
);
assert.equal(
  eventSurfaceGrip(3020, 0, 0),
  1,
  "A patch that is not live must cost nothing.",
);
assert.equal(
  eventSurfaceGrip(2000, 1, 0),
  1,
  "The salt patch must not cost grip 1000 m from the span.",
);
assert.equal(SALT_PATCH_SECONDS, 6, "The salt patch lives for 6 s.");

// --- 6. the squall ---------------------------------------------------------

const greenwaterInput = {
  kind: "greenwater",
  seed: RACE_SEED,
  totalLaps: TOTAL_LAPS,
  courseLengthMeters: GREENWATER_LENGTH,
};
const gwFirst = buildTrackEventSchedule(greenwaterInput);
assert.deepEqual(
  buildTrackEventSchedule(greenwaterInput),
  gwFirst,
  "The Greenwater schedule is not deterministic.",
);
assert.equal(gwFirst.gusts.length, 0, "Gusts are Bitterpan's; Greenwater gets none.");
assert.equal(gwFirst.saltDrops.length, 0, "The conveyor is Bitterpan's.");
assert.ok(gwFirst.squall, "Greenwater must schedule exactly one squall.");
assert.equal(first.squall, null, "Bitterpan must not schedule a squall.");
for (let seed = 1; seed <= 200; seed += 1) {
  const run = buildTrackEventSchedule({ ...greenwaterInput, seed });
  assert.ok(run.squall, `Seed ${seed} scheduled no Greenwater squall.`);
  assert.ok(
    run.squall.lap >= SQUALL_FIRST_ELIGIBLE_LAP
      && run.squall.lap <= SQUALL_LAST_ELIGIBLE_LAP,
    `Seed ${seed} starts the squall on lap ${run.squall.lap}; the window is `
      + `${SQUALL_FIRST_ELIGIBLE_LAP}-${SQUALL_LAST_ELIGIBLE_LAP}.`,
  );
  assert.ok(
    isInsideSquallSectors(run.squall.courseDistanceMeters),
    `Seed ${seed} starts the squall at `
      + `${run.squall.courseDistanceMeters.toFixed(1)} m, outside WATER_TABLE -> `
      + "GREENWATER_SWEEP.",
  );
  // Leaving room to actually rain: a squall that armed at the far edge of the
  // band would be over the sectors it is supposed to cover for a heartbeat.
  assert.ok(
    run.squall.courseDistanceMeters
      <= SQUALL_FROM_METERS + (SQUALL_TO_METERS - SQUALL_FROM_METERS) * 0.5,
    `Seed ${seed} arms the squall too late in the band to cover it.`,
  );
}
assert.equal(SQUALL_SECONDS, 25, "The squall runs 25 s of race time.");
// The grip the squall asks for, at full strength and at the ramp.
assert.ok(
  Math.abs(eventSurfaceGrip(800, 0, 1) - SQUALL_GRIP) < 1e-9,
  "A full squall must ask for 0.88 deck grip.",
);
assert.equal(eventSurfaceGrip(800, 0, 0), 1, "No squall, no grip cost.");
assert.equal(
  eventSurfaceGrip(SQUALL_TO_METERS + 50, 0, 1),
  1,
  "The squall must not cost grip outside its two sectors.",
);
assert.ok(
  eventSurfaceGrip(800, 0, 0.5) > SQUALL_GRIP
    && eventSurfaceGrip(800, 0, 0.5) < 1,
  "The squall's grip cost must ramp with its level rather than switching.",
);
// Fog.
assert.ok(
  Math.abs(eventFogMultiplier(800, 1) - 1.18) < 1e-9,
  "A full squall thickens the fog by 1.18x.",
);
assert.equal(eventFogMultiplier(800, 0), 1, "No squall, no fog change.");
assert.equal(eventFogMultiplier(2000, 1), 1, "The squall's fog stays in its sectors.");

// --- 7. the grip path ------------------------------------------------------
//
// The event term has to compose with the two that were already there, and it
// has to be the IDENTITY when nothing is happening — every pre-G3 call site
// omits it, so a default that was not 1 would move the whole handling model.

assert.equal(
  resolveTargetSurfaceGrip(1, 1),
  1,
  "A call with no event term must still resolve to 1.",
);
assert.equal(
  resolveTargetSurfaceGrip(1, 1, undefined, 1),
  1,
  "An event grip of 1 must be the identity.",
);
assert.equal(
  resolveTargetSurfaceGrip(1, 1, undefined, SALT_PATCH_GRIP),
  SALT_PATCH_GRIP,
  "On clean deck the event term is the whole target.",
);
assert.ok(
  resolveTargetSurfaceGrip(0.8, 1, undefined, SQUALL_GRIP)
    < Math.min(0.8, SQUALL_GRIP) + 1e-9,
  "A squall over standing water must be worse than either alone — the terms "
    + "multiply, they do not take a minimum.",
);
assert.ok(
  resolveTargetSurfaceGrip(0.2, 0.2, undefined, 0.2) >= 0.2,
  "The grip floor must still hold with three terms compounded.",
);

// --- 8. rate independence --------------------------------------------------
//
// The one failure no soak and no other validator can see. A gust is the first
// acceleration this game integrates onto the lateral outside the cushion, and
// it deliberately uses a DIFFERENT integrator, so it needs its own proof.

function integrateGust(stepSeconds, seconds, peak) {
  let velocity = 0;
  let travel = 0;
  let peakVelocity = 0;
  const steps = Math.round(seconds / stepSeconds);
  for (let index = 0; index < steps; index += 1) {
    const t = index * stepSeconds;
    velocity = integrateGustVelocity(velocity, gustEnvelope(t) * peak, stepSeconds);
    peakVelocity = Math.max(peakVelocity, Math.abs(velocity));
    travel += Math.abs(velocity) * stepSeconds;
  }
  return { velocity, travel, peakVelocity };
}

// FIRST, the integrator itself, where the property is EXACT and any tolerance
// would be hiding something. Under a CONSTANT push the zero-order hold is not
// an approximation of anything, so `exp(-(a+b)/tau) === exp(-a/tau)exp(-b/tau)`
// is the whole claim: N steps of h must land on the same velocity one step of
// N*h does. An Euler integrator fails this by percent, not by epsilon.
for (const [coarse, fine] of [[1 / 60, 1 / 120], [1 / 30, 1 / 240], [0.1, 1 / 240]]) {
  const ratio = Math.round(coarse / fine);
  let big = 0;
  let small = 0;
  for (let index = 0; index < 8; index += 1) {
    big = integrateGustVelocity(big, GUST_PEAK_CEILING_MPS2, coarse);
    for (let sub = 0; sub < ratio; sub += 1) {
      small = integrateGustVelocity(small, GUST_PEAK_CEILING_MPS2, fine);
    }
  }
  assert.ok(
    Math.abs(big - small) < 1e-12,
    `integrateGustVelocity is step dependent under a constant push: `
      + `${ratio} x ${fine.toFixed(5)} s reached ${small}, one ${coarse.toFixed(5)} s `
      + `step reached ${big}. The closed form exists precisely so these agree.`,
  );
}

// The one place the closed form deliberately stops being exact: a step longer
// than 0.1 s is CLAMPED, the same way the cushion clamps, so a tab that was
// backgrounded for two seconds cannot resume by teleporting the craft sideways.
// Asserted rather than left as a surprise for whoever next reads the exactness
// claim above.
assert.equal(
  integrateGustVelocity(0, GUST_PEAK_CEILING_MPS2, 5),
  integrateGustVelocity(0, GUST_PEAK_CEILING_MPS2, 0.1),
  "A long frame must be clamped to 0.1 s rather than integrated whole.",
);

// SECOND, the whole envelope. Here the rates genuinely see different forcing —
// each samples `gustEnvelope` at its own step boundaries during the two ramps —
// so this converges rather than matching exactly, and the assertion is written
// as convergence rather than as a tolerance somebody picked.
//
// The in-game answer is stronger than either: `FIXED_STEP` in game.ts pins the
// physics at 120 Hz whatever the renderer does, so the render rate cannot reach
// this integrator at all. What is being defended here is the model, not the
// loop.
const at120 = integrateGust(1 / 120, GUST_END_SECONDS + 2, GUST_PEAK_CEILING_MPS2);
const at60 = integrateGust(1 / 60, GUST_END_SECONDS + 2, GUST_PEAK_CEILING_MPS2);
const at240 = integrateGust(1 / 240, GUST_END_SECONDS + 2, GUST_PEAK_CEILING_MPS2);
const at480 = integrateGust(1 / 480, GUST_END_SECONDS + 2, GUST_PEAK_CEILING_MPS2);
assert.ok(
  Math.abs(at120.travel - at60.travel) < 0.01,
  `The gust moved the craft ${at120.travel.toFixed(4)} m at 120 Hz and `
    + `${at60.travel.toFixed(4)} m at 60 Hz — a `
    + `${Math.abs(at120.travel - at60.travel).toFixed(4)} m split over one gust. `
    + "Anything past a centimetre is a rate-dependent model, not quadrature.",
);
assert.ok(
  Math.abs(at120.peakVelocity - at60.peakVelocity) < 1e-3,
  `Peak lateral drift is rate dependent: ${at120.peakVelocity.toFixed(6)} m/s at `
    + `120 Hz against ${at60.peakVelocity.toFixed(6)} at 60 Hz.`,
);
// Convergence, halving twice: each refinement must move the answer LESS than
// the one before it. A model with a rate-dependent term does the opposite.
const gap60 = Math.abs(at60.travel - at120.travel);
const gap120 = Math.abs(at120.travel - at240.travel);
const gap240 = Math.abs(at240.travel - at480.travel);
assert.ok(
  gap120 < gap60 && gap240 < gap120,
  `The gust travel is not converging under refinement: 60->120 moved `
    + `${gap60.toExponential(2)} m, 120->240 moved ${gap120.toExponential(2)}, `
    + `240->480 moved ${gap240.toExponential(2)}. That is divergence.`,
);

// --- 9. the push envelope --------------------------------------------------

let peakVelocity = 0;
let peakPush = 0;
{
  let velocity = 0;
  let travel = 0;
  const step = 1 / 120;
  for (let index = 0; index * step <= GUST_END_SECONDS + 4; index += 1) {
    const push = gustEnvelope(index * step) * GUST_PEAK_CEILING_MPS2;
    peakPush = Math.max(peakPush, push);
    velocity = integrateGustVelocity(velocity, push, step);
    peakVelocity = Math.max(peakVelocity, Math.abs(velocity));
    travel += Math.abs(velocity) * step;
  }
  assert.ok(
    Math.abs(peakPush - GUST_PEAK_CEILING_MPS2) < 1e-9,
    `A lap-3 gust peaks at ${peakPush.toFixed(3)} m/s^2; the ceiling is 2.4.`,
  );
  // The number the whole damping decision rests on. `a * tau` is the terminal
  // drift; the hold is long enough to approach it but not to sit on it.
  const terminal = GUST_PEAK_CEILING_MPS2 * GUST_VELOCITY_TIME_CONSTANT_SECONDS;
  assert.ok(
    peakVelocity <= terminal + 1e-6,
    `The gust reached ${peakVelocity.toFixed(4)} m/s of lateral drift, over the `
      + `${terminal.toFixed(4)} m/s terminal the damping model allows. That is `
      + "the undamped-integration failure this constant exists to prevent.",
  );
  assert.ok(
    peakVelocity > terminal * 0.6,
    `The gust only reached ${peakVelocity.toFixed(4)} m/s against a terminal of `
      + `${terminal.toFixed(4)}. A gust that never spins up is a gust the driver `
      + "cannot feel, whatever the peak push reads.",
  );
  // The travel is the honest "what did it actually do" number. An uncorrected
  // craft is carried a couple of metres by one full-strength gust: enough to
  // need a correction, nowhere near enough to be thrown off a 23 m deck.
  assert.ok(
    travel > 1 && travel < 3.5,
    `One full gust carries an uncorrected craft ${travel.toFixed(3)} m sideways. `
      + "Under 1 m is invisible; over 3.5 m is a fault rather than weather.",
  );
  assert.ok(
    peakVelocity < GUST_VELOCITY_CAP_MPS,
    "A legal gust must never touch the velocity cap — the cap is a backstop for "
      + "an illegal one, not part of the model.",
  );
}

// The rival's half is bounded by the same brief number.
assert.ok(
  GUST_RIVAL_LANE_BIAS_METERS <= 0.9,
  `A gust biases a rival's target lane by ${GUST_RIVAL_LANE_BIAS_METERS} m; the `
    + "phase authors at most 0.9.",
);

// --- 10. a whole race, replayed --------------------------------------------
//
// The end-to-end shape: drive a stand-in player round five Bitterpan laps at
// the demo's measured pace and replay the schedule against it, exactly the way
// TrackEvents arms. What this catches that the unit assertions cannot is an
// event that is scheduled but never reachable — a station past the finish, a
// salt drop on a lap the race does not have, an arm cursor that skips.

{
  const step = 1 / 120;
  const lapSeconds = 183.417 / 5;
  const speed = BITTERPAN_LENGTH / lapSeconds;
  const schedule = buildTrackEventSchedule(bitterpanInput);
  let armedGusts = 0;
  let armedSalt = 0;
  let gustSeconds = 0;
  let nextGust = 0;
  let nextSalt = 0;
  let activeGustAt = -1;
  let saltPatchSeconds = 0;
  let activeSaltAt = -1;
  for (let index = 0; index * step <= lapSeconds * TOTAL_LAPS; index += 1) {
    const seconds = index * step;
    const distance = speed * seconds;
    while (
      nextGust < schedule.gusts.length
      && distance >= schedule.gusts[nextGust].armDistanceMeters
    ) {
      nextGust += 1;
      armedGusts += 1;
      activeGustAt = seconds;
    }
    while (
      nextSalt < schedule.saltDrops.length
      && distance >= schedule.saltDrops[nextSalt].armDistanceMeters
    ) {
      nextSalt += 1;
      armedSalt += 1;
      activeSaltAt = seconds;
    }
    if (activeGustAt >= 0) {
      if (seconds - activeGustAt > GUST_END_SECONDS) activeGustAt = -1;
      else if (gustEnvelope(seconds - activeGustAt) > 0) gustSeconds += step;
    }
    if (activeSaltAt >= 0) {
      const dropSeconds = seconds - activeSaltAt - SALT_WARNING_SECONDS;
      if (dropSeconds > SALT_PATCH_SECONDS) activeSaltAt = -1;
      else if (dropSeconds >= 0) saltPatchSeconds += step;
    }
  }
  assert.equal(
    armedGusts,
    schedule.gusts.length,
    `${armedGusts} of ${schedule.gusts.length} scheduled gusts armed over a `
      + "five-lap race. A gust that is scheduled and never reached is a gust "
      + "that does not exist.",
  );
  assert.equal(
    armedSalt,
    schedule.saltDrops.length,
    "A scheduled salt drop was never reached over the five laps.",
  );
  assert.ok(
    gustSeconds > 60 && gustSeconds < 150,
    `${gustSeconds.toFixed(1)} s of the ${(lapSeconds * TOTAL_LAPS).toFixed(1)} s `
      + "race carried a live gust. Under 60 s the pan does not read as windy; "
      + "over 150 s it is a permanent crosswind rather than gusts.",
  );
  // Each drop is a hard 6 s window — except that a drop scheduled on the FINAL
  // lap arms 210 m from the line, so the race can end inside its window. That
  // is correct behaviour (the salt still lands, and it lands on the run to the
  // flag, which is the most interesting place on the lap for it to land) but it
  // means the total is bounded rather than exact, and a soak's
  // `saltPatchSeconds` will read short of `saltDrops x 6` whenever the last lap
  // drew one.
  const full = schedule.saltDrops.length * SALT_PATCH_SECONDS;
  assert.ok(
    saltPatchSeconds <= full + 0.05
      && saltPatchSeconds >= full - SALT_PATCH_SECONDS - 0.05,
    `The salt patch was live for ${saltPatchSeconds.toFixed(2)} s across `
      + `${schedule.saltDrops.length} drops. At most one drop — the final-lap `
      + `one — may be cut short by the flag, so the total must sit in `
      + `[${(full - SALT_PATCH_SECONDS).toFixed(0)}, ${full.toFixed(0)}] s.`,
  );
}

// --- 11. the squall arms ONCE, replayed the way the runtime arms it ---------
//
// A REGRESSION TEST, and it is worth saying what it regressed against. The
// first build armed the squall on "past the station and not currently running",
// which is correct for the gusts and the salt drops (both walk a forward-only
// index) and wrong for the one optional event: the player stays past the
// station for the rest of the race, so the squall re-armed the instant it
// expired. A five-lap Greenwater soak measured FOUR squalls and 89.66 s of rain
// against the 25 s the phase authors — and every unit assertion above passed
// throughout, because the SCHEDULE was right and the ARMING was not.
//
// So this replays the arming itself, and then proves the test can fail by
// replaying the broken predicate beside it.

{
  const step = 1 / 120;
  const lapSeconds = 165.718 / 5;
  const speed = GREENWATER_LENGTH / lapSeconds;
  const schedule = buildTrackEventSchedule(greenwaterInput);

  function replaySquall(useFiredLatch) {
    let fired = false;
    let armed = false;
    let armedAt = -1;
    let count = 0;
    let seconds = 0;
    let startLap = 0;
    for (let index = 0; index * step <= lapSeconds * TOTAL_LAPS; index += 1) {
      const now = index * step;
      const distance = speed * now;
      const gate = useFiredLatch ? !fired : !armed;
      if (gate && distance >= schedule.squall.armDistanceMeters) {
        fired = true;
        armed = true;
        armedAt = now;
        count += 1;
        if (count === 1) startLap = Math.floor(distance / GREENWATER_LENGTH) + 1;
      }
      if (armed) {
        if (now - armedAt > SQUALL_SECONDS) armed = false;
        else if (squallEnvelope(now - armedAt) > 0) seconds += step;
      }
    }
    return { count, seconds, startLap };
  }

  const correct = replaySquall(true);
  assert.equal(
    correct.count,
    1,
    `The squall armed ${correct.count} times over a five-lap race. The phase `
      + "authors exactly one.",
  );
  assert.ok(
    correct.seconds >= 22 && correct.seconds <= 28,
    `The squall ran for ${correct.seconds.toFixed(2)} s; the acceptance band is `
      + "22-28 s.",
  );
  assert.ok(
    correct.startLap >= SQUALL_FIRST_ELIGIBLE_LAP
      && correct.startLap <= SQUALL_LAST_ELIGIBLE_LAP,
    `The squall started on lap ${correct.startLap}; the window is 2-4.`,
  );

  const broken = replaySquall(false);
  assert.ok(
    broken.count > 1,
    "The 'not currently running' arming predicate no longer re-arms the squall, "
      + "so this regression test proves nothing. Either the schedule moved the "
      + "squall to the last lap, or the replay stopped modelling the runtime.",
  );
}

console.log(
  `Track events PASS: ${first.gusts.length} Bitterpan gusts over ${TOTAL_LAPS} laps `
    + `(peak ${GUST_BASE_PEAK_MPS2} -> ${GUST_PEAK_CEILING_MPS2} m/s^2 from lap `
    + `${TENSION_ARC_FIRST_LAP}), ${first.saltDrops.length} salt drops none before `
    + `lap ${SALT_FIRST_ELIGIBLE_LAP}, one Greenwater squall on lap `
    + `${gwFirst.squall.lap} for ${SQUALL_SECONDS} s at grip ${SQUALL_GRIP}; `
    + "schedule deterministic over 200 seeds, telegraph inside 0.8-1.6 s for "
    + "every card phase, gust integration rate independent 60/120/240 Hz.",
);
