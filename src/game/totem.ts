import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { disposeObject3DResources } from "./graphics-resources";
import {
  TotemRacePresence,
  type RacePresenceVisualState,
} from "./race-presence";

export interface TotemVisualState extends RacePresenceVisualState {
  steer: number;
  lateralLoad: number;
}

interface NeutralTransform {
  quaternion: THREE.Quaternion;
  position: THREE.Vector3;
}

export interface Ps2MaterialTreatmentStats {
  materials: number;
  textures: number;
}

export type TotemRivalMaterialRole =
  | "TOTEM_body"
  | "TOTEM_emissive"
  | "TOTEM_glass";

/**
 * How a rival batch moves. `hull` is welded to the craft; the others turn about
 * their authored pivots, driven by the rival's pose signals.
 */
export type TotemRivalArticulationGroup =
  | "hull"
  | "steering_fins"
  | "airbrakes";

export interface TotemRivalArticulationSlot {
  /** Authored pivot node this slot stands in for, e.g. `steering_fin_L_pivot`. */
  pivot: string;
  /** The pivot's neutral transform in model space. Batch geometry is pivot-local. */
  pivotMatrix: THREE.Matrix4;
  /** Local axis the pivot turns about, per the MANIFEST `movable_nodes` contract. */
  axis: "x" | "y" | "z";
  /**
   * Brightness correction for this slot. Both sides of a pair share one
   * geometry, so they also share the reference side's baked `COLOR_0` shading.
   * This restores each side's own authored mean brightness through the instance
   * colour; the finer per-vertex panel variation is the price of the shared
   * geometry and stays with the reference side.
   */
  shadingScale: number;
}

export interface TotemRivalVisualBatch {
  role: TotemRivalMaterialRole;
  group: TotemRivalArticulationGroup;
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  triangles: number;
  /**
   * One entry per copy of this batch's geometry on a single craft. `hull` has a
   * single identity slot; an articulated group has one slot per side, and every
   * side shares the one pivot-local geometry — which is what lets a left/right
   * pair cost a single draw call instead of two.
   */
  slots: readonly TotemRivalArticulationSlot[];
}

/**
 * The left/right pairs worth articulating on a rival, in slot order. Both sides
 * of a pair are driven by the same signal, so they can share one instanced mesh.
 *
 * Elevons are deliberately absent: they are authored movers, but a third
 * articulated pair would cost a seventh rival body draw call and the phase
 * budget has no room for it. They ride with the hull on rivals; the player's
 * own vehicle still articulates all of them through `updateVisual`.
 */
const RIVAL_ARTICULATION_GROUPS: ReadonlyArray<{
  group: Exclude<TotemRivalArticulationGroup, "hull">;
  pivots: readonly string[];
  axis: "x" | "y" | "z";
}> = [
  {
    group: "steering_fins",
    pivots: ["steering_fin_L_pivot", "steering_fin_R_pivot"],
    axis: "y",
  },
  {
    group: "airbrakes",
    pivots: ["airbrake_L_pivot", "airbrake_R_pivot"],
    axis: "x",
  },
];

const IDENTITY_SLOT: TotemRivalArticulationSlot = {
  pivot: "",
  pivotMatrix: new THREE.Matrix4(),
  axis: "y",
  shadingScale: 1,
};

/** Mean of a geometry's baked vertex-shading multiplier, or 1 when unshaded. */
function meanVertexShading(geometry: THREE.BufferGeometry): number {
  const color = geometry.getAttribute("color");
  if (!color || color.count === 0) return 1;
  let total = 0;
  for (let index = 0; index < color.count; index += 1) {
    total += color.getX(index) + color.getY(index) + color.getZ(index);
  }
  const mean = total / (color.count * 3);
  return Number.isFinite(mean) && mean > 1e-6 ? mean : 1;
}

/** Positions must agree to this many metres for two sides to share geometry. */
const SHARED_SIDE_TOLERANCE_METERS = 1e-5;

interface OriginalVisibleMesh {
  mesh: THREE.Mesh;
  modelLocalMatrix: THREE.Matrix4;
  /** Nearest enclosing articulation pivot, or `null` when welded to the hull. */
  pivot: string | null;
}

const DEG = Math.PI / 180;
const LOCAL_ROTATION_AXES = {
  x: new THREE.Vector3(1, 0, 0),
  y: new THREE.Vector3(0, 1, 0),
  z: new THREE.Vector3(0, 0, 1),
} as const;
const ENGINE_FLAP_NAMES = [
  "engine_flap_L_0_pivot",
  "engine_flap_L_1_pivot",
  "engine_flap_R_0_pivot",
  "engine_flap_R_1_pivot",
] as const;
const RIVAL_MATERIAL_ROLES: readonly TotemRivalMaterialRole[] = [
  "TOTEM_body",
  "TOTEM_emissive",
  "TOTEM_glass",
];

function isRivalMaterialRole(name: string): name is TotemRivalMaterialRole {
  return RIVAL_MATERIAL_ROLES.includes(name as TotemRivalMaterialRole);
}

export function applyPs2MaterialTreatment(
  root: THREE.Object3D,
): Ps2MaterialTreatmentStats {
  const treatedMaterials = new Set<THREE.Material>();
  const treatedTextures = new Set<THREE.Texture>();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      treatedMaterials.add(material);
      material.dithering = true;
      const textured = material as THREE.Material & {
        map?: THREE.Texture | null;
        emissiveMap?: THREE.Texture | null;
        normalMap?: THREE.Texture | null;
        roughnessMap?: THREE.Texture | null;
        metalnessMap?: THREE.Texture | null;
        alphaMap?: THREE.Texture | null;
      };
      for (const texture of [
        textured.map,
        textured.emissiveMap,
        textured.normalMap,
        textured.roughnessMap,
        textured.metalnessMap,
        textured.alphaMap,
      ]) {
        if (!texture) continue;
        treatedTextures.add(texture);
        texture.magFilter = THREE.NearestFilter;
        texture.minFilter = THREE.NearestMipmapLinearFilter;
        texture.anisotropy = 1;
        texture.needsUpdate = true;
      }
      material.needsUpdate = true;
    }
  });
  return {
    materials: treatedMaterials.size,
    textures: treatedTextures.size,
  };
}

export class TotemVehicle {
  readonly root = new THREE.Group();
  private readonly visual = new THREE.Group();
  private readonly nodes = new Map<string, THREE.Object3D>();
  private readonly neutral = new Map<string, NeutralTransform>();
  private readonly rotationOffset = new THREE.Quaternion();
  private racePresence: TotemRacePresence | null = null;
  private model: THREE.Object3D | null = null;
  private originalVisibleMeshes: OriginalVisibleMesh[] = [];
  private readonly pivotMatrices = new Map<string, THREE.Matrix4>();

  constructor() {
    this.root.name = "totem_vehicle_root";
    this.visual.name = "totem_visual_motion";
    this.root.add(this.visual);
  }

  async load(url: string, effectsAtlasUrl: string): Promise<void> {
    const [gltfResult, atlasResult] = await Promise.allSettled([
      new GLTFLoader().loadAsync(url),
      new THREE.TextureLoader().loadAsync(effectsAtlasUrl),
    ]);
    if (gltfResult.status === "rejected") {
      if (atlasResult.status === "fulfilled") atlasResult.value.dispose();
      throw gltfResult.reason;
    }
    if (atlasResult.status === "rejected") {
      disposeObject3DResources(gltfResult.value.scene);
      throw atlasResult.reason;
    }
    const gltf = gltfResult.value;
    const effectsAtlas = atlasResult.value;
    this.model = gltf.scene;
    this.model.name = "TOTEM_runtime";
    this.visual.add(this.model);
    applyPs2MaterialTreatment(this.model);
    this.calibrateVehicleMaterials();

    this.model.traverse((object) => {
      if (object.name) this.nodes.set(object.name, object);
      if (object.name === "collision_proxy") object.visible = false;
      if (!(object instanceof THREE.Mesh)) return;

      object.castShadow = true;
      object.receiveShadow = true;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      if (materials.some((material) => material.name === "TOTEM_collision")) {
        object.visible = false;
      }
    });

    this.captureOriginalVisibleMeshes();

    for (const name of [
      "canopy_pivot",
      "airbrake_L_pivot",
      "airbrake_R_pivot",
      "steering_fin_L_pivot",
      "steering_fin_R_pivot",
      "elevon_L_pivot",
      "elevon_R_pivot",
      "engine_flap_L_0_pivot",
      "engine_flap_L_1_pivot",
      "engine_flap_R_0_pivot",
      "engine_flap_R_1_pivot",
      "stabiliser_ring_pivot",
      "skids_pivot",
    ]) {
      const node = this.nodes.get(name);
      if (!node) continue;
      this.neutral.set(name, {
        quaternion: node.quaternion.clone(),
        position: node.position.clone(),
      });
    }

    this.racePresence = new TotemRacePresence(
      this.model,
      this.nodes,
      effectsAtlas,
    );
  }

  /**
   * Ground-blob placement for the shared instanced shadow mesh: how far the
   * craft is floating above the deck right now, matching the hover the pose
   * uses. The blob itself is owned by the rival fleet.
   */
  hoverHeightMeters(state: TotemVisualState): number {
    return state.boostActive ? 0.6 : state.speedRatio < 0.1 ? 0.18 : 0.45;
  }

  effectsAtlas(): THREE.Texture {
    if (!this.racePresence) {
      throw new Error("TOTEM race-presence effects must be loaded before use.");
    }
    return this.racePresence.atlas;
  }

  createRivalVisualBatches(): TotemRivalVisualBatch[] {
    if (!this.model || this.originalVisibleMeshes.length === 0) {
      throw new Error("TOTEM must be loaded before creating rival visual batches.");
    }

    const materialByRole = new Map<TotemRivalMaterialRole, THREE.Material>();
    const roleOf = (source: OriginalVisibleMesh): TotemRivalMaterialRole => {
      if (Array.isArray(source.mesh.material)) {
        throw new Error(`TOTEM mesh ${source.mesh.name} has unsupported material groups.`);
      }
      const material = source.mesh.material;
      if (!isRivalMaterialRole(material.name)) {
        throw new Error(
          `TOTEM mesh ${source.mesh.name} has unexpected visible material ${material.name}.`,
        );
      }
      const existingMaterial = materialByRole.get(material.name);
      if (existingMaterial && existingMaterial !== material) {
        throw new Error(`TOTEM material role ${material.name} uses multiple materials.`);
      }
      materialByRole.set(material.name, material);
      return material.name;
    };

    const hullSources: OriginalVisibleMesh[] = [];
    const sourcesByPivot = new Map<string, OriginalVisibleMesh[]>();
    for (const source of this.originalVisibleMeshes) {
      roleOf(source);
      if (source.pivot === null) {
        hullSources.push(source);
        continue;
      }
      const existing = sourcesByPivot.get(source.pivot);
      if (existing) existing.push(source);
      else sourcesByPivot.set(source.pivot, [source]);
    }

    // Scratch geometries are tracked centrally so every exit path disposes them.
    const scratch: THREE.BufferGeometry[] = [];
    const bake = (
      source: OriginalVisibleMesh,
      matrix: THREE.Matrix4,
    ): THREE.BufferGeometry => {
      const geometry = source.mesh.geometry.index
        ? source.mesh.geometry.toNonIndexed()
        : source.mesh.geometry.clone();
      geometry.applyMatrix4(matrix);
      scratch.push(geometry);
      return geometry;
    };

    const batches: TotemRivalVisualBatch[] = [];
    const pivotLocal = new THREE.Matrix4();
    try {
      for (const definition of RIVAL_ARTICULATION_GROUPS) {
        const merged = this.mergeArticulationGroup(
          definition,
          sourcesByPivot,
          bake,
          scratch,
          pivotLocal,
        );
        if (!merged) {
          // The group is not shareable as authored, so the parts stay welded to
          // the hull rather than costing a draw call each. The soak's
          // `rivalArticulation` reading is what surfaces this if it happens.
          for (const pivot of definition.pivots) {
            for (const source of sourcesByPivot.get(pivot) ?? []) hullSources.push(source);
          }
          continue;
        }
        const material = materialByRole.get("TOTEM_body");
        if (!material) {
          merged.geometry.dispose();
          throw new Error("TOTEM is missing required rival material role TOTEM_body.");
        }
        batches.push({
          role: "TOTEM_body",
          group: definition.group,
          geometry: merged.geometry,
          material,
          triangles: merged.triangles,
          slots: merged.slots,
        });
      }

      const hullByRole = new Map<TotemRivalMaterialRole, THREE.BufferGeometry[]>();
      for (const role of RIVAL_MATERIAL_ROLES) hullByRole.set(role, []);
      for (const source of hullSources) {
        hullByRole.get(roleOf(source))?.push(bake(source, source.modelLocalMatrix));
      }
      for (const role of RIVAL_MATERIAL_ROLES) {
        const sourceGeometries = hullByRole.get(role) ?? [];
        const sourceMaterial = materialByRole.get(role);
        if (sourceGeometries.length === 0 || !sourceMaterial) {
          throw new Error(`TOTEM is missing required rival material role ${role}.`);
        }
        const geometry = mergeGeometries(sourceGeometries, false);
        if (!geometry) {
          throw new Error(`TOTEM ${role} geometry could not be merged safely.`);
        }
        const triangles = geometry.getAttribute("position").count / 3;
        if (!Number.isInteger(triangles)) {
          geometry.dispose();
          throw new Error(`TOTEM ${role} geometry does not contain complete triangles.`);
        }
        batches.push({
          role,
          group: "hull",
          geometry,
          material: sourceMaterial,
          triangles,
          slots: [{ ...IDENTITY_SLOT, pivotMatrix: new THREE.Matrix4() }],
        });
      }

      // Every batch of a role shares that role's material, so clone once per
      // role after the set is known and hand the clones out.
      const clonesByRole = new Map<TotemRivalMaterialRole, THREE.Material>();
      for (const batch of batches) {
        let clone = clonesByRole.get(batch.role);
        if (!clone) {
          clone = batch.material.clone();
          clonesByRole.set(batch.role, clone);
        }
        batch.material = clone;
      }
    } catch (error) {
      // Batches carry the model's own materials until the clone pass at the end
      // of the try block, so a throw can only ever leave geometry to release.
      for (const batch of batches) batch.geometry.dispose();
      throw error;
    } finally {
      for (const geometry of scratch) geometry.dispose();
    }
    return batches;
  }

  /**
   * Builds one shared pivot-local geometry for a left/right articulation pair.
   * Returns `null` when the pair cannot share geometry, which is the caller's
   * signal to weld those parts to the hull instead.
   */
  private mergeArticulationGroup(
    definition: (typeof RIVAL_ARTICULATION_GROUPS)[number],
    sourcesByPivot: ReadonlyMap<string, OriginalVisibleMesh[]>,
    bake: (source: OriginalVisibleMesh, matrix: THREE.Matrix4) => THREE.BufferGeometry,
    scratch: THREE.BufferGeometry[],
    pivotLocal: THREE.Matrix4,
  ): {
    geometry: THREE.BufferGeometry;
    triangles: number;
    slots: TotemRivalArticulationSlot[];
  } | null {
    const slots: TotemRivalArticulationSlot[] = [];
    const perPivot: THREE.BufferGeometry[] = [];
    for (const pivot of definition.pivots) {
      const sources = sourcesByPivot.get(pivot);
      const pivotMatrix = this.pivotMatrices.get(pivot);
      if (!sources || sources.length === 0 || !pivotMatrix) return null;
      // A mirrored pivot would flip winding on the shared geometry.
      if (pivotMatrix.determinant() <= 0) return null;
      if (sources.some((source) => (
        Array.isArray(source.mesh.material) || source.mesh.material.name !== "TOTEM_body"
      ))) return null;
      pivotLocal.copy(pivotMatrix).invert();
      const baked = sources.map((source) => (
        bake(source, pivotLocal.clone().multiply(source.modelLocalMatrix))
      ));
      let merged = baked[0];
      if (baked.length > 1) {
        const combined = mergeGeometries(baked, false);
        if (!combined) return null;
        scratch.push(combined);
        merged = combined;
      }
      perPivot.push(merged);
      slots.push({
        pivot,
        pivotMatrix: pivotMatrix.clone(),
        axis: definition.axis,
        shadingScale: 1,
      });
    }

    const reference = perPivot[0];
    const referenceShading = meanVertexShading(reference);
    for (let index = 0; index < perPivot.length; index += 1) {
      slots[index].shadingScale = meanVertexShading(perPivot[index]) / referenceShading;
    }
    const referencePositions = reference.getAttribute("position");
    for (let index = 1; index < perPivot.length; index += 1) {
      const positions = perPivot[index].getAttribute("position");
      if (positions.count !== referencePositions.count) return null;
      for (let component = 0; component < positions.array.length; component += 1) {
        const difference = Math.abs(
          (positions.array as ArrayLike<number>)[component]
            - (referencePositions.array as ArrayLike<number>)[component],
        );
        if (difference > SHARED_SIDE_TOLERANCE_METERS) return null;
      }
    }

    const triangles = referencePositions.count / 3;
    if (!Number.isInteger(triangles)) return null;
    // The reference is scratch-owned; hand back a copy the batch can own.
    return { geometry: reference.clone(), triangles, slots };
  }

  setPose(position: THREE.Vector3, quaternion: THREE.Quaternion): void {
    this.root.position.copy(position);
    this.root.quaternion.copy(quaternion);
    // updateVisual changes child transforms immediately after this call. The
    // chase-camera anchor performs the single authoritative world-matrix sync
    // once those changes are complete; an update here would traverse the full
    // vehicle hierarchy twice per active frame.
  }

  updateVisual(state: TotemVisualState): void {
    const bank = THREE.MathUtils.clamp(
      -state.steer * (0.2 + state.driftIntensity * 0.08)
        - state.lateralLoad * 0.13,
      -0.34,
      0.34,
    );
    const pitch = state.brake * 0.055 - state.throttle * 0.025;
    const bob = Math.sin(state.elapsed * 4.1) * 0.026 * (0.25 + state.speedRatio);
    this.visual.position.y = bob;
    const pitchResponse = 1 - Math.exp(-state.delta * 8.5);
    const bankResponse = 1 - Math.exp(-state.delta * 7.2);
    this.visual.rotation.x = THREE.MathUtils.lerp(
      this.visual.rotation.x,
      pitch,
      pitchResponse,
    );
    this.visual.rotation.z = THREE.MathUtils.lerp(
      this.visual.rotation.z,
      bank,
      bankResponse,
    );

    this.setRotation("steering_fin_L_pivot", "y", state.steer * 20 * DEG);
    this.setRotation("steering_fin_R_pivot", "y", state.steer * 20 * DEG);
    this.setRotation("airbrake_L_pivot", "x", state.brake * 60 * DEG);
    this.setRotation("airbrake_R_pivot", "x", state.brake * 60 * DEG);
    this.setRotation("elevon_L_pivot", "y", (-state.steer * 9 + state.brake * 6) * DEG);
    this.setRotation("elevon_R_pivot", "y", (-state.steer * 9 - state.brake * 6) * DEG);
    this.setRotation(
      "stabiliser_ring_pivot",
      "z",
      (-state.lateralLoad * 12 - state.steer * state.driftIntensity * 10) * DEG,
    );

    const flapAngle = (9 + state.throttle * 20 + (state.boostActive ? 4 : 0)) * DEG;
    for (const name of ENGINE_FLAP_NAMES) {
      this.setRotation(name, "x", flapAngle);
    }

    const skid = this.nodes.get("skids_pivot");
    const skidNeutral = this.neutral.get("skids_pivot");
    if (skid && skidNeutral) {
      const retract = THREE.MathUtils.smoothstep(state.speedRatio, 0.12, 0.26);
      skid.position.y = skidNeutral.position.y - retract * 0.22;
    }

    // The ground blob used to be a 12-triangle circle parented here. It now
    // rides in the fleet's shared instanced blob mesh alongside the rivals, so
    // every craft on track reads the same way for one draw call in total.
    this.racePresence?.update(state);
  }

  triggerImpactEffect(side: number, strength: number): void {
    this.racePresence?.triggerImpact(side, strength);
  }

  resetEffects(): void {
    this.racePresence?.reset();
  }

  worldPosition(
    name: string,
    fallback: THREE.Vector3,
    target: THREE.Vector3,
  ): THREE.Vector3 {
    const node = this.nodes.get(name);
    if (!node) return target.copy(fallback);
    this.root.updateMatrixWorld(true);
    return node.getWorldPosition(target);
  }

  private setRotation(name: string, axis: "x" | "y" | "z", offset: number): void {
    const node = this.nodes.get(name);
    const neutral = this.neutral.get(name);
    if (!node || !neutral) return;
    this.rotationOffset.setFromAxisAngle(LOCAL_ROTATION_AXES[axis], offset);
    node.quaternion.copy(neutral.quaternion).multiply(this.rotationOffset);
  }

  private captureOriginalVisibleMeshes(): void {
    if (!this.model) return;
    this.model.updateMatrixWorld(true);
    const modelWorldInverse = this.model.matrixWorld.clone().invert();
    const articulated = new Set(
      RIVAL_ARTICULATION_GROUPS.flatMap((entry) => entry.pivots),
    );
    this.originalVisibleMeshes = [];
    this.pivotMatrices.clear();
    this.model.traverse((object) => {
      if (articulated.has(object.name)) {
        this.pivotMatrices.set(
          object.name,
          modelWorldInverse.clone().multiply(object.matrixWorld),
        );
      }
      if (!(object instanceof THREE.Mesh) || !object.visible) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      if (materials.some((material) => material.name === "TOTEM_collision")) return;
      let pivot: string | null = null;
      for (
        let ancestor: THREE.Object3D | null = object;
        ancestor && ancestor !== this.model;
        ancestor = ancestor.parent
      ) {
        if (articulated.has(ancestor.name)) {
          pivot = ancestor.name;
          break;
        }
      }
      this.originalVisibleMeshes.push({
        mesh: object,
        modelLocalMatrix: modelWorldInverse.clone().multiply(object.matrixWorld),
        pivot,
      });
    });
  }

  private calibrateVehicleMaterials(): void {
    if (!this.model) return;
    const calibrated = new Set<THREE.Material>();
    this.model.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        if (calibrated.has(material) || !(material instanceof THREE.MeshStandardMaterial)) {
          continue;
        }
        calibrated.add(material);
        if (material.name === "TOTEM_body") {
          material.roughness = Math.max(material.roughness, 0.72);
          material.metalness = Math.min(material.metalness, 0.18);
        } else if (material.name === "TOTEM_emissive") {
          material.emissiveIntensity = 0.62;
        } else if (material.name === "TOTEM_glass") {
          material.roughness = Math.max(material.roughness, 0.25);
          material.metalness = Math.min(material.metalness, 0.1);
        }
        material.needsUpdate = true;
      }
    });
  }

}
