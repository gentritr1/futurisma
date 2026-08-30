/**
 * P7 — the four shipped TOTEM liveries, in one table.
 *
 * These decal sheets already existed: `totem_decals_1024_works.png` was baked
 * into the runtime GLB as the player's body map, and P2 packed all four into
 * the rival atlas so the fourth quadrant was waiting for livery select. This
 * module is the single place that knows what each sheet is called, where it
 * lives and which atlas quadrant it occupies, so the start screen, the player's
 * material swap and the rival assignment cannot disagree.
 *
 * Plain JS with JSDoc so `scripts/validate-persistence.mjs` can import the
 * livery codes under Node without a build step.
 *
 * @typedef {object} Livery
 * @property {string} code Stable save-file token. Never localized, never shown.
 * @property {string} label The in-fiction issue, e.g. `WORKS 07`.
 * @property {string} deck One line of paddock fiction for the start screen.
 * @property {string} texture Served decal sheet for the player's body material.
 */

const TEXTURE_ROOT = "/assets/totem/textures/totem_decals_1024_";

/** @type {readonly Livery[]} */
export const LIVERIES = [
  {
    code: "works",
    label: "WORKS 07",
    deck: "FACTORY ENTRY",
    texture: `${TEXTURE_ROOT}works.png`,
  },
  {
    code: "privateer",
    label: "PRIVATEER 13",
    deck: "CUSTOMER CAR",
    texture: `${TEXTURE_ROOT}privateer.png`,
  },
  {
    code: "nightform",
    label: "NIGHTFORM 24",
    deck: "NIGHT TRIALS SHELL",
    texture: `${TEXTURE_ROOT}nightform.png`,
  },
  {
    code: "needle",
    label: "NEEDLE 16",
    deck: "LIGHTWEIGHT SPEC",
    texture: `${TEXTURE_ROOT}needle.png`,
  },
];

/**
 * The livery the runtime GLB already wears.
 *
 * `TOTEM_body.map` arrives baked into `totem_runtime.glb`, so the craft is
 * never bare — it boots wearing exactly one of these four sheets and a livery
 * swap is a texture replacement on top of that.
 *
 * MEASURED, not assumed. The embedded image was extracted from the GLB's BIN
 * chunk and compared pixel-for-pixel against all four served sheets. The
 * embedded copy is stored PRE-FLIPPED (glTF puts the UV origin at the top and
 * `GLTFLoader` sets `flipY = false`), so the match to look for is the vertical
 * flip — see `SERVED_LIVERY_FLIP_Y` in totem.ts:
 *
 *   works      verticallyFlipped 100.000%   (same orientation 51.853%)
 *   privateer  verticallyFlipped  91.859%
 *   nightform  verticallyFlipped  91.253%
 *   needle     verticallyFlipped  77.852%
 *
 * One exact match, and it is not close. That is what makes {@link
 * bootLiveryToApply} returning `null` for this code a provable no-op rather
 * than an optimisation: there is nothing to swap, because the pixels the swap
 * would install are already on the model.
 *
 * If the GLB is ever re-exported with a different baked sheet, its sha256 moves
 * and `validate-art-pass.mjs` fails on `TOTEM_DECAL_CELLS.json`'s pinned hash
 * before this constant can quietly become wrong.
 */
export const BAKED_LIVERY_CODE = "works";

/**
 * P17.1 — which livery, if any, the boot path has to install.
 *
 * THE BUG THIS CLOSES. `MetaUi.syncFromSave` restores the stored livery into
 * the chip row with `ChipGroup.setValue`, which deliberately does NOT fire
 * `onCommit`, and nothing else applied it. So after a reload the HUD read
 * `NIGHTFORM 24` and the rival field correctly excluded nightform, while the
 * player's craft still wore the works sheet baked into the GLB. It was visible
 * in the soak as `storedLivery: "nightform"` alongside `wearScale: 1` — the
 * per-livery wear hold-back travels with `applyLivery`, so a livery that was
 * never applied leaves the scale at the works value.
 *
 * Pure, and in this file rather than in the async wrapper, so
 * `validate-persistence.mjs` can drive the decision under Node with real
 * inputs instead of a source regex.
 *
 * Returns `null` when the boot path must do nothing:
 *   - the stored code IS the baked sheet, so a swap would install pixels that
 *     are already there. This is what keeps the default no-save path byte-for-
 *     byte what it was before P17.1 — no extra fetch, no texture replacement.
 *   - the stored token is not a livery at all. `liveryFor` already collapses a
 *     corrupt or future save to the first entry, so a hostile save file can
 *     never send the boot path fetching a sheet that does not exist.
 *
 * @param {string} storedCode
 * @returns {string | null}
 */
export function bootLiveryToApply(storedCode) {
  const code = liveryFor(storedCode).code;
  return code === BAKED_LIVERY_CODE ? null : code;
}

/**
 * Atlas quadrant order, fixed by P2: the three default field entries take
 * quadrants 0-2 and the works sheet takes quadrant 3. Changing this order
 * changes which decal every rival wears, so it is declared once and derived
 * everywhere.
 */
export const LIVERY_ATLAS_ORDER = ["privateer", "nightform", "needle", "works"];

/** Save-file tokens, in start-screen order. */
export const LIVERY_CODES = LIVERIES.map((livery) => livery.code);

/**
 * @param {string} code
 * @returns {Livery}
 */
export function liveryFor(code) {
  return LIVERIES.find((livery) => livery.code === code) ?? LIVERIES[0];
}

/**
 * The three field entries, given what the player took. The player's choice is
 * swapped one-for-one with the works sheet, so the field is always three
 * distinct liveries and never wears the player's.
 *
 * @param {string} playerLivery
 * @returns {string[]}
 */
export function fieldLiveries(playerLivery) {
  const player = liveryFor(playerLivery).code;
  return LIVERY_ATLAS_ORDER
    .filter((code) => code !== "works")
    .map((code) => (code === player ? "works" : code));
}
