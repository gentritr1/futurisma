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
// The JavaScript ceiling, re-baselined four times on 2026-09-03 from 224.2 KiB
// gzip. Every rationale is kept, because each one names what its bytes bought
// and a later phase deciding whether to spend more needs all of them:
//
//   P20.1 directional shadow mapping  +1.1 KiB - src/game/shadows.ts: the
//     shadow settings, the texel-snapping maths and the shadow-receiving
//     stand-in material for Bitterpan's unlit deck overlay. An earlier
//     arrangement of the same code cost +2.0 KiB because seven lazy modules
//     imported it and Rollup promoted it to a shared chunk; the import surface
//     was cut to three call sites to buy that back.
//   P20.6 pan-floor macro field  +0.8 KiB - the vertex colour generator and its
//     shader injection, measured at 226.1 KiB on a tree with P20.3/P20.4/P20.7.
//   P20.5 sky decoupled from fog  +2.2 KiB - src/game/sky-profile.js (two
//     authored sky tables and the cloud profiles), src/game/speed-line-profile.js
//     and the rewritten dome fragment shader. GLSL is string content that
//     survives minification, so the shader is the expensive half; its
//     explanatory comments were moved OUT of the template literal into
//     TypeScript above it, which bought back 1.2 KiB of the 3.4 KiB the first
//     arrangement cost. What was NOT done, and why the ceiling had to move
//     instead: the Bitterpan sky is authored in BITTERPAN_PRODUCTION.json and
//     the Greenwater sector distances in course.ts, and importing either from
//     atmosphere.ts - which is in the initial shell - would have pulled a 12 KiB
//     or a 253 KiB lazy map chunk into first paint. The tables are mirrored in
//     sky-profile.js instead and validate-lighting.mjs fails if a mirror drifts.
//   G1 rivals that race + slipstream  +6.3 KiB - the per-map rival pace model
//     with its boost-reserve, pad and drift economies, the lane constraint
//     solver that keeps the field off the player and off each other,
//     `calculateSlipstream` and its two integrator terms, the HUD chip, and the
//     rival/slipstream telemetry the soaks read. The pace data itself is
//     ~0.6 KiB. Round two added 2.5 KiB of that total: the launch model (a
//     one-off grid fan plus a lateral rate limit over the opening 260 m), the
//     player/rival race-distance origin correction, and the two telemetry
//     channels that found it - the tow's own inputs measured against the
//     world-space separation the same frame drew, and a record of where the
//     field's closest approach actually happened.
//
//   G2 racing contact  +2.7 KiB - src/game/racing-contact.ts (the air cushion's
//     damped lateral integrator, the near-miss economy and the clean-gate
//     chain, plus the contact feedback all three share), `calculateCushion` and
//     `integrateCushionVelocity` in physics.js, `resolveNearMiss` /
//     `resolveCleanGateChain` in race-rules.js, the fleet's cushion resolution
//     and pass detection, one HUD glow, one counter and one audio cue.
//     Measured 232.8 -> 235.5 KiB gzip on the merged tree. There is no data
//     table in it: the whole cost is code, and the largest single piece is the
//     cushion's own envelope plus the fleet-side selection loop that feeds it.
//
// Measured on the merged tree with `npx vite build && node
// scripts/validate-build.mjs`: 235.5 KiB gzip over 10 initial chunks, against
// the 224.2 KiB all four P20 phases started from. The individual figures above
// were each taken on their own branch and do not sum exactly to it - Rollup
// splits differently once several phases share a tree, and this build has 10
// initial chunks where the pre-phase one had 8. The merged number is the real
// one and the one this ceiling is set from. The validator prints it live every
// run. Raise only with a fresh measurement and a note saying what the bytes
// bought.
//
//   A1 audio ambience  +2.0 KiB - measured 236.9 -> 238.9 KiB gzip on the
//     merged tree with `npx vite build && node scripts/validate-build.mjs`.
//     What the bytes bought, and what they deliberately did NOT:
//
//     IN the shell (the part that had to be): `src/game/ambience-cue.ts`, the
//     synchronous cue the race loop publishes every frame (0.24 KiB gzip as its
//     own chunk); the rival distance/Doppler/lag-compensation maths appended to
//     `audio-space.js`, which the 30 Hz control tick calls; and the growth in
//     `audio.ts` and `diagnostics.ts` - the lag-compensated listener and panner
//     placement, the boost/brake/Doppler per rival, and the `audio` diagnostics
//     block the harness asserts against.
//
//     OUT of the shell: `src/game/audio-ambience.ts` and `ambience-beds.js` -
//     the whole bed plan, the wind/air/whoosh graph and about 29 s of baked
//     loop synthesis - are behind a DYNAMIC import taken inside
//     `EngineAudio.start()`, on the await the AudioContext already needed.
//     That chunk is 4.60 KiB gzip and nobody who never presses start pays for
//     it. The first cut of this phase put all of it in the shell and measured
//     242.4 KiB; the split is what got it to 238.9.
//
//     No audio ASSETS were added and none can be: the project ships zero audio
//     files and every sound in it is synthesised at run time from a seeded LCG.
//     The served file list below is unchanged by this phase.
//
//   G4 modes, tiers, sector deltas and the result stats  +3.1 KiB - measured
//     238.9 -> 242.0 KiB gzip on the merged tree.
//
//     IN the shell, and each of these is load-bearing at first paint:
//     `src/game/race-modes-rules.js` and `src/game/race-modes.ts` (the format
//     vocabulary, the lap-count arbitration, the tier pace merge and the
//     delta arithmetic) land in the `query-probes` chunk, which grew 3.71 ->
//     5.14 KiB gzip. They cannot be lazy: `resolveLapCount` and the fleet
//     decision run before the first frame, and `meta-ui.ts` builds the format
//     and field chip rows on the start screen. `save-schema.js` grew by the
//     v3 guards and the v2 -> v3 migration; `ui.ts` by the two delta elements
//     and the result-stats renderer.
//
//     OUT of the shell: every byte of authored tier pace. The rookie and feral
//     cruise/boost-window blocks are ~1.1 KiB raw each and live in
//     `greenwater-rival-pace.json` and `BITTERPAN_PRODUCTION.json`, both of
//     which are already inside the lazily-imported course chunks - so a player
//     pays for the tier tables of the circuit they dispatched and neither of
//     the other map's. The per-tier derivation notes in those files are the
//     same: authored data, not shell.
assert.ok(
  javascriptGzip <= 243 * 1024,
  `JavaScript bundle exceeds 243 KiB gzip (${(javascriptGzip / 1024).toFixed(1)} KiB).`,
);
// Re-baselined 2026-08-28 from a measured 4.35 KiB gzip (the 4 KiB ceiling
// predated the HUD turn-cue and hazard styling) plus headroom for the planned
// minimap and meta-layer UI, and still comfortable at 5.10 KiB with G1's
// SLIPSTREAM chip in. Raise only with a fresh measurement and rationale.
assert.ok(
  stylesheetGzip <= 8 * 1024,
  `Stylesheet exceeds 8 KiB gzip (${(stylesheetGzip / 1024).toFixed(1)} KiB).`,
);
// Shell = HTML + initial JS + CSS. It moves with the JS ceiling above and for
// the same reason. The only shell-specific cost of G1 was its SLIPSTREAM chip,
// 0.75 KiB of stylesheet; G2 adds the contact glow, the clean-gate counter and
// their two HTML nodes, about 0.4 KiB of CSS and 0.2 of HTML, which still
// leaves CSS well under its own 8 KiB ceiling. Measured on the merged tree at
// 245.1 KiB (HTML 3.3 + JS 236.3 + CSS 5.5), against 241.0 before G2. The
// ceiling moves with the JS one it is dominated by; re-measure both together.
// A1 re-measure: 247.6 KiB (HTML 3.3 + JS 238.9 + CSS 5.4). The phase adds no
// HTML and no CSS at all - it is audio - so the whole move is the JS above. The
// ceiling goes 248 -> 251 for coherence rather than for headroom: at the JS
// ceiling of 240 the shell is already ~248.8, so a 248 shell ceiling would fail
// builds the JS ceiling explicitly allows.
// G4 re-measure: 251.0 KiB (HTML 3.4 + JS 242.0 + CSS 5.6). Unlike A1 this
// phase does touch both of the small halves - four HTML nodes (two chip rows,
// the sector-delta span, the live chip and the result-stats list) and the CSS
// for them, together about +0.3 KiB - but the move is still dominated by the
// JS above. The ceiling goes 251 -> 254 on the same coherence argument A1 used:
// at the JS ceiling of 243 the shell is already ~252, so a 251 shell ceiling
// would fail builds the JS ceiling explicitly allows.
assert.ok(
  shellGzip <= 254 * 1024,
  `Initial app shell exceeds 254 KiB gzip (${(shellGzip / 1024).toFixed(1)} KiB).`,
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
