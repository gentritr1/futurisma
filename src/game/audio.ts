export class EngineAudio {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private engineGain: GainNode | null = null;
  private engineOscillator: OscillatorNode | null = null;
  private harmonicOscillator: OscillatorNode | null = null;
  private harmonicGain: GainNode | null = null;
  private windGain: GainNode | null = null;
  private muted = false;

  async start(): Promise<void> {
    if (this.context) {
      await this.context.resume();
      return;
    }

    const context = new AudioContext();
    const master = context.createGain();
    master.gain.value = 0.34;
    master.connect(context.destination);

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

    const harmonicGain = context.createGain();
    harmonicGain.gain.value = 0.012;
    harmonicGain.connect(filter);
    const harmonicOscillator = context.createOscillator();
    harmonicOscillator.type = "triangle";
    harmonicOscillator.frequency.value = 108;
    harmonicOscillator.connect(harmonicGain);
    harmonicOscillator.start();

    const windGain = context.createGain();
    windGain.gain.value = 0;
    windGain.connect(filter);
    const noise = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
    const channel = noise.getChannelData(0);
    for (let index = 0; index < channel.length; index += 1) {
      channel[index] = Math.random() * 2 - 1;
    }
    const wind = context.createBufferSource();
    wind.buffer = noise;
    wind.loop = true;
    wind.connect(windGain);
    wind.start();

    this.context = context;
    this.master = master;
    this.engineGain = engineGain;
    this.engineOscillator = engineOscillator;
    this.harmonicOscillator = harmonicOscillator;
    this.harmonicGain = harmonicGain;
    this.windGain = windGain;
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
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    if (this.context && this.master) {
      this.master.gain.setTargetAtTime(this.muted ? 0 : 0.34, this.context.currentTime, 0.04);
    }
    return this.muted;
  }
}
