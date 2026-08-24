import assert from "node:assert/strict";
import { nextQuantizedTime } from "../src/game/audio-timing.js";

const bar = 60 / 174 * 4;
const origin = 0.08;

assert.equal(nextQuantizedTime(0, origin, bar), origin);
assert.equal(nextQuantizedTime(origin, origin, bar), origin);
assert.ok(Math.abs(nextQuantizedTime(origin + 0.2, origin, bar) - (origin + bar)) < 1e-9);
assert.ok(Math.abs(nextQuantizedTime(origin + bar, origin, bar) - (origin + bar)) < 1e-9);
assert.equal(nextQuantizedTime(2, 3, 0), 3);

console.log("Audio timing PASS: Greenwater stem changes stay on 174 BPM bar boundaries.");
