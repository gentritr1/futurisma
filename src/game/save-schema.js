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
  return { bestLapMs: null, bestRaceMs: null, laps: 0 };
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
  return record;
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
  for (const key of Object.keys(raw)) {
    if (kept >= MAX_COURSE_KEYS) break;
    if (!COURSE_KEY_PATTERN.test(key)) continue;
    records[key] = normalizeRecord(raw[key]);
    kept += 1;
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
  const source = /** @type {Record<string, unknown>} */ (parsed);
  // An unrecognised version is discarded whole. Reading half of a shape this
  // build does not understand is how save files get silently corrupted.
  if (source.schemaVersion !== schemaVersion) return fresh;
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
 * @param {CourseRecord} record
 * @param {{ bestLapMs: number | null, raceMs: number | null, laps: number }} run
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
     * @param {{ bestLapMs: number | null, raceMs: number | null, laps: number }} run
     */
    recordRace(courseKey, run) {
      if (!COURSE_KEY_PATTERN.test(courseKey)) {
        return { newBestLap: false, newBestRace: false, record: defaultRecord() };
      }
      const previous = save.records[courseKey] ?? defaultRecord();
      const applied = applyRaceResult(previous, run);
      save = {
        ...save,
        records: { ...save.records, [courseKey]: applied.record },
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
