import * as THREE from "three";
import facadesJson from "./data/BITTERPAN_STRUCTURE_FACADES.json";
import atlasRegionsJson from "./data/ATLAS_REGIONS.json";

/**
 * P18 art pass 03 — the 226 blockout placements, given a face.
 *
 * Every structure on the pan is untextured blockout: 226 placements across 15
 * merged families, all reading as one flat value, which is why the pan has no
 * middle distance. This is a MATERIAL SWAP on those existing merged families —
 * one 1024 sheet, one material per family, +0 draw calls by construction — plus
 * a generated `uv` attribute, because the accepted GLB ships POSITION and
 * NORMAL only.
 *
 * ## What the accepted geometry actually is
 *
 * Measured, not assumed. The 15 merged primitives split into 473 connected
 * elements, and the stack is the same shape almost everywhere:
 *
 *   body    base 0 -> the placement's full height   (the mass)
 *   cap     base ~= height, 0.3-4.4 m tall          (roof / parapet / control level)
 *   trim    base mid-height, wide and thin          (ducts, pipe runs, vent bands)
 *
 * There is NO short element at grade on any family except WIND_salt_drift,
 * whose single 0.31 m box IS the drift. So `BASE_SKIRT` cannot be a face
 * assignment here the way `sides` and `top` can: nothing exists to assign it
 * to. It is delivered instead as the bottom 2.0 m BAND of every wall that
 * stands at grade, cut by splitting the wall triangles on a horizontal plane.
 * That adds triangles (about +1,800 across the site) and adds NO draw call, no
 * silhouette and no placement — the split is a UV seam, not a structure.
 *
 * ## How a face gets its region
 *
 * 1. split each family's merged geometry into connected elements;
 * 2. attach each element to its nearest authored placement in XZ;
 * 3. give the element a role from its base and height inside that placement;
 * 4. classify every triangle by its geometric face normal — up, down, or one of
 *    the two vertical classes (a wall faces across the SHORT footprint axis, so
 *    that is a `side`; across the long axis is an `end`);
 * 5. for a wall at grade, split it at 2.0 m and give the lower band the
 *    family's plinth if it authors one, its skirt otherwise.
 *
 * ## Deviation, stated rather than absorbed
 *
 * `uvMetresPerTile` is honoured as an ASPECT RATIO, not as a repeat count. An
 * atlas region cannot tile under mipped linear filtering without splitting the
 * geometry per repeat, and splitting a merged accepted family per repeat would
 * multiply its triangles many times over. So each face box-maps its region
 * exactly once, which means a face much larger than its authored tile shows the
 * same pattern at a larger pitch. The delivery's own stated priority is the
 * draw-call budget ("if any face assignment moves to a second sheet ... the
 * deliverable is over budget"), and this is the mapping that keeps it. Flagged
 * for screenshot review.
 */

const TEXTURE_NAME = "bitterpan_facades_1024";
const SHEET_KEY = "bitterpan_facades_1024";

/** Above this |ny| a face is a roof or a soffit rather than a wall. */
const VERTICAL_NORMAL_LIMIT = 0.7;

/** The skirt band's height, metres. BASE_SKIRT is authored 8.00 x 2.00 m. */
const SKIRT_BAND_METRES = 2;
/** A wall whose element starts within this of grade takes the skirt band. */
const GRADE_TOLERANCE_METRES = 0.6;
/** An element starting this far up its placement is a cap rather than a body. */
const CAP_BASE_FRACTION = 0.5;
/** ... and a cap is no taller than this fraction of the placement. */
const CAP_HEIGHT_FRACTION = 0.4;

type FaceClass = "sides" | "ends" | "top" | "soffit" | "trim" | "base"
  | "window" | "plinth";

type ElementRole = "body" | "cap" | "trim";

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

interface FacadeFamily {
  id: string;
  placements: number;
  sizeClass: string;
  faces: Partial<Record<FaceClass, string>>;
  alphaTest: number;
  uvMetresPerTile: [number, number];
}

interface MassingPlacement {
  id: string;
  family: string;
  position: [number, number, number];
  height_m: number;
  footprint_m: [number, number];
}

const ATLAS_SHEETS = atlasRegionsJson as unknown as Record<string, AtlasSheet>;
const FACADES = facadesJson as unknown as {
  sheet: { texture: string };
  families: FacadeFamily[];
  rules: string[];
};

export interface FacadeStats {
  /** Placements that received at least one facade face. Must be 226. */
  assignments: number;
  /** Distinct materials created. One per family: 15. */
  materials: number;
  families: number;
  textures: number;
  /** Families whose material alpha-tests. Only the lattice families may. */
  alphaTestedFamilies: number;
  /** Placements carrying a grade band — the skirt, or the tower's plinth. */
  skirtedPlacements: number;
  /** Placements whose grade band is the authored plinth rather than the skirt. */
  plinthedPlacements: number;
  /** Placements that resolved a window strip. */
  windowedPlacements: number;
  elements: number;
  /** Triangles after the skirt split. The accepted payload holds 5,168. */
  triangles: number;
  /** Triangles added by the skirt split alone. */
  skirtTriangles: number;
  /** Sheets sampled across every facade material. Must be 1. */
  sheetsSampled: number;
  /** The dusk window blend, 0 at stop 0 (dead) and 1 at the last stop. */
  windowDuskBlend: number;
}

export class BitterpanFacades {
  readonly stats: FacadeStats;

  private constructor(
    private readonly texture: THREE.Texture,
    private readonly windowMaterials: THREE.MeshLambertMaterial[],
    stats: FacadeStats,
  ) {
    this.stats = stats;
  }

  /**
   * WINDOW_STRIP_DUSK and WINDOW_STRIP_DEAD are the same eight bays at the same
   * pitch. The delivery is explicit that this is a CROSS-FADE between the two
   * regions on the time-of-day stop, not a tint on one of them: an amber-tinted
   * dead window is a dead window, not a lit one.
   *
   * Two of the eight bays in the dusk strip are authored dark — a shed with
   * every bay lit is a hotel — so the fade is carried on the material's
   * emissive rather than on its colour: the dark bays stay dark as the lit ones
   * come up, which a colour lerp between two sampled regions could not do
   * without a second UV set and a second draw.
   *
   * @param blend 0 = dead (stop 0, HARD_NOON), 1 = lit (the last stop).
   */
  setWindowBlend(blend: number): void {
    const clamped = THREE.MathUtils.clamp(blend, 0, 1);
    if (Math.abs(clamped - this.stats.windowDuskBlend) < 0.001) return;
    this.stats.windowDuskBlend = Number(clamped.toFixed(3));
    for (const material of this.windowMaterials) {
      material.emissive.setRGB(0.62 * clamped, 0.32 * clamped, 0.08 * clamped);
      material.emissiveIntensity = clamped;
      material.needsUpdate = true;
    }
  }

  /**
   * Re-asserts the delivery's anisotropy after the PS2 material treatment has
   * run over the scene. That treatment's painterly class is linear and mipped —
   * which is right — but pins anisotropy to 1.
   */
  restoreAnisotropy(): void {
    this.texture.anisotropy = 4;
    this.texture.needsUpdate = true;
  }

  /** The filtering the sheet is actually running with. */
  get anisotropy(): number {
    return this.texture.anisotropy;
  }

  dispose(): void {
    this.texture.dispose();
  }

  /** Swaps the facade sheet onto an already-loaded `GW2_SITE_MASSING` scene. */
  static apply(
    massing: THREE.Object3D,
    placements: readonly MassingPlacement[],
    texture: THREE.Texture,
  ): BitterpanFacades {
    const sheet = ATLAS_SHEETS[SHEET_KEY];
    if (!sheet) {
      throw new Error(`Facade atlas ${SHEET_KEY} is missing from ATLAS_REGIONS.`);
    }

    const meshes: THREE.Mesh[] = [];
    massing.traverse((object) => {
      if (object instanceof THREE.Mesh) meshes.push(object);
    });
    if (meshes.length !== FACADES.families.length) {
      throw new Error(
        `The facade table authors ${FACADES.families.length} families but the `
          + `accepted massing carries ${meshes.length} primitives.`,
      );
    }

    const windowMaterials: THREE.MeshLambertMaterial[] = [];
    const totals = {
      assignments: 0,
      skirted: 0,
      plinthed: 0,
      windowed: 0,
      elements: 0,
      triangles: 0,
      skirtTriangles: 0,
      alphaTested: 0,
    };

    for (let index = 0; index < meshes.length; index += 1) {
      const mesh = meshes[index];
      const family = FACADES.families[index];
      const familyPlacements = placements.filter(
        (placement) => placement.family === family.id,
      );
      if (familyPlacements.length !== family.placements) {
        throw new Error(
          `Facade family ${family.id} declares ${family.placements} placements; `
            + `the accepted table holds ${familyPlacements.length}.`,
        );
      }

      const result = mapFamily(mesh, family, familyPlacements, sheet);
      // The skirt is applied to all 226 placements without exception, so a
      // placement that resolved no grade band is named rather than absorbed
      // into a count that is one short.
      for (const id of result.assigned) {
        if (result.skirted.has(id) || result.plinthed.has(id)) continue;
        console.warn(
          `Bitterpan facade: ${id} (${family.id}) resolved no grade band. Its `
            + "lowest element has no wall face within the 2 m skirt height.",
        );
      }
      totals.assignments += result.assigned.size;
      totals.skirted += result.skirted.size;
      totals.plinthed += result.plinthed.size;
      totals.windowed += result.windowed.size;
      totals.elements += result.elements;
      totals.triangles += result.triangles;
      totals.skirtTriangles += result.skirtTriangles;

      const previous = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
      const source = previous as THREE.MeshLambertMaterial;
      const material = new THREE.MeshLambertMaterial({
        name: `FACADE_${family.id}`,
        map: texture,
        color: 0xffffff,
        side: source?.side ?? THREE.FrontSide,
        fog: true,
      });
      // Only LATTICE_RIG uses alpha. Families that take it set alphaTest 0.5 on
      // their own material, which costs nothing; families that do not must stay
      // opaque so the pan's sorting is unchanged.
      if (family.alphaTest > 0) {
        material.alphaTest = family.alphaTest;
        material.transparent = false;
        totals.alphaTested += 1;
      }
      if (result.windowed.size > 0) windowMaterials.push(material);
      mesh.material = material;
    }

    return new BitterpanFacades(texture, windowMaterials, {
      assignments: totals.assignments,
      materials: meshes.length,
      families: FACADES.families.length,
      textures: 1,
      alphaTestedFamilies: totals.alphaTested,
      skirtedPlacements: totals.skirted,
      plinthedPlacements: totals.plinthed,
      windowedPlacements: totals.windowed,
      elements: totals.elements,
      triangles: totals.triangles,
      skirtTriangles: totals.skirtTriangles,
      sheetsSampled: 1,
      windowDuskBlend: 0,
    });
  }

  static async load(
    massing: THREE.Object3D,
    placements: readonly MassingPlacement[],
    textureUrl: string,
  ): Promise<BitterpanFacades> {
    const texture = await new THREE.TextureLoader().loadAsync(textureUrl);
    // Mips ON, linear, anisotropy 4, sRGB — the delivery's own filtering, and
    // the opposite of the card sheets. These faces are read from 8 m to 900 m
    // in the same frame; NearestFilter on a 0.25 m rib pitch is a moire
    // generator, and the Pass 02 crust-tile argument applies unchanged.
    texture.name = TEXTURE_NAME;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.generateMipmaps = true;
    texture.anisotropy = 4;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.needsUpdate = true;
    try {
      return BitterpanFacades.apply(massing, placements, texture);
    } catch (error) {
      texture.dispose();
      throw error;
    }
  }
}

interface ElementInfo {
  triangles: number[];
  box: THREE.Box3;
  placement: MassingPlacement;
  role: ElementRole;
}

interface FamilyMapResult {
  elements: number;
  triangles: number;
  skirtTriangles: number;
  skirted: Set<string>;
  plinthed: Set<string>;
  windowed: Set<string>;
  assigned: Set<string>;
}

interface MeshSink {
  positions: number[];
  normals: number[];
  uvs: number[];
}

/** Rebuilds one merged family's geometry with facade UVs, and reports what it hit. */
function mapFamily(
  mesh: THREE.Mesh,
  family: FacadeFamily,
  placements: readonly MassingPlacement[],
  sheet: AtlasSheet,
): FamilyMapResult {
  const source = mesh.geometry;
  const position = source.getAttribute("position") as THREE.BufferAttribute;
  const index = source.getIndex();
  const elements = splitElements(source, placements);
  const sourceTriangles = index ? index.count / 3 : position.count / 3;

  // The skirt is the region that stops a structure looking pasted onto the
  // ground plane, and the delivery applies it to all 226 placements without
  // exception. WIND_salt_drift carries it on `sides` rather than `base` —
  // a salt drift IS the skirt — so it is resolved from the whole face map.
  const skirtRegion = family.faces.base
    ?? (Object.values(family.faces).includes("BASE_SKIRT") ? "BASE_SKIRT" : undefined);

  const sink: MeshSink = { positions: [], normals: [], uvs: [] };
  const skirted = new Set<string>();
  const plinthed = new Set<string>();
  const windowed = new Set<string>();
  const assigned = new Set<string>();
  let skirtTriangles = 0;

  const corner = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const edge1 = new THREE.Vector3();
  const edge2 = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const size = new THREE.Vector3();

  for (const element of elements) {
    element.box.getSize(size);
    assigned.add(element.placement.id);
    const atGrade = element.box.min.y - element.placement.position[1]
      <= GRADE_TOLERANCE_METRES;
    // A grade band is concrete where the family authors a plinth ("concrete at
    // grade, sheet above") and the salt skirt everywhere else.
    const gradeRegion = atGrade
      ? (family.faces.plinth ?? skirtRegion)
      : undefined;
    const skirtTop = element.box.min.y + SKIRT_BAND_METRES;

    for (const triangle of element.triangles) {
      for (let vertex = 0; vertex < 3; vertex += 1) {
        const source = index ? index.getX(triangle * 3 + vertex) : triangle * 3 + vertex;
        corner[vertex].fromBufferAttribute(position, source);
      }
      edge1.subVectors(corner[1], corner[0]);
      edge2.subVectors(corner[2], corner[0]);
      normal.crossVectors(edge1, edge2).normalize();

      const faceClass = classifyFace(normal, size, element.role, family);
      if (faceClass === "window") windowed.add(element.placement.id);
      const wallRegionName = resolveRegion(family, faceClass, element.role);
      const wallRegion = requireRegion(sheet, family, wallRegionName);

      const isWall = Math.abs(normal.y) <= VERTICAL_NORMAL_LIMIT;
      if (isWall && gradeRegion && element.box.max.y > skirtTop) {
        // Split the wall on the skirt plane. The lower band takes the grade
        // region, the upper band keeps the wall's own. This is the only place
        // the mapper touches geometry, and it adds no silhouette: the split
        // vertices lie on the wall.
        const bandRegion = requireRegion(sheet, family, gradeRegion);
        const added = splitWallOnPlane(
          sink, corner, normal, skirtTop, element.box, size,
          bandRegion, wallRegion, sheet, family,
        );
        skirtTriangles += added - 1;
        if (gradeRegion === family.faces.plinth) plinthed.add(element.placement.id);
        else skirted.add(element.placement.id);
        continue;
      }
      if (isWall && gradeRegion && element.box.max.y <= skirtTop) {
        // The whole element is inside the band — a salt drift, a marshal post
        // footing. It IS the skirt.
        const bandRegion = requireRegion(sheet, family, gradeRegion);
        pushTriangle(sink, corner, normal, element.box, size, bandRegion, sheet, family);
        if (gradeRegion === family.faces.plinth) plinthed.add(element.placement.id);
        else skirted.add(element.placement.id);
        continue;
      }
      pushTriangle(sink, corner, normal, element.box, size, wallRegion, sheet, family);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(sink.positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(sink.normals, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(sink.uvs, 2));
  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();
  source.dispose();
  mesh.geometry = geometry;

  return {
    elements: elements.length,
    triangles: sink.positions.length / 9,
    skirtTriangles: sink.positions.length / 9 - sourceTriangles,
    skirted,
    plinthed,
    windowed,
    assigned,
  };
}

function requireRegion(
  sheet: AtlasSheet,
  family: FacadeFamily,
  name: string,
): AtlasRegion {
  const region = sheet.regions[name];
  if (!region) {
    throw new Error(`Facade family ${family.id} names unknown region ${name}.`);
  }
  return region;
}

/**
 * Cuts a wall triangle on the horizontal plane `planeY` and emits both halves
 * with their own regions. Returns how many triangles were emitted.
 */
function splitWallOnPlane(
  sink: MeshSink,
  corner: THREE.Vector3[],
  normal: THREE.Vector3,
  planeY: number,
  box: THREE.Box3,
  size: THREE.Vector3,
  lowRegion: AtlasRegion,
  highRegion: AtlasRegion,
  sheet: AtlasSheet,
  family: FacadeFamily,
): number {
  const below = corner.filter((point) => point.y < planeY);
  const above = corner.filter((point) => point.y >= planeY);
  if (below.length === 0 || above.length === 0) {
    pushTriangle(
      sink, corner, normal, box, size,
      below.length === 0 ? highRegion : lowRegion, sheet, family,
    );
    return 1;
  }

  // One vertex on the minority side, two on the majority side: the minority
  // vertex plus two cut points make a triangle, and the rest is a quad.
  const single = below.length === 1 ? below[0] : above[0];
  const pair = below.length === 1 ? above : below;
  const singleRegion = below.length === 1 ? lowRegion : highRegion;
  const pairRegion = below.length === 1 ? highRegion : lowRegion;
  const cutA = cutAt(single, pair[0], planeY);
  const cutB = cutAt(single, pair[1], planeY);

  // Winding is preserved by rebuilding each sub-triangle in the source order
  // and re-testing against the face normal, so a flipped sliver can never turn
  // a wall inside out.
  emitOriented(sink, [single, cutA, cutB], normal, box, size, singleRegion, sheet, family);
  emitOriented(sink, [cutA, pair[0], pair[1]], normal, box, size, pairRegion, sheet, family);
  emitOriented(sink, [cutA, pair[1], cutB], normal, box, size, pairRegion, sheet, family);
  return 3;
}

function cutAt(from: THREE.Vector3, to: THREE.Vector3, planeY: number): THREE.Vector3 {
  const span = to.y - from.y;
  const t = Math.abs(span) < 1e-6 ? 0 : (planeY - from.y) / span;
  return new THREE.Vector3().lerpVectors(from, to, THREE.MathUtils.clamp(t, 0, 1));
}

/** Emits a triangle, flipping it if the split reversed its winding. */
function emitOriented(
  sink: MeshSink,
  points: THREE.Vector3[],
  normal: THREE.Vector3,
  box: THREE.Box3,
  size: THREE.Vector3,
  region: AtlasRegion,
  sheet: AtlasSheet,
  family: FacadeFamily,
): void {
  const edge1 = new THREE.Vector3().subVectors(points[1], points[0]);
  const edge2 = new THREE.Vector3().subVectors(points[2], points[0]);
  const facing = new THREE.Vector3().crossVectors(edge1, edge2);
  if (facing.lengthSq() < 1e-12) return;
  const ordered = facing.dot(normal) >= 0
    ? points
    : [points[0], points[2], points[1]];
  pushTriangle(sink, ordered, normal, box, size, region, sheet, family);
}

/**
 * Box-projects one triangle's region onto its face and appends it.
 *
 * `uvMetresPerTile` sets the ASPECT of the projection — the axis that carries
 * more authored metres per tile advances more slowly — and the region is mapped
 * once across the face's own extent. See the deviation note at the top of this
 * file for why once rather than `extent / tile` times.
 */
function pushTriangle(
  sink: MeshSink,
  points: THREE.Vector3[],
  normal: THREE.Vector3,
  box: THREE.Box3,
  size: THREE.Vector3,
  region: AtlasRegion,
  sheet: AtlasSheet,
  family: FacadeFamily,
): void {
  // Half a texel in from every edge, so a mip level never bleeds a neighbouring
  // region into this one. At 1024 with four mip drops this is the cheapest
  // insurance the sheet has.
  const pad = 1.5;
  const u0 = (region.x + pad) / sheet.width;
  const u1 = (region.x + region.w - pad) / sheet.width;
  const v0 = 1 - (region.y + region.h - pad) / sheet.height;
  const v1 = 1 - (region.y + pad) / sheet.height;

  const horizontal = Math.abs(normal.y) > VERTICAL_NORMAL_LIMIT;
  const [tileU, tileV] = family.uvMetresPerTile;
  const aspect = tileV > 0 ? tileU / tileV : 1;

  for (const point of points) {
    let across: number;
    let along: number;
    let acrossSpan: number;
    let alongSpan: number;
    if (horizontal) {
      across = point.x - box.min.x;
      along = point.z - box.min.z;
      acrossSpan = size.x;
      alongSpan = size.z;
    } else if (Math.abs(normal.x) >= Math.abs(normal.z)) {
      across = point.z - box.min.z;
      along = point.y - box.min.y;
      acrossSpan = size.z;
      alongSpan = size.y;
    } else {
      across = point.x - box.min.x;
      along = point.y - box.min.y;
      acrossSpan = size.x;
      alongSpan = size.y;
    }
    const u = acrossSpan > 1e-4 ? across / acrossSpan : 0;
    // The aspect correction only ever SHRINKS the taller axis into the region,
    // so a squat face never stretches its ribs the other way.
    const vScale = alongSpan > 1e-4 && acrossSpan > 1e-4
      ? Math.min(1, (alongSpan / acrossSpan) / Math.max(aspect, 1e-4))
      : 1;
    const v = alongSpan > 1e-4 ? (along / alongSpan) * vScale : 0;
    sink.positions.push(point.x, point.y, point.z);
    sink.normals.push(normal.x, normal.y, normal.z);
    sink.uvs.push(
      u0 + (u1 - u0) * THREE.MathUtils.clamp(u, 0, 1),
      v0 + (v1 - v0) * THREE.MathUtils.clamp(v, 0, 1),
    );
  }
}

/**
 * Connected components of a merged family, each attached to its nearest
 * authored placement in XZ and given a role inside it. The accepted payload
 * merges by family across the whole 589 x 1214 m site, so this is what recovers
 * "which structure is this, and which part of it".
 */
function splitElements(
  geometry: THREE.BufferGeometry,
  placements: readonly MassingPlacement[],
): ElementInfo[] {
  const position = geometry.getAttribute("position") as THREE.BufferAttribute;
  const index = geometry.getIndex();
  const triangleCount = index ? index.count / 3 : position.count / 3;

  // Union-find over vertices, joined by every triangle. Positions are shared
  // inside an element and never between elements in this payload, so vertex
  // identity is the adjacency and no welding pass is needed.
  const parent = new Int32Array(position.count);
  for (let vertex = 0; vertex < parent.length; vertex += 1) parent[vertex] = vertex;
  const find = (vertex: number): number => {
    let root = vertex;
    while (parent[root] !== root) root = parent[root];
    let walk = vertex;
    while (parent[walk] !== root) {
      const next = parent[walk];
      parent[walk] = root;
      walk = next;
    }
    return root;
  };
  const union = (left: number, right: number): void => {
    const a = find(left);
    const b = find(right);
    if (a !== b) parent[b] = a;
  };
  const vertexOf = (triangle: number, corner: number): number => (index
    ? index.getX(triangle * 3 + corner)
    : triangle * 3 + corner);
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    union(vertexOf(triangle, 0), vertexOf(triangle, 1));
    union(vertexOf(triangle, 0), vertexOf(triangle, 2));
  }

  const byRoot = new Map<number, { triangles: number[]; box: THREE.Box3 }>();
  const point = new THREE.Vector3();
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const root = find(vertexOf(triangle, 0));
    const bucket = byRoot.get(root)
      ?? { triangles: [] as number[], box: new THREE.Box3() };
    bucket.triangles.push(triangle);
    for (const corner of [0, 1, 2]) {
      point.fromBufferAttribute(position, vertexOf(triangle, corner));
      bucket.box.expandByPoint(point);
    }
    byRoot.set(root, bucket);
  }

  const centre = new THREE.Vector3();
  const raw: { triangles: number[]; box: THREE.Box3; placement: MassingPlacement }[] = [];
  for (const bucket of byRoot.values()) {
    bucket.box.getCenter(centre);
    let best = placements[0];
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const placement of placements) {
      const dx = placement.position[0] - centre.x;
      const dz = placement.position[2] - centre.z;
      const distance = dx * dx + dz * dz;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = placement;
      }
    }
    raw.push({ triangles: bucket.triangles, box: bucket.box, placement: best });
  }

  // Roles, measured against the placement the element belongs to. The stack is
  // body / cap / trim on every family; see the note at the top of the file.
  const highestBase = new Map<string, number>();
  for (const element of raw) {
    const base = element.box.min.y - element.placement.position[1];
    highestBase.set(
      element.placement.id,
      Math.max(highestBase.get(element.placement.id) ?? -Infinity, base),
    );
  }
  return raw.map((element) => {
    const height = element.placement.height_m;
    const base = element.box.min.y - element.placement.position[1];
    const own = element.box.max.y - element.box.min.y;
    const isHighest = base >= (highestBase.get(element.placement.id) ?? 0) - 1e-3;
    const role: ElementRole = isHighest && height > 0
      && base >= CAP_BASE_FRACTION * height
      && own <= CAP_HEIGHT_FRACTION * height
      ? "cap"
      : base > GRADE_TOLERANCE_METRES
        ? "trim"
        : "body";
    return { ...element, role };
  });
}

/**
 * Face class from the geometric normal and the element's role.
 *
 * A wall faces ACROSS the element's short footprint axis, so that is a `side`;
 * across the long axis it is an `end`.
 */
function classifyFace(
  normal: THREE.Vector3,
  size: THREE.Vector3,
  role: ElementRole,
  family: FacadeFamily,
): FaceClass {
  if (normal.y > VERTICAL_NORMAL_LIMIT) return "top";
  if (normal.y < -VERTICAL_NORMAL_LIMIT) return family.faces.soffit ? "soffit" : "top";
  // The cap is the parapet, the roof band, the control level. It is the only
  // element with a lit interior, which is why it carries the window strip.
  if (role === "cap" && family.faces.window) return "window";
  if (role === "trim" && family.faces.trim) return "trim";
  const acrossX = Math.abs(normal.x) >= Math.abs(normal.z);
  const shortAxisIsX = size.x <= size.z;
  return acrossX === shortAxisIsX ? "sides" : "ends";
}

/** The region a face class resolves to, with the delivery's own fallbacks. */
function resolveRegion(
  family: FacadeFamily,
  faceClass: FaceClass,
  _role: ElementRole,
): string {
  const direct = family.faces[faceClass];
  if (direct) return direct;
  if (faceClass === "top" || faceClass === "soffit") {
    return family.faces.top ?? family.faces.sides ?? family.faces.base ?? "ROOF_SHEET";
  }
  return family.faces.sides ?? family.faces.base ?? "BASE_SKIRT";
}
