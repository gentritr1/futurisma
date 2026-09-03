/**
 * P20.6 review-only: `?floorprobe=1` and `?floorprobe=2`.
 *
 * Both hide the mid-ground band, the living world, the facades, the signage,
 * the 407 crust decals and the set dressing, leaving the road, the pan floor
 * and the sky. `=2` additionally bypasses this whole phase, so the floor
 * renders exactly as it did before P20.6: a flat Lambert quad with one tiled
 * crust texture.
 *
 * They exist because the phase's own acceptance metric could not see the floor.
 * Measured over 13 race-time-matched stations, the stdev of the blurred pan
 * band is ~22 luma on a build whose floor is ONE FLAT COLOUR, because that
 * number is decals, rigs and the fog ramp. A metric that cannot distinguish "no
 * floor detail at all" from "a floor pass shipped" is not measuring the floor,
 * and round 1 of this phase spent its whole budget being told 1.00x by it.
 *
 * `=2` is a better baseline than the pre-phase commit, deliberately: it is the
 * SAME binary, the same frame timing and the same camera path, so a
 * before/after difference cannot be a build difference. It is also the only way
 * to get a baseline with the flag at all, since the pre-phase commit has no
 * `floorprobe` in it.
 *
 * ## Why this is its own file
 *
 * `scene-assets.ts` is in the initial chunk and `pan-floor-colour.js` is not —
 * it is reached only through the lazily imported `bitterpan-surface`. Importing
 * the flag from there pulled the generator, the noise and every tuning constant
 * into the shell and took the initial JS from 225.7 to 227.4 KiB gzip, over the
 * 226 KiB budget `validate-build.mjs` holds. Twelve lines here instead.
 *
 * Not a render mode and not persisted: read fresh on each call, never memoized,
 * and nothing in the game reads it except the layer `visible` flags and the one
 * bypass in `buildPanFloor`.
 */

/**
 * P20.11 added modes 3-6: the same probe view as `=1` with ONE of the floor's
 * terms switched off, so "which term is aliasing at 500 m" is answered by
 * measurement rather than by argument. They are the reason the far-pan flicker
 * was attributed to the thresholded streak bands and not to the tile break —
 * see the table in `injectPanFloorMacro`.
 *
 *   3  the FEATURE terms off (wind streaks and brine flats), tile break and
 *      vertex colour field still on
 *   4  the tile-break samples off (the 1/37 and 1/23 secondary taps), features
 *      still on
 *   5  the streak and scour bands off only
 *   6  the brine flats off only
 *
 * @returns {0 | 1 | 2 | 3 | 4 | 5 | 6} 0 when off, 1 for the probe view,
 *   2 for probe + whole-phase bypass, 3-6 for the single-term diagnostics.
 */
export function panFloorProbeMode() {
  if (typeof window === "undefined") return 0;
  const raw = new URLSearchParams(window.location.search).get("floorprobe");
  if (raw === "1") return 1;
  if (raw === "2") return 2;
  if (raw === "3") return 3;
  if (raw === "4") return 4;
  if (raw === "5") return 5;
  if (raw === "6") return 6;
  return 0;
}

/** @returns {boolean} whether any probe view is on. */
export function panFloorProbeActive() {
  return panFloorProbeMode() !== 0;
}
