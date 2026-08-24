import assert from "node:assert/strict";
import {
  calculateFinishDistanceMeters,
  checkpointRequiresExtraCircuit,
  crossedForwardProgress,
  forwardProgressDelta,
  isCircularHazardContact,
} from "../src/game/race-rules.js";

const COURSE_LENGTH = 2_516;

assert.ok(crossedForwardProgress(0.1, 0.13, 0.12));
assert.ok(crossedForwardProgress(0.99, 0.01, 0));
assert.ok(!crossedForwardProgress(0.13, 0.1, 0.12));
assert.ok(!crossedForwardProgress(0.1, 0.11, 0.12));
assert.ok(forwardProgressDelta(0.99, 0.01) > 0);
assert.ok(forwardProgressDelta(0.01, 0.99) < 0);

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

console.log(
  "Race rules PASS: forward crossings, wraparound, missed-gate penalty, finish distance, cable contacts.",
);
