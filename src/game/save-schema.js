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
 * @typedef {object} CourseRecord
 * @property {number | null} bestLapMs
 * @property {number | null} bestRaceMs
 * @property {number} laps Laps logged on this course, all sessions.
 * @property {import("./ghost.js").GhostRecording | null} ghost Schema v2. The
 *   position trace of the lap that set `bestLapMs`, or null when this build has
 *   never stored one — every v1 file arrives here, and so does any file whose
 *   ghost failed its guards.
 *
 * @typedef {object} SaveFile
 * @property {number} schemaVersion
 * @property {SaveSettings} settings
 * @property {Record<string, CourseRecord>} records
 * @property {string} livery
 * @property {string} track The last dispatched circuit; `?map=` still wins.
 *
 * @typedef {object} SavePort
 * @property {() => string | null} read
 * @property {(text: string) => void} write
 */
import { MAX_GHOST_CHARACTERS, normalizeGhost } from "./ghost.js";
import { LIVERY_CODES } from "./liveries.js";

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
export { LIVERY_CODES };

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
 * P10 — how many courses may carry a ghost at once, and the reason the number
 * is this small. `MAX_COURSE_KEYS` records at `MAX_GHOST_CHARACTERS` each would
 * be 256 KB, four times what {@link MAX_PAYLOAD_CHARACTERS} will read back: the
 * game would write a file it then refuses on the next load, wiping every record
 * the player had. Two ghosts is both circuits, and caps a written save at about
 * 33 KB — comfortably inside the ceiling with the shape unchanged.
 */
const MAX_GHOST_COURSES = 2;

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
  };
}

/** @returns {CourseRecord} */
export function defaultRecord() {
  return { bestLapMs: null, bestRaceMs: null, laps: 0, ghost: null };
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
  record.ghost = normalizeStoredGhost(source.ghost);
  return record;
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
    if (record.ghost !== null) {
      // Past the budget the record still lands; only its replay is dropped.
      if (ghosts >= MAX_GHOST_COURSES) record.ghost = null;
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
 * @param {Record<string, CourseRecord>} records Freshly-copied; mutated in place.
 * @param {string} priorityKey
 * @returns {Record<string, CourseRecord>}
 */
function capGhostBudget(records, priorityKey) {
  const keys = Object.keys(records);
  const ordered = keys.includes(priorityKey)
    ? [priorityKey, ...keys.filter((key) => key !== priorityKey)]
    : keys;
  let ghosts = 0;
  for (const key of ordered) {
    if (records[key].ghost === null) continue;
    if (ghosts < MAX_GHOST_COURSES) {
      ghosts += 1;
      continue;
    }
    records[key] = { ...records[key], ghost: null };
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
 * @param {CourseRecord} record
 * @param {{
 *   bestLapMs: number | null,
 *   raceMs: number | null,
 *   laps: number,
 *   ghost?: unknown,
 * }} run
 */
export function applyRaceResult(record, run) {
  const lapMs = normalizeTimeMs(run.bestLapMs, null);
  const raceMs = normalizeTimeMs(run.raceMs, null);
  const laps = typeof run.laps === "number" && Number.isFinite(run.laps) && run.laps > 0
    ? Math.floor(run.laps)
    : 0;
  const newBestLap = lapMs !== null
    && (record.bestLapMs === null || lapMs < record.bestLapMs);
  const newBestRace = raceMs !== null
    && (record.bestRaceMs === null || raceMs < record.bestRaceMs);
  return {
    record: {
      bestLapMs: newBestLap ? lapMs : record.bestLapMs,
      bestRaceMs: newBestRace ? raceMs : record.bestRaceMs,
      laps: Math.min(record.laps + laps, 1_000_000),
      ghost: newBestLap ? normalizeStoredGhost(run.ghost) : record.ghost,
    },
    newBestLap,
    newBestRace,
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
     * @param {string} courseKey
     * @returns {CourseRecord}
     */
    recordFor(courseKey) {
      return { ...(save.records[courseKey] ?? defaultRecord()) };
    },
    /**
     * P10 — the stored best-lap ghost for a course, already normalized, or null.
     * Separate from {@link recordFor} because the replay is read once at race
     * start while the record is read on every result screen.
     *
     * @param {string} courseKey
     * @returns {import("./ghost.js").GhostRecording | null}
     */
    ghostFor(courseKey) {
      return save.records[courseKey]?.ghost ?? null;
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
    /**
     * @param {string} courseKey
     * @param {{
     *   bestLapMs: number | null,
     *   raceMs: number | null,
     *   laps: number,
     *   ghost?: unknown,
     * }} run
     */
    recordRace(courseKey, run) {
      if (!COURSE_KEY_PATTERN.test(courseKey)) {
        return { newBestLap: false, newBestRace: false, record: defaultRecord() };
      }
      const previous = save.records[courseKey] ?? defaultRecord();
      const applied = applyRaceResult(previous, run);
      save = {
        ...save,
        records: capGhostBudget(
          { ...save.records, [courseKey]: applied.record },
          courseKey,
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
