import assert from "node:assert/strict";
import {
  advanceFixedRateDeadline,
  encodeMusicProfileKey,
  fixedRateUpdateDue,
  MUSIC_LOOP_BEATS,
  MUSIC_STEM_SAMPLE_RATE,
  nextQuantizedTime,
  sampleLinearAutomation,
} from "../src/game/audio-timing.js";

const bar = 60 / 174 * 4;
const origin = 0.08;

assert.equal(MUSIC_LOOP_BEATS, 16);
assert.equal(MUSIC_STEM_SAMPLE_RATE, 24_000);

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

const profileKeys = new Set();
for (let trance = 0; trance <= 3; trance += 1) {
  for (let jungle = 0; jungle <= 3; jungle += 1) {
    for (let deepDnb = 0; deepDnb <= 3; deepDnb += 1) {
      for (let techstep = 0; techstep <= 3; techstep += 1) {
        profileKeys.add(encodeMusicProfileKey(trance, jungle, deepDnb, techstep));
      }
    }
  }
}
assert.equal(profileKeys.size, 256);
assert.equal(encodeMusicProfileKey(-1, 4, 2, 3), encodeMusicProfileKey(0, 3, 2, 3));

assert.equal(sampleLinearAutomation(1, 0.2, 0.8, 2, 4), 0.2);
assert.equal(sampleLinearAutomation(3, 0.2, 0.8, 2, 4), 0.5);
assert.equal(sampleLinearAutomation(5, 0.2, 0.8, 2, 4), 0.8);
assert.equal(sampleLinearAutomation(2, 0.2, 0.8, 2, 2), 0.8);

console.log(
  "Audio timing PASS: 174 BPM boundaries, unique stem profiles, interruption-safe ramps, and stable 30 Hz control at 60/120 Hz rendering.",
);
