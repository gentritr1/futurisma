/** @param {number} value @param {number} minimum @param {number} maximum */
function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
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
