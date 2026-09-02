import * as THREE from "three";
import atlasRegionsJson from "./data/ATLAS_REGIONS.json";
import midgroundJson from "./data/BITTERPAN_MIDGROUND.json";
import { type RaceCourse, surfaceHeightAtLateral } from "./course";
import { GROUND_Y_METRES } from "./bitterpan-surface";
import { activeRenderMode } from "./render-mode.js";
import { applyPs2MaterialTreatment } from "./totem";

/**
 * P20.3 — the 0-120 m band, given furniture.
 *
 * WHAT WAS WRONG. Bitterpan's 226 authored structures are silhouettes on the
 * horizon; between the road edge and them there was nothing at all. At 300 km/h
 * the frame was road, flat tan plane, flat tan sky, and the pan read as a
 * backdrop rather than as ground you are travelling over. Greenwater does not
 * have this problem because its 0-100 m band is full of kerbs, fences, lamp
 * posts and vegetation cards; the mid-ground is where speed becomes legible,
 * because it is the only band that moves fast enough to see and slow enough to
 * read.
 *
 * WHAT THIS IS. Six instanced families — 569 instances, six draw calls, one
 * material each on the ALREADY-PINNED `bitterpan_facades_1024` sheet. No new
 * texture, no animation, no per-frame work beyond a 4 Hz frustum count.
 * Placements come from `BITTERPAN_MIDGROUND.json`, authored offline by
 * `scripts/generate-bitterpan-midground.mjs` and re-derived byte-identical by
 * `scripts/validate-midground.mjs`.
 *
 * WHY IT CANNOT TOUCH PHYSICS. Two independent guarantees, because one is a
 * single point of failure:
 *
 *  1. Every instance is authored outside `halfWidth + apronWidth + 1.5 m` — the
 *     furthest lateral the craft's clamp can ever reach, plus 1.5 m — measured
 *     against every centreline segment within 120 m, not just its own. The
 *     validator re-computes that number and fails under 1.5 m.
 *  2. The group is named `BP_MIDGROUND` and listed in
 *     `CORRIDOR_SWEEP_EXCLUDED_NAMES`, so `corridor-sweep.ts` never sees it and
 *     `DRIVABLE_LIMITS.json` cannot be re-derived from it even if (1) broke.
 *
 * The reason both exist: the sweep promotes anything >= 0.85 m within its range
 * to a PHYSICS BOUNDARY. A 2.2 m fence post 4 m off the run-off lip would
 * silently narrow the drivable corridor and put an invisible wall over open
 * pan — the exact failure P16 was written to make impossible.
 *
 * WHERE THE PROPS SIT. On the pan floor at `GROUND_Y_METRES` (-1.95 m), which
 * is the plane `bitterpan-surface.ts` draws and the only ground that exists
 * outboard of the apron. The ribbon rides 0.08-3.82 m above it, so a prop that
 * followed the deck plane would hang in the air by up to 3.8 m over a bank.
 * `surfaceHeightAtLateral` is still consulted and still applied: it returns 0
 * for everything at these laterals — every instance is outboard of the apron by
 * construction — and the assertion below makes that a checked fact rather than
 * an assumption, so a future placement that DOES land on the apron rides the
 * authored cross-section instead of punching through it.
 */

const GROUP_NAME = "BP_MIDGROUND";
const MESH_PREFIX = "BP_MIDGROUND_";
const SHEET_KEY = "bitterpan_facades_1024";

/** Diagnostics `visibleInstances` is recomputed at most this often. */
const VISIBILITY_INTERVAL_SECONDS = 0.25;

/**
 * Baked tilt of a `CRUST_PLATE`, degrees.
 *
 * Baked rather than authored per instance so the placement record stays six
 * fields wide: the instance's `yawDeg` turns the tilt, so one geometry delivers
 * every heading of lift, and `lift` (negative, from the generator) sinks the
 * low corner under the pan instead of balancing the slab on its centre.
 */
const CRUST_TILT_DEG = 8;

/** The three fields the geometry builders need off a point. */
interface Point3 { x: number; y: number; z: number }

interface AtlasRegion { x: number; y: number; w: number; h: number }
interface AtlasSheet {
  texture: string;
  width: number;
  height: number;
  regions: Record<string, AtlasRegion>;
}

interface MidgroundInstance {
  family: string;
  distance: number;
  lateral: number;
  yawDeg: number;
  scale: [number, number, number];
  lift: number;
  tint: string;
}

const ATLAS_SHEETS = atlasRegionsJson as unknown as Record<string, AtlasSheet>;
const MIDGROUND = midgroundJson as unknown as {
  seed: number;
  groundYMetres: number;
  counts: { instances: number; families: number; byFamily: Record<string, number> };
  instances: MidgroundInstance[];
};

export interface MidgroundStats {
  drawCalls: number;
  instances: number;
  triangles: number;
  families: number;
  byFamily: Record<string, number>;
  trianglesPerInstance: Record<string, number>;
  materials: number;
  textures: number;
}

export interface MidgroundDiagnostics {
  drawCalls: number;
  instances: number;
  triangles: number;
  families: number;
  visibleInstances: number;
}

// ---------------------------------------------------------------------------
// Geometry builders.
//
// Every family is authored in a UNIT frame with its footing at y = 0 and its
// long axis on +X, so the generator's `scale` triple reads the same way for all
// six: [along, up, across]. UVs are assigned per FACE from named regions on the
// facade sheet — box-mapped once per face, the same deviation `bitterpan-
// facades.ts` documents, because tiling an atlas region needs geometry split
// per repeat and these are 6-to-84 triangle props.
// ---------------------------------------------------------------------------

const sheet = ATLAS_SHEETS[SHEET_KEY];

function regionUv(name: string): [number, number, number, number] {
  const region = sheet?.regions[name];
  if (!sheet || !region) {
    throw new Error(`Bitterpan midground names unknown atlas region ${name}.`);
  }
  return [
    region.x / sheet.width,
    1 - (region.y + region.h) / sheet.height,
    (region.x + region.w) / sheet.width,
    1 - region.y / sheet.height,
  ];
}

interface Builder {
  positions: number[];
  normals: number[];
  uvs: number[];
}

function createBuilder(): Builder {
  return { positions: [], normals: [], uvs: [] };
}

/**
 * One quad, wound counter-clockwise from `a` through `d`, with its region
 * box-mapped across it. Non-indexed on purpose: these geometries are 6-84
 * triangles and shared by every instance of the family, so the index buffer
 * would cost more to carry than the duplicated vertices it saves.
 */
function quad(
  builder: Builder,
  a: Point3,
  b: Point3,
  c: Point3,
  d: Point3,
  region: [number, number, number, number],
): void {
  const [u0, v0, u1, v1] = region;
  const ab = new THREE.Vector3(b.x - a.x, b.y - a.y, b.z - a.z);
  const ac = new THREE.Vector3(c.x - a.x, c.y - a.y, c.z - a.z);
  const normal = ab.cross(ac).normalize();
  const corners = [a, b, c, a, c, d];
  const uv = [[u0, v0], [u1, v0], [u1, v1], [u0, v0], [u1, v1], [u0, v1]];
  corners.forEach((corner, index) => {
    builder.positions.push(corner.x, corner.y, corner.z);
    builder.normals.push(normal.x, normal.y, normal.z);
    builder.uvs.push(uv[index][0], uv[index][1]);
  });
}

/** An axis-aligned box, one region per face pair. 12 triangles. */
function box(
  builder: Builder,
  centre: THREE.Vector3,
  size: THREE.Vector3,
  sides: [number, number, number, number],
  caps: [number, number, number, number],
): void {
  const hx = size.x / 2;
  const hy = size.y / 2;
  const hz = size.z / 2;
  const v = (sx: number, sy: number, sz: number) => ({
    x: centre.x + sx * hx,
    y: centre.y + sy * hy,
    z: centre.z + sz * hz,
  });
  quad(builder, v(-1, -1, 1), v(1, -1, 1), v(1, 1, 1), v(-1, 1, 1), sides);
  quad(builder, v(1, -1, -1), v(-1, -1, -1), v(-1, 1, -1), v(1, 1, -1), sides);
  quad(builder, v(1, -1, 1), v(1, -1, -1), v(1, 1, -1), v(1, 1, 1), sides);
  quad(builder, v(-1, -1, -1), v(-1, -1, 1), v(-1, 1, 1), v(-1, 1, -1), sides);
  quad(builder, v(-1, 1, 1), v(1, 1, 1), v(1, 1, -1), v(-1, 1, -1), caps);
  quad(builder, v(-1, -1, -1), v(1, -1, -1), v(1, -1, 1), v(-1, -1, 1), caps);
}

function finishGeometry(builder: Builder): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.BufferAttribute(new Float32Array(builder.positions), 3),
  );
  geometry.setAttribute(
    "normal",
    new THREE.BufferAttribute(new Float32Array(builder.normals), 3),
  );
  geometry.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(builder.uvs), 2));
  geometry.computeBoundingSphere();
  return geometry;
}

/**
 * A plate-topped marker post. 24 triangles.
 *
 * The workhorse: a run of these passing the camera is the rhythm that makes
 * 300 km/h legible, and it is exactly what Greenwater's 0-100 m band has and
 * Bitterpan's did not. The plate is what stops it reading as a bare stick and
 * gives the salt works its marked-boundary language.
 *
 * Authored 1 m tall so the generator's `scale.y` IS the post height in metres.
 */
function buildPostPlate(): THREE.BufferGeometry {
  const builder = createBuilder();
  const galv = regionUv("SKIN_GALV_RIB");
  const patched = regionUv("SKIN_PATCHED");
  box(
    builder,
    new THREE.Vector3(0, 0.5, 0),
    new THREE.Vector3(0.14, 1, 0.14),
    galv,
    galv,
  );
  box(
    builder,
    new THREE.Vector3(0, 0.84, 0.03),
    new THREE.Vector3(0.46, 0.3, 0.05),
    patched,
    patched,
  );
  return finishGeometry(builder);
}

/**
 * A bay of wind screening strung between two posts, six sagging segments.
 * 72 triangles.
 *
 * This started as a bare 0.05 m cable and the screenshots said no: a cable seen
 * from a chase camera at 300 km/h is one pixel of nothing, and the measured
 * `edges%` after a full pass of them was 7.26 against a 9.0 target. A salt works
 * in a 292 deg wind does not string bare wire along its boundary anyway — it
 * strings SCREENING, which is the map's own `S1_wind_screens` vocabulary
 * ("closest ordinary massing; low enough to never occlude the route edge"), on
 * `MASS_weathered_canvas`. So the bay carries a 1.05 m panel of `SKIN_CANVAS`
 * that sags with its own top edge. The cable is still there — it is the top
 * edge of the screen, which is where a real one is.
 *
 * Spans x in [-0.5, 0.5] so the generator's `scale.x` is the span in metres and
 * the panel's height and thickness do not stretch with it: `scale.y` and
 * `scale.z` stay 1, which is what keeps a 30 m bay looking like screening and
 * not like a wall. `lift` carries the top edge to the post attachment height.
 *
 * SEGMENTS, and why there are eight of them. `bitterpan-facades.ts` documents
 * honouring `uvMetresPerTile` as an aspect ratio rather than a repeat count,
 * because tiling an atlas region needs the geometry split per repeat. On a
 * 226-placement merged family that trade is right. On a 30 m screen bay it is
 * not: mapping one 256 px canvas swatch across 30 m of panel is a texel every
 * 12 cm, which renders as a flat wash — measured on the first pass, where two
 * of thirteen stations came back with LOWER `edges%` after the layer went in,
 * because a flat prop was covering the pan's own crust crazing and putting
 * nothing back. Eight segments put the region down eight times, about 3 m to
 * the tile, which is both the honest pitch for weathered screening and detail
 * the frame can actually see. 72 triangles, inside the 120 ceiling.
 *
 * It cannot hide the route edge: it is at most 1.05 m tall, stands 4.8 m or
 * more outboard of the run-off lip, and stands on the pan floor, which is
 * 0.08-3.82 m BELOW the deck it is beside.
 */
function buildScreenBay(): THREE.BufferGeometry {
  const builder = createBuilder();
  const canvas = regionUv("SKIN_CANVAS");
  const SAG = 0.34;
  // 1.05 m, down from 1.45. The scene lights with one key and a thin hemisphere
  // term, so the road-facing side of a vertical panel renders near-black — the
  // established look of the authored sheds beside it, but at 1.45 m and 11 m off
  // the deck edge it was a black mass filling the near-left of the 830 m crop
  // rather than a piece of site furniture. At 1.05 m the screen also hangs with
  // 0.3-1.1 m of daylight under it, which is what strung windbreak screening
  // actually looks like and what stops the fence line reading as a wall.
  const PANEL_HEIGHT = 1.05;
  // Six, not eight. Eight put the layer at 30,304 triangles against the phase's
  // 30,000 ceiling — measured off the renderer, not estimated. Six is about 4 m
  // to the tile on a 25 m bay, which is still an order of magnitude finer than
  // the single stretched swatch this replaced, and lands the layer at 26,772.
  const SEGMENTS = 6;
  // CENTRED on x = 0, like every other family. The first version ran x from 0
  // to 1, which put the instance origin at one END of the bay while the
  // generator authors it at the MIDPOINT between the two posts — so every bay
  // overshot its far post by half its own span, and the generator's and
  // validator's clearance sampling (which both work outward from the midpoint)
  // were measuring a bay that was not where the runtime put it.
  const nodes = Array.from({ length: SEGMENTS + 1 }, (_, i) => {
    const t = i / SEGMENTS;
    // A parabola through (0,0) and (1,0) with its minimum at -SAG.
    return { x: t - 0.5, y: -4 * SAG * t * (1 - t) };
  });
  for (let i = 0; i + 1 < nodes.length; i += 1) {
    const a = nodes[i];
    const b = nodes[i + 1];
    box(
      builder,
      new THREE.Vector3(
        (a.x + b.x) / 2,
        (a.y + b.y) / 2 - PANEL_HEIGHT / 2,
        0,
      ),
      new THREE.Vector3(Math.hypot(b.x - a.x, b.y - a.y), PANEL_HEIGHT, 0.05),
      canvas,
      canvas,
    );
    // The segment is authored horizontal and then sheared to its own slope by
    // moving its own vertices, so the instance transform stays a plain
    // scale-yaw-translate and `scale.x` keeps meaning "span in metres".
    const written = builder.positions.length;
    const slope = (b.y - a.y) / (b.x - a.x);
    for (let v = written - 36 * 3; v < written; v += 3) {
      builder.positions[v + 1] += slope * (builder.positions[v] - (a.x + b.x) / 2);
    }
  }
  return finishGeometry(builder);
}

/**
 * A wind-banked salt ridge: a triangular prism, no underside. 18 triangles.
 *
 * The densest and cheapest family, and the one that does the most for the
 * emptiness: a 0.5 m ridge catches the key light on one flank and shades the
 * other, so the pan gets a normal instead of a single value. The generator
 * pre-resolves its yaw so the ridge lies ACROSS the 292 deg wind in world
 * space, which is why they stay parallel to each other through every bend.
 */
function buildWindrowRidge(): THREE.BufferGeometry {
  const builder = createBuilder();
  const concrete = regionUv("SKIN_CONCRETE");
  const [u0, v0, u1, v1] = concrete;
  // Split along its length for the same reason `buildScreenBay` is: a 30 m ridge
  // showing one 512 px swatch of `SKIN_CONCRETE` is a flat wash, and a flat wash
  // over the pan's own crust crazing is a net LOSS of frame detail. Four
  // segments put the region down four times, and the ridge line still reads as
  // one bank because the segments share their vertices exactly.
  const SEGMENTS = 4;
  const ridgeA = { x: -0.5, y: 1, z: 0 };
  const ridgeB = { x: 0.5, y: 1, z: 0 };
  const baseNear = { x: -0.5, y: 0, z: 0.5 };
  const baseNearB = { x: 0.5, y: 0, z: 0.5 };
  const baseFar = { x: -0.5, y: 0, z: -0.5 };
  const baseFarB = { x: 0.5, y: 0, z: -0.5 };
  for (let i = 0; i < SEGMENTS; i += 1) {
    const x0 = -0.5 + i / SEGMENTS;
    const x1 = -0.5 + (i + 1) / SEGMENTS;
    quad(
      builder,
      { x: x0, y: 0, z: 0.5 },
      { x: x1, y: 0, z: 0.5 },
      { x: x1, y: 1, z: 0 },
      { x: x0, y: 1, z: 0 },
      concrete,
    );
    quad(
      builder,
      { x: x1, y: 0, z: -0.5 },
      { x: x0, y: 0, z: -0.5 },
      { x: x0, y: 1, z: 0 },
      { x: x1, y: 1, z: 0 },
      concrete,
    );
  }
  // The two ends, as single triangles.
  const endUv = [[u0, v0], [u1, v0], [(u0 + u1) / 2, v1]];
  const ends: [Point3, Point3, Point3][] = [
    [baseFar, baseNear, ridgeA],
    [baseNearB, baseFarB, ridgeB],
  ];
  for (const triangle of ends) {
    const [a, b, c] = triangle;
    const normal = new THREE.Vector3(b.x - a.x, b.y - a.y, b.z - a.z)
      .cross(new THREE.Vector3(c.x - a.x, c.y - a.y, c.z - a.z))
      .normalize();
    triangle.forEach((corner, index) => {
      builder.positions.push(corner.x, corner.y, corner.z);
      builder.normals.push(normal.x, normal.y, normal.z);
      builder.uvs.push(endUv[index][0], endUv[index][1]);
    });
  }
  return finishGeometry(builder);
}

/**
 * A lifted plate of broken pan crust. 12 triangles.
 *
 * Pale on top, `BASE_SKIRT` on the sides and underside so the lifted edge shows
 * something darker than the ground it came out of. The tilt is baked; the
 * instance yaw turns it.
 */
function buildCrustPlate(): THREE.BufferGeometry {
  const builder = createBuilder();
  box(
    builder,
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(1, 0.12, 1),
    regionUv("BASE_SKIRT"),
    regionUv("SKIN_CONCRETE"),
  );
  const geometry = finishGeometry(builder);
  geometry.rotateZ(THREE.MathUtils.degToRad(CRUST_TILT_DEG));
  geometry.computeBoundingSphere();
  return geometry;
}

/**
 * A brine-line bent: two legs and the pipe they carry. 60 triangles.
 *
 * The only family over 2.5 m, deliberately the sparsest, and the reason the
 * generator carries a board-sightline rule at all.
 */
function buildPipeRun(): THREE.BufferGeometry {
  const builder = createBuilder();
  // NOT `LATTICE_RIG`, which is what this reached for first. That region is an
  // ALPHA-CUT lattice — `bitterpan-facades.ts` gives it an alphaTest — and its
  // mean value is (32, 24, 19). Box-mapped onto an opaque leg it produced a
  // black picture frame standing on a pale pan: measured off the sheet, not
  // inferred, after the first screenshot pass showed it.
  //
  // Nor `SKIN_PLANT_STEEL`, which was the second try at (114, 87, 66). Better,
  // but a 4.7 m bent still read as a black gate in the 1343 m crop, because a
  // dark region times a dark tint on a face turned from the key light has
  // nothing left. `SKIN_GALV_RIB` is (117, 128, 127) and cool, which is what a
  // galvanised brine-line trestle is anyway.
  const steel = regionUv("SKIN_GALV_RIB");
  const pipe = regionUv("TRIM_PIPE_RUN");
  for (const x of [-0.5, 0.5]) {
    box(
      builder,
      new THREE.Vector3(x, 0.5, 0),
      new THREE.Vector3(0.18, 1, 0.18),
      steel,
      steel,
    );
  }
  // Three boxes end to end rather than one, so the pipe's own region lands about
  // every 2 m of run instead of once across the whole 8 m bent. Same reasoning
  // as the screen bay and the windrow.
  const SEGMENTS = 3;
  for (let i = 0; i < SEGMENTS; i += 1) {
    box(
      builder,
      new THREE.Vector3(-0.61 + (1.22 * (i + 0.5)) / SEGMENTS, 1.02, 0),
      new THREE.Vector3(1.22 / SEGMENTS, 0.22, 0.22),
      pipe,
      pipe,
    );
  }
  return finishGeometry(builder);
}

/** An eight-sided drum, `segments` faces plus caps. */
function drum(builder: Builder, centre: THREE.Vector3, radius: number, height: number): void {
  const tank = regionUv("SKIN_TANK");
  const [u0, v0, u1, v1] = tank;
  const SIDES = 8;
  const ring = (scale: number, y: number) => Array.from({ length: SIDES }, (_, i) => {
    const angle = (i / SIDES) * Math.PI * 2;
    return new THREE.Vector3(
      centre.x + Math.cos(angle) * radius * scale,
      centre.y + y,
      centre.z + Math.sin(angle) * radius * scale,
    );
  });
  const bottom = ring(1, 0);
  const top = ring(1, height);
  for (let i = 0; i < SIDES; i += 1) {
    const j = (i + 1) % SIDES;
    const su0 = u0 + ((u1 - u0) * i) / SIDES;
    const su1 = u0 + ((u1 - u0) * (i + 1)) / SIDES;
    quad(builder, bottom[i], bottom[j], top[j], top[i], [su0, v0, su1, v1]);
  }
  // Caps as triangle fans about the centre.
  for (const [ringPoints, y, flip] of [[top, height, false], [bottom, 0, true]] as const) {
    const hub = new THREE.Vector3(centre.x, centre.y + y, centre.z);
    for (let i = 0; i < SIDES; i += 1) {
      const j = (i + 1) % SIDES;
      const a = hub;
      const b = flip ? ringPoints[j] : ringPoints[i];
      const c = flip ? ringPoints[i] : ringPoints[j];
      const normal = new THREE.Vector3(0, flip ? -1 : 1, 0);
      const uv = [
        [(u0 + u1) / 2, (v0 + v1) / 2],
        [u0 + ((u1 - u0) * i) / SIDES, v0],
        [u0 + ((u1 - u0) * (i + 1)) / SIDES, v1],
      ];
      [a, b, c].forEach((corner, index) => {
        builder.positions.push(corner.x, corner.y, corner.z);
        builder.normals.push(normal.x, normal.y, normal.z);
        builder.uvs.push(uv[index][0], uv[index][1]);
      });
    }
  }
}

/**
 * Three drums, stood where the works left them. 96 triangles.
 *
 * The cluster is baked as one geometry rather than placed as three instances so
 * the arrangement — two upright and one on its side against them — is a single
 * authored read that never scatters into a tidy triangle.
 */
function buildDrumCluster(): THREE.BufferGeometry {
  const builder = createBuilder();
  drum(builder, new THREE.Vector3(0, 0, 0), 0.31, 0.92);
  drum(builder, new THREE.Vector3(0.68, 0, 0.22), 0.31, 0.92);
  const toppled = createBuilder();
  drum(toppled, new THREE.Vector3(0, 0, 0), 0.31, 0.92);
  const geometry = finishGeometry(toppled);
  geometry.rotateX(Math.PI / 2);
  geometry.translate(0.3, 0.31, -0.72);
  const positions = geometry.getAttribute("position");
  const normals = geometry.getAttribute("normal");
  const uvs = geometry.getAttribute("uv");
  for (let i = 0; i < positions.count; i += 1) {
    builder.positions.push(positions.getX(i), positions.getY(i), positions.getZ(i));
    builder.normals.push(normals.getX(i), normals.getY(i), normals.getZ(i));
    builder.uvs.push(uvs.getX(i), uvs.getY(i));
  }
  geometry.dispose();
  return finishGeometry(builder);
}

const FAMILY_BUILDERS: Record<string, () => THREE.BufferGeometry> = {
  POST_PLATE: buildPostPlate,
  SCREEN_BAY: buildScreenBay,
  WINDROW_RIDGE: buildWindrowRidge,
  CRUST_PLATE: buildCrustPlate,
  PIPE_RUN: buildPipeRun,
  DRUM_CLUSTER: buildDrumCluster,
};

/** Hard ceiling from the phase budget; asserted rather than commented. */
const MAX_FAMILIES = 7;
const MAX_TRIANGLES_PER_INSTANCE = 120;

export class BitterpanMidground {
  readonly stats: MidgroundStats;

  private readonly meshes: THREE.InstancedMesh[];

  private visibleInstances = 0;

  private visibilityTimer = 0;

  private readonly frustum = new THREE.Frustum();

  private readonly viewProjection = new THREE.Matrix4();

  private readonly cameraInverse = new THREE.Matrix4();

  private readonly instanceCentres: THREE.Vector3[][] = [];

  private readonly instanceRadii: number[][] = [];

  private readonly scratch = new THREE.Sphere();

  private constructor(
    readonly root: THREE.Group,
    meshes: THREE.InstancedMesh[],
    stats: MidgroundStats,
    centres: THREE.Vector3[][],
    radii: number[][],
  ) {
    this.meshes = meshes;
    this.stats = stats;
    this.instanceCentres = centres;
    this.instanceRadii = radii;
  }

  static build(course: RaceCourse, texture: THREE.Texture): BitterpanMidground {
    if (MIDGROUND.instances.length !== MIDGROUND.counts.instances) {
      throw new Error(
        `The Bitterpan midground declares ${MIDGROUND.counts.instances} instances `
          + `but ships ${MIDGROUND.instances.length}.`,
      );
    }
    if (Math.abs(MIDGROUND.groundYMetres - GROUND_Y_METRES) > 1e-9) {
      throw new Error(
        `The Bitterpan midground was authored against a pan floor at `
          + `${MIDGROUND.groundYMetres} m but the surface layer draws it at `
          + `${GROUND_Y_METRES} m. Every prop would float or sink by the difference.`,
      );
    }

    const byFamily = new Map<string, MidgroundInstance[]>();
    for (const instance of MIDGROUND.instances) {
      const bucket = byFamily.get(instance.family);
      if (bucket) bucket.push(instance);
      else byFamily.set(instance.family, [instance]);
    }
    if (byFamily.size > MAX_FAMILIES) {
      throw new Error(
        `The Bitterpan midground has ${byFamily.size} families against a `
          + `${MAX_FAMILIES} draw-call budget.`,
      );
    }

    const root = new THREE.Group();
    root.name = GROUP_NAME;
    const meshes: THREE.InstancedMesh[] = [];
    const centres: THREE.Vector3[][] = [];
    const radii: number[][] = [];
    const counts: Record<string, number> = {};
    const trianglesPerInstance: Record<string, number> = {};
    let triangles = 0;

    const sample = course.createSampleScratch();
    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const position = new THREE.Vector3();
    const colour = new THREE.Color();
    const forward = new THREE.Vector3();
    const yawAxis = new THREE.Vector3(0, 1, 0);

    for (const [family, list] of [...byFamily].sort((a, b) => a[0].localeCompare(b[0]))) {
      const builder = FAMILY_BUILDERS[family];
      if (!builder) throw new Error(`Bitterpan midground names unknown family ${family}.`);
      const geometry = builder();
      const familyTriangles = geometry.getAttribute("position").count / 3;
      if (familyTriangles > MAX_TRIANGLES_PER_INSTANCE) {
        throw new Error(
          `Bitterpan midground family ${family} is ${familyTriangles} triangles per `
            + `instance, over the ${MAX_TRIANGLES_PER_INSTANCE} ceiling.`,
        );
      }
      const material = new THREE.MeshLambertMaterial({
        name: `${MESH_PREFIX}${family}`,
        map: texture,
        fog: true,
        side: THREE.FrontSide,
      });
      const mesh = new THREE.InstancedMesh(geometry, material, list.length);
      mesh.name = `${MESH_PREFIX}${family}`;
      // A parallel phase is turning shadow maps on. The flags cost nothing
      // while `renderer.shadowMap.enabled` is false and mean this layer does
      // not have to be revisited when it flips.
      mesh.castShadow = true;
      mesh.receiveShadow = true;

      const familyCentres: THREE.Vector3[] = [];
      const familyRadii: number[] = [];
      const geometryRadius = geometry.boundingSphere?.radius ?? 1;
      const geometryCentre = geometry.boundingSphere?.center ?? new THREE.Vector3();

      list.forEach((instance, index) => {
        course.sample(instance.distance / course.length, sample);
        // The apron cross-section is consulted, not assumed away: it returns 0
        // for every instance the generator produced, because all of them are
        // outboard of the apron, but a placement that ever does land on the
        // run-off rides its authored profile rather than punching through it.
        const apronHeight = surfaceHeightAtLateral(sample, instance.lateral);
        position.copy(sample.position).addScaledVector(sample.right, instance.lateral);
        // Off the apron, the drawn ground is the flat pan plane. On it, the
        // apron surface, which is course-relative and therefore banked.
        position.y = apronHeight === 0
          ? GROUND_Y_METRES + instance.lift
          : position.y + apronHeight + instance.lift;

        // Yaw is measured from the course tangent, flattened: the props stand
        // upright on a flat pan, so the bank of the deck beside them is not
        // their business.
        //
        // THE MINUS A QUARTER TURN IS LOAD-BEARING. Every family is authored
        // with its LONG axis on local +X, and a three.js rotation of `t` about
        // +Y sends local +X to (cos t, 0, -sin t) — which for t = atan2(fx, fz)
        // is the course RIGHT, not the course forward. Without the quarter
        // turn every long prop is built across the track instead of along it:
        // a 28 m screen bay authored at lateral -20 swings its far end onto the
        // racing surface.
        //
        // Not reasoned out — MEASURED. Running the corridor sweep with this
        // layer's name exclusion removed reported 33 obstacles and 21 bounded
        // spans, `BP_MIDGROUND_SCREEN_BAY` vertices as far in as lateral
        // -0.512 m at 2425.6 m, over the middle of the deck in the Harvester
        // Chicane. The generator and its validator both passed the same
        // placements at >= 1.5 m of clearance, because both of them measured
        // the geometry the runtime was SUPPOSED to build. That is exactly why
        // the "excluded by name" lock is not allowed to be the only lock, and
        // why the exclusion gets pulled and the sweep re-run as part of
        // accepting this phase.
        forward.set(sample.tangent.x, 0, sample.tangent.z).normalize();
        const baseYaw = Math.atan2(forward.x, forward.z) - Math.PI / 2;
        quaternion.setFromAxisAngle(
          yawAxis,
          baseYaw + THREE.MathUtils.degToRad(instance.yawDeg),
        );
        scale.set(instance.scale[0], instance.scale[1], instance.scale[2]);
        matrix.compose(position, quaternion, scale);
        mesh.setMatrixAt(index, matrix);
        colour.set(instance.tint).convertSRGBToLinear();
        mesh.setColorAt(index, colour);

        const centre = geometryCentre.clone().multiply(scale).applyQuaternion(quaternion)
          .add(position);
        familyCentres.push(centre);
        familyRadii.push(geometryRadius * Math.max(scale.x, scale.y, scale.z));
      });

      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
      // The layer wraps the whole 3,050 m lap, so its own bounding sphere
      // contains the camera at every point of it and the frustum test can never
      // retire the mesh. Culling it costs a sphere test that always says yes;
      // the per-instance count below is what actually answers "how much of this
      // is on screen".
      mesh.frustumCulled = false;

      applyPs2MaterialTreatment(mesh, { worldGeometry: true });
      // The treatment pins anisotropy to 1 and, outside `?render=ps2`, would
      // leave this sheet point-sampled. `bitterpan-facades.ts` re-asserts the
      // delivery's own filtering on the same texture for the same reason; these
      // props stand beside those structures and must not be a second filtering
      // class on the same pixels.
      if (activeRenderMode() !== "ps2") {
        texture.magFilter = THREE.LinearFilter;
        texture.minFilter = THREE.LinearMipmapLinearFilter;
        texture.generateMipmaps = true;
        texture.anisotropy = 4;
        texture.needsUpdate = true;
      }

      root.add(mesh);
      meshes.push(mesh);
      centres.push(familyCentres);
      radii.push(familyRadii);
      counts[family] = list.length;
      trianglesPerInstance[family] = familyTriangles;
      triangles += familyTriangles * list.length;
    }

    return new BitterpanMidground(
      root,
      meshes,
      {
        drawCalls: meshes.length,
        instances: MIDGROUND.instances.length,
        triangles,
        families: meshes.length,
        byFamily: counts,
        trianglesPerInstance,
        materials: meshes.length,
        textures: 1,
      },
      centres,
      radii,
    );
  }

  static async load(course: RaceCourse, textureUrl: string): Promise<BitterpanMidground> {
    const texture = await new THREE.TextureLoader().loadAsync(textureUrl);
    // The same filtering `bitterpan-facades.ts` pins for this sheet: these
    // props stand beside the structures that use it and must not be a second
    // filtering class on the same pixels.
    texture.name = SHEET_KEY;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.generateMipmaps = true;
    texture.anisotropy = 4;
    texture.needsUpdate = true;
    try {
      return BitterpanMidground.build(course, texture);
    } catch (error) {
      texture.dispose();
      throw error;
    }
  }

  /**
   * Counts the instances inside the camera frustum, at most four times a
   * second.
   *
   * This is the number the phase's density criterion reads, so it is a real
   * per-instance sphere test against the real camera frustum — not the mesh
   * count, not the instance count, and not a bounding box of the whole layer.
   *
   * Driven from `diagnostics()` rather than from the race loop, for two
   * reasons. The layer is static, so there is nothing else it needs a frame
   * tick for; and `game.ts` sits against a 1,950-line seam budget that
   * `validate-module-seams.mjs` enforces, so a phase that only needs a number
   * read once a second has no business adding a per-frame call to it. The
   * throttle stands anyway: the diagnostics line refreshes at ~1 Hz, but
   * nothing stops a caller asking more often, and 569 sphere tests per frame is
   * a real cost for a diagnostic.
   */
  refreshVisibility(camera: THREE.Camera): void {
    const now = performance.now() / 1000;
    if (this.visibilityTimer !== 0 && now - this.visibilityTimer < VISIBILITY_INTERVAL_SECONDS) {
      return;
    }
    this.visibilityTimer = now;
    camera.updateMatrixWorld();
    // Recomputed rather than trusted: `matrixWorldInverse` is maintained by the
    // renderer, and this can be called from a diagnostics read that happens
    // before the first render of a session.
    this.cameraInverse.copy(camera.matrixWorld).invert();
    this.viewProjection.multiplyMatrices(
      (camera as THREE.PerspectiveCamera).projectionMatrix,
      this.cameraInverse,
    );
    this.frustum.setFromProjectionMatrix(this.viewProjection);
    let visible = 0;
    for (let family = 0; family < this.instanceCentres.length; family += 1) {
      const centres = this.instanceCentres[family];
      const radii = this.instanceRadii[family];
      for (let index = 0; index < centres.length; index += 1) {
        this.scratch.center.copy(centres[index]);
        this.scratch.radius = radii[index];
        if (this.frustum.intersectsSphere(this.scratch)) visible += 1;
      }
    }
    this.visibleInstances = visible;
  }

  diagnostics(): MidgroundDiagnostics {
    return {
      drawCalls: this.stats.drawCalls,
      instances: this.stats.instances,
      triangles: this.stats.triangles,
      families: this.stats.families,
      visibleInstances: this.visibleInstances,
    };
  }

  dispose(): void {
    const textures = new Set<THREE.Texture>();
    for (const mesh of this.meshes) {
      mesh.geometry.dispose();
      const material = mesh.material as THREE.MeshLambertMaterial;
      if (material.map) textures.add(material.map);
      material.dispose();
      mesh.dispose();
    }
    // Every family shares the one facade sheet; disposing it six times is a
    // no-op but saying so once is what makes that a fact rather than a hope.
    for (const texture of textures) texture.dispose();
  }
}
