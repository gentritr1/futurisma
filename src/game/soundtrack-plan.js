/**
 * M1 — the local soundtrack's pure decisions, kept out of the runtime module
 * for the same reason `pit-radio-lines.js` and `music-plan.js` are plain JS
 * beside their TypeScript: a Node validator can import this file directly and
 * attack it without a bundler, an AudioContext or a DOM.
 *
 * Nothing in here touches the network, the audio graph or the page. The half
 * that does live in `soundtrack.ts`.
 */

/** Where the (gitignored) track list is served from. Same-origin, always. */
export const SOUNDTRACK_MANIFEST_PATH = "/assets/audio/music/tracks.local.json";
/** Where the (gitignored) audio files themselves are served from. */
export const SOUNDTRACK_DIRECTORY = "/assets/audio/music/";

/**
 * A mix longer than this gets dropped into rather than started from the top.
 *
 * The whole point of the phase is 60–120 minute jungle sets: starting every
 * launch on the same DJ intro would make a two-hour mix feel like a 90-second
 * one. Five minutes is the line because below it a track has a shape a listener
 * expects to hear from the beginning.
 */
export const LONG_TRACK_SECONDS = 300;
/** Never open on the first 30 s: that is where the intro talk usually is. */
export const RANDOM_START_MINIMUM_SECONDS = 30;
/** ...and never inside the last five minutes, so a launch gets a real run. */
export const RANDOM_START_TAIL_SECONDS = 300;

/**
 * `?music=` — three states, and the default is the interesting one.
 *
 * `synth` and `0` are both QA/kill switches in the `?voice=0` idiom: the URL
 * may take the tracks away, never impose them. There is deliberately no
 * `?music=track`, because "play my files if I have any" is already what the
 * absence of the switch means.
 *
 * @param {string | null} parameter
 * @returns {"auto" | "synth" | "off"}
 */
export function resolveMusicMode(parameter) {
  if (parameter === "0") return "off";
  if (parameter === "synth") return "synth";
  return "auto";
}

/**
 * Reads `{ tracks: [...] }` into the shape the player uses, dropping anything
 * malformed rather than throwing.
 *
 * A hand-edited manifest is the expected case — the import script writes it,
 * but the user owns it — so one bad row must cost that row and nothing else.
 * A missing file, a missing title and a missing duration are all survivable:
 * the file name is the only field without a fallback.
 *
 * @param {unknown} payload
 * @returns {{ file: string, title: string, durationSeconds: number }[]}
 */
export function normalizeManifest(payload) {
  const rows = payload
    && typeof payload === "object"
    && Array.isArray(/** @type {{ tracks?: unknown }} */ (payload).tracks)
    ? /** @type {unknown[]} */ (/** @type {{ tracks: unknown[] }} */ (payload).tracks)
    : [];
  /** @type {{ file: string, title: string, durationSeconds: number }[]} */
  const tracks = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const entry = /** @type {Record<string, unknown>} */ (row);
    const file = typeof entry.file === "string" ? entry.file.trim() : "";
    // A file name is a path segment and nothing more. The manifest is local and
    // trusted-ish, but it is also the one input to this module that a person
    // types by hand, and `../` in it would reach out of the served directory.
    if (file.length === 0 || file.includes("/") || file.includes("\\")) continue;
    if (file.startsWith(".")) continue;
    const title = typeof entry.title === "string" && entry.title.trim().length > 0
      ? entry.title.trim()
      : file.replace(/\.[a-z0-9]+$/i, "");
    const duration = Number(entry.durationSeconds);
    tracks.push({
      file,
      title,
      durationSeconds: Number.isFinite(duration) && duration > 0 ? duration : 0,
    });
  }
  return tracks;
}

/** @param {string} file */
export function trackPath(file) {
  return `${SOUNDTRACK_DIRECTORY}${encodeURIComponent(file)}`;
}

/**
 * Where in a mix this launch starts.
 *
 * The window is `[30 s, duration - 300 s]`, which only exists at all once the
 * mix is longer than 330 s — the guard below is not defensive noise, it is the
 * arithmetic: a 301-second track has an empty window and must start at 0, or
 * the offset would be negative and the element would refuse the seek.
 *
 * @param {number} durationSeconds
 * @param {() => number} random `Math.random`-shaped, in [0, 1).
 */
export function trackStartOffset(durationSeconds, random) {
  if (!Number.isFinite(durationSeconds)) return 0;
  if (durationSeconds <= LONG_TRACK_SECONDS) return 0;
  const highest = durationSeconds - RANDOM_START_TAIL_SECONDS;
  if (highest <= RANDOM_START_MINIMUM_SECONDS) return 0;
  return RANDOM_START_MINIMUM_SECONDS
    + random() * (highest - RANDOM_START_MINIMUM_SECONDS);
}

/**
 * A fresh play order, with the one guarantee that matters: the mix that just
 * finished is never the mix that starts next.
 *
 * Fisher-Yates, then a single corrective swap on the head. The swap is
 * deliberately not a re-shuffle loop — a loop can spin, and with two tracks it
 * would spin half the time.
 *
 * `previousLast` is `-1` on the first order of a page session, and NOTHING IS
 * PERSISTED between page loads. That is a constraint rather than a shortcut:
 * `scripts/validate-security.mjs` bans every per-tab web-storage API across
 * `src/` (the save file is the only storage surface this game has, and M1 is
 * explicitly not allowed to touch its schema), and it rejects the identifier on
 * sight. So the no-immediate-repeat guarantee holds WITHIN a page session -
 * which is where it matters, because that is where two mixes play in a row -
 * and a reload simply starts somewhere random.
 *
 * @param {number} count
 * @param {number} previousLast index of the track that just played, or -1.
 * @param {() => number} random
 * @returns {number[]}
 */
export function shuffleOrder(count, previousLast, random) {
  /** @type {number[]} */
  const order = [];
  for (let index = 0; index < count; index += 1) order.push(index);
  for (let index = count - 1; index > 0; index -= 1) {
    const pick = Math.floor(random() * (index + 1));
    const held = order[index];
    order[index] = order[pick];
    order[pick] = held;
  }
  if (count > 1 && order[0] === previousLast) {
    const swap = 1 + Math.floor(random() * (count - 1));
    const held = order[0];
    order[0] = order[swap];
    order[swap] = held;
  }
  return order;
}

/**
 * `?musictest=` — a forced play order, and it only exists under `?diagnostics=1`.
 *
 * The `ended` acceptance needs a twelve-second file to play FIRST and a second
 * file to follow it, which a shuffle cannot be asked to arrange. Comma-separated
 * file names; unknown names are dropped, and an order that resolves to nothing
 * falls back to the shuffle rather than to silence.
 *
 * @param {string | null} parameter
 * @param {{ file: string }[]} tracks
 * @returns {number[] | null}
 */
export function resolveTestOrder(parameter, tracks) {
  if (typeof parameter !== "string" || parameter.length === 0) return null;
  /** @type {number[]} */
  const order = [];
  for (const name of parameter.split(",")) {
    const wanted = name.trim();
    if (wanted.length === 0) continue;
    const index = tracks.findIndex((track) => track.file === wanted);
    if (index >= 0) order.push(index);
  }
  return order.length > 0 ? order : null;
}

/**
 * RMS in dBFS, floored so a silent bus reports a number rather than `-Infinity`.
 *
 * The floor is what makes `busMeters.musicDb < -60` a testable acceptance for
 * `?music=0`: JSON has no `-Infinity`, so an unfloored value would serialise to
 * `null` and the assertion would have to special-case it.
 *
 * @param {number} meanSquare
 */
export function meterDecibels(meanSquare) {
  if (!(meanSquare > 0)) return SOUNDTRACK_METER_FLOOR_DB;
  const decibels = 10 * Math.log10(meanSquare);
  return decibels < SOUNDTRACK_METER_FLOOR_DB ? SOUNDTRACK_METER_FLOOR_DB : decibels;
}

export const SOUNDTRACK_METER_FLOOR_DB = -120;
