import assert from "node:assert/strict";
import { hasPlayerControlIntent } from "../src/game/control-mode.js";

const neutral = { throttle: 0, brake: 0, steer: 0, boost: false };
assert.equal(hasPlayerControlIntent(neutral), false);
assert.equal(
  hasPlayerControlIntent({ ...neutral, steer: 0.049 }),
  false,
  "Small analogue noise must not cancel showcase autopilot.",
);
assert.equal(hasPlayerControlIntent({ ...neutral, throttle: 0.1 }), true);
assert.equal(hasPlayerControlIntent({ ...neutral, brake: 0.1 }), true);
assert.equal(hasPlayerControlIntent({ ...neutral, steer: -0.1 }), true);
assert.equal(hasPlayerControlIntent({ ...neutral, boost: true }), true);
assert.equal(
  hasPlayerControlIntent({ ...neutral, throttle: Number.NaN, steer: Number.NaN }),
  false,
  "Invalid analogue values must not create a takeover.",
);

console.log(
  "Control mode PASS: neutral demo input stays automatic and every deliberate driving control requests manual takeover.",
);
