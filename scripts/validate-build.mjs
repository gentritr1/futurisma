import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { readFile, readdir } from "node:fs/promises";

const assetsDirectory = new URL("../dist/assets/", import.meta.url);
const assetNames = await readdir(assetsDirectory);
const javascriptName = assetNames.find((name) => name.endsWith(".js"));
const stylesheetName = assetNames.find((name) => name.endsWith(".css"));
assert.ok(javascriptName, "The production build must contain a JavaScript bundle.");
assert.ok(stylesheetName, "The production build must contain a stylesheet bundle.");

const javascript = await readFile(new URL(javascriptName, assetsDirectory));
const stylesheet = await readFile(new URL(stylesheetName, assetsDirectory));
const html = await readFile(new URL("../dist/index.html", import.meta.url));
const productionHeaders = await readFile(new URL("../dist/_headers", import.meta.url), "utf8");
const javascriptGzip = gzipSync(javascript).byteLength;
const stylesheetGzip = gzipSync(stylesheet).byteLength;
const shellGzip = gzipSync(html).byteLength + javascriptGzip + stylesheetGzip;

assert.ok(
  javascriptGzip <= 225 * 1024,
  `JavaScript bundle exceeds 225 KiB gzip (${(javascriptGzip / 1024).toFixed(1)} KiB).`,
);
assert.ok(
  stylesheetGzip <= 4 * 1024,
  `Stylesheet exceeds 4 KiB gzip (${(stylesheetGzip / 1024).toFixed(1)} KiB).`,
);
assert.ok(
  shellGzip <= 235 * 1024,
  `Initial app shell exceeds 235 KiB gzip (${(shellGzip / 1024).toFixed(1)} KiB).`,
);
assert.ok(
  productionHeaders.includes("frame-ancestors 'none'"),
  "The production build must include the hardened response-header policy.",
);

console.log(
  `Build PASS: ${(shellGzip / 1024).toFixed(1)} KiB gzip shell (${(javascriptGzip / 1024).toFixed(1)} KiB JS).`,
);
