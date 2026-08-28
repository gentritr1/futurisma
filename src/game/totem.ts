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

export interface TotemRivalVisualBatch {
  role: TotemRivalMaterialRole;
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  triangles: number;
}

interface OriginalVisibleMesh {
  mesh: THREE.Mesh;
  modelLocalMatrix: THREE.Matrix4;
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
  private hoverShadow: THREE.Mesh | null = null;
  private racePresence: TotemRacePresence | null = null;
  private model: THREE.Object3D | null = null;
  private originalVisibleMeshes: OriginalVisibleMesh[] = [];

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
    this.installHoverShadow();
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

    const geometriesByRole = new Map<TotemRivalMaterialRole, THREE.BufferGeometry[]>();
    const materialByRole = new Map<TotemRivalMaterialRole, THREE.Material>();
    for (const role of RIVAL_MATERIAL_ROLES) geometriesByRole.set(role, []);

    for (const source of this.originalVisibleMeshes) {
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

      const geometry = source.mesh.geometry.index
        ? source.mesh.geometry.toNonIndexed()
        : source.mesh.geometry.clone();
      geometry.applyMatrix4(source.modelLocalMatrix);
      geometriesByRole.get(material.name)?.push(geometry);
    }

    const batches: TotemRivalVisualBatch[] = [];
    try {
      for (const role of RIVAL_MATERIAL_ROLES) {
        const sourceGeometries = geometriesByRole.get(role) ?? [];
        const sourceMaterial = materialByRole.get(role);
        if (sourceGeometries.length === 0 || !sourceMaterial) {
          throw new Error(`TOTEM is missing required rival material role ${role}.`);
        }
        const geometry = mergeGeometries(sourceGeometries, false);
        if (!geometry) {
          throw new Error(`TOTEM ${role} geometry could not be merged safely.`);
        }
        const position = geometry.getAttribute("position");
        const triangles = position.count / 3;
        if (!Number.isInteger(triangles)) {
          geometry.dispose();
          throw new Error(`TOTEM ${role} geometry does not contain complete triangles.`);
        }
        batches.push({
          role,
          geometry,
          material: sourceMaterial.clone(),
          triangles,
        });
      }
    } catch (error) {
      for (const batch of batches) {
        batch.geometry.dispose();
        batch.material.dispose();
      }
      throw error;
    } finally {
      for (const geometries of geometriesByRole.values()) {
        for (const geometry of geometries) geometry.dispose();
      }
    }
    return batches;
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

    const hoverHeight = state.boostActive
      ? 0.6
      : state.speedRatio < 0.1 ? 0.18 : 0.45;
    const trackOffset = -(hoverHeight + 0.68);
    if (this.hoverShadow) {
      this.hoverShadow.position.y = trackOffset;
      const shadowMaterial = this.hoverShadow.material as THREE.MeshBasicMaterial;
      shadowMaterial.opacity = state.boostActive ? 0.11 : 0.18;
    }
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
    this.originalVisibleMeshes = [];
    this.model.traverse((object) => {
      if (!(object instanceof THREE.Mesh) || !object.visible) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      if (materials.some((material) => material.name === "TOTEM_collision")) return;
      this.originalVisibleMeshes.push({
        mesh: object,
        modelLocalMatrix: modelWorldInverse.clone().multiply(object.matrixWorld),
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

  private installHoverShadow(): void {
    const shadowMaterial = new THREE.MeshBasicMaterial({
      color: 0x07100c,
      transparent: true,
      opacity: 0.18,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    this.hoverShadow = new THREE.Mesh(
      new THREE.CircleGeometry(1, 12),
      shadowMaterial,
    );
    this.hoverShadow.name = "totem_hover_shadow";
    this.hoverShadow.rotation.x = -Math.PI / 2;
    this.hoverShadow.position.set(0, -1.13, 0.28);
    this.hoverShadow.scale.set(1.55, 3.05, 1);
    this.hoverShadow.renderOrder = 1;
    this.root.add(this.hoverShadow);
  }

}
