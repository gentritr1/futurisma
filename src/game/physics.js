export const CRUISE_MAX_SPEED = 86;
export const BOOST_MAX_SPEED = 112;
const NON_BOOST_SPEED_LIMIT = 92;

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
  const nextSpeed = speed + (engineForce + boostForce - brakeForce - drag) * delta;
  return clamp(
    nextSpeed,
    0,
    boostActive ? BOOST_MAX_SPEED : NON_BOOST_SPEED_LIMIT,
  );
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
