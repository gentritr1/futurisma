import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { RaceCourse } from "./course";
import { disposeObject3DResources } from "./graphics-resources";
import { applyPs2MaterialTreatment } from "./totem";

const EXPECTED_RUNTIME_MESHES = 60;
const HANGAR_BARRIER_MESH = "GW_SECTOR_HANGAR_SIX_concrete";
const HANGAR_ROUTE_HINT_PROGRESS = 0.28;
const HANGAR_BARRIER_OUTWARD_SHIFT_METERS = 4;
const EXPECTED_RELOCATED_HANGAR_COMPONENTS = 76;
const EXPECTED_RELOCATED_HANGAR_VERTICES = 2_400;
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
    const treatment = applyPs2MaterialTreatment(root, { worldGeometry: true });
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
        object.castShadow = false;
        object.receiveShadow = true;
      });
      if (cullGroups.length !== EXPECTED_RUNTIME_MESHES) {
        const drift = `meshes ${EXPECTED_RUNTIME_MESHES} != ${cullGroups.length}`;
        contractDrift.push(drift);
        console.warn(`Greenwater authored-asset contract drift: ${drift}.`);
      }
      scene.name = "greenwater_authored_environment";
      return new GreenwaterEnvironment(
        scene,
        cullGroups,
        triangles,
        contractDrift,
      );
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
