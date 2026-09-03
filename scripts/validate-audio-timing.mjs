import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
import {
  AUDIO_ZONE_PROFILES,
  createImpulseResponseChannel,
  IMPULSE_RESPONSE_SEED,
  listenerPanX,
  listenerRightVector,
  measureReverbTimeSeconds,
  playerEngineGains,
  RIVAL_AUDIO_VOICES,
  RIVAL_DETUNE_RATIOS,
  resolveAudioZone,
  resolveZoneCrossfade,
  rivalEngineFrequency,
  rivalEngineGains,
  ZONE_CROSSFADE_SECONDS,
} from "../src/game/audio-space.js";

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

// ---------------------------------------------------------------------------
// P3 — spatial rival audio and zoned convolution reverb.
// ---------------------------------------------------------------------------

const blockout = JSON.parse(
  readFileSync(new URL("../src/game/data/greenwater-blockout.json", import.meta.url), "utf8"),
);
const bitterpanProduction = JSON.parse(
  readFileSync(
    new URL("../src/game/data/map02/BITTERPAN_PRODUCTION.json", import.meta.url),
    "utf8",
  ),
);

// The map files are the authored source; the engine constants must not drift
// from them. Both directions still hold, but the engine table is now shared by
// two maps (P8 added Bitterpan's `underpass`), so it is no longer equal to any
// single map's block. Direction one: every room Greenwater authors matches the
// engine exactly. Direction two: every room the engine holds is authored by
// some map, so an orphan profile cannot appear in code alone.
const authoredAudioProfiles = {
  ...bitterpanProduction.audio.profiles,
  ...blockout.audio.profiles,
};
for (const [zone, profile] of Object.entries(blockout.audio.profiles)) {
  assert.deepEqual(
    profile,
    AUDIO_ZONE_PROFILES[zone],
    `greenwater-blockout.json audio room ${zone} must match AUDIO_ZONE_PROFILES.`,
  );
}
for (const [zone, profile] of Object.entries(AUDIO_ZONE_PROFILES)) {
  assert.deepEqual(
    profile,
    authoredAudioProfiles[zone],
    `AUDIO_ZONE_PROFILES room ${zone} is not authored by any map.`,
  );
}
assert.equal(blockout.audio.defaultZone, "open");
assert.equal(blockout.audio.quantize, "bar");
assert.equal(blockout.audio.crossfadeSeconds, ZONE_CROSSFADE_SECONDS);

// The authored hangar is the closed interval [588, 846]: the B-wall interior.
// A "last trigger wins" lookup would hand metre 846 back to `open`, so resolve
// the boundary metres explicitly rather than trusting the scan.
const zones = blockout.audio.zones;
const zoneAt = (distance) => resolveAudioZone(distance, zones, blockout.audio.defaultZone);
assert.equal(zoneAt(0), "open");
assert.equal(zoneAt(587.999), "open");
assert.equal(zoneAt(588), "hangar");
assert.equal(zoneAt(588.001), "hangar");
assert.equal(zoneAt(717), "hangar");
assert.equal(zoneAt(845.999), "hangar");
assert.equal(zoneAt(846), "hangar");
assert.equal(zoneAt(846.001), "open");
assert.equal(zoneAt(blockout.centreline.lapLength), "open");
assert.equal(zoneAt(Number.NaN), "open");

// One lap sampled every metre must cross exactly two boundaries, which is what
// makes the 5-lap "exactly 10 transitions" soak criterion arithmetic instead of
// a guess.
let boundaryCrossings = 0;
let previousZone = zoneAt(0);
for (let metre = 1; metre <= Math.floor(blockout.centreline.lapLength); metre += 1) {
  const zone = zoneAt(metre);
  if (zone !== previousZone) boundaryCrossings += 1;
  previousZone = zone;
}
assert.equal(
  boundaryCrossings,
  2,
  "One Greenwater lap must cross the hangar boundary exactly twice.",
);

// Impulse responses: deterministic for a fixed seed, and the authored decay is
// recoverable from the buffer itself rather than only from the constant.
for (const sampleRate of [44_100, 48_000]) {
  const first = createImpulseResponseChannel(sampleRate, 1.9, IMPULSE_RESPONSE_SEED);
  const second = createImpulseResponseChannel(sampleRate, 1.9, IMPULSE_RESPONSE_SEED);
  assert.ok(first instanceof Float32Array);
  assert.equal(first.length, Math.ceil(1.9 * sampleRate));
  assert.deepEqual(
    first,
    second,
    "The impulse response generator must be deterministic for a fixed seed.",
  );
  const different = createImpulseResponseChannel(sampleRate, 1.9, IMPULSE_RESPONSE_SEED + 1);
  assert.notDeepEqual(
    first,
    different,
    "The second stereo channel must not duplicate the first, or the room is mono.",
  );

  const hangarRt60 = measureReverbTimeSeconds(
    createImpulseResponseChannel(
      sampleRate,
      AUDIO_ZONE_PROFILES.hangar.decaySeconds,
      IMPULSE_RESPONSE_SEED,
    ),
    sampleRate,
  );
  assert.ok(
    hangarRt60 >= 1.7 && hangarRt60 <= 2.1,
    `Hangar RT60 measured ${hangarRt60.toFixed(3)} s at ${sampleRate} Hz; the authored `
      + "room is 1.9 s and the acceptance window is [1.7, 2.1].",
  );

  const openRt60 = measureReverbTimeSeconds(
    createImpulseResponseChannel(
      sampleRate,
      AUDIO_ZONE_PROFILES.open.decaySeconds,
      IMPULSE_RESPONSE_SEED,
    ),
    sampleRate,
  );
  assert.ok(
    openRt60 > 0.3 && openRt60 < 0.5,
    `Open-air RT60 measured ${openRt60.toFixed(3)} s; the authored room is 0.4 s.`,
  );
  assert.ok(
    hangarRt60 > openRt60 * 3,
    "The two rooms must be audibly different, not two names for one decay.",
  );
}

// Zone crossfades start on a bar of the 174 BPM grid, exactly like the stem
// transitions. The convolver swap sits at the midpoint, while the send is muted.
for (const offset of [0, 0.001, 0.4, bar - 1e-4, bar, bar * 2.5, 37.9]) {
  const window = resolveZoneCrossfade(origin + offset, origin, bar);
  const bars = (window.start - origin) / bar;
  assert.ok(
    Math.abs(bars - Math.round(bars)) < 1e-9,
    `A zone crossfade started ${bars} bars after the music origin; it must be whole bars.`,
  );
  assert.ok(window.start >= origin + offset - 1e-9);
  assert.ok(Math.abs(window.end - window.start - ZONE_CROSSFADE_SECONDS) < 1e-9);
  assert.ok(Math.abs(window.mute - window.start - ZONE_CROSSFADE_SECONDS / 2) < 1e-9);
}
assert.equal(resolveZoneCrossfade(0, origin, bar).start, origin);

// Gain staging. Inside the panner reference distance the inverse distance model
// is unity, so the pre-panner gains are directly comparable: three rivals abeam
// must stay under 40 % of a boosting player engine. A1 moved that reference
// distance to 6 m and added two gated layers per rival; the steady-state
// ceiling below is unchanged and the distance model itself is asserted in
// scripts/validate-audio-ambience.mjs.
assert.equal(RIVAL_AUDIO_VOICES, 3);
assert.equal(RIVAL_DETUNE_RATIOS.length, RIVAL_AUDIO_VOICES);
assert.equal(new Set(RIVAL_DETUNE_RATIOS).size, RIVAL_AUDIO_VOICES);
const playerPair = { oscillator: 0, harmonic: 0 };
const rivalPair = { oscillator: 0, harmonic: 0 };
assert.equal(
  playerEngineGains(1, 1, true, playerPair),
  playerPair,
  "The real-time control tick must reuse its gain-pair object.",
);
// Pinned against the pre-P3 formula in audio.ts, so extracting it cannot re-tune
// the player engine by accident.
assert.deepEqual(playerEngineGains(0, 0, false, playerPair), {
  oscillator: 0.025,
  harmonic: 0.008,
});
assert.deepEqual(playerEngineGains(1, 1, true, playerPair), {
  oscillator: 0.085,
  harmonic: 0.049,
});
const playerPeak = playerPair.oscillator + playerPair.harmonic;
rivalEngineGains(1, rivalPair);
const rivalPeak = RIVAL_AUDIO_VOICES * (rivalPair.oscillator + rivalPair.harmonic);
assert.ok(
  rivalPeak <= playerPeak * 0.4,
  `Three rivals at 4 m sum to ${(rivalPeak / playerPeak * 100).toFixed(1)} % of the player `
    + "engine; the ceiling is 40 %.",
);
assert.ok(
  rivalPeak >= playerPeak * 0.35,
  "The rival field is far under its own ceiling, which means it is inaudible pressure.",
);
rivalEngineGains(0, rivalPair);
assert.ok(
  rivalPair.oscillator > 0 && rivalPair.harmonic > 0,
  "A stationary rival must still idle rather than vanish.",
);
assert.deepEqual(rivalEngineGains(Number.NaN, rivalPair), rivalEngineGains(0, rivalPair));

// Rival pitch mirrors the player curve minus throttle and boost, then detunes.
assert.ok(Math.abs(rivalEngineFrequency(0, 1) - 52) < 1e-9);
assert.ok(Math.abs(rivalEngineFrequency(1, 1) - 170) < 1e-9);
assert.ok(Math.abs(rivalEngineFrequency(2, 1) - 170) < 1e-9);
assert.ok(rivalEngineFrequency(1, RIVAL_DETUNE_RATIOS[1]) !== rivalEngineFrequency(1, 1));

// The pan axis the `rival-audio` probe reads. Web Audio's listener is
// right-handed with forward -Z and up +Y, so forward x up is its right ear.
const right = listenerRightVector({ x: 0, y: 0, z: -1 }, { x: 0, y: 1, z: 0 }, {
  x: 0,
  y: 0,
  z: 0,
});
assert.ok(
  Math.abs(right.x - 1) < 1e-12 && Math.abs(right.y) < 1e-12 && Math.abs(right.z) < 1e-12,
  "forward -Z with up +Y must yield the listener's right ear at +X.",
);
assert.equal(listenerPanX({ x: -4, y: 0, z: 0 }, right), -1);
assert.equal(listenerPanX({ x: 4, y: 0, z: 0 }, right), 1);
assert.equal(listenerPanX({ x: 0, y: 0, z: -20 }, right), 0);
assert.equal(listenerPanX({ x: 0, y: 0, z: 0 }, right), 0);
// A degenerate basis must not produce NaN into an AudioParam.
assert.deepEqual(
  listenerRightVector({ x: 0, y: 1, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 0 }),
  { x: 1, y: 0, z: 0 },
);
// The probe geometry: a rival 4 m abeam, read from a chase camera 2.7 m astern
// and 1.25 m high, must still clear the +-0.85 acceptance gate. The listener
// rides the craft, so the longitudinal offset of the camera does not dilute it.
assert.ok(listenerPanX({ x: -4, y: 0, z: 0 }, right) <= -0.85);
assert.ok(listenerPanX({ x: 4, y: 0, z: 0 }, right) >= 0.85);
// The probe places its rival along the course sample's `right`, and the pan is
// measured along the listener's right. Those are only the same side because
// course.ts builds `right` with the same `forward x up` handedness. If that line
// ever flips to `up x forward`, every pan assertion silently inverts, so pin it.
const courseSource = readFileSync(
  new URL("../src/game/course.ts", import.meta.url),
  "utf8",
);
assert.ok(
  courseSource.includes("target.right.crossVectors(target.tangent, WORLD_UP)"),
  "course.ts must keep `right = tangent x up`; listenerRightVector uses the same "
    + "handedness and the rival-audio probe depends on the two agreeing.",
);

// Even a full degree of camera roll and a 3 degree pitch leave the axis intact.
const tilted = listenerRightVector(
  { x: 0.05, y: -0.05, z: -0.997 },
  { x: 0.017, y: 0.999, z: 0 },
  { x: 0, y: 0, z: 0 },
);
assert.ok(listenerPanX({ x: -4, y: 0, z: 0 }, tilted) <= -0.85);

console.log(
  "Audio timing PASS: advancing-clock node safety, 174 BPM F-minor tonal plan, boost filter/shelf targets, unique stem profiles, interruption-safe ramps, stable 30 Hz control at 60/120 Hz rendering, deterministic impulse responses with measured 1.9 s hangar RT60, bar-quantized zone crossfades, closed [588, 846] hangar interval, and a rival field capped at 40% of the player engine.",
);
