import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  DEFAULT_RACE_MODE,
  DEFAULT_RIVAL_TIER,
  DELTA_DEAD_BAND_MS,
  LIVE_DELTA_INTERVAL_MS,
  RACE_MODES,
  RACE_MODE_DECKS,
  RACE_MODE_LABELS,
  RIVAL_TIERS,
  RIVAL_TIER_DECKS,
  RIVAL_TIER_LABELS,
  SECTOR_DELTA_HOLD_MS,
  SPRINT_LAP_COUNT,
  applyBestLapSplits,
  applyPaceTier,
  bestLapTimeAtDistanceMs,
  bestRecordKey,
  deltaTone,
  formatDeltaSeconds,
  ghostRecordKey,
  liveDeltaMs,
  modeFieldSize,
  modeHasField,
  modeReversesGrid,
  normalizeRaceMode,
  normalizeRivalTier,
  resolveModeLapCount,
  reverseGridOrder,
  sectorDeltaMs,
} from "../src/game/race-modes-rules.js";
import {
  RIVAL_GRID_MINIMUM_SPACING_METERS,
  RIVAL_PROFILES,
  minimumLateralSpacingMeters,
  spreadGridLaterals,
} from "../src/game/rival-race.js";
import { loadCourseModel, loadRivalPace } from "./lib/rival-course-model.mjs";

/**
 * G4 — the race formats, the rival tiers and the sector-delta arithmetic.
 *
 * `src/game/race-modes-rules.js` holds every decision this phase makes and runs
 * under Node on purpose, so all of it can be attacked here with fixtures rather
 * than inferred from a screenshot. What this file proves, in order:
 *
 *   1. mode and tier parsing, including the hostile and absent cases
 *   2. the lap count each format races, and the one place `?laps=` is overruled
 *   3. the sprint's grid reversal, against the REAL grid both circuits author
 *   4. the delta arithmetic, against a fixture best lap
 *   5. time attack's absent field
 *   6. the tier pace merge, against the shipped JSON
 *   7. the HUD contract the elements and the stylesheet have to keep
 *
 * Determinism per tier is proved in `scripts/validate-rivals.mjs`, beside the
 * rest of the field's determinism, rather than here.
 */

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

// ---------------------------------------------------------------------------
// 1. Vocabulary
// ---------------------------------------------------------------------------

assert.deepEqual([...RACE_MODES], ["race", "sprint", "timeattack"]);
assert.deepEqual([...RIVAL_TIERS], ["rookie", "works", "feral"]);
assert.equal(DEFAULT_RACE_MODE, "race", "The default format must stay `race`.");
assert.equal(DEFAULT_RIVAL_TIER, "works", "The default tier must stay `works`.");

for (const mode of RACE_MODES) {
  assert.equal(normalizeRaceMode(mode), mode);
  assert.equal(normalizeRaceMode(mode.toUpperCase()), mode, "Parsing must be case-free.");
}
for (const tier of RIVAL_TIERS) {
  assert.equal(normalizeRivalTier(tier), tier);
  assert.equal(normalizeRivalTier(tier.toUpperCase()), tier);
}
// Anything unrecognised resolves to the default rather than throwing or leaking
// through. `?mode=` is a QA override that always wins, so an unknown value still
// counts as an override and still has to land somewhere legal.
for (const hostile of [
  undefined, null, "", "  ", "championship", 7, {}, [], true, "race ", "__proto__",
]) {
  assert.equal(normalizeRaceMode(hostile), DEFAULT_RACE_MODE, `mode ${String(hostile)}`);
  assert.equal(normalizeRivalTier(hostile), DEFAULT_RIVAL_TIER, `tier ${String(hostile)}`);
}

// Every choice the paddock offers has a label and a deck line, or a chip ships
// blank. Cheap to assert, and the failure is invisible until someone looks.
for (const mode of RACE_MODES) {
  assert.ok(RACE_MODE_LABELS[mode]?.length > 0, `${mode} has no label.`);
  assert.ok(RACE_MODE_DECKS[mode]?.length > 0, `${mode} has no deck line.`);
}
for (const tier of RIVAL_TIERS) {
  assert.ok(RIVAL_TIER_LABELS[tier]?.length > 0, `${tier} has no label.`);
  assert.ok(RIVAL_TIER_DECKS[tier]?.length > 0, `${tier} has no deck line.`);
}

// The record and ghost slot keys, which the save file stores verbatim.
assert.equal(bestRecordKey("race", "works"), "race:works");
assert.equal(bestRecordKey("SPRINT", "FERAL"), "sprint:feral");
assert.equal(bestRecordKey("nonsense", "nonsense"), "race:works");
assert.equal(ghostRecordKey("timeattack"), "timeattack");
assert.equal(ghostRecordKey("nonsense"), "race");
// Tier is deliberately NOT part of the ghost key: a racing line does not change
// because the cars beside it got quicker, and the payload ceiling cannot afford
// nine replays per circuit. See the note on `ghostRecordKey`.
assert.equal(
  new Set(RIVAL_TIERS.map((tier) => ghostRecordKey("race", tier))).size,
  1,
  "The ghost slot became tier-dependent; the save file cannot afford that.",
);

// ---------------------------------------------------------------------------
// 2. Lap counts, and the one place `?laps=` is overruled
// ---------------------------------------------------------------------------

const course = { defaultLapCount: 5, minimumLapCount: 1, maximumLapCount: 20 };

assert.equal(resolveModeLapCount("race", course, Number.NaN), 5);
assert.equal(resolveModeLapCount("timeattack", course, Number.NaN), 5);
assert.equal(resolveModeLapCount("race", course, 3), 3, "`?laps=` must reach `race`.");
assert.equal(
  resolveModeLapCount("timeattack", course, 3),
  3,
  "`?laps=` must reach `timeattack`.",
);
assert.equal(resolveModeLapCount("race", course, 999), 20, "`?laps=` must clamp high.");
assert.equal(resolveModeLapCount("race", course, -4), 1, "`?laps=` must clamp low.");

// The asymmetry, stated as an assertion because it is the one thing about the
// lap count that is surprising: two laps IS the sprint, so `?laps=` does not
// move it. The soak command the phase is verified with passes `&laps=5`, and a
// sprint has to come back a sprint anyway.
assert.equal(resolveModeLapCount("sprint", course, Number.NaN), SPRINT_LAP_COUNT);
assert.equal(
  resolveModeLapCount("sprint", course, 5),
  SPRINT_LAP_COUNT,
  "`?laps=5` moved the sprint; the two-lap format is the mode, not a setting.",
);
assert.equal(resolveModeLapCount("sprint", course, 17), SPRINT_LAP_COUNT);
// ...but a course that refuses two laps still gets a legal race rather than a
// broken one.
assert.equal(
  resolveModeLapCount("sprint", { defaultLapCount: 5, minimumLapCount: 3, maximumLapCount: 9 }, 5),
  3,
  "The sprint count must clamp into what the course allows.",
);

// ---------------------------------------------------------------------------
// 3. The sprint grid, against the grid both circuits actually author
//
// `reverseGridOrder` is a permutation, so the assertions below are about what a
// permutation guarantees: the same slots, none invented, and the field still
// entirely behind the player with its authored spacing intact.
// ---------------------------------------------------------------------------

assert.equal(modeReversesGrid("sprint"), true);
assert.equal(modeReversesGrid("race"), false);
assert.equal(modeReversesGrid("timeattack"), false);

assert.deepEqual(reverseGridOrder([1, 2, 3]), [3, 2, 1]);
assert.deepEqual(reverseGridOrder([]), []);
{
  const source = [{ a: 1 }, { a: 2 }];
  const reversed = reverseGridOrder(source);
  assert.notEqual(reversed, source, "reverseGridOrder must not mutate its input.");
  assert.deepEqual(source, [{ a: 1 }, { a: 2 }]);
  assert.equal(reversed[0], source[1], "The slots must be the same objects, reassigned.");
}

for (const kind of ["greenwater", "bitterpan"]) {
  const model = loadCourseModel(kind);
  const authored = RIVAL_PROFILES.map((profile) => {
    const start = model.gridStart(profile.name);
    return start ? start.raceDistanceMeters : profile.gridOffsetMeters;
  });
  const sprint = reverseGridOrder(authored);

  // The slots themselves are untouched, so the spacing the map authored between
  // them survives whatever order they are handed out in.
  assert.deepEqual(
    [...sprint].sort((a, b) => a - b),
    [...authored].sort((a, b) => a - b),
    `${kind}: the sprint grid is not a permutation of the authored one.`,
  );

  // The player's own slot. `playerRaceDistanceOffsetMeters` puts the player at
  // `startProgress * length` in the field's frame, wrapped to the half lap
  // nearest zero — the same correction `rivals.ts` applies.
  const raw = ((model.startProgress % 1) + 1) % 1 * model.length;
  const playerRaceDistance = raw > model.length / 2 ? raw - model.length : raw;
  for (const [index, distance] of sprint.entries()) {
    assert.ok(
      distance <= playerRaceDistance,
      `${kind}: sprint slot ${index} starts ${(distance - playerRaceDistance).toFixed(2)} m `
        + "AHEAD of the player. The sprint is a defence; the player starts P1.",
    );
  }

  // The quickest rival takes the slot furthest back. This is what makes the
  // format a defence rather than a procession — see `reverseGridOrder`.
  assert.equal(
    sprint[0],
    Math.min(...authored),
    `${kind}: PRIVATEER 13 did not take the rearmost grid slot in the sprint.`,
  );

  // And the lateral fan is untouched by any of it: it is computed from the
  // profiles' lanes, which the reversal does not move. Asserted on the real
  // solver at the real grid width, in both formats.
  const halfWidth = kind === "greenwater" ? 9.5 : 12.45;
  const laterals = spreadGridLaterals(
    model.startLateral,
    RIVAL_PROFILES.map((profile) => (
      model.gridStart(profile.name)?.lateralMeters ?? profile.startingLateralMeters
    )),
    halfWidth,
  );
  assert.ok(
    minimumLateralSpacingMeters([...laterals, model.startLateral])
      >= RIVAL_GRID_MINIMUM_SPACING_METERS - 1e-9,
    `${kind}: the sprint grid is closer than ${RIVAL_GRID_MINIMUM_SPACING_METERS} m `
      + `somewhere (${minimumLateralSpacingMeters([...laterals, model.startLateral])
        .toFixed(3)} m).`,
  );
}

// ---------------------------------------------------------------------------
// 4. Delta arithmetic, against a fixture best lap
// ---------------------------------------------------------------------------

// A 2,516 m lap with eight gates, ascending, closed by a 34,000 ms lap time.
const FIXTURE = {
  gateMeters: [300, 620, 940, 1_260, 1_580, 1_900, 2_180, 2_400],
  splitsMs: [4_050, 8_400, 12_700, 17_000, 21_300, 25_600, 29_400, 32_400],
  lapMs: 34_000,
  lapLengthMeters: 2_516,
};

assert.equal(sectorDeltaMs(4_370, 4_050), 320, "A slower gate must read positive.");
assert.equal(sectorDeltaMs(3_940, 4_050), -110, "A faster gate must read negative.");
// Nothing on file is not "level"; it is nothing, and the chip has to say so.
assert.equal(sectorDeltaMs(4_370, null), null);
assert.equal(sectorDeltaMs(4_370, undefined), null);
assert.equal(sectorDeltaMs(4_370, 0), null, "A zero split is absent, not instant.");
assert.equal(sectorDeltaMs(Number.NaN, 4_050), null);
assert.equal(sectorDeltaMs(4_370, Number.POSITIVE_INFINITY), null);

// The two values the brief names, printed the way the HUD prints them.
assert.equal(formatDeltaSeconds(320), "+0.32");
assert.equal(formatDeltaSeconds(-110), "−0.11");
assert.equal(formatDeltaSeconds(null), "—", "No record must read as an em dash.");
assert.equal(formatDeltaSeconds(Number.NaN), "—");
// U+2212 MINUS SIGN, not a hyphen: the pair has to read as a pair in a mono
// face at 400 km/h. A hyphen here is a silent legibility regression.
assert.ok(
  !formatDeltaSeconds(-110).includes("-"),
  "The negative delta prints an ASCII hyphen instead of U+2212 MINUS SIGN.",
);
assert.equal(
  formatDeltaSeconds(320).length,
  formatDeltaSeconds(-110).length,
  "The two signs print at different widths; the chip will jitter.",
);

// The dead band. The physics step is 8.33 ms, so anything under half a step is
// below the instrument's own resolution and must not flip a colour.
assert.ok(DELTA_DEAD_BAND_MS > 0 && DELTA_DEAD_BAND_MS < 1000 / 120 / 2 + 1);
assert.equal(formatDeltaSeconds(1), "0.00");
assert.equal(formatDeltaSeconds(-1), "0.00");
assert.equal(deltaTone(1), "level");
assert.equal(deltaTone(320), "up");
assert.equal(deltaTone(-110), "down");
assert.equal(deltaTone(null), "none");
// The text and the colour are decided by the same band, so a chip reading
// `0.00` can never be orange.
for (const value of [-20, -5, -DELTA_DEAD_BAND_MS, 0, DELTA_DEAD_BAND_MS - 1, 3, 40]) {
  const level = formatDeltaSeconds(value) === "0.00";
  assert.equal(
    level,
    deltaTone(value) === "level",
    `Delta ${value} ms prints "${formatDeltaSeconds(value)}" with tone `
      + `"${deltaTone(value)}"; the text and the colour disagree.`,
  );
}

// The interpolated curve. Knots land exactly; the lap line and the lap close it.
assert.equal(bestLapTimeAtDistanceMs(0, FIXTURE), 0);
assert.equal(bestLapTimeAtDistanceMs(300, FIXTURE), 4_050);
assert.equal(bestLapTimeAtDistanceMs(2_400, FIXTURE), 32_400);
assert.equal(bestLapTimeAtDistanceMs(2_516, FIXTURE), 34_000);
assert.equal(
  bestLapTimeAtDistanceMs(9_999, FIXTURE),
  34_000,
  "Past the lap line the curve must clamp, not extrapolate.",
);
// Halfway between two knots is halfway between two times.
assert.equal(bestLapTimeAtDistanceMs(460, FIXTURE), (4_050 + 8_400) / 2);
// Monotonic everywhere, which is what makes a delta mean anything.
let previous = -1;
for (let metres = 0; metres <= FIXTURE.lapLengthMeters; metres += 17) {
  const value = bestLapTimeAtDistanceMs(metres, FIXTURE);
  assert.ok(value >= previous, `The best-lap curve went backwards at ${metres} m.`);
  previous = value;
}

// A curve that cannot be trusted returns null rather than a wrong answer. Each
// of these is a real corruption mode: a course that changed its gate count
// between the stored lap and this one, a hand-edited save, a zeroed lap.
for (const [label, broken] of [
  ["mismatched knot counts", { ...FIXTURE, splitsMs: FIXTURE.splitsMs.slice(0, 4) }],
  ["a non-ascending distance", { ...FIXTURE, gateMeters: [300, 200, 940, 1_260, 1_580, 1_900, 2_180, 2_400] }],
  ["a non-ascending split", { ...FIXTURE, splitsMs: [4_050, 3_000, 12_700, 17_000, 21_300, 25_600, 29_400, 32_400] }],
  ["a zero lap time", { ...FIXTURE, lapMs: 0 }],
  ["a zero lap length", { ...FIXTURE, lapLengthMeters: 0 }],
  ["splits that are not an array", { ...FIXTURE, splitsMs: "nope" }],
  ["a split past the lap", { ...FIXTURE, splitsMs: [...FIXTURE.splitsMs.slice(0, 7), 40_000] }],
]) {
  assert.equal(
    bestLapTimeAtDistanceMs(1_000, broken),
    null,
    `${label} produced a delta instead of nothing.`,
  );
}
assert.equal(bestLapTimeAtDistanceMs(-5, FIXTURE), null);

// The live delta itself.
assert.equal(liveDeltaMs(4_370, 300, FIXTURE), 320, "At a gate, live == sector.");
assert.equal(liveDeltaMs(12_000, 460, FIXTURE), 12_000 - (4_050 + 8_400) / 2);
assert.equal(liveDeltaMs(4_370, 300, null), null, "No record must read as nothing.");
assert.equal(liveDeltaMs(Number.NaN, 300, FIXTURE), null);
// A split table stored without splits — which is exactly what a migrated v2
// best lap is — has no curve, so the chip stays on the em dash rather than
// inventing a comparison.
assert.equal(
  bestLapTimeAtDistanceMs(1_000, { ...FIXTURE, gateMeters: [], splitsMs: [] }),
  1_000 / 2_516 * 34_000,
  "An empty gate table must still interpolate the lap line to the lap time.",
);

// 4 Hz exactly, which is the brief's ceiling for the live chip.
assert.equal(LIVE_DELTA_INTERVAL_MS, 250);
assert.equal(SECTOR_DELTA_HOLD_MS, 1_200, "The per-gate flash holds for 1.2 s.");

// Folding a lap into the record: the splits and the time move together, always.
{
  const first = applyBestLapSplits(null, 34_000, [1, 2, 3]);
  assert.equal(first.improved, true);
  assert.equal(first.previousBestLapMs, null);
  assert.deepEqual(first.best, { bestLapMs: 34_000, gateSplitsMs: [1, 2, 3] });

  const slower = applyBestLapSplits(first.best, 35_000, [9, 9, 9]);
  assert.equal(slower.improved, false);
  assert.deepEqual(
    slower.best.gateSplitsMs,
    [1, 2, 3],
    "A slower lap overwrote the stored splits.",
  );
  assert.equal(slower.previousBestLapMs, 34_000);

  const faster = applyBestLapSplits(first.best, 33_000, [4, 5, 6]);
  assert.equal(faster.improved, true);
  assert.deepEqual(
    faster.best,
    { bestLapMs: 33_000, gateSplitsMs: [4, 5, 6] },
    "A faster lap kept the previous lap's splits; the chip would measure "
      + "against a lap the board says was already beaten.",
  );
  // The stored array is a copy, so the recorder's own buffer can be reused.
  const buffer = [7, 8];
  const copied = applyBestLapSplits(null, 30_000, buffer);
  buffer.push(9);
  assert.deepEqual(copied.best.gateSplitsMs, [7, 8], "The splits were stored by reference.");

  for (const bad of [null, 0, -1, Number.NaN, "34000"]) {
    assert.equal(applyBestLapSplits(first.best, bad, []).improved, false, String(bad));
  }
}

// ---------------------------------------------------------------------------
// 5. Time attack races alone
// ---------------------------------------------------------------------------

assert.equal(modeHasField("race"), true);
assert.equal(modeHasField("sprint"), true);
assert.equal(modeHasField("timeattack"), false);
assert.equal(modeFieldSize("race"), 4, "`fieldSize` must still report 4 in a field race.");
assert.equal(modeFieldSize("sprint"), 4);
assert.equal(
  modeFieldSize("timeattack"),
  1,
  "`fieldSize` must report 1 in a time attack; there are no rivals to classify.",
);
assert.equal(modeFieldSize("timeattack", 3), 1);
assert.equal(modeFieldSize("race", 0), 1, "A field of nobody still classifies the player.");

// The seam that makes the fleet actually absent rather than merely hidden: the
// format is checked BEFORE the batches are built and before the livery atlas is
// fetched, so a time attack costs neither a draw call nor a texture.
const rivalsSource = read("src/game/rivals.ts");
const createAt = rivalsSource.indexOf("static async create(");
const guardAt = rivalsSource.indexOf("if (!raceModes.hasField) return null;");
const batchesAt = rivalsSource.indexOf("vehicle.createRivalVisualBatches()", createAt);
const atlasAt = rivalsSource.indexOf("loadRivalLiveryAtlas()", createAt);
assert.ok(guardAt > createAt, "RivalFleet.create must refuse a fieldless format.");
assert.ok(
  guardAt < batchesAt && guardAt < atlasAt,
  "The fieldless check runs after the rival geometry or the livery atlas has "
    + "already been built. `fieldSize 1` has to mean absent in the draw calls "
    + "and the texture count, not just in the scene graph.",
);

// ---------------------------------------------------------------------------
// 6. The tier pace merge, against the shipped JSON
// ---------------------------------------------------------------------------

for (const kind of ["greenwater", "bitterpan"]) {
  const pace = loadRivalPace(kind);

  // `works` is the authored base block BY IDENTITY, not a copy of it. This is
  // the assertion that stops the calibrated G1 pace and the tier the game loads
  // for `works` from ever drifting apart.
  assert.equal(
    applyPaceTier(pace, "works"),
    pace,
    `${kind}: the works tier is a copy of the base block instead of being it.`,
  );
  assert.equal(pace.tiers.works, undefined, `${kind}: works must not author a tier block.`);

  for (const tier of ["rookie", "feral"]) {
    const overlay = pace.tiers[tier];
    assert.ok(overlay?.profiles, `${kind}: ${tier} authors no profiles.`);
    const resolved = applyPaceTier(pace, tier);

    // Inherited: everything the tier does not author moves with the shared
    // model rather than being frozen into three copies of it.
    for (const shared of [
      "cornerSpeedGain",
      "cornerSpeedFloor",
      "noBlockSide",
      "driftCurvature",
      "straightCurvature",
    ]) {
      assert.equal(
        resolved[shared],
        pace[shared],
        `${kind}/${tier}: ${shared} was not inherited from the base block.`,
      );
    }

    for (const profile of RIVAL_PROFILES) {
      const base = pace.profiles[profile.id];
      const entry = resolved.profiles[profile.id];
      assert.ok(entry, `${kind}/${tier}: ${profile.id} is missing.`);

      // Authored, not derived. A cruise speed that happened to equal the works
      // one times a constant would be a runtime multiplier wearing a JSON hat.
      assert.ok(
        typeof entry.cruiseSpeedMetersPerSecond === "number"
          && entry.cruiseSpeedMetersPerSecond > 40
          && entry.cruiseSpeedMetersPerSecond < 120,
        `${kind}/${tier}/${profile.id}: cruise `
          + `${String(entry.cruiseSpeedMetersPerSecond)} is not a plausible speed.`,
      );
      assert.notEqual(
        entry.cruiseSpeedMetersPerSecond,
        base.cruiseSpeedMetersPerSecond,
        `${kind}/${tier}/${profile.id}: the tier did not move the cruise speed.`,
      );
      // Direction, which is the tier's whole point.
      if (tier === "rookie") {
        assert.ok(
          entry.cruiseSpeedMetersPerSecond < base.cruiseSpeedMetersPerSecond,
          `${kind}/rookie/${profile.id} is not slower than works.`,
        );
      } else {
        assert.ok(
          entry.cruiseSpeedMetersPerSecond > base.cruiseSpeedMetersPerSecond,
          `${kind}/feral/${profile.id} is not faster than works.`,
        );
      }

      // The boost windows are authored per tier and have to be usable: ordered,
      // positive, inside the lap, and not overlapping each other.
      const windows = entry.boostWindows;
      assert.ok(
        Array.isArray(windows) && windows.length > 0,
        `${kind}/${tier}/${profile.id}: no boost windows.`,
      );
      assert.equal(
        windows.length,
        base.boostWindows.length,
        `${kind}/${tier}/${profile.id}: the tier changed how many windows exist.`,
      );
      let previousEnd = -1;
      for (const window of windows) {
        assert.ok(
          Number.isFinite(window.fromMeters) && Number.isFinite(window.toMeters),
          `${kind}/${tier}/${profile.id}: a window is not numeric.`,
        );
        assert.ok(
          window.fromMeters >= 0 && window.toMeters > window.fromMeters,
          `${kind}/${tier}/${profile.id}: window [${window.fromMeters}, `
            + `${window.toMeters}] is empty or negative.`,
        );
        assert.ok(
          window.toMeters <= loadCourseModel(kind).length,
          `${kind}/${tier}/${profile.id}: window ends past the lap.`,
        );
        assert.ok(
          window.fromMeters > previousEnd,
          `${kind}/${tier}/${profile.id}: windows overlap at ${window.fromMeters} m.`,
        );
        previousEnd = window.toMeters;
      }
      // `padUse` is inherited rather than re-authored, which is what proves the
      // merge is per-field and not a wholesale replacement of the profile.
      assert.equal(
        entry.padUse,
        base.padUse,
        `${kind}/${tier}/${profile.id}: padUse was lost in the merge.`,
      );
    }
  }

  // A malformed or missing tier races the works pace rather than a half-applied
  // one. A tier that silently lost its boost windows would be a different race
  // wearing the same name.
  for (const broken of [
    { ...pace, tiers: undefined },
    { ...pace, tiers: {} },
    { ...pace, tiers: { feral: {} } },
    { ...pace, tiers: { feral: { profiles: null } } },
    { ...pace, tiers: "nope" },
  ]) {
    assert.equal(
      applyPaceTier(broken, "feral"),
      broken,
      `${kind}: a malformed feral block was half-applied.`,
    );
  }
  assert.equal(applyPaceTier(null, "feral"), null);
  assert.equal(applyPaceTier(undefined, "feral"), undefined);
}

// No runtime multiplier anywhere. The tier has to be authored data end to end,
// and the cheapest way to break that rule is a scalar in the runtime, so the
// runtime is checked for one.
const modesSource = read("src/game/race-modes.ts");
const rulesSource = read("src/game/race-modes-rules.js");
for (const [label, source] of [
  ["race-modes.ts", modesSource],
  ["race-modes-rules.js", rulesSource],
]) {
  assert.ok(
    !/cruiseSpeedMetersPerSecond\s*\*/.test(source),
    `${label} scales a cruise speed at run time. Tiers are authored JSON.`,
  );
}

// ---------------------------------------------------------------------------
// 7. The HUD contract
//
// The elements the runtime writes into have to exist, and the stylesheet has to
// have a rule for every tone the runtime can set — a missing `data-tone` rule
// is an invisible failure that renders a delta in the wrong colour.
// ---------------------------------------------------------------------------

const indexHtml = read("index.html");
const styles = read("src/style.css");
const uiSource = read("src/game/ui.ts");

for (const id of [
  "sector-delta",
  "delta-chip",
  "delta-chip-value",
  "result-stats",
  "format-select",
  "tier-select",
]) {
  assert.ok(indexHtml.includes(`id="${id}"`), `index.html is missing #${id}.`);
  assert.ok(
    uiSource.includes(`"${id}"`) || read("src/game/meta-ui.ts").includes(`"${id}"`),
    `#${id} is in the DOM but nothing writes to it.`,
  );
}

for (const tone of ["up", "down"]) {
  assert.ok(
    styles.includes(`.sector-delta[data-tone="${tone}"]`),
    `The stylesheet has no rule for a "${tone}" sector delta.`,
  );
  assert.ok(
    styles.includes(`.delta-chip[data-tone="${tone}"]`),
    `The stylesheet has no rule for a "${tone}" live delta.`,
  );
}
// Orange for slower, cyan for faster, in the HUD's own two variables. Never
// colour alone: the sign carries it too, which the format assertions above
// already proved.
assert.match(
  styles.slice(styles.indexOf('.sector-delta[data-tone="up"]')).slice(0, 120),
  /var\(--warning\)/,
  "A slower sector delta must read in the warning (orange) colour.",
);
assert.match(
  styles.slice(styles.indexOf('.sector-delta[data-tone="down"]')).slice(0, 120),
  /var\(--cyan\)/,
  "A faster sector delta must read in cyan.",
);

// The live chip is time attack only, and the runtime is what enforces it.
assert.match(
  modesSource,
  /updateLiveDelta\([^)]*\)[^{]*\{\s*if \(this\.mode !== "timeattack"/,
  "The live delta chip is not gated to time attack.",
);

console.log(
  `Race modes PASS: ${RACE_MODES.length} formats x ${RIVAL_TIERS.length} tiers parsed `
    + `(11 hostile tokens collapsed to the defaults); sprint pinned at ${SPRINT_LAP_COUNT} `
    + "laps against `?laps=` while race and timeattack honour it; the sprint grid is a "
    + `permutation of the authored slots on both circuits with the player P1, the quickest `
    + `rival rearmost and the fan still >= ${RIVAL_GRID_MINIMUM_SPACING_METERS} m; delta `
    + `arithmetic against an 8-gate fixture lap with 7 corrupt curves refused, U+2212 `
    + `minus and a ${DELTA_DEAD_BAND_MS} ms dead band where text and colour agree; `
    + "timeattack reports fieldSize 1 and refuses the fleet before its geometry or atlas "
    + "is built; both maps' rookie/feral tiers authored, ordered, non-overlapping and "
    + "inherited field by field, with no runtime multiplier in either module.",
);
