import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import {
  AUDIO_EXTENSIONS,
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
import {
  LONG_TRACK_SECONDS,
  meterDecibels,
  normalizeManifest,
  ORIGINAL_SOUNDTRACK,
  RANDOM_START_MINIMUM_SECONDS,
  RANDOM_START_TAIL_SECONDS,
  resolveMusicMode,
  resolveTestOrder,
  shuffleOrder,
  soundtrackPlaylist,
  trackPath,
  trackStartOffset,
  SOUNDTRACK_METER_FLOOR_DB,
} from "../src/game/soundtrack-plan.js";

/**
 * M1 — the local soundtrack, on the half a Node process can actually attack.
 *
 * Three things are checked here and nothing else pretends to be checked:
 *
 *   1. THE IMPORT SCRIPT'S PURE HALF. Slugging a DJ set title and upserting a
 *      manifest are the two operations in `music-import.mjs` that are easy to
 *      get quietly wrong and impossible to notice — a slug that collapses to
 *      the empty string writes `.mp3`, an upsert that appends instead of
 *      replacing grows a duplicate row on every re-import. Both are pure, so
 *      both are tested here with no network and no ffmpeg.
 *
 *   2. THE PLAYER'S PURE DECISIONS. The start-offset window, the
 *      no-immediate-repeat shuffle and the `?music=` parse. The runtime module
 *      needs an AudioContext and a media element; these do not, which is why
 *      they live in `soundtrack-plan.js` beside it — the same split
 *      `pit-radio-lines.js` and `music-plan.js` already use.
 *
 *   3. THE SECURITY POSTURE THE PHASE MOVED. `media-src` went from `'none'` to
 *      `'self'` so a media element can stream a local mix, and the directory
 *      those mixes land in is gitignored. Both halves are asserted, and the
 *      second one against `git ls-files` rather than against the ignore file:
 *      a rule in `.gitignore` does nothing for a file that was already tracked
 *      when the rule arrived, and THAT is the mistake that would put somebody
 *      else's recordings in a public repository.
 *
 * What this file deliberately does NOT claim: that a track ever plays. Playback
 * needs a browser, and `scripts/visual/soundtrack-probe.mjs` is where that is
 * measured.
 */

const root = new URL("../", import.meta.url);
const repositoryRoot = fileURLToPath(root);

// The one shipped instrumental is original, separate from private imports,
// and measured using the same loudness target as those imports.
const originalReport = JSON.parse(await readFile(
  new URL("public/assets/audio/original/meridian-afterimage.json", root), "utf8",
));
const originalAudio = await readFile(
  new URL("public/assets/audio/original/meridian-afterimage.mp3", root),
);
assert.ok(originalReport.durationSeconds >= 90 && originalReport.durationSeconds <= 120);
assert.ok(Math.abs(originalReport.durationSeconds - ORIGINAL_SOUNDTRACK.durationSeconds) < .01);
assert.ok(originalReport.integratedLufs >= -15 && originalReport.integratedLufs <= -13);
assert.ok(originalReport.truePeakDbtp <= -.8, "The encoded instrumental needs true-peak headroom.");
assert.equal(originalReport.channels, 2);
assert.equal(originalReport.sha256, createHash("sha256").update(originalAudio).digest("hex"));
assert.ok(originalAudio.length > 1_000_000 && originalAudio.length < 3_000_000);
assert.equal(trackPath(ORIGINAL_SOUNDTRACK.file, true),
  "/assets/audio/original/meridian-afterimage.mp3");
assert.deepEqual(soundtrackPlaylist([]), [ORIGINAL_SOUNDTRACK]);
const importedFixture = [{ file: "mix.mp3", title: "Private mix", durationSeconds: 3600 }];
const combinedFixture = soundtrackPlaylist(importedFixture);
assert.deepEqual(combinedFixture[0], { ...importedFixture[0], original: false });
assert.equal(combinedFixture[1], ORIGINAL_SOUNDTRACK);
assert.equal(importedFixture.length, 1, "Building a playlist must not mutate private imports.");
assert.equal(normalizeManifest({ tracks: [{ ...importedFixture[0], original: true }] })[0].original,
  undefined, "The private manifest cannot redirect a recording into shipped assets.");
console.log(`Original soundtrack PASS: ${originalReport.durationSeconds} s, `
  + `${originalReport.integratedLufs} LUFS, ${originalReport.truePeakDbtp} dBTP, `
  + "encoded file hash verified; separate shipped/private paths and fresh-clone playlist.");

// ---------------------------------------------------------------------------
// 1. The import script's pure half.
// ---------------------------------------------------------------------------
assert.equal(slugify("Kool FM 1994 · Jungle Mix"), "kool-fm-1994-jungle-mix");
assert.equal(slugify("Café Del Mar"), "cafe-del-mar");
assert.equal(slugify("  ---  "), "track", "A title of punctuation must not slug to \"\".");
assert.equal(slugify(""), "track");
assert.equal(slugify("東京"), "track", "A non-Latin title must still yield a file name.");
assert.equal(slugify("A/B\\C:D*E?F"), "a-b-c-d-e-f", "Path separators must not survive.");
assert.ok(!slugify("x".repeat(200)).includes("/"));
assert.ok(
  slugify(`${"jungle-".repeat(20)}finale`).length <= 64,
  "A 140-character set title must not become a 140-character file name.",
);
assert.match(slugify("Ratty & Rude Bwoy"), /^[a-z0-9-]+$/);

assert.equal(uniqueSlug("mix", new Set()), "mix");
assert.equal(uniqueSlug("mix", new Set(["mix"])), "mix-2");
assert.equal(uniqueSlug("mix", new Set(["mix", "mix-2"])), "mix-3");

{
  const empty = { tracks: [] };
  const once = upsertTrack(empty, { file: "a.mp3", title: "A", durationSeconds: 3600 });
  assert.equal(once.tracks.length, 1);
  assert.deepEqual(empty.tracks, [], "upsertTrack must not mutate its argument.");
  const twice = upsertTrack(once, { file: "a.mp3", title: "A (remaster)", durationSeconds: 3601 });
  assert.equal(twice.tracks.length, 1, "Re-importing one file must replace, not append.");
  assert.equal(twice.tracks[0].title, "A (remaster)");
  const other = upsertTrack(twice, { file: "b.mp3", title: "B", durationSeconds: 12 });
  assert.equal(other.tracks.length, 2);
  const dropped = removeTrack(other, "a");
  assert.equal(dropped.manifest.tracks.length, 1);
  assert.equal(dropped.removed[0].file, "a.mp3");
  assert.equal(dropped.manifest.tracks[0].file, "b.mp3");
  assert.equal(removeTrack(other, "nope").removed.length, 0);
  assert.equal(trackSlug("kool-fm.mp3"), "kool-fm");
  // The serialized form is what the browser fetches, so it has to survive the
  // round trip through the module the browser actually parses it with.
  const served = normalizeManifest(JSON.parse(serializeManifest(other)));
  assert.equal(served.length, 2);
  assert.equal(served[0].durationSeconds, 3601);
}
{
  // Junk rows are dropped, not thrown on. The manifest is hand-editable.
  const messy = normalizeManifestFile({
    tracks: [null, 4, { title: "no file" }, { file: "ok.mp3" }],
  });
  assert.equal(messy.tracks.length, 1);
  assert.equal(messy.tracks[0].title, "ok", "A missing title falls back to the file name.");
  assert.equal(normalizeManifestFile(undefined).tracks.length, 0);
  assert.equal(normalizeManifestFile({ tracks: "no" }).tracks.length, 0);
}

// ---------------------------------------------------------------------------
// 2. The player's pure decisions.
// ---------------------------------------------------------------------------
assert.equal(resolveMusicMode(null), "auto", "No switch means: play my files if I have any.");
assert.equal(resolveMusicMode("synth"), "synth");
assert.equal(resolveMusicMode("0"), "off");
assert.equal(resolveMusicMode("1"), "auto", "?music=1 must not be a way to force tracks on.");
assert.equal(resolveMusicMode("nonsense"), "auto");

// A manifest row is not allowed to reach out of the served directory.
assert.equal(normalizeManifest({ tracks: [{ file: "../../secret.mp3" }] }).length, 0);
assert.equal(normalizeManifest({ tracks: [{ file: ".env" }] }).length, 0);
assert.equal(normalizeManifest({ tracks: [{ file: "a/b.mp3" }] }).length, 0);
assert.equal(normalizeManifest(null).length, 0);
assert.equal(
  trackPath("kool fm.mp3"),
  "/assets/audio/music/kool%20fm.mp3",
  "A space in a file name must be encoded, not sent raw.",
);

{
  const always = () => 0;
  const nearly = () => 0.999999;
  // Short files start at the top, and the boundary is inclusive on the short side.
  assert.equal(trackStartOffset(12, always), 0);
  assert.equal(trackStartOffset(LONG_TRACK_SECONDS, always), 0);
  assert.equal(trackStartOffset(0, always), 0);
  assert.equal(trackStartOffset(Number.NaN, always), 0);
  // ...and the empty-window case, which is the one that would otherwise seek
  // negative: 301 s is longer than five minutes but has no [30, duration-300].
  assert.equal(trackStartOffset(LONG_TRACK_SECONDS + 1, always), 0);
  assert.equal(trackStartOffset(LONG_TRACK_SECONDS + 30, always), 0);
  // A real 90-minute mix: the window is [30, 5100].
  const long = 90 * 60;
  assert.equal(trackStartOffset(long, always), RANDOM_START_MINIMUM_SECONDS);
  const top = trackStartOffset(long, nearly);
  assert.ok(
    top < long - RANDOM_START_TAIL_SECONDS && top > long - RANDOM_START_TAIL_SECONDS - 1,
    `The top of the window is ${top}; it must approach ${long - RANDOM_START_TAIL_SECONDS}.`,
  );
  for (let index = 0; index < 200; index += 1) {
    const offset = trackStartOffset(long, Math.random);
    assert.ok(
      offset >= RANDOM_START_MINIMUM_SECONDS
        && offset <= long - RANDOM_START_TAIL_SECONDS,
      `Start offset ${offset} is outside [30, ${long - RANDOM_START_TAIL_SECONDS}].`,
    );
  }
}

{
  // The shuffle: a permutation, every time, and never opening on the track that
  // just finished. Run over the sizes where the corrective swap is degenerate
  // (1 and 2) as well as a realistic library.
  for (const count of [1, 2, 3, 7, 40]) {
    for (let trial = 0; trial < 400; trial += 1) {
      const previous = trial % (count + 1) - 1;
      const order = shuffleOrder(count, previous, Math.random);
      assert.equal(order.length, count);
      assert.equal(new Set(order).size, count, "The shuffle dropped or repeated a track.");
      for (const index of order) assert.ok(index >= 0 && index < count);
      if (count > 1) {
        assert.notEqual(
          order[0],
          previous,
          `A ${count}-track shuffle opened on the track that just played.`,
        );
      }
    }
  }
  // The one-track library is the honest exception: it repeats because there is
  // nothing else to play, and asserting otherwise would be asserting a lie.
  assert.deepEqual(shuffleOrder(1, 0, Math.random), [0]);
  assert.deepEqual(shuffleOrder(0, -1, Math.random), []);
}

{
  const tracks = [{ file: "a.mp3" }, { file: "b.mp3" }, { file: "c.mp3" }];
  assert.deepEqual(resolveTestOrder("c.mp3,a.mp3", tracks), [2, 0]);
  assert.deepEqual(resolveTestOrder(" b.mp3 , a.mp3 ", tracks), [1, 0]);
  assert.equal(resolveTestOrder(null, tracks), null);
  assert.equal(resolveTestOrder("", tracks), null);
  assert.equal(
    resolveTestOrder("nothing.mp3", tracks),
    null,
    "An order that names nothing must fall back to the shuffle, not to silence.",
  );
}

{
  // The meter floor is what makes `musicDb < -60` a JSON-expressible acceptance.
  assert.equal(meterDecibels(0), SOUNDTRACK_METER_FLOOR_DB);
  assert.equal(meterDecibels(-1), SOUNDTRACK_METER_FLOOR_DB);
  assert.equal(meterDecibels(1), 0, "Full-scale mean square is 0 dBFS.");
  assert.ok(Math.abs(meterDecibels(0.01) + 20) < 1e-9, "0.01 mean square is -20 dBFS.");
  assert.ok(Number.isFinite(meterDecibels(1e-40)));
}

// ---------------------------------------------------------------------------
// 3. The security posture this phase moved.
// ---------------------------------------------------------------------------
const indexHtml = await readFile(new URL("index.html", root), "utf8");
const productionHeaders = await readFile(new URL("public/_headers", root), "utf8");
for (const [label, source] of [["index.html", indexHtml], ["public/_headers", productionHeaders]]) {
  assert.ok(
    source.includes("media-src 'self'"),
    `${label} must grant media-src 'self' or the soundtrack cannot stream.`,
  );
  assert.ok(
    !source.includes("media-src 'none'"),
    `${label} still pins media-src 'none'.`,
  );
  assert.ok(
    !/media-src [^;"]*\*/.test(source),
    `${label} widens media-src past 'self'; the element is same-origin only.`,
  );
}

const gitignore = await readFile(new URL(".gitignore", root), "utf8");
assert.ok(
  gitignore.includes(`${MUSIC_RELATIVE_DIRECTORY}/*`),
  `.gitignore must ignore ${MUSIC_RELATIVE_DIRECTORY}/* so imported mixes stay local.`,
);

/**
 * The assertion that actually protects the repository.
 *
 * `.gitignore` is advice for UNTRACKED files: a `git add -f`, or a file that was
 * committed before the rule existed, is ignored by the ignore file and stays in
 * history. So the question asked here is the only one that matters — what does
 * git say it is tracking, right now.
 */
const tracked = execFileSync(
  "git",
  ["ls-files", "--", MUSIC_RELATIVE_DIRECTORY],
  { cwd: repositoryRoot, encoding: "utf8" },
)
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => line.length > 0);
const audioPattern = new RegExp(`\\.(?:${AUDIO_EXTENSIONS.join("|")})$`, "i");
const trackedAudio = tracked.filter((file) => audioPattern.test(file));
assert.deepEqual(
  trackedAudio,
  [],
  `${trackedAudio.join(", ")} is tracked by git under ${MUSIC_RELATIVE_DIRECTORY}. `
    + "This repository is public and imported mixes are somebody else's "
    + "recordings; run `git rm --cached` on them.",
);
const trackedManifest = tracked.filter((file) => file.endsWith("tracks.local.json"));
assert.deepEqual(
  trackedManifest,
  [],
  `${MANIFEST_RELATIVE_PATH} is tracked by git. The manifest names local files `
    + "and is per-machine; it must stay untracked.",
);
assert.ok(
  tracked.every((file) => file.endsWith(".gitkeep")),
  `Only .gitkeep may be tracked under ${MUSIC_RELATIVE_DIRECTORY}; found ${
    tracked.join(", ")}.`,
);

console.log(
  `Soundtrack PASS: slug/upsert/manifest pure functions, the start-offset window `
    + `[${RANDOM_START_MINIMUM_SECONDS} s, duration-${RANDOM_START_TAIL_SECONDS} s] `
    + `over ${LONG_TRACK_SECONDS} s, a no-immediate-repeat shuffle across 5 library `
    + `sizes, the ?music= parse and the meter floor; media-src 'self' pinned in `
    + `index.html and public/_headers; ${tracked.length} file(s) tracked under `
    + `${MUSIC_RELATIVE_DIRECTORY} and none of them audio or a manifest.`,
);
