import assert from "node:assert/strict";
import {
  calculateMinimumPixelRatio,
  calculatePreferredPixelRatio,
  reconcilePixelRatioAfterResize,
} from "../src/game/render-quality.js";

assert.equal(calculatePreferredPixelRatio(720, 2, "adaptive"), 0.75);
assert.equal(calculateMinimumPixelRatio(720, 2, "adaptive"), 0.5);
assert.equal(calculatePreferredPixelRatio(1_080, 2, "adaptive"), 0.5);
assert.ok(
  Math.abs(calculateMinimumPixelRatio(1_080, 2, "adaptive") - 1 / 3) < 1e-9,
);
assert.equal(calculatePreferredPixelRatio(2_160, 2, "adaptive"), 0.25);
assert.equal(calculatePreferredPixelRatio(720, 2, "low"), 0.5);
assert.equal(calculateMinimumPixelRatio(720, 2, "low"), 0.5);
assert.equal(calculatePreferredPixelRatio(720, 2, "high"), 1.25);

assert.equal(reconcilePixelRatioAfterResize(0.75, 0.75, 0.5, 1 / 3), 0.5);
assert.equal(reconcilePixelRatioAfterResize(0.58, 0.75, 0.6, 0.4), 0.58);
assert.equal(reconcilePixelRatioAfterResize(0.34, 0.5, 0.6, 0.4), 0.4);

console.log(
  "Render quality PASS: 540-line adaptive target, 360-line floor, resize-safe degradation.",
);
