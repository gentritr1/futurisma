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
 *
 * DAILY OPS sit on top: three jobs a calendar day, one a week, and a streak
 * of days with at least one job done, whose seventh day unlocks the one paint
 * scheme credits cannot buy. The day is a FACT like any other — the caller
 * reads the clock (`garage-purse.ts`) and hands in a day number — so the
 * board is as pure, and as provable, as the contracts.
 */
import {
  CIRCUIT_CODES,
  CONTRACT_SLOTS,
  DAILY_FIELDS,
  FRAME_CODES,
  MAX_PART_STAGE,
  PAINT_CODES,
  PATTERN_CODES,
  bodySchemes,
  defaultFit,
} from "./garage-rules.js";
import { frameCard, partCard, paintCard, patternCard, schemeCard, SCRAP_PRICE } from "./garage-catalog.js";

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
 * @property {number} [day] the local calendar day the race finished on
 *   (days since 1970-01-01); without it the daily board is left alone
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
 * @property {boolean} goldLeaf this race's streak day unlocked GOLD LEAF
 * @property {string} next the nearest open daily job and how far along it is
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
  if (facts.demo) return { garage, lines: [], total: 0, completed: [], demo: true, goldLeaf: false, next: "" };
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
  let { daily, goldLeaf } = garage;
  let unlocked = false;
  let next = "";
  if (typeof facts.day === "number" && Number.isInteger(facts.day) && facts.day > 0) {
    const settled = settleDaily(readDaily(daily, facts.day), facts, completed.length, goldLeaf);
    lines.push(...settled.lines);
    daily = writeDaily(settled.state);
    unlocked = settled.goldLeaf;
    goldLeaf ||= unlocked;
    next = settled.next;
  }
  const total = lines.reduce((sum, line) => sum + line.amount, 0);
  return {
    garage: {
      ...garage,
      credits: garage.credits + total,
      contracts: board,
      circuits: newCircuit ? CIRCUIT_CODES.filter((code) => code === facts.track || garage.circuits.includes(code)) : garage.circuits,
      daily,
      goldLeaf,
    },
    lines,
    total,
    completed,
    demo: false,
    goldLeaf: unlocked,
    next,
  };
}

// ---------------------------------------------------------------------------
// Daily ops
// ---------------------------------------------------------------------------

/**
 * @typedef {"laps" | "drifts" | "close" | "draft" | "speed" | "podium" | "chain" | "circuit"} JobKind
 * @typedef {object} Job
 * @property {JobKind} kind
 * @property {number} target
 * @property {number} reward
 * @property {boolean} cumulative counts across the day's races; otherwise the best single race
 * @property {string | null} track the circuit of the day, for `circuit`
 *
 * @typedef {"wins" | "circuits" | "contracts" | "drifts" | "laps"} WeeklyKind
 * @typedef {{ kind: WeeklyKind, target: number, reward: number }} WeeklyJob
 *
 * @typedef {object} DailyState the stored board, read for one day
 * @property {number} day
 * @property {number[]} progress per job slot, in the job's own unit
 * @property {number} flags bits 0-2 job paid, 3 sweep paid, 4 weekly paid, 5 news for the bay
 * @property {number} week
 * @property {number} weekly the weekly job's count, or a circuit bitmask for the set jobs
 * @property {number} streak consecutive days with a job done, as of `lastDay`
 * @property {number} lastDay the last day that counted for the streak
 */

/** Totals over the day's races: a lap is a lap in any format. */
const CUMULATIVE_JOBS = [
  { kind: "laps", target: 9 },
  { kind: "drifts", target: 12 },
  { kind: "close", target: 10 },
  { kind: "draft", target: 25 },
];
/** The best single race of the day. */
const ONE_RACE_JOBS = [
  { kind: "speed", target: 340 },
  { kind: "podium", target: 1 },
  { kind: "chain", target: 10 },
];
const JOB_PAY = { cumulative: 150, race: 200, circuit: 250 };
export const SWEEP_BONUS = 250;
/**
 * The streak ladder, day 1 to day 7, then round again. Day 7 pays the most
 * whatever the driver races, and the first time it also unlocks GOLD LEAF, so
 * a TOTEM-only driver (no body to paint) is never paid in something unusable.
 */
export const STREAK_PAY = [75, 125, 175, 225, 275, 325, 500];
const WEEKLY_JOBS = [
  { kind: "wins", target: 3 },
  { kind: "circuits", target: 5 },
  { kind: "contracts", target: 3 },
  { kind: "drifts", target: 60 },
  { kind: "laps", target: 30 },
];
export const WEEKLY_PAY = 1_200;
const PAID_SWEEP = 8;
const PAID_WEEKLY = 16;
const NEWS = 32;
const MAX_COUNT = 9_999_999;

/** Weeks start on Monday: day 0 (1970-01-01) was a Thursday. @param {number} day */
export function weekOf(day) {
  return Math.floor((day + 3) / 7);
}

/**
 * The day's three jobs: one total over the day, one single-race best, and
 * the circuit of the day. Dealt from their own shuffled decks by the day
 * number, so consecutive days never repeat a job until the deck turns over.
 * The circuit deck is aligned to the Monday-to-Sunday week, so every week of
 * dailies tours all seven circuits exactly once.
 *
 * @param {number} day
 * @returns {Job[]}
 */
export function dailyJobs(day) {
  const total = dealFrom(CUMULATIVE_JOBS, day, 2_111);
  const best = dealFrom(ONE_RACE_JOBS, day, 3_301);
  return [
    { kind: /** @type {JobKind} */ (total.kind), target: total.target, reward: JOB_PAY.cumulative, cumulative: true, track: null },
    { kind: /** @type {JobKind} */ (best.kind), target: best.target, reward: JOB_PAY.race, cumulative: false, track: null },
    { kind: "circuit", target: 1, reward: JOB_PAY.circuit, cumulative: false, track: dealFrom(CIRCUIT_CODES, day + 3, 4_409) },
  ];
}

/** @param {number} week @returns {WeeklyJob} */
export function weeklyJob(week) {
  const job = dealFrom(WEEKLY_JOBS, week, 5_503);
  return { kind: /** @type {WeeklyKind} */ (job.kind), target: job.target, reward: WEEKLY_PAY };
}

/**
 * The stored board as it stands on `day`. A new day — ANY day other than the
 * stored one, earlier included — starts three fresh jobs; a new week a fresh
 * weekly. A clock wound back behind the last day that counted for the streak
 * drops the streak, so a stored future day can never freeze the board or bank
 * a streak "from the future".
 *
 * @param {readonly number[]} tuple
 * @param {number} day
 * @returns {DailyState}
 */
export function readDaily(tuple, day) {
  const [storedDay, p0, p1, p2, flags, storedWeek, weekly, streak, lastDay] = tuple.length === DAILY_FIELDS
    ? tuple
    : Array(DAILY_FIELDS).fill(0);
  const today = storedDay === day;
  const week = weekOf(day);
  const thisWeek = storedWeek === week;
  const rolledBack = lastDay > day;
  return {
    day,
    progress: today ? [p0, p1, p2] : [0, 0, 0],
    flags: (today ? flags & (7 | PAID_SWEEP) : 0) | (thisWeek ? flags & PAID_WEEKLY : 0) | (flags & NEWS),
    week,
    weekly: thisWeek ? weekly : 0,
    streak: rolledBack ? 0 : streak,
    lastDay: rolledBack ? 0 : lastDay,
  };
}

/** @param {DailyState} state @returns {number[]} */
export function writeDaily(state) {
  return [state.day, ...state.progress, state.flags, state.week, state.weekly, state.streak, state.lastDay]
    .map((value) => clamp(Math.floor(value), 0, MAX_COUNT));
}

/**
 * The streak as the driver should read it today: still alive if the last day
 * that counted was today or yesterday, otherwise gone.
 *
 * @param {DailyState} state
 */
export function liveStreak(state) {
  return state.lastDay >= state.day - 1 ? state.streak : 0;
}

/** @param {number} mask */
function circuitsIn(mask) {
  let found = 0;
  for (let bit = 0; bit < CIRCUIT_CODES.length; bit += 1) if (mask & (1 << bit)) found += 1;
  return found;
}

/**
 * How far a job has got, in the job's own unit.
 *
 * @param {DailyState} state
 * @param {number} slot
 */
export function jobDone(state, slot) {
  return (state.flags & (1 << slot)) !== 0;
}

/** @param {DailyState} state @param {WeeklyJob} job */
export function weeklyProgress(state, job) {
  return job.kind === "wins" || job.kind === "circuits" ? circuitsIn(state.weekly) : state.weekly;
}

/** @param {DailyState} state */
export function sweptToday(state) {
  return (state.flags & PAID_SWEEP) !== 0;
}

/** @param {DailyState} state */
export function weeklyDone(state) {
  return (state.flags & PAID_WEEKLY) !== 0;
}

/** @param {DailyState} state */
export function hasNews(state) {
  return (state.flags & NEWS) !== 0;
}

/**
 * What a finished race adds to one job. Every clause is a fact the race
 * already measured; the field jobs need a field, and a podium is a place in
 * one.
 *
 * @param {Job} job
 * @param {RaceFacts} facts
 */
function jobGain(job, facts) {
  const inField = count(facts.racerCount) > 1 && facts.mode !== "timeattack";
  switch (job.kind) {
    case "laps": return count(facts.laps);
    case "drifts": return count(facts.driftCashes);
    case "close": return inField ? count(facts.nearMisses) : 0;
    case "draft": return inField ? Math.floor(Math.max(0, facts.slipstreamSeconds)) : 0;
    case "speed": return Math.floor(Math.max(0, facts.topSpeedKph));
    case "podium": return inField && facts.position >= 1 && facts.position <= 3 ? 1 : 0;
    case "chain": return count(facts.cleanGateChain);
    case "circuit": return facts.track === job.track ? 1 : 0;
  }
}

/** The objective in the terminal's voice. @param {Job} job */
export function describeJob(job) {
  switch (job.kind) {
    case "laps": return `COMPLETE ${job.target} LAPS · ANY FORMAT`;
    case "drifts": return `CASH ${job.target} DRIFTS · ANY FORMAT`;
    case "close": return `LOG ${job.target} NEAR MISSES · RACE OR SPRINT`;
    case "draft": return `${job.target} S IN SLIPSTREAM · RACE OR SPRINT`;
    case "speed": return `REACH ${job.target} KM/H IN ONE RACE`;
    case "podium": return "FINISH P3 OR BETTER · RACE OR SPRINT";
    case "chain": return `CHAIN ${job.target} CLEAN GATES IN ONE RACE`;
    case "circuit": return "FINISH A RACE ON THE CIRCUIT OF THE DAY";
  }
}

/** @param {WeeklyJob} job */
export function describeWeekly(job) {
  switch (job.kind) {
    case "wins": return `WIN A FIELD RACE ON ${job.target} DIFFERENT CIRCUITS`;
    case "circuits": return `FINISH ON ${job.target} DIFFERENT CIRCUITS`;
    case "contracts": return `CLOSE ${job.target} CONTRACTS`;
    case "drifts": return `CASH ${job.target} DRIFTS`;
    case "laps": return `COMPLETE ${job.target} LAPS`;
  }
}

/**
 * How far along a job reads, beside its bar: a total as `6/9`, a single-race
 * best as the best so far, a yes/no job as open until it is done.
 *
 * @param {Job} job
 * @param {number} progress
 */
export function jobProgressLabel(job, progress) {
  if (job.kind === "speed") return `BEST ${progress} / ${job.target} KM/H`;
  if (job.kind === "chain") return `BEST ×${progress} / ×${job.target}`;
  if (job.target === 1) return progress >= 1 ? "DONE" : "OPEN";
  return `${Math.min(progress, job.target)}/${job.target}`;
}

/**
 * Folds one finished race into the daily board: job progress and pay, the
 * sweep, the streak (counted by the day's FIRST job, not by the sweep: one
 * race a day is the habit, and the sweep pays for itself), the weekly job, and
 * the line the purse ends on pointing at the next race worth running.
 *
 * @param {DailyState} state
 * @param {RaceFacts} facts
 * @param {number} contractsClosed by this same race
 * @param {boolean} goldLeaf already on file
 * @returns {{ state: DailyState, lines: PurseLine[], goldLeaf: boolean, next: string }}
 */
export function settleDaily(state, facts, contractsClosed, goldLeaf) {
  /** @type {PurseLine[]} */
  const lines = [];
  const jobs = dailyJobs(state.day);
  let flags = state.flags;
  const progress = jobs.map((job, slot) => {
    const gain = jobGain(job, facts);
    return Math.min(MAX_COUNT, job.cumulative ? state.progress[slot] + gain : Math.max(state.progress[slot], gain));
  });
  const firstToday = (flags & 7) === 0;
  for (const [slot, job] of jobs.entries()) {
    if (flags & (1 << slot) || progress[slot] < job.target) continue;
    flags |= (1 << slot) | NEWS;
    lines.push({ code: "daily", label: `DAILY · ${describeJob(job)}`, amount: job.reward });
  }
  let { streak, lastDay } = state;
  let unlocked = false;
  if (firstToday && (flags & 7) !== 0 && lastDay !== state.day) {
    streak = lastDay === state.day - 1 ? streak + 1 : 1;
    lastDay = state.day;
    const rung = (streak - 1) % STREAK_PAY.length;
    lines.push({ code: "streak", label: `STREAK · DAY ${rung + 1} OF ${STREAK_PAY.length}`, amount: STREAK_PAY[rung] });
    unlocked = rung === STREAK_PAY.length - 1 && !goldLeaf;
  }
  if ((flags & 7) === 7 && !(flags & PAID_SWEEP)) {
    flags |= PAID_SWEEP;
    lines.push({ code: "sweep", label: "DAILY SWEEP · ALL THREE JOBS", amount: SWEEP_BONUS });
  }
  const weekly = weeklyJob(state.week);
  const bit = CIRCUIT_CODES.indexOf(facts.track);
  const inField = count(facts.racerCount) > 1 && facts.mode !== "timeattack";
  let weeklyCount = state.weekly;
  if (weekly.kind === "wins" && inField && facts.position === 1 && bit >= 0) weeklyCount |= 1 << bit;
  else if (weekly.kind === "circuits" && bit >= 0) weeklyCount |= 1 << bit;
  else if (weekly.kind === "contracts") weeklyCount += contractsClosed;
  else if (weekly.kind === "drifts") weeklyCount += count(facts.driftCashes);
  else if (weekly.kind === "laps") weeklyCount += count(facts.laps);
  const next = { ...state, progress, flags, streak, lastDay, weekly: Math.min(MAX_COUNT, weeklyCount) };
  if (!(flags & PAID_WEEKLY) && weeklyProgress(next, weekly) >= weekly.target) {
    next.flags |= PAID_WEEKLY | NEWS;
    lines.push({ code: "weekly", label: `WEEKLY · ${describeWeekly(weekly)}`, amount: weekly.reward });
  }
  return { state: next, lines, goldLeaf: unlocked, next: nextJobLine(next) };
}

/**
 * The purse's last word: the open daily job nearest done, or the weekly once
 * the day is swept, so every result screen points at the next race.
 *
 * @param {DailyState} state
 */
export function nextJobLine(state) {
  const jobs = dailyJobs(state.day);
  const open = jobs
    .map((job, slot) => ({ job, slot, share: Math.min(1, state.progress[slot] / job.target) }))
    .filter(({ slot }) => !jobDone(state, slot))
    .sort((a, b) => b.share - a.share)[0];
  if (open) return `NEXT · DAILY · ${describeJob(open.job)} · ${jobProgressLabel(open.job, state.progress[open.slot])}`;
  const weekly = weeklyJob(state.week);
  if (!weeklyDone(state)) {
    return `DAILY SWEPT · WEEKLY · ${describeWeekly(weekly)} · ${Math.min(weeklyProgress(state, weekly), weekly.target)}/${weekly.target}`;
  }
  return "DAILY SWEPT · WEEKLY DONE · NEW JOBS AT MIDNIGHT";
}

/**
 * @typedef {"credits" | "licence" | "owned" | "unowned" | "maxed" | "slot" | "streak" | "unknown"} Refusal
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
      [code]: defaultFit(),
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

/**
 * Paints the frame on the grid with a body scheme, buying it first if this
 * frame does not have it yet. A scheme is its own atlas, so it is owned per
 * frame; GOLD LEAF is never sold, only fitted once the streak has unlocked it.
 *
 * @param {Garage} garage
 * @param {string} scheme
 * @returns {Transaction}
 */
export function fitBody(garage, scheme) {
  const frame = garage.chassis;
  const fit = garage.fleet[frame];
  if (!fit || scheme === "factory" && frame === "totem" || !bodySchemes(frame).includes(scheme)) return refuse(garage, "unknown");
  if (scheme === "gold" && !garage.goldLeaf) return refuse(garage, "streak");
  const key = `${frame}:${scheme}`;
  const owned = scheme === "factory" || scheme === "gold" || garage.schemes.includes(key);
  return spend(garage, owned ? 0 : schemeCard(scheme).price ?? 0, (next) => ({
    ...next,
    schemes: owned ? next.schemes : [...next.schemes, key],
    fleet: { ...next.fleet, [frame]: { ...fit, body: scheme } },
  }));
}

/**
 * Fits an underglow pattern to the frame on the grid, buying it first if the
 * driver does not own it yet. Bought once, like a colour, for every frame.
 *
 * @param {Garage} garage
 * @param {string} pattern
 * @returns {Transaction}
 */
export function fitPattern(garage, pattern) {
  const fit = garage.fleet[garage.chassis];
  if (!fit || !PATTERN_CODES.includes(pattern)) return refuse(garage, "unknown");
  const owned = garage.patterns.includes(pattern);
  return spend(garage, owned ? 0 : patternCard(pattern).price, (next) => ({
    ...next,
    patterns: owned ? next.patterns : PATTERN_CODES.filter((code) => code === pattern || next.patterns.includes(code)),
    fleet: { ...next.fleet, [garage.chassis]: { ...fit, pattern } },
  }));
}

/**
 * The bay has shown the driver what a finish closed: clears the flag that
 * lands the next GARAGE press on the DAILY tab.
 *
 * @param {Garage} garage
 * @returns {Garage}
 */
export function seenDaily(garage) {
  const daily = [...garage.daily];
  daily[4] &= ~NEWS;
  return { ...garage, daily };
}
