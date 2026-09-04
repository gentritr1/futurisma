import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const indexHtml = await readFile(new URL("index.html", root), "utf8");
const productionHeaders = await readFile(new URL("public/_headers", root), "utf8");
const packageJson = JSON.parse(await readFile(new URL("package.json", root), "utf8"));

const csp = indexHtml.match(
  /http-equiv="Content-Security-Policy"\s+content="([^"]+)"/,
)?.[1];
assert.ok(csp, "index.html must define a Content Security Policy.");
for (const directive of [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-src 'none'",
  // M1 - `media-src` moved from `'none'` to `'self'` and is pinned at `'self'`
  // here, with the exact-string assertion below closing the obvious way to
  // widen it by accident.
  //
  // WHY IT HAD TO MOVE. The local soundtrack streams a 60-120 minute mix
  // through an `HTMLAudioElement` (`src/game/soundtrack.ts` explains why a
  // `decodeAudioData` of that would be gigabytes of heap). A `fetch()` is
  // governed by `connect-src`, which is why the pit radio needed no CSP change
  // at all; a media element is governed by `media-src`, which is why this one
  // did.
  //
  // WHY `'self'` IS STILL THE WHOLE STORY. The element is only ever pointed at
  // a path from a manifest served by this origin, and `normalizeManifest` in
  // `soundtrack-plan.js` rejects any file field containing a path separator, so
  // there is no code path that names another host. `'self'` means a compromised
  // manifest still cannot exfiltrate by pointing the element off-origin.
  "media-src 'self'",
  "worker-src 'none'",
]) {
  assert.ok(csp.includes(directive), `CSP is missing: ${directive}.`);
}
assert.ok(
  !/media-src [^;]*\*/.test(csp),
  "CSP must not widen media-src past 'self'; the soundtrack is same-origin only.",
);
assert.ok(!csp.includes("'unsafe-inline'"), "CSP must not allow inline code or styles.");
assert.ok(!csp.includes("'unsafe-eval'"), "CSP must not allow evaluated code.");
assert.ok(!csp.includes("ws://"), "CSP must not grant cleartext WebSocket exceptions.");
assert.match(indexHtml, /<meta name="referrer" content="no-referrer"/);

for (const policy of [
  "frame-ancestors 'none'",
  "Cross-Origin-Opener-Policy: same-origin",
  "Cross-Origin-Resource-Policy: same-origin",
  "Permissions-Policy:",
  // M1 - the production headers carry the same `media-src` move as the meta
  // policy above. They are the ones that actually apply on a deployed build, so
  // a policy that only moved in `index.html` would ship a soundtrack that works
  // in the dev server and is blocked in production.
  "media-src 'self'",
  "Referrer-Policy: no-referrer",
  "Strict-Transport-Security: max-age=31536000",
  "X-Content-Type-Options: nosniff",
  "X-Frame-Options: DENY",
]) {
  assert.ok(
    productionHeaders.includes(policy),
    `Production headers are missing: ${policy}.`,
  );
}

// ---------------------------------------------------------------------------
// M1 - the other half of the `media-src 'self'` move, and the half that is not
// about the browser at all.
//
// Loosening a CSP directive buys a capability, and the capability bought here
// is "this origin may serve audio to a media element". The risk that comes with
// it is not an injection - it is a COMMIT. The directory the soundtrack plays
// from now holds 60-120 minute DJ sets somebody else recorded, this repository
// is public, and one `git add -A` at the wrong moment publishes them.
//
// So the posture is asserted at both ends. The ignore rule is checked because
// it is what makes the mistake unlikely; `git ls-files` is checked because it
// is the only thing that makes it detectable. They are genuinely different
// questions: `.gitignore` has no effect on a file that was already tracked when
// the rule landed, or on one added with `git add -f`, and it is exactly those
// two cases that would put the files in history without anyone noticing.
// ---------------------------------------------------------------------------
const MUSIC_DIRECTORY = "public/assets/audio/music";
const MUSIC_AUDIO = /\.(?:mp3|m4a|ogg|wav)$/i;
const gitignore = await readFile(new URL(".gitignore", root), "utf8");
assert.ok(
  gitignore.includes(`${MUSIC_DIRECTORY}/*`),
  `.gitignore must contain "${MUSIC_DIRECTORY}/*". The local soundtrack is not `
    + "shipped content and must never be committed.",
);
const trackedMusic = execFileSync("git", ["ls-files", "--", MUSIC_DIRECTORY], {
  cwd: fileURLToPath(root),
  encoding: "utf8",
}).split("\n").map((line) => line.trim()).filter((line) => line.length > 0);
const trackedAudio = trackedMusic.filter((file) => MUSIC_AUDIO.test(file));
assert.deepEqual(
  trackedAudio,
  [],
  `git is tracking ${trackedAudio.join(", ")}. Audio under ${MUSIC_DIRECTORY} is `
    + "the player's own imported mixes; run `git rm --cached` on them before "
    + "this reaches a public remote.",
);

const exactVersion = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
for (const [name, version] of Object.entries({
  ...packageJson.dependencies,
  ...packageJson.devDependencies,
})) {
  assert.match(version, exactVersion, `${name} must use an exact pinned version.`);
}

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await sourceFiles(filePath));
    else if (/\.(?:ts|js|css)$/.test(entry.name)) files.push(filePath);
  }
  return files;
}

const unsafePatterns = [
  [/\binnerHTML\b/, "innerHTML"],
  [/\bouterHTML\b/, "outerHTML"],
  [/\binsertAdjacentHTML\b/, "insertAdjacentHTML"],
  [/\beval\s*\(/, "eval"],
  [/\bnew\s+Function\b/, "new Function"],
  [/\bdocument\.write\b/, "document.write"],
  [/\blocalStorage\b|\bsessionStorage\b/, "persistent browser storage"],
  [/https?:\/\//, "remote runtime URL"],
];

/**
 * P7 amendment. `localStorage` used to be banned across all of `src/`, which
 * was the right rule while the game had nothing to remember. The meta layer
 * has to keep settings, a chosen livery and best laps across reloads, so the
 * ban narrows to a **single** allowed file rather than dissolving:
 * `src/game/persistence.ts` may touch `localStorage` and nothing else may.
 *
 * Note the CSP is not what enforced this. Neither the `index.html` meta policy
 * nor `public/_headers` has any directive that governs Web Storage — CSP only
 * has fetch, navigation and document directives — so no CSP change is needed
 * or possible here, and this validator is the only thing standing between the
 * game and an unbounded storage surface. Hence the extra assertions below.
 */
const STORAGE_OWNER = "src/game/persistence.ts";
/** Every stored key must sit under this prefix, so the origin stays partitioned. */
const STORAGE_KEY_PREFIX = "futurisma.";
/** Identifier-shaped words that would signal the save file drifting toward PII. */
const IDENTITY_WORDS = /\b(?:email|name|user|id|token)\b/i;

function checkSourceFile(relativePath, source) {
  const storageOwner = relativePath === STORAGE_OWNER;
  for (const [pattern, label] of unsafePatterns) {
    if (storageOwner && label === "persistent browser storage") continue;
    assert.ok(!pattern.test(source), `${relativePath} contains disallowed ${label}.`);
  }
  if (!storageOwner) return;

  // `sessionStorage` stays banned even in the owner: the save file is the only
  // storage surface, and it is deliberately durable rather than per-tab.
  assert.ok(
    !/\bsessionStorage\b/.test(source),
    `${relativePath} may use localStorage, but sessionStorage stays banned.`,
  );
  // `clear()` and `key(n)` reach keys this module never wrote.
  assert.ok(
    !/\blocalStorage\s*\.\s*(?:clear|key)\s*\(/.test(source),
    `${relativePath} must not call localStorage.clear() or localStorage.key().`,
  );

  // Assertion 1 — every key literal is namespaced. String arguments are checked
  // directly; identifier arguments are resolved against this file's own
  // `const X = "..."` declarations, so an unresolvable key is a failure too.
  const constants = new Map(
    [...source.matchAll(/\bconst\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*"([^"]*)"/g)]
      .map((match) => [match[1], match[2]]),
  );
  const calls = [...source.matchAll(
    /\blocalStorage\s*\.\s*(?:getItem|setItem|removeItem)\s*\(\s*("[^"]*"|[A-Za-z_$][\w$]*)/g,
  )];
  assert.ok(calls.length > 0, `${relativePath} must actually use localStorage.`);
  for (const [, argument] of calls) {
    const key = argument.startsWith('"')
      ? argument.slice(1, -1)
      : constants.get(argument);
    assert.ok(
      typeof key === "string",
      `${relativePath} passes an unresolvable storage key \`${argument}\`; `
        + "storage keys must be string literals or file-local string constants.",
    );
    assert.ok(
      key.startsWith(STORAGE_KEY_PREFIX),
      `${relativePath} writes storage key "${key}"; every key must be prefixed `
        + `"${STORAGE_KEY_PREFIX}".`,
    );
  }

  // Assertion 2 — the payload carries an integer schema version, so a future
  // shape change can be detected and discarded rather than half-read.
  const schemaVersion = source.match(/\bSCHEMA_VERSION\s*=\s*(-?\d+)\b/)?.[1];
  assert.ok(
    schemaVersion !== undefined,
    `${relativePath} must declare an integer \`SCHEMA_VERSION\`.`,
  );
  assert.ok(
    Number.isInteger(Number(schemaVersion)) && Number(schemaVersion) >= 1,
    `${relativePath} declares SCHEMA_VERSION ${schemaVersion}; it must be a `
      + "positive integer.",
  );
  assert.ok(
    /\bschemaVersion\b/.test(source),
    `${relativePath} must store a \`schemaVersion\` field.`,
  );

  // Assertion 3 — nothing identity-shaped. The save file is local settings and
  // lap times; the moment a field looks like a person, this fails.
  const identity = source.match(IDENTITY_WORDS);
  assert.ok(
    identity === null,
    `${relativePath} references "${identity?.[0]}". The save file must not carry `
      + "anything identity-shaped (email/name/user/id/token).",
  );
}

const sourceRoot = fileURLToPath(new URL("src", root));
const scanned = [];
for (const filePath of await sourceFiles(sourceRoot)) {
  const relativePath = path
    .join("src", path.relative(sourceRoot, filePath))
    .split(path.sep)
    .join("/");
  scanned.push(relativePath);
  checkSourceFile(relativePath, await readFile(filePath, "utf8"));
}
assert.ok(
  scanned.includes(STORAGE_OWNER),
  `${STORAGE_OWNER} is missing; the storage exemption must name a real file.`,
);

// Negative fixture. The exemption is file-scoped, so prove it: the same check
// that just passed over the real tree must still reject `localStorage` in any
// other file, and must reject an owner that breaks its own invariants.
for (const [label, relativePath, fixture] of [
  [
    "localStorage outside the owner",
    "src/game/ui.ts",
    'const stored = localStorage.getItem("futurisma.settings");',
  ],
  [
    "sessionStorage inside the owner",
    STORAGE_OWNER,
    'const SCHEMA_VERSION = 1;\nsessionStorage.getItem("futurisma.settings");'
      + '\nlocalStorage.getItem("futurisma.settings");\nschemaVersion;',
  ],
  [
    "an un-prefixed storage key",
    STORAGE_OWNER,
    'const SCHEMA_VERSION = 1;\nlocalStorage.setItem("settings", "{}");\nschemaVersion;',
  ],
  [
    "a missing schema version",
    STORAGE_OWNER,
    'localStorage.getItem("futurisma.settings");',
  ],
  [
    "an identity-shaped field",
    STORAGE_OWNER,
    'const SCHEMA_VERSION = 1;\nlocalStorage.getItem("futurisma.settings");'
      + "\nschemaVersion;\nexport const email = 1;",
  ],
]) {
  assert.throws(
    () => checkSourceFile(relativePath, fixture),
    assert.AssertionError,
    `The security validator failed to reject ${label}.`,
  );
}

console.log(
  `Local soundtrack: media-src 'self', ${trackedMusic.length} file(s) tracked under `
    + `${MUSIC_DIRECTORY} and none of them audio.`,
);
console.log(
  `Security PASS: strict CSP/headers, pinned packages, no unsafe DOM/code/network `
    + `sinks; browser storage confined to ${STORAGE_OWNER} under the `
    + `"${STORAGE_KEY_PREFIX}" prefix with a versioned, identity-free payload `
    + `(${scanned.length} source files scanned, 5 negative fixtures rejected).`,
);
