import * as THREE from "three";
import atlasRegionsJson from "./data/ATLAS_REGIONS.json";
import setDressingJson from "./data/BITTERPAN_SET_DRESSING.json";
import surfaceCrustJson from "./data/BITTERPAN_SURFACE_CRUST.json";
import { type CourseSample, type RaceCourse, surfaceHeightAtLateral } from "./course";
import { activeRenderMode } from "./render-mode.js";
import { applyPs2MaterialTreatment } from "./totem";

/**
 * P15 art pass 02 — the Bitterpan pan, given a ground and what was left on it.
 *
 * Two payloads, two draw calls, and the second number is the interesting one.
 *
 * 1. **The pan floor.** Bitterpan shipped with *no ground at all*: the ribbon
 *    and the site massing hang over fog, which is why the dust devils and the
 *    dry scud in the living-world layer have never read as crossing anything.
 *    `BITTERPAN_SURFACE_CRUST.json`'s `ground` block describes this as a re-map
 *    of "the existing pan plane" — there is no such plane in the runtime, so
 *    this builds the one Greenwater has had since Phase 1 (`createGroundPlane`)
 *    and puts the crust tile on it. That is one draw call the spec did not
 *    budget for; it is called out in the phase report rather than absorbed.
 *
 *    It is the one texture in the project that is deliberately NOT on the
 *    point-sampled class. Pass 02 principle 4: this plane is read from 2 m to
 *    900 m, and `NearestFilter` with no mip chain turns a crust tile into
 *    sparkle the moment the craft moves — era-accurate degradation rather than
 *    era-accurate atmosphere. `?render=ps2` still forces the pixel class on it,
 *    because that mode's whole contract is that nothing escapes the raster.
 *
 * 2. **The crust decals and the set dressing.** 297 + 110 = 407 decals on ONE
 *    mesh, ONE material, ONE draw call, 814 triangles. The two specs are
 *    separate authoring documents but name the same sheet and the same material
 *    contract, and `BITTERPAN_SET_DRESSING.json` says so in `mergesInto`, so
 *    they are built as one payload here — `validate-art-pass.mjs` asserts the
 *    two sides agree about every field on that shared material.
 *
 * The decal builder is the sibling of `opening-surface.ts` and deliberately
 * carries the identical contract: unlit, vertex-coloured, nearest-filtered with
 * no mip chain, `polygonOffset -2/-2` and `depthWrite: false`. Every corner is
 * sampled at its OWN distance around the lap so a 46 m span shadow on a curve
 * follows the centreline instead of cutting the chord, and rides the authored
 * apron cross-section through `surfaceHeightAtLateral` rather than a flat
 * extrapolation of the deck plane.
 *
 * Nothing here is furniture. Every entry is zero-height painted road under
 * `FLAT_FURNITURE_MAX_HEIGHT_METRES`; the 18 conveyor span shadows cross the
 * drivable corridor on purpose, because a shadow that stops at the deck edge is
 * not a shadow.
 */

const DECAL_MESH_NAME = "BP_SURFACE_CRUST";
const DECAL_MATERIAL_NAME = "BP_SURFACE_CRUST";
const GROUND_MESH_NAME = "BP_PAN_FLOOR";
const GROUND_MATERIAL_NAME = "BP_PAN_FLOOR";
const VERTICES_PER_DECAL = 4;
const TRIANGLES_PER_DECAL = 2;

/** Matches `opening-surface.ts`; see the note there. */
const DECAL_LIFT_METRES = 0.012;

/**
 * Where the pan floor sits, in world Y.
 *
 * The authored ribbon runs between -1.872 m and +1.872 m and the accepted
 * blockout's lowest *visible* vertex is the deck at -2.4916 m, so the floor has
 * to clear the deck surface at its lowest station without swallowing the road:
 * -1.95 m is 0.078 m under the lowest deck surface and above nothing that is
 * drawn. The deck's underside and barrier skirts fall below it and are hidden,
 * which is correct — you should not be able to see under the road.
 *
 * The consequence, stated rather than hidden: the crust and dressing decals are
 * authored course-relative and ride the ribbon, so where the ribbon is at its
 * high point an off-deck windrow sits up to 3.8 m above this plane. That is the
 * spec's own placement rule ("honouring the ribbon"), and it reads as the road
 * running on a raised shelf over the pan.
 */
export const GROUND_Y_METRES = -1.95;

/**
 * Half-extent of the pan floor, in metres, and where it is centred.
 *
 * Bitterpan renders at `camera.far = 1800` against Greenwater's 650, so the far
 * plane cannot be relied on to hide the ground's own edge. The track occupies
 * x -13..576 and z -335..878; a 6,048 m square centred on that box's middle
 * puts its nearest edge 2,417 m from the furthest point of the track, which
 * clears the far plane from anywhere a player can be. 6,048 is 504 whole tiles,
 * so the repeat lands on a texel boundary rather than half a crust plate.
 */
const GROUND_SIZE_METRES = 6_048;
const GROUND_CENTRE_X_METRES = 281;
const GROUND_CENTRE_Z_METRES = 271;

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
const SURFACE_CRUST = surfaceCrustJson as unknown as {
  ground: { metresPerTile: number };
  decalCount: number;
  triangles: number;
  decals: SurfaceDecal[];
};
const SET_DRESSING = setDressingJson as unknown as {
  itemCount: number;
  triangles: number;
  items: SurfaceDecal[];
};

export interface BitterpanSurfaceStats {
  drawCalls: number;
  /** 297 crust decals + 110 dressing items, on one mesh. */
  decals: number;
  crustDecals: number;
  dressingItems: number;
  triangles: number;
  materials: number;
  textures: number;
  groundMetresPerTile: number;
  groundAnisotropy: number;
  shaderModel: "unlit+lambert";
}

/** Corner order and winding, identical to `opening-surface.ts`. */
const CORNERS: ReadonlyArray<{ u: number; v: number; su: number; sv: number }> = [
  { u: -0.5, v: -0.5, su: 0, sv: 0 },
  { u: 0.5, v: -0.5, su: 1, sv: 0 },
  { u: -0.5, v: 0.5, su: 0, sv: 1 },
  { u: 0.5, v: 0.5, su: 1, sv: 1 },
];

const CORNER_INDICES = [0, 1, 2, 2, 1, 3];

export class BitterpanSurface {
  readonly stats: BitterpanSurfaceStats;

  private constructor(readonly root: THREE.Group, stats: BitterpanSurfaceStats) {
    this.stats = stats;
  }

  static build(
    course: RaceCourse,
    groundTexture: THREE.Texture,
    decalTexture: THREE.Texture,
  ): BitterpanSurface {
    const sheetKey = "bitterpan_crust_1024";
    const sheet = ATLAS_SHEETS[sheetKey];
    if (!sheet) {
      throw new Error(`Bitterpan crust atlas ${sheetKey} is missing from ATLAS_REGIONS.`);
    }
    if (SURFACE_CRUST.decals.length !== SURFACE_CRUST.decalCount) {
      throw new Error(
        `The pan crust declares ${SURFACE_CRUST.decalCount} decals but ships `
          + `${SURFACE_CRUST.decals.length}.`,
      );
    }
    if (SET_DRESSING.items.length !== SET_DRESSING.itemCount) {
      throw new Error(
        `The pan set dressing declares ${SET_DRESSING.itemCount} items but ships `
          + `${SET_DRESSING.items.length}.`,
      );
    }

    // One list, one buffer, one draw call. The dressing is not a second layer:
    // it names the same sheet and the same material, which is the whole reason
    // it costs nothing to draw.
    const decals: SurfaceDecal[] = [...SURFACE_CRUST.decals, ...SET_DRESSING.items];

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
        throw new Error(`Pan surface decal ${decalIndex} names unknown slot ${decal.slot}.`);
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
        const localU = corner.u * decal.width;
        const localV = corner.v * decal.length;
        const acrossMetres = localU * cos - localV * sin;
        const alongMetres = localU * sin + localV * cos;

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

    const decalMaterial = new THREE.MeshBasicMaterial({
      name: DECAL_MATERIAL_NAME,
      map: decalTexture,
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

    const decalMesh = new THREE.Mesh(geometry, decalMaterial);
    decalMesh.name = DECAL_MESH_NAME;
    // Unlike the opening straight this layer wraps the whole 3,050 m lap, so a
    // single bounding sphere covers the entire site and the frustum test can
    // never retire it. Culling it costs a sphere test that always says yes.
    decalMesh.frustumCulled = false;
    decalMesh.castShadow = false;
    decalMesh.receiveShadow = false;
    decalMesh.renderOrder = 1;

    const root = new THREE.Group();
    root.name = "bitterpan_surface_layer";
    root.add(buildPanFloor(groundTexture), decalMesh);

    return new BitterpanSurface(root, {
      drawCalls: 2,
      decals: decals.length,
      crustDecals: SURFACE_CRUST.decals.length,
      dressingItems: SET_DRESSING.items.length,
      triangles: decals.length * TRIANGLES_PER_DECAL,
      materials: 2,
      textures: 2,
      groundMetresPerTile: SURFACE_CRUST.ground.metresPerTile,
      groundAnisotropy: groundTexture.anisotropy,
      shaderModel: "unlit+lambert",
    });
  }

  static async load(
    course: RaceCourse,
    groundTextureUrl: string,
    decalTextureUrl: string,
  ): Promise<BitterpanSurface> {
    const loader = new THREE.TextureLoader();
    const [groundTexture, decalTexture] = await Promise.all([
      loader.loadAsync(groundTextureUrl),
      loader.loadAsync(decalTextureUrl),
    ]);
    groundTexture.name = "bitterpan_crust_tile_256";
    groundTexture.colorSpace = THREE.SRGBColorSpace;
    groundTexture.wrapS = THREE.RepeatWrapping;
    groundTexture.wrapT = THREE.RepeatWrapping;
    const tiles = GROUND_SIZE_METRES / SURFACE_CRUST.ground.metresPerTile;
    groundTexture.repeat.set(tiles, tiles);
    groundTexture.needsUpdate = true;

    decalTexture.name = "bitterpan_crust_1024";
    decalTexture.colorSpace = THREE.SRGBColorSpace;
    decalTexture.magFilter = THREE.NearestFilter;
    decalTexture.minFilter = THREE.NearestFilter;
    decalTexture.wrapS = THREE.ClampToEdgeWrapping;
    decalTexture.wrapT = THREE.ClampToEdgeWrapping;
    decalTexture.generateMipmaps = false;
    decalTexture.needsUpdate = true;

    try {
      return BitterpanSurface.build(course, groundTexture, decalTexture);
    } catch (error) {
      groundTexture.dispose();
      decalTexture.dispose();
      throw error;
    }
  }
}

/**
 * The ground the pan never had. A single quad the size of the visible world,
 * lit like the rest of the site rather than unlit like the decals over it.
 */
function buildPanFloor(texture: THREE.Texture): THREE.Mesh {
  const geometry = new THREE.PlaneGeometry(GROUND_SIZE_METRES, GROUND_SIZE_METRES, 1, 1);
  const material = new THREE.MeshLambertMaterial({
    name: GROUND_MATERIAL_NAME,
    map: texture,
    fog: true,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = GROUND_MESH_NAME;
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(GROUND_CENTRE_X_METRES, GROUND_Y_METRES, GROUND_CENTRE_Z_METRES);
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  // Always under the camera, never worth a bounding-sphere test.
  mesh.frustumCulled = false;

  // The floor is world geometry: in `?render=ps2` it snaps, dithers and takes
  // the grade with everything else, and it takes that mode's pixel filter class
  // too. Outside ps2 the treatment's default class would leave a 900 m ground
  // plane point-sampled with a nearest mip chain, so the spec's own filtering
  // is applied over the top — the stated exception, made in one place.
  applyPs2MaterialTreatment(mesh, { worldGeometry: true });
  if (activeRenderMode() !== "ps2") {
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.generateMipmaps = true;
    texture.anisotropy = 4;
    texture.needsUpdate = true;
  }
  return mesh;
}

/** Keeps a decal corner on the lap when it straddles the start line. */
function wrapDistance(distance: number, length: number): number {
  const wrapped = distance % length;
  return wrapped < 0 ? wrapped + length : wrapped;
}
