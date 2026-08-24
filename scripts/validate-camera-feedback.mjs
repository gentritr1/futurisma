import assert from "node:assert/strict";
import {
  calculateDesiredCameraFov,
  calculateImpactShakeOffset,
  integrateCameraFov,
} from "../src/game/camera-feedback.js";

for (const axis of ["lateral", "vertical"]) {
  const first = calculateImpactShakeOffset(2.75, 1, axis);
  const repeated = calculateImpactShakeOffset(2.75, 1, axis);
  assert.equal(first, repeated, `${axis} shake must be deterministic`);
  assert.ok(Math.abs(first) <= 0.16, `${axis} shake exceeds its bound`);
  assert.ok(
    Math.abs(calculateImpactShakeOffset(2.75, 0.5, axis)) <= 0.04,
    `${axis} shake must use squared trauma falloff`,
  );
  assert.equal(calculateImpactShakeOffset(2.75, 0, axis), 0);
}

assert.equal(calculateImpactShakeOffset(Number.NaN, 1, "lateral"), 0);
assert.equal(calculateImpactShakeOffset(1, Number.NaN, "vertical"), 0);

const neutralFov = calculateDesiredCameraFov(0, false, 0, 0, false);
const cruiseFov = calculateDesiredCameraFov(0.75, false, 0, 0, false);
const boostFov = calculateDesiredCameraFov(1, true, 0, 0, false);
const driftFov = calculateDesiredCameraFov(1, true, 1, 0, false);
const brakingFov = calculateDesiredCameraFov(0.75, false, 0, 1, false);
const reducedBoostFov = calculateDesiredCameraFov(1, true, 1, 0, true);
const reducedBrakingFov = calculateDesiredCameraFov(0.75, false, 0, 1, true);
assert.equal(neutralFov, 56, "Stationary camera FOV must remain neutral.");
assert.ok(cruiseFov > neutralFov, "Speed must widen the chase lens.");
assert.equal(boostFov, 73, "Full-speed boost must respect the 73-degree lens cap.");
assert.equal(driftFov, 76, "Boost plus full drift must respect the 76-degree lens cap.");
assert.equal(cruiseFov - brakingFov, 2.25, "Full braking must compress the lens by speed.");
assert.ok(reducedBoostFov <= 63.6, "Reduced motion must constrain maximum lens expansion.");
assert.equal(
  calculateDesiredCameraFov(0.75, false, 0, 0, true) - reducedBrakingFov,
  0.75,
  "Reduced motion must cap braking compression at one degree.",
);
assert.equal(
  calculateDesiredCameraFov(Number.NaN, true, Number.NaN, Number.NaN, false),
  63,
  "Invalid analogue values must fall back to a bounded boost lens.",
);

function simulateFov(step) {
  let fov = 56;
  const target = 73;
  const iterations = Math.round(1 / step);
  for (let index = 0; index < iterations; index += 1) {
    fov = integrateCameraFov(fov, target, step);
  }
  return fov;
}

const fov60 = simulateFov(1 / 60);
const fov120 = simulateFov(1 / 120);
assert.ok(
  Math.abs(fov60 - fov120) < 0.001,
  "Lens response must remain stable between 60 Hz and 120 Hz.",
);
assert.equal(integrateCameraFov(Number.NaN, Number.NaN, -1), 56);

console.log(
  `Camera feedback PASS: deterministic impact shake, bounded braking/boost lens, and 60/120 Hz FOV drift ${Math.abs(fov60 - fov120).toFixed(4)} degrees.`,
);
