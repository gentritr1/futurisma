/**
 * Garage — everything the player reads about a frame, a part or a paint.
 *
 * Lazy by construction: nothing in the initial shell imports this file. The
 * handling numbers are in `garage-rules.js` (first paint needs them to race);
 * this is the showroom card — names, deck lines, prices and colours — and it
 * arrives with the garage screen or the first purse. Each frame's body is its
 * own GLB (`public/assets/garage/frames/`), mounted by `garage-look.ts`.
 * `scripts/validate-garage.mjs` asserts the two files name exactly the same
 * frames, parts and paints, so the showroom cannot list a craft the race loop
 * does not know how to drive.
 *
 * Voice: the KAIRO DYNAMICS dispatch terminal. Upper-case, mono, a fleet
 * number on every frame, no marketing adjectives.
 */
import { FRAME_CODES, PAINT_CODES, PART_CODES, PATTERN_CODES, STAT_LIMITS } from "./garage-rules.js";

/**
 * @typedef {object} FrameCard
 * @property {string} code
 * @property {string} label
 * @property {string} deck What the frame is for, in four words or fewer.
 * @property {string} note The trade it makes, for the showroom line.
 * @property {number} price Credits. The works frame is issued, never bought.
 * @property {number} licence Contracts that must be on file before purchase.
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

/**
 * @typedef {object} SchemeCard
 * @property {string} code
 * @property {string} label
 * @property {number | null} price Per frame. Null: never sold (GOLD LEAF, the streak's).
 * @property {string} note
 */

/**
 * Body paint. The first three and GOLD LEAF are offered on every bodied frame;
 * each signature belongs to one frame (`signature` in `garage-rules.js`).
 *
 * @type {readonly SchemeCard[]}
 */
export const SCHEME_CARDS = [
  { code: "factory", label: "FACTORY", price: 0, note: "THE LIVERY IT LEFT THE WORKS IN" },
  { code: "noir", label: "NOIR", price: 600, note: "GLOSS BLACK · SIGNAL COLOURS KEPT" },
  { code: "arctic", label: "ARCTIC", price: 600, note: "PEARL WHITE · SIGNAL COLOURS KEPT" },
  { code: "strike", label: "STRIKE", price: 900, note: "RED OVER WHITE · INTERCEPTOR SPLIT" },
  { code: "neon", label: "NEON", price: 900, note: "GRAPHITE · CYAN SKIRTS · PINK SPINE" },
  { code: "hazard", label: "HAZARD", price: 900, note: "SAFETY ORANGE · BLACK BANDING" },
  { code: "nebula", label: "NEBULA", price: 900, note: "VIOLET TO NAVY · STAR FIELD" },
  { code: "dazzle", label: "DAZZLE", price: 900, note: "TEST-TRACK CAMOUFLAGE · ORANGE RING" },
  { code: "gold", label: "GOLD LEAF", price: null, note: "DAY 7 OF A DAILY STREAK · NEVER SOLD" },
];

/**
 * What each scheme's chip shows before its atlas is ever fetched: the paint
 * and the accent, as the Blender build painted them. The build writes the same
 * pairs into `public/assets/garage/frames/manifest.json`, and
 * `scripts/validate-garage-frames.mjs` holds the two equal.
 *
 * @type {Readonly<Record<string, Readonly<Record<string, readonly [string, string]>>>>}
 */
export const SCHEME_SWATCHES = {
  lance: { factory: ["#b2a88e", "#4abbc8"], noir: ["#08090a", "#4abbc8"], arctic: ["#d6d8db", "#4abbc8"], strike: ["#ccc9c1", "#c32b26"], gold: ["#e0ad3d", "#303034"] },
  sidewinder: { factory: ["#151518", "#e75db1"], noir: ["#08090a", "#e75db1"], arctic: ["#d6d8db", "#e75db1"], neon: ["#282b30", "#26c3dc"], gold: ["#e0ad3d", "#303034"] },
  bulwark: { factory: ["#4c4f35", "#f1cb4a"], noir: ["#08090a", "#f1cb4a"], arctic: ["#d6d8db", "#f1cb4a"], hazard: ["#f26607", "#262628"], gold: ["#e0ad3d", "#303034"] },
  corona: { factory: ["#212644", "#b18de9"], noir: ["#08090a", "#b18de9"], arctic: ["#d6d8db", "#b18de9"], nebula: ["#8c199e", "#30dce9"], gold: ["#e0ad3d", "#303034"] },
  halo: { factory: ["#1e2123", "#e7cc86"], noir: ["#08090a", "#e7cc86"], arctic: ["#d6d8db", "#e7cc86"], dazzle: ["#dbdde0", "#f99930"], gold: ["#e0ad3d", "#303034"] },
};

/**
 * @typedef {object} PatternCard
 * @property {string} code
 * @property {string} label
 * @property {number} price Bought once; fits any frame.
 */

/**
 * Underglow patterns. Every one stays at or under 3 Hz, and all of them hold
 * STEADY under reduced motion.
 *
 * @type {readonly PatternCard[]}
 */
export const PATTERN_CARDS = [
  { code: "steady", label: "STEADY", price: 0 },
  { code: "breathe", label: "BREATHE", price: 350 },
  { code: "chase", label: "CHASE", price: 350 },
  { code: "heartbeat", label: "HEARTBEAT", price: 350 },
];

/** @param {string} code @returns {SchemeCard} */
export function schemeCard(code) {
  return SCHEME_CARDS.find((card) => card.code === code) ?? SCHEME_CARDS[0];
}

/** @param {string} code @returns {PatternCard} */
export function patternCard(code) {
  return PATTERN_CARDS.find((card) => card.code === code) ?? PATTERN_CARDS[0];
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
// a showroom the race loop disagrees with. Cheap: four array comparisons.
for (const [codes, cards, name] of /** @type {const} */ ([
  [FRAME_CODES, FRAME_CARDS, "frame"],
  [PART_CODES, PART_CARDS, "part"],
  [PAINT_CODES, PAINT_CARDS, "paint"],
  [PATTERN_CODES, PATTERN_CARDS, "pattern"],
])) {
  const listed = cards.map((card) => card.code);
  if (listed.length !== codes.length || !codes.every((code) => listed.includes(code))) {
    throw new Error(`garage-catalog.js ${name} cards do not match garage-rules.js.`);
  }
}
