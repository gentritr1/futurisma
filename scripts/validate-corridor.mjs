/**
 * P21 — the gate on solid geometry inside the DRIVABLE corridor.
 *
 * THE RULE IT HOLDS. "Check that we don't have obstacles in the road even though
 * they don't block and we can go inside them — it makes it bad." The corridor is
 * not the deck: it is `apron.lateralLimit`, the clamp `game.ts` holds the craft
 * to, which is the deck plus the authored run-off (5 m of Greenwater gravel,
 * 2.1 m of works stand, 5.8 m of Bitterpan pan) trimmed wherever
 * `DRIVABLE_LIMITS.json` measured the art standing closer. Nothing in the run-off
 * has collision, so a solid object standing in it is one the player drives
 * straight through.
 *
 * WHY IT VALIDATES A COMMITTED BASELINE RATHER THAN RE-MEASURING. The census
 * reads the RENDERED scene, which needs a browser, and `test:code` has no
 * headless-browser dependency and no dev server — the same reason
 * `derive-drivable-limits.mjs` is a generation script and not runtime code. So
 * this splits the same way: `scripts/corridor-census.mjs --base <url>
 * --write-baseline scripts/data/CORRIDOR_CENSUS.json` takes the measurement, and
 * everything below is hermetic. The baseline carries the instrument's own
 * counters, and they are asserted first: a census recorded from a sweep that
 * never ran is all zeroes, and "not measured" must never read as "clean".
 *
 * WHAT IT ASSERTS
 *
 *  1. The baseline is a real measurement of the right corridor — `ran`, the
 *     drivable gate, non-zero meshes and vertices, on both maps.
 *  2. Every obstacle in it is either a COLLIDABLE HAZARD (the one allowed class)
 *     or a PINNED RESIDUAL. Anything else fails the build.
 *  3. Both tables are complete in both directions: an allowed mesh that no
 *     longer appears, or a pinned residual that no longer intrudes, is a stale
 *     exemption and fails. Stale exemptions are how a rule quietly stops binding.
 *  4. The allowed class is exactly the collidable-hazard set `corridor-sweep.ts`
 *     excludes from the limit derivation, and both of its meshes are really
 *     wired to `cableTripSideAt` in their own course. A whitelist that names a
 *     mesh nothing collides with is a whitelist that hides an obstacle.
 *  5. `DRIVABLE_LIMITS.json` is REPRODUCIBLE: re-deriving it from the committed
 *     span captures reproduces both tables byte-for-byte. A physics table nobody
 *     can regenerate from its own inputs cannot be reviewed at all — P16 learned
 *     that when a re-derivation collapsed Greenwater from 232 bounded spans to 3.
 *  6. The derivation's bounding floor is still above the craft's measured hull
 *     bottom. This is the assertion that would have caught the original error:
 *     0.85 m was chosen against the model ORIGIN, while the stabiliser ring hangs
 *     0.892 m below it, so the number was 0.29 m higher than anything the craft
 *     can actually fly over. The hover constants are read out of the two course
 *     files rather than restated, so raising the hover fails here and forces a
 *     re-derivation instead of silently re-opening the gap.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  CENSUS_ALLOWED_MESHES,
  CENSUS_PINNED_RESIDUALS,
  censusKey,
} from "./corridor-census.mjs";

const root = new URL("../", import.meta.url);
const readText = (path) => readFileSync(new URL(path, root), "utf8");
const readJson = (path) => JSON.parse(readText(path));

const CENSUS = readJson("scripts/data/CORRIDOR_CENSUS.json");
const SWEEP_SOURCE = readText("src/game/corridor-sweep.ts");
const GREENWATER_COURSE = readText("src/game/course.ts");
const BITTERPAN_COURSE = readText("src/game/bitterpan-course.ts");

// ---------------------------------------------------------------------------
// 1. The baseline is a measurement, of the right corridor.
// ---------------------------------------------------------------------------
assert.equal(CENSUS.maps.length, 2, "The census must cover both maps.");
const byMap = new Map(CENSUS.maps.map((entry) => [entry.map, entry]));
for (const map of ["greenwater", "bitterpan"]) {
  const census = byMap.get(map);
  assert.ok(census, `The census baseline has no ${map} block.`);
  assert.equal(
    census.ran,
    true,
    `${map}: the census was recorded from a sweep that never ran, so every zero `
      + 'in it means "not measured" and not "clean". Re-capture with '
      + "scripts/corridor-census.mjs --base <url> --write-baseline.",
  );
  assert.equal(
    census.gate,
    "drivable",
    `${map}: the census was recorded against the "${census.gate}" gate. The deck `
      + "gate is P16's question (nothing on the racing surface) and it is already "
      + "zero; P21 is about the run-off, which only the drivable gate reaches.",
  );
  assert.ok(
    census.meshesSwept > 0 && census.verticesSwept > 0,
    `${map}: the census swept ${census.meshesSwept} meshes and `
      + `${census.verticesSwept} vertices. An empty sweep reports an empty census.`,
  );
}

// ---------------------------------------------------------------------------
// 2 & 3. Every obstacle is allowed or pinned, and both tables are complete.
// ---------------------------------------------------------------------------
const allowed = new Set(CENSUS_ALLOWED_MESHES);
const pinned = new Set(Object.keys(CENSUS_PINNED_RESIDUALS));
const allowedSeen = new Set();
const pinnedSeen = new Set();

for (const census of CENSUS.maps) {
  for (const entry of census.obstacles) {
    if (allowed.has(entry.mesh)) {
      allowedSeen.add(entry.mesh);
      continue;
    }
    const key = censusKey(entry);
    assert.ok(
      pinned.has(key),
      `${census.map} @${entry.distance} m: ${key} stands ${entry.depth} m inside `
        + `the ${entry.limit} m drivable limit at lateral ${entry.lateral}, `
        + `${entry.heightMin}-${entry.heightMax} m above the deck. It is solid, it `
        + "is in the road, and nothing gives it collision, so the player drives "
        + "through it. Move it outside the limit, drop it below "
        + "FLAT_FURNITURE_MAX_HEIGHT_METRES, raise it into the plaque band, or — "
        + "if it genuinely cannot move — add it to CENSUS_PINNED_RESIDUALS with a "
        + "measured reason. A silent new intrusion is what this gate exists to stop.",
    );
    pinnedSeen.add(key);
  }
}

assert.deepEqual(
  [...allowedSeen].sort(),
  [...allowed].sort(),
  "CENSUS_ALLOWED_MESHES names a collidable hazard that no longer appears in the "
    + "census. Either the hazard moved out of the corridor — in which case delete "
    + "its entry — or the sweep stopped seeing it, which is worse.",
);
assert.deepEqual(
  [...pinnedSeen].sort(),
  [...pinned].sort(),
  "CENSUS_PINNED_RESIDUALS names an intrusion that is no longer in the census. "
    + "Delete the row: a residual nobody can still measure is a debt nobody can "
    + "still pay.",
);

// ---------------------------------------------------------------------------
// 4. The allowed class really is collidable.
// ---------------------------------------------------------------------------
const hazardBlock = SWEEP_SOURCE.match(
  /COLLIDABLE_HAZARD_MESHES: ReadonlySet<string> = new Set\(\[([\s\S]*?)\]\);/,
);
assert.ok(hazardBlock, "corridor-sweep.ts no longer declares COLLIDABLE_HAZARD_MESHES.");
const declaredHazards = [...hazardBlock[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
assert.deepEqual(
  declaredHazards.slice().sort(),
  [...allowed].sort(),
  "The census's allowed class and the meshes corridor-sweep.ts excludes from the "
    + "limit derivation have drifted apart. They are one decision — a hazard has "
    + "its own physics, so it may stand in the corridor AND must never become a "
    + "derived wall — and two copies of it is how the DECK_HAZARDS whitelist rotted.",
);
for (const [mesh, source, file] of [
  ["map02_cable_coils", BITTERPAN_COURSE, "bitterpan-course.ts"],
  ["cable_trip_hazards", GREENWATER_COURSE, "course.ts"],
]) {
  assert.ok(
    source.includes(`"${mesh}"`),
    `${file} no longer names ${mesh}, so the census is exempting a mesh that map `
      + "does not build.",
  );
  assert.ok(
    /cableTripSideAt\s*\(/.test(source),
    `${file} no longer implements cableTripSideAt, so ${mesh} is no longer `
      + "collidable and has no business standing in the drivable corridor.",
  );
}

// ---------------------------------------------------------------------------
// 5. The limit tables are reproducible from their committed inputs.
// ---------------------------------------------------------------------------
const LIMIT_FILES = [
  "src/game/data/DRIVABLE_LIMITS.json",
  "src/game/data/map02/DRIVABLE_LIMITS.json",
];
const before = LIMIT_FILES.map((path) => readText(path));
execFileSync(
  process.execPath,
  [
    fileURLToPath(new URL("derive-drivable-limits.mjs", import.meta.url)),
    "--greenwater", fileURLToPath(new URL("data/CORRIDOR_SPANS_GREENWATER.json", import.meta.url)),
    "--bitterpan", fileURLToPath(new URL("data/CORRIDOR_SPANS_BITTERPAN.json", import.meta.url)),
  ],
  { stdio: "pipe" },
);
LIMIT_FILES.forEach((path, index) => {
  assert.equal(
    readText(path),
    before[index],
    `${path} is not what scripts/derive-drivable-limits.mjs produces from `
      + "scripts/data/CORRIDOR_SPANS_*.json. Either the table was hand-edited or "
      + "the capture is stale; re-capture and re-derive rather than reconciling "
      + "the two by hand.",
  );
});

// ---------------------------------------------------------------------------
// 6. The bounding floor still clears the craft's hull, not its origin.
// ---------------------------------------------------------------------------
const number = (source, pattern, what) => {
  const match = source.match(pattern);
  assert.ok(match, `Could not read ${what}; the corridor gate cannot check itself.`);
  return Number(match[1]);
};
const ringDrop = number(
  GREENWATER_COURSE,
  /stabiliser ring bottoms out ([\d.]+) m below/,
  "the TOTEM stabiliser ring drop",
);
const greenwaterBoost = number(
  GREENWATER_COURSE,
  /const dynamicHeight = boostActive \? ([\d.]+)/,
  "the Greenwater boost hover",
);
const greenwaterBase = number(
  GREENWATER_COURSE,
  /return dynamicHeight \+ ([\d.]+);/,
  "the Greenwater hover base",
);
const bitterpanBoost = number(
  BITTERPAN_COURSE,
  /return boostActive \? ([\d.]+)/,
  "the Bitterpan boost hover",
);
const tallFloor = number(
  SWEEP_SOURCE,
  /export const TALL_GEOMETRY_MIN_HEIGHT_METRES = ([\d.]+);/,
  "TALL_GEOMETRY_MIN_HEIGHT_METRES",
);
// The craft's LOWEST geometry at its HIGHEST hover: the tallest thing it can
// ever pass over. Everything above this is driven into, on one map or both.
const hullBottom = Math.max(
  greenwaterBoost + greenwaterBase - ringDrop,
  bitterpanBoost - ringDrop,
);
assert.ok(
  tallFloor > hullBottom,
  `TALL_GEOMETRY_MIN_HEIGHT_METRES is ${tallFloor} m but the craft's hull bottom `
    + `reaches ${hullBottom.toFixed(3)} m above the deck at boost, so geometry `
    + "between them bounds nothing and is driven through. This is the original "
    + "P21 defect: the floor was set against the model ORIGIN while the "
    + `stabiliser ring hangs ${ringDrop} m below it.`,
);
assert.ok(
  tallFloor <= hullBottom + 0.1,
  `TALL_GEOMETRY_MIN_HEIGHT_METRES is ${tallFloor} m against a `
    + `${hullBottom.toFixed(3)} m hull bottom — ${(tallFloor - hullBottom).toFixed(3)} m `
    + "of slack. Every centimetre of that is geometry the craft drives through "
    + "without the corridor narrowing for it; keep the floor just above the "
    + "measurement, and re-derive when the hover changes.",
);

// ---------------------------------------------------------------------------
// 7. The Bitterpan pan plane may not swallow any more of the ribbon than it
//    already does.
//
// The one pinned residual is not an object standing in the corridor — it is the
// pan floor drawn OVER the road. `GROUND_Y_METRES` is flat at -1.95 m, picked as
// 0.078 m below the ribbon's CENTRELINE low point; the ribbon banks 2.5 deg, so
// its lowest DRAWN surface is the run-off lip at -2.7446 m, a quarter of a metre
// below the plane meant to sit under everything. Same shape of error as the
// bounding floor in section 6: a clearance computed against the wrong reference.
//
// Fixing it means moving `GROUND_Y_METRES`, which also anchors the mid-ground
// layer and the road-edge band's lip threshold, so it is a map-wide art decision
// and is deliberately not taken here. What IS taken here is the guarantee that
// the defect cannot grow while it waits: the overlap is re-derived from the
// authored centreline every run and compared with what was measured. Widen the
// deck, deepen the bank or raise the plane, and this fails.
// ---------------------------------------------------------------------------
const CENTRELINE = readJson("src/game/data/map02/CENTRELINE_STATIONS.json");
const SURFACE_SOURCE = readText("src/game/bitterpan-surface.ts");
const groundY = number(
  SURFACE_SOURCE,
  /export const GROUND_Y_METRES = (-?[\d.]+);/,
  "GROUND_Y_METRES",
);
/** Widest authored Bitterpan run-off (edge C, open pan), metres. */
const BITTERPAN_WIDEST_APRON_METRES = 5.8;
let deckSidesCovered = 0;
let worstDeckCoverMetres = 0;
let lowestDrawnRibbonY = Infinity;
for (const station of CENTRELINE.stations) {
  const halfWidth = station.width_m / 2;
  const sinBank = Math.sin(Math.abs(station.bank_deg) * (Math.PI / 180));
  lowestDrawnRibbonY = Math.min(
    lowestDrawnRibbonY,
    station.y - (halfWidth + BITTERPAN_WIDEST_APRON_METRES) * sinBank,
  );
  if (sinBank <= 0) continue;
  // The lateral at which the banked deck plane drops through the pan plane.
  const crossing = (groundY - station.y) / -sinBank;
  const covered = halfWidth - Math.abs(crossing);
  if (station.y - halfWidth * sinBank < groundY && covered > 0) {
    deckSidesCovered += 1;
    worstDeckCoverMetres = Math.max(worstDeckCoverMetres, covered);
  }
}
// Computed by this block from the authored centreline and the GROUND_Y_METRES
// literal in bitterpan-surface.ts — not transcribed from a scratch estimate. An
// earlier pass pinned 12.26 m from a pan height inferred off a single swept
// vertex (-1.9569 m); against the real -1.95 m the coverage is 12.42 m. The
// crossing sits at 1/sin(2.5 deg) = 22.9 m of lateral per metre of height, so
// 7 mm of error in the plane height moves the answer 16 cm. Read the constant.
const MEASURED_DECK_SIDES_COVERED = 53;
const MEASURED_WORST_DECK_COVER_METRES = 12.42;
assert.ok(
  deckSidesCovered <= MEASURED_DECK_SIDES_COVERED,
  `The Bitterpan pan plane is now drawn over part of the racing surface on `
    + `${deckSidesCovered} station-sides, up from the measured `
    + `${MEASURED_DECK_SIDES_COVERED}. GROUND_Y_METRES is ${groundY} m and the `
    + `lowest drawn ribbon surface is ${lowestDrawnRibbonY.toFixed(4)} m.`,
);
assert.ok(
  worstDeckCoverMetres <= MEASURED_WORST_DECK_COVER_METRES + 0.01,
  `The worst pan-over-deck coverage is now ${worstDeckCoverMetres.toFixed(2)} m, `
    + `up from the measured ${MEASURED_WORST_DECK_COVER_METRES} m.`,
);
// And the fix, when it is taken, is this number.
const requiredGroundY = lowestDrawnRibbonY - 0.078;

const obstacles = CENSUS.maps.reduce((sum, map) => sum + map.obstacles.length, 0);
console.log(
  `Corridor PASS: ${obstacles} obstacle group(s) inside the drivable corridor `
    + `across both maps — ${allowedSeen.size} collidable hazard mesh(es) and `
    + `${pinnedSeen.size} pinned residual(s), nothing unaccounted for. Bounding `
    + `floor ${tallFloor} m clears the ${hullBottom.toFixed(3)} m hull bottom; both `
    + "DRIVABLE_LIMITS.json tables re-derive byte-identical from their captures. "
    + `Bitterpan pan plane at ${groundY} m still covers deck on ${deckSidesCovered} `
    + `station-side(s), worst ${worstDeckCoverMetres.toFixed(2)} m (no worse than `
    + `measured); clearing the ${lowestDrawnRibbonY.toFixed(3)} m run-off lip would `
    + `need ${requiredGroundY.toFixed(3)} m.`,
);
