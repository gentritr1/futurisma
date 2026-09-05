import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { disposeObject3DResources } from "./graphics-resources.js";
import type { TotemVisualState } from "./totem";
import { TidelinePowerField } from "./tideline-power-field";
import { PowerKit, type PowerKitVisual } from "./power-kit";

export const TOTEM_EVOLUTION_URL = "/assets/totem-evolution/totem_evolution.glb";

const READY = new THREE.Color(0xc4e77d);
const RECHARGING = new THREE.Color(0xff993e);
const BOOST = new THREE.Color(0xff581d);
const OVERDRIVE = new THREE.Color(0x26deff);
const FLOOR = new THREE.Color(0x52cee1);
const CEILING = new THREE.Color(0xfa8ecb);
const SHIELD = new THREE.Color(0xb899ff);
const BRAKE = new THREE.Color(0xff4221);
const POWER_IDLE = new THREE.Color(0x3b325a);
const TWO_PI = Math.PI * 2;

/** Player-only assembly: no materials or geometry are shared with the rival fleet. */
export class TotemEvolution {
  readonly root = new THREE.Group();
  private readonly rotor: THREE.Object3D;
  private readonly boostLamp: THREE.MeshStandardMaterial;
  private readonly brakeLamp: THREE.MeshStandardMaterial;
  private readonly gravityLamp: THREE.MeshStandardMaterial;
  private readonly powerLamp: THREE.MeshStandardMaterial;
  private readonly jets: THREE.InstancedMesh;
  private readonly jetMaterial: THREE.ShaderMaterial;
  private readonly shield: THREE.Mesh;
  private readonly shieldMaterial: THREE.ShaderMaterial;
  private readonly placement = new THREE.Object3D();
  private readonly lightColor = new THREE.Color();
  private readonly pumpField: TidelinePowerField | null;
  private rotorSpeed = 0;
  private engineStrength = 0;
  private surgeDevice: PowerKitVisual | null = null;
  private shieldDevice: PowerKitVisual | null = null;
  private surgeDeployment = 0;
  private shieldDeployment = 0;
  private powerMounts: THREE.InstancedMesh | null = null;
  private surgeConduit: THREE.InstancedMesh | null = null;

  static async load(pumpWorks = false): Promise<TotemEvolution> {
    const [assetResult, kitResult] = await Promise.allSettled([
      new GLTFLoader().loadAsync(TOTEM_EVOLUTION_URL), PowerKit.load(pumpWorks),
    ]);
    if (assetResult.status === "rejected") {
      if (kitResult.status === "fulfilled") kitResult.value.dispose();
      throw assetResult.reason;
    }
    const kit = kitResult.status === "fulfilled" ? kitResult.value : null;
    if (kitResult.status === "rejected") console.warn("Mechanical power modules could not load.", kitResult.reason);
    try { return new TotemEvolution(assetResult.value.scene, kit); }
    catch (error) {
      disposeObject3DResources(assetResult.value.scene);
      kit?.dispose();
      throw error;
    }
  }

  constructor(asset: THREE.Object3D, powerKit: PowerKit | null = null) {
    this.root.name = "totem_evolution_player_only";
    const rotor = asset.getObjectByName("TE_gyro_pivot");
    if (!rotor) throw new Error("TOTEM evolution is missing its gyro pivot.");
    this.rotor = rotor;
    const materials = new Map<string, THREE.MeshStandardMaterial>();
    asset.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const batch = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of batch) {
        if (material instanceof THREE.MeshStandardMaterial) {
          materials.set(material.name, material);
        }
      }
      object.castShadow = false;
      object.receiveShadow = true;
    });
    const requiredMaterial = (name: string): THREE.MeshStandardMaterial => {
      const material = materials.get(name);
      if (!material) throw new Error(`TOTEM evolution is missing ${name}.`);
      return material;
    };
    // Validate the complete asset before allocating any effects resources.
    this.boostLamp = requiredMaterial("TE_boost");
    this.brakeLamp = requiredMaterial("TE_brake");
    this.gravityLamp = requiredMaterial("TE_gravity");
    this.powerLamp = requiredMaterial("TE_power");
    this.pumpField = powerKit?.templates.surge.userData.pumpHardware ? new TidelinePowerField() : null;
    if(this.pumpField)this.root.add(this.pumpField.root);
    this.root.add(asset);

    this.jetMaterial = new THREE.ShaderMaterial({
      name: "TE_layered_engine_jets",
      uniforms: {
        uTime: { value: 0 },
        uStrength: { value: 0 },
        uColor: { value: BOOST.clone() },
      },
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        varying float vLayer;
        varying float vCore;
        void main() {
          vUv = uv;
          vLayer = instanceColor.r;
          vCore = instanceColor.g;
          gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform float uStrength;
        uniform vec3 uColor;
        varying vec2 vUv;
        varying float vLayer;
        varying float vCore;
        void main() {
          float endFade = smoothstep(0.0, 0.18, vUv.y) * (0.35 + 0.65 * vUv.y);
          float diamonds = 0.7 + 0.3 * pow(0.5 + 0.5 * cos(vUv.y * 31.4 - uTime), 3.0);
          vec3 hotColor = mix(uColor, vec3(1.0, 0.96, 0.86), vCore * 0.9);
          gl_FragColor = vec4(hotColor, endFade * diamonds * vLayer * uStrength);
          #include <colorspace_fragment>
        }
      `,
    });
    // The nozzle is z=0; the narrow tail is z=1. Four instances are two nested
    // layers per engine, so changing boost length adds no geometry or draw calls.
    const jetGeometry = new THREE.CylinderGeometry(1, 0.04, 1, 8, 3, true);
    jetGeometry.rotateX(-Math.PI / 2);
    jetGeometry.translate(0, 0, 0.5);
    this.jets = new THREE.InstancedMesh(jetGeometry, this.jetMaterial, 4);
    this.jets.name = "TE_twin_layered_exhaust";
    this.jets.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.jets.frustumCulled = false;
    this.jets.renderOrder = 3;
    for (let index = 0; index < 4; index += 1) {
      const core = index % 2 === 0;
      this.jets.setColorAt(index, new THREE.Color(core ? 0.94 : 0.48, core ? 1 : 0, 0));
    }
    this.root.add(this.jets);

    this.shieldMaterial = new THREE.ShaderMaterial({
      name: "TE_shield_field",
      uniforms: { uOpacity: { value: 0 }, uColor: { value: SHIELD.clone() } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      vertexShader: /* glsl */ `
        varying float vRim;
        varying float vHeight;
        void main() {
          vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
          vec3 viewNormal = normalize(normalMatrix * normal);
          vRim = 1.0 - abs(dot(viewNormal, normalize(-viewPosition.xyz)));
          vHeight = position.y;
          gl_Position = projectionMatrix * viewPosition;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uOpacity;
        uniform vec3 uColor;
        varying float vRim;
        varying float vHeight;
        void main() {
          float bands = smoothstep(0.9, 1.0, cos(vHeight * 55.0));
          float edge = pow(clamp(vRim, 0.0, 1.0), 2.7);
          gl_FragColor = vec4(uColor, (edge * 0.5 + bands * 0.08) * uOpacity);
          #include <colorspace_fragment>
        }
      `,
    });
    this.shield = new THREE.Mesh(createHexShieldGeometry(), this.shieldMaterial);
    this.shield.name = "TE_power_shield";
    this.shield.position.set(0, 0.1, -0.55);
    this.shield.scale.set(1.86, 1.28, 3.75);
    this.shield.renderOrder = 4;
    this.shield.visible = false;
    this.root.add(this.shield);
    if (powerKit) {
      this.powerMounts = new THREE.InstancedMesh(
        new THREE.CylinderGeometry(.065, .085, 1, 6),
        new THREE.MeshStandardMaterial({ color: 0x52636a, roughness: .5, metalness: .3 }), 4,
      );
      this.powerMounts.name = "TE_telescopic_power_mounts";
      this.powerMounts.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.powerMounts.frustumCulled = false;
      this.root.add(this.powerMounts);
      this.surgeConduit = new THREE.InstancedMesh(
        new THREE.BoxGeometry(.055, .026, .21),
        new THREE.MeshBasicMaterial({ color: 0x7ceaf8, transparent: true, opacity: .8,
          depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }), 6,
      );
      this.surgeConduit.name = "TE_surge_feed_conduit";
      this.surgeConduit.visible = false;
      for (let segment = 0; segment < 6; segment += 1) {
        this.placement.position.set(-.7, .49, .2 + segment * .33);
        this.placement.scale.setScalar(1);
        this.placement.updateMatrix();
        this.surgeConduit.setMatrixAt(segment, this.placement.matrix);
        this.surgeConduit.setColorAt(segment, new THREE.Color(.2, .2, .2));
      }
      this.root.add(this.surgeConduit);
      this.surgeDevice = powerKit.createPickupVisual("surge");
      this.shieldDevice = powerKit.createPickupVisual("shield");
      for (const [device, side] of [[this.surgeDevice, -1], [this.shieldDevice, 1]] as const) {
        device.root.name = side < 0 ? "TE_mounted_surge" : "TE_mounted_shield";
        device.root.position.set(side * .78, .64, -.05);
        device.root.rotation.x = device.root.userData.pumpHardware ? -.18 : Math.PI / 2;
        device.root.scale.setScalar(.42);
        this.root.add(device.root);
      }
    }
    this.reset();
  }

  update(state: TotemVisualState): void {
    const delta = THREE.MathUtils.clamp(state.delta, 0, 0.1);
    const speed = THREE.MathUtils.clamp(state.speedRatio, 0, 1.5);
    const transition = THREE.MathUtils.clamp(state.gravityTransition ?? 0, 0, 1);
    const overdrive = state.overdriveActive === true;
    const firing = state.boostActive || overdrive;
    const reserve = THREE.MathUtils.clamp(state.boostReserve ?? 1, 0, 1);
    const inverted = (state.gravitySign ?? 1) < 0;
    const spinDirection = inverted ? -1 : 1;
    const targetSpeed = (0.65 + speed * 5.4 + (firing ? 10 : 0)) * spinDirection;
    this.rotorSpeed = THREE.MathUtils.lerp(this.rotorSpeed, targetSpeed, 1 - Math.exp(-delta * 5));
    // Reduced motion keeps the instrument's state signal while removing the
    // continuous spinning, flicker and thruster modulation.
    if (!state.reducedMotion) {
      this.rotor.rotation.z = (this.rotor.rotation.z + this.rotorSpeed * delta) % TWO_PI;
    }
    this.rotor.rotation.x = state.reducedMotion ? 0 : transition * 0.16;

    this.lightColor.copy(firing ? (overdrive ? OVERDRIVE : BOOST) : reserve > 0.18 ? READY : RECHARGING);
    this.setLamp(this.boostLamp, this.lightColor, firing ? 2.1 : 0.35 + reserve * 0.5, delta);
    this.setLamp(this.brakeLamp, BRAKE, 0.08 + THREE.MathUtils.clamp(state.brake, 0, 1) * 2.1, delta);
    this.setLamp(this.gravityLamp, transition > 0.02 ? RECHARGING : inverted ? CEILING : FLOOR, transition > 0.02 ? 1.8 : 0.8, delta);
    const powerColor = state.shieldActive
      ? SHIELD
      : overdrive ? OVERDRIVE : state.powerReady ? RECHARGING : POWER_IDLE;
    this.setLamp(this.powerLamp, powerColor, state.shieldActive || overdrive ? 1.7 : state.powerReady ? 0.85 : 0.18, delta);

    const throttle = THREE.MathUtils.clamp(state.throttle, 0, 1);
    const targetStrength = 0.20 + throttle * 0.78 + (firing ? 0.80 : 0);
    this.engineStrength = THREE.MathUtils.lerp(this.engineStrength, targetStrength, 1 - Math.exp(-delta * 11));
    // A broad outer plume and shorter white core remain legible behind the hull
    // at chase distance. Nitro is hot orange; the installed Surge changes it cyan.
    const length = 0.24 + throttle * 1.12 + (firing ? (overdrive ? 3.55 : 2.75) : 0);
    const nozzleWidth = 0.23 + (firing ? 0.14 : 0);
    for (let engine = 0; engine < 2; engine += 1) {
      for (let layer = 0; layer < 2; layer += 1) {
        this.placement.position.set(engine === 0 ? -0.45 : 0.45, 0.215659, 2.50);
        const radius = nozzleWidth * (layer === 0 ? 0.66 : 1.22);
        this.placement.scale.set(radius, radius, length * (layer === 0 ? 0.78 : 1));
        this.placement.updateMatrix();
        this.jets.setMatrixAt(engine * 2 + layer, this.placement.matrix);
      }
    }
    this.jets.instanceMatrix.needsUpdate = true;
    this.jetMaterial.uniforms.uTime.value = state.reducedMotion ? 0 : state.elapsed * 9;
    this.jetMaterial.uniforms.uStrength.value = this.engineStrength;
    this.jetMaterial.uniforms.uColor.value.copy(overdrive ? OVERDRIVE : BOOST);
    this.shield.visible = !this.pumpField && state.shieldActive === true;
    this.pumpField?.update(state.elapsed,state.reducedMotion,overdrive,state.shieldActive === true,state.shieldRefundWindow === true);
    const charge = THREE.MathUtils.clamp(state.powerCharge ?? 1, 0, 1);
    const activation = THREE.MathUtils.clamp(state.powerActivation ?? 1, 0, 1);
    const response = 1 - Math.exp(-delta * 7);
    const surgeTarget = overdrive ? 1 : state.heldPowerKind === "surge" ? .66 : 0;
    const shieldTarget = state.shieldActive ? 1 : state.heldPowerKind === "shield" ? .66 : 0;
    this.surgeDeployment = THREE.MathUtils.lerp(this.surgeDeployment, surgeTarget, response);
    this.shieldDeployment = THREE.MathUtils.lerp(this.shieldDeployment, shieldTarget, response);
    for (const [device, deployment, active] of [
      [this.surgeDevice, this.surgeDeployment, overdrive],
      [this.shieldDevice, this.shieldDeployment, state.shieldActive === true],
    ] as const) {
      if (!device) continue;
      device.root.position.y = .64 + deployment * .46;
      device.root.scale.setScalar(.42 + deployment * .2);
      device.update(state.elapsed, state.reducedMotion, deployment > .05 ? charge : .12, active ? activation : 0);
    }
    if (this.surgeConduit) {
      this.surgeConduit.visible = overdrive || state.heldPowerKind === "surge";
      for (let segment = 0; segment < 6; segment += 1) {
        const wave = state.reducedMotion ? 1 : .55 + .45 * Math.sin(state.elapsed * 7 - segment * 1.2);
        const energy = overdrive ? .55 + wave * .45 : .08 + charge * .12;
        this.lightColor.setRGB(energy, energy, energy);
        this.surgeConduit.setColorAt(segment, this.lightColor);
      }
      if (this.surgeConduit.instanceColor) this.surgeConduit.instanceColor.needsUpdate = true;
    }
    if (this.powerMounts) {
      for (let side = 0; side < 2; side += 1) {
        const device = side === 0 ? this.surgeDevice : this.shieldDevice;
        if (!device) continue;
        const height = Math.max(.08, device.root.position.y - device.root.scale.x * .46 - .38);
        for (let support = 0; support < 2; support += 1) {
          this.placement.position.set(side === 0 ? -.78 : .78, .38 + height / 2, -.05 + (support === 0 ? -.14 : .14));
          this.placement.scale.set(1, height, 1);
          this.placement.updateMatrix();
          this.powerMounts.setMatrixAt(side * 2 + support, this.placement.matrix);
        }
      }
      this.powerMounts.instanceMatrix.needsUpdate = true;
    }
    this.shieldMaterial.uniforms.uOpacity.value = state.reducedMotion ? 0.5 : 0.65;
  }

  reset(): void {
    this.surgeDeployment = this.shieldDeployment = 0;
    this.rotorSpeed = 0;
    this.rotor.rotation.set(0, 0, 0);
    this.engineStrength = 0;
    this.jetMaterial.uniforms.uStrength.value = 0;
    this.shield.visible = false;
    this.pumpField?.update(0,true,false,false,false);
    if (this.surgeConduit) this.surgeConduit.visible = false;
    this.brakeLamp.emissiveIntensity = 0.08;
  }

  private setLamp(
    material: THREE.MeshStandardMaterial,
    color: THREE.Color,
    strength: number,
    delta: number,
  ): void {
    const response = 1 - Math.exp(-delta * 12);
    material.color.lerp(color, response);
    material.emissive.lerp(color, response);
    material.emissiveIntensity = THREE.MathUtils.lerp(material.emissiveIntensity, strength, response);
  }
}

/** Spaced, surfaced hexagonal plates around the hull, rather than a solid bubble. */
function createHexShieldGeometry(): THREE.BufferGeometry {
  const positions: number[] = [];
  const centre = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const right = new THREE.Vector3();
  const up = new THREE.Vector3();
  const point = new THREE.Vector3();
  for (const latitude of [-.52, 0, .52]) {
    for (let segment = 0; segment < 8; segment += 1) {
      const angle = segment * Math.PI / 4 + (latitude === 0 ? 0 : Math.PI / 8);
      const radius = Math.sqrt(1 - latitude * latitude);
      centre.set(Math.cos(angle) * radius, latitude, Math.sin(angle) * radius);
      normal.copy(centre).normalize();
      right.crossVectors(new THREE.Vector3(0, 1, 0), normal).normalize();
      up.crossVectors(normal, right).normalize();
      for (let corner = 0; corner < 6; corner += 1) {
        positions.push(centre.x, centre.y, centre.z);
        for (const index of [corner, corner + 1]) {
          const phase = index * Math.PI / 3;
          point.copy(centre).addScaledVector(right, Math.cos(phase) * .22).addScaledVector(up, Math.sin(phase) * .22);
          positions.push(point.x, point.y, point.z);
        }
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}
