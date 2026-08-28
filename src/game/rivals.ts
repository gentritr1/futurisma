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
  rivalFinishRunOutDistanceMeters,
  stepRivalState,
} from "./rival-race.js";
import type { TotemRivalVisualBatch } from "./totem";
import type { FieldOrderEntry, RaceGridEntry, RaceStandingEntry } from "./ui";

const PLAYER_ID = "player";
const VEHICLE_CLEARANCE_METERS = 2.2;
const RIVAL_COUNT = RIVAL_PROFILES.length;
const RIVAL_ROLL_AXIS = new THREE.Vector3(0, 0, 1);
const RIVAL_LIVERY_URLS = [
  "/assets/totem/textures/totem_decals_1024_privateer.png",
  "/assets/totem/textures/totem_decals_1024_nightform.png",
  "/assets/totem/textures/totem_decals_1024_needle.png",
] as const;

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

type RivalState = ReturnType<typeof createRivalState>;

export async function loadRivalLiveryTextures(): Promise<THREE.Texture[]> {
  const loader = new THREE.TextureLoader();
  const results = await Promise.allSettled(
    RIVAL_LIVERY_URLS.map((url) => loader.loadAsync(url)),
  );
  const textures: THREE.Texture[] = [];
  let firstFailure: unknown = null;
  for (const result of results) {
    if (result.status === "fulfilled") {
      textures.push(result.value);
    } else if (firstFailure === null) {
      firstFailure = result.reason;
    }
  }
  if (firstFailure !== null) {
    for (const texture of textures) texture.dispose();
    throw firstFailure;
  }
  for (const texture of textures) {
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.flipY = false;
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestMipmapLinearFilter;
    texture.anisotropy = 1;
    texture.needsUpdate = true;
  }
  return textures;
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

export class RivalFleet {
  readonly root = new THREE.Group();
  readonly gridEntries: readonly RaceGridEntry[];
  private readonly states: RivalState[];
  private readonly previousDistances = new Float64Array(RIVAL_COUNT);
  private readonly previousLaterals = new Float32Array(RIVAL_COUNT);
  private readonly visualMeshes: Array<{
    mesh: THREE.InstancedMesh;
    rivalIndex: number | null;
  }> = [];
  private readonly engineGlow: THREE.InstancedMesh;
  private readonly sample;
  private readonly poseMatrix = new THREE.Matrix4();
  private readonly poseQuaternion = new THREE.Quaternion();
  private readonly bankQuaternion = new THREE.Quaternion();
  private readonly posePosition = new THREE.Vector3();
  private readonly poseScale = new THREE.Vector3(1, 1, 1);
  private readonly backward = new THREE.Vector3();
  private readonly engineLocalMatrix = new THREE.Matrix4();
  private readonly engineWorldMatrix = new THREE.Matrix4();
  private readonly finishVisualAges = new Float32Array(RIVAL_COUNT);
  private readonly finishRunOutSpeeds = new Float32Array(RIVAL_COUNT);
  private updateSteps = 0;
  private minimumSeparationMeters = Infinity;

  readonly stats: {
    drawCalls: number;
    triangles: number;
  };

  constructor(
    private readonly course: RaceCourse,
    private readonly totalLaps: number,
    visualBatches: readonly TotemRivalVisualBatch[],
    liveryTextures: readonly THREE.Texture[],
    effectsAtlas: THREE.Texture,
  ) {
    if (visualBatches.length !== 3) {
      throw new Error(`Rival fleet requires three TOTEM batches; received ${visualBatches.length}.`);
    }
    this.root.name = "totem_rival_fleet";
    this.states = RIVAL_PROFILES.map((profile) => (
      createRivalState(profile.id, course.length, totalLaps)
    ));
    this.sample = course.createSampleScratch();

    if (liveryTextures.length !== RIVAL_COUNT) {
      throw new Error(
        `Rival fleet requires ${RIVAL_COUNT} livery textures; received ${liveryTextures.length}.`,
      );
    }

    for (const batch of visualBatches) {
      if (batch.role === "TOTEM_body") {
        for (let index = 0; index < RIVAL_COUNT; index += 1) {
          const material = index === 0 ? batch.material : batch.material.clone();
          if (!(material instanceof THREE.MeshStandardMaterial)) {
            throw new Error("TOTEM body rival batch requires a standard material.");
          }
          material.map = liveryTextures[index];
          material.color.set(0xffffff);
          material.needsUpdate = true;
          const mesh = new THREE.InstancedMesh(batch.geometry, material, 1);
          mesh.name = `rival_body_${RIVAL_PROFILES[index].id}`;
          mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
          mesh.castShadow = false;
          mesh.receiveShadow = false;
          mesh.frustumCulled = false;
          this.visualMeshes.push({ mesh, rivalIndex: index });
          this.root.add(mesh);
        }
        continue;
      }
      const mesh = new THREE.InstancedMesh(
        batch.geometry,
        batch.material,
        RIVAL_COUNT,
      );
      mesh.name = `rival_batch_${batch.role.toLowerCase()}`;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.frustumCulled = false;
      for (let index = 0; index < RIVAL_COUNT; index += 1) {
        const tint = new THREE.Color(RIVAL_PROFILES[index].tint);
        if (batch.role === "TOTEM_glass") tint.lerp(new THREE.Color(0x99afb0), 0.55);
        mesh.setColorAt(index, tint);
      }
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      this.visualMeshes.push({ mesh, rivalIndex: null });
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
      this.engineGlow.setColorAt(
        index,
        new THREE.Color(RIVAL_PROFILES[index].engineTint),
      );
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

    const visualTriangles = visualBatches.reduce(
      (total, batch) => total + batch.triangles * RIVAL_COUNT,
      0,
    );
    const glowTriangles = (
      glowGeometry.index?.count ?? glowGeometry.getAttribute("position").count
    ) / 3 * RIVAL_COUNT;
    this.stats = {
      drawCalls: this.visualMeshes.length + 1,
      triangles: visualTriangles + glowTriangles,
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
    });
    this.updateSteps = 0;
    this.minimumSeparationMeters = Infinity;
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
      this.posePosition.copy(this.sample.position)
        .addScaledVector(this.sample.right, lateral)
        .addScaledVector(
          this.sample.up,
          0.82 + Math.sin(elapsedSeconds * 4.1 + index * 1.7) * 0.035,
        );
      this.poseMatrix.makeBasis(
        this.sample.right,
        this.sample.up,
        this.backward.copy(this.sample.tangent).multiplyScalar(-1),
      );
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
      for (const visual of this.visualMeshes) {
        if (visual.rivalIndex === null) {
          visual.mesh.setMatrixAt(index, this.poseMatrix);
        } else if (visual.rivalIndex === index) {
          visual.mesh.setMatrixAt(0, this.poseMatrix);
        }
      }
      this.engineWorldMatrix.multiplyMatrices(this.poseMatrix, this.engineLocalMatrix);
      this.engineGlow.setMatrixAt(index, this.engineWorldMatrix);
    }
    for (const visual of this.visualMeshes) {
      visual.mesh.instanceMatrix.needsUpdate = true;
    }
    this.engineGlow.instanceMatrix.needsUpdate = true;
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
