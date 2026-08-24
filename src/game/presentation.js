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
