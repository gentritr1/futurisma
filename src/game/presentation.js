/**
 * Returns the fixed-step remainder used to interpolate the previous and current
 * simulation poses for rendering.
 * @param {number} accumulator
 * @param {number} fixedStep
 */
export function calculatePresentationAlpha(accumulator, fixedStep) {
  if (!Number.isFinite(accumulator) || !Number.isFinite(fixedStep) || fixedStep <= 0) {
    return 0;
  }
  return Math.min(1, Math.max(0, accumulator / fixedStep));
}

/** @param {number} value @param {number} minimum @param {number} maximum */
function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

/** @param {number} value @param {number} minimum @param {number} maximum */
function smoothstep(value, minimum, maximum) {
  const normalized = clamp((value - minimum) / (maximum - minimum), 0, 1);
  return normalized * normalized * (3 - 2 * normalized);
}

/**
 * Keeps chase-camera streaks absent at low speed and restrained at race pace.
 * @param {number} speedRatio
 * @param {number} driftIntensity
 * @param {boolean} reducedMotion
 */
export function calculateSpeedStreakOpacity(
  speedRatio,
  driftIntensity,
  reducedMotion,
) {
  const speed = Number.isFinite(speedRatio) ? clamp(speedRatio, 0, 1) : 0;
  const drift = Number.isFinite(driftIntensity)
    ? clamp(driftIntensity, 0, 1)
    : 0;
  return Math.min(
    0.36,
    smoothstep(speed, 0.44, 0.94) * (reducedMotion ? 0.07 : 0.26)
      + drift * (reducedMotion ? 0.015 : 0.08),
  );
}

/**
 * Streak length communicates velocity without adding more particles or draws.
 * @param {number} speedRatio
 * @param {boolean} boostActive
 * @param {boolean} reducedMotion
 */
export function calculateSpeedStreakLength(
  speedRatio,
  boostActive,
  reducedMotion,
) {
  const speed = Number.isFinite(speedRatio) ? clamp(speedRatio, 0, 1) : 0;
  if (reducedMotion) return 0.45 + speed * 0.55 + (boostActive ? 0.2 : 0);
  return 0.65 + speed * 2.6 + (boostActive ? 1.6 : 0);
}
