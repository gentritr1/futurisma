import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ATMOSPHERE_UPDATE_INTERVAL_SECONDS,
  DEFAULT_KEY_DIRECTION,
  HANGAR_FLICKER_MAX,
  HANGAR_FLICKER_MIN,
  HANGAR_FLICKER_SEED,
  HANGAR_LAMP_FROM_METRES,
  HANGAR_LAMP_TO_METRES,
  LIGHTING_CROSSFADE_METRES,
  SECTOR_KEY_DIRECTIONS,
  SECTOR_KEY_DIRECTION_ORDER,
  createHangarFlicker,
  createTimeOfDayTint,
  evaluateTimeOfDay,
  isInsideHangarRange,
  lerpKeyDirection,
  resolveHangarLampLevel,
  resolveLapProgress,
  resolveTimeOfDayDrift,
} from "../src/game/lighting-motion.js";

/**
 * P4a lighting-motion guard.
 *
 * `atmosphere.ts` owns three.js objects that Node cannot construct, so the
 * decisions themselves live in `src/game/lighting-motion.js` and are exercised
 * here against the *real* authored numbers: the sector distances are scraped
 * out of `SECTOR_PALETTE_DEFINITIONS` in `course.ts` rather than restated, and
 * the time-of-day ramp is read from `greenwater-blockout.json`. A palette edit
 * that pops the sun, an undeclared `keyDirection`, a flicker that stops being
 * deterministic, or a ramp that loses its warm shift all fail here.
 */

const MAX_ANGULAR_DELTA_DEGREES = 0.9;
const SAMPLE_STEP_METRES = 1;
const DEGREES = 180 / Math.PI;

function read(relativePath) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

const courseSource = read("src/game/course.ts");
const blockout = JSON.parse(read("src/game/data/greenwater-blockout.json"));
const lapLength = blockout.centreline.lapLength;

/* ------------------------------------------------------------------ */
/* 1. All 12 sector palettes declare a normalized keyDirection          */
/* ------------------------------------------------------------------ */

const paletteStart = courseSource.indexOf("const SECTOR_PALETTE_DEFINITIONS = [");
assert.ok(paletteStart >= 0, "course.ts must declare SECTOR_PALETTE_DEFINITIONS.");
const paletteBlock = courseSource.slice(
  paletteStart,
  courseSource.indexOf("] as const;", paletteStart),
);

// Each entry must name its sector, bind a keyDirection from the shared table,
// and give a distance — in that order. Scraping keeps the validator honest:
// it fails if an entry is added without a direction rather than silently
// testing eleven zones.
const entryPattern
  = /sector: "([A-Z0-9_]+)",\s*\n\s*keyDirection: SECTOR_KEY_DIRECTIONS\.([A-Z0-9_]+),\s*\n\s*distance: ([0-9.]+),/g;
const authored = [];
for (const match of paletteBlock.matchAll(entryPattern)) {
  assert.equal(
    match[2],
    match[1],
    `SECTOR_PALETTE_DEFINITIONS entry "${match[1]}" binds `
      + `SECTOR_KEY_DIRECTIONS.${match[2]}. A sector must use its own direction.`,
  );
  authored.push({ sector: match[1], distance: Number(match[3]) });
}

assert.equal(
  authored.length,
  12,
  `Expected 12 sector palettes each declaring a keyDirection, found `
    + `${authored.length}. Every entry in SECTOR_PALETTE_DEFINITIONS must author one.`,
);

assert.deepEqual(
  authored.map((entry) => entry.sector),
  [...SECTOR_KEY_DIRECTION_ORDER],
  "SECTOR_PALETTE_DEFINITIONS and SECTOR_KEY_DIRECTION_ORDER disagree on the "
    + "sector order around the lap.",
);

for (const { sector } of authored) {
  const direction = SECTOR_KEY_DIRECTIONS[sector];
  assert.ok(direction, `SECTOR_KEY_DIRECTIONS is missing ${sector}.`);
  const length = Math.hypot(direction.x, direction.y, direction.z);
  assert.ok(
    Math.abs(length - 1) <= 1e-5,
    `${sector} keyDirection is not normalized (length ${length.toFixed(8)}).`,
  );
  assert.ok(
    direction.y > 0,
    `${sector} keyDirection points at or below the horizon (y=${direction.y}); `
      + "the key light must stay above the deck.",
  );
}

// The lap wrap is a seam like any other: RUNWAY_HOME fades into RUNWAY_START.
assert.deepEqual(
  SECTOR_KEY_DIRECTIONS.RUNWAY_HOME,
  SECTOR_KEY_DIRECTIONS.RUNWAY_START,
  "RUNWAY_HOME and RUNWAY_START must share a direction or the lap wrap pops.",
);

// Bitterpan type-checks against the same profile shape and must keep the
// pre-P4a fixed sun until P8 authors its own.
assert.deepEqual(
  DEFAULT_KEY_DIRECTION,
  SECTOR_KEY_DIRECTIONS.RUNWAY_START,
  "DEFAULT_KEY_DIRECTION (used by Bitterpan) must be the legacy fixed sun.",
);
const bitterpanSource = read("src/game/bitterpan-course.ts");
assert.equal(
  (bitterpanSource.match(/keyDirection:/g) ?? []).length,
  3,
  "All three Bitterpan lighting profiles must declare a keyDirection.",
);

/* ------------------------------------------------------------------ */
/* 2. The authored table has to actually reach the light                */
/* ------------------------------------------------------------------ */

// Data that nothing reads is not a feature. Pin the two hops between the
// authored table and the three.js light: course.lightingAt crossfades the
// direction, and atmosphere.ts steers the key light with the result.
const lightingAtBody = courseSource.slice(
  courseSource.indexOf("  lightingAt(progress: number): CourseLightingProfile {"),
  courseSource.indexOf("  edgeType(sample: CourseSample, lateral: number): EdgeType {"),
);
assert.ok(
  lightingAtBody.includes("lerpKeyDirection("),
  "GreenwaterCourse.lightingAt must crossfade the key direction through "
    + "lerpKeyDirection — the function this validator's continuity sweep runs.",
);
assert.ok(
  lightingAtBody.includes("target.keyDirection"),
  "lightingAt must write the crossfaded direction into the profile scratch.",
);
assert.ok(
  /this\.keyDirection\.lerp\(\s*lighting\.keyDirection/.test(read("src/game/atmosphere.ts"))
    && /this\.keyLight\.position\s*\n?\s*\.copy\(this\.keyDirection\)/
      .test(read("src/game/atmosphere.ts")),
  "atmosphere.ts must follow lighting.keyDirection and steer keyLight.position "
    + "with it; otherwise the sweep is authored but never lit.",
);

/* ------------------------------------------------------------------ */
/* 3. Continuity: max angular delta per metre around the lap            */
/* ------------------------------------------------------------------ */

const zones = authored.map((entry) => ({
  distance: entry.distance,
  direction: SECTOR_KEY_DIRECTIONS[entry.sector],
}));

function angleBetweenDegrees(a, b) {
  const dot = Math.min(1, Math.max(-1, a.x * b.x + a.y * b.y + a.z * b.z));
  return Math.acos(dot) * DEGREES;
}

const previous = { x: 0, y: 0, z: 0 };
const current = { x: 0, y: 0, z: 0 };
lerpKeyDirection(zones, 0, lapLength, previous, LIGHTING_CROSSFADE_METRES);

let maxDelta = 0;
let maxDeltaAt = 0;
let samples = 0;
for (
  let distance = SAMPLE_STEP_METRES;
  distance <= lapLength;
  distance += SAMPLE_STEP_METRES
) {
  lerpKeyDirection(
    zones,
    distance % lapLength,
    lapLength,
    current,
    LIGHTING_CROSSFADE_METRES,
  );
  const length = Math.hypot(current.x, current.y, current.z);
  assert.ok(
    Math.abs(length - 1) <= 1e-9,
    `lerpKeyDirection returned a non-unit vector at ${distance} m.`,
  );
  const delta = angleBetweenDegrees(previous, current);
  if (delta > maxDelta) {
    maxDelta = delta;
    maxDeltaAt = distance;
  }
  previous.x = current.x;
  previous.y = current.y;
  previous.z = current.z;
  samples += 1;
}

// A percentile means nothing without knowing the window was actually walked.
assert.equal(
  samples,
  Math.floor(lapLength / SAMPLE_STEP_METRES),
  `Continuity sweep covered ${samples} samples; the ${lapLength} m lap at `
    + `${SAMPLE_STEP_METRES} m steps is ${Math.floor(lapLength / SAMPLE_STEP_METRES)}.`,
);

assert.ok(
  maxDelta <= MAX_ANGULAR_DELTA_DEGREES,
  `Key direction jumps ${maxDelta.toFixed(3)}° between samples 1 m apart at `
    + `d=${maxDeltaAt} m; the no-pop budget is ${MAX_ANGULAR_DELTA_DEGREES}°. `
    + "A short sector crossfades over its whole length, so a big direction "
    + "delta across a 30 m sector boundary is the usual cause.",
);

// The sweep has to be a sweep, not twelve copies of one vector. Widest pair
// anywhere on the lap, and the widest swing seen from the start line.
let totalSwing = 0;
for (let a = 0; a < SECTOR_KEY_DIRECTION_ORDER.length; a += 1) {
  for (let b = a + 1; b < SECTOR_KEY_DIRECTION_ORDER.length; b += 1) {
    totalSwing = Math.max(totalSwing, angleBetweenDegrees(
      SECTOR_KEY_DIRECTIONS[SECTOR_KEY_DIRECTION_ORDER[a]],
      SECTOR_KEY_DIRECTIONS[SECTOR_KEY_DIRECTION_ORDER[b]],
    ));
  }
}
assert.ok(
  totalSwing >= 30,
  `The authored key directions only span ${totalSwing.toFixed(2)}° across the `
    + "lap. P4a exists so the sun visibly swings; that is not a sweep.",
);

// The hangar is an interior, and its key has to read as one: distinctly
// steeper than the open-air sectors on either side of it.
const elevationDegrees = (sector) => Math.asin(SECTOR_KEY_DIRECTIONS[sector].y) * DEGREES;
for (const openSector of ["RUNWAY_START", "GREENWATER_SWEEP", "THE_ELBOW"]) {
  assert.ok(
    elevationDegrees("HANGAR_SIX") - elevationDegrees(openSector) >= 10,
    `HANGAR_SIX's key (${elevationDegrees("HANGAR_SIX").toFixed(1)}°) is not `
      + `meaningfully steeper than ${openSector}'s `
      + `(${elevationDegrees(openSector).toFixed(1)}°); the shell interior should `
      + "not be lit like open sky.",
  );
}

/* ------------------------------------------------------------------ */
/* 4. Hangar flicker                                                    */
/* ------------------------------------------------------------------ */

assert.equal(
  ATMOSPHERE_UPDATE_INTERVAL_SECONDS,
  1 / 30,
  "The flicker must ride the existing 30 Hz atmosphere tick.",
);
assert.ok(
  !courseSource.includes("const ATMOSPHERE_UPDATE_INTERVAL_SECONDS = "),
  "course.ts redeclares ATMOSPHERE_UPDATE_INTERVAL_SECONDS. There is one tick "
    + "rate and it lives in lighting-motion.js.",
);

const SOAK_TICKS = 30 * 120; // two minutes of hangar time
const flicker = createHangarFlicker(HANGAR_FLICKER_SEED);
const replay = createHangarFlicker(HANGAR_FLICKER_SEED);
const otherSeed = createHangarFlicker(HANGAR_FLICKER_SEED + 1);

let minIntensity = Infinity;
let maxIntensity = -Infinity;
let slowMinimum = Infinity;
let slowMaximum = -Infinity;
let slowMaxStep = 0;
let fastDips = 0;
let fastQuiet = 0;
let differsFromOtherSeed = 0;
let previousSlow = flicker.slowComponent(0);

for (let tick = 0; tick < SOAK_TICKS; tick += 1) {
  const intensity = flicker.intensityAt(tick);
  assert.equal(
    intensity,
    replay.intensityAt(tick),
    `Flicker is not deterministic: tick ${tick} replayed differently for seed `
      + `${HANGAR_FLICKER_SEED}.`,
  );
  assert.ok(
    intensity >= HANGAR_FLICKER_MIN - 1e-12
      && intensity <= HANGAR_FLICKER_MAX + 1e-12,
    `Flicker intensity ${intensity} at tick ${tick} left `
      + `[${HANGAR_FLICKER_MIN}, ${HANGAR_FLICKER_MAX}].`,
  );
  if (intensity < minIntensity) minIntensity = intensity;
  if (intensity > maxIntensity) maxIntensity = intensity;
  if (otherSeed.intensityAt(tick) !== intensity) differsFromOtherSeed += 1;

  const slow = flicker.slowComponent(tick);
  if (slow < slowMinimum) slowMinimum = slow;
  if (slow > slowMaximum) slowMaximum = slow;
  const step = Math.abs(slow - previousSlow);
  if (tick > 0 && step > slowMaxStep) slowMaxStep = step;
  previousSlow = slow;

  const fast = flicker.fastComponent(tick);
  assert.ok(fast >= 0 && fast <= 1, `fastComponent left [0, 1] at tick ${tick}.`);
  if (fast < 0.6) fastDips += 1;
  if (fast > 0.999) fastQuiet += 1;
}

assert.ok(
  differsFromOtherSeed > SOAK_TICKS * 0.5,
  "A different seed produced a near-identical sequence; the flicker is not "
    + "actually seeded.",
);

// Both layers must be doing work: a slow sag that breathes, and a fast strike
// that is occasional rather than white noise.
assert.ok(
  slowMaximum - slowMinimum >= 0.1,
  `The slow flicker component only spans ${(slowMaximum - slowMinimum).toFixed(3)}; `
    + "with no sag the lamp is a constant with sparkles on top.",
);
assert.ok(
  slowMaxStep <= 0.03,
  `The slow component steps ${slowMaxStep.toFixed(4)} in one tick; it is meant `
    + "to be the smooth layer.",
);
assert.ok(
  fastDips >= SOAK_TICKS * 0.02,
  `Only ${fastDips} of ${SOAK_TICKS} ticks carry a strike; the lamp never reads `
    + "as failing.",
);
assert.ok(
  fastQuiet >= SOAK_TICKS * 0.5,
  `Only ${fastQuiet} of ${SOAK_TICKS} ticks are quiet; a lamp that dips on more `
    + "than half its ticks is white noise, not failing industrial lighting.",
);
assert.ok(
  minIntensity <= HANGAR_FLICKER_MIN + 0.03,
  `The deepest dip only reached ${minIntensity.toFixed(3)}; the authored floor `
    + `${HANGAR_FLICKER_MIN} is never used.`,
);
assert.ok(
  maxIntensity >= HANGAR_FLICKER_MAX - 0.03,
  `The lamp never recovers past ${maxIntensity.toFixed(3)}.`,
);

/* -- range gating and reduced motion -- */

assert.ok(
  isInsideHangarRange(HANGAR_LAMP_FROM_METRES)
    && isInsideHangarRange(HANGAR_LAMP_TO_METRES)
    && isInsideHangarRange(700),
  "The hangar range must cover [618, 816] inclusive.",
);
assert.ok(
  !isInsideHangarRange(HANGAR_LAMP_FROM_METRES - 0.001)
    && !isInsideHangarRange(HANGAR_LAMP_TO_METRES + 0.001)
    && !isInsideHangarRange(0),
  "The hangar lamps must be off outside [618, 816].",
);

const hangarSector = blockout.sectors.find((sector) => sector.name === "HANGAR_SIX");
assert.ok(
  HANGAR_LAMP_FROM_METRES >= hangarSector.startDistance
    && HANGAR_LAMP_TO_METRES <= hangarSector.endDistance,
  `The lamp range [${HANGAR_LAMP_FROM_METRES}, ${HANGAR_LAMP_TO_METRES}] must sit `
    + `inside the authored HANGAR_SIX span [${hangarSector.startDistance}, `
    + `${hangarSector.endDistance}].`,
);

for (const distance of [0, 400, 617.9, 700, 816.1, 2400]) {
  assert.equal(
    resolveHangarLampLevel(distance, 41, true, flicker),
    0,
    `Reduced motion must zero the hangar lamps (d=${distance}).`,
  );
}
for (const distance of [0, 400, 617.9, 816.1, 2400]) {
  assert.equal(
    resolveHangarLampLevel(distance, 41, false, flicker),
    0,
    `The hangar lamps must be off at d=${distance}.`,
  );
}
for (let distance = HANGAR_LAMP_FROM_METRES; distance <= HANGAR_LAMP_TO_METRES; distance += 1) {
  const level = resolveHangarLampLevel(distance, distance | 0, false, flicker);
  assert.ok(
    level >= HANGAR_FLICKER_MIN && level <= HANGAR_FLICKER_MAX,
    `Lamp level ${level} inside the shell at d=${distance} left the flicker band.`,
  );
}
assert.equal(
  resolveHangarLampLevel(Number.NaN, 0, false, flicker),
  0,
  "A non-finite distance must leave the lamps off rather than NaN the intensity.",
);

// atmosphere.ts must actually hide the lights, not just dim them.
const atmosphereSource = read("src/game/atmosphere.ts");
assert.ok(
  atmosphereSource.includes("resolveHangarLampLevel("),
  "atmosphere.ts must drive the lamps through resolveHangarLampLevel, which is "
    + "what this validator actually exercises.",
);
assert.ok(
  atmosphereSource.includes("ATMOSPHERE_UPDATE_INTERVAL_SECONDS"),
  "The flicker must be advanced on the 30 Hz atmosphere tick, not per frame.",
);
assert.ok(
  atmosphereSource.includes("lamp.visible = active;")
    && atmosphereSource.includes("lamp.intensity = intensity;"),
  "atmosphere.ts must set both `visible` and `intensity` on the hangar lamps; "
    + "an intensity-0 light still costs a uniform upload.",
);
assert.ok(
  atmosphereSource.includes("lamp.visible = false;"),
  "The hangar lamps must be created hidden.",
);

/* ------------------------------------------------------------------ */
/* 5. Lap-based time-of-day ramp                                        */
/* ------------------------------------------------------------------ */

const ramp = blockout.timeOfDay;
assert.ok(ramp, "greenwater-blockout.json must author a `timeOfDay` ramp.");
assert.equal(
  ramp.model,
  "multiplicative",
  "The ramp must be multiplicative so the sector palette survives it.",
);
const stops = ramp.stops;
assert.equal(stops.length, 5, `The time-of-day ramp must have 5 stops, found ${stops.length}.`);
assert.equal(stops[0].lapProgress, 0, "Stop 0 must sit at lapProgress 0.");
assert.equal(
  stops[stops.length - 1].lapProgress,
  1,
  "The last stop must sit at lapProgress 1.",
);

const CHANNELS = ["keyTint", "skyTint", "groundTint", "fogTint"];
for (let index = 0; index < stops.length; index += 1) {
  const stop = stops[index];
  assert.ok(typeof stop.label === "string" && stop.label.length > 0, `Stop ${index} needs a label.`);
  if (index > 0) {
    assert.ok(
      stop.lapProgress > stops[index - 1].lapProgress,
      `Stop ${index} does not advance lapProgress.`,
    );
  }
  for (const channel of CHANNELS) {
    const tint = stop[channel];
    assert.ok(
      Array.isArray(tint) && tint.length === 3,
      `Stop ${index} ${channel} must be an [r, g, b] multiplier.`,
    );
    for (const value of tint) {
      assert.ok(
        Number.isFinite(value) && value > 0 && value <= 1.2,
        `Stop ${index} ${channel} multiplier ${value} is out of the sane range.`,
      );
    }
  }
}

// Stop 0 is the identity, which is what makes "no drift" and "menu" the same
// state as "start of the race" rather than a separate code path.
for (const channel of CHANNELS) {
  assert.deepEqual(
    stops[0][channel],
    [1, 1, 1],
    `Stop 0 ${channel} must be the identity multiplier [1, 1, 1].`,
  );
}
assert.equal(stops[0].hemisphereScale, 1, "Stop 0 hemisphereScale must be 1.");
assert.equal(stops[0].keyScale, 1, "Stop 0 keyScale must be 1.");

// Overcast day -> dusk: warmth (red over blue) rises monotonically, blue falls
// monotonically, and both light levels fall. Any stop that breaks the run turns
// the drift into a wander.
for (let index = 1; index < stops.length; index += 1) {
  const previousStop = stops[index - 1];
  const stop = stops[index];
  for (const channel of CHANNELS) {
    const warmthBefore = previousStop[channel][0] / previousStop[channel][2];
    const warmth = stop[channel][0] / stop[channel][2];
    assert.ok(
      warmth > warmthBefore,
      `${channel} does not warm from stop ${index - 1} to ${index} `
        + `(R/B ${warmthBefore.toFixed(4)} -> ${warmth.toFixed(4)}).`,
    );
    assert.ok(
      stop[channel][2] < previousStop[channel][2],
      `${channel} blue does not fall from stop ${index - 1} to ${index}.`,
    );
  }
  assert.ok(
    stop.hemisphereScale < previousStop.hemisphereScale,
    `hemisphereScale does not fall from stop ${index - 1} to ${index}.`,
  );
  assert.ok(
    stop.keyScale < previousStop.keyScale,
    `keyScale does not fall from stop ${index - 1} to ${index}.`,
  );
}

// The drift must be unmistakable across a 5-lap race but subtle lap to lap.
const lapMid = (lap, totalLaps) => (lap - 1 + 0.5) / totalLaps;
const tintAt = (drift) => evaluateTimeOfDay(stops, drift, createTimeOfDayTint());
const lapOne = tintAt(lapMid(1, 5));
const lapTwo = tintAt(lapMid(2, 5));
const lapFive = tintAt(lapMid(5, 5));
const warmth = (tint) => tint.keyR / tint.keyB;
assert.ok(
  warmth(lapFive) / warmth(lapOne) >= 1.35,
  `Lap 1 to lap 5 only warms the key by `
    + `${(warmth(lapFive) / warmth(lapOne)).toFixed(3)}x; the drift has to be `
    + "unmistakable across the race.",
);
assert.ok(
  warmth(lapTwo) / warmth(lapOne) <= 1.2,
  `One lap warms the key by ${(warmth(lapTwo) / warmth(lapOne)).toFixed(3)}x; `
    + "the drift is meant to be subtle lap to lap.",
);
assert.ok(
  lapFive.keyScale < 0.8 && lapFive.hemisphereScale < 0.9,
  "The last lap must genuinely lose light, not just change hue.",
);

// Continuity of the ramp itself: no stop-to-stop jump.
let previousWarmth = warmth(tintAt(0));
let maxRampStep = 0;
for (let drift = 0.001; drift <= 1; drift += 0.001) {
  const nextWarmth = warmth(tintAt(drift));
  maxRampStep = Math.max(maxRampStep, Math.abs(nextWarmth - previousWarmth));
  previousWarmth = nextWarmth;
}
assert.ok(
  maxRampStep < 0.01,
  `The ramp jumps ${maxRampStep.toFixed(5)} in warmth over 0.001 of lapProgress.`,
);

/* -- reduced motion and absent lap data zero the drift -- */

for (const lapProgress of [0, 0.25, 0.5, 0.999, 1]) {
  assert.equal(
    resolveTimeOfDayDrift(lapProgress, true),
    0,
    `Reduced motion must zero the drift (lapProgress ${lapProgress}).`,
  );
}
for (const absent of [null, undefined, Number.NaN]) {
  assert.equal(
    resolveTimeOfDayDrift(absent, false),
    0,
    "Absent lap data (menu / standby) must zero the drift.",
  );
}
assert.equal(resolveTimeOfDayDrift(1.4, false), 1, "Drift must clamp to 1.");
assert.equal(resolveTimeOfDayDrift(-0.2, false), 0, "Drift must clamp to 0.");

const zeroTint = tintAt(resolveTimeOfDayDrift(0.9, true));
assert.deepEqual(
  [zeroTint.keyR, zeroTint.keyG, zeroTint.keyB, zeroTint.keyScale, zeroTint.hemisphereScale],
  [1, 1, 1, 1, 1],
  "Zero drift must resolve to the identity tint, leaving the sector palette "
    + "exactly as authored.",
);

/* -- lap progress resolution mirrors game.ts's raceProgressFromStart -- */

const START_PROGRESS = 0.002;
assert.equal(
  resolveLapProgress("standby", 3, 5, 0.4, START_PROGRESS),
  null,
  "The pre-race standby screen has no lap data.",
);
assert.equal(
  resolveLapProgress("countdown", 1, 5, 0.002, START_PROGRESS),
  null,
  "Countdown has no lap data.",
);
assert.equal(
  resolveLapProgress("running", 1, 5, START_PROGRESS, START_PROGRESS),
  0,
  "The green light must sit at drift 0.",
);
assert.ok(
  Math.abs(resolveLapProgress("running", 3, 5, START_PROGRESS, START_PROGRESS) - 0.4)
    < 1e-9,
  "Lap 3 of 5 at the start line must be 0.4 through the race.",
);
// Wrapping behind the start line must not read as "nearly finished".
assert.ok(
  Math.abs(
    resolveLapProgress("running", 1, 5, 0.001, START_PROGRESS) - (0.999 / 5),
  ) < 1e-9,
  "Progress just behind the start line must wrap forward, not go negative.",
);
assert.equal(
  resolveLapProgress("finished", 5, 5, START_PROGRESS, START_PROGRESS),
  0.8,
  "The finished phase must keep reporting drift rather than snapping back.",
);
assert.equal(
  resolveLapProgress("running", 1, 0, 0.5, START_PROGRESS),
  null,
  "A zero-lap race has no drift to report.",
);

// game.ts must hand the atmosphere real lap data, and the reduced-motion flag
// at construction.
const gameSource = read("src/game/game.ts");
assert.ok(
  gameSource.includes(
    "this.atmosphere.updateFog(delta, this.progress, this.lap, this.totalLaps, this.phase);",
  ),
  "game.ts must pass lap, totalLaps and phase into atmosphere.updateFog.",
);
assert.ok(
  /new RaceAtmosphere\([^)]*this\.reducedMotion,/s.test(gameSource),
  "game.ts must hand the reduced-motion flag to RaceAtmosphere.",
);
assert.ok(
  gameSource.includes('readonly startProgress = 0.002;')
    || read("src/game/course.ts").includes("readonly startProgress = 0.002;"),
  "The start progress this validator pins against has moved; update it here too.",
);
assert.ok(
  gameSource.includes("atmosphere: this.atmosphere.diagnostics(),"),
  "game.ts must contribute the atmosphere diagnostics block.",
);
for (const field of [
  "keyDirection",
  "hangarFlickerActive",
  "hangarLampIntensity",
  "timeOfDayDrift",
]) {
  assert.ok(
    atmosphereSource.includes(`${field}:`),
    `atmosphere.diagnostics() must report \`${field}\`.`,
  );
}

console.log(
  "Lighting motion PASS: 12 normalized sector key directions, max "
    + `${maxDelta.toFixed(3)}°/m over ${samples} samples (budget `
    + `${MAX_ANGULAR_DELTA_DEGREES}°, worst at d=${maxDeltaAt} m, total swing `
    + `${totalSwing.toFixed(1)}°); seeded flicker deterministic over ${SOAK_TICKS} `
    + `ticks in [${minIntensity.toFixed(3)}, ${maxIntensity.toFixed(3)}] with `
    + `${fastDips} strikes and a ${(slowMaximum - slowMinimum).toFixed(3)} slow sag; `
    + `5-stop ramp warms ${(warmth(lapFive) / warmth(lapOne)).toFixed(2)}x lap 1 to `
    + "lap 5 and zeroes under reduced motion.",
);
