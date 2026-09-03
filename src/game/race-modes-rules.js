/**
 * G4 — the race formats, the rival tiers and the sector-delta arithmetic.
 *
 * Plain JS with JSDoc types, like `race-rules.js` and `save-schema.js` beside
 * it, so `scripts/validate-race-modes.mjs` can run every decision here under
 * Node against fixtures instead of against a browser. Nothing in this file
 * touches the DOM, the save file, three.js or the query string: it is given
 * numbers and returns numbers. `src/game/race-modes.ts` is the adapter that
 * owns all four of those.
 *
 * The governing rule, and the reason the split is worth its own module: a race
 * FORMAT is resolved once, at load, and then cannot change. Lap count, whether
 * a field is spawned, which pace table the field drives and which record slot
 * the result lands in are all decided here from two strings, and every consumer
 * downstream reads the answer rather than re-deriving it. A mode that meant one
 * thing to the lap counter and another to the save key is the failure this
 * shape rules out.
 *
 * @typedef {"race" | "sprint" | "timeattack"} RaceMode
 * @typedef {"rookie" | "works" | "feral"} RivalTier
 *
 * @typedef {object} GateSplitCurve
 * @property {readonly number[]} gateMeters Lap distance of each timed gate,
 *   ascending, exclusive of the lap line itself.
 * @property {readonly number[]} splitsMs Lap-relative time at each of those
 *   gates, same length and same order.
 * @property {number} lapMs The lap's own time, which closes the curve.
 * @property {number} lapLengthMeters
 */

/**
 * The three formats, in the order the paddock chip row prints them.
 * @type {readonly RaceMode[]}
 */
export const RACE_MODES = Object.freeze(["race", "sprint", "timeattack"]);
/** @type {RaceMode} */
export const DEFAULT_RACE_MODE = "race";

/**
 * The three field strengths, slowest first.
 * @type {readonly RivalTier[]}
 */
export const RIVAL_TIERS = Object.freeze(["rookie", "works", "feral"]);
/** @type {RivalTier} */
export const DEFAULT_RIVAL_TIER = "works";

/**
 * What each choice is called on screen, and the deck line under it.
 *
 * Here rather than beside the runtime for one concrete reason: `ui.ts` prints
 * these on the result screen and `meta-ui.ts` prints them on the chips, and
 * neither has any business importing the module that reads the query string and
 * writes the save file. Labels are data.
 */
/** @type {Readonly<Record<RaceMode, string>>} */
export const RACE_MODE_LABELS = Object.freeze({
  race: "FIELD RACE",
  sprint: "SPRINT",
  timeattack: "TIME ATTACK",
});

/** @type {Readonly<Record<RaceMode, string>>} */
export const RACE_MODE_DECKS = Object.freeze({
  race: "5 LAPS · FULL FIELD",
  sprint: "2 LAPS · DEFEND",
  timeattack: "5 LAPS · SOLO + GHOST",
});

/** @type {Readonly<Record<RivalTier, string>>} */
export const RIVAL_TIER_LABELS = Object.freeze({
  rookie: "ROOKIE",
  works: "WORKS",
  feral: "FERAL",
});

/** @type {Readonly<Record<RivalTier, string>>} */
export const RIVAL_TIER_DECKS = Object.freeze({
  rookie: "FIELD OFF PACE",
  works: "FACTORY PACE",
  feral: "FIELD AHEAD",
});

/**
 * The sprint's lap count, and why it is a constant rather than a preference.
 *
 * Two laps is what the format IS — a launch, a lap to hold the lead through and
 * a lap to survive — so `?laps=` deliberately does not reach it. Every other
 * mode still honours the override. See {@link resolveModeLapCount}, where that
 * asymmetry is enforced in one place so it cannot be half-applied.
 */
export const SPRINT_LAP_COUNT = 2;

/** How long a per-gate delta holds on the HUD, milliseconds. */
export const SECTOR_DELTA_HOLD_MS = 1_200;

/**
 * The live chip's minimum interval, milliseconds — 4 Hz exactly.
 *
 * The brief's ceiling, held here rather than at the call site because the HUD
 * frame already runs at 30 Hz: a chip that repainted every HUD frame would
 * write the DOM seven times for every reading a driver at 400 km/h can
 * actually take in.
 */
export const LIVE_DELTA_INTERVAL_MS = 250;

/**
 * How far apart two lap times have to be before the chip calls them different.
 *
 * One millisecond of jitter flickering a sign between orange and cyan is worse
 * than no chip at all, and the physics step is 8.33 ms, so anything under half
 * a step is below the instrument's own resolution. Reported as level.
 */
export const DELTA_DEAD_BAND_MS = 4;

/** @param {unknown} raw @returns {RaceMode} */
export function normalizeRaceMode(raw) {
  const value = typeof raw === "string" ? raw.toLowerCase() : "";
  return RACE_MODES.includes(/** @type {RaceMode} */ (value))
    ? /** @type {RaceMode} */ (value)
    : DEFAULT_RACE_MODE;
}

/** @param {unknown} raw @returns {RivalTier} */
export function normalizeRivalTier(raw) {
  const value = typeof raw === "string" ? raw.toLowerCase() : "";
  return RIVAL_TIERS.includes(/** @type {RivalTier} */ (value))
    ? /** @type {RivalTier} */ (value)
    : DEFAULT_RIVAL_TIER;
}

/**
 * Whether this format spawns the three rival craft at all.
 *
 * `timeattack` is the only false, and the consequence reaches further than the
 * scene graph: no fleet means no classification, no position ladder, no
 * slipstream and no cushion, so `fieldSize` reports 1 rather than 4 and the
 * validators that expect three rivals have to accept that. The absence is the
 * feature — a time attack the field could interfere with is not one.
 *
 * @param {RaceMode} mode
 */
export function modeHasField(mode) {
  return normalizeRaceMode(mode) !== "timeattack";
}

/**
 * How many craft are classified in this format: the player plus the field.
 *
 * @param {RaceMode} mode
 * @param {number} [fieldCount] rivals the fleet would spawn
 */
export function modeFieldSize(mode, fieldCount = 3) {
  const rivals = Number.isFinite(fieldCount) ? Math.max(0, Math.floor(fieldCount)) : 0;
  return modeHasField(mode) ? rivals + 1 : 1;
}

/**
 * Whether the field's longitudinal grid order is reversed for this format.
 *
 * @param {RaceMode} mode
 */
export function modeReversesGrid(mode) {
  return normalizeRaceMode(mode) === "sprint";
}

/**
 * The lap count this format races, and the one place `?laps=` is arbitrated.
 *
 * `race` and `timeattack` take the course's default and honour the override
 * within the course's own bounds, exactly as `resolveLapCount` in
 * `query-probes.ts` always did. `sprint` takes {@link SPRINT_LAP_COUNT} and
 * ignores the override, because the two-lap format is the mode rather than a
 * setting inside it — see the constant's note. The sprint count is still
 * clamped to what the course allows, so a course that refuses two laps gets a
 * legal race instead of a broken one.
 *
 * @param {RaceMode} mode
 * @param {{defaultLapCount: number, minimumLapCount: number, maximumLapCount: number}} course
 * @param {number} requestedLaps `?laps=`, or NaN when absent
 */
export function resolveModeLapCount(mode, course, requestedLaps) {
  const clamp = (/** @type {number} */ value) => Math.min(
    course.maximumLapCount,
    Math.max(course.minimumLapCount, value),
  );
  if (normalizeRaceMode(mode) === "sprint") return clamp(SPRINT_LAP_COUNT);
  if (!Number.isFinite(requestedLaps)) return course.defaultLapCount;
  return clamp(requestedLaps);
}

/**
 * The sprint's grid reversal, as a permutation of the field's grid slots.
 *
 * WHAT IS ACTUALLY REVERSED, and why it is not what the phrase first suggests.
 * Both shipped circuits already start the player AHEAD of the whole field:
 * Greenwater's profiles sit at -12 / -24 / -36 m and Bitterpan's authored grid
 * puts the works slot level with PRIVATEER 13 and the other two 15 m back, so
 * P1 on the grid is where a race already begins. Reversing THAT would put the
 * player last, which is an attack from the back — the opposite of the
 * defend-the-lead sprint this format is for.
 *
 * So what reverses is the FIELD's order among its own slots: the quickest rival
 * takes the slot furthest back and the slowest takes the closest. Over two laps
 * that is what makes the format a defence — the car that can actually beat you
 * has the most ground to make up before it can try.
 *
 * Pure, and a permutation rather than a rewrite: the authored slots are handed
 * back unchanged, only reassigned, so the spacing the map authored survives and
 * the lateral fan in `spreadGridLaterals` is untouched.
 *
 * @template T
 * @param {readonly T[]} slots grid slots in profile order, quickest first
 * @returns {T[]} the same slots, reassigned back to front
 */
export function reverseGridOrder(slots) {
  return [...slots].reverse();
}

/**
 * Resolves the pace table a tier races on.
 *
 * `works` is the authored base block itself, returned by identity: the tier
 * that G1 calibrated is not a copy of the shipped numbers sitting beside them
 * where the two can drift, it IS the shipped numbers. `rookie` and `feral`
 * author only what they change — a cruise speed and a boost window per profile
 * — and everything else (corner scrub, no-block side, drift curvature) is
 * inherited, so a later tuning pass to the shared model moves all three tiers
 * together.
 *
 * There is deliberately no multiplier here. A runtime scale on speed would make
 * the tier a property of the integrator rather than of the authored race, and
 * the boost windows — which is where a tier's character actually lives — cannot
 * be scaled at all. Every number a tier drives on is solved by
 * `scripts/rival-pace-calibration.mjs` and pinned by
 * `scripts/validate-rivals.mjs`.
 *
 * @param {object | null | undefined} pace the map's authored `rivals` block
 * @param {RivalTier} tier
 * @returns {object | null | undefined} a pace table in the shape rivals.ts reads
 */
export function applyPaceTier(pace, tier) {
  const wanted = normalizeRivalTier(tier);
  if (!pace || typeof pace !== "object") return pace;
  if (wanted === DEFAULT_RIVAL_TIER) return pace;
  const overlay = /** @type {Record<string, any>} */ (pace).tiers?.[wanted];
  // An absent or malformed tier block races the works pace rather than a
  // half-applied one. A tier that silently lost its boost windows would be a
  // different race wearing the same name, which is worse than an honest fall
  // back to the calibrated default.
  if (!overlay || typeof overlay !== "object" || !overlay.profiles) return pace;
  const base = /** @type {Record<string, any>} */ (pace);
  /** @type {Record<string, any>} */
  const profiles = {};
  for (const [id, entry] of Object.entries(base.profiles ?? {})) {
    profiles[id] = { ...entry, ...(overlay.profiles[id] ?? {}) };
  }
  return { ...base, ...overlay, profiles };
}

/**
 * The record slot a finished race lands in: one best lap per map, mode and
 * tier.
 *
 * Kept as a single string because that is what the save file stores it as, and
 * built here rather than at the call sites so the result screen, the live chip
 * and the write all address the same slot by construction. The map is NOT part
 * of it — the map is the course record's own key, and folding it in here would
 * put two identifiers in one field.
 *
 * @param {RaceMode} mode
 * @param {RivalTier} tier
 */
export function bestRecordKey(mode, tier) {
  return `${normalizeRaceMode(mode)}:${normalizeRivalTier(tier)}`;
}

/**
 * The ghost slot a mode replays from: one stored best-lap trace per map and
 * mode.
 *
 * Tier is deliberately not part of it. A ghost is a racing LINE, and the line
 * that sets a personal best round a circuit does not change because the cars
 * beside it got quicker; keeping tier out also holds the stored ghost count
 * down, which is the constraint the save file's payload ceiling actually cares
 * about (see `MAX_STORED_GHOSTS` in `save-schema.js`).
 *
 * @param {RaceMode} mode
 */
export function ghostRecordKey(mode) {
  return normalizeRaceMode(mode);
}

/**
 * A gate's delta against the stored best lap's split at the same gate.
 *
 * @param {number} splitMs lap-relative time this lap reached the gate at
 * @param {number | null | undefined} bestSplitMs the same gate, on the best lap
 * @returns {number | null} milliseconds, positive slower; null when there is
 *   nothing on file to compare against
 */
export function sectorDeltaMs(splitMs, bestSplitMs) {
  if (typeof splitMs !== "number" || !Number.isFinite(splitMs)) return null;
  if (typeof bestSplitMs !== "number" || !Number.isFinite(bestSplitMs)) return null;
  if (bestSplitMs <= 0) return null;
  return splitMs - bestSplitMs;
}

/**
 * The delta as the HUD prints it: two decimals, always signed, an em dash when
 * there is no record to measure against.
 *
 * U+2212 MINUS SIGN rather than a hyphen, because the pair has to read as a
 * pair at 400 km/h in a mono face and `-0.11` beside `+0.32` does not — the
 * hyphen sits high and short against the plus. Same reason the whole HUD prints
 * fixed-width numerals.
 *
 * @param {number | null} deltaMs
 */
export function formatDeltaSeconds(deltaMs) {
  if (deltaMs === null || !Number.isFinite(deltaMs)) return "—";
  if (Math.abs(deltaMs) < DELTA_DEAD_BAND_MS) return "0.00";
  const seconds = Math.abs(deltaMs) / 1000;
  return `${deltaMs > 0 ? "+" : "−"}${seconds.toFixed(2)}`;
}

/**
 * Which way a delta reads: slower, faster, or inside the dead band.
 *
 * The HUD colours off this rather than off the sign, so the dead band is
 * applied once and the chip's text and its colour can never disagree.
 *
 * @param {number | null} deltaMs
 * @returns {"none" | "level" | "up" | "down"}
 */
export function deltaTone(deltaMs) {
  if (deltaMs === null || !Number.isFinite(deltaMs)) return "none";
  if (Math.abs(deltaMs) < DELTA_DEAD_BAND_MS) return "level";
  return deltaMs > 0 ? "up" : "down";
}

/**
 * Where the stored best lap was, in lap time, at a given distance into the lap.
 *
 * The best lap is on file as its gate splits plus its own total, which is a
 * time-at-distance curve sampled at the gates. This interpolates it linearly
 * between those knots, with (0 m, 0 ms) at the lap line and (lap length,
 * lapMs) closing it.
 *
 * PIECEWISE-LINEAR IS THE HONEST CHOICE HERE, not a shortcut. The alternative
 * would be to drive the live chip off the stored ghost's 20 Hz position trace,
 * which is finer — but the ghost is per mode while the best lap is per mode AND
 * tier, so the two do not always describe the same lap, and a chip that
 * silently measured against a different lap than the gate flashes do would be a
 * worse error than a coarse one. Eight knots on a 2.5 km lap is a knot every
 * ~310 m; between them the curve assumes constant pace, which is wrong by
 * roughly the amount a corner differs from a straight and is why the chip is
 * held to 4 Hz and two decimals rather than presented as a timing beam.
 *
 * @param {number} lapMeters distance into the current lap
 * @param {GateSplitCurve} curve
 * @returns {number | null}
 */
export function bestLapTimeAtDistanceMs(lapMeters, curve) {
  if (!curve || !Number.isFinite(lapMeters) || lapMeters < 0) return null;
  const { gateMeters, splitsMs, lapMs, lapLengthMeters } = curve;
  if (!Number.isFinite(lapMs) || lapMs <= 0) return null;
  if (!Number.isFinite(lapLengthMeters) || lapLengthMeters <= 0) return null;
  if (!Array.isArray(gateMeters) || !Array.isArray(splitsMs)) return null;
  // Knots have to arrive in pairs. A best lap stored before a course changed
  // its gate count would otherwise be read against the wrong distances, which
  // is a wrong answer rather than a missing one.
  if (gateMeters.length !== splitsMs.length) return null;
  // THE WHOLE CURVE IS CHECKED BEFORE ANY OF IT IS READ, and that ordering is
  // the point rather than an implementation detail. Validating lazily — bailing
  // only once the walk reaches a bad knot — makes a corrupt record produce
  // perfectly good deltas for the first half of a lap and then silently stop,
  // which is a worse failure than never working: the driver has no way to know
  // which half they were being told the truth in. A curve that is broken
  // anywhere is refused everywhere.
  let previousMeters = 0;
  let previousMs = 0;
  for (let index = 0; index <= gateMeters.length; index += 1) {
    const knotMeters = index === gateMeters.length ? lapLengthMeters : gateMeters[index];
    const knotMs = index === gateMeters.length ? lapMs : splitsMs[index];
    if (!Number.isFinite(knotMeters) || !Number.isFinite(knotMs)) return null;
    // A non-monotonic curve is a corrupted record, not a slow lap.
    if (knotMeters <= previousMeters || knotMs <= previousMs) return null;
    previousMeters = knotMeters;
    previousMs = knotMs;
  }
  const distance = Math.min(lapMeters, lapLengthMeters);
  previousMeters = 0;
  previousMs = 0;
  for (let index = 0; index <= gateMeters.length; index += 1) {
    const knotMeters = index === gateMeters.length ? lapLengthMeters : gateMeters[index];
    const knotMs = index === gateMeters.length ? lapMs : splitsMs[index];
    if (distance <= knotMeters) {
      const span = knotMeters - previousMeters;
      const alpha = span > 0 ? (distance - previousMeters) / span : 0;
      return previousMs + (knotMs - previousMs) * alpha;
    }
    previousMeters = knotMeters;
    previousMs = knotMs;
  }
  return lapMs;
}

/**
 * The live delta: how far ahead of or behind the stored best lap this lap is,
 * right now.
 *
 * @param {number} lapElapsedMs time into the current lap
 * @param {number} lapMeters distance into the current lap
 * @param {GateSplitCurve | null} curve the stored best lap, or null
 * @returns {number | null} milliseconds, positive slower
 */
export function liveDeltaMs(lapElapsedMs, lapMeters, curve) {
  if (!curve) return null;
  if (!Number.isFinite(lapElapsedMs) || lapElapsedMs < 0) return null;
  const reference = bestLapTimeAtDistanceMs(lapMeters, curve);
  return reference === null ? null : lapElapsedMs - reference;
}

/**
 * Folds a finished lap's splits into the stored record, keeping the splits and
 * the time together.
 *
 * The rule this enforces is the same one `applyRaceResult` enforces for the
 * ghost: the stored splits are ALWAYS the splits of the lap that set the stored
 * time. Splits that outlived their lap would have the chip measuring against a
 * lap the board says you already beat — the exact failure the ghost's own note
 * in `save-schema.js` describes.
 *
 * @param {{bestLapMs: number | null, gateSplitsMs: readonly number[]} | null} stored
 * @param {number | null} lapMs
 * @param {readonly number[]} gateSplitsMs
 */
export function applyBestLapSplits(stored, lapMs, gateSplitsMs) {
  const previousMs = stored && Number.isFinite(stored.bestLapMs ?? NaN)
    ? /** @type {number} */ (stored.bestLapMs)
    : null;
  const improved = typeof lapMs === "number"
    && Number.isFinite(lapMs)
    && lapMs > 0
    && (previousMs === null || lapMs < previousMs);
  if (!improved) {
    return {
      best: stored ?? { bestLapMs: null, gateSplitsMs: [] },
      improved: false,
      previousBestLapMs: previousMs,
    };
  }
  return {
    best: { bestLapMs: Math.round(/** @type {number} */ (lapMs)), gateSplitsMs: [...gateSplitsMs] },
    improved: true,
    previousBestLapMs: previousMs,
  };
}
