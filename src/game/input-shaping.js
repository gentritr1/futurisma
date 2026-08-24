const DEFAULT_STEERING_DEADZONE = 0.16;

/** @param {number} value @param {number} minimum @param {number} maximum */
function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

/**
 * Removes normal stick noise, rescales the remaining travel, and rejects
 * non-finite driver values before they can enter the physics state.
 * @param {number} value
 * @param {number} [deadzone]
 */
export function applySteeringDeadzone(
  value,
  deadzone = DEFAULT_STEERING_DEADZONE,
) {
  const axis = Number.isFinite(value) ? clamp(value, -1, 1) : 0;
  const threshold = Number.isFinite(deadzone)
    ? clamp(deadzone, 0, 0.95)
    : DEFAULT_STEERING_DEADZONE;
  const magnitude = Math.abs(axis);
  if (magnitude <= threshold) return 0;
  return Math.sign(axis) * ((magnitude - threshold) / (1 - threshold));
}

/** @param {number} value */
export function sanitizeTrigger(value) {
  return Number.isFinite(value) ? clamp(value, 0, 1) : 0;
}

/**
 * A deliberate digital direction wins while held; otherwise steering comes
 * from the sanitized analogue axis.
 * @param {number} keyboardSteer
 * @param {number} gamepadAxis
 */
export function resolveSteeringInput(keyboardSteer, gamepadAxis) {
  const keyboard = Number.isFinite(keyboardSteer)
    ? clamp(keyboardSteer, -1, 1)
    : 0;
  if (keyboard !== 0) return keyboard;
  return applySteeringDeadzone(gamepadAxis);
}
