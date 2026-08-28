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
 * @param {number} speed
 * @param {number} throttle
 * @param {number} brake
 * @param {boolean} boostActive
 * @param {number} driftIntent
 * @param {number} delta
 */
export function integrateSpeed(
  speed,
  throttle,
  brake,
  boostActive,
  driftIntent,
  delta,
) {
  const maxSpeed = boostActive ? BOOST_MAX_SPEED : CRUISE_MAX_SPEED;
  const engineForce = throttle * (26 - (speed / maxSpeed) * 12);
  const boostForce = boostActive ? 34 : 0;
  const brakeForce = brake * lerp(46, 25, driftIntent);
  const drag = 1.2 + speed * 0.038 + speed * speed * 0.0007;
  const overspeedDrag = boostActive
    ? 0
    : Math.max(0, speed - CRUISE_MAX_SPEED) * OVERSPEED_DRAG_RATE;
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
 */
export function integrateBoostReserve(reserve, reserveBoostActive, delta, reward = 0) {
  const current = Number.isFinite(reserve) ? clamp(reserve, 0, 1) : 0;
  const payout = Number.isFinite(reward) ? Math.max(0, reward) : 0;
  const step = Number.isFinite(delta) ? Math.max(0, delta) : 0;
  const rate = reserveBoostActive
    ? -BOOST_RESERVE_DRAIN_RATE
    : BOOST_RESERVE_REGEN_RATE;
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
