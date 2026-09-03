/**
 * H2a — the generated art pack, behind `?art=hf`.
 *
 * Three sheets have a second edition prepared by
 * `scripts/prepare-higgsfield-textures.py` out of the Higgsfield batch-1
 * generations: the Bitterpan pan crust tile, the Bitterpan facade sheet and the
 * shared horizon card sheet. This module is the ONLY place that decides which
 * edition a load reaches for, so the flag cannot be half-applied — a run with
 * the new horizon and the old facades is a combination nobody reviewed.
 *
 * The alternates are drop-in by construction. Every rect in ATLAS_REGIONS.json
 * is unmoved, the facade and horizon sheets keep the original pixels for every
 * region the pack does not replace, and nothing here touches a filter class:
 * `bitterpan-surface.ts` still puts linear + mipmaps + anisotropy 4 on the
 * floor and `living-world.ts` still puts the nearest, unmipped, `flipY = false`
 * card contract on the horizon sheet. The pack changes the pixels and nothing
 * else.
 *
 * DEFAULT IS `base`, and that is a review gate rather than a hedge. The pan
 * crust in particular is a photoreal generation whose macro polygons land at
 * roughly 8 across a 12 m tile against the shipping tile's 14 finer ones, and
 * whether that reads as a salt pan or as a visible repeat is a taste call that
 * needs eyes on a station sheet, not a validator. Flipping the default is a
 * one-line change here once that call is made.
 *
 * Shaped like `render-mode.js` on purpose: one parse, one memo, no `three`, so
 * a validator can import it under Node.
 *
 * @typedef {"base" | "hf"} ArtPack
 * @typedef {"panCrustTile" | "bitterpanFacades" | "horizonCards"} ArtPackSheet
 */

/** @type {ArtPack} */
export const DEFAULT_ART_PACK = "base";

/** @type {Record<ArtPackSheet, Record<ArtPack, string>>} */
export const ART_PACK_SHEETS = {
  panCrustTile: {
    base: "/assets/map02/textures/bitterpan_crust_tile_256.png",
    hf: "/assets/map02/textures/bitterpan_crust_tile_hf_512.png",
  },
  bitterpanFacades: {
    base: "/assets/map02/textures/bitterpan_facades_1024.png",
    hf: "/assets/map02/textures/bitterpan_facades_hf_1024.png",
  },
  horizonCards: {
    base: "/assets/greenwater/textures/futurisma_horizon_1024.png",
    hf: "/assets/greenwater/textures/futurisma_horizon_hf_1024.png",
  },
};

/**
 * Parses `?art=`. An unknown value falls back to the default rather than
 * throwing, for the same reason `resolveRenderMode` does: a typo in a shared
 * link must not break the game.
 *
 * @param {string | null | undefined} raw
 * @returns {ArtPack}
 */
export function resolveArtPack(raw) {
  return (typeof raw === "string" ? raw.trim().toLowerCase() : "") === "hf"
    ? "hf"
    : DEFAULT_ART_PACK;
}

/** @type {ArtPack | null} */
let cachedPack = null;

/**
 * The pack for this page load, memoized so the four load sites cannot disagree.
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
 * The served URL for one sheet under the active pack.
 *
 * @param {ArtPackSheet} sheet
 * @returns {string}
 */
export function artPackSheet(sheet) {
  return ART_PACK_SHEETS[sheet][activeArtPack()];
}
