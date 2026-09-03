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
  slipstream = 0,
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
      slipstream,
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

// ---------------------------------------------------------------------------
// G1 slipstream
// ---------------------------------------------------------------------------

// Shape, at the four corners of the authored window.
assert.equal(
  physics.calculateSlipstream(10, 0.5, 0.9),
  1,
  "Squarely in the wake and on the line must be a full tow.",
);
assert.equal(
  physics.calculateSlipstream(30, 0, 0.9),
  0,
  "Past SLIPSTREAM_FADE_METERS there is no tow at all.",
);
assert.equal(
  physics.calculateSlipstream(10, 3, 0.9),
  0,
  "Past SLIPSTREAM_LATERAL_FADE_METERS off the line there is no tow at all.",
);
assert.equal(
  physics.calculateSlipstream(10, 0, 0.3),
  0,
  "Below SLIPSTREAM_MINIMUM_SPEED_RATIO a crawling craft gets no tow.",
);

// Boundaries and monotonicity: the window has to be continuous, or the HUD chip
// and the drag term would both flicker on the edge of it.
assert.equal(physics.calculateSlipstream(0, 0, 0.9), 0);
assert.equal(physics.calculateSlipstream(physics.SLIPSTREAM_NEAR_METERS, 0, 0.9), 1);
assert.equal(physics.calculateSlipstream(physics.SLIPSTREAM_FULL_METERS, 0, 0.9), 1);
assert.equal(physics.calculateSlipstream(physics.SLIPSTREAM_FADE_METERS, 0, 0.9), 0);
assert.equal(
  physics.calculateSlipstream(10, physics.SLIPSTREAM_LATERAL_FULL_METERS, 0.9),
  1,
);
assert.equal(
  physics.calculateSlipstream(10, physics.SLIPSTREAM_LATERAL_FADE_METERS, 0.9),
  0,
);
assert.equal(
  physics.calculateSlipstream(10, -0.5, 0.9),
  physics.calculateSlipstream(10, 0.5, 0.9),
  "The lateral window must be symmetric about the rival's line.",
);
assert.equal(
  physics.calculateSlipstream(physics.SLIPSTREAM_MINIMUM_SPEED_RATIO * 0 + 10, 0, physics.SLIPSTREAM_MINIMUM_SPEED_RATIO),
  0,
  "The speed gate opens AT the minimum ratio, not below it.",
);
// Never NaN, never out of range, whatever it is handed.
for (const [distance, lateral, ratio] of [
  [Number.NaN, 0, 0.9],
  [10, Number.NaN, 0.9],
  [10, 0, Number.NaN],
  [-10, 0, 0.9],
  [Infinity, 0, 0.9],
]) {
  const value = physics.calculateSlipstream(distance, lateral, ratio);
  assert.ok(
    Number.isFinite(value) && value >= 0 && value <= 1,
    `calculateSlipstream(${distance}, ${lateral}, ${ratio}) returned ${value}.`,
  );
}
let previousTow = 1;
for (let distance = physics.SLIPSTREAM_FULL_METERS; distance <= physics.SLIPSTREAM_FADE_METERS; distance += 0.5) {
  const tow = physics.calculateSlipstream(distance, 0, 0.9);
  assert.ok(tow <= previousTow + 1e-12, "The tow must fall off monotonically.");
  previousTow = tow;
}

/**
 * What the tow is worth, measured rather than asserted from the constant.
 *
 * `SLIPSTREAM_CRUISE_BONUS` lifts the cruise CAP by 6% - the knee where
 * overspeed drag starts, 86 -> 91.16 m/s - which is not the same thing as a 6%
 * higher top speed. Both numbers are pinned so a later edit to the drag model
 * cannot quietly change what a draft is worth while the constant still reads
 * 0.06. CRUISE_MAX_SPEED and BOOST_MAX_SPEED themselves are untouched: the tow
 * is a bonus over the authored cruise, never a change to it.
 */
const towedCruise120 = simulateSpeed({
  seconds: 60,
  step: 1 / 120,
  throttle: 1,
  brake: 0,
  boostActive: false,
  slipstream: 1,
});
const towedCruise60 = simulateSpeed({
  seconds: 60,
  step: 1 / 60,
  throttle: 1,
  brake: 0,
  boostActive: false,
  slipstream: 1,
});
const plainCruise60s = simulateSpeed({
  seconds: 60,
  step: 1 / 120,
  throttle: 1,
  brake: 0,
  boostActive: false,
});
assert.equal(physics.CRUISE_MAX_SPEED, 86, "The authored cruise cap must not move.");
assert.equal(physics.BOOST_MAX_SPEED, 112, "The authored boost cap must not move.");
assert.equal(
  Number((physics.CRUISE_MAX_SPEED * (1 + physics.SLIPSTREAM_CRUISE_BONUS)).toFixed(2)),
  91.16,
  "Full tow must lift the effective cruise cap 86 -> 91.16 m/s.",
);
assert.equal(
  Number(plainCruise60s.toFixed(2)),
  91.79,
  "Terminal cruise with no tow moved; re-pin only with a deliberate drag change.",
);
assert.equal(
  Number(towedCruise120.toFixed(2)),
  95.85,
  "Terminal cruise at full tow moved; re-pin only with a deliberate drag change.",
);
assert.ok(
  towedCruise120 > plainCruise60s,
  "A full tow must be worth speed.",
);
assert.ok(
  Math.abs(towedCruise120 - towedCruise60) < 0.001,
  `Towed cruise drifts ${Math.abs(towedCruise120 - towedCruise60).toFixed(5)} m/s `
    + "between 60 Hz and 120 Hz.",
);
assert.equal(
  simulateSpeed({
    seconds: 60,
    step: 1 / 120,
    throttle: 1,
    brake: 0,
    boostActive: false,
    slipstream: 0,
  }),
  plainCruise60s,
  "Zero tow must be byte-identical to the pre-G1 integrator.",
);

// The reserve half of the tow: regen doubles, drain is untouched.
const regenNoTow = physics.integrateBoostReserve(0, false, 1, 0, 0);
const regenFullTow = physics.integrateBoostReserve(0, false, 1, 0, 1);
assert.equal(regenNoTow, physics.BOOST_RESERVE_REGEN_RATE);
assert.equal(
  Number(regenFullTow.toFixed(6)),
  Number((physics.BOOST_RESERVE_REGEN_RATE * 2).toFixed(6)),
  "A full tow must double reserve regen.",
);
assert.equal(
  physics.integrateBoostReserve(1, true, 1, 0, 1),
  physics.integrateBoostReserve(1, true, 1, 0, 0),
  "A tow must not change the drain rate; drafting is not free boost.",
);
let towedReserve120 = 0;
let towedReserve60 = 0;
for (let index = 0; index < 120 * 6; index += 1) {
  towedReserve120 = physics.integrateBoostReserve(towedReserve120, false, 1 / 120, 0, 0.6);
}
for (let index = 0; index < 60 * 6; index += 1) {
  towedReserve60 = physics.integrateBoostReserve(towedReserve60, false, 1 / 60, 0, 0.6);
}
assert.ok(
  Math.abs(towedReserve120 - towedReserve60) < 0.001,
  `Towed reserve drifts ${Math.abs(towedReserve120 - towedReserve60).toFixed(6)} `
    + "between 60 Hz and 120 Hz.",
);

// ---------------------------------------------------------------------------
// G2 — the air cushion.
//
// The cushion is the one thing standing between "no player collision" and two
// hulls drawn through one another, so its shape is pinned rather than trusted:
// where it is zero, where it peaks, that it never points the wrong way, that it
// cannot exceed its stated ceilings, and that it integrates the same at 60 Hz
// and 120 Hz.
// ---------------------------------------------------------------------------

// 1. The envelope. Zero outside 2.4 m laterally or 5.5 m longitudinally, in
//    both signs, and zero on the boundary itself rather than one epsilon
//    inside it.
for (const longitudinal of [-8, -7, 0, 7, 8, 40]) {
  for (const lateral of [-4, -3.4, 3.4, 4]) {
    const outside = physics.calculateCushion(lateral, longitudinal, 0);
    assert.equal(
      outside.lateralPush,
      0,
      `Cushion pushed ${outside.lateralPush} at lateral ${lateral} m / `
        + `longitudinal ${longitudinal} m, outside its own envelope.`,
    );
    assert.equal(outside.speedScrub, 0);
  }
}
assert.equal(
  physics.calculateCushion(3.4, 0, 0).lateralPush,
  0,
  "The lateral range is exclusive: exactly at CUSHION_LATERAL_RANGE_METERS the "
    + "cushion must already be off, or the push jumps at the boundary.",
);
assert.equal(physics.calculateCushion(0, 7, 0).lateralPush, 0);
assert.ok(
  Math.abs(physics.calculateCushion(3.39, 0, 0).lateralPush) < 0.02,
  "The cushion must arrive smoothly, not step on at the range boundary.",
);

// 2. The peak. Full CUSHION_PEAK_PUSH_MPS2 first reached at
//    CUSHION_LATERAL_PEAK_METERS and HELD from there down to zero gap - a
//    cushion that softened as the hulls converged would let them converge.
assert.equal(
  Math.abs(physics.calculateCushion(physics.CUSHION_LATERAL_PEAK_METERS, 0, 0).lateralPush),
  physics.CUSHION_PEAK_PUSH_MPS2,
  `The cushion must reach its ${physics.CUSHION_PEAK_PUSH_MPS2} m/s^2 peak at `
    + `${physics.CUSHION_LATERAL_PEAK_METERS} m.`,
);
for (const lateral of [0, 0.2, 0.7, 1.39, 1.4]) {
  assert.equal(
    Math.abs(physics.calculateCushion(lateral, 0, 0).lateralPush),
    physics.CUSHION_PEAK_PUSH_MPS2,
    `The cushion softened to ${physics.calculateCushion(lateral, 0, 0).lateralPush} `
      + `at a ${lateral} m gap; inside the peak it must plateau, not fall away.`,
  );
}
// Monotone: closing the gap can never reduce the push.
let previousPush = 0;
for (let lateral = 3.4; lateral >= 0; lateral -= 0.05) {
  const push = Math.abs(physics.calculateCushion(lateral, 0, 0).lateralPush);
  assert.ok(
    push >= previousPush - 1e-12,
    `Cushion push fell from ${previousPush} to ${push} as the gap closed to `
      + `${lateral.toFixed(2)} m.`,
  );
  previousPush = push;
}

// 3. Direction. The push is ALWAYS away from the rival, over the whole
//    envelope and at every closing speed. A cushion that pointed inward
//    anywhere would be a magnet, and it would be invisible in a lap time.
for (let lateral = -3.35; lateral <= 3.35; lateral += 0.05) {
  for (const longitudinal of [-6, -3, 0, 3, 6]) {
    for (const closing of [-4, 0, 1.5, 9]) {
      const { lateralPush } = physics.calculateCushion(lateral, longitudinal, closing);
      if (lateralPush === 0) continue;
      assert.ok(
        lateral >= 0 ? lateralPush < 0 : lateralPush > 0,
        `Cushion pushed INTO the rival: gap ${lateral.toFixed(2)} m, push `
          + `${lateralPush.toFixed(3)} m/s^2.`,
      );
      assert.ok(
        Math.abs(lateralPush) <= physics.CUSHION_PEAK_PUSH_MPS2 + 1e-9,
        `Cushion exceeded its ${physics.CUSHION_PEAK_PUSH_MPS2} m/s^2 ceiling at `
          + `closing speed ${closing} m/s: ${lateralPush.toFixed(3)}.`,
      );
      assert.ok(Number.isFinite(lateralPush));
    }
  }
}
// Two craft on exactly the same line still separate. `Math.sign(0)` is 0, so
// the naive spelling of this leaves them welded together.
assert.ok(
  physics.calculateCushion(0, 0, 0).lateralPush !== 0,
  "A zero lateral gap must still resolve to a push, or two craft on identical "
    + "lines sit inside one another forever.",
);

// 4. The closing term brings the peak SOONER, never higher.
const lazy = physics.calculateCushion(2.4, 0, 0).lateralPush;
const diving = physics.calculateCushion(2.4, 0, 3).lateralPush;
assert.ok(
  Math.abs(diving) > Math.abs(lazy),
  "A craft diving across must meet the cushion sooner than one drifting in.",
);
assert.equal(
  physics.calculateCushion(1.4, 0, 9).lateralPush,
  physics.calculateCushion(1.4, 0, 0).lateralPush,
  "At the peak the closing term must have nothing left to add; the cushion is "
    + "a lean, and its ceiling does not move with how hard it was hit.",
);

// 5. The scrub ceiling. At most CUSHION_MAX_SCRUB_PER_SECOND of current speed
//    per second, and never a function of the closing speed.
let peakScrub = 0;
for (let lateral = -3.4; lateral <= 3.4; lateral += 0.05) {
  for (const longitudinal of [-7, -4, 0, 4, 7]) {
    for (const closing of [0, 3, 20]) {
      const { speedScrub } = physics.calculateCushion(lateral, longitudinal, closing);
      assert.ok(speedScrub >= 0 && Number.isFinite(speedScrub));
      peakScrub = Math.max(peakScrub, speedScrub);
    }
  }
}
assert.equal(
  peakScrub,
  physics.CUSHION_MAX_SCRUB_PER_SECOND,
  `Cushion scrub peaked at ${peakScrub} against a stated ceiling of `
    + `${physics.CUSHION_MAX_SCRUB_PER_SECOND} per second.`,
);
assert.equal(
  physics.calculateCushion(2.2, 0, 0).speedScrub,
  physics.calculateCushion(2.2, 0, 12).speedScrub,
  "The scrub must read geometry only: leaning on a rival costs the same "
    + "whether the player arrived there fast or drifted in.",
);
// A full second of the worst possible overlap, at boost speed, must cost less
// than 2% of that speed. This is the "no speed loss above the stated scrub"
// half of the phase's no-collision promise, in metres per second.
const scrubbedOverASecond = physics.BOOST_MAX_SPEED
  * physics.CUSHION_MAX_SCRUB_PER_SECOND;
assert.ok(
  scrubbedOverASecond <= physics.BOOST_MAX_SPEED * 0.02,
  "The cushion scrub must stay inside 2% of current speed per second.",
);

// 6. NaN in, zero out — every field, in both arguments.
for (const bad of [NaN, Infinity, -Infinity, undefined, null, "x"]) {
  const a = physics.calculateCushion(bad, 0, 0);
  const b = physics.calculateCushion(0.5, bad, 0);
  const c = physics.calculateCushion(0.5, 0, bad);
  for (const result of [a, b, c]) {
    assert.ok(
      Number.isFinite(result.lateralPush) && Number.isFinite(result.speedScrub),
      `Cushion produced a non-finite result from ${String(bad)}.`,
    );
  }
  assert.equal(a.lateralPush, 0);
  assert.equal(b.lateralPush, 0);
  // A bad closing speed must not disarm the cushion; it falls back to "not
  // closing", which is the conservative reading.
  assert.ok(c.lateralPush !== 0);
}

// 7. The two regimes, and rate independence across both.
//
//    Round 2 split the integrator: a pressure field accelerates without drag
//    while the hulls are fouling, and the velocity decays only once clear. Both
//    halves are pinned, because the whole feature is the difference between
//    them - round 1 damped the push while it was still needed and measured
//    0.489 m of travel over five laps for it.
function cushionVelocityAfter(seconds, step, push) {
  let velocity = 0;
  for (let index = 0; index < Math.round(seconds / step); index += 1) {
    velocity = physics.integrateCushionVelocity(velocity, push, step);
  }
  return velocity;
}
const cushionVelocity120 = cushionVelocityAfter(2, 1 / 120, physics.CUSHION_PEAK_PUSH_MPS2);
const cushionVelocity60 = cushionVelocityAfter(2, 1 / 60, physics.CUSHION_PEAK_PUSH_MPS2);
assert.ok(
  Math.abs(cushionVelocity120 - cushionVelocity60) < 0.001,
  `Cushion velocity drifts ${Math.abs(cushionVelocity120 - cushionVelocity60).toFixed(6)} `
    + "m/s between 60 Hz and 120 Hz.",
);
// The cap, not the damping, is what bounds the lean.
assert.equal(
  cushionVelocity120,
  physics.CUSHION_VELOCITY_CAP_MPS,
  `A held peak push settles at ${cushionVelocity120} m/s against the `
    + `${physics.CUSHION_VELOCITY_CAP_MPS} m/s cap.`,
);
assert.ok(
  cushionVelocityAfter(20, 1 / 120, physics.CUSHION_PEAK_PUSH_MPS2)
    <= physics.CUSHION_VELOCITY_CAP_MPS + 1e-12,
  "A long contact must not accumulate lateral speed past the cap; that is a "
    + "shove, and the phase asked for a lean.",
);
// Reaching the cap must take long enough to read as a push rather than a kick.
const capSeconds = physics.CUSHION_VELOCITY_CAP_MPS / physics.CUSHION_PEAK_PUSH_MPS2;
assert.ok(
  capSeconds > 0.15 && capSeconds < 0.6,
  `The cushion reaches its velocity cap in ${capSeconds.toFixed(3)} s; under `
    + "0.15 s that is a kick and over 0.6 s it is back to being too slow to "
    + "clear a hull.",
);
// ... and releasing it must bleed off on the authored time constant.
let releasing = physics.CUSHION_VELOCITY_CAP_MPS;
const tau = physics.CUSHION_VELOCITY_TIME_CONSTANT_SECONDS;
for (let index = 0; index < Math.round(tau * 120); index += 1) {
  releasing = physics.integrateCushionVelocity(releasing, 0, 1 / 120);
}
assert.ok(
  Math.abs(releasing - physics.CUSHION_VELOCITY_CAP_MPS / Math.E) < 0.02,
  `One time constant after release the lean is ${releasing.toFixed(3)} m/s; a `
    + `${tau} s exponential should leave `
    + `${(physics.CUSHION_VELOCITY_CAP_MPS / Math.E).toFixed(3)}.`,
);
let released60 = physics.CUSHION_VELOCITY_CAP_MPS;
for (let index = 0; index < Math.round(tau * 60); index += 1) {
  released60 = physics.integrateCushionVelocity(released60, 0, 1 / 60);
}
assert.ok(
  Math.abs(releasing - released60) < 0.001,
  "The release is not rate independent.",
);

// 7b. THE ROUND 2 ACCEPTANCE SCENARIO, as a test rather than as a soak.
//
//     Two hulls overlapping by 1.2 m (a 1.0 m centre gap against a ~2.2 m hull
//     width) with the player still closing at 1.5 m/s. The cushion has to
//     reverse that closure and carry the pair clear of touching - 2.2 m centre
//     to centre - inside 0.6 s, and it must never once accelerate the player
//     toward the rival on the way.
//
//     This is the test round 1 could not have passed: its envelope reached
//     6 m/s^2 through a damped integrator and took 0.83 s just to undo the
//     closure.
const CLEARANCE_SCENARIO = {
  startGapMeters: 1,
  closingMetersPerSecond: 1.5,
  clearMeters: 2.2,
  deadlineSeconds: 0.6,
};
function runClearanceScenario(step) {
  let gap = CLEARANCE_SCENARIO.startGapMeters;
  // Seeded with the closure: the craft is already moving INTO the rival, and
  // the cushion's job is to turn that around.
  let velocity = -CLEARANCE_SCENARIO.closingMetersPerSecond;
  let clearedAt = null;
  let minimumGap = gap;
  let acceleratedInward = false;
  for (let index = 0; index < Math.round(1.5 / step); index += 1) {
    const { lateralPush } = physics.calculateCushion(
      gap,
      0,
      Math.max(0, -velocity),
    );
    // `calculateCushion` signs its push away from a rival at +gap; this
    // scenario holds the rival at +gap, so the separating direction is the
    // magnitude. A push that ever pointed the other way is caught here as well
    // as by the envelope sweep above.
    if (lateralPush > 0) acceleratedInward = true;
    velocity = physics.integrateCushionVelocity(velocity, Math.abs(lateralPush), step);
    gap += velocity * step;
    minimumGap = Math.min(minimumGap, gap);
    if (clearedAt === null && gap >= CLEARANCE_SCENARIO.clearMeters) {
      clearedAt = (index + 1) * step;
    }
  }
  return { clearedAt, minimumGap, acceleratedInward };
}
const clearance120 = runClearanceScenario(1 / 120);
const clearance60 = runClearanceScenario(1 / 60);
assert.ok(
  clearance120.clearedAt !== null
    && clearance120.clearedAt <= CLEARANCE_SCENARIO.deadlineSeconds,
  `From a ${CLEARANCE_SCENARIO.startGapMeters} m gap closing at `
    + `${CLEARANCE_SCENARIO.closingMetersPerSecond} m/s the cushion took `
    + `${clearance120.clearedAt === null ? "forever" : clearance120.clearedAt.toFixed(3)} s `
    + `to reach ${CLEARANCE_SCENARIO.clearMeters} m, against a `
    + `${CLEARANCE_SCENARIO.deadlineSeconds} s deadline.`,
);
assert.ok(
  !clearance120.acceleratedInward,
  "The cushion accelerated the player INTO the rival during the clearance "
    + "scenario.",
);
assert.ok(
  clearance120.minimumGap >= CLEARANCE_SCENARIO.startGapMeters - 0.15,
  `The cushion let the pair close a further `
    + `${(CLEARANCE_SCENARIO.startGapMeters - clearance120.minimumGap).toFixed(3)} m `
    + "before it took hold. Over 0.15 m and the hulls are inside one another "
    + "for long enough to read as a collision.",
);
assert.ok(
  Math.abs((clearance120.clearedAt ?? 0) - (clearance60.clearedAt ?? 0)) <= 1 / 60 + 1e-9,
  "The clearance scenario is not rate independent.",
);

// 8. The clean-gate chain reaches the passive regen and NOTHING else. Same
//    discipline the slipstream regen bonus is held to.
assert.equal(
  physics.integrateBoostReserve(0, false, 1, 0, 0, 1),
  physics.BOOST_RESERVE_REGEN_RATE,
  "A chain of one must leave passive regen exactly where it was.",
);
assert.equal(
  Number(physics.integrateBoostReserve(0, false, 1, 0, 0, 1.5).toFixed(6)),
  Number((physics.BOOST_RESERVE_REGEN_RATE * 1.5).toFixed(6)),
  "The capped chain must multiply passive regen by 1.5.",
);
assert.equal(
  physics.integrateBoostReserve(1, true, 1, 0, 0, 1.5),
  physics.integrateBoostReserve(1, true, 1, 0, 0, 1),
  "The chain must not change the DRAIN rate; a tidy lap is not longer boost.",
);
assert.equal(
  physics.integrateBoostReserve(0, false, 1, 0, 0),
  physics.integrateBoostReserve(0, false, 1, 0, 0, 1),
  "The chain multiplier must default to 1, so every existing caller is unmoved.",
);

console.log(
  `Cushion PASS: zero outside ${physics.CUSHION_LATERAL_RANGE_METERS} m lateral / `
    + `${physics.CUSHION_LONGITUDINAL_RANGE_METERS} m longitudinal, peak `
    + `${physics.CUSHION_PEAK_PUSH_MPS2} m/s^2 from `
    + `${physics.CUSHION_LATERAL_PEAK_METERS} m inward, monotone, never inward-`
    + `pointing over the whole envelope, scrub ceiling `
    + `${(physics.CUSHION_MAX_SCRUB_PER_SECOND * 100).toFixed(1)}%/s `
    + `(${scrubbedOverASecond.toFixed(2)} m/s at boost speed), lean capped at `
    + `${cushionVelocity120.toFixed(2)} m/s reached in ${capSeconds.toFixed(2)} s and `
    + `bled on a ${tau} s constant, 60/120 Hz drift `
    + `${Math.abs(cushionVelocity120 - cushionVelocity60).toFixed(6)} m/s; 1.0 m `
    + `overlap closing 1.5 m/s clears 2.2 m in `
    + `${(clearance120.clearedAt ?? 0).toFixed(3)} s (deadline `
    + `${CLEARANCE_SCENARIO.deadlineSeconds} s, worst gap `
    + `${clearance120.minimumGap.toFixed(3)} m); clean-gate chain multiplies `
    + `passive regen only.`,
);

console.log(
  `Slipstream PASS: full tow inside ${physics.SLIPSTREAM_NEAR_METERS}-`
    + `${physics.SLIPSTREAM_FULL_METERS} m and ${physics.SLIPSTREAM_LATERAL_FULL_METERS} m `
    + `of the line, gone by ${physics.SLIPSTREAM_FADE_METERS} m / `
    + `${physics.SLIPSTREAM_LATERAL_FADE_METERS} m; cruise cap 86 -> 91.16 m/s, `
    + `terminal cruise ${plainCruise60s.toFixed(2)} -> ${towedCruise120.toFixed(2)} m/s `
    + `(+${((towedCruise120 / plainCruise60s - 1) * 100).toFixed(2)}%), regen `
    + `${physics.BOOST_RESERVE_REGEN_RATE} -> ${regenFullTow.toFixed(3)} per second; `
    + `60/120 Hz drift ${Math.abs(towedCruise120 - towedCruise60).toFixed(5)} m/s.`,
);

console.log(
  `Physics PASS: cruise ${(cruise120 * 3.6).toFixed(1)} km/h, boost ${(boosted * 3.6).toFixed(1)} km/h, post-boost ${(releasedBoostHalfSecond * 3.6).toFixed(1)}→${(releasedBoostTwoSeconds120 * 3.6).toFixed(1)} km/h, finish run-out ${coast120.distance.toFixed(1)} m / ${(3.5).toFixed(1)} s settled, wet grip ${wetGrip120.toFixed(3)}→${recoveredGrip120.toFixed(3)}, 60/120 Hz speed drift ${Math.abs(cruise120 - cruise60).toFixed(3)} m/s, steering drift ${Math.abs(steering120 - steering60).toFixed(4)}, 240 s soak ${soak120.boostExhaustions} boost exhaustions / ${soak120.driftEntries} drift entries / ${(Math.abs(soak120.distance - soak60.distance) / soak120.distance * 100).toFixed(3)}% distance drift, drift bank ${chargeSeconds120.toFixed(3)} s to full / ${decaySeconds120.toFixed(3)} s to empty, 240 s drift economy ${driftSoak120.driftEntries} entries / ${driftSoak120.driftRewards} rewards (+${driftSoak120.driftRewardTotal.toFixed(2)} reserve), reserve low-water ${driftSoak120.minimumReserve.toFixed(3)}.`,
);
