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
for (const filePath of await sourceFiles(fileURLToPath(new URL("src", root)))) {
  const source = await readFile(filePath, "utf8");
  for (const [pattern, label] of unsafePatterns) {
    assert.ok(!pattern.test(source), `${filePath} contains disallowed ${label}.`);
  }
}

console.log("Security PASS: strict CSP/headers, pinned packages, no unsafe DOM/code/storage/network sinks.");
