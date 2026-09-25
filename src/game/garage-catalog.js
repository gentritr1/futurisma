/**
 * Garage — everything the player reads about a frame, a part or a paint.
 *
 * Lazy by construction: nothing in the initial shell imports this file. The
 * handling numbers are in `garage-rules.js` (first paint needs them to race);
 * this is the showroom card — names, deck lines, prices, colours and each
 * frame's stance — and it arrives with the garage screen or the first purse.
 * `scripts/validate-garage.mjs` asserts the two files name exactly the same
 * frames, parts and paints, so the showroom cannot list a craft the race loop
 * does not know how to drive.
 *
 * Voice: the KAIRO DYNAMICS dispatch terminal. Upper-case, mono, a fleet
 * number on every frame, no marketing adjectives.
 */
import { FRAME_CODES, PAINT_CODES, PART_CODES, STAT_LIMITS } from "./garage-rules.js";

/**
 * @typedef {object} FrameCard
 * @property {string} code
 * @property {string} label
 * @property {string} deck What the frame is for, in four words or fewer.
 * @property {string} note The trade it makes, for the showroom line.
 * @property {number} price Credits. The works frame is issued, never bought.
 * @property {number} licence Contracts that must be on file before purchase.
 * @property {readonly [number, number, number]} stance Width, height, length
 *   scale on the player's visual hull. Visual only: the contact model, apron
 *   and camera all keep measuring the authored 2.2 m hull.
 * @property {string} glow The paint `stock` resolves to on this frame's lights.
 * @property {string} flame The paint `stock` resolves to on its boost jets.
 */

/** @type {readonly FrameCard[]} */
export const FRAME_CARDS = [
  {
    code: "totem",
    label: "TOTEM KD-07",
    deck: "WORKS ALL-ROUNDER",
    note: "THE FACTORY BASELINE · NO WEAKNESS, NO EDGE",
    price: 0,
    licence: 0,
    stance: [1, 1, 1],
    glow: "stock",
    flame: "ember",
  },
  {
    code: "lance",
    label: "LANCE S3",
    deck: "STRAIGHT-LINE SPEC",
    note: "HIGHEST CAP AND PULL · LOOSE IN THE TURNS",
    price: 2_400,
    licence: 0,
    stance: [0.93, 0.95, 1.08],
    glow: "cyan",
    flame: "cyan",
  },
  {
    code: "sidewinder",
    label: "SIDEWINDER D2",
    deck: "DRIFT SPEC",
    note: "BANKS A DRIFT FAST, ROTATES HARD · SOFT CAP",
    price: 1_800,
    licence: 0,
    stance: [1.05, 0.97, 0.96],
    glow: "magenta",
    flame: "magenta",
  },
  {
    code: "bulwark",
    label: "BULWARK G4",
    deck: "HIGH-GRIP SPEC",
    note: "HOLDS A LINE IN THE WET · HEAVY OFF THE LINE",
    price: 1_500,
    licence: 0,
    stance: [1.08, 1.04, 1],
    glow: "amber",
    flame: "amber",
  },
  {
    code: "corona",
    label: "CORONA P5",
    deck: "PLASMA SPEC",
    note: "REFILLS THE RESERVE FASTEST, HITS HARDER ON BOOST",
    price: 3_200,
    licence: 0,
    stance: [1, 1.03, 1.03],
    glow: "violet",
    flame: "violet",
  },
  {
    code: "halo",
    label: "HALO X1",
    deck: "WORKS PROTOTYPE",
    note: "ISSUED ONLY TO DRIVERS WITH EIGHT CONTRACTS ON FILE",
    price: 7_500,
    licence: 8,
    stance: [0.97, 0.94, 1.05],
    glow: "white",
    flame: "white",
  },
];

/**
 * @typedef {object} PartCard
 * @property {string} code
 * @property {string} label
 * @property {string} stat What the HUD calls the stat it moves.
 * @property {readonly number[]} prices Credits for stage I, II and III.
 */

/** @type {readonly PartCard[]} */
export const PART_CARDS = [
  { code: "engine", label: "ENGINE", stat: "TOP SPEED", prices: [350, 800, 1_500] },
  { code: "thrusters", label: "THRUSTERS", stat: "ACCELERATION", prices: [300, 700, 1_300] },
  { code: "stabilisers", label: "STABILISERS", stat: "GRIP", prices: [300, 700, 1_300] },
  { code: "skid", label: "SKID RIG", stat: "DRIFT", prices: [250, 600, 1_100] },
  { code: "plasma", label: "PLASMA CELL", stat: "PLASMA", prices: [300, 700, 1_300] },
];

/**
 * @typedef {object} PaintCard
 * @property {string} code
 * @property {string} label
 * @property {number | null} hex Null for `stock` (the frame decides) and `off`.
 * @property {number} price Bought once; usable in all three slots after.
 */

/** @type {readonly PaintCard[]} */
export const PAINT_CARDS = [
  { code: "stock", label: "FRAME", hex: null, price: 0 },
  { code: "off", label: "OFF", hex: null, price: 0 },
  { code: "ember", label: "EMBER", hex: 0xff581d, price: 200 },
  { code: "acid", label: "ACID", hex: 0xc8ff2e, price: 250 },
  { code: "cyan", label: "CYAN", hex: 0x49e2ff, price: 250 },
  { code: "amber", label: "AMBER", hex: 0xffa31a, price: 250 },
  { code: "magenta", label: "MAGENTA", hex: 0xff3fa8, price: 300 },
  { code: "violet", label: "VIOLET", hex: 0x9a6bff, price: 300 },
  { code: "white", label: "ARC WHITE", hex: 0xf2fbff, price: 400 },
];

/** The three paint slots, in the order the paint shop lists them. */
export const PAINT_SLOTS = /** @type {const} */ ([
  { code: "glow", label: "RUNNING LIGHTS" },
  { code: "flame", label: "BOOST FLAME" },
  { code: "under", label: "UNDERGLOW" },
]);

/** Credits to tear up a contract and draw the next one. */
export const SCRAP_PRICE = 100;

/** @param {string} code @returns {FrameCard} */
export function frameCard(code) {
  return FRAME_CARDS.find((card) => card.code === code) ?? FRAME_CARDS[0];
}

/** @param {string} code @returns {PartCard} */
export function partCard(code) {
  return PART_CARDS.find((card) => card.code === code) ?? PART_CARDS[0];
}

/** @param {string} code @returns {PaintCard} */
export function paintCard(code) {
  return PAINT_CARDS.find((card) => card.code === code) ?? PAINT_CARDS[0];
}

/**
 * The colour a slot actually shows: its own paint, or the frame's signature
 * when the slot is on `stock`. Null means "leave the authored look alone" (the
 * works lights) or "nothing fitted" (an underglow that is off).
 *
 * @param {string} frameCode
 * @param {"glow" | "flame" | "under"} slot
 * @param {string} paint
 * @returns {number | null}
 */
export function resolvePaint(frameCode, slot, paint) {
  if (paint === "off") return null;
  if (paint !== "stock") return paintCard(paint).hex;
  if (slot === "under") return null;
  const frame = frameCard(frameCode);
  return paintCard(slot === "glow" ? frame.glow : frame.flame).hex;
}

/**
 * Where a stat sits inside its hard limits, 0..1, for the showroom bars. The
 * limits are the handling clamps themselves, so a full bar means "as far as
 * the rules let this stat go", not an arbitrary ten.
 *
 * @param {keyof typeof STAT_LIMITS} stat
 * @param {number} value
 */
export function statFill(stat, value) {
  const [floor, ceiling] = STAT_LIMITS[stat];
  return Math.min(1, Math.max(0, (value - floor) / (ceiling - floor)));
}

/** Showroom order and labels for the five stats. */
export const STAT_ROWS = /** @type {const} */ ([
  { stat: "topSpeed", label: "SPEED" },
  { stat: "accel", label: "ACCEL" },
  { stat: "grip", label: "GRIP" },
  { stat: "drift", label: "DRIFT" },
  { stat: "plasma", label: "PLASMA" },
]);

/** @param {number} credits */
export function formatCredits(credits) {
  return `CR ${Math.round(credits).toLocaleString("en-US")}`;
}

// The shell's code lists are the contract this table has to honour; a
// mismatch is a build-time bug, so it throws on import rather than rendering
// a showroom the race loop disagrees with. Cheap: three array comparisons.
for (const [codes, cards, name] of /** @type {const} */ ([
  [FRAME_CODES, FRAME_CARDS, "frame"],
  [PART_CODES, PART_CARDS, "part"],
  [PAINT_CODES, PAINT_CARDS, "paint"],
])) {
  const listed = cards.map((card) => card.code);
  if (listed.length !== codes.length || !codes.every((code) => listed.includes(code))) {
    throw new Error(`garage-catalog.js ${name} cards do not match garage-rules.js.`);
  }
}
