/** @param {number} value */
function wrapProgress(value) {
  return ((value % 1) + 1) % 1;
}

/** @param {number} remainingSeconds */
export function resolveCountdownStage(remainingSeconds) {
  if (!Number.isFinite(remainingSeconds) || remainingSeconds <= 0) return "";
  if (remainingSeconds <= 1) return "GO";
  return String(Math.ceil(remainingSeconds - 1));
}

/** @param {number} previousProgress @param {number} currentProgress */
export function forwardProgressDelta(previousProgress, currentProgress) {
  let delta = wrapProgress(currentProgress) - wrapProgress(previousProgress);
  if (delta > 0.5) delta -= 1;
  if (delta < -0.5) delta += 1;
  return delta;
}

/**
 * @param {number} previousProgress
 * @param {number} currentProgress
 * @param {number} targetProgress
 * @param {number} [tolerance]
 */
export function crossedForwardProgress(
  previousProgress,
  currentProgress,
  targetProgress,
  tolerance = 0.0015,
) {
  const travelled = forwardProgressDelta(previousProgress, currentProgress);
  if (travelled <= 0) return false;
  const distanceToTarget = wrapProgress(targetProgress - previousProgress);
  return distanceToTarget <= travelled + tolerance;
}

/**
 * A checkpoint behind the vehicle requires another complete circuit before the
 * current lap can be validated.
 * @param {number} progress
 * @param {number | null} nextCheckpointProgress
 */
export function checkpointRequiresExtraCircuit(progress, nextCheckpointProgress) {
  if (nextCheckpointProgress === null) return false;
  return wrapProgress(progress) > wrapProgress(nextCheckpointProgress) + 0.002;
}

/**
 * @param {number} progress
 * @param {number} lap
 * @param {number} totalLaps
 * @param {number} courseLength
 * @param {number | null} nextCheckpointProgress
 */
export function calculateFinishDistanceMeters(
  progress,
  lap,
  totalLaps,
  courseLength,
  nextCheckpointProgress,
) {
  const currentCircuitRemaining = 1 - wrapProgress(progress);
  const laterLaps = Math.max(0, totalLaps - Math.max(1, lap));
  const missedCircuit = checkpointRequiresExtraCircuit(
    progress,
    nextCheckpointProgress,
  ) ? 1 : 0;
  return Math.max(
    0,
    (currentCircuitRemaining + laterLaps + missedCircuit) * courseLength,
  );
}

/**
 * @param {number} offCourseSeconds
 * @param {number} recoveryHoldSeconds
 */
export function calculateRecoveryTelemetry(
  offCourseSeconds,
  recoveryHoldSeconds,
) {
  const holdSeconds = Number.isFinite(recoveryHoldSeconds)
    ? Math.max(0.001, recoveryHoldSeconds)
    : 0.001;
  const elapsedSeconds = Number.isFinite(offCourseSeconds)
    ? Math.min(holdSeconds, Math.max(0, offCourseSeconds))
    : 0;
  return {
    active: elapsedSeconds > 0,
    progress: elapsedSeconds / holdSeconds,
    remainingSeconds: Math.max(0, holdSeconds - elapsedSeconds),
  };
}

/**
 * @param {number} distance
 * @param {number} lateral
 * @param {number} hazardDistance
 * @param {number} hazardLateral
 * @param {number} courseLength
 * @param {number} [distanceRadius]
 * @param {number} [lateralRadius]
 */
export function isCircularHazardContact(
  distance,
  lateral,
  hazardDistance,
  hazardLateral,
  courseLength,
  distanceRadius = 3.2,
  lateralRadius = 3.1,
) {
  const distanceDelta = Math.abs(
    ((distance - hazardDistance + courseLength / 2) % courseLength
      + courseLength) % courseLength
      - courseLength / 2,
  );
  return distanceDelta <= distanceRadius
    && Math.abs(lateral - hazardLateral) <= lateralRadius;
}
