import { seededRandom } from "./audio-space.js";

/**
 * A1 — the authored sound field, as pure maths and pure sample generation.
 *
 * Everything in this module is deterministic and free of Web Audio types, for
 * the same reason `audio-space.js` is: node has no `AudioContext`, and the
 * validator has to be able to execute the bed plan, the level solver and the
 * baked loops themselves rather than read them. The Web Audio graph that plays
 * these numbers lives in `audio-ambience.ts`.
 *
 * The project ships zero audio assets and this phase does not change that: every
 * loop below is synthesised from a seeded LCG at start-up.
 */

/** @typedef {"greenwater" | "bitterpan"} AmbienceMapId */
/** @typedef {"windGust" | "squall" | "saltDrop"} AmbienceEventName */

/**
 * @typedef {object} AmbienceWindow
 * @property {number} startDistance first metre of the authored stretch
 * @property {number} endDistance last metre of the authored stretch
 * @property {number} fadeMeters approach/departure ramp OUTSIDE the window
 */

/**
 * @typedef {object} AmbienceBed
 * @property {string} id
 * @property {"wind" | "loop"} kind `wind` is filter-built and never repeats;
 *   `loop` is a baked seeded buffer.
 * @property {string} note what a listener is supposed to hear
 * @property {number} level authored peak gain into the ambience bus
 * @property {AmbienceWindow | null} window null means the whole lap
 * @property {string | null} zone reverb room that makes this bed louder
 * @property {number} zoneGain multiplier applied inside `zone`
 * @property {AmbienceEventName | null} event track-event level that drives it
 * @property {number} eventGain added gain at event level 1
 * @property {number} reverbSend 0..1 into the shared convolver
 * @property {AmbienceWindProfile | null} wind two-layer noise bed authoring,
 *   for `kind: "wind"` beds only
 */

/**
 * @typedef {object} AmbienceWindProfile
 * @property {number} lowHz band centre of the moving low layer
 * @property {number} highHz band centre of the bright upper layer
 * @property {number} lowLfoHz wander rate of the low layer
 * @property {number} highLfoHz wander rate of the upper layer
 * @property {number} gustHz how far a full gust pushes the upper band up
 */

/**
 * Beds duck this far under a full score. Authored as a relative decibel figure
 * rather than a multiplier so the intent survives a re-tune of `level`: at stem
 * sum 12/12 the whole ambience bus sits 9 dB below where it sits in silence.
 */
export const AMBIENCE_DUCK_DB = -9;

/**
 * One bed crossfade is three time constants of this first-order smoother, i.e.
 * 2.0 s to 95 %. Both halves of that sentence are asserted in
 * `scripts/validate-audio-ambience.mjs`, against a simulated lap rather than
 * against the constant.
 */
export const AMBIENCE_SMOOTHING_SECONDS = 2 / 3;

/** Rival closer than this fires one pass-by whoosh. */
export const PASS_BY_TRIGGER_METERS = 4;

/** ...and has to get this far out again before it can fire a second one. */
export const PASS_BY_RELEASE_METERS = 9;

/** Length of the one-shot pass-by swell. */
export const PASS_BY_SECONDS = 0.42;

/**
 * Shared noise bed length. Long enough that the two wind layers, played back at
 * different rates, do not lock into an audible period.
 */
export const NOISE_LOOP_SECONDS = 4.13;

/**
 * Baked at the same 24 kHz the music stems use. The content tops out near
 * 6.2 kHz (the salt patter's brightest grain), so Nyquist is not the limit —
 * start-up time is. At 48 kHz the Bitterpan set costs 97 ms of main thread
 * before the countdown; at 24 kHz it costs 61 ms, measured by
 * `node scripts/validate-audio-ambience.mjs`, and the `AudioBufferSourceNode`
 * resamples for free.
 */
export const AMBIENCE_LOOP_SAMPLE_RATE = 24_000;

/**
 * Baked loop lengths. Every internal rhythm below is authored as a whole number
 * of cycles across these, so the loop point is silent without a crossfade doing
 * the work — the 24 ms tail crossfade only cleans up the noise layers.
 */
export const AMBIENCE_LOOP_SECONDS = {
  noise: NOISE_LOOP_SECONDS,
  works_hum: 12.5,
  conveyor_rattle: 2.068_965_517_241_379,
  brine_lap: 9.7,
  salt_patter: 4.3,
  canopy_chirp: 11.3,
  pump_thrum: 3.1,
  rain_patter: 5.9,
};

/**
 * The authored field, per map.
 *
 * `level` is the gain into the ambience bus with the bus itself at unity (no
 * duck), and every baked loop is peak-normalised to 0.9 before it gets there,
 * so these numbers are directly comparable with each other. The measured RMS
 * each one produces is pinned in `AMBIENCE_RMS_BANDS` below.
 *
 * @type {Record<AmbienceMapId, AmbienceBed[]>}
 */
export const AMBIENCE_BEDS = {
  bitterpan: [
    {
      id: "dry_wind",
      kind: "wind",
      note: "the pan itself: two band-passed noise layers, one low and moving, "
        + "one bright and dry, wandering against each other on slow LFOs.",
      level: 0.3,
      window: null,
      zone: null,
      zoneGain: 1,
      event: "windGust",
      eventGain: 0.24,
      reverbSend: 0,
      wind: { lowHz: 340, highHz: 2_200, lowLfoHz: 0.063, highLfoHz: 0.091, gustHz: 900 },
    },
    {
      id: "works_hum",
      kind: "loop",
      note: "the HARVEST BASIN rigs: a low pulsing drone with metallic rattle "
        + "on top. Authored across the basin sequences Q1..L1, not as a point "
        + "source, because the rigs are a field of them.",
      level: 0.17,
      window: { startDistance: 60, endDistance: 1_600, fadeMeters: 60 },
      zone: null,
      zoneGain: 1,
      event: null,
      eventGain: 0,
      reverbSend: 0.18,
      wind: null,
    },
    {
      id: "brine_lap",
      kind: "loop",
      note: "WET PAN BEND into BRINE CUT: sparse filtered drips over a very "
        + "quiet lap of standing brine.",
      level: 0.14,
      window: { startDistance: 2_600, endDistance: 2_960, fadeMeters: 60 },
      zone: null,
      zoneGain: 1,
      event: null,
      eventGain: 0,
      reverbSend: 0.12,
      wind: null,
    },
    {
      id: "conveyor_rattle",
      kind: "loop",
      note: "the span: a 16th-note clatter on the 174 BPM grid with a roller "
        + "thump on the quarters, half again as loud inside the underpass, "
        + "where the shared convolver gives it the soffit.",
      level: 0.3,
      // 2965, not a round 2980: that is where BITTERPAN_PRODUCTION.json's own
      // `underpass` room starts (L3 LOADOUT APPROACH into Q5 CONVEYOR
      // UNDERPASS). The bed and the room are the same structure, so the bed is
      // authored off the map file and the validator asserts the two agree.
      window: { startDistance: 2_965, endDistance: 3_050, fadeMeters: 60 },
      zone: "underpass",
      zoneGain: 1.5,
      event: null,
      eventGain: 0,
      reverbSend: 0.55,
      wind: null,
    },
    {
      id: "salt_patter",
      kind: "loop",
      note: "salt drop: a dry hiss and patter burst, silent unless the event "
        + "says otherwise.",
      level: 0,
      window: null,
      zone: null,
      zoneGain: 1,
      event: "saltDrop",
      eventGain: 0.18,
      reverbSend: 0.08,
      wind: null,
    },
  ],
  greenwater: [
    {
      id: "wetland",
      kind: "wind",
      note: "humid air rather than dry: the same two-layer noise bed tuned "
        + "lower and wetter, on a much slower wander.",
      level: 0.26,
      window: null,
      zone: null,
      zoneGain: 1,
      event: "windGust",
      eventGain: 0.18,
      reverbSend: 0,
      wind: { lowHz: 210, highHz: 880, lowLfoHz: 0.041, highLfoHz: 0.058, gustHz: 420 },
    },
    {
      id: "canopy_chirp",
      kind: "loop",
      note: "CANOPY PASSAGE: sparse seeded insect chirps with the occasional "
        + "frog under them.",
      level: 0.16,
      window: {
        startDistance: 1_128.982,
        endDistance: 1_481.152,
        fadeMeters: 60,
      },
      zone: null,
      zoneGain: 1,
      event: null,
      eventGain: 0,
      reverbSend: 0.1,
      wind: null,
    },
    {
      id: "pump_thrum",
      kind: "loop",
      note: "FUEL ROW: a pump station thrumming just under two cycles a "
        + "second, with a mechanical tick off it.",
      level: 0.16,
      window: {
        startDistance: 1_591.107,
        endDistance: 2_121.465,
        fadeMeters: 60,
      },
      zone: null,
      zoneGain: 1,
      event: null,
      eventGain: 0,
      reverbSend: 0.15,
      wind: null,
    },
    {
      id: "rain_patter",
      kind: "loop",
      note: "squall: rain on the deck plus the low wind swell that comes with "
        + "it. Silent unless the event says otherwise.",
      level: 0,
      window: null,
      zone: null,
      zoneGain: 1,
      event: "squall",
      eventGain: 0.2,
      reverbSend: 0.1,
      wind: null,
    },
  ],
};

/**
 * Night circuits reuse the authored rain/machinery samples at new levels and
 * route windows. They allocate only the beds this map uses; no birds or salt
 * events follow the player into the city. Windows scale with the actual lap.
 * @param {"nightshift" | "polarity"} map
 * @param {number} lapLength
 * @returns {AmbienceBed[]}
 */
export function cityAmbienceBeds(map, lapLength) {
  const hum = AMBIENCE_BEDS.bitterpan.find((bed) => bed.id === "works_hum");
  const water = AMBIENCE_BEDS.bitterpan.find((bed) => bed.id === "brine_lap");
  const rain = AMBIENCE_BEDS.greenwater.find((bed) => bed.id === "rain_patter");
  const pump = AMBIENCE_BEDS.greenwater.find((bed) => bed.id === "pump_thrum");
  const wind = AMBIENCE_BEDS.bitterpan.find((bed) => bed.id === "dry_wind");
  if (!hum || !water || !rain || !pump || !wind) {
    throw new Error("The night circuit's base ambience loops are missing.");
  }
  const polarity = map === "polarity";
  const lap = Number.isFinite(lapLength) && lapLength > 0 ? lapLength : 1;
  return [
    {
      ...wind, id: "city_air", level: polarity ? .18 : .13,
      event: null, eventGain: 0, reverbSend: .04,
      note: "Air moving between buildings, kept below the passing craft's own wind.",
      wind: { lowHz: 165, highHz: 710, lowLfoHz: .039, highLfoHz: .057, gustHz: 0 },
    },
    {
      ...hum, level: polarity ? .115 : .065, window: null,
      zone: "underpass", zoneGain: 1.45, reverbSend: .18,
      note: "The city's electrical plant, with a stronger enclosed magnetic hum beneath the upper road.",
    },
    {
      ...rain, level: polarity ? .022 : .057, event: null, eventGain: 0,
      reverbSend: .12,
      note: "Fine persistent rain on the road and rooftop metal, without a storm swell.",
    },
    {
      ...pump, level: polarity ? .085 : .06, reverbSend: .22,
      window: { startDistance: lap * (polarity ? .16 : .50),
        endDistance: lap * (polarity ? .74 : .63), fadeMeters: 65 },
      note: "Mechanical relays throb through the transfer structure and fade away from its approaches.",
    },
    {
      ...water, level: .055, reverbSend: .13,
      window: { startDistance: lap * .67, endDistance: lap * .84, fadeMeters: 50 },
      note: "Water moving against the concrete below the last service district.",
    },
  ];
}

/**
 * Acceptance bands for the rendered RMS of each bed, in dBFS, measured at the
 * ambience bus with the bed at window gain 1 and the music silent (duck = 1).
 * For a bed that is audible at rest the band describes its RESTING level — no
 * track event, no room boost — because that is what a listener hears for most
 * of a lap; for an event-only bed (`level` 0) it describes the event at 1,
 * because at rest that bed is silence by design. In the game everything below
 * is additionally multiplied by the 0.34 master ceiling.
 *
 * These numbers were PRODUCED BY MEASUREMENT, not chosen: run
 * `node scripts/visual/audio-probe.mjs <url>` and read the `bed RMS` table. The
 * band is the measured value +-3 dB, so a re-tune of `level` has to come back
 * here and a silent or blown-up bed cannot pass.
 *
 * Measured on Chromium 48 kHz, 2026-09-03, centres in dBFS:
 *   dry_wind -26.0, works_hum -27.3, brine_lap -35.3, conveyor_rattle -29.0,
 *   salt_patter -26.7 (event 1), wetland -29.8, canopy_chirp -35.9,
 *   pump_thrum -27.7, rain_patter -25.7 (event 1).
 * The first pass of this table was a guess and it was WRONG in both directions:
 * the wind beds came back 12 dB hot and the two storm beds 6 dB hot. What fixed
 * them is `WIND_LAYER_GAIN` in `audio-ambience.ts` and the two `eventGain`
 * figures above, and the fix was driven by this table rather than the other way
 * round.
 *
 * @type {Record<string, [number, number]>}
 */
export const AMBIENCE_RMS_BANDS = {
  dry_wind: [-29.0, -23.0],
  works_hum: [-30.3, -24.3],
  brine_lap: [-38.3, -32.3],
  conveyor_rattle: [-32.0, -26.0],
  salt_patter: [-29.7, -23.7],
  wetland: [-32.8, -26.8],
  canopy_chirp: [-38.9, -32.9],
  pump_thrum: [-30.7, -24.7],
  rain_patter: [-28.7, -22.7],
};

/** Nothing on the ambience bus may render above this RMS. */
export const AMBIENCE_RMS_CEILING_DBFS = -12;

/** ...or above this sample peak. */
export const AMBIENCE_PEAK_CEILING = 0.98;

/**
 * One seed per loop. Authored rather than derived from the id so a rename
 * cannot silently re-roll a bed that has already been listened to.
 * @type {Record<string, number>}
 */
export const AMBIENCE_LOOP_SEEDS = {
  noise: 9_311,
  works_hum: 4_027,
  conveyor_rattle: 5_113,
  brine_lap: 6_209,
  salt_patter: 7_331,
  canopy_chirp: 8_017,
  pump_thrum: 2_663,
  rain_patter: 3_449,
};

/** @param {number} value @param {number} lap */
function wrap(value, lap) {
  const span = lap > 0 ? lap : 1;
  return ((value % span) + span) % span;
}

/** @param {number} value */
function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/**
 * How present a bed is at a point on the lap. 1 inside the authored stretch,
 * ramping to 0 over `fadeMeters` OUTSIDE it in both directions — the rigs start
 * to arrive before the basin does rather than snapping on at its first metre.
 *
 * Wrap-aware, because Bitterpan's conveyor window ends on the lap seam.
 *
 * @param {number} distanceMeters
 * @param {number} lapLengthMeters
 * @param {AmbienceWindow | null} window
 */
export function bedWindowGain(distanceMeters, lapLengthMeters, window) {
  if (!window) return 1;
  if (!Number.isFinite(distanceMeters)) return 0;
  const lap = lapLengthMeters > 0 ? lapLengthMeters : 1;
  const fade = Math.max(1e-3, window.fadeMeters);
  const start = wrap(window.startDistance, lap);
  const span = Math.min(lap, Math.max(0, window.endDistance - window.startDistance));
  const into = wrap(distanceMeters - start, lap);
  if (into <= span) return 1;
  const past = into - span;
  const before = lap - into;
  const nearest = Math.min(past, before);
  return nearest >= fade ? 0 : 1 - nearest / fade;
}

/**
 * The whole ambience bus under the score. `levels` is the live 0..3 stem
 * profile; a silent score leaves the beds at unity and a full one puts them
 * `AMBIENCE_DUCK_DB` under that.
 *
 * @param {{ trance: number; jungle: number; deep_dnb: number; techstep: number }} levels
 */
export function ambienceDuck(levels) {
  const sum = clamp01(
    ((levels?.trance ?? 0) + (levels?.jungle ?? 0)
      + (levels?.deep_dnb ?? 0) + (levels?.techstep ?? 0)) / 12,
  );
  const floor = Math.pow(10, AMBIENCE_DUCK_DB / 20);
  return 1 + (floor - 1) * sum;
}

/**
 * @typedef {object} AmbienceState
 * @property {number} distanceMeters
 * @property {number} lapLengthMeters
 * @property {string} zone active reverb room
 * @property {Record<string, number>} events 0..1 track-event levels
 */

/**
 * The gain one bed should be heading for. The duck is applied once on the bus,
 * not here, so this stays the bed's own authored presence.
 *
 * @param {AmbienceBed} bed
 * @param {AmbienceState} state
 */
export function bedTargetGain(bed, state) {
  const window = bedWindowGain(
    state.distanceMeters,
    state.lapLengthMeters,
    bed.window,
  );
  if (window <= 0) return 0;
  const event = bed.event ? clamp01(state.events?.[bed.event] ?? 0) : 0;
  const zone = bed.zone && state.zone === bed.zone ? bed.zoneGain : 1;
  return (bed.level + event * bed.eventGain) * window * zone;
}

/**
 * The player's own air. `windGain` in audio.ts already scales a flat noise bed
 * with speed; this is the part that was missing — the band the air moves
 * through, which is what makes 400 km/h sound different from 200 rather than
 * merely louder.
 *
 * @param {number} speedRatio
 */
export function airFilterHz(speedRatio) {
  return 620 + clamp01(speedRatio) * 2_100;
}

/**
 * The boost "tear": a bright layer that only exists while the boost is lit.
 * @param {number} speedRatio
 * @param {boolean} boost
 */
export function airTearGain(speedRatio, boost) {
  return boost ? 0.028 + clamp01(speedRatio) * 0.05 : 0;
}

/** @param {number} speedRatio */
export function airLayerGain(speedRatio) {
  const ratio = clamp01(speedRatio);
  return ratio * ratio * 0.055;
}

/**
 * @param {Float32Array<ArrayBuffer>} channel
 * @param {number} target
 */
function normalisePeak(channel, target) {
  let peak = 0;
  for (const sample of channel) peak = Math.max(peak, Math.abs(sample));
  if (peak <= 0) return channel;
  const scale = target / peak;
  for (let index = 0; index < channel.length; index += 1) channel[index] *= scale;
  return channel;
}

/**
 * 24 ms of the head mixed into the tail. The rhythmic content of every loop is
 * already a whole number of cycles; this only stops the noise layers clicking.
 * @param {Float32Array<ArrayBuffer>} channel
 * @param {number} sampleRate
 */
function crossfadeTail(channel, sampleRate) {
  const fade = Math.min(Math.floor(channel.length / 4), Math.floor(0.024 * sampleRate));
  for (let index = 0; index < fade; index += 1) {
    const mix = index / fade;
    const tail = channel.length - fade + index;
    channel[tail] = channel[tail] * (1 - mix) + channel[index] * mix;
  }
  return channel;
}

/**
 * A two-pole resonator, run over one short grain in place. This is what gives
 * the rattles, drips and chirps a body instead of leaving them as filtered
 * hiss — and it costs nothing at run time, because it happens once at start-up.
 *
 * @param {Float32Array<ArrayBuffer>} channel
 * @param {number} startSample
 * @param {number} sampleRate
 * @param {{ frequency: number; q: number; seconds: number; amplitude: number;
 *   excite: () => number; decay?: number }} grain
 */
function resonantGrain(channel, startSample, sampleRate, grain) {
  const count = Math.min(
    channel.length - startSample,
    Math.max(1, Math.floor(grain.seconds * sampleRate)),
  );
  if (count <= 0) return;
  const angle = 2 * Math.PI * grain.frequency / sampleRate;
  const radius = Math.exp(-Math.PI * (grain.frequency / Math.max(0.5, grain.q)) / sampleRate);
  const a1 = 2 * radius * Math.cos(angle);
  const a2 = radius * radius;
  const decay = grain.decay ?? 6;
  let y1 = 0;
  let y2 = 0;
  for (let index = 0; index < count; index += 1) {
    const progress = index / count;
    const input = grain.excite() * Math.exp(-progress * decay);
    const output = input + a1 * y1 - a2 * y2;
    y2 = y1;
    y1 = output;
    channel[startSample + index] += output * grain.amplitude * (1 - radius);
  }
}

/**
 * Every baked ambience loop, by id. One seeded LCG per loop, so a bed sounds
 * identical on every machine and in the offline render the validator asserts.
 *
 * @param {string} id
 * @param {number} sampleRate
 * @returns {Float32Array<ArrayBuffer>}
 */
export function renderAmbienceLoop(id, sampleRate) {
  const rate = Math.max(8_000, Math.floor(sampleRate));
  const seconds = AMBIENCE_LOOP_SECONDS[/** @type {keyof typeof AMBIENCE_LOOP_SECONDS} */ (id)];
  if (!seconds) throw new Error(`Unknown ambience loop "${id}".`);
  const length = Math.ceil(seconds * rate);
  const channel = new Float32Array(length);
  const random = seededRandom(AMBIENCE_LOOP_SEEDS[id] ?? 1);
  const noise = () => random() * 2 - 1;

  if (id === "noise") {
    for (let index = 0; index < length; index += 1) channel[index] = noise();
    return normalisePeak(crossfadeTail(channel, rate), 0.9);
  }

  if (id === "works_hum") {
    // Four pulses of the drone across the loop, so the pumping is seamless.
    const pulseHz = 4 / seconds;
    for (let index = 0; index < length; index += 1) {
      const time = index / rate;
      const pulse = 0.55 + 0.45 * Math.sin(2 * Math.PI * pulseHz * time);
      channel[index] = (
        Math.sin(2 * Math.PI * 43 * time) * 0.9
        + Math.sin(2 * Math.PI * 64.5 * time) * 0.42
        + Math.sin(2 * Math.PI * 21.5 * time) * 0.3
      ) * pulse * 0.5;
    }
    // Nine metallic rattles, inharmonic, spread by the seed.
    for (let event = 0; event < 9; event += 1) {
      const at = Math.floor((event + random() * 0.9) / 9 * length);
      for (const [ratio, amplitude] of [[1, 1], [1.71, 0.55], [2.43, 0.3]]) {
        resonantGrain(channel, at, rate, {
          frequency: 1_180 * ratio,
          q: 26,
          seconds: 0.16,
          amplitude: 1.6 * amplitude,
          excite: noise,
          decay: 9,
        });
      }
    }
    return normalisePeak(crossfadeTail(channel, rate), 0.9);
  }

  if (id === "conveyor_rattle") {
    // Six beats of the 174 BPM grid. The clatter is on 16ths, the roller thump
    // on the quarters, so the span sits on the same clock as the score.
    const beat = seconds / 6;
    for (let step = 0; step < 24; step += 1) {
      const at = Math.floor(step * beat / 4 * rate);
      resonantGrain(channel, at, rate, {
        frequency: 1_260 + random() * 520,
        q: 14,
        seconds: 0.05,
        amplitude: 1.1 + random() * 0.8,
        excite: noise,
        decay: 16,
      });
      if (step % 4 === 0) {
        resonantGrain(channel, at, rate, {
          frequency: 76,
          q: 7,
          seconds: 0.24,
          amplitude: 2.4,
          excite: noise,
          decay: 7,
        });
      }
    }
    return normalisePeak(crossfadeTail(channel, rate), 0.9);
  }

  if (id === "brine_lap") {
    // A very quiet lap of standing brine under the drips: low-passed noise via
    // a one-pole, which is all the water needs to stop being hiss.
    let low = 0;
    for (let index = 0; index < length; index += 1) {
      low += (noise() - low) * 0.0022;
      channel[index] = low * 3.4;
    }
    for (let event = 0; event < 15; event += 1) {
      const at = Math.floor((event + random() * 0.95) / 15 * length);
      const start = 340 + random() * 260;
      const count = Math.min(length - at, Math.floor(0.19 * rate));
      for (let index = 0; index < count; index += 1) {
        const time = index / rate;
        const progress = index / count;
        // A drip is a pitch that falls as the drop lets go, not a fixed tone.
        const frequency = start * Math.exp(-progress * 1.15);
        channel[at + index] += Math.sin(2 * Math.PI * frequency * time)
          * Math.exp(-progress * 7.5) * 0.34;
      }
      resonantGrain(channel, at, rate, {
        frequency: 2_600 + random() * 900,
        q: 9,
        seconds: 0.02,
        amplitude: 0.5,
        excite: noise,
        decay: 22,
      });
    }
    return normalisePeak(crossfadeTail(channel, rate), 0.9);
  }

  if (id === "salt_patter" || id === "rain_patter") {
    const rain = id === "rain_patter";
    // A hiss floor, differenced to take the mud out of it.
    let previous = 0;
    for (let index = 0; index < length; index += 1) {
      const sample = noise();
      channel[index] = (sample - previous * (rain ? 0.55 : 0.78)) * (rain ? 0.5 : 0.42);
      previous = sample;
    }
    const grains = rain ? 900 : 460;
    for (let event = 0; event < grains; event += 1) {
      const at = Math.floor(random() * (length - 1));
      resonantGrain(channel, at, rate, {
        frequency: rain ? 1_500 + random() * 2_600 : 2_800 + random() * 3_400,
        q: rain ? 6 : 4,
        seconds: rain ? 0.014 : 0.009,
        amplitude: 0.5 + random() * 0.7,
        excite: noise,
        decay: 26,
      });
    }
    if (rain) {
      // The low swell that arrives with the squall, four cycles across the loop.
      let swell = 0;
      const swellHz = 4 / seconds;
      for (let index = 0; index < length; index += 1) {
        swell += (noise() - swell) * 0.004;
        const time = index / rate;
        channel[index] += swell * (0.6 + 0.4 * Math.sin(2 * Math.PI * swellHz * time)) * 2.6;
      }
    }
    return normalisePeak(crossfadeTail(channel, rate), 0.9);
  }

  if (id === "canopy_chirp") {
    for (let event = 0; event < 26; event += 1) {
      const at = Math.floor((event + random() * 0.92) / 26 * length);
      if (random() < 0.72) {
        // Insect: a short trill of AM pulses high up.
        const base = 3_050 + random() * 900;
        const pulses = 3 + Math.floor(random() * 3);
        for (let pulse = 0; pulse < pulses; pulse += 1) {
          const offset = at + Math.floor(pulse * 0.035 * rate);
          const count = Math.min(length - offset, Math.floor(0.022 * rate));
          for (let index = 0; index < count; index += 1) {
            const time = index / rate;
            const progress = index / count;
            channel[offset + index] += Math.sin(2 * Math.PI * base * time)
              * Math.sin(Math.PI * progress) * 0.3;
          }
        }
      } else {
        // Frog: a low buzzy croak with a rasp on it.
        const base = 150 + random() * 70;
        const count = Math.min(length - at, Math.floor(0.28 * rate));
        for (let index = 0; index < count; index += 1) {
          const time = index / rate;
          const progress = index / count;
          const rasp = 0.5 + 0.5 * Math.sin(2 * Math.PI * 27 * time);
          channel[at + index] += (
            Math.sin(2 * Math.PI * base * time)
            + Math.sin(2 * Math.PI * base * 2 * time) * 0.5
            + Math.sin(2 * Math.PI * base * 3 * time) * 0.28
          ) * rasp * Math.sin(Math.PI * progress) * 0.22;
        }
      }
    }
    return normalisePeak(crossfadeTail(channel, rate), 0.9);
  }

  if (id === "pump_thrum") {
    // Six thrums across 3.1 s -> 1.935 Hz, seamless at the loop point.
    const thrumHz = 6 / seconds;
    for (let index = 0; index < length; index += 1) {
      const time = index / rate;
      const phase = (time * thrumHz) % 1;
      const envelope = Math.exp(-phase * 4.6) * Math.min(1, phase * 40);
      channel[index] = (
        Math.sin(2 * Math.PI * 58 * time) * 0.9
        + Math.sin(2 * Math.PI * 116 * time) * 0.34
        + Math.sin(2 * Math.PI * 29 * time) * 0.4
      ) * (0.24 + envelope * 0.9) * 0.5;
    }
    for (let event = 0; event < 6; event += 1) {
      resonantGrain(channel, Math.floor((event + 0.62) / 6 * length), rate, {
        frequency: 1_920,
        q: 18,
        seconds: 0.045,
        amplitude: 0.9,
        excite: noise,
        decay: 18,
      });
    }
    return normalisePeak(crossfadeTail(channel, rate), 0.9);
  }

  throw new Error(`Unknown ambience loop "${id}".`);
}

/** RMS of a rendered channel, in dBFS. @param {Float32Array<ArrayBuffer>} channel */
export function channelRmsDbfs(channel) {
  if (channel.length === 0) return -Infinity;
  let sum = 0;
  for (const sample of channel) sum += sample * sample;
  const rms = Math.sqrt(sum / channel.length);
  return rms > 0 ? 20 * Math.log10(rms) : -Infinity;
}

/** Absolute peak of a rendered channel. @param {Float32Array<ArrayBuffer>} channel */
export function channelPeak(channel) {
  let peak = 0;
  for (const sample of channel) peak = Math.max(peak, Math.abs(sample));
  return peak;
}

/**
 * Every bed id this phase authors, in both maps. Exported so the validator can
 * assert the RMS band table covers the plan exactly, with no orphans in either
 * direction.
 */
export function ambienceBedIds() {
  /** @type {string[]} */
  const ids = [];
  for (const beds of Object.values(AMBIENCE_BEDS)) {
    for (const bed of beds) if (!ids.includes(bed.id)) ids.push(bed.id);
  }
  return ids;
}

/** Flooded machinery gives way to salt air as the circuit climbs.
 * @param {number} lapLength @returns {AmbienceBed[]}
 */
export function tidelineAmbienceBeds(lapLength) {
  const base = cityAmbienceBeds("polarity", lapLength);
  const lap = Math.max(1, lapLength);
  return base.map((bed, index) => {
    if (index === 0) return { ...bed, id: "pelagic_wind", level: .18,
      window: { startDistance: lap * .26, endDistance: lap * .93, fadeMeters: 70 } };
    if (index === 1) return { ...bed, level: .10,
      zone: "underpass", zoneGain: 1.8, reverbSend: .26 };
    if (index === 2) return { ...bed, level: .045,
      zone: "underpass", zoneGain: 1.9, reverbSend: .21 };
    if (index === 3) return { ...bed, level: .09,
      window: { startDistance: lap * .2, endDistance: lap * .44, fadeMeters: 70 } };
    return { ...bed, level: .08, window: null };
  });
}
