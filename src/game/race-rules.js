/** @param {number} value */
function wrapProgress(value) {
  return ((value % 1) + 1) % 1;
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
