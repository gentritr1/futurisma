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
  greenwater: { drawCalls: 7, cards: 280, triangles: 560 },
  bitterpan: { drawCalls: 6, cards: 154, triangles: 308 },
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
  assert.equal(
    spec.batches.length,
    accepted + appended.length + later.length,
    `${spec.id} declares ${spec.batches.length} batches; P12 authors `
      + `${accepted} accepted plus ${appended.length} appended, and P18 appends `
      + `${later.length} more.`,
  );
  assert.deepEqual(
    spec.batches.slice(accepted, accepted + appended.length).map((batch) => ({ ...batch })),
    appended,
    `${spec.id} atlas-B batches changed. Each one is a draw call and a render `
      + "state, and they must stay AFTER the accepted batches.",
  );
  assert.deepEqual(
    spec.batches.slice(accepted + appended.length).map((batch) => ({ ...batch })),
    later,
    `${spec.id} horizon batches changed. They are appended LAST so nothing `
      + "above them moves, and each is a draw call and a render state.",
  );
}

// The additive-and-unfogged combination is a single deliberate exemption. Any
// other batch that turns fog off must either be a lamp batch (whose colour is
// driven per frame anyway) or be argued for here.
for (const [map, spec] of Object.entries(LIVING_WORLD_SPECS)) {
  for (const batch of spec.batches) {
    if (batch.fog) continue;
    assert.ok(
      batch.lamps || batch.id === "horizonAir",
      `${spec.id} batch ${batch.id} is unfogged. Pass 03 allows exactly one `
        + `non-lamp fog exemption (${map} horizonAir) and it is authored as the `
        + "far-field air itself.",
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
  const ids = spec.zones.map((zone) => zone.id);
  assert.deepEqual(
    ids.slice(ids.length - p18.length),
    p18,
    `${spec.id} must keep its P18 horizon zones last and in order.`,
  );
  assert.deepEqual(
    ids.slice(ids.length - p18.length - p12.length, ids.length - p18.length),
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
    + "every silhouette bottom-anchored at base 0, the two tone bands centred, "
    + "one fog exemption), "
    + `${CARD_KINDS.length} motions and `
    + `${alphaKinds.size} envelopes wired in the runtime.`,
);
