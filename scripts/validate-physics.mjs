import assert from "node:assert/strict";
import * as physics from "../src/game/physics.js";

function simulateSpeed({
  seconds,
  step,
  throttle,
  brake,
  boostActive,
  steer = 0,
  startingSpeed = 0,
}) {
  let speed = startingSpeed;
  const iterations = Math.round(seconds / step);
  for (let index = 0; index < iterations; index += 1) {
    const drift = physics.calculateDriftIntent(
      speed / physics.BOOST_MAX_SPEED,
      brake,
      steer,
    );
    speed = physics.integrateSpeed(
      speed,
      throttle,
      brake,
      boostActive,
      drift,
      step,
    );
  }
  return speed;
}

const cruise120 = simulateSpeed({
  seconds: 12,
  step: 1 / 120,
  throttle: 1,
  brake: 0,
  boostActive: false,
});
const cruise60 = simulateSpeed({
  seconds: 12,
  step: 1 / 60,
  throttle: 1,
  brake: 0,
  boostActive: false,
});
const boosted = simulateSpeed({
  seconds: 6,
  step: 1 / 120,
  throttle: 1,
  brake: 0,
  boostActive: true,
});
const braking = simulateSpeed({
  seconds: 1,
  step: 1 / 120,
  throttle: 0,
  brake: 1,
  boostActive: false,
  startingSpeed: 85,
});
const releasedBoostFirstStep = simulateSpeed({
  seconds: 1 / 120,
  step: 1 / 120,
  throttle: 1,
  brake: 0,
  boostActive: false,
  startingSpeed: physics.BOOST_MAX_SPEED,
});
const releasedBoostHalfSecond = simulateSpeed({
  seconds: 0.5,
  step: 1 / 120,
  throttle: 1,
  brake: 0,
  boostActive: false,
  startingSpeed: physics.BOOST_MAX_SPEED,
});
const releasedBoostTwoSeconds120 = simulateSpeed({
  seconds: 2,
  step: 1 / 120,
  throttle: 1,
  brake: 0,
  boostActive: false,
  startingSpeed: physics.BOOST_MAX_SPEED,
});
const releasedBoostTwoSeconds60 = simulateSpeed({
  seconds: 2,
  step: 1 / 60,
  throttle: 1,
  brake: 0,
  boostActive: false,
  startingSpeed: physics.BOOST_MAX_SPEED,
});

function simulateCoast({ seconds, step, startingSpeed }) {
  let speed = startingSpeed;
  let distance = 0;
  const iterations = Math.round(seconds / step);
  for (let index = 0; index < iterations; index += 1) {
    speed = physics.integrateCoastSpeed(speed, step);
    distance += speed * step;
  }
  return { speed, distance };
}

const coastOneSecond = simulateCoast({
  seconds: 1,
  step: 1 / 120,
  startingSpeed: physics.CRUISE_MAX_SPEED,
});
const coast120 = simulateCoast({
  seconds: 3.5,
  step: 1 / 120,
  startingSpeed: physics.CRUISE_MAX_SPEED,
});
const coast60 = simulateCoast({
  seconds: 3.5,
  step: 1 / 60,
  startingSpeed: physics.CRUISE_MAX_SPEED,
});

assert.ok(cruise120 > 70 && cruise120 <= 92, `Unexpected cruise speed ${cruise120}.`);
assert.ok(boosted > cruise120, "Boost must produce a higher terminal speed than cruise.");
assert.ok(boosted <= physics.BOOST_MAX_SPEED, "Boost must respect its speed cap.");
assert.ok(braking < 45, `Full braking should shed meaningful speed; got ${braking}.`);
assert.ok(
  releasedBoostFirstStep > 110,
  `Boost release must preserve momentum instead of snapping to cruise speed (${releasedBoostFirstStep}).`,
);
assert.ok(
  releasedBoostHalfSecond < releasedBoostFirstStep
    && releasedBoostHalfSecond > 100,
  "Released boost must begin a controlled overspeed bleed.",
);
assert.ok(
  releasedBoostTwoSeconds120 < releasedBoostHalfSecond
    && releasedBoostTwoSeconds120 > 92,
  "Overspeed must continue decaying smoothly without an artificial cruise clamp.",
);
assert.ok(
  Math.abs(releasedBoostTwoSeconds120 - releasedBoostTwoSeconds60) < 0.2,
  "Post-boost momentum decay must remain stable between 60 Hz and 120 Hz.",
);
assert.ok(
  Math.abs(cruise120 - cruise60) < 0.2,
  "Longitudinal integration must remain stable between 60 Hz and 120 Hz.",
);
assert.ok(
  coastOneSecond.speed > 35 && coastOneSecond.speed < 55,
  "The result run-out must visibly carry finish-line momentum for its first second.",
);
assert.equal(coast120.speed, 0, "The result run-out must settle within 3.5 seconds.");
assert.equal(coast60.speed, 0, "The 60 Hz result run-out must settle within 3.5 seconds.");
assert.ok(
  coast120.distance > 85 && coast120.distance < 115,
  `The result run-out must stay near The Cradle; got ${coast120.distance} m.`,
);
assert.ok(
  Math.abs(coast120.distance - coast60.distance) < 0.7,
  "Result run-out distance must remain stable between 60 Hz and 120 Hz.",
);
assert.equal(
  physics.integrateCoastSpeed(Number.NaN, Number.NaN),
  0,
  "Invalid result run-out state must settle safely.",
);

const highSpeedDrift = physics.calculateDriftIntent(0.82, 1, 1);
const noBrakeDrift = physics.calculateDriftIntent(0.82, 0, 1);
assert.ok(highSpeedDrift > 0.5, "Brake plus steer at speed must engage drift authority.");
assert.equal(noBrakeDrift, 0, "Steering alone must not engage the drift model.");
assert.equal(
  physics.resolveDriftActive(false, 0.25),
  false,
  "Drift feedback must not engage below its entry threshold.",
);
assert.equal(
  physics.resolveDriftActive(false, 0.26),
  true,
  "Drift feedback must engage at its entry threshold.",
);
assert.equal(
  physics.resolveDriftActive(true, 0.15),
  true,
  "Active drift feedback must survive small analogue-input noise.",
);
assert.equal(
  physics.resolveDriftActive(true, 0.13),
  false,
  "Drift feedback must release below its exit threshold.",
);
assert.ok(
  physics.calculateTurnRate(0.82, highSpeedDrift)
    > physics.calculateTurnRate(0.82, 0),
  "Drift must increase yaw authority.",
);
assert.ok(
  physics.calculateGripRate(0.82, highSpeedDrift, 1, 1, 1)
    < physics.calculateGripRate(0.82, 0, 1, 0, 1),
  "Drift must reduce lateral grip.",
);
assert.ok(
  physics.calculateGripRate(0.6, 0, 0.8, 0, 0)
    < physics.calculateGripRate(0.6, 0, 1, 0, 0),
  "Standing water must reduce available grip.",
);

function simulateSurfaceGrip({ seconds, step, startingGrip, targetGrip }) {
  let grip = startingGrip;
  const iterations = Math.round(seconds / step);
  for (let index = 0; index < iterations; index += 1) {
    grip = physics.integrateSurfaceGrip(grip, targetGrip, 0.8, step);
  }
  return grip;
}

const wetGripFirstStep = simulateSurfaceGrip({
  seconds: 1 / 120,
  step: 1 / 120,
  startingGrip: 1,
  targetGrip: 0.8,
});
const wetGrip120 = simulateSurfaceGrip({
  seconds: 0.2,
  step: 1 / 120,
  startingGrip: 1,
  targetGrip: 0.8,
});
const wetGrip60 = simulateSurfaceGrip({
  seconds: 0.2,
  step: 1 / 60,
  startingGrip: 1,
  targetGrip: 0.8,
});
const recoveredGrip120 = simulateSurfaceGrip({
  seconds: 0.8,
  step: 1 / 120,
  startingGrip: wetGrip120,
  targetGrip: 1,
});
const recoveredGrip60 = simulateSurfaceGrip({
  seconds: 0.8,
  step: 1 / 60,
  startingGrip: wetGrip60,
  targetGrip: 1,
});
assert.ok(
  wetGripFirstStep > 0.8 && wetGripFirstStep < 1,
  "Water entry must begin immediately without snapping grip in one step.",
);
assert.ok(wetGrip120 < 0.81, "Wet grip must take hold within 0.2 seconds.");
assert.ok(
  recoveredGrip120 > 0.98 && recoveredGrip120 < 1,
  "Grip must recover smoothly across the authored 0.8-second duration.",
);
assert.ok(
  Math.abs(wetGrip120 - wetGrip60) < 0.001
    && Math.abs(recoveredGrip120 - recoveredGrip60) < 0.001,
  "Surface-grip transitions must remain stable between 60 Hz and 120 Hz.",
);
assert.equal(
  physics.integrateSurfaceGrip(Number.NaN, Number.NaN, Number.NaN, Number.NaN),
  1,
  "Invalid surface state must fall back to full grip.",
);

function simulateSteering({ seconds, step, target, startingSteer = 0 }) {
  let steer = startingSteer;
  const iterations = Math.round(seconds / step);
  for (let index = 0; index < iterations; index += 1) {
    steer = physics.integrateSteering(steer, target, step);
  }
  return steer;
}

const steering120 = simulateSteering({ seconds: 0.25, step: 1 / 120, target: 1 });
const steering60 = simulateSteering({ seconds: 0.25, step: 1 / 60, target: 1 });
const releasedSteering = simulateSteering({
  seconds: 0.3,
  step: 1 / 120,
  target: 0,
  startingSteer: steering120,
});
assert.ok(
  steering120 > 0.75 && steering120 < 0.85,
  `Steering attack is outside the responsive arcade window (${steering120}).`,
);
assert.ok(
  Math.abs(steering120 - steering60) < 0.001,
  "Steering response must remain stable between 60 Hz and 120 Hz.",
);
assert.ok(releasedSteering < 0.07, "Released steering must settle quickly.");
assert.equal(
  physics.integrateSteering(0, 0, 1 / 120),
  0,
  "Neutral input must never create steering assistance.",
);

// The P5 economy table is the whole drift/boost tradeoff, and every duration
// asserted below is derived from it. Pinning the constants here means a silent
// re-tune cannot pass by quietly moving both the value and its expectation.
assert.equal(physics.DRIFT_CHARGE_RATE, 0.55, "Drift charge rate is off the authored table.");
assert.equal(physics.DRIFT_CHARGE_CAP, 1, "Drift charge cap is off the authored table.");
assert.equal(physics.DRIFT_CHARGE_DECAY_RATE, 1.2, "Drift charge decay is off the authored table.");
assert.equal(
  physics.DRIFT_REWARD_MINIMUM_CHARGE,
  0.35,
  "Drift reward minimum is off the authored table.",
);
assert.equal(physics.DRIFT_RELEASE_REWARD, 0.3, "Drift release reward is off the authored table.");
assert.equal(
  physics.BOOST_RESERVE_DRAIN_RATE,
  0.26,
  "Boost drain is off the authored P5 table.",
);
assert.equal(
  physics.BOOST_RESERVE_REGEN_RATE,
  0.045,
  "Passive regen is off the authored P5 table.",
);

function simulateDriftCharge({ seconds, step, intensity, startingCharge = 0 }) {
  const samples = [startingCharge];
  let charge = startingCharge;
  const iterations = Math.round(seconds / step);
  for (let index = 0; index < iterations; index += 1) {
    charge = physics.integrateDriftCharge(charge, intensity, step);
    samples.push(charge);
  }
  return samples;
}

/**
 * Time at which the ramp crosses `target`, taken from the rate the function
 * itself produced on its first step rather than from a hard-coded constant.
 *
 * The naive "first sample at or past the target" answer is step-size dependent
 * — it lands up to one whole frame late, and lands on a different frame at
 * 60 Hz than at 120 Hz — so it cannot be compared against an authored duration
 * to 0.02 s. The crossing is the quantity 60 Hz and 120 Hz actually agree on,
 * and it is only meaningful because `assertLinearRamp` proves the slope is
 * constant, which is also what makes the integrator frame-rate independent.
 */
function rampCrossing(samples, step, target) {
  const rate = (samples[1] - samples[0]) / step;
  for (let index = 1; index < samples.length; index += 1) {
    const reached = rate > 0 ? samples[index] >= target : samples[index] <= target;
    if (reached) return (index - 1) * step + (target - samples[index - 1]) / rate;
  }
  return Number.NaN;
}

function assertLinearRamp(samples, step, label) {
  const rate = (samples[1] - samples[0]) / step;
  for (let index = 2; index < samples.length; index += 1) {
    const delta = samples[index] - samples[index - 1];
    // Stop at the clamp; every step before it must share one slope.
    if (Math.abs(delta) < Math.abs(rate * step) - 1e-12) return rate;
    assert.ok(
      Math.abs(delta - rate * step) < 1e-9,
      `${label} is not linear in delta at sample ${index}.`,
    );
  }
  return rate;
}

const charge120 = simulateDriftCharge({ seconds: 3, step: 1 / 120, intensity: 1 });
const charge60 = simulateDriftCharge({ seconds: 3, step: 1 / 60, intensity: 1 });
const decay120 = simulateDriftCharge({
  seconds: 1.5,
  step: 1 / 120,
  intensity: 0,
  startingCharge: 1,
});
const decay60 = simulateDriftCharge({
  seconds: 1.5,
  step: 1 / 60,
  intensity: 0,
  startingCharge: 1,
});
assertLinearRamp(charge120, 1 / 120, "Drift charge");
assertLinearRamp(decay120, 1 / 120, "Drift charge decay");
const chargeSeconds120 = rampCrossing(charge120, 1 / 120, 1);
const chargeSeconds60 = rampCrossing(charge60, 1 / 60, 1);
const decaySeconds120 = rampCrossing(decay120, 1 / 120, 0);
const decaySeconds60 = rampCrossing(decay60, 1 / 60, 0);

assert.ok(
  Math.abs(chargeSeconds120 - 1.8) <= 0.02,
  `Full drift charge must land within 1.80 s +/- 0.02 s; got ${chargeSeconds120}.`,
);
assert.ok(
  Math.abs(decaySeconds120 - 0.833) <= 0.02,
  `Off-drift decay must clear the bank within 0.833 s +/- 0.02 s; got ${decaySeconds120}.`,
);
assert.ok(
  Math.abs(chargeSeconds120 - chargeSeconds60) < 0.001
    && Math.abs(decaySeconds120 - decaySeconds60) < 0.001,
  "Drift charge timing must remain stable between 60 Hz and 120 Hz.",
);
for (const [label, coarse, fine] of [
  ["Drift charge", charge60, charge120],
  ["Drift charge decay", decay60, decay120],
]) {
  for (let index = 0; index < coarse.length; index += 1) {
    assert.ok(
      Math.abs(coarse[index] - fine[index * 2]) < 0.001,
      `${label} diverged between 60 Hz and 120 Hz at sample ${index}.`,
    );
  }
}
assert.equal(
  charge120[charge120.length - 1],
  physics.DRIFT_CHARGE_CAP,
  "Drift charge must clamp at its single-bank cap.",
);
assert.equal(
  decay120[decay120.length - 1],
  0,
  "Off-drift decay must clamp at zero rather than going negative.",
);
assert.ok(
  simulateDriftCharge({ seconds: 1.8, step: 1 / 120, intensity: 0.5 }).at(-1) < 0.55,
  "Partial drift intensity must charge the bank proportionally.",
);
assert.equal(
  physics.integrateDriftCharge(Number.NaN, Number.NaN, Number.NaN),
  0,
  "Invalid drift-charge state must settle safely at an empty bank.",
);

// Release edge: only on drifting -> not drifting, only at or above the minimum.
assert.equal(
  physics.resolveDriftRelease(1, true, true).reward,
  0,
  "A drift that is still held must not pay out.",
);
assert.equal(
  physics.resolveDriftRelease(1, false, false).reward,
  0,
  "A release edge is required before the bank can pay out.",
);
assert.deepEqual(
  physics.resolveDriftRelease(0.3499, true, false),
  { reward: 0, consumed: false },
  "A release under the minimum charge must pay nothing and consume nothing.",
);
assert.deepEqual(
  physics.resolveDriftRelease(physics.DRIFT_REWARD_MINIMUM_CHARGE, true, false),
  { reward: physics.DRIFT_RELEASE_REWARD, consumed: true },
  "A release at the minimum charge must pay exactly the authored reward.",
);
assert.deepEqual(
  physics.resolveDriftRelease(1, true, false),
  { reward: physics.DRIFT_RELEASE_REWARD, consumed: true },
  "A full bank must pay exactly the authored reward, not a scaled one.",
);
assert.deepEqual(
  physics.resolveDriftRelease(Number.NaN, true, false),
  { reward: 0, consumed: false },
  "An invalid bank must not pay out.",
);

let reserve = 1;
const drainSteps = Math.ceil(120 / physics.BOOST_RESERVE_DRAIN_RATE);
for (let index = 0; index < drainSteps; index += 1) {
  reserve = physics.integrateBoostReserve(reserve, true, 1 / 120);
}
assert.equal(reserve, 0, "Boost reserve must clamp at zero.");
const regenSteps = Math.ceil(120 / physics.BOOST_RESERVE_REGEN_RATE);
for (let index = 0; index < regenSteps; index += 1) {
  reserve = physics.integrateBoostReserve(reserve, false, 1 / 120);
}
assert.equal(reserve, 1, "Boost reserve must recharge and clamp at one.");
assert.ok(
  drainSteps / 120 > 3.5 && drainSteps / 120 < 4,
  "A full reserve must drain in under four seconds of held boost.",
);
assert.ok(
  regenSteps / 120 > 20,
  "Passive regen alone must take over twenty seconds to refill the reserve.",
);
assert.equal(
  physics.integrateBoostReserve(0.95, false, 1 / 120, physics.DRIFT_RELEASE_REWARD),
  1,
  "A drift reward must clamp at a full reserve rather than banking overflow.",
);
assert.equal(
  physics.integrateBoostReserve(0, true, 1 / 120, physics.DRIFT_RELEASE_REWARD),
  physics.DRIFT_RELEASE_REWARD - physics.BOOST_RESERVE_DRAIN_RATE / 120,
  "A reward paid while boosting must land before that step's drain.",
);
assert.equal(
  physics.integrateBoostReserve(Number.NaN, false, Number.NaN, Number.NaN),
  0,
  "Invalid reserve state must settle safely.",
);
assert.ok(
  physics.DRIFT_RELEASE_REWARD / physics.BOOST_RESERVE_REGEN_RATE > 5,
  "One drift reward must be worth more than five seconds of passive regen, or "
    + "the loop is not worth committing to.",
);
assert.equal(
  physics.resolveBoostLockout(true, physics.BOOST_RESERVE_CUTOFF, false),
  true,
  "Depleted boost must enter lockout at its reserve cutoff.",
);
assert.equal(
  physics.resolveBoostLockout(true, 1, true),
  true,
  "Boost lockout must persist while the input remains held.",
);
assert.equal(
  physics.resolveBoostLockout(false, 1, true),
  false,
  "Releasing boost must clear its depletion lockout.",
);

function getSoakControls(elapsed) {
  const phase = elapsed % 24;

  if (phase < 5.5) {
    return { throttle: 1, brake: 0, boostRequested: true, steerTarget: 0, surfaceGrip: 1 };
  }
  if (phase < 7) {
    return { throttle: 0, brake: 1, boostRequested: false, steerTarget: 0, surfaceGrip: 1 };
  }
  if (phase < 8.5) {
    return { throttle: 1, brake: 0, boostRequested: false, steerTarget: 1, surfaceGrip: 1 };
  }
  if (phase < 10) {
    return { throttle: 1, brake: 0, boostRequested: false, steerTarget: -1, surfaceGrip: 1 };
  }
  if (phase < 12) {
    return { throttle: 0.72, brake: 1, boostRequested: false, steerTarget: 1, surfaceGrip: 1 };
  }
  if (phase < 14) {
    return { throttle: 1, brake: 0, boostRequested: false, steerTarget: 0, surfaceGrip: 1 };
  }
  if (phase < 16) {
    return { throttle: 0.85, brake: 0, boostRequested: false, steerTarget: -0.8, surfaceGrip: 0.72 };
  }
  if (phase < 20) {
    return { throttle: 0.9, brake: 0, boostRequested: false, steerTarget: 0.4, surfaceGrip: 1 };
  }
  return { throttle: 1, brake: 0, boostRequested: true, steerTarget: 0, surfaceGrip: 1 };
}

function simulateControlSoak(step) {
  const seconds = 240;
  const iterations = Math.round(seconds / step);
  let speed = 0;
  let reserve = 1;
  let steer = 0;
  let surfaceGrip = 1;
  let driftActive = false;
  let boostLockedUntilRelease = false;
  let distance = 0;
  let boostExhaustions = 0;
  let boostRefills = 0;
  let driftEntries = 0;
  let driftExits = 0;
  let driftCharge = 0;
  let driftRewards = 0;
  let driftRewardTotal = 0;
  let maximumDriftCharge = 0;
  let maximumSpeed = 0;
  let maximumDriftIntent = 0;
  let minimumGripRate = Number.POSITIVE_INFINITY;

  for (let index = 0; index < iterations; index += 1) {
    const elapsed = index * step;
    const controls = getSoakControls(elapsed);
    const previousReserve = reserve;
    const previousDriftActive = driftActive;
    const previousBoostLockout = boostLockedUntilRelease;
    boostLockedUntilRelease = physics.resolveBoostLockout(
      controls.boostRequested,
      reserve,
      boostLockedUntilRelease,
    );
    const boostActive = controls.boostRequested && !boostLockedUntilRelease;

    steer = physics.integrateSteering(steer, controls.steerTarget, step);
    const speedRatio = speed / physics.BOOST_MAX_SPEED;
    const driftIntent = physics.calculateDriftIntent(
      speedRatio,
      controls.brake,
      steer,
    );
    driftActive = physics.resolveDriftActive(driftActive, driftIntent);
    const driftRelease = physics.resolveDriftRelease(
      driftCharge,
      previousDriftActive,
      driftActive,
    );
    if (driftRelease.consumed) {
      driftCharge = 0;
      driftRewards += 1;
      driftRewardTotal += driftRelease.reward;
    }
    driftCharge = physics.integrateDriftCharge(
      driftCharge,
      driftActive ? driftIntent : 0,
      step,
    );
    const turnAuthority = physics.calculateTurnAuthority(speedRatio);
    const turnRate = physics.calculateTurnRate(speedRatio, driftIntent);
    surfaceGrip = physics.integrateSurfaceGrip(
      surfaceGrip,
      controls.surfaceGrip,
      0.8,
      step,
    );
    const gripRate = physics.calculateGripRate(
      speedRatio,
      driftIntent,
      surfaceGrip,
      controls.brake,
      steer,
    );

    speed = physics.integrateSpeed(
      speed,
      controls.throttle,
      controls.brake,
      boostActive,
      driftIntent,
      step,
    );
    reserve = physics.integrateBoostReserve(
      reserve,
      boostActive,
      step,
      driftRelease.reward,
    );
    distance += speed * step;

    const finiteValues = [
      speed,
      reserve,
      steer,
      driftIntent,
      turnAuthority,
      turnRate,
      surfaceGrip,
      gripRate,
      distance,
      driftCharge,
    ];
    assert.ok(
      finiteValues.every(Number.isFinite),
      `Physics soak produced a non-finite state at ${elapsed.toFixed(3)} seconds.`,
    );
    assert.ok(speed >= 0 && speed <= physics.BOOST_MAX_SPEED, "Soak speed escaped its bounds.");
    assert.ok(reserve >= 0 && reserve <= 1, "Soak boost reserve escaped its bounds.");
    assert.ok(steer >= -1 && steer <= 1, "Soak steering escaped its bounds.");
    assert.ok(driftIntent >= 0 && driftIntent <= 1, "Soak drift intent escaped its bounds.");
    assert.ok(turnAuthority >= 0.32 && turnAuthority <= 1, "Soak turn authority escaped its bounds.");
    assert.ok(turnRate > 0 && turnRate < 3, "Soak turn rate escaped its arcade handling window.");
    assert.ok(surfaceGrip >= 0.2 && surfaceGrip <= 1, "Soak surface grip escaped its bounds.");
    assert.ok(gripRate > 0 && gripRate < 10, "Soak grip rate escaped its handling window.");
    assert.ok(driftCharge >= 0 && driftCharge <= 1, "Soak drift charge escaped its bounds.");

    if (!previousBoostLockout && boostLockedUntilRelease) boostExhaustions += 1;
    // Passive regen alone no longer refills a drained reserve inside one soak
    // cycle, which is the point of the P5 economy. What still has to happen is
    // that a drained reserve comes back to a usable half tank.
    if (previousReserve < 0.5 && reserve >= 0.5) boostRefills += 1;
    if (!previousDriftActive && driftActive) driftEntries += 1;
    if (previousDriftActive && !driftActive) driftExits += 1;

    maximumSpeed = Math.max(maximumSpeed, speed);
    maximumDriftCharge = Math.max(maximumDriftCharge, driftCharge);
    maximumDriftIntent = Math.max(maximumDriftIntent, driftIntent);
    minimumGripRate = Math.min(minimumGripRate, gripRate);
  }

  return {
    speed,
    reserve,
    steer,
    surfaceGrip,
    driftActive,
    distance,
    boostExhaustions,
    boostRefills,
    driftEntries,
    driftExits,
    driftCharge,
    driftRewards,
    driftRewardTotal,
    maximumDriftCharge,
    maximumSpeed,
    maximumDriftIntent,
    minimumGripRate,
  };
}

const soak120 = simulateControlSoak(1 / 120);
const soak60 = simulateControlSoak(1 / 60);

assert.ok(soak120.boostExhaustions >= 10, "The soak must repeatedly exhaust boost.");
assert.ok(soak120.boostRefills >= 9, "The soak must repeatedly restore a usable reserve.");
assert.ok(soak120.driftEntries >= 10, "The soak must repeatedly enter drift.");
assert.ok(soak120.driftExits >= 10, "The soak must repeatedly exit drift.");
assert.ok(soak120.maximumSpeed > 100, "The soak must exercise the boosted speed range.");
assert.ok(soak120.maximumDriftIntent > 0.5, "The soak must exercise strong drift intent.");
assert.ok(soak120.minimumGripRate < 2, "The soak must exercise reduced-grip handling.");
assert.equal(
  soak120.driftActive,
  false,
  "The soak must finish outside drift rather than leaving feedback latched.",
);
assert.equal(
  soak120.boostExhaustions,
  soak60.boostExhaustions,
  "Boost exhaustion count must agree at 60 Hz and 120 Hz.",
);
assert.equal(
  soak120.boostRefills,
  soak60.boostRefills,
  "Boost refill count must agree at 60 Hz and 120 Hz.",
);
assert.equal(
  soak120.driftEntries,
  soak60.driftEntries,
  "Drift entry count must agree at 60 Hz and 120 Hz.",
);
assert.equal(
  soak120.driftExits,
  soak60.driftExits,
  "Drift exit count must agree at 60 Hz and 120 Hz.",
);
assert.ok(
  Math.abs(soak120.speed - soak60.speed) < 0.25,
  "Final soak speed must remain stable between 60 Hz and 120 Hz.",
);
assert.ok(
  Math.abs(soak120.reserve - soak60.reserve) < 0.005,
  "Final boost reserve must remain stable between 60 Hz and 120 Hz.",
);
assert.ok(
  Math.abs(soak120.steer - soak60.steer) < 0.01,
  "Final steering state must remain stable between 60 Hz and 120 Hz.",
);
assert.ok(
  Math.abs(soak120.surfaceGrip - soak60.surfaceGrip) < 0.001,
  "Final surface-grip state must remain stable between 60 Hz and 120 Hz.",
);
assert.ok(
  Math.abs(soak120.distance - soak60.distance) / soak120.distance < 0.002,
  "Soak distance must remain within 0.2% between 60 Hz and 120 Hz.",
);

/*
 * The mixed-control soak above enters drift often but never holds one long
 * enough to bank a reward — measured max charge there is 0.04 of 1.0. That is a
 * fair reading of how that control script drives, but it means it proves
 * nothing about the payout path, so the drift economy gets its own soak whose
 * script actually commits to corners and releases them.
 */
function getDriftSoakControls(elapsed) {
  const phase = elapsed % 12;
  if (phase < 3.5) return { throttle: 1, brake: 0, boostRequested: true, steerTarget: 0 };
  if (phase < 6) return { throttle: 1, brake: 0.5, boostRequested: false, steerTarget: 1 };
  if (phase < 7) return { throttle: 1, brake: 0, boostRequested: false, steerTarget: 0 };
  if (phase < 9) return { throttle: 1, brake: 0.42, boostRequested: false, steerTarget: -1 };
  if (phase < 10) return { throttle: 1, brake: 0, boostRequested: false, steerTarget: 0 };
  return { throttle: 1, brake: 0, boostRequested: true, steerTarget: 0 };
}

function simulateDriftEconomySoak(step) {
  const iterations = Math.round(240 / step);
  let speed = 0;
  let reserve = 1;
  let steer = 0;
  let driftActive = false;
  let driftCharge = 0;
  let boostLockedUntilRelease = false;
  let driftEntries = 0;
  let driftRewards = 0;
  let driftRewardTotal = 0;
  let driftSeconds = 0;
  let boostSeconds = 0;
  let maximumDriftCharge = 0;
  let minimumReserve = 1;

  for (let index = 0; index < iterations; index += 1) {
    const elapsed = index * step;
    const controls = getDriftSoakControls(elapsed);
    const previousDriftActive = driftActive;
    boostLockedUntilRelease = physics.resolveBoostLockout(
      controls.boostRequested,
      reserve,
      boostLockedUntilRelease,
    );
    const boostActive = controls.boostRequested && !boostLockedUntilRelease;

    steer = physics.integrateSteering(steer, controls.steerTarget, step);
    const speedRatio = speed / physics.BOOST_MAX_SPEED;
    const driftIntent = physics.calculateDriftIntent(speedRatio, controls.brake, steer);
    driftActive = physics.resolveDriftActive(driftActive, driftIntent);
    if (driftActive && !previousDriftActive) driftEntries += 1;

    const release = physics.resolveDriftRelease(
      driftCharge,
      previousDriftActive,
      driftActive,
    );
    if (release.consumed) {
      driftCharge = 0;
      driftRewards += 1;
      driftRewardTotal += release.reward;
    }
    driftCharge = physics.integrateDriftCharge(
      driftCharge,
      driftActive ? driftIntent : 0,
      step,
    );

    speed = physics.integrateSpeed(
      speed,
      controls.throttle,
      controls.brake,
      boostActive,
      driftIntent,
      step,
    );
    reserve = physics.integrateBoostReserve(reserve, boostActive, step, release.reward);

    assert.ok(
      Number.isFinite(reserve) && Number.isFinite(driftCharge) && Number.isFinite(speed),
      `Drift economy soak produced a non-finite state at ${elapsed.toFixed(3)} seconds.`,
    );
    assert.ok(
      reserve >= 0 && reserve <= 1,
      `Drift economy soak reserve escaped [0, 1] at ${elapsed.toFixed(3)} seconds: ${reserve}.`,
    );
    assert.ok(
      driftCharge >= 0 && driftCharge <= physics.DRIFT_CHARGE_CAP,
      `Drift economy soak charge escaped its bank at ${elapsed.toFixed(3)} seconds.`,
    );

    if (driftActive) driftSeconds += step;
    if (boostActive) boostSeconds += step;
    maximumDriftCharge = Math.max(maximumDriftCharge, driftCharge);
    minimumReserve = Math.min(minimumReserve, reserve);
  }

  return {
    reserve,
    driftCharge,
    driftEntries,
    driftRewards,
    driftRewardTotal,
    driftSeconds,
    boostSeconds,
    maximumDriftCharge,
    minimumReserve,
  };
}

const driftSoak120 = simulateDriftEconomySoak(1 / 120);
const driftSoak60 = simulateDriftEconomySoak(1 / 60);

/*
 * Measured, not guessed: this script yields exactly 40 drift entries and 20
 * payouts at both 1/120 and 1/60. The long window banks past the minimum and
 * the short one deliberately does not, so the soak covers both release
 * branches. The bound is the measured count less a margin, not a round number.
 */
assert.ok(
  driftSoak120.driftRewards >= 18,
  `A committed 240 s drift script must repeatedly cash the bank in; got ${driftSoak120.driftRewards}.`,
);
assert.ok(
  driftSoak120.driftRewards < driftSoak120.driftEntries,
  "The soak must also exercise releases that bank too little to pay out.",
);
assert.ok(
  driftSoak120.minimumReserve < 0.05,
  `The P5 economy must make the reserve genuinely scarce under this script; the `
    + `low-water mark was ${driftSoak120.minimumReserve}.`,
);
assert.equal(
  driftSoak120.driftRewards,
  driftSoak60.driftRewards,
  "Drift reward count must agree at 60 Hz and 120 Hz.",
);
assert.ok(
  Math.abs(driftSoak120.driftRewardTotal - driftSoak60.driftRewardTotal) < 0.001,
  "Total drift payout must agree at 60 Hz and 120 Hz.",
);
assert.ok(
  Math.abs(driftSoak120.reserve - driftSoak60.reserve) < 0.005,
  "Final reserve under the drift economy must agree at 60 Hz and 120 Hz.",
);
assert.ok(
  driftSoak120.maximumDriftCharge > 0.35 && driftSoak120.maximumDriftCharge <= 1,
  "The drift script must bank past the reward minimum without exceeding one bank.",
);
assert.ok(
  Math.abs(
    driftSoak120.driftRewardTotal
      - driftSoak120.driftRewards * physics.DRIFT_RELEASE_REWARD,
  ) < 1e-9,
  "Every payout must be exactly the authored reward, never a scaled one.",
);

/*
 * Anti-farming, stated as the boundary rather than as a vibe: a stab of brake
 * and steer short of the minimum pays nothing however many times it is
 * repeated, and the same loop one step over the minimum pays every time.
 */
function simulateDriftFarming(driftSeconds, repeats, step) {
  const driftIterations = Math.round(driftSeconds / step);
  const gapIterations = Math.round(0.5 / step);
  let charge = 0;
  let rewards = 0;
  let wasDrifting = false;
  for (let cycle = 0; cycle < repeats; cycle += 1) {
    for (const [drifting, iterations] of [[true, driftIterations], [false, gapIterations]]) {
      for (let index = 0; index < iterations; index += 1) {
        const release = physics.resolveDriftRelease(charge, wasDrifting, drifting);
        if (release.consumed) {
          charge = 0;
          rewards += 1;
        }
        charge = physics.integrateDriftCharge(charge, drifting ? 1 : 0, step);
        wasDrifting = drifting;
      }
    }
  }
  return rewards;
}

const farmedTwitches = simulateDriftFarming(0.6, 200, 1 / 120);
const farmedCommitments = simulateDriftFarming(0.7, 200, 1 / 120);
assert.equal(
  farmedTwitches,
  0,
  "200 sub-minimum drift stabs must pay nothing; the reward is for commitment.",
);
assert.equal(
  farmedCommitments,
  200,
  "A drift held past the minimum must pay every time, not intermittently.",
);

console.log(
  `Physics PASS: cruise ${(cruise120 * 3.6).toFixed(1)} km/h, boost ${(boosted * 3.6).toFixed(1)} km/h, post-boost ${(releasedBoostHalfSecond * 3.6).toFixed(1)}→${(releasedBoostTwoSeconds120 * 3.6).toFixed(1)} km/h, finish run-out ${coast120.distance.toFixed(1)} m / ${(3.5).toFixed(1)} s settled, wet grip ${wetGrip120.toFixed(3)}→${recoveredGrip120.toFixed(3)}, 60/120 Hz speed drift ${Math.abs(cruise120 - cruise60).toFixed(3)} m/s, steering drift ${Math.abs(steering120 - steering60).toFixed(4)}, 240 s soak ${soak120.boostExhaustions} boost exhaustions / ${soak120.driftEntries} drift entries / ${(Math.abs(soak120.distance - soak60.distance) / soak120.distance * 100).toFixed(3)}% distance drift, drift bank ${chargeSeconds120.toFixed(3)} s to full / ${decaySeconds120.toFixed(3)} s to empty, 240 s drift economy ${driftSoak120.driftEntries} entries / ${driftSoak120.driftRewards} rewards (+${driftSoak120.driftRewardTotal.toFixed(2)} reserve), reserve low-water ${driftSoak120.minimumReserve.toFixed(3)}.`,
);
