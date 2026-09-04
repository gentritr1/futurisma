/**
 * M1 — the import script's pure half.
 *
 * `scripts/music-import.mjs` runs yt-dlp, ffmpeg and ffprobe, writes files and
 * mutates a manifest on disk. None of that can be tested without a network, a
 * toolchain and a temp directory. Everything in THIS file is a function of its
 * arguments, so `scripts/validate-soundtrack.mjs` can attack the parts that are
 * actually easy to get wrong — slugging and the upsert — on every `test:code`
 * run, with no processes spawned and nothing downloaded.
 */

/** Where the manifest lives, relative to the repository root. */
export const MANIFEST_RELATIVE_PATH = "public/assets/audio/music/tracks.local.json";
/** Where the audio lives, relative to the repository root. */
export const MUSIC_RELATIVE_DIRECTORY = "public/assets/audio/music";
/** Extensions the validator treats as "audio that must never be committed". */
export const AUDIO_EXTENSIONS = ["mp3", "m4a", "ogg", "wav"];

/**
 * A file-name-safe slug for a YouTube title.
 *
 * Lowercase ASCII, digits and single hyphens, and nothing else — the slug
 * becomes both the file name on disk and a URL path segment, and DJ set titles
 * routinely carry slashes, ampersands, emoji, CJK and RTL text. Diacritics are
 * folded rather than stripped so "Café Del Mar" stays readable as
 * "cafe-del-mar"; anything that folds to nothing falls back to `track`, because
 * a title that is entirely non-Latin must still produce a usable file name
 * rather than an empty one.
 *
 * Capped at 64 characters on a hyphen boundary so a 120-character set title
 * does not become a 120-character file name.
 *
 * @param {string} title
 * @returns {string}
 */
export function slugify(title) {
  const folded = String(title ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (folded.length === 0) return "track";
  if (folded.length <= 64) return folded;
  const cut = folded.slice(0, 64);
  const boundary = cut.lastIndexOf("-");
  const trimmed = boundary > 16 ? cut.slice(0, boundary) : cut;
  return trimmed.replace(/-+$/g, "") || "track";
}

/**
 * The slug a name is given when another entry already holds it.
 *
 * `-2`, `-3`, ... rather than a hash, because the person reading the directory
 * is the person who imported both files and a readable duplicate is more use
 * than a unique one.
 *
 * @param {string} slug
 * @param {Set<string>} taken
 */
export function uniqueSlug(slug, taken) {
  if (!taken.has(slug)) return slug;
  for (let suffix = 2; suffix < 1000; suffix += 1) {
    const candidate = `${slug}-${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${slug}-${Date.now()}`;
}

/**
 * Reads whatever was on disk into a manifest shape, tolerating an absent or
 * broken file. A manifest that cannot be parsed becomes an empty one rather
 * than an exception: the alternative is an import that refuses to run because
 * of a stray comma in a file the user hand-edited.
 *
 * @param {unknown} payload
 * @returns {{ tracks: { file: string, title: string, durationSeconds: number }[] }}
 */
export function normalizeManifestFile(payload) {
  const rows = payload
    && typeof payload === "object"
    && Array.isArray(payload.tracks)
    ? payload.tracks
    : [];
  const tracks = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    if (typeof row.file !== "string" || row.file.length === 0) continue;
    const duration = Number(row.durationSeconds);
    tracks.push({
      file: row.file,
      title: typeof row.title === "string" && row.title.length > 0
        ? row.title
        : row.file.replace(/\.[a-z0-9]+$/i, ""),
      durationSeconds: Number.isFinite(duration) && duration > 0
        ? Math.round(duration * 100) / 100
        : 0,
    });
  }
  return { tracks };
}

/**
 * Adds a track, or replaces the entry that already has that file name.
 *
 * Returns a NEW manifest rather than mutating the argument, so a caller that
 * fails to write the file has not already changed its own copy. Re-importing
 * the same URL therefore updates the title and duration in place instead of
 * growing a second row that points at the same file.
 *
 * @param {{ tracks: { file: string, title: string, durationSeconds: number }[] }} manifest
 * @param {{ file: string, title: string, durationSeconds: number }} entry
 */
export function upsertTrack(manifest, entry) {
  const tracks = normalizeManifestFile(manifest).tracks;
  const row = {
    file: entry.file,
    title: entry.title,
    durationSeconds: Math.round(Number(entry.durationSeconds) * 100) / 100,
  };
  const index = tracks.findIndex((track) => track.file === row.file);
  if (index >= 0) tracks[index] = row;
  else tracks.push(row);
  return { tracks };
}

/**
 * Drops the entry whose slug (file name without extension) matches.
 *
 * @param {{ tracks: { file: string, title: string, durationSeconds: number }[] }} manifest
 * @param {string} slug
 * @returns {{ manifest: { tracks: object[] }, removed: { file: string }[] }}
 */
export function removeTrack(manifest, slug) {
  const tracks = normalizeManifestFile(manifest).tracks;
  const removed = tracks.filter((track) => trackSlug(track.file) === slug);
  return {
    manifest: { tracks: tracks.filter((track) => trackSlug(track.file) !== slug) },
    removed,
  };
}

/** @param {string} file */
export function trackSlug(file) {
  return String(file ?? "").replace(/\.[a-z0-9]+$/i, "");
}

/** The manifest as it is written to disk: two-space JSON with a trailing newline. */
export function serializeManifest(manifest) {
  return `${JSON.stringify(normalizeManifestFile(manifest), null, 2)}\n`;
}
