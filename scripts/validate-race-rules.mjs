import assert from "node:assert/strict";
import {
  calculateFinishDistanceMeters,
  calculateRecoveryTelemetry,
  checkpointRequiresExtraCircuit,
  crossedForwardProgress,
  forwardProgressDelta,
  integrateWrongWayEvidence,
  isOpenEdgeWarningActive,
  isCircularHazardContact,
  isTurnCueBeyondFinish,
  isTurnCueUrgent,
  resolveWrongWayActive,
  resolveCountdownStage,
} from "../src/game/race-rules.js";
import {
  resolveBoostPresentation,
  resolveFinishPresentation,
  resolveInitialRacePresentation,
  resolveRaceStage,
} from "../src/game/hud-presentation.js";

const COURSE_LENGTH = 2_516;

assert.ok(crossedForwardProgress(0.1, 0.13, 0.12));
assert.ok(crossedForwardProgress(0.99, 0.01, 0));
assert.ok(!crossedForwardProgress(0.13, 0.1, 0.12));
assert.ok(!crossedForwardProgress(0.1, 0.11, 0.12));
assert.ok(forwardProgressDelta(0.99, 0.01) > 0);
assert.ok(forwardProgressDelta(0.01, 0.99) < 0);

assert.equal(resolveCountdownStage(3.7), "3");
assert.equal(resolveCountdownStage(3), "2");
assert.equal(resolveCountdownStage(2), "1");
assert.equal(resolveCountdownStage(1), "GO");
assert.equal(resolveCountdownStage(0), "");
assert.equal(resolveCountdownStage(Number.NaN), "");

assert.equal(isTurnCueUrgent(210, 90, true), true);
assert.equal(isTurnCueUrgent(230, 90, true), false);
assert.equal(isTurnCueUrgent(120, 20, true), true);
assert.equal(isTurnCueUrgent(80, 90, false), false);
assert.equal(isTurnCueUrgent(Number.NaN, 90, true), false);

assert.equal(isOpenEdgeWarningActive(6.5, 10), true);
assert.equal(isOpenEdgeWarningActive(6.3, 10), false);
assert.equal(isOpenEdgeWarningActive(-6.5, 10), true);
assert.equal(isOpenEdgeWarningActive(Number.NaN, 10), false);

let wrongWayEvidence120 = 0;
for (let index = 0; index < 78; index += 1) {
  wrongWayEvidence120 = integrateWrongWayEvidence(wrongWayEvidence120, -0.7, 24, 1 / 120);
}
let wrongWayEvidence60 = 0;
for (let index = 0; index < 39; index += 1) {
  wrongWayEvidence60 = integrateWrongWayEvidence(wrongWayEvidence60, -0.7, 24, 1 / 60);
}
assert.ok(resolveWrongWayActive(false, wrongWayEvidence120));
assert.ok(resolveWrongWayActive(false, wrongWayEvidence60));
assert.ok(
  Math.abs(wrongWayEvidence120 - wrongWayEvidence60) < 0.001,
  "Wrong-way evidence must remain stable between 60 Hz and 120 Hz.",
);
assert.equal(
  integrateWrongWayEvidence(0, -1, 7.9, 1),
  0,
  "Low-speed rotation must not trigger wrong-way evidence.",
);
assert.equal(
  integrateWrongWayEvidence(0, -0.34, 40, 1),
  0,
  "Hard-turn heading error must not trigger below the reversal threshold.",
);
assert.equal(resolveWrongWayActive(false, 0.64), false);
assert.equal(resolveWrongWayActive(false, 0.65), true);
assert.equal(resolveWrongWayActive(true, 0.18), true);
assert.equal(resolveWrongWayActive(true, 0.17), false);

assert.equal(isTurnCueBeyondFinish(280, 60, true), true);
assert.equal(isTurnCueBeyondFinish(0, 360, true), false);
assert.equal(isTurnCueBeyondFinish(280, 60, false), false);
assert.equal(isTurnCueBeyondFinish(Number.NaN, 60, true), false);

assert.equal(checkpointRequiresExtraCircuit(0.4, 0.2), true);
assert.equal(checkpointRequiresExtraCircuit(0.2, 0.4), false);
assert.equal(checkpointRequiresExtraCircuit(0.9, null), false);

const cleanFiveLapDistance = calculateFinishDistanceMeters(
  0.25,
  1,
  5,
  COURSE_LENGTH,
  0.4,
);
assert.equal(cleanFiveLapDistance, COURSE_LENGTH * 4.75);

const missedGateDistance = calculateFinishDistanceMeters(
  0.25,
  1,
  5,
  COURSE_LENGTH,
  0.2,
);
assert.equal(missedGateDistance, COURSE_LENGTH * 5.75);

const finishArmedDistance = calculateFinishDistanceMeters(
  0.75,
  5,
  5,
  COURSE_LENGTH,
  null,
);
assert.equal(finishArmedDistance, COURSE_LENGTH * 0.25);

assert.deepEqual(resolveFinishPresentation(COURSE_LENGTH * 5, 1, 5, false), {
  label: "12.6 KM TO FINISH",
  finalLap: false,
  finalApproach: false,
});
assert.deepEqual(resolveFinishPresentation(630, 5, 5, false), {
  label: "630 M TO FINISH",
  finalLap: true,
  finalApproach: false,
});
assert.deepEqual(resolveFinishPresentation(256, 5, 5, true), {
  label: "260 M · THE CRADLE",
  finalLap: true,
  finalApproach: true,
});
assert.deepEqual(resolveFinishPresentation(Number.NaN, 1, 1, false), {
  label: "0 M TO FINISH",
  finalLap: true,
  finalApproach: false,
});
assert.deepEqual(resolveInitialRacePresentation(1, COURSE_LENGTH), {
  totalLaps: 1,
  lapLabel: "LAP 1 / 1",
  finishLabel: "2.5 KM TO FINISH",
});
assert.deepEqual(resolveInitialRacePresentation(5, COURSE_LENGTH), {
  totalLaps: 5,
  lapLabel: "LAP 1 / 5",
  finishLabel: "12.6 KM TO FINISH",
});
assert.deepEqual(resolveInitialRacePresentation(Number.NaN, Number.NaN), {
  totalLaps: 1,
  lapLabel: "LAP 1 / 1",
  finishLabel: "0 M TO FINISH",
});
assert.equal(resolveRaceStage(false, 1, 5), "running");
assert.equal(resolveRaceStage(true, 4, 5), "running");
assert.equal(resolveRaceStage(false, 5, 5), "final");
assert.equal(resolveRaceStage(true, 5, 5), "approach");
assert.deepEqual(resolveBoostPresentation(false, false), {
  label: "PLASMA RESERVE",
  state: "ready",
});
assert.deepEqual(resolveBoostPresentation(true, false), {
  label: "PLASMA DISCHARGE",
  state: "active",
});
assert.deepEqual(resolveBoostPresentation(false, true), {
  label: "BOOST LOCKOUT · RELEASE",
  state: "locked",
});
assert.deepEqual(
  resolveBoostPresentation(true, true),
  { label: "BOOST LOCKOUT · RELEASE", state: "locked" },
  "Manual lockout must remain visible while a course pad supplies boost.",
);

assert.ok(isCircularHazardContact(781.2, -8.4, 781.24, -8.5, COURSE_LENGTH));
assert.ok(isCircularHazardContact(0.8, 7, COURSE_LENGTH - 0.5, 7, COURSE_LENGTH));
assert.ok(!isCircularHazardContact(781.2, 0, 781.24, -8.5, COURSE_LENGTH));
assert.ok(!isCircularHazardContact(790, -8.5, 781.24, -8.5, COURSE_LENGTH));

assert.deepEqual(calculateRecoveryTelemetry(0, 1.4), {
  active: false,
  progress: 0,
  remainingSeconds: 1.4,
});
assert.deepEqual(calculateRecoveryTelemetry(0.7, 1.4), {
  active: true,
  progress: 0.5,
  remainingSeconds: 0.7,
});
assert.deepEqual(calculateRecoveryTelemetry(2, 1.4), {
  active: true,
  progress: 1,
  remainingSeconds: 0,
});
assert.deepEqual(calculateRecoveryTelemetry(Number.NaN, 0), {
  active: false,
  progress: 0,
  remainingSeconds: 0.001,
});

console.log(
  "Race rules PASS: countdown, turn urgency, open-edge and hysteretic wrong-way warnings, final-route filtering, forward crossings, wraparound, missed-gate penalty, finish and boost presentation, cable contacts, recovery telemetry.",
);
