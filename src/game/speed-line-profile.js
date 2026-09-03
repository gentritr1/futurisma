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
   * Bitterpan: warm pan dust rather than cold light, and DARKER than the sky it
   * crosses. Normal blending, because additive over a pale sky is what made the
   * streaks read as near-white scratches.
   *
   * Round 1 of P20.5 used a pale tint (#d8c8a8) at 0.55 opacity over 60 short
   * streaks, and it went too far the other way: the streaks landed within a few
   * luma of the sky and the speed cue disappeared — measured 36/20/29 streak
   * pixels against a base of 1117/493/540, a 95-97% cut, peaking at 3-6 luma.
   *
   * A dark tint at normal alpha is how dust actually reads against a bright pan
   * sky: it is legible because it is DARKER, which is the one direction that can
   * never approach white however hard it is pushed. #201a12 is much darker than
   * the "warm dust" an eye would pick off a palette, and it has to be: under AgX
   * a mid tint like #8f8270 renders at ~123 luma, within ten luma of this sky,
   * and produced a measured ZERO streak pixels at the 6-luma threshold.
   *
   * Density and length carry the rest. Round 1 cut both (60 streaks, 0.7 length)
   * on top of an already quiet blend, which was over-correction twice over; a
   * quiet streak has to be a bit more numerous to still say "fast". 112 at 0.95
   * with the peak held at 13-15 luma puts the isolated streak layer at 27-53% of
   * the pre-P20.5 count with zero near-white pixels, against 95-97% quieter and
   * invisible before. The ramp underneath is untouched.
   */
  bitterpan: Object.freeze({
    count: 112,
    color: 0x201a12,
    boostColor: 0x28211a,
    lengthScale: 0.95,
    opacityScale: 0.8,
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
