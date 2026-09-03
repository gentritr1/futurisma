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

/**
 * Hard turns need enough warning to react at race speed, while a fixed minimum
 * keeps the instruction useful after braking has already begun.
 * @param {number} distanceMeters
 * @param {number} speedMetersPerSecond
 * @param {boolean} hardTurn
 */
export function isTurnCueUrgent(distanceMeters, speedMetersPerSecond, hardTurn) {
  if (!hardTurn || !Number.isFinite(distanceMeters) || !Number.isFinite(speedMetersPerSecond)) {
    return false;
  }
  return distanceMeters <= Math.max(140, Math.max(0, speedMetersPerSecond) * 2.4);
}

/**
 * Warn before an open runoff begins, without changing the collision boundary.
 * @param {number} lateralMeters
 * @param {number} halfWidthMeters
 * @param {number} [roadInsetMeters]
 * @param {number} [warningMarginMeters]
 */
export function isOpenEdgeWarningActive(
  lateralMeters,
  halfWidthMeters,
  roadInsetMeters = 2.05,
  warningMarginMeters = 1.6,
) {
  if (!Number.isFinite(lateralMeters) || !Number.isFinite(halfWidthMeters)) return false;
  const roadLimit = Math.max(0, halfWidthMeters - Math.max(0, roadInsetMeters));
  const warningLimit = Math.max(0, roadLimit - Math.max(0, warningMarginMeters));
  return Math.abs(lateralMeters) > warningLimit;
}

/**
 * Builds evidence for a real route reversal while rejecting low-speed rotation,
 * brief impacts, and the large heading changes required by authored hairpins.
 * @param {number} previousEvidenceSeconds
 * @param {number} courseAlignment
 * @param {number} speedMetersPerSecond
 * @param {number} deltaSeconds
 */
export function integrateWrongWayEvidence(
  previousEvidenceSeconds,
  courseAlignment,
  speedMetersPerSecond,
  deltaSeconds,
) {
  const evidence = Number.isFinite(previousEvidenceSeconds)
    ? Math.max(0, previousEvidenceSeconds)
    : 0;
  const delta = Number.isFinite(deltaSeconds)
    ? Math.min(0.1, Math.max(0, deltaSeconds))
    : 0;
  if (!Number.isFinite(courseAlignment) || !Number.isFinite(speedMetersPerSecond)) return 0;
  if (speedMetersPerSecond >= 8 && courseAlignment <= -0.35) {
    return Math.min(1.5, evidence + delta);
  }
  const releaseRate = speedMetersPerSecond < 8 || courseAlignment >= 0.1 ? 2.5 : 0.5;
  return Math.max(0, evidence - delta * releaseRate);
}

/** @param {boolean} previousActive @param {number} evidenceSeconds */
export function resolveWrongWayActive(previousActive, evidenceSeconds) {
  const evidence = Number.isFinite(evidenceSeconds) ? Math.max(0, evidenceSeconds) : 0;
  return evidence >= (previousActive ? 0.18 : 0.65);
}

/**
 * A closed course can wrap its look-ahead into the next lap. Once the final
 * gate is armed, instructions beyond the finish line must stay hidden.
 * @param {number} turnDistanceMeters
 * @param {number} finishDistanceMeters
 * @param {boolean} finalFinishArmed
 */
export function isTurnCueBeyondFinish(
  turnDistanceMeters,
  finishDistanceMeters,
  finalFinishArmed,
) {
  return finalFinishArmed
    && Number.isFinite(turnDistanceMeters)
    && Number.isFinite(finishDistanceMeters)
    && turnDistanceMeters > Math.max(0, finishDistanceMeters);
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
 * P11 — how long a missed gate is left on screen before the craft is handed to
 * the recovery flow.
 *
 * A miss freezes `nextCheckpointIndex` by design, and on an A edge nothing else
 * ever fires: the run-off is legal, so `offCourseTime` never accumulates and
 * the automatic recovery never arms. Before this the banner simply stayed up
 * for the rest of the race. The grace exists so the player *sees* the gate go
 * past before the world resets, and it is skipped when the craft is already
 * slow, because standing still staring at a banner is the same softlock.
 */
export const GATE_MISS_RECOVERY_GRACE_SECONDS = 1;
/** Below this the miss is already obvious; recover on the next step. */
export const GATE_MISS_RECOVERY_INSTANT_SPEED_MPS = 15;

/** @param {number} speedMetersPerSecond */
export function resolveGateMissRecoveryDelay(speedMetersPerSecond) {
  if (!Number.isFinite(speedMetersPerSecond)) return 0;
  return speedMetersPerSecond < GATE_MISS_RECOVERY_INSTANT_SPEED_MPS
    ? 0
    : GATE_MISS_RECOVERY_GRACE_SECONDS;
}

export const HAZARD_CONTACT_DISTANCE_RADIUS_METERS = 3.2;
export const HAZARD_CONTACT_LATERAL_RADIUS_METERS = 3.1;

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
  distanceRadius = HAZARD_CONTACT_DISTANCE_RADIUS_METERS,
  lateralRadius = HAZARD_CONTACT_LATERAL_RADIUS_METERS,
) {
  const distanceDelta = Math.abs(
    ((distance - hazardDistance + courseLength / 2) % courseLength
      + courseLength) % courseLength
      - courseLength / 2,
  );
  return distanceDelta <= distanceRadius
    && Math.abs(lateral - hazardLateral) <= lateralRadius;
}

/* ---------------------------------------------------------------------------
 * G2 near miss — the reward for racing close.
 *
 * G1 gave the player a slipstream but nothing at all for the risk of using it.
 * The near miss is the other half: a pass completed close enough to be a real
 * decision, and fast enough to be a real pass, pays reserve.
 *
 * The band is deliberately bounded at BOTH ends. Below
 * NEAR_MISS_LATERAL_MINIMUM_METERS the craft are inside the G2 air cushion and
 * the player is leaning on the rival to get by, which is contact — it reads as
 * one on screen and it pays nothing. Above NEAR_MISS_LATERAL_MAXIMUM_METERS the
 * pass was made in clear air and needs no reward. The speed gate keeps a crawl
 * past a parked craft from farming it.
 * ------------------------------------------------------------------------- */
export const NEAR_MISS_LATERAL_MINIMUM_METERS = 1.6;
export const NEAR_MISS_LATERAL_MAXIMUM_METERS = 3.2;
/** Share of BOOST_MAX_SPEED the pass has to be made at. */
export const NEAR_MISS_SPEED_RATIO = 0.6;
export const NEAR_MISS_REWARD = 0.12;
/**
 * The cable-coil variant, and the one place this phase had to interpret its
 * brief rather than implement it.
 *
 * The brief asks for "passing a cable coil within 2.5 m without tripping". As
 * written that is unreachable: `isCircularHazardContact` trips the coil at any
 * lateral inside HAZARD_CONTACT_LATERAL_RADIUS_METERS (3.1 m), so every pass
 * within 2.5 m of the coil's centre line is a strike, not a near miss. The
 * window is therefore measured OUTWARD FROM THE TRIP BOUNDARY: 2.5 m of clear
 * air beyond the radius that would otherwise have cost the player 42% of its
 * speed. In centre-line terms that is 3.1 m to 5.6 m.
 */
export const HAZARD_NEAR_MISS_MARGIN_METERS = 2.5;
export const HAZARD_NEAR_MISS_REWARD = 0.06;

/**
 * Scores one completed pass.
 *
 * Pure and total: every input lands in exactly one of the three outcomes, so
 * the caller never has to guess what a gap of NaN or a pass at walking pace
 * means.
 *
 * @param {number} lateralGapMeters signed gap at the crossing; only |gap| is read
 * @param {number} speedRatio player speed over BOOST_MAX_SPEED
 * @param {"rival" | "hazard"} [kind] a rival pass, or a cable coil left standing
 * @returns {{ reward: number, outcome: "near-miss" | "contact" | "none" }}
 *   `contact` is reported rather than silently dropped, so the race loop can
 *   tell "too close to pay" apart from "nowhere near anything".
 */
export function resolveNearMiss(lateralGapMeters, speedRatio, kind = "rival") {
  /** @type {{ reward: number, outcome: "near-miss" | "contact" | "none" }} */
  const none = { reward: 0, outcome: "none" };
  /** @type {{ reward: number, outcome: "near-miss" | "contact" | "none" }} */
  const contact = { reward: 0, outcome: "contact" };
  if (!Number.isFinite(lateralGapMeters) || !Number.isFinite(speedRatio)) return none;
  const gap = Math.abs(lateralGapMeters);
  if (kind === "hazard") {
    // A coil that was actually struck is not this function's business; the
    // caller only asks about coils it got past. Anything beyond the margin is a
    // pass in clear air and pays nothing.
    if (gap < HAZARD_CONTACT_LATERAL_RADIUS_METERS) return contact;
    if (
      gap > HAZARD_CONTACT_LATERAL_RADIUS_METERS + HAZARD_NEAR_MISS_MARGIN_METERS
      || speedRatio < NEAR_MISS_SPEED_RATIO
    ) return none;
    return { reward: HAZARD_NEAR_MISS_REWARD, outcome: "near-miss" };
  }
  // Inside the cushion. This is the case the phase exists to distinguish: the
  // player did get past, but by leaning on the other craft, and a lean does not
  // pay — whatever speed it was made at.
  if (gap < NEAR_MISS_LATERAL_MINIMUM_METERS) return contact;
  if (gap > NEAR_MISS_LATERAL_MAXIMUM_METERS || speedRatio < NEAR_MISS_SPEED_RATIO) {
    return none;
  }
  return { reward: NEAR_MISS_REWARD, outcome: "near-miss" };
}

/* ---------------------------------------------------------------------------
 * G2 clean-gate chain — the reward for racing tidy.
 *
 * The near miss pays for one brave move. The chain pays for a whole lap of
 * discipline, and it pays in the same currency so the two trade against each
 * other: a driver can take the wide line into a gate to set up a pass, and lose
 * the chain doing it.
 *
 * A chain survives only a clean gate. An off-centre crossing resets it
 * SILENTLY — the gate was legal, nothing went wrong, and a warning for driving
 * a normal racing line would be noise — while a MISS resets it on top of the
 * missed-gate banner that already fires.
 * ------------------------------------------------------------------------- */
export const CLEAN_GATE_LATERAL_FRACTION = 0.35;
/**
 * Passive-regen multiplier by chain length: no bonus for the first gate, then
 * three steps to the cap. Indexed directly by chain, clamped at the end.
 *
 * Chain 1 pays nothing on purpose. One tidy gate is not a chain, and paying for
 * it would make the counter flicker on and off through every normal lap.
 */
export const CLEAN_GATE_REGEN_MULTIPLIERS = Object.freeze([1, 1, 1.15, 1.3, 1.5]);

/** @param {number} chain */
export function cleanGateRegenMultiplier(chain) {
  const length = Number.isFinite(chain) ? Math.max(0, Math.floor(chain)) : 0;
  return CLEAN_GATE_REGEN_MULTIPLIERS[
    Math.min(length, CLEAN_GATE_REGEN_MULTIPLIERS.length - 1)
  ];
}

/**
 * Advances the clean-gate chain across one gate crossing.
 *
 * @param {number} previousChain
 * @param {{
 *   lateralMeters: number;
 *   gateHalfWidthMeters: number;
 *   missed?: boolean;
 * }} crossing
 * @returns {{ chain: number, clean: boolean, multiplier: number }}
 */
export function resolveCleanGateChain(previousChain, crossing) {
  const chain = Number.isFinite(previousChain)
    ? Math.max(0, Math.floor(previousChain))
    : 0;
  const lateral = Number.isFinite(crossing?.lateralMeters)
    ? Math.abs(crossing.lateralMeters)
    : Infinity;
  const halfWidth = Number.isFinite(crossing?.gateHalfWidthMeters)
    ? Math.max(0, crossing.gateHalfWidthMeters)
    : 0;
  // A miss can never leave the chain standing, whatever the lateral was: the
  // craft is outside the gate, so "0.35 of the gate half-width" is not even a
  // question that applies to it. `validate-race-rules.mjs` probes this
  // directly, because getting it wrong is invisible — the chain would simply
  // read one higher than it earned.
  if (crossing?.missed) {
    return { chain: 0, clean: false, multiplier: cleanGateRegenMultiplier(0) };
  }
  const clean = lateral <= CLEAN_GATE_LATERAL_FRACTION * halfWidth;
  const next = clean ? chain + 1 : 0;
  return { chain: next, clean, multiplier: cleanGateRegenMultiplier(next) };
}
