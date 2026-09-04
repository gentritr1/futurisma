import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as THREE from "three";
import { transformWithOxc } from "vite";
import {
  CEILING_HEIGHT, FLIP_SECONDS, FLIP_COOLDOWN_SECONDS, SURGE_SECONDS, SHIELD_SECONDS,
} from "../src/game/polarity-rules.js";
import { disposeObject3DResources } from "../src/game/graphics-resources.js";

// Execute the production TS modules. Only browser services are replaced; the
// actual course, input edge handling, world markers and runtime all run here.
async function moduleUrl(relative, imports = {}, embeddedRoute = false) {
  const file = new URL(relative, import.meta.url);
  const source = await readFile(file, "utf8");
  let { code } = await transformWithOxc(source, file.pathname);
  const replacements = { three: import.meta.resolve("three"), ...imports };
  for (const [specifier, resolved] of Object.entries(replacements)) {
    code = code.replaceAll(`from ${JSON.stringify(specifier)}`, `from ${JSON.stringify(resolved)}`);
  }
  if (embeddedRoute) {
    const route = await readFile(new URL("../src/game/data/polarity/route.json", import.meta.url), "utf8");
    code = code.replace('import route from "./data/polarity/route.json";', `const route = ${route};`);
    const pace = await readFile(new URL("../src/game/data/polarity/rival-pace.json", import.meta.url), "utf8");
    code = code.replace('import rivalPace from "./data/polarity/rival-pace.json";', `const rivalPace = ${pace};`);
  }
  return `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
}
const local = name => new URL(`../src/game/${name}`, import.meta.url).href;
const courseUrl = await moduleUrl("../src/game/polarity-course.ts", {
  "./apron.js": local("apron.js"), "./polarity-rules.js": local("polarity-rules.js"),
}, true);
// Blender loading is validated separately. The production phase fields/signs,
// course geometry and runtime remain real in this no-network test.
const fieldUrl = `data:text/javascript;base64,${Buffer.from(`import * as THREE from ${JSON.stringify(import.meta.resolve("three"))};
export class PowerPickupField { root = new THREE.Group(); ready = Promise.resolve(); update() {} dispose() {} }`).toString("base64")}`;
const worldUrl = await moduleUrl("../src/game/polarity-world.ts", {
  "./polarity-course": courseUrl, "./power-pickup-field": fieldUrl,
  "./polarity-simulation.js": local("polarity-simulation.js"),
});
const inputUrl = await moduleUrl("../src/game/input.ts", {
  "./action-gate": local("action-gate.js"), "./input-shaping": local("input-shaping.js"),
});
const runtimeUrl = await moduleUrl("../src/game/polarity-runtime.ts", {
  "./polarity-rules.js": local("polarity-rules.js"), "./polarity-world": worldUrl,
  "./polarity-course": courseUrl, "./polarity-simulation.js": local("polarity-simulation.js"),
  "./ability-seed": await moduleUrl("../src/game/ability-seed.ts"),
});

const elements = new Map();
class ElementStub {
  id = "";
  hidden = false;
  textContent = "";
  dataset = {};
  style = {};
  removed = false;
  width = 0;
  height = 0;
  getContext() {
    // Canvas drawing is outside this test. Keeping the real CanvasTexture and
    // marker geometry still exercises hierarchy, transform and disposal paths.
    return { fillRect() {}, strokeRect() {}, fillText() {} };
  }
  remove() { this.removed = true; elements.delete(this.id); }
}
for (const id of ["polarity-hud", "polarity-deck", "polarity-flip", "polarity-power", "polarity-route", "power-charge-fill", "gravity-veil"]) {
  const element = new ElementStub(); element.id = id; elements.set(id, element);
}
const windowStub = new EventTarget();
const documentStub = {
  getElementById: id => elements.get(id) ?? null,
  createElement: () => new ElementStub(),
  body: { append(element) { elements.set(element.id, element); } },
};
const originals = new Map();
const gamepads = [];
const gamepad = { axes: [0, 0], buttons: Array.from({ length: 10 }, () => ({ pressed: false, value: 0 })) };
for (const [name, value] of Object.entries({ window: windowStub, document: documentStub, navigator: { getGamepads: () => gamepads }, location: { search: "?diagnostics" } })) {
  originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
}
const { InputController } = await import(inputUrl);
const { PolarityCourse } = await import(courseUrl);
const { PolarityRuntime } = await import(runtimeUrl);
const input = new InputController();
const course = new PolarityCourse();
const calls = [];
const audio = Object.fromEntries(["playPowerDenied", "playGravityFlip", "playPowerPickup", "playPowerActivate"].map(name => [name, (...args) => calls.push({ name, args })]));
const messages = [];
const ui = { flashHazard: (message, duration) => messages.push({ message, duration }) };
let runtime;
const dt = 1 / 120;
const close = (actual, expected, epsilon, label) => assert.ok(Math.abs(actual - expected) <= epsilon, `${label}: ${actual} versus ${expected}.`);
function key(code, pressed, repeat = false) {
  const event = new Event(pressed ? "keydown" : "keyup", { cancelable: true });
  Object.assign(event, { code, repeat });
  windowStub.dispatchEvent(event);
  return event;
}
function press(code) { key(code, true); input.read(); key(code, false); }
const camera = new THREE.PerspectiveCamera(57, 16 / 9, .1, 1800);
const forward = new THREE.Vector3(0, 0, -1);
const position = new THREE.Vector3();
const sample = course.createProjectionScratch();
const state = {};
function present(progress = .08) {
  course.sample(progress, sample);
  position.copy(sample.position);
  runtime.present(sample, position, forward, state);
  runtime.updateCamera(camera, 1 / 60, position, forward, 90);
  runtime.updateHud(progress);
  assert.ok([...position, ...sample.up, ...sample.right, ...camera.position, ...camera.quaternion, ...camera.projectionMatrix.elements].every(Number.isFinite), "Gravity presentation and camera must remain finite.");
  close(sample.up.length(), 1, 1e-7, "Unit presentation up");
  close(sample.right.length(), 1, 1e-7, "Unit presentation right");
  close(sample.up.dot(sample.right), 0, 1e-7, "Orthogonal presentation basis");
  return JSON.parse(elements.get("polarity-diagnostics").textContent);
}
function step(frames, progress = .08, lateral = 0, lap = 1) {
  for (let index = 0; index < frames; index += 1) runtime.step(dt, progress, lateral, lap);
}
function flip(progress = .08, lateral = 0, running = true) {
  press("Space");
  course.sample(progress, sample);
  position.copy(sample.position).addScaledVector(sample.right, lateral);
  return runtime.handleActions(running, progress, position, lateral, false);
}
try {
  // The existing maps keep both Space and Shift as nitro. Polarity rebinds only
  // Space to one flip edge and keeps Shift available for sustained nitro.
  key("Space", true); assert.equal(input.read().boost, true); assert.equal(input.consumeFlip(), false); key("Space", false);
  key("ShiftLeft", true); assert.equal(input.read().boost, true); key("ShiftLeft", false);
  key("KeyE", true); input.read(); assert.equal(input.consumePower(), false); key("KeyE", false);
  runtime = new PolarityRuntime(course, input, audio, ui, false);
  runtime.reset();
  assert.equal(elements.get("polarity-hud").hidden, false);
  key("Space", true); assert.equal(input.read().boost, false); assert.equal(input.consumeFlip(), true); assert.equal(input.consumeFlip(), false);
  key("Space", true, true); input.read(); assert.equal(input.consumeFlip(), false, "Held Space must not flip repeatedly."); key("Space", false);
  for (const code of ["ShiftLeft", "ShiftRight"]) { key(code, true); assert.equal(input.read().boost, true); key(code, false); }
  key("KeyE", true); input.read(); assert.equal(input.consumePower(), true); key("KeyE", true, true); input.read(); assert.equal(input.consumePower(), false); key("KeyE", false);

  // Gravity/power actions are also deliberate demo takeovers, including the
  // gamepad X/B edges whose axes and triggers can remain neutral.
  input.consumeControlIntent();
  press("KeyE");
  assert.equal(input.consumePower(), true);
  assert.equal(input.consumeControlIntent(), true, "Accepted E exits the demo driver.");
  assert.equal(input.consumeControlIntent(), false, "Control intent is consumed once.");
  gamepads.push(gamepad);
  for (const [button, consume] of [[2, () => input.consumeFlip()], [1, () => input.consumePower()]]) {
    gamepad.buttons[button].pressed = true;
    input.read();
    assert.equal(consume(), true);
    assert.equal(input.consumeControlIntent(), true, "Accepted gamepad X/B exits the demo driver.");
    input.read();
    assert.equal(consume(), false, "A held gamepad button does not retrigger.");
    assert.equal(input.consumeControlIntent(), false);
    gamepad.buttons[button].pressed = false;
    input.read();
  }
  input.suspendActionsUntilRelease();
  gamepad.buttons[2].pressed = gamepad.buttons[1].pressed = true;
  input.read();
  assert.equal(input.consumeFlip(), false); assert.equal(input.consumePower(), false);
  assert.equal(input.consumeControlIntent(), false, "Suppressed pad actions cannot take over the demo.");
  gamepad.buttons[2].pressed = gamepad.buttons[1].pressed = false;
  input.read();
  gamepads.length = 0;
  input.read();

  input.suspendActionsUntilRelease();
  for (const code of ["Space", "KeyE"]) key(code, true);
  input.read(); assert.equal(input.consumeFlip(), false); assert.equal(input.consumePower(), false);
  for (const code of ["Space", "KeyE"]) key(code, false);
  input.read(); // A neutral frame rearms input after interruption.
  press("Space"); assert.equal(input.consumeFlip(), true);
  press("KeyE"); assert.equal(input.consumePower(), true);

  // Actions are consumed during pause and cannot leak into the resumed race.
  press("Space"); press("KeyE");
  assert.equal(runtime.handleActions(false, .08, position, 0, false), false);
  assert.equal(runtime.handleActions(true, .08, position, 0, false), false);
  assert.equal(runtime.flips, 0);
  assert.equal(flip(.08, 9), false, "The upper road is narrower; edge transfers must be denied.");
  assert.match(messages.at(-1).message, /CENTRE/);
  const blockedProgress = (course.shortcuts[0].from + course.shortcuts[0].to) / 2;
  assert.equal(course.transferAvailable(blockedProgress), false);
  assert.equal(flip(blockedProgress), false, "A separated shortcut is not a transfer window.");
  assert.equal(course.lane, 0);
  assert.equal(runtime.flips, 0);

  assert.equal(flip(), true);
  assert.equal(course.lane, 1);
  assert.equal(position.y, CEILING_HEIGHT, "Physics changes deck immediately; presentation owns the smooth transfer.");
  assert.equal(runtime.blend, 0);
  assert.equal(runtime.isFlipping, true);
  assert.equal(flip(), false, "A second press during transfer is denied.");
  let previousHeight = 0;
  for (let frame = 0; frame < Math.ceil(FLIP_SECONDS / dt) + 1; frame += 1) {
    step(1);
    present();
    assert.ok(position.y >= previousHeight - 1e-10 && position.y <= CEILING_HEIGHT + 1e-10);
    previousHeight = position.y;
  }
  assert.equal(runtime.isFlipping, false);
  close(position.y, CEILING_HEIGHT, 1e-8, "Settled ceiling height");
  assert.ok(sample.up.y < -.999 && camera.up.y < -.999, "The vehicle and camera both settle inverted.");
  assert.equal(state.gravitySign, -1);
  assert.equal(state.gravityTransition, 0);
  assert.equal(flip(), false, "Completing a flip does not bypass its longer cooldown.");
  step(Math.ceil(FLIP_COOLDOWN_SECONDS / dt) + 1);
  assert.equal(flip(), false, "The same entry cannot be reused after its cooldown.");
  assert.equal(flip(.445), true);
  step(Math.ceil(FLIP_SECONDS / dt) + 1);
  present();
  assert.equal(course.lane, 0);
  assert.ok(sample.up.y > .999 && camera.up.y > .999);
  close(position.y, 0, 1e-8, "Returned floor height");

  // Rendering and paused input must not advance a transfer or cooldown clock.
  runtime.reset(); assert.equal(flip(), true); step(25); const frozen = present();
  const capsule = runtime.world.root.children.find(child => child.isInstancedMesh);
  const frozenMatrices = [...capsule.instanceMatrix.array];
  for (let frame = 0; frame < 240; frame += 1) {
    runtime.handleActions(false, .08, position, 0, false);
    const current = present();
    assert.equal(current.blend, frozen.blend);
    assert.equal(current.cooldown, frozen.cooldown);
    assert.equal(current.upperSeconds, frozen.upperSeconds);
  }
  assert.deepEqual([...capsule.instanceMatrix.array], frozenMatrices, "Paused world marker animation must freeze with game time.");
  runtime.recover(.30); present(.30);
  assert.equal(course.lane, 0); assert.equal(runtime.isFlipping, false); assert.equal(runtime.blend, 0);
  assert.equal(present(.30).cooldown, FLIP_COOLDOWN_SECONDS, "Recovery cannot bypass route commitment.");
  assert.equal(runtime.surgeActive, false); assert.equal(runtime.shieldActive, false);

  // The finish coast advances only clocks: an already-started transfer must
  // land normally, while passing power capsules cannot change the finished run.
  runtime.reset(); assert.equal(flip(.08), true);
  step(20, .091);
  assert.equal(runtime.isFlipping, true);
  const coastPickupEvents = calls.filter(call => call.name === "playPowerPickup").length;
  for (let frame = 0; frame < 840; frame += 1) {
    const coastProgress = .091 + frame * .0003;
    runtime.advanceClocks(dt);
    runtime.handleActions(false, coastProgress, position, 0, false);
    present(coastProgress);
  }
  assert.equal(runtime.isFlipping, false);
  assert.equal(runtime.ceiling, true);
  close(runtime.blend, 1, 1e-8, "A transfer settles during finish coast");
  close(position.y, CEILING_HEIGHT, 1e-8, "Finish-coast landing height");
  assert.ok(camera.up.y < -.999);
  assert.equal(runtime.pickups, 0, "Finish coast cannot collect the upper capsule it crosses.");
  assert.equal(calls.filter(call => call.name === "playPowerPickup").length, coastPickupEvents);
  assert.equal(present(.15).cooldown, 0, "Coasting also settles the transfer cooldown.");

  // Record actual pickup crossings with the production inventory rules.
  runtime.reset();
  runtime.step(dt, .034, 0, 1); runtime.step(dt, .036, 0, 1);
  assert.equal(runtime.pickups, 1);
  assert.equal(present(.036).heldPower, "surge");
  assert.equal(state.powerReady, true);
  press("KeyE"); runtime.handleActions(true, .036, position, 0, false);
  assert.equal(runtime.surgeActive, true); assert.equal(runtime.powersUsed, 1);
  assert.equal(present(.036).heldPower, null); assert.equal(state.overdriveActive, true);
  const activeBefore = present(.036).powerTime;
  for (let frame = 0; frame < 180; frame += 1) { runtime.handleActions(false, .036, position, 0, false); present(.036); }
  assert.equal(present(.036).powerTime, activeBefore, "Pause must freeze power duration.");
  press("KeyE"); runtime.handleActions(true, .036, position, 0, false);
  assert.equal(runtime.powersUsed, 1, "A consumed capsule cannot activate twice.");
  let speed = 90;
  const thrust = { throttle: 1, brake: 0, steer: 0, boost: false };
  for (let frame = 0; frame < Math.ceil(SURGE_SECONDS / dt) + 1; frame += 1) {
    speed = runtime.applySurge(speed, Math.min(speed, 112), thrust, dt);
    assert.ok(speed <= 140 && speed >= 90);
    runtime.step(dt, .036, 0, 1);
  }
  assert.equal(runtime.surgeActive, false);
  const released = runtime.applySurge(130, 125, thrust, dt);
  assert.ok(released < 130 && released > 112, "Releasing surge cannot accelerate the craft.");
  const braking = runtime.applySurge(130, 110, { ...thrust, brake: 1 }, dt);
  assert.ok(braking < released, "Braking must release surplus surge speed faster.");

  runtime.reset(); runtime.recover(.179);
  runtime.step(dt, .181, 8, 1); assert.equal(runtime.pickups, 0, "Missing the capsule laterally earns nothing.");
  runtime.recover(.179); runtime.step(dt, .181, -3, 1);
  assert.equal(runtime.pickups, 1); assert.equal(present(.181).heldPower, "shield");
  press("KeyE"); runtime.handleActions(true, .181, position, -3, false);
  assert.equal(runtime.shieldActive, true); assert.equal(present(.181).activePower, "shield"); assert.equal(state.shieldActive, true);
  step(Math.floor((SHIELD_SECONDS - .02) / dt), .181, -3);
  assert.equal(runtime.shieldActive, true, "Shield remains active until its advertised duration.");
  step(5, .181, -3); assert.equal(runtime.shieldActive, false);
  runtime.recover(.179); runtime.step(dt, .181, -3, 1);
  assert.equal(runtime.pickups, 1, "Recovery cannot farm an already collected capsule in the same lap.");
  runtime.recover(.179); runtime.step(dt, .181, -3, 2);
  assert.equal(runtime.pickups, 2, "A fresh lap replenishes capsules.");

  // A flip in flight must not pick up capsules from the destination deck.
  runtime.reset(); assert.equal(flip(.08), true);
  runtime.step(dt, .094, 0, 1); runtime.step(dt, .096, 0, 1);
  assert.equal(runtime.pickups, 0);
  runtime.reset();
  assert.equal(runtime.flips, 0); assert.equal(runtime.pickups, 0); assert.equal(runtime.powersUsed, 0); assert.equal(runtime.upperSeconds, 0);
  assert.equal(present().heldPower, null);
  assert.equal(state.powerReady, false); assert.equal(state.shieldActive, false); assert.equal(state.overdriveActive, false);
  assert.ok(calls.some(call => call.name === "playGravityFlip"));
  assert.ok(calls.some(call => call.name === "playPowerPickup"));
  assert.ok(calls.some(call => call.name === "playPowerActivate" && call.args[0] === "shield"));
  assert.ok(calls.some(call => call.name === "playPowerDenied"));
  runtime.dispose();
  // Reduced motion makes one occluded deck cut; there is no animated 180° roll.
  runtime = new PolarityRuntime(course, input, audio, ui, true);
  runtime.reset(); assert.equal(flip(.05), true);
  let previousUp = 1, cuts = 0;
  for (let frame = 0; frame <= 128; frame++) {
    present(.05);
    assert.ok(Math.abs(sample.up.y) > .999999 && Math.abs(camera.up.y) > .999999,
      "Reduced motion keeps both camera and craft upright on their current deck.");
    assert.ok(position.y === 0 || position.y === CEILING_HEIGHT);
    if (previousUp !== Math.sign(sample.up.y)) {
      cuts++; assert.equal(elements.get("gravity-veil").style.opacity, "1", "The deck cut must be fully occluded.");
    }
    previousUp = Math.sign(sample.up.y);
    step(1, .05);
  }
  assert.equal(cuts, 1);
  assert.equal(elements.get("gravity-veil").style.opacity, "0");
  assert.equal(camera.fov, 62);
  runtime.reset();
  assert.equal(elements.get("gravity-veil").style.opacity, "0");
  runtime.dispose();
  assert.equal(elements.get("polarity-hud").hidden, true);
  assert.equal(elements.has("polarity-diagnostics"), false);
  console.log("Polarity runtime PASS: keyboard/gamepad action edges and demo takeovers, suppression, committed junctions, inverted finite camera, reduced-motion occluded cut, paused timers/markers, finished-coast landing without pickups, recovery/reset, capsule inventory, shield duration and bounded surge release.");
} finally {
  input.dispose();
  runtime?.dispose();
  disposeObject3DResources(course.group);
  for (const [name, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete globalThis[name];
  }
}
