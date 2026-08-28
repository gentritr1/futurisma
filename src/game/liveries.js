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
