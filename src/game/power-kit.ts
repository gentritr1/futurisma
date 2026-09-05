import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { disposeObject3DResources } from "./graphics-resources.js";

export type PowerKitKind = "surge" | "shield";
export const PUMP_POWER_KIT_URL = "/assets/power-kit-v2/power_kit.glb";
export const POWER_KIT_URL = "/assets/power-kit/power_kit.glb";

/** A transform-only instance. Geometry and materials belong to its PowerKit. */
type DeviceBatch = {update():void; dispose():void};
type BatchFactory = (root:THREE.Object3D,lamp:THREE.Object3D)=>DeviceBatch;

export class PowerKitVisual {
  readonly root: THREE.Object3D;
  readonly kind: PowerKitKind;
  private readonly moving: THREE.Object3D;
  private readonly core: THREE.Object3D;
  private readonly secondary: THREE.Object3D;
  private readonly release: () => void;
  private readonly pumpHardware: boolean;
  private readonly lampMaterials: THREE.MeshStandardMaterial[] = [];
  private previousTime = 0;
  private angle = 0;
  private disposed = false;
  private readonly batch: DeviceBatch | null;

  constructor(kind: PowerKitKind, root: THREE.Object3D, release: () => void, batchFactory?: BatchFactory) {
    this.kind = kind;
    this.root = root;
    this.release = release;
    const find = (suffix: string): THREE.Object3D => {
      const object = root.getObjectByName(`PK_${kind}_${suffix}`);
      if (!object) throw new Error(`Power kit is missing ${kind}/${suffix}.`);
      return object;
    };
    this.moving = find(kind === "surge" ? "cage" : "petals");
    this.core = find("core");
    this.secondary = find(kind === "surge" ? "capacitors" : "lattice");
    this.pumpHardware = root.userData.pumpHardware === true;
    if (this.pumpHardware) this.core.traverse(object => {
      if (!(object instanceof THREE.Mesh) || !(object.material instanceof THREE.MeshStandardMaterial)) return;
      object.material = object.material.clone();
      this.lampMaterials.push(object.material);
    });
    this.batch = this.pumpHardware && batchFactory ? batchFactory(root, this.core) : null;
  }

  update(elapsed: number, reducedMotion: boolean, charge = 1, activation = 0): void {
    if (this.disposed) return;
    const amount = THREE.MathUtils.clamp(charge, 0, 1);
    const firing = THREE.MathUtils.clamp(activation, 0, 1);
    const delta = THREE.MathUtils.clamp(elapsed - this.previousTime, 0, .1);
    this.previousTime = elapsed;
    if (!reducedMotion) this.angle = (this.angle + delta * (1 + amount * 1.4 + firing * 5)) % (Math.PI * 2);
    if (this.pumpHardware) {
      if (this.kind === "surge") this.moving.rotation.z = this.angle;
      else for (const blade of this.moving.children) blade.rotation.z = firing * .68;
      for (const lamp of this.lampMaterials) lamp.emissiveIntensity = .55 + amount * .3 + firing * 1.4;
      this.batch?.update();
      return;
    }
    if (this.kind === "surge") {
      this.moving.rotation.y = this.angle;
      this.secondary.rotation.y = -this.angle * .6;
      this.moving.scale.set(1 + firing * .13, 1 + firing * .18, 1 + firing * .13);
      this.core.scale.setScalar(.7 + amount * .3 + firing * .15);
    } else {
      const spread = .86 + amount * .10 + firing * .36;
      this.moving.scale.set(spread, 1, spread);
      this.moving.position.y = firing * .22;
      this.moving.rotation.y = firing * .32 + this.angle * .06;
      this.secondary.rotation.y = -this.angle * .25;
      this.secondary.position.y = firing * .2;
      this.core.scale.setScalar(.75 + amount * .25 + firing * .2);
    }
    // A restrained contained pulse keeps the solid mechanism easy to read.
    const pulse = reducedMotion ? 1 : 1 + Math.sin(elapsed * 2.8) * .035 * amount;
    this.core.scale.multiplyScalar(pulse);
  }

  /** Detach this instance. Shared render resources stay alive for other clones. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.root.removeFromParent();
    this.batch?.dispose();
    for (const lamp of this.lampMaterials) lamp.dispose();
    this.root.clear();
    this.release();
  }
}

export type PowerPickupVisual = PowerKitVisual;

/**
 * One library owns one loaded asset. Clones share geometry/materials. Call
 * dispose before the containing scene is disposed: it detaches every clone and
 * releases each source resource once. A live scene can also own the clones for
 * its whole lifetime and release their shared resources in its normal cleanup.
 */
export class PowerKit {
  readonly templates: Readonly<Record<PowerKitKind, THREE.Object3D>>;
  private readonly asset: THREE.Object3D;
  private readonly instances = new Set<PowerKitVisual>();
  private disposed = false;

  static async load(pumpWorks = false): Promise<PowerKit> {
    const gltf = await new GLTFLoader().loadAsync(pumpWorks ? PUMP_POWER_KIT_URL : POWER_KIT_URL);
    try {
      const Batch = pumpWorks ? (await import("./tideline-device-batch")).TidelineDeviceBatch : null;
      return new PowerKit(gltf.scene, Batch ? (root,lamp) => new Batch(root,lamp) : undefined);
    }
    catch (error) { disposeObject3DResources(gltf.scene); throw error; }
  }

  constructor(asset: THREE.Object3D, private readonly batchFactory?: BatchFactory) {
    this.asset = asset;
    const surge = asset.getObjectByName("PK_surge");
    const shield = asset.getObjectByName("PK_shield");
    if (!surge || !shield) throw new Error("Power kit must contain both mechanical devices.");
    this.templates = { surge, shield };
    for (const [kind, template] of Object.entries(this.templates)) {
      for (const suffix of kind === "surge" ? ["cage", "capacitors", "core", "mount"] : ["housing", "petals", "core", "lattice"]) {
        if (!template.getObjectByName(`PK_${kind}_${suffix}`)) throw new Error(`Power kit is missing ${kind}/${suffix}.`);
      }
    }
    asset.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      object.castShadow = false;
      object.receiveShadow = true;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        material.dithering = true;
        if (material instanceof THREE.MeshStandardMaterial) {
          material.roughness = Math.max(.44, material.roughness);
          material.emissiveIntensity = Math.min(material.emissiveIntensity, 1.5);
        }
      }
    });
  }

  createPickupVisual(kind: PowerKitKind): PowerKitVisual {
    if (this.disposed) throw new Error("A disposed power kit cannot create new instances.");
    const root = this.templates[kind].clone(true);
    root.name = `power_${kind}_instance`;
    const visual = new PowerKitVisual(kind, root, () => this.instances.delete(visual), this.batchFactory);
    this.instances.add(visual);
    return visual;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const instance of this.instances) instance.dispose();
    disposeObject3DResources(this.asset);
    this.asset.clear();
  }
}
