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

/** @returns {0 | 1 | 2} 0 when off, 1 for the probe view, 2 for probe + bypass */
export function panFloorProbeMode() {
  if (typeof window === "undefined") return 0;
  const raw = new URLSearchParams(window.location.search).get("floorprobe");
  if (raw === "1") return 1;
  if (raw === "2") return 2;
  return 0;
}

/** @returns {boolean} whether either probe view is on. */
export function panFloorProbeActive() {
  return panFloorProbeMode() !== 0;
}
