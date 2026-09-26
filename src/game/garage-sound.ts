/**
 * The showroom's engine: the sound of the bay's hold-BOOST / hold-BRAKE demo.
 *
 * The race's `EngineAudio` only starts behind START, and it brings the music,
 * the ambient beds, the pit radio and the rival voices with it. The bay needs
 * only the player's own engine, so it builds that voice here, lazily and inside
 * the gesture that began a hold, on the race's own curves: the same pitch,
 * filter and wind formulas as `EngineAudio.update`, the same gain pair as
 * `playerEngineGains` and the same boost cue as `playBoost` (the validator pins
 * each against the race's own). It plays at the listener's master volume, is
 * silent while the game is muted, and fades out and sleeps when the demo comes
 * to rest. It imports nothing from the running page: the volume is handed in.
 */

/** `EngineAudio`'s MASTER_GAIN_CEILING: the level the whole mix was balanced at. */
const CEILING = 0.34;

export class ShowroomSound {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private filter: BiquadFilterNode | null = null;
  private engine: OscillatorNode | null = null;
  private harmonic: OscillatorNode | null = null;
  private engineGain: GainNode | null = null;
  private harmonicGain: GainNode | null = null;
  private windGain: GainNode | null = null;
  private roarGain: GainNode | null = null;
  private firing = false;
  private braking = false;
  private recharging = false;
  private sleep = 0;

  /** `volume` reads the listener's master volume (0..1) when a frame plays. */
  constructor(private readonly volume: () => number) {}

  /** Builds (once) or wakes the voice. Call inside the gesture that began a hold. */
  wake(): void {
    clearTimeout(this.sleep);
    if (!this.context) {
      const context = new AudioContext();
      const master = context.createGain();
      master.gain.value = 0;
      master.connect(context.destination);
      const filter = context.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 820;
      filter.Q.value = 1.2;
      filter.connect(master);
      const voice = (type: OscillatorType, frequency: number): [OscillatorNode, GainNode] => {
        const gain = context.createGain();
        gain.gain.value = 0;
        gain.connect(filter);
        const oscillator = context.createOscillator();
        oscillator.type = type;
        oscillator.frequency.value = frequency;
        oscillator.connect(gain);
        oscillator.start();
        return [oscillator, gain];
      };
      [this.engine, this.engineGain] = voice("sawtooth", 52);
      [this.harmonic, this.harmonicGain] = voice("triangle", 105.6);
      // The air over the hull (and the airbrakes in it): the race's wind bed.
      const noise = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
      const channel = noise.getChannelData(0);
      for (let index = 0; index < channel.length; index += 1) channel[index] = Math.random() * 2 - 1;
      const wind = context.createBufferSource();
      wind.buffer = noise;
      wind.loop = true;
      this.windGain = context.createGain();
      this.windGain.gain.value = 0;
      wind.connect(this.windGain);
      this.windGain.connect(filter);
      // The boost's sustained roar under the onset cue: the same noise through a
      // low band (250 Hz band-pass, 1.4 kHz low-pass) straight to the master.
      const band = context.createBiquadFilter();
      band.type = "bandpass";
      band.frequency.value = 250;
      band.Q.value = 0.7;
      const smooth = context.createBiquadFilter();
      smooth.type = "lowpass";
      smooth.frequency.value = 1_400;
      this.roarGain = context.createGain();
      this.roarGain.gain.value = 0;
      wind.connect(band);
      band.connect(smooth);
      smooth.connect(this.roarGain);
      this.roarGain.connect(master);
      wind.start();
      Object.assign(this, { context, master, filter });
    }
    void this.context?.resume().catch(() => undefined);
  }

  /** One frame of the demo, on `EngineAudio.update`'s curves, with its edge cues. */
  set(throttle: number, speedRatio: number, brake: number, firing: boolean, recharging: boolean): void {
    const context = this.context;
    if (!context || !this.master) return;
    const now = context.currentTime;
    const muted = document.body.dataset.muted === "true";
    this.master.gain.setTargetAtTime(muted ? 0 : CEILING * this.volume(), now, 0.05);
    const base = 52 + speedRatio * 118 + throttle * 24 + (firing ? 18 : 0);
    this.engine?.frequency.setTargetAtTime(base, now, 0.045);
    this.harmonic?.frequency.setTargetAtTime(base * 2.03, now, 0.04);
    // playerEngineGains, as the race's player engine plays it.
    this.engineGain?.gain.setTargetAtTime(0.025 + throttle * 0.035 + speedRatio * 0.025, now, 0.08);
    this.harmonicGain?.gain.setTargetAtTime(0.008 + speedRatio * 0.021 + (firing ? 0.02 : 0), now, 0.06);
    this.windGain?.gain.setTargetAtTime(Math.pow(speedRatio, 2) * (0.045 + brake * 0.035), now, 0.1);
    // Roar: 60 ms attack, 180 ms release (a third of each as the time constant).
    this.roarGain?.gain.setTargetAtTime(firing ? 0.025 : 0, now, firing ? 0.02 : 0.06);
    this.filter?.frequency.setTargetAtTime(820 + speedRatio * 1_850 + brake * 420 + (firing ? 1_400 : 0), now, 0.08);
    // The race's boost cue as the jets light; the airbrakes' thunk as they
    // swing up; `playPowerDenied`'s pair when the reserve runs dry.
    if (firing && !this.firing) {
      this.tone(115, 0.2, 0.04, "sawtooth", 0, 2.2);
      this.tone(460, 0.14, 0.024, "square", 0.04, 1.5);
    }
    // The airbrakes' swing: a mid click (laptop speakers have no 92 Hz) over the thunk's body.
    if (brake > 0 && !this.braking) {
      this.tone(1_200, 0.008, 0.02, "square", 0, 1);
      this.tone(92, 0.16, 0.05, "sine", 0, 0.6);
    }
    if (recharging && !this.recharging) {
      this.tone(220, 0.09, 0.016, "triangle", 0, 0.82);
      this.tone(180, 0.1, 0.012, "triangle", 0.105, 1);
    }
    this.firing = firing;
    this.braking = brake > 0;
    this.recharging = recharging;
  }

  /** Fades the engine out and lets the context sleep until the next hold. */
  rest(): void {
    const context = this.context;
    if (!context || !this.master) return;
    this.master.gain.setTargetAtTime(0, context.currentTime, 0.06);
    this.roarGain?.gain.setTargetAtTime(0, context.currentTime, 0.06);
    this.firing = this.braking = this.recharging = false;
    clearTimeout(this.sleep);
    this.sleep = window.setTimeout(() => void context.suspend().catch(() => undefined), 400);
  }

  dispose(): void {
    clearTimeout(this.sleep);
    void this.context?.close().catch(() => undefined);
    this.context = this.master = null;
  }

  /** `EngineAudio.playTone`: one enveloped oscillator, swept to `ratio` (a click attacks in a third of itself). */
  private tone(frequency: number, duration: number, amplitude: number, type: OscillatorType, delay: number, ratio: number): void {
    const context = this.context;
    if (!context || !this.master) return;
    const at = context.currentTime + delay;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, at);
    oscillator.frequency.exponentialRampToValueAtTime(frequency * ratio, at + duration);
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(amplitude, at + Math.min(0.012, duration / 3));
    gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    oscillator.connect(gain);
    gain.connect(this.master);
    oscillator.start(at);
    oscillator.stop(at + duration + 0.02);
  }
}
