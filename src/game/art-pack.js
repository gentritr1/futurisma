/**
 * H2a — the horizon card sheet, in its generated edition.
 *
 * `futurisma_horizon_hf_1024.png` is the DEFAULT sheet. It is prepared by
 * `scripts/prepare-higgsfield-textures.py` out of a Higgsfield generation and
 * redraws thirteen of the sixteen silhouette cells; the P18 sheet stays served
 * and is reachable with `?art=base` for review only.
 *
 * Why this one and not the other two. The phase prepared three alternates and
 * shot them against the shipping sheets at thirteen Bitterpan stations. The
 * horizon was the only one that paid: a `STACK_CLUSTER` that was a dark
 * rectangle with three sticks became seven chimneys over a plant block, and a
 * featureless slab at 2900 m became a legible lattice gantry. That verdict
 * rests on the CROPS and `frame-metrics.py` was NOT able to
 * confirm it. That is recorded rather than dropped: on a five-station shoot the
 * metric's edges% rose every time, which looked like support, and on a
 * thirteen-station like-for-like re-shoot it rose at six of thirteen with most
 * deltas inside +/-0.05. The two stations that moved more than noise moved for
 * a reason the metric cannot see — `shoot-stations.mjs` fires anywhere inside
 * its 45 m window, so the two builds were photographed from different poses,
 * and its own header says so. A whole-frame structure metric is the wrong
 * instrument for a change confined to a 60-row horizon band under fog. The
 * crops are the evidence here, and they are qualitative on purpose.
 *
 * The pan crust and the facade skins did not pay: the crust's
 * macro polygons came out about twice the shipping tile's, which makes the 12 m
 * repeat visible, and the facade skins were tone-matched into the sheet so
 * carefully that at 2300 m they are hard to tell from the regions they replace.
 * Neither was worth 1.09 MB of served texture, so neither ships; the
 * preparation script still emits both into `shots/higgsfield/` so the work and
 * its numbers survive.
 *
 * The swap is drop-in by construction. Every rect in ATLAS_REGIONS.json is
 * unmoved, three cells (RIG_FAR, SHIMMER_BAND, HAZE_BAND — see the preparation
 * script for why each has no honest source) keep the P18 sheet's own pixels,
 * and nothing here touches a filter class: `living-world.ts` still puts the
 * nearest, unmipped, `flipY = false` card contract on whichever edition loads.
 * This module changes the pixels and nothing else.
 *
 * `?art=base` exists so the comparison stays runnable after the review closes —
 * a before/after that can only be reproduced by checking out an old commit
 * stops being reproduced. It is one string, not a feature.
 *
 * Shaped like `render-mode.js` on purpose: one parse, one memo, no `three`, so
 * a validator can import it under Node.
 *
 * @typedef {"base" | "hf"} ArtPack
 */

/** The generated sheet is the default; `?art=base` is the review-only way back. */
export const DEFAULT_ART_PACK = /** @type {ArtPack} */ ("hf");

/** @type {Record<ArtPack, string>} */
export const HORIZON_SHEETS = {
  base: "/assets/greenwater/textures/futurisma_horizon_1024.png",
  hf: "/assets/greenwater/textures/futurisma_horizon_hf_1024.png",
};


/**
 * Parses `?art=`. Anything that is not `base` falls back to the default rather
 * than throwing, for the same reason `resolveRenderMode` does: a typo in a
 * shared link must not break the game.
 *
 * @param {string | null | undefined} raw
 * @returns {ArtPack}
 */
export function resolveArtPack(raw) {
  return (typeof raw === "string" ? raw.trim().toLowerCase() : "") === "base"
    ? "base"
    : DEFAULT_ART_PACK;
}

/** @type {ArtPack | null} */
let cachedPack = null;

/**
 * The edition for this page load, memoized so a later read cannot disagree.
 *
 * @returns {ArtPack}
 */
export function activeArtPack() {
  if (cachedPack === null) {
    cachedPack = resolveArtPack(
      typeof window === "undefined"
        ? null
        : new URLSearchParams(window.location.search).get("art"),
    );
  }
  return cachedPack;
}

/**
 * The served URL of the horizon card sheet for this page load.
 *
 * @returns {string}
 */
export function horizonSheetUrl() {
  return HORIZON_SHEETS[activeArtPack()];
}
