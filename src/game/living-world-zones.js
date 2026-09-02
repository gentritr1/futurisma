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
 *   | "shear" | "sequence" | "pulse" | "blink" | "devil" | "strobe"
 *   | "cross"} CardKind
 *
 * @typedef {"mist" | "rise" | "puff" | "rain" | "ripple" | "flow" | "devil"
 *   | "shimmer" | "cross"} AlphaKind
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
 *   for `devil`, half the lateral traverse in metres for `cross`
 * @property {number} [hang] vertical reach: the pendulum anchor, or the climb
 *   height of a dust devil
 * @property {AlphaKind} [alphaKind]
 * @property {number} [alphaInitial]
 * @property {boolean} [upright] P20.4. Whether this card samples the atlas cell
 *   it NAMES.
 *
 *   It does not, by default, and that is a defect rather than a convention.
 *   `atlasRect` measures `rect.y` in PNG rows from the TOP of the sheet, and
 *   `living-world.ts` builds V straight off it (`v0 = rect.y / sheetSize`). But
 *   the sheets are uploaded through `THREE.TextureLoader` with `flipY` left at
 *   its default `true`, so V counts from the BOTTOM — and a cell in row `r` of
 *   an N-row grid therefore resolves to row `N - 1 - r`, same column. On the
 *   4x4 horizon sheet HAZE_BAND (slot 15) draws PYLON_RUN (slot 3) and
 *   MESA_LONG (12) draws TREELINE_DENSE (0); on the 4x4 motion-B sheet
 *   DUST_SCUD (13) draws BIRDS_B (1) and DEVIL_WISP_A (4) draws FLICKER_DEAD
 *   (8); on the 2x2 motion sheet MIST (0) draws RAIN (2).
 *
 *   MEASURED, not deduced. Two independent reads, both in shots/p20.4/:
 *   the horizon band renders visible lattice pylon masts with catenary wires
 *   that vanish at `?living=0`, and its rendered alpha profile matches
 *   PYLON_RUN's cell row for row while contradicting HAZE_BAND's. It is also
 *   the reason the P9/P12 near-field set reads as nothing: a "dust scud" card
 *   drawing a sparse bird cell has almost no coverage to show.
 *
 *   The fix is one line in `makeBatch`, and applying it globally would re-point
 *   EVERY card on both maps — the 155 accepted Greenwater cards included —
 *   which is out of scope for this phase and needs its own art review. So it is
 *   opt-in per CARD: the five P20.4 zones set it, get the cells they name, and
 *   every accepted card renders byte-identically to before. Per card rather
 *   than per batch because the new zones ride the accepted `air` and `airB`
 *   batches, and a batch of their own would cost a draw call.
 *
 *   A phase that fixes this properly deletes the flag and re-reviews both maps.
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
 * @property {"motion" | "motionB" | "jungle" | "emissive" | "horizon"} texture
 * @property {"normal" | "additive"} blending
 * @property {boolean} depthWrite
 * @property {boolean} fog
 * @property {number} alphaTest 0 disables the alpha test
 * @property {boolean} lamps emissive batch: colour is driven per frame
 * @property {"bottom"} [anchor] P18.1. Where `base` puts the card.
 *
 *   The card system has always CENTRED a quad on `sample.position.y + base`,
 *   which is right for drifting atmosphere — mist, steam, rain, glint all want
 *   a centre. It is wrong for a ground-standing silhouette: a 50 m mesa card at
 *   base 0 spans -25 m to +25 m and shows half its authored height, which is
 *   how P18 shipped and why the Long Basin still read as gradient.
 *
 *   `anchor: "bottom"` moves the card up by its own half-height so its BOTTOM
 *   edge sits at `base`. The cells are authored bottom-anchored — their grade
 *   contact is drawn at the cell's own bottom edge — so this is what makes
 *   `base: 0` mean "on the ground" instead of "half buried", and it keeps
 *   base 0 the verifiable convention the delivery asks for.
 *
 *   A BATCH property, not a card one: it is a property of what the cells on a
 *   sheet mean, every card in a batch shares it, and putting it here keeps it
 *   out of `canonicalCard` — so the 155 accepted Greenwater cards and every
 *   P9/P12 digest are untouched by definition rather than by inspection.
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
  // P20.4. Salt scud walking ACROSS the deck with the 292 deg wind. `flow`
  // travels ALONG the centreline and lies flat; nothing in the set could move a
  // camera-facing card sideways over the road, which is the one motion the
  // driver's seat actually catches.
  "cross",
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
  // P20.4. A crossing scud is born at one shoulder and gone at the other, so it
  // shares the traverse clock exactly (`sin(pi * progress)` on the SAME
  // `t * speed + phase` sawtooth the motion uses) and the sawtooth reset lands
  // on alpha 0. The ceiling is 0.32: a card that crosses the racing line below
  // 6 m has to stay under the 0.35 corridor cap by construction, not by review.
  cross: [0, 0.32],
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

/**
 * P12 art pass 01. Slot indices into `atlasRect(512, 4, slot)` on
 * `greenwater_motion_b_512` — the second motion sheet, whose sixteen 128 px
 * cells hold birds, dust devils, distant wrecks and dry scud. Both maps draw
 * from it, the same way both already share `greenwater_motion_512`.
 */
export const MOTION_B_RECTS = Object.freeze({
  birdsA: atlasRect(512, 4, 0),
  birdsB: atlasRect(512, 4, 1),
  birdsC: atlasRect(512, 4, 2),
  gull: atlasRect(512, 4, 3),
  devilWispA: atlasRect(512, 4, 4),
  devilWispB: atlasRect(512, 4, 5),
  flickerFull: atlasRect(512, 4, 6),
  flickerHalf: atlasRect(512, 4, 7),
  flickerDead: atlasRect(512, 4, 8),
  wreckFuselage: atlasRect(512, 4, 9),
  wreckTailfin: atlasRect(512, 4, 10),
  wreckNacelle: atlasRect(512, 4, 11),
  wreckGantry: atlasRect(512, 4, 12),
  dustScud: atlasRect(512, 4, 13),
  vaporThin: atlasRect(512, 4, 14),
  crateStack: atlasRect(512, 4, 15),
});

/**
 * P18 art pass 03. Slot indices into `atlasRect(1024, 4, slot)` on
 * `futurisma_horizon_1024` — the distant-silhouette card sheet, sixteen 256 px
 * cells, shared by both maps exactly as the two motion sheets already are. Slot
 * numbers are copied from `PASS03_LAYOUT.futurisma_horizon_1024` in
 * `scripts/design/atlas-draw-pass03.mjs`; `validate-art-pass.mjs` asserts the
 * rect this produces is the rect the builder drew.
 */
export const HORIZON_RECTS = Object.freeze({
  treelineDense: atlasRect(1024, 4, 0),
  treelineBroken: atlasRect(1024, 4, 1),
  treelineSnag: atlasRect(1024, 4, 2),
  pylonRun: atlasRect(1024, 4, 3),
  gantryFar: atlasRect(1024, 4, 4),
  hangarMass: atlasRect(1024, 4, 5),
  siloPair: atlasRect(1024, 4, 6),
  tankFarmFar: atlasRect(1024, 4, 7),
  stackCluster: atlasRect(1024, 4, 8),
  stackSingle: atlasRect(1024, 4, 9),
  plantMass: atlasRect(1024, 4, 10),
  rigFar: atlasRect(1024, 4, 11),
  mesaLong: atlasRect(1024, 4, 12),
  mesaBluff: atlasRect(1024, 4, 13),
  shimmerBand: atlasRect(1024, 4, 14),
  hazeBand: atlasRect(1024, 4, 15),
});

/**
 * The parallax bands of FUTURISMA_HORIZON_LAYERS.json.
 *
 * GW_* are the delivery's own output of that file's `tintRule` (each map's fog
 * colour pulled toward the silhouette base by 0.55 / 0.35 / 0.18 / 0.10).
 * Greenwater has ONE fog colour for the whole lap, so a hex frozen there freezes
 * a relationship to fog as well as a value.
 *
 * BP_* are NOT that. P18.2 re-authored them as ABSOLUTE Rec.709 luminance
 * targets, because Bitterpan's fog is per-sector and the pull rule, frozen to a
 * single hex, silently freezes the wrong half of the relationship: it pins the
 * band's luminance while the fog it has to contrast against keeps moving, so the
 * SIGN of the contrast flips from sector to sector and the silhouette dissolves
 * wherever the two cross. PAN_MESA_LINE spans 0-3050 m — the whole lap — so all
 * three sectors are load-bearing for one tint.
 *
 *   BP_NEAR    0x8c8474  luma 132.6
 *   BP_MID     0x9a9381  luma 147.1
 *   BP_FAR     0xa59e8d  luma 158.3
 *   BP_HORIZON 0xb1aa99  luma 170.3
 *
 * The invariant those four exist to hold: every one sits BELOW the darkest
 * sector fog on the map, so a silhouette reads darker than the air behind it
 * everywhere on the lap. The three sector fog luminances (measured off
 * BITTERPAN_PRODUCTION.json lighting.profiles) are S1 HARVEST BASIN #c7b997
 * 185.5, S2 THE LONG BASIN #d5cfb9 206.7, S3 LOADOUT BASIN #aeb8b2 181.4. The
 * ceiling is S3's 181.4, and BP_HORIZON clears it by 11.1. Hue is unchanged from
 * the delivery — each new value is a uniform RGB scale of the old one, so only
 * value moved, not the grade. Re-tint a band and you re-check it against 181.4;
 * validate-living-world.mjs asserts that bound on every built card, so this is a
 * rule with teeth rather than a note. FUTURISMA_HORIZON_LAYERS.json still lists
 * the delivered BP hexes and is left alone on purpose — it is the record of what
 * was delivered, and THIS table is what the runtime draws.
 *
 * The structural fix — derive each card's tint from the LIVE fog colour rather
 * than a constant — is rejected for now, not unconsidered. It would need
 * per-frame vertex-colour rewrites across all 38 Bitterpan horizon cards,
 * because atmosphere.ts does not step fog per sector: it lerps `fog.color`
 * toward `course.fogAt(progress)` every tick and multiplies that by the
 * time-of-day tint, so there is no frame on which the fog colour is a constant
 * to derive from. If this band ever goes invisible again — a re-graded sector, a
 * fourth sector, a darker time-of-day ramp — the live derivation is the real
 * answer and this table is the workaround that ran out.
 */
const HORIZON_BANDS = Object.freeze({
  GW_NEAR: 0x74827a,
  GW_MID: 0x8b968c,
  GW_FAR: 0xa1aa9f,
  BP_NEAR: 0x8c8474,
  BP_MID: 0x9a9381,
  BP_FAR: 0xa59e8d,
  BP_HORIZON: 0xb1aa99,
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

// ===========================================================================
// P12 art pass 01 — GREENWATER atlas B. APPEND ONLY.
//
// These zones are concatenated AFTER `GREENWATER_ZONES` when the spec is built
// (see `GREENWATER_LIVING_WORLD` below), so the shared `seededRandom(0x13a7)`
// stream reaches every legacy zone with exactly the draws it saw before and
// the 155 accepted cards stay bit-exact. Nothing above this line moved.
//
// Two new batches = two new draw calls, paid honestly: these cards need a
// different texture, so they cannot ride an existing batch.
// ===========================================================================

/** @type {readonly LivingBatchSpec[]} */
export const GREENWATER_BATCHES_B = Object.freeze([
  {
    // Air-suspended cards on the new sheet: birds and low scud. Same treatment
    // as the accepted `air` batch, different texture.
    id: "airB",
    meshName: "GW_LIVING_AIR_B",
    texture: "motionB",
    blending: "normal",
    depthWrite: false,
    fog: true,
    alphaTest: 0,
    lamps: false,
  },
  {
    // Ground-standing silhouettes. This is the only living-world batch that
    // writes depth and alpha-tests, because a wreck sitting on the shoulder
    // has to occlude the mist behind it or it reads as a decal in the air.
    id: "silhouette",
    meshName: "GW_LIVING_SILHOUETTE",
    texture: "motionB",
    blending: "normal",
    depthWrite: true,
    fog: true,
    alphaTest: 0.5,
    lamps: false,
  },
]);

/** @type {readonly LivingZone[]} */
export const GREENWATER_ZONES_B = Object.freeze([
  {
    /**
     * The served-machinery line off the left shoulder of RUNWAY_START.
     *
     * This is the far-field half of the wreck brief; the four hero pieces are
     * geometry and are specified separately. Everything here sits 34-78 m out,
     * which at Greenwater's 650 m far plane and the opening's fog is past the
     * distance where a card and a mesh are distinguishable. They exist to give
     * the eye something that is not gray fog on the outside of the opening
     * straight, and to establish before T1 that this field is a place where
     * airframes are taken apart.
     *
     * `shear` at 0.4 deg is deliberately almost-static. These are not alive.
     * The tiny lean is there so they settle with the same air the mist does
     * rather than sitting perfectly rigid against a moving world.
     */
    id: "OPENING_WRECK_LINE",
    batch: "silhouette",
    from: 28,
    to: 206,
    cards: 14,
    card: (distance, _side, index, next) => {
      const kinds = [
        MOTION_B_RECTS.wreckFuselage,
        MOTION_B_RECTS.wreckTailfin,
        MOTION_B_RECTS.wreckNacelle,
        MOTION_B_RECTS.crateStack,
        MOTION_B_RECTS.wreckGantry,
      ];
      const rect = kinds[index % kinds.length];
      const scale = rect === MOTION_B_RECTS.wreckFuselage ? 1.55
        : rect === MOTION_B_RECTS.wreckGantry ? 1.2
          : rect === MOTION_B_RECTS.crateStack ? 0.62 : 0.95;
      return {
        kind: "shear",
        distance,
        side: -1,
        lateral: 34 + next() * 44,
        base: 0,
        width: (11 + next() * 5) * scale,
        height: (9 + next() * 4) * scale,
        phase: next() * TAU,
        speed: TAU / 9.4,
        amplitude: degToRad(0.4),
        rect,
        tint: 0x6c7a70,
        seed: next(),
      };
    },
  },
  {
    /**
     * A flock over the wetland, crossing the opening straight.
     *
     * The sheet holds three wingbeat frames. The card system fixes one rect
     * per card, so the frames are used as VARIATION ACROSS the flock rather
     * than animation within a card — nine birds, wings at three different
     * points, rocking on `shear`. At 30-60 m that reads as a flock beating,
     * which is the whole ask, and it costs no new card kind.
     */
    id: "OPENING_BIRD_FLOCK",
    batch: "airB",
    from: 44,
    to: 212,
    cards: 9,
    card: (distance, side, index, next) => ({
      kind: "shear",
      distance,
      side,
      lateral: 22 + next() * 30,
      base: 13 + next() * 15,
      width: 7 + next() * 6,
      height: 4.5 + next() * 3.5,
      phase: next() * TAU,
      speed: TAU / (1.4 + next() * 0.5),
      amplitude: degToRad(6.5),
      rect: [MOTION_B_RECTS.birdsA, MOTION_B_RECTS.birdsB,
        MOTION_B_RECTS.birdsC, MOTION_B_RECTS.gull][index % 4],
      tint: 0x4d564e,
      seed: next(),
    }),
  },
  {
    /**
     * Dry scud lifting off the deck, low and wide, the whole sector.
     *
     * The opening is currently gray fog at every height. This puts something
     * moving at ankle height where the eye is already looking — at the racing
     * line — without putting anything in front of it.
     */
    id: "OPENING_DECK_SCUD",
    batch: "airB",
    from: 6,
    to: 218,
    cards: 8,
    card: (distance, side, _index, next) => ({
      kind: "mist",
      distance,
      side,
      lateral: 13 + next() * 12,
      base: 0.5 + next() * 1.1,
      width: 15 + next() * 13,
      height: 1.6 + next() * 1.2,
      phase: next() * TAU,
      speed: 0.62,
      rect: MOTION_B_RECTS.dustScud,
      tint: 0xc3c2b4,
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

// ===========================================================================
// P12 art pass 01 — BITTERPAN atlas B. APPEND ONLY, same rule as Greenwater.
// ===========================================================================

/** @type {readonly LivingBatchSpec[]} */
export const BITTERPAN_BATCHES_B = Object.freeze([
  {
    id: "airB",
    meshName: "BP_LIVING_AIR_B",
    texture: "motionB",
    blending: "normal",
    depthWrite: false,
    fog: true,
    alphaTest: 0,
    lamps: false,
  },
]);

/** @type {readonly LivingZone[]} */
export const BITTERPAN_ZONES_B = Object.freeze([
  {
    /**
     * The salt devils get their own shape.
     *
     * SALT_DUST_DEVILS currently borrows `MOTION_RECTS.steam` — a soft round
     * water-vapour puff — for a dry column of lifted crust. This zone runs
     * the same four stations with the authored devil wisp instead: a narrow
     * leaning column, dense and granular at the base, thinning as it climbs.
     * The accepted zone is left in place and untouched; this layers over it,
     * so the review can compare and the older zone can be retired later
     * without disturbing the seeded stream in the meantime.
     */
    id: "SALT_DEVIL_CORE",
    batch: "airB",
    from: 340,
    to: 2290,
    cards: 8,
    card: (_distance, _side, index, next) => ({
      kind: "devil",
      distance: 340 + Math.floor(index / 2) * 640 + (index % 2) * 8,
      side: Math.floor(index / 2) % 2 === 1 ? 1 : -1,
      lateral: 56 + (index % 2) * 4,
      base: 1 + (index % 2) * 8,
      width: 7 + (index % 2) * 2.5,
      height: 13 + (index % 2) * 5,
      phase: (index % 2) * 1.1 + Math.floor(index / 2) * 0.4,
      speed: TAU / 7.5,
      amplitude: 3.1 + (index % 2) * 1.2,
      hang: 11,
      rect: index % 2 === 0 ? MOTION_B_RECTS.devilWispA : MOTION_B_RECTS.devilWispB,
      tint: 0xe4dcc6,
      seed: next(),
    }),
  },
  {
    /**
     * Crust scud across the long pan. Wider and lower than the heat shimmer
     * it sits under, so the two do not read as one effect at two opacities.
     */
    id: "PAN_CRUST_SCUD",
    batch: "airB",
    from: 180,
    to: 2100,
    cards: 10,
    card: (distance, side, _index, next) => ({
      kind: "mist",
      distance,
      side,
      lateral: 24 + next() * 40,
      base: 0.3 + next() * 0.9,
      width: 26 + next() * 22,
      height: 2 + next() * 1.6,
      phase: next() * TAU,
      speed: 0.5,
      rect: MOTION_B_RECTS.dustScud,
      tint: 0xf0e9d8,
      seed: next(),
      alphaKind: "shimmer",
      alphaInitial: ALPHA_ENVELOPES.shimmer[0],
    }),
  },
]);

// ===========================================================================
// P18 art pass 03 — the world past the barriers. APPEND ONLY.
//
// Distant silhouette cards, authored in this same card idiom so no new runtime
// path exists: `FUTURISMA_HORIZON_LAYERS.json` states the batches, the bands
// and the numeric ranges, and the authors below are the mechanical reading of
// them. The precedent named by the spec is GREENWATER_ZONES_B.OPENING_WRECK_LINE
// — ground-anchored `shear` silhouettes — pushed out from 34-78 m to 180-1400 m.
//
// The append rule is the same one P12 wrote down and is the reason these zones
// are declared here rather than merged into the arrays above: the shared seeded
// stream reaches every legacy zone with exactly the draws it saw before, so
// Greenwater's 155 accepted cards and the P9/P12 additions stay bit-exact.
// Nothing above this line moved.
//
// `base: 0` on every silhouette zone is load-bearing, not a default: the cells
// are authored bottom-anchored so their grade contact is at the cell's own
// bottom edge, and a non-zero base floats the silhouette off the ground.
// ===========================================================================

/** @type {readonly LivingBatchSpec[]} */
export const GREENWATER_BATCHES_C = Object.freeze([
  {
    // depthWrite false, unlike the P12 `silhouette` batch: at 180 m and beyond
    // nothing needs to occlude anything, and writing depth from a card that far
    // out only risks fighting the sky dome. alphaTest 0.5 keeps the edge hard.
    id: "horizon",
    meshName: "GW_LIVING_HORIZON",
    texture: "horizon",
    blending: "normal",
    depthWrite: false,
    fog: true,
    alphaTest: 0.5,
    lamps: false,
    anchor: "bottom",
  },
]);

/** @type {readonly LivingZone[]} */
export const GREENWATER_ZONES_C = Object.freeze([
  {
    // The base layer. Fourteen cards over 2.4 km is one card every 170 m, which
    // closes the horizon without ever putting two in frame at the same size.
    id: "HORIZON_TREELINE_FAR",
    batch: "horizon",
    from: 60,
    to: 2440,
    cards: 14,
    card: (distance, side, index, next) => ({
      kind: "shear",
      distance,
      side,
      lateral: 480 + next() * 120,
      base: 0,
      width: 78 + next() * 26,
      height: 16 + next() * 6,
      phase: next() * TAU,
      speed: TAU / 11.5,
      amplitude: degToRad(0.25),
      rect: [HORIZON_RECTS.treelineDense, HORIZON_RECTS.treelineBroken,
        HORIZON_RECTS.treelineSnag][index % 3],
      tint: HORIZON_BANDS.GW_FAR,
      seed: next(),
    }),
  },
  {
    // The parallax. Two bands moving at different rates is what makes the far
    // one read as far; one band alone reads as wallpaper.
    id: "HORIZON_TREELINE_MID",
    batch: "horizon",
    from: 120,
    to: 2360,
    cards: 9,
    card: (distance, side, index, next) => ({
      kind: "shear",
      distance,
      side,
      lateral: 300 + next() * 80,
      base: 0,
      width: 54 + next() * 18,
      height: 13 + next() * 5,
      phase: next() * TAU,
      speed: TAU / 9.4,
      amplitude: degToRad(0.4),
      rect: [HORIZON_RECTS.treelineBroken, HORIZON_RECTS.treelineSnag][index % 2],
      tint: HORIZON_BANDS.GW_MID,
      seed: next(),
    }),
  },
  {
    // One side only, so consecutive pylons imply a line running away from the
    // course rather than a fence beside it. `sides: "left"` in the spec, and
    // left is side -1 — the same hand OPENING_WRECK_LINE stands its wrecks on.
    id: "HORIZON_PYLON_LINE",
    batch: "horizon",
    from: 300,
    to: 1900,
    cards: 5,
    card: (distance, _side, _index, next) => ({
      kind: "shear",
      distance,
      side: -1,
      lateral: 320 + next() * 40,
      base: 0,
      width: 38 + next() * 6,
      height: 30 + next() * 6,
      phase: next() * TAU,
      speed: TAU / 13,
      amplitude: degToRad(0.15),
      rect: HORIZON_RECTS.pylonRun,
      tint: HORIZON_BANDS.GW_MID,
      seed: next(),
    }),
  },
  {
    // Greenwater is a facility, so its horizon is a facility: the far-field
    // answer to the question the wreck line answers up close.
    id: "HORIZON_FAR_INDUSTRY",
    batch: "horizon",
    from: 420,
    to: 2300,
    cards: 6,
    card: (distance, side, index, next) => ({
      kind: "shear",
      distance,
      side,
      lateral: 500 + next() * 90,
      base: 0,
      width: 46 + next() * 42,
      height: 20 + next() * 14,
      phase: next() * TAU,
      speed: TAU / 12.2,
      amplitude: degToRad(0.2),
      rect: [HORIZON_RECTS.gantryFar, HORIZON_RECTS.hangarMass,
        HORIZON_RECTS.siloPair, HORIZON_RECTS.tankFarmFar][index % 4],
      tint: HORIZON_BANDS.GW_FAR,
      seed: next(),
    }),
  },
]);

/** @type {readonly LivingBatchSpec[]} */
export const BITTERPAN_BATCHES_C = Object.freeze([
  {
    id: "horizon",
    meshName: "BP_LIVING_HORIZON",
    texture: "horizon",
    blending: "normal",
    depthWrite: false,
    fog: true,
    alphaTest: 0.5,
    lamps: false,
    anchor: "bottom",
  },
  {
    // `fog: false` is deliberate and is the ONLY fog exemption in Pass 03: this
    // batch IS the far-field air. Fogging an additive haze band multiplies the
    // effect by itself and the horizon goes milky. Greenwater does not get this
    // batch — its far plane is 650 m and its own fog already does the job.
    //
    // No `anchor` either, and that is the delivery's own carve-out: the two
    // band cells are "the exception: they are additive and authored as tone",
    // not as silhouettes with a grade contact. They keep the centred card
    // convention every other drifting-atmosphere batch uses, and they are the
    // two zones that author a non-zero base for exactly that reason.
    id: "horizonAir",
    meshName: "BP_LIVING_HORIZON_AIR",
    texture: "horizon",
    blending: "additive",
    depthWrite: false,
    fog: false,
    alphaTest: 0,
    lamps: false,
  },
]);

/** @type {readonly LivingZone[]} */
export const BITTERPAN_ZONES_C = Object.freeze([
  {
    // The pan's edge. Eight MESA_LONG to two MESA_BLUFF: the bluff is the one
    // vertical out there and it should be rare enough to be a landmark. Index 4
    // and index 9 take it, so the two are never adjacent. This layer alone
    // changes Bitterpan from a white plane into a basin.
    id: "PAN_MESA_LINE",
    batch: "horizon",
    from: 0,
    to: 3050,
    cards: 10,
    card: (distance, side, index, next) => ({
      kind: "shear",
      distance,
      side,
      lateral: 1200 + next() * 200,
      base: 0,
      width: 240 + next() * 80,
      height: 44 + next() * 18,
      phase: next() * TAU,
      speed: TAU / 15,
      amplitude: degToRad(0.1),
      rect: index % 5 === 4 ? HORIZON_RECTS.mesaBluff : HORIZON_RECTS.mesaLong,
      tint: HORIZON_BANDS.BP_HORIZON,
      seed: next(),
    }),
  },
  {
    // Where the salt goes. The works on this map start and end at the loadout;
    // a refinery on the horizon is what makes the harvest look like it has a
    // customer.
    id: "PAN_REFINERY_FAR",
    batch: "horizon",
    from: 180,
    to: 2900,
    cards: 8,
    card: (distance, side, index, next) => ({
      kind: "shear",
      distance,
      side,
      lateral: 760 + next() * 140,
      base: 0,
      width: 54 + next() * 38,
      height: 42 + next() * 24,
      phase: next() * TAU,
      speed: TAU / 12.6,
      amplitude: degToRad(0.15),
      rect: [HORIZON_RECTS.stackCluster, HORIZON_RECTS.stackSingle,
        HORIZON_RECTS.plantMass][index % 3],
      tint: HORIZON_BANDS.BP_FAR,
      seed: next(),
    }),
  },
  {
    // RIG_FAR is the same stance as LATTICE_RIG on the facade sheet, so the 36
    // textured rigs beside the deck and the field of them on the horizon read
    // as one operation at two distances. The cheapest continuity in the pass.
    id: "PAN_RIG_FIELD_FAR",
    batch: "horizon",
    from: 240,
    to: 2620,
    cards: 8,
    card: (distance, side, _index, next) => ({
      kind: "shear",
      distance,
      side,
      lateral: 460 + next() * 140,
      base: 0,
      width: 30 + next() * 12,
      height: 18 + next() * 8,
      phase: next() * TAU,
      speed: TAU / 10.4,
      amplitude: degToRad(0.3),
      rect: HORIZON_RECTS.rigFar,
      tint: HORIZON_BANDS.BP_MID,
      seed: next(),
    }),
  },
  {
    // Sits behind and under the silhouettes: the band that makes 800 m look
    // like 800 m without touching fog density. Additive and unfogged.
    id: "PAN_HAZE_BAND",
    batch: "horizonAir",
    from: 0,
    to: 3050,
    cards: 7,
    card: (distance, side, _index, next) => ({
      kind: "mist",
      distance,
      side,
      lateral: 700 + next() * 120,
      base: 2 + next() * 4,
      width: 180 + next() * 60,
      height: 18 + next() * 8,
      phase: next() * TAU,
      speed: 0.24,
      rect: HORIZON_RECTS.hazeBand,
      tint: 0xd9cfb4,
      seed: next(),
      alphaKind: "shimmer",
      alphaInitial: ALPHA_ENVELOPES.shimmer[0],
    }),
  },
  {
    // Bottom-weighted heat off the pan, at the base of the mid-band silhouettes
    // so the rig feet dissolve rather than sitting on a hard line. Tint matches
    // PAN_CRUST_SCUD so the two are one atmosphere at two heights.
    id: "PAN_HEAT_SHIMMER_FAR",
    batch: "horizonAir",
    from: 180,
    to: 2400,
    cards: 5,
    card: (distance, side, _index, next) => ({
      kind: "mist",
      distance,
      side,
      lateral: 420 + next() * 140,
      base: next() * 1.5,
      width: 120 + next() * 50,
      height: 10 + next() * 5,
      phase: next() * TAU,
      speed: 0.3,
      rect: HORIZON_RECTS.shimmerBand,
      tint: 0xf0e9d8,
      seed: next(),
      alphaKind: "shimmer",
      alphaInitial: ALPHA_ENVELOPES.shimmer[0],
    }),
  },
]);

// ===========================================================================
// P20.4 — the air crosses the road. APPEND ONLY, same rule as P12 and P18.
//
// The P9/P12 Bitterpan set was authored "deliberately sparse, far off the deck
// and large in scale": nothing it draws is closer than 24 m outboard, so at
// 300 km/h from the chase camera NONE of it crosses the frame. Thirteen station
// screenshots of the P19 build show no living-world card at all. Greenwater
// reads because its mist, rain, glints and fronds are at the kerb (0-12 m).
//
// This block brings four things INSIDE the near field and adds one far one:
//   PAN_SCUD_NEAR      2-14 m outboard, the motion the eye catches at speed
//   PAN_SCUD_CROSSING  walks over the racing line on the new `cross` motion
//   SALT_DEVIL_ROAD    one devil whose orbit reaches the deck, once a lap
//   BRINE_HAZE_LOW     the wet basin breathing, 6-30 m outboard
//   PAN_SKY_HAZE       the band that separates sky from ground at the horizon
//
// The corridor rule these are authored against, asserted card by card in
// validate-living-world.mjs: `lateral` is measured OUTBOARD OF `halfWidth`
// (living-world.ts: `offset = sample.halfWidth + card.lateral`), and the
// drivable corridor on open pan is `halfWidth + 5.8` — so half-width cancels
// and "inside the corridor" is exactly `lateral <= 5.8`, at every station, with
// no course data needed. A card that reaches inside it below 6 m of deck height
// must peak at alpha <= 0.35. Every zone below satisfies that through its
// ENVELOPE (rise 0.34, devil 0.26, cross 0.32) rather than through a per-card
// number a later edit could drift.
// ===========================================================================

/**
 * The three windows PAN_SCUD_NEAR fills: the long pan, the sweep pair, and the
 * return leg. A LivingZone carries one span, so the zone advertises 160-2120 m
 * and each card picks its window off `index` — the SALT_DUST_DEVILS precedent
 * for a zone whose stations are structural rather than evenly spread.
 */
const SCUD_NEAR_WINDOWS = Object.freeze([
  [160, 630],
  [1000, 1600],
  [1640, 2120],
]);

/** THE LONG PAN and RETURN LEG, the two places a scud has room to cross. */
const SCUD_CROSS_WINDOWS = Object.freeze([
  [200, 600],
  [1700, 2100],
]);

/**
 * P20.4 sky haze tint, computed here rather than picked.
 *
 * The three Bitterpan sector fogs (BITTERPAN_PRODUCTION.json lighting.profiles,
 * as re-graded in P19) are S1 #c4ad84, S2 #cec2a2, S3 #aeb8b2 — Rec.709 luma
 * 174.9 / 194.3 / 181.4, mean colour (192.0, 183.7, 157.3) at luma 183.5.
 *
 * The band has to sit under the DARKEST of the three or its contrast changes
 * sign from sector to sector, which is the exact failure P18.2 re-authored the
 * HORIZON_BANDS table for. Target = 174.9 - 15 = 159.9; scaling the mean fog
 * colour by 159.9 / 183.5 = 0.8712 gives (167.3, 160.0, 137.1), and cooling it
 * (red down, blue up, ~5 counts each way, hue only) lands on
 *
 *   0xa2a091 = (162, 160, 145), luma 159.3
 *
 * which is 15.6 under S1, 34.9 under S2 and 22.1 under S3 — inside the 12-18
 * band against the darkest fog, and under all three. validate-living-world.mjs
 * asserts the "under the darkest sector fog" half of that.
 */
const BP_SKY_HAZE_TINT = 0xa2a091;

/** @type {readonly LivingBatchSpec[]} */
export const BITTERPAN_BATCHES_D = Object.freeze([
  {
    // The second fog exemption on the map, and it is the same argument
    // `horizonAir` already carries: this batch IS the far-field air, so fogging
    // it multiplies the effect by itself and the horizon goes milky.
    //
    // It is a SEPARATE batch from `horizonAir` for two reasons that are both
    // render state, not taste. `horizonAir` is ADDITIVE, and an additive card
    // can only ever add light — it cannot put a value BELOW the sky behind it,
    // which is the whole job here. And `horizon` alpha-tests at 0.5, which
    // erases a soft band whose own cell peaks at alpha 0.53. Normal blending,
    // no alpha test, no fog: +1 draw call, and the only one this phase spends.
    id: "skyHaze",
    meshName: "BP_LIVING_SKY_HAZE",
    texture: "horizon",
    blending: "normal",
    depthWrite: false,
    fog: false,
    alphaTest: 0,
    lamps: false,
  },
]);

/** @type {readonly LivingZone[]} */
export const BITTERPAN_ZONES_D = Object.freeze([
  {
    /**
     * Near-field salt scud, 2-14 m outboard of the deck edge — the first cards
     * on this map inside the distance the chase camera actually resolves at
     * 300 km/h. `shear` rather than `flow`, because `flow` writes a FLAT
     * ground-plane quad (writeFlatCard) that is edge-on to a camera looking
     * down the road and therefore invisible; `shear` is camera-facing and leans
     * with the 292 deg wind, which is the read the blockout authored.
     *
     * CELLS, MEASURED. The brief named DUST_SCUD / VAPOR_THIN and those cells
     * cannot carry a near-field read: sampled off greenwater_motion_b_512,
     * DUST_SCUD is 12.8% covered with a 0.029 MEAN alpha and VAPOR_THIN 56.3%
     * at 0.042, against MIST 53.4% at 0.167 and STEAM 64.6% at 0.226 on the
     * first motion sheet. At the 0.34 envelope ceiling below, a DUST_SCUD card
     * averages 1% opacity — and a diagnostic pass that forced these cards to
     * flat magenta at vertex alpha 1.0 still rendered a barely-visible smudge
     * (shots/p20.4/garish). MIST and STEAM are six to eight times denser, are
     * the cells SALT_DUST_DEVILS already uses for dry lifted crust, and put the
     * zone on the `air` batch, which costs no draw call either way.
     *
     * Alpha rides the `rise` envelope (peak 0.34) rather than `mist` (0.46):
     * the inner cards sit at lateral 2-5.8 m, inside the drivable corridor and
     * below 6 m, so 0.35 is a hard ceiling and the envelope is what holds it.
     * The envelope's birth-and-dissolve shape also gives the scud a life rather
     * than a loop, which is what separates it from PAN_CRUST_SCUD above.
     */
    id: "PAN_SCUD_NEAR",
    batch: "air",
    from: 160,
    to: 2120,
    cards: 34,
    card: (_distance, side, index, next) => {
      const window = SCUD_NEAR_WINDOWS[index % 3];
      const slot = Math.floor(index / 3);
      return {
        kind: "shear",
        distance: window[0] + (window[1] - window[0]) * (slot + 0.5) / 12,
        side,
        lateral: 2 + next() * 12,
        base: 0.2 + next() * 1.2,
        width: 6 + next() * 8,
        height: 1.2 + next() * 1.4,
        phase: next() * TAU,
        speed: 0.09 + next() * 0.05,
        amplitude: degToRad(6.5),
        rect: index % 3 === 2 ? MOTION_RECTS.steam : MOTION_RECTS.mist,
        upright: true,
        tint: 0xe6dcc4,
        seed: next(),
        alphaKind: "rise",
        alphaInitial: ALPHA_ENVELOPES.rise[0],
      };
    },
  },
  {
    /**
     * Scud that crosses the racing line. This is the one card in the set the
     * driver cannot miss, so it is also the one held hardest: the `cross`
     * envelope peaks at 0.32, under the 0.35 corridor cap, and both ends of the
     * traverse are alpha 0 so the sawtooth reset is never seen.
     *
     * `amplitude` is half the traverse. The anchor sits at `halfWidth + lateral`
     * outboard, so an amplitude of 34 m carries the card from ~34 m beyond its
     * own shoulder to ~9 m past the far edge of the deck, over 1 / speed = 9 s.
     */
    id: "PAN_SCUD_CROSSING",
    batch: "air",
    from: 200,
    to: 2100,
    cards: 10,
    card: (_distance, side, index, next) => {
      const window = SCUD_CROSS_WINDOWS[index % 2];
      const slot = Math.floor(index / 2);
      return {
        kind: "cross",
        distance: window[0] + (window[1] - window[0]) * (slot + 0.5) / 5,
        side,
        lateral: 8 + next() * 6,
        base: 0.3 + next() * 0.6,
        width: 10 + next() * 8,
        height: 2.2 + next() * 1.4,
        phase: next(),
        speed: 1 / 9,
        amplitude: 34,
        rect: MOTION_RECTS.mist,
        upright: true,
        tint: 0xe2d8bf,
        seed: next(),
        alphaKind: "cross",
        alphaInitial: ALPHA_ENVELOPES.cross[0],
      };
    },
  },
  {
    /**
     * The devil that walks onto the road, at the CONE ROW SWEEP entry. The four
     * at 58 m outboard stay where they are; this is one column on the SAME
     * SALT_DEVIL_CORE idiom whose orbit centre is the deck edge (lateral 0) and
     * whose orbit radius reaches 16 m, so the column crosses the deck rather
     * than standing beside it.
     *
     * The corridor rule is answered on the ALPHA side, not the height side: the
     * lowest card bases at 1.4 m, well under 6 m, and the `devil` envelope
     * peaks at 0.26 — the quietest ceiling in the set and comfortably under
     * 0.35. Lifting it above 6.5 m instead was the alternative and it is the
     * wrong one here: a dust devil that starts above head height is not a dust
     * devil, it is a cloud.
     */
    id: "SALT_DEVIL_ROAD",
    batch: "air",
    from: 1198,
    to: 1240,
    cards: 4,
    card: (_distance, _side, index, next) => ({
      kind: "devil",
      distance: 1210 + index * 5,
      side: -1,
      lateral: 0,
      base: 1.4 + index * 5.2,
      width: 6 + index * 2.2,
      height: 11 + index * 3.5,
      phase: index * 1.05,
      speed: TAU / 8.5,
      amplitude: 16,
      hang: 12,
      rect: index % 2 === 0 ? MOTION_RECTS.steam : MOTION_RECTS.mist,
      upright: true,
      tint: 0xded5bd,
      seed: next(),
      alphaKind: "devil",
      alphaInitial: ALPHA_ENVELOPES.devil[0],
    }),
  },
  {
    /**
     * WET PAN BEND into BRINE CUT is the only wet ground on the map, and it is
     * the one sector allowed to look humid. Wide, low, slow: 28-44 m of card
     * 2-4 m tall lying 6-30 m outboard, so the basin breathes without any of it
     * reaching the corridor (lateral floor 6 m clears the 5.8 m edge).
     *
     * `mist` drift for the motion and the `rise` envelope for the alpha, whose
     * 0.34 peak is under the 0.4 the sector can carry before the pan stops
     * reading as open. The two clocks are deliberately the same `card.speed`,
     * so a card is brightest in the middle of its own drift.
     */
    id: "BRINE_HAZE_LOW",
    batch: "air",
    from: 2600,
    to: 2960,
    cards: 16,
    card: (distance, side, _index, next) => ({
      kind: "mist",
      distance,
      side,
      lateral: 6 + next() * 24,
      base: 0.1 + next() * 0.5,
      width: 28 + next() * 16,
      height: 2 + next() * 2,
      phase: next() * TAU,
      speed: 0.1 + next() * 0.04,
      rect: MOTION_RECTS.mist,
      upright: true,
      tint: 0xd9e0dc,
      seed: next(),
      alphaKind: "rise",
      alphaInitial: ALPHA_ENVELOPES.rise[0],
    }),
  },
  {
    /**
     * The horizon band. PAN_HAZE_BAND (P18, `horizonAir`) is EXTENDED rather
     * than replaced — it stays exactly as authored, seven additive cards at
     * 700-820 m that tint the far field — because retiring it would move the
     * seeded stream. What it cannot do is separate sky from ground: it is
     * additive, so it can only add light to both, and at 700-820 m with an 18-26
     * m card it lands well under the horizon line from most stations.
     *
     * This zone is the continuous ring: 30 cards at 1320-1500 m, each 300-480 m
     * wide (>= 260 m), standing from ~8 m to ~168 m above the deck. That is
     * roughly 0.2-6.8 deg of elevation at 1400 m and still covers 0.4-5.2 deg at
     * the 1800 m far plane, so the band brackets the horizon row from every
     * station rather than only from the ones a card happens to face. The bottom
     * edge stays ABOVE eye level at every distance, which is the property that
     * keeps it out of the ground band it is supposed to contrast against.
     *
     * `shear` at 0.06 deg is a stand-still: this is tone, and tone that drifts
     * reads as cloud. No alphaKind, so the vertex alpha below is the constant
     * the material draws with; the cell's own alpha peaks at 0.53, so the band
     * lands at ~0.40 effective at its densest and fades to nothing upward.
     *
     * SEVENTY-TWO IS A MEASURED NUMBER, NOT A ROUND ONE. The card count was
     * swept against frame-metrics.py's sky band (rows 308-331) on matched race
     * poses, shots/p20.4/timed-live vs timed-nolive at clock 21299 ms:
     *
     *   30 cards @ alpha 0.66   sky band -2.3 luma
     *   72 cards @ alpha 0.75   sky band -7.0 luma
     *  150 cards @ alpha 0.75   sky band -7.5 luma   <- saturated
     *
     * The ceiling is COVERAGE, not opacity: the band's dense rows only fill
     * about a third of that 24-row window, so past ~72 cards more ring buys
     * fill rate and nothing else. 72 is the knee — 93% of the saturated effect
     * for half the overdraw of 150.
     */
    id: "PAN_SKY_HAZE",
    batch: "skyHaze",
    from: 0,
    to: 3050,
    cards: 72,
    card: (distance, side, _index, next) => {
      // Authored as BOTTOM EDGE + height, then converted, because `base` on a
      // centred batch is the card's middle and the thing that has to hold is
      // where the band's bottom lands: above the chase camera's eye, or the
      // band drops under the horizon line and darkens the ground it exists to
      // separate from. Drawing base and height independently let the bottom
      // wander to -2 m, which is how this was first authored and what
      // validate-living-world.mjs now refuses.
      const bottom = 10 + next() * 4;
      const height = 140 + next() * 40;
      return {
        kind: "shear",
        distance,
        side,
        lateral: 1320 + next() * 180,
        base: bottom + height / 2,
        width: 300 + next() * 180,
        height,
        phase: next() * TAU,
        speed: TAU / 22,
        amplitude: degToRad(0.06),
        rect: HORIZON_RECTS.hazeBand,
        upright: true,
        tint: BP_SKY_HAZE_TINT,
        seed: next(),
        alphaInitial: 0.75,
      };
    },
  },
]);

/**
 * @type {LivingWorldSpec}
 *
 * P12: the atlas-B batches and zones are CONCATENATED onto the accepted arrays
 * rather than spliced into them. `buildLivingWorld` walks `zones` in order off
 * one seeded stream, so appending is the only edit that leaves the 155 accepted
 * Greenwater cards and the 98 Bitterpan cards bit-for-bit identical —
 * `scripts/validate-living-world.mjs` pins all of them field by field.
 */
export const GREENWATER_LIVING_WORLD = Object.freeze({
  id: "GREENWATER",
  course: "greenwater",
  rootName: "GW_LIVING_RUNTIME",
  seed: 0x13a7,
  courseLength: 2515.982,
  batches: Object.freeze([
    ...GREENWATER_BATCHES, ...GREENWATER_BATCHES_B, ...GREENWATER_BATCHES_C,
  ]),
  zones: Object.freeze([
    ...GREENWATER_ZONES, ...GREENWATER_ZONES_B, ...GREENWATER_ZONES_C,
  ]),
});

/** @type {LivingWorldSpec} */
export const BITTERPAN_LIVING_WORLD = Object.freeze({
  id: "BITTERPAN",
  course: "bitterpan",
  rootName: "BP_LIVING_RUNTIME",
  seed: 0x2b17,
  courseLength: 3050,
  batches: Object.freeze([
    ...BITTERPAN_BATCHES, ...BITTERPAN_BATCHES_B, ...BITTERPAN_BATCHES_C,
    ...BITTERPAN_BATCHES_D,
  ]),
  zones: Object.freeze([
    ...BITTERPAN_ZONES, ...BITTERPAN_ZONES_B, ...BITTERPAN_ZONES_C,
    ...BITTERPAN_ZONES_D,
  ]),
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
