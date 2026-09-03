/**
 * P20.3 — the guard on Bitterpan's mid-ground dressing layer.
 *
 * The layer is 705 instanced props in the 3-120 m band outboard of the deck, and
 * the thing that makes it dangerous is not that it might look wrong. It is that
 * `corridor-sweep.ts` promotes anything at or above 0.85 m within its reach to a
 * DERIVED PHYSICS BOUNDARY: a 2.4 m fence post authored 1 m too far in becomes
 * an invisible wall over open salt pan, `DRIVABLE_LIMITS.json` grows an entry
 * nobody asked for, and — as P16 established the hard way — NOTHING ELSE IN THE
 * REPO CATCHES IT. The soak cannot: clamping every limit to `halfWidth` left
 * five Greenwater lap times bit-identical, because the autopilot never leaves
 * the racing line. So the clearance is asserted here, directly, against the same
 * centreline the runtime samples.
 *
 * What this file asserts:
 *
 *  1. IDEMPOTENCE. The generator is re-run and the committed JSON must be
 *     byte-identical. Same contract as `derive-decal-cells.mjs --check`: a
 *     placement list nobody can reproduce is a placement list nobody can review.
 *  2. CORRIDOR CLEARANCE. Every instance clears `halfWidth + apronWidth` by at
 *     least 1.5 m plus its own footprint radius, measured as a perpendicular
 *     distance against every centreline segment within 120 m — the way
 *     `course.project()` measures it, not the way one station sees it.
 *  3. BOARDS. Nothing within 6 m of a P12 signage board footprint, and nothing
 *     over 2.5 m standing in a board's 80 m approach.
 *  4. DENSITY. A per-station forward-window floor and a rolling 200 m floor, so
 *     "dense on average" cannot pass for "never empty".
 *  5. BUDGET. Families, instances and triangles, with the per-family triangle
 *     counts read out of the RUNTIME geometry builders rather than restated —
 *     a family that grows a segment fails here instead of in a frame capture.
 *  6. PHYSICS INVARIANCE. `map02/DRIVABLE_LIMITS.json` still has exactly the
 *     spans it had, and none of them is set by this layer.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const read = (path) => JSON.parse(readFileSync(new URL(path, root), "utf8"));

const MIDGROUND = read("src/game/data/BITTERPAN_MIDGROUND.json");
const CENTRELINE = read("src/game/data/map02/CENTRELINE_STATIONS.json");
const PRODUCTION = read("src/game/data/map02/BITTERPAN_PRODUCTION.json");
const SIGNAGE = read("src/game/data/FUTURISMA_SIGNAGE_PLACEMENTS.json");
const LIMITS = read("src/game/data/map02/DRIVABLE_LIMITS.json");

const LAP_LENGTH_METRES = 3050;
const CORRIDOR_CLEARANCE_METRES = 1.5;
const BOARD_CLEAR_RADIUS_METRES = 6;
const BOARD_SIGHTLINE_LENGTH_METRES = 80;
const BOARD_SIGHTLINE_HALF_WIDTH_METRES = 13;
const BOARD_SIGHTLINE_MAX_HEIGHT_METRES = 2.5;
const CLEARANCE_SCAN_METRES = 120;

/** Phase budget. Six families is six draw calls. */
const MAX_FAMILIES = 7;
const MAX_INSTANCES = 720;
const MAX_TRIANGLES = 30_000;
const MAX_TRIANGLES_PER_INSTANCE = 120;

/**
 * Density floors.
 *
 * `MIN_FORWARD_WINDOW` is the offline half of the acceptance's "at least a dozen
 * props in frame": everything within 150 m ahead and 90 m either side of the
 * centreline, evaluated from every 5 m of lap rather than only at the 13 review
 * stations, so a station that happens to sit in a gap cannot hide it. The
 * RUNTIME half is `midground.visibleInstances`, which counts what is actually
 * inside the camera frustum and which the phase report quotes per station.
 */
const MIN_FORWARD_WINDOW = 12;
const MIN_PER_200_METRE_RUN = 8;

// ---------------------------------------------------------------------------
// 1. Idempotence.
// ---------------------------------------------------------------------------
execFileSync(
  process.execPath,
  [fileURLToPath(new URL("generate-bitterpan-midground.mjs", import.meta.url)), "--check"],
  { stdio: "pipe" },
);

// ---------------------------------------------------------------------------
// The centreline, rebuilt exactly as `BitterpanCourse.sample` does. Restated
// here rather than imported from the generator on purpose: a validator that
// shares the code under test can only ever confirm the generator agrees with
// itself. This is a second implementation of the same rule from the same
// authored data, so a bug in either one shows up as a disagreement.
// ---------------------------------------------------------------------------
const STATIONS = CENTRELINE.stations;
const N = STATIONS.length;
const SPACING = CENTRELINE.station_spacing_m;

function unit(x, y, z) {
  const length = Math.hypot(x, y, z) || 1;
  return [x / length, y / length, z / length];
}

const POINTS = STATIONS.map((s) => [s.x, s.y, s.z]);
const TANGENTS = POINTS.map((_, i) => {
  const a = POINTS[(i - 1 + N) % N];
  const b = POINTS[(i + 1) % N];
  return unit(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
});
const RIGHTS = TANGENTS.map(([tx, , tz]) => unit(-tz, 0, tx));

const APRON = PRODUCTION.apron.edges;
const EDGES = STATIONS.map((station) => {
  let left = PRODUCTION.edges.default.edgeLeft;
  let right = PRODUCTION.edges.default.edgeRight;
  for (const span of PRODUCTION.edges.spans) {
    if (station.s < span.fromDistance || station.s > span.toDistance) continue;
    left = span.edgeLeft;
    right = span.edgeRight;
  }
  return { left: APRON[left].widthMetres, right: APRON[right].widthMetres };
});

const wrap = (d) => ((d % LAP_LENGTH_METRES) + LAP_LENGTH_METRES) % LAP_LENGTH_METRES;

function sampleAt(distance) {
  const scaled = (wrap(distance) / LAP_LENGTH_METRES) * N;
  const i = Math.floor(scaled) % N;
  const j = (i + 1) % N;
  const t = scaled - Math.floor(scaled);
  const lerp = (a, b) => a + (b - a) * t;
  const tangent = unit(
    lerp(TANGENTS[i][0], TANGENTS[j][0]),
    lerp(TANGENTS[i][1], TANGENTS[j][1]),
    lerp(TANGENTS[i][2], TANGENTS[j][2]),
  );
  return {
    x: lerp(POINTS[i][0], POINTS[j][0]),
    z: lerp(POINTS[i][2], POINTS[j][2]),
    right: unit(-tangent[2], 0, tangent[0]),
    tangent,
    halfWidth: lerp(STATIONS[i].width_m, STATIONS[j].width_m) / 2,
    apronLeft: EDGES[i].left,
    apronRight: EDGES[i].right,
  };
}

function worldAt(distance, lateral) {
  const s = sampleAt(distance);
  return [s.x + s.right[0] * lateral, s.z + s.right[2] * lateral];
}

function corridorClearance(x, z, atDistance) {
  const span = Math.ceil(CLEARANCE_SCAN_METRES / SPACING);
  const centre = Math.round(wrap(atDistance) / SPACING);
  let worst = Infinity;
  for (let step = -span; step <= span; step += 1) {
    const i = (centre + step + N * 2) % N;
    const j = (i + 1) % N;
    const ax = POINTS[i][0];
    const az = POINTS[i][2];
    const dx = POINTS[j][0] - ax;
    const dz = POINTS[j][2] - az;
    const lengthSq = dx * dx + dz * dz;
    const t = lengthSq === 0
      ? 0
      : Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / lengthSq));
    const distance = Math.hypot(x - (ax + dx * t), z - (az + dz * t));
    const side = (x - ax) * RIGHTS[i][0] + (z - az) * RIGHTS[i][2];
    const halfWidth = (STATIONS[i].width_m
      + (STATIONS[j].width_m - STATIONS[i].width_m) * t) / 2;
    worst = Math.min(
      worst,
      distance - (halfWidth + (side < 0 ? EDGES[i].left : EDGES[i].right)),
    );
  }
  return worst;
}

// ---------------------------------------------------------------------------
// Per-family footprint radius and standing height, resolved from the SCALE the
// generator authored rather than from a table restated here. Both feed the
// clearance and sightline assertions; a family whose props grow without their
// records growing fails.
// ---------------------------------------------------------------------------
function footprint(instance) {
  const [sx, sy, sz] = instance.scale;
  switch (instance.family) {
    // A post: 0.14 m square shaft, 0.46 m plate, standing `sy` metres tall.
    case "POST_PLATE":
      return { radius: 0.45, height: sy };
    // A bay of screening: `sx` metres of span, hanging from `lift`.
    case "SCREEN_BAY":
      return { radius: sx / 2, height: instance.lift };
    // A ridge: `sx` long, `sz` across, `sy` high.
    case "WINDROW_RIDGE":
      return { radius: Math.hypot(sx, sz) / 2, height: sy };
    case "CRUST_PLATE":
      return { radius: Math.hypot(sx, sz) / 2, height: 0.4 };
    // A bent: `sx` between the legs, `sy` to the pipe.
    case "PIPE_RUN":
      return { radius: sx / 2 + 0.4, height: sy };
    case "DRUM_CLUSTER":
      return { radius: 1.5 * Math.max(sx, sz), height: 1.1 * sy };
    default:
      throw new Error(`Unknown midground family ${instance.family}.`);
  }
}

/**
 * The world points a clearance rule has to hold at, and the radius to hold them
 * to.
 *
 * A long prop is a SEGMENT, not a disc. Treating a 27.7 m screen bay as a
 * 13.8 m disc about its midpoint is how the first version of this file fired a
 * FALSE failure: it reported a bay 0.44 m from a marshal plate when the bay
 * stands at lateral 31.7 against the plate's 19, i.e. 12.7 m clear, because it
 * had subtracted the bay's whole half-SPAN from a distance measured across it.
 * So the long families are sampled along their own axis — which comes from
 * their own `yawDeg` plus the course tangent, the way the runtime composes the
 * instance matrix — and held to their ACROSS extent.
 */
const LONG_FAMILIES = new Set(["SCREEN_BAY", "WINDROW_RIDGE", "PIPE_RUN"]);

function occupancy(instance) {
  const { radius, height } = footprint(instance);
  const [cx, cz] = worldAt(instance.distance, instance.lateral);
  if (!LONG_FAMILIES.has(instance.family)) {
    return { points: [[cx, cz]], radius, height };
  }
  const s = sampleAt(instance.distance);
  const yaw = Math.atan2(s.tangent[0], s.tangent[2]) + (instance.yawDeg * Math.PI) / 180;
  const half = instance.scale[0] / 2;
  const points = [];
  for (let n = -4; n <= 4; n += 1) {
    const t = (n / 4) * half;
    points.push([cx + Math.sin(yaw) * t, cz + Math.cos(yaw) * t]);
  }
  const across = instance.family === "WINDROW_RIDGE" ? instance.scale[2] / 2
    : instance.family === "PIPE_RUN" ? 0.4
      : 0.3;
  return { points, radius: across, height };
}

// ---------------------------------------------------------------------------
// 2. Corridor clearance — the assertion this file exists for.
// ---------------------------------------------------------------------------
let worstClearance = Infinity;
let worstInstance = null;
for (const instance of MIDGROUND.instances) {
  const { points, radius } = occupancy(instance);
  for (const [x, z] of points) {
    const clearance = corridorClearance(x, z, instance.distance) - radius;
    if (clearance < worstClearance) {
      worstClearance = clearance;
      worstInstance = instance;
    }
  }
}
assert.ok(
  worstClearance >= CORRIDOR_CLEARANCE_METRES,
  `Bitterpan midground: the closest instance (${worstInstance?.family} @`
    + `${worstInstance?.distance} m, lateral ${worstInstance?.lateral}) clears the `
    + `authored run-off lip by ${worstClearance.toFixed(3)} m, under the `
    + `${CORRIDOR_CLEARANCE_METRES} m floor. The craft's lateral clamp reaches `
    + "halfWidth + apronWidth, and corridor-sweep.ts turns anything over 0.85 m "
    + "inside its reach into a DERIVED PHYSICS BOUNDARY — this is how a dressing "
    + "prop becomes an invisible wall over open pan.",
);

// ---------------------------------------------------------------------------
// 3. The P12 boards keep their footprint and their approach.
// ---------------------------------------------------------------------------
function headingAt(distance) {
  const { tangent } = sampleAt(distance);
  return (Math.atan2(tangent[0], tangent[2]) * 180) / Math.PI;
}

const BOARDS = SIGNAGE.bitterpan.placements.map((board) => {
  const heading = (headingAt(board.distance) * Math.PI) / 180;
  const half = board.widthMetres / 2;
  const [cx, cz] = worldAt(board.distance, board.lateral);
  return {
    id: board.id,
    distance: board.distance,
    lateral: board.lateral,
    a: [cx - Math.sin(heading) * half, cz - Math.cos(heading) * half],
    b: [cx + Math.sin(heading) * half, cz + Math.cos(heading) * half],
  };
});

function toSegment(px, pz, [ax, az], [bx, bz]) {
  const dx = bx - ax;
  const dz = bz - az;
  const lengthSq = dx * dx + dz * dz;
  const t = lengthSq === 0
    ? 0
    : Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / lengthSq));
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}

let worstBoardGap = Infinity;
for (const instance of MIDGROUND.instances) {
  const { points, radius, height } = occupancy(instance);
  for (const board of BOARDS) {
    for (const [x, z] of points) {
      const gap = toSegment(x, z, board.a, board.b) - radius;
      worstBoardGap = Math.min(worstBoardGap, gap);
      assert.ok(
        gap >= BOARD_CLEAR_RADIUS_METRES,
        `Bitterpan midground: ${instance.family} @${instance.distance} m stands `
          + `${gap.toFixed(2)} m from board ${board.id}, inside its `
          + `${BOARD_CLEAR_RADIUS_METRES} m clear radius.`,
      );
    }

    if (height <= BOARD_SIGHTLINE_MAX_HEIGHT_METRES) continue;
    let ahead = board.distance - instance.distance;
    if (ahead < -LAP_LENGTH_METRES / 2) ahead += LAP_LENGTH_METRES;
    if (ahead > LAP_LENGTH_METRES / 2) ahead -= LAP_LENGTH_METRES;
    if (ahead < 0 || ahead > BOARD_SIGHTLINE_LENGTH_METRES) continue;
    assert.ok(
      Math.abs(instance.lateral - board.lateral) > BOARD_SIGHTLINE_HALF_WIDTH_METRES,
      `Bitterpan midground: ${instance.family} @${instance.distance} m is `
        + `${height.toFixed(1)} m tall and stands ${ahead.toFixed(0)} m in front of `
        + `board ${board.id} at lateral ${instance.lateral} against the board's `
        + `${board.lateral}. It would be between the chase camera and the board on `
        + "the approach, which is the only place the board reads from.",
    );
  }
}

// ---------------------------------------------------------------------------
// 4. Density: a floor, not an average.
// ---------------------------------------------------------------------------
let worstWindow = { from: 0, count: Infinity };
for (let from = 0; from < LAP_LENGTH_METRES; from += 5) {
  let count = 0;
  for (const instance of MIDGROUND.instances) {
    let ahead = instance.distance - from;
    if (ahead < 0) ahead += LAP_LENGTH_METRES;
    if (ahead < 150 && Math.abs(instance.lateral) <= 90) count += 1;
  }
  if (count < worstWindow.count) worstWindow = { from, count };
}
assert.ok(
  worstWindow.count >= MIN_FORWARD_WINDOW,
  `Bitterpan midground: only ${worstWindow.count} instances lie within 150 m `
    + `ahead of ${worstWindow.from} m and 90 m either side of the centreline, `
    + `under the floor of ${MIN_FORWARD_WINDOW}. That is a frame with nothing in `
    + "the mid-ground, which is the whole condition this phase exists to remove.",
);

let worstRun = { from: 0, count: Infinity };
for (let from = 0; from < LAP_LENGTH_METRES; from += 10) {
  let count = 0;
  for (const instance of MIDGROUND.instances) {
    let ahead = instance.distance - from;
    if (ahead < 0) ahead += LAP_LENGTH_METRES;
    if (ahead < 200) count += 1;
  }
  if (count < worstRun.count) worstRun = { from, count };
}
assert.ok(
  worstRun.count >= MIN_PER_200_METRE_RUN,
  `Bitterpan midground: the emptiest 200 m of lap (from ${worstRun.from} m) holds `
    + `${worstRun.count} instances, under the floor of ${MIN_PER_200_METRE_RUN}.`,
);

// ---------------------------------------------------------------------------
// 5. Budget. Triangle counts are READ OUT OF THE RUNTIME MODULE rather than
// restated: `bitterpan-midground.ts` is the only place that knows how many
// segments a screen bay has, and the point of this assertion is to catch it
// growing one.
// ---------------------------------------------------------------------------
const runtime = readFileSync(new URL("src/game/bitterpan-midground.ts", root), "utf8");
const declaredTriangles = {};
for (const match of runtime.matchAll(/function build(\w+)\(/g)) {
  // Search BACKWARD from the builder to the nearest "N triangles." above it,
  // which is the one in its own doc comment. A forward regex bound
  // `buildPostPlate` to the 12 in the shared `box()` helper's comment.
  const before = runtime.slice(0, match.index);
  const counts = [...before.matchAll(/(\d+) triangles\./g)];
  if (counts.length > 0) {
    declaredTriangles[match[1]] = Number(counts[counts.length - 1][1]);
  }
}

const families = [...new Set(MIDGROUND.instances.map((i) => i.family))];
assert.ok(
  families.length <= MAX_FAMILIES,
  `Bitterpan midground has ${families.length} families; the budget is `
    + `${MAX_FAMILIES}, and each family is one InstancedMesh and one draw call.`,
);
assert.equal(
  MIDGROUND.instances.length,
  MIDGROUND.counts.instances,
  "Bitterpan midground: the declared instance count and the shipped list disagree.",
);
assert.ok(
  MIDGROUND.instances.length <= MAX_INSTANCES,
  `Bitterpan midground ships ${MIDGROUND.instances.length} instances against a `
    + `${MAX_INSTANCES} budget.`,
);

const FAMILY_BUILDERS = {
  POST_PLATE: "PostPlate",
  SCREEN_BAY: "ScreenBay",
  WINDROW_RIDGE: "WindrowRidge",
  CRUST_PLATE: "CrustPlate",
  PIPE_RUN: "PipeRun",
  DRUM_CLUSTER: "DrumCluster",
};
let triangles = 0;
for (const family of families) {
  const builder = FAMILY_BUILDERS[family];
  const perInstance = declaredTriangles[builder];
  assert.ok(
    typeof perInstance === "number",
    `Bitterpan midground: could not read a triangle count for build${builder} out `
      + "of bitterpan-midground.ts. Every family builder documents its own count "
      + "in the form \"N triangles.\" and this validator reads it; a builder that "
      + "stops saying so stops being budgeted.",
  );
  assert.ok(
    perInstance <= MAX_TRIANGLES_PER_INSTANCE,
    `Bitterpan midground family ${family} is ${perInstance} triangles per `
      + `instance, over the ${MAX_TRIANGLES_PER_INSTANCE} ceiling.`,
  );
  triangles += perInstance * MIDGROUND.counts.byFamily[family];
}
assert.ok(
  triangles <= MAX_TRIANGLES,
  `Bitterpan midground is ${triangles} triangles against a ${MAX_TRIANGLES} `
    + "budget. That budget is the phase's own \"<= +30k triangles at every "
    + "station\" acceptance, measured off the renderer.",
);

// ---------------------------------------------------------------------------
// 6. Physics invariance.
//
// The full form of this — re-deriving the table from a fresh corridor sweep with
// the layer in the scene and diffing — needs a browser, so it is a review-time
// step and not a `test:code` step. What CAN be asserted offline is the property
// that a regression would show up as: the table still has exactly the spans it
// had, and none of them names this layer.
// ---------------------------------------------------------------------------
// P21 lowered the derivation's bounding floor from 0.85 m to the measured
// hull-bottom clearance of 0.60 m AND excluded the collidable cable coils from
// it, which removed the two coil-set entries at 2850 m and 2860 m. Those two
// were invisible walls at a hazard the craft is meant to aim past — the exact
// case P16 chose 0.85 m to prevent, which shipped anyway because the coil
// measured 0.85 m tall on that span. What remains is the single BP_SIGNAGE_POSTS
// span at 2990 m. The assertion this file exists for is unchanged: the count is
// still pinned, and none of it may be set by the mid-ground layer.
const PINNED_BITTERPAN_SPANS = 1;
assert.equal(
  LIMITS.entries.length,
  PINNED_BITTERPAN_SPANS,
  `map02/DRIVABLE_LIMITS.json now limits ${LIMITS.entries.length} spans against `
    + `the pinned ${PINNED_BITTERPAN_SPANS}. If the mid-ground layer put one there, `
    + "a dressing prop has become a physics boundary; re-run "
    + "scripts/derive-drivable-limits.mjs from a clean capture and find out what "
    + "set it.",
);
for (const entry of LIMITS.entries) {
  for (const side of ["left", "right"]) {
    const mesh = entry[side]?.setBy;
    if (!mesh) continue;
    assert.ok(
      !/BP_MIDGROUND/i.test(mesh),
      `map02 @${entry.distance} m ${side} is limited by ${mesh}. The mid-ground `
        + "layer is excluded from the corridor sweep by name AND authored outside "
        + "the corridor by 1.5 m; if it is bounding a span, BOTH guarantees have "
        + "broken at once.",
    );
  }
}

console.log(
  `Bitterpan midground PASS: ${MIDGROUND.instances.length} instances across `
    + `${families.length} families (${triangles} triangles) re-generated identical `
    + `from seed ${MIDGROUND.seed}; closest instance clears the run-off lip by `
    + `${worstClearance.toFixed(3)} m (floor ${CORRIDOR_CLEARANCE_METRES}); closest `
    + `approach to a signage board ${worstBoardGap.toFixed(2)} m (floor `
    + `${BOARD_CLEAR_RADIUS_METRES}); emptiest 150 m forward window `
    + `${worstWindow.count} at ${worstWindow.from} m and emptiest 200 m run `
    + `${worstRun.count} at ${worstRun.from} m; map02 drivable limits still `
    + `${LIMITS.entries.length} spans, none set by BP_MIDGROUND.`,
);
