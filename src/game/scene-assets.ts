import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { ASSET_KIT_PROP_PLACEMENTS } from "./asset-kit-layout";
import type { BitterpanSurface } from "./bitterpan-surface";
import { panFloorProbeActive, panFloorProbeMode } from "./floor-probe.js";

/**
 * P20.6 `?floorprobe=1|2` — the review-only view.
 *
 * Everything that is not the road, the pan floor or the sky is hidden, so the
 * floor's own variation can be measured instead of the decals, rigs, facades
 * and signage that otherwise dominate any number taken off the pan band. The
 * layer still LOADS — its diagnostics stay honest and its load errors still
 * surface — it simply does not draw.
 *
 * Returns its argument so it can wrap a `scene.add` without moving a line.
 */
function hiddenUnderFloorProbe<T extends THREE.Object3D>(root: T): T {
  if (panFloorProbeActive()) root.visible = false;
  return root;
}
import type { BitterpanMidground } from "./bitterpan-midground";
import type { CorridorSweepResult } from "./corridor-sweep";
import type {
  CourseRelocationStats,
  CourseReprojectionStats,
} from "./course-repair";
import { type RaceCourse } from "./course";
import type { RaceEnvironment } from "./environment";
import { disposeObject3DResources } from "./graphics-resources";
import type { LivingWorld, LivingWorldTextures } from "./living-world";
import type { GreenwaterOpeningSurface } from "./opening-surface";
import type { FacadeStats } from "./bitterpan-facades";
import type { HangarPlaqueBacking } from "./plaque-backing";
import {
  probeSelected, readProbeNumber, searchFlag, searchParam,
} from "./query-probes";
import type { BitterpanRoadEdgeBand } from "./road-edge-band";
import type { TracksideSignage } from "./signage";
import type { SignageBackPanels } from "./signage-backs";
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
  // The ghost replay craft. A race entity like the other two: it is SUPPOSED to
  // be on the deck, and it sits on the start line before the lap begins.
  // Identified by the sweep rather than guessed at — the first span table
  // reported tall geometry at lateral 0.000 on the start line and again at
  // 2510 m, and naming the bounding mesh showed `totem_ghost_hull` both times.
  // Excluded by construction, because a derived drivable limit must never be
  // set by something that is driving.
  "totem_ghost",
  // P16 task 6 — Bitterpan's blockout GLB and its collision proxy.
  //
  // NOT the road the player drives. Greenwater calls
  // `setProceduralEnvironmentVisible(course.group, false)` so its GLB replaces
  // the procedural ribbon; the Bitterpan branch never does, so both exist at
  // once and the ribbon — built from CENTRELINE_STATIONS, correctly banked — is
  // what renders under the craft. Proven rather than assumed: the craft held at
  // lateral -13 on the 2.5-degree station at 1250 m sits correctly on the road,
  // which it could not if the blockout were the surface.
  //
  // The blockout's cross-section is MIRRORED against the course model — its
  // left edge sits at the height of the model's right edge and vice versa, a
  // constant 1.303 m at lateral 14.925, which is sin(5.0 deg), exactly twice the
  // authored 2.5-degree bank. That phantom geometry was bounding 523 of 525
  // Bitterpan span-sides and would have deleted the map's entire pan run-off.
  //
  // A drivable limit must come from the world the player experiences. This is a
  // superseded duplicate representation, so it is excluded here rather than
  // removed from the scene: `finalMap02NativeBlockoutFreeze` suggests a freeze
  // contract around the asset, and taking it out is a separate decision.
  "GW2_TRACK_BLOCKOUT",
  "GW2_COLLISION_PROXY",
  // The living-world card layer is drifting atmosphere, not scenery, and its
  // position at any single frame is one sample of an animation rather than a
  // placement. Measured, not assumed: `GW_LIVING_AIR_B` reported lateral -11.104
  // on one sweep and -8.036 on another at the same 72.25 m. A sweep that fires
  // once cannot say anything useful about geometry that moves every frame, and
  // a transparent scud card is not something the craft drives into.
  "GW_LIVING_RUNTIME",
  // P20.3 — the SAME class, on the map the original entry forgot.
  //
  // Only the Greenwater root was listed, so Bitterpan's identical card layer
  // stayed in the sweep and its drift landed in the DERIVED PHYSICS TABLE.
  // Measured, not inferred: re-deriving `map02/DRIVABLE_LIMITS.json` from a
  // fresh capture on the committed tip produced FIVE limited spans against the
  // committed three, the two extra ones set by `BP_LIVING_AIR_B` at 1610 m and
  // `BP_LIVING_HORIZON` at 2960 m — a drifting scud card and a horizon card,
  // neither of which is anything the craft can drive into. With this line the
  // derivation reproduces the committed table byte-for-byte.
  //
  // That is a pre-existing bug, not one this phase introduced; it is fixed here
  // because P20.3's acceptance is "the limit table is byte-identical after a
  // re-derivation with the new layer present", and a table that is not
  // reproducible from its own inputs cannot answer that question either way.
  "BP_LIVING_RUNTIME",
  // P20.3 — the Bitterpan mid-ground dressing layer.
  //
  // 569 instanced props in the 3-120 m band outboard of the deck. Every one is
  // authored outside `halfWidth + apronWidth + 1.5 m` and the generator asserts
  // it, so nothing here is inside the sweep's reach in the first place. The
  // exclusion is the SECOND guarantee, not the only one: a fence post is 2.2 m
  // tall, the sweep promotes anything over 0.85 m to a physics boundary, and a
  // single bad regeneration would otherwise put an invisible wall over open
  // salt pan. Two independent locks, because either alone is one rename or one
  // re-run away from the P16 bug.
  "BP_MIDGROUND",
]);

/**
 * The "not swept" reading, declared here rather than imported so that
 * `corridor-sweep.ts` stays entirely out of the initial bundle. `ran: false` is
 * the load-bearing field: every zero below means "no measurement", never "clean".
 */
const CENSUS_LIST_CAP = 5000;

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
  vfx: 0,
  hiddenIntrusions: 0,
  hiddenByBand: Object.freeze({ flush: 0, obstacle: 0, overhead: 0, boundary: 0, vfx: 0 }),
  list: Object.freeze([]) as CorridorSweepResult["list"],
  spans: Object.freeze([]) as CorridorSweepResult["spans"],
  dump: Object.freeze([]) as CorridorSweepResult["dump"],
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
/**
 * P18 art pass 03 — the world past the barriers.
 *
 * Three sheets. The facade sheet is Bitterpan's alone; the horizon card sheet
 * and the trim sheet are shared by both maps, the same way the two motion
 * atlases already are, and are served from the shared Greenwater texture
 * directory rather than duplicated per map. The trim sheet carries BOTH the
 * signage back panels and the Bitterpan road edge band, which is why it is
 * loaded once here and handed to whichever layers a map has.
 */
const BITTERPAN_FACADES_TEXTURE_URL = "/assets/map02/textures/bitterpan_facades_1024.png";
const BITTERPAN_MASSING_PLACEMENTS_URL = "/data/map02/MASSING_PLACEMENTS.json";
const HORIZON_TEXTURE_URL = "/assets/greenwater/textures/futurisma_horizon_1024.png";
const TRIM_TEXTURE_URL = "/assets/greenwater/textures/futurisma_trim_512.png";
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
  // P20.1. The asset-kit dressing is trackside furniture; it casts for the same
  // reason the authored massing does. Set on the merged root's own meshes,
  // because the source objects these were baked from are discarded above.
  for (const child of mergedRoot.children) {
    child.castShadow = true;
    child.receiveShadow = true;
  }
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

  /** P20.3: the Bitterpan mid-ground dressing layer. Bitterpan only. */
  bitterpanMidground: BitterpanMidground | null = null;
  plaqueBacking: HangarPlaqueBacking | null = null;
  /** P18: the two layers that sample futurisma_trim_512. */
  signageBacks: SignageBackPanels | null = null;
  roadEdgeBand: BitterpanRoadEdgeBand | null = null;
  private trimLayersLoadMs: number | null = null;
  private trimLayersReady = false;
  private trimLayersError: string | null = null;
  private bitterpanSurfaceLoadMs: number | null = null;
  private bitterpanSurfaceReady = false;
  private bitterpanSurfaceError: string | null = null;

  private midgroundLoadMs: number | null = null;
  private midgroundReady = false;
  private midgroundError: string | null = null;
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
  private surfaceCharacterReprojection: CourseReprojectionStats | null = null;
  private corridorRelocation: CourseRelocationStats | null = null;

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
          BITTERPAN_FACADES_TEXTURE_URL,
          BITTERPAN_MASSING_PLACEMENTS_URL,
        );
        this.environmentLoadMs = performance.now() - environmentLoadStartedAt;
        if (this.isDisposed()) {
          disposeObject3DResources(environment.root);
          return;
        }
        this.authoredEnvironment = environment;
        await this.clearCorridorObstacles(environment.root);
        this.scene.add(hiddenUnderFloorProbe(environment.root));
        this.environmentReady = true;
        this.requestRender();
        // Bitterpan's zone set names only the shared motion atlases, so it needs
        // nothing off the accepted blockout the way Greenwater needs its jungle
        // and emissive maps.
        await Promise.all([
          this.loadLivingWorld({}),
          this.loadSignage(),
          this.loadBitterpanSurface(),
          this.loadBitterpanMidground(),
          this.loadTrimLayers(),
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
      await this.clearCorridorObstacles(environment.root);
      setProceduralEnvironmentVisible(this.course.group, false);
      environment.updateVisibility(this.camera);
      this.scene.add(hiddenUnderFloorProbe(environment.root));
      this.environmentReady = true;
      this.requestRender();
      await Promise.all([
        this.loadLivingWorld(environment.livingTextures),
        this.loadSurfaceCharacter(),
        this.loadOpeningSurface(),
        this.loadSignage(),
        this.loadPlaqueBacking(),
        this.loadTrimLayers(),
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
        HORIZON_TEXTURE_URL,
      );
      if (this.isDisposed()) {
        disposeObject3DResources(livingWorld.root);
        return;
      }
      this.livingWorld = livingWorld;
      this.scene.add(hiddenUnderFloorProbe(livingWorld.root));
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

  /**
   * P16 task 3 — moves environment geometry off the racing surface, at load.
   *
   * Both objects the player reported at Hangar Six are baked into
   * `greenwater_environment_runtime.glb`: a concrete box at 639.9 m / lateral
   * -3.11 m standing 1.24-1.58 m tall, and a low slab at 702.2 m / lateral
   * +0.31 m — dead centre of the road, on gate 03. The GLB's sha256 is pinned by
   * `validate-assets.mjs` and its contract is accepted, so the repair happens at
   * runtime rather than in a re-bake, exactly as `relocateHangarSixEdgeBarriers`
   * already does for the hangar edge barriers.
   *
   * Runs BEFORE `scene.add`, so no frame ever shows the unrepaired placement.
   */
  private async clearCorridorObstacles(root: THREE.Object3D): Promise<void> {
    const {
      relocateCorridorObstacles,
      OBSTACLE_LATERAL_MARGIN_METRES,
      OBSTACLE_HEIGHT_MIN_METRES,
      OBSTACLE_HEIGHT_MAX_METRES,
      OBSTACLE_SEAM_TOLERANCE_METRES,
    } = await import("./course-repair");
    this.corridorRelocation = relocateCorridorObstacles(root, this.course, {
      lateralMargin: OBSTACLE_LATERAL_MARGIN_METRES,
      heightMin: OBSTACLE_HEIGHT_MIN_METRES,
      heightMax: OBSTACLE_HEIGHT_MAX_METRES,
      seamTolerance: OBSTACLE_SEAM_TOLERANCE_METRES,
    });
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
      // P16 — re-seat the paint onto the banked deck before it is shown. The
      // sheet is authored flat, so on the 12-degree Greenwater Sweep it hung
      // 1.8 m off the road it is printed on; the corridor sweep read that as 31
      // separate obstacles. See `reprojectOntoBankedDeck`.
      const { reprojectOntoBankedDeck } = await import("./course-repair");
      this.surfaceCharacterReprojection = reprojectOntoBankedDeck(
        surfaceCharacter.root,
        this.course,
      );
      this.surfaceCharacter = surfaceCharacter;
      this.scene.add(hiddenUnderFloorProbe(surfaceCharacter.root));
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
      this.scene.add(hiddenUnderFloorProbe(openingSurface.root));
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
        panFloorProbeMode(),
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
   * P20.3. The mid-ground dressing in the 3-120 m band outboard of the deck —
   * post-and-cable runs, salt windrows, lifted crust plates, brine-line
   * trestles and drum clusters. Bitterpan only; Greenwater's equivalent band is
   * already dense with kerbs, fences, lamp posts and vegetation cards.
   *
   * Loaded alongside the surface layer rather than after it: the two share no
   * state beyond `GROUND_Y_METRES`, which is a module constant and not a load
   * result, so serialising them would only cost a round trip.
   */
  private async loadBitterpanMidground(): Promise<void> {
    const loadStartedAt = performance.now();
    try {
      const { BitterpanMidground } = await import("./bitterpan-midground");
      const midground = await BitterpanMidground.load(
        this.course,
        BITTERPAN_FACADES_TEXTURE_URL,
      );
      if (this.isDisposed()) {
        midground.dispose();
        return;
      }
      this.bitterpanMidground = midground;
      this.scene.add(hiddenUnderFloorProbe(midground.root));
      this.midgroundReady = true;
      this.requestRender();
    } catch (error) {
      this.midgroundError = error instanceof Error
        ? error.message
        : "Unknown Bitterpan midground load error";
      console.warn("Bitterpan mid-ground layer failed to load.", error);
    } finally {
      this.midgroundLoadMs = performance.now() - loadStartedAt;
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
      this.scene.add(hiddenUnderFloorProbe(backing.root));
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

  /**
   * P18 art pass 03 — everything that samples `futurisma_trim_512`.
   *
   * Both layers ride one texture load because they are one sheet: the signage
   * back panels on both maps, and the Bitterpan road edge band. Loaded together
   * so the band and the board backs can never disagree about the sheet's
   * filtering, and so a single failure reports once.
   */
  private async loadTrimLayers(): Promise<void> {
    const loadStartedAt = performance.now();
    try {
      const [{ SignageBackPanels }, { BitterpanRoadEdgeBand }] = await Promise.all([
        import("./signage-backs"),
        import("./road-edge-band"),
      ]);
      const backs = await SignageBackPanels.load(this.course, TRIM_TEXTURE_URL);
      if (this.isDisposed()) {
        disposeObject3DResources(backs.root);
        return;
      }
      this.signageBacks = backs;
      this.scene.add(hiddenUnderFloorProbe(backs.root));

      if (this.course.kind === "bitterpan") {
        const material = (backs.root.children[0] as THREE.Mesh).material;
        const texture = (material as THREE.MeshBasicMaterial).map;
        if (!texture) throw new Error("The trim sheet did not resolve a texture.");
        const band = await BitterpanRoadEdgeBand.load(this.course, texture);
        if (this.isDisposed()) {
          disposeObject3DResources(band.root);
          return;
        }
        this.roadEdgeBand = band;
        this.scene.add(hiddenUnderFloorProbe(band.root));
      }
      this.trimLayersReady = true;
      this.requestRender();
    } catch (error) {
      this.trimLayersError = error instanceof Error
        ? error.message
        : `Unknown ${this.course.mapName} trim-layer load error`;
      console.warn(`${this.course.mapName} Pass 03 trim layers failed to load.`, error);
    } finally {
      this.trimLayersLoadMs = performance.now() - loadStartedAt;
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
      this.scene.add(hiddenUnderFloorProbe(signage.root));
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
      this.scene.add(hiddenUnderFloorProbe(dressingDisplay));
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
        // `?spans=1` adds the per-span tall-geometry table. Only
        // `scripts/derive-drivable-limits.mjs` asks for it — it is ~250 rows a
        // map, which does not belong in a once-a-second diagnostics line.
        collectSpans: searchFlag("spans"),
        // P21 — `?census=1` widens the gate from the deck edge to the craft's
        // own lateral clamp, and lifts the list cap so the census can tell
        // "nothing more" from "no more room". Off by default: the committed
        // `corridorIntrusions` counter, the soak gates that read it and
        // `derive-drivable-limits.mjs` all mean the DECK gate, and silently
        // widening it here would have redefined every one of them at once.
        gate: searchFlag("census") ? "drivable" : "deck",
        listCap: searchFlag("census") ? CENSUS_LIST_CAP : undefined,
        // `?dumpMesh=NAME&dumpFrom=&dumpTo=` — the point cloud behind one census
        // row. See `CorridorSweepOptions.dumpMesh`.
        tallMin: readProbeNumber("tallMin", Number.NaN),
        dumpMesh: searchParam("dumpMesh") ?? undefined,
        dumpFrom: readProbeNumber("dumpFrom", Number.NEGATIVE_INFINITY),
        dumpTo: readProbeNumber("dumpTo", Number.POSITIVE_INFINITY),
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
    // Traversed, not just top-level: the Bitterpan blockout roots hang inside
    // `map02_bitterpan_authored_environment` rather than off the scene, and a
    // children-only scan silently matched none of them.
    this.scene.traverse((object) => {
      if (CORRIDOR_SWEEP_EXCLUDED_NAMES.has(object.name)) excluded.push(object);
    });
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
      corridorVfx: sweep.vfx,
      corridorHiddenIntrusions: sweep.hiddenIntrusions,
      corridorHiddenByBand: sweep.hiddenByBand,
      corridorSweepMeshes: sweep.meshesSwept,
      corridorSweepInstances: sweep.instancesSwept,
      corridorSweepVertices: sweep.verticesSwept,
      corridorSweepVerticesTested: sweep.verticesTested,
      corridorSweepMs: sweep.elapsedMs,
      // P21 — which corridor the numbers above were measured against. A census
      // reading "0 obstacles" is worthless without it: the deck gate and the
      // drivable gate answer different questions and both emit `corridorIntrusions`.
      corridorGate: searchFlag("census") ? "drivable" : "deck",
      corridorIntrusionList: sweep.list,
      corridorDump: sweep.dump,
      corridorSpans: sweep.spans,
      corridorRelocated: this.corridorRelocation?.relocated ?? 0,
      corridorRelocationMaxShift: this.corridorRelocation?.maxShiftMetres ?? 0,
      corridorRelocationList: this.corridorRelocation?.moved ?? [],
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
    const backs = this.signageBacks?.stats;
    const band = this.roadEdgeBand?.stats;
    const facades = (this.authoredEnvironment as { facades?: { stats: FacadeStats } | null })
      ?.facades?.stats;
    // P20.3. The frustum count is taken HERE rather than on a race-loop tick:
    // the layer is static, `game.ts` is at its seam budget, and this line
    // refreshes at ~1 Hz, which is inside the phase's <= 4 Hz sampling rule.
    this.bitterpanMidground?.refreshVisibility(this.camera);
    const midground = this.bitterpanMidground;
    return {
      // P20.3 art pass 04 — the mid-ground band. Nested rather than flattened
      // because the acceptance reads `midground.visibleInstances` directly, and
      // because every other counter here would have to grow a `midground`
      // prefix to say the same thing. Same reasoning as every art-pass counter
      // below: none of it is interactive, so the ONLY automated evidence that
      // the layer is in the scene is these numbers reading nonzero.
      midgroundLoadMs: this.midgroundLoadMs === null
        ? null
        : Number(this.midgroundLoadMs.toFixed(1)),
      midgroundReady: this.midgroundReady,
      midgroundError: this.midgroundError,
      midground: midground
        ? midground.diagnostics()
        : { drawCalls: 0, instances: 0, triangles: 0, families: 0, visibleInstances: 0 },
      // P18 art pass 03. Same reasoning as every art-pass counter above: none
      // of this is interactive, so a soak whose layer silently failed has
      // identical lap times, faults and frame timing to one where it rendered.
      // Each count reading nonzero is the only automated evidence the art is in
      // the scene, and `blockoutRoadHidden` is the only automated evidence the
      // duplicate road actually stopped drawing.
      trimLayersLoadMs: this.trimLayersLoadMs === null
        ? null
        : Number(this.trimLayersLoadMs.toFixed(1)),
      trimLayersReady: this.trimLayersReady,
      trimLayersError: this.trimLayersError,
      facadeAssignments: facades?.assignments ?? 0,
      facadeMaterials: facades?.materials ?? 0,
      facadeFamilies: facades?.families ?? 0,
      facadeAlphaTestedFamilies: facades?.alphaTestedFamilies ?? 0,
      facadeSkirtedPlacements: facades?.skirtedPlacements ?? 0,
      facadePlinthedPlacements: facades?.plinthedPlacements ?? 0,
      facadeWindowedPlacements: facades?.windowedPlacements ?? 0,
      facadeTriangles: facades?.triangles ?? 0,
      facadeSkirtTriangles: facades?.skirtTriangles ?? 0,
      facadeElements: facades?.elements ?? 0,
      facadeSheetsSampled: facades?.sheetsSampled ?? 0,
      facadeWindowDuskBlend: facades?.windowDuskBlend ?? 0,
      backPanelDrawCalls: backs?.drawCalls ?? 0,
      backPanels: backs?.panels ?? 0,
      backPanelsTagged: backs?.tagged ?? 0,
      backPanelsBlank: backs?.blank ?? 0,
      backPanelWallPlaqueSkips: backs?.wallPlaqueSkips ?? 0,
      backPanelTriangles: backs?.triangles ?? 0,
      edgeBandDrawCalls: band?.drawCalls ?? 0,
      edgeStrips: band?.strips ?? 0,
      edgeTicks: band?.ticks ?? 0,
      cyanTicks: band?.cyanTicks ?? 0,
      cyanTicksInSpan: band?.cyanTicksInSpan ?? 0,
      chevronTicks: band?.chevronTicks ?? 0,
      wearCapTicks: band?.wearCapTicks ?? 0,
      edgeBlankStrips: band?.blankStrips ?? 0,
      edgeDeckStrips: band?.deckStrips ?? 0,
      edgePanStrips: band?.panStrips ?? 0,
      edgeBermStrips: band?.bermStrips ?? 0,
      edgeBandQuads: band?.quads ?? 0,
      edgeBandTriangles: band?.triangles ?? 0,
      edgeBandMaxLiftMetres: band?.maxLiftMetres ?? 0,
      blockoutRoadHidden: this.course.kind === "bitterpan"
        ? this.scene.getObjectByName("GW2_TRACK_BLOCKOUT")?.visible === false
        : null,
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
      // P20.6 — the pan floor's macro colour field. Nested, like `midground`
      // above, because the acceptance reads `panFloor.segments` directly. The
      // floor is not interactive, so these are the only automated evidence
      // that the field is on the mesh: `segments` collapsing to 1 means the
      // subdivision never happened, and `meanLuma` off 1.0 means this stopped
      // being a variation pass and became a re-grade.
      panFloor: bitterpanSurface?.panFloor
        ? {
          segments: bitterpanSurface.panFloor.segments,
          macroSeed: bitterpanSurface.panFloor.macroSeed,
          secondaryScale: Number(bitterpanSurface.panFloor.secondaryScale.toFixed(6)),
          vertices: bitterpanSurface.panFloor.vertices,
          meanLuma: Number(bitterpanSurface.panFloor.meanLuma.toFixed(5)),
          peakBrightness: Number(bitterpanSurface.panFloor.peakBrightness.toFixed(4)),
          peakHue: Number(bitterpanSurface.panFloor.peakHue.toFixed(4)),
          windDegrees: bitterpanSurface.panFloor.windDegrees,
          streakBands: bitterpanSurface.panFloor.streakBands,
          brineWeightMean: Number(bitterpanSurface.panFloor.brineWeightMean.toFixed(5)),
          probe: bitterpanSurface.panFloor.probe,
        }
        : { segments: 0, macroSeed: 0, secondaryScale: 0, vertices: 0, meanLuma: 0,
          peakBrightness: 0, peakHue: 0, windDegrees: 0, streakBands: 0,
          brineWeightMean: 0, probe: false },
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
      // P20.4. Authored cards say what exists; visible cards say what the
      // driver can see. Bitterpan shipped 154 of the first and none of the
      // second, and only this number would have caught it.
      livingWorldVisibleCards: stats?.visibleCards ?? 0,
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
      surfaceCharacterReseated: this.surfaceCharacterReprojection?.moved ?? 0,
      surfaceCharacterMaxLiftFix: this.surfaceCharacterReprojection
        ?.maxCorrectionMetres ?? 0,
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
