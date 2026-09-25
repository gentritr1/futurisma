import {resultPresentation} from "../src/game/result-presentation.js";
import {resolveTimingPresentation} from "../src/game/hud-presentation.js";
/**
 * HUD pass — the logic a screenshot cannot check.
 *
 * Three things are asserted here:
 *
 * 1. The quit-hold state machine, including the case that motivated it: a hold
 *    started on the QUIT button must die when focus leaves the button, even
 *    though the key is still physically down.
 * 2. Authoritative ability attributes, independent of display copy.
 * 3. The interface scale, including that an unknown or missing stored value
 *    lands on the size the game shipped at.
 */

import {transformWithOxc} from "vite";
import {isMenuOnlyKey} from "../src/game/menu-key.js";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {INPUT_PROMPTS} from "../src/game/input-prompt-map.js";
import {
  QUIT_HOLD_SECONDS,
  QUIT_HOLD_MAX_STEP,
  createQuitHoldState,
  quitHoldProgress,
  stepQuitHold,
} from "../src/game/quit-hold.js";
import {readAbilityAttributes} from "../src/game/ability-state.js";
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

/* ------------------------------------------------------ ability attributes */
for(const state of ["held","active","perfect","empty"]){
 for(const kind of ["surge","shield"]){
  const result=readAbilityAttributes({device:state,kind,charge:"0.5"},{deck:"upper"},{transfer:"ready"});
  assert.deepEqual(result,{state,kind,charge:.5,deck:"upper",ready:true});
 }
}
assert.deepEqual(readAbilityAttributes({}, {}, {}),{state:"empty",kind:null,charge:0,deck:"none",ready:false});
assert.equal(readAbilityAttributes({charge:"4"},{deck:"lower"},{transfer:"wait"}).charge,1);
assert.equal(readAbilityAttributes({charge:"NaN"},{},{}).charge,0);

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

console.log("validate:hud — quit hold, ability attributes and interface scale all pass");

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
for(const kbd of html.matchAll(/<kbd([^>]*)>/g)){
 const action=/data-prompt="([^"]+)"/.exec(kbd[1])?.[1];
 assert.ok(action && INPUT_PROMPTS[action], 'Every kbd must use the single prompt map');
}
assert.equal(INPUT_PROMPTS.confirm.gamepad,'A');
assert.equal(INPUT_PROMPTS.back.gamepad,'B');

for(const code of ['KeyO','KeyC','KeyG'])assert.equal(isMenuOnlyKey(code),true,'O, C and G are exclusively menu keys');
assert.equal(isMenuOnlyKey('Other','O'),true);
assert.equal(isMenuOnlyKey('KeyW','w'),false);
const inputSource=readFileSync(new URL('../src/game/input.ts',import.meta.url),'utf8');
assert.ok(inputSource.indexOf('if (isMenuOnlyKey(event.code,event.key)) return;')<inputSource.indexOf('this.keys.add(event.code)'), 'Menu keys must return before the race key set');

// Execute InputController itself under the same DOM-free contract as runtime tests.
let {code:inputCode}=await transformWithOxc(inputSource,'input.ts');
for(const [specifier,file] of [['./menu-key.js','menu-key.js'],['./action-gate','action-gate.js'],['./input-shaping','input-shaping.js']])inputCode=inputCode.replaceAll(`from "${specifier}"`,`from "${new URL('../src/game/'+file,import.meta.url).href}"`);
const savedGlobals=new Map(['window','navigator'].map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)]));
const inputWindow=new EventTarget();
Object.defineProperty(globalThis,'window',{configurable:true,value:inputWindow});
Object.defineProperty(globalThis,'navigator',{configurable:true,value:{getGamepads:()=>[]}});
try{
 const {InputController}=await import('data:text/javascript;base64,'+Buffer.from(inputCode).toString('base64'));
 const input=new InputController();
 for(const code of ['KeyO','KeyC']){
  const event=new Event('keydown',{cancelable:true});Object.assign(event,{code,key:code.slice(3).toLowerCase(),repeat:false});inputWindow.dispatchEvent(event);
  assert.equal(input.isHeld(code),false,'Menu shortcuts never enter the race key set');
  assert.deepEqual(input.read(),{throttle:0,brake:0,steer:0,boost:false});
  for(const method of ['consumeStart','consumeReset','consumeMute','consumeFlip','consumePower','consumeControlIntent'])assert.equal(input[method](),false);
 }
 input.dispose();
}finally{for(const [name,descriptor] of savedGlobals){if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name];}}
console.log('HUD menu-key boundary PASS against production InputController.');

for(const mode of ['race','sprint','timeattack']){
 for(const newBestLap of [false,undefined])assert.equal(resultPresentation({mode,newBestLap,previousBestLapMs:90000}).newBestLap,false,'NEW BEST cannot show without the recorded true flag');
 assert.equal(resultPresentation({mode,newBestLap:true}).newBestLap,true);
}
assert.equal(resultPresentation(null).newBestLap,false);
assert.deepEqual(resultPresentation({mode:'timeattack',previousBestLapMs:12345}),{timeAttack:true,newBestLap:false,previousBestLapMs:12345});
console.log('HUD result verdict PASS: no NEW BEST without summary.newBestLap.');

/* ------------------------------------------------------------ timing block */
//
// The four cases the clock block can be in. The two race cases must be
// byte-for-byte what shipped before the helper existed, because the whole
// claim of this change is that only a time attack moved.
{
  const race = resolveTimingPresentation("race", 252_000, 34_500, null);
  assert.deepEqual(race, {tag: "RACE TIME", clockMs: 252_000, secondary: ""},
    "A field race with no completed lap is the tag, the total, and nothing else.");

  const raceWithLast = resolveTimingPresentation("race", 252_000, 34_500, 38_400);
  assert.deepEqual(raceWithLast,
    {tag: "RACE TIME", clockMs: 252_000, secondary: " · LAST 00:38.400"},
    "A completed lap adds the LAST line the HUD already showed, unchanged.");
  assert.deepEqual(resolveTimingPresentation("sprint", 252_000, 34_500, 38_400), raceWithLast,
    "Sprint is a race with fewer laps; its clock block must not differ.");

  const attack = resolveTimingPresentation("timeattack", 252_000, 34_500, null);
  assert.deepEqual(attack,
    {tag: "LAP TIME", clockMs: 34_500, secondary: "TOTAL 04:12.000"},
    "Time attack leads with the lap it is scored on and demotes the total.");

  const attackWithLast = resolveTimingPresentation("timeattack", 252_000, 1_200, 38_400);
  assert.deepEqual(attackWithLast,
    {tag: "LAP TIME", clockMs: 1_200, secondary: "TOTAL 04:12.000 · LAST 00:38.400"},
    "After a lap completes the clock is the new lap and the total keeps running.");
  assert.ok(attackWithLast.clockMs < 1_000 + 1_000,
    "The lap clock restarts at the crossing rather than carrying the race total.");
}
console.log("HUD timing PASS: race/sprint unchanged, time attack leads with the lap.");
