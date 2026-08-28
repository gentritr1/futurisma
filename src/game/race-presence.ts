import * as THREE from "three";

export interface RacePresenceVisualState {
  throttle: number;
  brake: number;
  speedRatio: number;
  boostActive: boolean;
  driftIntensity: number;
  surfaceGrip: number;
  reducedMotion: boolean;
  elapsed: number;
  delta: number;
}

type EffectFamily = "additive" | "alpha" | "masked_alpha";

type EffectSlot =
  | "idle_hover_discharge"
  | "acceleration_exhaust"
  | "boost_core_flare"
  | "braking_energy"
  | "wet_deck_spray"
  | "shallow_water_mist"
  | "impact_spark"
  | "ion_distortion_mask";

interface EffectBatch {
  mesh: THREE.InstancedMesh;
  capacity: number;
  used: number;
}

type RacePresenceMaterial = THREE.ShaderMaterial & {
  racePresenceAtlas: THREE.Texture;
};

const EFFECT_SLOT_INDEX: Record<EffectSlot, number> = {
  idle_hover_discharge: 0,
  acceleration_exhaust: 1,
  boost_core_flare: 2,
  braking_energy: 3,
  wet_deck_spray: 4,
  shallow_water_mist: 5,
  impact_spark: 6,
  ion_distortion_mask: 7,
};

const EFFECT_ALPHA_CAP: Record<EffectSlot, number> = {
  idle_hover_discharge: 0.58,
  acceleration_exhaust: 0.62,
  boost_core_flare: 0.68,
  braking_energy: 0.55,
  wet_deck_spray: 0.42,
  shallow_water_mist: 0.28,
  impact_spark: 0.72,
  ion_distortion_mask: 0.46,
};

const EFFECT_PLANE_AXIS = new THREE.Vector3(0, 0, 1);
const BOOST_MASK_OFFSET = new THREE.Vector3(0, -0.08, 0.12);

export const RACE_PRESENCE_RUNTIME_BUDGET = Object.freeze({
  atlasTextures: 1,
  materialFamilies: 3,
  maximumDrawCalls: 3,
  maximumInstances: 11,
  maximumTriangles: 22,
});

const VERTEX_SHADER = /* glsl */ `
  varying vec2 vEffectUv;
  varying vec3 vEffectData;
  #include <fog_pars_vertex>

  void main() {
    vEffectUv = uv;
    vEffectData = instanceColor;
    vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const FRAGMENT_SHADER = /* glsl */ `
  uniform sampler2D effectAtlas;
  uniform float maskedFamily;
  varying vec2 vEffectUv;
  varying vec3 vEffectData;
  #include <fog_pars_fragment>

  void main() {
    float slot = floor(vEffectData.r * 7.0 + 0.5);
    float column = mod(slot, 2.0);
    float row = floor(slot * 0.5);
    vec2 cellUv = vec2(vEffectUv.x, 1.0 - vEffectUv.y);
    vec2 atlasUv = vec2(column * 0.5, row * 0.25)
      + cellUv * vec2(0.5, 0.25);
    vec4 texel = texture2D(effectAtlas, atlasUv);
    float alpha = texel.a * vEffectData.g;
    float cutoff = mix(0.006, 0.055, maskedFamily);
    if (alpha < cutoff) discard;
    gl_FragColor = vec4(texel.rgb, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

function configureAtlas(texture: THREE.Texture): void {
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.flipY = false;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestMipmapNearestFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 1;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
}

function createEffectMaterial(
  atlas: THREE.Texture,
  family: EffectFamily,
): RacePresenceMaterial {
  const material = new THREE.ShaderMaterial({
    name: `TOTEM_race_presence_${family}`,
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        effectAtlas: { value: atlas },
        maskedFamily: { value: family === "masked_alpha" ? 1 : 0 },
      },
    ]),
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: family === "additive"
      ? THREE.AdditiveBlending
      : THREE.NormalBlending,
    side: THREE.DoubleSide,
    fog: true,
    toneMapped: false,
  }) as RacePresenceMaterial;
  // Keep the texture directly reachable so the shared graphics disposer owns it.
  material.racePresenceAtlas = atlas;
  return material;
}

function anchorPosition(
  model: THREE.Object3D,
  nodes: ReadonlyMap<string, THREE.Object3D>,
  name: string,
  fallback: THREE.Vector3,
): THREE.Vector3 {
  const node = nodes.get(name);
  if (!node) return fallback.clone();
  model.updateMatrixWorld(true);
  const modelWorldInverse = model.matrixWorld.clone().invert();
  return node.getWorldPosition(new THREE.Vector3()).applyMatrix4(modelWorldInverse);
}

export class TotemRacePresence {
  private readonly additive: EffectBatch;
  private readonly alpha: EffectBatch;
  private readonly masked: EffectBatch;
  private readonly batches: readonly EffectBatch[];
  private readonly effectMatrix = new THREE.Matrix4();
  private readonly effectQuaternion = new THREE.Quaternion();
  private readonly effectScale = new THREE.Vector3();
  private readonly effectData = new THREE.Color();
  private readonly effectPosition = new THREE.Vector3();
  private readonly engineLeft: THREE.Vector3;
  private readonly engineRight: THREE.Vector3;
  private readonly boostCenter: THREE.Vector3;
  private readonly brakeLeft: THREE.Vector3;
  private readonly brakeRight: THREE.Vector3;
  private readonly sprayLeft: THREE.Vector3;
  private readonly sprayRight: THREE.Vector3;
  private readonly impactNose: THREE.Vector3;
  private readonly impactLeft: THREE.Vector3;
  private readonly impactRight: THREE.Vector3;
  private impactActive = false;
  private impactAge = 0;
  private impactSide = 0;
  private impactStrength = 0;

  constructor(
    model: THREE.Object3D,
    nodes: ReadonlyMap<string, THREE.Object3D>,
    readonly atlas: THREE.Texture,
  ) {
    configureAtlas(atlas);
    const quad = new THREE.PlaneGeometry(1, 1, 1, 1);
    this.additive = this.createBatch(quad, atlas, "additive", 5, 5);
    this.alpha = this.createBatch(quad, atlas, "alpha", 5, 4);
    this.masked = this.createBatch(quad, atlas, "masked_alpha", 1, 3);
    this.batches = [this.additive, this.alpha, this.masked];
    model.add(
      this.masked.mesh,
      this.alpha.mesh,
      this.additive.mesh,
    );

    this.engineLeft = anchorPosition(
      model,
      nodes,
      "FX_engine_left",
      new THREE.Vector3(-0.45, 0.74, 2.52),
    );
    this.engineRight = anchorPosition(
      model,
      nodes,
      "FX_engine_right",
      new THREE.Vector3(0.45, 0.74, 2.52),
    );
    this.boostCenter = anchorPosition(
      model,
      nodes,
      "FX_boost_center",
      new THREE.Vector3(0, 0.76, 2.62),
    );
    this.brakeLeft = anchorPosition(
      model,
      nodes,
      "FX_trail_wing_left",
      new THREE.Vector3(-1.52, 0.44, 2.2),
    );
    this.brakeRight = anchorPosition(
      model,
      nodes,
      "FX_trail_wing_right",
      new THREE.Vector3(1.52, 0.44, 2.2),
    );
    this.sprayLeft = anchorPosition(
      model,
      nodes,
      "FX_dust_rear_left",
      new THREE.Vector3(-1.2, 0.1, 1.8),
    );
    this.sprayRight = anchorPosition(
      model,
      nodes,
      "FX_dust_rear_right",
      new THREE.Vector3(1.2, 0.1, 1.8),
    );
    this.impactNose = anchorPosition(
      model,
      nodes,
      "FX_impact_nose",
      new THREE.Vector3(0, 0.44, -3.3),
    );
    this.impactLeft = anchorPosition(
      model,
      nodes,
      "FX_impact_left",
      new THREE.Vector3(-1.53, 0.44, 2.05),
    );
    this.impactRight = anchorPosition(
      model,
      nodes,
      "FX_impact_right",
      new THREE.Vector3(1.53, 0.44, 2.05),
    );
  }

  update(state: RacePresenceVisualState): void {
    this.beginFrame();
    const pulse = state.reducedMotion
      ? 1
      : 0.92 + Math.sin(state.elapsed * 8.5) * 0.08;
    const idleWeight = 1 - THREE.MathUtils.smoothstep(state.speedRatio, 0.08, 0.38);
    this.addEffect(
      this.additive,
      "idle_hover_discharge",
      this.effectPosition.set(0, -0.5, 0.15),
      2.3,
      1.05,
      idleWeight * 0.46 * pulse,
    );

    const accelerationWeight = THREE.MathUtils.clamp(
      state.throttle * 0.82 + state.speedRatio * 0.48,
      0,
      1,
    );
    if (accelerationWeight > 0.02) {
      const exhaustOpacity = 0.14 + accelerationWeight * 0.42;
      const exhaustWidth = 0.62 + state.throttle * 0.12;
      const exhaustHeight = 0.82 + accelerationWeight * 0.46;
      this.addEffect(
        this.alpha,
        "acceleration_exhaust",
        this.engineLeft,
        exhaustWidth,
        exhaustHeight,
        exhaustOpacity,
      );
      this.addEffect(
        this.alpha,
        "acceleration_exhaust",
        this.engineRight,
        exhaustWidth,
        exhaustHeight,
        exhaustOpacity,
      );
    }

    if (state.boostActive) {
      const boostRead = THREE.MathUtils.smoothstep(state.speedRatio, 0.08, 0.3);
      const boostPulse = state.reducedMotion
        ? 1
        : 0.96 + Math.sin(state.elapsed * 22) * 0.04;
      this.addEffect(
        this.additive,
        "boost_core_flare",
        this.boostCenter,
        1.35 + boostRead * 0.28,
        1.42 + boostRead * 0.4,
        (0.42 + boostRead * 0.24) * boostPulse,
      );
      this.addEffect(
        this.masked,
        "ion_distortion_mask",
        this.effectPosition.copy(this.boostCenter).add(BOOST_MASK_OFFSET),
        1.7,
        0.72,
        0.18 + boostRead * 0.14,
      );
    }

    if (state.brake > 0.02) {
      const brakingOpacity = 0.14 + state.brake * 0.39;
      this.addEffect(
        this.additive,
        "braking_energy",
        this.brakeLeft,
        1.22,
        0.62,
        brakingOpacity,
        Math.PI,
      );
      this.addEffect(
        this.additive,
        "braking_energy",
        this.brakeRight,
        1.22,
        0.62,
        brakingOpacity,
      );
    }

    const wetness = 0.2 + (1 - THREE.MathUtils.clamp(state.surfaceGrip, 0, 1)) * 0.8;
    const wakeStrength = THREE.MathUtils.smoothstep(state.speedRatio, 0.12, 0.72);
    const sprayOpacity = wakeStrength * (0.07 + wetness * 0.29)
      + state.driftIntensity * 0.05;
    if (sprayOpacity > 0.01) {
      const sprayWidth = 1.35 + state.driftIntensity * 0.35;
      this.addEffect(
        this.alpha,
        "wet_deck_spray",
        this.effectPosition.copy(this.sprayLeft).setY(-0.58),
        sprayWidth,
        0.68,
        sprayOpacity,
      );
      this.addEffect(
        this.alpha,
        "wet_deck_spray",
        this.effectPosition.copy(this.sprayRight).setY(-0.58),
        sprayWidth,
        0.68,
        sprayOpacity,
      );
      this.addEffect(
        this.alpha,
        "shallow_water_mist",
        this.effectPosition.set(0, -0.73, 1.35),
        2.6,
        0.72,
        wakeStrength * (0.05 + wetness * 0.2),
      );
    }

    if (this.impactActive) {
      this.impactAge += Math.max(0, state.delta);
      const impactLife = state.reducedMotion ? 0.12 : 0.2;
      const life = 1 - THREE.MathUtils.clamp(this.impactAge / impactLife, 0, 1);
      if (life <= 0) {
        this.impactActive = false;
      } else {
        const anchor = this.impactSide < 0
          ? this.impactLeft
          : this.impactSide > 0
            ? this.impactRight
            : this.impactNose;
        this.addEffect(
          this.additive,
          "impact_spark",
          anchor,
          1.15 + (1 - life) * 0.8,
          0.72 + (1 - life) * 0.42,
          life * this.impactStrength * 0.72,
          this.impactSide * 0.22,
        );
      }
    }

    this.finishFrame();
  }

  triggerImpact(side: number, strength: number): void {
    this.impactActive = true;
    this.impactAge = 0;
    this.impactSide = Math.sign(side);
    this.impactStrength = THREE.MathUtils.clamp(strength, 0.2, 1);
  }

  reset(): void {
    this.impactActive = false;
    this.impactAge = 0;
    this.beginFrame();
    this.finishFrame();
  }

  private createBatch(
    geometry: THREE.BufferGeometry,
    atlas: THREE.Texture,
    family: EffectFamily,
    capacity: number,
    renderOrder: number,
  ): EffectBatch {
    const mesh = new THREE.InstancedMesh(
      geometry,
      createEffectMaterial(atlas, family),
      capacity,
    );
    mesh.name = `totem_race_presence_${family}`;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.renderOrder = renderOrder;
    mesh.count = 0;
    mesh.visible = false;
    return { mesh, capacity, used: 0 };
  }

  private beginFrame(): void {
    for (const batch of this.batches) batch.used = 0;
  }

  private finishFrame(): void {
    for (const batch of this.batches) {
      batch.mesh.count = batch.used;
      batch.mesh.visible = batch.used > 0;
      if (batch.used === 0) continue;
      batch.mesh.instanceMatrix.needsUpdate = true;
      if (batch.mesh.instanceColor) batch.mesh.instanceColor.needsUpdate = true;
    }
  }

  private addEffect(
    batch: EffectBatch,
    slot: EffectSlot,
    position: THREE.Vector3,
    width: number,
    height: number,
    opacity: number,
    rotationZ = 0,
  ): void {
    const cappedOpacity = THREE.MathUtils.clamp(
      opacity,
      0,
      EFFECT_ALPHA_CAP[slot],
    );
    if (cappedOpacity <= 0.006 || batch.used >= batch.capacity) return;
    const index = batch.used;
    this.effectQuaternion.setFromAxisAngle(EFFECT_PLANE_AXIS, rotationZ);
    this.effectScale.set(width, height, 1);
    this.effectMatrix.compose(position, this.effectQuaternion, this.effectScale);
    batch.mesh.setMatrixAt(index, this.effectMatrix);
    this.effectData.setRGB(EFFECT_SLOT_INDEX[slot] / 7, cappedOpacity, 0);
    batch.mesh.setColorAt(index, this.effectData);
    batch.used += 1;
  }
}
