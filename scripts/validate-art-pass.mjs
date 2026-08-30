import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolveApronProfile } from "../src/game/apron.js";
import {
  PLAQUE_BAND_BOTTOM_METRES,
  WALL_PLAQUE_INSET_METRES,
} from "../src/game/furniture-placement.js";

/**
 * P12 art pass 01 guard.
 *
 * The runway decals and the trackside boards are pure data pointed at pixel
 * regions on three atlas sheets. Nothing in the build catches the failures that
 * data can have, and none of them are visible in a soak — a decal naming a slot
 * that does not exist, a board standing in the middle of the road, a placement
 * past the end of the lap, or a sheet regenerated without its regions all
 * render as "no error" while the art is wrong or missing. So:
 *
 * 1. **Every slot resolves.** Decal and board slots must name a real region on
 *    the sheet they claim, and every region must lie inside its sheet.
 * 2. **The sheets and the regions are the same build.** `ATLAS_REGIONS.json`
 *    carries the sha256 the builder emitted for each PNG; if a sheet is
 *    regenerated and the regions are not, the UVs silently point at the wrong
 *    pixels. This is the check that catches it.
 * 3. **The counts are the accepted counts.** 200 decals / 400 triangles,
 *    Greenwater 22 boards over 39 quads, Bitterpan 12 over 12.
 * 4. **Nothing is placed off the lap, and no board stands on the road.** Two
 *    separate rules, because the delivered art needs both:
 *
 *    - HARD, no exceptions: a board clears the DECK by at least
 *      `MINIMUM_DECK_CLEARANCE_METRES`, or hangs above the 8 m clear span. A
 *      board on the racing surface is a collision nothing models.
 *    - PINNED: 16 of the 34 boards sit inside the gravel/pan RUN-OFF beyond the
 *      deck — pit walls, marshal posts and barrier-line boards, which is where
 *      a real circuit puts them. The run-off is drivable, so those boards are
 *      objects a sliding player can pass through. That is an accepted visual
 *      compromise, not a licence: every intruding board is named below with its
 *      measured depth, so a NEW one fails this validator and has to be argued
 *      for rather than absorbed.
 */

const root = new URL("../", import.meta.url);
const readJson = (path) => JSON.parse(readFileSync(new URL(path, root), "utf8"));

const atlas = readJson("src/game/data/ATLAS_REGIONS.json");
const decals = readJson("src/game/data/GREENWATER_OPENING_SURFACE_DECALS.json");
const signage = readJson("src/game/data/FUTURISMA_SIGNAGE_PLACEMENTS.json");
const blockout = readJson("src/game/data/greenwater-blockout.json");
const bitterpanStations = readJson("src/game/data/map02/CENTRELINE_STATIONS.json");
const bitterpanProduction = readJson("src/game/data/map02/BITTERPAN_PRODUCTION.json");
// P15 art pass 02.
const crust = readJson("src/game/data/BITTERPAN_SURFACE_CRUST.json");
const dressing = readJson("src/game/data/BITTERPAN_SET_DRESSING.json");
const plaqueBacking = readJson("src/game/data/HANGAR_SIX_PLAQUE_BACKING.json");
const liveryWear = readJson("src/game/data/TOTEM_LIVERY_WEAR.json");
const totemManifest = readJson("public/assets/totem/MANIFEST.json");
// P17 — the measured decal cells, the art call about what lands on each, and the
// generated table the runtime actually imports. All three are written or checked
// by scripts/derive-decal-cells.mjs.
const decalCells = readJson("src/game/data/TOTEM_DECAL_CELLS.json");
const wearPlacement = readJson("src/game/data/TOTEM_WEAR_PLACEMENT.json");
const wearCells = readJson("src/game/data/TOTEM_WEAR_CELLS.json");

// ---------------------------------------------------------------------------
// 1 + 2. The sheets, their regions, and that the two agree.
// ---------------------------------------------------------------------------

const EXPECTED_SHEETS = {
  // P12, art pass 01.
  greenwater_runway_1024: { width: 1024, height: 1024, regions: 36 },
  futurisma_signage_1024: { width: 1024, height: 1024, regions: 17 },
  greenwater_motion_b_512: { width: 512, height: 512, regions: 16 },
  // P15, art pass 02.
  bitterpan_crust_tile_256: { width: 256, height: 256, regions: 1 },
  bitterpan_crust_1024: { width: 1024, height: 1024, regions: 18 },
  hangar_fixtures_512: { width: 512, height: 512, regions: 4 },
  totem_wear_1024: { width: 1024, height: 1024, regions: 14 },
};

assert.deepEqual(
  Object.keys(atlas).sort(),
  Object.keys(EXPECTED_SHEETS).sort(),
  "ATLAS_REGIONS.json must describe exactly the seven art-pass sheets.",
);

for (const [key, expected] of Object.entries(EXPECTED_SHEETS)) {
  const sheet = atlas[key];
  assert.ok(sheet, `ATLAS_REGIONS.json is missing ${key}.`);
  assert.equal(sheet.width, expected.width, `${key} changed width.`);
  assert.equal(sheet.height, expected.height, `${key} changed height.`);
  assert.ok(sheet.regions, `${key} declares no regions.`);
  assert.equal(
    Object.keys(sheet.regions).length,
    expected.regions,
    `${key} declares ${Object.keys(sheet.regions).length} regions; expected `
      + `${expected.regions}.`,
  );

  // The sheet on disk must be the sheet these regions were cut from.
  assert.ok(
    sheet.texture.startsWith("/assets/"),
    `${key} must name a served texture path.`,
  );
  const bytes = readFileSync(new URL(`public${sheet.texture}`, root));
  assert.equal(
    createHash("sha256").update(bytes).digest("hex"),
    sheet.sha256,
    `${key} on disk is not the build ATLAS_REGIONS.json was cut from. Re-run `
      + "scripts/design/build-futurisma-atlases.mjs rather than editing either "
      + "by hand — a sheet and its regions are one artefact.",
  );
  assert.equal(
    bytes.subarray(0, 8).toString("hex"),
    "89504e470d0a1a0a",
    `${key} is not a PNG.`,
  );

  for (const [name, region] of Object.entries(sheet.regions)) {
    for (const field of ["x", "y", "w", "h"]) {
      assert.ok(
        Number.isInteger(region[field]) && region[field] >= 0,
        `${key}/${name} has a non-integer or negative ${field}.`,
      );
    }
    assert.ok(region.w > 0 && region.h > 0, `${key}/${name} is empty.`);
    assert.ok(
      region.x + region.w <= sheet.width && region.y + region.h <= sheet.height,
      `${key}/${name} runs off the sheet.`,
    );
  }
}

// ---------------------------------------------------------------------------
// 3. The opening-surface decals.
// ---------------------------------------------------------------------------

const runwayRegions = atlas.greenwater_runway_1024.regions;
const lapLength = blockout.centreline.lapLength;

assert.equal(decals.decalCount, 200, "Art pass 01 authors 200 opening decals.");
assert.equal(decals.decals.length, 200, "The decal list disagrees with its own count.");
assert.equal(decals.triangles, 400, "200 decals is 400 triangles, two per decal.");
assert.equal(
  decals.regionsFrom,
  "src/game/data/ATLAS_REGIONS.json#greenwater_runway_1024",
  "The decals must be cut against the runway sheet.",
);
assert.equal(
  decals.texture,
  atlas.greenwater_runway_1024.texture,
  "The decal texture path and the atlas texture path disagree.",
);

const decalRange = decals.range;
for (const [index, decal] of decals.decals.entries()) {
  const where = `decal ${index} (${decal.slot})`;
  assert.ok(runwayRegions[decal.slot], `${where} names a slot with no region.`);
  assert.ok(
    Number.isFinite(decal.distance) && decal.distance >= decalRange.fromMetres
      && decal.distance <= decalRange.toMetres,
    `${where} sits at ${decal.distance} m, outside the authored `
      + `${decalRange.fromMetres}-${decalRange.toMetres} m opening.`,
  );
  assert.ok(
    decal.distance >= 0 && decal.distance <= lapLength,
    `${where} sits off the ${lapLength} m lap.`,
  );
  assert.ok(decal.width > 0 && decal.length > 0, `${where} has no extent.`);
  assert.ok(
    decal.alpha > 0 && decal.alpha <= 1,
    `${where} has alpha ${decal.alpha}; an invisible decal is a wasted quad.`,
  );
  assert.ok(
    /^#[0-9a-f]{6}$/i.test(decal.tint),
    `${where} has a malformed tint ${decal.tint}.`,
  );
  assert.ok(
    Number.isFinite(decal.rotationDeg)
      && decal.rotationDeg >= 0 && decal.rotationDeg <= 360,
    `${where} has rotation ${decal.rotationDeg}.`,
  );
}

// The shoulder work is the reason the decal builder has to honour the apron
// cross-section at all. If this stops being true the apron path is dead code.
const beyondDeck = decals.decals.filter(
  (decal) => Math.abs(decal.lateral) > greenwaterHalfWidthAt(decal.distance),
);
assert.ok(
  beyondDeck.length > 0,
  "No decal sits past halfWidth, so nothing exercises the apron cross-section.",
);

// ---------------------------------------------------------------------------
// 4. The trackside boards.
// ---------------------------------------------------------------------------

const signageRegions = atlas.futurisma_signage_1024.regions;
const EXPECTED_SIGNAGE = {
  greenwater: { boards: 22, quads: 39, triangles: 78, length: lapLength },
  bitterpan: {
    boards: 12,
    quads: 12,
    triangles: 24,
    length: bitterpanStations.total_length_m,
  },
};
const FACINGS = new Set(["course", "reverse", "inward"]);

/** The authored clear span under the Cradle gantry. */
const CLEAR_SPAN_METRES = 8;
/** No board may come nearer than this to the deck edge. */
const MINIMUM_DECK_CLEARANCE_METRES = 0.5;

/** Boards that hang above the clear span and are exempt from lateral rules. */
const OVERHEAD_BOARDS = ["GW_CRADLE_FASCIA", "GW_CRADLE_FASCIA_REAR", "GW_CRADLE_PENNANTS"];

/**
 * Boards standing inside the drivable run-off, id to measured depth in metres.
 *
 * Every one of these is mounted on authored trackside structure — the pit wall
 * along the grid, marshal posts, and sponsor boards set just inside the barrier
 * line where a circuit actually puts them. The run-off is drivable (A gravel
 * grip 0.68, C pan grip 0.8), so a player who slides wide passes through them:
 * the boards are decoration and nothing gives them collision.
 *
 * Recorded rather than waved past. The depths below were measured against the
 * authored apron table at each board's own distance; the deepest is the grid
 * pit wall at 3.4 m into a 5 m gravel shoulder, and BP_M_UNDERPASS at 4.8 m
 * into the 5.8 m pan. Adding a board here is a review decision.
 */
const RUN_OFF_INTRUSIONS = {
  GW_GRID_TOTEM_WORKS: 3.4,
  GW_GRID_TOTEM_PRIVATEER: 3.4,
  GW_GRID_TOTEM_NIGHTFORM: 3.4,
  GW_GRID_TOTEM_NEEDLE: 3.4,
  GW_PITWALL_TAPE: 3.4,
  GW_S_KAIRO: 0.6,
  GW_S_AUTHORITY: 0.6,
  GW_S_AEROLIFT_A: 0.2,
  GW_S_KAIRO_C: 0.4,
  GW_M_T1: 1.07,
  GW_M_ELBOW: 0.51,
  GW_M_T10: 0.4,
  BP_M_UNDERPASS: 4.8,
};

const overheadIds = new Set(OVERHEAD_BOARDS);
const overheadSeen = new Set();
const intrusionsSeen = new Set();

for (const [map, expected] of Object.entries(EXPECTED_SIGNAGE)) {
  const spec = signage[map];
  assert.ok(spec, `FUTURISMA_SIGNAGE_PLACEMENTS.json has no ${map} block.`);
  assert.equal(spec.boards, expected.boards, `${map} board count changed.`);
  assert.equal(
    spec.placements.length,
    expected.boards,
    `${map} declares ${spec.boards} boards but ships ${spec.placements.length}.`,
  );

  let quads = 0;
  const ids = new Set();
  for (const placement of spec.placements) {
    const where = `${map}/${placement.id}`;
    assert.ok(!ids.has(placement.id), `${where} is a duplicate placement id.`);
    ids.add(placement.id);
    assert.ok(
      signageRegions[placement.slot],
      `${where} names slot ${placement.slot}, which has no region.`,
    );
    assert.ok(FACINGS.has(placement.facing), `${where} faces "${placement.facing}".`);
    assert.ok(
      typeof placement.mount === "string" && placement.mount.length > 0,
      `${where} has no mount note, so the post builder cannot place it.`,
    );
    assert.ok(
      placement.distance >= 0 && placement.distance <= expected.length,
      `${where} sits at ${placement.distance} m, off the ${expected.length} m lap.`,
    );
    assert.ok(
      placement.widthMetres > 0 && placement.heightMetres > 0,
      `${where} has no extent.`,
    );
    assert.ok(
      placement.height > 0,
      `${where} is mounted at ${placement.height} m, at or below the deck.`,
    );

    const tiles = placement.tileU ?? 1;
    assert.ok(
      Number.isInteger(tiles) && tiles >= 1,
      `${where} tiles ${tiles} times; tileU must be a positive integer.`,
    );
    quads += tiles;

    // A gantry fascia spans the track by design and is exempt from every
    // lateral rule by height: mounted above the 8 m clear span, it can never be
    // driven into.
    const lowerEdge = placement.height - placement.heightMetres / 2;
    if (lowerEdge >= CLEAR_SPAN_METRES) {
      assert.ok(
        overheadIds.has(placement.id),
        `${where} hangs above the clear span but is not a pinned overhead board.`,
      );
      overheadSeen.add(placement.id);
      continue;
    }

    const geometry = map === "greenwater"
      ? greenwaterCorridorAt(placement.distance)
      : bitterpanCorridorAt(placement.distance);

    // HARD. Nothing on the racing surface, ever.
    const deckClearance = Math.abs(placement.lateral) - geometry.halfWidth;
    assert.ok(
      deckClearance >= MINIMUM_DECK_CLEARANCE_METRES,
      `${where} stands at ${placement.lateral} m against a ${geometry.halfWidth} m `
        + `half-width — ${deckClearance.toFixed(2)} m of deck clearance, below the `
        + `${MINIMUM_DECK_CLEARANCE_METRES} m floor. A board on the racing `
        + "surface is a collision nothing models.",
    );

    // PINNED. Run-off intrusion is allowed only where it is already recorded.
    const intrusion = geometry.corridor - Math.abs(placement.lateral);
    const pinned = RUN_OFF_INTRUSIONS[placement.id];
    if (pinned === undefined) {
      assert.ok(
        intrusion <= 0,
        `${where} sits ${intrusion.toFixed(2)} m inside the drivable run-off `
          + `(corridor reaches ${geometry.corridor.toFixed(2)} m) and is not a `
          + "recorded intrusion. Move it outside the run-off, or add it to "
          + "RUN_OFF_INTRUSIONS with a reviewed reason — a board a sliding "
          + "player passes through is a compromise, not a default.",
      );
    } else {
      intrusionsSeen.add(placement.id);
      assert.ok(
        intrusion > 0,
        `${where} is recorded as a run-off intrusion but now clears the `
          + "corridor. Delete its RUN_OFF_INTRUSIONS entry.",
      );
      assert.equal(
        Number(intrusion.toFixed(2)),
        pinned,
        `${where} now intrudes ${intrusion.toFixed(2)} m into the run-off; the `
          + `reviewed depth is ${pinned} m.`,
      );
    }
  }

  assert.equal(quads, expected.quads, `${map} tiles to ${quads} quads.`);
  assert.equal(spec.quads, expected.quads, `${map} declares the wrong quad count.`);
  assert.equal(
    spec.triangles,
    expected.triangles,
    `${map} declares the wrong triangle count.`,
  );
  assert.equal(
    quads * 2,
    expected.triangles,
    `${map} quads and triangles disagree.`,
  );
}

// Neither pinned table may rot: an entry for a board that no longer exists is
// a stale exemption, and stale exemptions are how a rule quietly stops binding.
assert.deepEqual(
  [...overheadSeen].sort(),
  [...overheadIds].sort(),
  "OVERHEAD_BOARDS names a board that is no longer authored above the clear span.",
);
assert.deepEqual(
  [...intrusionsSeen].sort(),
  Object.keys(RUN_OFF_INTRUSIONS).sort(),
  "RUN_OFF_INTRUSIONS names a board that no longer exists or no longer intrudes.",
);

// Both Cradle fascia faces are authored, on the gantry, at the same height.
const cradle = signage.greenwater.placements.filter(
  (placement) => placement.slot === "CRADLE_BANNER",
);
assert.equal(cradle.length, 2, "The Cradle gantry carries two fascia faces.");
assert.deepEqual(
  cradle.map((placement) => placement.facing).sort(),
  ["course", "reverse"],
  "The two Cradle fascia faces must be a front and a back.",
);
for (const face of cradle) {
  assert.equal(face.height, 15.2, "Both Cradle fascia faces hang at 15.2 m.");
}

// ---------------------------------------------------------------------------
// 5. P15 art pass 02 — the four authoring specs.
//
// Same three questions as the pass-01 payloads above, asked of the new data:
// every slot resolves against the sheet it claims, the counts are the accepted
// counts, and nothing is placed off its lap. Plus the two contracts that are
// specific to this pass:
//
//  - The Bitterpan crust decals and the set dressing are ONE mesh. The dressing
//    declares `mergesInto` the crust layer and both name the same sheet, which
//    is the whole reason 110 extra decals cost zero extra draw calls. If either
//    side of that ever names a different texture the merge is a lie and the
//    budget in the phase report is wrong, so it is asserted rather than assumed.
//  - The Hangar Six backing panels are DERIVED, not authored. This file asserts
//    the declared class table and the counts; `validate-furniture.mjs` runs the
//    shipped resolver and MEASURES that exactly 13 wall placements exist and
//    that every backing clears the deck through the overhead-structure branch.
// ---------------------------------------------------------------------------

const bitterpanLapLength = bitterpanStations.total_length_m;
const crustRegions = atlas.bitterpan_crust_1024.regions;

/** Shared shape check for a surface decal: slot, extent, tint, alpha, spin. */
function assertSurfaceDecal(where, decal, regions, lapLength) {
  assert.ok(regions[decal.slot], `${where} names slot ${decal.slot}, which has no region.`);
  assert.ok(
    Number.isFinite(decal.distance) && decal.distance >= 0 && decal.distance <= lapLength,
    `${where} sits at ${decal.distance} m, off the ${lapLength} m lap.`,
  );
  assert.ok(Number.isFinite(decal.lateral), `${where} has a non-finite lateral.`);
  assert.ok(decal.width > 0 && decal.length > 0, `${where} has no extent.`);
  assert.ok(
    decal.alpha > 0 && decal.alpha <= 1,
    `${where} has alpha ${decal.alpha}; an invisible decal is a wasted quad.`,
  );
  assert.ok(/^#[0-9a-f]{6}$/i.test(decal.tint), `${where} has a malformed tint ${decal.tint}.`);
  // Pass 02 authors signed rotations (a windrow head tilted 1.4 degrees off the
  // ribbon), so the band is two-sided here where pass 01's was 0-360.
  assert.ok(
    Number.isFinite(decal.rotationDeg)
      && decal.rotationDeg >= -360 && decal.rotationDeg <= 360,
    `${where} has rotation ${decal.rotationDeg}.`,
  );
}

// --- The pan crust: base tile + decal layer ---------------------------------

assert.equal(
  crust.ground.texture,
  atlas.bitterpan_crust_tile_256.texture,
  "The pan ground names a texture the atlas does not describe.",
);
assert.equal(
  crust.ground.regionsFrom,
  "src/game/data/ATLAS_REGIONS.json#bitterpan_crust_tile_256",
  "The pan ground must be cut against the crust tile sheet.",
);
assert.equal(crust.ground.metresPerTile, 12, "The pan crust tile is 12 m across.");
assert.deepEqual(
  Object.keys(atlas.bitterpan_crust_tile_256.regions),
  ["CRUST_FIELD"],
  "The crust tile is one seamless field, not an atlas.",
);
// Pass 02 principle 4, stated in the spec and asserted here so a future filter
// sweep cannot quietly put a 900 m ground plane back on the point-sampled class.
assert.equal(crust.ground.runtime.magFilter, "LinearFilter");
assert.equal(crust.ground.runtime.minFilter, "LinearMipmapLinearFilter");
assert.equal(crust.ground.runtime.generateMipmaps, true);
assert.equal(crust.ground.runtime.anisotropy, 4);
assert.equal(crust.ground.runtime.wrapS, "RepeatWrapping");
assert.equal(crust.ground.runtime.wrapT, "RepeatWrapping");

assert.equal(crust.decalCount, 297, "Art pass 02 authors 297 pan crust decals.");
assert.equal(crust.decals.length, 297, "The crust decal list disagrees with its own count.");
assert.equal(crust.triangles, 594, "297 decals is 594 triangles, two per decal.");
assert.equal(
  crust.decalLayer.texture,
  atlas.bitterpan_crust_1024.texture,
  "The crust decal texture path and the atlas texture path disagree.",
);
assert.equal(
  crust.decalLayer.regionsFrom,
  "src/game/data/ATLAS_REGIONS.json#bitterpan_crust_1024",
  "The crust decals must be cut against the crust decal sheet.",
);
assert.equal(crust.lapLengthMetres, 3050, "The crust layer is authored against a 3,050 m lap.");
assert.ok(
  Math.abs(crust.lapLengthMetres - bitterpanLapLength) <= 15,
  `The crust layer is authored against ${crust.lapLengthMetres} m but Bitterpan is `
    + `${bitterpanLapLength} m.`,
);

for (const [index, decal] of crust.decals.entries()) {
  assertSurfaceDecal(
    `crust decal ${index} (${decal.slot})`,
    decal,
    crustRegions,
    bitterpanLapLength,
  );
}

// Which slots are allowed to land inside the drivable floor.
//
// Every entry here is zero-height painted road, so none of it is an obstacle —
// `validate-furniture.mjs` owns that rule and measures it. What this pins is
// INTENT: the spec names the slots that are supposed to be on the deck, and the
// route language is the one deliberate addition to that list. Pinning it means
// a NEW slot appearing under the racing line fails here and has to be argued
// for, rather than being absorbed into a 297-row table nobody re-reads.
const CRUST_ROUTE_ON_DECK = {
  // Generation rule 4: a cyan edge line on both Brine Cut berms. It is the
  // route read at the one place the pan gives the driver no other edge cue, and
  // an edge line that stops at the deck edge is not an edge line.
  ROUTE_EDGE_CYAN: "EDGE_BRINE_CUT berms",
};
const crustAllowedOnDeck = new Set([
  ...crust.deckSafety.onDeckSlots,
  ...Object.keys(CRUST_ROUTE_ON_DECK),
]);
const crustOnDeckSeen = new Set();
for (const [index, decal] of crust.decals.entries()) {
  if (Math.abs(decal.lateral) >= crust.deckSafety.offDrivableFloorMetres) continue;
  crustOnDeckSeen.add(decal.slot);
  assert.ok(
    crustAllowedOnDeck.has(decal.slot),
    `crust decal ${index} (${decal.slot}) sits at ${decal.lateral} m, inside the `
      + `${crust.deckSafety.offDrivableFloorMetres} m off-drivable floor, and its slot is `
      + "neither an authored on-deck telegraph nor pinned route language.",
  );
}
// Neither list may rot: a slot named as on-deck that no longer reaches the deck
// is a stale exemption, and stale exemptions are how a rule stops binding.
assert.deepEqual(
  [...crustOnDeckSeen].sort(),
  [...crustAllowedOnDeck].sort(),
  "A slot is declared as on-deck (or pinned as route language) but no longer "
    + "places anything inside the drivable floor.",
);

// --- The set dressing, which merges into the crust mesh ---------------------

assert.equal(dressing.itemCount, 110, "Art pass 02 authors 110 set-dressing items.");
assert.equal(dressing.items.length, 110, "The dressing list disagrees with its own count.");
assert.equal(dressing.triangles, 220, "110 items is 220 triangles, two per item.");
assert.equal(
  dressing.texture,
  crust.decalLayer.texture,
  "The dressing merges into the crust mesh, so it must name the same sheet — a "
    + "second texture here is a second draw call, whatever the spec says.",
);
assert.equal(
  dressing.regionsFrom,
  crust.decalLayer.regionsFrom,
  "The dressing and the crust layer must be cut against the same regions.",
);
assert.match(
  dressing.runtime.mergesInto,
  /^BP_SURFACE_CRUST\b/,
  "The dressing must declare that it merges into BP_SURFACE_CRUST.",
);
assert.equal(
  crust.decalLayer.runtime.meshName,
  "BP_SURFACE_CRUST",
  "The crust layer must be the mesh the dressing merges into.",
);
for (const field of ["depthWrite", "vertexColors", "polygonOffsetFactor", "polygonOffsetUnits"]) {
  assert.equal(
    dressing.runtime[field],
    crust.decalLayer.runtime[field],
    `The dressing and the crust layer disagree about ${field}; they share one `
      + "material, so they cannot disagree about anything on it.",
  );
}

const dressingCrossesDeck = new Set(dressing.deckSafety.crossesDeck);
for (const [index, item] of dressing.items.entries()) {
  const where = `dressing ${index} (${item.id} / ${item.slot})`;
  assertSurfaceDecal(where, item, crustRegions, bitterpanLapLength);
  assert.equal(item.class, "flat", `${where} is not classed flat.`);
  assert.equal(
    item.heightMetres,
    0,
    `${where} declares ${item.heightMetres} m of height. Every dressing entry is `
      + "a surface decal; anything with extent above the deck is furniture and "
      + "answers to validate-furniture.mjs instead.",
  );
  if (dressingCrossesDeck.has(item.slot)) continue;
  assert.ok(
    Math.abs(item.lateral) >= dressing.deckSafety.minimumAuthoredLateralMetres,
    `${where} sits at ${item.lateral} m, inside the authored `
      + `${dressing.deckSafety.minimumAuthoredLateralMetres} m minimum. Only the `
      + `${[...dressingCrossesDeck].join(", ")} spans may cross the corridor.`,
  );
}

const dressingIds = new Set(dressing.items.map((item) => item.id));
assert.equal(dressingIds.size, dressing.items.length, "A dressing id is repeated.");

const MERGED_BITTERPAN_DECALS = crust.decalCount + dressing.itemCount;
assert.equal(MERGED_BITTERPAN_DECALS, 407, "The merged Bitterpan surface layer is 407 decals.");
assert.equal(
  crust.triangles + dressing.triangles,
  MERGED_BITTERPAN_DECALS * 2,
  "The merged layer's triangle count must be two per decal.",
);

// --- Hangar Six plaque backing panels ---------------------------------------

const fixtureRegions = atlas.hangar_fixtures_512.regions;
assert.equal(
  plaqueBacking.texture,
  atlas.hangar_fixtures_512.texture,
  "The plaque backing names a texture the atlas does not describe.",
);
assert.equal(
  plaqueBacking.regionsFrom,
  "src/game/data/ATLAS_REGIONS.json#hangar_fixtures_512",
  "The backing panels must be cut against the hangar fixtures sheet.",
);

const EXPECTED_BACKING_PANELS = { total: 13, chevron: 7, board: 6 };
assert.equal(
  plaqueBacking.derivation.expected.panels,
  EXPECTED_BACKING_PANELS.total,
  "13 backing panels: one per Hangar Six wall plaque.",
);
assert.equal(plaqueBacking.derivation.expected.chevronPanels, EXPECTED_BACKING_PANELS.chevron);
assert.equal(plaqueBacking.derivation.expected.boardPanels, EXPECTED_BACKING_PANELS.board);
assert.equal(
  EXPECTED_BACKING_PANELS.chevron + EXPECTED_BACKING_PANELS.board,
  EXPECTED_BACKING_PANELS.total,
  "The two backing classes must account for every panel.",
);
assert.equal(
  plaqueBacking.classes.length,
  2,
  "Two backing classes: one behind a turn chevron, one behind a braking board.",
);
for (const backingClass of plaqueBacking.classes) {
  const where = `plaque backing ${backingClass.id}`;
  assert.ok(fixtureRegions[backingClass.slot], `${where} names slot ${backingClass.slot}.`);
  assert.ok(
    backingClass.widthMetres > 0 && backingClass.heightMetres > 0,
    `${where} has no extent.`,
  );
  // The panel grows UPWARD only. A symmetric margin would hang structure over
  // the deck under the plaque band, which is the precise P13 failure.
  assert.equal(
    backingClass.bottomMarginMetres,
    0,
    `${where} declares a bottom margin. The panel is flush with the plaque's own `
      + "lower edge; anything below it hangs over the deck.",
  );
  assert.equal(
    backingClass.bottomHeightMetres,
    PLAQUE_BAND_BOTTOM_METRES,
    `${where} sits its lower edge at ${backingClass.bottomHeightMetres} m rather than `
      + `flush with the ${PLAQUE_BAND_BOTTOM_METRES} m plaque band.`,
  );
  assert.equal(
    Number((backingClass.bottomHeightMetres + backingClass.heightMetres / 2).toFixed(4)),
    backingClass.centreHeightMetres,
    `${where}'s declared centre height does not follow from its flush bottom edge.`,
  );
  // The panel is bigger than the plaque it backs, on both axes, or it is not a
  // backing — it is a second plaque z-fighting the first.
  assert.ok(
    backingClass.sideMarginMetres > 0 && backingClass.topMarginMetres > 0,
    `${where} does not stand proud of the plaque it backs.`,
  );
}
assert.ok(
  plaqueBacking.placement.BACKING_INSET_METRES < WALL_PLAQUE_INSET_METRES,
  `The backing inset (${plaqueBacking.placement.BACKING_INSET_METRES} m) must be `
    + `smaller than the plaque's own ${WALL_PLAQUE_INSET_METRES} m, or the panel `
    + "stands in front of the plaque instead of behind it.",
);

// --- TOTEM livery wear ------------------------------------------------------

const wearRegions = atlas.totem_wear_1024.regions;
assert.equal(
  liveryWear.deliveryForm.texture,
  atlas.totem_wear_1024.texture,
  "The wear overlay names a texture the atlas does not describe.",
);
assert.equal(
  liveryWear.deliveryForm.liveryFilenamesChanged,
  false,
  "The wear pass ships as an overlay; the four livery sheets are validator-pinned "
    + "by hash in validate-assets.mjs and must not be recomposited.",
);
assert.deepEqual(
  liveryWear.chipStrip.region,
  totemManifest.texture_assignments.paint_chip_strip.region_px,
  "The wear sheet's chip strip must be in register with the livery paint-chip "
    + "strip declared in totem/MANIFEST.json. If these drift the multiply lands "
    + "on the wrong material and nothing renders wrong enough to notice.",
);
assert.deepEqual(
  [
    wearRegions.CHIP_WEAR_STRIP.x,
    wearRegions.CHIP_WEAR_STRIP.y,
    wearRegions.CHIP_WEAR_STRIP.w,
    wearRegions.CHIP_WEAR_STRIP.h,
  ],
  liveryWear.chipStrip.region,
  "CHIP_WEAR_STRIP on the sheet and the spec's chipStrip region disagree.",
);
assert.deepEqual(
  liveryWear.chipStrip.perMaterial.map((entry) => entry.material),
  totemManifest.texture_assignments.paint_chip_strip.order,
  "The wear multiples must be listed in the chip strip's own material order.",
);
for (const entry of liveryWear.chipStrip.perMaterial) {
  assert.ok(
    entry.multiply > 0 && entry.multiply <= 1,
    `Wear multiply for ${entry.material} is ${entry.multiply}.`,
  );
  // The spec quotes `effective` to three decimals, so the comparison is to the
  // resolution it was written at rather than to the float.
  assert.ok(
    Math.abs(entry.multiply * liveryWear.intensityScale - entry.effective) <= 5e-4,
    `${entry.material}'s effective wear ${entry.effective} does not follow from `
      + `${entry.multiply} at the 45/100 intensity `
      + `(${(entry.multiply * liveryWear.intensityScale).toFixed(4)}).`,
  );
}
for (const slot of liveryWear.librarySlots.slots) {
  assert.ok(wearRegions[slot.slot], `Wear library slot ${slot.slot} has no region.`);
}

// --- The wear library, placed on the measured decal cells -------------------
//
// HISTORY OF THIS ASSERTION. P15 asserted the opposite of what follows:
//
//     "The library slots are addressed by name and are NOT applied this phase:
//      the 12 decal-cell rects are unpublished, so a runtime that placed them
//      would be guessing. The chip strip is the whole of the shipped read, and
//      the open dependency is recorded so a future phase picks it up rather
//      than rediscovers it."
//
// It checked only that `openDependency` stayed recorded — a deliberate hold,
// not an oversight. P17 closed the dependency the only way it could be closed
// honestly: the rects were never published by totem.js, so they were MEASURED
// out of the runtime GLB by scripts/derive-decal-cells.mjs and committed as
// TOTEM_DECAL_CELLS.json with per-cell provenance and the GLB's sha256.
//
// The P15 assertion is not deleted, it is INVERTED, and the inversion carries
// the condition that made the hold correct in the first place: a slot may only
// be applied at a rect somebody measured. Everything below exists to make
// "applied without measurement" a failure rather than a silent regression to
// guessing.
assert.ok(
  liveryWear.librarySlots.openDependency.length > 0,
  "The decal-cell dependency's ORIGINAL wording must stay recorded even now that "
    + "it is closed. It is the record of why the library shipped unapplied for a "
    + "phase, and deleting it would make the hold look like an oversight.",
);
assert.ok(
  liveryWear.librarySlots.openDependencyClosedBy?.pass === "P17",
  "The open dependency is closed by P17 and the closure must say so.",
);

// The measurement itself: shape, provenance, and that it still describes the GLB
// that ships. `node scripts/derive-decal-cells.mjs --check` is the deeper gate
// (it re-derives from the binary); these are the invariants the runtime relies on.
assert.equal(decalCells.cellCount, 12, "The GLB must yield exactly 12 decal cells.");
assert.equal(
  decalCells.cells.length,
  decalCells.cellCount,
  "The decal-cell list disagrees with its own count.",
);
assert.equal(
  decalCells.source.glb,
  "public/assets/totem/models/totem_runtime.glb",
  "The decal cells must be measured from the GLB the runtime actually loads.",
);
assert.equal(
  decalCells.source.sha256,
  createHash("sha256")
    .update(readFileSync(new URL(decalCells.source.glb, root)))
    .digest("hex"),
  "The runtime GLB has changed since the decal cells were measured. Re-run "
    + "scripts/derive-decal-cells.mjs and review the diff BEFORE shipping: the wear "
    + "library would otherwise be painted at UV rects that no longer exist, which "
    + "is exactly the guessing P15 refused to do.",
);
// The convention is the trap this measurement lives inside — the served sheets
// are the vertical flip of the GLB-embedded one. Pin the proof, not the note.
assert.equal(
  decalCells.chipRowV,
  1 - (totemManifest.texture_assignments.paint_chip_strip.region_px[1]
    + totemManifest.texture_assignments.paint_chip_strip.chip_size_px / 2) / 1024,
  "The hull's collapsed UV row must land on the paint-chip strip's centre row in "
    + "the SERVED (flipY = true) convention. If this fails the whole pixel/UV "
    + "mapping in TOTEM_DECAL_CELLS.json is mirrored and every rect is wrong.",
);

const measuredCellIds = new Set();
const cellById = new Map(decalCells.cells.map((cell) => [cell.id, cell]));
for (const cell of decalCells.cells) {
  const where = `decal cell ${cell.id}`;
  assert.ok(!measuredCellIds.has(cell.id), `${where} is listed twice.`);
  measuredCellIds.add(cell.id);
  const [x, y, w, h] = cell.rectPx;
  assert.ok(w > 0 && h > 0, `${where} has no extent.`);
  assert.ok(
    x >= 0 && y >= 0 && x + w <= 1024 && y + h <= 1024,
    `${where} leaves the 1024 sheet.`,
  );
  const [u0, v0, u1, v1] = cell.uvRect;
  assert.ok(
    Math.abs(u0 * 1024 - x) < 1e-3 && Math.abs((1 - v1) * 1024 - y) < 1e-3
      && Math.abs((u1 - u0) * 1024 - w) < 1e-3 && Math.abs((v1 - v0) * 1024 - h) < 1e-3,
    `${where}'s UV rect and pixel rect disagree; one of them was hand-edited.`,
  );
  // Provenance is how a GLB re-export becomes visible as more than a hash change.
  assert.ok(cell.quads > 0, `${where} has no quads.`);
  assert.equal(
    cell.provenance.length,
    cell.quads,
    `${where} claims ${cell.quads} quads but carries ${cell.provenance.length} `
      + "provenance entries.",
  );
  assert.equal(
    cell.provenance.reduce((sum, entry) => sum + entry.vertices, 0),
    cell.vertices,
    `${where}'s per-quad vertex counts do not add up to its own total.`,
  );
  for (const entry of cell.provenance) {
    assert.equal(
      entry.material,
      "TOTEM_body",
      `${where} names material ${entry.material}; the wear overlay only reaches `
        + "TOTEM_body.",
    );
    assert.ok(entry.node.length > 0, `${where} has a provenance entry with no node.`);
  }
}

// Disjointness is load-bearing: the runtime picks a cell per fragment by summing
// rect tests, and the chip strip's multiply is applied unconditionally alongside.
// Overlapping rects would double-multiply and move the chip read off its spec.
const chipUv = [
  wearRegions.CHIP_WEAR_STRIP.x / 1024,
  1 - (wearRegions.CHIP_WEAR_STRIP.y + wearRegions.CHIP_WEAR_STRIP.h) / 1024,
  (wearRegions.CHIP_WEAR_STRIP.x + wearRegions.CHIP_WEAR_STRIP.w) / 1024,
  1 - wearRegions.CHIP_WEAR_STRIP.y / 1024,
];
const uvOverlaps = (a, b) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
for (const [index, cell] of decalCells.cells.entries()) {
  assert.ok(
    !uvOverlaps(cell.uvRect, chipUv),
    `${cell.id} overlaps the paint-chip strip. The chip multiply and a library `
      + "slot would stack on the same texel and the chip read would stop being the "
      + "spec's effective number.",
  );
  for (const other of decalCells.cells.slice(index + 1)) {
    assert.ok(
      !uvOverlaps(cell.uvRect, other.uvRect),
      `${cell.id} and ${other.id} overlap.`,
    );
  }
}

// --- Every applied slot must reference a measured rect ----------------------
const placements = wearPlacement.placements;
assert.ok(Array.isArray(placements), "The wear library must publish its placements.");
const slotNames = liveryWear.librarySlots.slots.map((entry) => entry.slot);
assert.equal(
  placements.length,
  slotNames.length,
  `The library authors ${slotNames.length} slots and places ${placements.length}. `
    + "P15 shipped 12 resolved and 0 applied; P17 ships 12 resolved and 12 applied. "
    + "A slot that is authored but unplaced is a slot nobody will ever see.",
);
/**
 * THE assertion this phase adds: apply-without-measurement fails.
 *
 * A function rather than an inline `assert.ok` so the negative test below can
 * drive the SAME predicate over a synthetic placement — twelve placements that
 * all pass prove only that the loop runs, not that the rule binds.
 */
function assertPlacementIsMeasured(placement) {
  assert.ok(
    measuredCellIds.has(placement.cell),
    `wear placement ${placement.slot} is applied at cell ${placement.cell}, which no `
      + "measurement produced. A slot may only be applied at a rect that came out of "
      + "scripts/derive-decal-cells.mjs; anything else is the guess P15 refused. "
      + `Measured cells: ${[...measuredCellIds].join(", ")}.`,
  );
}

const placedCells = new Set();
const placedSlots = new Set();
for (const placement of placements) {
  const where = `wear placement ${placement.slot}`;
  assertPlacementIsMeasured(placement);
  assert.ok(
    wearRegions[placement.slot],
    `${where} names a slot with no region on the wear sheet.`,
  );
  assert.ok(!placedSlots.has(placement.slot), `${where} is placed twice.`);
  assert.ok(
    !placedCells.has(placement.cell),
    `${where} lands on cell ${placement.cell}, which already carries a slot. The `
      + "runtime takes the first containing cell per fragment, so the second slot "
      + "would silently never render.",
  );
  placedSlots.add(placement.slot);
  placedCells.add(placement.cell);
  // `scale` is the hold-back mechanism. It may only ever pull a slot BACK.
  assert.ok(
    Number.isFinite(placement.scale) && placement.scale > 0 && placement.scale <= 1,
    `${where} asks for scale ${placement.scale}; the sheet is authored at its full `
      + "strength and a per-slot scale can only hold it back.",
  );
  assert.ok(
    typeof placement.reason === "string" && placement.reason.length > 0,
    `${where} has no recorded reason. Which slot lands on which cell is an art `
      + "call; an unargued one is indistinguishable from a guess.",
  );
}
assert.deepEqual(
  [...placedSlots].sort(),
  [...slotNames].sort(),
  "Every authored library slot must be placed, and only authored slots may be.",
);

// The three placements that are not taste but measurement. Each is derived from
// the cell AABBs, so a GLB re-export that moves the geometry fails here with the
// reason attached rather than quietly putting soot on the nose.
const cellOf = (slot) => cellById.get(
  placements.find((placement) => placement.slot === slot).cell,
);
const forwardMost = decalCells.cells.reduce(
  (best, cell) => (cell.aabb[2] < best.aabb[2] ? cell : best),
);
assert.equal(
  cellOf("SCUFF_EDGE").id,
  forwardMost.id,
  `SCUFF_EDGE is "abrasion along a leading edge", so it belongs on the cell with `
    + `the minimum zMin. That is ${forwardMost.id} (${forwardMost.aabb[2]} m), not `
    + `${cellOf("SCUFF_EDGE").id}.`,
);
const sootCell = cellOf("SOOT_FAN");
assert.ok(
  sootCell.aabb[5] > 2.2,
  `SOOT_FAN pairs with the vertex-colour heat staining the spec places at z > 2.2, `
    + `but ${sootCell.id} reaches only z = ${sootCell.aabb[5]} m.`,
);
const aftCells = decalCells.cells.filter((cell) => cell.aabb[5] > 2.2);
assert.equal(
  sootCell.id,
  aftCells.reduce((best, cell) => {
    const area = (c) => c.rectPx[2] * c.rectPx[3];
    return area(cell) > area(best) ? cell : best;
  }).id,
  "SOOT_FAN must take the largest of the aft cells; a fan on a small one reads as "
    + "a stain rather than as exhaust.",
);
assert.equal(
  cellOf("MISMATCH_PANEL").quads,
  2,
  "The privateer entry says it carries BOTH MISMATCH_PANEL placements, so the cell "
    + "MISMATCH_PANEL lands on must be a two-quad cell. One quad cannot be both.",
);

// --- The generated runtime table --------------------------------------------
//
// src/game/totem.ts imports TOTEM_WEAR_CELLS.json, not the two files above: the
// reasoning and the provenance are for people, and the initial bundle is capped
// at 225 KiB gzip. That split is only safe while the generated table says the
// same thing its sources do, so check it here as well as in --check.
assert.equal(
  wearCells.cells.length,
  placements.length,
  `The runtime table carries ${wearCells.cells.length} placements and the art `
    + `direction authors ${placements.length}. Re-run scripts/derive-decal-cells.mjs.`,
);
for (const [index, entry] of wearCells.cells.entries()) {
  const authored = placements[index];
  const where = `runtime wear cell ${index} (${entry.slot})`;
  assert.equal(entry.slot, authored.slot, `${where} is not the authored slot.`);
  assert.equal(entry.cell, authored.cell, `${where} names a different cell.`);
  assert.equal(entry.scale, authored.scale, `${where} carries a different scale.`);
  assert.deepEqual(
    entry.dst,
    cellById.get(entry.cell).uvRect,
    `${where}'s destination rect is not the measured cell's UV rect, so the runtime `
      + "would wear a rectangle nobody measured.",
  );
  const region = wearRegions[entry.slot];
  assert.deepEqual(
    entry.src,
    [
      region.x / 1024,
      1 - (region.y + region.h) / 1024,
      (region.x + region.w) / 1024,
      1 - region.y / 1024,
    ],
    `${where}'s source rect is not ${entry.slot}'s region on the wear sheet.`,
  );
  // Both rects must be non-degenerate: the shader divides by the destination's
  // size, and a zero-width source would collapse the slot to a single texel.
  assert.ok(
    entry.dst[2] > entry.dst[0] && entry.dst[3] > entry.dst[1],
    `${where} has a degenerate destination; the shader divides by its size.`,
  );
  assert.ok(
    entry.src[2] > entry.src[0] && entry.src[3] > entry.src[1],
    `${where} has a degenerate source.`,
  );
}

// ---------------------------------------------------------------------------
// NEGATIVE TEST — apply-without-measurement must FAIL.
//
// The twelve shipped placements all name measured cells, so running the rule
// over them proves only that the loop executes. The whole point of P17's
// re-baseline is that the P15 hold ("do not place a slot at a rect nobody
// published") survives the inversion as a condition rather than being dropped
// with it. So drive the SAME predicate over a placement pointing at a cell id
// no measurement produced, and assert it throws with the reason attached.
//
// The real JSON is never touched: the synthetic record is a copy of a real
// placement with its cell id moved off the measured set, and thrown away.
// ---------------------------------------------------------------------------

{
  const unmeasuredCell = "decal_99__SYNTHETIC_UNMEASURED";
  assert.ok(
    !measuredCellIds.has(unmeasuredCell),
    "The synthetic cell id is one the measurement produced, so the negative test "
      + "is not testing anything.",
  );
  const guessed = { ...placements[0], cell: unmeasuredCell };
  assert.throws(
    () => assertPlacementIsMeasured(guessed),
    (error) => {
      assert.ok(
        error instanceof assert.AssertionError,
        "The measurement rule threw the wrong error type.",
      );
      const message = String(error.message);
      for (const fragment of [
        guessed.slot,
        unmeasuredCell,
        "scripts/derive-decal-cells.mjs",
      ]) {
        assert.ok(
          message.includes(fragment),
          `The apply-without-measurement failure does not name "${fragment}". A `
            + `failure nobody can read is a failure nobody acts on. Got: ${message}`,
        );
      }
      return true;
    },
    "A wear slot applied at an UNMEASURED cell did not fail. The rule cannot fail, "
      + "so it has never proved anything about the twelve that pass — and the "
      + "guessing P15 refused would ship silently.",
  );
}

const liveryCodes = liveryWear.perLivery.map((entry) => entry.livery);
assert.deepEqual(
  [...liveryCodes].sort(),
  ["needle", "nightform", "privateer", "works"],
  "The wear spec must cover exactly the four shipped liveries.",
);
for (const entry of liveryWear.perLivery) {
  assert.ok(
    entry.intensity > 0 && entry.intensity <= liveryWear.intensity,
    `${entry.livery} asks for intensity ${entry.intensity}; the sheet is authored at `
      + `${liveryWear.intensity} and a per-livery scale can only hold it back.`,
  );
}
assert.equal(
  liveryWear.perLivery.filter((entry) => entry.intensity !== liveryWear.intensity).length,
  1,
  "Exactly one livery (nightform) is held back from the authored intensity.",
);

// ---------------------------------------------------------------------------
// Corridor helpers. Both read the same authored tables the courses build from.
// ---------------------------------------------------------------------------

function greenwaterSampleAt(distance) {
  const samples = blockout.centreline.samples;
  const wrapped = ((distance % lapLength) + lapLength) % lapLength;
  let best = samples[0];
  for (const sample of samples) {
    if (sample.d <= wrapped) best = sample;
    else break;
  }
  return best;
}

function greenwaterHalfWidthAt(distance) {
  return greenwaterSampleAt(distance).w / 2;
}

function greenwaterCorridorAt(distance) {
  const sample = greenwaterSampleAt(distance);
  const widest = Math.max(
    resolveApronProfile(blockout.apron, sample.edgeL, sample.sector).widthMetres,
    resolveApronProfile(blockout.apron, sample.edgeR, sample.sector).widthMetres,
  );
  return { halfWidth: sample.w / 2, corridor: sample.w / 2 + widest };
}

function bitterpanCorridorAt(distance) {
  const stations = bitterpanStations.stations;
  let best = stations[0];
  for (const station of stations) {
    if (station.s <= distance) best = station;
    else break;
  }
  const edges = bitterpanProduction.edges;
  let left = edges.default.edgeLeft;
  let right = edges.default.edgeRight;
  for (const span of edges.spans) {
    if (distance >= span.fromDistance && distance <= span.toDistance) {
      left = span.edgeLeft;
      right = span.edgeRight;
    }
  }
  const widest = Math.max(
    resolveApronProfile(bitterpanProduction.apron, left, best.sector).widthMetres,
    resolveApronProfile(bitterpanProduction.apron, right, best.sector).widthMetres,
  );
  return { halfWidth: best.width_m / 2, corridor: best.width_m / 2 + widest };
}

console.log(
  `Art pass PASS: 7 sheets hash-matched to their regions (36/17/16 + 1/18/4/14 `
    + `slots); ${decals.decalCount} opening decals / ${decals.triangles} tris, `
    + `${beyondDeck.length} past halfWidth on the apron profile; signage `
    + `greenwater ${EXPECTED_SIGNAGE.greenwater.boards} boards / `
    + `${EXPECTED_SIGNAGE.greenwater.quads} quads, bitterpan `
    + `${EXPECTED_SIGNAGE.bitterpan.boards} / ${EXPECTED_SIGNAGE.bitterpan.quads}; `
    + `every slot resolves, every board clears the deck by `
    + `${MINIMUM_DECK_CLEARANCE_METRES} m+, ${overheadSeen.size} hang above the `
    + `clear span and ${intrusionsSeen.size} sit inside the run-off at their `
    + `pinned depths. Pass 02: ${crust.decalCount} pan crust decals + `
    + `${dressing.itemCount} set-dressing items = ${MERGED_BITTERPAN_DECALS} on ONE `
    + `merged mesh (${crust.triangles + dressing.triangles} tris, same sheet and `
    + `material both sides); the crust tile is 12 m, linear, mipped, aniso 4; `
    + `${EXPECTED_BACKING_PANELS.total} plaque backings (`
    + `${EXPECTED_BACKING_PANELS.chevron} chevron + ${EXPECTED_BACKING_PANELS.board} `
    + `board) all flush at ${PLAQUE_BAND_BOTTOM_METRES} m and inset `
    + `${plaqueBacking.placement.BACKING_INSET_METRES} m inside a `
    + `${WALL_PLAQUE_INSET_METRES} m plaque; wear overlay in register with the `
    + "livery chip strip at intensity "
    + `${liveryWear.intensity}/100, 4 liveries, ${placements.length} library slots `
    + `APPLIED at ${decalCells.cellCount} measured decal cells `
    + `(${decalCells.quadCount} quads, GLB sha pinned) — P15 shipped these `
    + "resolved-and-not-applied and the history is kept at the assertion.",
);
