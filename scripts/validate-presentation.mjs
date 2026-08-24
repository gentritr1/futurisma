import assert from "node:assert/strict";
import {
  calculatePresentationAlpha,
  calculateSpeedStreakLength,
  calculateSpeedStreakOpacity,
} from "../src/game/presentation.js";

const FIXED_STEP = 1 / 120;

function simulatePresentation(renderHz, interpolate) {
  const frameDelta = 1 / renderHz;
  let accumulator = 0;
  let previous = 0;
  let current = 0;
  const positions = [];

  for (let frame = 0; frame < renderHz * 4; frame += 1) {
    accumulator += frameDelta;
    while (accumulator + Number.EPSILON >= FIXED_STEP) {
      previous = current;
      current += FIXED_STEP;
      accumulator = Math.max(0, accumulator - FIXED_STEP);
    }
    const alpha = calculatePresentationAlpha(accumulator, FIXED_STEP);
    positions.push(interpolate ? previous + (current - previous) * alpha : current);
  }

  const deltas = positions
    .slice(12)
    .map((position, index) => position - positions[index + 11]);
  const repeatedFrames = deltas.filter((delta) => Math.abs(delta) < 1e-10).length;
  const targetDelta = frameDelta;
  const maximumDeviation = Math.max(
    ...deltas.map((delta) => Math.abs(delta - targetDelta)),
  );
  return { repeatedFrames, maximumDeviation };
}

assert.equal(calculatePresentationAlpha(0, FIXED_STEP), 0);
assert.equal(calculatePresentationAlpha(FIXED_STEP / 2, FIXED_STEP), 0.5);
assert.equal(calculatePresentationAlpha(FIXED_STEP * 2, FIXED_STEP), 1);
assert.equal(calculatePresentationAlpha(Number.NaN, FIXED_STEP), 0);
assert.equal(calculatePresentationAlpha(0.1, 0), 0);

assert.equal(calculateSpeedStreakOpacity(0.4, 0, false), 0);
assert.ok(calculateSpeedStreakOpacity(0.75, 0, false) > 0.1);
assert.ok(
  calculateSpeedStreakOpacity(0.75, 0, true)
    < calculateSpeedStreakOpacity(0.75, 0, false),
);
assert.equal(calculateSpeedStreakOpacity(Number.NaN, Number.NaN, false), 0);
assert.ok(
  calculateSpeedStreakLength(0.8, true, false)
    > calculateSpeedStreakLength(0.8, false, false),
);
assert.ok(
  calculateSpeedStreakLength(0.8, true, true)
    < calculateSpeedStreakLength(0.8, false, false),
);

const summaries = [];
for (const refreshRate of [144, 165, 240]) {
  const stepped = simulatePresentation(refreshRate, false);
  const interpolated = simulatePresentation(refreshRate, true);
  assert.ok(
    stepped.repeatedFrames > 0,
    `${refreshRate} Hz should expose repeated 120 Hz simulation poses without interpolation.`,
  );
  assert.equal(
    interpolated.repeatedFrames,
    0,
    `${refreshRate} Hz interpolation must remove repeated presentation poses.`,
  );
  assert.ok(
    interpolated.maximumDeviation < 1e-9,
    `${refreshRate} Hz presentation motion must remain evenly spaced.`,
  );
  summaries.push(
    `${refreshRate} Hz ${stepped.repeatedFrames}→${interpolated.repeatedFrames} repeats`,
  );
}

console.log(
  `Presentation PASS: ${summaries.join(", ")}; bounded directional speed streaks.`,
);
