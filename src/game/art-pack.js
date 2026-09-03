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
 * H2b — `?deck=hf`, the Greenwater deck-tile experiment.
 *
 * A SEPARATE switch from `?art=`, and OFF by default, which is the opposite of
 * the choice made for the horizon sheet below. The reason is that this one is
 * not an edition of anything. It does not swap a sheet for a redrawn sheet with
 * the same regions: it takes the deck's baked atlas — which carries the runway
 * thresholds, the chequer, the chevrons and the A9 numerals as well as the
 * concrete — and replaces it with a repeating tile that has none of them. It
 * exists so the crop that says so stays re-takeable, not because anybody should
 * race with it.
 *
 * @returns {boolean}
 */
export function deckTileEnabled() {
  return typeof window !== "undefined"
    && new URLSearchParams(window.location.search).get("deck") === "hf";
}

/**
 * The tile `?deck=hf` loads — and DELIBERATELY not a served file.
 *
 * The experiment was rejected, so 358 KiB of texture for it would be the trade
 * H2a refused for the facade sheet. `scripts/prepare-higgsfield-textures.py`
 * emits the tile into `shots/higgsfield/` and prints the one line that copies
 * it here; until somebody runs that, this URL 404s and `environment.ts` leaves
 * the accepted deck exactly as it is and says so on the console. The switch
 * costs +0.2 KiB gzip and exists so the crop stays re-takeable.
 */
export const DECK_TILE_URL = "/assets/greenwater/textures/greenwater_deck_hf_512.png";

/**
 * How many metres of deck one repeat of that tile covers.
 *
 * MEASURED, not chosen: the prepared tile carries 4-5 expansion-joint lines per
 * edge (`scripts/prepare-higgsfield-textures.py` prints the count), and the
 * brief's target is joints about 6 m apart, so 4.5 x 6 = 27 m.
 */
export const DECK_TILE_METRES = 27;

/**
 * The served URL of the horizon card sheet for this page load.
 *
 * @returns {string}
 */
export function horizonSheetUrl() {
  return HORIZON_SHEETS[activeArtPack()];
}
