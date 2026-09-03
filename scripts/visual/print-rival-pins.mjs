// Prints the two pinned tables `scripts/validate-rivals.mjs` holds, so a
// deliberate model change can be re-pinned from a measurement rather than by
// copying an assertion failure out of a log.
import {
  RIVAL_FIXED_STEP_SECONDS,
  RIVAL_PROFILES,
  createRivalState,
  rivalPoseSignals,
  stepRivalState,
} from "../../src/game/rival-race.js";
import { loadCourseModel, loadRivalPace } from "../lib/rival-course-model.mjs";
import { measuredPacePlayer, simulateRivalField } from "../lib/rival-field-sim.mjs";

const courseLengthMeters = 2516;
const totalLaps = 5;
const PLAYER_TOTAL_SECONDS = { greenwater: 165.442, bitterpan: 183.933 };

function openLoopInput(index) {
  return {
    targetLateralMeters: RIVAL_PROFILES[index].startingLateralMeters + 5,
    paceLateralMeters: RIVAL_PROFILES[index].startingLateralMeters + 5,
    laneHalfWidthMeters: 8,
    courseSpeedFactor: 0.91,
    curvature: 0.4,
    cruiseSpeedMetersPerSecond: 84 - index * 1.5,
    boostWindowActive: index !== 1,
    onBoostPad: index === 1,
    curvatureMagnitude: 0.8,
    driftCurvature: 0.55,
  };
}

const states = RIVAL_PROFILES.map((profile) => (
  createRivalState(profile.id, courseLengthMeters, totalLaps)
));
for (let frame = 0; frame < 120 * 240 && states.some((s) => !s.finished); frame += 1) {
  for (let index = 0; index < states.length; index += 1) {
    const input = openLoopInput(index);
    rivalPoseSignals(states[index], input);
    stepRivalState(states[index], { deltaSeconds: RIVAL_FIXED_STEP_SECONDS, ...input });
  }
}
console.log("const OPEN_LOOP_FINISH_SECONDS = Object.freeze({");
for (const state of states) {
  console.log(`  "${state.id}": ${state.finishTimeSeconds},`);
}
console.log("});");

console.log("const COURSE_FINISH_SECONDS = {");
for (const kind of ["greenwater", "bitterpan"]) {
  const course = loadCourseModel(kind);
  const run = simulateRivalField({
    course,
    pace: loadRivalPace(kind),
    totalLaps,
    player: measuredPacePlayer(course.length, PLAYER_TOTAL_SECONDS[kind] / 5),
  });
  console.log(
    `  ${kind}: { `
      + run.states.map((s) => `"${s.id}": ${s.finishTimeSeconds}`).join(", ")
      + " },",
  );
}
console.log("};");
