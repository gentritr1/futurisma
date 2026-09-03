import { nextQuantizedTime } from "./audio-timing.js";

/**
 * Pure spatial-audio maths for the panner-per-rival field and the zoned
 * convolution reverb. Everything here is deterministic and free of Web Audio
 * types so the validators can execute it in node, where no AudioContext exists.
 */

/**
 * The authored rooms. Adding one means authoring an impulse response and an
 * `audio.zones` entry, not editing the race loop. `underpass` is P8's: Bitterpan
 * has exactly one covered stretch and it is a trestle soffit with open sides,
 * so it gets its own milder room rather than borrowing Greenwater's hangar.
 * @typedef {"open" | "hangar" | "underpass"} AudioZone
 */

/** Rival voices that carry a panner. One per authored rival. */
export const RIVAL_AUDIO_VOICES = 3;

/** Shared with the wind noise generator so the whole map sounds identical. */
export const IMPULSE_RESPONSE_SEED = 714;

/** Zone changes crossfade over this window, started on a musical bar. */
export const ZONE_CROSSFADE_SECONDS = 0.6;

/**
 * The authored rooms. `wet` is a send level into the shared convolver, so the
 * dry path never moves and a zone change cannot duck the racing mix.
 *
 * `underpass` sits deliberately between the two: a conveyor trestle closes the
 * sky over Bitterpan's corridor but never the sides, so it slaps back rather
 * than ringing. Giving it Greenwater's 1.9 s hangar would have been the easy
 * reuse and the wrong room.
 */
export const AUDIO_ZONE_PROFILES = {
  open: { decaySeconds: 0.4, wet: 0.08, highPassHz: 40 },
  hangar: { decaySeconds: 1.9, wet: 0.34, highPassHz: 240 },
  underpass: { decaySeconds: 1.05, wet: 0.2, highPassHz: 150 },
};

/**
 * Small authored detunes keep three identical engine pairs from phase-locking
 * into one voice. Authored rather than random so a soak is reproducible.
 */
export const RIVAL_DETUNE_RATIOS = [1, 1.037, 0.972];

/**
 * The same linear congruential stream the wind bed uses. Exported so the
 * impulse responses, the wind noise and the validators share one generator.
 * @param {number} seed
 */
export function seededRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 0x1_0000_0000;
  };
}

/**
 * One channel of an exponentially decaying noise impulse response. The envelope
 * reaches -60 dB exactly at `decaySeconds`, which is what makes the measured
 * RT60 match the authored profile instead of merely correlating with it.
 * @param {number} sampleRate
 * @param {number} decaySeconds
 * @param {number} seed
 */
export function createImpulseResponseChannel(sampleRate, decaySeconds, seed) {
  const rate = Math.max(1, Math.floor(sampleRate));
  const decay = Math.max(0.01, decaySeconds);
  const length = Math.max(1, Math.ceil(decay * rate));
  const channel = new Float32Array(length);
  const random = seededRandom(seed);
  const attenuation = Math.log(1000) / decay;
  for (let index = 0; index < length; index += 1) {
    const time = index / rate;
    channel[index] = (random() * 2 - 1) * Math.exp(-time * attenuation);
  }
  return channel;
}

/**
 * Schroeder backward integration with the standard T30 extrapolation: measure
 * the -5 dB to -35 dB slope and double it. Reading the decay back out of the
 * generated buffer is what turns "1.9 s hangar" into a checkable claim.
 * @param {Float32Array} channel
 * @param {number} sampleRate
 */
export function measureReverbTimeSeconds(channel, sampleRate) {
  const length = channel.length;
  if (length < 2 || sampleRate <= 0) return 0;
  const remaining = new Float64Array(length + 1);
  for (let index = length - 1; index >= 0; index -= 1) {
    remaining[index] = remaining[index + 1] + channel[index] * channel[index];
  }
  const total = remaining[0];
  if (total <= 0) return 0;
  let start = -1;
  for (let index = 0; index < length; index += 1) {
    const decibels = 10 * Math.log10(remaining[index] / total);
    if (start < 0 && decibels <= -5) start = index;
    if (decibels <= -35) {
      return start < 0 || index <= start ? 0 : ((index - start) / sampleRate) * 2;
    }
  }
  return 0;
}

/**
 * Closed-interval zone lookup. The authored hangar covers d ∈ [588, 846], so
 * both boundary metres must resolve to `hangar`; a "last trigger wins" scan
 * like `musicAt` would hand the closing metre back to `open`.
 * @param {number} distanceMeters
 * @param {ReadonlyArray<{ name: string; startDistance: number; endDistance: number }>} zones
 * @param {string} fallback
 */
export function resolveAudioZone(distanceMeters, zones, fallback) {
  if (!Number.isFinite(distanceMeters)) return fallback;
  for (const zone of zones) {
    if (distanceMeters >= zone.startDistance && distanceMeters <= zone.endDistance) {
      return zone.name;
    }
  }
  return fallback;
}

/**
 * A zone change starts on the next musical bar so the reverb turn lands with
 * the 174 BPM grid instead of cutting across it. The single convolver swaps its
 * buffer at `mute`, while the send is at zero, and opens again by `end`.
 * @param {number} now
 * @param {number} origin
 * @param {number} barSeconds
 */
export function resolveZoneCrossfade(now, origin, barSeconds) {
  const start = nextQuantizedTime(now, origin, barSeconds);
  return {
    start,
    mute: start + ZONE_CROSSFADE_SECONDS * 0.5,
    end: start + ZONE_CROSSFADE_SECONDS,
  };
}

/**
 * The player engine gain pair, unchanged from the pre-P3 formula. It lives here
 * so the rival ceiling is expressed against a real number rather than a comment.
 * @param {number} throttle
 * @param {number} speedRatio
 * @param {boolean} boost
 * @param {{ oscillator: number; harmonic: number }} target
 */
export function playerEngineGains(throttle, speedRatio, boost, target) {
  target.oscillator = 0.025 + throttle * 0.035 + speedRatio * 0.025;
  target.harmonic = 0.008 + speedRatio * 0.021 + (boost ? 0.02 : 0);
  return target;
}

/**
 * One rival's engine gain pair, pre-panner. Inside the panner reference
 * distance the distance model is unity, so these are directly comparable with
 * the player pair: three rivals abeam stay under 40 % of the player engine.
 *
 * A1 moved that reference distance from 4 m to 6 m (`RIVAL_PANNER`, below)
 * and added a boost layer and an airbrake hiss into the same
 * panners. The ceiling below is unchanged and still holds, because those two
 * layers are gated on acceleration rather than being always-on: the steady-state
 * pack is exactly the pair this function returns.
 * @param {number} speedRatio
 * @param {{ oscillator: number; harmonic: number }} target
 */
export function rivalEngineGains(speedRatio, target) {
  const ratio = Number.isFinite(speedRatio)
    ? Math.min(1, Math.max(0, speedRatio))
    : 0;
  target.oscillator = 0.006 + ratio * 0.006;
  target.harmonic = 0.0025 + ratio * 0.0033;
  return target;
}

/**
 * Mirrors the player engine pitch curve minus the inputs a rival does not
 * publish (throttle, boost), then applies the authored per-rival detune.
 * @param {number} speedRatio
 * @param {number} detuneRatio
 */
export function rivalEngineFrequency(speedRatio, detuneRatio) {
  const ratio = Number.isFinite(speedRatio)
    ? Math.min(1, Math.max(0, speedRatio))
    : 0;
  return (52 + ratio * 118) * detuneRatio;
}

/**
 * Listener-space right axis. Web Audio's listener is right-handed with the
 * default forward at -Z and up at +Y, so `forward x up` is +X, its right ear.
 * @param {{ x: number; y: number; z: number }} forward
 * @param {{ x: number; y: number; z: number }} up
 * @param {{ x: number; y: number; z: number }} target
 */
export function listenerRightVector(forward, up, target) {
  const x = forward.y * up.z - forward.z * up.y;
  const y = forward.z * up.x - forward.x * up.z;
  const z = forward.x * up.y - forward.y * up.x;
  const length = Math.hypot(x, y, z);
  if (length < 1e-6) {
    target.x = 1;
    target.y = 0;
    target.z = 0;
    return target;
  }
  target.x = x / length;
  target.y = y / length;
  target.z = z / length;
  return target;
}

/**
 * Signed left/right placement of a source in listener space: -1 is hard left,
 * +1 hard right. This is the value the `rival-audio` probe asserts, because the
 * HRTF panner itself exposes nothing a headless check can read.
 * @param {{ x: number; y: number; z: number }} delta source minus listener
 * @param {{ x: number; y: number; z: number }} right unit listener right axis
 */
export function listenerPanX(delta, right) {
  const length = Math.hypot(delta.x, delta.y, delta.z);
  if (length < 1e-6) return 0;
  const projection = (delta.x * right.x + delta.y * right.y + delta.z * right.z)
    / length;
  return Math.min(1, Math.max(-1, projection));
}

// ---------------------------------------------------------------------------
// A1 — the rival distance model, the Doppler approximation and the two signals
// read out of a rival's velocity stream.
//
// These live here rather than in `ambience-beds.js` for two reasons. They are
// spatial-audio maths, which is what this module already is; and the 30 Hz
// control tick calls them, so they must not sit behind the dynamic import that
// keeps the bed plan and its 29 s of baked loops out of the initial bundle.
// ---------------------------------------------------------------------------

/** @param {number} value */
function clampUnit(value) {
  if (!Number.isFinite(value)) return 0;
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/** Speed of sound used for the rival pitch offset. */
export const SPEED_OF_SOUND_MPS = 343;

/** Hard cap on the Doppler pitch offset, either direction. */
export const DOPPLER_LIMIT = 0.06;

/**
 * The rival distance model. `refDistance` moved 4 -> 6 m in A1: the pack now
 * carries a boost layer and an airbrake hiss on top of the engine pair, and at
 * 4 m reference those extra layers were inaudible by 30 m. On the inverse model
 * a rival 15 m astern reads 0.323 and one at 60 m reads 0.073 — a 12.9 dB fall
 * across the overtaking band, which is the "clearly audible behind, a whisper
 * at 60 m" the phase asked for. HRTF is kept over equalpower because the front
 * /back cue is the whole point of a rival that is *behind* you; the frame cost
 * of the three panners is reported in the A1 harness run.
 */
export const RIVAL_PANNER = {
  panningModel: "HRTF",
  distanceModel: "inverse",
  refDistance: 6,
  maxDistance: 90,
  rolloffFactor: 1.4,
};

/**
 * A1 — spatial lag compensation.
 *
 * A position pushed through `setTargetAtTime` once per control tick arrives
 * late by two things that add: the smoother's own time constant, and half the
 * tick it was sampled on. At 90 m/s that is about 3.1 m, and it was MEASURED
 * before it was fixed — `scripts/visual/audio-probe.mjs` reported panner
 * readbacks 2.0-4.4 m behind the rival seam on a live Bitterpan lap.
 *
 * Most of that error is common to the listener and every source, so it does not
 * move the scene relative to the ear; what is left over is the part where two
 * craft are on different headings, which was still up to 1.9 m. Both ends are
 * therefore led by their own velocity, which puts the panner where the rival
 * IS rather than where it was a frame and a half ago.
 *
 * The clamp is the safety on it: a dropped frame makes a finite-differenced
 * velocity spike, and an unclamped lead would teleport the listener.
 */
export const SPATIAL_LEAD_CLAMP_METERS = 4;

/**
 * @param {number} smoothingSeconds the `setTargetAtTime` time constant
 * @param {number} controlIntervalSeconds the control tick
 */
export function spatialLeadSeconds(smoothingSeconds, controlIntervalSeconds) {
  const smoothing = Number.isFinite(smoothingSeconds) ? Math.max(0, smoothingSeconds) : 0;
  const interval = Number.isFinite(controlIntervalSeconds)
    ? Math.max(0, controlIntervalSeconds)
    : 0;
  return smoothing + interval / 2;
}

/**
 * WebAudio's `inverse` distance model, in JS. Used for the reported panner gain,
 * because a `PannerNode` exposes no readable gain of its own.
 *
 * @param {number} distanceMeters
 */
export function inverseDistanceGain(distanceMeters) {
  const { refDistance, maxDistance, rolloffFactor } = RIVAL_PANNER;
  if (!Number.isFinite(distanceMeters)) return 0;
  const clamped = Math.min(maxDistance, Math.max(refDistance, distanceMeters));
  return refDistance / (refDistance + rolloffFactor * (clamped - refDistance));
}

/**
 * Approximated Doppler. WebAudio removed its own, so the pitch offset is the
 * first-order term of the real thing — closing speed over the speed of sound —
 * clamped to +-6 % so a boosting rival never sounds like a tape stopping.
 *
 * @param {number} closingMetersPerSecond positive when the gap is shrinking
 */
export function dopplerRatio(closingMetersPerSecond) {
  if (!Number.isFinite(closingMetersPerSecond)) return 1;
  const offset = closingMetersPerSecond / SPEED_OF_SOUND_MPS;
  return 1 + Math.min(DOPPLER_LIMIT, Math.max(-DOPPLER_LIMIT, offset));
}

/**
 * A rival's boost, read out of its own velocity rather than out of a widened
 * seam. `RivalSpatialSource` publishes position and velocity and nothing else,
 * on purpose; d|v|/dt is enough to tell a boost from a corner, and it keeps the
 * rival simulation's determinism entirely out of the audio graph.
 *
 * The rival boost accelerates at about 13 m/s^2 against a corner scrub that
 * rarely exceeds 4, so the band opens at 6 and saturates at 20.
 *
 * @param {number} accelerationMetersPerSecondSquared
 */
export function rivalBoostSignal(accelerationMetersPerSecondSquared) {
  if (!Number.isFinite(accelerationMetersPerSecondSquared)) return 0;
  return clampUnit((accelerationMetersPerSecondSquared - 6) / 14);
}

/**
 * The airbrake hiss, from the same signal on the deceleration side. Set higher
 * than the boost band because lifting off scrubs speed on its own and only a
 * real brake application should hiss.
 *
 * @param {number} accelerationMetersPerSecondSquared
 */
export function rivalBrakeSignal(accelerationMetersPerSecondSquared) {
  if (!Number.isFinite(accelerationMetersPerSecondSquared)) return 0;
  return clampUnit((-accelerationMetersPerSecondSquared - 8) / 18);
}

