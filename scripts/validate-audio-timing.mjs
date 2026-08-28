import assert from "node:assert/strict";
import {
  advanceFixedRateDeadline,
  audioClockAdvances,
  encodeMusicProfileKey,
  fixedRateUpdateDue,
  MUSIC_LOOP_BEATS,
  MUSIC_STEM_SAMPLE_RATE,
  nextQuantizedTime,
  resolveMusicFilterTargets,
  sampleLinearAutomation,
} from "../src/game/audio-timing.js";
import {
  DEEP_DNB_BASS_EVENTS,
  GATE_CHIME_MIDI,
  MUSIC_BPM,
  MUSIC_KEY,
  RACE_EVENT_MIDI,
  TECHSTEP_HIT_MIDI,
  TRANCE_CHORD_MIDI,
  TRANCE_PLUCK_MIDI,
  frequencyForMidiNote,
} from "../src/game/music-plan.js";

const bar = 60 / MUSIC_BPM * 4;
const origin = 0.08;

assert.equal(audioClockAdvances("running"), true);
for (const state of ["suspended", "interrupted", "closed", "uninitialized"]) {
  assert.equal(
    audioClockAdvances(state),
    false,
    `${state} audio clocks must not receive real-time nodes or automation.`,
  );
}

assert.equal(MUSIC_BPM, 174);
assert.equal(MUSIC_KEY, "F minor");
assert.equal(MUSIC_LOOP_BEATS, 16);
assert.equal(MUSIC_STEM_SAMPLE_RATE, 24_000);
assert.ok(Math.abs(frequencyForMidiNote(69) - 440) < 1e-9);

const fNaturalMinorPitchClasses = new Set([0, 2, 3, 5, 7, 8, 10]);
const relativeToF = (midiNote) => (midiNote - 5 + 120) % 12;
const tonalNotes = [
  ...TRANCE_CHORD_MIDI.flat(),
  ...TRANCE_PLUCK_MIDI,
  ...DEEP_DNB_BASS_EVENTS.map((event) => event.midiNote),
  TECHSTEP_HIT_MIDI.downbeat,
  TECHSTEP_HIT_MIDI.offbeat,
  ...GATE_CHIME_MIDI,
  ...Object.values(RACE_EVENT_MIDI).flat(),
];
for (const midiNote of tonalNotes) {
  assert.ok(
    fNaturalMinorPitchClasses.has(relativeToF(midiNote)),
    `MIDI note ${midiNote} must belong to F natural minor.`,
  );
}

assert.deepEqual(resolveMusicFilterTargets(0.5, false), {
  lowpassHz: 2900,
  highShelfDb: 0,
});
assert.deepEqual(resolveMusicFilterTargets(0.5, true), {
  lowpassHz: 6200,
  highShelfDb: 4.5,
});
assert.equal(resolveMusicFilterTargets(Number.NaN, false).lowpassHz, 2100);
assert.equal(resolveMusicFilterTargets(2, false).lowpassHz, 3700);
const reusableFilterTargets = { lowpassHz: 0, highShelfDb: 0 };
assert.equal(
  resolveMusicFilterTargets(0.25, false, reusableFilterTargets),
  reusableFilterTargets,
  "Real-time audio control must reuse its filter-target object.",
);
assert.deepEqual(reusableFilterTargets, {
  lowpassHz: 2500,
  highShelfDb: 0,
});
assert.equal(
  resolveMusicFilterTargets(0.9, true, reusableFilterTargets),
  reusableFilterTargets,
  "Boost updates must preserve the same filter-target object.",
);

assert.equal(nextQuantizedTime(0, origin, bar), origin);
assert.equal(nextQuantizedTime(origin, origin, bar), origin);
assert.ok(Math.abs(nextQuantizedTime(origin + 0.2, origin, bar) - (origin + bar)) < 1e-9);
assert.ok(Math.abs(nextQuantizedTime(origin + bar, origin, bar) - (origin + bar)) < 1e-9);
assert.equal(nextQuantizedTime(2, 3, 0), 3);

function countFixedRateUpdates(renderHz, seconds, controlHz) {
  const frameInterval = 1 / renderHz;
  const controlInterval = 1 / controlHz;
  let deadline = 0;
  let updates = 0;
  for (let frame = 0; frame <= renderHz * seconds; frame += 1) {
    const now = frame * frameInterval;
    if (!fixedRateUpdateDue(now, deadline, controlInterval)) continue;
    updates += 1;
    deadline = advanceFixedRateDeadline(now, deadline, controlInterval);
  }
  return updates;
}

assert.equal(countFixedRateUpdates(60, 10, 30), 301);
assert.equal(countFixedRateUpdates(120, 10, 30), 301);
assert.equal(advanceFixedRateDeadline(5, 0.2, 1 / 30), 5 + 1 / 30);

const profileKeys = new Set();
for (let trance = 0; trance <= 3; trance += 1) {
  for (let jungle = 0; jungle <= 3; jungle += 1) {
    for (let deepDnb = 0; deepDnb <= 3; deepDnb += 1) {
      for (let techstep = 0; techstep <= 3; techstep += 1) {
        profileKeys.add(encodeMusicProfileKey(trance, jungle, deepDnb, techstep));
      }
    }
  }
}
assert.equal(profileKeys.size, 256);
assert.equal(encodeMusicProfileKey(-1, 4, 2, 3), encodeMusicProfileKey(0, 3, 2, 3));

assert.equal(sampleLinearAutomation(1, 0.2, 0.8, 2, 4), 0.2);
assert.equal(sampleLinearAutomation(3, 0.2, 0.8, 2, 4), 0.5);
assert.equal(sampleLinearAutomation(5, 0.2, 0.8, 2, 4), 0.8);
assert.equal(sampleLinearAutomation(2, 0.2, 0.8, 2, 2), 0.8);

console.log(
  "Audio timing PASS: advancing-clock node safety, 174 BPM F-minor tonal plan, boost filter/shelf targets, unique stem profiles, interruption-safe ramps, and stable 30 Hz control at 60/120 Hz rendering.",
);
