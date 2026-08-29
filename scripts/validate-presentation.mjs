import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  bankedSurfaceLift,
  calculatePresentationAlpha,
  calculateSpeedStreakLength,
  calculateSpeedStreakOpacity,
} from "../src/game/presentation.js";

function read(relativePath) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

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

/* ------------------------------------------------------------------ */
/* P11: the banked deck's height at a lateral offset                    */
/* ------------------------------------------------------------------ */

// `course.sample()` rotates `right` by -bank about the tangent, so `right.y` is
// sin(bank) and the deck surface at lateral L is `right.y * L` above the
// centreline. The race loop used to place the craft at the centreline height
// regardless, which buried it into the high side of a banked corner and floated
// it over the low side. The authored banks are the real input here, not a made
// up angle, so the worst case is scraped from the map.
const blockout = JSON.parse(read("src/game/data/greenwater-blockout.json"));
const apronWidths = Object.fromEntries(
  Object.entries(blockout.apron.edges).map(([edge, profile]) => [
    edge,
    profile.widthMetres,
  ]),
);
let steepest = blockout.centreline.samples[0];
for (const sample of blockout.centreline.samples) {
  if (Math.abs(sample.bank) > Math.abs(steepest.bank)) steepest = sample;
}
assert.ok(
  Math.abs(steepest.bank) >= 1,
  "Greenwater authors no banked station; this check would be vacuous.",
);
const steepestSin = Math.sin((-steepest.bank * Math.PI) / 180);
const steepestHalfWidth = steepest.w / 2;
const legalLateral = steepestHalfWidth + apronWidths[steepest.edgeR];

assert.equal(
  bankedSurfaceLift(0, legalLateral),
  0,
  "A flat station must not move the craft vertically at any lateral.",
);
assert.equal(
  Math.abs(bankedSurfaceLift(steepestSin, 0)),
  0,
  "On the centreline the bank cannot change the height, however steep.",
);
assert.equal(
  bankedSurfaceLift(steepestSin, -legalLateral),
  -bankedSurfaceLift(steepestSin, legalLateral),
  "The lift must be odd in lateral: one side rises exactly as the other falls.",
);
const worstCaseError = Math.abs(bankedSurfaceLift(steepestSin, legalLateral));
// The error the fix removes, at the widest legal lateral on the steepest
// authored bank. Well over the craft's own hover height (0.89-1.31 m), which is
// why the old behaviour read as driving inside the road.
assert.ok(
  worstCaseError > 3.5 && worstCaseError < 3.9,
  `Worst-case bank error is ${worstCaseError.toFixed(3)} m at d=${steepest.d} m, `
    + `lateral ${legalLateral} m; expected ~3.70 m. Re-baseline this only with `
    + "the authored bank or apron width, never to make a regression pass.",
);
assert.equal(bankedSurfaceLift(Number.NaN, 4), 0);
assert.equal(bankedSurfaceLift(0.2, Number.NaN), 0);

// Applied on the presentation path only. `this.position` is the simulation's
// own state: `course.project()` and the demo autopilot both read it back, so
// lifting it would move progress and lateral on the next fixed step and take
// the lap clock with them.
const gameSource = read("src/game/game.ts");
assert.ok(
  gameSource.includes("this.presentationPosition.y += bankedSurfaceLift("),
  "game.ts must lift the interpolated presentation pose onto the banked deck.",
);
assert.ok(
  !/this\.position\.y\s*\+?=\s*[^;]*bankedSurfaceLift/.test(gameSource),
  "game.ts must NOT apply the bank lift to `this.position`. That vector is the "
    + "simulation's state; moving its y changes progress, lateral and lap times.",
);
assert.ok(
  gameSource.includes("this.position.y = afterMove.position.y;"),
  "The simulation must keep snapping its own y to the centreline sample.",
);
assert.ok(
  read("src/game/effects.ts").includes(
    "const originY = origin.y + bankedSurfaceLift(sample.right.y, lateral);",
  ),
  "Impact sparks must leave the banked surface, not the centreline plane.",
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
  `Presentation PASS: ${summaries.join(", ")}; bounded directional speed streaks; `
    + `banked-deck lift ${worstCaseError.toFixed(2)} m at the ${steepest.bank}° `
    + `station (d=${steepest.d} m), applied on the presentation pose and the `
    + "spark origin and kept off the simulation's own position.",
);
