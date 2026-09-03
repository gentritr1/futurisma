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
// Re-baselined twice on 2026-09-03, from 224.2 KiB gzip before either phase:
//
//   P20.1 directional shadow mapping  +1.1 KiB - src/game/shadows.ts, the
//     shadow settings, the texel-snapping maths and the shadow-receiving
//     stand-in material for Bitterpan's unlit deck overlay. An earlier
//     arrangement cost +2.0 KiB because seven lazy modules imported it and
//     Rollup promoted it to a shared chunk; the import surface was cut to
//     three call sites to buy that back.
//   G1 rivals that race + slipstream  +3.8 KiB - the per-map rival pace model
//     with its boost-reserve, pad and drift economies, the lane constraint
//     solver that keeps the field off the player and off each other,
//     `calculateSlipstream` and its two integrator terms, the HUD chip, and
//     the rival/slipstream telemetry the soaks read. The pace data itself is
//     ~0.6 KiB of that.
//
// Measured with `npx vite build && node scripts/validate-build.mjs`; raise only
// with a fresh measurement and a note saying what the bytes bought.
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
// Re-baselined alongside the JavaScript ceiling above, from a measured
// 237.6 KiB gzip (HTML 3.1 + JS 229.4 + CSS 5.1). The stylesheet grew 0.75 KiB
// for G1's SLIPSTREAM chip and still sits well under its own 8 KiB ceiling.
assert.ok(
  shellGzip <= 241 * 1024,
  `Initial app shell exceeds 241 KiB gzip (${(shellGzip / 1024).toFixed(1)} KiB).`,
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
