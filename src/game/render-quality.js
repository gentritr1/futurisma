const MINIMUM_PIXEL_RATIO = 0.25;

/**
 * P14 — modern-legibility defaults. PRODUCT.md principle 4: "the PS2 era is the
 * memory, not the method." Atmosphere stays; literal degradation goes wherever
 * it costs legibility, and a 540-line default backbuffer stretched over a 720p
 * window was the largest single legibility cost in the build.
 *
 * `adaptive` now targets 720 lines with the ratio cap opened to 1.0, so a
 * 1280x720 window renders 1:1 instead of at 960x540. `low` inherits the old
 * adaptive target (540 lines) and keeps its own 0.65 cap, so it is still a real
 * step down. `high` is untouched.
 */
const ADAPTIVE_TARGET_LINES = 720;
const ADAPTIVE_RATIO_CAP = 1;
const LOW_TARGET_LINES = 540;
const LOW_RATIO_CAP = 0.65;
/**
 * The adaptive *floor* is deliberately NOT moved with the target. The p95
 * governor in `game.ts` is the safety net for a machine that cannot hold the new
 * target, and narrowing its range would blunt exactly the mechanism that makes
 * raising the target safe. It keeps its 360-line / 0.65 bound.
 */
const ADAPTIVE_FLOOR_LINES = 360;
const ADAPTIVE_FLOOR_RATIO_CAP = 0.65;

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
  const targetHeight = mode === "low" ? LOW_TARGET_LINES : ADAPTIVE_TARGET_LINES;
  const ratioCap = mode === "low" ? LOW_RATIO_CAP : ADAPTIVE_RATIO_CAP;
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
    Math.min(
      preferred,
      ADAPTIVE_FLOOR_RATIO_CAP,
      ADAPTIVE_FLOOR_LINES / Math.max(1, viewportHeight),
    ),
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
