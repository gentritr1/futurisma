import assert from "node:assert/strict";
import {
  calculateFinishDistanceMeters,
  calculateRecoveryTelemetry,
  checkpointRequiresExtraCircuit,
  crossedForwardProgress,
  forwardProgressDelta,
  isCircularHazardContact,
  resolveCountdownStage,
} from "../src/game/race-rules.js";

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
  "Race rules PASS: countdown, forward crossings, wraparound, missed-gate penalty, finish distance, cable contacts, recovery telemetry.",
);
