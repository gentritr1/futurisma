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
 * P7 — the two viewport-bound wrappers, moved out of the race loop.
 *
 * `game.ts` held a pair of one-expression methods that did nothing but read
 * `window` and forward to the calculators above. They belong with the ratio
 * maths, not with the race loop, and moving them keeps the seam budget honest
 * as the meta layer lands. `window` is read at call time, so this module still
 * imports cleanly under Node for `scripts/validate-render-quality.mjs`.
 *
 * @param {RenderQualityMode} mode
 */
export function preferredPixelRatioFor(mode) {
  return calculatePreferredPixelRatio(
    window.innerHeight,
    window.devicePixelRatio,
    mode,
  );
}

/** @param {RenderQualityMode} mode */
export function minimumPixelRatioFor(mode) {
  return calculateMinimumPixelRatio(
    window.innerHeight,
    window.devicePixelRatio,
    mode,
  );
}

/**
 * P7 — the resolution lock, resolved once.
 *
 * `?quality=` stays the QA override and always wins; a bare load falls through
 * to the stored setting, and anything unrecognised lands on `adaptive`. The
 * stored value is passed in rather than read here so this module stays free of
 * the save layer and importable under Node.
 *
 * @param {string | null} override
 * @param {string} stored
 * @returns {RenderQualityMode}
 */
export function resolveQualityMode(override, stored) {
  const requested = override ?? stored;
  if (requested === "high") return "high";
  if (requested === "low") return "low";
  return "adaptive";
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
