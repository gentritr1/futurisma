import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolveActionSuppression } from "../src/game/action-gate.js";
import { hasPlayerControlIntent } from "../src/game/control-mode.js";
import {
  applySteeringDeadzone,
  resolveSteeringInput,
  sanitizeTrigger,
} from "../src/game/input-shaping.js";

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

assert.equal(applySteeringDeadzone(0.16), 0);
assert.equal(applySteeringDeadzone(-0.08), 0);
assert.ok(applySteeringDeadzone(0.5) > 0);
assert.equal(applySteeringDeadzone(1.4), 1);
assert.equal(applySteeringDeadzone(-1.4), -1);
assert.equal(applySteeringDeadzone(Number.NaN), 0);
assert.equal(applySteeringDeadzone(Number.POSITIVE_INFINITY), 0);
assert.equal(sanitizeTrigger(-0.2), 0);
assert.equal(sanitizeTrigger(1.3), 1);
assert.equal(sanitizeTrigger(Number.NaN), 0);
assert.equal(
  resolveSteeringInput(-1, 1),
  -1,
  "A deliberate keyboard command must override an opposing gamepad axis.",
);
assert.equal(
  resolveSteeringInput(0, Number.NaN),
  0,
  "Invalid gamepad steering must remain neutral.",
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

const mainSource = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");
assert.doesNotMatch(
  mainSource,
  /window\.addEventListener\(["']keydown["']/,
  "Keyboard actions must have one owner so a launch press cannot also pause the trial.",
);

console.log(
  "Control mode PASS: single-owner keyboard actions, sanitized analogue input, deliberate manual takeover, keyboard override, and interruption-safe action edges.",
);
