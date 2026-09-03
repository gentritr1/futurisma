/**
 * G1 rival pace measurement.
 *
 * Every number in `src/game/data/greenwater-rival-pace.json` and in the
 * `rivals` block of `src/game/data/map02/BITTERPAN_PRODUCTION.json` came out of
 * this script. It is not a validator — `scripts/validate-rivals.mjs` is — it is
 * the instrument the pace was solved on, kept in the repo so a later tuning
 * pass re-derives the numbers instead of nudging them.
 *
 * Usage:
 *   node scripts/rival-pace-calibration.mjs                 both maps, report
 *   node scripts/rival-pace-calibration.mjs greenwater      one map, report
 *   node scripts/rival-pace-calibration.mjs bitterpan --solve --player=201.066
 *
 * `--solve` bisects each profile's `cruiseSpeedMetersPerSecond` until its
 * five-lap total lands on the authored offset from the player's total, then
 * prints the block to paste back. `--player=` is the demo-autopilot five-lap
 * total measured by `node scripts/visual/diag-long.mjs` on that map; pass the number
 * from the soak you are calibrating against, never a remembered one.
 */
import { loadCourseModel, loadRivalPace } from "./lib/rival-course-model.mjs";
import { measuredPacePlayer, simulateRivalField } from "./lib/rival-field-sim.mjs";
import { RIVAL_PROFILES } from "../src/game/rival-race.js";

/**
 * Five-lap demo-autopilot totals and lap-1 times measured on the build this
 * pace was solved against (`node scripts/visual/diag-long.mjs`, 2026-09-03).
 * Re-measure and update both numbers whenever the player model moves.
 */
const PLAYER_REFERENCE = {
  greenwater: { lapOneSeconds: 34.483, totalSeconds: 165.442 },
  bitterpan: { lapOneSeconds: 38.775, totalSeconds: 183.933 },
};

/** Where each profile is meant to land relative to the player's five-lap total. */
const TARGET_TOTAL_OFFSET_SECONDS = {
  "rival-privateer": -0.4,
  "rival-nightform": 1.4,
  "rival-needle": 3.0,
};

const argv = process.argv.slice(2);
const solve = argv.includes("--solve");
const kinds = argv.filter((value) => !value.startsWith("--"));
const maps = kinds.length > 0 ? kinds : ["greenwater", "bitterpan"];
const playerOverride = argv
  .find((value) => value.startsWith("--player="))
  ?.slice("--player=".length);

function runOnce(kind, pace, player) {
  const course = loadCourseModel(kind);
  return simulateRivalField({
    course,
    pace,
    totalLaps: 5,
    player: measuredPacePlayer(course.length, player.totalSeconds / 5),
  });
}

function report(kind) {
  const pace = loadRivalPace(kind);
  const player = {
    ...PLAYER_REFERENCE[kind],
    ...(playerOverride ? { totalSeconds: Number(playerOverride) } : {}),
  };
  const run = runOnce(kind, pace, player);
  const course = loadCourseModel(kind);
  console.log(`\n=== ${kind.toUpperCase()} (${course.length.toFixed(0)} m, 5 laps) ===`);
  console.log(
    `player   lap1 ${player.lapOneSeconds.toFixed(3)}   `
      + `total ${player.totalSeconds.toFixed(3)}`,
  );
  for (const state of run.states) {
    const total = state.finishTimeSeconds;
    const lapOne = state.lapTimesSeconds[0];
    const pad = pace.profiles[state.id];
    console.log(
      `${state.id.padEnd(16)} cruise ${pad.cruiseSpeedMetersPerSecond.toFixed(2)}  `
        + `lap1 ${lapOne?.toFixed(3)} (${(lapOne - player.lapOneSeconds >= 0 ? "+" : "")}`
        + `${(lapOne - player.lapOneSeconds).toFixed(3)})  `
        + `total ${total?.toFixed(3)} (${(total - player.totalSeconds >= 0 ? "+" : "")}`
        + `${(total - player.totalSeconds).toFixed(3)})  `
        + `boost ${state.boostSeconds.toFixed(2)}s  pads ${state.padHits}  `
        + `drifts ${state.driftEntries}  reserve ${state.boostReserve.toFixed(2)}`,
    );
  }
  console.log(
    `field: rival-rival minSeparation ${run.minimumRivalSeparationMeters.toFixed(2)} m  `
      + `player-rival ${run.minimumSeparationMeters.toFixed(2)} m  `
      + `minFreeDeck ${(run.minimumFreeDeckFraction * 100).toFixed(1)}% all / `
      + `${(run.minimumClearFreeDeckFraction * 100).toFixed(1)}% not-alongside `
      + `(target ${(run.minimumFreeDeckTarget * 100).toFixed(1)}%, margin `
      + `${(run.minimumClearFreeDeckMargin * 100).toFixed(2)} pts)  `
      + `${run.noBlockSamples} samples, ${run.alongsideSamples} player inside the corridor  `
      + `leadChanges ${run.leadChanges}`,
  );
  return { pace, player, run };
}

/**
 * Solves the map-level corner scrub with the authored cruise speeds held fixed.
 *
 * The cruise numbers are constrained by the brief - a rival has to reach the
 * player's own cruise band (82-88 m/s) on a straight or it is a pace car with a
 * boost button - so the free variable is how much of that a corner takes back.
 * `cornerSpeedGain` is bisected against the reference profile's five-lap total;
 * everything else follows from it.
 */
function solveCornerScrub(kind) {
  const pace = loadRivalPace(kind);
  const player = {
    ...PLAYER_REFERENCE[kind],
    ...(playerOverride ? { totalSeconds: Number(playerOverride) } : {}),
  };
  const reference = "rival-privateer";
  const target = player.totalSeconds + TARGET_TOTAL_OFFSET_SECONDS[reference];
  let low = 0.05;
  let high = 0.9;
  for (let iteration = 0; iteration < 34; iteration += 1) {
    const middle = (low + high) / 2;
    const trial = structuredClone(pace);
    trial.cornerSpeedGain = middle;
    const course = loadCourseModel(kind);
    const run = simulateRivalField({
      course,
      pace: trial,
      totalLaps: 5,
      player: measuredPacePlayer(course.length, player.totalSeconds / 5),
      onlyProfileIndex: RIVAL_PROFILES.findIndex((entry) => entry.id === reference),
      contest: false,
    });
    const finish = run.states[0].finishTimeSeconds;
    if (finish === null || finish > target) high = middle;
    else low = middle;
  }
  console.log(
    `\nsolved cornerSpeedGain for ${kind}: ${((low + high) / 2).toFixed(4)} `
      + `(cruise held at ${JSON.stringify(
        Object.fromEntries(
          Object.entries(pace.profiles)
            .map(([id, entry]) => [id, entry.cruiseSpeedMetersPerSecond]),
        ),
      )})`,
  );
}

function solveCruise(kind) {
  const pace = loadRivalPace(kind);
  const player = {
    ...PLAYER_REFERENCE[kind],
    ...(playerOverride ? { totalSeconds: Number(playerOverride) } : {}),
  };
  const solved = {};
  for (const profile of RIVAL_PROFILES) {
    const target = player.totalSeconds + TARGET_TOTAL_OFFSET_SECONDS[profile.id];
    let low = 55;
    let high = 120;
    for (let iteration = 0; iteration < 34; iteration += 1) {
      const middle = (low + high) / 2;
      const trial = structuredClone(pace);
      trial.profiles[profile.id].cruiseSpeedMetersPerSecond = middle;
      const course = loadCourseModel(kind);
      const run = simulateRivalField({
        course,
        pace: trial,
        totalLaps: 5,
        player: measuredPacePlayer(course.length, player.totalSeconds / 5),
        onlyProfileIndex: RIVAL_PROFILES.indexOf(profile),
        contest: false,
      });
      const finish = run.states[0].finishTimeSeconds;
      if (finish === null || finish > target) low = middle;
      else high = middle;
    }
    solved[profile.id] = Number(((low + high) / 2).toFixed(2));
  }
  console.log(`\nsolved cruise for ${kind}:`, JSON.stringify(solved, null, 2));
  return solved;
}

for (const kind of maps) {
  if (argv.includes("--solve-corner")) solveCornerScrub(kind);
  if (solve) solveCruise(kind);
  report(kind);
}
