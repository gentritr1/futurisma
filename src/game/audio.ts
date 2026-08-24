export interface MusicProfile {
  trance: number;
  jungle: number;
  deep_dnb: number;
  techstep: number;
}

type StemName = keyof MusicProfile;
type WaveShape = "sine" | "metal";

const BPM = 174;
const BEAT_SECONDS = 60 / BPM;
const LOOP_BEATS = 8;
const STEM_NAMES: StemName[] = ["trance", "jungle", "deep_dnb", "techstep"];
const STEM_GAIN: Record<StemName, number> = {
  trance: 0.075,
  jungle: 0.085,
  deep_dnb: 0.09,
  techstep: 0.075,
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
  private engineOscillator: OscillatorNode | null = null;
  private harmonicOscillator: OscillatorNode | null = null;
  private harmonicGain: GainNode | null = null;
  private windGain: GainNode | null = null;
  private musicFilter: BiquadFilterNode | null = null;
  private readonly stemGains = new Map<StemName, GainNode>();
  private readonly persistentSources: AudioScheduledSourceNode[] = [];
  private musicProfileKey = "";
  private muted = false;
  private paused = false;

  async start(): Promise<void> {
    if (this.context) {
      await this.context.resume();
      return;
    }

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
    this.engineOscillator = engineOscillator;
    this.harmonicOscillator = harmonicOscillator;
    this.harmonicGain = harmonicGain;
    this.windGain = windGain;
    this.installMusic(context, master);
  }

  update(speedRatio: number, throttle: number, boost: boolean): void {
    if (!this.context || !this.engineOscillator || !this.harmonicOscillator) return;
    const now = this.context.currentTime;
    const baseFrequency = 52 + speedRatio * 118 + throttle * 24 + (boost ? 18 : 0);
    this.engineOscillator.frequency.setTargetAtTime(baseFrequency, now, 0.045);
    this.harmonicOscillator.frequency.setTargetAtTime(baseFrequency * 2.03, now, 0.04);
    this.engineGain?.gain.setTargetAtTime(0.025 + throttle * 0.035 + speedRatio * 0.025, now, 0.08);
    this.harmonicGain?.gain.setTargetAtTime(0.008 + speedRatio * 0.021 + (boost ? 0.02 : 0), now, 0.06);
    this.windGain?.gain.setTargetAtTime(Math.pow(speedRatio, 2) * 0.055, now, 0.12);
    this.musicFilter?.frequency.setTargetAtTime(
      boost ? 6200 : 2100 + speedRatio * 1600,
      now,
      0.12,
    );
  }

  setMusicProfile(profile: MusicProfile): void {
    if (!this.context) return;
    const key = STEM_NAMES.map((name) => profile[name]).join(":");
    if (key === this.musicProfileKey) return;
    this.musicProfileKey = key;
    const now = this.context.currentTime;
    for (const name of STEM_NAMES) {
      const level = Math.max(0, Math.min(3, profile[name]));
      this.stemGains.get(name)?.gain.setTargetAtTime(
        (level / 3) * STEM_GAIN[name],
        now,
        BEAT_SECONDS * 0.8,
      );
    }
  }

  playGate(index: number): void {
    this.playTone(410 + index * 32, 0.11, 0.045, "square");
  }

  playCountdown(go: boolean): void {
    this.playTone(go ? 520 : 260, go ? 0.16 : 0.09, go ? 0.045 : 0.028, "square");
  }

  playBoost(): void {
    this.playTone(115, 0.2, 0.04, "sawtooth", 0, 2.2);
    this.playTone(460, 0.14, 0.024, "square", 0.04, 1.5);
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
    this.stemGains.clear();
    void this.context?.close();
    this.context = null;
    this.master = null;
  }

  private installMusic(context: AudioContext, master: GainNode): void {
    const musicFilter = context.createBiquadFilter();
    musicFilter.type = "lowpass";
    musicFilter.frequency.value = 2100;
    musicFilter.Q.value = 0.78;
    musicFilter.connect(master);
    this.musicFilter = musicFilter;

    const startAt = context.currentTime + 0.08;
    for (const name of STEM_NAMES) {
      const gain = context.createGain();
      gain.gain.value = 0;
      gain.connect(musicFilter);
      const source = context.createBufferSource();
      source.buffer = this.createStemBuffer(context, name);
      source.loop = true;
      source.connect(gain);
      source.start(startAt);
      this.persistentSources.push(source);
      this.stemGains.set(name, gain);
    }
  }

  private createStemBuffer(context: AudioContext, stem: StemName): AudioBuffer {
    const duration = BEAT_SECONDS * LOOP_BEATS;
    const length = Math.ceil(duration * context.sampleRate);
    const buffer = context.createBuffer(1, length, context.sampleRate);
    const channel = buffer.getChannelData(0);
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
      const start = Math.floor(beat * BEAT_SECONDS * context.sampleRate);
      const sampleDuration = beatDuration * BEAT_SECONDS;
      const count = Math.min(length - start, Math.floor(sampleDuration * context.sampleRate));
      for (let index = 0; index < count; index += 1) {
        const time = index / context.sampleRate;
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
      const start = Math.floor(beat * BEAT_SECONDS * context.sampleRate);
      const sampleDuration = beatDuration * BEAT_SECONDS;
      const count = Math.min(length - start, Math.floor(sampleDuration * context.sampleRate));
      let previous = 0;
      for (let index = 0; index < count; index += 1) {
        const progress = index / Math.max(1, count);
        const noise = random() * 2 - 1;
        const brightNoise = noise - previous * 0.72;
        previous = noise;
        channel[start + index] += brightNoise * Math.exp(-progress * 8) * amplitude;
      }
    };

    if (stem === "trance") {
      for (let beat = 0; beat < LOOP_BEATS; beat += 1) {
        addTone(beat, 0.55, 58, 0.62);
        addTone(beat + 0.5, 0.22, beat % 2 === 0 ? 220 : 247, 0.18, "metal");
      }
    } else if (stem === "jungle") {
      for (const beat of [0, 1.5, 2, 2.75, 4, 5.5, 6, 7.25]) {
        addTone(beat, 0.34, 72, 0.55);
      }
      for (const beat of [1, 3, 5, 7]) addNoise(beat, 0.42, 0.46);
      for (let beat = 0.25; beat < LOOP_BEATS; beat += 0.5) addNoise(beat, 0.1, 0.14);
    } else if (stem === "deep_dnb") {
      for (const beat of [0, 1.75, 4, 5.5]) addTone(beat, 1.4, 49, 0.72);
      for (const beat of [2, 6]) addNoise(beat, 0.65, 0.38);
      for (const beat of [0, 4]) addTone(beat, 0.38, 64, 0.46);
    } else {
      for (const beat of [0, 0.75, 1.5, 2.75, 4, 4.5, 5.75, 7]) {
        addTone(beat, 0.24, beat % 1 === 0 ? 610 : 830, 0.34, "metal");
      }
      for (const beat of [1, 3, 5, 7]) addNoise(beat, 0.24, 0.3);
    }

    let peak = 0;
    for (const sample of channel) peak = Math.max(peak, Math.abs(sample));
    const scale = peak > 0 ? 0.82 / peak : 1;
    for (let index = 0; index < channel.length; index += 1) channel[index] *= scale;
    return buffer;
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
