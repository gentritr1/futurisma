/**
 * Garage — the purse, the contract board and every transaction, as pure
 * functions of (garage, facts).
 *
 * Nothing here reads a clock, a random source, the DOM or the save file. A
 * transaction takes a garage and returns the next one; `garage-purse.ts` and
 * `garage-ui.ts` are the only callers that write, through `save.setGarage`,
 * which normalizes again on the way in. That split is what lets
 * `scripts/validate-garage.mjs` settle thousands of synthetic races under Node
 * and prove the loop's properties rather than sample them.
 *
 * THE LOOP. Race anywhere → the purse pays by finishing place, field strength
 * and distance, plus the craft skills the result screen already measures →
 * three contracts on the board point at specific circuits and ask for
 * something those circuits reward → credits buy frames, parts and paint →
 * a faster, grippier or better-drifting craft takes on the harder field. The
 * HALO X1 frame is licensed by contracts completed, not by credits alone, so
 * the fastest route to the top is racing all seven circuits rather than
 * farming one.
 */
import {
  CIRCUIT_CODES,
  CONTRACT_SLOTS,
  FRAME_CODES,
  MAX_PART_STAGE,
  PAINT_CODES,
} from "./garage-rules.js";
import { frameCard, partCard, paintCard, SCRAP_PRICE } from "./garage-catalog.js";

/**
 * @typedef {import("./garage-rules.js").Garage} Garage
 * @typedef {"rookie" | "works" | "feral"} Tier
 *
 * @typedef {object} RaceFacts Everything a finished race is settled on.
 * @property {string} track circuit code, e.g. `tideline`
 * @property {string} mode `race`, `sprint` or `timeattack`
 * @property {string} tier `rookie`, `works` or `feral`
 * @property {number} position 1-based finishing place
 * @property {number} racerCount classified craft; 1 in a solo time attack
 * @property {number} laps laps completed
 * @property {boolean} newBestLap this mode and tier's record fell
 * @property {number} topSpeedKph
 * @property {number} nearMisses
 * @property {number} cleanGateChain peak chain of clean gates
 * @property {number} slipstreamSeconds
 * @property {number} driftCashes drifts released with enough charge to pay
 * @property {boolean} demo launched on autopilot; pays nothing
 *
 * @typedef {"win" | "podium" | "sprint" | "speed" | "chain" | "drift" | "draft" | "close" | "record"} ContractKind
 *
 * @typedef {object} Contract
 * @property {number} serial
 * @property {ContractKind} kind
 * @property {string} track
 * @property {"race" | "sprint" | "timeattack" | "field" | null} mode
 *   `field` is any format with rivals on track; null is any format at all
 * @property {Tier | null} tier the MINIMUM field strength, or null for any
 * @property {number} target place, km/h, gates, drifts, seconds or near misses
 * @property {number} reward credits
 *
 * @typedef {{ code: string, label: string, amount: number }} PurseLine
 *
 * @typedef {object} Settlement
 * @property {Garage} garage the garage after the purse and contracts landed
 * @property {PurseLine[]} lines itemised, in the order the screen prints them
 * @property {number} total
 * @property {Contract[]} completed contracts this race closed
 * @property {boolean} demo
 */

const TIERS = /** @type {const} */ (["rookie", "works", "feral"]);
/** Purse by finishing place in a field format; past the table pays the last row. */
const PLACE_PURSE = [320, 200, 130, 80];
/** A classified solo run: time attack has no places, only the clock. */
const SOLO_PURSE = 160;
const TIER_RATE = { rookie: 0.8, works: 1, feral: 1.4 };
/**
 * Pay is linear in distance around the three-lap standard, so `?laps=1` pays a
 * third for a third of the driving and there is nothing to farm by shortening
 * the race. Clamped so a nine-lap marathon is worth five laps of purse.
 */
const STANDARD_LAPS = 3;
const NEW_BEST_BONUS = 120;
const NEW_CIRCUIT_BONUS = 300;
const CHAIN_MINIMUM = 4;

/** @param {number} value */
function roundToFive(value) {
  return Math.round(value / 5) * 5;
}

/** @param {number} value @param {number} min @param {number} max */
function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/** @param {unknown} value */
function count(value) {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

/** @param {string} tier @returns {Tier} */
function tierOf(tier) {
  return /** @type {Tier} */ (TIERS.includes(/** @type {Tier} */ (tier)) ? tier : "works");
}

/**
 * A small integer hash (Wang/Jenkins mix). The contract board is a pure
 * function of a serial, so this is the only "random" in the garage, and it is
 * the same on every machine that will ever run the build.
 *
 * @param {number} value
 */
function hash(value) {
  let h = (value ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

/**
 * Deals from `deck` in shuffled blocks: every `deck.length` consecutive
 * serials (aligned to a block) hold each entry exactly once. `salt` keeps two
 * decks dealt off the same serial from moving in lockstep.
 *
 * @template T
 * @param {readonly T[]} deck
 * @param {number} serial
 * @param {number} salt
 * @returns {T}
 */
function dealFrom(deck, serial, salt) {
  const block = Math.floor(serial / deck.length);
  const order = [...deck];
  for (let index = order.length - 1; index > 0; index -= 1) {
    const swap = hash(block * 31 + index + salt) % (index + 1);
    [order[index], order[swap]] = [order[swap], order[index]];
  }
  return order[serial % order.length];
}

/**
 * The circuit a serial points at: any seven block-aligned contracts visit
 * every circuit exactly once, so the three on the board at the start are
 * always three different places.
 *
 * @param {number} serial
 */
function trackFor(serial) {
  return dealFrom(CIRCUIT_CODES, serial, 0);
}

/** Reward and target per kind, by level 0 (early) .. 2 (late). */
const CONTRACT_TABLE = {
  win: { targets: [1, 1, 1], rewards: [350, 650, 1_100] },
  podium: { targets: [3, 3, 2], rewards: [300, 550, 850] },
  sprint: { targets: [1, 1, 1], rewards: [300, 550, 950] },
  speed: { targets: [340, 370, 395], rewards: [250, 450, 750] },
  chain: { targets: [8, 14, 20], rewards: [250, 450, 750] },
  drift: { targets: [3, 6, 10], rewards: [250, 450, 750] },
  draft: { targets: [3, 6, 10], rewards: [250, 450, 750] },
  close: { targets: [2, 4, 6], rewards: [250, 450, 750] },
  record: { targets: [0, 0, 0], rewards: [300, 500, 800] },
};
/** @type {readonly ContractKind[]} */
export const CONTRACT_KINDS = /** @type {ContractKind[]} */ (Object.keys(CONTRACT_TABLE));

/**
 * The contract a serial names. Pure and total: the save file stores serials,
 * so what a contract asks and pays is always this build's authored table.
 *
 * Difficulty climbs with the serial — the first nine are level 0, the next
 * nine can be level 1 — with a one-in-three chance of a level up at any point,
 * so a veteran board still mixes a quick earner in with the hard ones.
 *
 * @param {number} serial
 * @returns {Contract}
 */
export function contractFor(serial) {
  const h = hash(serial + 7_919);
  // Kinds are dealt the way circuits are, from their own shuffled deck, so a
  // board never opens on two of the same objective and nine block-aligned
  // contracts ask for nine different things.
  const kind = dealFrom(CONTRACT_KINDS, serial, 1_009);
  const level = Math.min(2, Math.floor(serial / 9) + ((h >>> 8) % 3 === 0 ? 1 : 0));
  const row = CONTRACT_TABLE[kind];
  /** @type {Contract["mode"]} */
  const mode = kind === "win" || kind === "podium" ? "race"
    : kind === "sprint" ? "sprint"
    : kind === "record" ? "timeattack"
    : kind === "draft" || kind === "close" ? "field"
    : null;
  /** @type {Tier | null} */
  const tier = kind === "win" || kind === "sprint" ? TIERS[level]
    : kind === "podium" ? (level === 0 ? "works" : "feral")
    : null;
  return {
    serial,
    kind,
    track: trackFor(serial),
    mode,
    tier,
    target: row.targets[level],
    reward: row.rewards[level],
  };
}

/**
 * The objective in the terminal's voice, without the circuit (the board prints
 * that separately, from the circuit table the rest of the paddock uses).
 *
 * @param {Contract} contract
 */
export function describeContract(contract) {
  const field = contract.tier ? ` · ${contract.tier.toUpperCase()} FIELD OR HARDER` : "";
  switch (contract.kind) {
    case "win": return `WIN THE FIELD RACE${field}`;
    case "podium": return `FINISH P${contract.target} OR BETTER IN THE FIELD RACE${field}`;
    case "sprint": return `WIN THE SPRINT · HOLD THE LEAD${field}`;
    case "speed": return `REACH ${contract.target} KM/H · ANY FORMAT`;
    case "chain": return `CHAIN ${contract.target} CLEAN GATES · ANY FORMAT`;
    case "drift": return `CASH ${contract.target} DRIFTS IN ONE RACE · ANY FORMAT`;
    case "draft": return `DRAFT ${contract.target} S IN SLIPSTREAM · RACE OR SPRINT`;
    case "close": return `LOG ${contract.target} NEAR MISSES · RACE OR SPRINT`;
    case "record": return "SET A PERSONAL BEST · TIME ATTACK";
  }
}

/**
 * Whether a finished race closes a contract. Every clause is a fact the race
 * already measured; nothing is re-simulated or estimated.
 *
 * @param {Contract} contract
 * @param {RaceFacts} facts
 */
export function contractMet(contract, facts) {
  if (facts.demo || facts.track !== contract.track) return false;
  if (contract.mode === "field" ? facts.mode === "timeattack" : contract.mode !== null && facts.mode !== contract.mode) {
    return false;
  }
  if (contract.tier && TIERS.indexOf(tierOf(facts.tier)) < TIERS.indexOf(contract.tier)) return false;
  const inField = count(facts.racerCount) > 1;
  switch (contract.kind) {
    case "win":
    case "sprint": return inField && facts.position === 1;
    case "podium": return inField && facts.position >= 1 && facts.position <= contract.target;
    case "speed": return facts.topSpeedKph >= contract.target;
    case "chain": return count(facts.cleanGateChain) >= contract.target;
    case "drift": return count(facts.driftCashes) >= contract.target;
    case "draft": return facts.slipstreamSeconds >= contract.target;
    case "close": return count(facts.nearMisses) >= contract.target;
    case "record": return facts.newBestLap === true;
  }
}

/**
 * The race purse, itemised. Separate from {@link settleRace} so the numbers
 * can be asserted without a garage in the way.
 *
 * @param {RaceFacts} facts
 * @param {boolean} newCircuit first classified finish on this circuit
 * @returns {PurseLine[]}
 */
export function racePurse(facts, newCircuit) {
  if (facts.demo) return [];
  const tier = tierOf(facts.tier);
  const laps = count(facts.laps);
  const solo = facts.mode === "timeattack" || count(facts.racerCount) <= 1;
  const place = Math.max(1, count(facts.position));
  const base = solo ? SOLO_PURSE : PLACE_PURSE[Math.min(place, PLACE_PURSE.length) - 1];
  const distance = clamp(laps / STANDARD_LAPS, 1 / STANDARD_LAPS, 5 / STANDARD_LAPS);
  const lapLabel = `${laps} ${laps === 1 ? "LAP" : "LAPS"}`;
  /** @type {PurseLine[]} */
  const lines = [{
    code: "place",
    label: solo ? `TIME ATTACK · ${lapLabel}` : `P${place} · ${tier.toUpperCase()} · ${lapLabel}`,
    amount: roundToFive(base * TIER_RATE[tier] * distance),
  }];
  if (facts.newBestLap) lines.push({ code: "best", label: "NEW BEST LAP", amount: NEW_BEST_BONUS });
  const chain = count(facts.cleanGateChain);
  if (chain >= CHAIN_MINIMUM) {
    lines.push({ code: "chain", label: `CLEAN CHAIN ×${chain}`, amount: Math.min(160, chain * 8) });
  }
  const close = count(facts.nearMisses);
  if (close > 0) lines.push({ code: "close", label: `NEAR MISSES ×${close}`, amount: Math.min(150, close * 15) });
  const drifts = count(facts.driftCashes);
  if (drifts > 0) lines.push({ code: "drift", label: `DRIFTS CASHED ×${drifts}`, amount: Math.min(120, drifts * 10) });
  if (newCircuit) lines.push({ code: "circuit", label: "NEW CIRCUIT LOGGED", amount: NEW_CIRCUIT_BONUS });
  return lines;
}

/**
 * Folds one finished race into the garage: the purse, the first-finish bonus,
 * and every contract on the board it closed. A closed contract's slot is
 * re-dealt from `next` immediately, so the board is always three deep.
 *
 * @param {Garage} garage
 * @param {RaceFacts} facts
 * @returns {Settlement}
 */
export function settleRace(garage, facts) {
  if (facts.demo) return { garage, lines: [], total: 0, completed: [], demo: true };
  const newCircuit = CIRCUIT_CODES.includes(facts.track) && !garage.circuits.includes(facts.track);
  const lines = racePurse(facts, newCircuit);
  const board = { ...garage.contracts, active: [...garage.contracts.active] };
  /** @type {Contract[]} */
  const completed = [];
  for (let slot = 0; slot < CONTRACT_SLOTS; slot += 1) {
    const contract = contractFor(board.active[slot]);
    if (!contractMet(contract, facts)) continue;
    completed.push(contract);
    lines.push({ code: "contract", label: `CONTRACT · ${describeContract(contract)}`, amount: contract.reward });
    board.active[slot] = board.next;
    board.next += 1;
    board.done += 1;
  }
  const total = lines.reduce((sum, line) => sum + line.amount, 0);
  return {
    garage: {
      ...garage,
      credits: garage.credits + total,
      contracts: board,
      circuits: newCircuit ? CIRCUIT_CODES.filter((code) => code === facts.track || garage.circuits.includes(code)) : garage.circuits,
    },
    lines,
    total,
    completed,
    demo: false,
  };
}

/**
 * @typedef {"credits" | "licence" | "owned" | "unowned" | "maxed" | "slot" | "unknown"} Refusal
 * @typedef {{ ok: true, garage: Garage, spent: number } | { ok: false, garage: Garage, reason: Refusal }} Transaction
 */

/** @param {Garage} garage @param {Refusal} reason @returns {Transaction} */
function refuse(garage, reason) {
  return { ok: false, garage, reason };
}

/** @param {Garage} garage @param {number} price @param {(next: Garage) => Garage} apply @returns {Transaction} */
function spend(garage, price, apply) {
  if (garage.credits < price) return refuse(garage, "credits");
  return { ok: true, garage: apply({ ...garage, credits: garage.credits - price }), spent: price };
}

/**
 * Buys a frame and puts it on the grid. A HALO needs its contract licence as
 * well as the credits; the licence is checked first so the refusal names the
 * thing the player actually has to go and do.
 *
 * @param {Garage} garage
 * @param {string} code
 * @returns {Transaction}
 */
export function buyFrame(garage, code) {
  if (!FRAME_CODES.includes(code)) return refuse(garage, "unknown");
  if (Object.hasOwn(garage.fleet, code)) return refuse(garage, "owned");
  const card = frameCard(code);
  if (garage.contracts.done < card.licence) return refuse(garage, "licence");
  return spend(garage, card.price, (next) => ({
    ...next,
    chassis: code,
    fleet: {
      ...next.fleet,
      [code]: {
        parts: { engine: 0, thrusters: 0, stabilisers: 0, skid: 0, plasma: 0 },
        glow: "stock",
        flame: "stock",
        under: "off",
      },
    },
  }));
}

/** @param {Garage} garage @param {string} code @returns {Transaction} */
export function selectFrame(garage, code) {
  if (!Object.hasOwn(garage.fleet, code)) return refuse(garage, "unowned");
  return { ok: true, garage: { ...garage, chassis: code }, spent: 0 };
}

/**
 * The next stage of one part on the frame on the grid. Parts belong to the
 * frame they were fitted to: a staged engine stays with the LANCE when the
 * driver switches to the BULWARK.
 *
 * @param {Garage} garage
 * @param {string} part
 * @returns {Transaction}
 */
export function buyPart(garage, part) {
  const fit = garage.fleet[garage.chassis];
  if (!fit || !Object.hasOwn(fit.parts, part)) return refuse(garage, "unknown");
  const key = /** @type {keyof typeof fit.parts} */ (part);
  const stage = fit.parts[key];
  if (stage >= MAX_PART_STAGE) return refuse(garage, "maxed");
  return spend(garage, partCard(part).prices[stage], (next) => ({
    ...next,
    fleet: {
      ...next.fleet,
      [garage.chassis]: { ...fit, parts: { ...fit.parts, [key]: stage + 1 } },
    },
  }));
}

/**
 * Fits a colour to one slot on the frame on the grid, buying it first if the
 * driver does not own it yet. One purchase, all three slots, every frame.
 *
 * @param {Garage} garage
 * @param {"glow" | "flame" | "under"} slot
 * @param {string} paint
 * @returns {Transaction}
 */
export function fitPaint(garage, slot, paint) {
  const fit = garage.fleet[garage.chassis];
  if (!fit || !PAINT_CODES.includes(paint) || !["glow", "flame", "under"].includes(slot)) {
    return refuse(garage, "unknown");
  }
  // Only the underglow can be switched off; lights and jets always burn.
  if (paint === "off" && slot !== "under") return refuse(garage, "slot");
  const owned = garage.paints.includes(paint);
  return spend(garage, owned ? 0 : paintCard(paint).price, (next) => ({
    ...next,
    paints: owned ? next.paints : PAINT_CODES.filter((code) => code === paint || next.paints.includes(code)),
    fleet: { ...next.fleet, [garage.chassis]: { ...fit, [slot]: paint } },
  }));
}

/**
 * Tears up one contract for a fee and deals the next serial into its slot.
 * The fee is what stops the board from being rerolled for free until it shows
 * only the circuit the driver already likes.
 *
 * @param {Garage} garage
 * @param {number} slot
 * @returns {Transaction}
 */
export function scrapContract(garage, slot) {
  if (!Number.isInteger(slot) || slot < 0 || slot >= CONTRACT_SLOTS) return refuse(garage, "unknown");
  return spend(garage, SCRAP_PRICE, (next) => {
    const active = [...next.contracts.active];
    active[slot] = next.contracts.next;
    return { ...next, contracts: { ...next.contracts, active, next: next.contracts.next + 1 } };
  });
}
