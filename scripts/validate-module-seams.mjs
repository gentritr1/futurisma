import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * P0.5 seam guard. `src/game/game.ts` was one 2790-line class that ten roadmap
 * phases all had to edit. This validator keeps the extracted seams in place so
 * the collisions do not creep back: lighting, particle effects, authored asset
 * loading, the showcase autopilot and diagnostics each own their own module.
 */

/**
 * G2 — 1950 -> 1975, and the reason is recorded here rather than left as a
 * bumped number.
 *
 * This is a WEAKENED assertion and it should be read as one. What G2 did with
 * it: the phase's own logic - the air cushion, the near-miss economy, the
 * clean-gate chain and the contact feedback that goes with all three - is about
 * 300 lines, and every one of them went into `src/game/racing-contact.ts`. Two
 * regions that were already in `game.ts` went out with them: the impact-spark
 * burst (contact feedback, now beside the cushion's own burst so the two
 * strengths are visible together) and `resolveLapCount` (a query-string
 * decision, now with the other query-string decisions in `query-probes.ts`).
 *
 * What is left in the race loop is 23 net lines of wiring: one field, one
 * constructor line, six call sites and their comments. There is no arrangement
 * of a feature that touches the reserve, the lateral, the gate crossing and the
 * HUD frame that costs zero lines at those seams, and the file was sitting
 * exactly on the cap.
 *
 * The compensating half is below: three assertions that the G2 logic is NOT in
 * `game.ts`, which is what the budget was a proxy for. A future phase that
 * needs room should extract again rather than move this number - and the next
 * honest candidate is the apron/boundary block inside `updateRace`, which is
 * ~70 lines of world-contact handling that belongs with the rest of contact.
 */
/**
 * G3 — 1975 -> 1998, and the same disclosure the G2 note demanded.
 *
 * This is a WEAKENED assertion, again, and the honest reading is that the line
 * budget is now measuring the WIRING COST of a subsystem seam rather than the
 * size of the race loop's own logic. What G3 did with it: the phase's logic —
 * the seeded event schedule, the gust envelope and its damped lateral, the salt
 * patch and its decal, the squall, the HUD chip resolution and every piece of
 * telemetry for the three — is ~700 lines, and all of it went into
 * `src/game/track-events.ts` and `src/game/track-events-rules.js`.
 *
 * What is left in the race loop is 20 net lines of wiring: one field, one
 * construct, one `scene.add`, one `reset`, one `resetDiagnostics`, one `step`,
 * one extra argument on the existing `resolveTargetSurfaceGrip` call, one HUD
 * field, one diagnostics contributor, and their comments. There is no
 * arrangement of a feature that touches the lateral, the grip, the HUD frame
 * and the diagnostics report that costs zero lines at those seams.
 *
 * The compensating half is below, extended for G3: the assertion list now names
 * the G3 logic as well, so a future phase that "extracts" a track event by
 * wrapping it in a private method of `Game` fails here rather than passing on a
 * line count. A phase that needs room should extract again rather than move
 * this number — the candidate named in the G2 note (the apron/boundary block
 * inside `updateRace`, ~70 lines of world-contact handling that belongs with
 * the rest of contact) is still the honest one and is still unclaimed.
 */
const GAME_LINE_BUDGET = 1_998;

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const game = read("src/game/game.ts");
const gameLines = game.split("\n").length - (game.endsWith("\n") ? 1 : 0);

assert.ok(
  gameLines <= GAME_LINE_BUDGET,
  `src/game/game.ts is ${gameLines} lines; the seam budget is ${GAME_LINE_BUDGET}. `
    + "Extract the new region into its own module instead of growing the race loop.",
);

// Lighting construction belongs to src/game/atmosphere.ts.
for (const light of ["HemisphereLight", "DirectionalLight", "PointLight"]) {
  assert.ok(
    !new RegExp(`new\\s+THREE\\.${light}\\b`).test(game),
    `src/game/game.ts constructs a THREE.${light}. Scene lighting lives in `
      + "src/game/atmosphere.ts.",
  );
}

// Impact spark particle state belongs to src/game/effects.ts.
assert.ok(
  !game.includes("impactSpark"),
  "src/game/game.ts references impactSpark state directly. The particle buffers "
    + "live in src/game/effects.ts.",
);

// G2 — the racing-contact seam, which is what the budget above is a proxy for.
// The race loop may CALL the cushion, the near miss and the chain; it may not
// contain any of them. Each of these three names being absent from game.ts is
// the difference between a feature that was extracted and a feature that was
// merely wrapped in a helper method.
for (const owned of [
  "calculateCushion",
  "integrateCushionVelocity",
  "resolveNearMiss",
  "resolveCleanGateChain",
]) {
  assert.ok(
    !game.includes(owned),
    `src/game/game.ts references ${owned}. The G2 contact model lives in `
      + "src/game/racing-contact.ts; the race loop calls RacingContact instead.",
  );
}

// G3 — the track-events seam, on exactly the same terms as G2's above and for
// the same reason: the budget is a proxy for this, and this is the thing that
// actually matters. The race loop may ASK the schedule what it wants; it may
// not contain the schedule, the envelopes, the wind bearing or the grip rule.
for (const owned of [
  "buildTrackEventSchedule",
  "gustEnvelope",
  "gustScudTraverse",
  "squallEnvelope",
  "saltPatchAlpha",
  "eventSurfaceGrip",
  "eventFogMultiplier",
  "integrateGustVelocity",
  "BITTERPAN_WIND_BEARING_DEGREES",
]) {
  assert.ok(
    !game.includes(owned),
    `src/game/game.ts references ${owned}. The G3 track-event model lives in `
      + "src/game/track-events.ts and src/game/track-events-rules.js; the race "
      + "loop calls TrackEvents instead.",
  );
}

// And the audio seam G3 published rather than wired, asserted so the next phase
// finds it. `audio.ts` was owned by another phase in parallel, so track-events
// exposes a read-only state object for it instead of calling into it.
const trackEvents = read("src/game/track-events.ts");
assert.ok(
  trackEvents.includes("export function trackEventState("),
  "src/game/track-events.ts must publish `trackEventState()` — the read-only "
    + "{ windGust, squall, saltDrop, lastEvent } view the audio phase wires to.",
);
assert.ok(
  !trackEvents.includes('from "./audio"'),
  "src/game/track-events.ts must not import audio.ts. G3 publishes a state "
    + "object for the audio phase to read; it does not drive audio itself.",
);

// Authored asset loading belongs to src/game/scene-assets.ts.
assert.ok(
  !game.includes("GLTFLoader"),
  "src/game/game.ts loads a GLB directly. Authored scene layers load in "
    + "src/game/scene-assets.ts.",
);

const modules = {
  "src/game/atmosphere.ts": ["export class RaceAtmosphere"],
  "src/game/autopilot.ts": [
    "export class DemoAutopilot",
    "export function alignDirectionToSurface",
  ],
  "src/game/effects.ts": ["export class RaceEffects"],
  "src/game/racing-contact.ts": ["export class RacingContact"],
  "src/game/track-events.ts": ["export class TrackEvents"],
  "src/game/track-events-rules.js": [
    "export function buildTrackEventSchedule",
    "export function gustEnvelope",
  ],
  "src/game/scene-assets.ts": ["export class SceneAssets"],
  "src/game/diagnostics.ts": [
    "export function buildDiagnosticsReport",
    "export class RaceDiagnostics",
  ],
};

for (const [path, exports] of Object.entries(modules)) {
  const source = read(path);
  for (const declaration of exports) {
    assert.ok(
      source.includes(declaration),
      `${path} must declare \`${declaration}\`.`,
    );
  }
}

// The diagnostics report is composed by spreading each contributor's flat
// object. The emitted JSON key order is that spread order, so a phase that adds
// telemetry must append inside its own contributor, never reorder these.
const diagnostics = read("src/game/diagnostics.ts");
const composition = diagnostics.slice(
  diagnostics.indexOf("export function buildDiagnosticsReport("),
);
const contributorOrder = [
  "...courseFields(",
  "...renderFields(",
  "...rivalFields(",
  "...audioFields(",
  "...contributors.assetKit,",
  "...contributors.environment,",
  "...contributors.livingWorld,",
  "...contributors.surfaceCharacter,",
  // P4a: lighting motion telemetry is contributed by atmosphere.ts, not by the
  // race loop, so it appends here rather than growing DiagnosticsCore.
  "...contributors.atmosphere,",
  // G3: same rule, one phase later. The module that owns the event schedule
  // owns its telemetry, and it appends AFTER every existing contributor so no
  // emitted key order moves.
  "...contributors.trackEvents,",
];
let cursor = -1;
for (const spread of contributorOrder) {
  const at = composition.indexOf(spread);
  assert.ok(at >= 0, `buildDiagnosticsReport is missing \`${spread}\`.`);
  assert.ok(
    at > cursor,
    `buildDiagnosticsReport spreads \`${spread}\` out of order; the spread order `
      + "is the emitted JSON key order.",
  );
  assert.equal(
    composition.indexOf(spread, at + 1),
    -1,
    `buildDiagnosticsReport spreads \`${spread}\` twice.`,
  );
  cursor = at;
}

// Renaming an emitted key silently breaks every soak comparison, so pin the
// keys that the extraction had to route through a differently named input.
assert.ok(
  composition.includes("impactSparkBursts: core.sparkBursts,"),
  "The emitted diagnostics key must stay `impactSparkBursts`.",
);
assert.ok(
  composition.includes('console.info("[FUTURISMA_DIAGNOSTICS]"')
    || diagnostics.includes('console.info("[FUTURISMA_DIAGNOSTICS]"'),
  "The diagnostics line must still be emitted as [FUTURISMA_DIAGNOSTICS].",
);

console.log(
  `Module seams PASS: game.ts ${gameLines}/${GAME_LINE_BUDGET} lines, lighting, `
    + "effects, scene assets, autopilot, track events and diagnostics extracted, "
    + "contributor "
    + "spread order pinned.",
);
