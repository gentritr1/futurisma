#!/usr/bin/env node
/**
 * M1 — the soundtrack importer.
 *
 *   node scripts/music-import.mjs <url-or-audio-file> [--title "..."]
 *   node scripts/music-import.mjs --list
 *   node scripts/music-import.mjs --remove <slug>
 *
 * Pulls one mix into `public/assets/audio/music/`, normalises it and writes it
 * into the (gitignored) manifest the game reads. NOTHING it writes is ever
 * committed — the repository is public and the mixes are somebody else's
 * recordings. `scripts/validate-soundtrack.mjs` fails the build if a file with
 * an audio extension ever appears under that directory in `git ls-files`.
 *
 * WHY TWO-PASS LOUDNORM RATHER THAN ONE. A single-pass `loudnorm` is a dynamic
 * normaliser: it gates and rides the level as it goes, which on a 90-minute DJ
 * set means the quiet intro is pushed up and the drops are pulled down, and the
 * mix arrives at the game already squashed. The two-pass form MEASURES the
 * whole file first and then applies one linear gain, so the set keeps its own
 * dynamics and only its absolute level moves. That matters here more than it
 * usually would, because `TRACK_GAIN` in `src/game/soundtrack.ts` is a single
 * constant chosen against -14 LUFS material: it is only defensible if every
 * file really arrives at -14 LUFS, and a dynamic pass does not guarantee that.
 *
 * WHY -14 LUFS. It is the streaming-platform convention, so a mix pulled from
 * YouTube is usually already near it and the correction is small; and it leaves
 * about 14 dB of headroom under a -1.5 dBTP ceiling, which is enough for the
 * peaks of a jungle break to survive the encode.
 *
 * 128 kbps 44.1 kHz stereo, and that IS the taste call in this script. A
 * two-hour set at 128 kbps is ~110 MB; at 192 it is ~165 MB. The game plays it
 * through a media element under an engine bed at speed, and the difference is
 * not audible there. A player who disagrees can re-encode: the game reads
 * whatever the manifest names.
 *
 * The download step is deliberately the only part that touches the network, and
 * it only runs when the argument looks like a URL. Local files skip it.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  MANIFEST_RELATIVE_PATH,
  MUSIC_RELATIVE_DIRECTORY,
  normalizeManifestFile,
  removeTrack,
  serializeManifest,
  slugify,
  trackSlug,
  uniqueSlug,
  upsertTrack,
} from "./lib/music-manifest.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const musicDirectory = path.join(root, MUSIC_RELATIVE_DIRECTORY);
const manifestPath = path.join(root, MANIFEST_RELATIVE_PATH);

/** Homebrew's prefix, where yt-dlp/ffmpeg/ffprobe live on this machine. */
const TOOL_DIRECTORY = "/opt/homebrew/bin";

function tool(name) {
  const homebrew = path.join(TOOL_DIRECTORY, name);
  return existsSync(homebrew) ? homebrew : name;
}

function run(command, args, options = {}) {
  const result = spawnSync(tool(command), args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    ...options,
  });
  if (result.error) {
    throw new Error(`${command} could not be started: ${result.error.message}`);
  }
  return result;
}

function mustRun(command, args, options = {}) {
  const result = run(command, args, options);
  if (result.status !== 0) {
    process.stderr.write(result.stderr ?? "");
    throw new Error(`${command} exited ${result.status}.`);
  }
  return result;
}

function readManifest() {
  if (!existsSync(manifestPath)) return { tracks: [] };
  try {
    return normalizeManifestFile(JSON.parse(readFileSync(manifestPath, "utf8")));
  } catch {
    // A hand-edited manifest with a stray comma must not block an import.
    return { tracks: [] };
  }
}

function writeManifest(manifest) {
  mkdirSync(musicDirectory, { recursive: true });
  writeFileSync(manifestPath, serializeManifest(manifest));
}

/** ffprobe's duration for a media file, in seconds. */
function probeDuration(file) {
  const probe = mustRun("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1",
    file,
  ]);
  const seconds = Number.parseFloat(probe.stdout.trim());
  assert.ok(
    Number.isFinite(seconds) && seconds > 0,
    `ffprobe reported no usable duration for ${file}.`,
  );
  return seconds;
}

/**
 * The ebur128 integrated loudness of a finished file.
 *
 * Read back off the OUTPUT rather than trusted from the loudnorm pass, because
 * the loudnorm measurement is taken before the mp3 encode and the whole point
 * of printing it is to prove what the file on disk actually is.
 */
function measureLoudness(file) {
  const result = run("ffmpeg", [
    "-nostdin", "-hide_banner",
    "-i", file,
    "-af", "ebur128=framelog=quiet",
    "-f", "null", "-",
  ]);
  const summary = `${result.stderr ?? ""}`;
  const integrated = summary.match(/I:\s*(-?\d+(?:\.\d+)?)\s*LUFS/g);
  if (!integrated || integrated.length === 0) return null;
  const last = integrated[integrated.length - 1];
  const value = Number.parseFloat(last.replace(/[^-\d.]/g, ""));
  return Number.isFinite(value) ? value : null;
}

/** The measured pass of a two-pass loudnorm, as JSON. */
function measureLoudnorm(input) {
  const result = run("ffmpeg", [
    "-nostdin", "-hide_banner",
    "-i", input,
    "-af", "loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json",
    "-f", "null", "-",
  ]);
  const stderr = `${result.stderr ?? ""}`;
  const start = stderr.lastIndexOf("{");
  const end = stderr.lastIndexOf("}");
  assert.ok(start >= 0 && end > start, "ffmpeg loudnorm printed no measurement.");
  return JSON.parse(stderr.slice(start, end + 1));
}

function isUrl(argument) {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(argument);
}

/**
 * yt-dlp, and nothing here ever runs it on its own initiative.
 *
 * @returns {{ file: string, title: string }}
 */
function download(url, workDirectory) {
  const template = path.join(workDirectory, "download.%(ext)s");
  mustRun("yt-dlp", [
    "-x",
    "--audio-format", "mp3",
    "--audio-quality", "5",
    "--no-playlist",
    "-o", template,
    url,
  ], { stdio: ["ignore", "inherit", "inherit"] });
  const downloaded = readdirSync(workDirectory)
    .filter((name) => name.startsWith("download."))
    .map((name) => path.join(workDirectory, name));
  assert.ok(downloaded.length > 0, "yt-dlp produced no file.");
  const title = run("yt-dlp", ["--no-playlist", "--print", "%(title)s", url]);
  return {
    file: downloaded[0],
    title: title.status === 0 ? title.stdout.trim() : "",
  };
}

function list() {
  const manifest = readManifest();
  if (manifest.tracks.length === 0) {
    process.stdout.write(
      `No local soundtrack. ${MANIFEST_RELATIVE_PATH} is absent or empty; the `
        + "game plays its synthesised score.\n",
    );
    return;
  }
  process.stdout.write(`${MANIFEST_RELATIVE_PATH} — ${manifest.tracks.length} track(s)\n`);
  for (const track of manifest.tracks) {
    const minutes = Math.floor(track.durationSeconds / 60);
    const seconds = Math.round(track.durationSeconds % 60);
    const onDisk = existsSync(path.join(musicDirectory, track.file)) ? "" : "  [FILE MISSING]";
    process.stdout.write(
      `  ${trackSlug(track.file).padEnd(40)} ${String(minutes).padStart(3)}:${
        String(seconds).padStart(2, "0")}  ${track.title}${onDisk}\n`,
    );
  }
}

function remove(slug) {
  const { manifest, removed } = removeTrack(readManifest(), slug);
  if (removed.length === 0) {
    process.stdout.write(`No manifest entry with slug "${slug}".\n`);
    return;
  }
  for (const track of removed) {
    const file = path.join(musicDirectory, track.file);
    if (existsSync(file)) {
      unlinkSync(file);
      process.stdout.write(`Deleted ${MUSIC_RELATIVE_DIRECTORY}/${track.file}\n`);
    }
  }
  writeManifest(manifest);
  process.stdout.write(
    `Removed "${slug}" from the manifest; ${manifest.tracks.length} track(s) left.\n`,
  );
}

function importTrack(source, titleOverride) {
  mkdirSync(musicDirectory, { recursive: true });
  const workDirectory = mkdtempSync(path.join(tmpdir(), "futurisma-music-"));
  try {
    let input = source;
    let discoveredTitle = "";
    if (isUrl(source)) {
      const downloaded = download(source, workDirectory);
      input = downloaded.file;
      discoveredTitle = downloaded.title;
    } else {
      input = path.resolve(source);
      assert.ok(existsSync(input), `${input} does not exist.`);
    }

    const title = (titleOverride || discoveredTitle || path.basename(input).replace(/\.[^.]+$/, "")).trim();
    const manifest = readManifest();
    const taken = new Set(manifest.tracks.map((track) => trackSlug(track.file)));
    const baseSlug = slugify(title);
    // A re-import of the same title overwrites its own row rather than growing a
    // second one, so `uniqueSlug` only ever fires for two genuinely different
    // sets that happen to slug the same.
    const slug = taken.has(baseSlug) ? baseSlug : uniqueSlug(baseSlug, taken);
    const outputName = `${slug}.mp3`;
    const output = path.join(musicDirectory, outputName);

    process.stdout.write(`Measuring ${path.basename(input)} ...\n`);
    const measured = measureLoudnorm(input);
    const filter = "loudnorm=I=-14:TP=-1.5:LRA=11"
      + `:measured_I=${measured.input_i}`
      + `:measured_TP=${measured.input_tp}`
      + `:measured_LRA=${measured.input_lra}`
      + `:measured_thresh=${measured.input_thresh}`
      + `:offset=${measured.target_offset}`
      + ":linear=true:print_format=summary";
    process.stdout.write("Normalising and encoding ...\n");
    mustRun("ffmpeg", [
      "-nostdin", "-hide_banner", "-y",
      "-i", input,
      "-af", filter,
      "-ar", "44100",
      "-ac", "2",
      "-c:a", "libmp3lame",
      "-b:a", "128k",
      "-map_metadata", "-1",
      "-metadata", `title=${title}`,
      output,
    ]);

    const durationSeconds = probeDuration(output);
    const loudness = measureLoudness(output);
    const entry = { file: outputName, title, durationSeconds };
    writeManifest(upsertTrack(manifest, entry));

    const bytes = readFileSync(output).length;
    process.stdout.write(
      `\nWrote ${MUSIC_RELATIVE_DIRECTORY}/${outputName} — ${
        (bytes / (1024 * 1024)).toFixed(1)} MiB, ${
        Math.floor(durationSeconds / 60)}:${
        String(Math.round(durationSeconds % 60)).padStart(2, "0")}\n`,
    );
    process.stdout.write(
      `Output integrated loudness (ebur128): ${
        loudness === null ? "unavailable" : `${loudness.toFixed(1)} LUFS`} (target -14)\n`,
    );
    process.stdout.write(
      `Manifest entry: ${JSON.stringify({
        file: entry.file,
        title: entry.title,
        durationSeconds: Math.round(durationSeconds * 100) / 100,
      })}\n`,
    );
    process.stdout.write(
      "This file is gitignored and must never be committed.\n",
    );
  } finally {
    rmSync(workDirectory, { recursive: true, force: true });
  }
}

const argv = process.argv.slice(2);
if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
  process.stdout.write(
    "M1 soundtrack importer\n\n"
      + "  node scripts/music-import.mjs <url-or-audio-file> [--title \"Set name\"]\n"
      + "  node scripts/music-import.mjs --list\n"
      + "  node scripts/music-import.mjs --remove <slug>\n\n"
      + `Files land in ${MUSIC_RELATIVE_DIRECTORY}/ and are gitignored. The game\n`
      + "plays them through the MUSIC LEVEL bus; ?music=synth forces the\n"
      + "synthesised score and ?music=0 silences both.\n",
  );
  process.exit(0);
}

if (argv[0] === "--list") {
  list();
} else if (argv[0] === "--remove") {
  assert.ok(argv[1], "--remove needs a slug. Run --list to see them.");
  remove(argv[1]);
} else {
  const titleIndex = argv.indexOf("--title");
  const titleOverride = titleIndex >= 0 ? argv[titleIndex + 1] ?? "" : "";
  importTrack(argv[0], titleOverride);
}
