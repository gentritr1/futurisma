import assert from "node:assert/strict";
import { resolveActionSuppression } from "../src/game/action-gate.js";
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

assert.equal(resolveActionSuppression(false, false), false);
assert.equal(
  resolveActionSuppression(true, true),
  true,
  "A held action control must stay suppressed across an interruption.",
);
assert.equal(
  resolveActionSuppression(true, false),
  false,
  "The neutral frame must rearm without accepting a queued action.",
);
assert.equal(
  resolveActionSuppression(false, true),
  false,
  "A fresh action after rearming must be accepted.",
);

console.log(
  "Control mode PASS: deliberate input requests manual takeover and interrupted action edges require a fresh release/press.",
);
