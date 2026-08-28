/**
 * P10 — the ghost lap's pure half.
 *
 * The design decision this file encodes: a ghost stores **positions, not
 * inputs**. Replaying inputs would require the physics to be bit-reproducible
 * across builds — it is not, and never will be, so every stored ghost would
 * silently rot the first time a grip curve moved. A position recording is
 * version-independent: it describes where the craft *was*, which no later
 * physics change can invalidate.
 *
 * Everything here is plain JS with JSDoc types so `scripts/validate-ghost.mjs`
 * can run the recorder, the quantizer and the player under Node with no THREE
 * and no browser. `src/game/ghost-runtime.ts` is the thin adapter that feeds
 * this from the 120 Hz race step and poses a mesh from it.
 *
 * The stored form is deliberately lossy and bounded:
 *
 * | field       | unit stored              | worst-case error |
 * |-------------|--------------------------|------------------|
 * | `lapMeters` | centimetres, delta-coded | 0.005 m          |
 * | `lateral`   | centimetres              | 0.005 m          |
 * | `speed`     | whole km/h               | 0.14 m/s         |
 * | `steer`     | hundredths of full lock  | 0.005            |
 *
 * `lapMeters` is delta-coded *after* quantisation, never before, so the error
 * is a flat 0.005 m at every frame instead of accumulating along the lap.
 *
 * @typedef {object} GhostRecording The storable form. JSON-safe, ints only.
 * @property {number} version
 * @property {number} sampleHz
 * @property {number} lapMs The authoritative lap time; the frame count is a
 *   20 Hz quantisation of it and would be up to 50 ms out on its own.
 * @property {number[]} frames Flat, four ints per frame, in field order.
 *
 * @typedef {object} GhostTrack The decoded, playable form. Real units.
 * @property {number} sampleHz
 * @property {number} lapMs
 * @property {number} count
 * @property {Float64Array} lapMeters Distance along the lap, non-decreasing.
 * @property {Float64Array} lateral Metres from the centreline, + to starboard.
 * @property {Float64Array} speed Metres per second.
 * @property {Float64Array} steer -1..1, full lock either way.
 *
 * @typedef {object} GhostPose
 * @property {number} lapMeters
 * @property {number} lateral
 * @property {number} speed
 * @property {number} steer
 * @property {boolean} finished True once the clock is past the stored lap.
 */

/** Bumped only when the frame encoding changes. A ghost of any other version is dropped. */
export const GHOST_FORMAT_VERSION = 1;
/**
 * The recording rate. Chosen against the 120 Hz physics step so a sample is
 * every sixth step exactly — no wall clock, no accumulator, and therefore the
 * same frame count on a 60 Hz laptop and a 165 Hz monitor.
 */
export const GHOST_SAMPLE_HZ = 20;
/** 120 / 20. Asserted in the validator rather than assumed here. */
export const PHYSICS_STEPS_PER_SAMPLE = 6;
export const GHOST_FIELDS_PER_FRAME = 4;
/**
 * 120 s of lap at 20 Hz. Greenwater laps in ~34 s and Bitterpan in ~51 s, so
 * this is a hostile-payload ceiling, not a gameplay one — it is what stops a
 * hand-edited save from handing the player a 40 MB array to interpolate.
 */
export const MAX_GHOST_FRAMES = 2_400;
/** A single ghost's serialized budget. Measured, not guessed: see the validator. */
export const MAX_GHOST_CHARACTERS = 16 * 1024;

/** Field ranges. Anything outside these is a corrupt recording, not a slow lap. */
const MAX_LAP_CENTIMETRES = 2_000_000; // 20 km of lap.
const MAX_LATERAL_CENTIMETRES = 10_000; // 100 m off the centreline.
const MAX_SPEED_KMH = 2_000;
const STEER_SCALE = 100;
const MAX_LAP_MS = 30 * 60 * 1000;

/** @param {unknown} value */
function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** @param {number} value @param {number} low @param {number} high */
function clamp(value, low, high) {
  return value < low ? low : value > high ? high : value;
}

/**
 * Rounds to an integer and folds negative zero away.
 *
 * `Math.round(-0.004)` is `-0`, which `JSON.stringify` writes as `0` and
 * `JSON.parse` reads back as `+0` — so a ghost holding one would not be equal
 * to itself after a save and reload. Rare, silent, and exactly the kind of
 * thing the round-trip assertion exists to catch.
 *
 * @param {number} value
 */
function toStorableInt(value) {
  const rounded = Math.round(value);
  return rounded === 0 ? 0 : rounded;
}

/**
 * @param {unknown} value
 * @param {number} limit
 * @returns {value is number} True when `value` is a safe integer inside ±`limit`.
 */
function isBoundedInt(value, limit) {
  return typeof value === "number"
    && Number.isInteger(value)
    && value >= -limit
    && value <= limit;
}

/**
 * The recorder. Fed once per fixed physics step; keeps every sixth.
 *
 * It holds raw doubles and quantises only at {@link GhostRecorder#toRecording},
 * so a lap that never gets stored costs nothing but four pushes per sample and
 * the recording itself can never perturb the simulation — nothing here reads or
 * writes any physics state, and `step` has no return value the caller can act on.
 */
export class GhostRecorder {
  constructor(sampleHz = GHOST_SAMPLE_HZ, stepsPerSample = PHYSICS_STEPS_PER_SAMPLE) {
    this.sampleHz = sampleHz;
    this.stepsPerSample = stepsPerSample;
    /** @type {number[]} */ this.lapMeters = [];
    /** @type {number[]} */ this.lateral = [];
    /** @type {number[]} */ this.speed = [];
    /** @type {number[]} */ this.steer = [];
    this.steps = 0;
  }

  get frameCount() {
    return this.lapMeters.length;
  }

  /** Discards the lap in progress. Called at every race reset and lap boundary. */
  reset() {
    this.lapMeters.length = 0;
    this.lateral.length = 0;
    this.speed.length = 0;
    this.steer.length = 0;
    this.steps = 0;
  }

  /**
   * One fixed physics step. The first step of a lap is always sampled, so frame
   * 0 sits at t = 0 and the player needs no special case at the lap start.
   *
   * @param {number} lapMeters Distance along the current lap.
   * @param {number} lateral Metres from the centreline.
   * @param {number} speed Metres per second.
   * @param {number} steer -1..1.
   */
  step(lapMeters, lateral, speed, steer) {
    const due = this.steps % this.stepsPerSample === 0;
    this.steps += 1;
    if (!due || this.lapMeters.length >= MAX_GHOST_FRAMES) return;
    if (!Number.isFinite(lapMeters) || !Number.isFinite(lateral)) return;
    this.lapMeters.push(lapMeters);
    this.lateral.push(lateral);
    this.speed.push(Number.isFinite(speed) ? speed : 0);
    this.steer.push(Number.isFinite(steer) ? steer : 0);
  }

  /**
   * Freezes the lap into its storable form, or null when there is not enough of
   * a lap to replay. `lapMs` comes from the race clock rather than the frame
   * count because the frame count is only accurate to one sample period.
   *
   * @param {number} lapMs
   * @returns {GhostRecording | null}
   */
  toRecording(lapMs) {
    if (this.lapMeters.length < 2) return null;
    if (!Number.isFinite(lapMs) || lapMs <= 0 || lapMs > MAX_LAP_MS) return null;
    const frames = [];
    let previousCentimetres = 0;
    for (let index = 0; index < this.lapMeters.length; index += 1) {
      // Quantise first, then delta. The other order compounds the rounding
      // error along the lap; this way every frame is within half a centimetre.
      const centimetres = clamp(
        toStorableInt(this.lapMeters[index] * 100),
        0,
        MAX_LAP_CENTIMETRES,
      );
      // Distance along a lap cannot go backwards. A projection jitter that
      // would encode as a negative delta is pinned instead, which keeps the
      // decoded track monotonic by construction rather than by hope.
      const advance = Math.max(0, centimetres - previousCentimetres);
      previousCentimetres += advance;
      frames.push(
        advance,
        clamp(
          toStorableInt(this.lateral[index] * 100),
          -MAX_LATERAL_CENTIMETRES,
          MAX_LATERAL_CENTIMETRES,
        ),
        clamp(toStorableInt(this.speed[index] * 3.6), 0, MAX_SPEED_KMH),
        toStorableInt(clamp(this.steer[index], -1, 1) * STEER_SCALE),
      );
    }
    return {
      version: GHOST_FORMAT_VERSION,
      sampleHz: this.sampleHz,
      lapMs: Math.round(lapMs),
      frames,
    };
  }
}

/**
 * The one entry point for an untrusted ghost — a hand-edited save, a payload
 * from a build that encoded frames differently, a recording truncated by a
 * quota-exceeded write. Returns a recording that is safe to decode, or null.
 *
 * Null is not an error: `save-schema.js` responds by dropping the ghost and
 * keeping the course record, so a corrupt ghost costs the player a replay and
 * never a lap time.
 *
 * @param {unknown} raw
 * @returns {GhostRecording | null}
 */
export function normalizeGhost(raw) {
  if (!isPlainObject(raw)) return null;
  const source = /** @type {Record<string, unknown>} */ (raw);
  if (source.version !== GHOST_FORMAT_VERSION) return null;
  const sampleHz = source.sampleHz;
  if (!isBoundedInt(sampleHz, 120) || sampleHz < 1) return null;
  const lapMs = source.lapMs;
  if (!isBoundedInt(lapMs, MAX_LAP_MS) || lapMs <= 0) return null;
  const frames = source.frames;
  if (!Array.isArray(frames)) return null;
  if (frames.length === 0 || frames.length % GHOST_FIELDS_PER_FRAME !== 0) return null;
  if (frames.length > MAX_GHOST_FRAMES * GHOST_FIELDS_PER_FRAME) return null;
  const count = frames.length / GHOST_FIELDS_PER_FRAME;
  if (count < 2) return null;
  let centimetres = 0;
  for (let index = 0; index < count; index += 1) {
    const base = index * GHOST_FIELDS_PER_FRAME;
    const advance = frames[base];
    // A negative advance is the one thing that could break the player's
    // monotonicity guarantee, so it disqualifies the whole recording rather
    // than being repaired into something the file never actually held.
    if (!isBoundedInt(advance, MAX_LAP_CENTIMETRES) || advance < 0) return null;
    centimetres += advance;
    if (centimetres > MAX_LAP_CENTIMETRES) return null;
    if (!isBoundedInt(frames[base + 1], MAX_LATERAL_CENTIMETRES)) return null;
    if (!isBoundedInt(frames[base + 2], MAX_SPEED_KMH)) return null;
    if (frames[base + 2] < 0) return null;
    if (!isBoundedInt(frames[base + 3], STEER_SCALE)) return null;
  }
  return {
    version: GHOST_FORMAT_VERSION,
    sampleHz,
    lapMs,
    frames: /** @type {number[]} */ (frames.slice()),
  };
}

/**
 * Expands a validated recording into typed arrays in real units. Call
 * {@link normalizeGhost} first; this trusts its input.
 *
 * @param {GhostRecording} recording
 * @returns {GhostTrack}
 */
export function decodeGhost(recording) {
  const count = recording.frames.length / GHOST_FIELDS_PER_FRAME;
  const lapMeters = new Float64Array(count);
  const lateral = new Float64Array(count);
  const speed = new Float64Array(count);
  const steer = new Float64Array(count);
  let centimetres = 0;
  for (let index = 0; index < count; index += 1) {
    const base = index * GHOST_FIELDS_PER_FRAME;
    centimetres += recording.frames[base];
    lapMeters[index] = centimetres / 100;
    lateral[index] = recording.frames[base + 1] / 100;
    speed[index] = recording.frames[base + 2] / 3.6;
    steer[index] = recording.frames[base + 3] / STEER_SCALE;
  }
  return {
    sampleHz: recording.sampleHz,
    lapMs: recording.lapMs,
    count,
    lapMeters,
    lateral,
    speed,
    steer,
  };
}

/**
 * The serialized cost of a ghost, in characters of the save file.
 *
 * @param {GhostRecording} recording
 */
export function ghostCharacterCount(recording) {
  return JSON.stringify(recording).length;
}

/**
 * The player. Turns a race clock into a pose by linear interpolation between
 * the two frames straddling it.
 *
 * Interpolation is monotonic in `lapMeters` because the decoded track is
 * non-decreasing and a lerp between two non-decreasing samples cannot dip: this
 * is what stops the ghost from appearing to twitch backwards, which reads as a
 * bug far more loudly than a ghost that is simply half a metre off.
 *
 * The pose object is reused between calls — this runs once a frame beside the
 * rival fleet's own presentation pass, and neither may allocate.
 */
export class GhostPlayer {
  /** @param {GhostTrack} track */
  constructor(track) {
    this.track = track;
    /** @type {GhostPose} */
    this.pose = { lapMeters: 0, lateral: 0, speed: 0, steer: 0, finished: false };
  }

  get lapMs() {
    return this.track.lapMs;
  }

  get frameCount() {
    return this.track.count;
  }

  /**
   * @param {number} lapTimeMs Milliseconds since this lap began.
   * @returns {GhostPose} The reused pose object.
   */
  sampleAt(lapTimeMs) {
    const track = this.track;
    const pose = this.pose;
    const time = Number.isFinite(lapTimeMs) ? Math.max(0, lapTimeMs) : 0;
    const exact = (time / 1000) * track.sampleHz;
    const last = track.count - 1;
    if (exact >= last) {
      // Past the recording: hold the final pose. The ghost has crossed the line
      // and stops, which is the honest reading of a lap that has ended.
      pose.lapMeters = track.lapMeters[last];
      pose.lateral = track.lateral[last];
      pose.speed = track.speed[last];
      pose.steer = track.steer[last];
      pose.finished = true;
      return pose;
    }
    const index = Math.floor(exact);
    const alpha = exact - index;
    const next = index + 1;
    pose.lapMeters = track.lapMeters[index]
      + (track.lapMeters[next] - track.lapMeters[index]) * alpha;
    pose.lateral = track.lateral[index]
      + (track.lateral[next] - track.lateral[index]) * alpha;
    pose.speed = track.speed[index] + (track.speed[next] - track.speed[index]) * alpha;
    pose.steer = track.steer[index] + (track.steer[next] - track.steer[index]) * alpha;
    pose.finished = false;
    return pose;
  }
}

/**
 * Builds a player from stored data in one step, returning null for anything
 * that does not survive normalization.
 *
 * @param {unknown} raw
 * @returns {GhostPlayer | null}
 */
export function createGhostPlayer(raw) {
  const recording = normalizeGhost(raw);
  return recording === null ? null : new GhostPlayer(decodeGhost(recording));
}
