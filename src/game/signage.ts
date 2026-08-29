import * as THREE from "three";
import atlasRegionsJson from "./data/ATLAS_REGIONS.json";
import signagePlacementsJson from "./data/FUTURISMA_SIGNAGE_PLACEMENTS.json";
import {
  type CourseSample,
  type RaceCourse,
  surfaceHeightAtLateral,
} from "./course";

/**
 * P12 art pass 01 — trackside signage, both maps.
 *
 * Every board on a map merges into ONE mesh against ONE atlas: 1 draw call for
 * Greenwater's 22 boards (39 quads, because pennant rows and sponsor tape tile
 * across their span) and 1 for Bitterpan's 12. Posts and hoarding frames merge
 * into a second, untextured mesh per map — so the whole layer is 2 draw calls
 * per map, and a board costs 2 triangles.
 *
 * Boards are alpha-tested rather than blended, and they DO write depth: a
 * trackside board is a solid object at a known distance, and a blended one
 * would sort against the living-world cards every frame for no visual gain.
 *
 * Orientation is derived from the course, never authored as a world rotation,
 * so the whole layer survives any re-authoring of the centreline:
 *
 * - `inward` — the board faces the racing line from its own side.
 * - `course` — the board faces ONCOMING traffic, so it is read on the approach.
 *   This is the Cradle fascia's reading: the delivery note has it silhouetting
 *   "from 200 m out" and being "the last thing over the nose at the line".
 * - `reverse` — the opposite face of the same structure. Both Cradle faces draw
 *   the same `CRADLE_BANNER` region, so the two are visually identical prints
 *   on the front and back of one gantry beam.
 */

const BOARD_MATERIAL_NAME = "FUTURISMA_SIGNAGE";
const POST_MATERIAL_NAME = "FUTURISMA_SIGNAGE_POSTS";
const VERTICES_PER_QUAD = 4;
const TRIANGLES_PER_QUAD = 2;

/** Box-section posts, metres. The delivery calls out 0.34 m for two-post boards. */
const POST_SECTION_METRES = 0.34;
/** How far in from a board's edge a post stands, as a fraction of its width. */
const POST_INSET_FRACTION = 0.12;
/** Posts sink this far below the drawn surface so they never float on a slope. */
const POST_FOOTING_METRES = 0.25;

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
  regions: Record<string, AtlasRegion>;
}

export interface SignagePlacement {
  id: string;
  slot: string;
  distance: number;
  lateral: number;
  height: number;
  widthMetres: number;
  heightMetres: number;
  facing: "course" | "reverse" | "inward";
  mount: string;
  tileU?: number;
}

interface SignageMapSpec {
  boards: number;
  quads: number;
  triangles: number;
  placements: SignagePlacement[];
}

const ATLAS_SHEETS = atlasRegionsJson as unknown as Record<string, AtlasSheet>;
const SIGNAGE = signagePlacementsJson as unknown as {
  texture: string;
  greenwater: SignageMapSpec;
  bitterpan: SignageMapSpec;
};

export interface TracksideSignageStats {
  drawCalls: number;
  boards: number;
  quads: number;
  triangles: number;
  posts: number;
  postTriangles: number;
  materials: number;
  textures: number;
  shaderModel: "unlit";
}

/** Deterministic 32-bit hash of a placement id — the lean must not drift. */
function hashId(id: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

/**
 * The heat-dead boards lean 4-9 degrees. Seeded off the placement id so the
 * same board leans the same way on every load and in the validator, and so
 * adding a board never moves an existing one.
 */
function leanRadians(placement: SignagePlacement): number {
  if (!/leaning/i.test(placement.mount)) return 0;
  const hash = hashId(placement.id);
  const degrees = 4 + ((hash >>> 8) % 1024) / 1024 * 5;
  const direction = (hash & 1) === 0 ? 1 : -1;
  return THREE.MathUtils.degToRad(degrees) * direction;
}

/** How many posts a mount note asks for, and 0 for anything already structural. */
export function postCountFor(mount: string): number {
  if (/four-post/i.test(mount)) return 4;
  if (/two-post/i.test(mount)) return 2;
  if (/single post/i.test(mount)) return 1;
  // Gantry beams, top chords, pit wall panels and capping are existing
  // structure — a post under them would be a second thing holding up the first.
  return 0;
}

interface BoardFrame {
  origin: THREE.Vector3;
  widthAxis: THREE.Vector3;
  heightAxis: THREE.Vector3;
  groundY: number;
}

/**
 * Builds the board's local frame from the course. `widthAxis x heightAxis` is
 * the board's outward normal, which is what fixes the winding below.
 */
function frameFor(
  course: RaceCourse,
  placement: SignagePlacement,
  scratch: CourseSample,
): BoardFrame {
  const sample = course.sample(
    ((placement.distance % course.length) + course.length) % course.length / course.length,
    scratch,
  );
  const side = placement.lateral < 0 ? -1 : 1;
  const widthAxis = new THREE.Vector3();
  if (placement.facing === "inward") {
    // Face the centreline: normal = -side * right, so widthAxis = -side * tangent.
    widthAxis.copy(sample.tangent).multiplyScalar(-side);
  } else if (placement.facing === "course") {
    // Face oncoming traffic: normal = -tangent, so widthAxis = right.
    widthAxis.copy(sample.right);
  } else {
    // `reverse`: the opposite face of the same structure.
    widthAxis.copy(sample.right).multiplyScalar(-1);
  }

  const heightAxis = sample.up.clone();
  const lean = leanRadians(placement);
  if (lean !== 0) heightAxis.applyAxisAngle(widthAxis, lean).normalize();

  const surface = surfaceHeightAtLateral(sample, placement.lateral);
  const origin = sample.position.clone()
    .addScaledVector(sample.right, placement.lateral)
    .addScaledVector(sample.up, surface + placement.height);

  return {
    origin,
    widthAxis,
    heightAxis,
    groundY: sample.position.clone()
      .addScaledVector(sample.up, surface).y,
  };
}

interface QuadSink {
  positions: number[];
  uvs: number[];
  indices: number[];
}

function pushQuad(
  sink: QuadSink,
  centre: THREE.Vector3,
  widthAxis: THREE.Vector3,
  heightAxis: THREE.Vector3,
  halfWidth: number,
  halfHeight: number,
  uv: readonly [number, number, number, number],
): void {
  const base = sink.positions.length / 3;
  const [u0, v0, u1, v1] = uv;
  const corners: ReadonlyArray<readonly [number, number, number, number]> = [
    [-halfWidth, -halfHeight, u0, v0],
    [halfWidth, -halfHeight, u1, v0],
    [-halfWidth, halfHeight, u0, v1],
    [halfWidth, halfHeight, u1, v1],
  ];
  for (const [across, up, u, v] of corners) {
    sink.positions.push(
      centre.x + widthAxis.x * across + heightAxis.x * up,
      centre.y + widthAxis.y * across + heightAxis.y * up,
      centre.z + widthAxis.z * across + heightAxis.z * up,
    );
    sink.uvs.push(u, v);
  }
  // `widthAxis x heightAxis` is the outward normal, so this winding faces out.
  sink.indices.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
}

/** A box-section post as 8 corners and 12 triangles. */
function pushPost(
  sink: { positions: number[]; indices: number[] },
  centre: THREE.Vector3,
  widthAxis: THREE.Vector3,
  upAxis: THREE.Vector3,
  normal: THREE.Vector3,
  half: number,
  bottom: number,
  top: number,
): void {
  const base = sink.positions.length / 3;
  for (const level of [bottom, top]) {
    for (const [a, n] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
      sink.positions.push(
        centre.x + widthAxis.x * a * half + normal.x * n * half + upAxis.x * level,
        centre.y + widthAxis.y * a * half + normal.y * n * half + upAxis.y * level,
        centre.z + widthAxis.z * a * half + normal.z * n * half + upAxis.z * level,
      );
    }
  }
  const sides = [[0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]];
  for (const [a, b, c, d] of sides) {
    sink.indices.push(base + a, base + b, base + c, base + a, base + c, base + d);
  }
  // Cap the top; the bottom is buried by POST_FOOTING_METRES.
  sink.indices.push(base + 4, base + 5, base + 6, base + 4, base + 6, base + 7);
}

export class TracksideSignage {
  readonly stats: TracksideSignageStats;

  private constructor(readonly root: THREE.Group, stats: TracksideSignageStats) {
    this.stats = stats;
  }

  static build(course: RaceCourse, texture: THREE.Texture): TracksideSignage {
    const spec = course.kind === "bitterpan" ? SIGNAGE.bitterpan : SIGNAGE.greenwater;
    const sheet = ATLAS_SHEETS.futurisma_signage_1024;
    if (!sheet) {
      throw new Error("Signage atlas futurisma_signage_1024 is missing from ATLAS_REGIONS.");
    }

    const boards: QuadSink = { positions: [], uvs: [], indices: [] };
    const posts = { positions: [] as number[], indices: [] as number[] };
    const scratch = course.createSampleScratch();
    let quads = 0;
    let postCount = 0;

    for (const placement of spec.placements) {
      const region = sheet.regions[placement.slot];
      if (!region) {
        throw new Error(`Signage placement ${placement.id} names unknown slot ${placement.slot}.`);
      }
      const u0 = region.x / sheet.width;
      const u1 = (region.x + region.w) / sheet.width;
      const v0 = 1 - (region.y + region.h) / sheet.height;
      const v1 = 1 - region.y / sheet.height;

      const frame = frameFor(course, placement, scratch);
      const tiles = Math.max(1, Math.round(placement.tileU ?? 1));
      const tileWidth = placement.widthMetres / tiles;
      const halfHeight = placement.heightMetres / 2;

      for (let tile = 0; tile < tiles; tile += 1) {
        // Tiles march along the board's own width axis from one end to the other.
        const offset = -placement.widthMetres / 2 + tileWidth * (tile + 0.5);
        const centre = frame.origin.clone()
          .addScaledVector(frame.widthAxis, offset);
        pushQuad(
          boards,
          centre,
          frame.widthAxis,
          frame.heightAxis,
          tileWidth / 2,
          halfHeight,
          [u0, v0, u1, v1],
        );
        quads += 1;
      }

      const wanted = postCountFor(placement.mount);
      if (wanted === 0) continue;
      const normal = new THREE.Vector3()
        .crossVectors(frame.widthAxis, frame.heightAxis)
        .normalize();
      const upAxis = new THREE.Vector3(0, 1, 0);
      // Posts run from below the drawn surface up to the board's lower edge.
      const boardBottom = frame.origin.y - halfHeight;
      const bottom = frame.groundY - POST_FOOTING_METRES;
      if (boardBottom <= bottom) continue;
      const span = placement.widthMetres * (1 - POST_INSET_FRACTION * 2);
      for (let index = 0; index < wanted; index += 1) {
        const across = wanted === 1
          ? 0
          : -span / 2 + span * (index / (wanted - 1));
        const centre = frame.origin.clone()
          .addScaledVector(frame.widthAxis, across);
        centre.y = 0;
        pushPost(
          posts,
          centre,
          frame.widthAxis,
          upAxis,
          normal,
          POST_SECTION_METRES / 2,
          bottom,
          boardBottom,
        );
        postCount += 1;
      }
    }

    const root = new THREE.Group();
    root.name = `${course.kind}_trackside_signage`;

    const boardGeometry = new THREE.BufferGeometry();
    boardGeometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(boards.positions, 3),
    );
    boardGeometry.setAttribute("uv", new THREE.Float32BufferAttribute(boards.uvs, 2));
    boardGeometry.setIndex(boards.indices);
    boardGeometry.computeBoundingSphere();

    const boardMaterial = new THREE.MeshBasicMaterial({
      name: BOARD_MATERIAL_NAME,
      map: texture,
      transparent: false,
      alphaTest: 0.5,
      depthWrite: true,
      depthTest: true,
      side: THREE.FrontSide,
      fog: true,
    });
    const boardMesh = new THREE.Mesh(boardGeometry, boardMaterial);
    boardMesh.name = course.kind === "bitterpan" ? "BP_SIGNAGE_BOARDS" : "GW_SIGNAGE_BOARDS";
    boardMesh.castShadow = false;
    boardMesh.receiveShadow = false;
    root.add(boardMesh);

    let postTriangles = 0;
    if (posts.positions.length > 0) {
      const postGeometry = new THREE.BufferGeometry();
      postGeometry.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(posts.positions, 3),
      );
      postGeometry.setIndex(posts.indices);
      postGeometry.computeVertexNormals();
      postGeometry.computeBoundingSphere();
      const postMaterial = new THREE.MeshLambertMaterial({
        name: POST_MATERIAL_NAME,
        color: 0x2b2f31,
        side: THREE.FrontSide,
        fog: true,
      });
      const postMesh = new THREE.Mesh(postGeometry, postMaterial);
      postMesh.name = course.kind === "bitterpan" ? "BP_SIGNAGE_POSTS" : "GW_SIGNAGE_POSTS";
      postMesh.castShadow = false;
      postMesh.receiveShadow = false;
      root.add(postMesh);
      postTriangles = posts.indices.length / 3;
    }

    return new TracksideSignage(root, {
      drawCalls: postTriangles > 0 ? 2 : 1,
      boards: spec.placements.length,
      quads,
      triangles: quads * TRIANGLES_PER_QUAD,
      posts: postCount,
      postTriangles,
      materials: postTriangles > 0 ? 2 : 1,
      textures: 1,
      shaderModel: "unlit",
    });
  }

  static async load(course: RaceCourse, textureUrl: string): Promise<TracksideSignage> {
    const texture = await new THREE.TextureLoader().loadAsync(textureUrl);
    texture.name = "futurisma_signage_1024";
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;
    try {
      return TracksideSignage.build(course, texture);
    } catch (error) {
      texture.dispose();
      throw error;
    }
  }
}

/** Quad count for a map, without building geometry — the validator reads this. */
export function signageQuadCount(map: "greenwater" | "bitterpan"): number {
  return SIGNAGE[map].placements.reduce(
    (total, placement) => total + Math.max(1, Math.round(placement.tileU ?? 1)),
    0,
  );
}

export { SIGNAGE as SIGNAGE_PLACEMENTS, VERTICES_PER_QUAD };
