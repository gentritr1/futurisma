import * as THREE from "three";

import {
  FLAT_FURNITURE_MAX_HEIGHT_METRES,
  PLAQUE_BAND_BOTTOM_METRES,
} from "./furniture-placement.js";
import { surfaceHeightAtLateral } from "./course";
import type { ApronResolution, CourseProjection, RaceCourse } from "./course";
import { createApronResolution } from "./apron.js";

/**
 * P16 — the runtime corridor sweep.
 *
 * Every intrusion check the repo had before this one read AUTHORED JSON:
 * `validate-furniture.mjs` resolves the furniture tables against the centreline
 * and asserts each item clears the deck. That leaves three holes, and all three
 * shipped visible obstacles:
 *
 *  1. It only sees what is in those tables. The 60-mesh Greenwater environment
 *     GLB, the 226 Bitterpan massing placements, the 21 asset-kit props and the
 *     76 hangar components the runtime relocates are all outside it.
 *  2. It trusts the authored coordinate. A mesh whose transform, parent or
 *     baked vertices disagree with its placement record passes anyway.
 *  3. It cannot see anything a runtime step moves after load.
 *
 * This sweep asks the opposite question, of the scene that actually rendered:
 * walk the graph, transform every vertex into course-local coordinates, and
 * report what is standing in the corridor. It is the instrument, not the fix —
 * the counters it emits are what the acceptance re-runs.
 *
 * Armed by `?diagnostics=1&probe=corridor-sweep`; it costs a few hundred
 * milliseconds and allocates, so it never runs in a normal session.
 */

/** Half-width margin added to the deck before a mesh counts as intruding. */
export const CORRIDOR_LATERAL_MARGIN_METRES = 0.5;

/**
 * The height band that matters, measured from the LOCAL deck plane (bank and
 * apron cross-section included), not from world Y.
 *
 * The floor is above painted road and the apron's own lip (0.14 m at most), so
 * decals and the run-off surface never register. The ceiling is above the craft
 * and below the authored plaque band at 3.2 m, so wall plaques and gantries
 * overhead do not register either — this is a test for things standing IN the
 * driving volume.
 */
export const CORRIDOR_HEIGHT_MIN_METRES = 0.05;
export const CORRIDOR_HEIGHT_MAX_METRES = 4.0;

/**
 * Within that swept band, an intrusion is classified into one of three, and only
 * the middle one is an obstacle.
 *
 * The two edges are not a new exemption — they are the constants
 * `furniture-placement.js` already ships and `validate-furniture.mjs` already
 * enforces, imported rather than restated so the runtime sweep and the authored
 * sweep cannot drift apart:
 *
 *  - `flush` (0.05 to 0.3 m) is painted road. The route lights and turn vector
 *    lights sit at 0.06-0.19 m and are the road's own lane markers, no more an
 *    obstacle than a painted line. `FLAT_FURNITURE_MAX_HEIGHT_METRES`.
 *  - `obstacle` (0.3 to 3.2 m) is the driving volume. The craft is 2.3 m tall
 *    and hovers to 1.31 m; anything here is in the way. This is the count that
 *    must be zero.
 *  - `overhead` (3.2 to 4.0 m) is the plaque band and above — where P13
 *    deliberately put the wall plaques, over the craft rather than beside it.
 *    `PLAQUE_BAND_BOTTOM_METRES`.
 *
 * All three are counted and all three appear in the list with their band, so
 * nothing is hidden: a board that regresses to deck level moves from `overhead`
 * to `obstacle` and shows up, which is the whole point of separating them by
 * measured geometry instead of by a name whitelist.
 */
export type CorridorBand =
  | "flush"
  | "obstacle"
  | "overhead"
  | "boundary"
  | "vfx";

/**
 * True for a mesh that cannot be an obstacle because it does not occupy space:
 * transparent AND not writing depth. That is the signature of an overlay —
 * steam puffs, drifting scud, spark billboards — which draw through everything
 * behind them and which the craft passes through by design. The Greenwater
 * blockout says so in its own words: the steam vents are authored
 * `"effect": "vision_only"`.
 *
 * Two properties of the mesh, not a list of names. That matters, because a
 * name whitelist is exactly what the deck-hazard exemption was, and this must
 * not become one: anything that starts writing depth or turns opaque
 * immediately reclassifies itself as scenery and shows up in the count.
 *
 * The class is REPORTED, never hidden — `corridorVfx`, and every entry stays in
 * the list. That is deliberate. The surface-character decal layer would have
 * landed here (it is transparent with `depthWrite: false`), and it was a real
 * bug worth fixing rather than filing away; a class you can still see is a class
 * you can still audit.
 */
function isNonOccludingOverlay(mesh: THREE.Mesh): boolean {
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  return materials.length > 0 && materials.every((material) => (
    material !== null
    && material !== undefined
    && material.transparent === true
    && material.depthWrite === false
  ));
}

/**
 * The obstacle band, re-exported under its own names so the relocation pass in
 * `course-repair.ts` gates on exactly what this sweep counts. Two modules
 * deciding "is this an obstacle" from two copies of 0.3 and 3.2 is how the
 * DECK_HAZARDS whitelist drifted from the thing it was exempting.
 */
export const CORRIDOR_OBSTACLE_HEIGHT_MIN_METRES = FLAT_FURNITURE_MAX_HEIGHT_METRES;
export const CORRIDOR_OBSTACLE_HEIGHT_MAX_METRES = PLAQUE_BAND_BOTTOM_METRES;

/**
 * How far a vertex may sit inside the deck edge and still be the track's own
 * boundary rather than something standing on the road.
 *
 * The kerb and apron meshes are authored to OVERLAP the deck seam so no crack
 * shows between them — `APRON_SEAM_OVERLAP_METRES` is 0.06 m, and the Bitterpan
 * kerb measures 0.045 m inside its own deck edge. Without this tolerance every
 * one of those seams reads as an obstacle: 92 of Bitterpan's first 97.
 */
export const BOUNDARY_SEAM_TOLERANCE_METRES = 0.1;

/**
 * Band edges are compared with a millimetre of slack.
 *
 * `validate-furniture.mjs` compares AUTHORED numbers and can afford its 1e-6.
 * This sweep compares RENDERED vertices: the same plaque authored at exactly
 * 3.2 m comes back as 3.19949 after a float matrix multiply and a projection
 * onto `up`, and at 1e-6 that reads as an obstacle 0.5 mm below its own band.
 * A millimetre is far below anything a person can see and far above the error.
 */
const BAND_EPSILON_METRES = 1e-3;

/**
 * `depth` is measured against `halfWidth + CORRIDOR_LATERAL_MARGIN_METRES`, so a
 * vertex is ON THE DECK ITSELF exactly when its depth exceeds that margin.
 *
 * This is the distinction the whole report turns on, and the first run without
 * it was unreadable. The corridor volume the brief defines reaches 0.5 m PAST
 * the deck edge, which is deliberate — a wall 0.2 m off the deck is still in
 * your face. But it also means the track's own boundary lives inside the
 * volume: Greenwater's trackside walls sit at 10.5-11.8 m against an 11.5 m
 * half-width, and Bitterpan's kerb overlaps its deck seam by 45 mm. Counting
 * those as obstacles makes "zero intrusions" mean "delete the barriers".
 *
 * So geometry beyond the deck edge is classified `boundary`: still measured,
 * still listed, still counted — but not the number that has to reach zero.
 * `obstacle` is reserved for what the user actually ruled on, geometry standing
 * ON the racing surface.
 */
export function classifyCorridorBand(
  heightMin: number,
  heightMax: number,
  depth: number,
  nonOccluding = false,
): CorridorBand {
  if (nonOccluding) return "vfx";
  if (heightMax <= FLAT_FURNITURE_MAX_HEIGHT_METRES + BAND_EPSILON_METRES) {
    return "flush";
  }
  if (heightMin >= PLAQUE_BAND_BOTTOM_METRES - BAND_EPSILON_METRES) {
    return "overhead";
  }
  if (depth <= CORRIDOR_LATERAL_MARGIN_METRES + BOUNDARY_SEAM_TOLERANCE_METRES) {
    return "boundary";
  }
  return "obstacle";
}

/** Cell size of the station lookup grid, metres. */
const GRID_CELL_METRES = 24;

/** Emitted list cap. The full count is always reported. */
const MAX_REPORTED_INTRUSIONS = 120;

/**
 * Intrusions are grouped per mesh AND per run of this many metres of lap.
 *
 * The Greenwater environment arrives as one merged mesh per sector per
 * material, so a whole 200 m sector of concrete is a single `THREE.Mesh`.
 * Grouping by mesh alone answers "this mesh intrudes somewhere", which is not
 * something anyone can act on. Grouping by mesh and distance run says WHERE,
 * which is the only form of this report that leads to a fix.
 */
const INTRUSION_GROUP_METRES = 20;

export interface CorridorIntrusion {
  /** Mesh name, or the nearest named ancestor when the mesh itself is unnamed. */
  readonly mesh: string;
  /**
   * Name of the top-level scene child this mesh hangs off. This is the handle a
   * fix acts on: it names the subsystem that placed the geometry, which the mesh
   * name on its own often does not.
   */
  readonly root: string;
  readonly material: string;
  /** Instance index for an InstancedMesh, else null. */
  readonly instance: number | null;
  /** Course distance in metres at the deepest intruding vertex. */
  readonly distance: number;
  /** Signed lateral of that vertex, metres from the centreline. */
  readonly lateral: number;
  /** Height above the local deck plane at that vertex, metres. */
  readonly height: number;
  /**
   * How far inside the corridor wall the vertex sits, metres. Positive is an
   * intrusion; this is the number a relocation has to erase.
   */
  readonly depth: number;
  /** Height band actually spanned by this mesh's intruding vertices. */
  readonly heightMin: number;
  readonly heightMax: number;
  readonly vertices: number;
  /** False when the mesh or an ancestor was hidden at sweep time. */
  readonly visible: boolean;
  readonly sector: string;
  readonly band: CorridorBand;
  /** The craft's clamp limit for this side and span, metres from centreline. */
  readonly reach: number;
  /** |lateral| of this group's innermost vertex — its inner face. */
  readonly innerExtent: number;
}

export interface CorridorSweepResult {
  readonly ran: boolean;
  readonly map: string;
  readonly meshesSwept: number;
  readonly instancesSwept: number;
  readonly verticesSwept: number;
  readonly verticesTested: number;
  readonly skippedMeshes: number;
  /**
   * Visible obstacles in the driving volume. This is the number that must
   * reach zero.
   */
  readonly intrusions: number;
  /** Visible flush road furniture (0.05-0.3 m). Reported, not an obstacle. */
  readonly flush: number;
  /** Visible overhead geometry (3.2-4.0 m). Reported, not an obstacle. */
  readonly overhead: number;
  /**
   * Visible geometry standing just PAST the deck edge — the track's own kerbs,
   * walls and barriers. Reported, not an obstacle.
   */
  readonly boundary: number;
  /** Visible non-occluding overlays (steam, scud, sparks). Reported. */
  readonly vfx: number;
  /** Entries whose mesh was hidden at sweep time. Counted, not exempted. */
  readonly hiddenIntrusions: number;
  /** Band composition of those hidden entries — the audit the gate depends on. */
  readonly hiddenByBand: Readonly<Record<CorridorBand, number>>;
  readonly list: readonly CorridorIntrusion[];
  /**
   * Per-span innermost tall geometry, the input to the derived drivable limit.
   * Emitted only when `?probe=corridor-sweep` runs with `spans=1`, because it is
   * ~250 rows per map and belongs in a generation script's output, not in every
   * diagnostics line.
   */
  readonly spans: readonly TallGeometrySpan[];
  readonly elapsedMs: number;
}

export const EMPTY_CORRIDOR_SWEEP: CorridorSweepResult = Object.freeze({
  ran: false,
  map: "",
  meshesSwept: 0,
  instancesSwept: 0,
  verticesSwept: 0,
  verticesTested: 0,
  skippedMeshes: 0,
  intrusions: 0,
  flush: 0,
  overhead: 0,
  boundary: 0,
  vfx: 0,
  hiddenIntrusions: 0,
  hiddenByBand: Object.freeze({
    flush: 0, obstacle: 0, overhead: 0, boundary: 0, vfx: 0,
  }),
  list: Object.freeze([]) as readonly CorridorIntrusion[],
  spans: Object.freeze([]) as readonly TallGeometrySpan[],
  elapsedMs: 0,
});

/**
 * A uniform (x, z) hash over the centreline stations.
 *
 * `course.project()` is a two-pass nearest-segment scan: it searches 42 segments
 * either side of the hint, and falls back to all 1,258 when that misses. Called
 * per vertex with no hint that fallback is the common case, which turns a
 * 150k-vertex sweep into ~190M segment tests. The grid gives every vertex a hint
 * good to one cell, so the local pass answers and the sweep stays a few hundred
 * milliseconds.
 */
class StationGrid {
  private readonly cells = new Map<string, number[]>();

  private readonly progressOf: number[] = [];

  private readonly xOf: number[] = [];

  private readonly zOf: number[] = [];

  constructor(course: RaceCourse, stationCount: number) {
    const scratch = course.createSampleScratch();
    for (let index = 0; index < stationCount; index += 1) {
      const progress = index / stationCount;
      const sample = course.sample(progress, scratch);
      this.progressOf.push(progress);
      this.xOf.push(sample.position.x);
      this.zOf.push(sample.position.z);
      // Register the station in its own cell and the eight around it, so a
      // single lookup always sees every station that could be nearest.
      const cellX = Math.floor(sample.position.x / GRID_CELL_METRES);
      const cellZ = Math.floor(sample.position.z / GRID_CELL_METRES);
      for (let dx = -1; dx <= 1; dx += 1) {
        for (let dz = -1; dz <= 1; dz += 1) {
          const neighbour = `${cellX + dx}:${cellZ + dz}`;
          const bucket = this.cells.get(neighbour);
          if (bucket) bucket.push(index);
          else this.cells.set(neighbour, [index]);
        }
      }
    }
  }

  private static key(x: number, z: number): string {
    return `${Math.floor(x / GRID_CELL_METRES)}:${Math.floor(z / GRID_CELL_METRES)}`;
  }

  /**
   * Progress hint for a world point: the NEAREST station in the cell, or null
   * when nothing is near enough.
   *
   * This returned `bucket[0]` — whichever station happened to be registered in
   * the cell first — and that was the P16 task-6 attribution bug. Both courses
   * pass near themselves, so one 24 m cell can hold stations from two different
   * parts of the lap. A first-match hint pointed `project()` at the wrong
   * section, and its local pass only searches 42 segments either side of the
   * hint, so it locked onto the wrong one and never recovered. The visible
   * symptom was Bitterpan's road appearing to be the wall that bounds it: road
   * vertices from a neighbouring section projecting onto this station at a
   * plausible lateral and at the ELEVATION DIFFERENCE between the two sections,
   * which is where the phantom "1.3 m tall geometry" over open salt pan came
   * from.
   *
   * The corridor gate never saw it because a mis-projected vertex lands at a
   * large lateral and reads as off-deck. Only the derived limit table, which
   * asks "what is the innermost tall thing", was sensitive to it.
   */
  hint(x: number, z: number): number | null {
    const bucket = this.cells.get(StationGrid.key(x, z));
    if (!bucket || bucket.length === 0) return null;
    let best = bucket[0];
    let bestDistanceSquared = Infinity;
    for (const index of bucket) {
      const dx = this.xOf[index] - x;
      const dz = this.zOf[index] - z;
      const distanceSquared = dx * dx + dz * dz;
      if (distanceSquared < bestDistanceSquared) {
        bestDistanceSquared = distanceSquared;
        best = index;
      }
    }
    return this.progressOf[best];
  }

  /** True when no station registered a cell anywhere near this point. */
  isFarFromCourse(x: number, z: number): boolean {
    return !this.cells.has(StationGrid.key(x, z));
  }
}

/**
 * The span table task 6 derives the drivable limit from.
 *
 * One bucket per `TALL_GEOMETRY_SPAN_METRES` of lap per side, holding the
 * innermost lateral at which geometry taller than
 * `TALL_GEOMETRY_MIN_HEIGHT_METRES` was found anywhere inside the craft's clamp.
 *
 * The height floor is the ruling's: a kerb, lip or marker at or below 0.5 m does
 * NOT bound the craft — running over a low kerb onto the Bitterpan pan is a
 * feature, and the pan floor exists to receive it. Only geometry the craft would
 * visibly drive INTO counts.
 */
export interface TallGeometrySpan {
  /** Lap distance at the start of this span, metres. */
  readonly distance: number;
  /** Innermost tall lateral to the left (negative side), or null. */
  readonly left: number | null;
  /** Innermost tall lateral to the right (positive side), or null. */
  readonly right: number | null;
  readonly halfWidth: number;
  /** `resolveApron`'s current clamp for this span. */
  readonly clamp: number;
  /**
   * Distance and half-width AT THE BOUNDING VERTEX ITSELF, per side.
   *
   * The limit must be computed against the half-width where the bounding
   * geometry actually stands, never against a bucket-wide minimum: mixing them
   * is how a vertex 10 m away came to look "inner". Recording the vertex's own
   * distance also makes a mis-projection visible in the table — a bounding
   * distance far from its span's is the signature of one.
   */
  readonly leftAt: number | null;
  readonly rightAt: number | null;
  readonly leftHalfWidth: number | null;
  readonly rightHalfWidth: number | null;
  /**
   * The mesh whose vertex set the innermost tall lateral on each side.
   *
   * A derived physics limit has to be able to answer "what put it there". The
   * first table without this reported tall geometry at lateral 0.000 on the
   * start line and there was no way to tell a gantry footing from a stray card
   * without re-running the whole sweep.
   */
  readonly leftMesh: string | null;
  readonly rightMesh: string | null;
  /** Height above the local deck plane at the bounding vertex, per side. */
  readonly leftHeight: number | null;
  readonly rightHeight: number | null;
}

/** Lap resolution of the derived limit table. */
export const TALL_GEOMETRY_SPAN_METRES = 10;

/**
 * Below this, geometry does not BOUND the craft — it is something the craft
 * goes over rather than into.
 *
 * 0.85 m, just under the 0.89 m minimum hover height, and this is the
 * DERIVATION threshold only: the sweep's own obstacle classification still
 * starts at `FLAT_FURNITURE_MAX_HEIGHT_METRES` (0.3 m), so a 0.78 m cable coil
 * standing on the racing surface is still an obstacle and still has to move.
 * What it no longer does is generate an invisible wall.
 *
 * It was 0.5 m, and that put a derived limit at five Bitterpan spans where the
 * only tall thing was a 0.78 m coil the craft physically clears by 0.11 m.
 * An invisible boundary at a hazard you can visibly fly over is the exact feel
 * this phase exists to kill — and skimming a coil by 0.11 m is a near miss,
 * which is what the trip hazards are for.
 */
export const TALL_GEOMETRY_MIN_HEIGHT_METRES = 0.85;

interface MeshAccumulator {
  mesh: string;
  root: string;
  material: string;
  instance: number | null;
  visible: boolean;
  nonOccluding: boolean;
  vertices: number;
  depth: number;
  distance: number;
  lateral: number;
  height: number;
  heightMin: number;
  heightMax: number;
  sector: string;
  reach: number;
  innerExtent: number;
}

function displayName(object: THREE.Object3D): string {
  for (
    let node: THREE.Object3D | null = object;
    node;
    node = node.parent
  ) {
    if (node.name) return node === object ? node.name : `${node.name}/<unnamed>`;
  }
  return "<unnamed>";
}

/** The top-level scene child an object descends from. */
function rootName(object: THREE.Object3D, scene: THREE.Object3D): string {
  let top: THREE.Object3D = object;
  for (
    let node: THREE.Object3D | null = object;
    node && node !== scene;
    node = node.parent
  ) {
    top = node;
  }
  return top.name || `<${top.type}>`;
}

function materialName(mesh: THREE.Mesh): string {
  const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
  return material?.name || material?.type || "<none>";
}

function worldVisible(object: THREE.Object3D): boolean {
  for (
    let node: THREE.Object3D | null = object;
    node;
    node = node.parent
  ) {
    if (!node.visible) return false;
  }
  return true;
}

export interface CorridorSweepOptions {
  /**
   * Objects whose subtrees are not scenery — the player craft and the rival
   * field hover 0.89-1.31 m over the deck by design and would otherwise be the
   * loudest intrusions in the report.
   */
  readonly exclude?: readonly THREE.Object3D[];
  readonly lateralMargin?: number;
  readonly heightMin?: number;
  readonly heightMax?: number;
  /** Emit the per-span tall-geometry table. Off by default; see `spans`. */
  readonly collectSpans?: boolean;
}

/**
 * Walks `scene` and reports every mesh vertex standing in the driving corridor.
 *
 * The course-local conversion is the shipped inverse, deliberately: `project()`
 * resolves `lateral` along the BANKED `right` axis, so height has to come from
 * the same frame — `(v - position) · up`, minus the apron cross-section — and
 * not from a world-Y difference against the centreline. Measuring height in
 * world Y is what let the relocated hangar components pass their own check on a
 * 12-degree bank.
 */
export function sweepCorridor(
  scene: THREE.Object3D,
  course: RaceCourse,
  options: CorridorSweepOptions = {},
): CorridorSweepResult {
  const startedAt = performance.now();
  const lateralMargin = options.lateralMargin ?? CORRIDOR_LATERAL_MARGIN_METRES;
  const heightMin = options.heightMin ?? CORRIDOR_HEIGHT_MIN_METRES;
  const heightMax = options.heightMax ?? CORRIDOR_HEIGHT_MAX_METRES;
  const excluded = new Set(options.exclude ?? []);
  const collectSpans = options.collectSpans === true;

  // Station spacing tracks the authored tables: ~2 m on Greenwater, ~5 m on
  // Bitterpan. One station per 4 m of lap is finer than the grid cell either way.
  const stationCount = Math.max(256, Math.round(course.length / 4));
  const grid = new StationGrid(course, stationCount);

  scene.updateMatrixWorld(true);

  const projection: CourseProjection = course.createProjectionScratch();
  const apron: ApronResolution = createApronResolution();
  const vertex = new THREE.Vector3();
  const offset = new THREE.Vector3();
  const instanceMatrix = new THREE.Matrix4();
  const composed = new THREE.Matrix4();

  const accumulators = new Map<string, MeshAccumulator>();
  interface SpanSide {
    lateral: number;
    at: number;
    halfWidth: number;
    height: number;
    mesh: string;
  }
  interface SpanBucket {
    left: SpanSide | null;
    right: SpanSide | null;
    halfWidth: number;
    clamp: number;
  }
  const spanBuckets = new Map<number, SpanBucket>();
  const recordTallGeometry = (
    distance: number,
    lateral: number,
    halfWidth: number,
    clamp: number,
    height: number,
    mesh: string,
  ): void => {
    const index = Math.floor(distance / TALL_GEOMETRY_SPAN_METRES);
    let bucket = spanBuckets.get(index);
    if (!bucket) {
      bucket = { left: null, right: null, halfWidth, clamp };
      spanBuckets.set(index, bucket);
    }
    // Narrowest half-width and clamp across the span: the limit has to hold
    // everywhere in it, so the span takes its tightest station.
    bucket.halfWidth = Math.min(bucket.halfWidth, halfWidth);
    bucket.clamp = Math.min(bucket.clamp, clamp);
    const magnitude = Math.abs(lateral);
    const side: SpanSide = {
      lateral: magnitude, at: distance, halfWidth, height, mesh,
    };
    if (lateral < 0) {
      if (bucket.left === null || magnitude < bucket.left.lateral) {
        bucket.left = side;
      }
    } else if (bucket.right === null || magnitude < bucket.right.lateral) {
      bucket.right = side;
    }
  };
  let meshesSwept = 0;
  let instancesSwept = 0;
  let verticesSwept = 0;
  let verticesTested = 0;
  let skippedMeshes = 0;

  const sweepBatch = (
    mesh: THREE.Mesh,
    matrix: THREE.Matrix4,
    instance: number | null,
    positions: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
    visible: boolean,
  ): void => {
    const meshKey = `${mesh.id}#${instance ?? ""}`;
    for (let i = 0; i < positions.count; i += 1) {
      verticesSwept += 1;
      vertex.fromBufferAttribute(positions, i).applyMatrix4(matrix);
      // Cheap reject first: most of a 60-mesh environment is nowhere near the
      // ribbon, and a grid miss costs one map lookup instead of a projection.
      if (grid.isFarFromCourse(vertex.x, vertex.z)) continue;
      const hint = grid.hint(vertex.x, vertex.z);
      if (hint === null) continue;
      verticesTested += 1;
      course.project(vertex, hint, projection);
      const lateral = projection.lateral;
      // Two different limits, and keeping them apart is the point.
      //
      // The GATE is the deck: `halfWidth + margin`. That is what "nothing
      // stands on the racing surface" means, and it is the count that must
      // reach zero.
      //
      // The SWEEP is wider — out to the craft's clamp — because task 6 needs to
      // know where tall geometry begins across the whole reach in order to
      // derive the limit from it. `apronAt` resolves this span's edge type from
      // course data, so nothing here hardcodes which spans are open run-off.
      course.apronAt(projection, lateral, apron);
      const gate = projection.halfWidth + lateralMargin;
      // The AUTHORED reach, rebuilt from the apron width — deliberately NOT
      // `apron.lateralLimit`, which now returns the DERIVED limit.
      //
      // The derivation must be idempotent, and using the live clamp made it
      // catastrophically not. Once `DRIVABLE_LIMITS.json` was consumed, the
      // sweep saw the already-narrowed limit, stopped recording the very wall
      // geometry that set it — the wall sits just OUTSIDE the limit it produced,
      // by the 1.6 m hull margin — and a re-derivation collapsed Greenwater from
      // 232 bounded spans to 3. Committing that table would have silently
      // restored the original over-wide clamp and the void with it.
      const clamp = apron.width > 0
        ? projection.halfWidth + apron.width
        : apron.roadLimit;
      const distance = projection.progress * course.length;
      const surface = surfaceHeightAtLateral(projection, lateral);
      const height = offset.subVectors(vertex, projection.position)
        .dot(projection.up) - surface;
      // Tall geometry anywhere inside the clamp bounds the craft, whichever
      // side of the deck edge it stands on. Recorded before the gate test,
      // because most of it is legitimately outside the deck.
      // Only geometry in the DRIVING band bounds the craft. The upper edge is
      // the plaque band, not the sweep ceiling: the Cradle gantry's beam
      // crosses the track at 3.5 m and would otherwise collapse the derived
      // limit to lateral 0 on the start line, which is exactly what the first
      // span table did (`d=0 left 0`).
      if (
        height >= TALL_GEOMETRY_MIN_HEIGHT_METRES
        && height < PLAQUE_BAND_BOTTOM_METRES
        && Math.abs(lateral) <= clamp
      ) {
        if (collectSpans) {
          recordTallGeometry(
            distance,
            lateral,
            projection.halfWidth,
            clamp,
            height,
            displayName(mesh),
          );
        }
      }
      const depth = gate - Math.abs(lateral);
      if (depth <= 0) continue;
      if (height < heightMin || height > heightMax) continue;
      const key = `${meshKey}@${Math.floor(distance / INTRUSION_GROUP_METRES)}`;
      let accumulator = accumulators.get(key);
      if (!accumulator) {
        accumulator = {
          mesh: displayName(mesh),
          root: rootName(mesh, scene),
          material: materialName(mesh),
          instance,
          visible,
          nonOccluding: isNonOccludingOverlay(mesh),
          vertices: 0,
          depth: -Infinity,
          distance: 0,
          lateral: 0,
          height: 0,
          heightMin: Infinity,
          heightMax: -Infinity,
          sector: projection.sector,
          reach: clamp,
          innerExtent: Infinity,
        };
        accumulators.set(key, accumulator);
      }
      accumulator.vertices += 1;
      if (Math.abs(lateral) < accumulator.innerExtent) {
        accumulator.innerExtent = Math.abs(lateral);
        accumulator.reach = clamp;
      }
      accumulator.heightMin = Math.min(accumulator.heightMin, height);
      accumulator.heightMax = Math.max(accumulator.heightMax, height);
      // Report the deepest vertex: that is the one a relocation has to clear.
      if (depth > accumulator.depth) {
        accumulator.depth = depth;
        accumulator.distance = distance;
        accumulator.lateral = lateral;
        accumulator.height = height;
        accumulator.sector = projection.sector;
      }
    }
  };

  scene.traverse((object) => {
    if (excluded.has(object)) return;
    for (
      let node: THREE.Object3D | null = object;
      node;
      node = node.parent
    ) {
      if (excluded.has(node)) return;
    }
    if (!(object instanceof THREE.Mesh)) return;
    const positions = object.geometry?.getAttribute("position");
    if (!positions) {
      skippedMeshes += 1;
      return;
    }
    const visible = worldVisible(object);
    if (object instanceof THREE.InstancedMesh) {
      meshesSwept += 1;
      for (let index = 0; index < object.count; index += 1) {
        object.getMatrixAt(index, instanceMatrix);
        composed.multiplyMatrices(object.matrixWorld, instanceMatrix);
        instancesSwept += 1;
        sweepBatch(object, composed, index, positions, visible);
      }
      return;
    }
    meshesSwept += 1;
    sweepBatch(object, object.matrixWorld, null, positions, visible);
  });

  const ordered = [...accumulators.values()]
    .map((entry): CorridorIntrusion => ({
      mesh: entry.mesh,
      root: entry.root,
      material: entry.material,
      instance: entry.instance,
      distance: Number(entry.distance.toFixed(2)),
      lateral: Number(entry.lateral.toFixed(3)),
      height: Number(entry.height.toFixed(3)),
      depth: Number(entry.depth.toFixed(3)),
      heightMin: Number(entry.heightMin.toFixed(3)),
      heightMax: Number(entry.heightMax.toFixed(3)),
      vertices: entry.vertices,
      visible: entry.visible,
      sector: entry.sector,
      reach: Number(entry.reach.toFixed(3)),
      innerExtent: Number(entry.innerExtent.toFixed(3)),
      band: classifyCorridorBand(
        entry.heightMin,
        entry.heightMax,
        entry.depth,
        entry.nonOccluding,
      ),
    }))
    .sort((a, b) => b.depth - a.depth);

  const visibleList = ordered.filter((entry) => entry.visible);
  const hiddenList = ordered.filter((entry) => !entry.visible);
  // P16 stage 2 — the gate counts hidden geometry exactly like visible.
  //
  // It did not, and that was a hole. `updateVisibility` culls distant sector
  // groups, so at the moment the sweep fires a whole sector can be hidden; an
  // obstacle standing on the deck in a culled sector swept as hidden, passed a
  // gate that only looked at visible entries, and then popped into view mid-lap.
  // Visibility is a render optimisation and says nothing about whether the
  // world contains the thing.
  //
  // The only exclusions that survive are by CONSTRUCTION — race entities, which
  // never enter the traversal at all, and non-occluding overlays, which are
  // classified from their own material. Neither depends on what the camera
  // could see at one instant.
  const obstacles = ordered.filter((entry) => entry.band === "obstacle");
  const hiddenByBand: Record<CorridorBand, number> = {
    flush: 0, obstacle: 0, overhead: 0, boundary: 0, vfx: 0,
  };
  for (const entry of hiddenList) hiddenByBand[entry.band] += 1;
  return {
    ran: true,
    map: course.kind,
    meshesSwept,
    instancesSwept,
    verticesSwept,
    verticesTested,
    skippedMeshes,
    intrusions: obstacles.length,
    flush: visibleList.filter((entry) => entry.band === "flush").length,
    overhead: visibleList.filter((entry) => entry.band === "overhead").length,
    boundary: visibleList.filter((entry) => entry.band === "boundary").length,
    vfx: visibleList.filter((entry) => entry.band === "vfx").length,
    hiddenIntrusions: hiddenList.length,
    hiddenByBand,
    // Obstacles first: the list is capped, and the capped-out tail must never
    // be the thing that had to be fixed.
    spans: [...spanBuckets.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([index, bucket]): TallGeometrySpan => ({
        distance: index * TALL_GEOMETRY_SPAN_METRES,
        left: bucket.left === null
          ? null
          : Number(bucket.left.lateral.toFixed(3)),
        right: bucket.right === null
          ? null
          : Number(bucket.right.lateral.toFixed(3)),
        leftAt: bucket.left === null ? null : Number(bucket.left.at.toFixed(2)),
        rightAt: bucket.right === null
          ? null
          : Number(bucket.right.at.toFixed(2)),
        leftHalfWidth: bucket.left === null
          ? null
          : Number(bucket.left.halfWidth.toFixed(3)),
        rightHalfWidth: bucket.right === null
          ? null
          : Number(bucket.right.halfWidth.toFixed(3)),
        halfWidth: Number(bucket.halfWidth.toFixed(3)),
        clamp: Number(bucket.clamp.toFixed(3)),
        leftMesh: bucket.left?.mesh ?? null,
        rightMesh: bucket.right?.mesh ?? null,
        leftHeight: bucket.left === null
          ? null
          : Number(bucket.left.height.toFixed(3)),
        rightHeight: bucket.right === null
          ? null
          : Number(bucket.right.height.toFixed(3)),
      })),
    // Obstacles first regardless of visibility — the capped tail must never be
    // the thing that had to be fixed, and a hidden obstacle is still an
    // obstacle.
    list: [
      ...obstacles,
      ...visibleList.filter((entry) => entry.band !== "obstacle"),
      ...hiddenList.filter((entry) => entry.band !== "obstacle"),
    ].slice(0, MAX_REPORTED_INTRUSIONS),
    elapsedMs: Number((performance.now() - startedAt).toFixed(1)),
  };
}
