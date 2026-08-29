import * as THREE from "three";

import {
  FLAT_FURNITURE_MAX_HEIGHT_METRES,
  PLAQUE_BAND_BOTTOM_METRES,
} from "./furniture-placement.js";
import { surfaceHeightAtLateral } from "./course";
import type { CourseProjection, RaceCourse } from "./course";

/**
 * P16 — re-seating authored geometry onto the banked deck at runtime.
 *
 * `greenwater_surface_character_runtime.glb` is a decal sheet: one mesh, 776
 * triangles, unlit, `transparent`, `depthWrite = false`, `polygonOffset = -2`.
 * Every one of those settings says "painted onto the road". It was authored
 * FLAT, though, and the deck is banked up to 12 degrees, so on every banked
 * sector the paint floats off the surface it is supposed to be printed on by
 * `|lateral| * sin(bank)` — 1.8 m out over the Greenwater Sweep, hanging in the
 * air beside the craft.
 *
 * That is the same bug P11 fixed for the craft with `bankedSurfaceLift` and the
 * same one the apron cross-section term fixes for the hover height: a layer
 * deriving a world pose from (progress, lateral) and taking the centreline `y`
 * alone. It is worth being precise that this is a REPROJECTION and not a
 * relocation — the marks keep their distance along the lap and their lateral
 * offset exactly, and only their height changes. Moving them sideways would
 * drag the track's own grime off the road.
 *
 * Confirmed by measurement before it was written: across the 31 groups the
 * corridor sweep flagged, measured height over `|lateral| * sin(bank)` averaged
 * 1.038, and 28 of the 31 sat between 1.046 and 1.120. The residual is the
 * authored lift, which this pass preserves.
 */

/** Beyond this, a vertex is not decal work and is left alone. */
const MAX_REPROJECTED_LIFT_METRES = 0.6;

export interface CourseReprojectionStats {
  readonly vertices: number;
  readonly moved: number;
  readonly maxCorrectionMetres: number;
  readonly skipped: number;
}

/**
 * Re-seats every vertex of `root` onto the banked deck, preserving each one's
 * lap distance, lateral offset and authored lift above the surface.
 *
 * The flat authoring is what makes this recoverable. For a flat sheet the offset
 * from the centreline decomposes into a horizontal lateral and a world-vertical
 * lift, so both survive being read back: the lateral is measured against the
 * UN-banked right axis (the banked one already carries the error), and the lift
 * is the plain world-Y difference. The vertex is then rebuilt in the banked
 * frame at the same lateral, which is where the deck actually is.
 */
export function reprojectOntoBankedDeck(
  root: THREE.Object3D,
  course: RaceCourse,
): CourseReprojectionStats {
  root.updateMatrixWorld(true);
  const projection: CourseProjection = course.createProjectionScratch();
  const world = new THREE.Vector3();
  const offset = new THREE.Vector3();
  const unbankedRight = new THREE.Vector3();
  const rebuilt = new THREE.Vector3();
  const inverse = new THREE.Matrix4();

  let vertices = 0;
  let moved = 0;
  let skipped = 0;
  let maxCorrection = 0;

  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const positions = object.geometry?.getAttribute("position");
    if (!positions || positions.count === 0) return;
    inverse.copy(object.matrixWorld).invert();
    let hint = 0;

    for (let i = 0; i < positions.count; i += 1) {
      vertices += 1;
      world.fromBufferAttribute(positions, i).applyMatrix4(object.matrixWorld);
      course.project(world, hint, projection);
      hint = projection.progress;

      // Undo the bank on `right` to recover the axis the sheet was authored
      // against. `sample()` rotates the frame by -bank, so +bank restores it.
      unbankedRight
        .copy(projection.right)
        .applyAxisAngle(
          projection.tangent,
          THREE.MathUtils.degToRad(projection.bank),
        )
        .normalize();

      offset.subVectors(world, projection.position);
      const lateral = offset.dot(unbankedRight);
      const lift = offset.y;
      if (!Number.isFinite(lateral) || !Number.isFinite(lift)) {
        skipped += 1;
        continue;
      }
      // A vertex sitting well above the flat plane is not paint — leave it
      // exactly where the artist put it rather than flattening it onto the road.
      if (Math.abs(lift) > MAX_REPROJECTED_LIFT_METRES) {
        skipped += 1;
        continue;
      }

      const surface = surfaceHeightAtLateral(projection, lateral);
      rebuilt
        .copy(projection.position)
        .addScaledVector(projection.right, lateral)
        .addScaledVector(projection.up, surface + lift);

      const correction = rebuilt.distanceTo(world);
      if (correction > 1e-4) {
        moved += 1;
        maxCorrection = Math.max(maxCorrection, correction);
      }
      rebuilt.applyMatrix4(inverse);
      positions.setXYZ(i, rebuilt.x, rebuilt.y, rebuilt.z);
    }
    positions.needsUpdate = true;
    object.geometry.computeBoundingSphere();
    object.geometry.computeBoundingBox();
  });

  return {
    vertices,
    moved,
    maxCorrectionMetres: Number(maxCorrection.toFixed(4)),
    skipped,
  };
}

// ---------------------------------------------------------------------------
// Relocation — for geometry that is an object, not paint.
// ---------------------------------------------------------------------------

/** Outward clearance added past the corridor wall when a component is moved. */
const RELOCATION_CLEARANCE_METRES = 0.35;

/** Below this many vertices a component is noise, not a prop. */
const MIN_COMPONENT_VERTICES = 3;

/**
 * The obstacle band, taken from the same two shipped constants
 * `corridor-sweep.ts` classifies against — `furniture-placement.js` — rather
 * than from `corridor-sweep.ts` itself.
 *
 * That indirection is load-bearing for the download, not style. This pass runs
 * on every normal session, and importing the sweep for its constants dragged
 * the sweep, its station grid and its projection machinery into the initial
 * bundle: 1,037.8 KiB against a 950 KiB budget. Sharing the ROOT constants
 * keeps the two in agreement without the diagnostics instrument shipping to
 * players who never arm it.
 */
export const OBSTACLE_HEIGHT_MIN_METRES = FLAT_FURNITURE_MAX_HEIGHT_METRES;
export const OBSTACLE_HEIGHT_MAX_METRES = PLAQUE_BAND_BOTTOM_METRES;
export const OBSTACLE_LATERAL_MARGIN_METRES = 0.5;
export const OBSTACLE_SEAM_TOLERANCE_METRES = 0.1;

export interface RelocatedComponent {
  readonly mesh: string;
  readonly distance: number;
  readonly fromLateral: number;
  readonly toLateral: number;
  readonly shift: number;
  readonly heightMin: number;
  readonly heightMax: number;
  readonly vertices: number;
}

export interface CourseRelocationStats {
  readonly components: number;
  readonly relocated: number;
  readonly maxShiftMetres: number;
  readonly moved: readonly RelocatedComponent[];
}

/**
 * Connected components of a mesh, welded by position so hard-edge vertex splits
 * do not tear one prop into six.
 *
 * `environment.ts` has a version of this for its hangar-barrier repair, but that
 * one requires an indexed geometry and throws by name if it is not. The merged
 * per-sector environment meshes are not all indexed, so this handles both:
 * indexed geometry unions through the index buffer, non-indexed through
 * consecutive triangles.
 */
function findComponents(geometry: THREE.BufferGeometry): number[][] {
  const positions = geometry.getAttribute("position");
  if (!positions) return [];
  const parents = Array.from({ length: positions.count }, (_, i) => i);
  const find = (vertex: number): number => {
    let root = vertex;
    while (parents[root] !== root) root = parents[root];
    let walk = vertex;
    while (parents[walk] !== walk) {
      const next = parents[walk];
      parents[walk] = root;
      walk = next;
    }
    return root;
  };
  const union = (a: number, b: number): void => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parents[rootB] = rootA;
  };

  // Weld coincident positions first: a cube exported with hard edges has 24
  // vertices at 8 locations, and without welding it reads as six loose quads.
  const welded = new Map<string, number>();
  for (let i = 0; i < positions.count; i += 1) {
    const key = `${positions.getX(i).toFixed(3)}:`
      + `${positions.getY(i).toFixed(3)}:${positions.getZ(i).toFixed(3)}`;
    const first = welded.get(key);
    if (first === undefined) welded.set(key, i);
    else union(first, i);
  }

  const index = geometry.index;
  if (index) {
    for (let i = 0; i + 2 < index.count; i += 3) {
      union(index.getX(i), index.getX(i + 1));
      union(index.getX(i + 1), index.getX(i + 2));
    }
  } else {
    for (let i = 0; i + 2 < positions.count; i += 3) {
      union(i, i + 1);
      union(i + 1, i + 2);
    }
  }

  const groups = new Map<number, number[]>();
  for (let i = 0; i < positions.count; i += 1) {
    const root = find(i);
    const bucket = groups.get(root);
    if (bucket) bucket.push(i);
    else groups.set(root, [i]);
  }
  return [...groups.values()];
}

/**
 * Moves any connected component standing on the racing surface outward until it
 * clears the corridor, and leaves everything else untouched.
 *
 * Modelled on `relocateHangarSixEdgeBarriers`, with its one measurement flaw
 * fixed: that pass classifies by `centerWorld.y - projection.position.y`, a raw
 * world-Y difference against the centreline, which on a banked sector is wrong
 * by `lateral * sin(bank)` — up to 2.2 m on the Greenwater Sweep. Height here is
 * `(v - position) . up` minus the apron cross-section, the same course-local
 * measure the corridor sweep gates on, so what this pass moves and what the
 * sweep counts cannot disagree.
 *
 * The shift is along the banked `right`, per component, sized from the deepest
 * intruding vertex — never a fixed nudge, because the objects range from a slab
 * 0.31 m off the centreline to a wall face 0.24 m inside the deck edge.
 */
export function relocateCorridorObstacles(
  root: THREE.Object3D,
  course: RaceCourse,
  options: {
    readonly lateralMargin: number;
    readonly heightMin: number;
    readonly heightMax: number;
    readonly seamTolerance: number;
  },
): CourseRelocationStats {
  root.updateMatrixWorld(true);
  const projection: CourseProjection = course.createProjectionScratch();
  const world = new THREE.Vector3();
  const offset = new THREE.Vector3();
  const shifted = new THREE.Vector3();
  const inverse = new THREE.Matrix4();

  let components = 0;
  let maxShift = 0;
  const moved: RelocatedComponent[] = [];

  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const positions = object.geometry?.getAttribute("position");
    if (!positions) return;
    inverse.copy(object.matrixWorld).invert();

    for (const component of findComponents(object.geometry)) {
      components += 1;
      if (component.length < MIN_COMPONENT_VERTICES) continue;

      // Pass one: does this component stand in the corridor, and how deep?
      //
      // The test is on the component's height SPAN, not on individual vertices,
      // and matching the sweep's group-level classification here is load-bearing.
      // A slim post has vertices only at its base and its cap: a 6-vertex
      // `GW_SECTOR_FUEL_ROW_metal` component at 1829.91 m measured 0.093 m and
      // 3.563 m and NOTHING between, so an in-band vertex test saw nothing while
      // the post itself passed straight through the driving volume. It swept as
      // an obstacle and was skipped by the mover — the two disagreed, which is
      // precisely the failure this pass exists to prevent. Geometry that crosses
      // the band is in the band.
      let worstShift = 0;
      let side = 0;
      let atDistance = 0;
      let atLateral = 0;
      let bandMin = Infinity;
      let bandMax = -Infinity;
      let hint = 0;
      const samples: {
        lateral: number;
        height: number;
        depth: number;
        distance: number;
      }[] = [];
      for (const vertex of component) {
        world.fromBufferAttribute(positions, vertex)
          .applyMatrix4(object.matrixWorld);
        course.project(world, hint, projection);
        hint = projection.progress;
        const lateral = projection.lateral;
        const height = offset.subVectors(world, projection.position)
          .dot(projection.up)
          - surfaceHeightAtLateral(projection, lateral);
        bandMin = Math.min(bandMin, height);
        bandMax = Math.max(bandMax, height);
        samples.push({
          lateral,
          height,
          depth: projection.halfWidth + options.lateralMargin - Math.abs(lateral),
          distance: projection.progress * course.length,
        });
      }
      // Overlap, not containment: below the band AND above it still crosses it.
      const crossesBand = bandMax > options.heightMin
        && bandMin < options.heightMax;
      if (!crossesBand) continue;
      // Size the shift from vertices actually inside the band where there are
      // any; otherwise the post is only known by its ends, so use them.
      const inBand = samples.filter((entry) => (
        entry.height >= options.heightMin && entry.height <= options.heightMax
      ));
      for (const entry of (inBand.length > 0 ? inBand : samples)) {
        if (entry.depth <= options.lateralMargin + options.seamTolerance) continue;
        if (entry.depth > worstShift) {
          worstShift = entry.depth;
          // Push toward the nearer edge. A slab lying across the centreline has
          // no natural side, and the shorter move disturbs less of the scene.
          side = entry.lateral === 0 ? 1 : Math.sign(entry.lateral);
          atDistance = entry.distance;
          atLateral = entry.lateral;
        }
      }
      if (worstShift <= 0) continue;

      const shift = worstShift + RELOCATION_CLEARANCE_METRES;
      maxShift = Math.max(maxShift, shift);
      hint = 0;
      for (const vertex of component) {
        world.fromBufferAttribute(positions, vertex)
          .applyMatrix4(object.matrixWorld);
        course.project(world, hint, projection);
        hint = projection.progress;
        shifted.copy(world).addScaledVector(projection.right, side * shift);
        shifted.applyMatrix4(inverse);
        positions.setXYZ(vertex, shifted.x, shifted.y, shifted.z);
      }
      positions.needsUpdate = true;
      moved.push({
        mesh: object.name || "<unnamed>",
        distance: Number(atDistance.toFixed(2)),
        fromLateral: Number(atLateral.toFixed(3)),
        toLateral: Number((atLateral + side * shift).toFixed(3)),
        shift: Number(shift.toFixed(3)),
        heightMin: Number(bandMin.toFixed(3)),
        heightMax: Number(bandMax.toFixed(3)),
        vertices: component.length,
      });
    }
    object.geometry.computeBoundingSphere();
    object.geometry.computeBoundingBox();
  });

  return {
    components,
    relocated: moved.length,
    maxShiftMetres: Number(maxShift.toFixed(3)),
    moved,
  };
}
