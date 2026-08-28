import assert from "node:assert/strict";
import {
  RIVAL_FIXED_STEP_SECONDS,
  RIVAL_FINISH_RUN_OUT_SECONDS,
  RIVAL_PROFILES,
  calculateRivalBankRadians,
  calculateRaceGaps,
  createRivalState,
  playerRaceDistanceMeters,
  recoverInvalidRivalState,
  rivalFinishRunOutDistanceMeters,
  resetRivalState,
  stepRivalState,
} from "../src/game/rival-race.js";

const courseLengthMeters = 2516;
const totalLaps = 5;

function simulate(renderDeltaSeconds) {
  const states = RIVAL_PROFILES.map((profile) => (
    createRivalState(profile.id, courseLengthMeters, totalLaps)
  ));
  let previousDistances = states.map((state) => state.raceDistanceMeters);
  for (let frame = 0; frame < 120 * 240 && states.some((state) => !state.finished); frame += 1) {
    for (let index = 0; index < states.length; index += 1) {
      const state = states[index];
      stepRivalState(state, {
        deltaSeconds: renderDeltaSeconds,
        targetLateralMeters: RIVAL_PROFILES[index].startingLateralMeters,
        laneHalfWidthMeters: 8,
        courseSpeedFactor: 0.91,
      });
      assert.ok(state.raceDistanceMeters >= previousDistances[index]);
      assert.ok(Math.abs(state.lateralMeters) <= 8 + 1e-9);
      previousDistances[index] = state.raceDistanceMeters;
    }
  }
  assert.ok(states.every((state) => state.finished));
  assert.ok(states.every((state) => state.completedLaps === totalLaps));
  assert.ok(states.every((state) => state.lapTimesSeconds.length === totalLaps));
  return states;
}

const at120Hz = simulate(RIVAL_FIXED_STEP_SECONDS);
const at60Hz = simulate(1 / 60);
const stableSnapshot = (states) => states.map((state) => ({
  id: state.id,
  distance: state.raceDistanceMeters,
  laps: state.lapTimesSeconds,
  finish: state.finishTimeSeconds,
  recoveries: state.recoveryCount,
}));
assert.deepEqual(stableSnapshot(at60Hz), stableSnapshot(at120Hz));

const finishTimes = at120Hz.map((state) => state.finishTimeSeconds);
assert.equal(new Set(finishTimes).size, RIVAL_PROFILES.length);
assert.ok(Math.max(...finishTimes) - Math.min(...finishTimes) < 12);

const playerDistance = playerRaceDistanceMeters({
  progress: 0.5,
  lap: 2,
  totalLaps,
  courseLengthMeters,
});
assert.equal(playerDistance, courseLengthMeters * 1.5);
assert.equal(playerRaceDistanceMeters({
  progress: 0.5,
  lap: 2,
  totalLaps,
  courseLengthMeters,
  nextCheckpointProgress: 0.2,
}), courseLengthMeters * 0.5);
assert.equal(playerRaceDistanceMeters({
  progress: 0.85,
  lap: 1,
  totalLaps,
  courseLengthMeters,
  nextCheckpointProgress: 0.1,
}), 0);
assert.equal(playerRaceDistanceMeters({
  progress: 0.5,
  lap: 2,
  totalLaps,
  courseLengthMeters,
  nextCheckpointProgress: 0.7,
}), courseLengthMeters * 1.5);
assert.equal(playerRaceDistanceMeters({
  progress: 0,
  lap: totalLaps,
  totalLaps,
  courseLengthMeters,
  finished: true,
}), courseLengthMeters * totalLaps);
const gaps = calculateRaceGaps([
  { id: "player", raceDistanceMeters: 100, speedMetersPerSecond: 50 },
  { id: "ahead", raceDistanceMeters: 125, speedMetersPerSecond: 50 },
  { id: "behind", raceDistanceMeters: 80, speedMetersPerSecond: 40 },
], "player");
assert.equal(gaps.position, 2);
assert.equal(gaps.racerCount, 3);
assert.equal(gaps.gapToAheadMs, 500);
assert.equal(gaps.gapToBehindMs, 400);

const recoverable = createRivalState(RIVAL_PROFILES[0].id, courseLengthMeters, totalLaps);
stepRivalState(recoverable, { deltaSeconds: 1, laneHalfWidthMeters: 8 });
const safeDistance = recoverable.raceDistanceMeters;
recoverable.raceDistanceMeters = Number.NaN;
assert.equal(recoverInvalidRivalState(recoverable), true);
assert.equal(recoverable.raceDistanceMeters, safeDistance);
assert.equal(recoverable.recoveryCount, 1);
resetRivalState(recoverable);
assert.equal(recoverable.raceDistanceMeters, RIVAL_PROFILES[0].gridOffsetMeters);

const runOutSpeed = 60;
assert.equal(rivalFinishRunOutDistanceMeters(0, runOutSpeed), 0);
assert.equal(
  rivalFinishRunOutDistanceMeters(RIVAL_FINISH_RUN_OUT_SECONDS, runOutSpeed),
  runOutSpeed * RIVAL_FINISH_RUN_OUT_SECONDS / 2,
);
assert.equal(
  rivalFinishRunOutDistanceMeters(RIVAL_FINISH_RUN_OUT_SECONDS + 2, runOutSpeed),
  runOutSpeed * RIVAL_FINISH_RUN_OUT_SECONDS / 2,
);

assert.equal(calculateRivalBankRadians(0, 0, 0), 0);
assert.equal(calculateRivalBankRadians(0, 0, 1), -0.09);
assert.equal(calculateRivalBankRadians(0, 0, -1), 0.09);
assert.equal(calculateRivalBankRadians(0, 1, 1), -0.2);
assert.equal(calculateRivalBankRadians(0, -1, -1), 0.2);
assert.equal(calculateRivalBankRadians(Number.NaN, Number.NaN, Number.NaN), 0);

console.log(
  "Rival race PASS: deterministic 120 Hz pacing, five-lap timing, bounded lanes, stable ranking/gaps, finish spread, safe-state recovery and bounded visual banking.",
);
