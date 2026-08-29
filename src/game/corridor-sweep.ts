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
export type CorridorBand = "flush" | "obstacle" | "overhead" | "boundary";

/**
 * How far a vertex may sit inside the deck edge and still be the track's own
 * boundary rather than something standing on the road.
 *
 * The kerb and apron meshes are authored to OVERLAP the deck seam so no crack
 * shows between them — `APRON_SEAM_OVERLAP_METRES` is 0.06 m, and the Bitterpan
 * kerb measures 0.045 m inside its own deck edge. Without this tolerance every
 * one of those seams reads as an obstacle: 92 of Bitterpan's first 97.
 */
const BOUNDARY_SEAM_TOLERANCE_METRES = 0.1;

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
): CorridorBand {
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
  /** Intrusions from meshes hidden at sweep time, reported separately. */
  readonly hiddenIntrusions: number;
  readonly list: readonly CorridorIntrusion[];
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
  hiddenIntrusions: 0,
  list: Object.freeze([]) as readonly CorridorIntrusion[],
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

  constructor(course: RaceCourse, stationCount: number) {
    const scratch = course.createSampleScratch();
    for (let index = 0; index < stationCount; index += 1) {
      const progress = index / stationCount;
      const sample = course.sample(progress, scratch);
      this.progressOf.push(progress);
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

  /** Progress hint for a world point, or null when nothing is near enough. */
  hint(x: number, z: number): number | null {
    const bucket = this.cells.get(StationGrid.key(x, z));
    if (!bucket || bucket.length === 0) return null;
    return this.progressOf[bucket[0]];
  }

  /** True when no station registered a cell anywhere near this point. */
  isFarFromCourse(x: number, z: number): boolean {
    return !this.cells.has(StationGrid.key(x, z));
  }
}

/**
 * How far out the craft can be driven and held, per side and per span.
 *
 * On an UNWALLED edge (Greenwater's C / OPEN_RUNOFF, Bitterpan's OPEN_PAN) there
 * is nothing to stop the craft, so the whole run-off is drivable and the reach
 * is `halfWidth + width` — 5.8 m past the deck on both maps. Anything standing
 * in there is something the player drives into, which is the P16 (B) report:
 * held on the Cradle Bend run-off, the hull interpenetrated an edge wall board.
 *
 * On a WALLED edge (A, B) the wall is the boundary the player sees and hits, so
 * the visual reach is the deck itself.
 *
 * A MEASURED CAVEAT, and it is not small. `resolveApron` sets
 * `lateralLimit = halfWidth + width` for EVERY edge, walled or not, and
 * `game.ts:893` clamps `this.lateral` to it unconditionally — `apron.wall` only
 * gates the impact FX at line 905. So the simulation actually lets the craft's
 * CENTRE reach 16.0 m at Cradle Bend while the wall it just drove through
 * stands at 10.76 m. This function deliberately uses the visual boundary rather
 * than that clamp, because treating the clamp as the corridor would classify
 * every trackside wall on both maps as an obstacle in its own road. The clamp
 * overshoot is real, is pre-existing, and is a physics question — out of scope
 * here, reported instead.
 */
function drivableReach(
  halfWidth: number,
  apron: ApronResolution,
  lateralMargin: number,
): number {
  const outer = apron.wall || apron.width <= 0
    ? halfWidth
    : halfWidth + apron.width;
  return outer + lateralMargin;
}

interface MeshAccumulator {
  mesh: string;
  root: string;
  material: string;
  instance: number | null;
  visible: boolean;
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
      // The corridor is the DRIVABLE REACH, not the deck. `apronAt` resolves
      // this span's edge type from course data — nothing here hardcodes which
      // spans are C — and returns both the run-off width and whether that edge
      // ends in a wall.
      course.apronAt(projection, lateral, apron);
      const reach = drivableReach(projection.halfWidth, apron, lateralMargin);
      const depth = reach - Math.abs(lateral);
      if (depth <= 0) continue;
      const surface = surfaceHeightAtLateral(projection, lateral);
      const height = offset.subVectors(vertex, projection.position)
        .dot(projection.up) - surface;
      if (height < heightMin || height > heightMax) continue;
      const distance = projection.progress * course.length;
      const key = `${meshKey}@${Math.floor(distance / INTRUSION_GROUP_METRES)}`;
      let accumulator = accumulators.get(key);
      if (!accumulator) {
        accumulator = {
          mesh: displayName(mesh),
          root: rootName(mesh, scene),
          material: materialName(mesh),
          instance,
          visible,
          vertices: 0,
          depth: -Infinity,
          distance: 0,
          lateral: 0,
          height: 0,
          heightMin: Infinity,
          heightMax: -Infinity,
          sector: projection.sector,
          reach,
          innerExtent: Infinity,
        };
        accumulators.set(key, accumulator);
      }
      accumulator.vertices += 1;
      if (Math.abs(lateral) < accumulator.innerExtent) {
        accumulator.innerExtent = Math.abs(lateral);
        accumulator.reach = reach;
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
      ),
    }))
    .sort((a, b) => b.depth - a.depth);

  const visibleList = ordered.filter((entry) => entry.visible);
  const obstacles = visibleList.filter((entry) => entry.band === "obstacle");
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
    hiddenIntrusions: ordered.length - visibleList.length,
    // Obstacles first: the list is capped, and the capped-out tail must never
    // be the thing that had to be fixed.
    list: [
      ...obstacles,
      ...visibleList.filter((entry) => entry.band !== "obstacle"),
      ...ordered.filter((entry) => !entry.visible),
    ].slice(0, MAX_REPORTED_INTRUSIONS),
    elapsedMs: Number((performance.now() - startedAt).toFixed(1)),
  };
}
