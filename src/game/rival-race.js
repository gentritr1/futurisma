export const RIVAL_FIXED_STEP_SECONDS = 1 / 120;
export const RIVAL_FINISH_RUN_OUT_SECONDS = 3;

/**
 * @typedef {{
 *   id: string;
 *   name: string;
 *   tint: string;
 *   engineTint: string;
 *   gridOffsetMeters: number;
 *   startingLateralMeters: number;
 *   cruiseSpeedMetersPerSecond: number;
 *   paceVariationMetersPerSecond: number;
 *   accelerationMetersPerSecondSquared: number;
 *   brakingMetersPerSecondSquared: number;
 *   lateralSpeedMetersPerSecond: number;
 *   pacePhaseRadians: number;
 * }} RivalProfile
 */

/**
 * @typedef {{
 *   id: string;
 *   profileId: string;
 *   courseLengthMeters: number;
 *   totalLaps: number;
 *   raceDistanceMeters: number;
 *   courseDistanceMeters: number;
 *   speedMetersPerSecond: number;
 *   lateralMeters: number;
 *   completedLaps: number;
 *   lap: number;
 *   lapTimesSeconds: number[];
 *   finishTimeSeconds: number | null;
 *   finished: boolean;
 *   elapsedSeconds: number;
 *   fixedStepRemainderSeconds: number;
 *   lastLapCrossingTimeSeconds: number;
 *   lastSafeDistanceMeters: number;
 *   lastSafeSpeedMetersPerSecond: number;
 *   lastSafeLateralMeters: number;
 *   lastSafeElapsedSeconds: number;
 *   recoveryCount: number;
 * }} RivalState
 */

/**
 * @typedef {{
 *   id: string;
 *   raceDistanceMeters: number;
 *   speedMetersPerSecond?: number;
 *   finished?: boolean;
 *   finishTimeSeconds?: number | null;
 * }} RaceEntry
 */

/** @type {readonly RivalProfile[]} */
export const RIVAL_PROFILES = Object.freeze([
  Object.freeze({
    id: "rival-privateer",
    name: "PRIVATEER 13",
    tint: "#c07f4f",
    engineTint: "#f47a32",
    gridOffsetMeters: -12,
    startingLateralMeters: -3.2,
    cruiseSpeedMetersPerSecond: 66.2,
    paceVariationMetersPerSecond: 1.7,
    accelerationMetersPerSecondSquared: 13,
    brakingMetersPerSecondSquared: 18,
    lateralSpeedMetersPerSecond: 4.8,
    pacePhaseRadians: 0.4,
  }),
  Object.freeze({
    id: "rival-nightform",
    name: "NIGHTFORM 24",
    tint: "#4f8993",
    engineTint: "#5fc4d4",
    gridOffsetMeters: -24,
    startingLateralMeters: 3.1,
    cruiseSpeedMetersPerSecond: 64.8,
    paceVariationMetersPerSecond: 2.1,
    accelerationMetersPerSecondSquared: 12.4,
    brakingMetersPerSecondSquared: 17.5,
    lateralSpeedMetersPerSecond: 4.5,
    pacePhaseRadians: 2.2,
  }),
  Object.freeze({
    id: "rival-needle",
    name: "NEEDLE 16",
    tint: "#d6cfbb",
    engineTint: "#d2c8ad",
    gridOffsetMeters: -36,
    startingLateralMeters: -0.4,
    cruiseSpeedMetersPerSecond: 63.6,
    paceVariationMetersPerSecond: 1.9,
    accelerationMetersPerSecondSquared: 12,
    brakingMetersPerSecondSquared: 17,
    lateralSpeedMetersPerSecond: 4.6,
    pacePhaseRadians: 4.1,
  }),
]);

/** @param {string} profileId */
function profileForId(profileId) {
  const profile = RIVAL_PROFILES.find((candidate) => candidate.id === profileId);
  if (!profile) throw new Error(`Unknown rival profile ${profileId}.`);
  return profile;
}

/**
 * @param {string} profileId
 * @param {number} courseLengthMeters
 * @param {number} [totalLaps]
 * @returns {RivalState}
 */
export function createRivalState(profileId, courseLengthMeters, totalLaps = 5) {
  const profile = profileForId(profileId);
  const safeLength = Math.max(1, courseLengthMeters);
  const safeLaps = Math.max(1, Math.floor(totalLaps));
  return {
    id: profile.id,
    profileId: profile.id,
    courseLengthMeters: safeLength,
    totalLaps: safeLaps,
    raceDistanceMeters: profile.gridOffsetMeters,
    courseDistanceMeters: profile.gridOffsetMeters,
    speedMetersPerSecond: 0,
    lateralMeters: profile.startingLateralMeters,
    completedLaps: 0,
    lap: 1,
    lapTimesSeconds: [],
    finishTimeSeconds: null,
    finished: false,
    elapsedSeconds: 0,
    fixedStepRemainderSeconds: 0,
    lastLapCrossingTimeSeconds: 0,
    lastSafeDistanceMeters: profile.gridOffsetMeters,
    lastSafeSpeedMetersPerSecond: 0,
    lastSafeLateralMeters: profile.startingLateralMeters,
    lastSafeElapsedSeconds: 0,
    recoveryCount: 0,
  };
}

/**
 * @param {RivalState} state
 * @param {number} [courseLengthMeters]
 * @param {number} [totalLaps]
 */
export function resetRivalState(
  state,
  courseLengthMeters = state.courseLengthMeters,
  totalLaps = state.totalLaps,
) {
  Object.assign(state, createRivalState(state.profileId, courseLengthMeters, totalLaps));
  return state;
}

/** @param {number} value @param {number} target @param {number} maximumDelta */
function moveToward(value, target, maximumDelta) {
  if (value < target) return Math.min(target, value + maximumDelta);
  return Math.max(target, value - maximumDelta);
}

/** @param {number} value @param {number} minimum @param {number} maximum */
function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

/**
 * Returns a restrained visual-only roll for a rival craft. Lateral motion
 * supplies the immediate response while course curvature keeps the ship
 * leaning into a bend after it settles onto its line.
 *
 * @param {number} previousLateralMeters
 * @param {number} currentLateralMeters
 * @param {number} curvature
 */
export function calculateRivalBankRadians(
  previousLateralMeters,
  currentLateralMeters,
  curvature,
) {
  const previous = Number.isFinite(previousLateralMeters)
    ? previousLateralMeters
    : 0;
  const current = Number.isFinite(currentLateralMeters)
    ? currentLateralMeters
    : previous;
  const lateralSpeed = clamp(
    (current - previous) / RIVAL_FIXED_STEP_SECONDS,
    -5.2,
    5.2,
  );
  const bend = Number.isFinite(curvature) ? clamp(curvature, -1, 1) : 0;
  const bank = clamp(-lateralSpeed * 0.022 - bend * 0.09, -0.2, 0.2);
  return Math.abs(bank) < 1e-9 ? 0 : bank;
}

/** @param {RivalState} state */
export function recoverInvalidRivalState(state) {
  const invalid = !Number.isFinite(state.raceDistanceMeters)
    || !Number.isFinite(state.speedMetersPerSecond)
    || !Number.isFinite(state.lateralMeters)
    || !Number.isFinite(state.elapsedSeconds);
  if (!invalid) return false;
  state.raceDistanceMeters = state.lastSafeDistanceMeters;
  state.courseDistanceMeters = state.lastSafeDistanceMeters;
  state.speedMetersPerSecond = state.lastSafeSpeedMetersPerSecond;
  state.lateralMeters = state.lastSafeLateralMeters;
  state.elapsedSeconds = state.lastSafeElapsedSeconds;
  state.fixedStepRemainderSeconds = 0;
  state.recoveryCount += 1;
  return true;
}

/**
 * @param {RivalState} state
 * @param {{
 *   deltaSeconds: number;
 *   targetLateralMeters?: number;
 *   laneHalfWidthMeters?: number;
 *   courseSpeedFactor?: number;
 * }} input
 */
export function stepRivalState(state, input) {
  if (state.finished) return state;
  recoverInvalidRivalState(state);
  const deltaSeconds = Number.isFinite(input.deltaSeconds)
    ? clamp(input.deltaSeconds, 0, 0.25)
    : 0;
  state.fixedStepRemainderSeconds += deltaSeconds;
  const profile = profileForId(state.profileId);
  while (state.fixedStepRemainderSeconds + 1e-12 >= RIVAL_FIXED_STEP_SECONDS) {
    state.fixedStepRemainderSeconds -= RIVAL_FIXED_STEP_SECONDS;
    const previousDistance = state.raceDistanceMeters;
    const previousElapsed = state.elapsedSeconds;
    const speedFactor = typeof input.courseSpeedFactor === "number"
      && Number.isFinite(input.courseSpeedFactor)
      ? clamp(input.courseSpeedFactor, 0.72, 1.05)
      : 1;
    const paceWave = Math.sin(
      state.elapsedSeconds * 0.37 + profile.pacePhaseRadians,
    ) * profile.paceVariationMetersPerSecond;
    const targetSpeed = Math.max(
      0,
      (profile.cruiseSpeedMetersPerSecond + paceWave) * speedFactor,
    );
    const acceleration = targetSpeed >= state.speedMetersPerSecond
      ? profile.accelerationMetersPerSecondSquared
      : profile.brakingMetersPerSecondSquared;
    state.speedMetersPerSecond = moveToward(
      state.speedMetersPerSecond,
      targetSpeed,
      acceleration * RIVAL_FIXED_STEP_SECONDS,
    );
    state.raceDistanceMeters += state.speedMetersPerSecond * RIVAL_FIXED_STEP_SECONDS;
    state.elapsedSeconds += RIVAL_FIXED_STEP_SECONDS;

    const laneHalfWidth = typeof input.laneHalfWidthMeters === "number"
      && Number.isFinite(input.laneHalfWidthMeters)
      ? Math.max(0, input.laneHalfWidthMeters)
      : 8;
    const targetLateral = typeof input.targetLateralMeters === "number"
      && Number.isFinite(input.targetLateralMeters)
      ? clamp(input.targetLateralMeters, -laneHalfWidth, laneHalfWidth)
      : clamp(profile.startingLateralMeters, -laneHalfWidth, laneHalfWidth);
    state.lateralMeters = moveToward(
      state.lateralMeters,
      targetLateral,
      profile.lateralSpeedMetersPerSecond * RIVAL_FIXED_STEP_SECONDS,
    );
    state.lateralMeters = clamp(state.lateralMeters, -laneHalfWidth, laneHalfWidth);

    const completedBefore = Math.max(0, Math.floor(previousDistance / state.courseLengthMeters));
    const completedAfter = Math.min(
      state.totalLaps,
      Math.max(0, Math.floor(state.raceDistanceMeters / state.courseLengthMeters)),
    );
    for (let completed = completedBefore + 1; completed <= completedAfter; completed += 1) {
      const boundary = completed * state.courseLengthMeters;
      const travelled = state.raceDistanceMeters - previousDistance;
      const crossingAmount = travelled > 0
        ? clamp((boundary - previousDistance) / travelled, 0, 1)
        : 1;
      const crossingTime = previousElapsed + crossingAmount * RIVAL_FIXED_STEP_SECONDS;
      state.lapTimesSeconds.push(crossingTime - state.lastLapCrossingTimeSeconds);
      state.lastLapCrossingTimeSeconds = crossingTime;
      if (completed === state.totalLaps) {
        state.finished = true;
        state.finishTimeSeconds = crossingTime;
        state.raceDistanceMeters = boundary;
        state.speedMetersPerSecond = 0;
      }
    }
    state.completedLaps = completedAfter;
    state.lap = Math.min(state.totalLaps, completedAfter + 1);
    state.courseDistanceMeters = ((state.raceDistanceMeters % state.courseLengthMeters)
      + state.courseLengthMeters) % state.courseLengthMeters;
    state.lastSafeDistanceMeters = state.raceDistanceMeters;
    state.lastSafeSpeedMetersPerSecond = state.speedMetersPerSecond;
    state.lastSafeLateralMeters = state.lateralMeters;
    state.lastSafeElapsedSeconds = state.elapsedSeconds;
    if (state.finished) break;
  }
  if (state.fixedStepRemainderSeconds < 1e-12) state.fixedStepRemainderSeconds = 0;
  return state;
}

/**
 * @param {{
 *   progress: number;
 *   lap: number;
 *   totalLaps: number;
 *   courseLengthMeters: number;
 *   nextCheckpointProgress?: number | null;
 *   finished?: boolean;
 * }} input
 */
export function playerRaceDistanceMeters(input) {
  const length = Math.max(1, input.courseLengthMeters);
  const laps = Math.max(1, Math.floor(input.totalLaps));
  if (input.finished) return length * laps;
  const lap = clamp(Math.floor(input.lap), 1, laps);
  const progress = Number.isFinite(input.progress)
    ? ((input.progress % 1) + 1) % 1
    : 0;
  const checkpointProgress = input.nextCheckpointProgress;
  const needsExtraCircuit = checkpointProgress !== null
    && checkpointProgress !== undefined
    && Number.isFinite(checkpointProgress)
    && progress > (((checkpointProgress % 1) + 1) % 1) + 0.002;
  const validatedCircuits = Math.max(
    0,
    (lap - 1) + progress - (needsExtraCircuit ? 1 : 0),
  );
  return Math.min(length * laps, validatedCircuits * length);
}

/**
 * Presentation-only distance travelled after a rival crosses the finish. The
 * rival decelerates to rest, then its visual is removed from the live course.
 * @param {number} ageSeconds
 * @param {number} crossingSpeedMetersPerSecond
 */
export function rivalFinishRunOutDistanceMeters(
  ageSeconds,
  crossingSpeedMetersPerSecond,
) {
  const age = clamp(ageSeconds, 0, RIVAL_FINISH_RUN_OUT_SECONDS);
  const speed = Math.max(0, crossingSpeedMetersPerSecond);
  return speed * (
    age - age * age / (2 * RIVAL_FINISH_RUN_OUT_SECONDS)
  );
}

/**
 * @template {RaceEntry} T
 * @param {ReadonlyArray<T>} entries
 * @returns {T[]}
 */
export function rankRaceEntries(entries) {
  return [...entries].sort((a, b) => {
    if (a.finished && b.finished) {
      const timeDifference = (a.finishTimeSeconds ?? Infinity)
        - (b.finishTimeSeconds ?? Infinity);
      if (Math.abs(timeDifference) > 1e-9) return timeDifference;
    } else if (a.finished !== b.finished) {
      return a.finished ? -1 : 1;
    } else {
      const distanceDifference = b.raceDistanceMeters - a.raceDistanceMeters;
      if (Math.abs(distanceDifference) > 1e-9) return distanceDifference;
    }
    return a.id.localeCompare(b.id);
  });
}

/**
 * @param {ReadonlyArray<RaceEntry>} entries
 * @param {string} playerId
 */
export function calculateRaceGaps(entries, playerId) {
  const ordered = rankRaceEntries(entries);
  const playerIndex = ordered.findIndex((entry) => entry.id === playerId);
  if (playerIndex < 0) throw new Error(`Race field is missing ${playerId}.`);
  const player = ordered[playerIndex];
  /** @param {RaceEntry} first @param {RaceEntry} second */
  const gapMilliseconds = (first, second) => {
    if (
      first.finished
      && second.finished
      && first.finishTimeSeconds !== null
      && first.finishTimeSeconds !== undefined
      && second.finishTimeSeconds !== null
      && second.finishTimeSeconds !== undefined
    ) return Math.abs(first.finishTimeSeconds - second.finishTimeSeconds) * 1000;
    const speed = Math.max(
      12,
      first.speedMetersPerSecond ?? 0,
      second.speedMetersPerSecond ?? 0,
    );
    return Math.abs(first.raceDistanceMeters - second.raceDistanceMeters) / speed * 1000;
  };
  const ahead = playerIndex > 0 ? ordered[playerIndex - 1] : null;
  const behind = playerIndex < ordered.length - 1 ? ordered[playerIndex + 1] : null;
  return {
    ordered,
    position: playerIndex + 1,
    racerCount: ordered.length,
    gapToAheadMs: ahead ? gapMilliseconds(player, ahead) : null,
    gapToBehindMs: behind ? gapMilliseconds(player, behind) : null,
  };
}

/** @param {string} rivalId @param {string} otherId */
export function chooseOvertakeSide(rivalId, otherId) {
  return rivalId.localeCompare(otherId) <= 0 ? -1 : 1;
}

/**
 * @param {string} rivalId
 * @param {string} otherId
 * @param {number} baseLateralMeters
 */
export function chooseOvertakeOffset(rivalId, otherId, baseLateralMeters) {
  return baseLateralMeters + chooseOvertakeSide(rivalId, otherId) * 2.8;
}
