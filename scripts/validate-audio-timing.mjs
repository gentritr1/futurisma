import assert from "node:assert/strict";
import {
  advanceFixedRateDeadline,
  fixedRateUpdateDue,
  nextQuantizedTime,
} from "../src/game/audio-timing.js";

const bar = 60 / 174 * 4;
const origin = 0.08;

assert.equal(nextQuantizedTime(0, origin, bar), origin);
assert.equal(nextQuantizedTime(origin, origin, bar), origin);
assert.ok(Math.abs(nextQuantizedTime(origin + 0.2, origin, bar) - (origin + bar)) < 1e-9);
assert.ok(Math.abs(nextQuantizedTime(origin + bar, origin, bar) - (origin + bar)) < 1e-9);
assert.equal(nextQuantizedTime(2, 3, 0), 3);

function countFixedRateUpdates(renderHz, seconds, controlHz) {
  const frameInterval = 1 / renderHz;
  const controlInterval = 1 / controlHz;
  let deadline = 0;
  let updates = 0;
  for (let frame = 0; frame <= renderHz * seconds; frame += 1) {
    const now = frame * frameInterval;
    if (!fixedRateUpdateDue(now, deadline, controlInterval)) continue;
    updates += 1;
    deadline = advanceFixedRateDeadline(now, deadline, controlInterval);
  }
  return updates;
}

assert.equal(countFixedRateUpdates(60, 10, 30), 301);
assert.equal(countFixedRateUpdates(120, 10, 30), 301);
assert.equal(advanceFixedRateDeadline(5, 0.2, 1 / 30), 5 + 1 / 30);

console.log(
  "Audio timing PASS: 174 BPM bar boundaries and stable 30 Hz control at 60/120 Hz rendering.",
);
