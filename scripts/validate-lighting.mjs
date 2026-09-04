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

// The legacy fixed sun is still the P4a fallback for any course that authors no
// sweep. Bitterpan used it until P8; the constant itself must not move.
assert.deepEqual(
  DEFAULT_KEY_DIRECTION,
  SECTOR_KEY_DIRECTIONS.RUNWAY_START,
  "DEFAULT_KEY_DIRECTION must remain the legacy fixed sun.",
);

// P8 replaced Bitterpan's three copies of that fixed sun with an authored sweep
// in BITTERPAN_PRODUCTION.json. The placeholder assertion here used to count
// `keyDirection:` literals in the course source; now that the directions are
// data, assert the data instead — and assert it is a genuine swing rather than
// three copies of the default wearing an authored label.
const bitterpanSource = read("src/game/bitterpan-course.ts");
const bitterpanProfiles = JSON.parse(
  read("src/game/data/map02/BITTERPAN_PRODUCTION.json"),
).lighting.profiles;
assert.equal(
  bitterpanProfiles.length,
  3,
  "All three Bitterpan sectors must author a lighting profile.",
);
for (const profile of bitterpanProfiles) {
  const direction = profile.keyDirection;
  assert.ok(direction, `Bitterpan sector ${profile.sector} declares no keyDirection.`);
  const length = Math.hypot(direction.x, direction.y, direction.z);
  assert.ok(
    Math.abs(length - 1) <= 1e-5,
    `Bitterpan ${profile.sector} keyDirection is not normalized (${length.toFixed(8)}).`,
  );
  assert.ok(
    direction.y > 0,
    `Bitterpan ${profile.sector} keyDirection points at or below the horizon.`,
  );
  assert.notDeepEqual(
    direction,
    { x: DEFAULT_KEY_DIRECTION.x, y: DEFAULT_KEY_DIRECTION.y, z: DEFAULT_KEY_DIRECTION.z },
    `Bitterpan ${profile.sector} is still the pre-P8 fixed sun.`,
  );
}
for (let index = 1; index < bitterpanProfiles.length; index += 1) {
  assert.notDeepEqual(
    bitterpanProfiles[index].keyDirection,
    bitterpanProfiles[index - 1].keyDirection,
    "consecutive Bitterpan sectors must move the sun, or there is no sweep.",
  );
}
// ...and the authored sweep has to reach the light through the same crossfade
// Greenwater uses, or it is data nothing reads.
assert.ok(
  bitterpanSource.includes("lerpKeyDirection("),
  "BitterpanCourse.lightingAt must crossfade its key direction through "
    + "lerpKeyDirection, the same path Greenwater takes.",
);
assert.ok(
  bitterpanSource.includes("target.keyDirection")
    || bitterpanSource.includes("target.keyDirection,"),
  "BitterpanCourse.lightingAt must write the crossfaded direction into its scratch.",
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

/* ------------------------------------------------------------------ */
/* 6. P11 key/fill rebalance                                            */
/* ------------------------------------------------------------------ */

// NEW in P11, not a re-baseline: nothing here was previously pinned, which is
// how the lap ended up with a hemisphere fill sitting within a whisker of the
// key in every sector — lighting with no shadow side and therefore no form.
// These assertions state the *relationship* the regrade established rather than
// each number, so a future palette pass can move hues freely and only fails if
// it flattens the lighting again.
function paletteNumbers(field) {
  return [...paletteBlock.matchAll(new RegExp(`${field}: ([0-9.]+),`, "g"))]
    .map((match) => Number(match[1]));
}
const keyIntensities = paletteNumbers("keyIntensity");
const hemisphereIntensities = paletteNumbers("hemisphereIntensity");
assert.equal(keyIntensities.length, 12, "Every sector must author a keyIntensity.");
assert.equal(
  hemisphereIntensities.length,
  12,
  "Every sector must author a hemisphereIntensity.",
);
// The pre-P11 palette, kept so the regrade is checkable rather than asserted.
// Ten sectors took one uniform ratio shift — key x1.18, hemisphere x0.82,
// rounded to 2dp — which lifts modelling without touching hue identity. Two
// were authored by hand because they were the specific complaints: HANGAR_SIX
// was muddy, and GREENWATER_SWEEP's 12 degree camber had no shadow side to read
// against. A future palette pass re-baselines BOTH tables together.
const PRE_P11_PALETTE = {
  RUNWAY_START: [1.75, 1.45],
  T1_CRADLE_BEND: [1.7, 1.5],
  WATER_TABLE: [1.5, 1.55],
  LINK_APRON: [1.45, 1.45],
  HANGAR_SIX: [0.85, 1],
  HANGAR_EXIT: [1.3, 1.2],
  GREENWATER_SWEEP: [1.6, 1.65],
  CANOPY_PASSAGE: [1.2, 1.7],
  THE_ELBOW: [1.4, 1.6],
  FUEL_ROW: [1.6, 1.35],
  T10_TOTEM_TURN: [1.25, 1.15],
  RUNWAY_HOME: [1.8, 1.5],
};
const P11_KEY_FACTOR = 1.18;
const P11_HEMISPHERE_FACTOR = 0.82;
const P11_AUTHORED = {
  HANGAR_SIX: [1.25, 0.8],
  GREENWATER_SWEEP: [1.95, 1.2],
};
const round2 = (value) => Number(value.toFixed(2));
let shiftedSectors = 0;
for (let index = 0; index < 12; index += 1) {
  const sector = authored[index].sector;
  const before = PRE_P11_PALETTE[sector];
  assert.ok(before, `No pre-P11 baseline recorded for ${sector}.`);
  const [key, hemisphere] = P11_AUTHORED[sector] ?? [
    round2(before[0] * P11_KEY_FACTOR),
    round2(before[1] * P11_HEMISPHERE_FACTOR),
  ];
  // 0.01 of slack, not sloppiness: 1.75 x 1.18 and 1.25 x 1.18 both land exactly
  // on a 2dp tie (2.065, 1.475), where half-up and IEEE-754 `toFixed` disagree.
  // The tolerance is one unit in the last authored place, so a real palette edit
  // still fails.
  assert.ok(
    Math.abs(keyIntensities[index] - key) <= 0.01 + 1e-9,
    `${sector} keyIntensity is ${keyIntensities[index]}, expected ~${key}.`,
  );
  assert.ok(
    Math.abs(hemisphereIntensities[index] - hemisphere) <= 0.01 + 1e-9,
    `${sector} hemisphereIntensity is ${hemisphereIntensities[index]}, `
      + `expected ~${hemisphere}.`,
  );
  // The point of the pass, stated as a relationship so it survives a re-tint:
  // every sector's key must have gained on its fill.
  const ratioBefore = before[0] / before[1];
  const ratioAfter = keyIntensities[index] / hemisphereIntensities[index];
  assert.ok(
    ratioAfter > ratioBefore,
    `${sector} did not gain key over fill (${ratioBefore.toFixed(2)} -> `
      + `${ratioAfter.toFixed(2)}). A flat sector is the P11 complaint.`,
  );
  if (!P11_AUTHORED[sector]) shiftedSectors += 1;
}
assert.equal(shiftedSectors, 10, "Exactly ten sectors take the uniform shift.");
assert.equal(
  Number(
    paletteBlock
      .slice(paletteBlock.indexOf('sector: "HANGAR_SIX"'))
      .match(/fogDensity: ([0-9.]+),/)[1],
  ),
  0.0036,
  "HANGAR_SIX fog was thinned 0.0042 -> 0.0036 in P11; the shell was muddy.",
);

// The rim was standing in for the key. Pinned so a future pass cannot quietly
// hand the job back to it and re-flatten everything above.
const rimBoost = Number(
  atmosphereSource.match(/const RIM_PRESENCE_BOOST = ([0-9.]+);/)[1],
);
assert.ok(
  rimBoost <= 1.4,
  `RIM_PRESENCE_BOOST is ${rimBoost}; above 1.4 the rim out-reads the key again `
    + "(P11 took it from 1.85 to 1.35).",
);

// Hangar fixtures. Three lamps down the shell rather than two at the quarter
// points: two left the middle third dark. Every lamp must sit inside the
// authored [618, 816] range, and its falloff must die before the shell mouth or
// it leaks onto LINK_APRON / HANGAR_EXIT.
const lampDistances = atmosphereSource
  .match(/const HANGAR_LAMP_DISTANCES_METRES = \[([^\]]+)\]/)[1]
  .split(",")
  .map((value) => Number(value.trim()));
const lampRange = Number(
  atmosphereSource.match(/const HANGAR_LAMP_RANGE_METRES = ([0-9.]+);/)[1],
);
const lampPeak = Number(
  atmosphereSource.match(/const HANGAR_LAMP_PEAK_INTENSITY = ([0-9.]+);/)[1],
);
assert.ok(
  lampDistances.length >= 3,
  `${lampDistances.length} hangar lamps over `
    + `${HANGAR_LAMP_TO_METRES - HANGAR_LAMP_FROM_METRES} m leaves a dark band.`,
);
for (const distance of lampDistances) {
  assert.ok(
    isInsideHangarRange(distance),
    `Hangar lamp at d=${distance} m sits outside the authored shell.`,
  );
}
// Coverage is a 3-D question, not an along-track one: the lamps hang
// HANGAR_LAMP_HEIGHT_METRES above the deck, so a `distance` of R only reaches
// sqrt(R^2 - h^2) along the deck. The pre-P11 pair left the shell's middle
// third at 94% of range — all but fully attenuated — which is the dark band
// the third fixture exists to fill.
const lampHeight = Number(
  atmosphereSource.match(/const HANGAR_LAMP_HEIGHT_METRES = ([0-9.]+);/)[1],
);
const deckReach = Math.sqrt(lampRange * lampRange - lampHeight * lampHeight);
assert.ok(deckReach > 0, "The lamps must reach the deck they hang over.");
let darkestFraction = 0;
for (let index = 1; index < lampDistances.length; index += 1) {
  const gap = lampDistances[index] - lampDistances[index - 1];
  assert.ok(gap > 0, "Hangar lamp distances must be authored in order.");
  const midpoint = Math.hypot(gap / 2, lampHeight);
  darkestFraction = Math.max(darkestFraction, midpoint / lampRange);
  assert.ok(
    midpoint / lampRange <= 0.8,
    `The deck midway between the lamps at ${lampDistances[index - 1]} m and `
      + `${lampDistances[index]} m sits at ${(midpoint / lampRange * 100).toFixed(0)}% `
      + "of the lamp range, i.e. all but unlit. Add a fixture or extend the range.",
  );
}
// The falloff no longer dies inside the shell. Recorded, not forbidden: three
// lamps that cover the middle cannot also be contained, and the lamps are only
// visible while the player is inside anyway. Pinned so the spill cannot grow
// unnoticed into a pop the player sees on the way out.
const spillBefore = HANGAR_LAMP_FROM_METRES - (lampDistances[0] - deckReach);
const spillAfter = lampDistances.at(-1) + deckReach - HANGAR_LAMP_TO_METRES;
assert.ok(
  Math.max(spillBefore, spillAfter) < 45,
  `The hangar lamps reach ${Math.max(spillBefore, spillAfter).toFixed(1)} m past `
    + "the shell mouth. Beyond ~45 m the spill is wider than the exit sector.",
);
assert.ok(
  lampPeak > 0 && lampPeak * HANGAR_FLICKER_MIN > 0,
  "The flicker floor must still light the shell.",
);
// The fixture geometry has to read lit, or the lamps have no visible source.
const courseFixtureColor = courseSource.match(
  /const sodiumMaterial = new THREE\.MeshBasicMaterial\(\{\s*color: (0x[0-9a-f]+),/,
);
const lampColor = atmosphereSource.match(
  /const HANGAR_LAMP_COLOR = (0x[0-9a-f]+);/,
);
assert.ok(courseFixtureColor, "course.ts must build the hangar lamp strips.");
assert.equal(
  courseFixtureColor[1],
  lampColor[1],
  "The hangar lamp strips must be the same colour as the PointLights they "
    + "stand for, or the fixture reads as unlit metal under a lit pool.",
);

/* ------------------------------------------------------------------ */
/* 8. P20.5 — the sky dome is authored, and is not the fog              */
/* ------------------------------------------------------------------ */

// The point of P20.5 is that the framed sky stopped being a wash of the
// ground's own hue. That is a claim about NUMBERS — a haze cooler than the fog
// under it, a zenith darker than the haze, a hue that is not the pan's — so it
// is pinned here rather than left to a screenshot nobody re-takes.

const sky = await import("../src/game/sky-profile.js");

function channels(hex) {
  return [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
}
/** Rec.709 luma of an sRGB hex, 0-255. Used for ordering, never as a target. */
function hexLuma(hex) {
  const [r, g, b] = channels(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
/** HSV hue in degrees. */
function hexHue(hex) {
  const [r, g, b] = channels(hex).map((value) => value / 255);
  const max = Math.max(r, g, b);
  const delta = max - Math.min(r, g, b);
  if (delta < 1e-6) return 0;
  let hue;
  if (max === r) hue = ((g - b) / delta) % 6;
  else if (max === g) hue = (b - r) / delta + 2;
  else hue = (r - g) / delta + 4;
  return (((hue * 60) % 360) + 360) % 360;
}
/** How blue a colour is over how red it is, in 0-255 sRGB. */
function coolness(hex) {
  const [r, , b] = channels(hex);
  return b - r;
}
const hexString = (value) => `#${value.toString(16).padStart(6, "0")}`;

// --- The Bitterpan table in sky-profile.js MIRRORS the map JSON. atmosphere.ts
// cannot import the map (a 12 KiB lazy chunk) without dragging it into the
// initial shell, which validate-build holds to 226 KiB gzip. The mirror is
// allowed; the drift is not. The JSON is the authoring surface and this is what
// makes that true.
assert.equal(
  sky.BITTERPAN_SKY_ZONES.length,
  bitterpanProfiles.length,
  "sky-profile.js and BITTERPAN_PRODUCTION.json disagree on how many sectors "
    + "Bitterpan has.",
);
for (let index = 0; index < bitterpanProfiles.length; index += 1) {
  const authoredSky = bitterpanProfiles[index];
  const mirrored = sky.BITTERPAN_SKY_ZONES[index];
  assert.equal(
    mirrored.sector,
    authoredSky.sector,
    `sky-profile.js zone ${index} is ${mirrored.sector}; the map says `
      + `${authoredSky.sector}.`,
  );
  assert.equal(
    mirrored.distance,
    authoredSky.distance,
    `${authoredSky.sector} sky zone starts at ${mirrored.distance} m in `
      + `sky-profile.js and ${authoredSky.distance} m in the map.`,
  );
  for (const [field, jsonKey] of [["horizon", "skyHorizon"], ["zenith", "skyZenith"]]) {
    assert.ok(
      typeof authoredSky[jsonKey] === "string",
      `Bitterpan ${authoredSky.sector} authors no ${jsonKey}. P20.5 requires one `
        + "per sector.",
    );
    assert.equal(
      hexString(mirrored[field]),
      authoredSky[jsonKey].toLowerCase(),
      `Bitterpan ${authoredSky.sector} ${jsonKey} is ${authoredSky[jsonKey]} in the `
        + `map and ${hexString(mirrored[field])} in sky-profile.js. The mirror has `
        + "drifted; the map is the authoring surface.",
    );
  }
  assert.equal(
    mirrored.blendDegrees,
    authoredSky.skyHorizonBlendDegrees,
    `Bitterpan ${authoredSky.sector} sky blend disagrees between map and mirror.`,
  );
}

// --- Greenwater's sky zones mirror the sector distances in course.ts, so the
// sky changes sector on the same metre the palette and the fog do. A sector
// added to one table and not the other is the failure this catches.
assert.deepEqual(
  sky.GREENWATER_SKY_ZONES.map((zone) => zone.sector),
  authored.map((zone) => zone.sector),
  "GREENWATER_SKY_ZONES and SECTOR_PALETTE_DEFINITIONS disagree on the sectors "
    + "or their order around the lap.",
);
for (let index = 0; index < authored.length; index += 1) {
  assert.equal(
    sky.GREENWATER_SKY_ZONES[index].distance,
    authored[index].distance,
    `${authored[index].sector} starts at ${authored[index].distance} m in course.ts `
      + "but somewhere else in sky-profile.js; the sky would change sector on a "
      + "different metre from the light.",
  );
}

// --- The relations the phase is actually about, per sector, on both maps.
const fogByBitterpanSector = new Map(
  bitterpanProfiles.map((profile) => [
    profile.sector,
    Number.parseInt(profile.fog.color.slice(1), 16),
  ]),
);
const greenwaterFogHex = [...paletteBlock.matchAll(/\n\s*fog: (0x[0-9a-f]+),/g)]
  .map((match) => Number.parseInt(match[1], 16));
assert.equal(
  greenwaterFogHex.length,
  12,
  "Expected 12 Greenwater sector fogs to compare the sky against, found "
    + `${greenwaterFogHex.length}.`,
);

for (const [label, zones, fogs] of [
  [
    "Bitterpan",
    sky.BITTERPAN_SKY_ZONES,
    sky.BITTERPAN_SKY_ZONES.map((zone) => fogByBitterpanSector.get(zone.sector)),
  ],
  ["Greenwater", sky.GREENWATER_SKY_ZONES, greenwaterFogHex],
]) {
  for (let index = 0; index < zones.length; index += 1) {
    const zone = zones[index];
    const fog = fogs[index];
    assert.ok(
      hexLuma(zone.zenith) < hexLuma(zone.horizon) - 20,
      `${label} ${zone.sector}: the zenith (${hexLuma(zone.zenith).toFixed(0)}) is not `
        + `clearly darker than the haze (${hexLuma(zone.horizon).toFixed(0)}). Without `
        + "that drop the dome is a flat wash again.",
    );
    assert.ok(
      coolness(zone.horizon) > coolness(fog),
      `${label} ${zone.sector}: the haze is not cooler than the sector fog `
        + `(${coolness(zone.horizon)} vs ${coolness(fog)}). A haze at the fog's own `
        + "temperature is the coupling P20.5 exists to break.",
    );
    // Where the sector fog is WARM — the khaki that made Bitterpan's sky read
    // as more pan — the haze has to leave that hue entirely. 60 degrees is a
    // whole sextant of the wheel and still allows a green-grey sky.
    //
    // Greenwater's fogs are already cool greys and greens (RUNWAY_START is
    // hue 197), so a hue-separation rule there would only force the sky away
    // from a temperature it is supposed to share. `coolness` above is the
    // assertion that carries those sectors.
    const fogHue = hexHue(fog);
    const fogIsWarm = fogHue < 90 || fogHue > 300;
    if (fogIsWarm) {
      const separation = Math.abs(((hexHue(zone.horizon) - fogHue + 540) % 360) - 180);
      assert.ok(
        separation > 60,
        `${label} ${zone.sector}: haze hue ${hexHue(zone.horizon).toFixed(0)} deg is `
          + `only ${separation.toFixed(0)} deg from the warm fog's `
          + `${fogHue.toFixed(0)} deg. That is the sky wearing the ground's pigment.`,
      );
    }
    assert.ok(
      zone.blendDegrees >= 12 && zone.blendDegrees <= 26,
      `${label} ${zone.sector}: sky blend ${zone.blendDegrees} deg is outside the `
        + "12-26 deg band the chase camera frames.",
    );
  }
}

// Bitterpan is a salt pan at noon: its sky is blue-grey, not the green-grey
// Greenwater's humidity earns. Measured over 13 stations at 1280x720, the framed
// upper sky reads 195-204 degrees with these values.
for (const zone of sky.BITTERPAN_SKY_ZONES) {
  for (const field of ["horizon", "zenith"]) {
    const hue = hexHue(zone[field]);
    assert.ok(
      hue >= 185 && hue <= 235,
      `Bitterpan ${zone.sector} ${field} hue ${hue.toFixed(0)} deg is outside the `
        + "185-235 deg blue-grey band the pan's sky is authored to.",
    );
  }
}
for (const zone of sky.GREENWATER_SKY_ZONES) {
  for (const field of ["horizon", "zenith"]) {
    const hue = hexHue(zone[field]);
    assert.ok(
      hue >= 140 && hue <= 235,
      `Greenwater ${zone.sector} ${field} hue ${hue.toFixed(0)} deg is outside the `
        + "140-235 deg green-grey to blue-grey band.",
    );
  }
}

// --- The cloud band. The coverage bands are the brief's; the drift ceiling is
// what keeps a sky from reading as a scrolling texture.
assert.ok(
  sky.CLOUD_PROFILES.greenwater.coverage >= 0.45
    && sky.CLOUD_PROFILES.greenwater.coverage <= 0.6,
  `Greenwater cloud coverage ${sky.CLOUD_PROFILES.greenwater.coverage} is outside `
    + "the authored 0.45-0.6 overcast band.",
);
assert.ok(
  sky.CLOUD_PROFILES.bitterpan.coverage >= 0.15
    && sky.CLOUD_PROFILES.bitterpan.coverage <= 0.3,
  `Bitterpan cloud coverage ${sky.CLOUD_PROFILES.bitterpan.coverage} is outside the `
    + "authored 0.15-0.3 sparse-dust band.",
);
for (const [map, profile] of Object.entries(sky.CLOUD_PROFILES)) {
  assert.ok(
    profile.driftPerSecond > 0
      && profile.driftPerSecond <= sky.CLOUD_MAX_DRIFT_PER_SECOND,
    `${map} cloud drift ${profile.driftPerSecond}/s is not inside `
      + `(0, ${sky.CLOUD_MAX_DRIFT_PER_SECOND}] turns per second.`,
  );
  assert.ok(
    Number.isInteger(profile.azimuthPeriod),
    `${map} cloud azimuthPeriod ${profile.azimuthPeriod} is not an integer; the `
      + "value-noise lattice would not wrap and the sky would seam at due east.",
  );
  assert.ok(
    profile.seed % 1 !== 0,
    `${map} cloud seed ${profile.seed} is a whole turn, which multiplies into a `
      + "whole number of lattice cells and therefore seeds nothing.",
  );
  assert.ok(
    profile.lowDegrees >= 3 && profile.highDegrees <= 32,
    `${map} cloud band ${profile.lowDegrees}-${profile.highDegrees} deg escapes the `
      + "4-30 deg window the brief confines it to.",
  );
}
assert.notEqual(
  sky.CLOUD_PROFILES.greenwater.azimuthPeriod,
  sky.CLOUD_PROFILES.bitterpan.azimuthPeriod,
  "Both maps sample the cloud lattice at the same period, so they would show the "
    + "same sky rotated. Give them different periods.",
);
// P20.5 round 2. Round 1 authored the horizontal and vertical cloud frequencies
// independently, which landed at roughly 1:1 and read as soft round blobs —
// smoke or a storm front, not the high cirrus and blown dust the two maps are
// about. The vertical frequency is derived from `stretch` in the shader now, so
// this is the number that decides the shape.
for (const [map, profile] of Object.entries(sky.CLOUD_PROFILES)) {
  assert.ok(
    profile.stretch >= 4 && profile.stretch <= 8,
    `${map} cloud stretch ${profile.stretch} is outside 4-8. Under 4 the band `
      + "reads as blobs; over 8 it reads as scan lines.",
  );
}

// --- ...and the sky reaches the dome. Data nothing reads is not a feature.
for (const needle of [
  "skyZonesFor(course.kind)",
  "this.updateSkyPalette(distanceMetres, tint, response)",
  "uniform vec3 hazeColor;",
  "mix(sqrt(hazeColor), sqrt(topColor)",
  "skyRamp.x",
  // Round 2: the cloud may only ADD light, and never past the haze it sits
  // under. That single expression is what makes it brighter than the zenith and
  // never darker than the horizon by construction rather than by tuning, and it
  // is what took the storm-front look out of the upper frame.
  "color += min(add, max(hazeColor - color, vec3(0.0)));",
  "elevation * cloudShape.w * cloudStretch / 360.0",
]) {
  assert.ok(
    atmosphereSource.includes(needle),
    `atmosphere.ts no longer contains \`${needle}\`; the authored sky is not `
      + "reaching the dome.",
  );
}
// The sun is part of the dome now rather than a mesh in the transparent queue.
// That is the fix for the occlusion leak — measured inside HANGAR_SIX with the
// sun forced to screen centre, 262 of its pixels drew over opaque geometry
// before and 8 after — and a build that puts the mesh back reintroduces it.
assert.ok(
  !atmosphereSource.includes("createSunDisc"),
  "atmosphere.ts is building a separate sun-disc mesh again. A transparent mesh "
    + "at renderOrder -999 is drawn before every other transparent surface and "
    + "cannot be occluded by anything that does not write depth.",
);
assert.ok(
  atmosphereSource.includes("dot(dir, sunDirection)"),
  "The sun must be painted inside the dome's fragment shader, where every "
    + "surface in the scene covers it.",
);
// Reduced motion must be able to stop the sky, not merely slow it.
assert.ok(
  /if \(!reducedMotion\) \{\s*\n\s*this\.cloudPhase \+= delta \* this\.cloudProfile\.driftPerSecond;/
    .test(atmosphereSource),
  "The cloud drift phase must only advance when reduced motion is off.",
);

/* ------------------------------------------------------------------ */
/* 9. H3 — the Hangar Six steam vents are steam, not a floating rock     */
/* ------------------------------------------------------------------ */

// The vents live here because their WARNING LAMPS do: the lamp cycle above is
// the vent's telegraph, and the puff shares its clock. What is asserted is the
// half of the vent that was reported as a defect — the puff read as a solid
// grey lump at eye height on the LINK_APRON approach, because it was a
// flat-shaded `DodecahedronGeometry` with a hard silhouette. It is a soft
// camera-facing card now, and three properties keep it one:
//
//  a. NO SILHOUETTE. The sheet is generated from the STEAM cell's own measured
//     radial alpha, and that profile has to reach the rim at nothing. A profile
//     that ended on a step would put an edge back on the card.
//  b. NOT OPAQUE. Six cards overlap almost entirely, so the ceiling that
//     matters is the PLUME's, not one card's. This re-runs the composite walk
//     `scripts/visual/steam-puff-stack.mjs` documents, against the constants
//     parsed out of `course.ts`, so raising the envelope peak fails here.
//  c. STILL AN OVERLAY. `corridor-sweep.ts` classifies by `transparent` +
//     `depthWrite: false` and by nothing else; a puff material that started
//     writing depth would become a corridor obstacle, silently.
//
// Read out of the source rather than restated, for the same reason the sector
// palettes above are: two copies of 0.155 is how a number drifts.

const { measureSteamPlume } = await import("./visual/steam-puff-stack.mjs");

const steamNumber = (name) => {
  const match = courseSource.match(
    new RegExp(`const ${name} = (-?\\d+(?:\\.\\d+)?);`),
  );
  assert.ok(match, `course.ts must declare ${name}.`);
  return Number(match[1]);
};
const steamStops = (() => {
  const match = courseSource.match(
    /const STEAM_CELL_RADIAL_ALPHA = \[([\s\S]*?)\] as const;/,
  );
  assert.ok(match, "course.ts must declare the measured STEAM_CELL_RADIAL_ALPHA.");
  return match[1].split(",").map((raw) => raw.trim()).filter(Boolean).map(Number);
})();

assert.equal(
  steamStops.length,
  16,
  "The STEAM cell profile is sixteen annulus means; a different length means "
    + "the measurement in course.ts and the walk here no longer agree.",
);
assert.equal(steamStops[0], 1, "The profile is normalised to 1 at the centre.");
for (let index = 1; index < steamStops.length; index += 1) {
  assert.ok(
    steamStops[index] < steamStops[index - 1],
    `The STEAM profile must fall monotonically; stop ${index} does not. A rise `
      + "anywhere in it is a ring, and a ring is an edge.",
  );
}
assert.ok(
  steamStops[steamStops.length - 1] <= 0.05,
  `The profile reaches the rim at ${steamStops[steamStops.length - 1]}. Anything `
    + "the eye can see there is the card's own boundary, which is exactly the "
    + "hard silhouette this repair removed.",
);

const steamPlumeCeiling = Number(
  courseSource.match(/export const STEAM_PLUME_PEAK_ALPHA = (\d+(?:\.\d+)?);/)?.[1],
);
assert.ok(
  steamPlumeCeiling > 0,
  "course.ts must export STEAM_PLUME_PEAK_ALPHA, the ceiling this holds.",
);
const steamVents = blockout.hazards.filter((hazard) => hazard.type === "steam_vent");
assert.ok(steamVents.length > 0, "Greenwater must still author steam vents.");
const steamOptions = {
  peakAlpha: steamNumber("STEAM_PUFF_PEAK_ALPHA"),
  lifeSeconds: steamNumber("STEAM_PUFF_LIFE_SECONDS"),
  intervalSeconds: steamNumber("STEAM_PUFF_SPAWN_INTERVAL_SECONDS"),
  puffsPerVent: steamNumber("STEAM_PUFFS_PER_VENT"),
  birthMetres: steamNumber("STEAM_PUFF_BIRTH_METRES"),
  deathMetres: steamNumber("STEAM_PUFF_DEATH_METRES"),
  riseMetresPerSecond: steamNumber("STEAM_PUFF_RISE_METRES_PER_SECOND"),
  baseHeightMetres: steamNumber("STEAM_PUFF_BASE_HEIGHT_METRES"),
  driftMetresPerSecond: steamNumber("STEAM_PUFF_DRIFT_METRES_PER_SECOND"),
  // The tightest vent on the map: the shortest cycle and the longest telegraph
  // leave the least room, so the cycle that has to fit is that one.
  telegraphSeconds: Math.max(...steamVents.map((vent) => vent.telegraphSeconds ?? 1)),
  cycleSeconds: Math.min(...steamVents.map((vent) => vent.cycleSeconds ?? 4)),
  stops: steamStops,
};
const steamPlume = measureSteamPlume(steamOptions);
assert.ok(
  steamPlume.plumeAlpha <= steamPlumeCeiling,
  `The Hangar Six plume composites to ${steamPlume.plumeAlpha.toFixed(3)} at `
    + `${steamPlume.at?.heightMetres} m, over the ${steamPlumeCeiling} ceiling. `
    + "Six cards 0.24 m apart and 1.2-3.2 m across overlap almost entirely, so "
    + "the envelope peak a reviewer reads is NOT what the player sees: at 0.45 "
    + "per card the plume reaches 0.857 and reads as a grey wall. Re-find the "
    + "card peak with `node scripts/visual/steam-puff-stack.mjs <peak>` rather "
    + "than raising this ceiling.",
);
assert.ok(
  steamPlume.cardAlpha < steamPlumeCeiling,
  "One card must stay under the plume ceiling on its own.",
);
const steamLastDeath = steamOptions.telegraphSeconds
  + (steamOptions.puffsPerVent - 1) * steamOptions.intervalSeconds
  + steamOptions.lifeSeconds;
assert.ok(
  steamLastDeath <= steamOptions.cycleSeconds,
  `The last puff of a burst dies at ${steamLastDeath.toFixed(2)} s of a `
    + `${steamOptions.cycleSeconds} s cycle. Past the wrap it is cut off `
    + "mid-dissolve — a hard edge in time, which is the same defect as a hard "
    + "edge in space.",
);
// The overlay contract `corridor-sweep.ts` reads, and the shape that has no
// silhouette to begin with.
const steamMaterial = courseSource.match(
  /const puffMaterial = new THREE\.MeshBasicMaterial\(\{[\s\S]*?\n {6}\}\);/,
);
assert.ok(steamMaterial, "course.ts must build the steam puff material.");
assert.ok(
  /transparent: true,/.test(steamMaterial[0])
    && /depthWrite: false,/.test(steamMaterial[0]),
  "The puff material must stay transparent with depthWrite false, or "
    + "corridor-sweep.ts stops classifying it as a non-occluding overlay and "
    + "the vent becomes an obstacle standing beside the deck.",
);
assert.ok(
  /map: createSteamPuffTexture\(\)/.test(steamMaterial[0]),
  "The puff must be a textured card. A bare quad has the straight edges the "
    + "polyhedron had, on four sides instead of twelve.",
);
assert.ok(
  // `new THREE.` rather than the bare name: the comment in `course.ts` names
  // the defect it replaced, and a rule that forbids describing a defect is a
  // rule that gets worked around by deleting the description.
  !/new THREE\.DodecahedronGeometry/.test(courseSource),
  "H3: the Hangar Six puff was a flat-shaded DodecahedronGeometry, which the "
    + "player read as a rock hanging over the road. Nothing in the Greenwater "
    + "course draws one now.",
);

console.log(
  `H3 PASS: ${steamVents.length} Greenwater steam vents; card envelope peaks at `
    + `${steamPlume.cardAlpha.toFixed(3)} and the plume composites to `
    + `${steamPlume.plumeAlpha.toFixed(3)} (ceiling ${steamPlumeCeiling}) at `
    + `${steamPlume.at?.heightMetres} m with ${steamPlume.at?.liveCards} cards live; `
    + `the burst clears its ${steamOptions.cycleSeconds} s cycle by `
    + `${(steamOptions.cycleSeconds - steamLastDeath).toFixed(2)} s; sheet falls `
    + `${steamStops[0]} -> ${steamStops[steamStops.length - 1]} to the rim.`,
);

console.log(
  "Lighting motion PASS: 12 normalized sector key directions, max "
    + `${maxDelta.toFixed(3)}°/m over ${samples} samples (budget `
    + `${MAX_ANGULAR_DELTA_DEGREES}°, worst at d=${maxDeltaAt} m, total swing `
    + `${totalSwing.toFixed(1)}°); seeded flicker deterministic over ${SOAK_TICKS} `
    + `ticks in [${minIntensity.toFixed(3)}, ${maxIntensity.toFixed(3)}] with `
    + `${fastDips} strikes and a ${(slowMaximum - slowMinimum).toFixed(3)} slow sag; `
    + `5-stop ramp warms ${(warmth(lapFive) / warmth(lapOne)).toFixed(2)}x lap 1 to `
    + `lap 5 and zeroes under reduced motion; P11 regrade verified on all 12 `
    + `sectors (${shiftedSectors} x${P11_KEY_FACTOR}/x${P11_HEMISPHERE_FACTOR}, `
    + `2 authored, rim boost ${rimBoost}), ${lampDistances.length} hangar lamps `
    + `at ${lampDistances.join("/")} m over a ${lampRange} m range `
    + `(darkest deck point ${(darkestFraction * 100).toFixed(0)}% of range, `
    + `spill ${spillBefore.toFixed(1)}/${spillAfter.toFixed(1)} m past the mouths); `
    + `P20.5 sky authored on ${sky.BITTERPAN_SKY_ZONES.length} Bitterpan and `
    + `${sky.GREENWATER_SKY_ZONES.length} Greenwater sectors, every haze cooler than `
    + "its own fog and every zenith 20+ luma under its haze; cloud coverage "
    + `${sky.CLOUD_PROFILES.bitterpan.coverage}/${sky.CLOUD_PROFILES.greenwater.coverage} `
    + `drifting ${sky.CLOUD_PROFILES.bitterpan.driftPerSecond}/`
    + `${sky.CLOUD_PROFILES.greenwater.driftPerSecond} turns per second at `
    + `${sky.CLOUD_PROFILES.bitterpan.stretch}:1 and `
    + `${sky.CLOUD_PROFILES.greenwater.stretch}:1 stretch, adding light only.`,
);
