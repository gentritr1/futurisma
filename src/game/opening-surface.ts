import * as THREE from "three";
import atlasRegionsJson from "./data/ATLAS_REGIONS.json";
import openingDecalsJson from "./data/GREENWATER_OPENING_SURFACE_DECALS.json";
import { type CourseSample, type RaceCourse, surfaceHeightAtLateral } from "./course";

/**
 * P12 art pass 01 — the Greenwater opening straight, painted.
 *
 * 200 authored decals (threshold, designator, touchdown zone, grid boxes and
 * numerals, centreline, edge and shoulder work, taxi dashes, hazard banding and
 * the wear scatter over the top) collapsed into ONE mesh, ONE material, ONE
 * draw call, 400 triangles.
 *
 * The sibling of `surface-character.ts` and deliberately built to the same
 * material contract — unlit, vertex-coloured, nearest-filtered with no mip
 * chain, `polygonOffset -2/-2` and `depthWrite: false` so it lies on the deck
 * without z-fighting it and without occluding anything that follows. Where it
 * differs: the surface character ships as an authored GLB with baked vertices,
 * whereas this layer is BUILT from JSON against the live course, because a
 * decal has to follow the deck it is painted on.
 *
 * Two things that follow from that, and are the whole reason this is not a
 * flat quad list:
 *
 * 1. **Bank.** `sample.right` is already rotated into the banked deck plane, so
 *    placing a vertex at `position + right * lateral` puts it ON the surface at
 *    any bank. The opening straight is unbanked, but the layer is built the
 *    correct way regardless — nothing here assumes a flat sector.
 * 2. **The apron.** 29 of the 200 decals sit past `halfWidth` (shoulder
 *    chevrons at 13.8 m, hazard bands at 16.5 m, taxi dashes on the apron), and
 *    an A-apron falls 0.12 m across its width. Those vertices ride the same
 *    cross-section `createApronDecks` draws, via the shared
 *    `surfaceHeightAtLateral` — not a flat extrapolation of the deck plane.
 *
 * Every vertex is sampled at its OWN distance around the lap rather than off
 * one sample per decal, so a long decal on a curve follows the centreline
 * instead of cutting the chord.
 */

const MESH_NAME = "GW_OPENING_SURFACE";
const MATERIAL_NAME = "GW_OPENING_SURFACE";
const VERTICES_PER_DECAL = 4;
const TRIANGLES_PER_DECAL = 2;

/**
 * Lift off the drawn surface, in metres. `polygonOffset` already resolves the
 * depth fight; this is the belt to its braces on drivers that quantise the
 * offset, and is far below the 0.89 m minimum hover height so it can never be
 * seen as a gap.
 */
const DECAL_LIFT_METRES = 0.012;

interface AtlasRegion {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface AtlasSheet {
  texture: string;
  width: number;
  height: number;
  sha256: string;
  regions: Record<string, AtlasRegion>;
}

interface SurfaceDecal {
  slot: string;
  distance: number;
  lateral: number;
  width: number;
  length: number;
  rotationDeg: number;
  tint: string;
  alpha: number;
}

const ATLAS_SHEETS = atlasRegionsJson as unknown as Record<string, AtlasSheet>;
const OPENING_DECALS = openingDecalsJson as unknown as {
  texture: string;
  decalCount: number;
  triangles: number;
  decals: SurfaceDecal[];
};

export interface GreenwaterOpeningSurfaceStats {
  drawCalls: number;
  decals: number;
  triangles: number;
  materials: number;
  textures: number;
  shaderModel: "unlit";
}

/**
 * Corner order is fixed so both triangles wind with their normal along
 * `sample.up`: `right x tangent === up` in the course basis, so
 * `(0,1,2)` and `(2,1,3)` both face the sky and the layer needs no
 * double-sided material to be visible.
 */
const CORNERS: ReadonlyArray<{ u: number; v: number; su: number; sv: number }> = [
  { u: -0.5, v: -0.5, su: 0, sv: 0 },
  { u: 0.5, v: -0.5, su: 1, sv: 0 },
  { u: -0.5, v: 0.5, su: 0, sv: 1 },
  { u: 0.5, v: 0.5, su: 1, sv: 1 },
];

const CORNER_INDICES = [0, 1, 2, 2, 1, 3];

export class GreenwaterOpeningSurface {
  readonly stats: GreenwaterOpeningSurfaceStats;

  private constructor(readonly root: THREE.Group, stats: GreenwaterOpeningSurfaceStats) {
    this.stats = stats;
  }

  static build(course: RaceCourse, texture: THREE.Texture): GreenwaterOpeningSurface {
    const sheetKey = "greenwater_runway_1024";
    const sheet = ATLAS_SHEETS[sheetKey];
    if (!sheet) {
      throw new Error(`Opening-surface atlas ${sheetKey} is missing from ATLAS_REGIONS.`);
    }
    const decals = OPENING_DECALS.decals;
    if (decals.length !== OPENING_DECALS.decalCount) {
      throw new Error(
        `Opening surface declares ${OPENING_DECALS.decalCount} decals but ships `
          + `${decals.length}.`,
      );
    }

    const positions = new Float32Array(decals.length * VERTICES_PER_DECAL * 3);
    const uvs = new Float32Array(decals.length * VERTICES_PER_DECAL * 2);
    const colors = new Float32Array(decals.length * VERTICES_PER_DECAL * 4);
    const indices = new Uint16Array(decals.length * TRIANGLES_PER_DECAL * 3);

    const scratch = course.createSampleScratch();
    const tint = new THREE.Color();
    const point = new THREE.Vector3();

    decals.forEach((decal, decalIndex) => {
      const region = sheet.regions[decal.slot];
      if (!region) {
        throw new Error(`Opening-surface decal ${decalIndex} names unknown slot ${decal.slot}.`);
      }
      const u0 = region.x / sheet.width;
      const u1 = (region.x + region.w) / sheet.width;
      // Image space runs top-down, UV space bottom-up.
      const v0 = 1 - (region.y + region.h) / sheet.height;
      const v1 = 1 - region.y / sheet.height;

      const radians = THREE.MathUtils.degToRad(decal.rotationDeg);
      const cos = Math.cos(radians);
      const sin = Math.sin(radians);
      tint.set(decal.tint).convertSRGBToLinear();

      CORNERS.forEach((corner, cornerIndex) => {
        // The decal's own axes, then rotated about the surface normal.
        const localU = corner.u * decal.width;
        const localV = corner.v * decal.length;
        const acrossMetres = localU * cos - localV * sin;
        const alongMetres = localU * sin + localV * cos;

        // Sampled into the scratch rather than through `sampleAtDistance`,
        // which allocates a fresh sample per call — this runs 800 times.
        const sample: CourseSample = course.sample(
          wrapDistance(decal.distance + alongMetres, course.length) / course.length,
          scratch,
        );
        const lateral = decal.lateral + acrossMetres;
        const height = surfaceHeightAtLateral(sample, lateral) + DECAL_LIFT_METRES;

        point.copy(sample.position)
          .addScaledVector(sample.right, lateral)
          .addScaledVector(sample.up, height);

        const vertex = decalIndex * VERTICES_PER_DECAL + cornerIndex;
        positions[vertex * 3] = point.x;
        positions[vertex * 3 + 1] = point.y;
        positions[vertex * 3 + 2] = point.z;
        uvs[vertex * 2] = corner.su === 0 ? u0 : u1;
        uvs[vertex * 2 + 1] = corner.sv === 0 ? v0 : v1;
        colors[vertex * 4] = tint.r;
        colors[vertex * 4 + 1] = tint.g;
        colors[vertex * 4 + 2] = tint.b;
        colors[vertex * 4 + 3] = decal.alpha;
      });

      CORNER_INDICES.forEach((corner, slot) => {
        indices[decalIndex * TRIANGLES_PER_DECAL * 3 + slot] =
          decalIndex * VERTICES_PER_DECAL + corner;
      });
    });

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 4));
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    geometry.computeBoundingSphere();

    const material = new THREE.MeshBasicMaterial({
      name: MATERIAL_NAME,
      map: texture,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      vertexColors: true,
      side: THREE.FrontSide,
      fog: true,
      alphaTest: 0,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = MESH_NAME;
    // The layer spans 0-220 m of a 2,516 m lap and is always either wholly in
    // front of the camera or wholly behind it; culling it per frame buys
    // nothing and costs a bounding-sphere test.
    mesh.frustumCulled = true;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.renderOrder = 1;

    const root = new THREE.Group();
    root.name = "greenwater_opening_surface_layer";
    root.add(mesh);

    return new GreenwaterOpeningSurface(root, {
      drawCalls: 1,
      decals: decals.length,
      triangles: decals.length * TRIANGLES_PER_DECAL,
      materials: 1,
      textures: 1,
      shaderModel: "unlit",
    });
  }

  static async load(
    course: RaceCourse,
    textureUrl: string,
  ): Promise<GreenwaterOpeningSurface> {
    const texture = await new THREE.TextureLoader().loadAsync(textureUrl);
    texture.name = "greenwater_runway_1024";
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;
    try {
      return GreenwaterOpeningSurface.build(course, texture);
    } catch (error) {
      texture.dispose();
      throw error;
    }
  }
}

/** Keeps a decal corner on the lap when it straddles the start line. */
function wrapDistance(distance: number, length: number): number {
  const wrapped = distance % length;
  return wrapped < 0 ? wrapped + length : wrapped;
}
