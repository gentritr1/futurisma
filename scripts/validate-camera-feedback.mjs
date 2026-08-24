import assert from "node:assert/strict";
import { calculateImpactShakeOffset } from "../src/game/camera-feedback.js";

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

console.log(
  "Camera feedback PASS: deterministic, bounded, render-rate-independent impact shake.",
);
