import {
  BOOST_RESERVE_CUTOFF,
  BOOST_RESERVE_DRAIN_RATE,
  BOOST_RESERVE_REGEN_RATE,
  DRIFT_RELEASE_REWARD,
} from "./physics.js";

export const RIVAL_FIXED_STEP_SECONDS = 1 / 120;
export const RIVAL_FINISH_RUN_OUT_SECONDS = 3;

/**
 * G1 rival tool set. A rival now runs the same four economies the player does —
 * pad boost, a reserve spent in authored windows, a drift that pays that
 * reserve back, and a lane contest — so the field is raced rather than paced.
 *
 * Every rate below is either imported from `physics.js` (so the rival economy
 * cannot drift away from the player's) or derived from a measurement printed by
 * `scripts/rival-pace-calibration.mjs`. Nothing here is a guess.
 */

/** Matches the player's pad window in `game.ts` (`this.padBoostTime = 0.38`). */
export const RIVAL_PAD_BOOST_SECONDS = 0.38;
/** Pad and reserve boost both lift the authored pace target by this much. */
export const RIVAL_BOOST_SPEED_GAIN = 0.3;
/**
 * Boost also buys the drive to reach that target inside a window.
 *
 * Sized off the launch, which is where it matters most: the player's own
 * standing start costs 2.48 s against a craft already at 86 m/s
 * (`node scripts/visual/launch-probe.mjs`), and a rival's authored acceleration
 * alone costs 3.30 s. At 3.2 it costs 1.03 s, which is what lets lap one be a
 * race rather than a procession while the pace block's corner scrub is
 * re-solved to leave the five-lap total where it was.
 */
export const RIVAL_BOOST_ACCELERATION_GAIN = 3.2;
/** Reserve rates are the player's, imported so one edit moves both. */
export const RIVAL_BOOST_RESERVE_DRAIN_RATE = BOOST_RESERVE_DRAIN_RATE;
export const RIVAL_BOOST_RESERVE_REGEN_RATE = BOOST_RESERVE_REGEN_RATE;
export const RIVAL_BOOST_RESERVE_CUTOFF = BOOST_RESERVE_CUTOFF;
/** One committed corner pays the player's drift reward, once, on release. */
export const RIVAL_DRIFT_RELEASE_REWARD = DRIFT_RELEASE_REWARD;
/** Drift releases at this share of the entry threshold, so a corner is one drift. */
export const RIVAL_DRIFT_EXIT_FRACTION = 0.72;
/** Seconds for the presentation drift signal to travel its full range. */
export const RIVAL_DRIFT_RESPONSE_RATE = 3.4;
/** Extra roll into the bend at full drift, on top of the P2 curvature lean. */
export const RIVAL_DRIFT_BANK_GAIN = 0.11;
/** Extra airbrake travel at full drift, as a share of the authored 60 deg. */
export const RIVAL_DRIFT_AIRBRAKE_GAIN = 0.42;

/** Half a craft plus its cushion; the fleet and the free-deck rule share it. */
export const VEHICLE_CLEARANCE_METERS = 2.2;

/** The id the player races under, shared by the fleet and the gap maths. */
export const PLAYER_RACE_ID = "player";

/*
 * The launch.
 *
 * G1 first tried to solve the start by fanning the field out of its grid slots
 * over the opening 320 m. That made it worse: three craft and the player all
 * changing lane at once, off a grid whose own slots are as little as 0.4 m
 * apart, put two hulls 0.07 m from each other at 165 m on Bitterpan and 0.09 m
 * at 201 m on Greenwater. Nobody was misbehaving - the lane rules were all
 * satisfied - there was simply no room and no time.
 *
 * So the launch does the opposite now. The grid is fanned ONCE, before anyone
 * moves, to at least RIVAL_GRID_MINIMUM_SPACING_METERS between every slot
 * including the player's; then every rival holds the slot it was given, with
 * its lateral rate pinned at zero, until RIVAL_GRID_HOLD_METERS of race
 * distance and ramped back to the authored rate by RIVAL_GRID_RELEASE_METERS.
 * Nothing converges because nothing moves, and by the time the field is allowed
 * to change lane it is strung out along the track instead of stacked across it.
 */

/** Race distance up to which a rival holds its grid slot exactly. */
export const RIVAL_GRID_HOLD_METERS = 180;
/** ... and by which it has its full authored lateral rate back. */
export const RIVAL_GRID_RELEASE_METERS = 260;
/** Minimum gap between any two grid slots, the player's included. */
export const RIVAL_GRID_MINIMUM_SPACING_METERS = 3.2;
/** How far off its lane a rival will go to collect an authored pad. */
export const RIVAL_PAD_LANE_REACH_METERS = 7;
/**
 * How far ahead of a pad a rival starts lining up for it. A rival slides
 * laterally at ~4.6 m/s, so 150 m at race pace is about 1.7 s - enough to cross
 * the ~6 m from an authored lane to an authored pad without the craft looking
 * like it teleported onto the strip.
 */
export const RIVAL_PAD_APPROACH_METERS = 150;

/** PRODUCT.md principle 5: a rival never obstructs the route. */
export const RIVAL_FREE_DECK_FRACTION = 0.4;
/**
 * Extra deck the corridor reserves on top of the rule, so the rule survives the
 * two places the arithmetic is not exact: the deck narrows along a lap (9.5 m
 * to 12 m of half width on Greenwater), and the rivals inside the window are a
 * few metres apart and therefore clamped against slightly different widths.
 * Measured worst case for that mismatch is ~2.6% of the deck; 5% covers it.
 */
export const RIVAL_NO_BLOCK_MARGIN_FRACTION = 0.05;
/** The window the free-deck rule is asserted over: 0-15 m ahead of the player. */
export const RIVAL_NO_BLOCK_WINDOW_METERS = 15;
/**
 * The band is armed far earlier than it is asserted, because a rival moves
 * laterally at ~4.6 m/s and has to be clear of the reserved corridor BEFORE the
 * player arrives in the assertion window. 70 m of arming leaves a rival about
 * 1.8 s even when the player closes at boost speed.
 */
export const RIVAL_NO_BLOCK_ARM_METERS = 70;

/**
 * Stands in for infinity in the one-sided neighbour constraints. Any value well
 * past the widest deck does; it only has to bound the half-line.
 */
const LANE_HALF_LINE_METERS = 1e4;

/**
 * Longitudinal gate: rivals contest a lane inside this much clear road.
 *
 * It was 10 m in P2, which is close to a craft length - by the time the rule
 * fired the pair was already alongside, and with a 4.6 m/s slide rate the
 * ~0.7 s needed to open a gap was spent side by side. A five-lap Bitterpan run
 * measured 0.07 m between two rivals that way. 26 m is roughly a third of a
 * second of closing speed plus the slide time, so the room is made before it
 * is needed.
 */
export const RIVAL_LANE_CONTEST_GAP_METERS = 26;

/**
 * Longitudinal window over which a rival gives the player lateral room. It is
 * generous on purpose: a rival slides at ~4.6 m/s, so at a 30 m/s closing speed
 * 46 m buys it ~1.5 s - enough to be a full car's width clear before the player
 * arrives alongside. Lateral only; nothing here touches a rival's speed.
 */
export const RIVAL_PLAYER_AVOID_GAP_METERS = 46;
/**
 * How much harder a rival slides while the player is inside its clearance.
 *
 * A craft getting out of the way moves decisively. At its authored ~4.6 m/s a
 * rival needs 0.8 s to open the clearance, and a player changing line through
 * a corner does not leave it 0.8 s; that is what left two craft 0.93 m apart at
 * 468 m on Greenwater, on the exit of turn one, with the rival already aimed
 * 3.6 m away. At this gain the same move takes 0.33 s.
 *
 * It is spent ONLY while the player is inside the bubble and only on the
 * player-reactive lane - the player-free lane that pad coverage is resolved
 * against keeps the authored rate - so it cannot reach a rival's speed, and it
 * changes how fast a rival gets to its lane rather than which lane that is.
 *
 * G1 tried this once before against the LAUNCH scrum and reverted it: there it
 * did not help (the crossing was over either way) and it cost free deck. This
 * is the same lever aimed at the case it actually fits, with the launch now
 * handled by holding the grid instead.
 */
export const RIVAL_EVASIVE_LATERAL_GAIN = 4;
/**
 * Lateral room a rival keeps around anything else on the deck.
 *
 * Comfortably over the 2.2 m craft clearance the separation telemetry is held
 * to, so a craft still on its way to the constraint clears the bar too.
 */
export const RIVAL_LANE_CLEARANCE_METERS = 3.6;
/**
 * Longitudinal window in which the lateral clearance is allowed to override the
 * yield corridor: roughly two craft lengths, i.e. genuinely side by side.
 */
export const RIVAL_NO_BLOCK_YIELD_OVERRIDE_METERS = 7;

/**
 * G2 — extra lateral room a rival gives up while the player is leaning on it
 * through the air cushion.
 *
 * The cushion moves the PLAYER; this is the rival's half of the same moment, so
 * the pair separates from both sides rather than the player doing all the work.
 * Round 1 shipped 0.6 m and it was measurably nothing; 1.4 m is the same order
 * as the cushion's own authority, which is what it has to be for the two halves
 * to add up to a hull's width of clearance.
 *
 * It is LATERAL ONLY, and it reaches the rival by shifting the lane it AIMS at,
 * never by widening the forbidden span around the player - see the note in
 * `rivalContestLaneMeters` for why that distinction cost 0.9 points of free
 * deck when it was done the other way. Nothing here can touch a rival's speed,
 * which is what keeps the longitudinal-independence proof in
 * `validate-rivals.mjs` true with the cushion armed.
 */
export const RIVAL_CUSHION_YIELD_METERS = 1.4;
/**
 * ... and what it becomes when the PLAYER cannot move.
 *
 * At the deck edge the apron clamp wins: the cushion asks to push the player
 * outward, the clamp refuses, and the lean has nowhere to go. Without this the
 * pair would simply stay fouled for as long as the player was pinned there,
 * which is the one place a contact is most likely and least escapable. So the
 * rival takes the whole separation instead - enough on its own to clear two
 * hulls, rather than the half it takes on open deck.
 */
export const RIVAL_CUSHION_YIELD_BLOCKED_METERS = 2.8;

/** A rival defends the inside line while the player sits in this gap band. */
export const RIVAL_DEFENCE_MINIMUM_GAP_METERS = 8;
export const RIVAL_DEFENCE_MAXIMUM_GAP_METERS = 25;
/** ... and moves at most this far to do it. */
export const RIVAL_DEFENCE_SHIFT_METERS = 1.6;
/** Distance ahead the defence reads the bend it is defending. */
export const RIVAL_DEFENCE_LOOKAHEAD_METERS = 60;

/**
 * How much of a rival's fin deflection comes from the bend it is sitting in,
 * rather than from chasing its target line. Picked from a five-lap Greenwater
 * measurement (scripts/validate-rivals.mjs prints the distribution): at 0.8 the
 * median deflection is ~2.9 deg, the upper quartile ~8.7 deg and hard bends
 * reach the authored 20 deg limit without pinning there.
 */
export const RIVAL_STEER_CURVATURE_GAIN = 0.8;

/**
 * Seconds of authored acceleration (or braking) that saturate the throttle and
 * airbrake signals. A rival that is more than this far from its authored speed
 * is asking for everything the profile has.
 */
export const RIVAL_DRIVE_RESPONSE_SECONDS = 0.35;

/** Share of the engine-glow drive that tracks cruise speed rather than throttle. */
export const RIVAL_GLOW_SPEED_SHARE = 0.55;

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
 *   lastSafeBoostReserve: number;
 *   paceLateralMeters: number;
 *   recoveryCount: number;
 *   boostReserve: number;
 *   boostActive: boolean;
 *   padBoostSeconds: number;
 *   boostSeconds: number;
 *   padHits: number;
 *   driftActive: boolean;
 *   driftIntensity: number;
 *   driftSeconds: number;
 *   driftEntries: number;
 * }} RivalState
 */

/**
 * @typedef {{
 *   cruiseSpeedMetersPerSecond: number;
 *   padUse: boolean;
 *   boostWindows: readonly { fromMeters: number; toMeters: number }[];
 * }} RivalPaceEntry
 */

/**
 * @typedef {{
 *   cornerSpeedGain: number;
 *   cornerSpeedFloor: number;
 *   driftCurvature: number;
 *   straightCurvature: number;
 *   profiles: Record<string, RivalPaceEntry>;
 * }} RivalPaceTable
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
    lastSafeBoostReserve: 1,
    // The lane the rival would be on with no player in the world. Pads and the
    // rival-versus-rival contest read this and never `lateralMeters`, which is
    // what keeps every rival's lap time independent of the player.
    paceLateralMeters: profile.startingLateralMeters,
    recoveryCount: 0,
    // G1 — the rival half of the player's boost economy. A rival starts the
    // grid with a full reserve exactly as the player does.
    boostReserve: 1,
    boostActive: false,
    padBoostSeconds: 0,
    boostSeconds: 0,
    padHits: 0,
    driftActive: false,
    driftIntensity: 0,
    driftSeconds: 0,
    driftEntries: 0,
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
 * The speed the pacing model wants right now. Extracted so `stepRivalState` and
 * the pose signals below read the identical expression — a rival's airbrakes
 * must never disagree with the speed it is actually holding.
 *
 * @param {RivalState} state
 * @param {RivalProfile} profile
 * @param {number | undefined} courseSpeedFactor
 * @param {number | undefined} [cruiseOverride]
 */
function authoredTargetSpeed(state, profile, courseSpeedFactor, cruiseOverride) {
  const speedFactor = typeof courseSpeedFactor === "number"
    && Number.isFinite(courseSpeedFactor)
    ? clamp(courseSpeedFactor, 0.45, 1.05)
    : 1;
  const paceWave = Math.sin(
    state.elapsedSeconds * 0.37 + profile.pacePhaseRadians,
  ) * profile.paceVariationMetersPerSecond;
  return Math.max(0, (paceCruiseSpeed(profile, cruiseOverride) + paceWave) * speedFactor);
}

/**
 * The cruise the authored pace block asks for, falling back to the profile's
 * own number when a course authors no pace (or a caller passes none). The
 * profile constant is the floor of the fiction — a rival's character — and the
 * per-map block is what makes the same craft competitive on two very different
 * circuits.
 *
 * @param {RivalProfile} profile
 * @param {number | undefined} cruiseOverride
 */
function paceCruiseSpeed(profile, cruiseOverride) {
  return typeof cruiseOverride === "number"
    && Number.isFinite(cruiseOverride)
    && cruiseOverride > 0
    ? cruiseOverride
    : profile.cruiseSpeedMetersPerSecond;
}

/**
 * The speed a rival is actually driving at right now: its authored pace, lifted
 * by {@link RIVAL_BOOST_SPEED_GAIN} while a pad or a reserve window has boost
 * lit. Reads `state.boostActive`, so the pose signals a caller samples before
 * the step and the step itself can never disagree about what the craft wants.
 *
 * @param {RivalState} state
 * @param {RivalProfile} profile
 * @param {{ courseSpeedFactor?: number; cruiseSpeedMetersPerSecond?: number }} input
 */
function driveTargetSpeed(state, profile, input) {
  const base = authoredTargetSpeed(
    state,
    profile,
    input.courseSpeedFactor,
    input.cruiseSpeedMetersPerSecond,
  );
  return state.boostActive ? base * (1 + RIVAL_BOOST_SPEED_GAIN) : base;
}

/**
 * The lane the rival is allowed to aim at, resolved the same way
 * `stepRivalState` resolves it.
 *
 * @param {RivalProfile} profile
 * @param {{ targetLateralMeters?: number; laneHalfWidthMeters?: number }} input
 */
function authoredTargetLateral(profile, input) {
  const laneHalfWidth = typeof input.laneHalfWidthMeters === "number"
    && Number.isFinite(input.laneHalfWidthMeters)
    ? Math.max(0, input.laneHalfWidthMeters)
    : 8;
  return typeof input.targetLateralMeters === "number"
    && Number.isFinite(input.targetLateralMeters)
    ? clamp(input.targetLateralMeters, -laneHalfWidth, laneHalfWidth)
    : clamp(profile.startingLateralMeters, -laneHalfWidth, laneHalfWidth);
}

/**
 * Fin deflection, as a signed fraction of the authored +/-20 deg travel.
 *
 * Two pure terms, both read from state and from the same authored inputs
 * `stepRivalState` receives — never from `(current - previous) / deltaSeconds`,
 * so the signal is identical whatever rate the renderer runs at:
 *   - line chasing: the share of the profile's lateral authority the rival
 *     needs this fixed step to reach its target lane (overtakes saturate it);
 *   - bend holding: a sustained deflection into the curve, so a rival looks
 *     like it is steering through a corner rather than only at turn-in.
 *
 * @param {RivalState} state
 * @param {{
 *   targetLateralMeters?: number;
 *   laneHalfWidthMeters?: number;
 *   curvature?: number;
 * }} input
 * @returns {number} signed, clamped to [-1, 1]
 */
export function rivalSteerSignal(state, input) {
  const profile = profileForId(state.profileId);
  const lateral = Number.isFinite(state.lateralMeters) ? state.lateralMeters : 0;
  const target = authoredTargetLateral(profile, input);
  const reach = profile.lateralSpeedMetersPerSecond * RIVAL_FIXED_STEP_SECONDS;
  const line = reach > 0 ? clamp((target - lateral) / reach, -1, 1) : 0;
  const curvature = typeof input.curvature === "number" ? input.curvature : 0;
  const bend = Number.isFinite(curvature) ? clamp(curvature, -1, 1) : 0;
  return clamp(line - bend * RIVAL_STEER_CURVATURE_GAIN, -1, 1);
}

/**
 * Airbrake demand as a fraction of the authored 60 deg travel: how far the
 * rival is above the speed its pacing model wants, measured in seconds of
 * authored braking.
 *
 * @param {RivalState} state
 * @param {{ courseSpeedFactor?: number; cruiseSpeedMetersPerSecond?: number }} input
 * @returns {number} clamped to [0, 1]
 */
export function rivalBrakeSignal(state, input) {
  const profile = profileForId(state.profileId);
  const speed = Number.isFinite(state.speedMetersPerSecond)
    ? state.speedMetersPerSecond
    : 0;
  const surplus = speed - driveTargetSpeed(state, profile, input);
  const window = profile.brakingMetersPerSecondSquared * RIVAL_DRIVE_RESPONSE_SECONDS;
  return window > 0 ? clamp(surplus / window, 0, 1) : 0;
}

/**
 * Throttle demand, the mirror of {@link rivalBrakeSignal}: how far the rival is
 * below its authored speed, in seconds of authored acceleration.
 *
 * @param {RivalState} state
 * @param {{ courseSpeedFactor?: number; cruiseSpeedMetersPerSecond?: number }} input
 * @returns {number} clamped to [0, 1]
 */
export function rivalThrottleSignal(state, input) {
  const profile = profileForId(state.profileId);
  const speed = Number.isFinite(state.speedMetersPerSecond)
    ? state.speedMetersPerSecond
    : 0;
  const deficit = driveTargetSpeed(state, profile, input) - speed;
  const window = profile.accelerationMetersPerSecondSquared
    * RIVAL_DRIVE_RESPONSE_SECONDS;
  return window > 0 ? clamp(deficit / window, 0, 1) : 0;
}

/**
 * Engine-glow drive. Throttle alone sits at zero while a rival holds its cruise
 * speed, which would read as a dead engine, so the glow rides on how fast the
 * rival is actually travelling and surges with throttle out of a corner.
 *
 * @param {RivalState} state
 * @param {{ courseSpeedFactor?: number; cruiseSpeedMetersPerSecond?: number }} input
 * @returns {number} clamped to [0, 1]
 */
export function rivalGlowSignal(state, input) {
  const profile = profileForId(state.profileId);
  const speed = Number.isFinite(state.speedMetersPerSecond)
    ? state.speedMetersPerSecond
    : 0;
  const cruise = Math.max(1, paceCruiseSpeed(profile, input.cruiseSpeedMetersPerSecond));
  const speedRatio = clamp(speed / cruise, 0, 1);
  return clamp(
    speedRatio * RIVAL_GLOW_SPEED_SHARE
      + rivalThrottleSignal(state, input) * (1 - RIVAL_GLOW_SPEED_SHARE),
    0,
    1,
  );
}

/**
 * All four pose signals in one pass, for callers that need every one of them
 * per rival per frame.
 *
 * @param {RivalState} state
 * @param {{
 *   targetLateralMeters?: number;
 *   laneHalfWidthMeters?: number;
 *   courseSpeedFactor?: number;
 *   curvature?: number;
 * }} input
 */
export function rivalPoseSignals(state, input) {
  return {
    steer: rivalSteerSignal(state, input),
    brake: rivalBrakeSignal(state, input),
    throttle: rivalThrottleSignal(state, input),
    glow: rivalGlowSignal(state, input),
    drift: rivalDriftSignal(state),
  };
}

/**
 * G1 drift articulation, 0..1. The committed-drift state is integrated inside
 * the step (so it is rate independent like every other signal); this only reads
 * it back for the pose. The fleet spends it on a deeper roll and a wider
 * airbrake flare on the batches that already exist - no new emitter, no new
 * draw call - so a rival hanging the tail out through a hairpin reads as a
 * drift rather than as a tighter line.
 *
 * @param {RivalState} state
 * @returns {number} clamped to [0, 1]
 */
export function rivalDriftSignal(state) {
  return Number.isFinite(state.driftIntensity) ? clamp(state.driftIntensity, 0, 1) : 0;
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
  driftSignal = 0,
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
  // G1 - a committed drift deepens the lean into the bend it is committed to,
  // and only there. The P2 expression and its +/-0.2 clamp are left exactly as
  // they were and the drift lean is added OUTSIDE them, so at driftSignal 0
  // this returns byte-for-byte what it returned before the phase.
  const base = clamp(-lateralSpeed * 0.022 - bend * 0.09, -0.2, 0.2);
  const drift = Number.isFinite(driftSignal) ? clamp(driftSignal, 0, 1) : 0;
  const bank = clamp(
    base - bend * drift * RIVAL_DRIFT_BANK_GAIN,
    -0.2 - RIVAL_DRIFT_BANK_GAIN,
    0.2 + RIVAL_DRIFT_BANK_GAIN,
  );
  return Math.abs(bank) < 1e-9 ? 0 : bank;
}

/** @param {RivalState} state */
export function recoverInvalidRivalState(state) {
  const invalid = !Number.isFinite(state.raceDistanceMeters)
    || !Number.isFinite(state.speedMetersPerSecond)
    || !Number.isFinite(state.lateralMeters)
    || !Number.isFinite(state.elapsedSeconds)
    || !Number.isFinite(state.boostReserve);
  if (!invalid) return false;
  state.raceDistanceMeters = state.lastSafeDistanceMeters;
  state.courseDistanceMeters = state.lastSafeDistanceMeters;
  state.speedMetersPerSecond = state.lastSafeSpeedMetersPerSecond;
  state.lateralMeters = state.lastSafeLateralMeters;
  state.elapsedSeconds = state.lastSafeElapsedSeconds;
  // G1 — the reserve is part of the drive now, so a corrupted one has to come
  // back with the rest of the state instead of poisoning every later step.
  state.boostReserve = state.lastSafeBoostReserve;
  state.fixedStepRemainderSeconds = 0;
  state.recoveryCount += 1;
  return true;
}

/**
 * The lane a rival would hold with no player in the world at all.
 *
 * This is the ONE lane that feeds anything longitudinal: pad coverage is
 * resolved against it, and so is the rival-versus-rival contest. Every
 * player-reactive term lives in {@link rivalContestLaneMeters} downstream of
 * here, which is what makes a rival's lap time provably independent of what the
 * player does (scripts/validate-rivals.mjs proves it end to end by racing the
 * same field against a moving player and against a player parked on the grid).
 *
 * @param {RivalState} state
 * @param {{
 *   curvature?: number;
 *   laneHalfWidthMeters?: number;
 *   padLaneMeters?: number | null;
 *   padUse?: boolean;
 * }} input
 */
export function rivalPaceLaneMeters(state, input) {
  const profile = profileForId(state.profileId);
  const laneHalfWidth = typeof input.laneHalfWidthMeters === "number"
    && Number.isFinite(input.laneHalfWidthMeters)
    ? Math.max(0, input.laneHalfWidthMeters)
    : 8;
  const curvature = typeof input.curvature === "number"
    && Number.isFinite(input.curvature)
    ? clamp(input.curvature, -1, 1)
    : 0;
  const distance = Number.isFinite(state.raceDistanceMeters)
    ? state.raceDistanceMeters
    : 0;
  const lane = profile.startingLateralMeters
    + Math.sin(distance / 210 + profile.pacePhaseRadians) * 0.75
    - curvature * 1.4;
  // No start fan here any more: the launch is handled by holding the grid slot
  // (see `rivalGridHoldScale`), which is a rate limit rather than a lane, so a
  // rival's authored line is the same expression from the line to the flag.
  const padLane = input.padLaneMeters;
  if (
    input.padUse
    && typeof padLane === "number"
    && Number.isFinite(padLane)
    && Math.abs(padLane - lane) <= RIVAL_PAD_LANE_REACH_METERS
  ) {
    return clamp(padLane, -laneHalfWidth, laneHalfWidth);
  }
  return clamp(lane, -laneHalfWidth, laneHalfWidth);
}

/**
 * The metres to add to a player race distance to compare it with a rival's.
 *
 * The two are measured from different origins, and G1 shipped a round without
 * noticing. A rival's race distance is ribbon distance: `courseDistanceMeters`
 * is `raceDistanceMeters` modulo the lap, so zero is station zero. The player's
 * is measured from the START LINE, which is `startProgress` along that ribbon -
 * 5.03 m into Greenwater's lap, and 3045 m into Bitterpan's 3050 m lap. So a
 * rival and the player standing on the same line read race distances 5.03 m
 * apart on Greenwater and 5 m apart the other way on Bitterpan.
 *
 * Every player-versus-rival comparison inherited that: the slipstream, whose
 * full-tow band is only 4-16 m wide, so a 5 m error is a third of it; the
 * separation telemetry; the no-block window; the defence band. It was found by
 * comparing the tow's own inputs against the world-space separation the same
 * frame drew - `slipstreamMaxPositionMismatchMeters` - after a LOCK screenshot
 * showed no rival ahead of the craft.
 *
 * Wrapped to the half-lap nearest zero so the correction is the small signed
 * number it physically is rather than a whole lap of it.
 *
 * @param {number} startProgress the course's authored start, 0..1
 * @param {number} courseLengthMeters
 */
export function playerRaceDistanceOffsetMeters(startProgress, courseLengthMeters) {
  const length = Number.isFinite(courseLengthMeters) ? Math.max(1, courseLengthMeters) : 1;
  const progress = Number.isFinite(startProgress) ? startProgress : 0;
  const raw = ((progress % 1) + 1) % 1 * length;
  return raw > length / 2 ? raw - length : raw;
}

/**
 * How much of its authored lateral rate a rival is allowed at this point in the
 * race: none until {@link RIVAL_GRID_HOLD_METERS}, all of it from
 * {@link RIVAL_GRID_RELEASE_METERS}, linear between.
 *
 * A rate limit rather than a lane, so it constrains nothing about WHERE a rival
 * wants to be - only how fast it may get there. Pure in race distance, so it is
 * as rate independent and as player independent as the rest of the model.
 *
 * @param {number} raceDistanceMeters
 * @returns {number} 0..1
 */
export function rivalGridHoldScale(raceDistanceMeters) {
  // A corrupted distance releases the lane rather than freezing it: a rival
  // pinned on a grid slot for the rest of a race is a far worse failure than
  // one that changes lane a little early. Infinities are meaningful and are
  // left to the comparisons below.
  if (typeof raceDistanceMeters !== "number" || Number.isNaN(raceDistanceMeters)) return 1;
  const distance = raceDistanceMeters;
  if (distance >= RIVAL_GRID_RELEASE_METERS) return 1;
  if (distance <= RIVAL_GRID_HOLD_METERS) return 0;
  return (distance - RIVAL_GRID_HOLD_METERS)
    / (RIVAL_GRID_RELEASE_METERS - RIVAL_GRID_HOLD_METERS);
}

/**
 * Fans the authored grid so no two slots on it are within
 * {@link RIVAL_GRID_MINIMUM_SPACING_METERS}, the player's slot included.
 *
 * Greenwater authors no grid at all and the field launches from the profiles'
 * own lanes, two of which sit 2.8 m apart with a third 0.4 m off the player's;
 * Bitterpan's authored grid has a 3.1 m pair. Neither is enough room for four
 * craft to hold station through the opening 180 m, so the slots are spread
 * here, once, before anyone moves - rather than by editing accepted map data,
 * which owns where the grid furniture is drawn.
 *
 * The player's slot is the anchor and never moves: it is where the course says
 * the race starts from. Rivals keep their authored ORDER across the deck and
 * are pushed outward from the anchor only as far as the spacing needs.
 *
 * @param {number} anchorLateralMeters the player's grid lateral
 * @param {readonly number[]} lateralsMeters authored rival grid laterals
 * @param {number} laneHalfWidthMeters usable half width at the grid
 * @returns {number[]} spread laterals, in the order they were given
 */
export function spreadGridLaterals(anchorLateralMeters, lateralsMeters, laneHalfWidthMeters) {
  const anchor = Number.isFinite(anchorLateralMeters) ? anchorLateralMeters : 0;
  const laneHalfWidth = Number.isFinite(laneHalfWidthMeters)
    ? Math.max(0, laneHalfWidthMeters)
    : 8;
  const entries = lateralsMeters.map((lateral, index) => ({
    index,
    lateral: Number.isFinite(lateral) ? lateral : 0,
  }));
  const ordered = [...entries].sort(
    (a, b) => (a.lateral - b.lateral) || (a.index - b.index),
  );
  const spread = new Array(entries.length);
  let cursor = anchor;
  for (const entry of ordered.filter((candidate) => candidate.lateral >= anchor)) {
    cursor = Math.max(entry.lateral, cursor + RIVAL_GRID_MINIMUM_SPACING_METERS);
    spread[entry.index] = clamp(cursor, -laneHalfWidth, laneHalfWidth);
  }
  cursor = anchor;
  const below = ordered.filter((candidate) => candidate.lateral < anchor).reverse();
  for (const entry of below) {
    cursor = Math.min(entry.lateral, cursor - RIVAL_GRID_MINIMUM_SPACING_METERS);
    spread[entry.index] = clamp(cursor, -laneHalfWidth, laneHalfWidth);
  }
  return spread;
}

/**
 * The smallest gap between any two of `laterals`, for asserting a grid is
 * actually spread. Returns Infinity for fewer than two entries.
 *
 * @param {readonly number[]} laterals
 */
export function minimumLateralSpacingMeters(laterals) {
  const sorted = [...laterals].filter(Number.isFinite).sort((a, b) => a - b);
  let smallest = Infinity;
  for (let index = 1; index < sorted.length; index += 1) {
    smallest = Math.min(smallest, sorted[index] - sorted[index - 1]);
  }
  return smallest;
}

/**
 * The reserved corridor that keeps PRODUCT.md principle 5 true by construction.
 *
 * While the player is closing (armed at {@link RIVAL_NO_BLOCK_ARM_METERS}), a
 * rival's lane is clamped into the band that hugs `sideSign`'s edge and is
 * `(1 - RIVAL_FREE_DECK_FRACTION)` of the deck wide. Whatever the rest of the
 * field does, the opposite `RIVAL_FREE_DECK_FRACTION` of the deck is left
 * completely clear, so the player always has a route past.
 *
 * `sideSign` is the map's authored yield side (`rivalPace.noBlockSide`), the
 * same for every rival and never the player's position. It has to be shared:
 * two rivals yielding to opposite edges would leave the clear deck split into
 * two half-width strips and satisfy the per-craft reading of the rule while
 * walling the route off, which is exactly what principle 5 forbids. Being
 * authored rather than derived also means it cannot flip under a player who
 * swerves and strand a rival inside the corridor.
 *
 * @param {number} laneMeters
 * @param {number} sideSign
 * @param {number} halfWidthMeters
 */
export function rivalNoBlockLaneMeters(laneMeters, sideSign, halfWidthMeters) {
  const side = sideSign >= 0 ? 1 : -1;
  const halfWidth = Number.isFinite(halfWidthMeters) ? Math.max(0, halfWidthMeters) : 0;
  const lane = Number.isFinite(laneMeters) ? laneMeters : 0;
  const reserved = RIVAL_FREE_DECK_FRACTION + RIVAL_NO_BLOCK_MARGIN_FRACTION;
  const inner = halfWidth * (2 * reserved - 1) + VEHICLE_CLEARANCE_METERS;
  const outer = Math.max(inner, halfWidth - VEHICLE_CLEARANCE_METERS);
  return side * clamp(side * lane, inner, outer);
}

/**
 * The point of `[low, high]` closest to `desired` that is not strictly inside
 * any of the `forbidden` open intervals, or `null` when no such point exists.
 *
 * Three constraints act on a rival's lane at once - the no-block corridor, the
 * room it owes the player and the room it owes its neighbour - and clamping
 * them one after another does not solve them: each clamp can undo the one
 * before it, which is how a five-lap Bitterpan run ended up reporting 0.89 m
 * between two rivals with a 3.4 m floor supposedly in force. In one dimension
 * the exact answer is cheap, so take it: the optimum is either `desired` itself
 * or a constraint boundary, and there are at most six of those.
 *
 * @param {number} desired
 * @param {number} low
 * @param {number} high
 * @param {readonly number[][]} forbidden
 * @returns {number | null}
 */
export function nearestAllowedLane(desired, low, high, forbidden) {
  if (!(high >= low)) return null;
  /** @param {number} value */
  const inside = (value) => {
    for (const span of forbidden) {
      if (value > span[0] + 1e-9 && value < span[1] - 1e-9) return true;
    }
    return false;
  };
  let best = null;
  let bestDistance = Infinity;
  /** @param {number} raw */
  const consider = (raw) => {
    const value = clamp(raw, low, high);
    if (inside(value)) return;
    const distance = Math.abs(value - desired);
    if (distance < bestDistance - 1e-12) {
      bestDistance = distance;
      best = value;
    }
  };
  consider(desired);
  consider(low);
  consider(high);
  for (const span of forbidden) {
    consider(span[0]);
    consider(span[1]);
  }
  return best;
}

/**
 * The lane a rival aims at once everything but its own pace is accounted for.
 *
 * One function, because the constraints interact and have to be solved
 * together rather than applied in sequence:
 *
 *   - `desired` is the pace lane, plus at most
 *     {@link RIVAL_DEFENCE_SHIFT_METERS} toward the inside of the bend the
 *     player is about to follow it into;
 *   - the allowed range is the deck, narrowed to the authored no-block corridor
 *     while the player is anywhere within {@link RIVAL_NO_BLOCK_ARM_METERS};
 *   - the player and the nearest rival each forbid
 *     {@link RIVAL_LANE_CLEARANCE_METERS} either side of themselves.
 *
 * The three are relaxed in a fixed order when they cannot all hold: the
 * corridor goes first (a player parked inside the corridor is not being
 * blocked by definition, and the free-deck rule is asserted on the samples
 * where that is not happening), then the neighbour, and the player's room is
 * the last thing standing.
 *
 * Everything here is lateral. Nothing in it can reach a rival's speed, which is
 * what keeps a rival's lap time independent of the player.
 *
 * @param {number} paceLaneMeters
 * @param {{
 *   lateralMeters?: number;
 *   playerGapMeters: number;
 *   playerLateralMeters: number;
 *   rivalId?: string;
 *   neighbourLaterals?: readonly number[] | null;
 *   insideSign: number;
 *   sideSign: number;
 *   halfWidthMeters: number;
 *   laneHalfWidthMeters: number;
 *   cushionYieldMeters?: number;
 *   cushionYieldSign?: number;
 * }} input
 */
export function rivalContestLaneMeters(paceLaneMeters, input) {
  const lane = Number.isFinite(paceLaneMeters) ? paceLaneMeters : 0;
  const gap = Number.isFinite(input.playerGapMeters) ? input.playerGapMeters : Infinity;
  const laneHalfWidth = Number.isFinite(input.laneHalfWidthMeters)
    ? Math.max(0, input.laneHalfWidthMeters)
    : 8;
  const cushionYieldRaw = input.cushionYieldMeters ?? 0;
  const cushionSignRaw = input.cushionYieldSign ?? 0;
  const cushionYield = Number.isFinite(cushionYieldRaw) ? Math.max(0, cushionYieldRaw) : 0;
  const cushionSign = Number.isFinite(cushionSignRaw) ? Math.sign(cushionSignRaw) : 0;
  let desired = lane;
  if (
    gap >= RIVAL_DEFENCE_MINIMUM_GAP_METERS
    && gap <= RIVAL_DEFENCE_MAXIMUM_GAP_METERS
    && Number.isFinite(input.insideSign)
    && input.insideSign !== 0
  ) {
    desired += (input.insideSign > 0 ? 1 : -1) * RIVAL_DEFENCE_SHIFT_METERS;
  }
  // G2 — the rival's half of an air-cushion contact: aim RIVAL_CUSHION_YIELD_
  // METERS further from the player, on the side this craft is already on.
  //
  // It moves the DESIRED lane, not the forbidden span around the player, and
  // the difference is not cosmetic. Widening the span was tried first and cost
  // Bitterpan 0.9 points of free deck (37.7% -> 36.8%, under the 37% floor):
  // a wider forbidden zone makes the corridor solve infeasible more often, and
  // the relaxation that follows drops a rival OUT of the yield corridor, which
  // is exactly what the free-deck rule measures. A shifted target can only ever
  // be clamped by constraints that were already there, so the yield is strictly
  // gentler and the corridor is left alone.
  desired += cushionSign * cushionYield;
  desired = clamp(desired, -laneHalfWidth, laneHalfWidth);

  /** @type {number[][]} */
  const forbidden = [];
  const playerRoom = Math.abs(gap) <= RIVAL_PLAYER_AVOID_GAP_METERS
    && Number.isFinite(input.playerLateralMeters)
    ? [
      input.playerLateralMeters - RIVAL_LANE_CLEARANCE_METERS,
      input.playerLateralMeters + RIVAL_LANE_CLEARANCE_METERS,
    ]
    : null;
  if (playerRoom) forbidden.push(playerRoom);
  // EVERY neighbour inside the gate, not just the nearest one: with three craft
  // bunched, avoiding only the closest lets the other two be pushed together.
  //
  // And each neighbour constrains this craft to ITS OWN SIDE OF THE MIDPOINT,
  // half a clearance clear of it, rather than simply to somewhere outside the
  // neighbour's current bubble. That distinction is the difference between the
  // rule holding and not: both craft solve simultaneously, so a bubble anchored
  // on where the OTHER one is right now has each of them aiming at a boundary
  // the other is already leaving - they chase each other across the deck and
  // stay exactly as close as they started, which is how a five-lap Bitterpan
  // soak measured 1.02 m with a 4.2 m floor nominally in force. A midpoint is
  // the same value for both craft, so the pair converges to the clearance in
  // one move and stays there.
  const neighbourStart = forbidden.length;
  const own = typeof input.lateralMeters === "number" && Number.isFinite(input.lateralMeters)
    ? input.lateralMeters
    : desired;
  const half = RIVAL_LANE_CLEARANCE_METERS / 2;
  if (input.neighbourLaterals) {
    for (const lateral of input.neighbourLaterals) {
      if (!Number.isFinite(lateral)) continue;
      const difference = own - lateral;
      // Only a neighbour that is ACTUALLY too close constrains the lane. A
      // half-line anchored on a craft already a clearance away would pin each
      // rival to whichever side of the deck it happened to be on and stop the
      // pair ever entering the yield corridor together - measured as 32% free
      // deck where the rule wants 40%.
      if (Math.abs(difference) >= RIVAL_LANE_CLEARANCE_METERS) continue;
      const towardHigh = Math.abs(difference) > 1e-9
        ? difference > 0
        : chooseOvertakeSide(input.rivalId ?? "rival", "rival-other") > 0;
      const midpoint = (own + lateral) / 2;
      forbidden.push(towardHigh
        ? [-LANE_HALF_LINE_METERS, midpoint + half]
        : [midpoint - half, LANE_HALF_LINE_METERS]);
    }
  }
  const hasNeighbours = forbidden.length > neighbourStart;

  // The corridor is a range, not a forbidden zone, and it is armed on BOTH
  // sides of the player: a rival that only entered it once it was already ahead
  // would have no time to clear the reserved deck, which measured 38.9% free
  // where the rule wants 40%.
  const armed = Math.abs(gap) <= RIVAL_NO_BLOCK_ARM_METERS;
  const side = input.sideSign >= 0 ? 1 : -1;
  const halfWidth = Number.isFinite(input.halfWidthMeters)
    ? Math.max(0, input.halfWidthMeters)
    : laneHalfWidth + VEHICLE_CLEARANCE_METERS;
  const reserved = RIVAL_FREE_DECK_FRACTION + RIVAL_NO_BLOCK_MARGIN_FRACTION;
  // Occupied span must stay inside the (1 - reserved) share of the deck that
  // hugs `side`'s edge, which in lane terms is side*lane within [inner, outer].
  const inner = halfWidth * (2 * reserved - 1) + VEHICLE_CLEARANCE_METERS;
  const outer = Math.max(inner, halfWidth - VEHICLE_CLEARANCE_METERS);
  const low = Math.max(-laneHalfWidth, side > 0 ? inner : -outer);
  const high = Math.min(laneHalfWidth, side > 0 ? outer : -inner);

  // Relaxation order, when the three cannot all hold at once. The corridor
  // outranks the player's own room on purpose: the corridor is what guarantees
  // the player somewhere to go, and a player that has driven into the yielding
  // pack instead of taking the strip reserved for it is not being blocked. The
  // neighbour constraints are never dropped while a lane exists that honours
  // them - two rivals sharing a metre of deck is the one outcome nothing in the
  // race can excuse.
  const neighbourOnly = hasNeighbours
    ? forbidden.slice(neighbourStart)
    : [];
  // Relaxation order, when the three cannot all hold at once: the corridor is
  // kept and the player's room is what yields. A player standing inside the
  // strip reserved for it to pass through is not being denied a route, and the
  // free-deck rule is asserted exactly on the samples where that is not
  // happening. Dropping the corridor first instead was measured and reverted:
  // it bought no separation at all on Greenwater (0.79 m either way, because
  // the binding case there is a lateral transit rather than a constraint) and
  // it cost Bitterpan 2.3 points of free deck.
  if (armed) {
    const inCorridor = nearestAllowedLane(desired, low, high, forbidden)
      ?? nearestAllowedLane(desired, low, high, neighbourOnly);
    if (inCorridor !== null) return inCorridor;
  }
  const onDeck = nearestAllowedLane(desired, -laneHalfWidth, laneHalfWidth, forbidden)
    ?? nearestAllowedLane(desired, -laneHalfWidth, laneHalfWidth, neighbourOnly);
  if (onDeck !== null) return onDeck;
  return clamp(desired, -laneHalfWidth, laneHalfWidth);
}

/**
 * The widest continuous strip of deck the field leaves free, as a fraction of
 * the deck width. `laterals` is every rival that is inside the no-block window;
 * each occupies `+/- VEHICLE_CLEARANCE_METERS` around its centre line.
 *
 * This is the field-level reading of principle 5, and it is the strict one: a
 * single rival can never block a 24 m deck on its own, but three abreast can,
 * and that is exactly the case the rule has to catch.
 *
 * @param {number} halfWidthMeters
 * @returns {number} 0..1
 */
export function freeDeckTargetFraction(halfWidthMeters) {
  const halfWidth = Number.isFinite(halfWidthMeters)
    ? Math.max(1e-6, halfWidthMeters)
    : 1e-6;
  // Geometry ceiling, measured rather than assumed: a single craft splits the
  // deck into two strips summing to (2*halfWidth - 2*clearance), so the wider
  // of them can never exceed half of that however the craft is placed. On a
  // deck narrower than 22 m - Greenwater dips to 19 m - that ceiling is below
  // the 40% the rule asks for, and no lane choice can fix it.
  return Math.min(
    RIVAL_FREE_DECK_FRACTION,
    (halfWidth - VEHICLE_CLEARANCE_METERS) / (2 * halfWidth),
  );
}

/**
 * @param {readonly number[]} laterals
 * @param {number} halfWidthMeters
 * @returns {number} 0..1
 */
export function measureFreeDeckFraction(laterals, halfWidthMeters) {
  const halfWidth = Number.isFinite(halfWidthMeters)
    ? Math.max(1e-6, halfWidthMeters)
    : 1e-6;
  const spans = [];
  for (const lateral of laterals) {
    if (!Number.isFinite(lateral)) continue;
    spans.push([lateral - VEHICLE_CLEARANCE_METERS, lateral + VEHICLE_CLEARANCE_METERS]);
  }
  if (spans.length === 0) return 1;
  spans.sort((a, b) => a[0] - b[0]);
  let cursor = -halfWidth;
  let widest = 0;
  for (const [low, high] of spans) {
    if (low > cursor) widest = Math.max(widest, low - cursor);
    cursor = Math.max(cursor, high);
  }
  widest = Math.max(widest, halfWidth - cursor);
  return clamp(widest / (2 * halfWidth), 0, 1);
}

/**
 * Whether `courseDistanceMeters` is inside one of the rival's authored reserve
 * windows. Pure, so the same call decides the drive and the validator's
 * "every window sits on a straight" assertion.
 *
 * @param {readonly { fromMeters: number; toMeters: number }[] | undefined} windows
 * @param {number} courseDistanceMeters
 */
export function isInsideBoostWindow(windows, courseDistanceMeters) {
  if (!windows) return false;
  const distance = Number.isFinite(courseDistanceMeters) ? courseDistanceMeters : 0;
  for (const window of windows) {
    if (distance >= window.fromMeters && distance <= window.toMeters) return true;
  }
  return false;
}

/**
 * The pace entry for one rival, with the defaults a course that authors no
 * `rivalPace` block falls back to.
 *
 * @param {RivalPaceTable | null | undefined} pace
 * @param {string} profileId
 * @returns {RivalPaceEntry}
 */
export function resolveRivalPace(pace, profileId) {
  const profile = profileForId(profileId);
  const entry = pace?.profiles?.[profileId];
  return {
    cruiseSpeedMetersPerSecond: entry?.cruiseSpeedMetersPerSecond
      ?? profile.cruiseSpeedMetersPerSecond,
    padUse: entry?.padUse ?? false,
    boostWindows: entry?.boostWindows ?? [],
  };
}

/**
 * The authored corner speed multiplier for this map. Bitterpan's two long pans
 * and Greenwater's hairpins need different amounts of scrub off the same
 * curvature, so the shape lives in the per-map pace block rather than in a
 * constant here.
 *
 * @param {RivalPaceTable | null | undefined} pace
 * @param {number} curvature
 */
export function rivalCourseSpeedFactor(pace, curvature) {
  const gain = pace && Number.isFinite(pace.cornerSpeedGain) ? pace.cornerSpeedGain : 0.2;
  const floor = pace && Number.isFinite(pace.cornerSpeedFloor)
    ? pace.cornerSpeedFloor
    : 0.79;
  const bend = Number.isFinite(curvature) ? Math.abs(curvature) : 0;
  return clamp(1 - bend * gain, floor, 1);
}

/**
 * @typedef {{
 *   targetLateralMeters?: number;
 *   laneHalfWidthMeters?: number;
 *   courseSpeedFactor?: number;
 *   cruiseSpeedMetersPerSecond?: number;
 *   boostWindowActive?: boolean;
 *   onBoostPad?: boolean;
 *   curvatureMagnitude?: number;
 *   driftCurvature?: number;
 *   paceLateralMeters?: number;
 *   lateralSpeedScale?: number;
 * }} RivalDriveInput
 */

/**
 * Advances one rival by `deltaSeconds` of wall clock, in fixed
 * {@link RIVAL_FIXED_STEP_SECONDS} sub-steps.
 *
 * `resolveSubStepInput`, when supplied, is called once per sub-step with the
 * state the sub-step is about to consume, and returns the drive input for that
 * sub-step. That is what makes a course-faithful run bit-identical at any
 * render rate: two 1/120 calls and one 1/60 call resolve the same two inputs
 * from the same two states and take the same two integrations. Without it the
 * top-level `input` is reused for every sub-step, which is what the game does
 * (it always steps the fleet at exactly one sub-step per call) and what the
 * open-loop determinism harness needs.
 *
 * @param {RivalState} state
 * @param {RivalDriveInput & {
 *   deltaSeconds: number;
 *   resolveSubStepInput?: (state: RivalState) => RivalDriveInput;
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
  const resolve = typeof input.resolveSubStepInput === "function"
    ? input.resolveSubStepInput
    : null;
  while (state.fixedStepRemainderSeconds + 1e-12 >= RIVAL_FIXED_STEP_SECONDS) {
    state.fixedStepRemainderSeconds -= RIVAL_FIXED_STEP_SECONDS;
    const drive = resolve ? resolve(state) : input;
    const previousDistance = state.raceDistanceMeters;
    const previousElapsed = state.elapsedSeconds;

    // --- boost economy, resolved before the drive target so the target, the
    // --- pose signals and the telemetry all read one state.
    const onPad = Boolean(drive.onBoostPad);
    if (onPad && state.padBoostSeconds <= 0) state.padHits += 1;
    state.padBoostSeconds = onPad
      ? RIVAL_PAD_BOOST_SECONDS
      : Math.max(0, state.padBoostSeconds - RIVAL_FIXED_STEP_SECONDS);
    const reserveBoost = Boolean(drive.boostWindowActive)
      && state.boostReserve > RIVAL_BOOST_RESERVE_CUTOFF;
    state.boostActive = reserveBoost || state.padBoostSeconds > 0;
    if (state.boostActive) state.boostSeconds += RIVAL_FIXED_STEP_SECONDS;

    // --- drift. One authored corner is one drift: entry at the course's own
    // --- threshold, release at RIVAL_DRIFT_EXIT_FRACTION of it, so a bend that
    // --- ripples either side of the line cannot farm the reward.
    const enterCurvature = typeof drive.driftCurvature === "number"
      && Number.isFinite(drive.driftCurvature)
      ? Math.max(0, drive.driftCurvature)
      : Infinity;
    const bend = typeof drive.curvatureMagnitude === "number"
      && Number.isFinite(drive.curvatureMagnitude)
      ? Math.abs(drive.curvatureMagnitude)
      : 0;
    const wasDrifting = state.driftActive;
    state.driftActive = wasDrifting
      ? bend >= enterCurvature * RIVAL_DRIFT_EXIT_FRACTION
      : bend >= enterCurvature;
    if (state.driftActive && !wasDrifting) state.driftEntries += 1;
    if (state.driftActive) state.driftSeconds += RIVAL_FIXED_STEP_SECONDS;
    const driftReward = wasDrifting && !state.driftActive
      ? RIVAL_DRIFT_RELEASE_REWARD
      : 0;
    state.driftIntensity = moveToward(
      state.driftIntensity,
      state.driftActive ? 1 : 0,
      RIVAL_DRIFT_RESPONSE_RATE * RIVAL_FIXED_STEP_SECONDS,
    );
    state.boostReserve = clamp(
      state.boostReserve
        + driftReward
        + (reserveBoost ? -RIVAL_BOOST_RESERVE_DRAIN_RATE : RIVAL_BOOST_RESERVE_REGEN_RATE)
          * RIVAL_FIXED_STEP_SECONDS,
      0,
      1,
    );

    const targetSpeed = driveTargetSpeed(state, profile, drive);
    const acceleration = targetSpeed >= state.speedMetersPerSecond
      ? profile.accelerationMetersPerSecondSquared
        * (state.boostActive ? RIVAL_BOOST_ACCELERATION_GAIN : 1)
      : profile.brakingMetersPerSecondSquared;
    state.speedMetersPerSecond = moveToward(
      state.speedMetersPerSecond,
      targetSpeed,
      acceleration * RIVAL_FIXED_STEP_SECONDS,
    );
    state.raceDistanceMeters += state.speedMetersPerSecond * RIVAL_FIXED_STEP_SECONDS;
    state.elapsedSeconds += RIVAL_FIXED_STEP_SECONDS;

    const laneHalfWidth = typeof drive.laneHalfWidthMeters === "number"
      && Number.isFinite(drive.laneHalfWidthMeters)
      ? Math.max(0, drive.laneHalfWidthMeters)
      : 8;
    const targetLateral = authoredTargetLateral(profile, drive);
    const lateralScale = typeof drive.lateralSpeedScale === "number"
      && Number.isFinite(drive.lateralSpeedScale)
      ? clamp(drive.lateralSpeedScale, 0, RIVAL_EVASIVE_LATERAL_GAIN)
      : 1;
    // The grid hold is applied HERE rather than left to the caller, because it
    // has to bind both lanes below and a caller that forgot it would put the
    // field back in the scrum it exists to prevent.
    const gridHold = rivalGridHoldScale(state.raceDistanceMeters);
    const reach = profile.lateralSpeedMetersPerSecond
      * lateralScale * gridHold * RIVAL_FIXED_STEP_SECONDS;
    state.lateralMeters = clamp(
      moveToward(state.lateralMeters, targetLateral, reach),
      -laneHalfWidth,
      laneHalfWidth,
    );
    // The same integration, run on the player-free lane. It costs one
    // `moveToward` and it is the reason the pad a rival collects - the only
    // lateral fact that reaches its speed - cannot be changed by the player.
    const paceLateral = typeof drive.paceLateralMeters === "number"
      && Number.isFinite(drive.paceLateralMeters)
      ? drive.paceLateralMeters
      : targetLateral;
    // The player-free lane keeps the AUTHORED rate. It must not see the player
    // even indirectly, or the pad a rival collects - the one lateral fact that
    // reaches its speed - would become player-dependent.
    state.paceLateralMeters = clamp(
      moveToward(
        state.paceLateralMeters,
        paceLateral,
        profile.lateralSpeedMetersPerSecond * gridHold * RIVAL_FIXED_STEP_SECONDS,
      ),
      -laneHalfWidth,
      laneHalfWidth,
    );

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
        state.boostActive = false;
        state.driftActive = false;
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
    state.lastSafeBoostReserve = state.boostReserve;
    if (state.finished) break;
  }
  if (state.fixedStepRemainderSeconds < 1e-12) state.fixedStepRemainderSeconds = 0;
  return state;
}

/**
 * Advances the whole field in lockstep, one fixed sub-step at a time.
 *
 * The rivals are coupled - they contest lanes with each other - so they have to
 * see each other at the same instant. Stepping each rival's accumulator on its
 * own would let a rival run two sub-steps ahead of the field on a 1/60 frame
 * and read a stale neighbour, which is exactly the kind of rate dependence
 * `scripts/validate-rivals.mjs` exists to catch. This driver owns the
 * accumulator instead, hands every rival exactly one sub-step, and returns the
 * leftover for the caller to carry.
 *
 * @param {readonly RivalState[]} states
 * @param {{
 *   deltaSeconds: number;
 *   remainderSeconds?: number;
 *   resolveSubStepInput: (state: RivalState, states: readonly RivalState[]) => (RivalDriveInput & { deltaSeconds: number });
 *   onSubStep?: (states: readonly RivalState[]) => void;
 * }} input
 * @returns {number} seconds left over, to pass back as `remainderSeconds`
 */
export function stepRivalField(states, input) {
  const deltaSeconds = Number.isFinite(input.deltaSeconds)
    ? clamp(input.deltaSeconds, 0, 0.25)
    : 0;
  let remainder = (typeof input.remainderSeconds === "number"
    && Number.isFinite(input.remainderSeconds)
    ? input.remainderSeconds
    : 0) + deltaSeconds;
  while (remainder + 1e-12 >= RIVAL_FIXED_STEP_SECONDS) {
    remainder -= RIVAL_FIXED_STEP_SECONDS;
    for (const state of states) {
      // The resolver's object is written through rather than spread into a new
      // one: the fleet hands back a per-rival scratch, so a five-lap race
      // allocates nothing here at all.
      const drive = input.resolveSubStepInput(state, states);
      drive.deltaSeconds = RIVAL_FIXED_STEP_SECONDS;
      stepRivalState(state, drive);
    }
    if (input.onSubStep) input.onSubStep(states);
  }
  return remainder < 1e-12 ? 0 : remainder;
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

