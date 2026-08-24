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

assert.ok(cruise120 > 70 && cruise120 <= 92, `Unexpected cruise speed ${cruise120}.`);
assert.ok(boosted > cruise120, "Boost must produce a higher terminal speed than cruise.");
assert.ok(boosted <= physics.BOOST_MAX_SPEED, "Boost must respect its speed cap.");
assert.ok(braking < 45, `Full braking should shed meaningful speed; got ${braking}.`);
assert.ok(
  Math.abs(cruise120 - cruise60) < 0.2,
  "Longitudinal integration must remain stable between 60 Hz and 120 Hz.",
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

let reserve = 1;
for (let index = 0; index < 1_200; index += 1) {
  reserve = physics.integrateBoostReserve(reserve, true, 1 / 120);
}
assert.equal(reserve, 0, "Boost reserve must clamp at zero.");
for (let index = 0; index < 2_400; index += 1) {
  reserve = physics.integrateBoostReserve(reserve, false, 1 / 120);
}
assert.equal(reserve, 1, "Boost reserve must recharge and clamp at one.");
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
  let driftActive = false;
  let boostLockedUntilRelease = false;
  let distance = 0;
  let boostExhaustions = 0;
  let boostRecoveries = 0;
  let driftEntries = 0;
  let driftExits = 0;
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
    const turnAuthority = physics.calculateTurnAuthority(speedRatio);
    const turnRate = physics.calculateTurnRate(speedRatio, driftIntent);
    const gripRate = physics.calculateGripRate(
      speedRatio,
      driftIntent,
      controls.surfaceGrip,
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
    reserve = physics.integrateBoostReserve(reserve, boostActive, step);
    distance += speed * step;

    const finiteValues = [
      speed,
      reserve,
      steer,
      driftIntent,
      turnAuthority,
      turnRate,
      gripRate,
      distance,
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
    assert.ok(gripRate > 0 && gripRate < 10, "Soak grip rate escaped its handling window.");

    if (!previousBoostLockout && boostLockedUntilRelease) boostExhaustions += 1;
    if (previousReserve < 1 && reserve === 1) boostRecoveries += 1;
    if (!previousDriftActive && driftActive) driftEntries += 1;
    if (previousDriftActive && !driftActive) driftExits += 1;

    maximumSpeed = Math.max(maximumSpeed, speed);
    maximumDriftIntent = Math.max(maximumDriftIntent, driftIntent);
    minimumGripRate = Math.min(minimumGripRate, gripRate);
  }

  return {
    speed,
    reserve,
    steer,
    driftActive,
    distance,
    boostExhaustions,
    boostRecoveries,
    driftEntries,
    driftExits,
    maximumSpeed,
    maximumDriftIntent,
    minimumGripRate,
  };
}

const soak120 = simulateControlSoak(1 / 120);
const soak60 = simulateControlSoak(1 / 60);

assert.ok(soak120.boostExhaustions >= 10, "The soak must repeatedly exhaust boost.");
assert.ok(soak120.boostRecoveries >= 9, "The soak must repeatedly recharge boost.");
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
  soak120.boostRecoveries,
  soak60.boostRecoveries,
  "Boost recovery count must agree at 60 Hz and 120 Hz.",
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
  Math.abs(soak120.distance - soak60.distance) / soak120.distance < 0.002,
  "Soak distance must remain within 0.2% between 60 Hz and 120 Hz.",
);

console.log(
  `Physics PASS: cruise ${(cruise120 * 3.6).toFixed(1)} km/h, boost ${(boosted * 3.6).toFixed(1)} km/h, 60/120 Hz speed drift ${Math.abs(cruise120 - cruise60).toFixed(3)} m/s, steering drift ${Math.abs(steering120 - steering60).toFixed(4)}, 240 s soak ${soak120.boostExhaustions} boost exhaustions / ${soak120.driftEntries} drift entries / ${(Math.abs(soak120.distance - soak60.distance) / soak120.distance * 100).toFixed(3)}% distance drift.`,
);
