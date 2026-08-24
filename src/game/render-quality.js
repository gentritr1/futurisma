const MINIMUM_PIXEL_RATIO = 0.25;

/** @typedef {"adaptive" | "high" | "low"} RenderQualityMode */

/**
 * @param {number} viewportHeight
 * @param {number} devicePixelRatio
 * @param {RenderQualityMode} mode
 */
export function calculatePreferredPixelRatio(
  viewportHeight,
  devicePixelRatio,
  mode,
) {
  const height = Math.max(1, viewportHeight);
  const deviceRatio = Math.max(MINIMUM_PIXEL_RATIO, devicePixelRatio);
  if (mode === "high") return Math.min(deviceRatio, 1.25);
  const targetHeight = mode === "low" ? 360 : 540;
  const ratioCap = mode === "low" ? 0.65 : 0.82;
  return Math.max(
    MINIMUM_PIXEL_RATIO,
    Math.min(deviceRatio, ratioCap, targetHeight / height),
  );
}

/**
 * @param {number} viewportHeight
 * @param {number} devicePixelRatio
 * @param {RenderQualityMode} mode
 */
export function calculateMinimumPixelRatio(
  viewportHeight,
  devicePixelRatio,
  mode,
) {
  const preferred = calculatePreferredPixelRatio(
    viewportHeight,
    devicePixelRatio,
    mode,
  );
  if (mode !== "adaptive") return preferred;
  return Math.max(
    MINIMUM_PIXEL_RATIO,
    Math.min(preferred, 0.65, 360 / Math.max(1, viewportHeight)),
  );
}

/**
 * Keeps an intentionally degraded adaptive ratio across resize while allowing
 * a ratio at its preferred ceiling to follow the new viewport.
 * @param {number} current
 * @param {number} previousPreferred
 * @param {number} nextPreferred
 * @param {number} nextMinimum
 */
export function reconcilePixelRatioAfterResize(
  current,
  previousPreferred,
  nextPreferred,
  nextMinimum,
) {
  if (Math.abs(current - previousPreferred) < 0.002) return nextPreferred;
  return Math.min(nextPreferred, Math.max(nextMinimum, current));
}
