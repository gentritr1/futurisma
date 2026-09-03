import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  apronSurfaceLift,
  bankedSurfaceLift,
  calculatePresentationAlpha,
  calculateSpeedStreakLength,
  calculateSpeedStreakOpacity,
  presentationSurfaceLift,
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

// ---------------------------------------------------------------------------
// P16 — the apron cross-section term.
//
// `bankedSurfaceLift` extrapolates the bank plane, which is exactly right on the
// deck and incomplete past its edge: `createApronDecks` displaces the run-off
// along `up` by the edge's `outerRise`. The craft hovered 0.12 m over a gravel
// shoulder and sank 0.14 m into a structure rumble.
//
// It must be ZERO on the deck, which is what keeps every pinned on-deck pose —
// including the P11 clamp probe's — bit-identical across this change.
// ---------------------------------------------------------------------------
assert.equal(
  apronSurfaceLift(1, 0),
  0,
  "On the deck the apron cross-section is zero, so the lift must not move the "
    + "craft. Every pinned on-deck pose depends on this.",
);
assert.equal(
  presentationSurfaceLift(steepestSin, legalLateral, Math.cos(0), 0),
  bankedSurfaceLift(steepestSin, legalLateral),
  "With no cross-section the composed lift must equal the P11 bank lift alone.",
);
for (const outerRise of [-0.12, 0.14, 0]) {
  assert.equal(
    apronSurfaceLift(1, outerRise),
    outerRise,
    `An upright frame must pass the ${outerRise} m cross-section through whole.`,
  );
}
// The authored cross-sections, so the term can never silently grow into
// something that would move the craft a distance a player would notice.
const APRON_OUTER_RISES = [-0.12, 0.14, 0];
const worstApronLift = Math.max(
  ...APRON_OUTER_RISES.map((rise) => Math.abs(apronSurfaceLift(1, rise))),
);
assert.ok(
  worstApronLift > 0.13 && worstApronLift < 0.15,
  `Worst-case apron lift is ${worstApronLift.toFixed(3)} m; expected ~0.14 m. `
    + "This term corrects a cross-section, not a corridor: the P16 run-off "
    + "report measured 5.24 m of overshoot past the visible wall, which is a "
    + "clamp question and not this.",
);
assert.equal(apronSurfaceLift(Number.NaN, 0.14), 0);
assert.equal(apronSurfaceLift(1, Number.NaN), 0);

// Applied on the presentation path only. `this.position` is the simulation's
// own state: `course.project()` and the demo autopilot both read it back, so
// lifting it would move progress and lateral on the next fixed step and take
// the lap clock with them.
const gameSource = read("src/game/game.ts");
assert.ok(
  gameSource.includes("this.presentationPosition.y += presentationSurfaceLift("),
  "game.ts must lift the interpolated presentation pose onto the drawn surface. "
    + "P16 composed the bank plane and the apron cross-section into "
    + "`presentationSurfaceLift`; the lift itself must still be applied here.",
);
assert.ok(
  !/this\.position\.y\s*\+?=\s*[^;]*(?:banked|presentation|apron)SurfaceLift/
    .test(gameSource),
  "game.ts must NOT apply any surface lift to `this.position`. That vector is "
    + "the simulation's state; moving its y changes progress, lateral and lap "
    + "times.",
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

/* ------------------------------------------------------------------ */
/* P20.5 — speed lines are per map, and the ramp underneath is not      */
/* ------------------------------------------------------------------ */

// The 96 additive white-cyan streaks were drawn for Greenwater's dark sky. On
// Bitterpan's pale one they read as scratches on the lens — measured on the
// merged base they were the busiest thing in most frames. The palette is now
// per map; what must NOT be per map is the shape of the speed and drift ramps,
// because that is game feel and both maps drive the same craft.
const { SPEED_LINE_PROFILES, resolveSpeedLineProfile } = await import(
  "../src/game/speed-line-profile.js"
);
const effectsSource = read("src/game/effects.ts");

const bitterpanStreaks = SPEED_LINE_PROFILES.bitterpan;
const greenwaterStreaks = SPEED_LINE_PROFILES.greenwater;

assert.equal(
  resolveSpeedLineProfile("nonexistent-map"),
  greenwaterStreaks,
  "An unknown course kind must fall back to the shipped Greenwater streaks "
    + "rather than to an empty profile.",
);

assert.equal(greenwaterStreaks.count, 96, "Greenwater keeps its 96 streaks.");
assert.equal(greenwaterStreaks.lengthScale, 1, "Greenwater keeps its streak length.");
assert.ok(
  greenwaterStreaks.additive,
  "Greenwater's dark sky is what additive streaks were drawn for; keep them.",
);
assert.ok(
  Math.abs(greenwaterStreaks.opacityScale - 0.8) < 1e-9,
  `Greenwater streak opacity scale is ${greenwaterStreaks.opacityScale}; P20.5 `
    + "authored a 20% reduction, i.e. 0.8.",
);

// P20.5 round 2 replaced round 1's pale-and-sparse Bitterpan streaks with dark
// dust: the pale tint rendered within ten luma of the pan sky and the speed cue
// vanished entirely (a measured ZERO streak pixels at three stations). What is
// pinned here is the DIRECTION — darker than the sky, never additive, never
// near-white — and the density that keeps it legible at that low contrast.
assert.ok(
  bitterpanStreaks.count >= 96 && bitterpanStreaks.count <= 160,
  `Bitterpan authors ${bitterpanStreaks.count} streaks; a dark streak carries `
    + "less signal per line, so the density has to sit in 96-160 to keep the "
    + "speed cue. Round 1 shipped 60 and the cue disappeared.",
);
assert.ok(
  bitterpanStreaks.lengthScale >= 0.9 && bitterpanStreaks.lengthScale <= 1,
  `Bitterpan streak length scale is ${bitterpanStreaks.lengthScale}; 0.9-1.0. `
    + "Round 1's 0.7 cut length on top of an already quiet blend.",
);
assert.ok(
  bitterpanStreaks.opacityScale <= 0.8,
  `Bitterpan streak opacity scale ${bitterpanStreaks.opacityScale} is over the `
    + "0.8 ceiling.",
);
assert.ok(
  !bitterpanStreaks.additive,
  "Bitterpan streaks must not blend additively: additive white over a pale sky "
    + "is exactly the near-white scratch the phase removed.",
);
// Warm dust, not cold light: red over green over blue...
const [dustR, dustG, dustB] = [16, 8, 0].map(
  (shift) => (bitterpanStreaks.color >> shift) & 255,
);
assert.ok(
  dustR > dustG && dustG > dustB,
  `Bitterpan streak colour #${bitterpanStreaks.color.toString(16)} is not a warm `
    + "dust tint (needs red > green > blue).",
);
// ...and DARK, which is the half that cannot be eyeballed off a swatch. Under
// AgX a mid dust tint renders near the pan sky's own value and disappears; the
// streak has to start far below it. Rec.709 luma of the authored sRGB, out of
// 255 — 60 is already well under a sky that measures 95-145 in frame.
const dustLuma = 0.2126 * dustR + 0.7152 * dustG + 0.0722 * dustB;
assert.ok(
  dustLuma <= 60,
  `Bitterpan streak colour #${bitterpanStreaks.color.toString(16)} has luma `
    + `${dustLuma.toFixed(0)}; over 60 it renders within a few luma of the pan `
    + "sky under AgX and the streaks stop reading at all.",
);
assert.ok(
  dustLuma
    < 0.2126 * ((greenwaterStreaks.color >> 16) & 255)
      + 0.7152 * ((greenwaterStreaks.color >> 8) & 255)
      + 0.0722 * (greenwaterStreaks.color & 255),
  "Bitterpan's streaks must be darker than Greenwater's: one map reads its "
    + "speed as light added to a dark sky, the other as dust taken out of a "
    + "bright one.",
);

// The ramps themselves are untouched, and the scales ride OVER their output.
// If a future change folds the map scale into the ramp, these two fail: the
// ramp is what the rest of this file pins, and it must stay map-agnostic.
assert.ok(
  effectsSource.includes(") * this.profile.opacityScale;"),
  "effects.ts must apply the map's opacity scale over calculateSpeedStreakOpacity's "
    + "result, not inside it, or the drift and boost shoulders change shape.",
);
assert.ok(
  effectsSource.includes(") * this.profile.lengthScale;"),
  "effects.ts must apply the map's length scale over calculateSpeedStreakLength's "
    + "result.",
);
// Same ramp, two maps: the ONLY difference at a given input is the scale.
for (const speed of [0.5, 0.7, 0.9, 1]) {
  for (const drift of [0, 0.5, 1]) {
    const base = calculateSpeedStreakOpacity(speed, drift, false);
    assert.ok(
      Math.abs(base * bitterpanStreaks.opacityScale
        - base * greenwaterStreaks.opacityScale * (bitterpanStreaks.opacityScale
          / greenwaterStreaks.opacityScale)) < 1e-12,
      "The per-map scale must be a pure multiplier over one shared ramp.",
    );
    assert.ok(
      base * bitterpanStreaks.opacityScale <= base * greenwaterStreaks.opacityScale,
      `At speed ${speed}/drift ${drift} Bitterpan's streaks are not quieter than `
        + "Greenwater's, which is the whole point of the per-map profile.",
    );
  }
}
// Reduced motion is still the more restrictive path on both maps.
for (const profile of [bitterpanStreaks, greenwaterStreaks]) {
  assert.ok(
    calculateSpeedStreakOpacity(0.9, 0.5, true) * profile.opacityScale
      < calculateSpeedStreakOpacity(0.9, 0.5, false) * profile.opacityScale,
    "Reduced motion must stay quieter than full motion under every profile.",
  );
}

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
    + "spark origin and kept off the simulation's own position; P20.5 streak "
    + `profiles Bitterpan ${bitterpanStreaks.count} lines x${bitterpanStreaks.lengthScale} `
    + `length x${bitterpanStreaks.opacityScale} opacity `
    + `(#${bitterpanStreaks.color.toString(16)}, normal blend) and Greenwater `
    + `${greenwaterStreaks.count} x${greenwaterStreaks.opacityScale} additive, over one `
    + "shared ramp.",
);
