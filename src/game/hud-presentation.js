/** @typedef {"running" | "final" | "approach"} RaceStage */

/**
 * Initializes the dimmed HUD behind the launch screen from the requested race
 * format so it never contradicts the intro copy before the first HUD update.
 * @param {number} totalLaps
 * @param {number} courseLengthMeters
 */
export function resolveInitialRacePresentation(totalLaps, courseLengthMeters) {
  const laps = Number.isFinite(totalLaps)
    ? Math.max(1, Math.floor(totalLaps))
    : 1;
  const courseLength = Number.isFinite(courseLengthMeters)
    ? Math.max(0, courseLengthMeters)
    : 0;
  return {
    totalLaps: laps,
    lapLabel: `LAP 1 / ${laps}`,
    finishLabel: resolveFinishPresentation(
      courseLength * laps,
      1,
      laps,
      false,
    ).label,
  };
}

/**
 * Keeps the finish readout stable at race speed: kilometres for the long view,
 * ten-metre steps once the finish is close enough to act on.
 * @param {number} finishDistanceMeters
 */
function formatFinishDistance(finishDistanceMeters) {
  const distance = Number.isFinite(finishDistanceMeters)
    ? Math.max(0, finishDistanceMeters)
    : 0;
  return distance >= 1000
    ? `${(distance / 1000).toFixed(1)} KM`
    : `${Math.ceil(distance / 10) * 10} M`;
}

/**
 * @param {number} finishDistanceMeters
 * @param {number} lap
 * @param {number} totalLaps
 * @param {boolean} finishArmed
 * @returns {{ label: string; finalLap: boolean; finalApproach: boolean }}
 */
export function resolveFinishPresentation(
  finishDistanceMeters,
  lap,
  totalLaps,
  finishArmed,
) {
  const finalLap = lap === totalLaps;
  const finalApproach = finishArmed && finalLap;
  const distance = formatFinishDistance(finishDistanceMeters);
  return {
    label: finalApproach ? `${distance} · THE CRADLE` : `${distance} TO FINISH`,
    finalLap,
    finalApproach,
  };
}

/**
 * @param {boolean} finishArmed
 * @param {number} lap
 * @param {number} totalLaps
 * @returns {RaceStage}
 */
export function resolveRaceStage(finishArmed, lap, totalLaps) {
  if (finishArmed && lap === totalLaps) return "approach";
  if (totalLaps > 1 && lap === totalLaps) return "final";
  return "running";
}

/**
 * The reserve meter communicates depletion lockout independently from vehicle
 * boost, because a course pad can still boost TOTEM while manual boost is locked.
 * @param {boolean} boostActive
 * @param {boolean} boostLocked
 * @returns {{ label: string; state: "ready" | "active" | "locked" }}
 */
export function resolveBoostPresentation(boostActive, boostLocked) {
  if (boostLocked) return { label: "BOOST LOCKOUT · RELEASE", state: "locked" };
  if (boostActive) return { label: "PLASMA DISCHARGE", state: "active" };
  return { label: "PLASMA RESERVE", state: "ready" };
}
