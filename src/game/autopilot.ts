import * as THREE from "three";
import {
  type CourseProjection,
  type RaceCourse,
  type TurnCue,
} from "./course";
import type { InputFrame } from "./input";
import { BOOST_MAX_SPEED } from "./physics";

/**
 * Projects `direction` onto the surface plane described by `up`, falling back to
 * `fallback` when the projection collapses. Shared by the showcase autopilot and
 * the player race integration so both stay on the same surface basis.
 */
export function alignDirectionToSurface(
  direction: THREE.Vector3,
  up: THREE.Vector3,
  fallback: THREE.Vector3,
): void {
  direction.addScaledVector(up, -direction.dot(up));
  if (direction.lengthSq() < 0.0001) direction.copy(fallback);
  direction.normalize();
}

/**
 * Showcase autopilot. Owns the demo input frame plus the course scratch objects
 * it needs, so the race loop only forwards the vehicle state it already tracks.
 */
export class DemoAutopilot {
  readonly input: InputFrame = {
    throttle: 1,
    brake: 0,
    steer: 0,
    boost: false,
  };
  private readonly projection: CourseProjection;
  private readonly lookAheadSample: ReturnType<RaceCourse["createSampleScratch"]>;
  private readonly turnCue: TurnCue = {
    direction: "LEFT",
    followingDirection: null,
    distance: 0,
    hard: false,
    radius: 0,
  };
  private readonly scratchA = new THREE.Vector3();
  private readonly scratchB = new THREE.Vector3();

  constructor(private readonly course: RaceCourse) {
    this.projection = course.createProjectionScratch();
    this.lookAheadSample = course.createSampleScratch();
  }

  reset(): void {
    this.input.throttle = 1;
    this.input.brake = 0;
    this.input.steer = 0;
    this.input.boost = false;
  }

  read(
    position: THREE.Vector3,
    forward: THREE.Vector3,
    travelDirection: THREE.Vector3,
    progress: number,
    speed: number,
    lap: number,
    nextCheckpointIndex: number,
    elapsedMs: number,
  ): InputFrame {
    const projection = this.course.project(
      position,
      progress,
      this.projection,
    );
    const speedRatio = speed / BOOST_MAX_SPEED;
    const turnCue = this.course.turnAhead(
      progress,
      220,
      this.turnCue,
    );
    const lookAheadDistance = THREE.MathUtils.lerp(32, 52, speedRatio)
      - (turnCue?.hard ? 4 : 0);
    const lookAhead = this.course.sample(
      progress + lookAheadDistance / this.course.length,
      this.lookAheadSample,
    );
    const target = this.scratchA.copy(lookAhead.tangent);
    alignDirectionToSurface(target, projection.up, projection.tangent);
    const signedAngle = Math.atan2(
      this.scratchB.crossVectors(forward, target).dot(projection.up),
      THREE.MathUtils.clamp(forward.dot(target), -1, 1),
    );
    const lateralCorrection = THREE.MathUtils.clamp(
      projection.lateral / Math.max(1, projection.halfWidth),
      -1,
      1,
    );
    const lateralSlip = THREE.MathUtils.clamp(
      travelDirection.dot(projection.right),
      -1,
      1,
    );
    const gateProgress = this.course.checkpointProgress(nextCheckpointIndex);
    const gateDistance = THREE.MathUtils.euclideanModulo(
      gateProgress - progress,
      1,
    ) * this.course.length;
    // Flying laps begin at full speed, so the showcase controller trims its
    // straight-line target after lap one to keep the authored race pace.
    const cleanLineSpeed = lap === 1 ? 88 : 73;
    const turnTargetSpeed = turnCue
      ? turnCue.radius <= 50
        ? 52
        : turnCue.radius <= 60
          ? 56
          : turnCue.radius <= 85
            ? 64
            : turnCue.radius <= 110
              ? 72
              : turnCue.radius <= 200
                ? 82
                : cleanLineSpeed
      : cleanLineSpeed;
    const brakingDistance = Math.max(
      0,
      (speed * speed - turnTargetSpeed * turnTargetSpeed) / 28,
    ) + 30;
    const approachingTurnLimit = Boolean(
      turnCue && turnCue.distance < brakingDistance,
    );
    const desiredSpeed = approachingTurnLimit ? turnTargetSpeed : cleanLineSpeed;
    if (gateDistance < 120 && Math.abs(lateralCorrection) > 0.5) {
      this.input.brake = 0.2;
    } else if (speed > desiredSpeed) {
      this.input.brake = THREE.MathUtils.clamp(
        0.12 + (speed - desiredSpeed) / 42,
        0.12,
        0.5,
      );
    } else {
      this.input.brake = Math.abs(signedAngle) > 0.62 ? 0.3 : 0;
    }

    this.input.throttle = speed > desiredSpeed + 3 ? 0.18 : 1;
    this.input.steer = THREE.MathUtils.clamp(
      -signedAngle * 2.05 - lateralCorrection * 0.72 - lateralSlip,
      -1,
      1,
    );
    this.input.boost = !approachingTurnLimit
      && elapsedMs / 1000 % 5 < 0.55
      && speed < 88
      && Math.abs(signedAngle) < 0.12
      && Math.abs(lateralCorrection) < 0.24;
    return this.input;
  }
}
