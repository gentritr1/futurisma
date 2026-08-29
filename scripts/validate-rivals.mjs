import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  RIVAL_FIXED_STEP_SECONDS,
  RIVAL_FINISH_RUN_OUT_SECONDS,
  RIVAL_GLOW_SPEED_SHARE,
  RIVAL_PROFILES,
  RIVAL_STEER_CURVATURE_GAIN,
  calculateRivalBankRadians,
  calculateRaceGaps,
  chooseOvertakeOffset,
  createRivalState,
  playerRaceDistanceMeters,
  recoverInvalidRivalState,
  rivalBrakeSignal,
  rivalFinishRunOutDistanceMeters,
  rivalGlowSignal,
  rivalPoseSignals,
  rivalSteerSignal,
  rivalThrottleSignal,
  resetRivalState,
  stepRivalState,
} from "../src/game/rival-race.js";

const courseLengthMeters = 2516;
const totalLaps = 5;

/**
 * Finish times captured from this harness on the commit BEFORE the P2 rival
 * aliveness work, so the phase can prove it left the race itself untouched.
 * Recorded by running the same open-loop simulation against the pre-phase
 * `rival-race.js`. Any edit to the pacing model breaks these on purpose.
 */
const PRE_PHASE_OPEN_LOOP_FINISH_SECONDS = Object.freeze({
  "rival-privateer": 211.30391519203832,
  "rival-nightform": 216.25351195486905,
  "rival-needle": 220.25874561555503,
});

/** The authored travel the pose signals drive, mirroring `rivals.ts`. */
const STEERING_FIN_TRAVEL_RADIANS = 20 * Math.PI / 180;
const AIRBRAKE_TRAVEL_RADIANS = 60 * Math.PI / 180;

/**
 * A rival must reach at least this much fin deflection somewhere in a five-lap
 * run, otherwise the fins are decoration. Matches the soak assertion on the
 * `rivalMaximumSteerRadians` diagnostics field.
 */
const MINIMUM_PEAK_STEER_RADIANS = 0.10;

/**
 * Constant, state-independent inputs. Holding them fixed is what makes the
 * open-loop run comparable across render rates: every sub-step sees the same
 * authored demand, so the only thing that could make 60 Hz differ from 120 Hz
 * is a rate-dependent term hiding in the model or in a pose signal.
 */
function openLoopInput(index) {
  return {
    targetLateralMeters: RIVAL_PROFILES[index].startingLateralMeters + 5,
    laneHalfWidthMeters: 8,
    courseSpeedFactor: 0.91,
    curvature: 0.4,
  };
}

function simulate(renderDeltaSeconds) {
  const states = RIVAL_PROFILES.map((profile) => (
    createRivalState(profile.id, courseLengthMeters, totalLaps)
  ));
  let previousDistances = states.map((state) => state.raceDistanceMeters);
  // One row per `stepRivalState` call, per rival: the pose the rival is showing
  // with the state that call is about to consume.
  const poses = states.map(() => []);
  for (let frame = 0; frame < 120 * 240 && states.some((state) => !state.finished); frame += 1) {
    for (let index = 0; index < states.length; index += 1) {
      const state = states[index];
      const input = openLoopInput(index);
      const pose = rivalPoseSignals(state, input);
      poses[index].push(pose.steer, pose.brake, pose.throttle, pose.glow);
      stepRivalState(state, { deltaSeconds: renderDeltaSeconds, ...input });
      assert.ok(state.raceDistanceMeters >= previousDistances[index]);
      assert.ok(Math.abs(state.lateralMeters) <= 8 + 1e-9);
      previousDistances[index] = state.raceDistanceMeters;
    }
  }
  assert.ok(states.every((state) => state.finished));
  assert.ok(states.every((state) => state.completedLaps === totalLaps));
  assert.ok(states.every((state) => state.lapTimesSeconds.length === totalLaps));
  return { states, poses };
}

const run120Hz = simulate(RIVAL_FIXED_STEP_SECONDS);
const run60Hz = simulate(1 / 60);
const at120Hz = run120Hz.states;
const at60Hz = run60Hz.states;
const stableSnapshot = (states) => states.map((state) => ({
  id: state.id,
  distance: state.raceDistanceMeters,
  laps: state.lapTimesSeconds,
  finish: state.finishTimeSeconds,
  recoveries: state.recoveryCount,
}));
assert.deepEqual(stableSnapshot(at60Hz), stableSnapshot(at120Hz));

// A 1/60 render delta drives exactly two 1/120 sub-steps per call, so the 60 Hz
// pose sequence must land bit-for-bit on every second 120 Hz sample. A signal
// derived from `(current - previous) / deltaSeconds` would fail here, which is
// the whole point of deriving them from state instead.
const SIGNALS_PER_SAMPLE = 4;
for (let index = 0; index < RIVAL_PROFILES.length; index += 1) {
  const dense = run120Hz.poses[index];
  const sparse = run60Hz.poses[index];
  assert.ok(
    sparse.length > 0 && dense.length > 0,
    `${RIVAL_PROFILES[index].id} recorded no pose samples.`,
  );
  const comparable = Math.min(
    Math.floor(dense.length / SIGNALS_PER_SAMPLE / 2),
    Math.floor(sparse.length / SIGNALS_PER_SAMPLE),
  );
  assert.ok(
    comparable > 1000,
    `${RIVAL_PROFILES[index].id} has too few comparable pose samples (${comparable}).`,
  );
  let moved = 0;
  for (let sample = 0; sample < comparable; sample += 1) {
    for (let signal = 0; signal < SIGNALS_PER_SAMPLE; signal += 1) {
      const sparseValue = sparse[sample * SIGNALS_PER_SAMPLE + signal];
      const denseValue = dense[sample * 2 * SIGNALS_PER_SAMPLE + signal];
      assert.equal(
        sparseValue,
        denseValue,
        `${RIVAL_PROFILES[index].id} pose signal ${signal} diverges at sample `
          + `${sample}: 60 Hz ${sparseValue} vs 120 Hz ${denseValue}.`,
      );
    }
    if (Math.abs(sparse[sample * SIGNALS_PER_SAMPLE]) > 1e-6) moved += 1;
  }
  assert.ok(
    moved > comparable / 2,
    `${RIVAL_PROFILES[index].id} steer signal is flat across the run; the `
      + "determinism comparison would be vacuous.",
  );
}

for (const state of at120Hz) {
  const expected = PRE_PHASE_OPEN_LOOP_FINISH_SECONDS[state.id];
  assert.equal(
    typeof expected,
    "number",
    `No pre-phase finish time recorded for ${state.id}.`,
  );
  assert.equal(
    state.finishTimeSeconds,
    expected,
    `${state.id} finish time moved from the pre-phase capture: `
      + `${state.finishTimeSeconds} vs ${expected}. The rival race must be `
      + "untouched by presentation work.",
  );
}

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

// --- pose signals: shape, bounds and purity -------------------------------

const poseProbe = createRivalState(RIVAL_PROFILES[0].id, courseLengthMeters, totalLaps);
const probeInput = {
  targetLateralMeters: 6,
  laneHalfWidthMeters: 8,
  courseSpeedFactor: 0.9,
  curvature: 0.5,
};
const firstPose = rivalPoseSignals(poseProbe, probeInput);
const secondPose = rivalPoseSignals(poseProbe, probeInput);
assert.deepEqual(firstPose, secondPose, "Pose signals must be pure.");
for (const [name, value] of Object.entries(firstPose)) {
  assert.ok(Number.isFinite(value), `${name} signal is not finite.`);
}
assert.ok(firstPose.steer >= -1 && firstPose.steer <= 1);
assert.ok(firstPose.brake >= 0 && firstPose.brake <= 1);
assert.ok(firstPose.throttle >= 0 && firstPose.throttle <= 1);
assert.ok(firstPose.glow >= 0 && firstPose.glow <= 1);

// A stationary rival wants everything it has and nothing on the brakes, so its
// glow is carried entirely by the throttle share.
assert.equal(rivalThrottleSignal(poseProbe, { courseSpeedFactor: 1 }), 1);
assert.equal(rivalBrakeSignal(poseProbe, { courseSpeedFactor: 1 }), 0);
assert.equal(
  rivalGlowSignal(poseProbe, { courseSpeedFactor: 1 }),
  1 - RIVAL_GLOW_SPEED_SHARE,
);
// ... and a rival well over its authored pace is the mirror of that: nothing
// left to ask the engine for, so only the speed share remains lit.
const overSpeed = { ...poseProbe, speedMetersPerSecond: 200 };
assert.equal(rivalBrakeSignal(overSpeed, { courseSpeedFactor: 1 }), 1);
assert.equal(rivalThrottleSignal(overSpeed, { courseSpeedFactor: 1 }), 0);
assert.equal(rivalGlowSignal(overSpeed, { courseSpeedFactor: 1 }), RIVAL_GLOW_SPEED_SHARE);

// Curvature alone deflects the fins, which is what keeps a rival looking like
// it is steering through a bend rather than only at turn-in.
const onLine = { ...poseProbe, lateralMeters: 2 };
assert.equal(
  rivalSteerSignal(onLine, { targetLateralMeters: 2, laneHalfWidthMeters: 8, curvature: 0 }),
  0,
);
assert.equal(
  rivalSteerSignal(onLine, { targetLateralMeters: 2, laneHalfWidthMeters: 8, curvature: 1 }),
  -RIVAL_STEER_CURVATURE_GAIN,
);
assert.equal(
  rivalSteerSignal(onLine, { targetLateralMeters: 2, laneHalfWidthMeters: 8, curvature: -1 }),
  RIVAL_STEER_CURVATURE_GAIN,
);
// Garbage in, neutral out — a pose signal must never emit NaN into a matrix.
const corrupt = { ...poseProbe, lateralMeters: Number.NaN, speedMetersPerSecond: Number.NaN };
const corruptPose = rivalPoseSignals(corrupt, {
  targetLateralMeters: Number.NaN,
  laneHalfWidthMeters: Number.NaN,
  courseSpeedFactor: Number.NaN,
  curvature: Number.NaN,
});
for (const [name, value] of Object.entries(corruptPose)) {
  assert.ok(Number.isFinite(value), `${name} signal is not finite for corrupt state.`);
}

// --- course-faithful five-lap run -----------------------------------------

// The game steps the fleet at a fixed 1/120 out of its physics accumulator
// whatever the renderer is doing (game.ts), so this run reproduces the shape of
// a real race: the target line and speed factor come from the Greenwater
// centreline and are recomputed at every sub-step.
const blockout = JSON.parse(readFileSync(
  new URL("../src/game/data/greenwater-blockout.json", import.meta.url),
  "utf8",
));
const centreline = blockout.centreline.samples;
const lapLength = blockout.centreline.lapLength;
const sampleCount = centreline.length;
const wrapIndex = (value) => ((value % sampleCount) + sampleCount) % sampleCount;
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const normalise = (vector) => {
  const length = Math.hypot(vector[0], vector[1], vector[2]) || 1;
  return [vector[0] / length, vector[1] / length, vector[2] / length];
};
// Mirrors GreenwaterCourse's tangent/curvature derivation closely enough to
// shape a representative run. It is not a second source of truth for the
// course — the finish times below are anchored to this harness alone.
const tangents = centreline.map((_, index) => {
  const before = centreline[wrapIndex(index - 1)];
  const after = centreline[wrapIndex(index + 1)];
  return normalise([after.x - before.x, after.y - before.y, after.z - before.z]);
});
const curvatureOffset = Math.max(1, Math.round(8 / (lapLength / sampleCount)));
const curvatures = tangents.map((_, index) => {
  const before = tangents[wrapIndex(index - curvatureOffset)];
  const after = tangents[wrapIndex(index + curvatureOffset)];
  return clamp((before[2] * after[0] - before[0] * after[2]) * 4, -1, 1);
});
const sampleCourse = (progress) => {
  const scaled = (((progress % 1) + 1) % 1) * sampleCount;
  const index = Math.floor(scaled) % sampleCount;
  const next = (index + 1) % sampleCount;
  const alpha = scaled - Math.floor(scaled);
  const mix = (a, b) => a + (b - a) * alpha;
  return {
    curvature: mix(curvatures[index], curvatures[next]),
    halfWidth: mix(centreline[index].w, centreline[next].w) / 2,
  };
};

const VEHICLE_CLEARANCE_METERS = 2.2;

function raceOnCourse() {
  const states = RIVAL_PROFILES.map((profile) => (
    createRivalState(profile.id, lapLength, totalLaps)
  ));
  const steerRadians = [];
  const brakeRadians = [];
  let peakSteerRadians = 0;
  const stepLimit = Math.ceil(300 / RIVAL_FIXED_STEP_SECONDS);
  for (let step = 0; step < stepLimit && states.some((s) => !s.finished); step += 1) {
    for (let index = 0; index < states.length; index += 1) {
      const state = states[index];
      if (state.finished) continue;
      const profile = RIVAL_PROFILES[index];
      const sample = sampleCourse(state.courseDistanceMeters / lapLength);
      const laneHalfWidth = Math.max(0, sample.halfWidth - VEHICLE_CLEARANCE_METERS);
      let targetLateral = profile.startingLateralMeters
        + Math.sin(state.raceDistanceMeters / 210 + profile.pacePhaseRadians) * 0.75
        - sample.curvature * 1.4;
      for (let other = 0; other < states.length; other += 1) {
        if (other === index) continue;
        const rival = states[other];
        if (
          Math.abs(state.raceDistanceMeters - rival.raceDistanceMeters) < 10
          && Math.abs(state.lateralMeters - rival.lateralMeters) < 2.6
        ) {
          targetLateral = chooseOvertakeOffset(
            state.id,
            rival.id,
            profile.startingLateralMeters,
          );
          break;
        }
      }
      const input = {
        targetLateralMeters: targetLateral,
        laneHalfWidthMeters: laneHalfWidth,
        courseSpeedFactor: clamp(1 - Math.abs(sample.curvature) * 0.2, 0.79, 1),
        curvature: sample.curvature,
      };
      const pose = rivalPoseSignals(state, input);
      const steer = Math.abs(pose.steer) * STEERING_FIN_TRAVEL_RADIANS;
      steerRadians.push(steer);
      brakeRadians.push(pose.brake * AIRBRAKE_TRAVEL_RADIANS);
      if (steer > peakSteerRadians) peakSteerRadians = steer;
      stepRivalState(state, { deltaSeconds: RIVAL_FIXED_STEP_SECONDS, ...input });
    }
  }
  return { states, steerRadians, brakeRadians, peakSteerRadians };
}

/**
 * Finish times for the course-faithful run, captured on the same pre-phase
 * commit as the open-loop constants above.
 */
const PRE_PHASE_COURSE_FINISH_SECONDS = Object.freeze({
  "rival-privateer": 204.08746742796023,
  "rival-nightform": 208.60184334230098,
  "rival-needle": 212.6753891283855,
});

const courseRace = raceOnCourse();
assert.ok(
  courseRace.states.every((state) => state.finished),
  "Every rival must finish the course-faithful five-lap run.",
);
for (const state of courseRace.states) {
  assert.equal(
    state.finishTimeSeconds,
    PRE_PHASE_COURSE_FINISH_SECONDS[state.id],
    `${state.id} course finish time moved from the pre-phase capture.`,
  );
}

assert.ok(
  courseRace.peakSteerRadians >= MINIMUM_PEAK_STEER_RADIANS,
  `Peak fin deflection over five laps was ${courseRace.peakSteerRadians.toFixed(4)} rad, `
    + `below the ${MINIMUM_PEAK_STEER_RADIANS} rad floor: the fins would read as welded.`,
);

const quantile = (values, fraction) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))];
};
const steerAtOrAboveFloor = courseRace.steerRadians
  .filter((value) => value >= MINIMUM_PEAK_STEER_RADIANS).length;
// The gain in `rival-race.js` was chosen from exactly this distribution; the
// numbers are printed so a later change to it is visible in the log, not just
// in a pass/fail.
console.log(
  `Rival articulation over ${courseRace.steerRadians.length} sampled sub-steps: `
    + `|steer| p50=${quantile(courseRace.steerRadians, 0.5).toFixed(4)} rad, `
    + `p75=${quantile(courseRace.steerRadians, 0.75).toFixed(4)} rad, `
    + `p90=${quantile(courseRace.steerRadians, 0.9).toFixed(4)} rad, `
    + `peak=${courseRace.peakSteerRadians.toFixed(4)} rad, `
    + `${(steerAtOrAboveFloor / courseRace.steerRadians.length * 100).toFixed(1)}% at or `
    + `above ${MINIMUM_PEAK_STEER_RADIANS} rad; `
    + `airbrake peak=${quantile(courseRace.brakeRadians, 1).toFixed(4)} rad.`,
);

// ---------------------------------------------------------------------------
// P15.1 — the livery sheet orientation, pinned in both consumers.
//
// The GLB's baked sheet is stored PRE-FLIPPED and loaded `flipY = false`; the
// served PNGs are stored origin-at-top and need `flipY = true`. Getting this
// wrong is invisible to every other check in the repo — lap times, counts and
// frame timing are identical while every hull samples the mirrored paint-chip
// row — and it shipped that way from P7 until P15.1. So both consumers are
// pinned here rather than left to a comment.
// ---------------------------------------------------------------------------

const totemSource = readFileSync(
  new URL("../src/game/totem.ts", import.meta.url),
  "utf8",
);
const rivalsSource = readFileSync(
  new URL("../src/game/rivals.ts", import.meta.url),
  "utf8",
);

assert.match(
  totemSource,
  /export const SERVED_LIVERY_FLIP_Y = true;/,
  "Served TOTEM sheets are authored origin-at-top and need flipY = true. This "
    + "constant is the single place that decides it.",
);
assert.match(
  totemSource,
  /texture\.flipY = SERVED_LIVERY_FLIP_Y;/,
  "applyLivery must SET the served orientation, never inherit it. Copying "
    + "`previous.flipY` takes the GLB's pre-flipped `false` onto a served PNG, "
    + "which is the P15.1 bug: every swapped livery sampled the mirrored "
    + "paint-chip row and NIGHTFORM rendered flat acid-green.",
);
assert.ok(
  !/flipY = previous\.flipY/.test(totemSource),
  "applyLivery is inheriting flipY again — see the P15.1 note in totem.ts.",
);
assert.match(
  rivalsSource,
  /texture\.flipY = false;/,
  "The rival atlas keeps flipY = false: the quadrant offsets in "
    + "LIVERY_ATLAS_OFFSETS address the canvas in that orientation, so flipping "
    + "the sampler here would swap which livery each quadrant addresses.",
);
assert.match(
  rivalsSource,
  /context\.scale\(1, -1\);/,
  "The rival atlas must mirror each served sheet into its quadrant, because it "
    + "cannot flip the sampler. Without this every rival body samples the "
    + "mirrored paint-chip row.",
);

console.log(
  "Rival race PASS: deterministic 120 Hz pacing, five-lap timing, bounded lanes, stable ranking/gaps, finish spread, safe-state recovery, bounded visual banking, rate-independent pose signals and unchanged pre/post-phase finish times; livery sheet orientation pinned in both consumers (player swap sets flipY = true, rival atlas mirrors per quadrant at flipY = false).",
);
