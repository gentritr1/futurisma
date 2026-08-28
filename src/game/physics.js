export const CRUISE_MAX_SPEED = 86;
export const BOOST_MAX_SPEED = 112;
export const BOOST_RESERVE_CUTOFF = 0.012;
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
 * @param {number} reserve
 * @param {boolean} reserveBoostActive
 * @param {number} delta
 */
export function integrateBoostReserve(reserve, reserveBoostActive, delta) {
  return reserveBoostActive
    ? Math.max(0, reserve - delta * 0.2)
    : Math.min(1, reserve + delta * 0.075);
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
