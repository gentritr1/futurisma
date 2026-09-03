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
 * G4 — 1975 -> 1992, and like G2's note above this is a WEAKENED assertion that
 * should be read as one.
 *
 * What G4 did with it. The phase adds three race formats, three rival tiers,
 * per-gate deltas against a stored best lap, a live delta chip and a result
 * screen with six statistics. All of the deciding is in two new modules:
 * `src/game/race-modes-rules.js` (~300 lines, pure, runs under Node) and
 * `src/game/race-modes.ts` (~230 lines, the DOM/save/course adapter). The
 * authored tier pace lives in the two maps' own JSON.
 *
 * What is left in the race loop is 17 net lines, and every one of them is a
 * call or a comment: one import, one `attach`, one `reset`, one `closeLap`, one
 * `crossGate`, one `updateLiveDelta`, the `recordFinishedRace` argument list,
 * and the branch that lets `initialize` accept a fleet that was never spawned.
 * Three regions that were ALREADY in `game.ts` got smaller rather than larger
 * on the way: `resolveLapCount` now arbitrates the format inside
 * `query-probes.ts`, the live delta's arithmetic moved into `RaceModes` so the
 * call site carries none, and `RivalFleet.create` answers the "does this format
 * have a field" question itself instead of the race loop wrapping it.
 *
 * WHY NOT EXTRACT INSTEAD. G2's note nominates the apron/boundary block inside
 * `updateRace` as the next candidate, and that is still the right one — but it
 * is ~70 lines of world-contact code that reads and writes the simulation's
 * lateral, speed and grip inside the fixed step. Moving it in the same phase
 * that changes the save schema and the rival pace would put a determinism-
 * critical refactor behind two other risky changes, and the phase's own
 * acceptance is that `race` comes back bit-identical. That extraction wants a
 * phase where it is the only thing happening.
 *
 * The compensating half is below: five assertions that the G4 logic is NOT in
 * `game.ts`, which is what the budget is a proxy for.
 */
const GAME_LINE_BUDGET = 1_992;

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

// G4 — the race-modes seam, which is what the budget bump above is a proxy for.
// The race loop may CALL the format; it may not contain any of its decisions.
// Each of these names being absent from game.ts is the difference between a
// feature that was extracted and one that was merely given a helper method.
for (const owned of [
  "sectorDeltaMs",
  "liveDeltaMs",
  "formatDeltaSeconds",
  "applyPaceTier",
  "bestRecordKey",
]) {
  assert.ok(
    !game.includes(owned),
    `src/game/game.ts references ${owned}. The G4 format model lives in `
      + "src/game/race-modes-rules.js; the race loop calls raceModes instead.",
  );
}

// The race loop must not learn the vocabulary either: a `mode === "sprint"` in
// game.ts is the same failure as inlining the arithmetic, one branch at a time.
for (const token of ['"sprint"', '"timeattack"', '"feral"', '"rookie"']) {
  assert.ok(
    !game.includes(token),
    `src/game/game.ts names the race format ${token} directly. Formats are `
      + "resolved in race-modes.ts; the race loop asks it questions.",
  );
}

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
  "src/game/race-modes.ts": ["export const raceModes"],
  "src/game/race-modes-rules.js": [
    "export function resolveModeLapCount",
    "export function applyPaceTier",
    "export function liveDeltaMs",
    "export function reverseGridOrder",
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
    + "effects, scene assets, autopilot and diagnostics extracted, contributor "
    + "spread order pinned.",
);
