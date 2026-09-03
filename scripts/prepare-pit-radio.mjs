import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { PIT_RADIO_LINES, PIT_RADIO_SAMPLE_RATE } from "../src/game/pit-radio-lines.js";

/**
 * H2b — the encoder for the project's first shipped audio files.
 *
 * The 17 pit-radio lines arrive as 24 kHz 16-bit mono WAV from the voice
 * session and are NOT tracked (`assets-in/` is gitignored, the same rule the
 * Higgsfield sheets follow). This script is the tracked half: it is the record
 * of exactly what was done to them, and re-running it on the same sources
 * reproduces the served bytes.
 *
 * WHY THE DSP IS HERE AND NOT IN AN FFMPEG FILTER GRAPH. The acceptance
 * criteria are numeric — peak -1 dBFS, matched RMS, leading and trailing
 * silence under 60 ms — and an `ffmpeg -af silenceremove,loudnorm` chain would
 * satisfy them without ever printing what it achieved. Decoding to f32,
 * trimming and normalising in Node and handing the samples BACK to ffmpeg for
 * the MP3 stage means the script measures its own output: every number in the
 * table it prints is read off the samples that were encoded, so the report can
 * quote a measurement rather than a filter string.
 *
 * WHY MP3. `decodeAudioData` has to accept these in every browser the game
 * runs in and the graph decodes them through the existing AudioContext rather
 * than an `<audio>` element — which matters, because `index.html` ships
 * `media-src 'none'` and that stays true: a `fetch()` of an ArrayBuffer is
 * governed by `connect-src`, so no CSP directive moves for this phase. Opus
 * would be smaller but Safari's `decodeAudioData` does not take it in WebM or
 * Ogg; MP3 at 24 kHz is MPEG-2 Layer III, which every shipping decoder reads.
 *
 * Usage:
 *   `node scripts/prepare-pit-radio.mjs [--source DIR] [--bitrate 48k] [--dry]`
 *
 * `--source` exists because `assets-in/` is gitignored and therefore absent
 * from every agent worktree; point it at the main checkout's copy.
 */

const argv = process.argv.slice(2);
const SOURCE_DIRECTORY = argv.includes("--source")
  ? argv[argv.indexOf("--source") + 1].replace(/\/?$/, "/")
  : fileURLToPath(new URL("../assets-in/higgsfield/voice-arthur/", import.meta.url));
const OUTPUT_DIRECTORY = fileURLToPath(
  new URL("../public/assets/audio/radio/", import.meta.url),
);

const bitrate = argv.includes("--bitrate")
  ? argv[argv.indexOf("--bitrate") + 1]
  : "48k";
const dryRun = argv.includes("--dry");

/** The voiced-detection floor. Below this a window is treated as room tone. */
const VOICE_FLOOR_DBFS = -45;
/** RMS window for that detection, in seconds. */
const DETECT_WINDOW_SECONDS = 0.005;
/** Silence at least this long separates one voiced segment from the next. */
const SEGMENT_GAP_SECONDS = 0.25;
/**
 * A voiced segment shorter than this, at either END of a file, is an artefact
 * rather than speech.
 *
 * Three of the seventeen sources open with one — 10 to 130 ms of click or
 * breath before the read starts, at 22 to 37 dB below the voice. Left in, they
 * are what a leading-silence trimmer trims TO, so `gust_right` kept 1.2 s of
 * dead air in front of the words and `lights_out` 1.1 s. Only edge segments are
 * eligible: a short segment BETWEEN two long ones is a word.
 */
const EDGE_ARTEFACT_SECONDS = 0.25;
/**
 * How long a pause INSIDE a line may be.
 *
 * Not in the brief, and disclosed as an addition rather than smuggled in. The
 * sources are single reads with dramatic pauses — measured at 0.28 to 1.06 s
 * between clauses — which makes `slipstream_locked` a 4.2 s line and
 * `gate_missed` a 3.5 s one. The radio plays one line at a time with a 1.4 s
 * gap after it, so a four-second sentence with a second of silence in the
 * middle does not just sound dead, it holds the bus long enough for the next
 * event's line to expire unspoken. Capping the internal pause at 220 ms keeps
 * the phrasing and returns the bus.
 *
 * The cut is taken from the MIDDLE of the pause, where the source is quietest,
 * with a 10 ms crossfade; nothing voiced is touched.
 */
const MAX_INTERNAL_GAP_SECONDS = 0.22;
/** The crossfade over an internal splice. */
const SPLICE_FADE_SECONDS = 0.01;
/** Kept in front of the first voiced window, so a plosive is not clipped. */
const LEAD_IN_SECONDS = 0.02;
/** Kept after the last voiced window, so a fricative tail is not clipped. */
const LEAD_OUT_SECONDS = 0.05;
/** The brief's ceiling on silence at either end. */
const MAX_EDGE_SILENCE_SECONDS = 0.06;
/** Cosine fade at each cut, so trimming never introduces a step. */
const EDGE_FADE_SECONDS = 0.005;
/** Peak ceiling, dBFS. */
const PEAK_CEILING_DBFS = -1;

function decibels(amplitude) {
  return amplitude > 0 ? 20 * Math.log10(amplitude) : -Infinity;
}

function amplitude(decibelValue) {
  return Math.pow(10, decibelValue / 20);
}

/** @returns {Float32Array} mono samples at {@link PIT_RADIO_SAMPLE_RATE}. */
function decode(path) {
  const raw = execFileSync("ffmpeg", [
    "-v", "error",
    "-i", path,
    "-ac", "1",
    "-ar", String(PIT_RADIO_SAMPLE_RATE),
    "-f", "f32le",
    "-",
  ], { maxBuffer: 1 << 28 });
  return new Float32Array(
    raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength),
  );
}

function rms(samples, from = 0, to = samples.length) {
  let sum = 0;
  for (let index = from; index < to; index += 1) sum += samples[index] ** 2;
  const count = Math.max(1, to - from);
  return Math.sqrt(sum / count);
}

function peak(samples) {
  let highest = 0;
  for (const sample of samples) highest = Math.max(highest, Math.abs(sample));
  return highest;
}

/**
 * Every run of voiced windows, split wherever the source goes quiet for at
 * least {@link SEGMENT_GAP_SECONDS}.
 *
 * @returns {[number, number][]} sample ranges, in order.
 */
function voicedSegments(samples) {
  const window = Math.max(1, Math.round(DETECT_WINDOW_SECONDS * PIT_RADIO_SAMPLE_RATE));
  const floor = amplitude(VOICE_FLOOR_DBFS);
  const gapWindows = Math.round(SEGMENT_GAP_SECONDS / DETECT_WINDOW_SECONDS);
  const segments = [];
  let start = -1;
  let quiet = 0;
  for (let at = 0; at < samples.length; at += window) {
    const end = Math.min(samples.length, at + window);
    if (rms(samples, at, end) >= floor) {
      if (start < 0) start = at;
      quiet = 0;
      continue;
    }
    if (start < 0) continue;
    quiet += 1;
    if (quiet < gapWindows) continue;
    segments.push([start, at - (quiet - 1) * window]);
    start = -1;
    quiet = 0;
  }
  if (start >= 0) segments.push([start, samples.length]);
  return segments;
}

/**
 * The read itself: the segments with the edge artefacts removed.
 *
 * NOT a take selection. Every source in this set is one continuous read with
 * pauses in it, which was verified rather than assumed: a 16-band spectral
 * profile of each pair of segments in a file, time-normalised and compared by
 * cosine similarity, tops out at 0.895 (`wrong_way`, which shares vowels
 * between "Wrong way." and "Turn around."), where two renders of the same words
 * by the same voice sit above 0.95. So the segments are consecutive clauses and
 * all of them are kept.
 */
function keepSegments(segments) {
  const minimum = EDGE_ARTEFACT_SECONDS * PIT_RADIO_SAMPLE_RATE;
  let first = 0;
  let last = segments.length - 1;
  while (first < last && segments[first][1] - segments[first][0] < minimum) first += 1;
  while (last > first && segments[last][1] - segments[last][0] < minimum) last -= 1;
  return segments.slice(first, last + 1);
}

/**
 * Concatenates the kept segments, capping every pause between them, and
 * returns the joined samples plus the head and tail silence that was dropped.
 */
function assemble(samples, segments) {
  const rate = PIT_RADIO_SAMPLE_RATE;
  const leadIn = Math.round(LEAD_IN_SECONDS * rate);
  const leadOut = Math.round(LEAD_OUT_SECONDS * rate);
  const cap = Math.round(MAX_INTERNAL_GAP_SECONDS * rate);
  const fade = Math.round(SPLICE_FADE_SECONDS * rate);
  const first = Math.max(0, segments[0][0] - leadIn);
  const last = Math.min(samples.length, segments[segments.length - 1][1] + leadOut);

  const pieces = [];
  let cursor = first;
  for (let index = 1; index < segments.length; index += 1) {
    const gapStart = segments[index - 1][1];
    const gapEnd = segments[index][0];
    const gap = gapEnd - gapStart;
    if (gap <= cap) continue;
    // Keep half the cap either side of the pause and drop the quiet middle.
    const keepBefore = gapStart + Math.floor(cap / 2);
    const keepAfter = gapEnd - Math.ceil(cap / 2);
    pieces.push([cursor, keepBefore]);
    cursor = keepAfter;
  }
  pieces.push([cursor, last]);

  let length = 0;
  for (const [from, to] of pieces) length += to - from;
  const joined = new Float32Array(length);
  let at = 0;
  for (let index = 0; index < pieces.length; index += 1) {
    const [from, to] = pieces[index];
    joined.set(samples.subarray(from, to), at);
    // Crossfade the splice. Both sides are inside a pause, so the fade is over
    // room tone and cannot clip a consonant; it exists only to stop the join
    // from being a step.
    if (index > 0) {
      for (let n = 0; n < fade && at + n < joined.length; n += 1) {
        const shape = n / fade;
        joined[at + n] *= shape;
        if (at - 1 - n >= 0) joined[at - 1 - n] *= shape;
      }
    }
    at += to - from;
  }
  return {
    joined,
    headSilenceSeconds: first / rate,
    tailSilenceSeconds: (samples.length - last) / rate,
    internalCutSeconds: (last - first - length) / rate,
  };
}

function fadeEdges(samples) {
  const fade = Math.min(
    Math.round(EDGE_FADE_SECONDS * PIT_RADIO_SAMPLE_RATE),
    Math.floor(samples.length / 2),
  );
  for (let index = 0; index < fade; index += 1) {
    const shape = 0.5 - 0.5 * Math.cos((Math.PI * index) / fade);
    samples[index] *= shape;
    samples[samples.length - 1 - index] *= shape;
  }
  return samples;
}

const ids = Object.keys(PIT_RADIO_LINES).sort();
const decoded = ids.map((id) => {
  const source = join(SOURCE_DIRECTORY, `${id}.wav`);
  const samples = decode(source);
  const segments = keepSegments(voicedSegments(samples));
  const assembled = assemble(samples, segments);
  const trimmed = fadeEdges(assembled.joined);
  return {
    id,
    source,
    trimmed,
    segments: segments.length,
    headSilenceSeconds: assembled.headSilenceSeconds,
    tailSilenceSeconds: assembled.tailSilenceSeconds,
    internalCutSeconds: assembled.internalCutSeconds,
    sourceSeconds: samples.length / PIT_RADIO_SAMPLE_RATE,
    rms: rms(trimmed),
  };
});

/**
 * The common loudness target is the MEDIAN of the set, not a fixed number.
 *
 * A fixed target would have every line moved, including the ones the voice
 * session already got right; the median moves the outliers toward the body of
 * the set and leaves the body alone, which is what "similar RMS across lines"
 * asks for. The peak ceiling still wins where the two disagree — a line that
 * would clip is pulled down and its RMS shortfall is printed rather than
 * hidden, because a limiter on dialogue is the thing that makes a radio line
 * sound processed.
 */
const sortedRms = decoded.map((entry) => entry.rms).sort((a, b) => a - b);
const targetRms = sortedRms[Math.floor(sortedRms.length / 2)];
const ceiling = amplitude(PEAK_CEILING_DBFS);

mkdirSync(OUTPUT_DIRECTORY, { recursive: true });
const scratch = join(tmpdir(), `futurisma-pit-radio-${process.pid}.f32`);

const rows = [];
let totalBytes = 0;
let totalSeconds = 0;
for (const entry of decoded) {
  const gain = targetRms / entry.rms;
  const scaled = Float32Array.from(entry.trimmed, (sample) => sample * gain);
  const scaledPeak = peak(scaled);
  const limit = scaledPeak > ceiling ? ceiling / scaledPeak : 1;
  if (limit < 1) for (let index = 0; index < scaled.length; index += 1) scaled[index] *= limit;

  const outputPath = join(OUTPUT_DIRECTORY, `${entry.id}.mp3`);
  if (!dryRun) {
    writeFileSync(scratch, Buffer.from(scaled.buffer));
    execFileSync("ffmpeg", [
      "-v", "error", "-y",
      "-f", "f32le", "-ar", String(PIT_RADIO_SAMPLE_RATE), "-ac", "1",
      "-i", scratch,
      "-c:a", "libmp3lame",
      "-b:a", bitrate,
      "-write_xing", "1",
      outputPath,
    ]);
  }
  const bytes = dryRun ? 0 : statSync(outputPath).size;
  totalBytes += bytes;
  totalSeconds += scaled.length / PIT_RADIO_SAMPLE_RATE;
  rows.push({
    id: entry.id,
    seconds: scaled.length / PIT_RADIO_SAMPLE_RATE,
    sourceSeconds: entry.sourceSeconds,
    segments: entry.segments,
    head: entry.headSilenceSeconds,
    tail: entry.tailSilenceSeconds,
    cut: entry.internalCutSeconds,
    rmsDbfs: decibels(rms(scaled)),
    peakDbfs: decibels(peak(scaled)),
    bytes,
  });
}

console.log(
  `PIT RADIO ENCODE — libmp3lame ${bitrate} mono @ ${PIT_RADIO_SAMPLE_RATE} Hz\n`,
);
console.log(
  "id".padEnd(22) + "src".padStart(7) + "out".padStart(8) + "seg".padStart(5)
    + "rms".padStart(8) + "peak".padStart(7) + "bytes".padStart(8)
    + "   dropped head/tail/inner (s)",
);
for (const row of rows) {
  console.log(
    row.id.padEnd(22)
      + `${row.sourceSeconds.toFixed(2)}`.padStart(7)
      + `${row.seconds.toFixed(2)}s`.padStart(8)
      + `${row.segments}`.padStart(5)
      + `${row.rmsDbfs.toFixed(1)}`.padStart(8)
      + `${row.peakDbfs.toFixed(1)}`.padStart(7)
      + `${row.bytes}`.padStart(8)
      + `   ${row.head.toFixed(3)} / ${row.tail.toFixed(3)} / ${row.cut.toFixed(3)}`,
  );
}
const rmsValues = rows.map((row) => row.rmsDbfs);
console.log(
  `\n${rows.length} lines · ${totalSeconds.toFixed(2)} s · ${totalBytes} B `
    + `(${(totalBytes / 1024).toFixed(1)} KiB)`
    + `\nRMS ${Math.min(...rmsValues).toFixed(1)} .. ${Math.max(...rmsValues).toFixed(1)} dBFS `
    + `(target ${decibels(targetRms).toFixed(1)}, the set's own median); `
    + `peak ceiling ${PEAK_CEILING_DBFS} dBFS, worst ${
      Math.max(...rows.map((row) => row.peakDbfs)).toFixed(1)}`
    + `\nAuthored lead-in ${(LEAD_IN_SECONDS * 1000).toFixed(0)} ms, lead-out ${
      (LEAD_OUT_SECONDS * 1000).toFixed(0)} ms (ceiling ${
      (MAX_EDGE_SILENCE_SECONDS * 1000).toFixed(0)} ms); internal pauses capped at ${
      (MAX_INTERNAL_GAP_SECONDS * 1000).toFixed(0)} ms`,
);
