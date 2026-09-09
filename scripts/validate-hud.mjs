/**
 * HUD pass — the logic a screenshot cannot check.
 *
 * Three things are asserted here:
 *
 * 1. The quit-hold state machine, including the case that motivated it: a hold
 *    started on the QUIT button must die when focus leaves the button, even
 *    though the key is still physically down.
 * 2. The ability text readers, against the phrases the three circuit runtimes
 *    actually write - copied from `polarity-runtime.ts`, `tideline-runtime.ts`
 *    and `ascension-powers.ts` rather than invented here, because the whole
 *    point of reading their words is that their words are the contract.
 * 3. The interface scale, including that an unknown or missing stored value
 *    lands on the size the game shipped at.
 */

import assert from "node:assert/strict";
import {
  QUIT_HOLD_SECONDS,
  QUIT_HOLD_MAX_STEP,
  createQuitHoldState,
  quitHoldProgress,
  stepQuitHold,
} from "../src/game/quit-hold.js";
import {
  readCharge,
  readDeck,
  readDeviceKind,
  readDeviceState,
} from "../src/game/ability-text.js";
import {
  hudScaleValue,
  menuScaleValue,
  viewportScale,
} from "../src/game/interface-scale.js";

/* ------------------------------------------------------------------ quit hold */

const baseInputs = {
  paused: true,
  terminalOpen: false,
  actionsSuppressed: false,
  escapeHeld: false,
  buttonHeld: false,
  buttonFocused: false,
};

/** Run `frames` steps of `delta`, returning whether the quit fired. */
function hold(state, inputs, seconds, delta = 1 / 60) {
  let fired = false;
  for (let elapsed = 0; elapsed < seconds; elapsed += delta) {
    if (stepQuitHold(state, inputs, delta)) fired = true;
  }
  return fired;
}

// An uninterrupted hold on a focused button quits.
{
  const state = createQuitHoldState();
  const inputs = { ...baseInputs, buttonHeld: true, buttonFocused: true };
  assert.equal(hold(state, inputs, 0.5), false, "half a hold must not quit");
  assert.ok(quitHoldProgress(state) > 0.5, "progress must be visible mid-hold");
  assert.equal(hold(state, inputs, 0.5), true, "a full hold must quit");
}

// THE CASE THIS EXISTS FOR: hold Enter on QUIT, Tab away, keep holding.
// The key never comes up on the button, so an event-latched hold would run to
// completion off-screen. Focus is re-tested every frame, so this one dies.
{
  const state = createQuitHoldState();
  const focused = { ...baseInputs, buttonHeld: true, buttonFocused: true };
  hold(state, focused, 0.6);
  const blurred = { ...baseInputs, buttonHeld: true, buttonFocused: false };
  assert.equal(hold(state, blurred, 3), false, "a blurred button must not quit");
  assert.equal(state.elapsed, 0, "the hold must reset, not pause, on blur");
  // And it must not complete on the very frame focus is lost either.
  const edge = createQuitHoldState();
  hold(edge, focused, QUIT_HOLD_SECONDS - 0.02);
  assert.equal(
    stepQuitHold(edge, blurred, 0.05),
    false,
    "the completing frame must also require focus",
  );
}

// Escape is global: it holds without any focus, because it is not focused on
// anything. It must be armed by a release first, or the press that paused the
// race would quit it.
{
  const state = createQuitHoldState();
  const held = { ...baseInputs, escapeHeld: true };
  assert.equal(hold(state, held, 3), false, "an unreleased Escape must not arm");
  stepQuitHold(state, { ...baseInputs, escapeHeld: false }, 1 / 60);
  assert.equal(hold(state, held, 1.2), true, "Escape quits once armed");
}

// Leaving the pause screen kills a hold in flight, wherever it goes.
for (const exit of [
  { ...baseInputs, paused: false, escapeHeld: true },
  { ...baseInputs, terminalOpen: true, escapeHeld: true },
]) {
  const state = createQuitHoldState();
  stepQuitHold(state, { ...baseInputs }, 1 / 60);
  hold(state, { ...baseInputs, escapeHeld: true }, 0.6);
  assert.equal(hold(state, exit, 3), false, "a hold must not survive leaving pause");
}

// A focus loss that strands a held key resets the hold: this is the case where
// the keyup may never be delivered at all.
{
  const state = createQuitHoldState();
  stepQuitHold(state, { ...baseInputs }, 1 / 60);
  hold(state, { ...baseInputs, escapeHeld: true }, 0.6);
  const suppressed = { ...baseInputs, escapeHeld: true, actionsSuppressed: true };
  assert.equal(hold(state, suppressed, 3), false, "suppressed actions must not quit");
}

// A stalled frame cannot satisfy a whole hold on its own.
{
  const state = createQuitHoldState();
  stepQuitHold(state, { ...baseInputs }, 1 / 60);
  const inputs = { ...baseInputs, escapeHeld: true };
  assert.equal(stepQuitHold(state, inputs, 30), false, "one stalled frame must not quit");
  assert.ok(
    state.elapsed <= QUIT_HOLD_MAX_STEP + 1e-9,
    "a frame may contribute at most the clamp",
  );
}

// Swapping source mid-hold restarts: two half-holds are not one hold.
{
  const state = createQuitHoldState();
  stepQuitHold(state, { ...baseInputs }, 1 / 60);
  hold(state, { ...baseInputs, escapeHeld: true }, 0.6);
  const button = { ...baseInputs, buttonHeld: true, buttonFocused: true };
  assert.equal(hold(state, button, 0.5), false, "the swap must restart the hold");
}

// One hold fires once.
{
  const state = createQuitHoldState();
  const inputs = { ...baseInputs, buttonHeld: true, buttonFocused: true };
  assert.equal(hold(state, inputs, 1.2), true);
  assert.equal(hold(state, inputs, 3), false, "a fired hold must not fire again");
}

/* -------------------------------------------------------------- ability text */

// Phrases copied from the runtimes, not invented for the test.
const DEVICE_PHRASES = [
  // polarity-runtime.ts / tideline-runtime.ts
  ["COLLECT A POWER DEVICE", "empty", null],
  ["COLLECT A DEVICE", "empty", null],
  // ascension-powers.ts
  ["E / SURGE", "held", "surge"],
  ["E / PHASE SHIELD", "held", "shield"],
  ["SURGE 2.6s", "active", "surge"],
  ["PHASE SHIELD 4.1s", "active", "shield"],
  ["CHAIN · BULKHEAD → SURGE / +0.5s", "perfect", "surge"],
  ["PERFECT SURGE 1.6s", "perfect", "surge"],
];
for (const [text, state, kind] of DEVICE_PHRASES) {
  assert.equal(readDeviceState(text), state, `state of "${text}"`);
  assert.equal(readDeviceKind(text), kind, `kind of "${text}"`);
}

// Deck lines, including Ascension's, which names no deck at all.
assert.equal(readDeck("LOWER DECK"), "lower");
assert.equal(readDeck("UPPER EXPRESS · SUPPLY A"), "upper");
assert.equal(readDeck("PAD 09 / LAUNCH DAY"), "none", "a deckless circuit must read none");
assert.equal(readDeck("SUBMERGED / 24m"), "none");

// The charge comes back out of the transform the runtimes already write.
assert.equal(readCharge("scaleX(0.5)"), 0.5);
assert.equal(readCharge("scaleX(1)"), 1);
assert.equal(readCharge(""), 0, "an unset transform is zero charge, not a crash");
assert.equal(readCharge("none"), 0);
assert.equal(readCharge("scaleX(4)"), 1, "charge is clamped");

/* ------------------------------------------------------------ interface scale */

// The stored step.
assert.equal(hudScaleValue("m", 720), 1);
assert.equal(Number(hudScaleValue("s", 720).toFixed(4)), 0.88);
assert.equal(Number(hudScaleValue("l", 720).toFixed(4)), 1.2);
// Anything unrecognised - including a save written before this build - lands on
// the size the game shipped at rather than on a guess.
assert.equal(hudScaleValue(undefined, 720), 1, "a missing setting is the shipped size");
assert.equal(hudScaleValue("xl", 720), 1, "an unknown setting is the shipped size");
assert.equal(menuScaleValue(undefined), 1);
assert.equal(Number(menuScaleValue("l").toFixed(4)), 1.15);

// The viewport term never shrinks the HUD and never runs away.
assert.equal(viewportScale(720), 1, "the authored height is a no-op");
assert.equal(viewportScale(360), 1, "a short viewport must not shrink the HUD");
assert.ok(Math.abs(viewportScale(1080) - 1.2247) < 0.001, "1080p compensates by sqrt");
assert.equal(viewportScale(4000), 1.35, "the term is clamped");
assert.equal(viewportScale(Number.NaN), 1, "a bad height falls back rather than throwing");
assert.equal(viewportScale(0), 1);

// The two combine, and 1080p at L is the largest thing the HUD can be.
const largest = hudScaleValue("l", 1080);
assert.ok(Math.abs(largest - 1.2 * 1.2247) < 0.002, "L at 1080p is the step times the term");

console.log("validate:hud — quit hold, ability text and interface scale all pass");
