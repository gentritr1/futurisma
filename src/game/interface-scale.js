/**
 * The two interface scales, written to `<body>` as CSS custom properties.
 *
 * `--hud-scale` multiplies every in-race block from its own anchor corner, and
 * `--menu-scale` multiplies the menu panels. Both are plain numbers so CSS can
 * use them inside `scale()` without a unit dance.
 *
 * The HUD scale carries a second term the menu scale does not: a compensation
 * for viewport height. A 1080p screen is not a 720p screen with a 1.5x HUD -
 * the extra pixels should mostly become more view, not more instrument - so the
 * compensation is the square root of the height ratio, clamped so it can never
 * shrink the HUD below the authored size and never run away on a tall monitor.
 */

const USER_HUD_STEP = { s: 0.88, m: 1, l: 1.2 };
const USER_MENU_STEP = { s: 0.9, m: 1, l: 1.15 };

/** The height the HUD was authored against. */
const DESIGN_HEIGHT = 720;
/** Never smaller than authored, never more than a third larger. */
const VIEWPORT_MIN = 1;
const VIEWPORT_MAX = 1.35;

/** @typedef {"s" | "m" | "l"} InterfaceScale */

/**
 * @param {Record<string, number>} table
 * @param {string | undefined} value
 * @returns {number}
 */
function step(table, value) {
  return table[value ?? "m"] ?? table.m;
}

/**
 * The viewport term on its own, so a test can assert it without a DOM.
 *
 * @param {number} viewportHeight CSS pixels.
 * @returns {number}
 */
export function viewportScale(viewportHeight) {
  if (!Number.isFinite(viewportHeight) || viewportHeight <= 0) return VIEWPORT_MIN;
  const raw = Math.sqrt(viewportHeight / DESIGN_HEIGHT);
  return Math.min(VIEWPORT_MAX, Math.max(VIEWPORT_MIN, raw));
}

/**
 * The full HUD multiplier: the stored step times the viewport term.
 *
 * @param {string | undefined} stored `"s" | "m" | "l"`, else the shipped size.
 * @param {number} viewportHeight CSS pixels.
 * @returns {number}
 */
export function hudScaleValue(stored, viewportHeight) {
  return step(USER_HUD_STEP, stored) * viewportScale(viewportHeight);
}

/**
 * The menu multiplier. No viewport term: menu panels already reflow.
 * @param {string | undefined} stored
 * @returns {number}
 */
export function menuScaleValue(stored) {
  return step(USER_MENU_STEP, stored);
}

/**
 * Write both scales onto `<body>`. Safe to call on every settings change and on
 * every resize: it only touches two custom properties, and both are read by CSS
 * rather than by any layout measurement of ours.
 */
/**
 * @param {{ hudScale?: string, menuScale?: string }} settings
 * @param {number} [viewportHeight]
 */
export function applyInterfaceScale(settings, viewportHeight = window.innerHeight) {
  const body = document.body;
  body.style.setProperty("--hud-scale", hudScaleValue(settings.hudScale, viewportHeight).toFixed(4));
  body.style.setProperty("--menu-scale", menuScaleValue(settings.menuScale).toFixed(4));
}
