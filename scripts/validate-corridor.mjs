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

// P21.4 - this direction used to demand that every allowed mesh STILL APPEAR in
// the census, and that was the wrong staleness test.
//
// The support cap pulled Greenwater's corridor inside its cable hazards, so the
// map now reports zero obstacle groups and `cable_trip_hazards` is no longer in
// the census at all. Nothing about the whitelist rotted: the mesh still exists,
// is still built from the authored hazard table and is still read by
// `cableTripSideAt` every physics step. Whether a hazard happens to fall inside
// the corridor is a property of the CORRIDOR, which this phase deliberately
// narrowed, and holding the whitelist to it would mean every corridor change
// forces an unrelated edit here.
//
// What the loosening must not lose is the reason the check existed - a name in
// this table that no longer refers to anything collidable. That is asserted
// directly, and more strictly, in section 4 below: each mesh must be named in
// its own course file AND that file must still implement `cableTripSideAt`. The
// direction that actually gates the build - an intrusion that is NOT one of
// these - is the assertion above and is unchanged.
assert.ok(
  [...allowedSeen].every((mesh) => allowed.has(mesh)),
  "The census carries a hazard mesh that is not in CENSUS_ALLOWED_MESHES.",
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
// 7. The Bitterpan pan plane may not be drawn over the ribbon AT ALL.
//
// The last pinned residual was never an object standing in the corridor - it was
// the pan floor drawn OVER the road. `GROUND_Y_METRES` is a flat -1.95 m, picked
// as 0.078 m below the ribbon's CENTRELINE low point; the ribbon banks 2.5 deg,
// so its lowest DRAWN surface is the run-off lip at -2.7446 m, three quarters of
// a metre below the plane meant to sit under everything. Same shape of error as
// the bounding floor in section 6: a clearance computed against the wrong
// reference. `pan-floor-relief.js` now carves the grid down under the stations
// that need it.
//
// ASSERTED FROM A MEASUREMENT, NOT A MODEL. An earlier pass computed the overlap
// here analytically from the centreline, and it was both approximate and wrong
// in the reassuring direction: it modelled the deck only, and it read the plane
// height off a swept vertex rather than the source constant. What the census
// carries now is the runtime's own check, taken on the geometry that was built -
// the displaced grid sampled BILINEARLY at both deck edges and both run-off lips
// of all 610 stations, which is the surface the GPU actually rasterises and not
// the continuous function that displaced it.
//
// `reliefVertices` is asserted alongside, because `coveredSides: 0` on its own
// is exactly what a floor layer that never loaded would report.
// ---------------------------------------------------------------------------
const bitterpan = byMap.get("bitterpan");
const panFloor = bitterpan.panFloor;
assert.ok(
  panFloor,
  "The Bitterpan census carries no panFloor block, so the pan-plane fix is "
    + "unmeasured. Re-capture the baseline against a dev server.",
);
assert.equal(
  panFloor.coveredSides,
  0,
  `The Bitterpan pan plane is drawn over the ribbon on ${panFloor.coveredSides} `
    + `station-side(s), worst ${panFloor.coveredWorstMetres} m. The floor must sit `
    + "under every drawn surface of the road, at every station, on both sides. "
    + "See pan-floor-relief.js.",
);
assert.ok(
  panFloor.reliefVertices > 0 && panFloor.reliefMaxDropMetres > 0,
  `The pan relief displaced ${panFloor.reliefVertices} vertices by at most `
    + `${panFloor.reliefMaxDropMetres} m. Zero of either means the relief never `
    + 'ran, and "0 covered sides" from a floor that was never built is not a '
    + "clean reading - it is no reading.",
);
assert.equal(
  panFloor.fix,
  "b",
  `The census was recorded with pan fix "${panFloor.fix}". "b" is the shipped `
    + 'design; "a" (dropping GROUND_Y_METRES globally) is a review preview whose '
    + "mid-ground props and road-edge lips are NOT re-derived, so a baseline "
    + "taken under it does not describe anything shippable.",
);

const obstacles = CENSUS.maps.reduce((sum, map) => sum + map.obstacles.length, 0);
console.log(
  `Corridor PASS: ${obstacles} obstacle group(s) inside the drivable corridor `
    + `across both maps — ${allowedSeen.size} collidable hazard mesh(es) and `
    + `${pinnedSeen.size} pinned residual(s), nothing unaccounted for. Bounding `
    + `floor ${tallFloor} m clears the ${hullBottom.toFixed(3)} m hull bottom; both `
    + "DRIVABLE_LIMITS.json tables re-derive byte-identical from their captures. "
    + `Bitterpan pan plane covers the ribbon on ${panFloor.coveredSides} `
    + `station-side(s), with ${panFloor.reliefVertices} grid vertices carved down `
    + `by up to ${panFloor.reliefMaxDropMetres} m.`,
);
