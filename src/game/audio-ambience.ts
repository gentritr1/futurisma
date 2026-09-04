import {
  AMBIENCE_BEDS,
  AMBIENCE_LOOP_SAMPLE_RATE,
  AMBIENCE_SMOOTHING_SECONDS,
  airFilterHz,
  airLayerGain,
  airTearGain,
  ambienceDuck,
  bedTargetGain,
  cityAmbienceBeds,
  tidelineAmbienceBeds,
  PASS_BY_RELEASE_METERS,
  PASS_BY_SECONDS,
  PASS_BY_TRIGGER_METERS,
  renderAmbienceLoop,
} from "./ambience-beds.js";
import type { AmbienceBed } from "./ambience-beds.js";
import { ambienceCue, ambienceEventLevels } from "./ambience-cue.js";
import type { AmbienceMapId } from "./ambience-cue.js";
import { rivalBoostSignal, rivalBrakeSignal } from "./audio-space.js";
import type { AudioZone } from "./audio-space.js";

/**
 * A1 — the Web Audio side of the sound field.
 *
 * Three things live here, and none of them live in `game.ts`: the per-map,
 * per-sector ambience beds; the player's own speed-linked air; and the extra
 * layers each rival panner carries beyond its engine pair. `ambience-beds.js`
 * owns every number and every sample they play — this file only wires nodes and
 * moves gains.
 *
 * `audio.ts` reaches this module through a DYNAMIC import, so neither it nor
 * the ~29 s of baked loops behind it lands in the initial bundle. The two
 * things the race loop needs synchronously — the cue and the track-event
 * levels — live in `ambience-cue.ts` instead, which is why that file exists.
 */

/**
 * The one noise buffer every filtered layer in this module shares: the wind
 * beds, the player's air, the boost tear, the pass-by whoosh and the rival
 * airbrakes. Baked once per context, not once per node.
 */
const noiseBuffers = new WeakMap<BaseAudioContext, AudioBuffer>();

function createNoiseBuffer(context: BaseAudioContext): AudioBuffer {
  const cached = noiseBuffers.get(context);
  if (cached) return cached;
  const samples = renderAmbienceLoop("noise", AMBIENCE_LOOP_SAMPLE_RATE);
  const buffer = context.createBuffer(1, samples.length, AMBIENCE_LOOP_SAMPLE_RATE);
  buffer.copyToChannel(samples, 0);
  noiseBuffers.set(context, buffer);
  return buffer;
}

function loopingSource(
  context: BaseAudioContext,
  buffer: AudioBuffer,
  playbackRate: number,
  destination: AudioNode,
): AudioBufferSourceNode {
  const source = context.createBufferSource();
  source.buffer = buffer;
  source.loop = true;
  source.playbackRate.value = playbackRate;
  source.connect(destination);
  source.start();
  return source;
}

/**
 * What makes a wind bed's authored `level` mean the same thing a loop bed's
 * does. A band-passed noise pair is far hotter than a loop that has been
 * peak-normalised to 0.9, and by an amount that depends on the band, so the
 * two kinds cannot share a scale without one of them being calibrated against
 * the other.
 *
 * This number is a MEASUREMENT, not a taste call. Rendered through this exact
 * graph by `node scripts/visual/audio-probe.mjs`, the Bitterpan wind at level
 * 0.30 has to land beside the works hum at -27.3 dBFS; at 0.474 it renders
 * -26.0 and Greenwater's wetter, narrower wetland bed renders -29.8. Both
 * earlier values were wrong and the harness is what said so: 0.58 put the wind
 * 11 dB over the rest of the field, and the 0.145 that replaced it put it 9 dB
 * under.
 */
const WIND_LAYER_GAIN = 0.474;

interface BedVoice {
  bed: AmbienceBed;
  gain: GainNode;
  /** Only wind beds have a steerable upper band. */
  highFilter: BiquadFilterNode | null;
  highHz: number;
  gustHz: number;
  target: number;
}

/**
 * The per-map bed field. Built for one map at a time — a Bitterpan race never
 * allocates Greenwater's frogs.
 */
export class AmbienceField {
  readonly map: AmbienceMapId;
  private readonly bus: GainNode;
  private readonly voices: BedVoice[] = [];
  private readonly sources: AudioScheduledSourceNode[] = [];
  private readonly nodes: AudioNode[] = [];
  private readonly state = {
    distanceMeters: 0,
    lapLengthMeters: 1,
    zone: "open" as string,
    events: ambienceEventLevels() as unknown as Record<string, number>,
  };
  private prepareMs = 0;

  constructor(
    context: BaseAudioContext,
    destination: AudioNode,
    reverbSend: AudioNode | null,
    map: AmbienceMapId,
    options: { onlyBed?: string } = {},
  ) {
    const startedAt = performance.now();
    this.map = map;
    const bus = context.createGain();
    bus.gain.value = 1;
    bus.connect(destination);
    this.bus = bus;

    const noise = createNoiseBuffer(context);
    const beds = map === "tideline" ? tidelineAmbienceBeds(ambienceCue().lapLengthMeters)
      : map === "nightshift" || map === "polarity"
      ? cityAmbienceBeds(map, ambienceCue().lapLengthMeters)
      : AMBIENCE_BEDS[map];
    for (const bed of beds) {
      if (options.onlyBed && bed.id !== options.onlyBed) continue;
      const gain = context.createGain();
      gain.gain.value = 0;
      gain.connect(bus);
      if (reverbSend && bed.reverbSend > 0) {
        const send = context.createGain();
        send.gain.value = bed.reverbSend;
        gain.connect(send);
        send.connect(reverbSend);
        this.nodes.push(send);
      }
      let highFilter: BiquadFilterNode | null = null;
      if (bed.kind === "wind" && bed.wind) {
        highFilter = this.installWindBed(context, noise, bed.wind, gain);
      } else {
        const samples = renderAmbienceLoop(bed.id, AMBIENCE_LOOP_SAMPLE_RATE);
        const buffer = context.createBuffer(
          1,
          samples.length,
          AMBIENCE_LOOP_SAMPLE_RATE,
        );
        buffer.copyToChannel(samples, 0);
        this.sources.push(loopingSource(context, buffer, 1, gain));
      }
      this.nodes.push(gain);
      this.voices.push({
        bed,
        gain,
        highFilter,
        highHz: bed.wind?.highHz ?? 0,
        gustHz: bed.wind?.gustHz ?? 0,
        target: 0,
      });
    }
    this.prepareMs = performance.now() - startedAt;
  }

  /**
   * Two band-passed layers of the same noise buffer at different playback
   * rates, each wandering on its own sub-0.1 Hz LFO. The two rates are what
   * stop a 4.13 s loop from being audible as a loop.
   */
  private installWindBed(
    context: BaseAudioContext,
    noise: AudioBuffer,
    profile: { lowHz: number; highHz: number; lowLfoHz: number; highLfoHz: number },
    destination: GainNode,
  ): BiquadFilterNode {
    let high: BiquadFilterNode | null = null;
    const layers: [number, number, number, number, number][] = [
      [profile.lowHz, 0.55, 0.78, profile.lowLfoHz, 0.45],
      [profile.highHz, 0.85, 1.31, profile.highLfoHz, 0.4],
    ];
    for (const [frequency, q, rate, lfoHz, depth] of layers) {
      const filter = context.createBiquadFilter();
      filter.type = "bandpass";
      filter.frequency.value = frequency;
      filter.Q.value = q;
      const layerGain = context.createGain();
      layerGain.gain.value = WIND_LAYER_GAIN;
      filter.connect(layerGain);
      layerGain.connect(destination);
      this.sources.push(loopingSource(context, noise, rate, filter));
      const lfo = context.createOscillator();
      lfo.type = "sine";
      lfo.frequency.value = lfoHz;
      const lfoDepth = context.createGain();
      lfoDepth.gain.value = depth * WIND_LAYER_GAIN;
      lfo.connect(lfoDepth);
      lfoDepth.connect(layerGain.gain);
      lfo.start();
      this.sources.push(lfo);
      this.nodes.push(filter, layerGain, lfoDepth);
      if (frequency === profile.highHz) high = filter;
    }
    return high as BiquadFilterNode;
  }

  /**
   * One control tick. `immediate` is the offline-render path: the validator
   * harness needs the authored steady state, not a 2 s approach to it.
   */
  update(
    now: number,
    zone: AudioZone,
    music: { trance: number; jungle: number; deep_dnb: number; techstep: number },
    immediate = false,
  ): void {
    // The solver input is one reused object; a 30 Hz tick allocates nothing.
    const state = this.state;
    const cue = ambienceCue();
    state.distanceMeters = cue.distanceMeters;
    state.lapLengthMeters = cue.lapLengthMeters;
    state.zone = zone;
    const duck = ambienceDuck(music);
    if (immediate) this.bus.gain.value = duck;
    else this.bus.gain.setTargetAtTime(duck, now, AMBIENCE_SMOOTHING_SECONDS);
    for (const voice of this.voices) {
      voice.target = bedTargetGain(voice.bed, state);
      if (immediate) voice.gain.gain.value = voice.target;
      else voice.gain.gain.setTargetAtTime(voice.target, now, AMBIENCE_SMOOTHING_SECONDS);
      if (!voice.highFilter) continue;
      // A gust does not only get louder, it gets brighter and drier.
      const swell = voice.highHz + voice.gustHz * ambienceEventLevels().windGust;
      if (immediate) voice.highFilter.frequency.value = swell;
      else voice.highFilter.frequency.setTargetAtTime(swell, now, 0.6);
    }
  }

  /** Live bed gains, read back off the nodes rather than off the solver. */
  levels(target: Record<string, number>): Record<string, number> {
    for (const voice of this.voices) target[voice.bed.id] = voice.gain.gain.value;
    return target;
  }

  get preparationMs(): number {
    return this.prepareMs;
  }

  get bedCount(): number {
    return this.voices.length;
  }

  dispose(): void {
    for (const source of this.sources) {
      try {
        source.stop();
      } catch {
        // Already ended; nothing to stop.
      }
      source.disconnect();
    }
    this.sources.length = 0;
    for (const node of this.nodes) node.disconnect();
    this.nodes.length = 0;
    this.voices.length = 0;
    this.bus.disconnect();
  }
}

/**
 * The player's own air. `windGain` in `audio.ts` already scales a flat noise bed
 * with speed and stays exactly as it was; this adds the two things that were
 * missing — a band that RISES with speed, so 400 km/h is a different sound and
 * not just a louder one, and a bright tear that only exists under boost.
 *
 * The pass-by whoosh lives here too rather than on the rival voices, because it
 * is a thing that happens to the PLAYER's air when something goes past it.
 */
export class PlayerAirField {
  private readonly filter: BiquadFilterNode;
  private readonly gain: GainNode;
  private readonly tearGain: GainNode;
  private readonly whooshGain: GainNode;
  private readonly whooshFilter: BiquadFilterNode;
  private readonly sources: AudioScheduledSourceNode[] = [];
  private readonly nodes: AudioNode[] = [];
  private passByArmed = true;
  private whooshes = 0;

  constructor(context: BaseAudioContext, destination: AudioNode) {
    const noise = createNoiseBuffer(context);

    const filter = context.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = airFilterHz(0);
    filter.Q.value = 0.62;
    const gain = context.createGain();
    gain.gain.value = 0;
    filter.connect(gain);
    gain.connect(destination);
    this.sources.push(loopingSource(context, noise, 1.07, filter));

    const tearFilter = context.createBiquadFilter();
    tearFilter.type = "highpass";
    tearFilter.frequency.value = 2_400;
    tearFilter.Q.value = 1.4;
    const tearGain = context.createGain();
    tearGain.gain.value = 0;
    tearFilter.connect(tearGain);
    tearGain.connect(destination);
    this.sources.push(loopingSource(context, noise, 1.63, tearFilter));

    const whooshFilter = context.createBiquadFilter();
    whooshFilter.type = "bandpass";
    whooshFilter.frequency.value = 900;
    whooshFilter.Q.value = 1.1;
    const whooshGain = context.createGain();
    whooshGain.gain.value = 0;
    whooshFilter.connect(whooshGain);
    whooshGain.connect(destination);
    this.sources.push(loopingSource(context, noise, 0.91, whooshFilter));

    this.filter = filter;
    this.gain = gain;
    this.tearGain = tearGain;
    this.whooshGain = whooshGain;
    this.whooshFilter = whooshFilter;
    this.nodes.push(filter, gain, tearFilter, tearGain, whooshFilter, whooshGain);
  }

  update(now: number, speedRatio: number, boost: boolean): void {
    this.filter.frequency.setTargetAtTime(airFilterHz(speedRatio), now, 0.09);
    this.gain.gain.setTargetAtTime(airLayerGain(speedRatio), now, 0.1);
    this.tearGain.gain.setTargetAtTime(airTearGain(speedRatio, boost), now, 0.06);
  }

  /**
   * One filtered swell when a rival crosses inside 4 m, re-armed only once it
   * is 9 m out again. The hysteresis is what stops a side-by-side pair of craft
   * chattering the cue for a whole corner.
   */
  passBy(now: number, nearestMeters: number, closingMetersPerSecond: number): void {
    if (nearestMeters > PASS_BY_RELEASE_METERS) {
      this.passByArmed = true;
      return;
    }
    if (!this.passByArmed || nearestMeters > PASS_BY_TRIGGER_METERS) return;
    this.passByArmed = false;
    this.whooshes += 1;
    const speed = Math.min(1, Math.abs(closingMetersPerSecond) / 30);
    const gain = this.whooshGain.gain;
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(0.0001, now);
    gain.linearRampToValueAtTime(0.05 + speed * 0.05, now + PASS_BY_SECONDS * 0.34);
    gain.linearRampToValueAtTime(0.0001, now + PASS_BY_SECONDS);
    const frequency = this.whooshFilter.frequency;
    frequency.cancelScheduledValues(now);
    frequency.setValueAtTime(1_500, now);
    frequency.linearRampToValueAtTime(420, now + PASS_BY_SECONDS);
  }

  get passByCount(): number {
    return this.whooshes;
  }

  dispose(): void {
    for (const source of this.sources) {
      try {
        source.stop();
      } catch {
        // Already ended.
      }
      source.disconnect();
    }
    this.sources.length = 0;
    for (const node of this.nodes) node.disconnect();
    this.nodes.length = 0;
    this.passByArmed = true;
    this.whooshes = 0;
  }
}

/**
 * The two layers a rival carries on top of its engine pair, into the same
 * panner so they arrive from the same place: a bright boost saw and an airbrake
 * hiss.
 *
 * Both signals are read out of the rival's own velocity stream rather than out
 * of a widened `RivalSpatialSource`. That contract is two methods wide on
 * purpose and the rival simulation owns its own determinism; d|v|/dt is enough
 * to tell a boost from a corner and costs the simulation nothing.
 */
export class RivalVoiceLayers {
  private readonly boostGain: GainNode;
  private readonly boostOscillator: OscillatorNode;
  private readonly brakeGain: GainNode;
  private readonly sources: AudioScheduledSourceNode[] = [];
  private readonly nodes: AudioNode[] = [];
  private smoothedAcceleration = 0;
  private previousSpeed = 0;
  private hasPreviousSpeed = false;
  /** Reused: the control tick runs 30 times a second and allocates nothing. */
  private readonly signals = { boost: 0, brake: 0 };

  constructor(
    context: BaseAudioContext,
    destination: AudioNode,
    detune: number,
  ) {
    const boostGain = context.createGain();
    boostGain.gain.value = 0;
    boostGain.connect(destination);
    const boostOscillator = context.createOscillator();
    boostOscillator.type = "sawtooth";
    boostOscillator.frequency.value = 132 * detune;
    boostOscillator.connect(boostGain);
    boostOscillator.start();
    this.sources.push(boostOscillator);

    const brakeFilter = context.createBiquadFilter();
    brakeFilter.type = "bandpass";
    brakeFilter.frequency.value = 3_100;
    brakeFilter.Q.value = 0.8;
    const brakeGain = context.createGain();
    brakeGain.gain.value = 0;
    brakeFilter.connect(brakeGain);
    brakeGain.connect(destination);
    this.sources.push(
      loopingSource(context, createNoiseBuffer(context), 1.19 * detune, brakeFilter),
    );

    this.boostGain = boostGain;
    this.boostOscillator = boostOscillator;
    this.brakeGain = brakeGain;
    this.nodes.push(boostGain, brakeFilter, brakeGain);
  }

  /**
   * @param speed metres per second, this tick
   * @param deltaSeconds control interval
   * @param doppler pitch multiplier from the closing speed
   * @param racing gate: the grid is silent through the countdown
   */
  update(
    now: number,
    speed: number,
    deltaSeconds: number,
    doppler: number,
    racing: boolean,
  ): { boost: number; brake: number } {
    const step = deltaSeconds > 1e-4 ? deltaSeconds : 1 / 30;
    const raw = this.hasPreviousSpeed ? (speed - this.previousSpeed) / step : 0;
    this.previousSpeed = speed;
    this.hasPreviousSpeed = true;
    // A 30 Hz difference of a simulated speed is noisy; one pole of smoothing
    // keeps a corner from reading as a brake stab.
    this.smoothedAcceleration += (raw - this.smoothedAcceleration) * 0.35;
    const boost = racing ? rivalBoostSignal(this.smoothedAcceleration) : 0;
    const brake = racing ? rivalBrakeSignal(this.smoothedAcceleration) : 0;
    this.boostGain.gain.setTargetAtTime(boost * 0.0075, now, 0.07);
    this.boostOscillator.frequency.setTargetAtTime(
      (118 + boost * 46) * doppler,
      now,
      0.07,
    );
    this.brakeGain.gain.setTargetAtTime(brake * 0.011, now, 0.05);
    this.signals.boost = boost;
    this.signals.brake = brake;
    return this.signals;
  }

  reset(): void {
    this.hasPreviousSpeed = false;
    this.previousSpeed = 0;
    this.smoothedAcceleration = 0;
  }

  dispose(): void {
    for (const source of this.sources) {
      try {
        source.stop();
      } catch {
        // Already ended.
      }
      source.disconnect();
    }
    this.sources.length = 0;
    for (const node of this.nodes) node.disconnect();
    this.nodes.length = 0;
    this.reset();
  }
}
