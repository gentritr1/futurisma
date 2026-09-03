/**
 * P7 — the save file's pure half.
 *
 * `src/game/persistence.ts` is the only module allowed to touch browser
 * storage (see `scripts/validate-security.mjs`), so it stays a thin port: read
 * one string, write one string. Everything that *decides* anything — defaults,
 * parsing, per-field type guards, the record merge, the degrade-to-memory
 * rule — lives here, in plain JS with JSDoc types, so `scripts/validate-persistence.mjs`
 * can run the whole thing under Node with a stubbed port and prove it never
 * throws into the game.
 *
 * The governing rule for every read: **a hostile or unrecognised payload is
 * indistinguishable from a first run.** Nothing in this file may throw, and
 * nothing may return a partially-trusted object; a field that fails its guard
 * is replaced by its default rather than repaired.
 *
 * @typedef {"adaptive" | "high" | "low"} QualityMode
 * @typedef {"agx" | "ps2"} PresentationMode
 * @typedef {"storage" | "memory"} PersistenceMode
 *
 * @typedef {object} SaveSettings
 * @property {number} masterVolume 0..1, the whole mix.
 * @property {number} musicVolume 0..1, the four music stems only.
 * @property {boolean} reducedMotion Composes with the URL and OS signals.
 * @property {QualityMode} quality
 * @property {PresentationMode} renderMode
 *
 * @typedef {object} ModeBest
 * @property {number | null} bestLapMs Schema v3. The fastest lap set on this
 *   course in one specific mode and tier.
 * @property {number[]} gateSplitsMs Schema v3. Lap-relative time at each timed
 *   gate on that lap, ascending. Empty when the time predates split recording,
 *   which is exactly what a migrated v2 best arrives as.
 *
 * @typedef {object} CourseRecord
 * @property {number | null} bestLapMs The course's OUTRIGHT best, whichever
 *   mode and tier set it. This is the paddock's record line, and it is
 *   deliberately not per-mode: a circuit has one lap record.
 * @property {number | null} bestRaceMs
 * @property {number} laps Laps logged on this course, all sessions.
 * @property {Record<string, import("./ghost.js").GhostRecording>} ghosts
 *   Schema v3, keyed by race mode. The position trace of the lap that set that
 *   mode's best, for the modes this browser has one for. v2 stored a single
 *   `ghost` per course, which was always a `race`-mode lap because `race` was
 *   the only mode; the migration moves it to `ghosts.race` rather than dropping
 *   it. Bounded globally by {@link MAX_STORED_GHOSTS}, not per course.
 * @property {Record<string, ModeBest>} bests Schema v3, keyed by
 *   `"<mode>:<tier>"` — see `bestRecordKey` in `race-modes-rules.js`.
 *
 * @typedef {object} SaveFile
 * @property {number} schemaVersion
 * @property {SaveSettings} settings
 * @property {Record<string, CourseRecord>} records
 * @property {string} livery
 * @property {string} track The last dispatched circuit; `?map=` still wins.
 * @property {string} mode Schema v3. The last dispatched format; `?mode=` wins.
 * @property {string} tier Schema v3. The last dispatched field strength.
 *
 * @typedef {object} SavePort
 * @property {() => string | null} read
 * @property {(text: string) => void} write
 */
import { MAX_GHOST_CHARACTERS, normalizeGhost } from "./ghost.js";
import { LIVERY_CODES } from "./liveries.js";
import {
  DEFAULT_RACE_MODE,
  DEFAULT_RIVAL_TIER,
  RACE_MODES,
  RIVAL_TIERS,
} from "./race-modes-rules.js";

/** @type {readonly QualityMode[]} */
export const QUALITY_MODES = ["adaptive", "high", "low"];
/** @type {readonly PresentationMode[]} */
export const PRESENTATION_MODES = ["agx", "ps2"];
export const DEFAULT_LIVERY = "works";
/**
 * Circuit tokens. Kept here rather than imported from `map-selection.ts` so the
 * save file's vocabulary stays readable under Node, and so a course module can
 * never widen what is storable just by existing.
 */
export const TRACK_CODES = ["greenwater", "bitterpan"];
export const DEFAULT_TRACK = "greenwater";
export { LIVERY_CODES, RACE_MODES, RIVAL_TIERS, DEFAULT_RACE_MODE, DEFAULT_RIVAL_TIER };

/** Volumes are stored at slider resolution so a reload reads back exactly. */
const VOLUME_STEP = 0.05;
/** A stored payload larger than this is refused unparsed. */
const MAX_PAYLOAD_CHARACTERS = 64 * 1024;
/** A lap slower than this is a stuck clock, not a lap. */
const MAX_PLAUSIBLE_MS = 6 * 60 * 60 * 1000;
/** Course keys are authored codes such as `MAP 01`; nothing free-form. */
const COURSE_KEY_PATTERN = /^[A-Z0-9 _-]{1,16}$/;
const MAX_COURSE_KEYS = 16;
/**
 * P10 — how many stored ghosts may exist at once, and the reason the number is
 * this small. `MAX_COURSE_KEYS` records at `MAX_GHOST_CHARACTERS` each would be
 * 256 KB, four times what {@link MAX_PAYLOAD_CHARACTERS} will read back: the
 * game would write a file it then refuses on the next load, wiping every record
 * the player had. Two ghosts caps a written save at about 33 KB — comfortably
 * inside the ceiling with the shape unchanged.
 *
 * G4 — the budget is unchanged in SIZE and widened in SCOPE, which is the whole
 * point of restating it here. P10 spent it as "one ghost per course, two
 * courses"; v3 stores a ghost per course AND mode, so the same two slots are
 * now shared across six possible ones. That is deliberate: three modes on two
 * circuits at 16 KB each would be 96 KB, which is a save the game writes and
 * then refuses to read back — a total wipe, and the exact failure this constant
 * exists to prevent. The player keeps the two most recently earned replays and
 * the slot just raced is always one of them (see {@link capGhostBudget}); every
 * best LAP TIME is kept regardless, because a time is 8 bytes and a replay is
 * 16 KB.
 */
const MAX_STORED_GHOSTS = 2;
/**
 * G4 — how many `"<mode>:<tier>"` best-lap slots one course record may carry.
 *
 * Three modes times three tiers is nine, and a hostile payload must not be able
 * to turn the slot map into unbounded storage. Sized to the vocabulary rather
 * than generously, for the same reason `MAX_COURSE_KEYS` is: a slot this build
 * cannot name is a slot it cannot have written.
 */
const MAX_MODE_BEST_KEYS = RACE_MODES.length * RIVAL_TIERS.length;
/** `"<mode>:<tier>"`, and nothing else. Built by `bestRecordKey`. */
const MODE_BEST_KEY_PATTERN = new RegExp(
  `^(?:${RACE_MODES.join("|")}):(?:${RIVAL_TIERS.join("|")})$`,
);
/** Gate splits are one lap's worth; no course authors more gates than this. */
const MAX_GATE_SPLITS = 32;

/** @returns {SaveSettings} */
export function defaultSettings() {
  return {
    masterVolume: 1,
    musicVolume: 1,
    reducedMotion: false,
    quality: "adaptive",
    renderMode: "agx",
  };
}

/**
 * @param {number} schemaVersion
 * @returns {SaveFile}
 */
export function defaultSave(schemaVersion) {
  return {
    schemaVersion,
    settings: defaultSettings(),
    records: {},
    livery: DEFAULT_LIVERY,
    track: DEFAULT_TRACK,
    mode: DEFAULT_RACE_MODE,
    tier: DEFAULT_RIVAL_TIER,
  };
}

/** @returns {CourseRecord} */
export function defaultRecord() {
  return { bestLapMs: null, bestRaceMs: null, laps: 0, ghosts: {}, bests: {} };
}

/** @returns {ModeBest} */
export function defaultModeBest() {
  return { bestLapMs: null, gateSplitsMs: [] };
}

/**
 * Snaps a volume onto the slider grid and clamps it into 0..1. Anything that is
 * not a finite number falls back rather than poisoning a gain node with NaN.
 *
 * @param {unknown} value
 * @param {number} fallback
 */
export function normalizeVolume(value, fallback) {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  const clamped = value < 0 ? 0 : value > 1 ? 1 : value;
  return Math.round(clamped / VOLUME_STEP) * VOLUME_STEP;
}

/**
 * @param {unknown} value
 * @param {number | null} fallback
 * @returns {number | null}
 */
function normalizeTimeMs(value, fallback) {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  if (value <= 0 || value > MAX_PLAUSIBLE_MS) return fallback;
  return Math.round(value);
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * @param {unknown} raw
 * @returns {SaveSettings}
 */
export function normalizeSettings(raw) {
  const settings = defaultSettings();
  if (!isPlainObject(raw)) return settings;
  const source = raw;
  settings.masterVolume = normalizeVolume(source.masterVolume, settings.masterVolume);
  settings.musicVolume = normalizeVolume(source.musicVolume, settings.musicVolume);
  if (typeof source.reducedMotion === "boolean") {
    settings.reducedMotion = source.reducedMotion;
  }
  if (QUALITY_MODES.includes(/** @type {QualityMode} */ (source.quality))) {
    settings.quality = /** @type {QualityMode} */ (source.quality);
  }
  if (PRESENTATION_MODES.includes(/** @type {PresentationMode} */ (source.renderMode))) {
    settings.renderMode = /** @type {PresentationMode} */ (source.renderMode);
  }
  return settings;
}

/**
 * @param {unknown} raw
 * @returns {CourseRecord}
 */
export function normalizeRecord(raw) {
  const record = defaultRecord();
  if (!isPlainObject(raw)) return record;
  const source = raw;
  record.bestLapMs = normalizeTimeMs(source.bestLapMs, null);
  record.bestRaceMs = normalizeTimeMs(source.bestRaceMs, null);
  const laps = source.laps;
  if (typeof laps === "number" && Number.isFinite(laps) && laps > 0) {
    record.laps = Math.min(Math.floor(laps), 1_000_000);
  }
  record.ghosts = normalizeStoredGhosts(source.ghosts);
  record.bests = normalizeModeBests(source.bests);
  return record;
}

/**
 * G4 — the per-mode ghost map's guard.
 *
 * Inherits P10's rule exactly: a ghost that fails is ABSENT, and the lap times
 * either side of it are untouched. What is new is that one bad entry may not
 * cost the others — a corrupted sprint replay must not take the time-attack one
 * with it — so each key is guarded on its own and a failure drops that key
 * alone. An unrecognised mode is dropped rather than kept under a name this
 * build cannot replay.
 *
 * @param {unknown} raw
 * @returns {Record<string, import("./ghost.js").GhostRecording>}
 */
function normalizeStoredGhosts(raw) {
  /** @type {Record<string, import("./ghost.js").GhostRecording>} */
  const ghosts = {};
  if (!isPlainObject(raw)) return ghosts;
  for (const mode of RACE_MODES) {
    const ghost = normalizeStoredGhost(raw[mode]);
    if (ghost !== null) ghosts[mode] = ghost;
  }
  return ghosts;
}

/**
 * G4 — the `"<mode>:<tier>"` best-lap slots.
 *
 * A slot whose lap time fails its guard is dropped whole rather than kept with
 * a null time: an entry that exists but holds nothing would make the live delta
 * chip read `—` while the result screen claimed a record, and the two must
 * agree. Splits are guarded as a strictly ascending run of plausible times, and
 * a run that fails is emptied rather than trimmed — a partial split table is
 * measured against the wrong distances, which is a wrong delta rather than a
 * missing one.
 *
 * @param {unknown} raw
 * @returns {Record<string, ModeBest>}
 */
function normalizeModeBests(raw) {
  /** @type {Record<string, ModeBest>} */
  const bests = {};
  if (!isPlainObject(raw)) return bests;
  let kept = 0;
  for (const key of Object.keys(raw)) {
    if (kept >= MAX_MODE_BEST_KEYS) break;
    if (!MODE_BEST_KEY_PATTERN.test(key)) continue;
    const entry = raw[key];
    if (!isPlainObject(entry)) continue;
    const bestLapMs = normalizeTimeMs(entry.bestLapMs, null);
    if (bestLapMs === null) continue;
    bests[key] = { bestLapMs, gateSplitsMs: normalizeGateSplits(entry.gateSplitsMs, bestLapMs) };
    kept += 1;
  }
  return bests;
}

/**
 * G4 — a lap's gate splits: ascending, positive, and all inside the lap they
 * belong to.
 *
 * The last condition is the one worth stating. A split at or past the lap's own
 * time describes a gate crossed after the lap ended, which cannot happen, and
 * `bestLapTimeAtDistanceMs` refuses a non-monotonic curve anyway — so a table
 * that would be rejected on read is rejected on the way in instead, where the
 * failure is one empty array rather than a chip that silently never works.
 *
 * @param {unknown} raw
 * @param {number} lapMs
 * @returns {number[]}
 */
function normalizeGateSplits(raw, lapMs) {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_GATE_SPLITS) return [];
  /** @type {number[]} */
  const splits = [];
  let previous = 0;
  for (const value of raw) {
    if (typeof value !== "number" || !Number.isFinite(value)) return [];
    const split = Math.round(value);
    if (split <= previous || split >= lapMs) return [];
    splits.push(split);
    previous = split;
  }
  return splits;
}

/**
 * P10 — the ghost's own guard, kept separate from the record's because its
 * failure mode is different. A record that fails scrubs to defaults; a ghost
 * that fails is simply *absent*, and the lap times either side of it are
 * untouched. Losing a replay must never cost anyone a personal best.
 *
 * @param {unknown} raw
 * @returns {import("./ghost.js").GhostRecording | null}
 */
function normalizeStoredGhost(raw) {
  if (raw === undefined || raw === null) return null;
  const ghost = normalizeGhost(raw);
  if (ghost === null) return null;
  // A recording can pass every field guard and still be too big to store —
  // 2,400 legal frames is 45 KB. The size limit is part of the shape.
  if (JSON.stringify(ghost).length > MAX_GHOST_CHARACTERS) return null;
  return ghost;
}

/**
 * @param {unknown} raw
 * @returns {Record<string, CourseRecord>}
 */
function normalizeRecords(raw) {
  /** @type {Record<string, CourseRecord>} */
  const records = {};
  if (!isPlainObject(raw)) return records;
  let kept = 0;
  let ghosts = 0;
  for (const key of Object.keys(raw)) {
    if (kept >= MAX_COURSE_KEYS) break;
    if (!COURSE_KEY_PATTERN.test(key)) continue;
    const record = normalizeRecord(raw[key]);
    // Past the budget the record still lands; only its replays are dropped.
    // Counted across every (course, mode) slot rather than per course, which is
    // what keeps the read side's ceiling equal to the write side's.
    for (const mode of Object.keys(record.ghosts)) {
      if (ghosts >= MAX_STORED_GHOSTS) delete record.ghosts[mode];
      else ghosts += 1;
    }
    records[key] = record;
    kept += 1;
  }
  return records;
}

/**
 * P10 — holds the written file inside {@link MAX_PAYLOAD_CHARACTERS}.
 *
 * `normalizeRecords` caps ghosts on the way *in*; this caps them on the way
 * *out*, and the write side is the one that actually matters: a save the game
 * writes but cannot read back is a total wipe on the next load, which is the
 * one failure this whole module exists to prevent. The course just raced keeps
 * its ghost by priority, so setting a personal best never silently discards the
 * replay you set it with.
 *
 * G4 — the priority is now a (course, mode) SLOT rather than a course, because
 * that is what a ghost is stored per. The course just raced is still visited
 * first, and within it the mode just raced is visited first, so setting a
 * personal best never discards the replay you set it with even when the budget
 * is already full of two other modes' laps.
 *
 * @param {Record<string, CourseRecord>} records Freshly-copied; mutated in place.
 * @param {string} priorityKey
 * @param {string} priorityMode
 * @returns {Record<string, CourseRecord>}
 */
function capGhostBudget(records, priorityKey, priorityMode) {
  const keys = Object.keys(records);
  const ordered = keys.includes(priorityKey)
    ? [priorityKey, ...keys.filter((key) => key !== priorityKey)]
    : keys;
  let ghosts = 0;
  for (const key of ordered) {
    const record = records[key];
    const modes = Object.keys(record.ghosts);
    const orderedModes = key === priorityKey && modes.includes(priorityMode)
      ? [priorityMode, ...modes.filter((mode) => mode !== priorityMode)]
      : modes;
    /** @type {Record<string, import("./ghost.js").GhostRecording>} */
    const kept = {};
    for (const mode of orderedModes) {
      if (ghosts >= MAX_STORED_GHOSTS) continue;
      kept[mode] = record.ghosts[mode];
      ghosts += 1;
    }
    records[key] = { ...record, ghosts: kept };
  }
  return records;
}

/** @param {unknown} raw */
export function normalizeLivery(raw) {
  return LIVERY_CODES.includes(/** @type {string} */ (raw))
    ? /** @type {string} */ (raw)
    : DEFAULT_LIVERY;
}

/** @param {unknown} raw */
export function normalizeTrack(raw) {
  return TRACK_CODES.includes(/** @type {string} */ (raw))
    ? /** @type {string} */ (raw)
    : DEFAULT_TRACK;
}

/** G4 — the stored race format; `?mode=` still wins. @param {unknown} raw */
export function normalizeMode(raw) {
  return RACE_MODES.includes(/** @type {import("./race-modes-rules.js").RaceMode} */ (raw))
    ? /** @type {string} */ (raw)
    : DEFAULT_RACE_MODE;
}

/** G4 — the stored field strength; `?tier=` still wins. @param {unknown} raw */
export function normalizeTier(raw) {
  return RIVAL_TIERS.includes(/** @type {import("./race-modes-rules.js").RivalTier} */ (raw))
    ? /** @type {string} */ (raw)
    : DEFAULT_RIVAL_TIER;
}

/**
 * P10 — the schema versions this build knows how to read, oldest first. A
 * version outside this list is discarded whole, exactly as before.
 *
 * The migration ladder is deliberately data-shaped rather than a switch: each
 * entry is one step, applied in order, from the stored version up to the
 * current one. Adding v3 means adding one step, not editing `parseSave`.
 */
const MIGRATIONS = [
  {
    from: 1,
    to: 2,
    /**
     * v1 → v2. Purely additive: v2 gave `records[course]` an optional `ghost`,
     * and a v1 file simply has none. Every v1 field is carried through
     * untouched, so a v1 payload survives the step with nothing lost — which is
     * the property `scripts/validate-persistence.mjs` asserts field by field.
     *
     * @param {Record<string, unknown>} source
     * @returns {Record<string, unknown>}
     */
    step: (source) => source,
  },
  {
    from: 2,
    to: 3,
    /**
     * v2 → v3. G4 gave each course record a per-mode ghost map and a map of
     * best laps keyed by mode and tier, and gave the file itself a stored mode
     * and tier. Two of those three are additive; the ghost is a RELOCATION, and
     * relocation is where migrations lose files, so it is the part this step
     * actually does work for.
     *
     * `records[course].ghost` becomes `records[course].ghosts.race`. It is not
     * dropped and it is not duplicated: v2 had exactly one mode, `race`, so
     * every v2 ghost is a race-mode lap and `ghosts.race` is where the same lap
     * now lives. A build that dropped it would silently cost every returning
     * player their replay, which reads as a wipe even though the lap TIME
     * survived.
     *
     * `records[course].bestLapMs` also seeds `bests["race:works"]` with an
     * empty split table. Same argument: v2's best lap was necessarily set in
     * `race` at the `works` pace, because neither of the other choices existed,
     * so the slot it belongs in is knowable rather than guessable. The splits
     * are empty rather than invented — v2 never recorded them — and an empty
     * table is exactly what the delta chip reads as `—` until the first lap of
     * this build sets one. The outright `bestLapMs` on the record is left where
     * it is as well, so the paddock's record line is unchanged by the upgrade.
     *
     * `mode` and `tier` are absent from a v2 file and `normalizeMode` /
     * `normalizeTier` supply the defaults, which are the two the v2 build
     * raced. The upgrade therefore lands the player on the same dispatch they
     * left on.
     *
     * @param {Record<string, unknown>} source
     * @returns {Record<string, unknown>}
     */
    step: (source) => {
      const records = isPlainObject(source.records) ? source.records : {};
      /** @type {Record<string, unknown>} */
      const migrated = {};
      for (const [key, value] of Object.entries(records)) {
        if (!isPlainObject(value)) {
          migrated[key] = value;
          continue;
        }
        const { ghost, ...rest } = value;
        migrated[key] = {
          ...rest,
          ghosts: ghost === undefined || ghost === null ? {} : { race: ghost },
          bests: typeof value.bestLapMs === "number"
            ? { "race:works": { bestLapMs: value.bestLapMs, gateSplitsMs: [] } }
            : {},
        };
      }
      return { ...source, records: migrated };
    },
  },
];

/**
 * Walks a stored payload up the migration ladder to `schemaVersion`.
 *
 * @param {Record<string, unknown>} source
 * @param {unknown} storedVersion
 * @param {number} schemaVersion
 * @returns {Record<string, unknown> | null} Null when the ladder does not reach.
 */
function migrateSave(source, storedVersion, schemaVersion) {
  if (typeof storedVersion !== "number" || !Number.isInteger(storedVersion)) return null;
  if (storedVersion === schemaVersion) return source;
  if (storedVersion > schemaVersion || storedVersion < 1) return null;
  let migrated = source;
  let version = storedVersion;
  for (const migration of MIGRATIONS) {
    if (migration.from !== version) continue;
    migrated = migration.step(migrated);
    version = migration.to;
    if (version === schemaVersion) return migrated;
  }
  // The ladder ran out before reaching this build's shape. A partially-migrated
  // file is worse than no file, so it is discarded rather than half-trusted.
  return null;
}

/**
 * The one entry point for untrusted text. Returns a fully-formed save on every
 * input, including `null`, truncated JSON, a 5 MB string, a JSON array, and a
 * payload written by a schema this build has never seen.
 *
 * @param {unknown} text
 * @param {number} schemaVersion
 * @returns {SaveFile}
 */
export function parseSave(text, schemaVersion) {
  const fresh = defaultSave(schemaVersion);
  if (typeof text !== "string" || text.length === 0) return fresh;
  if (text.length > MAX_PAYLOAD_CHARACTERS) return fresh;
  /** @type {unknown} */
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return fresh;
  }
  if (!isPlainObject(parsed)) return fresh;
  const raw = /** @type {Record<string, unknown>} */ (parsed);
  // An unrecognised version is discarded whole. Reading half of a shape this
  // build does not understand is how save files get silently corrupted. A
  // version the ladder *does* cover is walked forward instead of thrown away.
  const source = migrateSave(raw, raw.schemaVersion, schemaVersion);
  if (source === null) return fresh;
  return {
    schemaVersion,
    settings: normalizeSettings(source.settings),
    records: normalizeRecords(source.records),
    livery: normalizeLivery(source.livery),
    track: normalizeTrack(source.track),
    mode: normalizeMode(source.mode),
    tier: normalizeTier(source.tier),
  };
}

/**
 * @param {SaveFile} save
 * @returns {string}
 */
export function serializeSave(save) {
  return JSON.stringify(save);
}

/**
 * Folds a finished race into a course record and reports what improved, so the
 * result screen can flash `NEW BEST` off the same decision the file stores.
 *
 * P10 added `run.ghost`. The rule the record has to keep is that the stored
 * ghost is *always* the lap that set `bestLapMs` — so a new best lap either
 * brings its own recording or clears the one on file. A ghost that outlived the
 * time it belongs to would replay a lap the board says you already beat.
 *
 * G4 SPLIT THAT COMPARISON IN TWO, and the split is the subtle part. There are
 * now two records a lap can beat:
 *
 *   - the course's OUTRIGHT best (`record.bestLapMs`), which is one number per
 *     circuit whatever mode set it, and
 *   - this mode and tier's own best (`record.bests[modeKey]`).
 *
 * They are not the same comparison and must not be collapsed. A quick lap in
 * `rookie` can beat the `rookie` record without touching a `feral` outright
 * best; a first-ever `sprint` lap sets a mode record on a circuit whose
 * outright best is untouchable. `NEW BEST` on the result screen reports the
 * MODE record, because that is the board the player was racing against — and
 * the ghost follows the mode record for the same reason, so what replays in
 * `timeattack` is the fastest time-attack lap rather than a race lap the format
 * cannot be compared against.
 *
 * The outright best still moves on any faster lap, because a lap record is a
 * lap record. It is what the paddock line prints and it is what a v2 file
 * arrives holding.
 *
 * @param {CourseRecord} record
 * @param {{
 *   bestLapMs: number | null,
 *   raceMs: number | null,
 *   laps: number,
 *   ghost?: unknown,
 *   modeKey?: string,
 *   ghostKey?: string,
 *   gateSplitsMs?: readonly number[],
 * }} run
 */
export function applyRaceResult(record, run) {
  const lapMs = normalizeTimeMs(run.bestLapMs, null);
  const raceMs = normalizeTimeMs(run.raceMs, null);
  const laps = typeof run.laps === "number" && Number.isFinite(run.laps) && run.laps > 0
    ? Math.floor(run.laps)
    : 0;
  const newOutrightLap = lapMs !== null
    && (record.bestLapMs === null || lapMs < record.bestLapMs);
  const newBestRace = raceMs !== null
    && (record.bestRaceMs === null || raceMs < record.bestRaceMs);

  const modeKey = typeof run.modeKey === "string" && MODE_BEST_KEY_PATTERN.test(run.modeKey)
    ? run.modeKey
    : null;
  const ghostKey = typeof run.ghostKey === "string"
    && RACE_MODES.includes(
      /** @type {import("./race-modes-rules.js").RaceMode} */ (run.ghostKey),
    )
    ? run.ghostKey
    : null;
  const previousModeBest = modeKey === null
    ? null
    : record.bests[modeKey] ?? null;
  const previousModeBestMs = previousModeBest?.bestLapMs ?? null;
  const newBestLap = modeKey !== null
    && lapMs !== null
    && (previousModeBestMs === null || lapMs < previousModeBestMs);

  const bests = { ...record.bests };
  if (newBestLap && modeKey !== null && lapMs !== null) {
    bests[modeKey] = {
      bestLapMs: lapMs,
      gateSplitsMs: normalizeGateSplits(run.gateSplitsMs, lapMs),
    };
  }
  const ghosts = { ...record.ghosts };
  if (ghostKey !== null && newBestLap) {
    const recording = normalizeStoredGhost(run.ghost);
    // Cleared rather than kept when the new best arrived without one: a replay
    // of a lap that is no longer the record is the one thing the ghost may
    // never be. Same rule P10 wrote, now applied per mode slot.
    if (recording === null) delete ghosts[ghostKey];
    else ghosts[ghostKey] = recording;
  }

  return {
    record: {
      bestLapMs: newOutrightLap ? lapMs : record.bestLapMs,
      bestRaceMs: newBestRace ? raceMs : record.bestRaceMs,
      laps: Math.min(record.laps + laps, 1_000_000),
      ghosts,
      bests,
    },
    newBestLap,
    newOutrightLap,
    newBestRace,
    previousBestLapMs: previousModeBestMs,
  };
}

/**
 * The live save. Holds one normalized `SaveFile` in memory and mirrors it to the
 * injected port. A port that throws on read starts the session from defaults; a
 * port that throws on write (a full quota, a browser with storage disabled)
 * drops the store to `"memory"` mode for the rest of the page load and stops
 * retrying — the game keeps working, it just forgets on reload.
 *
 * @param {SavePort | null} port
 * @param {number} schemaVersion
 */
export function createSaveStore(port, schemaVersion) {
  /** @type {string | null} */
  let text = null;
  if (port) {
    try {
      text = port.read();
    } catch {
      text = null;
    }
  }
  let save = parseSave(text, schemaVersion);
  /** @type {PersistenceMode} */
  let mode = port ? "storage" : "memory";
  let writeFailures = 0;

  function flush() {
    if (mode !== "storage" || !port) return;
    try {
      port.write(serializeSave(save));
    } catch {
      // Quota exceeded, or storage revoked mid-session. Degrade once, silently.
      writeFailures += 1;
      mode = "memory";
    }
  }

  return {
    /** @returns {PersistenceMode} */
    get mode() {
      return mode;
    },
    /** Diagnostics only: how many writes were refused before degrading. */
    get writeFailures() {
      return writeFailures;
    },
    /** @returns {SaveSettings} */
    get settings() {
      return { ...save.settings };
    },
    /** @returns {string} */
    get livery() {
      return save.livery;
    },
    /** @returns {string} */
    get track() {
      return save.track;
    },
    /**
     * G4 — the last dispatched format.
     *
     * Named `raceMode` rather than `mode` because the store already answers to
     * `mode`, which is the PERSISTENCE mode (`"storage"` or `"memory"`). Two
     * unrelated things called the same word on one object is how a caller ends
     * up storing `"memory"` as a race format; the stored JSON field is still
     * `mode`, because there it sits beside `track` and `livery` and means only
     * one thing.
     *
     * @returns {string}
     */
    get raceMode() {
      return save.mode;
    },
    /** G4 — the last dispatched field strength. @returns {string} */
    get tier() {
      return save.tier;
    },
    /**
     * @param {string} courseKey
     * @returns {CourseRecord}
     */
    recordFor(courseKey) {
      return { ...(save.records[courseKey] ?? defaultRecord()) };
    },
    /**
     * G4 — one mode and tier's best lap on a course, with the gate splits that
     * lap was set with. Always a defined object, so the delta chip's "nothing
     * on file" branch is a null `bestLapMs` rather than a missing record.
     *
     * @param {string} courseKey
     * @param {string} modeKey `"<mode>:<tier>"`
     * @returns {ModeBest}
     */
    bestFor(courseKey, modeKey) {
      const stored = save.records[courseKey]?.bests?.[modeKey];
      return stored
        ? { bestLapMs: stored.bestLapMs, gateSplitsMs: [...stored.gateSplitsMs] }
        : defaultModeBest();
    },
    /**
     * P10 — the stored best-lap ghost, already normalized, or null. Separate
     * from {@link recordFor} because the replay is read once at race start
     * while the record is read on every result screen.
     *
     * G4 — keyed by mode as well as course, so a time attack replays the
     * fastest time-attack lap rather than whatever lap the course last stored.
     *
     * @param {string} courseKey
     * @param {string} mode
     * @returns {import("./ghost.js").GhostRecording | null}
     */
    ghostFor(courseKey, mode) {
      return save.records[courseKey]?.ghosts?.[mode] ?? null;
    },
    /** @param {Partial<SaveSettings>} patch */
    updateSettings(patch) {
      save = {
        ...save,
        settings: normalizeSettings({ ...save.settings, ...patch }),
      };
      flush();
      return { ...save.settings };
    },
    /** @param {string} livery */
    setLivery(livery) {
      save = { ...save, livery: normalizeLivery(livery) };
      flush();
      return save.livery;
    },
    /** @param {string} track */
    setTrack(track) {
      save = { ...save, track: normalizeTrack(track) };
      flush();
      return save.track;
    },
    /** G4 @param {string} mode */
    setRaceMode(mode) {
      save = { ...save, mode: normalizeMode(mode) };
      flush();
      return save.mode;
    },
    /** G4 @param {string} tier */
    setTier(tier) {
      save = { ...save, tier: normalizeTier(tier) };
      flush();
      return save.tier;
    },
    /**
     * @param {string} courseKey
     * @param {{
     *   bestLapMs: number | null,
     *   raceMs: number | null,
     *   laps: number,
     *   ghost?: unknown,
     *   modeKey?: string,
     *   ghostKey?: string,
     *   gateSplitsMs?: readonly number[],
     * }} run
     */
    recordRace(courseKey, run) {
      if (!COURSE_KEY_PATTERN.test(courseKey)) {
        return {
          newBestLap: false,
          newOutrightLap: false,
          newBestRace: false,
          previousBestLapMs: null,
          record: defaultRecord(),
        };
      }
      const previous = save.records[courseKey] ?? defaultRecord();
      const applied = applyRaceResult(previous, run);
      save = {
        ...save,
        records: capGhostBudget(
          { ...save.records, [courseKey]: applied.record },
          courseKey,
          typeof run.ghostKey === "string" ? run.ghostKey : DEFAULT_RACE_MODE,
        ),
      };
      flush();
      return applied;
    },
    /** Test seam: the exact text that would be written right now. */
    snapshot() {
      return serializeSave(save);
    },
  };
}

/** @typedef {ReturnType<typeof createSaveStore>} SaveStore */
