import assert from "node:assert/strict";
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
  "media-src 'none'",
  "worker-src 'none'",
]) {
  assert.ok(csp.includes(directive), `CSP is missing: ${directive}.`);
}
assert.ok(!csp.includes("'unsafe-inline'"), "CSP must not allow inline code or styles.");
assert.ok(!csp.includes("'unsafe-eval'"), "CSP must not allow evaluated code.");
assert.ok(!csp.includes("ws://"), "CSP must not grant cleartext WebSocket exceptions.");
assert.match(indexHtml, /<meta name="referrer" content="no-referrer"/);

for (const policy of [
  "frame-ancestors 'none'",
  "Cross-Origin-Opener-Policy: same-origin",
  "Cross-Origin-Resource-Policy: same-origin",
  "Permissions-Policy:",
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
  `Security PASS: strict CSP/headers, pinned packages, no unsafe DOM/code/network `
    + `sinks; browser storage confined to ${STORAGE_OWNER} under the `
    + `"${STORAGE_KEY_PREFIX}" prefix with a versioned, identity-free payload `
    + `(${scanned.length} source files scanned, 5 negative fixtures rejected).`,
);
