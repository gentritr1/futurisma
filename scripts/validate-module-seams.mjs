import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * P0.5 seam guard. `src/game/game.ts` was one 2790-line class that ten roadmap
 * phases all had to edit. This validator keeps the extracted seams in place so
 * the collisions do not creep back: lighting, particle effects, authored asset
 * loading, the showcase autopilot and diagnostics each own their own module.
 */

const GAME_LINE_BUDGET = 1_950;

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
