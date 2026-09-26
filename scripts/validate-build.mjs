import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { readFile, readdir, writeFile, mkdir } from "node:fs/promises";

import { PIT_RADIO_IDS } from "../src/game/pit-radio-lines.js";

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

// Tideline/power-kit pass: 957.96 KiB raw / 260.14 KiB gzip, +8.2/+2.9 KiB
// over the previous integrated build. The allowance is explicitly wider for
// the animated mounted devices, shared power controls and fifth map selection.
// The overall 272 KiB shell ceiling is unchanged. Course/environment/sky data
// and the deterministic ability simulation still load with their circuit.
for (const name of javascriptNames) {
  assert.ok(!/tideline-(course|runtime|world|sky|environment)-|dreamisland-|polarity-simulation-/.test(name), "Circuit-specific presentation/rules must stay lazy.");
}

// HUD pass (2026-09-09): the approved interface bound to the running game.
// Measured on the merged tree, Ascension phase E + HUD, against the phase E
// baseline of 961.6 KiB raw / 262.0 KiB gzip / 272.0 KiB shell:
//   first arrangement  970.5 raw / 265.0 gzip / 276.8 shell  (+8.9 / +3.0 / +4.8)
//   ability-slots lazy 966.9 raw / 263.8 gzip / 275.5 shell  (+5.3 / +1.8 / +3.5)
// What the bytes buy: pause-menu.ts and quit-hold.js (the hold-to-quit that
// survives a Tab-away and a swallowed keyup), interface-scale.js (HUD SCALE and
// MENU TEXT as live settings), the signed ladder gap in rivals.ts, the
// focus-owned Enter/Space rule in input.ts, and the lap pips and ladder rows in
// ui.ts. What was tried: ability-slots.ts is circuit-specific presentation
// (it only ever shows a device circuit's state), so it now loads with the
// runtimes it reads - measured 3.6 KiB raw / 1.2 KiB gzip back. The pause menu
// was NOT split: it must exist before the first pause on every circuit, and a
// null-guarded step() for ~1 KiB is the indirection G3 already judged not
// worth it. Ceilings re-pinned at measured + ~1.5 KiB, as M1 did, so the next
// merge fails on spend rather than on chunk boundaries: 964/262/272 -> 969/266/277.
// Dream Island (Map 07) registration, measured 2026-09-09 with `npx vite build`
// on the merged tree: 970.3 KiB raw / 264.8 KiB gzip JS / 276.7 KiB shell,
// against 968.9 / 264.4 / 276.3 without the map. The whole +1.5 KiB raw lands in
// the entry chunk and is the seventh circuit's registration and nothing else:
// the CourseKind and MapSelection unions, the TRACKS row, TRACK_CODES, the
// DREAMISLAND sky zone / cloud profile / band strength (all three lookups, or
// the atmosphere throws on construction), the main.ts, circuit-runtime and
// scene-assets dispatch arms, the render-rule arm, the intro copy, and rollup's
// own asset-URL bookkeeping for the four new lazy chunks. Everything the map
// actually is - course, runtime, powers, environment, its 150 KiB route.json -
// stays lazy, which the assertion above this one pins by name.
// Only the RAW ceiling moves, 969 -> 972 (measured + 1.7 KiB, the same
// measured-plus-headroom rule the HUD pass used). The two compressed ceilings
// that decide what a visitor downloads are untouched and both still pass with
// 1.2 KiB and 0.3 KiB to spare.
//
// `work/hud-followup` (HUD follow-up, six UI fixes) — re-pinned 2026-09-12 by
// the measured-plus-~1.5-KiB rule M1 set and the 2026-09-09 HUD merge used
// again. Measured on a clean `main` checkout at eafe0b9 and on this branch
// with `validate-build.mjs`'s own arithmetic (initial /assets JS+CSS named by
// dist/index.html, gzipSync per file, shell = gzip(html) + jsGzip + cssGzip):
//
//                     JS raw     JS gzip   shell gzip
//   main  eafe0b9     971.37     265.11      276.994
//   work/hud-followup 972.27     265.42      277.414
//   delta              +0.90      +0.31       +0.420
//
// main had 0.63 KiB of raw headroom and SIX BYTES of shell headroom, so the
// shell ceiling was unmeetable by any change at all — the same "baseline
// sitting exactly on the ceiling" the 2026-09-09 merge hit with Codex's phase
// E tree. New pins: 972 -> 974 raw, 266 -> 267 gzip, 277 -> 279 shell, each
// measured + ~1.5 KiB (973.77 / 266.92 / 278.91 rounded up).
//
// What the bytes bought, all of it in the initial shell because the paddock
// and the HUD clock are first paint and cannot be split behind a lazy import:
// `resolveTimingPresentation` and the `formatRaceTime` it composes (moved out
// of ui.ts so `validate:hud` can assert the four clock cases under Node), the
// `#intro-objective` line and the three fields that keep format, laps and
// field alive across the three directions they arrive from, and the minimap's
// named radii and player-dot ring. The stylesheet moved +0.08 KiB gzip and
// still passes its own 8 KiB ceiling at 7.33.
//
// Garage (`claude/trusting-thompson-am0fst`) — re-pinned by the same
// measured-plus-~1.5-KiB rule, measured with this file's own arithmetic on a
// clean worktree of the parent commit and on the branch:
//
//                     JS raw     JS gzip   shell gzip   initial files
//   parent a6445a4    972.91     265.64      277.633        19
//   garage            977.92     267.80      279.896        20
//   delta              +5.01      +2.16       +2.263        +1
//
// What the bytes bought, and why each has to be first paint: `garage-rules.js`
// (2.9 KiB raw, its own shared chunk) — the frame and part numbers the race
// loop multiplies by from the FIRST fixed step, and `normalizeGarage`, which
// the save file runs at module evaluation; the five handling arguments in
// `physics.js`; the v6 rung and two store methods in `save-schema.js`; the
// `main.ts` wiring that installs the fitted handling, labels the GARAGE button
// with the balance and opens the bay on G; the purse seam in `meta-runtime.ts`;
// the gamepad surface in `input-prompts.ts`; and the chunk table entries for
// the new files. What stayed OUT, measured: the showroom, the purse, the
// contracts, the catalog and the look are ONE lazy chunk (`garage-bay`, 22.4
// KiB raw / 8.7 KiB gzip, plus 1.7 KiB gzip of its own stylesheet) fetched
// after the grid is up. What was tried: three separate dynamic imports cost
// +0.4 KiB of preload glue in the entry chunk, and letting the lazy modules
// import `persistence` / `race-modes` / `map-selection` split those into four
// extra shared chunks (+0.7 KiB gzip); both were undone, the latter by handing
// the bay its dependencies through `GarageHooks` instead.
// New pins: 974 -> 980 raw, 267 -> 270 gzip, 279 -> 282 shell (979.42 /
// 269.30 / 281.40 rounded up). The stylesheet does not move: 7.33 KiB.
//
// Garage frame bodies (same branch): 977.92 -> 981.07 raw, 267.80 -> 268.73
// gzip, 279.90 -> 280.86 shell. What the bytes bought is the mount contract,
// which has to live beside the private state it swaps: `TotemVehicle.loadBody`
// / `mountBody` (hide TOTEM's hull, rebind pivots by name), the kit's
// `anchorTo` (jets, device hardpoints, conduit, shield, live lamps) and the
// race presence's `rebind`. The bodies themselves are lazy GLBs and the
// showroom logic stays in the `garage-bay` chunk. Only the RAW ceiling moves,
// 980 -> 983 (measured + ~1.5 KiB), as the Dream Island registration did: the
// two compressed ceilings that decide what a visitor downloads both still pass.
//
// Garage daily ops and body paint (same branch): 981.3 -> 984.2 raw, measured
// against the previous commit's build: +1.35 KiB in `garage-rules.js` (v7's
// save fields — owned schemes and patterns, the GOLD LEAF flag and the daily
// board, all totalled by `normalizeGarage` at module evaluation — and each
// frame's `name`, so the grid, ladder and briefing name a LANCE at first paint
// rather than flipping from TOTEM when the lazy chunk lands) and +1.55 KiB in
// the entry chunk (`GameUi.setPlayerCraft` / `setFitting`, `main.ts`'s fitting
// state on START, `requestRender`, `MetaUi.showLivery`). Every rule about the
// daily board, the paint shop, the scheme atlases and the day clock is in the
// lazy `garage-bay` chunk. Only the RAW ceiling moves, 983 -> 986 (measured +
// ~1.5 KiB), as the two garage rounds before it did.
assert.ok(
  javascript.rawBytes <= 986 * 1024,
  `Initial JavaScript exceeds 986 KiB raw (${(javascript.rawBytes / 1024).toFixed(1)} KiB).`,
// Merged 2026-09-13 with Phase F ALIVE, whose own note follows; the combined
// tree measures under the 974 pin (see the phase-F merge commit).
// Phase F ALIVE (2026-09-12): 972 -> 973 raw. The island's own bytes are all
// lazy and cost the initial graph 0.13 KiB raw (measured: 971.40 -> 971.53 with
// every phase-F module in the tree and the three shared touches reverted). The
// move is bought by those three touches and nothing else: `data-circuit` and
// its dispose wrapper in circuit-runtime.ts, the live-gap write in
// `updateFieldOrder`, and the `power` row of the shared prompt map — 0.57 KiB
// raw together, measured by building with and without them. 971.53 -> 972.10;
// the ceiling goes to 973, which is measured + 0.9 KiB on the same
// measured-plus-headroom rule the line above it used.
//
// One thing was tried to avoid moving it and DID work, and is recorded because
// it is the cheaper lesson: `dreamisland-props.ts` first built its ball and its
// chrome sphere from `THREE.IcosahedronGeometry`, which had no other consumer
// in the tree, and importing it pulled `PolyhedronGeometry` into the SHARED
// three chunk the shell loads — 0.9 KiB gzip and 2.1 KiB raw, on the shell, for
// a 1.2 m ball. `SphereGeometry(.6, 8, 6)` has the same triangle count, was
// already in the bundle, and gave all of it back.
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
//   M1 local soundtrack  +2.1 KiB - src/game/soundtrack.ts (the media-element
//     player on the music bus, the title chip latch) and soundtrack-plan.js
//     (the `?music=` parse, start-offset window, shuffle), plus the two bus
//     meters and the stem hold in audio.ts and their diagnostics fields.
//     Measured 251.6 KiB on the agent's branch and 252.5 KiB on the SAME commit
//     fast-forwarded onto main (2026-09-04): 0.9 KiB of Rollup resplit noise on
//     an unchanged tree. Ceilings 252/262 -> 254/264 so the next merge fails
//     on spend, not on chunk boundaries. Measured shell 261.9 -> 262.7 KiB.
//
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
//   H2b pit radio  +2.4 KiB - measured 246.8 -> 249.2 KiB gzip on this tree with
//     `npx vite build && node scripts/validate-build.mjs`, the baseline taken by
//     stashing the phase and rebuilding rather than by trusting the 246.0 the
//     G3+G4 merge note above records (that number was measured before P21.2 and
//     H1 landed; this tree is 246.8, and quoting the stale one would have
//     credited H2b with 3.2 KiB it did not spend).
//
//     IN the shell, and all of it has to be: `src/game/pit-radio-lines.js` (the
//     17-line table with its scripts, the priorities, the cooldowns and the pure
//     edge resolvers) and `src/game/pit-radio.ts` (the band-pass bus, the duck,
//     the click envelope and the lazy fetch), plus the growth in `audio.ts` for
//     the ambience bus and seven cue hooks, one line in `ui.ts`, the VOICE chip
//     row in `meta-ui.ts`, `settings.voice` and the v3 -> v4 rung in
//     `save-schema.js`, and `armSerial` / `armGustSign` in `track-events.ts`.
//     The initial chunk count goes 12 -> 13; `pit-radio-lines.js` is a leaf that
//     Rollup splits out on its own.
//
//     OUT of the shell: the 186 028 bytes of audio, which is the whole point of
//     the arrangement. The clips are FETCHED, not imported, from
//     `public/assets/audio/radio/` inside `EngineAudio.start()` — so they are not
//     in the graph at all, they are never touched by anyone who does not press
//     start, and a driver with the VOICE row off never downloads them. Their own
//     ceiling is asserted separately below.
//
//   H2a + H2b merge  re-measured on the merged tree rather than summed, the
//     rule this file has applied at every merge since G3 + G4. H2a raised the
//     ceiling to 250 to restore main's own headroom (its code costs 0.1 KiB);
//     H2b measured 249.2 against a 246.8 baseline it took by stashing itself.
//     Neither had seen the other. MEASURED on the merged tree with `npx vite
//     build && node scripts/validate-build.mjs`: 249.5 KiB gzip JS / 259.5 KiB
//     shell, and 249.7 / 259.7 once H2b's rejected `?deck=hf` probe went in
//     (+0.2 KiB, kept so its crop stays re-takeable). The ceilings go to 252 and 262, which keeps roughly the 2.5 KiB of
//     working room H2a's note argues main needs and that neither branch's own
//     number would have left.
// Four-circuit build, measured at 257.2 KiB gzip JS: the additional shared
// cost buys gravity/power input and audio hooks, a shortcut minimap, two map
// dispatch choices and their HUD. The road data, Blender environments and
// Polarity runtime remain lazy; the ceiling allows 2.8 KiB of resplit headroom.
// 266 -> 267 on `work/hud-followup`; see the measurement table above the raw
// ceiling. This one was NOT failing (265.42 against 266) and moves only so the
// three ceilings keep the same ~1.5 KiB of working margin as each other —
// a gzip ceiling 0.58 KiB above the measurement would be the next phase's
// chunk-boundary failure rather than its spend failure.
// 267 -> 270 for the garage; see the measurement table above the raw ceiling.
assert.ok(
  javascriptGzip <= 270 * 1024,
  `JavaScript bundle exceeds 270 KiB gzip (${(javascriptGzip / 1024).toFixed(1)} KiB).`,
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
// H2b re-measure: 259.2 KiB (HTML 4.4 + JS 249.2 + CSS 5.6), against 256.7 on
// the same tree without the phase. The stylesheet does not move at all — the
// VOICE row reuses the existing `.option--choice` / `.chip-row` rules — and the
// HTML grows by the seven-line row plus nine characters of the options note.
// The ceiling goes 257 -> 262 on the coherence argument A1 and G4 both used: at
// the JS ceiling of 251 the shell is already ~261, so a tighter shell ceiling
// would fail builds the JS ceiling explicitly allows.
// H1 r2 merge 2026-09-03: shell measured 257.3 KiB on that branch (camera guards,
// plaque re-derivation, pose diagnostics); ceiling 258 with the merged measurement.
// H1 r2 + H2b merge: re-measured together rather than either branch's number
// taken, the rule this file has applied at every merge since G3 + G4. H1 r2 set
// 258 from a measured 257.3 and H2b set 262 from a measured 259.2; neither had
// seen the other. MEASURED on the merged tree: 250.3 KiB gzip JS / 260.3 KiB
// shell, so 252 and 262 both stand with about 1.7 KiB of room each — which is
// the working margin H2a's note above argues main needs and is why neither
// number moves again here.
// Phase F ALIVE (2026-09-12): 277.0 -> 277.5 KiB gzip, which is the exact
// allowance DREAM-ISLAND-ALIVE.md §4.5 writes down for this pass ("shell gzip
// may not grow by more than 0.5 KiB (the attribute and its one-line setter)").
// Measured 277.06 with every phase-F island module present and the three shared
// touches reverted, and 277.27 with them: +0.21 KiB spent of the 0.5 allowed,
// and 0.23 KiB of the allowance left unspent. The island's HUD skin, its fonts
// fallback, its road paint, props, capsules and the whole §4.6 power slot are
// on the far side of the dynamic import and appear in the island chunk ceiling
// below instead.
// (Phase F asked for 277.5; the HUD follow-up re-pinned the shell at 279 on the
// same day, and the combined tree sits under both.)
// 277 -> 279 on `work/hud-followup`, measured 277.414 + ~1.5 KiB. See the
// table above the raw ceiling: main sat at 276.994 against 277, six bytes of
// headroom, which is what made this the ceiling that had to move.
// 279 -> 282 for the garage (measured 279.896); see the table above the raw
// ceiling. The garage's daily-ops round left it at 281.952 (49 B of headroom);
// the polish round after it bought the headroom back without moving the
// ceiling, by moving each circuit's paddock flavour line and briefing out of
// ui.ts onto its lazy course class: 281.287 KiB, briefings byte-identical on
// all seven circuits (pinned in validate-module-seams.mjs).
assert.ok(
  shellGzip <= 282 * 1024,
  `Initial app shell exceeds 282 KiB gzip (${(shellGzip / 1024).toFixed(3)} KiB; ${shellGzip} B).`,
);

// ---------------------------------------------------------------------------
// The Dream Island lazy chunk, pinned for the first time (Phase F ALIVE).
//
// Everything the island is - course, runtime, powers, painted environment,
// water, road paint, props, capsules, the HUD controller, `style-dreamisland.css`
// and the 150 KiB route.json - reaches the player only through the dynamic
// import in `circuit-runtime.ts`. The assertion near the top of this file
// already pins that none of it is INITIAL. This one pins how big it is, so the
// next phase spends against a number instead of against nothing.
//
// MEASURED 102,295 B gzip over 6 files after round 2 (course 6,358; materials
// 50,042 - which is where rollup put route.json this build; painted environment
// 28,424; runtime 9,964; the skin's stylesheet 7,114; powers config 393). It was
// 95,627 B before round 2; the 6.7 KiB is the glass backings, the @font-face
// rules and the bubble in the stylesheet, and the doubled prop placements.
// CEILING = ceil(measured * 1.10) = 112,525 B, the same measured-plus-ten-percent
// rule DREAM-ISLAND-ALIVE.md §6 asks for. The file names carry content hashes
// and rollup moves modules between these chunks from build to build, so the
// ceiling is on the TOTAL of everything named `dreamisland-*`, never on one of
// them: a build that shifted route.json from the materials chunk to the course
// chunk would otherwise read as a catastrophe and a saving at once.
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// The island's two self-hosted faces (Phase F round 2, item 2).
//
// Michroma and Share Tech Mono, SIL OFL 1.1, latin subset only, served from
// `public/` and referenced by `@font-face` in `src/game/style-dreamisland.css`
// and nowhere else. They are a different axis from the gzip ceilings above:
// woff2 is already Brotli inside, so what matters is the bytes that reach a
// visitor who drives this one circuit.
//
// MEASURED 19,028 B over two files (Michroma 11,620; Share Tech Mono 7,408).
// CEILING = ceil(measured * 1.10) = 20,931 B. The latin-ext subsets were
// deliberately not taken - the HUD writes upper-case ASCII - and taking them
// would roughly double this, so the ceiling is also the thing that would catch
// somebody quietly adding them.
// ---------------------------------------------------------------------------
const fontDirectory = new URL("dreamisland/fonts/", assetsDirectory);
const fontNames = (await readdir(fontDirectory)).filter((name) => name.endsWith(".woff2")).sort();
assert.deepEqual(
  fontNames,
  ["michroma-latin-v21.woff2", "share-tech-mono-latin-v16.woff2"],
  "The island's self-hosted faces are not the two the stylesheet names.",
);
let fontBytes = 0;
for (const name of fontNames) {
  const bytes = await readFile(new URL(name, fontDirectory));
  // A woff2 that is not a woff2 fails silently in the browser and the HUD
  // falls back to the shell's faces without anybody noticing.
  assert.equal(
    bytes.subarray(0, 4).toString("latin1"),
    "wOF2",
    `dist/assets/dreamisland/fonts/${name} does not begin with a wOF2 signature.`,
  );
  fontBytes += bytes.byteLength;
}
const FONT_BYTES_MEASURED = 19_028;
const FONT_BYTES_CEILING = 20_931;
assert.ok(
  fontBytes <= FONT_BYTES_CEILING,
  `The island's self-hosted faces serve ${fontBytes} B against a ${FONT_BYTES_CEILING} B `
    + `ceiling (measured ${FONT_BYTES_MEASURED} B + 10%).`,
);
assert.ok(
  !htmlSource.includes("dreamisland/fonts/"),
  "The production shell must not reference the island's faces.",
);
console.log(
  `Dream Island faces: ${fontBytes} B over ${fontNames.length} woff2 against a `
    + `${FONT_BYTES_CEILING} B ceiling (measured ${FONT_BYTES_MEASURED} B + 10%); `
    + "referenced only by the island's own stylesheet.",
);

// `style-dreamisland-*.css` is in this set as well as `dreamisland-*`: round 2
// moved the skin from a Vite CSS import to a `new URL(..., import.meta.url)`
// asset, which Vite emits under the FILE's name rather than the chunk's, and a
// pattern that only matched `dreamisland-` silently stopped counting 2.4 KiB of
// the island's own lazy bytes the moment that landed.
const islandChunkNames = (await readdir(assetsDirectory))
  .filter((name) => /^(?:dreamisland-|style-dreamisland-)/.test(name) && /\.(?:js|css)$/.test(name))
  .sort();
assert.ok(
  islandChunkNames.length > 0,
  "No dreamisland-* chunk was emitted; the island's lazy chunk has vanished.",
);
const islandChunks = await measureAssets(islandChunkNames);
const ISLAND_CHUNK_MEASURED = 102_295;
const ISLAND_CHUNK_CEILING = 112_525;
assert.ok(
  islandChunks.gzipBytes <= ISLAND_CHUNK_CEILING,
  `The Dream Island chunk is ${islandChunks.gzipBytes} B gzip against a ${ISLAND_CHUNK_CEILING} B `
    + `ceiling (measured ${ISLAND_CHUNK_MEASURED} B + 10%). Re-measure and record what bought the bytes.`,
);
console.log(
  `Dream Island chunk: ${(islandChunks.gzipBytes / 1024).toFixed(2)} KiB gzip over `
    + `${islandChunkNames.length} lazy files, against a ${(ISLAND_CHUNK_CEILING / 1024).toFixed(2)} KiB `
    + `ceiling (measured ${(ISLAND_CHUNK_MEASURED / 1024).toFixed(2)} KiB + 10%).`,
);

// ---------------------------------------------------------------------------
// H2b — the served audio, which is the first of it this project has ever had.
//
// Not part of the shell and deliberately measured apart from it: these bytes
// are fetched from inside `EngineAudio.start()`, so nobody who does not press
// start pays for them and nobody who turns the VOICE row off pays for them at
// all. What they still are is bandwidth on every first race, so they get a
// ceiling of their own rather than living unbudgeted because they missed the
// one above.
//
// Measured 186 028 B (181.7 KiB) across 17 files by
// `node scripts/prepare-pit-radio.mjs` at libmp3lame 48 kbps mono / 24 kHz —
// 29.34 s of speech. The 192 KiB ceiling is that plus room to re-record a line
// or two; a second voice would not fit, which is the point. 48 kbps rather than
// 64 (which measured 240.9 KiB) because the runtime chain low-passes at 3.4 kHz
// before the driver hears any of it, so the extra 59 KiB would buy bits in a
// band the pit radio throws away.
// ---------------------------------------------------------------------------
const radioDirectory = new URL("../dist/assets/audio/radio/", import.meta.url);
const radioNames = (await readdir(radioDirectory)).sort();
assert.deepEqual(
  radioNames.map((name) => name.replace(/\.mp3$/, "")),
  [...PIT_RADIO_IDS].sort(),
  "The served pit-radio files and the shipped line table disagree. Every id the "
    + "queue can hold must have a file, and every served file must be reachable.",
);
let radioBytes = 0;
for (const name of radioNames) {
  const bytes = await readFile(new URL(name, radioDirectory));
  assert.ok(
    bytes.length > 2_000,
    `dist/assets/audio/radio/${name} is ${bytes.length} B; that is not a spoken line.`,
  );
  // ID3v2 ("ID3") or a bare MPEG frame sync. A file that is not actually MP3
  // fails `decodeAudioData` silently in the browser and is counted as a dropped
  // line rather than an error, so it has to fail here instead.
  assert.ok(
    bytes.subarray(0, 3).toString("latin1") === "ID3"
      || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0),
    `dist/assets/audio/radio/${name} does not begin with an MP3 frame or an ID3 tag.`,
  );
  radioBytes += bytes.length;
}
assert.ok(
  radioBytes <= 192 * 1024,
  `The served pit radio is ${(radioBytes / 1024).toFixed(1)} KiB; the ceiling is `
    + "192 KiB. Re-run scripts/prepare-pit-radio.mjs and record the measurement.",
);
// POLISH-3: six signature clips, measured by prepare-dreamisland-audio.py
// at the radio bank's 24 kHz / 48 kbps mono format. The two bed references
// remain evidence inputs; their procedural equivalents ship as lazy code.
// 225,912 B measured; ceil(measured * 1.10) = 248,504 B. Independent of radio.
const islandAudioDirectory=new URL('../dist/assets/dreamisland/audio/',import.meta.url);
const islandAudioNames=(await readdir(islandAudioDirectory)).sort();
assert.deepEqual(islandAudioNames,['clock-quarter-chime.mp3','clock-strike-three-tolls.mp3',
  'day-birds.mp3','fish-rise.mp3','tunnel-pass.mp3','waterfall-loop.mp3']);
let islandAudioBytes=0;
for(const name of islandAudioNames)islandAudioBytes+=(await readFile(new URL(name,islandAudioDirectory))).length;
assert.ok(islandAudioBytes<=248504,`Dream Island audio serves ${islandAudioBytes} B against 248504 B.`);
console.log(`Dream Island audio: ${islandAudioBytes} B / 248504 B; ${islandAudioNames.length} clips.`);
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
  `Build PASS: ${(radioBytes / 1024).toFixed(1)} KiB of pit radio across ${
    radioNames.length} served files; ${(shellGzip / 1024).toFixed(1)} KiB gzip shell; ${(
    javascript.rawBytes / 1024
  ).toFixed(1)} KiB raw / ${(javascriptGzip / 1024).toFixed(1)} KiB gzip initial JS across ${
    javascriptNames.length
  } file(s).`,
);

const reportDirectory=process.argv.find(argument=>argument.startsWith('--out='))?.slice(6);
if(reportDirectory){
 await mkdir(reportDirectory,{recursive:true});
 await writeFile(reportDirectory+'/build.json',JSON.stringify({script:'scripts/validate-build.mjs',
  javascriptGzip,shellGzip,stylesheetGzip,htmlGzip:gzipSync(html).byteLength,
  javascriptRaw:javascript.rawBytes,initialChunks:javascriptNames.length,radioBytes,islandAudioBytes,
  ceilings:{javascriptGzip:266*1024,shellGzip:277*1024,dreamIslandAudio:248504},passed:true},null,2)+'\n');
}
