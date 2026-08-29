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

/**
 * P11 — the banked deck's height at a lateral offset.
 *
 * `course.sample()` rotates `right` and `up` by the authored bank, so the
 * drivable surface at lateral `L` is `centre + right * L`. Its world height is
 * therefore the centreline height plus `right.y * L`, and `right.y` is exactly
 * `sin(bank)`. Anything that derives a world pose from (progress, lateral) and
 * takes the centreline `y` alone buries the craft into the high side of a
 * banked corner and floats it over the low side — on the 12 degree
 * GREENWATER_SWEEP that is 0.208 m of error per metre of lateral.
 *
 * Presentation only. The race loop's own `position` is the simulation's state:
 * `course.project()` and the demo autopilot both read it back, so moving its
 * `y` would move progress and lateral on the next fixed step and the lap clock
 * with them. The lift is applied to the interpolated presentation copy instead.
 *
 * @param {number} rightY `sample.right.y`, i.e. sin(bank).
 * @param {number} lateral signed metres from the centreline.
 */
export function bankedSurfaceLift(rightY, lateral) {
  if (!Number.isFinite(rightY) || !Number.isFinite(lateral)) return 0;
  return rightY * lateral;
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
