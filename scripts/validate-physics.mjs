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

console.log(
  `Physics PASS: cruise ${(cruise120 * 3.6).toFixed(1)} km/h, boost ${(boosted * 3.6).toFixed(1)} km/h, 60/120 Hz speed drift ${Math.abs(cruise120 - cruise60).toFixed(3)} m/s, steering drift ${Math.abs(steering120 - steering60).toFixed(4)}.`,
);
