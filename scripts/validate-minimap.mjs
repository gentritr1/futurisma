import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  OUTLINE_STATION_COUNT,
  RADAR_LATERAL_RANGE_METERS,
  RADAR_LONGITUDINAL_RANGE_METERS,
  buildCourseOutline,
  fitOutlineTransform,
  projectRivalToRadar,
  radarSeparationMeters,
} from "../src/game/minimap-projection.js";

/**
 * P6 minimap guard. `minimap.ts` owns a canvas, so the drawing itself is not
 * reachable from Node; the geometry that decides *what* gets drawn lives in
 * `minimap-projection.js` and is exercised here against the real Greenwater
 * centreline rather than a synthetic ring.
 */

function readJson(relativePath) {
  return JSON.parse(
    readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8"),
  );
}

const blockout = readJson("src/game/data/greenwater-blockout.json");
const bitterpan = readJson("src/game/data/map02/CENTRELINE_STATIONS.json");

/**
 * Mirrors the shared `sample()` shape of both course classes
 * (`GreenwaterCourse` in src/game/course.ts, `BitterpanCourse` in
 * src/game/bitterpan-course.ts): wrap progress into [0, 1), scale by the
 * station count and lerp between adjacent centreline points. Only
 * `position.x` / `position.z` reach the outline, so the tangent/bank/curvature
 * work the real courses also do is intentionally omitted.
 */
function centrelineCourse(stations, lapLength) {
  return {
    length: lapLength,
    sample(progress) {
      const wrapped = progress - Math.floor(progress);
      const scaled = wrapped * stations.length;
      const index = Math.floor(scaled) % stations.length;
      const nextIndex = (index + 1) % stations.length;
      const alpha = scaled - Math.floor(scaled);
      const current = stations[index];
      const next = stations[nextIndex];
      return {
        position: {
          x: current.x + (next.x - current.x) * alpha,
          z: current.z + (next.z - current.z) * alpha,
        },
      };
    },
  };
}

// P6 must work on both maps: Greenwater is near-square (721 m × 702 m) and
// Bitterpan is tall (563 m × 1188 m), so a regression that assumes one
// aspect ratio or one station count fails here.
const lapLength = blockout.centreline.lapLength;
const maps = [
  {
    name: "greenwater",
    stations: blockout.centreline.samples,
    lapLength,
  },
  {
    name: "bitterpan",
    stations: bitterpan.stations,
    lapLength: bitterpan.total_length_m,
  },
];

const greenwaterCourse = centrelineCourse(maps[0].stations, maps[0].lapLength);
let outline = null;
let closingGapMeters = 0;

for (const map of maps) {
  const course = centrelineCourse(map.stations, map.lapLength);
  const built = buildCourseOutline(course);

  assert.equal(
    built.stationCount,
    OUTLINE_STATION_COUNT,
    `${map.name}: the cached outline must sample 128 stations.`,
  );
  assert.equal(
    built.points.length,
    OUTLINE_STATION_COUNT * 2,
    `${map.name}: the outline ring must hold one XZ pair per station.`,
  );

  // Bounding box computed independently from the full centreline, so this is a
  // real containment check rather than a tautology against the outline's own
  // extent.
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const station of map.stations) {
    if (station.x < minX) minX = station.x;
    if (station.x > maxX) maxX = station.x;
    if (station.z < minZ) minZ = station.z;
    if (station.z > maxZ) maxZ = station.z;
  }
  const EPSILON_METERS = 1e-6;
  for (let index = 0; index < built.stationCount; index += 1) {
    const x = built.points[index * 2];
    const z = built.points[index * 2 + 1];
    assert.ok(
      Number.isFinite(x) && Number.isFinite(z),
      `${map.name}: outline station ${index} is not finite.`,
    );
    assert.ok(
      x >= minX - EPSILON_METERS && x <= maxX + EPSILON_METERS,
      `${map.name}: outline station ${index} X=${x} escapes the course `
        + `bounding box [${minX}, ${maxX}].`,
    );
    assert.ok(
      z >= minZ - EPSILON_METERS && z <= maxZ + EPSILON_METERS,
      `${map.name}: outline station ${index} Z=${z} escapes the course `
        + `bounding box [${minZ}, ${maxZ}].`,
    );
    assert.ok(
      x >= built.bounds.minX && x <= built.bounds.maxX
        && z >= built.bounds.minZ && z <= built.bounds.maxZ,
      `${map.name}: outline station ${index} falls outside the bounds it `
        + "reported; the canvas fit transform trusts those bounds.",
    );
  }

  // Closed loop: the last station sits on progress 1.0, which both course
  // implementations wrap onto progress 0. Drawn as a polyline, an open ring
  // would leave a visible gap across the start/finish line.
  const gapMeters = Math.hypot(
    built.points[(built.stationCount - 1) * 2] - built.points[0],
    built.points[(built.stationCount - 1) * 2 + 1] - built.points[1],
  );
  assert.ok(
    gapMeters <= 1,
    `${map.name}: the outline ring is open — first and last stations are `
      + `${gapMeters} m apart, budget is 1 m.`,
  );

  // Uniform spacing, so the ring cannot contain a jump between neighbouring
  // stations — a duplicated/degenerate run of points, or a course whose
  // sample() misbehaves mid-lap, would show up here rather than as a subtly
  // wrong shape on the canvas.
  let maxSegmentMeters = 0;
  for (let index = 0; index < built.stationCount - 1; index += 1) {
    maxSegmentMeters = Math.max(
      maxSegmentMeters,
      Math.hypot(
        built.points[(index + 1) * 2] - built.points[index * 2],
        built.points[(index + 1) * 2 + 1] - built.points[index * 2 + 1],
      ),
    );
  }
  const expectedSpacing = map.lapLength / (OUTLINE_STATION_COUNT - 1);
  assert.ok(
    maxSegmentMeters <= expectedSpacing * 1.25,
    `${map.name}: outline segments reach ${maxSegmentMeters} m against an `
      + `expected spacing of ${expectedSpacing} m — the ring has a jump.`,
  );

  if (map.name === "greenwater") {
    outline = built;
    closingGapMeters = gapMeters;
  }
}

assert.throws(
  () => buildCourseOutline(greenwaterCourse, 3),
  /at least 4/,
  "A degenerate station count must be rejected, not silently drawn.",
);

// --- Fit transform -------------------------------------------------------

const PANEL_WIDTH = 120;
const PANEL_HEIGHT = 74;
const PANEL_PADDING = 9;
const transform = fitOutlineTransform(
  outline.bounds,
  PANEL_WIDTH,
  PANEL_HEIGHT,
  PANEL_PADDING,
);
for (let index = 0; index < outline.stationCount; index += 1) {
  const x = outline.points[index * 2] * transform.scale + transform.offsetX;
  const y = outline.points[index * 2 + 1] * transform.scale + transform.offsetY;
  assert.ok(
    x >= PANEL_PADDING - 1e-6 && x <= PANEL_WIDTH - PANEL_PADDING + 1e-6,
    `Fitted station ${index} X=${x} spills outside the padded panel.`,
  );
  assert.ok(
    y >= PANEL_PADDING - 1e-6 && y <= PANEL_HEIGHT - PANEL_PADDING + 1e-6,
    `Fitted station ${index} Y=${y} spills outside the padded panel.`,
  );
}

// --- Radar projection ----------------------------------------------------

// Inside the box.
const ahead = projectRivalToRadar(40, 0);
assert.ok(ahead, "A rival 40 m ahead on the centreline must be on the radar.");
assert.equal(ahead.x, 0.5, "Zero lateral offset must sit on the centre lane.");
assert.equal(ahead.y, 0.25, "40 m ahead of 80 m range must sit a quarter down.");

const behind = projectRivalToRadar(-40, 0);
assert.ok(behind);
assert.equal(behind.y, 0.75, "Ahead must be up: 40 m behind sits three-quarters down.");

const left = projectRivalToRadar(0, -RADAR_LATERAL_RANGE_METERS);
assert.ok(left);
assert.equal(left.x, 0, "The far-left lane edge must map to x = 0.");
const right = projectRivalToRadar(0, RADAR_LATERAL_RANGE_METERS);
assert.ok(right);
assert.equal(right.x, 1, "The far-right lane edge must map to x = 1.");

const player = projectRivalToRadar(0, 0);
assert.ok(player);
assert.deepEqual(
  player,
  { x: 0.5, y: 0.5 },
  "A co-located rival must land dead centre.",
);

// Boundaries are inclusive, one step beyond is null.
assert.ok(
  projectRivalToRadar(RADAR_LONGITUDINAL_RANGE_METERS, 0),
  "Exactly 80 m ahead is still in range.",
);
assert.ok(
  projectRivalToRadar(-RADAR_LONGITUDINAL_RANGE_METERS, 0),
  "Exactly 80 m behind is still in range.",
);
assert.equal(
  projectRivalToRadar(RADAR_LONGITUDINAL_RANGE_METERS + 0.001, 0),
  null,
  "Beyond 80 m longitudinal must drop off the radar, not clamp to the rim.",
);
assert.equal(
  projectRivalToRadar(-RADAR_LONGITUDINAL_RANGE_METERS - 0.001, 0),
  null,
);
assert.equal(
  projectRivalToRadar(0, RADAR_LATERAL_RANGE_METERS + 0.001),
  null,
  "Beyond 20 m lateral must drop off the radar.",
);
assert.equal(projectRivalToRadar(0, -RADAR_LATERAL_RANGE_METERS - 0.001), null);

// A lapped rival is a full lap away in race distance and must not wrap onto
// the player's tail.
assert.equal(
  projectRivalToRadar(lapLength, 0),
  null,
  "A rival exactly one lap ahead must not appear as a co-located contact.",
);

// Non-finite inputs are rejected rather than drawn at NaN.
for (const bad of [Number.NaN, Infinity, -Infinity]) {
  assert.equal(projectRivalToRadar(bad, 0), null, `Longitudinal ${bad} must be null.`);
  assert.equal(projectRivalToRadar(0, bad), null, `Lateral ${bad} must be null.`);
}

// Everything in range must be clamped into the unit square.
for (let longitudinal = -80; longitudinal <= 80; longitudinal += 0.5) {
  for (let lateral = -20; lateral <= 20; lateral += 0.5) {
    const placed = projectRivalToRadar(longitudinal, lateral);
    assert.ok(
      placed,
      `(${longitudinal}, ${lateral}) is inside the radar box but returned null.`,
    );
    assert.ok(
      placed.x >= 0 && placed.x <= 1 && placed.y >= 0 && placed.y <= 1,
      `(${longitudinal}, ${lateral}) projected outside [0, 1]: `
        + `${placed.x}, ${placed.y}.`,
    );
  }
}

// Separation feeds the 25 m alert threshold.
assert.equal(radarSeparationMeters(3, 4), 5);
assert.equal(radarSeparationMeters(Number.NaN, 0), Infinity);

// --- Determinism ---------------------------------------------------------

// The outline is cached once as a Path2D, so a second build must be
// bit-identical or the cache would depend on when it was taken.
const rebuilt = buildCourseOutline(greenwaterCourse);
assert.deepEqual(
  Array.from(rebuilt.points),
  Array.from(outline.points),
  "buildCourseOutline is not deterministic across runs.",
);
assert.deepEqual(
  rebuilt.bounds,
  outline.bounds,
  "buildCourseOutline reported different bounds for identical input.",
);
for (let longitudinal = -80; longitudinal <= 80; longitudinal += 7) {
  for (let lateral = -20; lateral <= 20; lateral += 3) {
    assert.deepEqual(
      projectRivalToRadar(longitudinal, lateral),
      projectRivalToRadar(longitudinal, lateral),
      `projectRivalToRadar(${longitudinal}, ${lateral}) is not deterministic.`,
    );
  }
}

console.log(
  `Minimap PASS: ${outline.stationCount} outline stations inside the bounding `
    + `box on both maps, rings closed (Greenwater ${closingGapMeters.toFixed(3)} m), `
    + "radar projection clamped/nulled at ±80 m × ±20 m, pure functions "
    + "deterministic.",
);
