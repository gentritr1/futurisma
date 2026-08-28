import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { ASSET_KIT_PROP_PLACEMENTS } from "./asset-kit-layout";
import { type RaceCourse } from "./course";
import type { GreenwaterEnvironment, RaceEnvironment } from "./environment";
import { disposeObject3DResources } from "./graphics-resources";
import type { GreenwaterLivingWorld } from "./living-world";
import type { GreenwaterSurfaceCharacter } from "./surface-character";
import { applyPs2MaterialTreatment } from "./totem";

const ASSET_KIT_MODEL_URL = "/assets/totem/models/futurisma_asset_kit.glb";
const ENVIRONMENT_MODEL_URL = "/assets/greenwater/models/greenwater_environment_runtime.glb";
const LIVING_WORLD_MOTION_URL = "/assets/greenwater/textures/greenwater_motion_512.png";
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
  livingWorld: GreenwaterLivingWorld | null = null;
  surfaceCharacter: GreenwaterSurfaceCharacter | null = null;
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
        this.loadLivingWorld(environment),
        this.loadSurfaceCharacter(),
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

  private async loadLivingWorld(environment: GreenwaterEnvironment): Promise<void> {
    const loadStartedAt = performance.now();
    try {
      const { GreenwaterLivingWorld } = await import("./living-world");
      const livingWorld = await GreenwaterLivingWorld.load(
        this.course,
        environment.livingTextures,
        LIVING_WORLD_MOTION_URL,
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
        : "Unknown Greenwater living-world load error";
      console.warn("Greenwater living-world layer failed to load.", error);
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

  environmentDiagnostics() {
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
