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
  greenwater: { drawCalls: 6, cards: 246, triangles: 492 },
  bitterpan: { drawCalls: 4, cards: 116, triangles: 232 },
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
  assert.equal(
    spec.batches.length,
    accepted + appended.length,
    `${spec.id} declares ${spec.batches.length} batches; P12 authors `
      + `${accepted} accepted plus ${appended.length} appended.`,
  );
  assert.deepEqual(
    spec.batches.slice(accepted).map((batch) => ({ ...batch })),
    appended,
    `${spec.id} atlas-B batches changed. Each one is a draw call and a render `
      + "state, and they must stay AFTER the accepted batches.",
  );
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

// The P12 zones append: they must be the LAST zones of their spec, or the
// shared seeded stream reaches the accepted zones with different draws.
for (const [map, spec] of Object.entries(LIVING_WORLD_SPECS)) {
  const appended = P12_ZONES.filter((zone) => zone.map === map).map((zone) => zone.id);
  assert.deepEqual(
    spec.zones.slice(spec.zones.length - appended.length).map((zone) => zone.id),
    appended,
    `${spec.id} must keep its P12 zones last and in order.`,
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
    + `${P9_ZONES.length} P9 zones pinned, ${CARD_KINDS.length} motions and `
    + `${alphaKinds.size} envelopes wired in the runtime.`,
);
