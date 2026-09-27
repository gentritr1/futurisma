/** The shipped original score, streamed only inside the open bay. It resumes
 * its place between visits and respects both saved volume sliders and mute. */
export class GarageMusic {
  private audio: HTMLAudioElement | null = null;
  private open = false;
  private focused = true;
  private playing = false;
  private trying = false;
  private disposed = false;
  private readonly enabled = new URLSearchParams(window.location.search).get("music") !== "0";

  constructor(private readonly levels: () => {masterVolume: number; musicVolume: number}) {}

  show(): void { this.open = true; this.focused = true; this.sync(0, false); this.play(); }
  hide(): void { this.open = false; this.pause(); }
  interrupt(): void { this.focused = false; this.pause(); }
  resume(): void { this.focused = true; this.play(); }

  private allowed(): boolean {
    const volume = this.levels();
    return this.enabled && this.open && this.focused && !document.hidden && document.body.dataset.muted !== "true" && volume.masterVolume > 0 && volume.musicVolume > 0;
  }

  private play(): void {
    if (!this.allowed() || this.playing || this.trying || this.disposed) return;
    if (!this.audio) {
      this.audio = new Audio("/assets/audio/original/meridian-afterimage.mp3");
      this.audio.loop = true; this.audio.preload = "none"; this.audio.volume = 0;
      this.audio.dataset.garageMusic = "true";
    }
    this.trying = true;
    void this.audio.play().then(() => {
      this.playing = true;
      if (!this.allowed() || this.disposed) this.pause();
    }, () => undefined).finally(() => { this.trying = false; });
  }

  sync(delta: number, testing: boolean): void {
    if (!this.allowed()) { this.pause(); return; }
    // Autoplay refusal waits for the next real gesture; never retry every frame.
    if (!this.audio) return;
    const volume = this.levels();
    const target = .12 * volume.masterVolume * volume.musicVolume * (testing ? .22 : 1);
    this.audio.volume = Math.max(0, Math.min(1, this.audio.volume + (target - this.audio.volume) * (1 - Math.exp(-Math.max(0,delta) * (testing ? 18 : 5)))));
  }

  private pause(): void { this.audio?.pause(); this.playing = false; }
  dispose(): void {
    this.disposed = true; this.hide();
    if (this.audio) { this.audio.removeAttribute("src"); this.audio.load(); this.audio = null; }
  }
}
