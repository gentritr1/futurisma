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
//   G3 live track events  +3.8 KiB - src/game/track-events.ts and
//     src/game/track-events-rules.js: the seeded per-race schedule for
//     Bitterpan's wind gusts, its conveyor salt drops and Greenwater's rain
//     squall; the gust envelope and its damped lateral integrator
//     (`integrateGustVelocity` in physics.js); the salt patch's decal geometry;
//     the event grip term threaded through `resolveTargetSurfaceGrip`; the
//     re-phased crossing-scud clock and the two other living-world hooks; the
//     HUD chip; and 18 telemetry fields including the schedule digest a soak
//     line has to carry to be argued with.
//
//     THERE IS NO DATA TABLE IN IT AND NO SHADER STRING: the whole cost is
//     code. Measured 236.9 -> 240.7 KiB gzip on the merged tree.
//
//     What was tried to avoid moving the ceiling, and what it was worth.
//     `track-events.ts` is imported statically by game.ts, atmosphere.ts and
//     rivals.ts (all initial) and by living-world.ts (lazy), so Rollup promotes
//     it — and physics.js with it — into a shared initial chunk, the same
//     mechanism that cost P20.1 0.9 KiB. Rerouting living-world's four reads
//     through a leaf signals module on the `time-of-day.ts` idiom, so that the
//     promotion never happens, was built and MEASURED: 240.0 KiB against 240.7.
//     0.7 KiB for a whole extra module and an indirection on every card read is
//     not a trade worth making, so it was reverted and the ceiling moved
//     instead. Recording the number here so the next phase does not re-derive
//     it: on this tree, chunk promotion is worth well under a kilobyte and the
//     code itself is the cost.
//
// Measured on the merged tree with `npx vite build && node
// scripts/validate-build.mjs`: 240.7 KiB gzip over 10 initial chunks, against
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
// Re-baselined 2026-09-03 at the G3 + A1 merge: 242.8 KiB measured on the
// merged tree (A1's lazy ambience chunk split and G3's events landed on one
// build; the per-branch numbers of 238.9 and 240.7 do not sum under Rollup's
// resplit). Ceiling 244; G4 (modes/time attack) is the next known cost.
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
//
//   G3 + G4 merge  re-measured on the merged tree, not summed. G3 set 244 from
//     a measured 242.8 and G4 set 243 from a measured 242.0; neither had seen
//     the other, and Rollup resplits when both land, so measured 246.0 KiB gzip / 255.9 KiB shell on
//     the merged tree, ceilings 247 and 257. Taken with `npx vite build && node
//     scripts/validate-build.mjs` after the merge.
//
//   H1 + H1.2 pose and camera fix  246.6 -> 247.3 KiB gzip, measured on the
//     tree merged with P21, with `npx vite build && node
//     scripts/validate-build.mjs`. Ceiling 247 -> 248 at the time; superseded by H2a's 250 below, which
//     already counts this spend as part of "the corridor and pose work that
//     landed since".
//
//     IN the shell, all of it, and none of it optional: the presentation lift
//     and the two chase-camera guards run every frame of every race, so
//     `presentation.js` (`lateralFromHorizontalOffset`, `hullClearance`,
//     `chaseDistanceCorrection`, `cameraSurfaceClearance`) and their call sites
//     in `game.ts` are first-paint code by definition. The diagnostics fields
//     that pin them are behind `diagnosticsMode` at runtime but their keys are
//     in `diagnostics.ts`, which is already in the shell.
//
//     OUT of the shell: the proof. `scripts/validate-pose.mjs` is 435 lines of
//     invariant and negative fixtures and ships nothing, which is the whole
//     reason the arithmetic went into a leaf module rather than into the race
//     loop where it could not be tested without a browser.
//   H2a  247 -> 250, and this one is NOT a re-baseline for what H2a spent.
//     H2a's own code is `src/game/art-pack.js` — two string constants, a query
//     parse and a memo. MEASURED by building the merged tree twice, once with
//     that module and its one import removed and once with it: 246.8 -> 246.9
//     KiB gzip, i.e. +0.1 KiB, and 256.7 -> 256.9 KiB shell. A phase that costs
//     a tenth of a kilobyte does not move a ceiling.
//
//     The ceiling moves because MAIN is at 246.8 of 247 on its own. The 247 was
//     set at the G3+G4 merge from a measured 246.0 with a kilobyte of headroom,
//     and the corridor and pose work that landed since has eaten it: what is
//     left is 0.2 KiB, which is smaller than the resplit noise this file has
//     already recorded twice (P20.1 saw 0.9 KiB move on import surface alone,
//     G3 saw 0.7 KiB). At that margin the next landing fails on Rollup's chunk
//     boundaries rather than on anything its author wrote, and the honest
//     failure mode of a ceiling is "you spent too much", not "you were
//     unlucky". 250 restores roughly the 1 KiB of working room the 247 was
//     chosen to have, and H1 round 2 and P21 round 3 are both in flight.
//
//     What was NOT done: nothing was trimmed to avoid the move, because there
//     was nothing to trim — the phase's whole shell cost is 0.1 KiB and the
//     three sheets it prepared but rejected were TEXTURE bytes, which this
//     ceiling does not weigh (see the art-pack block below). Raising a ceiling
//     to cover someone else's spend is worth naming as exactly that.
assert.ok(
  javascriptGzip <= 250 * 1024,
  `JavaScript bundle exceeds 250 KiB gzip (${(javascriptGzip / 1024).toFixed(1)} KiB).`,
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
//
// G3's own shell cost is one HUD chip - about 0.3 KiB of CSS reusing the
// slipstream chip's rules and 0.2 KiB of HTML - on top of the +3.8 KiB of JS
// itself. Re-measured on the merged tree at 249.7 KiB (HTML 3.7 + JS 240.7 +
// CSS 5.4), so the ceiling goes to 253 with the same headroom the 248 one had.
// G4 re-measure: 251.0 KiB (HTML 3.4 + JS 242.0 + CSS 5.6). Unlike A1 this
// phase does touch both of the small halves - four HTML nodes (two chip rows,
// the sector-delta span, the live chip and the result-stats list) and the CSS
// for them, together about +0.3 KiB - but the move is still dominated by the
// JS above. The ceiling goes 251 -> 254 on the same coherence argument A1 used:
// at the JS ceiling of 243 the shell is already ~252, so a 251 shell ceiling
// would fail builds the JS ceiling explicitly allows.
// G3 + G4 merge: re-measured, for the same reason the JS ceiling above was.
// H1 + H1.2: 257.3 KiB (HTML 3.4 + JS 247.3 + CSS 5.6), measured on the tree
// merged with P21. The phase adds no HTML and no CSS - it is the race loop's
// pose and camera - so the whole move is the JS above, which went 246.6 ->
// 247.3 for its own documented reasons. The ceiling goes 257 -> 258, the same
// +1 the JS ceiling took, on the coherence argument A1 and G4 both used: at a
// JS ceiling of 248 the shell is already ~258, so a 257 shell ceiling would
// fail builds the JS ceiling explicitly allows.
assert.ok(
  shellGzip <= 258 * 1024,
  `Initial app shell exceeds 258 KiB gzip (${(shellGzip / 1024).toFixed(1)} KiB).`,
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

// ---------------------------------------------------------------------------
// H2a. The generated horizon sheet, on the served side of the build.
//
// It costs the SHELL 0.1 KiB gzip (see the ceiling note above). What it costs
// is SERVED TEXTURE BYTES, a different axis from the one the ceilings above
// police, so it is weighed separately rather than folded into a number that
// would then mean two things:
//
//   futurisma_horizon_hf_1024.png   197,939 raw   (gzip is not the axis: PNG is
//                                                  already deflate, and the
//                                                  _headers policy does not
//                                                  re-compress images)
//
// against a 2.5 MB allowance for the phase. The P18 sheet stays served as the
// `?art=base` way back, so this is a full addition and not a delta. Three other
// candidates — a pan crust tile, a facade sheet and a brine tile, 1,535,343
// bytes together — were prepared, wired, shot and REJECTED on the crops; they
// are emitted into the gitignored `shots/higgsfield/` instead of served.
//
// This block asserts the bytes reach `dist/` at all. The hash lives in
// validate-art-pass.mjs (which also pins that every base rect still lands
// inside the alternate, and that art-pack.js actually defaults to it) and in
// validate-assets.mjs; the pixel properties — P20.8 row orientation and the
// P18.1 bottom anchor — live in validate-living-world.mjs. What is checked
// here, and only here, is that Vite actually copied it out of public/: a
// texture that validates in the source tree and 404s in production is the
// failure this file exists to catch, and it is the DEFAULT sheet now, so that
// 404 would be every player's horizon.
// ---------------------------------------------------------------------------
const artPackServed = {
  "greenwater/textures/futurisma_horizon_hf_1024.png": 197939,
};
let artPackServedBytes = 0;
for (const [name, expected] of Object.entries(artPackServed)) {
  const bytes = await readFile(new URL(name, assetsDirectory));
  assert.equal(
    bytes.byteLength,
    expected,
    `dist/assets/${name} is ${bytes.byteLength} bytes, not the ${expected} the `
      + "art pack pins. The build copied a different file than the one the "
      + "validators hashed.",
  );
  artPackServedBytes += bytes.byteLength;
}
assert.ok(
  artPackServedBytes <= 2.5 * 1000 * 1000,
  `The H2a art pack serves ${(artPackServedBytes / 1024).toFixed(1)} KiB, over `
    + "its 2.5 MB allowance.",
);
// The P18 sheet has to survive too: it is `?art=base`, and a comparison that
// needs a checkout to reproduce stops being reproduced.
assert.ok(
  (await readFile(new URL(
    "greenwater/textures/futurisma_horizon_1024.png", assetsDirectory,
  ))).byteLength === 49017,
  "The P18 horizon sheet is missing or resized in dist/. It is the `?art=base` "
    + "way back to the sheet the generated one replaced.",
);

console.log(
  `Art pack: ${(artPackServedBytes / 1024).toFixed(1)} KiB of served texture — `
    + "the generated horizon sheet, now the default, with ?art=base kept.",
);
console.log(
  `Build PASS: ${(shellGzip / 1024).toFixed(1)} KiB gzip shell; ${(
    javascript.rawBytes / 1024
  ).toFixed(1)} KiB raw / ${(javascriptGzip / 1024).toFixed(1)} KiB gzip initial JS across ${
    javascriptNames.length
  } file(s).`,
);
