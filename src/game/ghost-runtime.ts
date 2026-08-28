/**
 * P10 — the ghost lap's impure half: the five lines `game.ts` can afford.
 *
 * `src/game/ghost.js` owns every decision (when to sample, how to quantise, how
 * to interpolate) and runs under Node. This module is the adapter: it builds
 * one translucent mesh, feeds the recorder from the fixed step, poses the mesh
 * from the player, and talks to the save file. The race loop sits five lines
 * from its 1,950-line seam budget, so everything that could live here does.
 *
 * **Recording cannot perturb physics.** Nothing in this file writes a
 * simulation value, and `step` returns nothing the caller can branch on. It
 * reads five numbers and pushes four of them into an array every sixth call.
 * That is the whole contract, and it is why the soak's lap times must come back
 * bit-identical with recording armed.
 */
import * as THREE from "three";

import type { RaceCourse } from "./course";
import {
  GHOST_SAMPLE_HZ,
  GhostPlayer,
  GhostRecorder,
  PHYSICS_STEPS_PER_SAMPLE,
  createGhostPlayer,
  type GhostRecording,
} from "./ghost.js";
import { save } from "./persistence";
import { probeSelected, searchFlag } from "./query-probes";
import type { TotemRivalVisualBatch } from "./totem";

/** Mirrors `game.ts`'s own constant. The recorder's rate is derived from it. */
const FIXED_STEP_MS = 1000 / 120;
/**
 * The acid green the course furniture already uses for its own markings, so the
 * ghost reads as part of the circuit's signage language rather than as a fourth
 * rival that someone forgot to texture.
 */
const GHOST_TINT = 0xc8ff2e;
/** Low enough to see the track through, high enough to pick out at 400 km/h. */
const GHOST_OPACITY = 0.26;
/** Matches the rivals' nominal ride height so the ghost flies the same line. */
const GHOST_HOVER_METERS = 0.82;
const GHOST_ROLL_AXIS = new THREE.Vector3(0, 0, 1);

export interface GhostDiagnostics {
  /** A stored ghost is loaded and being replayed this race. */
  ghostActive: boolean;
  /** 0 or 1. The phase budget allows exactly one. */
  ghostDrawCalls: number;
  /** Frames in the ghost being replayed, or 0. */
  ghostFrames: number;
  /** Frames captured for the lap in progress. */
  ghostRecordedFrames: number;
  /** The replayed lap's stored time, or null. */
  ghostLapMs: number | null;
  /** Triangles the ghost mesh adds when visible. Phase budget: 6,200. */
  ghostTriangles: number;
}

/** Only what this module needs from the vehicle, so the seam stays narrow. */
interface GhostGeometrySource {
  createRivalVisualBatches(): TotemRivalVisualBatch[];
}

/**
 * Merges one craft's worth of rival batch geometry into a single position-only
 * buffer, at the neutral pose.
 *
 * The rendering choice, and why it is not a fourth rival instance: P2's batches
 * are `count = 3` instanced meshes sharing opaque, livery-atlased materials. A
 * translucent ghost cannot share a material with them — it needs
 * `depthWrite: false` and its own blend — so a fourth instance would have to
 * grow every one of P2's five batches, rewrite the per-instance livery-offset
 * and shading-colour buffers, and still end up with a separate pass. That is
 * five buffers of determinism-adjacent P2 code touched to save nothing. One
 * merged mesh with one material is **+1 draw call** and leaves the fleet's
 * instance counts, offset buffers and classification code untouched.
 *
 * Articulation is dropped deliberately: the fins and airbrakes are baked at
 * their neutral pivot transform. A ghost is a racing line, not a performance —
 * and at 26% opacity a moving fin is invisible anyway.
 */
function buildGhostGeometry(batches: readonly TotemRivalVisualBatch[]): {
  geometry: THREE.BufferGeometry;
  triangles: number;
} {
  let vertices = 0;
  for (const batch of batches) {
    vertices += batch.geometry.getAttribute("position").count * batch.slots.length;
  }
  const positions = new Float32Array(vertices * 3);
  const vertex = new THREE.Vector3();
  let offset = 0;
  for (const batch of batches) {
    const source = batch.geometry.getAttribute("position");
    for (const slot of batch.slots) {
      // Articulated batches are baked pivot-local so a left/right pair can share
      // one geometry; reapplying the pivot's neutral transform is what puts each
      // side back where it belongs.
      for (let index = 0; index < source.count; index += 1) {
        vertex.fromBufferAttribute(source, index).applyMatrix4(slot.pivotMatrix);
        positions[offset] = vertex.x;
        positions[offset + 1] = vertex.y;
        positions[offset + 2] = vertex.z;
        offset += 3;
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  return { geometry, triangles: vertices / 3 };
}

/**
 * The ghost for this page load. A module singleton for the same reason `save`
 * is one — it lets the race loop reach it in one line rather than carrying a
 * field — and {@link GhostRuntime.attach} resets every piece of state, so a
 * second `Game` over the same module starts clean.
 */
class GhostRuntime {
  private readonly root = new THREE.Group();
  private mesh: THREE.Mesh | null = null;
  private course: RaceCourse | null = null;
  private recorder = new GhostRecorder(GHOST_SAMPLE_HZ, PHYSICS_STEPS_PER_SAMPLE);
  private player: GhostPlayer | null = null;
  /** The fastest lap of *this* race, held until the result screen stores it. */
  private bestOfRace: GhostRecording | null = null;
  private bestOfRaceMs: number | null = null;
  private lap = 1;
  private lapSteps = 0;
  private triangles = 0;
  private enabled = false;

  /** Reused every frame; the presentation pass beside this one never allocates. */
  private sample: ReturnType<RaceCourse["createSampleScratch"]> | null = null;
  private readonly posePosition = new THREE.Vector3();
  private readonly poseQuaternion = new THREE.Quaternion();
  private readonly poseMatrix = new THREE.Matrix4();
  private readonly poseScale = new THREE.Vector3(1, 1, 1);
  private readonly backward = new THREE.Vector3();
  private readonly bankQuaternion = new THREE.Quaternion();

  /**
   * Builds the mesh and returns it for the caller to add to the scene. Returns
   * an empty group — no mesh, no draw call, no recording — under `?demo` or any
   * `?probe=`, because a showcase reel and a headless probe are not races and
   * must not be able to write a personal best.
   */
  attach(course: RaceCourse, vehicle: GhostGeometrySource): THREE.Object3D {
    this.root.clear();
    this.root.name = "totem_ghost";
    this.mesh = null;
    this.course = course;
    this.sample = course.createSampleScratch();
    this.player = null;
    this.bestOfRace = null;
    this.bestOfRaceMs = null;
    this.triangles = 0;
    this.recorder.reset();
    this.enabled = !searchFlag("demo") && !isProbeRun();
    if (!this.enabled) return this.root;
    const batches = vehicle.createRivalVisualBatches();
    try {
      const built = buildGhostGeometry(batches);
      this.triangles = built.triangles;
      this.mesh = new THREE.Mesh(built.geometry, createGhostMaterial());
      this.mesh.name = "totem_ghost_hull";
      this.mesh.frustumCulled = false;
      this.mesh.castShadow = false;
      this.mesh.receiveShadow = false;
      // After the opaque pass, so the track behind it is already in the buffer.
      this.mesh.renderOrder = 2;
      this.mesh.visible = false;
      this.root.add(this.mesh);
    } finally {
      // The batches were cloned for this one merge and are never drawn from.
      for (const batch of batches) {
        batch.geometry.dispose();
        batch.material.dispose();
      }
    }
    return this.root;
  }

  /**
   * Race reset. Loads the stored best lap for this course, if there is one, and
   * throws away whatever the previous run recorded.
   */
  reset(): void {
    this.recorder.reset();
    this.bestOfRace = null;
    this.bestOfRaceMs = null;
    this.lap = 1;
    this.lapSteps = 0;
    this.player = this.enabled && this.course
      ? createGhostPlayer(save.ghostFor(this.course.mapCode))
      : null;
    if (this.mesh) this.mesh.visible = this.player !== null;
  }

  /**
   * One fixed 120 Hz race step, called from `updateRace` on the line directly
   * after `elapsedMs` advances and directly before the lap boundary is tested.
   *
   * That position is load-bearing, and it is what lets the lap clock be
   * *derived* — `lapSteps × FIXED_STEP_MS` — rather than threaded through a
   * sixth argument the seam budget cannot pay for:
   *
   * - **Before the boundary test**, so the crossing step is counted against the
   *   lap it finished. Sampling after it would put that step in the next lap and
   *   make every derived lap time 8.3 ms short.
   * - **After `elapsedMs += delta`**, and inside the same early-return fence:
   *   `updateRace` bails before both when an automatic recovery fires, so a
   *   recovery step advances neither clock. The two stay equal by construction
   *   rather than by coincidence.
   *
   * Measured, not assumed: 4,138 steps at 120 Hz close a lap at exactly
   * 34,483 ms, the value `game.ts` computes for the same drive.
   */
  step(lap: number, progress: number, lateral: number, speed: number, steer: number): void {
    if (!this.enabled || !this.course) return;
    if (lap !== this.lap) {
      this.closeLap(this.lapSteps * FIXED_STEP_MS);
      this.lap = lap;
    }
    this.lapSteps += 1;
    this.recorder.step(this.lapMetersAt(progress), lateral, speed, steer);
  }

  /**
   * Poses the ghost for this rendered frame. `physicsAccumulator` is the
   * unconsumed remainder of the fixed-step loop, in seconds; adding it to the
   * step-derived lap clock is what keeps the ghost as smooth as the
   * interpolated rivals beside it instead of stepping in 8.3 ms quanta.
   */
  updatePresentation(physicsAccumulator: number): void {
    const mesh = this.mesh;
    const player = this.player;
    const course = this.course;
    if (!mesh || !player || !course || !this.sample) return;
    const pose = player.sampleAt(this.lapSteps * FIXED_STEP_MS + physicsAccumulator * 1000);
    const sample = course.sample(
      course.startProgress + pose.lapMeters / course.length,
      this.sample,
    );
    this.posePosition.copy(sample.position)
      .addScaledVector(sample.right, pose.lateral)
      .addScaledVector(sample.up, GHOST_HOVER_METERS);
    this.backward.copy(sample.tangent).multiplyScalar(-1);
    this.poseMatrix.makeBasis(sample.right, sample.up, this.backward);
    this.poseQuaternion.setFromRotationMatrix(this.poseMatrix);
    this.bankQuaternion.setFromAxisAngle(GHOST_ROLL_AXIS, -pose.steer * 0.16);
    this.poseQuaternion.multiply(this.bankQuaternion);
    mesh.position.copy(this.posePosition);
    mesh.quaternion.copy(this.poseQuaternion);
    mesh.scale.copy(this.poseScale);
  }

  /**
   * The recording to store with a finished race, or null.
   *
   * Called from `meta-runtime.recordFinishedRace`, which is the *only* place a
   * ghost reaches the save file. Persisting mid-race would be the obvious
   * alternative and is a trap: it would lower the stored `bestLapMs` before the
   * result screen compares against it, and P7's `NEW BEST` flash would never
   * fire again. `applyRaceResult` attaches this recording only when the lap
   * actually is a new best, so the file's ghost always matches its `bestLapMs`.
   *
   * @param finalLapMs The last lap's authoritative time, still open in the
   *   recorder because the race ended on the crossing that closed it.
   */
  bestLapRecording(finalLapMs: number | null): GhostRecording | null {
    if (!this.enabled) return null;
    this.closeLap(finalLapMs ?? this.lapSteps * FIXED_STEP_MS);
    return this.bestOfRace;
  }

  diagnostics(): GhostDiagnostics {
    return {
      ghostActive: this.player !== null,
      ghostDrawCalls: this.mesh?.visible ? 1 : 0,
      ghostFrames: this.player?.frameCount ?? 0,
      ghostRecordedFrames: this.recorder.frameCount,
      ghostLapMs: this.player?.lapMs ?? null,
      ghostTriangles: this.triangles,
    };
  }

  /** Distance along the current lap, which is what the recording stores. */
  private lapMetersAt(progress: number): number {
    const course = this.course;
    if (!course) return 0;
    return THREE.MathUtils.euclideanModulo(progress - course.startProgress, 1)
      * course.length;
  }

  /** Freezes the lap in progress and keeps it if it is the race's fastest. */
  private closeLap(lapMs: number): void {
    const recording = this.recorder.toRecording(lapMs);
    this.recorder.reset();
    this.lapSteps = 0;
    if (!recording) return;
    if (this.bestOfRaceMs === null || recording.lapMs < this.bestOfRaceMs) {
      this.bestOfRace = recording;
      this.bestOfRaceMs = recording.lapMs;
    }
  }
}

/** `?probe=` arms a headless scenario; none of them are a race. */
function isProbeRun(): boolean {
  return [
    "recovery",
    "wrong-way",
    "impact",
    "water",
    "apron",
    "rival-audio",
    "context",
    "focus",
  ].some((name) => probeSelected(name));
}

function createGhostMaterial(): THREE.Material {
  return new THREE.MeshBasicMaterial({
    color: GHOST_TINT,
    transparent: true,
    opacity: GHOST_OPACITY,
    // The ghost must never occlude the track, the rivals or the player, and it
    // is drawn after them, so it contributes colour and nothing else.
    depthWrite: false,
    side: THREE.FrontSide,
    toneMapped: false,
  });
}

export const ghostRuntime = new GhostRuntime();
