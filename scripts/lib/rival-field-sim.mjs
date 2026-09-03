/**
 * The rival fleet's decision loop, in Node.
 *
 * This is the SAME sequence `RivalFleet.step` runs — pace lane, pad line,
 * rival-versus-rival contest, player defence, no-block corridor, then
 * `stepRivalField` — reading the headless course model instead of the
 * TypeScript course. It exists so the pace numbers can be measured
 * (`scripts/rival-pace-calibration.mjs`) and the race rules asserted
 * (`scripts/validate-rivals.mjs`) without a browser, and so both of those read
 * one implementation rather than two drifting copies.
 */
import {
  RIVAL_DEFENCE_LOOKAHEAD_METERS,
  RIVAL_FIXED_STEP_SECONDS,
  RIVAL_EVASIVE_LATERAL_GAIN,
  RIVAL_GRID_HOLD_METERS,
  RIVAL_LANE_CLEARANCE_METERS,
  RIVAL_LANE_CONTEST_GAP_METERS,
  RIVAL_FREE_DECK_FRACTION,
  RIVAL_NO_BLOCK_MARGIN_FRACTION,
  RIVAL_NO_BLOCK_WINDOW_METERS,
  RIVAL_PAD_APPROACH_METERS,
  RIVAL_PLAYER_AVOID_GAP_METERS,
  RIVAL_PROFILES,
  VEHICLE_CLEARANCE_METERS,
  createRivalState,
  isInsideBoostWindow,
  freeDeckTargetFraction,
  measureFreeDeckFraction,
  playerRaceDistanceOffsetMeters,
  rivalContestLaneMeters,
  rivalCourseSpeedFactor,
  rivalPaceLaneMeters,
  rivalPoseSignals,
  resolveRivalPace,
  spreadGridLaterals,
  stepRivalField,
} from "../../src/game/rival-race.js";

const PLAYER_ID = "player";

/**
 * @param {{
 *   course: ReturnType<import("./rival-course-model.mjs").loadCourseModel>;
 *   pace: object | null;
 *   totalLaps?: number;
 *   renderDeltaSeconds?: number;
 *   maximumSeconds?: number;
 *   player?: ((elapsedSeconds: number) => { raceDistanceMeters: number; lateralMeters: number }) | null;
 *   contest?: boolean;
 *   onlyProfileIndex?: number | null;
 * }} options
 */
export function simulateRivalField(options) {
  const {
    course,
    pace,
    totalLaps = 5,
    renderDeltaSeconds = RIVAL_FIXED_STEP_SECONDS,
    maximumSeconds = 480,
    player = null,
    contest = true,
    onlyProfileIndex = null,
  } = options;

  const profiles = onlyProfileIndex === null
    ? RIVAL_PROFILES
    : [RIVAL_PROFILES[onlyProfileIndex]];
  const paces = profiles.map((profile) => resolveRivalPace(pace, profile.id));
  // The map's authored yield side, shared by the whole field (see
  // `rivalNoBlockLaneMeters`). Defaults to the left edge when a course authors
  // no pace block at all.
  const noBlockSide = Number.isFinite(pace?.noBlockSide) ? pace.noBlockSide : -1;
  const driftCurvature = Number.isFinite(pace?.driftCurvature)
    ? pace.driftCurvature
    : Infinity;

  // The same one-off grid fan `RivalFleet.reset` applies, from the same helper.
  const gridSample = course.sample(course.startProgress);
  const gridLaterals = spreadGridLaterals(
    course.startLateral,
    profiles.map((profile) => (
      course.gridStart(profile.name)?.lateralMeters ?? profile.startingLateralMeters
    )),
    Math.max(0, gridSample.halfWidth - VEHICLE_CLEARANCE_METERS),
  );
  const states = profiles.map((profile, index) => {
    const state = createRivalState(profile.id, course.length, totalLaps);
    const grid = course.gridStart(profile.name);
    if (grid) {
      state.raceDistanceMeters = grid.raceDistanceMeters;
      state.courseDistanceMeters = grid.raceDistanceMeters;
      state.lastSafeDistanceMeters = grid.raceDistanceMeters;
    }
    state.lateralMeters = gridLaterals[index];
    state.paceLateralMeters = gridLaterals[index];
    state.lastSafeLateralMeters = gridLaterals[index];
    return state;
  });
  const gridSlots = states.map((state) => state.lateralMeters);
  let maximumGridDriftMeters = 0;

  // The player's distance arrives measured from the start line and a rival's is
  // measured from station zero; `RivalFleet.step` converts once on the way in
  // and so does this. One scratch object, so a five-lap run still allocates
  // nothing per sub-step.
  const playerDistanceOffset = playerRaceDistanceOffsetMeters(
    course.startProgress,
    course.length,
  );
  const playerScratch = { raceDistanceMeters: 0, lateralMeters: 0 };
  const readPlayer = (seconds) => {
    if (!player) return null;
    const raw = player(seconds);
    playerScratch.raceDistanceMeters = raw.raceDistanceMeters + playerDistanceOffset;
    playerScratch.lateralMeters = raw.lateralMeters;
    return playerScratch;
  };

  let elapsedSeconds = 0;
  let remainderSeconds = 0;
  let minimumSeparationMeters = Infinity;
  let minimumRivalSeparationMeters = Infinity;
  let worstRivalPair = null;
  let worstPlayerContact = null;
  let minimumFreeDeckFraction = 1;
  let noBlockSamples = 0;
  let alongsideSamples = 0;
  let minimumClearFreeDeckFraction = 1;
  let minimumClearFreeDeckMargin = Infinity;
  let minimumFreeDeckTarget = 1;
  let worstFreeDeckSample = { fraction: 1 };
  let leadChanges = 0;
  let peakSteerRadians = 0;
  let previousLeader = -1;
  const laneScratch = [];
  const freeDeckScratch = [];

  // One scratch drive object per rival: `stepRivalField` writes deltaSeconds
  // into whatever the resolver hands back, so nothing is allocated per sub-step.
  const driveScratch = profiles.map(() => ({ deltaSeconds: RIVAL_FIXED_STEP_SECONDS }));

  const resolve = (state, field) => {
    const index = states.indexOf(state);
    const entry = paces[index];
    const sample = course.sample(state.courseDistanceMeters / course.length);
    const laneHalfWidthMeters = Math.max(0, sample.halfWidth - VEHICLE_CLEARANCE_METERS);
    const padLaneMeters = entry.padUse
      ? course.boostPadLaneAt(
        state.courseDistanceMeters,
        sample.halfWidth,
        RIVAL_PAD_APPROACH_METERS,
      )
      : null;
    const paceLane = rivalPaceLaneMeters(state, {
      curvature: sample.curvature,
      laneHalfWidthMeters,
      padLaneMeters,
      padUse: entry.padUse,
    });
    const neighbourLaterals = [];
    if (contest) {
      for (const other of field) {
        if (other === state || other.finished) continue;
        if (
          Math.abs(state.raceDistanceMeters - other.raceDistanceMeters)
            < RIVAL_LANE_CONTEST_GAP_METERS
        ) neighbourLaterals.push(other.lateralMeters);
      }
    }
    const playerState = readPlayer(elapsedSeconds);
    const playerGapMeters = playerState
      ? state.raceDistanceMeters - playerState.raceDistanceMeters
      : Infinity;
    const aheadSample = course.sample(
      (state.courseDistanceMeters + RIVAL_DEFENCE_LOOKAHEAD_METERS) / course.length,
    );
    const insideSign = Math.abs(aheadSample.curvature) >= driftCurvature
      ? Math.sign(aheadSample.curvature)
      : 0;
    const targetLateralMeters = rivalContestLaneMeters(paceLane, {
      playerGapMeters,
      playerLateralMeters: playerState ? playerState.lateralMeters : 0,
      rivalId: state.id,
      lateralMeters: state.lateralMeters,
      neighbourLaterals,
      insideSign,
      sideSign: noBlockSide,
      halfWidthMeters: sample.halfWidth,
      laneHalfWidthMeters,
    });
    const drive = driveScratch[index];
    return Object.assign(drive, {
      targetLateralMeters,
      paceLateralMeters: paceLane,
      laneHalfWidthMeters,
      courseSpeedFactor: rivalCourseSpeedFactor(pace, sample.curvature),
      cruiseSpeedMetersPerSecond: entry.cruiseSpeedMetersPerSecond,
      boostWindowActive: isInsideBoostWindow(
        entry.boostWindows,
        state.courseDistanceMeters,
      ),
      onBoostPad: entry.padUse
        && course.isOnBoostPad(
          state.courseDistanceMeters,
          state.paceLateralMeters,
          sample.halfWidth,
        ),
      curvatureMagnitude: Math.abs(sample.curvature),
      driftCurvature,
      lateralSpeedScale: playerState
        && Math.abs(playerGapMeters) <= RIVAL_PLAYER_AVOID_GAP_METERS
        && Math.abs(state.lateralMeters - playerState.lateralMeters)
          < RIVAL_LANE_CLEARANCE_METERS
        ? RIVAL_EVASIVE_LATERAL_GAIN
        : 1,
    });
  };

  const onSubStep = (field) => {
    // The grid hold, measured rather than trusted: no rival may have moved a
    // millimetre off the slot it was given before RIVAL_GRID_HOLD_METERS.
    for (let index = 0; index < field.length; index += 1) {
      if (field[index].raceDistanceMeters > RIVAL_GRID_HOLD_METERS) continue;
      maximumGridDriftMeters = Math.max(
        maximumGridDriftMeters,
        Math.abs(field[index].lateralMeters - gridSlots[index]),
      );
    }
    const playerState = readPlayer(elapsedSeconds);
    freeDeckScratch.length = 0;
    // A free-deck sample is CONCLUSIVE only when the player is on the free side
    // of the yield corridor. A player that has driven into the rivals' band has
    // not been blocked out of the route - it has declined to take it - and in
    // that situation the lane solver deliberately spends the corridor to keep
    // the player its lateral clearance instead. Those samples are counted and
    // reported, and the separation assertion covers them.
    let conclusiveSample = true;
    let narrowestHalfWidth = Infinity;
    for (let index = 0; index < field.length; index += 1) {
      const state = field[index];
      if (playerState && !state.finished) {
        const contact = Math.hypot(
          state.raceDistanceMeters - playerState.raceDistanceMeters,
          state.lateralMeters - playerState.lateralMeters,
        );
        if (contact < minimumSeparationMeters) {
          minimumSeparationMeters = contact;
          worstPlayerContact = {
            elapsedSeconds,
            id: state.id,
            rivalLateral: state.lateralMeters,
            playerLateral: playerState.lateralMeters,
            longitudinalGap: state.raceDistanceMeters - playerState.raceDistanceMeters,
            target: resolve(state, field).targetLateralMeters,
            courseDistance: state.courseDistanceMeters,
          };
        }
        const gap = state.raceDistanceMeters - playerState.raceDistanceMeters;
        if (gap >= 0 && gap <= RIVAL_NO_BLOCK_WINDOW_METERS && !state.finished) {
          freeDeckScratch.push(state.lateralMeters);
          const halfWidth = course.sample(
            state.courseDistanceMeters / course.length,
          ).halfWidth;
          narrowestHalfWidth = Math.min(narrowestHalfWidth, halfWidth);
          const reserved = RIVAL_FREE_DECK_FRACTION + RIVAL_NO_BLOCK_MARGIN_FRACTION;
          const inner = halfWidth * (2 * reserved - 1) + VEHICLE_CLEARANCE_METERS;
          // Inconclusive when the player has put itself where the answer stops
          // meaning anything: inside the strip reserved for it to pass through,
          // or on a rival's own line, where the craft is already sliding out of
          // the way and the player is not being blocked - it is sitting on top
          // of the thing it would be blocked by.
          if (noBlockSide * playerState.lateralMeters >= inner) conclusiveSample = false;
          if (
            Math.abs(state.lateralMeters - playerState.lateralMeters)
              < RIVAL_LANE_CLEARANCE_METERS
          ) conclusiveSample = false;
        }
      }
      for (let other = index + 1; other < field.length; other += 1) {
        // A finished rival is parked on the line and its visual is retired by
        // the fleet, so it is not a separation hazard any more.
        if (state.finished || field[other].finished) continue;
        const pairSeparation = Math.hypot(
          state.raceDistanceMeters - field[other].raceDistanceMeters,
          state.lateralMeters - field[other].lateralMeters,
        );
        if (pairSeparation < minimumRivalSeparationMeters) {
          minimumRivalSeparationMeters = pairSeparation;
          worstRivalPair = {
            elapsedSeconds,
            a: state.id,
            b: field[other].id,
            aLateral: state.lateralMeters,
            bLateral: field[other].lateralMeters,
            aDistance: state.courseDistanceMeters,
            longitudinalGap: state.raceDistanceMeters - field[other].raceDistanceMeters,
          };
        }
      }
      const pose = rivalPoseSignals(state, resolve(state, field));
      peakSteerRadians = Math.max(peakSteerRadians, Math.abs(pose.steer) * 20 * Math.PI / 180);
    }
    if (freeDeckScratch.length > 0) {
      noBlockSamples += 1;
      const fraction = measureFreeDeckFraction(freeDeckScratch, narrowestHalfWidth);
      const target = freeDeckTargetFraction(narrowestHalfWidth);
      minimumFreeDeckFraction = Math.min(minimumFreeDeckFraction, fraction);
      minimumFreeDeckTarget = Math.min(minimumFreeDeckTarget, target);
      if (conclusiveSample && fraction < worstFreeDeckSample.fraction) {
        worstFreeDeckSample = {
          fraction,
          target,
          elapsedSeconds,
          halfWidth: narrowestHalfWidth,
          playerLateral: playerState.lateralMeters,
          laterals: [...freeDeckScratch],
        };
      }
      if (!conclusiveSample) alongsideSamples += 1;
      else {
        minimumClearFreeDeckFraction = Math.min(minimumClearFreeDeckFraction, fraction);
        minimumClearFreeDeckMargin = Math.min(
          minimumClearFreeDeckMargin,
          fraction - target,
        );
      }
    }
    laneScratch.length = 0;
    let leader = 0;
    for (let index = 1; index < field.length; index += 1) {
      if (field[index].raceDistanceMeters > field[leader].raceDistanceMeters) leader = index;
    }
    if (previousLeader >= 0 && leader !== previousLeader) leadChanges += 1;
    previousLeader = leader;
  };

  while (
    elapsedSeconds < maximumSeconds
    && states.some((state) => !state.finished)
  ) {
    remainderSeconds = stepRivalField(states, {
      deltaSeconds: renderDeltaSeconds,
      remainderSeconds,
      resolveSubStepInput: resolve,
      onSubStep,
    });
    elapsedSeconds += renderDeltaSeconds;
  }

  return {
    states,
    gridSlots,
    maximumGridDriftMeters,
    minimumSeparationMeters,
    minimumRivalSeparationMeters,
    worstRivalPair,
    worstPlayerContact,
    minimumFreeDeckFraction,
    minimumClearFreeDeckFraction,
    minimumClearFreeDeckMargin,
    minimumFreeDeckTarget,
    worstFreeDeckSample,
    alongsideSamples,
    noBlockSamples,
    leadChanges,
    peakSteerRadians,
    elapsedSeconds,
  };
}

/**
 * A deterministic stand-in for the player, built from the lap time the headless
 * demo soak actually measured. It launches from the grid with the field, ramps
 * to lap pace over `RAMP_SECONDS`, then holds it, and weaves slowly across the
 * deck so the lateral rules are exercised.
 *
 * It is deliberately NOT a physics model. The whole point of the
 * longitudinal-independence proof is that no property of the player's motion
 * can reach a rival's lap time, so the fidelity of this curve cannot change any
 * timing result - only which lateral situations the run visits.
 *
 * @param {number} courseLengthMeters
 * @param {number} lapSeconds
 * @param {number} [paceScale] >1 makes the player slower than the measurement,
 *   which is how the field is made to stream past it for the no-block rule.
 */
export function measuredPacePlayer(
  courseLengthMeters,
  lapSeconds,
  gridLateralMeters = 0,
  paceScale = 1,
) {
  const RAMP_SECONDS = 3.4;
  const speed = courseLengthMeters / (lapSeconds * paceScale);
  const rampDistance = speed * RAMP_SECONDS / 2;
  return (elapsedSeconds) => {
    const time = Math.max(0, elapsedSeconds);
    const raceDistanceMeters = time < RAMP_SECONDS
      ? speed * time * time / (2 * RAMP_SECONDS)
      : rampDistance + speed * (time - RAMP_SECONDS);
    return {
      raceDistanceMeters,
      // Holds its own grid lane over the launch, exactly as the demo driver
      // does, then goes back to weaving across the deck without regard for
      // traffic. Off the grid it is adversarial on purpose; on the grid it has
      // to model the driver the acceptance soak actually runs, or the launch
      // would be tested against a player the game never ships.
      lateralMeters: raceDistanceMeters < GRID_LANE_HOLD_METERS
        ? gridLateralMeters
        : Math.sin(time * 0.42) * 5.5,
    };
  };
}

/** Mirrors `GRID_LANE_HOLD_METERS` in `src/game/autopilot.ts`. */
export const GRID_LANE_HOLD_METERS = 200;

/** A player who never leaves the grid: the longitudinal-independence control. */
export function parkedPlayer() {
  return () => ({ raceDistanceMeters: 0, lateralMeters: 0 });
}

export { PLAYER_ID };
