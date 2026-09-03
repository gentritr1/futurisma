import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { RaceCourse } from "./course";
import { disposeObject3DResources } from "./graphics-resources";
import { applyPs2MaterialTreatment } from "./totem";
import { DECK_TILE_METRES, DECK_TILE_URL, deckTileEnabled } from "./art-pack.js";

const EXPECTED_RUNTIME_MESHES = 60;
const HANGAR_BARRIER_MESH = "GW_SECTOR_HANGAR_SIX_concrete";
const HANGAR_ROUTE_HINT_PROGRESS = 0.28;
const HANGAR_BARRIER_OUTWARD_SHIFT_METERS = 4;
const EXPECTED_RELOCATED_HANGAR_COMPONENTS = 76;
const EXPECTED_RELOCATED_HANGAR_VERTICES = 2_400;
/**
 * P20.1 — authored material families that must NOT cast.
 *
 * `GW_MAT_water` is the standing-water sheet: a body of water reading as an
 * opaque occluder is worse than no shadow at all. `GW_MAT_emissive` is the lamp
 * and glow geometry, which is the light in the fiction, sits coplanar with the
 * walls it is mounted on (an acne source), and is the single largest family in
 * GREENWATER_SWEEP and CANOPY_PASSAGE.
 *
 * Excluding them takes Greenwater's shadow pass from 41.5 to 37.5 draws a
 * frame (43 -> 39 distinct casters), measured with
 * scripts/visual/shadow-caster-probe.mjs on a demo lap.
 */
const NON_CASTING_MATERIALS = new Set(["GW_MAT_water", "GW_MAT_emissive"]);

const REPLACED_PROCEDURAL_OBJECTS = [
  "greenwater_surface",
  "greenwater_understructure",
  "greenwater_barriers",
  "greenwater_start_grid",
  "hangar_six_blockout",
  "greenwater_landmark_proxies",
  "greenwater_canopy",
] as const;

interface CullGroup {
  mesh: THREE.Mesh;
  sphere: THREE.Sphere;
  maximumDistanceSquared: number;
  triangles: number;
}

export interface RaceEnvironmentStats {
  meshes: number;
  triangles: number;
  materials: number;
  textures: number;
  visibleGroups: number;
  visibleTriangles: number;
  shaderModel: "lambert";
  signageSource: "baked" | "none";
  /**
   * Authored-asset contract mismatches observed while loading. A re-exported
   * GLB must never black-screen the game, so a drifted count warns and is
   * recorded here; the hard assertion lives in the build-time validators.
   */
  contractDrift: string[];
}

export type GreenwaterEnvironmentStats = RaceEnvironmentStats;

export interface RaceEnvironment {
  readonly root: THREE.Group;
  readonly stats: RaceEnvironmentStats;
  updateVisibility(camera: THREE.Camera): void;
}

export interface GreenwaterLivingTextures {
  jungle: THREE.Texture;
  emissive: THREE.Texture;
}

interface GeometryComponent {
  vertexIndices: number[];
  minimum: THREE.Vector3;
  maximum: THREE.Vector3;
}

function findIndexedGeometryComponents(
  geometry: THREE.BufferGeometry,
): GeometryComponent[] {
  const positions = geometry.getAttribute("position");
  const index = geometry.index;
  if (!positions || !index) {
    throw new Error(`${HANGAR_BARRIER_MESH} must remain indexed.`);
  }

  const parents = Array.from({ length: positions.count }, (_, vertex) => vertex);
  const find = (vertex: number): number => {
    let root = vertex;
    while (parents[root] !== root) root = parents[root];
    while (parents[vertex] !== vertex) {
      const next = parents[vertex];
      parents[vertex] = root;
      vertex = next;
    }
    return root;
  };
  const join = (first: number, second: number): void => {
    const firstRoot = find(first);
    const secondRoot = find(second);
    if (firstRoot !== secondRoot) parents[secondRoot] = firstRoot;
  };

  for (let offset = 0; offset < index.count; offset += 3) {
    const first = index.getX(offset);
    join(first, index.getX(offset + 1));
    join(first, index.getX(offset + 2));
  }

  // The accepted export splits vertices at hard edges. Weld equal positions for
  // component discovery only so each box is treated as one authored object.
  const vertexAtPosition = new Map<string, number>();
  for (let vertex = 0; vertex < positions.count; vertex += 1) {
    const key = `${positions.getX(vertex)}|${positions.getY(vertex)}|${positions.getZ(vertex)}`;
    const matchingVertex = vertexAtPosition.get(key);
    if (matchingVertex === undefined) vertexAtPosition.set(key, vertex);
    else join(vertex, matchingVertex);
  }

  const verticesByRoot = new Map<number, number[]>();
  for (let vertex = 0; vertex < positions.count; vertex += 1) {
    const root = find(vertex);
    const componentVertices = verticesByRoot.get(root);
    if (componentVertices) componentVertices.push(vertex);
    else verticesByRoot.set(root, [vertex]);
  }

  return [...verticesByRoot.values()].map((vertexIndices) => {
    const minimum = new THREE.Vector3(
      Number.POSITIVE_INFINITY,
      Number.POSITIVE_INFINITY,
      Number.POSITIVE_INFINITY,
    );
    const maximum = new THREE.Vector3(
      Number.NEGATIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
    );
    for (const vertex of vertexIndices) {
      const x = positions.getX(vertex);
      const y = positions.getY(vertex);
      const z = positions.getZ(vertex);
      minimum.x = Math.min(minimum.x, x);
      minimum.y = Math.min(minimum.y, y);
      minimum.z = Math.min(minimum.z, z);
      maximum.x = Math.max(maximum.x, x);
      maximum.y = Math.max(maximum.y, y);
      maximum.z = Math.max(maximum.z, z);
    }
    return { vertexIndices, minimum, maximum };
  });
}

function relocateHangarSixEdgeBarriers(
  mesh: THREE.Mesh,
  course: RaceCourse,
  contractDrift: string[],
): void {
  const geometry = mesh.geometry;
  const positions = geometry.getAttribute("position");
  const components = findIndexedGeometryComponents(geometry);
  const centerLocal = new THREE.Vector3();
  const centerWorld = new THREE.Vector3();
  const targetWorld = new THREE.Vector3();
  const targetLocal = new THREE.Vector3();
  const displacementLocal = new THREE.Vector3();
  let relocatedComponents = 0;
  let relocatedVertices = 0;

  for (const component of components) {
    centerLocal.addVectors(component.minimum, component.maximum).multiplyScalar(0.5);
    centerWorld.copy(centerLocal).applyMatrix4(mesh.matrixWorld);
    const projection = course.project(centerWorld, HANGAR_ROUTE_HINT_PROGRESS);
    const edgeOffset = Math.abs(projection.lateral) - projection.halfWidth;
    const height = component.maximum.y - component.minimum.y;
    const horizontalSpan = Math.hypot(
      component.maximum.x - component.minimum.x,
      component.maximum.z - component.minimum.z,
    );
    const heightAboveCourse = centerWorld.y - projection.position.y;
    const isEdgeBarrier = projection.sector === "HANGAR_SIX"
      && edgeOffset >= 0.4
      && edgeOffset <= 1.3
      && height >= 0.15
      && height <= 2.6
      && horizontalSpan >= 4
      && heightAboveCourse >= 1
      && heightAboveCourse <= 3;
    if (!isEdgeBarrier) continue;

    const side = Math.sign(projection.lateral) || 1;
    targetWorld.copy(centerWorld).addScaledVector(
      projection.right,
      side * HANGAR_BARRIER_OUTWARD_SHIFT_METERS,
    );
    targetLocal.copy(targetWorld);
    mesh.worldToLocal(targetLocal);
    displacementLocal.subVectors(targetLocal, centerLocal);
    for (const vertex of component.vertexIndices) {
      positions.setXYZ(
        vertex,
        positions.getX(vertex) + displacementLocal.x,
        positions.getY(vertex) + displacementLocal.y,
        positions.getZ(vertex) + displacementLocal.z,
      );
    }
    relocatedComponents += 1;
    relocatedVertices += component.vertexIndices.length;
  }

  if (relocatedComponents !== EXPECTED_RELOCATED_HANGAR_COMPONENTS) {
    const drift = `hangarComponents ${EXPECTED_RELOCATED_HANGAR_COMPONENTS} != ${relocatedComponents}`;
    contractDrift.push(drift);
    console.warn(`Greenwater authored-asset contract drift: ${drift}.`);
  }
  if (relocatedVertices !== EXPECTED_RELOCATED_HANGAR_VERTICES) {
    const drift = `hangarVertices ${EXPECTED_RELOCATED_HANGAR_VERTICES} != ${relocatedVertices}`;
    contractDrift.push(drift);
    console.warn(`Greenwater authored-asset contract drift: ${drift}.`);
  }
  positions.needsUpdate = true;
  geometry.boundingBox = null;
  geometry.boundingSphere = null;
  mesh.userData.runtimeRouteRepair = {
    relocatedComponents,
    relocatedVertices,
    outwardShiftMeters: HANGAR_BARRIER_OUTWARD_SHIFT_METERS,
  };
}

function createEnvironmentMaterial(source: THREE.MeshStandardMaterial): THREE.MeshLambertMaterial {
  const material = new THREE.MeshLambertMaterial({
    name: source.name,
    color: source.color,
    map: source.map,
    emissive: source.emissive,
    emissiveMap: source.emissiveMap,
    emissiveIntensity: source.emissiveIntensity,
    vertexColors: source.vertexColors,
    transparent: source.transparent,
    opacity: source.opacity,
    alphaTest: source.alphaTest,
    side: source.side,
    depthTest: source.depthTest,
    depthWrite: source.depthWrite,
    colorWrite: source.colorWrite,
    blending: source.blending,
    blendSrc: source.blendSrc,
    blendDst: source.blendDst,
    blendEquation: source.blendEquation,
    premultipliedAlpha: source.premultipliedAlpha,
    toneMapped: source.toneMapped,
    fog: source.fog,
  });
  material.alphaToCoverage = source.alphaToCoverage;
  material.polygonOffset = source.polygonOffset;
  material.polygonOffsetFactor = source.polygonOffsetFactor;
  material.polygonOffsetUnits = source.polygonOffsetUnits;
  return material;
}

function replaceEnvironmentMaterials(root: THREE.Object3D): void {
  const replacements = new Map<THREE.Material, THREE.Material>();
  const replace = (source: THREE.Material): THREE.Material => {
    const existing = replacements.get(source);
    if (existing) return existing;
    const replacement = source instanceof THREE.MeshStandardMaterial
      ? createEnvironmentMaterial(source)
      : source;
    replacements.set(source, replacement);
    return replacement;
  };
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.material = Array.isArray(object.material)
      ? object.material.map(replace)
      : replace(object.material);
  });
  for (const [source, replacement] of replacements) {
    if (source !== replacement) source.dispose();
  }
}

/**
 * H2b — the `?deck=hf` experiment, and the reason it is shaped like a probe
 * rather than like P18's facade swap.
 *
 * THE PREMISE THAT DID NOT HOLD. The brief for this called a deck-tile swap "a
 * material change on those meshes, like P18's facade swap". Measured off the
 * accepted GLB, it is not. Every `GW_SECTOR_*_concrete` mesh carries ATLAS UVs
 * spanning 0..1 (or 0.5..1) across its whole extent into ONE shared
 * `GW_MAT_concrete` image, and that image is not a concrete tile — it is a
 * sixteen-cell sheet whose cells are the runway thresholds, the chequer, the
 * chevron array, the A9 numerals, the wear patches and the KD 114 datum plate.
 * The paint IS the deck texture. P18's facades worked because the facade layer
 * is procedurally UV'd into a region sheet; this layer is baked, and the bake
 * is the accepted art.
 *
 * So a "tile swap" here does two things at once: it retiles, and it DELETES
 * every runway marking on the circuit. That is the finding, and this function
 * exists so it can be photographed rather than argued.
 *
 * What it does, as fairly as the geometry allows. One cloned material per
 * sector, because the twelve sectors share one material and their atlas UV
 * ranges differ, so a single `repeat` could not give them a common
 * metres-per-tile — which is itself part of the finding. Each clone's `repeat`
 * and `offset` are derived from that mesh's own world extent and UV range, so
 * the tile lands at {@link DECK_TILE_METRES} on every sector rather than on the
 * average one. `receiveShadow` is untouched (it lives on the mesh, not the
 * material) and the clone carries the colour, fog and side settings over, so
 * the only thing that changes is the map.
 *
 * The cloning costs draw calls — twelve materials where there was one — and
 * that cost is measured and reported rather than hidden. It is one of the
 * reasons this is review-only.
 */
function applyDeckTileExperiment(root: THREE.Object3D, tile: THREE.Texture): number {
  let swapped = 0;
  const box = new THREE.Box3();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    if (!object.name.endsWith("_concrete")) return;
    const material = Array.isArray(object.material) ? object.material[0] : object.material;
    if (!(material instanceof THREE.MeshLambertMaterial)) return;
    const uv = object.geometry.getAttribute("uv");
    if (!uv) return;
    let uMin = Infinity;
    let uMax = -Infinity;
    let vMin = Infinity;
    let vMax = -Infinity;
    for (let index = 0; index < uv.count; index += 1) {
      const u = uv.getX(index);
      const v = uv.getY(index);
      if (u < uMin) uMin = u;
      if (u > uMax) uMax = u;
      if (v < vMin) vMin = v;
      if (v > vMax) vMax = v;
    }
    object.geometry.computeBoundingBox();
    box.copy(object.geometry.boundingBox as THREE.Box3).applyMatrix4(object.matrixWorld);
    const width = Math.max(1, box.max.x - box.min.x);
    const depth = Math.max(1, box.max.z - box.min.z);
    // The UV axes are the ribbon's own along/across, not world XZ, so the two
    // world extents are assigned to the two UV spans by SIZE rather than by
    // axis: the longer world extent belongs to the wider UV span.
    const uSpan = Math.max(1e-3, uMax - uMin);
    const vSpan = Math.max(1e-3, vMax - vMin);
    const longer = Math.max(width, depth);
    const shorter = Math.min(width, depth);
    const uMetres = uSpan >= vSpan ? longer : shorter;
    const vMetres = uSpan >= vSpan ? shorter : longer;
    const swap = material.clone();
    swap.name = `${material.name}_deck_hf`;
    const map = tile.clone();
    map.wrapS = THREE.RepeatWrapping;
    map.wrapT = THREE.RepeatWrapping;
    map.colorSpace = THREE.SRGBColorSpace;
    map.repeat.set(
      uMetres / DECK_TILE_METRES / uSpan,
      vMetres / DECK_TILE_METRES / vSpan,
    );
    map.offset.set(-uMin * map.repeat.x, -vMin * map.repeat.y);
    map.needsUpdate = true;
    swap.map = map;
    swap.needsUpdate = true;
    object.material = swap;
    swapped += 1;
  });
  return swapped;
}

function findLivingTextures(root: THREE.Object3D): GreenwaterLivingTextures {
  let jungle: THREE.Texture | null = null;
  let emissive: THREE.Texture | null = null;
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      if (material instanceof THREE.MeshLambertMaterial) {
        if (material.name === "GW_MAT_jungle") jungle = material.map;
        if (material.name === "GW_MAT_emissive") {
          emissive = material.emissiveMap ?? material.map;
        }
      }
    }
  });
  if (!jungle || !emissive) {
    throw new Error("Greenwater runtime is missing the living-world atlas textures.");
  }
  return { jungle, emissive };
}

export class GreenwaterEnvironment {
  readonly root: THREE.Group;
  readonly stats: GreenwaterEnvironmentStats;
  readonly livingTextures: GreenwaterLivingTextures;
  private readonly cullGroups: CullGroup[];
  private readonly frustum = new THREE.Frustum();
  private readonly viewProjection = new THREE.Matrix4();

  private constructor(
    root: THREE.Group,
    cullGroups: CullGroup[],
    triangles: number,
    contractDrift: string[],
  ) {
    this.root = root;
    this.cullGroups = cullGroups;
    replaceEnvironmentMaterials(root);
    this.livingTextures = findLivingTextures(root);
    const treatment = applyPs2MaterialTreatment(root, {
      worldGeometry: true,
      textureCharacter: "painterly",
    });
    this.stats = {
      meshes: cullGroups.length,
      triangles,
      materials: treatment.materials,
      textures: treatment.textures,
      visibleGroups: cullGroups.length,
      visibleTriangles: triangles,
      shaderModel: "lambert",
      signageSource: "baked",
      contractDrift,
    };
  }

  static async load(url: string, course: RaceCourse): Promise<GreenwaterEnvironment> {
    const scene = (await new GLTFLoader().loadAsync(url)).scene;
    const contractDrift: string[] = [];
    try {
      const runtime = scene.getObjectByName("GW_ENVIRONMENT_RUNTIME");
      if (!runtime) {
        throw new Error("Greenwater runtime root is missing.");
      }
      scene.updateMatrixWorld(true);
      const hangarBarrierMesh = runtime.getObjectByName(HANGAR_BARRIER_MESH);
      if (!(hangarBarrierMesh instanceof THREE.Mesh)) {
        throw new Error(`${HANGAR_BARRIER_MESH} is missing.`);
      }
      relocateHangarSixEdgeBarriers(hangarBarrierMesh, course, contractDrift);
      const cullGroups: CullGroup[] = [];
      let triangles = 0;
      runtime.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        const cullDistance = object.userData.cull;
        if (!Number.isFinite(cullDistance) || cullDistance <= 0) {
          throw new Error(`${object.name} has no valid cull distance.`);
        }
        const geometry = object.geometry;
        if (!geometry.boundingSphere) geometry.computeBoundingSphere();
        const localSphere = geometry.boundingSphere;
        if (!localSphere) throw new Error(`${object.name} has no bounding sphere.`);
        const scale = object.matrixWorld.getMaxScaleOnAxis();
        const center = localSphere.center.clone().applyMatrix4(object.matrixWorld);
        const radius = localSphere.radius * scale;
        const meshTriangles = geometry.index
          ? geometry.index.count / 3
          : geometry.getAttribute("position").count / 3;
        cullGroups.push({
          mesh: object,
          sphere: new THREE.Sphere(center, radius),
          maximumDistanceSquared: (cullDistance + radius) ** 2,
          triangles: meshTriangles,
        });
        triangles += meshTriangles;
        // P20.1. The sector meshes are the Greenwater deck AND the structures
        // beside it, in one family per material, so this arms both the casters
        // and the deck's own self-shadowing in a single flag — except for the
        // two families in NON_CASTING_MATERIALS below.
        object.castShadow = !NON_CASTING_MATERIALS.has(
          (Array.isArray(object.material) ? object.material[0] : object.material)?.name,
        );
        object.receiveShadow = true;
      });
      if (cullGroups.length !== EXPECTED_RUNTIME_MESHES) {
        const drift = `meshes ${EXPECTED_RUNTIME_MESHES} != ${cullGroups.length}`;
        contractDrift.push(drift);
        console.warn(`Greenwater authored-asset contract drift: ${drift}.`);
      }
      scene.name = "greenwater_authored_environment";
      const environment = new GreenwaterEnvironment(
        scene,
        cullGroups,
        triangles,
        contractDrift,
      );
      // H2b — review only, after the constructor so the swap lands on the
      // Lambert materials `replaceEnvironmentMaterials` produced rather than on
      // the GLB's originals. A failed fetch leaves the accepted deck exactly as
      // it was, which is the correct failure for a probe.
      if (deckTileEnabled()) {
        try {
          const tile = await new THREE.TextureLoader().loadAsync(DECK_TILE_URL);
          const swapped = applyDeckTileExperiment(scene, tile);
          tile.dispose();
          console.info(`[FUTURISMA_DECK_TILE] ${swapped} sector deck material(s) swapped `
            + `at ${DECK_TILE_METRES} m per tile.`);
        } catch {
          console.warn("[FUTURISMA_DECK_TILE] tile unavailable; the accepted deck stands.");
        }
      }
      return environment;
    } catch (error) {
      disposeObject3DResources(scene);
      throw error;
    }
  }

  updateVisibility(camera: THREE.Camera): void {
    camera.updateMatrixWorld();
    this.viewProjection.multiplyMatrices(
      camera.projectionMatrix,
      camera.matrixWorldInverse,
    );
    this.frustum.setFromProjectionMatrix(this.viewProjection);
    let visibleGroups = 0;
    let visibleTriangles = 0;
    for (const group of this.cullGroups) {
      group.mesh.visible = camera.position.distanceToSquared(group.sphere.center)
        <= group.maximumDistanceSquared
        && this.frustum.intersectsSphere(group.sphere);
      if (!group.mesh.visible) continue;
      visibleGroups += 1;
      visibleTriangles += group.triangles;
    }
    this.stats.visibleGroups = visibleGroups;
    this.stats.visibleTriangles = visibleTriangles;
  }
}

export function setProceduralEnvironmentVisible(
  courseRoot: THREE.Object3D,
  visible: boolean,
): void {
  for (const name of REPLACED_PROCEDURAL_OBJECTS) {
    const object = courseRoot.getObjectByName(name);
    if (object) object.visible = visible;
  }
}
