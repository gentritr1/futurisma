import * as THREE from "three";
import {
  type CourseProjection,
  type RaceCourse,
  type TurnCue,
} from "./course";
import type { InputFrame } from "./input";
import {
  BOOST_MAX_SPEED,
  CUSHION_LATERAL_RANGE_METERS,
  SLIPSTREAM_LOCK_THRESHOLD,
} from "./physics";

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
 * G1 - race distance over which the demo driver holds its own grid lane.
 *
 * The rivals hold their grid slots for the first 180-260 m so the launch cannot
 * become a scrum; a demo player that immediately cut across to the racing line
 * would walk straight through the field it just spread out for. 200 m sits
 * inside the rivals' own release window, so the whole grid is off its slots at
 * about the same point. It is the DEMO driver only - a human still steers
 * wherever it likes off the line, and the rivals are pinned in that window, so
 * a human can put a hull through a hull if it aims for one.
 */
const GRID_LANE_HOLD_METERS = 200;

/** G1 - the controller only looks for a tow inside this much clear road. */
const DRAFT_RANGE_METERS = 30;
/**
 * ... and stops closing on the craft ahead here.
 *
 * The tow is already at full strength from 4 m back, so there is nothing to
 * gain by getting closer - and a controller that keeps closing drives into the
 * rival's tail, which a rival sliding sideways at 4.6 m/s cannot get out of the
 * way of. That is what collapsed `rivalMinimumSeparationMeters` to 0.03 m in a
 * Bitterpan soak: not the fleet failing to yield, the demo driver refusing to
 * lift. 7 m keeps the craft inside the full-tow band with room to spare.
 */
const DRAFT_HOLD_METERS = 7;
/** Throttle held while closed up behind the craft ahead. */
const DRAFT_HOLD_THROTTLE = 0.32;
/**
 * G1 — the lateral band inside which the controller will HOLD a wake.
 *
 * This is the tow's own fade width plus a little: past it there is nothing left
 * to hold on to.
 */
const DRAFT_LATERAL_RANGE_METERS = 2.5;
/**
 * G2 — the wider band inside which the controller will go and ACQUIRE one.
 *
 * G1's driver only ever held a wake it was already sitting in, which is why the
 * Bitterpan soak recorded zero locks over five laps: the yield corridor holds
 * PRIVATEER off the player's line by design, so the tow never came to the
 * driver and the driver never went to the tow. A human moves ACROSS to get
 * behind a car. This is that move, and it is the only new steering authority
 * G2 gives the demo driver.
 *
 * 6 m is a little over one deck lane. Wider than that and the controller starts
 * abandoning its own line for a tow it cannot reach before the next corner; the
 * measurements for the alternatives are in the configuration table below.
 */
const DRAFT_ACQUIRE_LATERAL_METERS = 6;
/** Longitudinal window worth crossing the deck for: far enough to arrive. */
const DRAFT_ACQUIRE_NEAR_METERS = 6;
const DRAFT_ACQUIRE_FAR_METERS = 30;
/**
 * Steering authority spent crossing to a wake, as a share of the tuck gain.
 *
 * Rate limited to the driver's normal lateral rate rather than added on top of
 * it: the acquisition steer goes through the SAME clamp the tuck does, so the
 * craft crosses the deck at the pace it corners at and a rival 6 m away is not
 * something the driver can teleport onto.
 */
const DRAFT_ACQUIRE_GAIN = 0.16;
/** Steering authority spent closing onto the rival line while tucking in. */
const DRAFT_TUCK_GAIN = 0.28;
/** Steering authority spent stepping out of the tow to make the pass. */
const DRAFT_PASS_STEER = 0.34;
/**
 * Seconds the tow has to stay locked before the controller spends it.
 *
 * Without it the pass fires on the first frame the tow reaches the threshold,
 * which both wastes the draft - the reserve regen is the bigger half of it -
 * and reads as a twitch rather than a driver settling into the wake and then
 * pulling out. A Bitterpan soak spent 2.47 s in a tow at a 0.6 s settle; the
 * phase asks for at least 3 s over five laps, and a second in the wake per pass
 * is what a driver actually does with one.
 */
const DRAFT_SETTLE_SECONDS = 1;
/*
 * G1 tried a fourth thing here and took it out again: a demo driver that yields
 * laterally to a rival alongside, mirroring what the rivals do for it. Five
 * soak configurations were measured and not one of them held all four of the
 * phase's numbers at once.
 *
 *   ahead 20 m / 0.9 authority   separation 2.79 m, but a second a lap and the
 *                                tow down to 0.3 s over five laps
 *   ahead 8 m  / 0.5 authority   separation 1.07 m - too weak to matter
 *   ahead 4 m  / 0.9 authority   Bitterpan back to 1.9 m, free deck 33-37%
 *   ahead 8 m  / 0.9 authority   separation 2.79 m and 3-4 wall impacts, on
 *                                soaks that had been clean all phase
 *   ... plus an edge fade to kill those impacts, which zeroed the yield exactly
 *       where the crossings happen and put separation back to 0.07 m
 *
 * The pattern is consistent: a driver steering away from traffic is a driver
 * steering away from the racing line and out of the slipstream, and near the
 * deck edge it is a driver steering into the wall. The launch - which is where
 * the reviewed 0.07 m reading came from - is fixed structurally instead, by
 * fanning the grid and holding it. What remains is one mid-race crossing on
 * Greenwater and it is reported rather than papered over.
 */

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
  /**
   * G1 draft state, fed in by the race loop each frame: how far ahead the
   * nearest rival is, how far off its line the craft is, and how strong the tow
   * currently is. Held as plain numbers so the controller stays deterministic -
   * everything it decides is a function of these three plus the course.
   */
  private draftDistanceMeters = Infinity;
  private draftLateralGapMeters = Infinity;
  private draftStrength = 0;
  /** Seconds the tow has been locked for, integrated by `setDraft`. */
  private draftLockedSeconds = 0;

  constructor(private readonly course: RaceCourse) {
    this.projection = course.createProjectionScratch();
    this.lookAheadSample = course.createSampleScratch();
  }

  reset(): void {
    this.input.throttle = 1;
    this.input.brake = 0;
    this.input.steer = 0;
    this.input.boost = false;
    this.draftDistanceMeters = Infinity;
    this.draftLateralGapMeters = Infinity;
    this.draftStrength = 0;
    this.draftLockedSeconds = 0;
  }

  /**
   * G1 - the traffic picture, pushed in by the race loop before `read`.
   *
   * The showcase controller has to exercise the slipstream, or a headless soak
   * would never prove the tow works at all. `traffic` is the rival fleet, taken
   * structurally so this module stays independent of it; its draft distance is
   * positive when the rival is ahead. `strength` is the fleet's own tow
   * measurement, so the autopilot and the physics can never disagree about when
   * the tow is locked.
   */
  setDraft(
    traffic: {
      readonly draftDistanceMeters: number;
      readonly draftLateralMeters: number;
    } | null | undefined,
    strength: number,
    deltaSeconds = 0,
  ): void {
    const distanceMeters = traffic?.draftDistanceMeters ?? Infinity;
    const lateralGapMeters = traffic?.draftLateralMeters ?? Infinity;
    this.draftDistanceMeters = Number.isFinite(distanceMeters) ? distanceMeters : Infinity;
    this.draftLateralGapMeters = Number.isFinite(lateralGapMeters)
      ? lateralGapMeters
      : Infinity;
    this.draftStrength = Number.isFinite(strength) ? strength : 0;
    this.draftLockedSeconds = this.draftStrength >= SLIPSTREAM_LOCK_THRESHOLD
      ? this.draftLockedSeconds + Math.max(0, deltaSeconds)
      : 0;
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
    // Distance since the line, on lap one only: everything the grid hold gates
    // is over long before a lap is out, so a wrapped progress cannot confuse it.
    const raceDistanceMeters = lap === 1
      ? THREE.MathUtils.euclideanModulo(progress - this.course.startProgress, 1)
        * this.course.length
      : Number.POSITIVE_INFINITY;
    const holdingGridLane = raceDistanceMeters < GRID_LANE_HOLD_METERS;
    const laneTargetMeters = holdingGridLane ? this.course.startLateral : 0;
    const lateralCorrection = THREE.MathUtils.clamp(
      (projection.lateral - laneTargetMeters) / Math.max(1, projection.halfWidth),
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
    // G1 - one straight-line target for every lap, where this used to trim to
    // 73 m/s after lap one to "keep the authored race pace".
    //
    // The authored race pace is no longer 73: the field now cruises in the
    // player's own 82-88 m/s band. Worse, the trim made the phase's two
    // calibration windows jointly unsatisfiable on Bitterpan. A rival loses
    // ~2.2 s on lap one to its standing start, so lap1 = later + 2.2 and
    // total = 5*later + 2.2. Holding lap1 within +1.0 s of a player lap-one of
    // 38.775 forces later <= 37.6 and therefore total <= 190.1, while holding
    // the five-lap total within -5 s of a player total of 201.07 demands
    // >= 196.1. With uniform player laps the same arithmetic closes with ~1.2 s
    // to spare. Greenwater is corner limited and barely notices the change;
    // Bitterpan, which is two long pans, gets ~1.8 s a lap faster.
    const cleanLineSpeed = 88;
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
    // --- G1 draft-and-pass, G2 draft acquisition ---------------------------
    // Four states, all decided from the numbers `setDraft` supplied:
    //   ACQUIRE a rival 6-30 m ahead and within 6 m laterally, but not on this
    //           craft's line - cross the deck to get behind it (G2);
    //   TUCK    a rival is close ahead and the tow is not locked yet, so hold
    //           its line - steer toward its lateral rather than the racing line;
    //   COMMIT  the tow has been locked for DRAFT_SETTLE_SECONDS at
    //           SLIPSTREAM_LOCK_THRESHOLD, so pull out and put the reserve down;
    //   off     nothing within DRAFT_RANGE_METERS, drive the line as before.
    const inDraftRange = this.draftDistanceMeters > 0
      && this.draftDistanceMeters < DRAFT_RANGE_METERS
      && Math.abs(this.draftLateralGapMeters) < DRAFT_LATERAL_RANGE_METERS
      && !approachingTurnLimit
      // Not while holding the grid lane: tucking in means steering onto another
      // craft's line, which is the one thing the launch window exists to stop.
      && !holdingGridLane;
    // G2 acquisition. A rival far enough ahead to get behind, close enough
    // laterally to be worth crossing for, and not already inside the hold band
    // (that case is `tucking`, which is a finer correction onto a line the
    // craft is nearly on already). Same corner and grid gates as the tuck: a
    // driver crossing the deck into a braking zone is a driver in the wall, and
    // the launch hold outranks every draft rule.
    const acquiring = !inDraftRange
      && this.draftDistanceMeters >= DRAFT_ACQUIRE_NEAR_METERS
      && this.draftDistanceMeters < DRAFT_ACQUIRE_FAR_METERS
      && Math.abs(this.draftLateralGapMeters) < DRAFT_ACQUIRE_LATERAL_METERS
      // Never START a crossing from inside the air cushion. The controller can
      // only reach this state with a rival that is off its line, and a rival
      // already within the cushion band is one the craft is leaning on rather
      // than lining up behind - steering further into it there is how a draft
      // rule turns into a tailgate.
      && Math.abs(this.draftLateralGapMeters) > CUSHION_LATERAL_RANGE_METERS
      && !approachingTurnLimit
      && !holdingGridLane;
    const committing = inDraftRange
      && this.draftLockedSeconds >= DRAFT_SETTLE_SECONDS;
    const holding = inDraftRange && this.draftDistanceMeters < DRAFT_HOLD_METERS;
    // Tucking means steering ONTO another craft's line, so it is only ever the
    // right thing to do with a real gap in front. Without the DRAFT_HOLD_METERS
    // floor the controller tucked toward a craft 0.2 m ahead - alongside, not
    // ahead - and, because tucking suppresses the traffic term below, it did so
    // instead of leaving it room. That is the 0.79 m Greenwater reading.
    const tucking = inDraftRange && !committing && !holding
      && this.draftDistanceMeters >= DRAFT_HOLD_METERS;
    if (holding && !committing) this.input.throttle = DRAFT_HOLD_THROTTLE;
    const draftSteer = acquiring
      // G2 - cross to the wake. Same sign convention as the tuck below, a
      // gentler gain, and the same 0.5 clamp, which is what rate limits the
      // crossing to the driver's normal lateral authority.
      ? THREE.MathUtils.clamp(this.draftLateralGapMeters * DRAFT_ACQUIRE_GAIN, -0.5, 0.5)
      : tucking
      // Close the lateral gap onto the rival's line to build the tow.
        ? THREE.MathUtils.clamp(this.draftLateralGapMeters * DRAFT_TUCK_GAIN, -0.5, 0.5)
        : committing
        // ... then step out of it, to the side the rival is NOT on. Positive
        // steer moves the craft to positive lateral (see the lateralCorrection
        // term above, which subtracts), so the sign is the opposite of the gap.
        ? (this.draftLateralGapMeters <= 0 ? 1 : -1) * DRAFT_PASS_STEER
        : 0;
    this.input.steer = THREE.MathUtils.clamp(
      -signedAngle * 2.05 - lateralCorrection * 0.72 - lateralSlip + draftSteer,
      -1,
      1,
    );
    this.input.boost = committing
      || (!approachingTurnLimit
        && elapsedMs / 1000 % 5 < 0.55
        && speed < 88
        && Math.abs(signedAngle) < 0.12
        && Math.abs(lateralCorrection) < 0.24);
    return this.input;
  }
}
