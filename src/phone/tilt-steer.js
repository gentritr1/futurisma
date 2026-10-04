// Tilt steering for the phone controller.
//
// Steering is the angle the phone's landscape-horizontal axis makes with the
// horizon, read from the gravity vector (`accelerationIncludingGravity`). That
// one number is the same gesture whether the phone is held upright like a wheel
// (rotating about the screen normal raises one end) or flat like a tray (tipping
// one end down), and it never passes through the Euler-angle gimbal lock that
// `deviceorientation` hits with the phone upright in landscape.
//
// Device axes (W3C): +x right, +y towards the top of the phone in portrait, +z
// out of the screen; at rest the reading points UP (flat, screen up: z = +g).
// Held landscape with the top of the phone to the LEFT, +x points up, so an
// upright grip reads gx > 0, and turning the phone clockwise (steer right)
// swings the up vector towards +y: gy > 0. With the top to the RIGHT both signs
// flip. So `gy * sign(gx)` is steer-right-positive in either landscape, and it
// is also immune to a platform that reports the whole vector inverted, because
// both factors flip together.

/**
 * Feel presets, picked on the phone. Full lock is the tilt that gives full
 * steering; `expo` > 1 makes small tilts gentle and keeps full authority at the
 * end. First playtest (2026-10-04, 28° lock, linear) was "a bit too hard", so
 * MEDIUM halves the response at 15° (0.49 -> 0.22) and moves full lock to 40°.
 */
export const TILT_PRESETS = {
  soft: { fullLockDeg: 50, expo: 1.6 },
  medium: { fullLockDeg: 40, expo: 1.4 },
  sharp: { fullLockDeg: 30, expo: 1.15 },
};
export const TILT_FULL_LOCK_DEG = TILT_PRESETS.medium.fullLockDeg;
export const TILT_EXPO = TILT_PRESETS.medium.expo;
export const TILT_DEADZONE_DEG = 2;
/** Below this share of g on the x axis the grip is too flat to read its sign. */
const UPRIGHT_SHARE = 0.3;

/** @param {number} value @param {number} minimum @param {number} maximum */
function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

/**
 * Which way the landscape axis runs, chosen once at calibration.
 *
 * From gravity when the phone is upright enough to read it (robust to platform
 * sign conventions), otherwise from the screen angle the browser reports,
 * where 90 means the top of the phone is to the left.
 * @param {number} gx @param {number} gy @param {number} gz
 * @param {number} screenAngle degrees, as `window.orientation` / `screen.orientation.angle`
 * @returns {-1 | 0 | 1} 0 when the phone is not in landscape
 */
export function resolveLandscapeSign(gx, gy, gz, screenAngle) {
  const magnitude = Math.hypot(gx, gy, gz);
  if (Number.isFinite(magnitude) && magnitude > 0 && Math.abs(gx) / magnitude > UPRIGHT_SHARE) {
    return gx > 0 ? 1 : -1;
  }
  // Flat grip. The screen angle gives the side, but it does not flip with a
  // platform that reports gravity itself instead of the spec's reaction vector
  // (iOS: z ~ -g face up, spec: +g), so read the convention off z: in any grip
  // where the player can see the screen it faces up, i.e. spec z >= 0.
  const angle = ((Math.round(screenAngle) % 360) + 360) % 360;
  const convention = gz < 0 ? -1 : 1;
  if (angle === 90) return /** @type {-1 | 1} */ (convention);
  if (angle === 270) return /** @type {-1 | 1} */ (-convention);
  return 0;
}

/**
 * Signed tilt of the landscape axis in degrees, steer-right positive.
 * @param {number} gx @param {number} gy @param {number} gz
 * @param {-1 | 0 | 1} landscapeSign
 * @returns {number | null} null when the reading is unusable
 */
export function tiltAngleDeg(gx, gy, gz, landscapeSign) {
  const magnitude = Math.hypot(gx, gy, gz);
  if (!landscapeSign || !Number.isFinite(magnitude) || magnitude < 0.05) return null;
  return Math.asin(clamp((gy * landscapeSign) / magnitude, -1, 1)) * (180 / Math.PI);
}

/**
 * Tilt relative to the calibrated neutral, to a steering value in [-1, 1].
 * @param {number} angleDeg @param {number} neutralDeg
 * @param {number} [fullLockDeg] @param {number} [deadzoneDeg] @param {number} [expo]
 */
export function shapeTiltSteer(
  angleDeg,
  neutralDeg,
  fullLockDeg = TILT_FULL_LOCK_DEG,
  deadzoneDeg = TILT_DEADZONE_DEG,
  expo = TILT_EXPO,
) {
  const delta = angleDeg - neutralDeg;
  if (!Number.isFinite(delta)) return 0;
  const magnitude = Math.abs(delta);
  if (magnitude <= deadzoneDeg) return 0;
  const linear = Math.min(1, (magnitude - deadzoneDeg) / (fullLockDeg - deadzoneDeg));
  return Math.sign(delta) * linear ** expo;
}

/**
 * Gravity for tilt. Where the browser also reports `acceleration` (the
 * sensor-fused, gyro-assisted user acceleration — iOS does), subtracting it from
 * `accelerationIncludingGravity` leaves the fused gravity vector, which does
 * not shake with the hand and needs almost no smoothing. Otherwise the raw
 * reading is all there is.
 * @param {{x: number | null, y: number | null, z: number | null} | null} withGravity
 * @param {{x: number | null, y: number | null, z: number | null} | null} userAcceleration
 * @returns {{ x: number, y: number, z: number, fused: boolean } | null}
 */
export function gravityVector(withGravity, userAcceleration) {
  if (!withGravity) return null;
  const { x, y, z } = withGravity;
  if (![x, y, z].every((value) => typeof value === "number" && Number.isFinite(value))) return null;
  const user = userAcceleration;
  if (user && [user.x, user.y, user.z].every((value) => typeof value === "number" && Number.isFinite(value))) {
    return {
      x: /** @type {number} */ (x) - /** @type {number} */ (user.x),
      y: /** @type {number} */ (y) - /** @type {number} */ (user.y),
      z: /** @type {number} */ (z) - /** @type {number} */ (user.z),
      fused: true,
    };
  }
  return { x: /** @type {number} */ (x), y: /** @type {number} */ (y), z: /** @type {number} */ (z), fused: false };
}
