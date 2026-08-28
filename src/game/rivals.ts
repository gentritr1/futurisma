import * as THREE from "three";
import type { RaceCourse } from "./course";
import {
  RIVAL_FIXED_STEP_SECONDS,
  RIVAL_FINISH_RUN_OUT_SECONDS,
  RIVAL_PROFILES,
  calculateRivalBankRadians,
  calculateRaceGaps,
  chooseOvertakeOffset,
  createRivalState,
  rankRaceEntries,
  resetRivalState,
  rivalBrakeSignal,
  rivalFinishRunOutDistanceMeters,
  rivalGlowSignal,
  rivalSteerSignal,
  rivalThrottleSignal,
  stepRivalState,
} from "./rival-race.js";
import type { MinimapContact } from "./minimap";
import type {
  TotemRivalArticulationGroup,
  TotemRivalArticulationSlot,
  TotemRivalVisualBatch,
} from "./totem";
import type { FieldOrderEntry, RaceGridEntry, RaceStandingEntry } from "./ui";

const PLAYER_ID = "player";
const VEHICLE_CLEARANCE_METERS = 2.2;
const RIVAL_COUNT = RIVAL_PROFILES.length;
const RIVAL_ROLL_AXIS = new THREE.Vector3(0, 0, 1);
const DEG = Math.PI / 180;

/**
 * Authored travel for each articulated group, matching the ranges the player's
 * own vehicle uses in `TotemVehicle.updateVisual` so a rival and the player
 * read as the same machine.
 */
const ARTICULATION_TRAVEL_RADIANS: Record<TotemRivalArticulationGroup, number> = {
  hull: 0,
  steering_fins: 20 * DEG,
  airbrakes: 60 * DEG,
};

const LOCAL_ROTATION_AXES = {
  x: new THREE.Vector3(1, 0, 0),
  y: new THREE.Vector3(0, 1, 0),
  z: new THREE.Vector3(0, 0, 1),
} as const;

/**
 * The four liveries packed into the runtime atlas, in quadrant order. The three
 * rivals take the first three; `works` fills the fourth so the player's own
 * livery is already in the atlas when livery select lands.
 */
const RIVAL_LIVERY_URLS = [
  "/assets/totem/textures/totem_decals_1024_privateer.png",
  "/assets/totem/textures/totem_decals_1024_nightform.png",
  "/assets/totem/textures/totem_decals_1024_needle.png",
  "/assets/totem/textures/totem_decals_1024_works.png",
] as const;

const LIVERY_SOURCE_PIXELS = 1024;
const LIVERY_ATLAS_PIXELS = LIVERY_SOURCE_PIXELS * 2;
/**
 * Half a source texel. Clamping every vertex UV inside this inset keeps each
 * quadrant's interpolated UVs inside its own quarter of the atlas, so a livery
 * can never sample its neighbour along a seam. Clamping per vertex is enough:
 * UV interpolation is affine, so it cannot leave the clamped hull.
 */
const LIVERY_UV_INSET = 0.5 / LIVERY_SOURCE_PIXELS;

/** Quadrant origin in atlas UV space, in the same order as the URLs above. */
const LIVERY_ATLAS_OFFSETS: readonly (readonly [number, number])[] = [
  [0, 0],
  [0.5, 0],
  [0, 0.5],
  [0.5, 0.5],
];

const SHADOW_BLOB_COUNT = RIVAL_COUNT + 1;
const PLAYER_BLOB_INDEX = RIVAL_COUNT;
const SHADOW_BLOB_WIDTH_METERS = 3.1;
const SHADOW_BLOB_LENGTH_METERS = 6.1;
const SHADOW_BLOB_AFT_OFFSET_METERS = 0.28;
const SHADOW_BLOB_LIFT_METERS = 0.02;
const SHADOW_BLOB_MAX_OPACITY = 0.18;
const SHADOW_BLOB_MIN_OPACITY = 0.11;
const SHADOW_BLOB_LOW_HOVER_METERS = 0.18;
const SHADOW_BLOB_HIGH_HOVER_METERS = 0.6;
/** Nominal hover a rival is treated as holding, for blob size and weight. */
const RIVAL_NOMINAL_HOVER_METERS = 0.45;

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

function createAccelerationExhaustGeometry(): THREE.PlaneGeometry {
  const geometry = new THREE.PlaneGeometry(1, 1, 1, 1);
  const uv = geometry.getAttribute("uv") as THREE.BufferAttribute;
  for (let index = 0; index < uv.count; index += 1) {
    uv.setXY(
      index,
      0.5 + uv.getX(index) * 0.5,
      0.25 - uv.getY(index) * 0.25,
    );
  }
  uv.needsUpdate = true;
  return geometry;
}

/**
 * A flat quad in the craft's local ground plane. Two triangles; the disc shape
 * comes from a radial alpha falloff in the material, so no texture is needed.
 */
function createShadowBlobGeometry(): THREE.PlaneGeometry {
  const geometry = new THREE.PlaneGeometry(1, 1, 1, 1);
  geometry.rotateX(-Math.PI / 2);
  return geometry;
}

/**
 * The FX atlas has no radial slot to borrow — its eight cells are plumes,
 * chevrons, sprays and sparks — so the blob's falloff is generated in the
 * shader instead. Same one draw call and two triangles, and no atlas texel is
 * spent on it.
 */
function createShadowBlobMaterial(): THREE.MeshBasicMaterial {
  const material = new THREE.MeshBasicMaterial({
    color: 0x07100c,
    transparent: true,
    opacity: 1,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
    fog: true,
  });
  material.name = "TOTEM_shadow_blob";
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nvarying vec2 vBlobUv;",
      )
      .replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\n\tvBlobUv = uv;",
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        "#include <common>\nvarying vec2 vBlobUv;",
      )
      .replace(
        "#include <alphamap_fragment>",
        "#include <alphamap_fragment>\n"
          + "\tdiffuseColor.a *= 1.0 - smoothstep( 0.30, 0.5, length( vBlobUv - 0.5 ) );\n"
          + "\t#ifdef USE_COLOR\n"
          // The instance colour carries per-craft opacity, not a tint, so put
          // the material's own colour back after `color_fragment` scaled it.
          + "\t\tdiffuseColor.a *= vColor.r;\n"
          + "\t\tdiffuseColor.rgb = diffuse;\n"
          + "\t#endif",
      );
  };
  return material;
}

/**
 * Packs the four liveries into a single 2048 canvas so every rival body can be
 * drawn by one instanced mesh instead of one mesh per livery texture. Built at
 * runtime from the shipped 1024 PNGs, so no new asset enters the served set and
 * no hash contract has to be re-baselined.
 */
export async function loadRivalLiveryAtlas(): Promise<THREE.Texture> {
  const loader = new THREE.ImageLoader();
  const images = await Promise.all(
    RIVAL_LIVERY_URLS.map((url) => loader.loadAsync(url)),
  );
  const canvas = document.createElement("canvas");
  canvas.width = LIVERY_ATLAS_PIXELS;
  canvas.height = LIVERY_ATLAS_PIXELS;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Rival livery atlas requires a 2D canvas context.");
  context.imageSmoothingEnabled = false;
  for (let index = 0; index < images.length; index += 1) {
    const [offsetU, offsetV] = LIVERY_ATLAS_OFFSETS[index];
    context.drawImage(
      images[index],
      offsetU * LIVERY_ATLAS_PIXELS,
      offsetV * LIVERY_ATLAS_PIXELS,
      LIVERY_SOURCE_PIXELS,
      LIVERY_SOURCE_PIXELS,
    );
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.name = "totem_liveries_2048_runtime";
  // Identical treatment to the per-rival textures this replaces, so the atlas
  // cannot change how a livery reads at any distance.
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.flipY = false;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestMipmapLinearFilter;
  texture.anisotropy = 1;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

export interface RivalRaceStatus {
  position: number;
  racerCount: number;
  gapToAheadMs: number | null;
  gapToBehindMs: number | null;
}

export interface RivalFleetDiagnostics {
  drawCalls: number;
  triangles: number;
  updateSteps: number;
  minimumSeparationMeters: number;
  catchUpMultiplier: number;
  articulatedGroups: string[];
  maximumSteerRadians: number;
  articulation: Array<{
    id: string;
    steerRadians: number;
    brakeRadians: number;
  }>;
  states: Array<{
    id: string;
    name: string;
    lap: number;
    raceDistanceMeters: number;
    speedKph: number;
    lateralMeters: number;
    finishTimeMs: number | null;
    recoveries: number;
  }>;
}

type RivalState = ReturnType<typeof createRivalState>;

interface RivalVisual {
  mesh: THREE.InstancedMesh;
  group: TotemRivalArticulationGroup;
  slots: readonly TotemRivalArticulationSlot[];
}

export class RivalFleet {
  readonly root = new THREE.Group();
  readonly gridEntries: readonly RaceGridEntry[];
  private readonly states: RivalState[];
  private readonly previousDistances = new Float64Array(RIVAL_COUNT);
  private readonly previousLaterals = new Float32Array(RIVAL_COUNT);
  private readonly steerSignals = new Float32Array(RIVAL_COUNT);
  private readonly brakeSignals = new Float32Array(RIVAL_COUNT);
  private readonly throttleSignals = new Float32Array(RIVAL_COUNT);
  private readonly glowSignals = new Float32Array(RIVAL_COUNT);
  private readonly visuals: RivalVisual[] = [];
  private readonly engineGlow: THREE.InstancedMesh;
  private readonly shadowBlobs: THREE.InstancedMesh;
  private readonly sample;
  private readonly poseMatrix = new THREE.Matrix4();
  private readonly slotMatrix = new THREE.Matrix4();
  private readonly articulationMatrix = new THREE.Matrix4();
  private readonly poseQuaternion = new THREE.Quaternion();
  private readonly bankQuaternion = new THREE.Quaternion();
  private readonly posePosition = new THREE.Vector3();
  private readonly poseScale = new THREE.Vector3(1, 1, 1);
  private readonly backward = new THREE.Vector3();
  private readonly blobPosition = new THREE.Vector3();
  private readonly blobScale = new THREE.Vector3();
  private readonly blobBasis = new THREE.Matrix4();
  private readonly blobQuaternion = new THREE.Quaternion();
  private readonly blobMatrix = new THREE.Matrix4();
  private readonly blobColor = new THREE.Color();
  private readonly glowScale = new THREE.Vector3();
  private readonly glowColor = new THREE.Color();
  private readonly glowTints: THREE.Color[];
  private readonly engineLocalMatrix = new THREE.Matrix4();
  private readonly engineScaledMatrix = new THREE.Matrix4();
  private readonly engineWorldMatrix = new THREE.Matrix4();
  private readonly finishVisualAges = new Float32Array(RIVAL_COUNT);
  private readonly finishRunOutSpeeds = new Float32Array(RIVAL_COUNT);
  private readonly worldPositions: THREE.Vector3[];
  private readonly worldVelocities: THREE.Vector3[];
  private readonly articulatedGroups: string[] = [];
  private updateSteps = 0;
  private minimumSeparationMeters = Infinity;
  private maximumSteerRadians = 0;

  readonly stats: {
    drawCalls: number;
    triangles: number;
  };

  /**
   * Assemble a fleet from the loaded vehicle: builds the rival visual batches,
   * loads the livery atlas, and owns cleanup when the game is disposed while
   * the atlas is still in flight. Returns null when disposed mid-assembly.
   */
  static async create(
    course: RaceCourse,
    totalLaps: number,
    vehicle: {
      createRivalVisualBatches(): TotemRivalVisualBatch[];
      effectsAtlas(): THREE.Texture;
    },
    isDisposed: () => boolean,
  ): Promise<RivalFleet | null> {
    const visualBatches = vehicle.createRivalVisualBatches();
    const disposeBatches = (): void => {
      for (const batch of visualBatches) {
        batch.geometry.dispose();
        batch.material.dispose();
      }
    };
    let liveryAtlas: THREE.Texture;
    try {
      liveryAtlas = await loadRivalLiveryAtlas();
    } catch (error) {
      disposeBatches();
      throw error;
    }
    if (isDisposed()) {
      disposeBatches();
      liveryAtlas.dispose();
      return null;
    }
    return new RivalFleet(course, totalLaps, visualBatches, liveryAtlas, vehicle.effectsAtlas());
  }

  constructor(
    private readonly course: RaceCourse,
    private readonly totalLaps: number,
    visualBatches: readonly TotemRivalVisualBatch[],
    liveryAtlas: THREE.Texture,
    effectsAtlas: THREE.Texture,
  ) {
    if (visualBatches.length < 3) {
      throw new Error(
        `Rival fleet requires at least three TOTEM batches; received ${visualBatches.length}.`,
      );
    }
    this.root.name = "totem_rival_fleet";
    this.states = RIVAL_PROFILES.map((profile) => (
      createRivalState(profile.id, course.length, totalLaps)
    ));
    this.sample = course.createSampleScratch();
    this.worldPositions = RIVAL_PROFILES.map(() => new THREE.Vector3());
    this.worldVelocities = RIVAL_PROFILES.map(() => new THREE.Vector3());
    this.glowTints = RIVAL_PROFILES.map(
      (profile) => new THREE.Color(profile.engineTint),
    );

    for (const batch of visualBatches) {
      const slotCount = batch.slots.length;
      const instanceCount = RIVAL_COUNT * slotCount;
      const mesh = new THREE.InstancedMesh(
        batch.geometry,
        batch.material,
        instanceCount,
      );
      mesh.name = `rival_${batch.role.toLowerCase()}_${batch.group}`;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.frustumCulled = false;
      if (batch.role === "TOTEM_body") {
        // One atlas, one material, one draw call: the livery a body instance
        // wears is chosen by its quadrant offset rather than by its texture.
        const material = batch.material;
        if (!(material instanceof THREE.MeshStandardMaterial)) {
          throw new Error("TOTEM body rival batch requires a standard material.");
        }
        if (material.map !== liveryAtlas) {
          material.map = liveryAtlas;
          material.color.set(0xffffff);
          material.onBeforeCompile = (shader) => {
            shader.vertexShader = shader.vertexShader
              .replace(
                "#include <common>",
                "#include <common>\nattribute vec2 aLiveryOffset;",
              )
              .replace(
                "#include <uv_vertex>",
                "#include <uv_vertex>\n"
                  + "\t#ifdef USE_MAP\n"
                  + `\t\tvMapUv = clamp( vMapUv, ${LIVERY_UV_INSET.toFixed(10)}, `
                  + `${(1 - LIVERY_UV_INSET).toFixed(10)} ) * 0.5 + aLiveryOffset;\n`
                  + "\t#endif",
              );
          };
          material.needsUpdate = true;
        }
        const offsets = new Float32Array(instanceCount * 2);
        for (let index = 0; index < instanceCount; index += 1) {
          const [offsetU, offsetV] = LIVERY_ATLAS_OFFSETS[Math.floor(index / slotCount)];
          offsets[index * 2] = offsetU;
          offsets[index * 2 + 1] = offsetV;
          // Restores the authored mean brightness of the side this instance
          // stands for, since both sides share one baked vertex-shading buffer.
          mesh.setColorAt(
            index,
            this.blobColor.setScalar(batch.slots[index % slotCount].shadingScale),
          );
        }
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        batch.geometry.setAttribute(
          "aLiveryOffset",
          new THREE.InstancedBufferAttribute(offsets, 2),
        );
      } else {
        for (let index = 0; index < instanceCount; index += 1) {
          const tint = new THREE.Color(RIVAL_PROFILES[Math.floor(index / slotCount)].tint);
          if (batch.role === "TOTEM_glass") tint.lerp(new THREE.Color(0x99afb0), 0.55);
          mesh.setColorAt(index, tint);
        }
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      }
      if (batch.group !== "hull") this.articulatedGroups.push(batch.group);
      this.visuals.push({ mesh, group: batch.group, slots: batch.slots });
      this.root.add(mesh);
    }

    const glowGeometry = createAccelerationExhaustGeometry();
    const glowMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      map: effectsAtlas,
      transparent: true,
      opacity: 0.52,
      depthWrite: false,
      blending: THREE.NormalBlending,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    this.engineGlow = new THREE.InstancedMesh(
      glowGeometry,
      glowMaterial,
      RIVAL_COUNT,
    );
    this.engineGlow.name = "rival_engine_glow";
    this.engineGlow.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.engineGlow.frustumCulled = false;
    for (let index = 0; index < RIVAL_COUNT; index += 1) {
      this.engineGlow.setColorAt(index, this.glowTints[index]);
    }
    if (this.engineGlow.instanceColor) {
      this.engineGlow.instanceColor.needsUpdate = true;
    }
    this.root.add(this.engineGlow);
    this.engineLocalMatrix.compose(
      new THREE.Vector3(0, 0.15, 3.05),
      new THREE.Quaternion(),
      new THREE.Vector3(1.35, 0.9, 1),
    );

    const blobGeometry = createShadowBlobGeometry();
    this.shadowBlobs = new THREE.InstancedMesh(
      blobGeometry,
      createShadowBlobMaterial(),
      SHADOW_BLOB_COUNT,
    );
    this.shadowBlobs.name = "totem_shadow_blobs";
    this.shadowBlobs.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.shadowBlobs.frustumCulled = false;
    this.shadowBlobs.renderOrder = 1;
    // Every blob starts collapsed. The rivals are filled in by the reset below;
    // the player's slot stays hidden until the first pose update places it,
    // so an untouched identity matrix can never leave a blob at the origin.
    this.blobMatrix.compose(
      this.blobPosition.set(0, 0, 0),
      this.blobQuaternion.identity(),
      this.blobScale.setScalar(0.00001),
    );
    for (let index = 0; index < SHADOW_BLOB_COUNT; index += 1) {
      this.shadowBlobs.setMatrixAt(index, this.blobMatrix);
      this.shadowBlobs.setColorAt(index, this.blobColor.setScalar(1));
    }
    this.shadowBlobs.instanceMatrix.needsUpdate = true;
    if (this.shadowBlobs.instanceColor) {
      this.shadowBlobs.instanceColor.needsUpdate = true;
    }
    this.root.add(this.shadowBlobs);

    const visualTriangles = visualBatches.reduce(
      (total, batch) => total + batch.triangles * RIVAL_COUNT * batch.slots.length,
      0,
    );
    const perInstanceTriangles = (geometry: THREE.BufferGeometry) => (
      (geometry.index?.count ?? geometry.getAttribute("position").count) / 3
    );
    this.stats = {
      drawCalls: this.visuals.length + 2,
      triangles: visualTriangles
        + perInstanceTriangles(glowGeometry) * RIVAL_COUNT
        + perInstanceTriangles(blobGeometry) * SHADOW_BLOB_COUNT,
    };
    this.gridEntries = [
      { position: 1, name: "TOTEM", team: "WORKS 07", player: true },
      ...RIVAL_PROFILES.map((profile, index) => ({
        position: index + 2,
        name: profile.name,
        team: "FIELD TOTEM",
        player: false,
      })),
    ];
    this.reset();
  }

  reset(): void {
    this.states.forEach((state, index) => {
      resetRivalState(state, this.course.length, this.totalLaps);
      const gridStart = this.course.rivalGridStart(RIVAL_PROFILES[index].name);
      if (gridStart) {
        state.raceDistanceMeters = gridStart.raceDistanceMeters;
        state.courseDistanceMeters = gridStart.courseDistanceMeters;
        state.lateralMeters = gridStart.lateralMeters;
        state.lastSafeDistanceMeters = gridStart.raceDistanceMeters;
        state.lastSafeLateralMeters = gridStart.lateralMeters;
      }
      this.previousDistances[index] = state.raceDistanceMeters;
      this.previousLaterals[index] = state.lateralMeters;
      this.finishVisualAges[index] = 0;
      this.finishRunOutSpeeds[index] = 0;
      this.steerSignals[index] = 0;
      this.brakeSignals[index] = 0;
      this.throttleSignals[index] = 0;
      this.glowSignals[index] = 0;
    });
    this.updateSteps = 0;
    this.minimumSeparationMeters = Infinity;
    this.maximumSteerRadians = 0;
    this.updatePresentation(1, 0);
  }

  step(
    deltaSeconds: number,
    playerRaceDistanceMeters: number,
    playerLateralMeters: number,
  ): void {
    for (let index = 0; index < this.states.length; index += 1) {
      const state = this.states[index];
      const profile = RIVAL_PROFILES[index];
      this.previousDistances[index] = state.raceDistanceMeters;
      this.previousLaterals[index] = state.lateralMeters;
      const wasFinished = state.finished;
      const crossingSpeed = state.speedMetersPerSecond;
      if (wasFinished) {
        this.finishVisualAges[index] += Math.max(0, deltaSeconds);
        // A finished rival coasts with its control surfaces neutral.
        this.steerSignals[index] = 0;
        this.brakeSignals[index] = 0;
        this.throttleSignals[index] = 0;
        this.glowSignals[index] = 0;
        continue;
      }
      this.course.sample(state.courseDistanceMeters / this.course.length, this.sample);
      const laneHalfWidth = Math.max(
        0,
        this.sample.halfWidth - VEHICLE_CLEARANCE_METERS,
      );
      let targetLateral = profile.startingLateralMeters
        + Math.sin(
          state.raceDistanceMeters / 210 + profile.pacePhaseRadians,
        ) * 0.75
        - this.sample.curvature * 1.4;
      if (
        Math.abs(state.raceDistanceMeters - playerRaceDistanceMeters) < 12
        && Math.abs(state.lateralMeters - playerLateralMeters) < 2.8
      ) {
        targetLateral = chooseOvertakeOffset(
          state.id,
          PLAYER_ID,
          profile.startingLateralMeters,
        );
      }
      for (let otherIndex = 0; otherIndex < this.states.length; otherIndex += 1) {
        if (otherIndex === index) continue;
        const other = this.states[otherIndex];
        if (
          Math.abs(state.raceDistanceMeters - other.raceDistanceMeters) < 10
          && Math.abs(state.lateralMeters - other.lateralMeters) < 2.6
        ) {
          targetLateral = chooseOvertakeOffset(
            state.id,
            other.id,
            profile.startingLateralMeters,
          );
          break;
        }
      }
      const courseSpeedFactor = THREE.MathUtils.clamp(
        1 - Math.abs(this.sample.curvature) * 0.2,
        0.79,
        1,
      );
      const poseInput = {
        targetLateralMeters: targetLateral,
        laneHalfWidthMeters: laneHalfWidth,
        courseSpeedFactor,
        curvature: this.sample.curvature,
      };
      // Read the pose before stepping: the signals describe what the rival is
      // about to do with the state the step is about to consume, and they are
      // derived from that state alone rather than from any frame delta.
      const steer = rivalSteerSignal(state, poseInput);
      this.steerSignals[index] = steer;
      this.brakeSignals[index] = rivalBrakeSignal(state, poseInput);
      this.throttleSignals[index] = rivalThrottleSignal(state, poseInput);
      this.glowSignals[index] = rivalGlowSignal(state, poseInput);
      this.maximumSteerRadians = Math.max(
        this.maximumSteerRadians,
        Math.abs(steer) * ARTICULATION_TRAVEL_RADIANS.steering_fins,
      );
      stepRivalState(state, {
        deltaSeconds,
        targetLateralMeters: targetLateral,
        laneHalfWidthMeters: laneHalfWidth,
        courseSpeedFactor,
      });
      if (state.finished) {
        this.finishVisualAges[index] = 0;
        this.finishRunOutSpeeds[index] = crossingSpeed;
      }
    }
    this.updateSteps += 1;
    this.measureSeparation(playerRaceDistanceMeters, playerLateralMeters);
  }

  updatePresentation(alpha: number, elapsedSeconds: number): void {
    const interpolation = THREE.MathUtils.clamp(alpha, 0, 1);
    for (let index = 0; index < this.states.length; index += 1) {
      const state = this.states[index];
      let distance = THREE.MathUtils.lerp(
        this.previousDistances[index],
        state.raceDistanceMeters,
        interpolation,
      );
      const lateral = THREE.MathUtils.lerp(
        this.previousLaterals[index],
        state.lateralMeters,
        interpolation,
      );
      const finishVisualAge = this.finishVisualAges[index];
      if (state.finished) {
        distance = state.raceDistanceMeters + rivalFinishRunOutDistanceMeters(
          finishVisualAge,
          this.finishRunOutSpeeds[index],
        );
      }
      const visible = !state.finished
        || finishVisualAge < RIVAL_FINISH_RUN_OUT_SECONDS;
      this.course.sample(distance / this.course.length, this.sample);
      const bob = Math.sin(elapsedSeconds * 4.1 + index * 1.7) * 0.035;
      this.posePosition.copy(this.sample.position)
        .addScaledVector(this.sample.right, lateral)
        .addScaledVector(this.sample.up, 0.82 + bob);
      this.backward.copy(this.sample.tangent).multiplyScalar(-1);
      this.poseMatrix.makeBasis(this.sample.right, this.sample.up, this.backward);
      this.poseQuaternion.setFromRotationMatrix(this.poseMatrix);
      const bank = calculateRivalBankRadians(
        this.previousLaterals[index],
        state.lateralMeters,
        this.sample.curvature,
      );
      this.bankQuaternion.setFromAxisAngle(RIVAL_ROLL_AXIS, bank);
      this.poseQuaternion.multiply(this.bankQuaternion);
      this.poseScale.setScalar(visible ? 1 : 0.00001);
      this.poseMatrix.compose(this.posePosition, this.poseQuaternion, this.poseScale);

      this.worldPositions[index].copy(this.posePosition);
      this.worldVelocities[index]
        .copy(this.sample.tangent)
        .multiplyScalar(state.speedMetersPerSecond)
        .addScaledVector(
          this.sample.right,
          this.steerSignals[index] * RIVAL_PROFILES[index].lateralSpeedMetersPerSecond,
        );

      for (const visual of this.visuals) {
        const travel = ARTICULATION_TRAVEL_RADIANS[visual.group];
        const angle = visual.group === "steering_fins"
          ? this.steerSignals[index] * travel
          : visual.group === "airbrakes"
            ? this.brakeSignals[index] * travel
            : 0;
        for (let slot = 0; slot < visual.slots.length; slot += 1) {
          const instance = index * visual.slots.length + slot;
          if (visual.group === "hull") {
            visual.mesh.setMatrixAt(instance, this.poseMatrix);
            continue;
          }
          const definition = visual.slots[slot];
          // pose * pivot * rotation(axis, angle) — the same composition the
          // player's hierarchy performs in `TotemVehicle.setRotation`, with the
          // pivot's neutral transform reapplied here because the batch geometry
          // was baked pivot-local so both sides could share it.
          this.articulationMatrix.makeRotationAxis(
            LOCAL_ROTATION_AXES[definition.axis],
            angle,
          );
          this.slotMatrix
            .multiplyMatrices(this.poseMatrix, definition.pivotMatrix)
            .multiply(this.articulationMatrix);
          visual.mesh.setMatrixAt(instance, this.slotMatrix);
        }
      }

      const glow = this.glowSignals[index];
      this.engineScaledMatrix.copy(this.engineLocalMatrix).scale(
        this.glowScale.setScalar(0.78 + glow * 0.44),
      );
      this.engineWorldMatrix.multiplyMatrices(
        this.poseMatrix,
        this.engineScaledMatrix,
      );
      this.engineGlow.setMatrixAt(index, this.engineWorldMatrix);
      this.engineGlow.setColorAt(
        index,
        this.glowColor
          .copy(this.glowTints[index])
          .multiplyScalar(0.5)
          .lerp(this.glowTints[index], glow),
      );

      this.composeShadowBlob(
        index,
        this.sample.position,
        this.sample.right,
        this.sample.up,
        this.backward,
        lateral,
        RIVAL_NOMINAL_HOVER_METERS + bob,
        visible,
      );
    }
    for (const visual of this.visuals) {
      visual.mesh.instanceMatrix.needsUpdate = true;
    }
    this.engineGlow.instanceMatrix.needsUpdate = true;
    if (this.engineGlow.instanceColor) this.engineGlow.instanceColor.needsUpdate = true;
    this.shadowBlobs.instanceMatrix.needsUpdate = true;
    if (this.shadowBlobs.instanceColor) this.shadowBlobs.instanceColor.needsUpdate = true;
  }

  /**
   * Places the player's ground blob in the shared instanced mesh. Called from
   * the pose update, which is where the player's on-surface point and basis are
   * already computed.
   */
  setPlayerShadow(
    surfacePosition: THREE.Vector3,
    right: THREE.Vector3,
    up: THREE.Vector3,
    backward: THREE.Vector3,
    hoverMeters: number,
    visible = true,
  ): void {
    this.composeShadowBlob(
      PLAYER_BLOB_INDEX,
      surfacePosition,
      right,
      up,
      backward,
      0,
      hoverMeters,
      visible,
    );
    this.shadowBlobs.instanceMatrix.needsUpdate = true;
    if (this.shadowBlobs.instanceColor) this.shadowBlobs.instanceColor.needsUpdate = true;
  }

  /** Live world position of a rival, for the spatial-audio phase. */
  worldPosition(index: number, target: THREE.Vector3): THREE.Vector3 {
    const source = this.worldPositions[index];
    if (!source) return target.set(0, 0, 0);
    return target.copy(source);
  }

  /**
   * Live world velocity of a rival, for the spatial-audio phase. Derived from
   * the authored speed and the pure steer signal, never from a frame delta.
   */
  worldVelocity(index: number, target: THREE.Vector3): THREE.Vector3 {
    const source = this.worldVelocities[index];
    if (!source) return target.set(0, 0, 0);
    return target.copy(source);
  }

  raceStatus(
    playerRaceDistanceMeters: number,
    playerSpeedMetersPerSecond: number,
    playerFinished = false,
    playerFinishTimeSeconds: number | null = null,
  ): RivalRaceStatus {
    const gaps = calculateRaceGaps([
      {
        id: PLAYER_ID,
        raceDistanceMeters: playerRaceDistanceMeters,
        speedMetersPerSecond: playerSpeedMetersPerSecond,
        finished: playerFinished,
        finishTimeSeconds: playerFinishTimeSeconds,
      },
      ...this.states,
    ], PLAYER_ID);
    return {
      position: gaps.position,
      racerCount: gaps.racerCount,
      gapToAheadMs: gaps.gapToAheadMs,
      gapToBehindMs: gaps.gapToBehindMs,
    };
  }

  /**
   * Zero-allocation spatial read for the P6 minimap radar: fills `out` in
   * place with each rival's live race distance and lane offset and returns how
   * many slots were written. Read-only by construction — the radar cannot
   * perturb the field it is drawing.
   */
  readRadarContacts(out: MinimapContact[]): number {
    const count = Math.min(out.length, this.states.length);
    for (let index = 0; index < count; index += 1) {
      const state = this.states[index];
      const slot = out[index];
      slot.raceDistanceMeters = state.raceDistanceMeters;
      slot.lateralMeters = state.lateralMeters;
    }
    return count;
  }

  /** Live field ranking for the HUD position ladder. */
  fieldOrder(
    playerRaceDistanceMeters: number,
    playerSpeedMetersPerSecond: number,
  ): FieldOrderEntry[] {
    const { ordered } = calculateRaceGaps([
      {
        id: PLAYER_ID,
        raceDistanceMeters: playerRaceDistanceMeters,
        speedMetersPerSecond: playerSpeedMetersPerSecond,
        finished: false,
        finishTimeSeconds: null,
      },
      ...this.states,
    ], PLAYER_ID);
    return ordered.map((entry, index) => ({
      position: index + 1,
      name: entry.id === PLAYER_ID
        ? "TOTEM"
        : RIVAL_PROFILES.find((profile) => profile.id === entry.id)?.name ?? entry.id,
      player: entry.id === PLAYER_ID,
    }));
  }

  classification(playerFinishTimeSeconds: number): RaceStandingEntry[] {    const totalDistance = this.course.length * this.totalLaps;
    const entries = [
      {
        id: PLAYER_ID,
        name: "TOTEM",
        team: "WORKS 07",
        player: true,
        raceDistanceMeters: totalDistance,
        finished: true,
        finishTimeSeconds: playerFinishTimeSeconds,
      },
      ...this.states.map((state, index) => {
        const profile = RIVAL_PROFILES[index];
        const projectedFinish = this.projectFinishTime(state, index);
        return {
          id: state.id,
          name: profile.name,
          team: "FIELD TOTEM",
          player: false,
          raceDistanceMeters: totalDistance,
          finished: true,
          finishTimeSeconds: projectedFinish,
        };
      }),
    ];
    const ordered = rankRaceEntries(entries);
    const winnerTime = ordered[0].finishTimeSeconds ?? playerFinishTimeSeconds;
    return ordered.map((entry, index) => ({
      position: index + 1,
      name: entry.name,
      team: entry.team,
      player: entry.player,
      finishTimeMs: (entry.finishTimeSeconds ?? playerFinishTimeSeconds) * 1000,
      gapMs: Math.max(
        0,
        ((entry.finishTimeSeconds ?? playerFinishTimeSeconds) - winnerTime) * 1000,
      ),
    }));
  }

  diagnostics(): RivalFleetDiagnostics {
    return {
      drawCalls: this.stats.drawCalls,
      triangles: this.stats.triangles,
      updateSteps: this.updateSteps,
      minimumSeparationMeters: Number.isFinite(this.minimumSeparationMeters)
        ? this.minimumSeparationMeters
        : 0,
      catchUpMultiplier: 1,
      articulatedGroups: [...this.articulatedGroups],
      maximumSteerRadians: this.maximumSteerRadians,
      articulation: this.states.map((state, index) => ({
        id: state.id,
        steerRadians: this.steerSignals[index]
          * ARTICULATION_TRAVEL_RADIANS.steering_fins,
        brakeRadians: this.brakeSignals[index]
          * ARTICULATION_TRAVEL_RADIANS.airbrakes,
      })),
      states: this.states.map((state, index) => ({
        id: state.id,
        name: RIVAL_PROFILES[index].name,
        lap: state.lap,
        raceDistanceMeters: state.raceDistanceMeters,
        speedKph: state.speedMetersPerSecond * 3.6,
        lateralMeters: state.lateralMeters,
        finishTimeMs: state.finishTimeSeconds === null
          ? null
          : state.finishTimeSeconds * 1000,
        recoveries: state.recoveryCount,
      })),
    };
  }

  private composeShadowBlob(
    instance: number,
    surfacePosition: THREE.Vector3,
    right: THREE.Vector3,
    up: THREE.Vector3,
    backward: THREE.Vector3,
    lateralMeters: number,
    hoverMeters: number,
    visible: boolean,
  ): void {
    const hover = clamp01(
      (hoverMeters - SHADOW_BLOB_LOW_HOVER_METERS)
        / (SHADOW_BLOB_HIGH_HOVER_METERS - SHADOW_BLOB_LOW_HOVER_METERS),
    );
    const spread = 1 + hover * 0.18;
    this.blobPosition.copy(surfacePosition)
      .addScaledVector(right, lateralMeters)
      .addScaledVector(up, SHADOW_BLOB_LIFT_METERS)
      .addScaledVector(backward, SHADOW_BLOB_AFT_OFFSET_METERS);
    this.blobBasis.makeBasis(right, up, backward);
    this.blobQuaternion.setFromRotationMatrix(this.blobBasis);
    this.blobScale.set(
      visible ? SHADOW_BLOB_WIDTH_METERS * spread : 0.00001,
      1,
      visible ? SHADOW_BLOB_LENGTH_METERS * spread : 0.00001,
    );
    this.blobMatrix.compose(this.blobPosition, this.blobQuaternion, this.blobScale);
    this.shadowBlobs.setMatrixAt(instance, this.blobMatrix);
    this.shadowBlobs.setColorAt(
      instance,
      this.blobColor.setScalar(
        SHADOW_BLOB_MAX_OPACITY
          - hover * (SHADOW_BLOB_MAX_OPACITY - SHADOW_BLOB_MIN_OPACITY),
      ),
    );
  }

  private projectFinishTime(state: RivalState, profileIndex: number): number {
    if (state.finishTimeSeconds !== null) return state.finishTimeSeconds;
    const projected: RivalState = {
      ...state,
      lapTimesSeconds: [...state.lapTimesSeconds],
    };
    const profile = RIVAL_PROFILES[profileIndex];
    const sample = this.course.createSampleScratch();
    const maximumSteps = Math.ceil(this.totalLaps * this.course.length / 20
      / RIVAL_FIXED_STEP_SECONDS);
    for (let step = 0; step < maximumSteps && !projected.finished; step += 1) {
      this.course.sample(projected.courseDistanceMeters / this.course.length, sample);
      const laneHalfWidth = Math.max(0, sample.halfWidth - VEHICLE_CLEARANCE_METERS);
      const targetLateral = THREE.MathUtils.clamp(
        profile.startingLateralMeters
          + Math.sin(
            projected.raceDistanceMeters / 210 + profile.pacePhaseRadians,
          ) * 0.75
          - sample.curvature * 1.4,
        -laneHalfWidth,
        laneHalfWidth,
      );
      stepRivalState(projected, {
        deltaSeconds: RIVAL_FIXED_STEP_SECONDS,
        targetLateralMeters: targetLateral,
        laneHalfWidthMeters: laneHalfWidth,
        courseSpeedFactor: THREE.MathUtils.clamp(
          1 - Math.abs(sample.curvature) * 0.2,
          0.79,
          1,
        ),
      });
    }
    if (projected.finishTimeSeconds === null) {
      throw new Error(`Rival ${state.id} did not reach its projected finish.`);
    }
    return projected.finishTimeSeconds;
  }

  private measureSeparation(
    playerRaceDistanceMeters: number,
    playerLateralMeters: number,
  ): void {
    for (let index = 0; index < this.states.length; index += 1) {
      const state = this.states[index];
      this.minimumSeparationMeters = Math.min(
        this.minimumSeparationMeters,
        Math.hypot(
          state.raceDistanceMeters - playerRaceDistanceMeters,
          state.lateralMeters - playerLateralMeters,
        ),
      );
      for (let otherIndex = index + 1; otherIndex < this.states.length; otherIndex += 1) {
        const other = this.states[otherIndex];
        this.minimumSeparationMeters = Math.min(
          this.minimumSeparationMeters,
          Math.hypot(
            state.raceDistanceMeters - other.raceDistanceMeters,
            state.lateralMeters - other.lateralMeters,
          ),
        );
      }
    }
  }
}
