import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { transformWithOxc } from 'vite';
import { TIDELINE_ABILITY_CONFIG, TIDELINE_FIELDS, currentLane } from '../src/game/tideline-rules.js';
import { disposeObject3DResources } from '../src/game/graphics-resources.js';
import { groundBlobVisible } from '../src/game/presentation.js';

const local = name => new URL(`../src/game/${name}`, import.meta.url).href;
async function moduleUrl(relative, replacements = {}, embedRoute = false) {
  const file = new URL(relative, import.meta.url);
  let { code } = await transformWithOxc(await readFile(file, 'utf8'), file.pathname);
  for (const [specifier, resolved] of Object.entries({ three: import.meta.resolve('three'), ...replacements })) {
    code = code.replaceAll(`from ${JSON.stringify(specifier)}`, `from ${JSON.stringify(resolved)}`);
  }
  if (embedRoute) for (const [binding, fileName] of [['route', 'route'], ['rivalPace', 'rival-pace']]) {
    const json = await readFile(new URL(`../src/game/data/tideline/${fileName}.json`, import.meta.url), 'utf8');
    code = code.replace(`import ${binding} from "./data/tideline/${fileName}.json";`, `const ${binding} = ${json};`);
  }
  return `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
}
const fieldUrl = `data:text/javascript;base64,${Buffer.from(`import * as THREE from ${JSON.stringify(import.meta.resolve('three'))};
export class PowerPickupField { static instances = []; root = new THREE.Group(); ready = Promise.resolve(); disposed = false;
 constructor(){PowerPickupField.instances.push(this);} update(...args){this.lastUpdate=args;} dispose(){this.disposed=true;} }`).toString('base64')}`;
const styleUrl = await moduleUrl('../src/game/tideline-style.ts');
const courseUrl = await moduleUrl('../src/game/tideline-course.ts', {
  './apron.js': local('apron.js'), './tideline-rules.js': local('tideline-rules.js'), './tideline-style': styleUrl,
}, true);
const worldUrl = await moduleUrl('../src/game/tideline-world.ts', {
  './power-pickup-field': fieldUrl, './tideline-rules.js': local('tideline-rules.js'),
  './tideline-sky': await moduleUrl('../src/game/tideline-sky.ts', { './tideline-style': styleUrl }),
});
const runtimeUrl = await moduleUrl('../src/game/tideline-runtime.ts', {
  './ability-seed': await moduleUrl('../src/game/ability-seed.ts'), './tideline-world': worldUrl,
  './polarity-rules.js': local('polarity-rules.js'), './polarity-simulation.js': local('polarity-simulation.js'), './tideline-rules.js': local('tideline-rules.js'),
});
const inputUrl = await moduleUrl('../src/game/input.ts', { './action-gate': local('action-gate.js'), './input-shaping': local('input-shaping.js') });
const elements = new Map();
class ElementStub {
  id = ''; hidden = false; textContent = ''; dataset = {}; style = {}; width = 0; height = 0;
  getContext() { return { fillRect() {}, strokeRect() {}, fillText() {} }; }
  remove() { elements.delete(this.id); }
}
for (const id of ['polarity-hud', 'polarity-deck', 'polarity-flip', 'polarity-power', 'polarity-route', 'power-charge-fill']) {
  const element = new ElementStub(); element.id = id; elements.set(id, element);
}
const windowStub = new EventTarget();
const originals = new Map();
for (const [name, value] of Object.entries({ window: windowStub, document: {
  getElementById: id => elements.get(id) ?? null, createElement: () => new ElementStub(), body: { append: element => elements.set(element.id, element) },
}, navigator: { getGamepads: () => [] }, location: { search: '?diagnostics' } })) {
  originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
}
const { InputController } = await import(inputUrl);
const { TidelineCourse } = await import(courseUrl);
const { TidelineRuntime } = await import(runtimeUrl);
const { PowerPickupField } = await import(fieldUrl);
const course = new TidelineCourse(), input = new InputController();
const audioEvents = [], messages = [];
const audio = Object.fromEntries(['playPowerPickup', 'playPowerDenied', 'playPowerActivate'].map(name => [name, (...args) => audioEvents.push({ name, args })]));
const ui = { flashHazard: message => messages.push(message) };
const camera = new THREE.PerspectiveCamera(57, 16 / 9, .1, 1800), sample = course.createProjectionScratch();
const position = new THREE.Vector3(), state = {};
const dt = 1 / 120;
let runtime;
function key(code, down, repeat = false) {
  const event = new Event(down ? 'keydown' : 'keyup', { cancelable: true });
  Object.assign(event, { code, repeat }); windowStub.dispatchEvent(event);
}
function power(progress, running = true) {
  key('KeyE', true); input.read(); key('KeyE', false);
  return runtime.handleActions(running, progress, position, 0, false);
}
function step(count, progress, lateral = 0, lap = 1) { for (let tick = 0; tick < count; tick++) runtime.step(dt, progress, lateral, lap); }
function present(progress) {
  course.sample(progress, sample); position.copy(sample.position).addScaledVector(sample.up, .96);
  const before = { position: position.clone(), up: sample.up.clone(), right: sample.right.clone(), tangent: sample.tangent.clone() };
  runtime.present(sample, position, sample.tangent, state);
  assert.deepEqual(position, before.position, 'Presentation must preserve true depth/elevation.');
  assert.deepEqual(sample.up, before.up); assert.deepEqual(sample.right, before.right); assert.deepEqual(sample.tangent, before.tangent);
  runtime.updateCamera(camera, 1 / 60, position, sample.tangent, 95);
  assert.deepEqual(camera.up, new THREE.Vector3(0, 1, 0), 'Every travel mode keeps a stable world-up horizon.');
  assert.ok([...position, ...camera.position, ...camera.quaternion, ...camera.projectionMatrix.elements].every(Number.isFinite));
  assert.ok(Math.abs(new THREE.Matrix4().makeBasis(sample.right, sample.up, sample.tangent.clone().negate()).determinant() - 1) < 1e-6);
  runtime.updateHud(progress);
  return JSON.parse(elements.get('tideline-diagnostics').textContent);
}
function collect(index, lap = 1) {
  const anchor = TIDELINE_ABILITY_CONFIG.pickups[index];
  runtime.recover(anchor.progress - .001); step(1, anchor.progress + .001, anchor.lateral, lap);
  assert.equal(runtime.simulation.heldPowerKind, runtime.simulation.pickupKind(index, lap));
}
try {
  runtime = new TidelineRuntime(course, input, audio, ui, false, 714); await runtime.ready;
  runtime.reset(); assert.equal(runtime.ceiling, false); assert.equal(runtime.isFlipping, false);
  for (const code of ['Space', 'ShiftLeft']) {
    key(code, true); assert.equal(input.read().boost, true, `${code} stays nitro in Tideline.`);
    assert.equal(input.consumeFlip(), false); key(code, false);
  }
  key('KeyE', true); input.read(); assert.equal(input.consumePower(), true);
  key('KeyE', true, true); input.read(); assert.equal(input.consumePower(), false); key('KeyE', false);
  const modes = new Set();
  for (let station = 0; station < 1000; station++) {
    const progress = station / 1000;
    step(1, progress); const diagnostic = present(progress); modes.add(diagnostic.mode);
    assert.equal(groundBlobVisible(true, course.travelModeAt(progress)), diagnostic.mode !== 'air',
      'Player and rival ground blobs must disappear across each actual flight gap and return over road.');
    assert.equal(groundBlobVisible(false, course.travelModeAt(progress)), false, 'Finished or flipping craft keep hidden blobs.');
    assert.equal(state.gravitySign, 1); assert.equal(state.gravityTransition, 0);
    assert.ok(sample.up.y > .95, 'The craft follows gentle true slopes without a roll reversal.');
  }
  assert.deepEqual([...modes].sort(), ['air', 'submerged', 'surface']);
  assert.equal(groundBlobVisible(true, undefined), true, 'Existing road-only courses keep their contact shadows.');
  const playerSource = await readFile(new URL('../src/game/game.ts', import.meta.url), 'utf8');
  const rivalSource = await readFile(new URL('../src/game/rivals.ts', import.meta.url), 'utf8');
  assert.match(playerSource, /groundBlobVisible\(!this\.circuitRuntime\?\.isFlipping, this\.course\.travelModeAt\?\.\(this\.progress\)\)/);
  assert.match(rivalSource, /groundBlobVisible\(visible, this\.course\.travelModeAt\?\.\(distance \/ this\.course\.length\)\)/);
  const device = PowerPickupField.instances[0];
  assert.equal(device.lastUpdate[0], runtime.simulation.state.tick / 120, 'World devices use simulation time.');

  // The lit current and the granted recharge always agree for either seed phase.
  runtime.reset();
  for (const lap of [1, 2, 3]) {
    const lane = currentLane(714, lap);
    step(1, .1, lane, lap); present(.1); assert.equal(runtime.boostRechargeScale, 1.85);
    assert.equal(runtime.world.currents[0].visible, lane < 0);
    assert.equal(runtime.world.currents[1].visible, lane > 0);
    step(1, .1, -lane, lap); assert.equal(runtime.boostRechargeScale, 1);
    step(1, .21, lane, lap); assert.equal(runtime.boostRechargeScale, 1);
    step(1, .5, lane, lap); assert.equal(runtime.boostRechargeScale, .75);
    step(1, .96, lane, lap); assert.equal(runtime.boostRechargeScale, 1.85);
  }

  runtime.reset(); collect(3); present(.45);
  assert.match(elements.get('polarity-power').textContent, /PERFECT NOW/);
  power(.45, false); assert.equal(runtime.surgeActive, false, 'Paused power input is consumed.');
  runtime.handleActions(true, .45, position, 0, false); assert.equal(runtime.surgeActive, false);
  power(.45); assert.equal(runtime.surgeActive, true); assert.equal(runtime.simulation.powerSeconds, 4);
  assert.equal(runtime.simulation.state.perfectActivations, 1); present(.45);
  assert.equal(state.overdriveActive, true); assert.equal(state.powerCharge, 1);
  const frozen = runtime.simulation.snapshot();
  for (let frame = 0; frame < 120; frame++) present(.45);
  assert.deepEqual(runtime.simulation.snapshot(), frozen, 'Rendering never advances ability state.');
  step(480, .45); assert.equal(runtime.surgeActive, false);
  assert.ok(messages.some(message => message.includes('PERFECT LAUNCH')));

  runtime.reset(); collect(1); power(.15); assert.equal(runtime.shieldActive, true);
  assert.equal(runtime.onShieldImpact(.16, 9), 0, 'An avoided bulkhead does not award a shield reward.');
  const firstField = TIDELINE_FIELDS[0];
  assert.notEqual(course.cableTripSideAt(firstField.progress, firstField.lateral), 0);
  assert.equal(runtime.onShieldImpact(firstField.progress, firstField.lateral), .18);
  assert.equal(runtime.onShieldImpact(firstField.progress, firstField.lateral), 0);
  assert.equal(runtime.simulation.powerSeconds, 7);
  assert.equal(runtime.simulation.state.shieldAbsorptions, 1);
  present(.16); assert.equal(state.shieldActive, true);
  const beforeCoastPickups = runtime.simulation.state.pickups;
  for (let frame = 0; frame < 840; frame++) { runtime.advanceClocks(dt); present(.235 + frame * .00001); }
  assert.equal(runtime.shieldActive, false);
  assert.equal(runtime.simulation.state.pickups, beforeCoastPickups, 'Finish coast cannot collect another capsule.');
  runtime.recover(.119); step(1, .121, -2); assert.equal(runtime.simulation.state.pickups, 1, 'Recovery cannot farm the same capsule.');
  runtime.reset(); assert.equal(runtime.simulation.state.seed, 714);
  assert.equal(runtime.simulation.state.pickups, 0); assert.equal(runtime.simulation.state.powersUsed, 0);
  assert.equal(runtime.simulation.heldPowerKind, null); assert.equal(runtime.shieldActive, false);
  assert.equal(runtime.simulation.state.tick, 0);
  runtime.dispose(); assert.equal(device.disposed, true);
  assert.equal(elements.get('polarity-hud').hidden, true); assert.equal(elements.has('tideline-diagnostics'), false);

  runtime = new TidelineRuntime(course, input, audio, ui, true, 714);
  runtime.reset();
  for (const progress of [.1, .35, .52, .69, .81, .96]) { step(1, progress); present(progress); assert.equal(camera.fov, 62); }
  runtime.dispose();
  // Compile the real course/sky/world/runtime with the other edition flag.
  // Both runtime constructors must retain one ability config and identical
  // command results, even though their material/sky uniforms visibly differ.
  const foundryStyle = `data:text/javascript;base64,${Buffer.from('export const isFoundryEdition = true;').toString('base64')}`;
  const foundryCourseUrl = await moduleUrl('../src/game/tideline-course.ts', {
    './apron.js': local('apron.js'), './tideline-rules.js': local('tideline-rules.js'), './tideline-style': foundryStyle,
  }, true);
  const foundryWorldUrl = await moduleUrl('../src/game/tideline-world.ts', {
    './power-pickup-field': fieldUrl, './tideline-rules.js': local('tideline-rules.js'),
    './tideline-sky': await moduleUrl('../src/game/tideline-sky.ts', { './tideline-style': foundryStyle }),
  });
  const foundryRuntimeUrl = await moduleUrl('../src/game/tideline-runtime.ts', {
    './ability-seed': await moduleUrl('../src/game/ability-seed.ts'), './tideline-world': foundryWorldUrl,
    './polarity-rules.js': local('polarity-rules.js'), './polarity-simulation.js': local('polarity-simulation.js'), './tideline-rules.js': local('tideline-rules.js'),
  });
  const { TidelineCourse: FoundryCourse } = await import(foundryCourseUrl);
  const { TidelineRuntime: FoundryRuntime } = await import(foundryRuntimeUrl);
  const foundryCourse = new FoundryCourse(), foundryInput = new InputController();
  runtime = new TidelineRuntime(course, input, audio, ui, false, 714);
  const foundryRuntime = new FoundryRuntime(foundryCourse, foundryInput, audio, ui, false, 714);
  try {
    await Promise.all([runtime.ready, foundryRuntime.ready]);
    assert.equal(runtime.world.sky.root.material.uniforms.foundry.value, 0);
    assert.equal(foundryRuntime.world.sky.root.material.uniforms.foundry.value, 1);
    assert.deepEqual(foundryRuntime.simulation.config, runtime.simulation.config, 'A visual edition must use the same ability configuration.');
    assert.deepEqual(foundryRuntime.simulation.snapshot(), runtime.simulation.snapshot());
    for (let tick = 0; .002 + tick / 6000 < 3; tick++) {
      const distance = .002 + tick / 6000, progress = distance % 1, lap = Math.floor(distance) + 1;
      for (const racer of [runtime, foundryRuntime]) {
        racer.step(dt, progress, 0, lap);
        racer.handleActions(true, progress, position, 0, true);
        const field = TIDELINE_FIELDS.find(field => Math.abs(field.progress - progress) * course.length < 2);
        if (field && racer.shieldActive) racer.onShieldImpact(progress, 0);
      }
      assert.equal(foundryRuntime.boostRechargeScale, runtime.boostRechargeScale);
      if (tick % 120 === 0) assert.deepEqual(foundryRuntime.simulation.snapshot(), runtime.simulation.snapshot(),
        'The same three-lap input trace must produce identical ability state/events in either edition.');
    }
    assert.deepEqual(foundryRuntime.simulation.snapshot(), runtime.simulation.snapshot());
    assert.equal(runtime.simulation.state.lap, 3);
    assert.ok(runtime.simulation.state.pickups > 3 && runtime.simulation.state.powersUsed > 3, 'The edition trace must exercise real power transitions.');
  } finally {
    foundryRuntime.dispose(); foundryInput.dispose(); disposeObject3DResources(foundryCourse.group);
  }
  runtime.dispose();
  assert.ok(audioEvents.some(event => event.name === 'playPowerActivate' && event.args[0] === 'shield'));
  console.log('Tideline runtime PASS: real 3D depth/height and basis, stable camera horizon in all travel modes, current lane/recharge agreement, nitro/power input, perfect launches, one-shot shield refunds, frozen rendering, coast/reset/disposal, reduced motion; original/Foundry ability configuration and three-lap command traces exactly identical.');
} finally {
  runtime?.dispose(); input.dispose(); disposeObject3DResources(course.group);
  for (const [name, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name];
  }
}
