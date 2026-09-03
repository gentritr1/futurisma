import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  ALPHA_ENVELOPES,
  buildLivingWorld,
  CARD_KINDS,
  CARD_TRIANGLES,
  LAMP_KINDS,
  LIVING_WORLD_SPECS,
  LIVING_WORLD_UPDATE_HZ,
} from "../src/game/living-world-zones.js";

/**
 * P9 living-world guard.
 *
 * The card layer is authored art with a hard perf ceiling, and its Greenwater
 * half was already accepted before P9 expanded it. This validator therefore
 * does three different jobs:
 *
 * 1. **Pin the accepted Greenwater zones.** The eleven pre-P9 zones are
 *    authored off one shared random stream, so *any* edit above them in
 *    `living-world-zones.js` — a reordered zone, an extra `next()` draw, a
 *    changed count — silently moves cards that a review already signed off.
 *    The digests below were computed from the pre-P9 `living-world.ts`
 *    constructor, not from the current module.
 * 2. **Hold the budget.** Cards, triangles and draw calls per map.
 * 3. **Keep the data and the runtime in agreement.** A zone naming a motion
 *    the runtime cannot advance renders a card that never moves, and nothing
 *    else in the build would catch it.
 */

/** Authored lap lengths, read back from the map data the courses are built on. */
const COURSE_LENGTHS = {
  greenwater: JSON.parse(
    readFileSync(new URL("../src/game/data/greenwater-blockout.json", import.meta.url), "utf8"),
  ).centreline.lapLength,
  bitterpan: Math.round(JSON.parse(
    readFileSync(new URL("../src/game/data/map02/CENTRELINE_STATIONS.json", import.meta.url), "utf8"),
  ).total_length_m),
};

/**
 * Per-map ceilings. Greenwater's triangle budget is the accepted 310 plus the
 * roadmap's +2,000; Bitterpan is a new layer and is bounded by its card count.
 */
const BUDGETS = {
  // P12 tightens both maps onto the art-pass-01 numbers. These are the measured
  // post-integration costs, not headroom: Greenwater 4 accepted batches + the 2
  // atlas-B batches, 215 accepted cards + the 31 opening-straight cards;
  // Bitterpan 3 + 1 batches, 98 + 18 cards. A new zone now has to be argued for
  // against a real ceiling rather than slipped into slack.
  //
  // P18 art pass 03 re-baselines both maps by exactly the horizon layer and no
  // more: Greenwater +1 batch / +34 cards, Bitterpan +2 batches / +38 cards.
  // Same rule as P12 — these are measured post-integration costs, not headroom.
  //
  // P20.4 re-baselines Bitterpan and only Bitterpan: +1 batch (`skyHaze`, the
  // single draw call the phase was allowed) and +136 cards. Same rule again —
  // these are the measured post-integration costs of the five zones the phase
  // adds, not headroom. Greenwater is untouched by P20.4 and does not move.
  //
  // P20.4 ROUND 2 adds ten more cards and no batch: PAN_SCUD_CROSSING goes
  // 10 -> 20. That is the zone that puts air over the racing line, and at ten
  // cards over 2360 m it was one every 236 m — measured on the review station
  // table (shots/p20.4r2/station-coverage.mjs), six of the thirteen stations
  // had no crossing card anywhere in the 15-150 m window where a card is both
  // in frame and big enough to read. Twenty is one every 118 m and every
  // station has one. Draw calls do not move; the cost is 20 triangles.
  greenwater: { drawCalls: 7, cards: 280, triangles: 560 },
  bitterpan: { drawCalls: 7, cards: 300, triangles: 600 },
};

/**
 * The four accepted Greenwater batches. A batch is a draw call *and* a render
 * state, so this pins the blending and depth behaviour of the accepted layer,
 * not just the count.
 */
const ACCEPTED_GREENWATER_BATCHES = [
  { id: "air", meshName: "GW_LIVING_AIR", texture: "motion", blending: "normal", depthWrite: false, fog: true, alphaTest: 0, lamps: false },
  { id: "water", meshName: "GW_LIVING_WATER", texture: "motion", blending: "additive", depthWrite: false, fog: true, alphaTest: 0, lamps: false },
  { id: "foliage", meshName: "GW_LIVING_FOLIAGE", texture: "jungle", blending: "normal", depthWrite: true, fog: true, alphaTest: 0.5, lamps: false },
  { id: "lamps", meshName: "GW_LIVING_LAMPS", texture: "emissive", blending: "additive", depthWrite: false, fog: false, alphaTest: 0, lamps: true },
];

/**
 * The accepted Greenwater layer, zone by zone. `digest` is sha256 over every
 * authored field of every card in the zone, truncated to 64 bits, recomputed
 * from the pre-P9 source at the time P9 landed.
 */
const ACCEPTED_GREENWATER_ZONES = [
  { id: "MIST_WATER_TABLE", batch: "air", from: 300, to: 470, cards: 14, digest: "fdac5c6564a7c84a" },
  { id: "MIST_CANOPY", batch: "air", from: 1180, to: 1330, cards: 12, digest: "3ef6adf517323983" },
  { id: "STEAM_HANGAR_VENTS", batch: "air", from: 700, to: 815, cards: 10, digest: "4b08975ec435a4e6" },
  { id: "RAIN_SWEEP", batch: "air", from: 860, to: 1030, cards: 22, digest: "b0aae97506b8ce45" },
  { id: "GLINT_WATER_TABLE", batch: "water", from: 300, to: 470, cards: 26, digest: "bfdef5c1ed0d9002" },
  { id: "GLINT_SWEEP_DRAINAGE", batch: "water", from: 860, to: 1030, cards: 18, digest: "20005f587d5c7d53" },
  { id: "VINE_SWAY_CANOPY", batch: "foliage", from: 1180, to: 1330, cards: 20, digest: "57bd914e34662656" },
  { id: "FROND_SWAY_SWEEP", batch: "foliage", from: 860, to: 1030, cards: 16, digest: "f5a159bc7925b511" },
  { id: "PUMP_LAMPS_FUEL_ROW", batch: "lamps", from: 1900, to: 2100, cards: 9, digest: "0fed0714b28e0f84" },
  { id: "CRANE_APEX_BEACON", batch: "lamps", from: 760, to: 800, cards: 2, digest: "d7aae026fc87b3bb" },
  { id: "MACHINERY_DISTANT", batch: "lamps", from: 690, to: 820, cards: 6, digest: "63e6c7d02156a51c" },
];

/** The P9 additions, pinned the same way so a later phase cannot drift them. */
const P9_ZONES = [
  { id: "FUEL_VAPOR_TANK_ROW", map: "greenwater", batch: "air", from: 1690, to: 1980, cards: 20, digest: "d66ed578b9a58711" },
  { id: "FUEL_ROW_PERIMETER_BEACONS", map: "greenwater", batch: "lamps", from: 1620, to: 2100, cards: 12, digest: "3bbc0b801f6152ca" },
  { id: "RUNWAY_APPROACH_STROBES", map: "greenwater", batch: "lamps", from: 2290, to: 2500, cards: 14, digest: "005fc48d156b8917" },
  { id: "RUNWAY_MIST_DRIFT", map: "greenwater", batch: "air", from: 2270, to: 2500, cards: 14, digest: "15a317faeb83e273" },
  { id: "HEAT_SHIMMER_LONG_PAN", map: "bitterpan", batch: "air", from: 160, to: 630, cards: 22, digest: "43e4f59719de4be7" },
  { id: "HEAT_RISE_RETURN_LEG", map: "bitterpan", batch: "air", from: 1640, to: 2120, cards: 18, digest: "0fe50a6db07e950d" },
  { id: "SALT_DUST_DEVILS", map: "bitterpan", batch: "air", from: 340, to: 2290, cards: 16, digest: "291dddd04dd71174" },
  { id: "HARVESTER_RIG_BEACONS", map: "bitterpan", batch: "lamps", from: 420, to: 1500, cards: 10, digest: "ce59f257a19896e3" },
  { id: "CONVEYOR_SPILL_WORKS", map: "bitterpan", batch: "glint", from: 2860, to: 3040, cards: 20, digest: "096a5474d691c95c" },
  { id: "UNDERPASS_HAZARD_LAMPS", map: "bitterpan", batch: "lamps", from: 3008, to: 3046, cards: 9, digest: "dc3d58ae81334218" },
  { id: "LOADOUT_TOWER_BEACON", map: "bitterpan", batch: "lamps", from: 2980, to: 3010, cards: 3, digest: "bbf2009fc05e8e91" },
];

/**
 * P12 art pass 01. The batches appended after the accepted ones, per map. These
 * are the only living-world batches that may name the second motion sheet, and
 * `silhouette` is the only one in the layer that writes depth — a wreck on the
 * shoulder has to occlude the mist behind it.
 */
const P12_BATCHES = {
  greenwater: [
    { id: "airB", meshName: "GW_LIVING_AIR_B", texture: "motionB", blending: "normal", depthWrite: false, fog: true, alphaTest: 0, lamps: false },
    { id: "silhouette", meshName: "GW_LIVING_SILHOUETTE", texture: "motionB", blending: "normal", depthWrite: true, fog: true, alphaTest: 0.5, lamps: false },
  ],
  bitterpan: [
    { id: "airB", meshName: "BP_LIVING_AIR_B", texture: "motionB", blending: "normal", depthWrite: false, fog: true, alphaTest: 0, lamps: false },
  ],
};

/** P12 art pass 01 zones, pinned the same way P9's were. */
const P12_ZONES = [
  { id: "OPENING_WRECK_LINE", map: "greenwater", batch: "silhouette", from: 28, to: 206, cards: 14, digest: "858e30f79ba99ef7" },
  { id: "OPENING_BIRD_FLOCK", map: "greenwater", batch: "airB", from: 44, to: 212, cards: 9, digest: "bb59783a361f2be0" },
  { id: "OPENING_DECK_SCUD", map: "greenwater", batch: "airB", from: 6, to: 218, cards: 8, digest: "aeb28d1007059468" },
  { id: "SALT_DEVIL_CORE", map: "bitterpan", batch: "airB", from: 340, to: 2290, cards: 8, digest: "979fe240083dc19d" },
  { id: "PAN_CRUST_SCUD", map: "bitterpan", batch: "airB", from: 180, to: 2100, cards: 10, digest: "25baa6f85792d865" },
];

/**
 * P18 art pass 03. The horizon batches, appended after P12's. Greenwater takes
 * one; Bitterpan takes two, and the second is the ONLY batch on either map that
 * is both additive and unfogged — that is the deliberate, single fog exemption
 * of Pass 03 (`horizonAir` IS the far-field air, and fogging an additive haze
 * band multiplies the effect by itself).
 */
const P18_BATCHES = {
  greenwater: [
    { id: "horizon", meshName: "GW_LIVING_HORIZON", texture: "horizon", blending: "normal", depthWrite: false, fog: true, alphaTest: 0.5, lamps: false, anchor: "bottom" },
  ],
  bitterpan: [
    { id: "horizon", meshName: "BP_LIVING_HORIZON", texture: "horizon", blending: "normal", depthWrite: false, fog: true, alphaTest: 0.5, lamps: false, anchor: "bottom" },
    { id: "horizonAir", meshName: "BP_LIVING_HORIZON_AIR", texture: "horizon", blending: "additive", depthWrite: false, fog: false, alphaTest: 0, lamps: false },
  ],
};

/**
 * P18 art pass 03 zones, pinned the way P9's and P12's are.
 *
 * The three Bitterpan `horizon` digests were re-baselined once, in P18.2, and
 * the history is kept here rather than dropped because the reason matters more
 * than the hash. `canonicalCard` folds `card.tint` in, so re-tinting a band
 * moves its zone digest and nothing else — which is exactly the containment
 * check the re-baseline rests on:
 *
 *   PAN_MESA_LINE      47f0a65fa1df8335 -> 0dc645008d33810e  (BP_HORIZON)
 *   PAN_REFINERY_FAR   c11a9f235ecf3769 -> 7c1baca536fd8c79  (BP_FAR)
 *   PAN_RIG_FIELD_FAR  58bd17b3021d3947 -> 9e6b64e2c684bcaa  (BP_MID)
 *
 * Why: the P18 tints were the frozen output of a fog-pull rule, and BP_HORIZON
 * landed at luma 193.3 — ABOVE two of Bitterpan's three sector fogs (185.5 /
 * 206.7 / 181.4). The mesa line was therefore lighter than the air behind it in
 * S1 and S3 and read as near-invisible. P18.2 re-authored the four BP bands as
 * absolute luminance targets that all sit under the darkest sector fog; see the
 * HORIZON_BANDS comment in living-world-zones.js. Nothing else about these
 * zones moved: the six other P18 digests, all six geometry fields per zone, and
 * both Greenwater/Bitterpan card counts are unchanged from the P18 baseline, so
 * a digest drift on any zone but these three is still a real regression.
 */
const P18_ZONES = [
  { id: "HORIZON_TREELINE_FAR", map: "greenwater", batch: "horizon", from: 60, to: 2440, cards: 14, digest: "d6a8548e2008fc56" },
  { id: "HORIZON_TREELINE_MID", map: "greenwater", batch: "horizon", from: 120, to: 2360, cards: 9, digest: "9c1ece39fce89145" },
  { id: "HORIZON_PYLON_LINE", map: "greenwater", batch: "horizon", from: 300, to: 1900, cards: 5, digest: "99dc098226fd514a" },
  { id: "HORIZON_FAR_INDUSTRY", map: "greenwater", batch: "horizon", from: 420, to: 2300, cards: 6, digest: "c87873ffddfd2af1" },
  { id: "PAN_MESA_LINE", map: "bitterpan", batch: "horizon", from: 0, to: 3050, cards: 10, digest: "0dc645008d33810e" },
  { id: "PAN_REFINERY_FAR", map: "bitterpan", batch: "horizon", from: 180, to: 2900, cards: 8, digest: "7c1baca536fd8c79" },
  { id: "PAN_RIG_FIELD_FAR", map: "bitterpan", batch: "horizon", from: 240, to: 2620, cards: 8, digest: "9e6b64e2c684bcaa" },
  { id: "PAN_HAZE_BAND", map: "bitterpan", batch: "horizonAir", from: 0, to: 3050, cards: 7, digest: "441b6a162eabed89" },
  { id: "PAN_HEAT_SHIMMER_FAR", map: "bitterpan", batch: "horizonAir", from: 180, to: 2400, cards: 5, digest: "05283e34b081cd49" },
];

/**
 * P20.4 — the air crosses the road. One batch, appended after P18's.
 *
 * `skyHaze` is the second non-lamp fog exemption on the map and the first new
 * batch since P18. It could not ride either horizon batch: `horizonAir` is
 * ADDITIVE (it can only add light to the sky, never put a value below it) and
 * `horizon` alpha-tests at 0.5, which erases a band whose own cell peaks at
 * 0.53. Normal blending, no alpha test, no fog.
 */
const P20_BATCHES = {
  greenwater: [],
  bitterpan: [
    { id: "skyHaze", meshName: "BP_LIVING_SKY_HAZE", texture: "horizon", blending: "normal", depthWrite: false, fog: false, alphaTest: 0, lamps: false },
  ],
};

/**
 * P20.4 zones, pinned the way P9's, P12's and P18's are, plus `kind` — because
 * for this phase the MOTION is the deliverable. `PAN_SCUD_CROSSING` authored as
 * anything but `cross` does not cross; `PAN_SCUD_NEAR` authored as `flow`
 * renders a flat ground quad that is edge-on to the chase camera and invisible,
 * which is the exact class of mistake the P9 Bitterpan set shipped.
 */
// ROUND 2 re-pins all five. What moved and why, zone by zone:
//   PAN_SCUD_NEAR      span 2120 -> 2560 and the three authored windows dropped
//                      for the even spread; two lateral tiers (inner 2.0-5.6 m
//                      on `rise`, shoulder 6.2-8.0 m on `scudShoulder`); tint
//                      0xe6dcc4 -> 0x4a4136; STEAM on the shoulder tier.
//   PAN_SCUD_CROSSING  10 -> 20 cards, span 2100 -> 2560, windows dropped,
//                      tint 0xe2d8bf -> 0x453d33.
//   SALT_DEVIL_ROAD    tint 0xded5bd -> 0x3f382e. Nothing else.
//   BRINE_HAZE_LOW     lateral floor 6 -> 7.5 m (which is what buys it the
//                      `brineSwell` envelope), tint 0xd9e0dc -> 0xb9c1bd.
//   PAN_SKY_HAZE       NOT re-authored. Its digest moves because it is the last
//                      zone on a single seeded stream and the ten extra
//                      crossing cards ahead of it shift that stream. Same 72
//                      cards, same BP_SKY_HAZE_TINT, same bottom-above-eye
//                      construction, all still asserted below; the ring is a
//                      re-roll of the same distribution, not a re-author.
const P20_ZONES = [
  { id: "PAN_SCUD_NEAR", map: "bitterpan", batch: "air", from: 160, to: 2560, cards: 34, kind: "shear", digest: "ab3f4ec74c7398b7" },
  { id: "PAN_SCUD_CROSSING", map: "bitterpan", batch: "air", from: 200, to: 2560, cards: 20, kind: "cross", digest: "31c527cecfc96d37" },
  { id: "SALT_DEVIL_ROAD", map: "bitterpan", batch: "air", from: 1198, to: 1240, cards: 4, kind: "devil", digest: "e27b47f8ced41c7b" },
  { id: "BRINE_HAZE_LOW", map: "bitterpan", batch: "air", from: 2600, to: 2960, cards: 16, kind: "mist", digest: "a969ac97c2c2b2ac" },
  { id: "PAN_SKY_HAZE", map: "bitterpan", batch: "skyHaze", from: 0, to: 3050, cards: 72, kind: "shear", digest: "b1aa89e52e9cc2c8" },
];

/**
 * P20.4 — THE CORRIDOR RULE.
 *
 * `lateral` is measured OUTBOARD of the deck half-width: living-world.ts places
 * a card at `sample.halfWidth + card.lateral` along the course right vector. The
 * drivable corridor on Bitterpan's open pan is `halfWidth + 5.8` (edge C of
 * BITTERPAN_PRODUCTION.json authors 5.8 m of run-off), so half-width cancels out
 * of both sides and "this card reaches inside the corridor" is exactly
 * `reachableLateral <= 5.8` — true at every station, with no course sampling and
 * no half-width table to drift.
 *
 * A card that gets inside it below 6 m of deck height has to peak at alpha 0.35
 * or under, or it is a whiteout on the racing line. Bitterpan only: 5.8 m is
 * Bitterpan's own run-off width, and Greenwater's aprons are authored per
 * sector, so the same constant would be a different rule over there.
 */
const CORRIDOR_LATERAL_METRES = 5.8;
const CORRIDOR_HEIGHT_METRES = 6;
const CORRIDOR_ALPHA_CEILING = 0.35;

/**
 * The smallest `lateral` a card's own MOTION can carry it to.
 *
 * The default is the authored lateral, and every kind that moves a card
 * sideways is named — because a rule that reads the anchor and not the motion
 * would wave `cross` and `devil` straight through, and those are the two kinds
 * this phase put on the deck on purpose.
 */
function reachableLateral(card) {
  // `cross` walks `amplitude` metres either side of its anchor; `devil` orbits
  // out to `amplitude`; `mist` drifts `speed * 9` along the camera right vector
  // (living-world.ts, case "mist").
  if (card.kind === "cross" || card.kind === "devil") {
    return card.lateral - (card.amplitude ?? 0);
  }
  if (card.kind === "mist") return card.lateral - card.speed * 9;
  return card.lateral;
}

/** The highest alpha a card can ever draw at. */
function peakAlpha(card) {
  if (card.alphaKind) return ALPHA_ENVELOPES[card.alphaKind][1];
  return card.alphaInitial ?? 1;
}

/**
 * The invariant the P18.2 re-baseline actually protects, asserted rather than
 * described: every Bitterpan horizon band must be DARKER than the darkest
 * sector fog on the map, or the silhouette's contrast changes sign somewhere on
 * a lap and the layer dissolves there. Pinning the digests alone would let a
 * future re-tint sail through with the same failure the digests were rebaselined
 * for. Luminance is Rec.709 on the raw 8-bit channels, which is what the eye
 * sorts these two surfaces by.
 */
// P19: mirrors the P19 fog re-grade in BITTERPAN_PRODUCTION.json (S1
// #c7b997 -> #c4ad84, S2 #d5cfb9 -> #cec2a2; S3 unchanged). The relational
// assertion below is unchanged and still the point: every horizon band stays
// darker than the darkest sector fog, now luma 174.9 (S1).
const BP_SECTOR_FOG_HEXES = ["#c4ad84", "#cec2a2", "#aeb8b2"];
const rec709 = (hex) => {
  const value = typeof hex === "number" ? hex : Number.parseInt(hex.slice(1), 16);
  return 0.2126 * ((value >> 16) & 0xff)
    + 0.7152 * ((value >> 8) & 0xff)
    + 0.0722 * (value & 0xff);
};

const NUMERIC_FIELDS = [
  "distance",
  "side",
  "lateral",
  "base",
  "width",
  "height",
  "phase",
  "speed",
  "tint",
  "seed",
];

/**
 * Canonical serialization of one authored card. Numbers go through
 * `JSON.stringify`, which round-trips a double exactly, so the digest changes
 * on a one-ulp move.
 *
 * @param {Record<string, any>} card
 * @returns {string}
 */
function canonicalCard(card) {
  return JSON.stringify([
    card.motionId,
    card.kind,
    card.batch,
    card.distance,
    card.side,
    card.lateral,
    card.base,
    card.width,
    card.height,
    card.phase,
    card.speed,
    card.tint,
    card.seed,
    card.amplitude ?? null,
    card.hang ?? null,
    card.alphaKind ?? null,
    card.alphaInitial ?? null,
    card.rect.x,
    card.rect.y,
    card.rect.size,
    card.rect.sheetSize,
  ]);
}

const kinds = new Set(CARD_KINDS);
const lampKinds = new Set(LAMP_KINDS);
const alphaKinds = new Set(Object.keys(ALPHA_ENVELOPES));

/** @type {Map<string, string>} */
const zoneDigests = new Map();
/** @type {Record<string, ReturnType<typeof buildLivingWorld>>} */
const built = {};

for (const [map, spec] of Object.entries(LIVING_WORLD_SPECS)) {
  assert.equal(spec.course, map, `Zone set ${spec.id} is filed under ${map}.`);
  const courseLength = COURSE_LENGTHS[map];
  assert.ok(courseLength, `No authored lap length is known for ${map}.`);
  assert.ok(
    Math.abs(spec.courseLength - courseLength) < 0.5,
    `${spec.id} declares a ${spec.courseLength} m lap; the authored map data says `
      + `${courseLength} m. Zone distances are metres, so this must not drift.`,
  );

  const batchIds = new Set(spec.batches.map((batch) => batch.id));
  assert.equal(
    batchIds.size,
    spec.batches.length,
    `${spec.id} declares a duplicate batch id.`,
  );
  const meshNames = new Set(spec.batches.map((batch) => batch.meshName));
  assert.equal(
    meshNames.size,
    spec.batches.length,
    `${spec.id} declares a duplicate batch mesh name.`,
  );

  const zoneIds = new Set(spec.zones.map((zone) => zone.id));
  assert.equal(zoneIds.size, spec.zones.length, `${spec.id} declares a duplicate zone id.`);

  for (const zone of spec.zones) {
    assert.ok(batchIds.has(zone.batch), `${zone.id} targets unknown batch ${zone.batch}.`);
    assert.ok(zone.cards >= 1, `${zone.id} authors ${zone.cards} cards.`);
    assert.ok(zone.from >= 0, `${zone.id} starts at ${zone.from} m, before the line.`);
    assert.ok(zone.to > zone.from, `${zone.id} spans ${zone.from}-${zone.to} m.`);
    assert.ok(
      zone.to <= spec.courseLength,
      `${zone.id} ends at ${zone.to} m, past the ${spec.courseLength} m lap.`,
    );
  }

  const world = buildLivingWorld(spec);
  built[map] = world;

  const budget = BUDGETS[map];
  assert.ok(budget, `No perf budget is declared for ${map}.`);
  assert.equal(
    world.drawCalls,
    spec.batches.length,
    `${spec.id} reports ${world.drawCalls} draw calls for ${spec.batches.length} batches.`,
  );
  assert.ok(
    world.drawCalls <= budget.drawCalls,
    `${spec.id} costs ${world.drawCalls} draw calls; the budget is ${budget.drawCalls}.`,
  );
  assert.ok(
    world.cards <= budget.cards,
    `${spec.id} authors ${world.cards} cards; the budget is ${budget.cards}.`,
  );
  assert.equal(
    world.triangles,
    world.cards * CARD_TRIANGLES,
    `${spec.id} triangles must be two per card.`,
  );
  assert.ok(
    world.triangles <= budget.triangles,
    `${spec.id} costs ${world.triangles} triangles; the budget is ${budget.triangles}.`,
  );

  /** @type {Map<string, string[]>} */
  const canonicalByZone = new Map();
  let seen = 0;
  for (const batch of world.batches) {
    assert.ok(
      batch.cards.length > 0,
      `${spec.id} batch ${batch.spec.id} is empty; an empty batch is a wasted draw call.`,
    );
    for (const card of batch.cards) {
      seen += 1;
      const where = `${spec.id}/${card.motionId}`;
      assert.ok(kinds.has(card.kind), `${where} uses unknown motion "${card.kind}".`);
      assert.ok(
        card.side === 1 || card.side === -1,
        `${where} has side ${card.side}; a card sits on one side of the centreline.`,
      );
      for (const field of NUMERIC_FIELDS) {
        assert.ok(
          Number.isFinite(card[field]),
          `${where} has a non-finite ${field}: ${card[field]}.`,
        );
      }
      assert.ok(
        card.distance >= 0 && card.distance <= spec.courseLength,
        `${where} places a card at ${card.distance} m, outside the `
          + `${spec.courseLength} m lap.`,
      );
      assert.ok(
        card.width >= 0 && card.height >= 0,
        `${where} has a negative card extent.`,
      );
      assert.ok(
        card.tint >= 0 && card.tint <= 0xffffff,
        `${where} has an out-of-range tint.`,
      );
      if (card.alphaKind !== undefined) {
        assert.ok(
          alphaKinds.has(card.alphaKind),
          `${where} uses unknown alpha envelope "${card.alphaKind}".`,
        );
        const envelope = ALPHA_ENVELOPES[card.alphaKind];
        assert.equal(
          card.alphaInitial,
          envelope[0],
          `${where} seeds an alpha outside the "${card.alphaKind}" envelope.`,
        );
      }
      if (lampKinds.has(card.kind)) {
        assert.equal(
          batch.spec.lamps,
          true,
          `${where} is a lamp motion in the non-lamp batch ${batch.spec.id}.`,
        );
        assert.equal(
          card.alphaKind,
          undefined,
          `${where} is a lamp motion with an alpha envelope; `
            + "updateLampColors overwrites vertex alpha, so the envelope is dead.",
        );
      } else {
        assert.equal(
          batch.spec.lamps,
          false,
          `${where} is a non-lamp motion in the lamp batch ${batch.spec.id}; `
            + "updateLampColors would drive its colour.",
        );
      }
      const list = canonicalByZone.get(card.motionId) ?? [];
      list.push(canonicalCard(card));
      canonicalByZone.set(card.motionId, list);
    }
  }
  assert.equal(seen, world.cards, `${spec.id} card count disagrees with its batches.`);

  for (const zone of spec.zones) {
    const cards = canonicalByZone.get(zone.id);
    assert.ok(cards, `${zone.id} authored no cards.`);
    assert.equal(
      cards.length,
      zone.cards,
      `${zone.id} declares ${zone.cards} cards but authored ${cards.length}.`,
    );
    zoneDigests.set(
      `${map}/${zone.id}`,
      createHash("sha256").update(cards.join("\n")).digest("hex").slice(0, 16),
    );
  }

  // Every card of a zone has to land inside the span the zone advertises,
  // including the zones that override the even spread with their own stations.
  for (const batch of world.batches) {
    for (const card of batch.cards) {
      const zone = spec.zones.find((candidate) => candidate.id === card.motionId);
      assert.ok(zone, `${card.motionId} has no zone.`);
      assert.ok(
        card.distance >= zone.from && card.distance <= zone.to,
        `${zone.id} places a card at ${card.distance} m, outside its declared `
          + `${zone.from}-${zone.to} m span.`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// The accepted Greenwater layer.
// ---------------------------------------------------------------------------

const greenwater = LIVING_WORLD_SPECS.greenwater;
assert.deepEqual(
  greenwater.batches
    .slice(0, ACCEPTED_GREENWATER_BATCHES.length)
    .map((batch) => ({ ...batch })),
  ACCEPTED_GREENWATER_BATCHES,
  "The four accepted Greenwater batches changed. P9 adds cards to them and P12 "
    + "appends new ones after them; neither re-authors them, and each one is a "
    + "draw call and a render state.",
);

const greenwaterZoneOrder = greenwater.zones.map((zone) => zone.id);
assert.deepEqual(
  greenwaterZoneOrder.slice(0, ACCEPTED_GREENWATER_ZONES.length),
  ACCEPTED_GREENWATER_ZONES.map((zone) => zone.id),
  "The accepted Greenwater zones must stay first and in order: every zone draws "
    + "from one shared seeded stream, so inserting above them moves accepted art.",
);

for (const accepted of ACCEPTED_GREENWATER_ZONES) {
  const zone = greenwater.zones.find((candidate) => candidate.id === accepted.id);
  assert.ok(zone, `The accepted zone ${accepted.id} is gone.`);
  assert.equal(zone.batch, accepted.batch, `${accepted.id} changed batch.`);
  assert.equal(zone.from, accepted.from, `${accepted.id} changed its start.`);
  assert.equal(zone.to, accepted.to, `${accepted.id} changed its end.`);
  assert.equal(zone.cards, accepted.cards, `${accepted.id} changed its card count.`);
  assert.equal(
    zoneDigests.get(`greenwater/${accepted.id}`),
    accepted.digest,
    `${accepted.id} no longer authors the accepted cards. This is the pre-P9 `
      + "layer: if the change is deliberate it needs a fresh art review, not a "
      + "new digest.",
  );
}

const acceptedCards = ACCEPTED_GREENWATER_ZONES.reduce((total, zone) => total + zone.cards, 0);
assert.equal(acceptedCards, 155, "The accepted Greenwater layer is 155 cards.");

// ---------------------------------------------------------------------------
// The P9 additions.
// ---------------------------------------------------------------------------

for (const authored of P9_ZONES) {
  const spec = LIVING_WORLD_SPECS[authored.map];
  const zone = spec.zones.find((candidate) => candidate.id === authored.id);
  assert.ok(zone, `The P9 zone ${authored.id} is missing from ${authored.map}.`);
  assert.equal(zone.batch, authored.batch, `${authored.id} changed batch.`);
  assert.equal(zone.from, authored.from, `${authored.id} changed its start.`);
  assert.equal(zone.to, authored.to, `${authored.id} changed its end.`);
  assert.equal(zone.cards, authored.cards, `${authored.id} changed its card count.`);
  assert.equal(
    zoneDigests.get(`${authored.map}/${authored.id}`),
    authored.digest,
    `${authored.id} no longer authors the cards this validator pinned.`,
  );
}

// ---------------------------------------------------------------------------
// The P12 art-pass-01 additions.
// ---------------------------------------------------------------------------

for (const [map, appended] of Object.entries(P12_BATCHES)) {
  const spec = LIVING_WORLD_SPECS[map];
  const accepted = map === "greenwater" ? ACCEPTED_GREENWATER_BATCHES.length : 3;
  const later = P18_BATCHES[map] ?? [];
  const latest = P20_BATCHES[map] ?? [];
  assert.equal(
    spec.batches.length,
    accepted + appended.length + later.length + latest.length,
    `${spec.id} declares ${spec.batches.length} batches; P12 authors `
      + `${accepted} accepted plus ${appended.length} appended, P18 appends `
      + `${later.length} more and P20.4 appends ${latest.length}.`,
  );
  assert.deepEqual(
    spec.batches.slice(accepted, accepted + appended.length).map((batch) => ({ ...batch })),
    appended,
    `${spec.id} atlas-B batches changed. Each one is a draw call and a render `
      + "state, and they must stay AFTER the accepted batches.",
  );
  assert.deepEqual(
    spec.batches
      .slice(accepted + appended.length, accepted + appended.length + later.length)
      .map((batch) => ({ ...batch })),
    later,
    `${spec.id} horizon batches changed. They are appended after P12's so `
      + "nothing above them moves, and each is a draw call and a render state.",
  );
  assert.deepEqual(
    spec.batches
      .slice(accepted + appended.length + later.length)
      .map((batch) => ({ ...batch })),
    latest,
    `${spec.id} P20.4 batches changed. They are appended LAST, and the one `
      + "there is the single extra draw call the phase was allowed to spend.",
  );
}

// Turning fog off is an exemption, and the list of them is closed. Both
// non-lamp exemptions are batches that ARE the far-field air, so fogging them
// multiplies the effect by itself and the horizon goes milky. P18 opened the
// list with `horizonAir`; P20.4 adds `skyHaze` and nothing else may join
// without being argued for by name, right here.
const UNFOGGED_NON_LAMP_BATCHES = new Set(["horizonAir", "skyHaze"]);
for (const [map, spec] of Object.entries(LIVING_WORLD_SPECS)) {
  for (const batch of spec.batches) {
    if (batch.fog) continue;
    assert.ok(
      batch.lamps || UNFOGGED_NON_LAMP_BATCHES.has(batch.id),
      `${spec.id} batch ${batch.id} is unfogged. The only non-lamp fog `
        + `exemptions are ${[...UNFOGGED_NON_LAMP_BATCHES].join(", ")} (${map}), `
        + "both authored as the far-field air itself.",
    );
  }
}

// Only the appended batches may name the second sheet, and every batch that
// names it must actually be one of them.
for (const [map, spec] of Object.entries(LIVING_WORLD_SPECS)) {
  const appendedIds = new Set((P12_BATCHES[map] ?? []).map((batch) => batch.id));
  for (const batch of spec.batches) {
    assert.equal(
      batch.texture === "motionB",
      appendedIds.has(batch.id),
      `${spec.id} batch ${batch.id} disagrees with the atlas-B texture pin.`,
    );
  }
}

for (const authored of P12_ZONES) {
  const spec = LIVING_WORLD_SPECS[authored.map];
  const zone = spec.zones.find((candidate) => candidate.id === authored.id);
  assert.ok(zone, `The P12 zone ${authored.id} is missing from ${authored.map}.`);
  assert.equal(zone.batch, authored.batch, `${authored.id} changed batch.`);
  assert.equal(zone.from, authored.from, `${authored.id} changed its start.`);
  assert.equal(zone.to, authored.to, `${authored.id} changed its end.`);
  assert.equal(zone.cards, authored.cards, `${authored.id} changed its card count.`);
  assert.equal(
    zoneDigests.get(`${authored.map}/${authored.id}`),
    authored.digest,
    `${authored.id} no longer authors the cards this validator pinned.`,
  );
}

// ---------------------------------------------------------------------------
// The P18 art-pass-03 additions.
// ---------------------------------------------------------------------------

for (const authored of P18_ZONES) {
  const spec = LIVING_WORLD_SPECS[authored.map];
  const zone = spec.zones.find((candidate) => candidate.id === authored.id);
  assert.ok(zone, `The P18 zone ${authored.id} is missing from ${authored.map}.`);
  assert.equal(zone.batch, authored.batch, `${authored.id} changed batch.`);
  assert.equal(zone.from, authored.from, `${authored.id} changed its start.`);
  assert.equal(zone.to, authored.to, `${authored.id} changed its end.`);
  assert.equal(zone.cards, authored.cards, `${authored.id} changed its card count.`);
  assert.equal(
    zoneDigests.get(`${authored.map}/${authored.id}`),
    authored.digest,
    `${authored.id} no longer authors the cards this validator pinned.`,
  );
}

// Every silhouette card of the horizon layer resolves base 0. The cells are
// authored bottom-anchored, so a non-zero base floats the grade contact — this
// is the one geometric mistake the layer can make that still looks like art.
for (const authored of P18_ZONES) {
  if (authored.batch !== "horizon") continue;
  const cards = built[authored.map].batches
    .flatMap((batch) => batch.cards)
    .filter((card) => card.motionId === authored.id);
  for (const card of cards) {
    assert.equal(
      card.base,
      0,
      `${authored.id} places a silhouette card at base ${card.base} m; a `
        + "bottom-anchored cell above 0 floats off the grade.",
    );
  }
}

// P18.2 — the contrast rule. Every Bitterpan silhouette card must be darker
// than the DARKEST sector fog, not merely darker than some sector's fog: the
// card is one constant and the fog is three, so anything above the floor reads
// as a silhouette in one basin and dissolves in another. This is the assertion
// the P18 digests could not make; they pinned a value, and the failure was in a
// relationship.
const darkestSectorFog = Math.min(...BP_SECTOR_FOG_HEXES.map(rec709));
for (const authored of P18_ZONES) {
  if (authored.map !== "bitterpan" || authored.batch !== "horizon") continue;
  const cards = built.bitterpan.batches
    .flatMap((batch) => batch.cards)
    .filter((card) => card.motionId === authored.id);
  assert.ok(cards.length > 0, `${authored.id} built no cards to check tint on.`);
  for (const card of cards) {
    assert.ok(
      rec709(card.tint) < darkestSectorFog,
      `${authored.id} tints its silhouettes 0x${card.tint.toString(16)} `
        + `(luma ${rec709(card.tint).toFixed(1)}), at or above the darkest `
        + `Bitterpan sector fog (luma ${darkestSectorFog.toFixed(1)}). The `
        + "band inverts against that sector's air and the layer disappears "
        + "there — see the HORIZON_BANDS comment in living-world-zones.js.",
    );
  }
}

// ---------------------------------------------------------------------------
// P18.1 — the anchoring rule.
//
// `base` used to mean one thing (the card's CENTRE) because every card in the
// layer was drifting atmosphere. P18 added ground-standing silhouettes, where
// base 0 centred a 44-62 m mesa on the deck and buried half of it. The rule
// below is what keeps the two meanings from being confused again.
// ---------------------------------------------------------------------------

/**
 * Whether a batch stands its cards on the ground.
 *
 * A batch that alpha-tests and does not drive lamps is drawing SILHOUETTES —
 * shapes with a hard edge and a grade contact — and every one of them must
 * anchor at the bottom. A batch that blends is drawing tone, and tone centres.
 */
const anchorsAtBottom = (batch) => batch.alphaTest > 0 && !batch.lamps
  && batch.texture === "horizon";

for (const [map, spec] of Object.entries(LIVING_WORLD_SPECS)) {
  for (const batch of spec.batches) {
    if (anchorsAtBottom(batch)) {
      assert.equal(
        batch.anchor,
        "bottom",
        `${spec.id} batch ${batch.id} draws bottom-anchored silhouette cells `
          + "but centres them on `base`. At base 0 that buries half of every "
          + "card, which is exactly the P18 defect this rule exists to catch.",
      );
      continue;
    }
    assert.equal(
      batch.anchor,
      undefined,
      `${spec.id} batch ${batch.id} declares anchor "${batch.anchor}". Only the `
        + "silhouette batches anchor; every accepted batch above them centres "
        + "its cards, and moving one would move accepted art.",
    );
  }
  // The two additive band batches are the delivery's own carve-out — "authored
  // as tone", not as silhouettes — and they are the only horizon zones allowed
  // a non-zero base. Assert the pairing, so a band can never quietly become a
  // silhouette or a silhouette a band.
  for (const zone of P18_ZONES.filter((entry) => entry.map === map)) {
    const batch = spec.batches.find((candidate) => candidate.id === zone.batch);
    const cards = built[map].batches
      .flatMap((entry) => entry.cards)
      .filter((card) => card.motionId === zone.id);
    const anchored = batch.anchor === "bottom";
    const bases = cards.map((card) => card.base);
    assert.equal(
      anchored,
      bases.every((base) => base === 0),
      `${zone.id} is on a ${anchored ? "bottom-anchored" : "centred"} batch but `
        + `authors bases ${[...new Set(bases)].join(", ")}. A bottom-anchored `
        + "zone bases at 0; a centred band is the only thing allowed to lift.",
    );
  }
}

// The rule is only worth its lines if it fails on the thing it exists to catch:
// a silhouette batch that forgot to anchor, which renders as half-buried art
// and throws no error anywhere else in the system.
assert.throws(
  () => {
    const unanchored = { ...P18_BATCHES.bitterpan[0] };
    delete unanchored.anchor;
    assert.ok(anchorsAtBottom(unanchored), "not a silhouette batch");
    assert.equal(
      unanchored.anchor,
      "bottom",
      "silhouette batch centres its cards",
    );
  },
  /silhouette batch centres its cards/,
  "The anchoring rule does not fail on a silhouette batch with no anchor.",
);

// ... and the runtime has to actually implement it, or the data says one thing
// while every frame does another.
const anchorRuntime = readFileSync(
  new URL("../src/game/living-world.ts", import.meta.url),
  "utf8",
);
assert.ok(
  anchorRuntime.includes('batch.spec.anchor === "bottom" ? y + halfHeight : y'),
  "living-world.ts never lifts a bottom-anchored card by its half-height, so "
    + "the `anchor` flag would be data nothing reads.",
);

// The append order is the whole determinism argument: P12's zones sit after the
// accepted and P9 ones, P18's sit after P12's, and P18's are last. Any other
// order reaches the accepted zones with different draws off the shared stream.
for (const [map, spec] of Object.entries(LIVING_WORLD_SPECS)) {
  const p12 = P12_ZONES.filter((zone) => zone.map === map).map((zone) => zone.id);
  const p18 = P18_ZONES.filter((zone) => zone.map === map).map((zone) => zone.id);
  const p20 = P20_ZONES.filter((zone) => zone.map === map).map((zone) => zone.id);
  const ids = spec.zones.map((zone) => zone.id);
  const end = ids.length;
  assert.deepEqual(
    ids.slice(end - p20.length),
    p20,
    `${spec.id} must keep its P20.4 zones last and in order.`,
  );
  assert.deepEqual(
    ids.slice(end - p20.length - p18.length, end - p20.length),
    p18,
    `${spec.id} must keep its P18 horizon zones immediately before P20.4's.`,
  );
  assert.deepEqual(
    ids.slice(
      end - p20.length - p18.length - p12.length,
      end - p20.length - p18.length,
    ),
    p12,
    `${spec.id} must keep its P12 zones immediately before the P18 zones.`,
  );
}

// The horizon layer exists to close the far field. Assert the reach, not just
// that the zones parse: Greenwater's far band must clear 480 m (inside the
// 650 m far plane) and Bitterpan's must clear 1,200 m (inside 1,800 m).
for (const [map, minimum, ceiling] of [["greenwater", 480, 650], ["bitterpan", 1200, 1800]]) {
  const laterals = built[map].batches
    .flatMap((batch) => batch.cards)
    .filter((card) => card.motionId.startsWith("HORIZON_") || card.motionId.startsWith("PAN_MESA")
      || card.motionId.startsWith("PAN_REFINERY") || card.motionId.startsWith("PAN_RIG")
      || card.motionId.startsWith("PAN_HAZE") || card.motionId.startsWith("PAN_HEAT_SHIMMER_FAR"))
    .map((card) => card.lateral);
  assert.ok(laterals.length > 0, `${map} authors no horizon cards.`);
  assert.ok(
    Math.max(...laterals) >= minimum,
    `${map}'s horizon reaches only ${Math.max(...laterals).toFixed(0)} m; the `
      + `layer is authored to stand out at ${minimum} m or beyond.`,
  );
  assert.ok(
    Math.max(...laterals) < ceiling,
    `${map}'s horizon stands at ${Math.max(...laterals).toFixed(0)} m, at or `
      + `past camera.far ${ceiling} m, so a card can clip through the far plane.`,
  );
}

// The opening straight (0-220 m) is what art pass 01 exists to dress. Assert
// the coverage, not just that the zones parse.
const openingCards = built.greenwater.batches
  .flatMap((batch) => batch.cards)
  .filter((card) => card.distance >= 0 && card.distance <= 220);
assert.ok(
  openingCards.length >= 31,
  `The Greenwater opening straight holds ${openingCards.length} living cards; `
    + "art pass 01 authors 31 there.",
);

// FUEL_ROW (1591-2121 m) and RUNWAY_HOME (2255-2516 m) were the two Greenwater
// sectors with nothing alive in them. Assert the coverage, not just the zones.
for (const [sector, from, to] of [["FUEL_ROW", 1591.107, 2121.465], ["RUNWAY_HOME", 2254.982, 2515.982]]) {
  const inSector = built.greenwater.batches
    .flatMap((batch) => batch.cards)
    .filter((card) => card.distance >= from && card.distance <= to);
  assert.ok(
    inSector.length >= 20,
    `${sector} holds only ${inSector.length} living cards; P9 exists to cover it.`,
  );
  const motions = new Set(inSector.map((card) => card.motionId));
  assert.ok(
    motions.size >= 2,
    `${sector} has ${motions.size} living zones; a single motion reads as a prop, `
      + "not as a place that is alive.",
  );
}

// Bitterpan is authored across the lap rather than clustered at the works.
const bitterpanSectorCoverage = new Set(
  built.bitterpan.batches
    .flatMap((batch) => batch.cards)
    .map((card) => (card.distance < 1607 ? "S1" : card.distance < 2548 ? "S2" : "S3")),
);
assert.deepEqual(
  [...bitterpanSectorCoverage].sort(),
  ["S1", "S2", "S3"],
  "Bitterpan's zone set must reach all three sectors.",
);

// ---------------------------------------------------------------------------
// The P20.4 additions — the air crosses the road.
// ---------------------------------------------------------------------------

for (const authored of P20_ZONES) {
  const spec = LIVING_WORLD_SPECS[authored.map];
  const zone = spec.zones.find((candidate) => candidate.id === authored.id);
  assert.ok(zone, `The P20.4 zone ${authored.id} is missing from ${authored.map}.`);
  assert.equal(zone.batch, authored.batch, `${authored.id} changed batch.`);
  assert.equal(zone.from, authored.from, `${authored.id} changed its start.`);
  assert.equal(zone.to, authored.to, `${authored.id} changed its end.`);
  assert.equal(zone.cards, authored.cards, `${authored.id} changed its card count.`);
  const cards = built[authored.map].batches
    .flatMap((batch) => batch.cards)
    .filter((card) => card.motionId === authored.id);
  assert.ok(cards.length > 0, `${authored.id} built no cards.`);
  for (const card of cards) {
    assert.equal(
      card.kind,
      authored.kind,
      `${authored.id} authors a "${card.kind}" card; the zone is pinned to `
        + `"${authored.kind}", and for this phase the motion IS the deliverable.`,
    );
  }
  assert.equal(
    zoneDigests.get(`${authored.map}/${authored.id}`),
    authored.digest,
    `${authored.id} no longer authors the cards this validator pinned.`,
  );
}

/**
 * P20.4 ROUND 2 — THE NEAR CARDS READ AS DUST, NOT AS CRUST.
 *
 * Round 1 shipped these four zones tinted at the crust's own colour
 * (PAN_SCUD_NEAR 0xe6dcc4, PAN_SCUD_CROSSING 0xe2d8bf, SALT_DEVIL_ROAD
 * 0xded5bd, BRINE_HAZE_LOW 0xd9e0dc, Rec.709 luma 220 / 216 / 213 / 223) and
 * its own honest read was that the cards are placed and moving correctly and
 * are INVISIBLE in a still frame. A card tinted at the colour it is drawn over
 * has no luminance to contribute in either direction, whatever its alpha.
 *
 * Vertex colour is a LINEAR multiplier applied before AgX and before the alpha
 * blend (living-world.ts writes `(tint >> 16 & 255) / 255` straight into the
 * colour attribute with no sRGB decode), so the tint is not a colour the card
 * is drawn IN — it is a gain on the cell. The near crust renders at 78-102
 * display luma over the four pan stations, and the three DUST zones have to
 * land under that: the round-2 taste call, in the reviewer's words, is that
 * near cards read as dust — darker and warmer than the crust, never lighter.
 *
 * Asserted here rather than left to the digests, because a digest tells the
 * next phase that something moved and this tells it what may not:
 *   - the three dust zones stay at or under DUST_TINT_LUMA_CEILING;
 *   - the three dust zones stay WARM, red over green over blue, which is the
 *     crust's own hue and the thing that stops "darker" from becoming "grey";
 *   - BRINE_HAZE_LOW is the one zone allowed to be cool (blue at or over red),
 *     because it is the wet basin rather than lifted crust, and it still has to
 *     sit under the round-1 value it replaced.
 */
const DUST_TINT_LUMA_CEILING = 80;
const BRINE_TINT_LUMA_CEILING = 200;
const P20_DUST_ZONES = ["PAN_SCUD_NEAR", "PAN_SCUD_CROSSING", "SALT_DEVIL_ROAD"];
const P20_ROUND_ONE_TINTS = {
  PAN_SCUD_NEAR: 0xe6dcc4,
  PAN_SCUD_CROSSING: 0xe2d8bf,
  SALT_DEVIL_ROAD: 0xded5bd,
  BRINE_HAZE_LOW: 0xd9e0dc,
};
for (const [zoneId, roundOne] of Object.entries(P20_ROUND_ONE_TINTS)) {
  const cards = built.bitterpan.batches
    .flatMap((batch) => batch.cards)
    .filter((card) => card.motionId === zoneId);
  assert.ok(cards.length > 0, `${zoneId} authored no cards to tint.`);
  for (const card of cards) {
    const luma = rec709(card.tint);
    const red = (card.tint >> 16) & 0xff;
    const green = (card.tint >> 8) & 0xff;
    const blue = card.tint & 0xff;
    assert.ok(
      luma < rec709(roundOne),
      `${zoneId} is tinted at luma ${luma.toFixed(1)}; round 1 shipped `
        + `${rec709(roundOne).toFixed(1)} and was rejected for having no `
        + "luminance contrast against the crust. It may not go back up.",
    );
    if (P20_DUST_ZONES.includes(zoneId)) {
      assert.ok(
        luma <= DUST_TINT_LUMA_CEILING,
        `${zoneId} is tinted at luma ${luma.toFixed(1)}, over the `
          + `${DUST_TINT_LUMA_CEILING} ceiling. The near crust renders at `
          + "78-102 display luma and this is a linear gain on the cell, so a "
          + "dust card tinted above the ceiling reads as haze on the crust "
          + "rather than as dust in front of it.",
      );
      assert.ok(
        red > green && green > blue,
        `${zoneId} is tinted (${red}, ${green}, ${blue}); lifted salt crust is `
          + "warm — red over green over blue — and a neutral dark card reads as "
          + "a smudge on the lens rather than as air.",
      );
    } else {
      assert.ok(
        blue >= red && luma <= BRINE_TINT_LUMA_CEILING,
        `${zoneId} is tinted (${red}, ${green}, ${blue}) at luma `
          + `${luma.toFixed(1)}; the wet basin is the one zone allowed to be `
          + "cooler than the crust, and it still has to sit under "
          + `${BRINE_TINT_LUMA_CEILING}.`,
      );
    }
  }
}

// The tint rule is only worth its lines if it fails on the thing it exists to
// catch. Asserted against synthetic cards so the fixtures cannot drift with the
// real zones — and needed as fixtures at all because a real re-tint trips the
// zone DIGEST first, which says only that something moved.
assert.throws(
  () => {
    const offender = { motionId: "FAKE_PALE_SCUD", tint: 0xe6dcc4 };
    assert.ok(
      rec709(offender.tint) <= DUST_TINT_LUMA_CEILING,
      "dust tint is under the ceiling",
    );
  },
  /dust tint is under the ceiling/,
  "The dust-tint rule does not fail on round 1's crust-coloured tint, which is "
    + "the exact value it exists to keep out.",
);
assert.throws(
  () => {
    const offender = { tint: 0x33383f };
    const red = (offender.tint >> 16) & 0xff;
    const green = (offender.tint >> 8) & 0xff;
    const blue = offender.tint & 0xff;
    assert.ok(red > green && green > blue, "dust tint is warm");
  },
  /dust tint is warm/,
  "The dust-tint rule passes a cold grey-blue card, which reads as a smudge on "
    + "the lens rather than as lifted salt crust.",
);

/**
 * P20.4 ROUND 2 — THE TWO-TIER ALPHA, AND THE PLACEMENT IT DEPENDS ON.
 *
 * The 0.35 corridor cap is a rule about cards the craft flies THROUGH. Round 1
 * applied it to the whole near zone, which cost the outboard cards a factor of
 * two in density for nothing: measured on greenwater_motion_512, the MIST cell
 * averages 0.167 alpha, so a card at 0.34 vertex alpha averages 5.7% opacity —
 * under the 10-luma census threshold at every station.
 *
 * So PAN_SCUD_NEAR is two tiers, split on the same number the corridor rule
 * reads: inner cards at lateral 2.0-5.6 m stay on `rise` (0.34), shoulder cards
 * at 6.2-8.0 m ride `scudShoulder` (0.62). This asserts both halves — the
 * placement envelope the round-2 brief specifies, and that no card outside the
 * corridor exceeds 0.62 while no card inside it exceeds 0.35.
 */
const NEAR_ALPHA_CEILING_OUTSIDE = 0.62;
const P20_NEAR_ZONES = [...P20_DUST_ZONES, "BRINE_HAZE_LOW"];
const scudNear = built.bitterpan.batches
  .flatMap((batch) => batch.cards)
  .filter((card) => card.motionId === "PAN_SCUD_NEAR");
assert.equal(scudNear.length, 34, "PAN_SCUD_NEAR is 34 cards.");
for (const card of scudNear) {
  assert.ok(
    card.width >= 8 && card.width <= 18,
    `PAN_SCUD_NEAR authors a ${card.width.toFixed(1)} m card; the near band is `
      + "8-18 m wide.",
  );
  assert.ok(
    card.height >= 1.6 && card.height <= 3.4,
    `PAN_SCUD_NEAR authors a ${card.height.toFixed(1)} m card; the near band is `
      + "1.6-3.4 m tall.",
  );
  assert.ok(
    card.base >= 0.1 && card.base <= 1.0,
    `PAN_SCUD_NEAR bases a card at ${card.base.toFixed(2)} m; the near band `
      + "sits at 0.1-1.0 m.",
  );
}
const scudNearInBand = scudNear.filter(
  (card) => card.lateral >= 2 && card.lateral <= 8,
);
assert.ok(
  scudNearInBand.length >= 25,
  `Only ${scudNearInBand.length} of PAN_SCUD_NEAR's ${scudNear.length} cards sit `
    + "2-8 m outboard of the deck edge; at least 25 have to. Further out and the "
    + "zone is PAN_CRUST_SCUD again, which is the layer the driver never saw.",
);
const shoulderTier = scudNear.filter((card) => card.alphaKind === "scudShoulder");
assert.ok(
  shoulderTier.length >= 12,
  `PAN_SCUD_NEAR has ${shoulderTier.length} shoulder-tier cards; the tier that `
    + "carries the density is what makes the zone visible and it may not be "
    + "emptied by a re-author.",
);
assert.deepEqual(
  [...new Set(shoulderTier.map((card) => card.side))].sort(),
  [-1, 1],
  "PAN_SCUD_NEAR puts its whole shoulder tier on one side of the road. `side` "
    + "is `index % 2`, so a tier keyed off the same parity lands entirely on "
    + "one shoulder — the tier key has to be a different parity.",
);
for (const card of built.bitterpan.batches
  .filter((batch) => !batch.spec.lamps)
  .flatMap((batch) => batch.cards)) {
  if (!P20_NEAR_ZONES.includes(card.motionId)) continue;
  const reach = reachableLateral(card);
  if (reach <= CORRIDOR_LATERAL_METRES && card.base < CORRIDOR_HEIGHT_METRES) {
    continue; // covered by the corridor rule below, at the tighter 0.35.
  }
  assert.ok(
    peakAlpha(card) <= NEAR_ALPHA_CEILING_OUTSIDE,
    `BITTERPAN/${card.motionId} peaks at alpha ${peakAlpha(card).toFixed(2)} at `
      + `lateral reach ${reach.toFixed(2)} m. Outboard of the corridor a near `
      + `card may go to ${NEAR_ALPHA_CEILING_OUTSIDE}; past that it stops being `
      + "air over the pan and becomes weather over the track.",
  );
}

/**
 * P20.4 ROUND 2 — `forceSinglePass` on every living-world material.
 *
 * A transparent DoubleSide material is drawn twice by three.js, back faces then
 * front, so that a folded transparent surface sorts against itself. Measured on
 * the pinned station set, the seven Bitterpan batches cost 14 of
 * `renderer.info.render.calls` at every one of the thirteen stations (64 live
 * minus 50 with `?living=0` at station 150), and 7 after this flag.
 *
 * Every card is a flat quad with `depthWrite: false`; it has no self-sorting to
 * do. DoubleSide stays — the ring and the crossing scud are both seen from
 * behind — and only the duplicate pass goes. Asserted in the source because
 * there is no other place it can be caught: dropping it costs seven draw calls
 * a frame and changes not one pixel.
 */
const livingWorldSource = readFileSync(
  new URL("../src/game/living-world.ts", import.meta.url),
  "utf8",
);
assert.ok(
  /forceSinglePass:\s*true/.test(livingWorldSource),
  "living-world.ts no longer sets `forceSinglePass: true`, so every one of the "
    + "seven transparent DoubleSide batches is drawn in two passes again — 14 "
    + "draw calls for 7 batches, with no visible difference to show for it.",
);
assert.ok(
  /side:\s*THREE\.DoubleSide/.test(livingWorldSource),
  "living-world.ts no longer sets DoubleSide. `forceSinglePass` is not a "
    + "substitute for it: cards are seen from behind at every station.",
);

/**
 * P20.4 - `upright` is opt-in and stays opt-in.
 *
 * `atlasRect` counts `rect.y` in PNG rows from the TOP; the sheets upload with
 * three.js `flipY` at its default `true`, so V counts from the BOTTOM and a
 * slot in grid row `r` resolves to row `N - 1 - r`. HAZE_BAND (slot 15) draws
 * PYLON_RUN (slot 3); MESA_LONG (slot 12) draws TREELINE_DENSE (slot 0), which
 * is a treeline on a salt pan. That is a real defect, measured rather than
 * deduced, and it is written up in living-world-zones.js.
 *
 * It is NOT fixed globally here, and the assertion below is what says so out
 * loud: fixing it re-points every card on both maps, the 155 accepted Greenwater
 * ones included, and that needs its own art review rather than a quiet
 * ride-along in a Bitterpan phase. Exactly one batch opts in - the one P20.4
 * adds - so the accepted layer renders byte-identically and the defect stays
 * visible to the next phase instead of being half-fixed.
 */
for (const [map, world] of Object.entries(built)) {
  const uprightZones = [...new Set(world.batches
    .flatMap((batch) => batch.cards)
    .filter((card) => card.upright)
    .map((card) => card.motionId))].sort();
  const expected = P20_ZONES
    .filter((zone) => zone.map === map)
    .map((zone) => zone.id)
    .sort();
  assert.deepEqual(
    uprightZones,
    expected,
    `${map} changed which zones sample the atlas cell they name. Turning this `
      + "on for an existing zone re-points accepted art; turning it off for a "
      + "P20.4 zone puts birds back in the salt scud and lattice pylons back in "
      + "the horizon haze.",
  );
  // Every card of an opted-in zone, not just some of them: a zone whose author
  // sets the flag on one branch of a ternary and not the other renders half its
  // cards from a different cell and looks like a deliberate mix.
  for (const zone of expected) {
    const cards = world.batches
      .flatMap((batch) => batch.cards)
      .filter((card) => card.motionId === zone);
    assert.ok(
      cards.every((card) => card.upright === true),
      `${zone} authors ${cards.filter((card) => !card.upright).length} cards `
        + "without `upright`, so the zone draws from two different atlas cells.",
    );
  }
}

// ... and the runtime has to implement it, or the flag is data nothing reads.
assert.ok(
  readFileSync(
    new URL("../src/game/living-world.ts", import.meta.url),
    "utf8",
  ).includes("card.upright"),
  "living-world.ts never reads `upright`, so the P20.4 zones would silently "
    + "render the mirrored atlas cell the accepted zones render.",
);

// The corridor rule, asserted over every Bitterpan card rather than only the
// new ones — the failure it prevents is not "the P20.4 zones are wrong", it is
// "some later zone is". Lamp batches are excluded: `updateLampColors` overwrites
// vertex alpha every frame, so an envelope on one is dead data anyway, and a
// 1.35 m beacon is a point of light rather than a screen-filling card.
let corridorCards = 0;
for (const batch of built.bitterpan.batches) {
  if (batch.spec.lamps) continue;
  for (const card of batch.cards) {
    const reach = reachableLateral(card);
    if (reach > CORRIDOR_LATERAL_METRES) continue;
    if (card.base >= CORRIDOR_HEIGHT_METRES) continue;
    corridorCards += 1;
    assert.ok(
      peakAlpha(card) <= CORRIDOR_ALPHA_CEILING,
      `BITTERPAN/${card.motionId} reaches lateral ${reach.toFixed(2)} m — inside `
        + `the halfWidth + ${CORRIDOR_LATERAL_METRES} m corridor — at base `
        + `${card.base.toFixed(2)} m, and peaks at alpha `
        + `${peakAlpha(card).toFixed(2)}. A card the craft flies through below `
        + `${CORRIDOR_HEIGHT_METRES} m has to stay at or under `
        + `${CORRIDOR_ALPHA_CEILING} or it is a whiteout on the racing line.`,
    );
  }
}
assert.ok(
  corridorCards >= 15,
  `Only ${corridorCards} Bitterpan cards reach inside the drivable corridor `
    + "below 6 m. P20.4 exists because that number was 0 and the map read as "
    + "empty from the driver's seat; a rule with nothing to check is not a rule. "
    + "P20.4 authors 17 of them: the ten crossing scud, the lowest road devil, "
    + "and the inner tail of PAN_SCUD_NEAR / BRINE_HAZE_LOW.",
);

// The rule is only worth its lines if it fails on the thing it exists to catch:
// a low, opaque card sitting on the racing line, which renders as a whiteout at
// 300 km/h and throws no error anywhere else in the system.
assert.throws(
  () => {
    const offender = {
      motionId: "FAKE_LOW_SCUD",
      kind: "shear",
      lateral: 3,
      base: 1,
      alphaKind: "mist",
    };
    assert.ok(
      reachableLateral(offender) > CORRIDOR_LATERAL_METRES,
      "card is outboard of the corridor",
    );
    assert.ok(
      peakAlpha(offender) <= CORRIDOR_ALPHA_CEILING,
      "card is under the corridor alpha ceiling",
    );
  },
  /card is outboard of the corridor/,
  "The corridor rule does not fail on a low, opaque card on the racing line.",
);

// The point of P20.4 is that the layer arrives in the NEAR field. Assert the
// reach the phase exists to add: the P9/P12 Bitterpan set bottomed out at 24 m
// outboard, which is why thirteen station screenshots of it showed nothing.
const p20Ids = new Set(P20_ZONES.map((zone) => zone.id));
const nearFieldCards = built.bitterpan.batches
  .flatMap((batch) => batch.cards)
  .filter((card) => p20Ids.has(card.motionId)
    && reachableLateral(card) <= 14 && card.base < 12);
assert.ok(
  nearFieldCards.length >= 48,
  `P20.4 puts ${nearFieldCards.length} cards within 14 m of the deck edge and `
    + "under 12 m up; the phase is authored to put at least 48 there.",
);

// The crossing scud has to actually cross. `amplitude` is half the traverse and
// the anchor sits at halfWidth + lateral, so the card only reaches the far side
// of the deck if the amplitude clears BOTH the authored lateral and the widest
// half-width on the map — 11.5 m, the widest Bitterpan deck (validate-map02.mjs
// carries the station table this is read off).
const BITTERPAN_MAX_HALF_WIDTH_METRES = 11.5;
let crossingCards = 0;
for (const card of built.bitterpan.batches.flatMap((batch) => batch.cards)) {
  if (card.kind !== "cross") continue;
  crossingCards += 1;
  assert.ok(
    (card.amplitude ?? 0) >= card.lateral + BITTERPAN_MAX_HALF_WIDTH_METRES,
    `${card.motionId} traverses ${card.amplitude} m from lateral ${card.lateral}; `
      + `it needs ${(card.lateral + BITTERPAN_MAX_HALF_WIDTH_METRES).toFixed(1)} m `
      + "to reach the centreline, so as authored it never crosses the road and "
      + "the zone is a lateral drift with a grand name.",
  );
}
// ROUND 2: twenty, not ten. Ten over the zone's span was one crossing card
// every 236 m, and six of the thirteen review stations then had none inside the
// 15-150 m window where a card is both in frame and large enough to read — the
// zone that names the phase was absent from half of it. Twenty is one every
// 118 m. Pinned as an equality rather than a floor because "more air over the
// racing line" is a corridor-rule question, not a free knob.
assert.equal(crossingCards, 20, "PAN_SCUD_CROSSING is twenty crossing cards.");

// The sky haze ring exists to separate sky from ground at the horizon, and
// every half of that is geometry. Stand it far enough out to read as horizon,
// keep it inside camera.far, keep every card wide enough to be a band rather
// than a cloud, and — the load-bearing one — keep its BOTTOM edge above the
// chase camera's eye height, because a band whose bottom dips below eye level
// lands under the horizon line and darkens the ground it exists to separate
// from. That is not a taste call; it is the sign of the metric.
const BP_CHASE_EYE_HEIGHT_METRES = 8;
const skyHazeCards = built.bitterpan.batches
  .flatMap((batch) => batch.cards)
  .filter((card) => card.motionId === "PAN_SKY_HAZE");
assert.equal(skyHazeCards.length, 72, "PAN_SKY_HAZE is a 72-card ring.");
for (const card of skyHazeCards) {
  assert.ok(
    card.lateral >= 1200 && card.lateral < 1800,
    `PAN_SKY_HAZE stands at ${card.lateral.toFixed(0)} m; the ring is authored `
      + "at 1,200 m or beyond and inside the 1,800 m far plane.",
  );
  assert.ok(
    card.width >= 260,
    `PAN_SKY_HAZE authors a ${card.width.toFixed(0)} m card; under 260 m the `
      + "ring reads as cloud rather than as a continuous band.",
  );
  assert.ok(
    card.base - card.height / 2 > BP_CHASE_EYE_HEIGHT_METRES,
    `PAN_SKY_HAZE bottoms at ${(card.base - card.height / 2).toFixed(1)} m, at `
      + `or below the ${BP_CHASE_EYE_HEIGHT_METRES} m chase eye height.`,
  );
  assert.ok(
    peakAlpha(card) >= 0.55 && peakAlpha(card) <= 0.75,
    `PAN_SKY_HAZE draws at alpha ${peakAlpha(card)}; the band is authored at `
      + "0.55-0.75 and the cell's own alpha peaks at 0.53 on top of that.",
  );
}

// ... and it stays darker than the darkest sector fog, for exactly the reason
// the P18.2 horizon bands do: one constant against three fogs, so anything above
// the floor inverts in one basin and the band dissolves there.
for (const card of skyHazeCards) {
  assert.ok(
    rec709(card.tint) < darkestSectorFog,
    `PAN_SKY_HAZE tints 0x${card.tint.toString(16)} (luma `
      + `${rec709(card.tint).toFixed(1)}), at or above the darkest Bitterpan `
      + `sector fog (luma ${darkestSectorFog.toFixed(1)}).`,
  );
}

// The visibility census is a diagnostics number, and a diagnostics number that
// silently stops being computed is worse than none. It is the only evidence in
// the build that the layer is on screen at all.
assert.ok(
  readFileSync(
    new URL("../src/game/living-world.ts", import.meta.url),
    "utf8",
  ).includes("this.stats.visibleCards = this.countVisibleCards(camera)"),
  "living-world.ts never samples visibleCards, so the diagnostics field would "
    + "report 0 for a layer that is fully on screen.",
);
assert.ok(
  readFileSync(
    new URL("../src/game/scene-assets.ts", import.meta.url),
    "utf8",
  ).includes("livingWorldVisibleCards"),
  "scene-assets.ts never reports visibleCards, so nothing outside the class "
    + "can see it.",
);

// ---------------------------------------------------------------------------
// Data and runtime have to agree.
// ---------------------------------------------------------------------------

const runtime = readFileSync(
  new URL("../src/game/living-world.ts", import.meta.url),
  "utf8",
);

for (const kind of CARD_KINDS) {
  assert.ok(
    runtime.includes(`case "${kind}"`) || runtime.includes(`card.kind === "${kind}"`),
    `living-world.ts never advances the "${kind}" motion, so a zone using it `
      + "would render a card that never moves.",
  );
}
for (const alphaKind of alphaKinds) {
  assert.ok(
    runtime.includes(`case "${alphaKind}"`),
    `living-world.ts has no alpha branch for "${alphaKind}".`,
  );
}

// Reduced motion freezes the effect clock. That only works while every motion,
// every envelope and every lamp reads `elapsedSeconds` and nothing else.
assert.ok(
  runtime.includes("if (advanceMotion) this.elapsedSeconds += UPDATE_STEP_SECONDS;"),
  "living-world.ts must gate its clock on `advanceMotion` so reduced motion "
    + "freezes the layer.",
);
for (const clock of ["performance.now(", "Date.now(", "Math.random("]) {
  assert.ok(
    !runtime.includes(clock),
    `living-world.ts reads ${clock}); a motion on a clock other than `
      + "`elapsedSeconds` would keep running under reduced motion.",
  );
}
const game = readFileSync(new URL("../src/game/game.ts", import.meta.url), "utf8");
assert.ok(
  game.includes("this.sceneAssets.livingWorld?.update(delta, this.camera, !this.reducedMotion)"),
  "game.ts must keep passing `!this.reducedMotion` into the living-world update.",
);

// The layer is a fixed-step 30 Hz tick, and the soak asserts it.
assert.equal(LIVING_WORLD_UPDATE_HZ, 30, "The living-world tick is 30 Hz.");
assert.ok(
  runtime.includes("const UPDATE_STEP_SECONDS = 1 / LIVING_WORLD_UPDATE_HZ;"),
  "living-world.ts must derive its step from LIVING_WORLD_UPDATE_HZ.",
);

// Both maps load through one wiring seam.
const sceneAssets = readFileSync(
  new URL("../src/game/scene-assets.ts", import.meta.url),
  "utf8",
);
assert.equal(
  (sceneAssets.match(/this\.loadLivingWorld\(/g) ?? []).length,
  2,
  "scene-assets.ts must call loadLivingWorld once per map branch.",
);

const summary = Object.entries(built)
  .map(([map, world]) => `${map} ${world.drawCalls} calls / ${world.cards} cards / `
    + `${world.triangles} tris (budget ${BUDGETS[map].drawCalls}/${BUDGETS[map].cards})`)
  .join(", ");
console.log(
  `Living world PASS: ${summary}; 11 accepted Greenwater zones pinned byte-exact, `
    + `${P9_ZONES.length} P9 zones pinned, ${P12_ZONES.length} P12 zones, `
    + `${P18_ZONES.length} P18 horizon zones (34 GW / 38 BP cards, 1 / 2 batches, `
    + "every silhouette bottom-anchored at base 0, the two tone bands centred), "
    + `${P20_ZONES.length} P20.4 zones (`
    + `${P20_ZONES.reduce((total, zone) => total + zone.cards, 0)} BP cards, `
    + `+1 batch, ${shoulderTier.length} shoulder-tier cards at alpha `
    + `${NEAR_ALPHA_CEILING_OUTSIDE} and ${corridorCards} cards inside the `
    + `drivable corridor all under alpha ${CORRIDOR_ALPHA_CEILING}, every dust `
    + `tint under luma ${DUST_TINT_LUMA_CEILING}, single-pass materials), `
    + "two fog exemptions, "
    + `${CARD_KINDS.length} motions and `
    + `${alphaKinds.size} envelopes wired in the runtime.`,
);
