import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

export interface TotemVisualState {
  steer: number;
  throttle: number;
  brake: number;
  speedRatio: number;
  boostActive: boolean;
  driftIntensity: number;
  lateralLoad: number;
  elapsed: number;
  delta: number;
}

interface NeutralTransform {
  rotation: THREE.Euler;
  position: THREE.Vector3;
}

export interface Ps2MaterialTreatmentStats {
  materials: number;
  textures: number;
}

const DEG = Math.PI / 180;
const ENGINE_FLAP_NAMES = [
  "engine_flap_L_0_pivot",
  "engine_flap_L_1_pivot",
  "engine_flap_R_0_pivot",
  "engine_flap_R_1_pivot",
] as const;

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
  private readonly enginePlumes: THREE.Mesh[] = [];
  private boostPlume: THREE.Mesh | null = null;
  private model: THREE.Object3D | null = null;

  constructor() {
    this.root.name = "totem_vehicle_root";
    this.visual.name = "totem_visual_motion";
    this.root.add(this.visual);
  }

  async load(url: string): Promise<void> {
    const loader = new GLTFLoader();
    const gltf = await loader.loadAsync(url);
    this.model = gltf.scene;
    this.model.name = "TOTEM_runtime";
    this.visual.add(this.model);
    applyPs2MaterialTreatment(this.model);

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
        rotation: node.rotation.clone(),
        position: node.position.clone(),
      });
    }

    this.installEngineEffects();
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

    const plumeStrength = 0.22 + state.throttle * 0.78 + state.speedRatio * 0.28;
    for (const plume of this.enginePlumes) {
      plume.scale.set(0.72 + state.throttle * 0.34, plumeStrength, 0.72 + state.throttle * 0.34);
      const material = plume.material as THREE.MeshBasicMaterial;
      material.opacity = 0.12 + state.throttle * 0.42 + state.speedRatio * 0.12;
    }
    if (this.boostPlume) {
      const boostRead = THREE.MathUtils.smoothstep(state.speedRatio, 0.08, 0.28);
      this.boostPlume.visible = state.boostActive && boostRead > 0.01;
      this.boostPlume.scale.setScalar(
        state.boostActive
          ? (0.65 + boostRead * 0.35) * (1 + Math.sin(state.elapsed * 32) * 0.04)
          : 0.01,
      );
      const boostMaterial = this.boostPlume.material as THREE.MeshBasicMaterial;
      boostMaterial.opacity = 0.28 + boostRead * 0.22;
    }
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
    node.rotation[axis] = neutral.rotation[axis] + offset;
  }

  private installEngineEffects(): void {
    const plumeMaterial = new THREE.MeshBasicMaterial({
      color: 0x7cecff,
      transparent: true,
      opacity: 0.58,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    const plumeGeometry = new THREE.CylinderGeometry(0.05, 0.34, 2.8, 7, 1, true);
    plumeGeometry.translate(0, 1.4, 0);

    for (const anchorName of ["FX_engine_left", "FX_engine_right"]) {
      const anchor = this.nodes.get(anchorName);
      if (!anchor) continue;
      const plume = new THREE.Mesh(plumeGeometry, plumeMaterial.clone());
      plume.name = `${anchorName}_plume`;
      plume.rotation.x = Math.PI / 2;
      anchor.add(plume);
      this.enginePlumes.push(plume);
    }

    const boostAnchor = this.nodes.get("FX_boost_center");
    if (!boostAnchor) return;
    const boostGeometry = new THREE.CylinderGeometry(0.04, 0.56, 5.5, 8, 1, true);
    boostGeometry.translate(0, 2.75, 0);
    const boostMaterial = new THREE.MeshBasicMaterial({
      color: 0xc8ff2e,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.boostPlume = new THREE.Mesh(boostGeometry, boostMaterial);
    this.boostPlume.rotation.x = Math.PI / 2;
    this.boostPlume.visible = false;
    boostAnchor.add(this.boostPlume);
  }
}
