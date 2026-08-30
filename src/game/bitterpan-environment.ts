import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import productionJson from "./data/map02/BITTERPAN_PRODUCTION.json";
import type { RaceEnvironment, RaceEnvironmentStats } from "./environment";
import { BitterpanFacades } from "./bitterpan-facades";
import { disposeObject3DResources } from "./graphics-resources";
import { searchFlag } from "./query-probes";
import { activeRenderMode } from "./render-mode.js";
import { timeOfDayDrift } from "./time-of-day";
import { applyPs2MaterialTreatment } from "./totem";

const EXPECTED_TRACK_PRIMITIVES = 5;
const EXPECTED_MASSING_PRIMITIVES = 15;
const EXPECTED_VISIBLE_TRIANGLES = 11_268;
const CULLING = (productionJson as unknown as {
  culling: {
    baseDistanceMetres: number;
    radiusMultiplier: number;
    maximumDistanceMetres: number;
  };
}).culling;

/**
 * One cullable primitive. Mirrors `CullGroup` in environment.ts, but Greenwater
 * reads an authored `userData.cull` off every mesh and Map 02 has none — the
 * accepted payload never authored one — so the distance is derived from the
 * primitive's own bounding sphere instead.
 */
interface BitterpanCullGroup {
  mesh: THREE.Mesh;
  sphere: THREE.Sphere;
  maximumDistanceSquared: number;
  triangles: number;
}

/**
 * Derived cull distance. Bitterpan renders at `camera.far = 1800` against
 * Greenwater's 650, so the far plane cannot be relied on to bound anything: a
 * distance test is the only thing that will ever retire the small props.
 *
 * The multiplier is on the radius rather than a fixed distance because the
 * accepted GLBs merge geometry *by family across the whole 589 x 1214 m site*.
 * A 30 m loadout tower and a 675 m track ribbon are both single primitives, and
 * only the small ones can honestly be retired early; everything else is left to
 * the frustum.
 */
function deriveCullDistance(radius: number): number {
  return Math.min(
    CULLING.maximumDistanceMetres,
    CULLING.baseDistanceMetres + radius * CULLING.radiusMultiplier,
  );
}

/**
 * The accepted massing placement table, served rather than bundled.
 *
 * `public/data/map02/MASSING_PLACEMENTS.json` is 156 KB and is hash-pinned by
 * `scripts/validate-map02.mjs`. The facade mapper needs it to tell which
 * structure a merged element belongs to, and only on Bitterpan, so it is
 * fetched beside the GLBs instead of import-bundled into every map's payload.
 */
async function loadPlacements(url: string): Promise<readonly {
  id: string;
  family: string;
  position: [number, number, number];
  height_m: number;
  footprint_m: [number, number];
}[]> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Bitterpan massing placements ${url} returned ${response.status}.`);
  }
  const payload = await response.json();
  if (!Array.isArray(payload?.placements)) {
    throw new Error("Bitterpan massing placements payload has no placement list.");
  }
  return payload.placements;
}

/** Builds a world-space cull group for every visible mesh under `root`. */
function collectCullGroups(root: THREE.Object3D): BitterpanCullGroup[] {
  const groups: BitterpanCullGroup[] = [];
  root.updateMatrixWorld(true);
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || !object.visible) return;
    const geometry = object.geometry;
    if (!geometry.boundingSphere) geometry.computeBoundingSphere();
    const localSphere = geometry.boundingSphere;
    if (!localSphere) return;
    const scale = object.matrixWorld.getMaxScaleOnAxis();
    const radius = localSphere.radius * scale;
    groups.push({
      mesh: object,
      sphere: new THREE.Sphere(
        localSphere.center.clone().applyMatrix4(object.matrixWorld),
        radius,
      ),
      maximumDistanceSquared: (deriveCullDistance(radius) + radius) ** 2,
      triangles: (
        geometry.index?.count ?? geometry.getAttribute("position").count
      ) / 3,
    });
  });
  return groups;
}
const ROUTE_PALETTE = {
  deck: new THREE.Color(0x252c29),
  kerb: new THREE.Color(0xd7f05a),
  barrier: new THREE.Color(0xc85f32),
} as const;

function createLambertMaterial(source: THREE.MeshStandardMaterial): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({
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
    toneMapped: source.toneMapped,
    fog: source.fog,
  });
}

function replaceStandardMaterials(root: THREE.Object3D): void {
  const replacements = new Map<THREE.Material, THREE.Material>();
  const replace = (source: THREE.Material): THREE.Material => {
    const existing = replacements.get(source);
    if (existing) return existing;
    const replacement = source instanceof THREE.MeshStandardMaterial
      ? createLambertMaterial(source)
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

function applyRuntimeRoutePalette(root: THREE.Object3D): void {
  const styled = new Set<THREE.Material>();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      if (styled.has(material) || !(material instanceof THREE.MeshLambertMaterial)) continue;
      styled.add(material);
      if (material.name === "BLOCKOUT_deck") {
        material.color.copy(ROUTE_PALETTE.deck);
        material.emissive.setHex(0x050806);
        material.emissiveIntensity = 0.1;
      } else if (material.name === "BLOCKOUT_kerb") {
        material.color.copy(ROUTE_PALETTE.kerb);
        material.emissive.setHex(0x3a470d);
        material.emissiveIntensity = 0.5;
      } else if (material.name === "BLOCKOUT_barrier") {
        material.color.copy(ROUTE_PALETTE.barrier);
        material.emissive.setHex(0x3d1307);
        material.emissiveIntensity = 0.36;
      } else {
        continue;
      }
      material.needsUpdate = true;
    }
  });
}

function countVisibleMeshes(root: THREE.Object3D): {
  meshes: number;
  triangles: number;
} {
  let meshes = 0;
  let triangles = 0;
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || !object.visible) return;
    meshes += 1;
    triangles += (
      object.geometry.index?.count
      ?? object.geometry.getAttribute("position").count
    ) / 3;
    object.castShadow = false;
    object.receiveShadow = true;
  });
  return { meshes, triangles };
}

function countVisibleResources(root: THREE.Object3D): {
  materials: number;
  textures: number;
} {
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || !object.visible) return;
    const meshMaterials = Array.isArray(object.material)
      ? object.material
      : [object.material];
    for (const material of meshMaterials) {
      materials.add(material);
      const textured = material as THREE.Material & { map?: THREE.Texture | null };
      if (textured.map) textures.add(textured.map);
    }
  });
  return { materials: materials.size, textures: textures.size };
}

export class BitterpanEnvironment implements RaceEnvironment {
  readonly root: THREE.Group;
  readonly stats: RaceEnvironmentStats;
  private readonly cullGroups: BitterpanCullGroup[];
  private readonly frustum = new THREE.Frustum();
  private readonly viewProjection = new THREE.Matrix4();

  private constructor(
    root: THREE.Group,
    meshes: number,
    triangles: number,
    contractDrift: string[],
    readonly facades: BitterpanFacades | null,
  ) {
    this.root = root;
    this.cullGroups = collectCullGroups(root);
    replaceStandardMaterials(root);
    // The accepted GLBs stay byte-identical. Their pale review palette was
    // authored for diagrams and disappears against the live fog/sky. Runtime
    // colors provide the value separation required to drive the blockout.
    applyRuntimeRoutePalette(root);
    // The map-02 GLBs ship untextured, so the class is a no-op today; it is
    // declared anyway because a baked sheet here would belong with Greenwater's.
    applyPs2MaterialTreatment(root, {
      worldGeometry: true,
      textureCharacter: "painterly",
    });
    // P18 — the treatment's "painterly" class is already linear + mipped, which
    // is what the facade sheet asks for, but it pins anisotropy to 1. These
    // faces are read from 8 m to 900 m in the same frame and almost all of them
    // are seen at a grazing angle; the delivery names anisotropy 4 for exactly
    // that. Restored here, in one place, and only outside `?render=ps2` — that
    // mode's whole contract is that nothing escapes the raster.
    if (facades && activeRenderMode() !== "ps2") facades.restoreAnisotropy();
    const resources = countVisibleResources(root);
    this.stats = {
      meshes,
      triangles,
      materials: resources.materials,
      textures: resources.textures,
      visibleGroups: meshes,
      visibleTriangles: triangles,
      shaderModel: "lambert",
      signageSource: "none",
      contractDrift,
    };
  }

  static async load(
    trackUrl: string,
    massingUrl: string,
    facadeTextureUrl: string,
    placementsUrl: string,
  ): Promise<BitterpanEnvironment> {
    const loader = new GLTFLoader();
    const [trackResult, massingResult] = await Promise.allSettled([
      loader.loadAsync(trackUrl),
      loader.loadAsync(massingUrl),
    ]);
    if (trackResult.status === "rejected" || massingResult.status === "rejected") {
      if (trackResult.status === "fulfilled") {
        disposeObject3DResources(trackResult.value.scene);
      }
      if (massingResult.status === "fulfilled") {
        disposeObject3DResources(massingResult.value.scene);
      }
      throw trackResult.status === "rejected"
        ? trackResult.reason
        : massingResult.status === "rejected"
          ? massingResult.reason
          : new Error("Bitterpan environment load failed.");
    }

    const trackScene = trackResult.value.scene;
    const massingScene = massingResult.value.scene;
    try {
      const track = trackScene.getObjectByName("GW2_TRACK_BLOCKOUT");
      const collision = trackScene.getObjectByName("GW2_COLLISION_PROXY");
      const massing = massingScene.getObjectByName("GW2_SITE_MASSING");
      if (!track || !collision || !massing) {
        throw new Error("Bitterpan GLBs are missing an accepted runtime node.");
      }
      collision.visible = false;
      const trackStats = countVisibleMeshes(track);
      const massingStats = countVisibleMeshes(massing);
      // A re-exported blockout must not black-screen the race. Count drift is
      // reported to diagnostics; scripts/validate-map02.mjs keeps the hard
      // build-time assertion on the accepted bytes.
      const contractDrift: string[] = [];
      const visibleTriangles = trackStats.triangles + massingStats.triangles;
      if (trackStats.meshes !== EXPECTED_TRACK_PRIMITIVES) {
        contractDrift.push(
          `trackPrimitives ${EXPECTED_TRACK_PRIMITIVES} != ${trackStats.meshes}`,
        );
      }
      if (massingStats.meshes !== EXPECTED_MASSING_PRIMITIVES) {
        contractDrift.push(
          `massingPrimitives ${EXPECTED_MASSING_PRIMITIVES} != ${massingStats.meshes}`,
        );
      }
      if (visibleTriangles !== EXPECTED_VISIBLE_TRIANGLES) {
        contractDrift.push(
          `visibleTriangles ${EXPECTED_VISIBLE_TRIANGLES} != ${visibleTriangles}`,
        );
      }
      for (const drift of contractDrift) {
        console.warn(`Bitterpan authored-asset contract drift: ${drift}.`);
      }

      // P18 task 5 — the vestigial blockout ROAD stops rendering.
      //
      // `GW2_TRACK_BLOCKOUT` is not the road the player drives. Greenwater
      // calls `setProceduralEnvironmentVisible(course.group, false)` so its GLB
      // replaces the procedural ribbon; the Bitterpan branch never did, so both
      // existed at once and the ribbon — built from CENTRELINE_STATIONS,
      // correctly banked — is what renders under the craft. P16 measured the
      // duplicate's cross-section as MIRRORED against the course model (a
      // constant 1.303 m at lateral 14.925 = sin(5.0 deg), exactly twice the
      // authored 2.5-degree bank) and excluded it from the corridor sweep for
      // that reason. What was left was a second road drawn through the real
      // one, and with it the legacy `BLOCKOUT_barrier` orange edge banding.
      //
      // Removed from RENDER, not from LOAD, and deliberately so: the accepted
      // GLB keeps being parsed, its five primitives and 6,100 triangles keep
      // being counted, and `contractDrift` above is still computed from the
      // full accepted payload. The freeze contract that
      // `finalMap02NativeBlockoutFreeze` stands for is a contract about the
      // BYTES — `scripts/validate-map02.mjs` asserts them against the file —
      // and nothing about it is weakened by not drawing the mesh. Dropping the
      // load would have weakened it.
      //
      // The replacement is authored and lands in the same change:
      // BITTERPAN_ROAD_EDGE_BAND, painted on the ribbon itself. Two orange edge
      // languages in one frame is worse than either alone.
      //
      // Hidden on every descendant, not just the group: `collectCullGroups`,
      // `countVisibleMeshes` and `countVisibleResources` all test the object's
      // own `visible`, and `updateVisibility` writes it every frame — a group
      // flag alone would stop the draw but leave all three counters lying.
      //
      // `?diagnostics=1&legacyBlockout=1` keeps it drawn. That is the A/B lever
      // for this change and nothing else: it exists because "the old orange
      // banding is gone and the authored band replaced it" is a claim only a
      // before/after pair can settle, and a reviewer should not have to check
      // out the previous commit to see the before. Gated on diagnostics, so no
      // player can reach it.
      const keepLegacyBlockout = searchFlag("diagnostics") && searchFlag("legacyBlockout");
      if (!keepLegacyBlockout) {
        track.traverse((object) => {
          object.visible = false;
        });
      }

      const facades = await BitterpanFacades.load(
        massing,
        await loadPlacements(placementsUrl),
        facadeTextureUrl,
      );

      const root = new THREE.Group();
      root.name = "map02_bitterpan_authored_environment";
      root.add(trackScene, massingScene);
      // Recounted AFTER the blockout road is hidden, so `environmentMeshes` and
      // `environmentTriangles` report what is drawn rather than what was
      // loaded. The accepted-contract numbers above are untouched.
      const drawn = countVisibleMeshes(root);
      return new BitterpanEnvironment(
        root,
        drawn.meshes,
        drawn.triangles,
        contractDrift,
        facades,
      );
    } catch (error) {
      disposeObject3DResources(trackScene);
      disposeObject3DResources(massingScene);
      throw error;
    }
  }

  /**
   * Distance + frustum culling, the same test Greenwater runs, allocation-free.
   *
   * Honest note on what this buys: the accepted Map 02 GLBs merge geometry by
   * family across the whole site, so 15 of the 20 primitives carry 240-816 m
   * bounding radii and only the three small ones (the loadout tower and two
   * prop batches) are ever retired. `visibleGroups` therefore drops below
   * `meshes`, but the triangle saving is small by construction. Splitting the
   * merged primitives spatially would fix that and is an art-phase change: it
   * would break the accepted-byte freeze and trade real draw calls for the
   * saving, which at 11,268 triangles against a 140,000 ceiling is not a trade
   * worth making yet.
   */
  updateVisibility(camera: THREE.Camera): void {
    // P18 — the facade window strips ride the existing time-of-day stop
    // mechanism. WINDOW_STRIP_DUSK and WINDOW_STRIP_DEAD are the same eight
    // bays at the same pitch, cross-faded on the drift the atmosphere already
    // resolves, rather than tinted: an amber-tinted dead window is a dead
    // window, not a lit one. Driven from here because this is the one
    // Bitterpan-only per-frame call that already exists, and `game.ts` is on a
    // hard line budget.
    this.facades?.setWindowBlend(timeOfDayDrift());
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
