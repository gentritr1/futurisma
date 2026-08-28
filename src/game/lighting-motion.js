/**
 * P4a lighting motion — the pure half.
 *
 * `atmosphere.ts` owns the three.js objects; everything that decides *what the
 * light should be doing* lives here so `scripts/validate-lighting.mjs` can run
 * it in Node against the real authored numbers. Three motions:
 *
 * 1. a per-sector key **direction** that crossfades with the same
 *    `LIGHTING_CROSSFADE_METRES` machinery the sector colours already use;
 * 2. a seeded, deterministic hangar lamp flicker sampled on the existing 30 Hz
 *    atmosphere tick;
 * 3. a lap-based time-of-day ramp applied *multiplicatively* over the sector
 *    palette, so sector identity survives the drift.
 *
 * Everything here is allocation-free on the hot path: every function that
 * produces a vector or a tint writes into a caller-owned target.
 */

/**
 * @typedef {{ x: number, y: number, z: number }} LightVector
 *
 * @typedef {object} KeyDirectionZone
 * @property {number} distance metres around the lap where this zone starts
 * @property {LightVector} direction normalized key direction for the zone
 *
 * @typedef {object} HangarFlicker
 * @property {(tick: number) => number} slowComponent smooth sag layer, [0, 1]
 * @property {(tick: number) => number} fastComponent strike layer, [0, 1]
 * @property {(tick: number) => number} intensityAt combined lamp level
 *
 * @typedef {object} TimeOfDayStop
 * @property {number} lapProgress
 * @property {string} label
 * @property {readonly [number, number, number]} keyTint
 * @property {readonly [number, number, number]} skyTint
 * @property {readonly [number, number, number]} groundTint
 * @property {readonly [number, number, number]} fogTint
 * @property {number} hemisphereScale
 * @property {number} keyScale
 *
 * @typedef {object} TimeOfDayTint
 * @property {number} keyR
 * @property {number} keyG
 * @property {number} keyB
 * @property {number} skyR
 * @property {number} skyG
 * @property {number} skyB
 * @property {number} groundR
 * @property {number} groundG
 * @property {number} groundB
 * @property {number} fogR
 * @property {number} fogG
 * @property {number} fogB
 * @property {number} hemisphereScale
 * @property {number} keyScale
 */

/** Matches `ATMOSPHERE_UPDATE_INTERVAL_SECONDS` in course.ts — one 30 Hz tick. */
export const ATMOSPHERE_UPDATE_INTERVAL_SECONDS = 1 / 30;

/** Matches `LIGHTING_CROSSFADE_METRES` in course.ts. */
export const LIGHTING_CROSSFADE_METRES = 90;

/**
 * Authored sun/key direction per Greenwater sector, normalized, in world space.
 *
 * Read as elevation above the horizon and azimuth measured from +X toward -Z.
 * The sun stays plausibly one-sided all lap (azimuth 8°-52°, always east of the
 * strip) and drifts in elevation and azimuth as the route turns, so the light
 * swings rather than jumping. Two deliberate exceptions:
 *
 * - `LINK_APRON` already lifts toward the hangar so the 30 m link sector does
 *   not have to swallow the whole swing (it is the shortest crossfade window on
 *   the lap, and a big delta there would pop).
 * - `HANGAR_SIX` is an interior: a steep 74° roof-lantern key, not a sun.
 *   `HANGAR_EXIT` steps back out toward the open sky.
 *
 * `RUNWAY_START` / `RUNWAY_HOME` are the pre-P4a fixed direction
 * (`normalize(80, 130, -35)`) so the start line looks exactly as accepted and
 * the lap wrap is a zero-delta seam.
 */
export const SECTOR_KEY_DIRECTIONS = Object.freeze({
  // elevation 56.1°, azimuth 23.6° — the legacy fixed key, unchanged.
  RUNWAY_START: Object.freeze({ x: 0.510841, y: 0.830116, z: -0.223493 }),
  // elevation 53.0°, azimuth 32.0°
  T1_CRADLE_BEND: Object.freeze({ x: 0.510368, y: 0.798636, z: -0.318913 }),
  // elevation 49.0°, azimuth 41.0° — rakes low across the water sheet.
  WATER_TABLE: Object.freeze({ x: 0.495134, y: 0.754710, z: -0.430413 }),
  // elevation 61.0°, azimuth 33.0° — pre-lifted toward the hangar lantern.
  LINK_APRON: Object.freeze({ x: 0.406596, y: 0.874620, z: -0.264046 }),
  // elevation 74.0°, azimuth 29.0° — steep interior key.
  HANGAR_SIX: Object.freeze({ x: 0.241078, y: 0.961262, z: -0.133632 }),
  // elevation 61.0°, azimuth 21.0°
  HANGAR_EXIT: Object.freeze({ x: 0.452609, y: 0.874620, z: -0.173740 }),
  // elevation 51.0°, azimuth 14.0° — opens back onto the sweep.
  GREENWATER_SWEEP: Object.freeze({ x: 0.610627, y: 0.777146, z: -0.152246 }),
  // elevation 44.0°, azimuth 8.0° — low sun through the canopy.
  CANOPY_PASSAGE: Object.freeze({ x: 0.712339, y: 0.694658, z: -0.100113 }),
  // elevation 40.0°, azimuth 34.0° — the visible swing round the elbow.
  THE_ELBOW: Object.freeze({ x: 0.635080, y: 0.642788, z: -0.428367 }),
  // elevation 46.0°, azimuth 52.0° — sun well round down the long straight.
  FUEL_ROW: Object.freeze({ x: 0.427674, y: 0.719340, z: -0.547398 }),
  // elevation 52.0°, azimuth 40.0°
  T10_TOTEM_TURN: Object.freeze({ x: 0.471624, y: 0.788011, z: -0.395740 }),
  // elevation 56.1°, azimuth 23.6° — wraps back onto RUNWAY_START.
  RUNWAY_HOME: Object.freeze({ x: 0.510841, y: 0.830116, z: -0.223493 }),
});

/** Ordered sector names, matching `SECTOR_PALETTE_DEFINITIONS` in course.ts. */
export const SECTOR_KEY_DIRECTION_ORDER = Object.freeze([
  "RUNWAY_START",
  "T1_CRADLE_BEND",
  "WATER_TABLE",
  "LINK_APRON",
  "HANGAR_SIX",
  "HANGAR_EXIT",
  "GREENWATER_SWEEP",
  "CANOPY_PASSAGE",
  "THE_ELBOW",
  "FUEL_ROW",
  "T10_TOTEM_TURN",
  "RUNWAY_HOME",
]);

/**
 * Bitterpan is not authored until P8, so its three profiles reuse the pre-P4a
 * fixed key direction. Nothing about its look changes.
 */
export const DEFAULT_KEY_DIRECTION = SECTOR_KEY_DIRECTIONS.RUNWAY_START;

/**
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function clamp(value, min, max) {
  return value < min ? min : value > max ? max : value;
}

/**
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function smoothstep(value, min, max) {
  if (value <= min) return 0;
  if (value >= max) return 1;
  const t = (value - min) / (max - min);
  return t * t * (3 - 2 * t);
}

/**
 * Crossfades the authored key directions around the lap and writes the
 * normalized result into `target` (anything with x/y/z — a `THREE.Vector3`
 * works). Deliberately mirrors `GreenwaterCourse.lightingAt`: the fade only
 * runs across the last `crossfadeMetres` of a zone, clamped to the zone length,
 * so a short sector fades over its whole span instead of reaching backwards.
 *
 * @param {ReadonlyArray<KeyDirectionZone>} zones
 * @param {number} distance metres around the lap, already wrapped into [0, lapLength)
 * @param {number} lapLength
 * @param {LightVector} target
 * @param {number} [crossfadeMetres]
 * @returns {LightVector}
 */
export function lerpKeyDirection(
  zones,
  distance,
  lapLength,
  target,
  crossfadeMetres = LIGHTING_CROSSFADE_METRES,
) {
  let index = 0;
  for (let candidate = 1; candidate < zones.length; candidate += 1) {
    if (zones[candidate].distance > distance) break;
    index = candidate;
  }
  const zone = zones[index];
  const next = zones[(index + 1) % zones.length];
  const zoneEnd = index === zones.length - 1 ? lapLength : next.distance;
  const crossfadeStart = Math.max(zone.distance, zoneEnd - crossfadeMetres);
  const amount = distance <= crossfadeStart
    ? 0
    : smoothstep(distance, crossfadeStart, zoneEnd);
  const from = zone.direction;
  const to = next.direction;
  const x = from.x + (to.x - from.x) * amount;
  const y = from.y + (to.y - from.y) * amount;
  const z = from.z + (to.z - from.z) * amount;
  const length = Math.sqrt(x * x + y * y + z * z) || 1;
  target.x = x / length;
  target.y = y / length;
  target.z = z / length;
  return target;
}

/* ------------------------------------------------------------------ */
/* Hangar lamp flicker                                                 */
/* ------------------------------------------------------------------ */

/** `HANGAR_SIX` shell span, metres. Matches `createHangarShell` in course.ts. */
export const HANGAR_LAMP_FROM_METRES = 618;
export const HANGAR_LAMP_TO_METRES = 816;

/** Seed shared with the rest of the deterministic runtime (audio.ts, diagnostics.ts). */
export const HANGAR_FLICKER_SEED = 714;

/** Failing-sodium floor and ceiling. */
export const HANGAR_FLICKER_MIN = 0.55;
export const HANGAR_FLICKER_MAX = 1;

/** Slow sag: one authored step every 13 ticks (~0.43 s), smoothstepped between. */
const SLOW_STEP_TICKS = 13;
const SLOW_TABLE_LENGTH = 37;
const SLOW_FLOOR = 0.82;

/** Fast strike: a dip fires on ~11 % of ticks and decays over 4 ticks. */
const FAST_TABLE_LENGTH = 211;
const DIP_TRIGGER = 0.11;
const DIP_DECAY_TICKS = 4;

/**
 * Same LCG as `seededRandom` in audio.ts — one deterministic stream per seed.
 *
 * @param {number} seed
 * @returns {() => number}
 */
export function seededRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 0x1_0000_0000;
  };
}

/**
 * @param {() => number} random
 * @param {number} length
 * @returns {Float64Array}
 */
function buildTable(random, length) {
  const table = new Float64Array(length);
  for (let index = 0; index < length; index += 1) table[index] = random();
  return table;
}

/**
 * @param {number} value
 * @param {number} length
 * @returns {number}
 */
function wrapIndex(value, length) {
  const wrapped = value % length;
  return wrapped < 0 ? wrapped + length : wrapped;
}

/**
 * Deterministic hangar lamp flicker. Two layers, because pure per-tick noise
 * reads as a rendering glitch rather than as a lamp:
 *
 * - `slowComponent` is a smoothstepped walk between authored stops 13 ticks
 *   apart. It never leaves [0.82, 1.0] — this is the lamp *breathing*, and on
 *   its own it is barely perceptible.
 * - `fastComponent` is 1.0 most of the time and occasionally strikes: a dip
 *   fires, drops hard, and recovers over four ticks. This is the failure.
 *
 * The two multiply, so a strike landing on a sag is the deepest the lamp gets.
 * Both components are pure functions of the tick index, so the sequence is
 * reproducible from the seed alone and a soak can be replayed exactly.
 *
 * @param {number} [seed]
 * @returns {HangarFlicker}
 */
export function createHangarFlicker(seed = HANGAR_FLICKER_SEED) {
  const slowTable = buildTable(seededRandom(seed), SLOW_TABLE_LENGTH);
  // A second, decorrelated stream; xor-shifting the seed keeps it derived from
  // the one authored number instead of introducing a second magic constant.
  const fastTable = buildTable(seededRandom((seed ^ 0x9e37_79b9) >>> 0), FAST_TABLE_LENGTH);

  /** @param {number} step @returns {number} */
  function slowStop(step) {
    return SLOW_FLOOR + slowTable[wrapIndex(step, SLOW_TABLE_LENGTH)] * (1 - SLOW_FLOOR);
  }

  /** @param {number} tick @returns {number} */
  function slowComponent(tick) {
    const step = Math.floor(tick / SLOW_STEP_TICKS);
    const phase = (tick - step * SLOW_STEP_TICKS) / SLOW_STEP_TICKS;
    const eased = phase * phase * (3 - 2 * phase);
    const from = slowStop(step);
    const to = slowStop(step + 1);
    return from + (to - from) * eased;
  }

  /** @param {number} tick @returns {number} */
  function dipFiredAt(tick) {
    const roll = fastTable[wrapIndex(tick, FAST_TABLE_LENGTH)];
    return roll < DIP_TRIGGER ? 1 - roll / DIP_TRIGGER : 0;
  }

  /** @param {number} tick @returns {number} */
  function fastComponent(tick) {
    let deepest = 0;
    for (let back = 0; back <= DIP_DECAY_TICKS; back += 1) {
      const decay = 1 - back / (DIP_DECAY_TICKS + 1);
      const strength = dipFiredAt(tick - back) * decay;
      if (strength > deepest) deepest = strength;
    }
    return 1 - deepest;
  }

  /** @param {number} tick @returns {number} */
  function intensityAt(tick) {
    const level = clamp(slowComponent(tick) * fastComponent(tick), 0, 1);
    return HANGAR_FLICKER_MIN + (HANGAR_FLICKER_MAX - HANGAR_FLICKER_MIN) * level;
  }

  return { slowComponent, fastComponent, intensityAt };
}

/**
 * True while the player is inside the `HANGAR_SIX` shell.
 *
 * @param {number} distanceMetres
 * @returns {boolean}
 */
export function isInsideHangarRange(distanceMetres) {
  return distanceMetres >= HANGAR_LAMP_FROM_METRES
    && distanceMetres <= HANGAR_LAMP_TO_METRES;
}

/**
 * Lamp level in [0, 1]: exactly `0` when the lamps must be off (outside the
 * shell, or reduced motion), otherwise the flicker value in
 * [HANGAR_FLICKER_MIN, HANGAR_FLICKER_MAX]. There is no third state — the
 * caller reads `> 0` as "active" and hides the lights otherwise.
 *
 * @param {number} distanceMetres
 * @param {number} tick
 * @param {boolean} reducedMotion
 * @param {HangarFlicker} flicker
 * @returns {number}
 */
export function resolveHangarLampLevel(distanceMetres, tick, reducedMotion, flicker) {
  if (reducedMotion) return 0;
  if (!Number.isFinite(distanceMetres)) return 0;
  if (!isInsideHangarRange(distanceMetres)) return 0;
  return flicker.intensityAt(tick);
}

/* ------------------------------------------------------------------ */
/* Lap-based time-of-day drift                                         */
/* ------------------------------------------------------------------ */

/**
 * How far through the *race* the player is, in [0, 1], or `null` when there is
 * no lap N of M to read yet — the pre-race
 * standby screen and the countdown, where the atmosphere must show zero drift
 * rather than guess. The showcase autopilot runs in `running` like any other
 * racer, so a demo lap drifts exactly as a played one does.
 *
 * The `lapFraction` term mirrors `raceProgressFromStart` in game.ts: progress
 * measured from the start line rather than from the centreline's zero, so the
 * drift ticks over at the flag and not at some arbitrary point on the strip.
 *
 * @param {string} phase race phase, as owned by game.ts
 * @param {number} lap current lap, 1-based
 * @param {number} totalLaps
 * @param {number} progress course progress in [0, 1)
 * @param {number} startProgress course progress of the start line
 * @returns {number | null}
 */
export function resolveLapProgress(phase, lap, totalLaps, progress, startProgress) {
  if (phase === "standby" || phase === "countdown") return null;
  if (!Number.isFinite(totalLaps) || totalLaps <= 0) return null;
  if (!Number.isFinite(lap) || !Number.isFinite(progress)) return null;
  const raw = (progress - startProgress) % 1;
  const lapFraction = raw < 0 ? raw + 1 : raw;
  return clamp((lap - 1 + lapFraction) / totalLaps, 0, 1);
}

/**
 * The drift term actually applied this frame. `null` lap data (menu / standby,
 * where there is no lap N of M yet) and reduced motion both collapse to a hard
 * `0`, which is the ramp's identity stop — so nothing tints and diagnostics
 * report `timeOfDayDrift: 0`.
 *
 * @param {number | null | undefined} lapProgress
 * @param {boolean} reducedMotion
 * @returns {number}
 */
export function resolveTimeOfDayDrift(lapProgress, reducedMotion) {
  if (reducedMotion) return 0;
  if (lapProgress === null || lapProgress === undefined) return 0;
  if (!Number.isFinite(lapProgress)) return 0;
  return clamp(lapProgress, 0, 1);
}

/**
 * Mutable scratch the ramp writes into. Create once, reuse every frame.
 *
 * @returns {TimeOfDayTint}
 */
export function createTimeOfDayTint() {
  return {
    keyR: 1, keyG: 1, keyB: 1,
    skyR: 1, skyG: 1, skyB: 1,
    groundR: 1, groundG: 1, groundB: 1,
    fogR: 1, fogG: 1, fogB: 1,
    hemisphereScale: 1,
    keyScale: 1,
  };
}

/** The four palette columns the ramp tints. Named for the validator, not the hot path. */
export const TIME_OF_DAY_TINT_CHANNELS = Object.freeze([
  "keyTint",
  "skyTint",
  "groundTint",
  "fogTint",
]);

/**
 * Samples the authored 5-stop ramp from `greenwater-blockout.json` at
 * `drift ∈ [0, 1]` and writes the multipliers into `target`. Multiplicative by
 * design: the sector palette keeps deciding *what colour* a sector is, the ramp
 * only decides how far through the day the whole lap has drifted.
 *
 * The channel writes are spelled out rather than looped over
 * `TIME_OF_DAY_TINT_CHANNELS` because this runs every frame and computed
 * property names would allocate a string per channel per frame.
 *
 * @param {ReadonlyArray<TimeOfDayStop>} stops
 * @param {number} drift
 * @param {TimeOfDayTint} target
 * @returns {TimeOfDayTint}
 */
export function evaluateTimeOfDay(stops, drift, target) {
  const amount = clamp(drift, 0, 1);
  let index = 0;
  for (let candidate = 1; candidate < stops.length - 1; candidate += 1) {
    if (stops[candidate].lapProgress > amount) break;
    index = candidate;
  }
  const from = stops[index];
  const to = stops[Math.min(index + 1, stops.length - 1)];
  const span = to.lapProgress - from.lapProgress;
  const t = span <= 0 ? 0 : clamp((amount - from.lapProgress) / span, 0, 1);
  const fromKey = from.keyTint;
  const toKey = to.keyTint;
  target.keyR = fromKey[0] + (toKey[0] - fromKey[0]) * t;
  target.keyG = fromKey[1] + (toKey[1] - fromKey[1]) * t;
  target.keyB = fromKey[2] + (toKey[2] - fromKey[2]) * t;
  const fromSky = from.skyTint;
  const toSky = to.skyTint;
  target.skyR = fromSky[0] + (toSky[0] - fromSky[0]) * t;
  target.skyG = fromSky[1] + (toSky[1] - fromSky[1]) * t;
  target.skyB = fromSky[2] + (toSky[2] - fromSky[2]) * t;
  const fromGround = from.groundTint;
  const toGround = to.groundTint;
  target.groundR = fromGround[0] + (toGround[0] - fromGround[0]) * t;
  target.groundG = fromGround[1] + (toGround[1] - fromGround[1]) * t;
  target.groundB = fromGround[2] + (toGround[2] - fromGround[2]) * t;
  const fromFog = from.fogTint;
  const toFog = to.fogTint;
  target.fogR = fromFog[0] + (toFog[0] - fromFog[0]) * t;
  target.fogG = fromFog[1] + (toFog[1] - fromFog[1]) * t;
  target.fogB = fromFog[2] + (toFog[2] - fromFog[2]) * t;
  target.hemisphereScale = from.hemisphereScale
    + (to.hemisphereScale - from.hemisphereScale) * t;
  target.keyScale = from.keyScale + (to.keyScale - from.keyScale) * t;
  return target;
}

export { clamp as clampUnitRange, smoothstep as smoothstepUnit };
