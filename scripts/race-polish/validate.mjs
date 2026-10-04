import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {RaceInputTimeline, decodeRaceInput, createRaceSnapshot, compatibleRaceSnapshot} from '../../src/game/race-session-protocol.js';
import {DriverGuidance} from '../../src/game/driver-guidance.js';
import {DRIFT_REWARD_MINIMUM_CHARGE} from '../../src/game/physics.js';
import {integrateCameraFov} from '../../src/game/camera-feedback.js';

const packet = (tick, sequence, input = {throttle: 1, brake: 0, steer: .5, boost: true}) => ({version: 1, tick, sequence, input});
for (const raw of [null, [], {}, packet(-1, 0), packet(0, -1), packet(.5, 0), packet(Infinity, 0), {...packet(0, 0), version: 2}]) assert.equal(decodeRaceInput(raw), null);
assert.deepEqual(decodeRaceInput(packet(0, 0, {throttle: 20, brake: -2, steer: NaN, boost: 'true'})).input,
  {throttle: 1, brake: 0, steer: 0, boost: false});
const inputs = new RaceInputTimeline();
assert.equal(inputs.accept(packet(20, 0), 20), true);
assert.equal(inputs.accept(packet(20, 1), 20), false, 'Cannot rewrite a queued input');
assert.equal(inputs.accept(packet(21, 0), 20), false, 'Reject sequence replay');
assert.equal(inputs.accept(packet(19, 2), 20), false, 'Reject past inputs');
assert.equal(inputs.accept(packet(261, 2), 20), false, 'Reject far future inputs');
const first = inputs.consume(20);first.throttle = 0;
assert.equal(inputs.consume(21).throttle, 1, 'Caller cannot mutate held input');
assert.equal(inputs.consume(31).boost, true);
assert.deepEqual(inputs.consume(32), {throttle: 0, brake: 0, steer: 0, boost: false}, '100ms silence releases controls');
assert.throws(() => inputs.consume(31));
assert.equal(inputs.packets.size, 0);
const bounded = new RaceInputTimeline();
for (let tick = 0; tick < 240; tick++) assert.equal(bounded.accept(packet(tick, tick), 0), true);
assert.equal(bounded.accept(packet(240, 240), 0), false, 'Queue is bounded');
bounded.consume(200);assert.equal(bounded.packets.size, 39);

const pose = {circuit: 'greenwater', seed: 42, elapsedMs: 1000, tick: 120, round: 1, phase: 'running', playerId: 'one',
  position: [1, 2, 3], forward: [0, 0, 1], progress: .5, lateral: 2, speed: 80, steer: .1,
  boost: .8, boostActive: true, lap: 1, nextCheckpoint: 3, ceiling: false, alternateRoad: false};
const snapshot = createRaceSnapshot(pose);
pose.position[0] = 99;
assert.equal(snapshot.tick, 120);assert.equal(snapshot.position[0], 1);
assert.ok(Object.isFrozen(snapshot) && Object.isFrozen(snapshot.position) && Object.isFrozen(snapshot.forward));
assert.equal(compatibleRaceSnapshot(snapshot, {circuit: 'greenwater', seed: 42}), true);
assert.equal(compatibleRaceSnapshot(snapshot, {circuit: 'frostline', seed: 42}), false);
assert.equal(compatibleRaceSnapshot(snapshot, {circuit: 'greenwater', seed: 43}), false);

const frame = {elapsedMs: 1000, speedKph: 0, raceActive: true, recoveryActive: false, wrongWay: false,
  edgeWarning: false, missedGate: null, trackEvent: '', boostActive: false, boostLocked: false,
  boost: 1, lap: 1, totalLaps: 3, drifting: false, driftCharge: 0, turnUrgent: false, lowGrip: false,
  turnDirection: null, turnDistanceMeters: 0, turnHard: false, braking: false};
const guide = new DriverGuidance();
assert.equal(guide.update(frame, false).action, 'thrust');
assert.match(guide.update(frame, true).title, /RT/);
assert.equal(guide.update({...frame,elapsedMs:90000},false).action,'thrust','Idle drivers retain the launch lesson');
for (const danger of [{recoveryActive: true}, {wrongWay: true}, {edgeWarning: true}, {missedGate: 1}, {trackEvent: 'WIND'}]) assert.equal(guide.update({...frame, ...danger}, false), null);
assert.equal(guide.update({...frame, raceActive: false}, false), null, 'Pause cannot teach');
assert.equal(guide.update({...frame, speedKph: 180}, false).action, 'boost');
assert.equal(guide.update({...frame, speedKph: 180, boostActive: true}, false), null);
assert.equal(guide.update({...frame, speedKph: 180, drifting: true, driftCharge: DRIFT_REWARD_MINIMUM_CHARGE - .01}, false), null, 'Never promise an unearned drift reward');
assert.equal(guide.update({...frame, speedKph: 180, drifting: true, driftCharge: DRIFT_REWARD_MINIMUM_CHARGE}, false).action, 'release');
assert.equal(guide.update({...frame, speedKph: 180, boostLocked: true}, false).action, 'release');
assert.equal(guide.update({...frame, speedKph: 180, elapsedMs: 46000}, false), null);
assert.equal(guide.update({...frame,speedKph:180,elapsedMs:180000,lap:3,drifting:true,driftCharge:DRIFT_REWARD_MINIMUM_CHARGE},false).title,'DRIFT BANK READY','Banking feedback remains useful after onboarding');
assert.equal(guide.update({...frame, elapsedMs: 0}, false).action, 'thrust', 'Retry reintroduces throttle');
assert.ok(integrateCameraFov(56, 73, .15) > 67, 'Boost lens responds within 150ms');

const bytes = readFileSync('public/assets/race-polish/timing-kit.glb');
assert.equal(bytes.toString('ascii', 0, 4), 'glTF');
const gltf = JSON.parse(bytes.toString('utf8', 20, 20 + bytes.readUInt32LE(12)).trim());
assert.equal(gltf.meshes.length, 3);assert.equal(gltf.materials.length, 3);
assert.deepEqual(gltf.nodes.map(n => n.name).sort(), ['timing_lens', 'timing_metal', 'timing_shell']);
let triangles = 0;
for (const mesh of gltf.meshes) for (const primitive of mesh.primitives) {
  triangles += gltf.accessors[primitive.indices].count / 3;
  assert.ok(primitive.attributes.TEXCOORD_0 !== undefined);
}
assert.ok(triangles < 3000);assert.ok(bytes.length < 400000);
assert.equal(gltf.images.length, 1);assert.equal(gltf.images[0].mimeType, 'image/jpeg');
console.log(`Race polish rules PASS: input replay/bounds/timeout, immutable compatible snapshots, contextual lessons, boost lens; original timing kit ${triangles} triangles / ${bytes.length} bytes.`);
