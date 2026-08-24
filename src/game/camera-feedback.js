/** @param {number} value @param {number} minimum @param {number} maximum */
function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

/**
 * Arcade lens response with bounded speed expansion and a small speed-scaled
 * braking compression. Reduced motion retains state readability at lower range.
 * @param {number} speedRatio
 * @param {boolean} boostActive
 * @param {number} driftIntensity
 * @param {number} brake
 * @param {boolean} reducedMotion
 */
export function calculateDesiredCameraFov(
  speedRatio,
  boostActive,
  driftIntensity,
  brake,
  reducedMotion,
) {
  const speed = Number.isFinite(speedRatio) ? clamp(speedRatio, 0, 1) : 0;
  const drift = Number.isFinite(driftIntensity) ? clamp(driftIntensity, 0, 1) : 0;
  const braking = Number.isFinite(brake) ? clamp(brake, 0, 1) : 0;
  const speedRange = reducedMotion ? 5 : 10;
  const boostRange = reducedMotion ? 2 : 7;
  const driftRange = reducedMotion ? 0.6 : 3;
  const brakeRange = reducedMotion ? 1 : 3;
  return 56
    + speed * speedRange
    + (boostActive ? boostRange : 0)
    + drift * driftRange
    - braking * speed * brakeRange;
}

/** @param {number} currentFov @param {number} desiredFov @param {number} deltaSeconds */
export function integrateCameraFov(currentFov, desiredFov, deltaSeconds) {
  const current = Number.isFinite(currentFov) ? currentFov : 56;
  const desired = Number.isFinite(desiredFov) ? desiredFov : 56;
  const delta = Number.isFinite(deltaSeconds) ? Math.max(0, deltaSeconds) : 0;
  return current + (desired - current) * (1 - Math.exp(-delta * 4.8));
}

/**
 * Deterministic, bounded impact vibration. Sampling the same timestamp always
 * returns the same offset, so camera feedback does not change with render rate.
 * @param {number} elapsedSeconds
 * @param {number} intensity
 * @param {"lateral" | "vertical"} axis
 */
export function calculateImpactShakeOffset(elapsedSeconds, intensity, axis) {
  if (!Number.isFinite(elapsedSeconds) || !Number.isFinite(intensity)) return 0;
  const trauma = clamp(intensity, 0, 1);
  if (trauma === 0) return 0;
  const amplitude = trauma * trauma * 0.16;
  if (axis === "lateral") {
    return (
      Math.sin(elapsedSeconds * 71 + 0.8) * 0.72
      + Math.sin(elapsedSeconds * 113 + 2.1) * 0.28
    ) * amplitude;
  }
  return (
    Math.sin(elapsedSeconds * 83 + 1.7) * 0.74
    + Math.sin(elapsedSeconds * 127 + 0.3) * 0.26
  ) * amplitude;
}
