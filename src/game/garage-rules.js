/**
 * Garage — the half of the craft layer that has to exist at first paint.
 *
 * Three things live here and nothing else: the codes a save file may name, the
 * handling numbers each frame and part is worth, and the rule that turns an
 * untrusted stored garage into a usable one. Everything the player READS about
 * the garage — names, decks, prices, colours, contracts, the purse — is in the
 * lazy `garage-catalog.js` / `garage-economy.js` pair, because the initial
 * shell has about a kilobyte of headroom and a label table is not first paint.
 *
 * Plain JS with JSDoc so `scripts/validate-garage.mjs` and
 * `scripts/validate-persistence.mjs` import it under Node without a build.
 *
 * THE BALANCE RULE. Rivals run authored pace and never rubber-band
 * (PRODUCT.md principle 5), so every stat here is a lever on the player's own
 * craft only. The works TOTEM is exactly {@link NEUTRAL_HANDLING}; every other
 * frame trades something for its strength, and the clamps in
 * {@link handlingFor} hold a fully built prototype inside ~7% of the authored
 * top speed, which is the envelope the camera guards and corridor sweeps were
 * measured in.
 */
/**
 * @typedef {object} Handling The craft's handling as five multipliers on the
 *   authored model in `physics.js`.
 * @property {number} topSpeed cruise cap and boost ceiling
 * @property {number} accel engine thrust
 * @property {number} grip how fast the travel line follows the nose
 * @property {number} drift drift charge rate and drift rotation
 * @property {number} plasma reserve regen and boost thrust
 *
 * @typedef {"engine" | "thrusters" | "stabilisers" | "skid" | "plasma"} PartCode
 * @typedef {Record<PartCode, number>} PartLevels
 * @typedef {{ parts: PartLevels, glow: string, flame: string, under: string, body: string, pattern: string }} FrameFit
 * @typedef {{ next: number, active: number[], done: number }} ContractBoard
 * @typedef {{
 *   credits: number,
 *   chassis: string,
 *   fleet: Record<string, FrameFit>,
 *   paints: string[],
 *   schemes: string[],
 *   patterns: string[],
 *   goldLeaf: boolean,
 *   daily: number[],
 *   contracts: ContractBoard,
 *   circuits: string[],
 * }} Garage
 */

/**
 * The works craft: every multiplier exactly 1. Declared here, in a module that
 * imports nothing, because both the race loop (`physics.js`) and the lazy
 * garage chunks need it; a file with dependencies here would drag them out of
 * the entry chunk with it.
 *
 * @type {Readonly<Handling>}
 */
export const NEUTRAL_HANDLING = Object.freeze({
  topSpeed: 1,
  accel: 1,
  grip: 1,
  drift: 1,
  plasma: 1,
});

/**
 * The circuits contracts are dealt on and first finishes are logged for. The
 * same list as `TRACK_CODES` in `save-schema.js`, repeated rather than imported
 * for the same reason as above; `scripts/validate-garage.mjs` fails the build
 * the moment the two disagree, so an eighth circuit cannot be missed here.
 */
export const CIRCUIT_CODES = ["greenwater", "bitterpan", "nightshift", "polarity", "tideline", "ascension", "dreamisland"];

/**
 * The six frames, as the numbers the race loop multiplies by. Order is garage
 * order. `halo` is the long goal: it is gated by contracts as well as credits
 * (see `garage-catalog.js`), which is what keeps the loop pointed at all seven
 * circuits rather than at the one the player farms fastest.
 *
 * `name` is here rather than in the catalog because the paddock names the
 * craft at first paint — the grid, the ladder, the briefing — and a name that
 * arrived with the lazy chunk would flip on every load. `signature` is the
 * frame's own body paint scheme (see {@link bodySchemes}); TOTEM has none.
 *
 * @type {readonly { code: string, name: string, signature?: string, stats: Readonly<Handling> }[]}
 */
export const FRAMES = [
  { code: "totem", name: "TOTEM", stats: NEUTRAL_HANDLING },
  { code: "lance", name: "LANCE S3", signature: "strike", stats: { topSpeed: 1.035, accel: 1.08, grip: 0.88, drift: 0.85, plasma: 0.95 } },
  { code: "sidewinder", name: "SIDEWINDER D2", signature: "neon", stats: { topSpeed: 0.98, accel: 1, grip: 0.94, drift: 1.45, plasma: 1.05 } },
  { code: "bulwark", name: "BULWARK G4", signature: "hazard", stats: { topSpeed: 0.975, accel: 0.96, grip: 1.18, drift: 0.85, plasma: 1 } },
  { code: "corona", name: "CORONA P5", signature: "nebula", stats: { topSpeed: 0.99, accel: 0.94, grip: 1, drift: 1.1, plasma: 1.35 } },
  { code: "halo", name: "HALO X1", signature: "dazzle", stats: { topSpeed: 1.03, accel: 1.06, grip: 1.08, drift: 1.2, plasma: 1.15 } },
];
export const FRAME_CODES = FRAMES.map((frame) => frame.code);
export const DEFAULT_FRAME = "totem";

/**
 * Each part raises one stat by `step` per stage, three stages. A fully staged
 * part is worth about one frame's specialism, so parts deepen a frame rather
 * than erasing the difference between two.
 *
 * @type {readonly { code: PartCode, stat: keyof Handling, step: number }[]}
 */
export const PARTS = [
  { code: "engine", stat: "topSpeed", step: 0.01 },
  { code: "thrusters", stat: "accel", step: 0.05 },
  { code: "stabilisers", stat: "grip", step: 0.05 },
  { code: "skid", stat: "drift", step: 0.12 },
  { code: "plasma", stat: "plasma", step: 0.08 },
];
export const PART_CODES = PARTS.map((part) => part.code);
export const MAX_PART_STAGE = 3;

/**
 * Hard floor and ceiling per stat, applied AFTER frame times parts. Wide enough
 * that no shipped combination touches them; they exist so a hand-edited save
 * cannot put a 3x engine on the deck.
 *
 * @type {Readonly<Record<keyof Handling, readonly [number, number]>>}
 */
export const STAT_LIMITS = {
  topSpeed: [0.95, 1.07],
  accel: [0.85, 1.25],
  grip: [0.8, 1.35],
  drift: [0.8, 1.85],
  plasma: [0.85, 1.6],
};

/**
 * Paint codes. One owned set serves all three slots — glow, boost flame and
 * underglow — so a colour is bought once. `stock` means "this frame's own
 * signature", `off` is only meaningful for the underglow.
 */
export const PAINT_CODES = ["stock", "off", "acid", "cyan", "magenta", "amber", "violet", "white", "ember"];
const FREE_PAINTS = ["stock", "off"];

/**
 * Body paint, for a frame with its own body: `factory` (the atlas its GLB
 * ships with), NOIR and ARCTIC on every frame, the frame's signature scheme,
 * and `gold` — the streak's reward, never sold, fitted only while `goldLeaf`
 * is on file. Each is its own atlas, so a scheme is owned per frame
 * (`"lance:noir"` in `schemes`). TOTEM has no body atlas: its paint is the
 * livery the paddock issues.
 *
 * @param {string} frame
 * @returns {string[]}
 */
export function bodySchemes(frame) {
  const signature = FRAMES.find((entry) => entry.code === frame)?.signature;
  return signature ? ["factory", "noir", "arctic", signature, "gold"] : ["factory"];
}

/** Underglow patterns: bought once, fitted per frame like the colour. */
export const PATTERN_CODES = ["steady", "breathe", "chase", "heartbeat"];

/**
 * The daily board, as bounded whole numbers rather than an object: the day
 * and week it belongs to, three job counters, paid flags, the weekly counter,
 * the streak and the last day that counted for it. Its meaning — and every
 * rule about rolling it over — lives in the lazy `garage-economy.js`; the
 * shell only has to carry it through a save intact, which a fixed-length list
 * of small integers needs no knowledge of the board to do.
 */
export const DAILY_FIELDS = 9;
const MAX_DAILY_VALUE = 10_000_000;

/**
 * The names the paddock gives the craft on the grid: its name in the lists,
 * its first word in running copy, and — for a bodied frame — the paint it
 * wears where TOTEM's lines name its livery (empty: the livery stands).
 *
 * @param {Garage} garage
 */
export function craftNames(garage) {
  const frame = FRAMES.find((entry) => entry.code === garage.chassis) ?? FRAMES[0];
  const body = garage.fleet[frame.code]?.body ?? "factory";
  return {
    label: frame.name,
    short: frame.name.split(" ")[0],
    team: frame.signature ? body === "gold" ? "GOLD LEAF" : body.toUpperCase() : "",
  };
}

export const STARTING_CREDITS = 400;
const MAX_CREDITS = 9_999_999;
export const CONTRACT_SLOTS = 3;
const MAX_CONTRACT_SERIAL = 1_000_000;

/** @returns {FrameFit} */
export function defaultFit() {
  return {
    parts: { engine: 0, thrusters: 0, stabilisers: 0, skid: 0, plasma: 0 },
    glow: "stock",
    flame: "stock",
    under: "off",
    body: "factory",
    pattern: "steady",
  };
}

/** @returns {Garage} */
export function defaultGarage() {
  return {
    credits: STARTING_CREDITS,
    chassis: DEFAULT_FRAME,
    fleet: { [DEFAULT_FRAME]: defaultFit() },
    paints: [...FREE_PAINTS],
    schemes: [],
    patterns: ["steady"],
    goldLeaf: false,
    daily: Array(DAILY_FIELDS).fill(0),
    contracts: { next: CONTRACT_SLOTS, active: [0, 1, 2], done: 0 },
    circuits: [],
  };
}

/** @param {unknown} value */
function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

/** @param {unknown} value @param {number} max */
function wholeNumber(value, max) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= max;
}

/** @param {unknown} value @param {string} fallback */
function paintOr(value, fallback) {
  return typeof value === "string" && PAINT_CODES.includes(value) ? value : fallback;
}

/**
 * @param {unknown} raw
 * @returns {FrameFit}
 */
function normalizeFit(raw) {
  const fit = defaultFit();
  if (!isPlainObject(raw)) return fit;
  const source = /** @type {Record<string, unknown>} */ (raw);
  if (isPlainObject(source.parts)) {
    const parts = /** @type {Record<string, unknown>} */ (source.parts);
    for (const code of PART_CODES) {
      if (wholeNumber(parts[code], MAX_PART_STAGE)) fit.parts[code] = /** @type {number} */ (parts[code]);
    }
  }
  fit.glow = paintOr(source.glow, "stock");
  fit.flame = paintOr(source.flame, "stock");
  fit.under = paintOr(source.under, "off");
  if (typeof source.body === "string") fit.body = source.body;
  if (typeof source.pattern === "string") fit.pattern = source.pattern;
  return fit;
}

/**
 * The one entry point for an untrusted stored garage. Total: every input,
 * including a hostile one, returns a usable garage, and the works frame is
 * always owned so there is always something to race.
 *
 * Contracts are stored as serials, never as text. The contract a serial names
 * is a pure function of that serial (`contractFor` in `garage-economy.js`), so
 * a save file cannot carry an objective or a reward the build did not author.
 *
 * @param {unknown} raw
 * @returns {Garage}
 */
export function normalizeGarage(raw) {
  const garage = defaultGarage();
  if (!isPlainObject(raw)) return garage;
  const source = /** @type {Record<string, unknown>} */ (raw);
  if (typeof source.credits === "number" && Number.isFinite(source.credits)) {
    garage.credits = Math.min(MAX_CREDITS, Math.max(0, Math.floor(source.credits)));
  }
  if (isPlainObject(source.fleet)) {
    const fleet = /** @type {Record<string, unknown>} */ (source.fleet);
    for (const code of FRAME_CODES) {
      if (Object.hasOwn(fleet, code)) garage.fleet[code] = normalizeFit(fleet[code]);
    }
  }
  if (typeof source.chassis === "string" && Object.hasOwn(garage.fleet, source.chassis)) {
    garage.chassis = source.chassis;
  }
  if (Array.isArray(source.paints)) {
    const owned = new Set([...FREE_PAINTS, ...source.paints]);
    garage.paints = PAINT_CODES.filter((code) => owned.has(code));
  }
  if (Array.isArray(source.circuits)) {
    const logged = new Set(source.circuits);
    garage.circuits = CIRCUIT_CODES.filter((code) => logged.has(code));
  }
  // Body paint and patterns: only what this build sells, and a frame can only
  // wear what is on file for it — GOLD LEAF only while the streak's flag is.
  garage.goldLeaf = source.goldLeaf === true;
  if (Array.isArray(source.schemes)) {
    const owned = new Set(source.schemes);
    garage.schemes = FRAME_CODES.flatMap((frame) => bodySchemes(frame).slice(1, -1).map((scheme) => `${frame}:${scheme}`))
      .filter((key) => owned.has(key));
  }
  if (Array.isArray(source.patterns)) {
    const owned = new Set(["steady", ...source.patterns]);
    garage.patterns = PATTERN_CODES.filter((code) => owned.has(code));
  }
  for (const [frame, fit] of Object.entries(garage.fleet)) {
    const wearable = fit.body === "factory" || (fit.body === "gold" ? garage.goldLeaf && bodySchemes(frame).includes("gold")
      : garage.schemes.includes(`${frame}:${fit.body}`));
    if (!wearable) fit.body = "factory";
    if (!garage.patterns.includes(fit.pattern)) fit.pattern = "steady";
  }
  if (Array.isArray(source.daily) && source.daily.length === DAILY_FIELDS
    && source.daily.every((value) => wholeNumber(value, MAX_DAILY_VALUE))) {
    garage.daily = /** @type {number[]} */ ([...source.daily]);
  }
  if (isPlainObject(source.contracts)) {
    const board = /** @type {Record<string, unknown>} */ (source.contracts);
    const next = wholeNumber(board.next, MAX_CONTRACT_SERIAL)
      ? /** @type {number} */ (board.next)
      : CONTRACT_SLOTS;
    const active = Array.isArray(board.active) ? board.active : [];
    const usable = active.length === CONTRACT_SLOTS
      && new Set(active).size === CONTRACT_SLOTS
      && active.every((serial) => wholeNumber(serial, MAX_CONTRACT_SERIAL) && serial < next);
    garage.contracts = usable
      ? { next, active: /** @type {number[]} */ ([...active]), done: 0 }
      // An unusable board is re-dealt FORWARD from `next`, never from zero, so
      // a corrupt file cannot hand a veteran the three starter contracts again.
      : { next: next + CONTRACT_SLOTS, active: [next, next + 1, next + 2], done: 0 };
    if (wholeNumber(board.done, MAX_CONTRACT_SERIAL)) garage.contracts.done = /** @type {number} */ (board.done);
  }
  return garage;
}

/**
 * The fitted craft's handling: frame stats plus staged parts, clamped. Frozen,
 * because the race loop reads it every fixed step and must never be handed an
 * object something else can edit under it.
 *
 * @param {Garage} garage
 * @returns {Readonly<Handling>}
 */
export function handlingFor(garage) {
  const frame = FRAMES.find((entry) => entry.code === garage.chassis) ?? FRAMES[0];
  const fit = garage.fleet[frame.code] ?? defaultFit();
  /** @type {Handling} */
  const handling = { ...frame.stats };
  for (const part of PARTS) handling[part.stat] += part.step * fit.parts[part.code];
  for (const stat of /** @type {(keyof Handling)[]} */ (Object.keys(STAT_LIMITS))) {
    const [floor, ceiling] = STAT_LIMITS[stat];
    handling[stat] = Math.min(ceiling, Math.max(floor, handling[stat]));
  }
  // The works frame with nothing staged IS the authored craft. Handing back the
  // shared neutral object rather than an equal copy keeps that identity
  // checkable with `===`, which is what the stock-parity validator asserts.
  const neutral = PART_CODES.every((code) => fit.parts[code] === 0) && frame.code === DEFAULT_FRAME;
  return neutral ? NEUTRAL_HANDLING : Object.freeze(handling);
}

/**
 * The handling the race loop reads. Installed at boot from the save and again
 * whenever the garage refits the craft; the garage only opens between races, so
 * a race never sees it change under it.
 */
let installed = NEUTRAL_HANDLING;

/** @param {Readonly<Handling>} handling */
export function installHandling(handling) {
  installed = handling;
}

/** @returns {Readonly<Handling>} */
export function activeHandling() {
  return installed;
}
