/**
 * P9 living-world zones — the pure half.
 *
 * `living-world.ts` owns the three.js objects (buffers, materials, the 30 Hz
 * card update); everything that decides *what is alive, where, and in what
 * quantity* lives here so `scripts/validate-living-world.mjs` can run the real
 * authoring in Node and pin it.
 *
 * Two rules govern this file:
 *
 * 1. **The eleven Greenwater zones below are accepted art.** Their expressions
 *    are the pre-P9 `living-world.ts` constructor verbatim, and they are
 *    authored off one shared `seededRandom(0x13a7)` stream *in declaration
 *    order*, so every new zone appends after `MACHINERY_DISTANT`. Reordering,
 *    inserting, or changing the number of `next()` draws in any legacy zone
 *    shifts the stream and moves cards that a review already signed off.
 *    `scripts/validate-living-world.mjs` pins all 155 of them field by field.
 * 2. **A batch is a draw call.** Cards land in a batch by material, not by
 *    zone, so a new zone that reuses an existing material is free. The four
 *    Greenwater batches are unchanged by P9; the sixty new Greenwater cards
 *    ride in them.
 */

/**
 * @typedef {"mist" | "rise" | "puff" | "rain" | "ripple" | "flow" | "pendulum"
 *   | "shear" | "sequence" | "pulse" | "blink" | "devil" | "strobe"} CardKind
 *
 * @typedef {"mist" | "rise" | "puff" | "rain" | "ripple" | "flow" | "devil"
 *   | "shimmer"} AlphaKind
 *
 * @typedef {object} AtlasRect
 * @property {number} x
 * @property {number} y
 * @property {number} size
 * @property {number} sheetSize
 *
 * @typedef {object} LivingCardSeed
 * @property {CardKind} kind
 * @property {number} distance metres around the lap
 * @property {number} side -1 or 1; which side of the centreline
 * @property {number} lateral metres outboard of `sample.halfWidth`
 * @property {number} base metres above the deck
 * @property {number} width
 * @property {number} height
 * @property {number} phase
 * @property {number} speed
 * @property {AtlasRect} rect
 * @property {number} tint
 * @property {number} seed
 * @property {number} [amplitude] radians for `shear`/`pendulum`, orbit metres
 *   for `devil`
 * @property {number} [hang] vertical reach: the pendulum anchor, or the climb
 *   height of a dust devil
 * @property {AlphaKind} [alphaKind]
 * @property {number} [alphaInitial]
 *
 * @typedef {LivingCardSeed & { motionId: string, batch: string }} AuthoredCard
 *
 * @typedef {(
 *   distance: number, side: number, index: number, next: () => number,
 * ) => LivingCardSeed} CardAuthor
 *
 * @typedef {object} LivingZone
 * @property {string} id
 * @property {string} batch id of the batch (and therefore the draw call)
 * @property {number} from first metre of the zone
 * @property {number} to last metre of the zone
 * @property {number} cards
 * @property {CardAuthor} card
 *
 * @typedef {object} LivingBatchSpec
 * @property {string} id
 * @property {string} meshName
 * @property {"motion" | "jungle" | "emissive"} texture
 * @property {"normal" | "additive"} blending
 * @property {boolean} depthWrite
 * @property {boolean} fog
 * @property {number} alphaTest 0 disables the alpha test
 * @property {boolean} lamps emissive batch: colour is driven per frame
 *
 * @typedef {object} LivingWorldSpec
 * @property {string} id
 * @property {"greenwater" | "bitterpan"} course
 * @property {string} rootName
 * @property {number} seed
 * @property {number} courseLength authored lap length, metres
 * @property {readonly LivingBatchSpec[]} batches
 * @property {readonly LivingZone[]} zones
 *
 * @typedef {object} AuthoredBatch
 * @property {LivingBatchSpec} spec
 * @property {AuthoredCard[]} cards
 *
 * @typedef {object} AuthoredLivingWorld
 * @property {AuthoredBatch[]} batches
 * @property {number} drawCalls
 * @property {number} cards
 * @property {number} triangles
 */

/** The card update tick. Mirrors `UPDATE_HZ` in living-world.ts. */
export const LIVING_WORLD_UPDATE_HZ = 30;

/** Two triangles per card, one quad. */
export const CARD_TRIANGLES = 2;

/** Every motion the runtime knows how to advance. */
export const CARD_KINDS = Object.freeze([
  "mist",
  "rise",
  "puff",
  "rain",
  "ripple",
  "flow",
  "pendulum",
  "shear",
  "sequence",
  "pulse",
  "blink",
  "devil",
  "strobe",
]);

/** Kinds whose colour is driven by `updateLampColors`, not by an envelope. */
export const LAMP_KINDS = Object.freeze(["sequence", "pulse", "blink", "strobe"]);

/** @type {Readonly<Record<AlphaKind, readonly [number, number]>>} */
export const ALPHA_ENVELOPES = Object.freeze({
  mist: [0.22, 0.46],
  rise: [0.1, 0.34],
  puff: [0, 0.5],
  rain: [0.08, 0.22],
  ripple: [0, 0.38],
  flow: [0, 0.3],
  // P9. A salt devil is dust, not water vapour: it peaks mid-climb and is gone.
  devil: [0, 0.26],
  // P9. Heat off the pan is barely there — this is the quietest envelope in the
  // set on purpose, because the shimmer sits over the whole Bitterpan straight.
  shimmer: [0.05, 0.17],
});

/**
 * @param {number} seed
 * @returns {() => number}
 */
export function seededRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6d2b79f5) >>> 0;
    const first = (value ^ (value >>> 15)) * (1 | value);
    const second = (
      value + (((value ^ (value >>> 7)) * (61 | value)) >>> 0)
    ) >>> 0;
    return ((first ^ second) >>> 0) / 0x1_0000_0000;
  };
}

/**
 * @param {number} sheetSize
 * @param {number} columns
 * @param {number} slotIndex
 * @returns {AtlasRect}
 */
export function atlasRect(sheetSize, columns, slotIndex) {
  const size = sheetSize / columns;
  return {
    x: (slotIndex % columns) * size,
    y: Math.floor(slotIndex / columns) * size,
    size,
    sheetSize,
  };
}

export const MOTION_RECTS = Object.freeze({
  mist: atlasRect(512, 2, 0),
  steam: atlasRect(512, 2, 1),
  rain: atlasRect(512, 2, 2),
  glint: atlasRect(512, 2, 3),
});
export const JUNGLE_RECTS = Object.freeze({
  fern: atlasRect(1024, 4, 3),
  vine: atlasRect(1024, 4, 4),
});
export const EMISSIVE_RECTS = Object.freeze({
  amberLamp: atlasRect(512, 4, 0),
  redLamp: atlasRect(512, 4, 2),
});

const TAU = Math.PI * 2;
/** `THREE.MathUtils.DEG2RAD`, restated so the legacy amplitudes stay bit-exact. */
const DEG2RAD = Math.PI / 180;

/**
 * @param {number} degrees
 * @returns {number}
 */
function degToRad(degrees) {
  return degrees * DEG2RAD;
}

/** @type {readonly LivingBatchSpec[]} */
const GREENWATER_BATCHES = Object.freeze([
  {
    id: "air",
    meshName: "GW_LIVING_AIR",
    texture: "motion",
    blending: "normal",
    depthWrite: false,
    fog: true,
    alphaTest: 0,
    lamps: false,
  },
  {
    id: "water",
    meshName: "GW_LIVING_WATER",
    texture: "motion",
    blending: "additive",
    depthWrite: false,
    fog: true,
    alphaTest: 0,
    lamps: false,
  },
  {
    id: "foliage",
    meshName: "GW_LIVING_FOLIAGE",
    texture: "jungle",
    blending: "normal",
    depthWrite: true,
    fog: true,
    alphaTest: 0.5,
    lamps: false,
  },
  {
    id: "lamps",
    meshName: "GW_LIVING_LAMPS",
    texture: "emissive",
    blending: "additive",
    depthWrite: false,
    fog: false,
    alphaTest: 0,
    lamps: true,
  },
]);

/**
 * The eleven accepted zones, then the four authored by P9.
 *
 * @type {readonly LivingZone[]}
 */
const GREENWATER_ZONES = Object.freeze([
  {
    id: "MIST_WATER_TABLE",
    batch: "air",
    from: 300,
    to: 470,
    cards: 14,
    card: (distance, side, _index, next) => ({
      kind: "mist",
      distance,
      side,
      lateral: 17 + next() * 21,
      base: 2 + next() * 9,
      width: 17 + next() * 17,
      height: 2.2 + next() * 2.3,
      phase: next() * Math.PI * 2,
      speed: 0.55,
      rect: MOTION_RECTS.mist,
      tint: 0xbcd4d0,
      seed: next(),
      alphaKind: "mist",
      alphaInitial: ALPHA_ENVELOPES.mist[0],
    }),
  },
  {
    id: "MIST_CANOPY",
    batch: "air",
    from: 1180,
    to: 1330,
    cards: 12,
    card: (distance, side, _index, next) => ({
      kind: "rise",
      distance,
      side,
      lateral: 15 + next() * 15,
      base: 3 + next() * 11,
      width: 14 + next() * 11,
      height: 2.4 + next() * 1.8,
      phase: next() * Math.PI * 2,
      speed: 0.28,
      rect: MOTION_RECTS.mist,
      tint: 0x8fae86,
      seed: next(),
      alphaKind: "rise",
      alphaInitial: ALPHA_ENVELOPES.rise[0],
    }),
  },
  {
    id: "STEAM_HANGAR_VENTS",
    batch: "air",
    from: 700,
    to: 815,
    cards: 10,
    card: (distance, _side, index, next) => ({
      kind: "puff",
      distance,
      side: index % 3 !== 0 ? -1 : 1,
      lateral: 9 + (index % 6) * 1.2,
      base: 1.4 + (index % 3) * 0.8,
      width: 3.2,
      height: 3.2,
      phase: index / 10 * Math.PI * 2,
      speed: 1 / 2.4,
      rect: MOTION_RECTS.steam,
      tint: 0xd8cbb2,
      seed: next(),
      alphaKind: "puff",
      alphaInitial: ALPHA_ENVELOPES.puff[0],
    }),
  },
  {
    id: "RAIN_SWEEP",
    batch: "air",
    from: 860,
    to: 1030,
    cards: 22,
    card: (distance, side, _index, next) => ({
      kind: "rain",
      distance: distance + (next() - 0.5) * 11,
      side,
      lateral: 24 + next() * 28,
      base: 3 + next() * 16,
      width: 3.4 + next() * 2.4,
      height: 12 + next() * 8,
      phase: next(),
      speed: 14,
      rect: MOTION_RECTS.rain,
      tint: 0xbfd6da,
      seed: next(),
      alphaKind: "rain",
      alphaInitial: ALPHA_ENVELOPES.rain[0],
    }),
  },
  {
    id: "GLINT_WATER_TABLE",
    batch: "water",
    from: 300,
    to: 470,
    cards: 26,
    card: (distance, side, _index, next) => ({
      kind: "ripple",
      distance,
      side,
      lateral: 12 + next() * 32,
      base: 0.15,
      width: 2.4 + next() * 3.1,
      height: 0,
      phase: next() * Math.PI * 2,
      speed: 0.9,
      rect: MOTION_RECTS.glint,
      tint: 0x9fd8cc,
      seed: next(),
      alphaKind: "ripple",
      alphaInitial: ALPHA_ENVELOPES.ripple[0],
    }),
  },
  {
    id: "GLINT_SWEEP_DRAINAGE",
    batch: "water",
    from: 860,
    to: 1030,
    cards: 18,
    card: (distance, side, index, next) => ({
      kind: "flow",
      distance,
      side,
      lateral: 11 + (index % 4) * 2.1,
      base: 0.1,
      width: 1.8 + next() * 1.6,
      height: 0,
      phase: next(),
      speed: 3.2,
      rect: MOTION_RECTS.glint,
      tint: 0x8fd4c0,
      seed: next(),
      alphaKind: "flow",
      alphaInitial: ALPHA_ENVELOPES.flow[0],
    }),
  },
  {
    id: "VINE_SWAY_CANOPY",
    batch: "foliage",
    from: 1180,
    to: 1330,
    cards: 20,
    card: (distance, side, _index, next) => ({
      kind: "pendulum",
      distance,
      side,
      lateral: 8 + next() * 9,
      base: 11,
      hang: 17.4,
      width: 3.4 + next() * 2.2,
      height: 6.4,
      phase: next() * Math.PI * 2,
      speed: Math.PI * 2 / 5.5,
      amplitude: degToRad(3.2),
      rect: JUNGLE_RECTS.vine,
      tint: 0x6f8f58,
      seed: next(),
    }),
  },
  {
    id: "FROND_SWAY_SWEEP",
    batch: "foliage",
    from: 860,
    to: 1030,
    cards: 16,
    card: (distance, side, _index, next) => ({
      kind: "shear",
      distance,
      side,
      lateral: 20 + next() * 16,
      base: 1.2 + next() * 3,
      width: 5 + next() * 3.5,
      height: 4.5 + next() * 3,
      phase: next() * Math.PI * 2,
      speed: Math.PI * 2 / 7.3,
      amplitude: degToRad(2.4),
      rect: JUNGLE_RECTS.fern,
      tint: 0x5c7a4a,
      seed: next(),
    }),
  },
  {
    id: "PUMP_LAMPS_FUEL_ROW",
    batch: "lamps",
    from: 1900,
    to: 2100,
    cards: 9,
    card: (distance, side, index, next) => ({
      kind: "sequence",
      distance,
      side,
      lateral: 12 + (index % 5) * 3.1,
      base: 3 + (index % 3) * 0.9,
      width: 0.85,
      height: 0.85,
      phase: (index % 3) / 3,
      speed: 1 / 1.1,
      rect: index === 4 ? EMISSIVE_RECTS.redLamp : EMISSIVE_RECTS.amberLamp,
      tint: index === 4 ? 0xff5a3c : 0xffb45a,
      seed: next(),
    }),
  },
  {
    id: "CRANE_APEX_BEACON",
    batch: "lamps",
    from: 760,
    to: 800,
    cards: 2,
    card: (distance, _side, index, next) => ({
      kind: "pulse",
      distance,
      side: 1,
      lateral: 25.4,
      base: 34 + index * 1.6,
      width: 1.15,
      height: 1.15,
      phase: index * 0.5,
      speed: Math.PI * 2 / 2.6,
      rect: EMISSIVE_RECTS.redLamp,
      tint: 0xff4a34,
      seed: next(),
    }),
  },
  {
    id: "MACHINERY_DISTANT",
    batch: "lamps",
    from: 690,
    to: 820,
    cards: 6,
    card: (distance, _side, index, next) => ({
      kind: "blink",
      distance,
      side: -1,
      lateral: 40 + (index % 3) * 6,
      base: 2.5 + (index % 4) * 2.2,
      width: 0.7,
      height: 0.7,
      phase: (index % 3) * 0.37,
      speed: 1 / (index % 2 !== 0 ? 3.7 : 5.2),
      rect: index % 3 === 2 ? EMISSIVE_RECTS.amberLamp : EMISSIVE_RECTS.redLamp,
      tint: index % 3 === 2 ? 0xffb45a : 0xff4a34,
      seed: next(),
    }),
  },

  // ---------------------------------------------------------------------
  // P9. Everything above is accepted art and is pinned by the validator.
  // Everything below is new, and appends to the random stream rather than
  // displacing it.
  // ---------------------------------------------------------------------

  {
    // FUEL_ROW is 1591-2121 m and until P9 held nine pump lamps and nothing
    // else — 530 m of the longest sector on the map with no motion in it. The
    // authored tank row (`LM_TANKS`) is 300 m long at -40 m lateral, nine
    // spheres stepping from 18 m down to 6 m toward T10, so the vapour rides
    // that step down rather than sitting at one height.
    id: "FUEL_VAPOR_TANK_ROW",
    batch: "air",
    from: 1690,
    to: 1980,
    cards: 20,
    card: (distance, _side, _index, next) => ({
      kind: "rise",
      distance,
      side: -1,
      lateral: 24 + next() * 14,
      base: 18.6 - (distance - 1690) / 290 * 11.4 + next() * 2.4,
      width: 9 + next() * 7,
      height: 5 + next() * 4,
      phase: next() * TAU,
      speed: 0.17,
      rect: MOTION_RECTS.steam,
      tint: 0xc4bda6,
      seed: next(),
      alphaKind: "rise",
      alphaInitial: ALPHA_ENVELOPES.rise[0],
    }),
  },
  {
    // Perimeter marking for the tank compound, running the length of the row
    // and past the pump lamps. Mostly tank side; every fourth lamp is on the
    // service side so the row reads as an enclosure rather than a wall.
    id: "FUEL_ROW_PERIMETER_BEACONS",
    batch: "lamps",
    from: 1620,
    to: 2100,
    cards: 12,
    card: (distance, _side, index, next) => ({
      kind: "blink",
      distance,
      side: index % 4 === 3 ? 1 : -1,
      lateral: 18 + (index % 3) * 4.5,
      base: 12 + (index % 4) * 3.4,
      width: 0.9,
      height: 0.9,
      phase: (index % 5) * 0.21,
      speed: 1 / (index % 2 !== 0 ? 2.9 : 4.3),
      rect: index % 3 === 0 ? EMISSIVE_RECTS.redLamp : EMISSIVE_RECTS.amberLamp,
      tint: index % 3 === 0 ? 0xff4a34 : 0xffb45a,
      seed: next(),
    }),
  },
  {
    // RUNWAY_HOME is a disused runway and the map is an airfield, so the home
    // straight gets the airfield's own language: a sequenced approach flasher
    // running toward The Cradle, threshold pair in red.
    id: "RUNWAY_APPROACH_STROBES",
    batch: "lamps",
    from: 2290,
    to: 2500,
    cards: 14,
    card: (distance, side, index, next) => ({
      kind: "strobe",
      distance,
      side,
      lateral: 6.5 + (index % 3) * 0.8,
      base: 1.6 + (index % 2) * 0.4,
      width: 1,
      height: 1,
      phase: Math.floor(index / 2) / 7,
      speed: 0.9,
      rect: index >= 12 ? EMISSIVE_RECTS.redLamp : EMISSIVE_RECTS.amberLamp,
      tint: index >= 12 ? 0xff4a34 : 0xdff0ff,
      seed: next(),
    }),
  },
  {
    // The flooded side of the home straight. Same motion as the water table
    // mist that opens the lap, cooler and thinner, so the last sector answers
    // the first instead of introducing a new idea 200 m from the flag.
    id: "RUNWAY_MIST_DRIFT",
    batch: "air",
    from: 2270,
    to: 2500,
    cards: 14,
    card: (distance, _side, _index, next) => ({
      kind: "mist",
      distance,
      side: -1,
      lateral: 19 + next() * 24,
      base: 1.4 + next() * 5,
      width: 18 + next() * 16,
      height: 2.4 + next() * 2.2,
      phase: next() * TAU,
      speed: 0.42,
      rect: MOTION_RECTS.mist,
      tint: 0xcfdde2,
      seed: next(),
      alphaKind: "mist",
      alphaInitial: ALPHA_ENVELOPES.mist[0],
    }),
  },
]);

/** @type {readonly LivingBatchSpec[]} */
const BITTERPAN_BATCHES = Object.freeze([
  {
    id: "air",
    meshName: "BP_LIVING_AIR",
    texture: "motion",
    blending: "normal",
    depthWrite: false,
    fog: true,
    alphaTest: 0,
    lamps: false,
  },
  {
    id: "glint",
    meshName: "BP_LIVING_GLINT",
    texture: "motion",
    blending: "additive",
    depthWrite: false,
    fog: true,
    alphaTest: 0,
    lamps: false,
  },
  {
    id: "lamps",
    meshName: "BP_LIVING_LAMPS",
    texture: "motion",
    blending: "additive",
    depthWrite: false,
    fog: false,
    alphaTest: 0,
    lamps: true,
  },
]);

/**
 * Bitterpan Works, 3050 m. The site is a salt pan: the design target is
 * *exposed emptiness*, so this set is deliberately sparse, far off the deck and
 * large in scale. Ninety-eight cards over 3 km, against Greenwater's 215 over
 * 2.5 km, and most of them sit 30-70 m outboard rather than at the kerb.
 *
 * @type {readonly LivingZone[]}
 */
const BITTERPAN_ZONES = Object.freeze([
  {
    // Q1 THE LONG PAN, 488 m of true tangent. Heat off the crust, leaning with
    // the WNW wind the blockout authored. Near-white and barely present: this
    // is the widest, emptiest read on the map and it must not become weather.
    id: "HEAT_SHIMMER_LONG_PAN",
    batch: "air",
    from: 160,
    to: 630,
    cards: 22,
    card: (distance, side, _index, next) => ({
      kind: "shear",
      distance,
      side,
      lateral: 26 + next() * 46,
      base: 0.6 + next() * 2.4,
      width: 22 + next() * 20,
      height: 3.4 + next() * 2.6,
      phase: next() * TAU,
      speed: TAU / 8.5,
      amplitude: degToRad(1.6),
      rect: MOTION_RECTS.mist,
      tint: 0xf2eee2,
      seed: next(),
      alphaKind: "shimmer",
      alphaInitial: ALPHA_ENVELOPES.shimmer[0],
    }),
  },
  {
    // L1 RETURN LEG, S2 THE LONG BASIN — the reference sector, structure
    // density "low", "nothing near the deck". Rising heat columns rather than
    // a lean, so the two straights do not read as the same effect twice.
    id: "HEAT_RISE_RETURN_LEG",
    batch: "air",
    from: 1640,
    to: 2120,
    cards: 18,
    card: (distance, side, _index, next) => ({
      kind: "rise",
      distance,
      side,
      lateral: 30 + next() * 52,
      base: 0.4 + next() * 1.6,
      width: 14 + next() * 12,
      height: 6 + next() * 5,
      phase: next() * TAU,
      speed: 0.16,
      rect: MOTION_RECTS.steam,
      tint: 0xefe8d8,
      seed: next(),
      alphaKind: "rise",
      alphaInitial: ALPHA_ENVELOPES.rise[0],
    }),
  },
  {
    // Four devils, four cards each stacked into a column, spaced 640 m apart
    // around the lap and alternating sides. The even `spread` distance is
    // overridden here because a devil is a column, not a queue: each group of
    // four shares a station and differs only in height.
    id: "SALT_DUST_DEVILS",
    batch: "air",
    from: 340,
    to: 2290,
    cards: 16,
    card: (_distance, _side, index, next) => ({
      kind: "devil",
      distance: 340 + Math.floor(index / 4) * 640 + (index % 4) * 6,
      side: Math.floor(index / 4) % 2 === 1 ? 1 : -1,
      lateral: 58 + (index % 4) * 3.5,
      base: 1.2 + (index % 4) * 5.5,
      width: 5.5 + (index % 4) * 1.8,
      height: 7 + (index % 4) * 2.4,
      phase: (index % 4) * 0.9 + Math.floor(index / 4) * 0.4,
      speed: TAU / 7.5,
      amplitude: 2.6 + (index % 4) * 1.1,
      hang: 9,
      rect: MOTION_RECTS.steam,
      tint: 0xe8e2cf,
      seed: next(),
      alphaKind: "devil",
      alphaInitial: ALPHA_ENVELOPES.devil[0],
    }),
  },
  {
    // S1 HARVEST BASIN: "harvester rigs, brine pumps, hoppers". Ten warning
    // lamps over 1080 m, 34-70 m off the deck and 9-22 m up — read as plant on
    // the horizon, never as track furniture.
    id: "HARVESTER_RIG_BEACONS",
    batch: "lamps",
    from: 420,
    to: 1500,
    cards: 10,
    card: (distance, _side, index, next) => ({
      kind: "blink",
      distance,
      side: index % 3 === 2 ? 1 : -1,
      lateral: 34 + (index % 4) * 12,
      base: 9 + (index % 3) * 6.5,
      width: 1.35,
      height: 1.35,
      phase: (index % 4) * 0.29,
      speed: 1 / (index % 2 !== 0 ? 3.3 : 5.9),
      rect: MOTION_RECTS.steam,
      tint: index % 3 === 1 ? 0xffb45a : 0xff4a34,
      seed: next(),
    }),
  },
  {
    // The conveyor into the loadout, running with the track through Q4/L3 and
    // into the underpass. `flow` re-samples the centreline every tick, so the
    // spill tracks the route through the Brine Cut instead of cutting the
    // corner.
    id: "CONVEYOR_SPILL_WORKS",
    batch: "glint",
    from: 2860,
    to: 3040,
    cards: 20,
    card: (distance, _side, index, next) => ({
      kind: "flow",
      distance,
      side: index % 5 === 4 ? -1 : 1,
      lateral: 7.5 + (index % 4) * 1.6,
      base: 4.2 + (index % 3) * 0.9,
      width: 1.6 + next() * 1.4,
      height: 0,
      phase: next(),
      speed: 4.4,
      rect: MOTION_RECTS.glint,
      tint: 0xdcd2b4,
      seed: next(),
      alphaKind: "flow",
      alphaInitial: ALPHA_ENVELOPES.flow[0],
    }),
  },
  {
    // Q5 CONVEYOR UNDERPASS, the map's signature occlusion: the trestle soffit
    // closes the sky for 40 m. A fast chase running with the track is the one
    // place on Bitterpan where the living layer is close enough to touch.
    id: "UNDERPASS_HAZARD_LAMPS",
    batch: "lamps",
    from: 3008,
    to: 3046,
    cards: 9,
    card: (distance, side, index, next) => ({
      kind: "strobe",
      distance,
      side,
      lateral: 5.2 + (index % 3) * 0.6,
      base: 6.5 + (index % 2) * 4.5,
      width: 1.1,
      height: 1.1,
      phase: Math.floor(index / 2) / 5,
      speed: 1.4,
      rect: MOTION_RECTS.steam,
      tint: index % 2 === 0 ? 0xffd23c : 0xff7a1e,
      seed: next(),
    }),
  },
  {
    // The loadout tower is the one tall thing on the site. Three stacked
    // obstruction lamps, the Bitterpan answer to the Greenwater crane beacon.
    id: "LOADOUT_TOWER_BEACON",
    batch: "lamps",
    from: 2980,
    to: 3010,
    cards: 3,
    card: (distance, _side, index, next) => ({
      kind: "pulse",
      distance,
      side: 1,
      lateral: 46,
      base: 26 + index * 4.5,
      width: 1.5,
      height: 1.5,
      phase: index * 0.55,
      speed: TAU / 3.4,
      rect: MOTION_RECTS.steam,
      tint: 0xff4a34,
      seed: next(),
    }),
  },
]);

/** @type {LivingWorldSpec} */
export const GREENWATER_LIVING_WORLD = Object.freeze({
  id: "GREENWATER",
  course: "greenwater",
  rootName: "GW_LIVING_RUNTIME",
  seed: 0x13a7,
  courseLength: 2515.982,
  batches: GREENWATER_BATCHES,
  zones: GREENWATER_ZONES,
});

/** @type {LivingWorldSpec} */
export const BITTERPAN_LIVING_WORLD = Object.freeze({
  id: "BITTERPAN",
  course: "bitterpan",
  rootName: "BP_LIVING_RUNTIME",
  seed: 0x2b17,
  courseLength: 3050,
  batches: BITTERPAN_BATCHES,
  zones: BITTERPAN_ZONES,
});

/** @type {Readonly<Record<string, LivingWorldSpec>>} */
export const LIVING_WORLD_SPECS = Object.freeze({
  greenwater: GREENWATER_LIVING_WORLD,
  bitterpan: BITTERPAN_LIVING_WORLD,
});

/**
 * Authors every card of a spec into its batch, in declaration order, off one
 * seeded stream. Pure: no three.js, no course sampling, no allocation on any
 * hot path — this runs once at load and once per validator run.
 *
 * @param {LivingWorldSpec} spec
 * @returns {AuthoredLivingWorld}
 */
export function buildLivingWorld(spec) {
  const random = seededRandom(spec.seed);
  /** @type {Map<string, AuthoredBatch>} */
  const batches = new Map();
  for (const batchSpec of spec.batches) {
    batches.set(batchSpec.id, { spec: batchSpec, cards: [] });
  }

  let cardCount = 0;
  for (const zone of spec.zones) {
    const batch = batches.get(zone.batch);
    if (!batch) {
      throw new Error(`Living-world zone ${zone.id} targets unknown batch ${zone.batch}.`);
    }
    const span = zone.to - zone.from;
    for (let index = 0; index < zone.cards; index += 1) {
      const distance = zone.from + span * (index + 0.5) / zone.cards;
      const side = index % 2 === 1 ? 1 : -1;
      batch.cards.push({
        ...zone.card(distance, side, index, random),
        motionId: zone.id,
        batch: zone.batch,
      });
      cardCount += 1;
    }
  }

  return {
    batches: [...batches.values()],
    drawCalls: spec.batches.length,
    cards: cardCount,
    triangles: cardCount * CARD_TRIANGLES,
  };
}
