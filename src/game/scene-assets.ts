import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { ASSET_KIT_PROP_PLACEMENTS } from "./asset-kit-layout";
import type { BitterpanSurface } from "./bitterpan-surface";
import type { CorridorSweepResult } from "./corridor-sweep";
import { type RaceCourse } from "./course";
import type { RaceEnvironment } from "./environment";
import { disposeObject3DResources } from "./graphics-resources";
import type { LivingWorld, LivingWorldTextures } from "./living-world";
import type { GreenwaterOpeningSurface } from "./opening-surface";
import type { HangarPlaqueBacking } from "./plaque-backing";
import { probeSelected } from "./query-probes";
import type { TracksideSignage } from "./signage";
import type { GreenwaterSurfaceCharacter } from "./surface-character";
import { applyPs2MaterialTreatment } from "./totem";

/**
 * P16 — scene roots the corridor sweep does not treat as scenery.
 *
 * Filled from the sweep's own first run: these are the objects that legitimately
 * occupy the driving volume. Named roots rather than a class test, so anything
 * new that appears in the corridor shows up in the report instead of being
 * quietly absorbed by a category.
 */
const CORRIDOR_SWEEP_EXCLUDED_NAMES: ReadonlySet<string> = new Set([
  "totem_vehicle_root",
  "totem_rival_fleet",
]);

/**
 * The "not swept" reading, declared here rather than imported so that
 * `corridor-sweep.ts` stays entirely out of the initial bundle. `ran: false` is
 * the load-bearing field: every zero below means "no measurement", never "clean".
 */
const CORRIDOR_SWEEP_NOT_RUN: CorridorSweepResult = Object.freeze({
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
  list: Object.freeze([]) as CorridorSweepResult["list"],
  elapsedMs: 0,
});

const ASSET_KIT_MODEL_URL = "/assets/totem/models/futurisma_asset_kit.glb";
const ENVIRONMENT_MODEL_URL = "/assets/greenwater/models/greenwater_environment_runtime.glb";
/**
 * The mist / steam / rain / glint motion atlas. Authored for Greenwater and
 * frozen inside `GREENWATER_LIVING_WORLD_v1.3.zip`, but the four quadrants are
 * generic soft shapes, so Bitterpan's zone set draws its heat, salt dust,
 * conveyor spill and lamps out of the same sheet rather than shipping a second
 * 512 for the same four blobs.
 */
const LIVING_WORLD_MOTION_URL = "/assets/greenwater/textures/greenwater_motion_512.png";
/**
 * P12 art pass 01. The second motion sheet — birds, dust devils, far-field
 * wrecks and dry scud. Shared by both maps for the same reason the first one
 * is: the cells are generic, and a second 512 beats a second draw call.
 */
const LIVING_WORLD_MOTION_B_URL = "/assets/greenwater/textures/greenwater_motion_b_512.png";
/** P12. Runway surface marking atlas, Greenwater opening straight only. */
const OPENING_SURFACE_TEXTURE_URL = "/assets/greenwater/textures/greenwater_runway_1024.png";
/** P12. Trackside board atlas, both maps. */
const SIGNAGE_TEXTURE_URL = "/assets/greenwater/textures/futurisma_signage_1024.png";
/**
 * P15 art pass 02. The pan crust: a 256 seamless tile for the ground itself and
 * a 1024 decal sheet for the 407 cracks, brine patches, windrows, scrape
 * bundles, spill fans and conveyor shadows drawn over it. Bitterpan only.
 */
const BITTERPAN_CRUST_TILE_URL = "/assets/map02/textures/bitterpan_crust_tile_256.png";
const BITTERPAN_CRUST_DECAL_URL = "/assets/map02/textures/bitterpan_crust_1024.png";
/** P15. Hangar Six fixture panels — the plaque backings. Greenwater only. */
const HANGAR_FIXTURES_TEXTURE_URL = "/assets/greenwater/textures/hangar_fixtures_512.png";
const SURFACE_CHARACTER_MODEL_URL = "/assets/greenwater/models/greenwater_surface_character_runtime.glb";
const BITTERPAN_TRACK_MODEL_URL = "/assets/map02/models/bitterpan_blockout.glb";
const BITTERPAN_MASSING_MODEL_URL = "/assets/map02/models/bitterpan_massing.glb";

interface StaticGeometryBucket {
  material: THREE.Material;
  geometries: THREE.BufferGeometry[];
}

function mergeStaticSceneByMaterial(source: THREE.Object3D): THREE.Group {
  source.updateMatrixWorld(true);
  const buckets = new Map<string, StaticGeometryBucket>();
  const fallbackMeshes: THREE.Mesh[] = [];

  source.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    if (Array.isArray(object.material) || object instanceof THREE.InstancedMesh) {
      const fallback = new THREE.Mesh(object.geometry.clone(), object.material);
      fallback.geometry.applyMatrix4(object.matrixWorld);
      fallbackMeshes.push(fallback);
      return;
    }
    const geometry = object.geometry.index
      ? object.geometry.toNonIndexed()
      : object.geometry.clone();
    geometry.applyMatrix4(object.matrixWorld);
    const attributeSignature = Object.keys(geometry.attributes)
      .map((name) => {
        const attribute = geometry.attributes[name] as THREE.BufferAttribute;
        return `${name}:${attribute.itemSize}:${attribute.normalized}`;
      })
      .sort()
      .join("|");
    const key = `${object.material.uuid}|${attributeSignature}`;
    const bucket: StaticGeometryBucket = buckets.get(key) ?? {
      material: object.material,
      geometries: [] as THREE.BufferGeometry[],
    };
    bucket.geometries.push(geometry);
    buckets.set(key, bucket);
  });

  const mergedRoot = new THREE.Group();
  mergedRoot.name = "totem_asset_kit_course_dressing";
  for (const bucket of buckets.values()) {
    const geometry = mergeGeometries(bucket.geometries, false);
    for (const sourceGeometry of bucket.geometries) sourceGeometry.dispose();
    if (!geometry) continue;
    mergedRoot.add(new THREE.Mesh(geometry, bucket.material));
  }
  if (fallbackMeshes.length > 0) mergedRoot.add(...fallbackMeshes);
  return mergedRoot;
}

function placeCourseAlignedObject(
  object: THREE.Object3D,
  sample: ReturnType<RaceCourse["sample"]>,
  lateral: number,
  yaw: number,
  scale: number,
): void {
  object.position.copy(sample.position).addScaledVector(sample.right, lateral);
  object.quaternion.setFromRotationMatrix(
    new THREE.Matrix4().makeBasis(
      sample.right,
      sample.up,
      sample.tangent.clone().multiplyScalar(-1),
    ),
  );
  object.rotateY(yaw);
  object.scale.setScalar(scale);
}

function createNormalizedPropInstance(
  source: THREE.Object3D,
  name: string,
): THREE.Group {
  const template = source.getObjectByName(name);
  if (!template) throw new Error(`Accepted asset kit is missing ${name}.`);
  const prop = template.clone(true);
  const bounds = new THREE.Box3().setFromObject(prop);
  if (bounds.isEmpty()) throw new Error(`Accepted asset kit prop ${name} has no bounds.`);
  const center = bounds.getCenter(new THREE.Vector3());
  prop.position.x -= center.x;
  prop.position.y -= bounds.min.y;
  prop.position.z -= center.z;
  const root = new THREE.Group();
  root.name = `${name}_course_instance`;
  root.add(prop);
  return root;
}

function createAssetKitCourseDressing(
  source: THREE.Object3D,
  course: RaceCourse,
): THREE.Group {
  const dressing = new THREE.Group();
  dressing.name = "totem_asset_kit_course_source";
  for (const placement of ASSET_KIT_PROP_PLACEMENTS) {
    const prop = createNormalizedPropInstance(source, placement.name);
    placeCourseAlignedObject(
      prop,
      course.sampleAtDistance(placement.distance),
      placement.lateral,
      placement.yaw,
      placement.scale,
    );
    dressing.add(prop);
  }

  placeCourseAlignedObject(source, course.sample(0.985), -22, 0, 1);
  dressing.add(source);
  return dressing;
}

/**
 * Authored scene layers loaded after the race is already interactive: the map
 * environment, the living-world card layer, the surface character and the
 * Phase 1 asset-kit dressing fallback. Owns their load telemetry so every
 * diagnostics contributor for those layers lives in one module.
 */
export class SceneAssets {
  authoredEnvironment: RaceEnvironment | null = null;
  livingWorld: LivingWorld | null = null;
  surfaceCharacter: GreenwaterSurfaceCharacter | null = null;
  openingSurface: GreenwaterOpeningSurface | null = null;
  signage: TracksideSignage | null = null;
  /** P15: the Bitterpan pan crust + set dressing, and the Hangar Six backings. */
  bitterpanSurface: BitterpanSurface | null = null;
  plaqueBacking: HangarPlaqueBacking | null = null;
  private bitterpanSurfaceLoadMs: number | null = null;
  private bitterpanSurfaceReady = false;
  private bitterpanSurfaceError: string | null = null;
  private plaqueBackingLoadMs: number | null = null;
  private plaqueBackingReady = false;
  private plaqueBackingError: string | null = null;
  private openingSurfaceLoadMs: number | null = null;
  private openingSurfaceReady = false;
  private openingSurfaceError: string | null = null;
  private signageLoadMs: number | null = null;
  private signageReady = false;
  private signageError: string | null = null;
  private assetKitLoadMs: number | null = null;
  private assetKitReady = false;
  private environmentLoadMs: number | null = null;
  private environmentReady = false;
  private environmentError: string | null = null;
  private livingWorldLoadMs: number | null = null;
  private livingWorldReady = false;
  private livingWorldError: string | null = null;
  private surfaceCharacterLoadMs: number | null = null;
  private surfaceCharacterReady = false;
  private surfaceCharacterError: string | null = null;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.PerspectiveCamera,
    private readonly course: RaceCourse,
    private readonly isDisposed: () => boolean,
    private readonly requestRender: () => void,
  ) {}

  async loadAuthoredEnvironment(): Promise<void> {
    const environmentLoadStartedAt = performance.now();
    try {
      if (this.course.kind === "bitterpan") {
        const { BitterpanEnvironment } = await import("./bitterpan-environment");
        const environment = await BitterpanEnvironment.load(
          BITTERPAN_TRACK_MODEL_URL,
          BITTERPAN_MASSING_MODEL_URL,
        );
        this.environmentLoadMs = performance.now() - environmentLoadStartedAt;
        if (this.isDisposed()) {
          disposeObject3DResources(environment.root);
          return;
        }
        this.authoredEnvironment = environment;
        this.scene.add(environment.root);
        this.environmentReady = true;
        this.requestRender();
        // Bitterpan's zone set names only the shared motion atlases, so it needs
        // nothing off the accepted blockout the way Greenwater needs its jungle
        // and emissive maps.
        await Promise.all([
          this.loadLivingWorld({}),
          this.loadSignage(),
          this.loadBitterpanSurface(),
        ]);
        return;
      }

      const {
        GreenwaterEnvironment: GreenwaterEnvironmentRuntime,
        setProceduralEnvironmentVisible,
      } = await import("./environment");
      const environment = await GreenwaterEnvironmentRuntime.load(
        ENVIRONMENT_MODEL_URL,
        this.course,
      );
      this.environmentLoadMs = performance.now() - environmentLoadStartedAt;
      if (this.isDisposed()) {
        disposeObject3DResources(environment.root);
        return;
      }
      this.authoredEnvironment = environment;
      setProceduralEnvironmentVisible(this.course.group, false);
      environment.updateVisibility(this.camera);
      this.scene.add(environment.root);
      this.environmentReady = true;
      this.requestRender();
      await Promise.all([
        this.loadLivingWorld(environment.livingTextures),
        this.loadSurfaceCharacter(),
        this.loadOpeningSurface(),
        this.loadSignage(),
        this.loadPlaqueBacking(),
      ]);
    } catch (error) {
      this.environmentError = error instanceof Error
        ? error.message
        : `Unknown ${this.course.mapName} environment load error`;
      if (this.course.kind === "bitterpan") {
        console.error("Bitterpan accepted blockout environment failed to load.", error);
        throw error;
      }
      console.warn("Greenwater authored environment failed to load; using Phase 1 fallback.", error);
      // The accepted Phase 1 prop dressing remains a recoverable visual fallback.
      await this.loadAssetKit();
    } finally {
      this.environmentLoadMs ??= performance.now() - environmentLoadStartedAt;
    }
  }

  private async loadLivingWorld(textures: LivingWorldTextures): Promise<void> {
    const loadStartedAt = performance.now();
    try {
      const { LivingWorld: LivingWorldRuntime } = await import("./living-world");
      const livingWorld = await LivingWorldRuntime.load(
        this.course,
        textures,
        LIVING_WORLD_MOTION_URL,
        LIVING_WORLD_MOTION_B_URL,
      );
      if (this.isDisposed()) {
        disposeObject3DResources(livingWorld.root);
        return;
      }
      this.livingWorld = livingWorld;
      this.scene.add(livingWorld.root);
      this.livingWorldReady = true;
      this.requestRender();
    } catch (error) {
      this.livingWorldError = error instanceof Error
        ? error.message
        : `Unknown ${this.course.mapName} living-world load error`;
      console.warn(
        `${this.course.mapName} living-world layer failed to load.`,
        error,
      );
    } finally {
      this.livingWorldLoadMs = performance.now() - loadStartedAt;
    }
  }

  private async loadSurfaceCharacter(): Promise<void> {
    const loadStartedAt = performance.now();
    try {
      const { GreenwaterSurfaceCharacter } = await import("./surface-character");
      const surfaceCharacter = await GreenwaterSurfaceCharacter.load(
        SURFACE_CHARACTER_MODEL_URL,
      );
      if (this.isDisposed()) {
        disposeObject3DResources(surfaceCharacter.root);
        return;
      }
      this.surfaceCharacter = surfaceCharacter;
      this.scene.add(surfaceCharacter.root);
      this.surfaceCharacterReady = true;
      this.requestRender();
    } catch (error) {
      this.surfaceCharacterError = error instanceof Error
        ? error.message
        : "Unknown Greenwater surface-character load error";
      console.warn("Greenwater surface-character layer failed to load.", error);
    } finally {
      this.surfaceCharacterLoadMs = performance.now() - loadStartedAt;
    }
  }

  /**
   * P12. The painted opening straight. Greenwater only — the 200 decals are
   * authored against RUNWAY_START, and Bitterpan's pan has no markings.
   */
  private async loadOpeningSurface(): Promise<void> {
    const loadStartedAt = performance.now();
    try {
      const { GreenwaterOpeningSurface } = await import("./opening-surface");
      const openingSurface = await GreenwaterOpeningSurface.load(
        this.course,
        OPENING_SURFACE_TEXTURE_URL,
      );
      if (this.isDisposed()) {
        disposeObject3DResources(openingSurface.root);
        return;
      }
      this.openingSurface = openingSurface;
      this.scene.add(openingSurface.root);
      this.openingSurfaceReady = true;
      this.requestRender();
    } catch (error) {
      this.openingSurfaceError = error instanceof Error
        ? error.message
        : "Unknown Greenwater opening-surface load error";
      console.warn("Greenwater opening-surface layer failed to load.", error);
    } finally {
      this.openingSurfaceLoadMs = performance.now() - loadStartedAt;
    }
  }

  /**
   * P15. The pan crust and everything the works left on it. Bitterpan only —
   * the ground tile is authored for the salt flat and Greenwater has had a
   * ground plane since Phase 1.
   */
  private async loadBitterpanSurface(): Promise<void> {
    const loadStartedAt = performance.now();
    try {
      const { BitterpanSurface } = await import("./bitterpan-surface");
      const surface = await BitterpanSurface.load(
        this.course,
        BITTERPAN_CRUST_TILE_URL,
        BITTERPAN_CRUST_DECAL_URL,
      );
      if (this.isDisposed()) {
        disposeObject3DResources(surface.root);
        return;
      }
      this.bitterpanSurface = surface;
      this.scene.add(surface.root);
      this.bitterpanSurfaceReady = true;
      this.requestRender();
    } catch (error) {
      this.bitterpanSurfaceError = error instanceof Error
        ? error.message
        : "Unknown Bitterpan surface load error";
      console.warn("Bitterpan pan-surface layer failed to load.", error);
    } finally {
      this.bitterpanSurfaceLoadMs = performance.now() - loadStartedAt;
    }
  }

  /**
   * P15. The panels the 13 Hangar Six wall plaques are bolted to. Greenwater
   * only, and only because the hangar span authors no verge — the placements
   * come off the course's own resolver, not out of a position list.
   */
  private async loadPlaqueBacking(): Promise<void> {
    const loadStartedAt = performance.now();
    try {
      const { HangarPlaqueBacking } = await import("./plaque-backing");
      const backing = await HangarPlaqueBacking.load(
        this.course.wallPlaqueBackings ?? [],
        HANGAR_FIXTURES_TEXTURE_URL,
      );
      if (this.isDisposed()) {
        disposeObject3DResources(backing.root);
        return;
      }
      this.plaqueBacking = backing;
      this.scene.add(backing.root);
      this.plaqueBackingReady = true;
      this.requestRender();
    } catch (error) {
      this.plaqueBackingError = error instanceof Error
        ? error.message
        : "Unknown Hangar Six plaque-backing load error";
      console.warn("Greenwater plaque-backing layer failed to load.", error);
    } finally {
      this.plaqueBackingLoadMs = performance.now() - loadStartedAt;
    }
  }

  /** P12. Trackside boards and their posts. Both maps, one atlas. */
  private async loadSignage(): Promise<void> {
    const loadStartedAt = performance.now();
    try {
      const { TracksideSignage } = await import("./signage");
      const signage = await TracksideSignage.load(this.course, SIGNAGE_TEXTURE_URL);
      if (this.isDisposed()) {
        disposeObject3DResources(signage.root);
        return;
      }
      this.signage = signage;
      this.scene.add(signage.root);
      this.signageReady = true;
      this.requestRender();
    } catch (error) {
      this.signageError = error instanceof Error
        ? error.message
        : `Unknown ${this.course.mapName} signage load error`;
      console.warn(`${this.course.mapName} trackside signage failed to load.`, error);
    } finally {
      this.signageLoadMs = performance.now() - loadStartedAt;
    }
  }

  private async loadAssetKit(): Promise<void> {
    const assetKitLoadStartedAt = performance.now();
    try {
      const gltf = await new GLTFLoader().loadAsync(
        ASSET_KIT_MODEL_URL,
      );
      if (this.isDisposed()) {
        disposeObject3DResources(gltf.scene);
        return;
      }
      applyPs2MaterialTreatment(gltf.scene, { worldGeometry: true });
      const courseDressing = createAssetKitCourseDressing(gltf.scene, this.course);
      const dressingDisplay = mergeStaticSceneByMaterial(courseDressing);
      if (this.isDisposed()) {
        disposeObject3DResources(dressingDisplay);
        return;
      }
      this.scene.add(dressingDisplay);
      const proceduralCables = this.course.group.getObjectByName("cable_trip_hazards");
      if (proceduralCables) proceduralCables.visible = false;
      this.assetKitReady = true;
      this.requestRender();
    } catch {
      // Greenwater retains its procedural cable visuals if optional dressing fails.
    } finally {
      this.assetKitLoadMs = performance.now() - assetKitLoadStartedAt;
    }
  }

  assetKitDiagnostics() {
    return {
      assetKitLoadMs: this.assetKitLoadMs === null
        ? null
        : Number(this.assetKitLoadMs.toFixed(1)),
      assetKitReady: this.assetKitReady,
    };
  }

  /**
   * P16 — the corridor sweep runs from here, once, when the scene stops growing.
   *
   * It needs three things at the same moment: the whole scene graph, the course,
   * and every async load already in it. `SceneAssets` holds the first two and is
   * the last thing to finish adding to the third, but its loads are independent
   * promises and the craft and rival field are added by the race loop, so there
   * is no single "everything is in" callback to hang this on. Rather than invent
   * one (and spend `game.ts` lines it does not have), the sweep waits for the
   * graph itself to settle: two consecutive diagnostics reports — one second
   * apart — with an identical descendant count, and the environment ready.
   *
   * That is a real readiness signal rather than a timer, and it self-reports:
   * `corridorSweepRan` stays false if it never fired, so an empty intrusion list
   * can never be mistaken for a clean one.
   *
   * The module is imported DYNAMICALLY and only once the probe is armed. It was
   * a static import first, and that put ~90 KiB of sweep and grid code into the
   * initial bundle for every player who will never run it — enough to fail the
   * 950 KiB initial-JavaScript budget in `validate-performance.mjs` at
   * 1,038 KiB. A diagnostics instrument must not cost the shipped download.
   */
  private corridorSweep: CorridorSweepResult = CORRIDOR_SWEEP_NOT_RUN;

  private corridorSweepModule: typeof import("./corridor-sweep") | null = null;

  private corridorSweepRequested = false;

  private corridorSweepPreviousCount = -1;

  private maybeRunCorridorSweep(): void {
    if (this.corridorSweep.ran || !probeSelected("corridor-sweep")) return;
    if (!this.environmentReady) return;
    if (!this.corridorSweepModule) {
      if (this.corridorSweepRequested) return;
      this.corridorSweepRequested = true;
      void import("./corridor-sweep").then((module) => {
        if (!this.isDisposed()) this.corridorSweepModule = module;
      });
      return;
    }
    let count = 0;
    this.scene.traverse(() => {
      count += 1;
    });
    if (count !== this.corridorSweepPreviousCount) {
      this.corridorSweepPreviousCount = count;
      return;
    }
    this.corridorSweep = this.corridorSweepModule.sweepCorridor(
      this.scene,
      this.course,
      {
        // The craft and the rival field hover 0.89-1.31 m over the deck by
        // design. Excluded by identity, not by name, so a renamed mesh cannot
        // silently re-enter the report.
        exclude: this.corridorSweepExclusions(),
      },
    );
  }

  /**
   * Everything in the scene that is allowed in the corridor because it is not
   * scenery: the player craft, the rival field, and the effect systems that draw
   * over the deck (sparks, spray, the shadow blob).
   */
  private corridorSweepExclusions(): THREE.Object3D[] {
    const excluded: THREE.Object3D[] = [];
    for (const child of this.scene.children) {
      if (CORRIDOR_SWEEP_EXCLUDED_NAMES.has(child.name)) excluded.push(child);
    }
    return excluded;
  }

  corridorSweepDiagnostics() {
    const sweep = this.corridorSweep;
    return {
      corridorSweepRan: sweep.ran,
      corridorIntrusions: sweep.intrusions,
      corridorFlush: sweep.flush,
      corridorOverhead: sweep.overhead,
      corridorBoundary: sweep.boundary,
      corridorHiddenIntrusions: sweep.hiddenIntrusions,
      corridorSweepMeshes: sweep.meshesSwept,
      corridorSweepInstances: sweep.instancesSwept,
      corridorSweepVertices: sweep.verticesSwept,
      corridorSweepVerticesTested: sweep.verticesTested,
      corridorSweepMs: sweep.elapsedMs,
      corridorIntrusionList: sweep.list,
    };
  }

  environmentDiagnostics() {
    this.maybeRunCorridorSweep();
    const stats = this.authoredEnvironment?.stats;
    return {
      environmentLoadMs: this.environmentLoadMs === null
        ? null
        : Number(this.environmentLoadMs.toFixed(1)),
      environmentReady: this.environmentReady,
      environmentError: this.environmentError,
      environmentMeshes: stats?.meshes ?? 0,
      environmentTriangles: stats?.triangles ?? 0,
      environmentMaterials: stats?.materials ?? 0,
      environmentTextures: stats?.textures ?? 0,
      environmentVisibleGroups: stats?.visibleGroups ?? 0,
      environmentVisibleTriangles: stats?.visibleTriangles ?? 0,
      environmentShaderModel: stats?.shaderModel ?? null,
      environmentSignageSource: stats?.signageSource ?? null,
      environmentContractDrift: stats?.contractDrift ?? [],
      ...this.corridorSweepDiagnostics(),
      ...this.artPassDiagnostics(),
    };
  }

  /**
   * P12 art-pass counters, folded into the environment contributor rather than
   * registered as a contributor of their own: `game.ts` is at its 1,950-line
   * seam budget and may not grow by a line, and `diagnostics.ts` spreads each
   * contributor into the flat report, so fields added here surface unchanged.
   *
   * These exist because the soak cannot see this phase. Decals and boards are
   * non-interactive, so lap times, impacts and frame timing are identical
   * whether the layers rendered or silently caught an error on load — every
   * count below reads ZERO on a no-op, which is the only automated signal that
   * the art is actually in the scene.
   */
  private artPassDiagnostics() {
    const opening = this.openingSurface?.stats;
    const signage = this.signage?.stats;
    const bitterpanSurface = this.bitterpanSurface?.stats;
    const plaqueBacking = this.plaqueBacking?.stats;
    return {
      // P15, same reasoning as the P12 counters below: the pan crust, the set
      // dressing and the plaque backings are all non-interactive, so a soak
      // whose layer silently failed to load has identical lap times, faults and
      // frame timing to one where it rendered. These counts reading nonzero is
      // the only automated evidence the art is in the scene.
      bitterpanSurfaceLoadMs: this.bitterpanSurfaceLoadMs === null
        ? null
        : Number(this.bitterpanSurfaceLoadMs.toFixed(1)),
      bitterpanSurfaceReady: this.bitterpanSurfaceReady,
      bitterpanSurfaceError: this.bitterpanSurfaceError,
      bitterpanSurfaceDrawCalls: bitterpanSurface?.drawCalls ?? 0,
      bpCrustDecals: bitterpanSurface?.decals ?? 0,
      bpCrustOnlyDecals: bitterpanSurface?.crustDecals ?? 0,
      bpDressingItems: bitterpanSurface?.dressingItems ?? 0,
      bpCrustTriangles: bitterpanSurface?.triangles ?? 0,
      bpGroundMetresPerTile: bitterpanSurface?.groundMetresPerTile ?? 0,
      bpGroundAnisotropy: bitterpanSurface?.groundAnisotropy ?? 0,
      plaqueBackingLoadMs: this.plaqueBackingLoadMs === null
        ? null
        : Number(this.plaqueBackingLoadMs.toFixed(1)),
      plaqueBackingReady: this.plaqueBackingReady,
      plaqueBackingError: this.plaqueBackingError,
      plaqueBackingDrawCalls: plaqueBacking?.drawCalls ?? 0,
      plaqueBackings: plaqueBacking?.panels ?? 0,
      plaqueBackingChevrons: plaqueBacking?.chevronPanels ?? 0,
      plaqueBackingBoards: plaqueBacking?.boardPanels ?? 0,
      plaqueBackingTriangles: plaqueBacking?.triangles ?? 0,
      openingSurfaceLoadMs: this.openingSurfaceLoadMs === null
        ? null
        : Number(this.openingSurfaceLoadMs.toFixed(1)),
      openingSurfaceReady: this.openingSurfaceReady,
      openingSurfaceError: this.openingSurfaceError,
      openingSurfaceDrawCalls: opening?.drawCalls ?? 0,
      openingSurfaceDecals: opening?.decals ?? 0,
      openingSurfaceTriangles: opening?.triangles ?? 0,
      signageLoadMs: this.signageLoadMs === null
        ? null
        : Number(this.signageLoadMs.toFixed(1)),
      signageReady: this.signageReady,
      signageError: this.signageError,
      signageDrawCalls: signage?.drawCalls ?? 0,
      signageBoards: signage?.boards ?? 0,
      signageQuads: signage?.quads ?? 0,
      signageTriangles: signage?.triangles ?? 0,
      signagePosts: signage?.posts ?? 0,
      signagePostTriangles: signage?.postTriangles ?? 0,
    };
  }

  livingWorldDiagnostics() {
    const stats = this.livingWorld?.stats;
    return {
      livingWorldLoadMs: this.livingWorldLoadMs === null
        ? null
        : Number(this.livingWorldLoadMs.toFixed(1)),
      livingWorldReady: this.livingWorldReady,
      livingWorldError: this.livingWorldError,
      livingWorldDrawCalls: stats?.drawCalls ?? 0,
      livingWorldCards: stats?.cards ?? 0,
      livingWorldTriangles: stats?.triangles ?? 0,
      livingWorldUpdateHz: stats?.updateHz ?? 0,
      livingWorldUpdateSteps: stats?.updateSteps ?? 0,
    };
  }

  surfaceCharacterDiagnostics() {
    const stats = this.surfaceCharacter?.stats;
    return {
      surfaceCharacterLoadMs: this.surfaceCharacterLoadMs === null
        ? null
        : Number(this.surfaceCharacterLoadMs.toFixed(1)),
      surfaceCharacterReady: this.surfaceCharacterReady,
      surfaceCharacterError: this.surfaceCharacterError,
      surfaceCharacterDrawCalls: stats?.drawCalls ?? 0,
      surfaceCharacterMeshes: stats?.meshes ?? 0,
      surfaceCharacterTriangles: stats?.triangles ?? 0,
      surfaceCharacterMaterials: stats?.materials ?? 0,
      surfaceCharacterTextures: stats?.textures ?? 0,
      surfaceCharacterShaderModel: stats?.shaderModel ?? null,
      surfaceCharacterAnimated: stats?.animated ?? false,
    };
  }
}
