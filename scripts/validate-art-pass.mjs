import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolveApronProfile } from "../src/game/apron.js";

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

// ---------------------------------------------------------------------------
// 1 + 2. The sheets, their regions, and that the two agree.
// ---------------------------------------------------------------------------

const EXPECTED_SHEETS = {
  greenwater_runway_1024: { width: 1024, height: 1024, regions: 36 },
  futurisma_signage_1024: { width: 1024, height: 1024, regions: 17 },
  greenwater_motion_b_512: { width: 512, height: 512, regions: 16 },
};

assert.deepEqual(
  Object.keys(atlas).sort(),
  Object.keys(EXPECTED_SHEETS).sort(),
  "ATLAS_REGIONS.json must describe exactly the three art-pass-01 sheets.",
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
  `Art pass PASS: 3 sheets hash-matched to their regions (36/17/16 slots); `
    + `${decals.decalCount} opening decals / ${decals.triangles} tris, `
    + `${beyondDeck.length} past halfWidth on the apron profile; signage `
    + `greenwater ${EXPECTED_SIGNAGE.greenwater.boards} boards / `
    + `${EXPECTED_SIGNAGE.greenwater.quads} quads, bitterpan `
    + `${EXPECTED_SIGNAGE.bitterpan.boards} / ${EXPECTED_SIGNAGE.bitterpan.quads}; `
    + `every slot resolves, every board clears the deck by `
    + `${MINIMUM_DECK_CLEARANCE_METRES} m+, ${overheadSeen.size} hang above the `
    + `clear span and ${intrusionsSeen.size} sit inside the run-off at their `
    + "pinned depths.",
);
