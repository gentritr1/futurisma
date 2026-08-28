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
 * One rival's engine gain pair, pre-panner. At the panner reference distance of
 * 4 m the panner is unity, so these are directly comparable with the player
 * pair: three rivals at 4 m stay under 40 % of the player engine.
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
