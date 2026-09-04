import {
  normalizeManifest,
  resolveMusicMode,
  resolveTestOrder,
  shuffleOrder,
  trackPath,
  trackStartOffset,
  SOUNDTRACK_MANIFEST_PATH,
} from "./soundtrack-plan.js";

/**
 * M1 — the local soundtrack.
 *
 * The four synthesised stems are a score, and after twenty phases the verdict
 * on them was "there is no music". They stay: they are the fallback, they are
 * what a fresh clone sounds like, and they are the only music that ships. What
 * this module adds is the ability to put REAL mixes underneath the game —
 * vintage jungle and old-school drum and bass sets, 60 to 120 minutes each —
 * from files the player puts in `public/assets/audio/music/` themselves.
 *
 * NOTHING IT PLAYS IS EVER COMMITTED. The repository is public; the directory
 * is gitignored down to the file, `scripts/validate-soundtrack.mjs` fails the
 * build if `git ls-files` ever disagrees, and there is no code path that
 * fetches audio from anywhere but this origin.
 *
 * WHY AN `<audio>` ELEMENT AND NOT `decodeAudioData`. The pit radio decodes,
 * because seventeen clips are 29 seconds of speech. A 90-minute mix decoded to
 * 32-bit stereo PCM at 48 kHz is 2.07 GB of heap, and even one is a tab crash.
 * An `HTMLAudioElement` streams it: the browser holds a buffer measured in
 * seconds, seeks without re-downloading and costs the graph one node. That is
 * the whole reason `media-src` moves from `'none'` to `'self'` — a `fetch()` is
 * governed by `connect-src`, a media element is not. `'self'` and no wider:
 * the element can only ever be pointed at this origin.
 *
 * WHERE IT SITS IN THE MIX, and this is the one placement that is not obvious.
 * The stem chain runs through a 2 100 Hz low-pass that opens with speed — it is
 * a speed cue, authored against synthesised material with nothing above 2 kHz
 * worth keeping. Putting a real recording through it would sound like a blanket
 * over the speaker. So the track joins AFTER the filter and the shelf, directly
 * into `musicBus`, which is the node the MUSIC LEVEL slider and the pit radio's
 * duck both already move. The listener's slider, the radio duck, mute and pause
 * therefore all compose with the track for free, and none of them needed a
 * second code path.
 */

export type SoundtrackSource = "track" | "stems" | "off";
export type SoundtrackState = "idle" | "playing" | "paused" | "ended";

/**
 * The track bus level, and it is a measurement rather than a taste number.
 *
 * The import script normalises every file to -14 LUFS integrated, so the
 * material arriving here is a known quantity — which is what makes a single
 * constant defensible at all. The target is the music sitting 0 to +3 dB over
 * the non-music mix (engine, wind, ambience beds) at cruise: level enough to be
 * the thing you are driving to, quiet enough that the engine still tells you
 * what the craft is doing. Measured on the Greenwater demo lap at MUSIC LEVEL
 * 100 through the `busMeters` readouts below. 0.34 measured a median of +1.7 dB
 * against a synthetic -14 LUFS click-and-sine, but -0.1 dB (five stations,
 * -9.0 to +0.5) against a real 1994-98 jungle mix at the same loudness, whose
 * energy is spread wider in time; 0.4 (+1.4 dB) puts the real material inside
 * the window, and the MUSIC LEVEL slider only goes down from here.
 */
export const TRACK_GAIN = 0.4;

interface SoundtrackTrack {
  file: string;
  title: string;
  durationSeconds: number;
}

export interface SoundtrackDiagnostics {
  source: SoundtrackSource;
  title: string;
  currentTime: number;
  state: SoundtrackState;
  trackGain: number;
}

/** How long a title stays on the HUD after a track starts, milliseconds. */
export const SOUNDTRACK_CHIP_MS = 4_000;

/**
 * The HUD latch, on the `ambience-cue.ts` / `track-events.ts` idiom.
 *
 * The chip has to be painted by `ui.ts`, which knows nothing about audio, and
 * raised by a media event, which knows nothing about the HUD. One module-level
 * record read once a frame is the same seam the track-event chip already uses,
 * and it costs the race loop zero lines.
 */
const chip = { title: "", until: 0 };

export function soundtrackChip(): { title: string; until: number } {
  return chip;
}

export class SoundtrackPlayer {
  private readonly mode: "auto" | "synth" | "off";
  /** `?musictest=`, latched at construction and only ever set under diagnostics. */
  private readonly testOrder: string | null;
  private readonly gain: GainNode;
  private readonly tracks: SoundtrackTrack[] = [];
  private element: HTMLAudioElement | null = null;
  private source: MediaElementAudioSourceNode | null = null;
  private order: number[] = [];
  private cursor = 0;
  private playing = -1;
  private manifestResolved = false;
  private started = false;
  private paused = false;
  private ended = false;
  private pendingOffset = 0;
  private disposed = false;

  /**
   * @param context The graph's own context; the soundtrack never makes a second.
   * @param destination `musicBus` — AFTER the stem low-pass and shelf, so the
   *   speed filter colours the stems and leaves a real recording alone.
   * @param search The page's query string, read once.
   */
  constructor(
    private readonly context: AudioContext,
    destination: AudioNode,
    search: string,
  ) {
    const parameters = new URLSearchParams(search);
    this.mode = resolveMusicMode(parameters.get("music"));
    this.testOrder = parameters.has("diagnostics")
      ? parameters.get("musictest")
      : null;
    const gain = context.createGain();
    gain.gain.value = TRACK_GAIN;
    gain.connect(destination);
    this.gain = gain;
  }

  /**
   * Reads the manifest and, if there is one, starts playing.
   *
   * SILENT ON EVERY FAILURE, and that is a requirement rather than laziness.
   * The overwhelmingly common case is a fresh clone with no manifest at all:
   * the fetch 404s, the stems play, and the console must stay clean — a
   * `console.warn` on a path every single new player takes is noise that trains
   * people to ignore the console. The browser's own network line for the 404 is
   * the honest record of it, and `soundtrack.source` in the diagnostics says
   * which score is actually running.
   *
   * Awaited by `EngineAudio.start()`. The payload is a few hundred bytes from
   * this origin and it has to resolve before the first `play()` anyway: the
   * element needs the gesture that opened the AudioContext, and a `play()`
   * deferred past it is a `play()` the autoplay policy can refuse.
   */
  async start(): Promise<void> {
    if (this.started || this.disposed) return;
    this.started = true;
    if (this.mode !== "auto") {
      this.manifestResolved = true;
      return;
    }
    try {
      const response = await fetch(SOUNDTRACK_MANIFEST_PATH, { cache: "no-store" });
      if (response.ok) {
        for (const track of normalizeManifest(await response.json())) {
          this.tracks.push(track);
        }
      }
    } catch {
      // No manifest, a malformed one, or an offline page. All three mean the
      // same thing to the player: the synthesised score is the score.
    }
    this.manifestResolved = true;
    if (this.disposed || this.tracks.length === 0) return;
    this.order = resolveTestOrder(this.testOrder, this.tracks)
      ?? shuffleOrder(this.tracks.length, -1, Math.random);
    this.cursor = 0;
    this.advance();
  }

  /**
   * Whether the four stems must be held at zero this tick.
   *
   * True while a track is the score, true under `?music=0`, and true while the
   * manifest fetch is still in flight — that last one is what stops a player
   * with tracks from hearing one bar of stems before the mix arrives. It goes
   * false the moment the fetch resolves with nothing.
   */
  holdsStems(): boolean {
    if (this.mode === "off") return true;
    if (this.mode === "synth") return false;
    return !this.manifestResolved || this.tracks.length > 0;
  }

  /**
   * `Esc` / `P`. The element pauses and resumes; the AudioContext suspension
   * that `EngineAudio` already does would freeze the graph but leave the media
   * element running against a stalled clock.
   */
  setPaused(paused: boolean): void {
    this.paused = paused;
    const element = this.element;
    if (!element || this.playing < 0) return;
    if (paused) element.pause();
    else void element.play().catch(() => undefined);
  }

  diagnostics(): SoundtrackDiagnostics {
    const element = this.element;
    return {
      source: this.mode === "off"
        ? "off"
        : this.tracks.length > 0 && this.playing >= 0
          ? "track"
          : "stems",
      title: this.playing >= 0 ? this.tracks[this.playing]?.title ?? "" : "",
      currentTime: element ? Number(element.currentTime.toFixed(2)) : 0,
      state: this.resolveState(),
      trackGain: TRACK_GAIN,
    };
  }

  dispose(): void {
    this.disposed = true;
    const element = this.element;
    if (element) {
      element.pause();
      element.removeAttribute("src");
      element.load();
    }
    this.source?.disconnect();
    this.gain.disconnect();
    this.source = null;
    this.element = null;
    this.tracks.length = 0;
    this.order.length = 0;
    this.playing = -1;
    chip.title = "";
    chip.until = 0;
  }

  private resolveState(): SoundtrackState {
    if (this.playing < 0) return "idle";
    const element = this.element;
    if (!element) return "idle";
    if (this.ended) return "ended";
    if (element.paused) return "paused";
    return "playing";
  }

  /**
   * The one element, built once and reused for every track in the session.
   *
   * `createMediaElementSource` may only be called once per element, so the
   * element and its node are a pair that outlive any individual track: a new
   * mix is a new `src`, never a new node. `preload="auto"` because the next
   * track is wanted within a second of the last one ending, and `crossOrigin`
   * is deliberately never set — the source is same-origin and an explicit
   * `anonymous` would turn a local file into a CORS negotiation.
   */
  private ensureElement(): HTMLAudioElement {
    const existing = this.element;
    if (existing) return existing;
    const element = new Audio();
    element.preload = "auto";
    element.loop = false;
    element.addEventListener("ended", this.handleEnded);
    // A file the manifest names but the directory does not hold must not stop
    // the session. Treated exactly like a track that finished.
    element.addEventListener("error", this.handleEnded);
    element.addEventListener("loadedmetadata", this.handleMetadata);
    this.element = element;
    this.source = this.context.createMediaElementSource(element);
    this.source.connect(this.gain);
    return element;
  }

  private readonly handleEnded = (): void => {
    if (this.disposed) return;
    this.ended = true;
    this.advance();
  };

  /**
   * The random start offset, applied the moment the duration is known.
   *
   * Seeking has to wait for metadata — `currentTime` on an element that has not
   * loaded any is discarded — but `play()` must NOT wait for it, or the call
   * lands outside the gesture that opened the AudioContext and the autoplay
   * policy refuses it. So the two are split: play immediately, seek about a
   * hundred milliseconds later. The manifest's own `durationSeconds` is
   * preferred where it exists, because it is what the import script measured
   * with ffprobe; the element's is the fallback.
   */
  private readonly handleMetadata = (): void => {
    const element = this.element;
    if (!element || this.pendingOffset <= 0) return;
    const offset = this.pendingOffset;
    this.pendingOffset = 0;
    if (Number.isFinite(element.duration) && offset < element.duration) {
      try {
        element.currentTime = offset;
      } catch {
        // A stream that refuses the seek simply starts from the top.
      }
    }
  };

  /** Starts the next track in the order, re-shuffling when the order runs out. */
  private advance(): void {
    if (this.disposed || this.tracks.length === 0) return;
    if (this.cursor >= this.order.length) {
      this.order = shuffleOrder(this.tracks.length, this.playing, Math.random);
      this.cursor = 0;
    }
    const index = this.order[this.cursor];
    this.cursor += 1;
    const track = this.tracks[index];
    if (!track) return;
    this.playing = index;
    this.ended = false;
    const element = this.ensureElement();
    const duration = track.durationSeconds > 0 ? track.durationSeconds : 0;
    this.pendingOffset = trackStartOffset(duration, Math.random);
    element.src = trackPath(track.file);
    chip.title = track.title;
    chip.until = performance.now() + SOUNDTRACK_CHIP_MS;
    if (this.paused) return;
    void element.play().catch(() => undefined);
  }
}
