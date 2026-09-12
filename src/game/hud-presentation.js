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
 * @param {number} position
 * @param {number} racerCount
 */
export function formatRacePosition(position, racerCount) {
  const count = Number.isFinite(racerCount)
    ? Math.max(1, Math.floor(racerCount))
    : 1;
  const place = Number.isFinite(position)
    ? Math.min(count, Math.max(1, Math.floor(position)))
    : count;
  return `P${place} / ${count}`;
}

/**
 * @param {number} position
 * @param {number | null} gapToAheadMs
 * @param {number | null} gapToBehindMs
 */
export function formatRaceGap(position, gapToAheadMs, gapToBehindMs) {
  if (position <= 1) {
    return Number.isFinite(gapToBehindMs) && gapToBehindMs !== null
      ? `${(Math.max(0, gapToBehindMs) / 1000).toFixed(2)} CLEAR`
      : "FIELD LEAD";
  }
  return Number.isFinite(gapToAheadMs) && gapToAheadMs !== null
    ? `+${(Math.max(0, gapToAheadMs) / 1000).toFixed(2)} TO P${Math.max(1, position - 1)}`
    : "GAP ACQUIRING";
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

/**
 * `mm:ss.mmm`. Lives here rather than in `ui.ts` because
 * {@link resolveTimingPresentation} composes the secondary line out of it and
 * that helper has to stay runnable under Node — `validate:hud` asserts its
 * four cases, and a helper that reached into the DOM module could not be
 * asserted at all. `ui.ts` re-exports it, so every existing caller is
 * unchanged.
 * @param {number} milliseconds
 */
export function formatRaceTime(milliseconds) {
  const safe = Math.max(0, Math.floor(milliseconds));
  const minutes = Math.floor(safe / 60_000);
  const seconds = Math.floor((safe % 60_000) / 1_000);
  const millis = safe % 1_000;
  return `${minutes.toString().padStart(2, "0")}:${seconds
    .toString()
    .padStart(2, "0")}.${millis.toString().padStart(3, "0")}`;
}

/**
 * What the clock block says, per format.
 *
 * A time attack is scored on ONE lap, so the total elapsed is the least useful
 * number the block can lead with: at 4:12 into a five-lap solo run the driver
 * is asking "how is THIS lap going", and the delta chip below already answers
 * it against the record. The tag moves with the number so the two can never
 * disagree — a block that reads `RACE TIME` over a lap clock would be worse
 * than the total it replaced.
 *
 * Race and sprint are byte-for-byte what they were: the same tag, the same
 * clock, the same ` · LAST mm:ss.mmm` secondary that appears on the first
 * completed lap.
 *
 * @param {string} mode the resolved race mode
 * @param {number} elapsedMs total race time
 * @param {number} lapElapsedMs time on the current lap
 * @param {number | null} lastLapMs the last completed lap, or null
 * @returns {{ tag: string; clockMs: number; secondary: string }}
 */
export function resolveTimingPresentation(mode, elapsedMs, lapElapsedMs, lastLapMs) {
  const last = lastLapMs === null ? "" : ` · LAST ${formatRaceTime(lastLapMs)}`;
  if (mode !== "timeattack") {
    return { tag: "RACE TIME", clockMs: elapsedMs, secondary: last };
  }
  return {
    tag: "LAP TIME",
    clockMs: lapElapsedMs,
    secondary: `TOTAL ${formatRaceTime(elapsedMs)}${last}`,
  };
}
