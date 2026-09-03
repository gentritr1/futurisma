export const CRUISE_MAX_SPEED = 86;
export const BOOST_MAX_SPEED = 112;
export const BOOST_RESERVE_CUTOFF = 0.012;

/*
 * P5 drift economy — the whole drift/boost tradeoff lives in these seven
 * numbers and nowhere else, so a tuning pass edits one block instead of
 * hunting constants through the race loop. Every one of them is a pre-
 * authorised proposal pending the P5 taste gate (a human drives three laps),
 * so treat this block as the single edit point when those answers come back.
 *
 * Derived durations, for reference when re-tuning:
 *   full charge from empty at driftIntensity 1 = 1 / 0.55   = 1.818 s
 *   full decay  from 1.0 while off drift       = 1 / 1.2    = 0.833 s
 *   one reward vs passive regen                = 0.30/0.045 = 6.7 s of regen
 */
export const DRIFT_CHARGE_RATE = 0.55;
export const DRIFT_CHARGE_CAP = 1;
export const DRIFT_CHARGE_DECAY_RATE = 1.2;
export const DRIFT_REWARD_MINIMUM_CHARGE = 0.35;
export const DRIFT_RELEASE_REWARD = 0.3;
export const BOOST_RESERVE_DRAIN_RATE = 0.26;
export const BOOST_RESERVE_REGEN_RATE = 0.045;

/*
 * G1 slipstream. Sitting in a rival's wake is the one tool the player has for
 * fighting a car that is quicker in a straight line, so it pays in the two
 * currencies the drive is made of: a higher effective cruise cap and a faster
 * refill of the reserve that buys the pass.
 *
 * The shape is a distance window times a lateral window times a speed gate:
 *   - full tow from SLIPSTREAM_NEAR to SLIPSTREAM_FULL metres behind, ramping
 *     in from nothing at zero (past that you are alongside, not drafting) and
 *     out to nothing at SLIPSTREAM_FADE;
 *   - full inside SLIPSTREAM_LATERAL_FULL of the rival's line, out to nothing
 *     at SLIPSTREAM_LATERAL_FADE;
 *   - nothing at all below SLIPSTREAM_MINIMUM_SPEED_RATIO of BOOST_MAX_SPEED,
 *     so a crawling player gets no tow.
 */
export const SLIPSTREAM_NEAR_METERS = 4;
export const SLIPSTREAM_FULL_METERS = 16;
export const SLIPSTREAM_FADE_METERS = 26;
export const SLIPSTREAM_LATERAL_FULL_METERS = 1.5;
export const SLIPSTREAM_LATERAL_FADE_METERS = 2.6;
export const SLIPSTREAM_MINIMUM_SPEED_RATIO = 0.45;
export const SLIPSTREAM_SPEED_RATIO_RAMP = 0.55;
/**
 * Share the effective cruise cap is lifted by at full tow: 86 -> 91.16 m/s.
 * The cap is the knee where overspeed drag starts biting, not a hard limit, so
 * the measured terminal cruise moves 91.79 -> 95.85 m/s (+4.4%) - see
 * `scripts/validate-physics.mjs`, which pins both numbers.
 */
export const SLIPSTREAM_CRUISE_BONUS = 0.06;
/** Reserve regen multiplier at full tow: +100%, i.e. 0.045 -> 0.09 per second. */
export const SLIPSTREAM_REGEN_BONUS = 1;
/** Where the HUD chip reads as locked and the audio cue fires. */
export const SLIPSTREAM_LOCK_THRESHOLD = 0.8;

/*
 * G2 air cushion. Racing contact without collision.
 *
 * PRODUCT.md principle 5 forbids player collision, and G1 honoured that by
 * having nothing at all happen when two hulls occupy the same metre of deck:
 * the Greenwater soak recorded a 1.23 m player-rival minimum with the craft
 * simply drawn through one another. A hard collision is still the wrong answer
 * - it costs the player a race for a contact the rival provoked - so what goes
 * in its place is a LEAN: a soft lateral spring that pushes the PLAYER off the
 * rival's line, plus a small speed cost for staying there.
 *
 * FRAME. Both gaps are CENTRE TO CENTRE in the G1 race-distance frame, the same
 * numbers `RivalFleet.measureSeparation` reports. They are NOT hull-to-hull
 * clearances: a TOTEM is 4.4 m across, so a 2.4 m centre gap is already deep
 * visual overlap, and the whole envelope lives inside the span where the two
 * craft are drawn touching. Reading these as hull clearances instead would put
 * the outer edge at a 6.8 m centre gap and have the cushion firing across most
 * of the deck, which is a different feature.
 *
 * SHAPE. Push = PEAK * across * along, where
 *   - `across` ramps from 0 at CUSHION_LATERAL_RANGE_METERS to 1 at
 *     CUSHION_LATERAL_PEAK_METERS and then HOLDS at 1 all the way to zero gap.
 *     It plateaus rather than falling away again because a cushion that got
 *     softer as the hulls converged would be a cushion that lets them converge;
 *     "peaks at 0.8 m" is where the peak is first reached, not a spike.
 *   - `along` is 1 while the craft are within CUSHION_LONGITUDINAL_FULL_METERS
 *     of level and fades to 0 at CUSHION_LONGITUDINAL_RANGE_METERS, so a rival
 *     six metres up the road never shoves.
 * A craft diving across gets the same peak SOONER, through
 * CUSHION_CLOSING_GAIN, never harder: the closing term can only bring `across`
 * up to its clamp at 1, so the push is capped at PEAK whatever the closing
 * speed. That is what keeps this a lean and not a wall.
 *
 * SIGN. Positive `lateralPush` moves the player toward positive lateral. The
 * push is always AWAY from the rival, so it can never drive the two together;
 * `scripts/validate-physics.mjs` asserts that over the whole envelope.
 */
/*
 * ROUND 2 envelope. Round 1 shipped 2.4 m / 5.5 m at a 6 m/s^2 peak through a
 * 0.5 s integrator, and the soak telemetry said exactly what that was worth:
 * 0.489 m of lateral travel over five laps, a longest contact of 0.208 s, and
 * a Greenwater minimum separation of 0.15 m - two hulls drawn through one
 * another. The arithmetic was the finding: a lean that only arms at 2.4 m has
 * to arrest all closure inside 0.4 m to leave 2.0 m, which is a wall.
 *
 * So the envelope arms earlier and pushes harder. It is still not a wall - it
 * is a lane's worth of lean, bounded by CUSHION_VELOCITY_CAP_MPS rather than by
 * being too weak to matter.
 */
/**
 * ROUND 3 pre-lean. The cushion now arms 1.2 m earlier than its own field, at a
 * fixed gentle CUSHION_PRE_LEAN_PUSH_MPS2, and the point is not the push - it
 * is the closure it takes off before the hard zone starts.
 *
 * Round 2's field was at its 14 m/s^2 ceiling at the worst Greenwater instant
 * and still could not reverse the pair, because it only started arguing once
 * they were 3.4 m apart and already converging fast. Three metres per second
 * squared applied from 4.6 m is worth about a metre per second of closure by
 * the time the field proper takes over, and a metre per second is most of the
 * problem.
 */
export const CUSHION_PRE_LEAN_RANGE_METERS = 4.6;
export const CUSHION_PRE_LEAN_PUSH_MPS2 = 3;
export const CUSHION_LATERAL_RANGE_METERS = 3.4;
/**
 * Full push at or inside this hull-centre gap. A TOTEM is ~2.2 m across, so
 * 2.2 m centre to centre is hulls touching and 1.4 m is deep overlap: the peak
 * is reached before the craft intersect, not after.
 */
export const CUSHION_LATERAL_PEAK_METERS = 1.4;
/**
 * Longitudinal profile: full while within FULL of level, fading to nothing at
 * RANGE. 4 m of level keeps the whole side-by-side band at full strength; the
 * fade out to 7 m is what stops a craft two lengths up the road from shoving.
 */
export const CUSHION_LONGITUDINAL_FULL_METERS = 4;
export const CUSHION_LONGITUDINAL_RANGE_METERS = 7;
/** Peak lateral acceleration on the player, m/s^2, at or inside the peak gap. */
export const CUSHION_PEAK_PUSH_MPS2 = 14;
/** Ceiling on the scrub, as a share of current speed per second. Unchanged. */
export const CUSHION_MAX_SCRUB_PER_SECOND = 0.02;
/** Closing speed at which the closing term is fully spent, m/s. */
export const CUSHION_CLOSING_REFERENCE_MPS = 3;
/** How much earlier a fast closing reaches the peak: `across` * up to 1.6. */
export const CUSHION_CLOSING_GAIN = 0.6;
/**
 * The hard ceiling on how fast the cushion alone can move the craft sideways.
 *
 * This, not the peak acceleration, is what keeps the cushion a lean. 14 m/s^2
 * is a firm shove for the fraction of a second it takes to get clear, but the
 * craft never leaves at more than a lane-change speed, and the moment the
 * contact ends the whole thing bleeds off in about a third of a second.
 *
 * Note it sits BELOW the undamped terminal velocity
 * (CUSHION_PEAK_PUSH_MPS2 * CUSHION_VELOCITY_TIME_CONSTANT_SECONDS = 4.9 m/s),
 * so a sustained peak contact reaches the cap at about 0.59 s and holds there.
 */
export const CUSHION_VELOCITY_CAP_MPS = 4;
/**
 * How long the cushion's own lateral velocity takes to bleed off once the
 * contact ends, in seconds - and, on the way in, the time constant of the ramp.
 *
 * 0.35 s is short enough that the craft is back on the driver's line almost
 * immediately after a brush, and long enough that the push does not read as a
 * kick. Round 1 ran 0.5 s at a fifth of the acceleration and the two together
 * were what made the feature invisible.
 */
export const CUSHION_VELOCITY_TIME_CONSTANT_SECONDS = 0.35;
/** Expressed as a rate for the integrator: 1 / time constant. */
export const CUSHION_VELOCITY_DAMPING = 1 / CUSHION_VELOCITY_TIME_CONSTANT_SECONDS;
/**
 * Separation under which a "tow" is really a contact.
 *
 * The cushion exempts a craft the player is properly drafting, because a locked
 * tow is the game working rather than two hulls fouling. That exemption has to
 * stop somewhere, and this is where.
 *
 * INTERPRETED, and the interpretation is worth stating. The round 2 brief asks
 * for "a tow that closes under 2.0 m LATERAL" to drop the lock. Read literally
 * that disarms every draft in the game: SLIPSTREAM_LATERAL_FULL_METERS is
 * 1.5 m, so a full tow is BY DEFINITION under 2.0 m of lateral - the rule would
 * mean no lock could ever exist. Taken as SEPARATION it says the intended
 * thing: a tow sits 4-16 m back, so hypot is 4 m or more and the exemption
 * survives, while a craft that has closed to within 2 m of the one ahead is
 * touching it and gets the cushion.
 */
export const CUSHION_TOW_CONTACT_SEPARATION_METERS = 2;

/**
 * The soft contact between the player and one rival, for one step.
 *
 * Pure and allocation free: the race loop hands it the same `target` object
 * every step, so a whole race allocates nothing here.
 *
 * @param {number} lateralGapMeters signed, rival lateral minus player lateral
 * @param {number} longitudinalGapMeters signed, rival distance minus player's
 * @param {number} closingLateralSpeed m/s, positive when the gap is shrinking
 * @param {{ lateralPush: number, speedScrub: number, contact: boolean }} [target]
 * @returns {{ lateralPush: number, speedScrub: number, contact: boolean }}
 *   `lateralPush` in m/s^2 on the player, `speedScrub` as a share of current
 *   speed per second, `contact` false while only the pre-lean is acting
 */
export function calculateCushion(
  lateralGapMeters,
  longitudinalGapMeters,
  closingLateralSpeed,
  target = { lateralPush: 0, speedScrub: 0, contact: false },
) {
  target.lateralPush = 0;
  target.speedScrub = 0;
  target.contact = false;
  if (!Number.isFinite(lateralGapMeters) || !Number.isFinite(longitudinalGapMeters)) {
    return target;
  }
  const lateral = Math.abs(lateralGapMeters);
  const longitudinal = Math.abs(longitudinalGapMeters);
  if (
    lateral >= CUSHION_PRE_LEAN_RANGE_METERS
    || longitudinal >= CUSHION_LONGITUDINAL_RANGE_METERS
  ) return target;
  const along = 1 - smoothstep(
    longitudinal,
    CUSHION_LONGITUDINAL_FULL_METERS,
    CUSHION_LONGITUDINAL_RANGE_METERS,
  );
  const closing = Number.isFinite(closingLateralSpeed)
    ? clamp(closingLateralSpeed, 0, CUSHION_CLOSING_REFERENCE_MPS)
      / CUSHION_CLOSING_REFERENCE_MPS
    : 0;
  // Two bands, joined so the magnitude is continuous at the seam: the pre-lean
  // runs 0 -> CUSHION_PRE_LEAN_PUSH_MPS2 between 4.6 m and 3.4 m, and the field
  // proper carries on from that same value up to the peak at 1.4 m. Approaching
  // 3.4 m from either side gives CUSHION_PRE_LEAN_PUSH_MPS2, so nothing steps.
  const contact = lateral < CUSHION_LATERAL_RANGE_METERS;
  const across = contact
    ? smoothstep(
      CUSHION_LATERAL_RANGE_METERS - lateral,
      0,
      CUSHION_LATERAL_RANGE_METERS - CUSHION_LATERAL_PEAK_METERS,
    )
    : 0;
  const firmness = clamp(across * (1 + CUSHION_CLOSING_GAIN * closing), 0, 1);
  const magnitude = contact
    ? CUSHION_PRE_LEAN_PUSH_MPS2
      + (CUSHION_PEAK_PUSH_MPS2 - CUSHION_PRE_LEAN_PUSH_MPS2) * firmness
    : CUSHION_PRE_LEAN_PUSH_MPS2 * smoothstep(
      CUSHION_PRE_LEAN_RANGE_METERS - lateral,
      0,
      CUSHION_PRE_LEAN_RANGE_METERS - CUSHION_LATERAL_RANGE_METERS,
    );
  // Away from the rival. A gap of exactly zero resolves to a push toward
  // negative lateral rather than to no push at all, so two craft on identical
  // lines still separate instead of sitting inside one another.
  const away = lateralGapMeters >= 0 ? -1 : 1;
  target.lateralPush = away * magnitude * along;
  // The scrub reads the GEOMETRY only, never the closing term: leaning on a
  // rival costs the same whether the player arrived there fast or drifted in.
  // It stays confined to the FIELD, not the pre-lean - the pre-lean is a bleed
  // applied to craft that are merely near each other, and charging speed for
  // that would tax every near miss the phase is trying to reward.
  target.speedScrub = CUSHION_MAX_SCRUB_PER_SECOND * across * along;
  // Whether this is CONTACT, as against the pre-lean's gentle nudge. The glow,
  // the spark burst and the contact counters all read this rather than "the
  // push is non-zero", so their round 2 meaning is unchanged: a craft 4 m away
  // being bled off is not a craft the player is leaning on.
  target.contact = contact && target.lateralPush !== 0;
  return target;
}

/**
 * Integrates the cushion's own lateral velocity.
 *
 * TWO REGIMES, because a pressure field and a release are not the same thing.
 *
 *   PUSHING - the field accelerates the craft, full stop. `v += push * delta`,
 *     bounded by CUSHION_VELOCITY_CAP_MPS. There is no drag term here on
 *     purpose: a damping that fought the push while the hulls were still
 *     fouling is exactly what made round 1 useless, and it is also wrong -
 *     nothing is resisting the separation while the two craft are inside one
 *     another's air.
 *   CLEAR - the craft coasts back onto the driver's line, decaying with
 *     CUSHION_VELOCITY_TIME_CONSTANT_SECONDS. This is the regime the brief's
 *     0.35 s describes, and it is what stops a brush handing the player a
 *     permanent sideways drift.
 *
 * Both halves are exact over the step rather than Euler approximations of
 * something else - a constant acceleration integrates exactly, and the decay
 * uses the closed form - so 60 Hz and 120 Hz agree to floating point.
 *
 * @param {number} velocity
 * @param {number} pushMetersPerSecondSquared signed; zero means clear
 * @param {number} delta
 */
export function integrateCushionVelocity(velocity, pushMetersPerSecondSquared, delta) {
  const current = Number.isFinite(velocity) ? velocity : 0;
  const push = Number.isFinite(pushMetersPerSecondSquared)
    ? pushMetersPerSecondSquared
    : 0;
  const step = Number.isFinite(delta) ? clamp(delta, 0, 0.1) : 0;
  const next = push === 0
    ? current * Math.exp(-step * CUSHION_VELOCITY_DAMPING)
    : current + push * step;
  return clamp(next, -CUSHION_VELOCITY_CAP_MPS, CUSHION_VELOCITY_CAP_MPS);
}

const OVERSPEED_DRAG_RATE = 0.45;
const COAST_BASE_DECELERATION = 10;
const COAST_SPEED_DRAG_RATE = 0.55;
const COAST_STOP_SPEED = 0.35;

/** @param {number} value @param {number} minimum @param {number} maximum */
function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

/** @param {number} start @param {number} end @param {number} amount */
function lerp(start, end, amount) {
  return start + (end - start) * amount;
}

/** @param {number} value @param {number} minimum @param {number} maximum */
function smoothstep(value, minimum, maximum) {
  const amount = clamp((value - minimum) / (maximum - minimum), 0, 1);
  return amount * amount * (3 - 2 * amount);
}

/**
 * @param {number} speedRatio
 * @param {number} brake
 * @param {number} steer
 */
export function calculateDriftIntent(speedRatio, brake, steer) {
  return brake * Math.abs(steer) * smoothstep(speedRatio, 0.28, 0.78);
}

/**
 * Uses separate enter and exit thresholds so noisy analogue input cannot flicker
 * drift feedback while the underlying continuous physics stays unchanged.
 * @param {boolean} previousActive
 * @param {number} driftIntent
 */
export function resolveDriftActive(previousActive, driftIntent) {
  const threshold = previousActive ? 0.14 : 0.26;
  return clamp(driftIntent, 0, 1) >= threshold;
}

/**
 * Tow strength behind the craft ahead, 0..1.
 *
 * Pure and allocation free: `updateRace` calls it three times a step, once per
 * rival, from race-distance fields it already has.
 *
 * @param {number} distanceBehindMeters positive when the other craft is ahead
 * @param {number} lateralGapMeters signed offset between the two lines
 * @param {number} speedRatio player speed over {@link BOOST_MAX_SPEED}
 * @returns {number} clamped to [0, 1]
 */
export function calculateSlipstream(distanceBehindMeters, lateralGapMeters, speedRatio) {
  const distance = Number.isFinite(distanceBehindMeters) ? distanceBehindMeters : 0;
  const lateral = Number.isFinite(lateralGapMeters) ? Math.abs(lateralGapMeters) : Infinity;
  const ratio = Number.isFinite(speedRatio) ? speedRatio : 0;
  if (distance <= 0 || distance >= SLIPSTREAM_FADE_METERS) return 0;
  if (lateral >= SLIPSTREAM_LATERAL_FADE_METERS) return 0;
  const longitudinal = distance < SLIPSTREAM_NEAR_METERS
    ? distance / SLIPSTREAM_NEAR_METERS
    : distance <= SLIPSTREAM_FULL_METERS
      ? 1
      : 1 - (distance - SLIPSTREAM_FULL_METERS)
        / (SLIPSTREAM_FADE_METERS - SLIPSTREAM_FULL_METERS);
  const across = lateral <= SLIPSTREAM_LATERAL_FULL_METERS
    ? 1
    : 1 - (lateral - SLIPSTREAM_LATERAL_FULL_METERS)
      / (SLIPSTREAM_LATERAL_FADE_METERS - SLIPSTREAM_LATERAL_FULL_METERS);
  const gate = smoothstep(
    ratio,
    SLIPSTREAM_MINIMUM_SPEED_RATIO,
    SLIPSTREAM_SPEED_RATIO_RAMP,
  );
  return clamp(longitudinal * across * gate, 0, 1);
}

/**
 * @param {number} speed
 * @param {number} throttle
 * @param {number} brake
 * @param {boolean} boostActive
 * @param {number} driftIntent
 * @param {number} delta
 * @param {number} [slipstream] 0..1 tow from the craft ahead
 */
export function integrateSpeed(
  speed,
  throttle,
  brake,
  boostActive,
  driftIntent,
  delta,
  slipstream = 0,
) {
  const tow = Number.isFinite(slipstream) ? clamp(slipstream, 0, 1) : 0;
  // The tow is a drag reduction expressed as a lift of the cruise cap: it moves
  // the knee where overspeed drag starts and, with it, the engine's own falloff
  // curve. It is deliberately NOT a change to CRUISE_MAX_SPEED itself - the
  // constant stays the authored cruise and the tow is a bonus over it.
  const cruiseCap = CRUISE_MAX_SPEED * (1 + SLIPSTREAM_CRUISE_BONUS * tow);
  const maxSpeed = boostActive ? BOOST_MAX_SPEED : cruiseCap;
  const engineForce = throttle * (26 - (speed / maxSpeed) * 12);
  const boostForce = boostActive ? 34 : 0;
  const brakeForce = brake * lerp(46, 25, driftIntent);
  const drag = 1.2 + speed * 0.038 + speed * speed * 0.0007;
  const overspeedDrag = boostActive
    ? 0
    : Math.max(0, speed - cruiseCap) * OVERSPEED_DRAG_RATE;
  const nextSpeed = speed + (
    engineForce
    + boostForce
    - brakeForce
    - drag
    - overspeedDrag
  ) * delta;
  return clamp(nextSpeed, 0, BOOST_MAX_SPEED);
}

/**
 * Carries visible finish-line momentum, then settles the result presentation
 * close to The Cradle instead of simulating another sector behind the overlay.
 * @param {number} speed
 * @param {number} delta
 */
export function integrateCoastSpeed(speed, delta) {
  const currentSpeed = Number.isFinite(speed)
    ? clamp(speed, 0, BOOST_MAX_SPEED)
    : 0;
  const step = Number.isFinite(delta) ? clamp(delta, 0, 0.1) : 0;
  if (currentSpeed <= COAST_STOP_SPEED || step === 0) {
    return currentSpeed <= COAST_STOP_SPEED ? 0 : currentSpeed;
  }
  const nextSpeed = Math.max(
    0,
    currentSpeed - (
      COAST_BASE_DECELERATION + currentSpeed * COAST_SPEED_DRAG_RATE
    ) * step,
  );
  return nextSpeed <= COAST_STOP_SPEED ? 0 : nextSpeed;
}

/**
 * Banks committed drift. Linear in delta so 60 Hz and 120 Hz charge and decay
 * the same bank over the same wall-clock drift, and clamped at both ends so the
 * caller never has to guard the stored value.
 * @param {number} charge
 * @param {number} driftIntensity zero (or less) means off drift, and decays
 * @param {number} delta
 */
export function integrateDriftCharge(charge, driftIntensity, delta) {
  const current = Number.isFinite(charge)
    ? clamp(charge, 0, DRIFT_CHARGE_CAP)
    : 0;
  const intensity = Number.isFinite(driftIntensity)
    ? clamp(driftIntensity, 0, 1)
    : 0;
  const step = Number.isFinite(delta) ? Math.max(0, delta) : 0;
  const rate = intensity > 0
    ? intensity * DRIFT_CHARGE_RATE
    : -DRIFT_CHARGE_DECAY_RATE;
  return clamp(current + rate * step, 0, DRIFT_CHARGE_CAP);
}

/**
 * Pays the bank out on the drift-release edge only. A release under the
 * minimum charge pays nothing and consumes nothing — the bank is left to the
 * off-drift decay — so a twitch of brake-and-steer cannot farm reserve.
 * @param {number} charge
 * @param {boolean} wasDrifting
 * @param {boolean} isDrifting
 * @returns {{ reward: number, consumed: boolean }}
 */
export function resolveDriftRelease(charge, wasDrifting, isDrifting) {
  const current = Number.isFinite(charge)
    ? clamp(charge, 0, DRIFT_CHARGE_CAP)
    : 0;
  const released = Boolean(wasDrifting) && !isDrifting;
  if (!released || current < DRIFT_REWARD_MINIMUM_CHARGE) {
    return { reward: 0, consumed: false };
  }
  return { reward: DRIFT_RELEASE_REWARD, consumed: true };
}

/**
 * The reserve integrator owns the drift reward too, so every path that can move
 * the reserve shares one clamp and the stored value can never leave [0, 1].
 * @param {number} reserve
 * @param {boolean} reserveBoostActive
 * @param {number} delta
 * @param {number} [reward] drift-release payout applied this step
 * @param {number} [slipstream] 0..1 tow, which speeds the refill but never the drain
 * @param {number} [regenMultiplier] G2 clean-gate chain, which likewise only
 *   ever multiplies the PASSIVE regen - see `cleanGateRegenMultiplier`
 */
export function integrateBoostReserve(
  reserve,
  reserveBoostActive,
  delta,
  reward = 0,
  slipstream = 0,
  regenMultiplier = 1,
) {
  const current = Number.isFinite(reserve) ? clamp(reserve, 0, 1) : 0;
  const payout = Number.isFinite(reward) ? Math.max(0, reward) : 0;
  const step = Number.isFinite(delta) ? Math.max(0, delta) : 0;
  const tow = Number.isFinite(slipstream) ? clamp(slipstream, 0, 1) : 0;
  const chain = Number.isFinite(regenMultiplier) ? clamp(regenMultiplier, 1, 2) : 1;
  const rate = reserveBoostActive
    ? -BOOST_RESERVE_DRAIN_RATE
    : BOOST_RESERVE_REGEN_RATE * (1 + SLIPSTREAM_REGEN_BONUS * tow) * chain;
  return clamp(current + payout + rate * step, 0, 1);
}

/**
 * Once the reserve reaches its cutoff, boost stays locked until the player
 * releases the input. This prevents empty-reserve boost from chattering between
 * one recharge frame and one drain frame while the button remains held.
 * @param {boolean} boostRequested
 * @param {number} reserve
 * @param {boolean} previousLockout
 */
export function resolveBoostLockout(boostRequested, reserve, previousLockout) {
  if (!boostRequested) return false;
  return previousLockout || reserve <= BOOST_RESERVE_CUTOFF;
}

/**
 * @param {number} current
 * @param {number} target
 * @param {number} delta
 */
export function integrateSteering(current, target, delta) {
  const responseRate = Math.abs(target) > 0.01 ? 6.2 : 8.5;
  const response = 1 - Math.exp(-Math.max(0, delta) * responseRate);
  return lerp(current, clamp(target, -1, 1), response);
}

/** @param {number} speedRatio */
export function calculateTurnAuthority(speedRatio) {
  return lerp(0.32, 1, smoothstep(speedRatio, 0.015, 0.2));
}

/** @param {number} speedRatio @param {number} driftIntent */
export function calculateTurnRate(speedRatio, driftIntent) {
  return lerp(1.85, 0.92, smoothstep(speedRatio, 0.12, 1))
    * (1 + driftIntent * 0.58);
}

/**
 * @param {number} speedRatio
 * @param {number} driftIntent
 * @param {number} surfaceGrip
 * @param {number} brake
 * @param {number} steer
 */
export function calculateGripRate(
  speedRatio,
  driftIntent,
  surfaceGrip,
  brake,
  steer,
) {
  return lerp(7.2, 1.85, smoothstep(speedRatio, 0.08, 1))
    * lerp(1, 0.36, driftIntent)
    * surfaceGrip
    + brake * 2.2 * (1 - Math.abs(steer));
}

/**
 * Composes the authored course grip (standing water) with the authored apron
 * grip into one target. Multiplying keeps both authored costs visible instead
 * of letting the wider one mask the other, and the floor stops a compounded
 * target from dropping below the handling model's usable range.
 * @param {number} courseGrip
 * @param {number} apronGrip
 * @param {number} [gripFloor]
 */
export function resolveTargetSurfaceGrip(courseGrip, apronGrip, gripFloor = 0.2) {
  const floor = Number.isFinite(gripFloor) ? clamp(gripFloor, 0.05, 1) : 0.2;
  const course = Number.isFinite(courseGrip) ? clamp(courseGrip, floor, 1) : 1;
  const apron = Number.isFinite(apronGrip) ? clamp(apronGrip, floor, 1) : 1;
  return clamp(course * apron, floor, 1);
}

/**
 * Speed lost while the vehicle is held against an authored boundary. Linear in
 * delta, so 60 Hz and 120 Hz scrub the same amount over the same wall contact.
 * @param {number} speed
 * @param {number} scrubMetersPerSecondSquared
 * @param {number} delta
 */
export function integrateEdgeScrub(speed, scrubMetersPerSecondSquared, delta) {
  const currentSpeed = Number.isFinite(speed) ? Math.max(0, speed) : 0;
  const scrub = Number.isFinite(scrubMetersPerSecondSquared)
    ? Math.max(0, scrubMetersPerSecondSquared)
    : 0;
  const step = Number.isFinite(delta) ? Math.max(0, delta) : 0;
  return Math.max(0, currentSpeed - scrub * step);
}

/**
 * Wet surfaces take hold quickly, while recovery uses the authored duration so
 * crossing the water boundary cannot snap lateral response in one step.
 * @param {number} currentGrip
 * @param {number} targetGrip
 * @param {number} recoverySeconds
 * @param {number} delta
 */
export function integrateSurfaceGrip(
  currentGrip,
  targetGrip,
  recoverySeconds,
  delta,
) {
  const current = Number.isFinite(currentGrip) ? clamp(currentGrip, 0.2, 1) : 1;
  const target = Number.isFinite(targetGrip) ? clamp(targetGrip, 0.2, 1) : 1;
  if (Math.abs(current - target) < 1e-6) return target;
  const recovery = Number.isFinite(recoverySeconds) && recoverySeconds > 0
    ? recoverySeconds
    : 0.8;
  const step = Number.isFinite(delta) ? Math.max(0, delta) : 0;
  const responseRate = target < current ? 18 : 3 / recovery;
  return lerp(current, target, 1 - Math.exp(-step * responseRate));
}
