/**
 * P20.5 — speed lines belong to a map, not to the engine.
 *
 * The 96 additive white-cyan streaks were drawn for Greenwater, whose sky is
 * dark and humid: an additive highlight over that reads as air moving. Bitterpan
 * inherited them unchanged and its sky is pale, so the same streaks read as
 * scratches on the lens — measured on the merged base, they were the busiest
 * thing in most Bitterpan frames.
 *
 * A profile is a palette decision, so it lives in data. What it deliberately
 * does NOT touch is the *shape* of the speed and drift ramps in
 * `calculateSpeedStreakOpacity` / `calculateSpeedStreakLength`: those decide
 * when a streak appears and how it grows with velocity, which is game feel and
 * is identical on both maps. `opacityScale` and `lengthScale` are applied over
 * the ramp's output, never inside it.
 *
 * `opacityScale` multiplies both the normal and the reduced-motion branch of
 * that ramp. Reduced motion is a motion decision (no roll, short streaks, low
 * ceiling) and is untouched here; the map scale is a colour decision and
 * applies to whatever the ramp returned.
 */

/**
 * @typedef {object} SpeedLineProfile
 * @property {number} count streak segments in the buffer
 * @property {number} color base streak colour
 * @property {number} boostColor colour while boost is held
 * @property {number} lengthScale over `calculateSpeedStreakLength`
 * @property {number} opacityScale over `calculateSpeedStreakOpacity`
 * @property {boolean} additive additive blending, or normal alpha
 */

/** @type {Readonly<Record<string, SpeedLineProfile>>} */
export const SPEED_LINE_PROFILES = Object.freeze({
  /**
   * Greenwater, as shipped, at -20% opacity. The dark sky can carry an additive
   * highlight; it just carried slightly too much of one.
   */
  greenwater: Object.freeze({
    count: 96,
    color: 0xc5f4ff,
    boostColor: 0x78d6de,
    lengthScale: 1,
    opacityScale: 0.8,
    additive: true,
  }),
  /**
   * Bitterpan: warm pan dust rather than cold light. Normal blending, because
   * additive over a pale sky is what made the streaks read as near-white
   * scratches — a warm tint at normal alpha lands *below* the sky's own value
   * over the pan and above it against the deck, which is what dust does.
   * 60 streaks at 0.7 length: fewer, shorter, and the same ramp underneath.
   */
  bitterpan: Object.freeze({
    count: 60,
    color: 0xd8c8a8,
    boostColor: 0xe8d2a4,
    lengthScale: 0.7,
    opacityScale: 0.55,
    additive: false,
  }),
});

/**
 * @param {string} kind course kind
 * @returns {SpeedLineProfile}
 */
export function resolveSpeedLineProfile(kind) {
  return SPEED_LINE_PROFILES[kind] ?? SPEED_LINE_PROFILES.greenwater;
}
