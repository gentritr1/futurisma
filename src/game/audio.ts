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
} from "./audio-timing";
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
} from "./music-plan";

export interface MusicProfile {
  trance: number;
  jungle: number;
  deep_dnb: number;
  techstep: number;
}

type StemName = keyof MusicProfile;
type WaveShape = "sine" | "metal";

interface StemAutomation {
  from: number;
  target: number;
  start: number;
  end: number;
}

const BEAT_SECONDS = 60 / MUSIC_BPM;
const BAR_SECONDS = BEAT_SECONDS * 4;
const CONTROL_INTERVAL_SECONDS = 1 / 30;
const STEM_NAMES: StemName[] = ["trance", "jungle", "deep_dnb", "techstep"];
const STEM_GAIN: Record<StemName, number> = {
  trance: 0.075,
  jungle: 0.085,
  deep_dnb: 0.09,
  techstep: 0.075,
};
const STEM_PAN: Record<StemName, number> = {
  trance: -0.18,
  jungle: 0.12,
  deep_dnb: 0,
  techstep: 0.2,
};

function seededRandom(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 0x1_0000_0000;
  };
}

export class EngineAudio {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private engineGain: GainNode | null = null;
  private engineFilter: BiquadFilterNode | null = null;
  private engineOscillator: OscillatorNode | null = null;
  private harmonicOscillator: OscillatorNode | null = null;
  private harmonicGain: GainNode | null = null;
  private windGain: GainNode | null = null;
  private musicFilter: BiquadFilterNode | null = null;
  private musicShelf: BiquadFilterNode | null = null;
  private readonly stemGains = new Map<StemName, GainNode>();
  private readonly stemAutomation = new Map<StemName, StemAutomation>();
  private readonly persistentSources: AudioScheduledSourceNode[] = [];
  private readonly musicFilterTargets = { lowpassHz: 2100, highShelfDb: 0 };
  private musicProfileKey = -1;
  private musicStartTime = 0;
  private nextControlUpdateTime = 0;
  private diagnosticControlUpdates = 0;
  private diagnosticControlStartedAt = 0;
  private diagnosticMusicTransitions = 0;
  private diagnosticMusicPreparationMs = 0;
  private diagnosticInitializationMs = 0;
  private diagnosticMaxMusicLowpassHz = 0;
  private diagnosticMaxMusicHighShelfDb = 0;
  private activeOneShots = 0;
  private diagnosticPeakActiveOneShots = 0;
  private diagnosticSkippedOneShots = 0;
  private diagnosticRaceEventCues = 0;
  private musicSampleRate = 0;
  private muted = false;
  private paused = false;
  private readonly preparedStemSamples = new Map<StemName, Float32Array<ArrayBuffer>>();

  constructor() {
    const preparationStartedAt = performance.now();
    for (const name of STEM_NAMES) {
      this.preparedStemSamples.set(name, this.createStemSamples(name));
    }
    this.diagnosticMusicPreparationMs = performance.now() - preparationStartedAt;
  }

  async start(): Promise<void> {
    if (this.context) {
      await this.context.resume();
      return;
    }

    const initializationStartedAt = performance.now();
    const context = new AudioContext();
    const master = context.createGain();
    master.gain.value = 0.34;
    const compressor = context.createDynamicsCompressor();
    compressor.threshold.value = -12;
    compressor.knee.value = 10;
    compressor.ratio.value = 6;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.12;
    master.connect(compressor);
    compressor.connect(context.destination);

    const filter = context.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 880;
    filter.Q.value = 1.2;
    filter.connect(master);

    const engineGain = context.createGain();
    engineGain.gain.value = 0.02;
    engineGain.connect(filter);
    const engineOscillator = context.createOscillator();
    engineOscillator.type = "sawtooth";
    engineOscillator.frequency.value = 54;
    engineOscillator.connect(engineGain);
    engineOscillator.start();
    this.persistentSources.push(engineOscillator);

    const harmonicGain = context.createGain();
    harmonicGain.gain.value = 0.012;
    harmonicGain.connect(filter);
    const harmonicOscillator = context.createOscillator();
    harmonicOscillator.type = "triangle";
    harmonicOscillator.frequency.value = 108;
    harmonicOscillator.connect(harmonicGain);
    harmonicOscillator.start();
    this.persistentSources.push(harmonicOscillator);

    const windGain = context.createGain();
    windGain.gain.value = 0;
    windGain.connect(filter);
    const noise = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
    const channel = noise.getChannelData(0);
    const random = seededRandom(714);
    for (let index = 0; index < channel.length; index += 1) {
      channel[index] = random() * 2 - 1;
    }
    const wind = context.createBufferSource();
    wind.buffer = noise;
    wind.loop = true;
    wind.connect(windGain);
    wind.start();
    this.persistentSources.push(wind);

    this.context = context;
    this.master = master;
    this.engineGain = engineGain;
    this.engineFilter = filter;
    this.engineOscillator = engineOscillator;
    this.harmonicOscillator = harmonicOscillator;
    this.harmonicGain = harmonicGain;
    this.windGain = windGain;
    this.installMusic(context, master);
    this.diagnosticInitializationMs = performance.now() - initializationStartedAt;
  }

  update(
    speedRatio: number,
    throttle: number,
    brake: number,
    boost: boolean,
    surfaceGrip: number,
    driftIntensity: number,
  ): boolean {
    if (
      !this.context
      || !audioClockAdvances(this.context.state)
      || !this.engineOscillator
      || !this.harmonicOscillator
    ) return false;
    const now = this.context.currentTime;
    if (!fixedRateUpdateDue(now, this.nextControlUpdateTime, CONTROL_INTERVAL_SECONDS)) {
      return false;
    }
    this.nextControlUpdateTime = advanceFixedRateDeadline(
      now,
      this.nextControlUpdateTime,
      CONTROL_INTERVAL_SECONDS,
    );
    this.diagnosticControlUpdates += 1;
    const baseFrequency = 52 + speedRatio * 118 + throttle * 24 + (boost ? 18 : 0);
    this.engineOscillator.frequency.setTargetAtTime(baseFrequency, now, 0.045);
    this.harmonicOscillator.frequency.setTargetAtTime(baseFrequency * 2.03, now, 0.04);
    this.engineGain?.gain.setTargetAtTime(0.025 + throttle * 0.035 + speedRatio * 0.025, now, 0.08);
    this.harmonicGain?.gain.setTargetAtTime(0.008 + speedRatio * 0.021 + (boost ? 0.02 : 0), now, 0.06);
    this.windGain?.gain.setTargetAtTime(
      Math.pow(speedRatio, 2) * (0.045 + brake * 0.035)
        + (1 - surfaceGrip) * speedRatio * 0.07
        + driftIntensity * speedRatio * 0.045,
      now,
      0.1,
    );
    this.engineFilter?.frequency.setTargetAtTime(
      820
        + speedRatio * 1_850
        + brake * 420
        + driftIntensity * 480
        + (boost ? 1_400 : 0),
      now,
      0.08,
    );
    const musicTargets = resolveMusicFilterTargets(
      speedRatio,
      boost,
      this.musicFilterTargets,
    );
    this.musicFilter?.frequency.setTargetAtTime(musicTargets.lowpassHz, now, 0.12);
    this.musicShelf?.gain.setTargetAtTime(musicTargets.highShelfDb, now, 0.08);
    this.diagnosticMaxMusicLowpassHz = Math.max(
      this.diagnosticMaxMusicLowpassHz,
      musicTargets.lowpassHz,
    );
    this.diagnosticMaxMusicHighShelfDb = Math.max(
      this.diagnosticMaxMusicHighShelfDb,
      musicTargets.highShelfDb,
    );
    return true;
  }

  setMusicProfile(profile: MusicProfile): void {
    if (!this.context || !audioClockAdvances(this.context.state)) return;
    const key = encodeMusicProfileKey(
      profile.trance,
      profile.jungle,
      profile.deep_dnb,
      profile.techstep,
    );
    if (key === this.musicProfileKey) return;
    this.musicProfileKey = key;
    this.diagnosticMusicTransitions += 1;
    const now = this.context.currentTime;
    const transitionStart = nextQuantizedTime(
      now,
      this.musicStartTime,
      BAR_SECONDS,
    );
    for (const name of STEM_NAMES) {
      const level = Math.max(0, Math.min(3, profile[name]));
      const target = (level / 3) * STEM_GAIN[name];
      const gain = this.stemGains.get(name)?.gain;
      if (!gain) continue;
      const previous = this.stemAutomation.get(name) ?? {
        from: gain.value,
        target: gain.value,
        start: now,
        end: now,
      };
      const heldValue = sampleLinearAutomation(
        now,
        previous.from,
        previous.target,
        previous.start,
        previous.end,
      );
      gain.cancelScheduledValues(now);
      gain.setValueAtTime(heldValue, now);
      gain.setValueAtTime(heldValue, transitionStart);
      const transitionEnd = transitionStart + BAR_SECONDS;
      gain.linearRampToValueAtTime(target, transitionEnd);
      this.stemAutomation.set(name, {
        from: heldValue,
        target,
        start: transitionStart,
        end: transitionEnd,
      });
    }
  }

  playGate(index: number): void {
    const noteIndex = ((index - 1) % GATE_CHIME_MIDI.length
      + GATE_CHIME_MIDI.length) % GATE_CHIME_MIDI.length;
    const note = GATE_CHIME_MIDI[noteIndex];
    const frequency = frequencyForMidiNote(note);
    this.playTone(frequency, 0.11, 0.038, "square", 0, 1.02);
    this.playTone(frequency * 1.5, 0.15, 0.022, "sine", 0.045, 1.01);
  }

  playMissedGate(): void {
    this.playTone(150, 0.2, 0.038, "square", 0, 0.58);
    this.playTone(94, 0.26, 0.03, "sawtooth", 0.08, 0.72);
  }

  playCountdown(go: boolean): void {
    this.playTone(go ? 520 : 260, go ? 0.16 : 0.09, go ? 0.045 : 0.028, "square");
  }

  playBoost(): void {
    this.playTone(115, 0.2, 0.04, "sawtooth", 0, 2.2);
    this.playTone(460, 0.14, 0.024, "square", 0.04, 1.5);
  }

  /**
   * One cue serves both drift edges. Entry keeps the original 210 Hz square
   * blip (`releaseCharge` 0); a rewarded release replays the same one-shot
   * pitched and opened up by the bank it paid out, so a big drift cashes in an
   * octave above a marginal one without adding a second voice to the mix.
   */
  playDriftEngage(releaseCharge = 0): void {
    const charge = Math.min(1, Math.max(0, releaseCharge));
    this.playTone(
      210 * (1 + charge),
      0.11 + charge * 0.05,
      0.018 + charge * 0.014,
      "square",
      0,
      0.74,
    );
  }

  playImpact(intensity: number): void {
    const strength = Math.min(1, Math.max(0, intensity));
    this.playTone(105 + strength * 35, 0.13, 0.025 + strength * 0.04, "square", 0, 0.58);
  }

  playLap(): void {
    this.playTone(330, 0.18, 0.05, "triangle");
    this.playTone(495, 0.24, 0.04, "sine", 0.08);
  }

  playFinish(): void {
    this.playTone(330, 0.28, 0.055, "sawtooth");
    this.playTone(495, 0.32, 0.045, "triangle", 0.06);
    this.playTone(660, 0.38, 0.038, "sine", 0.12);
  }

  playPositionChange(gained: boolean): void {
    const notes = gained
      ? RACE_EVENT_MIDI.positionGain
      : RACE_EVENT_MIDI.positionLoss;
    this.playTone(frequencyForMidiNote(notes[0]), 0.11, 0.026, "square", 0, 1.01);
    this.playTone(frequencyForMidiNote(notes[1]), 0.16, 0.02, "sine", 0.055, 1.01);
    this.diagnosticRaceEventCues += 1;
  }

  playFinalLap(): void {
    this.playTone(
      frequencyForMidiNote(RACE_EVENT_MIDI.finalLap[0]),
      0.16,
      0.032,
      "square",
      0,
      1.01,
    );
    this.playTone(
      frequencyForMidiNote(RACE_EVENT_MIDI.finalLap[1]),
      0.24,
      0.026,
      "triangle",
      0.08,
      1.01,
    );
    this.diagnosticRaceEventCues += 1;
  }

  playClassification(): void {
    this.playTone(
      frequencyForMidiNote(RACE_EVENT_MIDI.classification[0]),
      0.2,
      0.032,
      "triangle",
      0,
      1.01,
    );
    this.playTone(
      frequencyForMidiNote(RACE_EVENT_MIDI.classification[1]),
      0.28,
      0.024,
      "sine",
      0.09,
      1.01,
    );
    this.diagnosticRaceEventCues += 1;
  }

  playRecovery(): void {
    this.playTone(190, 0.16, 0.034, "square", 0, 1.7);
    this.playTone(380, 0.2, 0.028, "triangle", 0.1, 1.32);
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    this.updateMasterGain();
    return this.muted;
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    if (!paused) void this.context?.resume().catch(() => undefined);
    this.updateMasterGain();
  }

  resetDiagnostics(): void {
    this.diagnosticControlUpdates = 0;
    this.diagnosticControlStartedAt = this.context?.currentTime ?? 0;
    this.diagnosticMusicTransitions = 0;
    this.diagnosticMaxMusicLowpassHz = 0;
    this.diagnosticMaxMusicHighShelfDb = 0;
    this.diagnosticPeakActiveOneShots = this.activeOneShots;
    this.diagnosticSkippedOneShots = 0;
    this.diagnosticRaceEventCues = 0;
  }

  diagnostics(): {
    contextState: AudioContextState | "uninitialized";
    controlUpdates: number;
    controlHz: number;
    controlTargetHz: number;
    musicTransitions: number;
    musicProfileKey: number;
    musicLoopBeats: number;
    musicLoopSeconds: number;
    musicSampleRate: number;
    musicKey: string;
    maxMusicLowpassHz: number;
    maxMusicHighShelfDb: number;
    activeOneShots: number;
    peakActiveOneShots: number;
    skippedOneShots: number;
    raceEventCues: number;
    musicPreparationMs: number;
    initializationMs: number;
  } {
    const elapsed = this.context
      ? Math.max(0, this.context.currentTime - this.diagnosticControlStartedAt)
      : 0;
    return {
      contextState: this.context?.state ?? "uninitialized",
      controlUpdates: this.diagnosticControlUpdates,
      controlHz: elapsed > 0
        ? this.diagnosticControlUpdates / elapsed
        : 0,
      controlTargetHz: 1 / CONTROL_INTERVAL_SECONDS,
      musicTransitions: this.diagnosticMusicTransitions,
      musicProfileKey: this.musicProfileKey,
      musicLoopBeats: MUSIC_LOOP_BEATS,
      musicLoopSeconds: BEAT_SECONDS * MUSIC_LOOP_BEATS,
      musicSampleRate: this.musicSampleRate,
      musicKey: MUSIC_KEY,
      maxMusicLowpassHz: this.diagnosticMaxMusicLowpassHz,
      maxMusicHighShelfDb: this.diagnosticMaxMusicHighShelfDb,
      activeOneShots: this.activeOneShots,
      peakActiveOneShots: this.diagnosticPeakActiveOneShots,
      skippedOneShots: this.diagnosticSkippedOneShots,
      raceEventCues: this.diagnosticRaceEventCues,
      musicPreparationMs: this.diagnosticMusicPreparationMs,
      initializationMs: this.diagnosticInitializationMs,
    };
  }

  dispose(): void {
    for (const source of this.persistentSources) {
      try {
        source.stop();
      } catch {
        // A source that already ended needs no further cleanup.
      }
      source.disconnect();
    }
    this.persistentSources.length = 0;
    this.preparedStemSamples.clear();
    this.stemGains.clear();
    this.stemAutomation.clear();
    void this.context?.close();
    this.context = null;
    this.master = null;
    this.engineGain = null;
    this.engineFilter = null;
    this.engineOscillator = null;
    this.harmonicOscillator = null;
    this.harmonicGain = null;
    this.windGain = null;
    this.musicFilter = null;
    this.musicShelf = null;
    this.musicProfileKey = -1;
    this.musicStartTime = 0;
    this.nextControlUpdateTime = 0;
    this.diagnosticControlUpdates = 0;
    this.diagnosticControlStartedAt = 0;
    this.diagnosticMusicTransitions = 0;
    this.diagnosticInitializationMs = 0;
    this.diagnosticMaxMusicLowpassHz = 0;
    this.diagnosticMaxMusicHighShelfDb = 0;
    this.activeOneShots = 0;
    this.diagnosticPeakActiveOneShots = 0;
    this.diagnosticSkippedOneShots = 0;
    this.diagnosticRaceEventCues = 0;
    this.musicSampleRate = 0;
  }

  private installMusic(context: AudioContext, master: GainNode): void {
    const musicFilter = context.createBiquadFilter();
    musicFilter.type = "lowpass";
    musicFilter.frequency.value = 2100;
    musicFilter.Q.value = 0.78;
    const musicShelf = context.createBiquadFilter();
    musicShelf.type = "highshelf";
    musicShelf.frequency.value = 1800;
    musicShelf.gain.value = 0;
    musicFilter.connect(musicShelf);
    musicShelf.connect(master);
    this.musicFilter = musicFilter;
    this.musicShelf = musicShelf;

    const startAt = context.currentTime + 0.08;
    this.musicStartTime = startAt;
    for (const name of STEM_NAMES) {
      const gain = context.createGain();
      gain.gain.value = 0;
      const panner = context.createStereoPanner();
      panner.pan.value = STEM_PAN[name];
      gain.connect(panner);
      panner.connect(musicFilter);
      const source = context.createBufferSource();
      source.buffer = this.createStemBuffer(context, name);
      source.loop = true;
      source.connect(gain);
      source.start(startAt);
      this.persistentSources.push(source);
      this.stemGains.set(name, gain);
      this.stemAutomation.set(name, {
        from: 0,
        target: 0,
        start: startAt,
        end: startAt,
      });
    }
    this.preparedStemSamples.clear();
  }

  private createStemBuffer(context: AudioContext, stem: StemName): AudioBuffer {
    const samples = this.preparedStemSamples.get(stem);
    if (!samples) throw new Error(`Prepared ${stem} music stem is missing.`);
    const buffer = context.createBuffer(
      1,
      samples.length,
      MUSIC_STEM_SAMPLE_RATE,
    );
    buffer.copyToChannel(samples, 0);
    this.musicSampleRate = MUSIC_STEM_SAMPLE_RATE;
    return buffer;
  }

  private createStemSamples(stem: StemName): Float32Array<ArrayBuffer> {
    const duration = BEAT_SECONDS * MUSIC_LOOP_BEATS;
    const sampleRate = MUSIC_STEM_SAMPLE_RATE;
    const length = Math.ceil(duration * sampleRate);
    const channel = new Float32Array(length);
    const random = seededRandom(
      stem === "trance" ? 101 : stem === "jungle" ? 202 : stem === "deep_dnb" ? 303 : 404,
    );

    const addTone = (
      beat: number,
      beatDuration: number,
      frequency: number,
      amplitude: number,
      shape: WaveShape = "sine",
    ): void => {
      const start = Math.floor(beat * BEAT_SECONDS * sampleRate);
      const sampleDuration = beatDuration * BEAT_SECONDS;
      const count = Math.min(length - start, Math.floor(sampleDuration * sampleRate));
      for (let index = 0; index < count; index += 1) {
        const time = index / sampleRate;
        const progress = time / sampleDuration;
        const envelope = Math.exp(-progress * 5.2) * Math.min(1, progress * 34);
        const phase = Math.PI * 2 * frequency * time;
        const wave = shape === "metal"
          ? Math.sin(phase) * 0.65 + Math.sin(phase * 1.414) * 0.35
          : Math.sin(phase) + Math.sin(phase * 2) * 0.16;
        channel[start + index] += wave * envelope * amplitude;
      }
    };

    const addNoise = (beat: number, beatDuration: number, amplitude: number): void => {
      const start = Math.floor(beat * BEAT_SECONDS * sampleRate);
      const sampleDuration = beatDuration * BEAT_SECONDS;
      const count = Math.min(length - start, Math.floor(sampleDuration * sampleRate));
      let previous = 0;
      for (let index = 0; index < count; index += 1) {
        const progress = index / Math.max(1, count);
        const noise = random() * 2 - 1;
        const brightNoise = noise - previous * 0.72;
        previous = noise;
        channel[start + index] += brightNoise * Math.exp(-progress * 8) * amplitude;
      }
    };

    const addKick = (beat: number, amplitude: number): void => {
      const start = Math.floor(beat * BEAT_SECONDS * sampleRate);
      const sampleDuration = BEAT_SECONDS * 0.52;
      const count = Math.min(length - start, Math.floor(sampleDuration * sampleRate));
      let phase = 0;
      for (let index = 0; index < count; index += 1) {
        const time = index / sampleRate;
        const progress = time / sampleDuration;
        const frequency = 46 + 108 * Math.exp(-progress * 13);
        phase += Math.PI * 2 * frequency / sampleRate;
        const envelope = Math.exp(-progress * 8.4) * Math.min(1, progress * 45);
        channel[start + index] += Math.sin(phase) * envelope * amplitude;
      }
    };

    const addPad = (
      beat: number,
      beatDuration: number,
      frequencies: readonly number[],
      amplitude: number,
    ): void => {
      const start = Math.floor(beat * BEAT_SECONDS * sampleRate);
      const sampleDuration = beatDuration * BEAT_SECONDS;
      const count = Math.min(length - start, Math.floor(sampleDuration * sampleRate));
      for (let index = 0; index < count; index += 1) {
        const time = index / sampleRate;
        const progress = time / sampleDuration;
        const envelope = Math.min(1, progress * 5) * Math.min(1, (1 - progress) * 5);
        let wave = 0;
        for (const frequency of frequencies) {
          wave += Math.sin(Math.PI * 2 * frequency * time)
            + Math.sin(Math.PI * 2 * frequency * 1.006 * time) * 0.34;
        }
        channel[start + index] += wave / frequencies.length * envelope * amplitude;
      }
    };

    if (stem === "trance") {
      for (let bar = 0; bar < 4; bar += 1) {
        addPad(
          bar * 4,
          4,
          TRANCE_CHORD_MIDI[bar].map(frequencyForMidiNote),
          0.12,
        );
      }
      for (let beat = 0; beat < MUSIC_LOOP_BEATS; beat += 1) {
        addKick(beat, 0.62);
        addTone(
          beat + 0.5,
          0.22,
          frequencyForMidiNote(TRANCE_PLUCK_MIDI[beat]),
          0.16,
          "metal",
        );
      }
    } else if (stem === "jungle") {
      for (const beat of [0, 1.5, 2.75, 4, 5.5, 6.75, 8, 9.25, 10.75, 12, 13.5, 14.25, 15.25]) {
        addKick(beat, beat >= 8 ? 0.5 : 0.56);
      }
      for (const beat of [1, 3, 5, 7, 9, 11, 13, 15]) addNoise(beat, 0.42, 0.46);
      for (let beat = 0.25; beat < MUSIC_LOOP_BEATS; beat += 0.5) {
        addNoise(beat, 0.1, beat % 2 === 0.25 ? 0.15 : 0.11);
      }
    } else if (stem === "deep_dnb") {
      for (const event of DEEP_DNB_BASS_EVENTS) {
        addTone(event.beat, 1.55, frequencyForMidiNote(event.midiNote), 0.72);
      }
      for (const beat of [2, 6, 10, 14]) addNoise(beat, 0.65, 0.38);
      for (const beat of [0, 4, 8, 12]) {
        addTone(beat, 0.38, frequencyForMidiNote(36), 0.42);
      }
    } else {
      for (const beat of [0, 0.75, 1.5, 2.75, 4, 4.5, 5.75, 7, 8, 8.5, 9.75, 10.5, 12, 13.25, 14.5, 15.25]) {
        const midiNote = beat % 1 === 0
          ? TECHSTEP_HIT_MIDI.downbeat
          : TECHSTEP_HIT_MIDI.offbeat;
        addTone(beat, 0.24, frequencyForMidiNote(midiNote), 0.34, "metal");
      }
      for (const beat of [0, 4, 8, 12]) addKick(beat, 0.5);
      for (const beat of [1, 3, 5, 7, 9, 11, 13, 15]) addNoise(beat, 0.24, 0.3);
    }

    let peak = 0;
    for (const sample of channel) peak = Math.max(peak, Math.abs(sample));
    const scale = peak > 0 ? 0.78 / peak : 1;
    for (let index = 0; index < channel.length; index += 1) channel[index] *= scale;
    return channel;
  }

  private playTone(
    frequency: number,
    duration: number,
    amplitude: number,
    type: OscillatorType,
    delay = 0,
    endFrequencyRatio = 1.35,
  ): void {
    if (!this.context || !this.master) return;
    if (!audioClockAdvances(this.context.state)) {
      this.diagnosticSkippedOneShots += 1;
      return;
    }
    const now = this.context.currentTime + delay;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, now);
    oscillator.frequency.exponentialRampToValueAtTime(
      frequency * endFrequencyRatio,
      now + duration,
    );
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(amplitude, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    oscillator.connect(gain);
    gain.connect(this.master);
    this.activeOneShots += 1;
    this.diagnosticPeakActiveOneShots = Math.max(
      this.diagnosticPeakActiveOneShots,
      this.activeOneShots,
    );
    oscillator.addEventListener("ended", () => {
      this.activeOneShots = Math.max(0, this.activeOneShots - 1);
      oscillator.disconnect();
      gain.disconnect();
    }, { once: true });
    oscillator.start(now);
    oscillator.stop(now + duration + 0.02);
  }

  private updateMasterGain(): void {
    if (!this.context || !this.master) return;
    this.master.gain.setTargetAtTime(
      this.muted || this.paused ? 0 : 0.34,
      this.context.currentTime,
      0.045,
    );
  }
}
