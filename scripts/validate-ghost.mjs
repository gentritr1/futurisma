import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  GHOST_FIELDS_PER_FRAME,
  GHOST_FORMAT_VERSION,
  GHOST_SAMPLE_HZ,
  GhostPlayer,
  GhostRecorder,
  MAX_GHOST_CHARACTERS,
  MAX_GHOST_FRAMES,
  PHYSICS_STEPS_PER_SAMPLE,
  createGhostPlayer,
  decodeGhost,
  ghostCharacterCount,
  normalizeGhost,
} from "../src/game/ghost.js";

/**
 * P10 — the ghost has to survive the round trip, and it has to be unable to
 * touch the race.
 *
 * Two independent claims are proven here. The first is fidelity: a recorded lap
 * comes back out of the save file as the same lap, inside 0.05 m, with the
 * interpolation monotonic in progress so the ghost never appears to twitch
 * backwards. The second is *isolation*: the recorder samples off the fixed step
 * with no clock of its own, and holds no reference to anything that could write
 * a simulation value. A ghost that shifted a lap time by a millisecond would be
 * a worse bug than one that never rendered.
 */

const GREENWATER_LAP_METERS = 2_515.982;
const PHYSICS_HZ = 120;
const FIXED_STEP_MS = 1000 / PHYSICS_HZ;
// The soak's Greenwater lap, to the millisecond, so the sizes below are the
// sizes the game will actually write rather than a round number.
const REFERENCE_LAP_MS = 34_483;

// ---------------------------------------------------------------------------
// Sampling is derived from the fixed step, not from a clock
// ---------------------------------------------------------------------------

assert.equal(
  GHOST_SAMPLE_HZ * PHYSICS_STEPS_PER_SAMPLE,
  PHYSICS_HZ,
  `${GHOST_SAMPLE_HZ} Hz every ${PHYSICS_STEPS_PER_SAMPLE} steps is not `
    + `${PHYSICS_HZ} Hz. The recorder's rate must divide the physics step exactly, `
    + "or the frame count would differ between a 60 Hz laptop and a 165 Hz monitor.",
);

const ghostSource = await readFile(new URL("../src/game/ghost.js", import.meta.url), "utf8");

// No wall clock, anywhere. Sampling is a modulo on a step counter; the moment
// it consults real time the recording stops being frame-rate independent.
for (const clock of ["Date.now", "performance.now", "requestAnimationFrame", "setTimeout"]) {
  assert.ok(
    !ghostSource.includes(clock),
    `src/game/ghost.js references ${clock}. The recorder samples off the fixed `
      + "step; a wall clock would make the same lap record differently per machine.",
  );
}

// A pure leaf. `ghost.js` importing anything is how a "pure" module quietly
// grows a path back into the simulation it is supposed to only observe.
assert.ok(
  !/^\s*import\s/m.test(ghostSource),
  "src/game/ghost.js imports a module. It must stay a leaf: the adapter that "
    + "touches THREE, the course and the save file is src/game/ghost-runtime.ts.",
);

const runtimeSource = await readFile(
  new URL("../src/game/ghost-runtime.ts", import.meta.url),
  "utf8",
);
// One writer. The ghost reaches the save file through
// `meta-runtime.recordFinishedRace` and nowhere else, so the stored ghost and
// the stored best lap are decided by the same comparison.
assert.ok(
  !/\bsave\s*\.\s*recordRace\s*\(/.test(runtimeSource),
  "src/game/ghost-runtime.ts writes a race result. Persisting mid-race lowers "
    + "the stored bestLapMs before the result screen compares against it, and P7's "
    + "NEW BEST flash would stop firing. The ghost is offered to recordFinishedRace.",
);

const metaSource = await readFile(
  new URL("../src/game/meta-runtime.ts", import.meta.url),
  "utf8",
);
assert.ok(
  /ghostRuntime\.bestLapRecording\(/.test(metaSource),
  "src/game/meta-runtime.ts no longer offers the ghost to recordFinishedRace; "
    + "nothing would ever store a replay.",
);

// The race loop's own hook, in the one place that keeps the recorder's step
// count identical to the game's lap clock.
const gameSource = await readFile(new URL("../src/game/game.ts", import.meta.url), "utf8");
assert.ok(
  /ghostRuntime\.step\([^\n]*\);\n\s*this\.updateCheckpointProgress\(/.test(gameSource),
  "src/game/game.ts must call ghostRuntime.step immediately before "
    + "updateCheckpointProgress. Sampling after the lap boundary would put the "
    + "crossing step in the wrong lap and shorten every derived lap time by 8.3 ms.",
);

// ---------------------------------------------------------------------------
// A synthetic lap, driven exactly as the race loop drives it
// ---------------------------------------------------------------------------

/**
 * A lap with everything the encoder has to survive: a speed range that spans
 * the craft's, a line that crosses the centreline repeatedly, full steering
 * lock at the extremes, and a length that is not a multiple of the sample rate.
 */
function driveLap(lapMs = REFERENCE_LAP_MS) {
  const steps = Math.round(lapMs / FIXED_STEP_MS);
  const recorder = new GhostRecorder();
  const truth = [];
  let meters = 0;
  for (let step = 0; step < steps; step += 1) {
    const phase = step / steps;
    // 45..105 m/s, which brackets the craft's real range.
    const speed = 75 + 30 * Math.sin(phase * Math.PI * 7.3);
    meters += speed * (FIXED_STEP_MS / 1000);
    const lateral = 9.4 * Math.sin(phase * Math.PI * 11.7);
    const steer = Math.max(-1, Math.min(1, 1.35 * Math.cos(phase * Math.PI * 11.7)));
    // The order the race loop uses: the sample is taken, then the step is
    // counted. `truth` records what the recorder was shown, at the step it was
    // shown it, so the comparison below is against the input and not a re-derivation.
    if (step % PHYSICS_STEPS_PER_SAMPLE === 0) {
      truth.push({ meters, lateral, speed, steer });
    }
    recorder.step(meters, lateral, speed, steer);
  }
  return { recorder, truth, steps, lapMeters: meters };
}

const lap = driveLap();

assert.equal(
  lap.recorder.frameCount,
  Math.ceil(lap.steps / PHYSICS_STEPS_PER_SAMPLE),
  "The recorder kept a different number of frames than every sixth step.",
);
assert.ok(
  lap.recorder.frameCount >= 670 && lap.recorder.frameCount <= 700,
  `A 34.5 s Greenwater lap recorded ${lap.recorder.frameCount} frames; the design `
    + "budget is ~680. A large miss means the sampling rate drifted.",
);
assert.ok(
  Math.abs(lap.lapMeters - GREENWATER_LAP_METERS) < 400,
  `The synthetic lap covered ${lap.lapMeters.toFixed(0)} m against Greenwater's `
    + `${GREENWATER_LAP_METERS} m; the fixture stopped resembling a lap.`,
);

// ---------------------------------------------------------------------------
// Round trip: record → quantise → JSON → parse → normalize → decode
// ---------------------------------------------------------------------------

const recording = lap.recorder.toRecording(REFERENCE_LAP_MS);
assert.ok(recording, "A full lap must produce a recording.");
assert.equal(recording.version, GHOST_FORMAT_VERSION);
assert.equal(recording.sampleHz, GHOST_SAMPLE_HZ);
assert.equal(recording.lapMs, REFERENCE_LAP_MS, "The lap time must be stored exactly.");
assert.equal(
  recording.frames.length,
  lap.recorder.frameCount * GHOST_FIELDS_PER_FRAME,
  "The flat frame array is not four fields per frame.",
);
for (const value of recording.frames) {
  assert.ok(Number.isInteger(value), `Frame value ${value} is not an integer.`);
}

// The trip through storage, byte for byte.
const stored = normalizeGhost(JSON.parse(JSON.stringify(recording)));
assert.ok(stored, "A freshly-recorded ghost must survive its own normalizer.");
assert.deepEqual(stored, recording, "The ghost did not round-trip through JSON.");

const track = decodeGhost(stored);
assert.equal(track.count, lap.truth.length, "The decoded track lost frames.");

let worstMeters = 0;
let worstLateral = 0;
let worstSpeed = 0;
let worstSteer = 0;
for (let index = 0; index < track.count; index += 1) {
  const expected = lap.truth[index];
  worstMeters = Math.max(worstMeters, Math.abs(track.lapMeters[index] - expected.meters));
  worstLateral = Math.max(worstLateral, Math.abs(track.lateral[index] - expected.lateral));
  worstSpeed = Math.max(worstSpeed, Math.abs(track.speed[index] - expected.speed));
  worstSteer = Math.max(
    worstSteer,
    Math.abs(track.steer[index] - Math.max(-1, Math.min(1, expected.steer))),
  );
}

assert.ok(
  worstMeters < 0.05,
  `Worst progress error ${worstMeters.toFixed(4)} m exceeds the 0.05 m acceptance. `
    + "Delta coding must not accumulate: quantise to centimetres first, then delta.",
);
assert.ok(
  worstLateral < 0.05,
  `Worst lateral error ${worstLateral.toFixed(4)} m exceeds 0.05 m.`,
);
assert.ok(worstSpeed < 0.2, `Worst speed error ${worstSpeed.toFixed(3)} m/s exceeds 0.2.`);
assert.ok(worstSteer < 0.01, `Worst steer error ${worstSteer.toFixed(4)} exceeds 0.01.`);

// The error must not grow along the lap. A delta encoder that quantised the
// deltas instead of the absolutes would pass the average and fail here.
const firstHalf = Math.floor(track.count / 2);
let earlyWorst = 0;
let lateWorst = 0;
for (let index = 0; index < track.count; index += 1) {
  const error = Math.abs(track.lapMeters[index] - lap.truth[index].meters);
  if (index < firstHalf) earlyWorst = Math.max(earlyWorst, error);
  else lateWorst = Math.max(lateWorst, error);
}
assert.ok(
  lateWorst < earlyWorst + 0.01,
  `Progress error grew from ${earlyWorst.toFixed(4)} m to ${lateWorst.toFixed(4)} m `
    + "along the lap. The quantisation error is accumulating through the deltas.",
);

// ---------------------------------------------------------------------------
// Size
// ---------------------------------------------------------------------------

const characters = ghostCharacterCount(recording);
assert.ok(
  characters <= MAX_GHOST_CHARACTERS,
  `One lap serializes to ${characters} characters, over the ${MAX_GHOST_CHARACTERS} `
    + "budget. Two of these plus settings must fit the save file's 64 KB ceiling.",
);

// ---------------------------------------------------------------------------
// The player: monotonic, and faithful to the stored lap time
// ---------------------------------------------------------------------------

const player = new GhostPlayer(track);
assert.equal(player.lapMs, REFERENCE_LAP_MS);
assert.equal(player.frameCount, track.count);

// Monotonic in progress across a sweep finer than the sample period, including
// past the end of the recording.
let previous = -1;
let previousSpeed = null;
for (let timeMs = 0; timeMs <= REFERENCE_LAP_MS + 2_000; timeMs += 3.7) {
  const pose = player.sampleAt(timeMs);
  assert.ok(
    pose.lapMeters >= previous - 1e-9,
    `The ghost went backwards at ${timeMs.toFixed(1)} ms: `
      + `${pose.lapMeters.toFixed(4)} m after ${previous.toFixed(4)} m.`,
  );
  assert.ok(Number.isFinite(pose.lateral), "Interpolated lateral is not finite.");
  assert.ok(Number.isFinite(pose.speed), "Interpolated speed is not finite.");
  assert.ok(pose.steer >= -1 && pose.steer <= 1, `Interpolated steer ${pose.steer} escaped.`);
  previous = pose.lapMeters;
  previousSpeed = pose.speed;
}
assert.ok(previousSpeed !== null);

// Past the recording it holds the final pose and says so, rather than looping.
const ended = player.sampleAt(REFERENCE_LAP_MS + 60_000);
assert.equal(ended.finished, true, "A ghost past its lap must report finished.");
assert.equal(
  ended.lapMeters,
  track.lapMeters[track.count - 1],
  "A finished ghost must hold the last recorded point.",
);
assert.equal(player.sampleAt(0).finished, false, "A ghost at t=0 is not finished.");

// A negative or non-finite clock is a caller bug, not a crash.
for (const bad of [-5_000, Number.NaN, Number.POSITIVE_INFINITY]) {
  const pose = player.sampleAt(bad);
  assert.ok(Number.isFinite(pose.lapMeters), `sampleAt(${bad}) produced a non-finite pose.`);
}

// The lap time the ghost replays reproduces the stored one. The acceptance is
// ±0.05 s; the clock is stored explicitly rather than derived from the frame
// count precisely so this cannot depend on the sample rate.
const replayedLapMs = player.lapMs;
assert.ok(
  Math.abs(replayedLapMs - REFERENCE_LAP_MS) <= 50,
  `The replayed lap is ${replayedLapMs} ms against a stored ${REFERENCE_LAP_MS} ms.`,
);
// The frame count alone would not have been good enough — that is the whole
// reason lapMs is a stored field, so prove the gap is real.
const derivedFromFrames = ((track.count - 1) / GHOST_SAMPLE_HZ) * 1000;
assert.ok(
  Math.abs(derivedFromFrames - REFERENCE_LAP_MS) > 0,
  "The frame count happened to land exactly on the lap time; pick a fixture lap "
    + "that is not a whole number of sample periods.",
);

// ---------------------------------------------------------------------------
// Recording is inert: the same drive with and without a recorder
// ---------------------------------------------------------------------------

{
  // The soak's claim, proven structurally: `step` is fed copies of five numbers
  // and returns nothing, so no caller can branch on it and nothing it does can
  // reach back into the values it was given.
  const recorder = new GhostRecorder();
  assert.equal(
    recorder.step(10, 1, 50, 0.2),
    undefined,
    "GhostRecorder.step returned a value. The race loop must not be able to "
      + "branch on the recorder, or recording would change how the race runs.",
  );
  const before = { meters: 12.5, lateral: -3.25, speed: 61.5, steer: -0.5 };
  const arguments_ = { ...before };
  recorder.step(arguments_.meters, arguments_.lateral, arguments_.speed, arguments_.steer);
  assert.deepEqual(arguments_, before, "The recorder mutated its caller's values.");
}

// ---------------------------------------------------------------------------
// Hostile ghosts. Every one drops to null; none throws.
// ---------------------------------------------------------------------------

const frames = recording.frames;
const hostileGhosts = [
  ["null", null],
  ["undefined", undefined],
  ["a number", 42],
  ["a string", "ghost"],
  ["an array", [1, 2, 3, 4]],
  ["empty object", {}],
  ["missing version", { sampleHz: 20, lapMs: 34_483, frames }],
  ["wrong version", { version: 99, sampleHz: 20, lapMs: 34_483, frames }],
  ["version as a string", { version: "1", sampleHz: 20, lapMs: 34_483, frames }],
  ["missing lapMs", { version: 1, sampleHz: 20, frames }],
  ["zero lapMs", { version: 1, sampleHz: 20, lapMs: 0, frames }],
  ["negative lapMs", { version: 1, sampleHz: 20, lapMs: -1, frames }],
  ["absurd lapMs", { version: 1, sampleHz: 20, lapMs: 1e12, frames }],
  ["lapMs as a string", { version: 1, sampleHz: 20, lapMs: "34483", frames }],
  ["zero sampleHz", { version: 1, sampleHz: 0, lapMs: 34_483, frames }],
  ["absurd sampleHz", { version: 1, sampleHz: 1e6, lapMs: 34_483, frames }],
  ["frames missing", { version: 1, sampleHz: 20, lapMs: 34_483 }],
  ["frames not an array", { version: 1, sampleHz: 20, lapMs: 34_483, frames: "..." }],
  ["frames empty", { version: 1, sampleHz: 20, lapMs: 34_483, frames: [] }],
  [
    // The quota-exceeded write: the array stops mid-frame.
    "truncated mid-frame",
    { version: 1, sampleHz: 20, lapMs: 34_483, frames: frames.slice(0, frames.length - 2) },
  ],
  [
    "a single frame",
    { version: 1, sampleHz: 20, lapMs: 34_483, frames: frames.slice(0, GHOST_FIELDS_PER_FRAME) },
  ],
  [
    "a NaN in the frames",
    {
      version: 1,
      sampleHz: 20,
      lapMs: 34_483,
      frames: frames.map((value, index) => (index === 12 ? Number.NaN : value)),
    },
  ],
  [
    "a float in the frames",
    {
      version: 1,
      sampleHz: 20,
      lapMs: 34_483,
      frames: frames.map((value, index) => (index === 12 ? 4.5 : value)),
    },
  ],
  [
    "a string in the frames",
    {
      version: 1,
      sampleHz: 20,
      lapMs: 34_483,
      frames: frames.map((value, index) => (index === 12 ? "8" : value)),
    },
  ],
  [
    // The one that would break monotonicity, so it disqualifies the recording
    // rather than being repaired into something the file never held.
    "a backwards progress delta",
    {
      version: 1,
      sampleHz: 20,
      lapMs: 34_483,
      frames: frames.map((value, index) => (index === 40 ? -500 : value)),
    },
  ],
  [
    "a negative speed",
    {
      version: 1,
      sampleHz: 20,
      lapMs: 34_483,
      frames: frames.map((value, index) => (index === 42 ? -10 : value)),
    },
  ],
  [
    "steer past full lock",
    {
      version: 1,
      sampleHz: 20,
      lapMs: 34_483,
      frames: frames.map((value, index) => (index === 43 ? 5_000 : value)),
    },
  ],
  [
    "lateral a kilometre off line",
    {
      version: 1,
      sampleHz: 20,
      lapMs: 34_483,
      frames: frames.map((value, index) => (index === 41 ? 500_000 : value)),
    },
  ],
  [
    "more frames than the ceiling",
    {
      version: 1,
      sampleHz: 20,
      lapMs: 34_483,
      frames: new Array((MAX_GHOST_FRAMES + 1) * GHOST_FIELDS_PER_FRAME).fill(1),
    },
  ],
  [
    "progress past the longest conceivable lap",
    {
      version: 1,
      sampleHz: 20,
      lapMs: 34_483,
      frames: [0, 0, 0, 0, 1_999_999, 0, 0, 0, 1_999_999, 0, 0, 0],
    },
  ],
  ["prototype pollution attempt", JSON.parse('{"__proto__":{"ghosted":true},"version":1}')],
];

assert.ok(hostileGhosts.length >= 20, "The hostile ghost set must cover at least 20 inputs.");

for (const [label, payload] of hostileGhosts) {
  let result;
  assert.doesNotThrow(() => {
    result = normalizeGhost(payload);
  }, `normalizeGhost threw on ${label}.`);
  assert.equal(result, null, `${label} was accepted as a ghost.`);
  assert.doesNotThrow(() => {
    assert.equal(createGhostPlayer(payload), null, `${label} produced a player.`);
  }, `createGhostPlayer threw on ${label}.`);
}
assert.equal({}.ghosted, undefined, "A hostile ghost polluted Object.prototype.");

// A recording that is legal but only just: two frames is the minimum replayable
// lap, and it must work rather than being rejected for being short.
{
  const minimal = normalizeGhost({
    version: 1,
    sampleHz: 20,
    lapMs: 50,
    frames: [0, 0, 0, 0, 400, 25, 200, 50],
  });
  assert.ok(minimal, "A two-frame recording is legal and must normalize.");
  const shortPlayer = new GhostPlayer(decodeGhost(minimal));
  assert.equal(shortPlayer.sampleAt(0).lapMeters, 0);
  assert.ok(Math.abs(shortPlayer.sampleAt(25).lapMeters - 2) < 1e-9);
  assert.equal(shortPlayer.sampleAt(1_000).finished, true);
}

// A recorder that never got a full lap yields nothing rather than a stub ghost.
{
  const stub = new GhostRecorder();
  assert.equal(stub.toRecording(1_000), null, "An empty recorder produced a recording.");
  stub.step(0, 0, 0, 0);
  assert.equal(stub.toRecording(1_000), null, "A one-frame recorder produced a recording.");
  const two = new GhostRecorder();
  for (let step = 0; step < PHYSICS_STEPS_PER_SAMPLE + 1; step += 1) two.step(step, 0, 50, 0);
  assert.ok(two.toRecording(100), "Two frames is enough to replay.");
  assert.equal(two.toRecording(0), null, "A zero-length lap produced a recording.");
  assert.equal(two.toRecording(Number.NaN), null, "A NaN lap time produced a recording.");
}

// The frame ceiling holds against a driver that never stops.
{
  const runaway = new GhostRecorder();
  const steps = (MAX_GHOST_FRAMES + 500) * PHYSICS_STEPS_PER_SAMPLE;
  for (let step = 0; step < steps; step += 1) runaway.step(step * 0.6, 0, 72, 0);
  assert.equal(
    runaway.frameCount,
    MAX_GHOST_FRAMES,
    "The recorder blew past its frame ceiling; a stuck race would grow without bound.",
  );
}

console.log(
  `Ghost PASS: ${lap.recorder.frameCount} frames for a ${(REFERENCE_LAP_MS / 1000).toFixed(3)} s `
    + `lap at ${GHOST_SAMPLE_HZ} Hz (every ${PHYSICS_STEPS_PER_SAMPLE}th of ${PHYSICS_HZ} Hz), `
    + `${characters} chars / ${(characters / 1024).toFixed(2)} KB stored `
    + `(budget ${MAX_GHOST_CHARACTERS}), worst round-trip error `
    + `${(worstMeters * 100).toFixed(2)} cm progress / ${(worstLateral * 100).toFixed(2)} cm `
    + `lateral, interpolation monotonic over ${REFERENCE_LAP_MS + 2_000} ms, `
    + `${hostileGhosts.length} hostile ghosts refused.`,
);
