/**
 * P20.3 — authors Bitterpan's mid-ground dressing layer.
 *
 * WHY THIS EXISTS. Bitterpan is a 3,050 m lap over a flat salt pan with 226
 * authored structures, and from the chase camera at 300 km/h the 0-120 m band
 * outboard of the deck is EMPTY: the frame is road, flat tan plane, flat tan
 * sky. Greenwater reads full in the same band because it has kerbs, fences,
 * lamp posts and vegetation cards there. This script builds Bitterpan's
 * equivalent — the furniture of a working salt harvest — as authored data.
 *
 * WHY IT IS A GENERATION SCRIPT AND NOT RUNTIME CODE. Two reasons, and the
 * second is the load-bearing one.
 *
 *  1. Determinism. A runtime scatter reseeded per session is a layer nobody can
 *     review, screenshot or diff. This emits a committed placement list; the
 *     validator re-runs the script and asserts the JSON is byte-identical,
 *     which is how the repo already pins derived data
 *     (`scripts/derive-decal-cells.mjs --check`).
 *  2. Physics safety. `corridor-sweep.ts` turns anything >= 0.85 m standing
 *     within its sweep range into a DERIVED PHYSICS BOUNDARY. A prop that lands
 *     inside that range narrows the drivable corridor and creates an invisible
 *     wall — the exact bug P16 exists to kill. The clearance rule therefore has
 *     to be enforced where it can be asserted offline, against the same
 *     centreline the runtime samples, rather than trusted to a scatter that
 *     runs after load.
 *
 * THE CLEARANCE RULE, in one line:
 *
 *   perpendicular distance to the centreline >= halfWidth + apronWidth + 1.5 m
 *   + the instance's own footprint radius, against EVERY centreline segment
 *   within 120 m and not only the one it is authored against.
 *
 * The "every segment within 120 m" is not belt-and-braces. Bitterpan's lap
 * doubles back on itself, so a prop 20 m outboard of the segment it was
 * authored at can sit in the run-off of a segment 90 m further round the lap.
 * Measuring against one station is how the first P16 derivation ended up
 * attributing the road to itself.
 *
 * It is measured as a PERPENDICULAR distance to the centreline polyline rather
 * than as a lateral seen along one station's `right` axis, because that is what
 * `course.project()` — and therefore `corridor-sweep.ts` — actually computes.
 *
 * The prop layer is ALSO excluded from the sweep by name (`BP_MIDGROUND`, in
 * `CORRIDOR_SWEEP_EXCLUDED_NAMES`). Two independent guarantees, because either
 * one alone is a single point of failure: the exclusion could be dropped by a
 * rename, and the clearance could be broken by a re-generation.
 *
 * WHERE THE PROPS SIT. On the pan floor, world Y = -1.95 m
 * (`GROUND_Y_METRES` in `bitterpan-surface.ts`), NOT on the extrapolated deck
 * plane. The ribbon rides between -1.872 m and +1.872 m, so the deck stands
 * 0.08-3.82 m above the pan; the drawn ground outside the apron is the flat pan
 * plane, and a prop that followed the deck would float over it by up to 3.8 m.
 * Every instance here is outboard of the apron by construction, so the apron
 * cross-section never applies to one — see the note on `lift` below.
 *
 * THE FICTION. Bitterpan is a salt harvest worked in a wind from 292 deg
 * (WNW). That wind is the reason the windrows run where they run: a wind-banked
 * ridge lies ACROSS the wind, so every `WINDROW_RIDGE` is yawed to a world
 * heading of 022 deg regardless of where the road is pointing. Everything else
 * — post-and-cable runs, pipe trestles, drum clusters, lifted crust plates — is
 * site infrastructure and follows the road or the works it belongs to.
 *
 * USAGE
 *   node scripts/generate-bitterpan-midground.mjs           # write the JSON
 *   node scripts/generate-bitterpan-midground.mjs --check   # fail if it differs
 */
import { readFileSync, writeFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const read = (path) => JSON.parse(readFileSync(new URL(path, root), "utf8"));

const OUT_PATH = "src/game/data/BITTERPAN_MIDGROUND.json";

const CENTRELINE = read("src/game/data/map02/CENTRELINE_STATIONS.json");
const PRODUCTION = read("src/game/data/map02/BITTERPAN_PRODUCTION.json");
const SIGNAGE = read("src/game/data/FUTURISMA_SIGNAGE_PLACEMENTS.json");
const MASSING = read("public/data/map02/MASSING_PLACEMENTS.json");

/** Matches `COURSE_LENGTH_METRES` in bitterpan-course.ts. */
const LAP_LENGTH_METRES = 3050;
/** Matches `GROUND_Y_METRES` in bitterpan-surface.ts. */
const GROUND_Y_METRES = -1.95;

/**
 * Clearance from the outer lip of the authored run-off, metres.
 *
 * The brief's floor. `resolveApron` sets the craft's lateral clamp to
 * `halfWidth + apronWidth`, so this is 1.5 m of air between the furthest point
 * the craft can legally reach and the nearest vertex of the nearest prop.
 */
const CORRIDOR_CLEARANCE_METRES = 1.5;

/** Clear radius kept around every P12 signage board footprint. */
const BOARD_CLEAR_RADIUS_METRES = 6;

/**
 * The board sightline corridor: how far upstream of a board, and how wide, no
 * prop taller than `BOARD_SIGHTLINE_MAX_HEIGHT_METRES` may stand.
 *
 * A 6 m radius stops a prop touching a board. It does NOT stop a 5 m pipe
 * trestle 50 m before the board on the same lateral from standing in front of
 * it. The boards read from the chase camera on approach, so the thing to
 * protect is the approach, not the footprint.
 */
const BOARD_SIGHTLINE_LENGTH_METRES = 80;
const BOARD_SIGHTLINE_HALF_WIDTH_METRES = 13;
const BOARD_SIGHTLINE_MAX_HEIGHT_METRES = 2.5;

/** Clear gap kept between a prop and any authored massing footprint. */
const MASSING_CLEAR_METRES = 3;

/** How far each side of a prop's own station the clearance rule is re-checked. */
const CLEARANCE_SCAN_METRES = 120;

/**
 * Site wind, degrees, blowing FROM this bearing. Stated in the Bitterpan map
 * concept and already the reason the authored `WIND_salt_drift` family exists.
 */
const WIND_FROM_DEG = 292;
/** A wind-banked ridge lies across the wind. */
const WINDROW_WORLD_HEADING_DEG = (WIND_FROM_DEG + 90) % 360;

const SEED = 0x20300003;

// ---------------------------------------------------------------------------
// Deterministic RNG. mulberry32 — 32 bits of state, identical in every Node.
// ---------------------------------------------------------------------------
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rng = mulberry32(SEED);
const rand = (lo, hi) => lo + (hi - lo) * rng();
const pick = (list) => list[Math.min(list.length - 1, Math.floor(rng() * list.length))];
const round = (value, places = 3) => Number(value.toFixed(places));

// ---------------------------------------------------------------------------
// The centreline model, reproduced EXACTLY as `BitterpanCourse.sample` builds
// it. Anything else here is a second opinion about where the road is, and the
// clearance rule would then be measured against a road the runtime does not
// have.
//
//   points[i]   = (x, y, z) straight off the station table
//   tangent[i]  = normalize(points[i+1] - points[i-1])
//   sample(d)   : index = floor(d / 5), alpha = frac
//                 position = lerp(points), tangent = normalize(lerp(tangents))
//                 right    = normalize(cross(tangent, WORLD_UP))
//                 halfWidth= lerp(width_m) / 2
//                 apron    = per-station, discrete, never lerped
//
// `right` is `cross(tangent, up)`, which for tangent +Z is -X: the RUNTIME
// lateral sign is the opposite of the station table's `normal`, and of
// MASSING_PLACEMENTS' `lateral_offset_m`. Everything below is in the runtime's
// convention, because that is the one the runtime places instances in and the
// one `DRIVABLE_LIMITS.json` is measured in.
// ---------------------------------------------------------------------------
const STATIONS = CENTRELINE.stations;
const STATION_COUNT = STATIONS.length;
const STATION_SPACING = CENTRELINE.station_spacing_m;

const POINTS = STATIONS.map((s) => [s.x, s.y, s.z]);

function normalize([x, y, z]) {
  const length = Math.hypot(x, y, z) || 1;
  return [x / length, y / length, z / length];
}

const TANGENTS = POINTS.map((_, i) => {
  const before = POINTS[(i - 1 + STATION_COUNT) % STATION_COUNT];
  const after = POINTS[(i + 1) % STATION_COUNT];
  return normalize([after[0] - before[0], after[1] - before[1], after[2] - before[2]]);
});

/** cross(tangent, worldUp), normalised — the runtime's unbanked right axis. */
const RIGHTS = TANGENTS.map(([tx, , tz]) => normalize([-tz, 0, tx]));

const APRON_EDGES = PRODUCTION.apron.edges;
const STATION_EDGES = STATIONS.map((station) => {
  let left = PRODUCTION.edges.default.edgeLeft;
  let right = PRODUCTION.edges.default.edgeRight;
  for (const span of PRODUCTION.edges.spans) {
    if (station.s < span.fromDistance || station.s > span.toDistance) continue;
    left = span.edgeLeft;
    right = span.edgeRight;
  }
  return {
    apronLeft: APRON_EDGES[left].widthMetres,
    apronRight: APRON_EDGES[right].widthMetres,
  };
});

function wrapDistance(distance) {
  const wrapped = distance % LAP_LENGTH_METRES;
  return wrapped < 0 ? wrapped + LAP_LENGTH_METRES : wrapped;
}

/** The runtime's `sampleAtDistance`, in plain numbers. */
function sampleAt(distance) {
  const scaled = (wrapDistance(distance) / LAP_LENGTH_METRES) * STATION_COUNT;
  const index = Math.floor(scaled) % STATION_COUNT;
  const next = (index + 1) % STATION_COUNT;
  const alpha = scaled - Math.floor(scaled);
  const lerp = (a, b) => a + (b - a) * alpha;
  const position = [0, 1, 2].map((k) => lerp(POINTS[index][k], POINTS[next][k]));
  const tangent = normalize([0, 1, 2].map((k) => lerp(TANGENTS[index][k], TANGENTS[next][k])));
  const right = normalize([-tangent[2], 0, tangent[0]]);
  return {
    index,
    position,
    tangent,
    right,
    halfWidth: lerp(STATIONS[index].width_m, STATIONS[next].width_m) / 2,
    apronLeft: STATION_EDGES[index].apronLeft,
    apronRight: STATION_EDGES[index].apronRight,
    sector: STATIONS[index].sector,
    sequence: STATIONS[index].sequence,
  };
}

/** Run-off outer lip on the given side (-1 runtime-left, +1 runtime-right). */
function clampAt(sample, side) {
  return sample.halfWidth + (side < 0 ? sample.apronLeft : sample.apronRight);
}

/** World XZ of a (distance, lateral) pair, on the pan floor. */
function worldAt(distance, lateral) {
  const sample = sampleAt(distance);
  return [
    sample.position[0] + sample.right[0] * lateral,
    sample.position[2] + sample.right[2] * lateral,
  ];
}

/** World heading of the course tangent at `distance`, degrees. */
function headingAt(distance) {
  const { tangent } = sampleAt(distance);
  return (Math.atan2(tangent[0], tangent[2]) * 180) / Math.PI;
}

/**
 * The clearance rule, measured the way the runtime measures it.
 *
 * `corridor-sweep.ts` resolves each vertex through `course.project()`, which
 * finds the NEAREST point on the centreline and reports the perpendicular
 * lateral there — not the lateral seen from some particular station. So this
 * walks every centreline SEGMENT within `CLEARANCE_SCAN_METRES`, takes the
 * perpendicular distance to each, and returns the smallest
 * `distance - clamp` any of them yields.
 *
 * Taking the minimum over every nearby segment rather than only the nearest one
 * is the conservative reading and it is deliberate: where the lap doubles back,
 * a prop can be comfortably outboard of the segment it was authored against and
 * sitting in the run-off of a segment 90 m further round. The one number this
 * returns is the same one `validate-midground.mjs` re-computes and the same one
 * the acceptance quotes as "min |lateral| - (halfWidth + apron width)".
 */
function corridorClearance(worldX, worldZ, atDistance) {
  const span = Math.ceil(CLEARANCE_SCAN_METRES / STATION_SPACING);
  const centre = Math.round(wrapDistance(atDistance) / STATION_SPACING);
  let worst = Infinity;
  for (let step = -span; step <= span; step += 1) {
    const i = (centre + step + STATION_COUNT * 2) % STATION_COUNT;
    const j = (i + 1) % STATION_COUNT;
    const ax = POINTS[i][0];
    const az = POINTS[i][2];
    const dx = POINTS[j][0] - ax;
    const dz = POINTS[j][2] - az;
    const lengthSq = dx * dx + dz * dz;
    const t = lengthSq === 0
      ? 0
      : Math.max(0, Math.min(1, ((worldX - ax) * dx + (worldZ - az) * dz) / lengthSq));
    const distance = Math.hypot(worldX - (ax + dx * t), worldZ - (az + dz * t));
    // Side, so the clamp is the run-off ACTUALLY authored on the side the prop
    // stands on: Bitterpan's three edge spans put 2.1 m on one hand and 4.6 m
    // on the other, and taking the wider one would let a prop sit inside the
    // narrower.
    const side = (worldX - ax) * RIGHTS[i][0] + (worldZ - az) * RIGHTS[i][2];
    const halfWidth = (STATIONS[i].width_m + (STATIONS[j].width_m - STATIONS[i].width_m) * t) / 2;
    const apron = side < 0 ? STATION_EDGES[i].apronLeft : STATION_EDGES[i].apronRight;
    worst = Math.min(worst, distance - (halfWidth + apron));
  }
  return worst;
}

// ---------------------------------------------------------------------------
// The boards, the massing and the sightline corridors, in world XZ.
// ---------------------------------------------------------------------------
const BOARDS = SIGNAGE.bitterpan.placements.map((board) => {
  const heading = headingAt(board.distance);
  const half = board.widthMetres / 2;
  const [cx, cz] = worldAt(board.distance, board.lateral);
  const along = [Math.sin((heading * Math.PI) / 180), Math.cos((heading * Math.PI) / 180)];
  return {
    id: board.id,
    distance: board.distance,
    lateral: board.lateral,
    a: [cx - along[0] * half, cz - along[1] * half],
    b: [cx + along[0] * half, cz + along[1] * half],
  };
});

const MASSING_CIRCLES = MASSING.placements.map((placement) => ({
  x: placement.position[0],
  z: placement.position[2],
  radius: Math.hypot(placement.footprint_m[0], placement.footprint_m[1]) / 2,
  family: placement.family,
  station: placement.station_m,
}));

/** The works: the families a drum or a pallet plausibly belongs beside. */
const WORKS_FAMILIES = new Set([
  "S1_hoppers_and_sheds",
  "S3_sheds_and_plant",
  "S2_pump_stands",
]);
const WORKS_ANCHORS = MASSING.placements.filter((p) => WORKS_FAMILIES.has(p.family));

function distanceToSegment(px, pz, [ax, az], [bx, bz]) {
  const dx = bx - ax;
  const dz = bz - az;
  const lengthSq = dx * dx + dz * dz;
  const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / lengthSq));
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}

function clearsBoards(worldX, worldZ, radius) {
  for (const board of BOARDS) {
    if (distanceToSegment(worldX, worldZ, board.a, board.b) < BOARD_CLEAR_RADIUS_METRES + radius) {
      return false;
    }
  }
  return true;
}

/**
 * True when a prop of this height may stand at this (distance, lateral)
 * without standing between the chase camera and a board on its approach.
 */
function clearsBoardSightline(distance, lateral, height) {
  if (height <= BOARD_SIGHTLINE_MAX_HEIGHT_METRES) return true;
  for (const board of BOARDS) {
    let ahead = board.distance - distance;
    if (ahead < -LAP_LENGTH_METRES / 2) ahead += LAP_LENGTH_METRES;
    if (ahead > LAP_LENGTH_METRES / 2) ahead -= LAP_LENGTH_METRES;
    if (ahead < 0 || ahead > BOARD_SIGHTLINE_LENGTH_METRES) continue;
    if (Math.abs(lateral - board.lateral) <= BOARD_SIGHTLINE_HALF_WIDTH_METRES) return false;
  }
  return true;
}

function clearsMassing(worldX, worldZ, radius) {
  for (const circle of MASSING_CIRCLES) {
    const gap = Math.hypot(worldX - circle.x, worldZ - circle.z) - circle.radius - radius;
    if (gap < MASSING_CLEAR_METRES) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// The families.
//
// `radius` is the horizontal bounding radius of the instance at scale 1 and is
// what the clearance rule adds to the origin; `height` is what the sightline
// rule reads. Both are declared here and re-asserted by the validator against
// the runtime geometry, so a family that grows without its record growing with
// it fails rather than quietly reaching into the corridor.
// ---------------------------------------------------------------------------
const FAMILIES = [
  "POST_PLATE",
  "SCREEN_BAY",
  "WINDROW_RIDGE",
  "CRUST_PLATE",
  "PIPE_RUN",
  "DRUM_CLUSTER",
];

/**
 * Sector density weight. S1 HARVEST BASIN holds the rigs and S3 LOADOUT BASIN
 * the plant, so both are worked ground; S2 THE LONG BASIN is the map's stated
 * empty run and stays sparser — but never empty, which the per-200 m floor in
 * the validator is what actually holds.
 */
const SECTOR_WEIGHT = { S1: 1.15, S2: 0.72, S3: 1.1 };

const instances = [];

function emit(family, distance, lateral, yawDeg, scale, lift, tint) {
  instances.push({
    family,
    distance: round(wrapDistance(distance), 2),
    lateral: round(lateral, 3),
    yawDeg: round(((yawDeg % 360) + 360) % 360, 2),
    scale: scale.map((v) => round(v, 3)),
    lift: round(lift, 3),
    tint,
  });
}

// --- Palettes. Worn industrial fiction: galvanised, corroded, sun-killed,
// salt. Nothing saturated, nothing emissive, nothing that reads as neon.
//
// These are MULTIPLIERS on an already-dim sheet, and the scene lights with one
// key: a vertical face turned away from it keeps only the hemisphere term. The
// first values here were chosen for silhouette contrast and shipped screen bays
// whose road-facing side rendered as a flat black bar in the 830 m crop — a
// graphic stripe, not weathered canvas. Lifted until the shaded face reads as
// material. The posts stay dark on purpose: a marker post IS a silhouette, and
// that is what makes the run legible at 300 km/h.
const POST_TINTS = ["#6f6a5e", "#5c574c", "#7d7768", "#514d44"];
const HAZARD_POST_TINTS = ["#8f5636", "#7e4c30"];
// Weathered canvas: pale, bleached, warm. A wind screen has to read AGAINST
// the pan it stands on, not disappear into it.
const SCREEN_TINTS = ["#bdb49f", "#aca391", "#c9c0aa"];
const SALT_TINTS = ["#f2ecd9", "#fbf5e4", "#e8e1cd"];
const CRUST_TINTS = ["#a49c88", "#b6ad97", "#8e8676"];
const STEEL_TINTS = ["#c7bda8", "#b5ab96", "#d2c9b4"];
const DRUM_TINTS = ["#7d7260", "#6a6255", "#736852", "#847f6f"];

/**
 * Rejection-sampled placement.
 *
 * Every family funnels through this, so there is exactly one place where the
 * corridor rule, the board rule, the sightline rule and the massing rule are
 * applied. A family that placed its own instances directly would be a family
 * that could forget one of them.
 */
function tryPlace(distance, lateral, radius, height) {
  const [wx, wz] = worldAt(distance, lateral);
  if (corridorClearance(wx, wz, distance) < CORRIDOR_CLEARANCE_METRES + radius) return null;
  if (!clearsBoards(wx, wz, radius)) return null;
  if (!clearsBoardSightline(distance, lateral, height)) return null;
  if (!clearsMassing(wx, wz, radius)) return null;
  return [wx, wz];
}

/**
 * The same rules for something long and thin.
 *
 * A cable between two posts is 24 m of geometry, and treating it as a 12 m disc
 * about its midpoint rejects every cable on the map — the first run of this
 * generator emitted 0 of them for exactly that reason. It is a SEGMENT, so it
 * gets sampled along its length against a small radius instead.
 */
function spanIsClear(distance, lateral, aWorld, bWorld, height, radius) {
  const SAMPLES = 7;
  for (let n = 0; n <= SAMPLES; n += 1) {
    const t = n / SAMPLES;
    const wx = aWorld[0] + (bWorld[0] - aWorld[0]) * t;
    const wz = aWorld[1] + (bWorld[1] - aWorld[1]) * t;
    if (corridorClearance(wx, wz, distance) < CORRIDOR_CLEARANCE_METRES + radius) return false;
    if (!clearsBoards(wx, wz, radius)) return false;
    if (!clearsMassing(wx, wz, radius)) return false;
  }
  return clearsBoardSightline(distance, lateral, height);
}

// ---------------------------------------------------------------------------
// 1. POST_PLATE + SCREEN_BAY — the roadside rhythm.
//
// Runs of plate-topped posts at a roughly constant offset outboard of the
// run-off lip, with a bay of sagging wind screening strung between consecutive
// posts. This is the layer that does the most work at 300 km/h: a regular
// vertical beat passing the camera is what makes speed legible, and it is
// exactly what Greenwater has and Bitterpan does not.
//
// Posts in a run share a height so the screen between them hangs level. The
// offset is measured from the run-off LIP and re-resolved at every post, so the
// run follows the road through a bend the way a real fence line does.
// ---------------------------------------------------------------------------
// The first version of this pass authored ONE run at a time on a randomly
// chosen side and produced 84 posts over a 3,050 m lap — one every 36 m, on
// alternating hands, which in a 1,280 x 720 frame is four or five posts and no
// rhythm at all. Measured, not judged by eye: median `edges%` moved 5.97 -> 6.89
// against a 9.0 target. A fence line is a CONTINUOUS thing with authored breaks
// in it, so this walks each side of the lap independently and fences most of it.
function buildFenceLine(side) {
  let cursor = rand(0, 90);
  while (cursor < LAP_LENGTH_METRES - 30) {
    const weight = SECTOR_WEIGHT[sampleAt(cursor).sector] ?? 1;
    // The break. Longer where the map is meant to feel empty, so S2's LONG
    // BASIN still reads as the open run it is named for.
    cursor += rand(30, 110) / weight;
    if (cursor >= LAP_LENGTH_METRES - 30) break;

    const offset = rand(4.8, 13.5);
    const spacing = Math.round(rand(15, 22) / 2) * 2;
    const runLength = rand(150, 400) * weight;
    const postHeight = rand(1.7, 2.7);
    const hazardRun = rng() < 0.22;
    const screenTop = postHeight * 0.78;

    const nodes = [];
    for (let along = 0; along <= runLength; along += spacing) {
      const distance = cursor + along;
      if (distance >= LAP_LENGTH_METRES - 8) break;
      const node = sampleAt(distance);
      const lateral = side * (clampAt(node, side) + offset);
      const placed = tryPlace(distance, lateral, 0.45, postHeight);
      if (!placed) {
        nodes.push(null);
        continue;
      }
      nodes.push({ distance, lateral, world: placed });
      emit(
        "POST_PLATE",
        distance,
        lateral,
        rand(-8, 8) + (side < 0 ? 180 : 0),
        [rand(0.85, 1.15), postHeight, rand(0.85, 1.15)],
        0,
        hazardRun && rng() < 0.5 ? pick(HAZARD_POST_TINTS) : pick(POST_TINTS),
      );
    }

    for (let i = 0; i + 1 < nodes.length; i += 1) {
      const a = nodes[i];
      const b = nodes[i + 1];
      if (!a || !b) continue;
      const span = Math.hypot(b.world[0] - a.world[0], b.world[1] - a.world[1]);
      if (span < 6 || span > 34) continue;
      const midDistance = (a.distance + b.distance) / 2;
      const midLateral = (a.lateral + b.lateral) / 2;
      // World heading from post A to post B, expressed relative to the course
      // tangent at the midpoint, because the runtime rotates from that tangent.
      const worldHeading = (Math.atan2(b.world[0] - a.world[0], b.world[1] - a.world[1]) * 180)
        / Math.PI;
      if (!spanIsClear(midDistance, midLateral, a.world, b.world, screenTop, 0.3)) continue;
      emit(
        "SCREEN_BAY",
        midDistance,
        midLateral,
        worldHeading - headingAt(midDistance),
        [span, 1, 1],
        screenTop,
        pick(SCREEN_TINTS),
      );
    }

    cursor += runLength;
  }
}

// Both hands, and deliberately not symmetrically: the two lines are drawn from
// the same stream at different phases, so they break in different places and
// the frame almost never has a fence on exactly both sides for exactly the same
// stretch.
buildFenceLine(-1);
buildFenceLine(1);

// ---------------------------------------------------------------------------
// 2. WINDROW_RIDGE — the pan's own texture, given height.
//
// Low banked ridges of harvested salt. These are the densest family and the
// cheapest (6 triangles), and they are the reason the 20-80 m band stops
// reading as a painted plane: a 0.5 m ridge catches the key light on one flank
// and shades the other, so the ground gets a normal instead of a value.
//
// Yawed to a WORLD heading, not a course-relative one. The wind does not know
// where the road goes.
// ---------------------------------------------------------------------------
for (let distance = 6; distance < LAP_LENGTH_METRES; distance += 33) {
  const sample = sampleAt(distance);
  const weight = SECTOR_WEIGHT[sample.sector] ?? 1;
  const attempts = rng() < weight * 0.75 ? 3 : 2;
  for (let n = 0; n < attempts; n += 1) {
    const side = rng() < 0.5 ? -1 : 1;
    const offset = rand(1.8, 54);
    const at = distance + rand(-3, 3);
    const lateral = side * (clampAt(sampleAt(at), side) + offset);
    const length = rand(8, 30);
    const height = rand(0.45, 1.05);
    const width = rand(2.4, 5.2);
    const jitter = rand(-7, 7);
    const worldYaw = WINDROW_WORLD_HEADING_DEG + jitter;
    const [wx, wz] = worldAt(at, lateral);
    const dirX = Math.sin((worldYaw * Math.PI) / 180) * (length / 2);
    const dirZ = Math.cos((worldYaw * Math.PI) / 180) * (length / 2);
    const ends = [[wx - dirX, wz - dirZ], [wx + dirX, wz + dirZ]];
    // A ridge is 30 m long and 4 m wide; as a disc it would need 15 m of
    // clearance it does not occupy. Sampled along its own axis instead, with
    // its half-WIDTH as the radius.
    if (!spanIsClear(at, lateral, ends[0], ends[1], height, width / 2)) continue;
    emit(
      "WINDROW_RIDGE",
      at,
      lateral,
      worldYaw - headingAt(at),
      [length, height, width],
      0,
      pick(SALT_TINTS),
    );
  }
}

// ---------------------------------------------------------------------------
// 3. CRUST_PLATE — broken pan crust, lifted at one edge.
//
// The pan is a crust over brine and it breaks. Each plate is a thin slab with
// a baked 8 deg tilt; the yaw turns the tilt, so one geometry gives every
// heading of lift. `lift` sinks the low corner under the pan rather than
// balancing the slab on its centre, which is what stops the high edge reading
// as a floating card.
// ---------------------------------------------------------------------------
const CRUST_TILT_DEG = 8;
for (let distance = 3; distance < LAP_LENGTH_METRES; distance += 14) {
  const sample = sampleAt(distance);
  const weight = SECTOR_WEIGHT[sample.sector] ?? 1;
  if (rng() > weight * 0.62) continue;
  const side = rng() < 0.5 ? -1 : 1;
  const offset = rand(1.4, 30);
  const at = distance + rand(-4, 4);
  const lateral = side * (clampAt(sampleAt(at), side) + offset);
  const sx = rand(1.8, 4.2);
  const sz = rand(1.6, 3.4);
  const radius = Math.hypot(sx, sz) / 2;
  if (!tryPlace(at, lateral, radius, 0.4)) continue;
  // Half-diagonal x sin(tilt): the drop from the slab centre to its low corner.
  const sink = radius * Math.sin((CRUST_TILT_DEG * Math.PI) / 180);
  emit("CRUST_PLATE", at, lateral, rand(0, 360), [sx, 1, sz], -sink, pick(CRUST_TINTS));
}

// ---------------------------------------------------------------------------
// 4. PIPE_RUN — brine lines on trestles.
//
// The one tall family (3-5 m) and deliberately the sparsest. It is what gives
// the middle distance a vertical, and it is the family the board sightline rule
// exists for. Placed further out (20-90 m) so it reads as infrastructure
// crossing the pan rather than as roadside furniture.
// ---------------------------------------------------------------------------
for (let distance = 40; distance < LAP_LENGTH_METRES - 40; distance += 38) {
  const sample = sampleAt(distance);
  const weight = SECTOR_WEIGHT[sample.sector] ?? 1;
  if (rng() > weight * 0.5) continue;
  const side = rng() < 0.5 ? -1 : 1;
  // A trestle is a run, not a monument: two or three bents in a line.
  const bents = rng() < 0.55 ? 3 : 2;
  const offset = rand(14, 76);
  const height = rand(3, 5);
  const span = rand(4.5, 8);
  const heading = rand(-40, 40);
  for (let n = 0; n < bents; n += 1) {
    const at = distance + n * rand(9, 15);
    const lateral = side * (clampAt(sampleAt(at), side) + offset + rand(-1.5, 1.5));
    if (!tryPlace(at, lateral, span / 2 + 0.4, height)) continue;
    emit("PIPE_RUN", at, lateral, heading, [span, height, 1], 0, pick(STEEL_TINTS));
  }
}

// ---------------------------------------------------------------------------
// 5. DRUM_CLUSTER — what the works leaves lying about.
//
// Anchored to the authored plant rather than scattered: a cluster only exists
// within 60 m of an S1_hoppers_and_sheds, S3_sheds_and_plant or S2_pump_stands
// placement, because drums stacked in open pan 400 m from anything is set
// dressing and drums stacked beside a shed is a site.
// ---------------------------------------------------------------------------
for (const anchor of WORKS_ANCHORS) {
  const clusters = rng() < 0.62 ? 2 : 1;
  for (let n = 0; n < clusters; n += 1) {
    const at = anchor.station_m + rand(-42, 42);
    const side = anchor.side < 0 ? 1 : -1; // authored side -> runtime side
    const node = sampleAt(at);
    const anchorOffset = Math.abs(anchor.lateral_offset_m) - node.halfWidth;
    const offset = Math.max(2.5, Math.min(46, anchorOffset + rand(-16, 16)));
    const lateral = side * (clampAt(node, side) + offset);
    if (!tryPlace(at, lateral, 1.5, 1.1)) continue;
    emit(
      "DRUM_CLUSTER",
      at,
      lateral,
      rand(0, 360),
      [rand(0.85, 1.25), rand(0.85, 1.15), rand(0.85, 1.25)],
      0,
      pick(DRUM_TINTS),
    );
  }
}

// ---------------------------------------------------------------------------
// The histograms the acceptance reads.
// ---------------------------------------------------------------------------
instances.sort((a, b) => (a.distance - b.distance) || a.family.localeCompare(b.family)
  || (a.lateral - b.lateral));

const BIN_METRES = 250;
const binCount = Math.ceil(LAP_LENGTH_METRES / BIN_METRES);
const bins = new Array(binCount).fill(0);
for (const instance of instances) bins[Math.floor(instance.distance / BIN_METRES)] += 1;

/** Rolling 200 m floor: the metric that says "never empty", not "dense on average". */
const RUN_METRES = 200;
let worstRun = { from: 0, count: Infinity };
for (let from = 0; from < LAP_LENGTH_METRES; from += 10) {
  let count = 0;
  for (const instance of instances) {
    let ahead = instance.distance - from;
    if (ahead < 0) ahead += LAP_LENGTH_METRES;
    if (ahead < RUN_METRES) count += 1;
  }
  if (count < worstRun.count) worstRun = { from, count };
}

/**
 * The forward window the acceptance measures: everything a camera at `from`
 * could see in the next 150 m within +/- 90 m of the centreline.
 */
function forwardWindow(from) {
  let count = 0;
  for (const instance of instances) {
    let ahead = instance.distance - from;
    if (ahead < 0) ahead += LAP_LENGTH_METRES;
    if (ahead < 150 && Math.abs(instance.lateral) <= 90) count += 1;
  }
  return count;
}

let worstWindow = { from: 0, count: Infinity };
for (let from = 0; from < LAP_LENGTH_METRES; from += 5) {
  const count = forwardWindow(from);
  if (count < worstWindow.count) worstWindow = { from, count };
}

const familyCounts = {};
for (const family of FAMILIES) familyCounts[family] = 0;
for (const instance of instances) familyCounts[instance.family] += 1;

let minClearance = Infinity;
let minClearanceAt = null;
for (const instance of instances) {
  const [wx, wz] = worldAt(instance.distance, instance.lateral);
  const clearance = corridorClearance(wx, wz, instance.distance);
  if (clearance < minClearance) {
    minClearance = clearance;
    minClearanceAt = instance;
  }
}

const document = {
  $generatedBy: "scripts/generate-bitterpan-midground.mjs",
  $doNotEditByHand:
    "Re-run the generator and review the diff. scripts/validate-midground.mjs "
    + "re-runs it and fails if this file is not what the seed produces.",
  map: "bitterpan",
  seed: SEED,
  lapLengthMetres: LAP_LENGTH_METRES,
  groundYMetres: GROUND_Y_METRES,
  windFromDeg: WIND_FROM_DEG,
  windrowWorldHeadingDeg: WINDROW_WORLD_HEADING_DEG,
  rules: [
    `Every instance clears the authored run-off lip (halfWidth + apronWidth) by `
      + `at least ${CORRIDOR_CLEARANCE_METRES} m plus its own footprint radius, `
      + `measured against every station within ${CLEARANCE_SCAN_METRES} m and not `
      + "only its own.",
    `No instance comes within ${BOARD_CLEAR_RADIUS_METRES} m of a P12 signage `
      + "board footprint.",
    `No instance taller than ${BOARD_SIGHTLINE_MAX_HEIGHT_METRES} m stands in a `
      + `board's ${BOARD_SIGHTLINE_LENGTH_METRES} m approach within `
      + `${BOARD_SIGHTLINE_HALF_WIDTH_METRES} m of its lateral.`,
    `No instance comes within ${MASSING_CLEAR_METRES} m of an authored massing `
      + "footprint.",
    "lateral is signed in the RUNTIME convention (course.sample's `right` = "
      + "cross(tangent, worldUp)), which is the opposite sign to the station "
      + "table's `normal` and to MASSING_PLACEMENTS' lateral_offset_m.",
    "yawDeg is measured from the course tangent at the instance's own distance. "
      + "WINDROW_RIDGE yaws are pre-resolved so the ridge lies across the "
      + `${WIND_FROM_DEG} deg wind in WORLD space.`,
    "lift is metres of the instance origin above the pan floor; 0 for anything "
      + "standing on the ground, the screen top-edge height for SCREEN_BAY, and "
      + "negative for CRUST_PLATE so its low corner sinks instead of the slab "
      + "balancing on its centre.",
  ],
  counts: {
    instances: instances.length,
    families: FAMILIES.length,
    byFamily: familyCounts,
  },
  density: {
    binMetres: BIN_METRES,
    perBin: bins,
    worst200mRun: worstRun,
    worst150mForwardWindow: worstWindow,
  },
  clearance: {
    minMetresBeyondRunOffLip: round(minClearance),
    at: minClearanceAt && {
      family: minClearanceAt.family,
      distance: minClearanceAt.distance,
      lateral: minClearanceAt.lateral,
    },
  },
  instances,
};

const body = `${JSON.stringify(document, null, 1)}\n`;

if (process.argv.includes("--check")) {
  let existing = null;
  try {
    existing = readFileSync(new URL(OUT_PATH, root), "utf8");
  } catch {
    console.error(`${OUT_PATH} does not exist. Run the generator without --check.`);
    process.exit(1);
  }
  if (existing !== body) {
    console.error(
      `${OUT_PATH} is not what seed ${SEED} produces. The committed placements `
        + "and the generator disagree — re-run without --check and review the diff.",
    );
    process.exit(1);
  }
  console.log(
    `Bitterpan midground CHECK: ${instances.length} instances across `
      + `${FAMILIES.length} families re-generated identical from seed ${SEED}.`,
  );
} else {
  writeFileSync(new URL(OUT_PATH, root), body);
  console.log(
    `Bitterpan midground: ${instances.length} instances across ${FAMILIES.length} `
      + `families -> ${OUT_PATH}`,
  );
  console.log(`  by family: ${FAMILIES.map((f) => `${f} ${familyCounts[f]}`).join(", ")}`);
  console.log(
    `  min clearance beyond the run-off lip: ${round(minClearance)} m `
      + `(${minClearanceAt?.family} @${minClearanceAt?.distance} m)`,
  );
  console.log(
    `  worst 200 m run: ${worstRun.count} instances from ${worstRun.from} m; `
      + `worst 150 m forward window: ${worstWindow.count} from ${worstWindow.from} m`,
  );
  console.log(`  per-${BIN_METRES} m histogram:`);
  bins.forEach((count, i) => {
    console.log(
      `    ${String(i * BIN_METRES).padStart(4)}-${String((i + 1) * BIN_METRES).padStart(4)} m `
        + `${String(count).padStart(3)} ${"#".repeat(Math.min(60, count))}`,
    );
  });
}
