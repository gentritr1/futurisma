import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { readFile } from "node:fs/promises";

const assetsDirectory = new URL("../dist/assets/", import.meta.url);
const html = await readFile(new URL("../dist/index.html", import.meta.url));
const productionHeaders = await readFile(new URL("../dist/_headers", import.meta.url), "utf8");
const htmlSource = html.toString("utf8");
const initialAssetNames = [...htmlSource.matchAll(
  /(?:src|href)="\/assets\/([^"?]+\.(?:js|css))"/g,
)].map((match) => match[1]);
const javascriptNames = initialAssetNames.filter((name) => name.endsWith(".js"));
const stylesheetNames = initialAssetNames.filter((name) => name.endsWith(".css"));
assert.ok(javascriptNames.length > 0, "The production shell must reference JavaScript.");
assert.ok(stylesheetNames.length > 0, "The production shell must reference a stylesheet.");
assert.equal(
  new Set(initialAssetNames).size,
  initialAssetNames.length,
  "The production shell repeats an initial asset reference.",
);

async function measureAssets(names) {
  let rawBytes = 0;
  let gzipBytes = 0;
  for (const name of names) {
    const bytes = await readFile(new URL(name, assetsDirectory));
    rawBytes += bytes.byteLength;
    gzipBytes += gzipSync(bytes).byteLength;
  }
  return { rawBytes, gzipBytes };
}

const javascript = await measureAssets(javascriptNames);
const stylesheet = await measureAssets(stylesheetNames);
const javascriptGzip = javascript.gzipBytes;
const stylesheetGzip = stylesheet.gzipBytes;
const shellGzip = gzipSync(html).byteLength + javascriptGzip + stylesheetGzip;

assert.ok(
  javascript.rawBytes <= 950 * 1024,
  `Initial JavaScript exceeds 950 KiB raw (${(javascript.rawBytes / 1024).toFixed(1)} KiB).`,
);
// Re-baselined 2026-09-03 by P20.1 (directional shadow mapping): 224.2 -> 225.3
// KiB gzip measured on this build, 8 initial chunks in both. The +1.1 KiB is
// src/game/shadows.ts — the shadow settings, the texel-snapping maths and the
// shadow-receiving stand-in material for Bitterpan's unlit deck overlay. An
// earlier arrangement of the same code cost +2.0 KiB because seven lazy modules
// imported it and Rollup promoted it to a shared chunk; the import surface was
// cut to three call sites to buy that back, so this ceiling is 226 rather than
// 227. Raise only with a fresh measurement and rationale.
// Re-baselined 2026-09-03 by the P20.6 merge (pan-floor macro field: vertex
// colour generator + shader injection, measured 226.1 KiB gzip on the merged
// tree with P20.3/P20.4/P20.7 in). Ceiling 228 leaves one small phase of
// headroom; G1 (rival pace + slipstream, +3.8 KiB) re-baselines again when it
// lands.
//
//
// Re-baselined 2026-09-03 by P20.5 (sky decoupled from fog, cloud band, per-map
// speed lines): 225.6 -> 227.8 KiB gzip measured on this build, 8 initial chunks
// in both. The +2.2 KiB is src/game/sky-profile.js (two authored sky tables and
// the cloud profiles), src/game/speed-line-profile.js, and the rewritten dome
// fragment shader — GLSL is string content that survives minification, so it is
// the expensive half. That shader's explanatory comments were moved OUT of the
// template literal into TypeScript above it for exactly this reason, which
// bought back 1.2 KiB of the 3.4 KiB the first arrangement cost.
//
// What was NOT done, and why the ceiling had to move instead: the Bitterpan sky
// is authored in BITTERPAN_PRODUCTION.json and the Greenwater sector distances
// in course.ts, and importing either from atmosphere.ts — which is in the
// initial shell — would have pulled a 12 KiB or a 253 KiB lazy map chunk into
// first paint. The tables are mirrored in sky-profile.js instead and
// validate-lighting.mjs fails if a mirror drifts from its source.
//
// Re-baselined 2026-09-03 at the P20.5 + P20.6 merge: both phases landed on one
// tree (226.1 + 2.2 measured separately), so the ceiling is 230 KiB with the
// merged build's number recorded below by the validator output. G1 (rival pace
// + slipstream, +3.8 KiB) is the next known cost.
// Raise only with a fresh measurement and rationale.
assert.ok(
  javascriptGzip <= 230 * 1024,
  `JavaScript bundle exceeds 230 KiB gzip (${(javascriptGzip / 1024).toFixed(1)} KiB).`,
);
// Re-baselined 2026-08-28 from a measured 4.35 KiB gzip (the 4 KiB ceiling predated
// the HUD turn-cue and hazard styling) plus headroom for the planned minimap and
// meta-layer UI. Raise only with a fresh measurement and rationale.
assert.ok(
  stylesheetGzip <= 8 * 1024,
  `Stylesheet exceeds 8 KiB gzip (${(stylesheetGzip / 1024).toFixed(1)} KiB).`,
);
// Shell = HTML + initial JS + CSS. It moves with the JS ceiling above and for
// the same reason; re-baselined 2026-09-03 by P20.5 from a measured 233.6 ->
// 235.9 KiB gzip, which is the +2.2 KiB of sky tables and dome shader and
// nothing else (HTML and CSS are untouched by this phase).
assert.ok(
  shellGzip <= 237 * 1024,
  `Initial app shell exceeds 237 KiB gzip (${(shellGzip / 1024).toFixed(1)} KiB).`,
);
assert.ok(
  html.includes('rel="preload"')
    && html.includes('href="/assets/totem/models/totem_runtime.glb"')
    && html.includes('as="fetch"')
    && html.includes('crossorigin="anonymous"'),
  "The production shell must overlap the critical TOTEM fetch with module loading.",
);
assert.ok(
  productionHeaders.includes("frame-ancestors 'none'"),
  "The production build must include the hardened response-header policy.",
);

console.log(
  `Build PASS: ${(shellGzip / 1024).toFixed(1)} KiB gzip shell; ${(
    javascript.rawBytes / 1024
  ).toFixed(1)} KiB raw / ${(javascriptGzip / 1024).toFixed(1)} KiB gzip initial JS across ${
    javascriptNames.length
  } file(s).`,
);
