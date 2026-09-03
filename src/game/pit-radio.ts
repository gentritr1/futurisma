import {
  admitLine,
  expireQueue,
  gateClearReady,
  nextLine,
  pitRadioPath,
  PIT_RADIO_IDS,
  PIT_RADIO_LINES,
  radioEdgeState,
  resolveEventLine,
  resolveFrameLines,
} from "./pit-radio-lines.js";
import { trackEventState } from "./track-events";

/**
 * H2b — the pit radio: the first recorded audio this project has ever shipped.
 *
 * Seventeen lines in one voice, played through their own bus beside the
 * procedural graph rather than inside it. Everything about WHEN a line plays
 * lives in `pit-radio-lines.js` so a Node validator can attack it; this file is
 * the part that needs an AudioContext — the fetch, the decode, the band-pass
 * colour, the duck and the envelope.
 *
 * WHAT THE RADIO IS ALLOWED TO BE. PRODUCT.md is explicit that the game stays
 * playable without audio and that critical state is never communicated by sound
 * alone. Nothing here is new information: every line names something the HUD is
 * already showing or the world is already doing, and five of the seventeen are
 * resolved off the exact `HudFrame` object the HUD renders on the same frame,
 * which makes that a structural property rather than a review note. Turning the
 * voice off with `?voice=0` or the VOICE row costs the driver nothing.
 *
 * WHY IT DOES NOT INTERRUPT ITSELF. A queued line can be pushed down the order
 * by a more urgent one, but a line that has STARTED always finishes. A radio
 * that cuts a word in half reads as a bug rather than as pressure, and the
 * queue is short enough (three) and short-lived enough (three seconds) that
 * waiting for a 1.2 s line to end never leaves a stale warning behind it.
 *
 * NO CSP MOVE. The clips are fetched as ArrayBuffers and decoded through the
 * existing AudioContext, never attached to an `<audio>` element, so
 * `media-src 'none'` in `index.html` stays exactly as it is — a `fetch()` is
 * governed by `connect-src`, which already resolves to `'self'`.
 */

/** The band-pass that makes a voice read as a speaker rather than a narrator. */
const RADIO_HIGHPASS_HZ = 300;
const RADIO_LOWPASS_HZ = 3_400;
/** One biquad each: a BiquadFilterNode high/low-pass is 2-pole, 12 dB/octave. */
const RADIO_FILTER_Q = 0.707;

/**
 * The click at each end of a line, seconds.
 *
 * A hard gate on a band-limited chain is what a keyed transmitter sounds like;
 * 30 ms is long enough not to be a pop on the master compressor and short
 * enough that the first consonant is not swallowed.
 */
const RADIO_CLICK_SECONDS = 0.03;

/**
 * The bus level, against the authored mix.
 *
 * The master ceiling is 0.34 and the loudest procedural voice in the game is a
 * music stem at ~0.07 peak, so a line normalised to -1 dBFS at unity would sit
 * about 22 dB over the score. Half of that is still unmistakably the loudest
 * thing in the mix — which is correct for a radio call — without pinning the
 * compressor for the length of a sentence. It is a taste number and it is the
 * first thing the listening checklist asks about.
 */
const RADIO_BUS_GAIN = 0.5;

/** The music duck while a line plays, dB. */
export const RADIO_MUSIC_DUCK_DB = -3;
/** The ambience duck while a line plays, dB. */
export const RADIO_AMBIENCE_DUCK_DB = -2;
/** How fast each duck moves. Fast enough to clear the first word. */
export const RADIO_DUCK_SECONDS = 0.08;

/** Below this a decoded sample is silence, for the lead-in measurement. */
const RADIO_SILENCE_FLOOR = 0.0032; // -50 dBFS

function amplitudeFromDb(decibels: number): number {
  return Math.pow(10, decibels / 20);
}

/**
 * The HUD's own frame, narrowed to the eight fields the radio reads.
 *
 * Structurally a subset of `HudFrame`, declared here rather than imported so
 * that `ui.ts` publishing into this latch is a one-way dependency: the radio
 * knows what the HUD shows, the HUD knows nothing about the radio.
 */
export interface RadioFrame {
  raceActive: boolean;
  wrongWay: boolean;
  recoveryActive: boolean;
  cleanGateChain: number;
  position: number;
  racerCount: number;
  lap: number;
  lastLapMs: number;
}

const frame: RadioFrame = {
  raceActive: false,
  wrongWay: false,
  recoveryActive: false,
  cleanGateChain: 0,
  position: 0,
  racerCount: 0,
  lap: 0,
  lastLapMs: 0,
};

/**
 * The one seam the HUD touches, and the reason it costs `game.ts` nothing.
 *
 * `ui.update(frame)` already receives every field below, on the frame the HUD
 * paints them. Latching them here is one line inside `ui.ts` and zero lines in
 * the race loop, which sits exactly on its seam budget — the same argument
 * `publishAmbienceCue` makes in `ambience-cue.ts`, one phase later.
 *
 * No allocation and no subscription: the fields are copied into one reused
 * record and the audio control tick reads it 30 times a second.
 */
export function publishRadioFrame(source: {
  raceActive: boolean;
  wrongWay: boolean;
  recoveryActive: boolean;
  cleanGateChain: number;
  position: number;
  racerCount: number;
  lap: number;
  lastLapMs: number | null;
}): void {
  frame.raceActive = source.raceActive;
  frame.wrongWay = source.wrongWay;
  frame.recoveryActive = source.recoveryActive;
  frame.cleanGateChain = source.cleanGateChain;
  frame.position = source.position;
  frame.racerCount = source.racerCount;
  frame.lap = source.lap;
  frame.lastLapMs = source.lastLapMs ?? 0;
}

/** What one loaded line costs to play: the buffer and where the words start. */
interface RadioClip {
  buffer: AudioBuffer;
  /** Seconds of decoder padding and room tone before the first word. */
  offsetSeconds: number;
}

export interface PitRadioDiagnostics {
  linesPlayed: number;
  linesDropped: number;
  lastLine: string;
  queueDepth: number;
  loaded: number;
}

export class PitRadio {
  private readonly bus: GainNode;
  private readonly clickGain: GainNode;
  private readonly clips = new Map<string, RadioClip>();
  private readonly queue: { id: string; priority: number; queuedAt: number }[] = [];
  private readonly edges = radioEdgeState();
  private readonly frameLines: string[] = [];
  private loadStarted = false;
  private raceActive = false;
  private enabled = false;
  private busUntil = 0;
  private duckUntil = 0;
  private ducked = false;
  private gateClearAt = Number.NEGATIVE_INFINITY;
  private lastEventSerial = 0;
  private linesPlayed = 0;
  private linesDropped = 0;
  private lastLine = "";

  /**
   * @param context The graph's own context; the radio never makes a second one.
   * @param destination The master bus, so mute, pause and master level all
   *   already apply to the voice without a second code path.
   * @param duck Applies the two ducks. Owned by `audio.ts` because the music
   *   bus level is the listener's setting multiplied by this, and only the
   *   music bus's owner knows the other half.
   */
  constructor(
    private readonly context: AudioContext,
    destination: AudioNode,
    private readonly duck: (musicScale: number, ambienceScale: number) => void,
  ) {
    const bus = context.createGain();
    bus.gain.value = RADIO_BUS_GAIN;
    const lowpass = context.createBiquadFilter();
    lowpass.type = "lowpass";
    lowpass.frequency.value = RADIO_LOWPASS_HZ;
    lowpass.Q.value = RADIO_FILTER_Q;
    const highpass = context.createBiquadFilter();
    highpass.type = "highpass";
    highpass.frequency.value = RADIO_HIGHPASS_HZ;
    highpass.Q.value = RADIO_FILTER_Q;
    const clickGain = context.createGain();
    clickGain.gain.value = 0;
    clickGain.connect(highpass);
    highpass.connect(lowpass);
    lowpass.connect(bus);
    bus.connect(destination);
    this.bus = bus;
    this.clickGain = clickGain;
  }

  /**
   * The stored VOICE row, re-applied on every control tick.
   *
   * Switching it on is what starts the fetch, so a driver who never wants the
   * radio never downloads it — and one who turns it on mid-session gets it a
   * few hundred milliseconds later rather than on the next relink. Switching it
   * off drops the queue and releases the duck immediately; a line already
   * speaking is allowed to finish its sentence, for the same reason nothing
   * else interrupts one.
   */
  setEnabled(enabled: boolean): void {
    if (enabled === this.enabled) return;
    this.enabled = enabled;
    if (enabled) this.load();
    else this.queue.length = 0;
  }

  /**
   * Fetches and decodes the seventeen lines. Safe to call more than once.
   *
   * Deliberately NOT awaited by its caller. `EngineAudio.start()` runs behind
   * the start button and the countdown begins on the next frame; holding it for
   * ~330 KB of audio would put a network stall between the driver pressing
   * Enter and the lights, which is the one place in the game where a stall is
   * unforgivable. A line that has not arrived when its event fires is simply
   * dropped, and `loaded` in the diagnostics says how many are ready.
   */
  load(): void {
    if (this.loadStarted) return;
    this.loadStarted = true;
    for (const id of PIT_RADIO_IDS) {
      void fetch(pitRadioPath(id))
        .then((response) => (response.ok ? response.arrayBuffer() : null))
        .then((bytes) => (bytes ? this.context.decodeAudioData(bytes) : null))
        .then((buffer) => {
          if (buffer) this.clips.set(id, { buffer, offsetSeconds: leadIn(buffer) });
        })
        .catch(() => undefined);
    }
  }

  /** Offers one line to the queue. The gating rules decide whether it lands. */
  cue(id: string): void {
    if (!this.enabled || !(id in PIT_RADIO_LINES)) return;
    const now = this.context.currentTime;
    if (id === "gate_clear") {
      if (!gateClearReady(this.gateClearAt, now)) {
        this.linesDropped += 1;
        return;
      }
      this.gateClearAt = now;
    }
    this.linesDropped += admitLine(this.queue, id, now);
  }

  /**
   * One control tick. Reads the two published states, drains the queue and
   * releases the duck.
   *
   * Called from `EngineAudio.update`, so it runs on the same 30 Hz clock as the
   * beds, the panners and the music filter, and adds no timer of its own.
   */
  tick(now: number): void {
    if (!this.enabled) {
      // The edges still have to be walked with the voice off, or switching it
      // back on mid-lap would fire every edge that passed while it was quiet.
      resolveFrameLines(this.edges, frame, now, this.frameLines);
      this.lastEventSerial = trackEventState().armSerial;
      this.raceActive = frame.raceActive;
      if (this.ducked) {
        this.ducked = false;
        this.duck(1, 1);
      }
      return;
    }
    // THE QUEUE IS NEVER CLEARED BY A PHASE CHANGE, and that is a decision
    // rather than an omission. Two of the seventeen lines are cued from OUTSIDE
    // a running race — `lights_out` on the countdown's go, one frame before the
    // phase becomes `"running"`, and `classification_locked` on the frame it
    // becomes `"finished"` — so a queue flush on either edge throws away
    // precisely the line that edge exists to speak. Staleness is handled by
    // `expireQueue` instead, which is three seconds for everything and cannot
    // be got wrong by a phase transition landing on the wrong side of a frame.
    //
    // What DOES reset with the race is the cooldown and the edges, on the
    // inactive side where nothing is ever pending on them.
    if (this.raceActive && !frame.raceActive) {
      this.gateClearAt = Number.NEGATIVE_INFINITY;
      this.lastEventSerial = 0;
    }
    this.raceActive = frame.raceActive;
    resolveFrameLines(this.edges, frame, now, this.frameLines);
    for (const id of this.frameLines) this.cue(id);
    const events = trackEventState();
    if (events.armSerial !== this.lastEventSerial) {
      const line = resolveEventLine(events, this.lastEventSerial);
      this.lastEventSerial = events.armSerial;
      if (line) this.cue(line);
    }
    this.linesDropped += expireQueue(this.queue, now);
    if (this.ducked && now >= this.duckUntil) {
      this.ducked = false;
      this.duck(1, 1);
    }
    const id = nextLine(this.queue, now, this.busUntil);
    if (id) this.speak(id, now);
  }

  resetDiagnostics(): void {
    this.linesPlayed = 0;
    this.linesDropped = 0;
    this.lastLine = "";
  }

  diagnostics(): PitRadioDiagnostics {
    return {
      linesPlayed: this.linesPlayed,
      linesDropped: this.linesDropped,
      lastLine: this.lastLine,
      queueDepth: this.queue.length,
      loaded: this.clips.size,
    };
  }

  dispose(): void {
    this.queue.length = 0;
    this.clips.clear();
    this.clickGain.disconnect();
    this.bus.disconnect();
  }

  private speak(id: string, now: number): void {
    const clip = this.clips.get(id);
    if (!clip) {
      // The event happened; the file has not arrived. Counted, not silently
      // forgotten — a `linesDropped` that climbs with `loaded` below 17 is the
      // signature of a slow first race rather than a queue bug.
      this.linesDropped += 1;
      return;
    }
    const duration = clip.buffer.duration - clip.offsetSeconds;
    const start = now + 0.01;
    const end = start + duration;
    const source = this.context.createBufferSource();
    source.buffer = clip.buffer;
    source.connect(this.clickGain);

    const gain = this.clickGain.gain;
    gain.cancelScheduledValues(start);
    gain.setValueAtTime(0, start);
    gain.linearRampToValueAtTime(1, start + RADIO_CLICK_SECONDS);
    gain.setValueAtTime(1, Math.max(start + RADIO_CLICK_SECONDS, end - RADIO_CLICK_SECONDS));
    gain.linearRampToValueAtTime(0, end);

    source.start(start, clip.offsetSeconds);
    source.stop(end + 0.02);
    source.addEventListener("ended", () => source.disconnect(), { once: true });

    this.busUntil = end;
    this.duckUntil = end;
    if (!this.ducked) {
      this.ducked = true;
      this.duck(
        amplitudeFromDb(RADIO_MUSIC_DUCK_DB),
        amplitudeFromDb(RADIO_AMBIENCE_DUCK_DB),
      );
    }
    this.linesPlayed += 1;
    this.lastLine = id;
  }
}

/**
 * Where the words actually start in a decoded clip.
 *
 * `prepare-pit-radio.mjs` trims the sources to a 20 ms lead-in, but an MP3
 * decoder prepends its own encoder delay — about 1 105 samples, ~46 ms at
 * 24 kHz — and browsers do not agree on whether to strip it. Measuring the
 * decoded buffer once, at load, is what makes "leading silence under 60 ms" a
 * property of the thing the driver hears rather than of the file on disk: the
 * padding is skipped at playback with `source.start(when, offset)` instead of
 * being argued about.
 *
 * Scans at most the first 200 ms; a line whose first word is later than that is
 * not a padding problem and must not be trimmed into.
 */
function leadIn(buffer: AudioBuffer): number {
  const samples = buffer.getChannelData(0);
  const limit = Math.min(samples.length, Math.round(buffer.sampleRate * 0.2));
  for (let index = 0; index < limit; index += 1) {
    if (Math.abs(samples[index]) >= RADIO_SILENCE_FLOOR) {
      // Back off 5 ms so the attack of the first word is not clipped.
      return Math.max(0, index / buffer.sampleRate - 0.005);
    }
  }
  return 0;
}
