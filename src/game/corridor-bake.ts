import * as THREE from "three";
import type { RaceCourse } from "./course";
import {
  OBSTACLE_HEIGHT_MAX_METRES,
  OBSTACLE_HEIGHT_MIN_METRES,
  OBSTACLE_LATERAL_MARGIN_METRES,
  OBSTACLE_SEAM_TOLERANCE_METRES,
  relocateCorridorObstacles,
  type CourseRelocationStats,
} from "./course-repair";

type Bake = typeof import("./data/GREENWATER_CORRIDOR_RELOCATION.json");

/**
 * The corridor repair for any circuit that runs it (Greenwater, Bitterpan):
 * Greenwater's baked answer when it applies, otherwise the full pass. The
 * 0.5 MB bake is a separate dynamic import, so Bitterpan never downloads it.
 */
export async function clearCorridor(root: THREE.Object3D, course: RaceCourse): Promise<CourseRelocationStats> {
  if (course.kind === "greenwater") {
    const bake = (await import("./data/GREENWATER_CORRIDOR_RELOCATION.json")).default as Bake;
    const baked = applyCorridorBake(root, course, bake);
    if (baked) return baked;
  }
  return relocateCorridorObstacles(root, course, {
    lateralMargin: OBSTACLE_LATERAL_MARGIN_METRES,
    heightMin: OBSTACLE_HEIGHT_MIN_METRES,
    heightMax: OBSTACLE_HEIGHT_MAX_METRES,
    seamTolerance: OBSTACLE_SEAM_TOLERANCE_METRES,
  });
}

/**
 * Applies Greenwater's baked corridor relocation in O(moved vertices).
 *
 * `relocateCorridorObstacles` projects all 114,940 environment vertices onto
 * the course: ~900 ms of main thread on every Greenwater load (measured on the
 * prod build, 881/906/903 ms). Its input is the sha256-pinned GLB after the two
 * deterministic repairs in `repairGreenwaterRuntimeGeometry`, so
 * `scripts/derive-corridor-relocation.mjs` runs the real pass once under Node and
 * stores the 18,314 vertices it moves; `--check` in `test:code` re-derives it
 * byte-for-byte.
 *
 * Returns null — and `clearCorridor` runs the full pass — whenever the input is not
 * the one the bake was derived from: `?corridorbake=0`, a different marsh-plant
 * or hangar-barrier repair count (e.g. the signature dock failed to load), a
 * mesh with a different vertex count, or moved vertices whose pre-bake positions
 * do not sum to the recorded checksum. A mismatch costs time, never geometry.
 */
interface BakedMesh {
  readonly mesh: string;
  readonly vertexCount: number;
  readonly beforeChecksum: number;
  readonly runs: readonly (readonly [number, number])[];
  readonly positions: readonly number[];
}

export function applyCorridorBake(
  root: THREE.Object3D,
  course: RaceCourse,
  BAKE: Bake,
): CourseRelocationStats | null {
  if (course.kind !== "greenwater") return null;
  if (new URLSearchParams(location.search).get("corridorbake") === "0") return null;
  const reject = (why: string): null => {
    console.warn(`[FUTURISMA_CORRIDOR] bake not applied (${why}); running the full relocation.`);
    return null;
  };
  const marsh = course.group.getObjectByName("circuit_signature")?.userData.relocatedMarshPlants;
  if (marsh !== BAKE.preconditions.relocatedMarshPlants) return reject(`marsh plants ${marsh}`);
  const hangar = root.getObjectByName("GW_SECTOR_HANGAR_SIX_concrete")?.userData.runtimeRouteRepair?.relocatedComponents;
  if (hangar !== BAKE.preconditions.hangarComponents) return reject(`hangar barriers ${hangar}`);

  const meshes = BAKE.meshes as unknown as readonly BakedMesh[];
  const targets: THREE.Mesh[] = [];
  for (const entry of meshes) {
    const mesh = root.getObjectByName(entry.mesh);
    const positions = mesh instanceof THREE.Mesh ? mesh.geometry.getAttribute("position") : null;
    if (!positions || positions.count !== entry.vertexCount) return reject(`${entry.mesh} vertex count`);
    let checksum = 0;
    for (const [first, count] of entry.runs) {
      for (let vertex = first; vertex < first + count; vertex += 1) {
        checksum += positions.getX(vertex) + positions.getY(vertex) + positions.getZ(vertex);
      }
    }
    if (Math.abs(checksum - entry.beforeChecksum) > 0.01) return reject(`${entry.mesh} checksum`);
    targets.push(mesh as THREE.Mesh);
  }

  meshes.forEach((entry, index) => {
    const geometry = targets[index].geometry;
    const positions = geometry.getAttribute("position");
    let read = 0;
    for (const [first, count] of entry.runs) {
      for (let vertex = first; vertex < first + count; vertex += 1, read += 3) {
        positions.setXYZ(vertex, entry.positions[read], entry.positions[read + 1], entry.positions[read + 2]);
      }
    }
    positions.needsUpdate = true;
    geometry.computeBoundingSphere();
    geometry.computeBoundingBox();
  });
  console.info(`[FUTURISMA_CORRIDOR] baked relocation applied: ${BAKE.stats.relocated} components, ${BAKE.movedVertices} vertices.`);
  return BAKE.stats as unknown as CourseRelocationStats;
}
