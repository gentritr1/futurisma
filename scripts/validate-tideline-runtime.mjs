import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { transformWithOxc } from 'vite';
import { TIDELINE_ABILITY_CONFIG, TIDELINE_FIELDS, currentLane } from '../src/game/tideline-rules.js';
import { disposeObject3DResources } from '../src/game/graphics-resources.js';
import { groundBlobVisible } from '../src/game/presentation.js';
import { TIDE_SCHEDULE, tideForLap, tideWaterLevel, tideGrip } from '../src/game/tideline-tide.js';
const route = JSON.parse(await readFile(new URL('../src/game/data/tideline/route.json', import.meta.url), 'utf8'));

const local = name => new URL(`../src/game/${name}`, import.meta.url).href;
async function moduleUrl(relative, replacements = {}, embedRoute = false) {
  const file = new URL(relative, import.meta.url);
  let { code } = await transformWithOxc(await readFile(file, 'utf8'), file.pathname);
  for (const [specifier, resolved] of Object.entries({ three: import.meta.resolve('three'), './tideline-tide.js': local('tideline-tide.js'), ...replacements })) {
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
 constructor(){PowerPickupField.instances.push(this);} update(...args){this.lastUpdate=args;} dispose(){this.disposed=true;} } export {PowerPickupField as TidelineCradles};`).toString('base64')}`;
const styleUrl = await moduleUrl('../src/game/tideline-style.ts');
const courseUrl = await moduleUrl('../src/game/tideline-course.ts', {
  './tideline-materials':await moduleUrl('../src/game/tideline-materials.ts'),
  './apron.js': local('apron.js'), './tideline-rules.js': local('tideline-rules.js'), './tideline-style': styleUrl,
}, true);
const hardwareUrl=await moduleUrl('../src/game/tideline-hardware.ts',{'three/addons/utils/BufferGeometryUtils.js':import.meta.resolve('three/addons/utils/BufferGeometryUtils.js')});
const signalsUrl=await moduleUrl('../src/game/tideline-road-signals.ts',{'./tideline-hardware':hardwareUrl,'./tideline-rules.js':local('tideline-rules.js')});
const refractionUrl=await moduleUrl('../src/game/tideline-refraction.ts',{});
const bulkheadsUrl=await moduleUrl('../src/game/tideline-bulkheads.ts',{'./tideline-refraction':refractionUrl,'./tideline-hardware':hardwareUrl,'./tideline-rules.js':local('tideline-rules.js')});
const worldUrl = await moduleUrl('../src/game/tideline-world.ts', {
  './tideline-cradles':fieldUrl,'./tideline-road-signals':signalsUrl,'./tideline-bulkheads':bulkheadsUrl, './tideline-rules.js': local('tideline-rules.js'),
  './tideline-sky': await moduleUrl('../src/game/tideline-sky.ts', { './tideline-style': styleUrl }),
}, true);
const runtimeUrl = await moduleUrl('../src/game/tideline-runtime.ts', {
  './tideline-power-chain.js':local('tideline-power-chain.js'),'./ability-seed': await moduleUrl('../src/game/ability-seed.ts'), './tideline-world': worldUrl,
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
const audio = Object.fromEntries(['playPowerPickup', 'playPowerDenied', 'playPowerActivate', 'playTideDrain', 'playDeviceClunk', 'playBulkheadKlaxon'].map(name => [name, (...args) => audioEvents.push({ name, args })]));
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
  runtime.world.root.updateMatrixWorld(true);
  for (const gate of runtime.world.sluices.children) {
    for (let x=-route.shortcut.width/2; x<=route.shortcut.width/2; x+=.5) {
      for (const y of [-3.25, 0, 3.25]) for (const z of [-.225, .225]) {
        const point=gate.localToWorld(new THREE.Vector3(x,y,z));
        const road=course.project(point,.15);
        assert.ok(Math.abs(road.lateral)>road.halfWidth+2,
          'Closed sluices must leave the entire main-road corridor clear.');
      }
    }
  }
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
      'Every station has a real road and a contact shadow.');
    assert.equal(groundBlobVisible(false, course.travelModeAt(progress)), false, 'Finished or flipping craft keep hidden blobs.');
    assert.equal(state.gravitySign, 1); assert.equal(state.gravityTransition, 0);
    assert.ok(sample.up.y > .95, 'The craft follows gentle true slopes without a roll reversal.');
  }
  assert.deepEqual([...modes].sort(), ['submerged', 'surface']);
  assert.equal(groundBlobVisible(true, undefined), true, 'Existing road-only courses keep their contact shadows.');
  const playerSource = await readFile(new URL('../src/game/game.ts', import.meta.url), 'utf8');
  const rivalSource = await readFile(new URL('../src/game/rivals.ts', import.meta.url), 'utf8');
  assert.match(playerSource, /groundBlobVisible\(!this\.circuitRuntime\?\.isFlipping, this\.course\.travelModeAt\?\.\(this\.progress\)\)/);
  assert.match(rivalSource, /groundBlobVisible\(visible, this\.course\.travelModeAt\?\.\(distance \/ this\.course\.length\)\)/);
  const device = PowerPickupField.instances[0];
  assert.equal(device.lastUpdate[0], runtime.simulation.state.tick / 120, 'World devices use simulation time.');

  // The schedule is published and deterministic, with a real shorter route.
  assert.deepEqual(TIDE_SCHEDULE.map(t => t.waterLevel), [0, -15, -27]);
  assert.equal(tideForLap(9).id, "dry");
  for (const lap of [2, 3]) {
    assert.equal(tideWaterLevel(lap, 0), tideForLap(lap - 1).waterLevel);
    assert.equal(tideWaterLevel(lap, 5), tideForLap(lap).waterLevel);
    const levels = Array.from({length: 601}, (_, i) => tideWaterLevel(lap, i / 120));
    assert.ok(levels.every((level, i) => i === 0 || level <= levels[i-1]));
  }
  assert.equal(tideGrip(2, 4, 5), 1, 'Port grip stays dry.');
  assert.equal(tideGrip(2, -18, 5), 1, 'Still-submerged reactor retains grip.');
  assert.equal(tideGrip(2, -12, 5), .7);
  assert.ok(tideGrip(2, -12, 0) > tideGrip(2, -12, 5), 'The clean center line rewards precision.');
  assert.ok(route.shortcut.savings > 20 && route.shortcut.savings < 30);
  assert.ok(!route.checkpoints.some(p => p > route.shortcut.from && p < route.shortcut.to),
    'Both routes pass the same ordered gates.');
  assert.ok([...TIDELINE_ABILITY_CONFIG.pickups, ...TIDELINE_FIELDS].every(p =>
    p.progress < route.shortcut.from || p.progress > route.shortcut.to),
    'Route-space powers cannot trigger through the walls of the other route.');
  for (const lap of [1, 2, 3]) {
    course.setLapBoard(lap); course.advanceTide(5);
    let branchHits = 0;
    for (let i = 1; i < route.shortcut.stations.length - 1; i++) {
      const st = route.shortcut.stations[i];
      const position = new THREE.Vector3(...st.p);
      const projection = course.project(position, st.progress);
      if (projection.sector === 'PUMP_HALL_CUT') {
        branchHits++;
        assert.equal(projection.alternateRoad, true);
        assert.ok(projection.position.distanceTo(position) < .01);
        assert.ok(Math.abs(projection.progress - st.progress) < .00001);
      }
    }
    assert.equal(branchHits, lap === 3 ? route.shortcut.stations.length - 2 : 0);
    for (const progress of [.06, .12, .2, .26]) {
      const position = course.sample(progress).position;
      assert.notEqual(course.project(position, progress).sector, 'PUMP_HALL_CUT', 'Main road remains valid on every lap.');
    }
  }

  const cutMiddle = course.sampleShortcut(.16);
  assert.ok(Math.abs(course.rivalLateralAt(cutMiddle.position, .16)) > 20,
    'Fleet interactions use the physical gap to the other road, not branch-relative zero.');
  runtime.reset();
  for (const lap of [1, 2, 3]) {
    const lane = currentLane(714, lap);
    step(1, .1, lane, lap); present(.1);
    assert.equal(runtime.boostRechargeScale, lap === 1 ? 1.85 : 1);
    for(const channel of runtime.world.signals.currents){
      assert.equal(channel.root.visible,true,'Cable trays remain physical hardware after draining.');
      const lamp=new THREE.Color();channel.lamps.getColorAt(0,lamp);
      assert.equal(lamp.r>1,lap===1&&channel.side===Math.sign(lane),'The active current travels through the correct lamps.');
    }
    step(1, .1, -lane, lap); assert.equal(runtime.boostRechargeScale, 1);
    step(1, .5, lane, lap); assert.equal(runtime.boostRechargeScale, 1);
    step(1, .96, lane, lap); assert.equal(runtime.boostRechargeScale, lap === 1 ? 1.85 : 1);
    const frozenTide = {...course.tide};
    for (let frame = 0; frame < 120; frame++) present(.1);
    assert.deepEqual(course.tide, frozenTide, 'Paused presentation never advances the tide.');
    step(600, .1, lane, lap); present(.1);
    assert.equal(course.tide.waterLevel, tideForLap(lap).waterLevel);
    for (const gate of runtime.world.sluices.children) {
      assert.equal(gate.position.y - gate.userData.baseHeight, lap === 3 ? 15 : 0);
    }
    assert.equal(runtime.world.forkGuards.position.y,lap===3?-3:0,
      'Visible mouth guards lower when the shortcut opens.');
  }
  assert.equal(audioEvents.filter(e => e.name === 'playTideDrain').length, 2, 'One siren per actual drain.');
  runtime.reset();
  assert.deepEqual(course.tide, {lap:1, elapsed:0, waterLevel:0, draining:false, shortcutOpen:false});

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
  runtime.recover(TIDELINE_ABILITY_CONFIG.pickups[1].progress - .001); step(1, TIDELINE_ABILITY_CONFIG.pickups[1].progress + .001, -2); assert.equal(runtime.simulation.state.pickups, 1, 'Recovery cannot farm the same capsule.');
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
  // Equal command streams at different render rates preserve tide and powers.
  const snapshots = [];
  for (const hz of [60, 120, 240]) {
    runtime = new TidelineRuntime(course, input, audio, ui, false, 714);
    await runtime.ready; runtime.reset();
    for (let lap = 1; lap <= 3; lap++) {
      for (let frame = 0; frame < hz * 8; frame++) runtime.step(1 / hz, .4, 0, lap);
    }
    snapshots.push({tide: {...course.tide}, powers: runtime.simulation.snapshot()});
    runtime.dispose();
  }
  assert.deepEqual(snapshots[0], snapshots[1]);
  assert.deepEqual(snapshots[2], snapshots[1]);
  assert.ok(audioEvents.some(event => event.name === 'playPowerActivate' && event.args[0] === 'shield'));
  console.log('Tideline runtime PASS: published tide schedule, 23 m physical shortcut closed on laps 1/2, lap-3 projection and main-road alternative, exposed algae grip, current recharge, nitro/power controls, shield refunds, pause/reset and resource disposal; equal 60/120/240 Hz tide and command results.');
} finally {
  runtime?.dispose(); input.dispose(); disposeObject3DResources(course.group);
  for (const [name, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name];
  }
}
