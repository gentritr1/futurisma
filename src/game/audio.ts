import * as THREE from "three";
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
  AUDIO_ZONE_PROFILES,
  createImpulseResponseChannel,
  IMPULSE_RESPONSE_SEED,
  listenerPanX,
  listenerRightVector,
  playerEngineGains,
  RIVAL_AUDIO_VOICES,
  RIVAL_DETUNE_RATIOS,
  resolveZoneCrossfade,
  rivalEngineFrequency,
  rivalEngineGains,
  seededRandom,
} from "./audio-space.js";
import type { AudioZone } from "./audio-space.js";
import { ambienceCue, ambienceEventLevels } from "./ambience-cue.js";
import {
  dopplerRatio,
  inverseDistanceGain,
  RIVAL_PANNER,
  SPATIAL_LEAD_CLAMP_METERS,
  spatialLeadSeconds,
} from "./audio-space.js";
import type {
  AmbienceField,
  PlayerAirField,
  RivalVoiceLayers,
} from "./audio-ambience.js";
import { BOOST_MAX_SPEED } from "./physics.js";
import { PitRadio, RADIO_DUCK_SECONDS } from "./pit-radio";
import type { PitRadioDiagnostics } from "./pit-radio";
import { resolveVoiceEnabled, voiceKilled } from "./query-probes";
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

/**
 * A1 — re-exported so the race loop's ONE existing `./audio` import line can
 * carry them. `game.ts` sits exactly on its 1975-line seam budget, so the
 * ambience wiring is two MODIFIED lines there and zero new ones; the reasoning
 * is written out over `publishAmbienceCue` in `audio-ambience.ts`.
 */
export { publishAmbienceCue, setEventLevels } from "./ambience-cue.js";

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

/**
 * The authored master ceiling. Predates P7 as a literal `0.34`; named here so
 * the listener's master-volume setting is unambiguously a scalar *on* the mix
 * rather than a rewrite of it.
 */
const MASTER_GAIN_CEILING = 0.34;

/** @returns `volume` clamped into 0..1, or `fallback` when it is not a number. */
function clampVolume(volume: number, fallback: number): number {
  if (!Number.isFinite(volume)) return fallback;
  return volume < 0 ? 0 : volume > 1 ? 1 : volume;
}

const BEAT_SECONDS = 60 / MUSIC_BPM;
const BAR_SECONDS = BEAT_SECONDS * 4;
const CONTROL_INTERVAL_SECONDS = 1 / 30;
/** Roughly half a control tick: tracks a passing rival without zippering. */
const SPATIAL_SMOOTHING_SECONDS = 0.018;
/** A1 — what that smoother plus the tick costs in metres. See `ambience-beds`. */
const SPATIAL_LEAD_SECONDS = spatialLeadSeconds(
  SPATIAL_SMOOTHING_SECONDS,
  CONTROL_INTERVAL_SECONDS,
);
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

/**
 * A rival source only has to publish where it is and how fast it is moving.
 * Keeping the seam this narrow stops the audio graph from depending on the
 * rival simulation, whose determinism is owned elsewhere.
 */
export interface RivalSpatialSource {
  worldPosition(index: number, target: THREE.Vector3): THREE.Vector3;
  worldVelocity(index: number, target: THREE.Vector3): THREE.Vector3;
}

interface EngineGainPair {
  oscillator: number;
  harmonic: number;
}

interface RivalVoice {
  panner: PannerNode;
  oscillator: OscillatorNode;
  harmonic: OscillatorNode;
  gain: GainNode;
  harmonicGain: GainNode;
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
  /**
   * P7 — the music bus. One gain node between the stem chain's high shelf and
   * the master bus, so a music-volume setting can move the four stems without
   * touching their level automation (which the music plan owns) and without
   * moving the engine bed, the rival field or the race cues.
   */
  private musicBus: GainNode | null = null;
  /** 0..1 listener settings, applied on top of the authored mix. */
  private masterVolume = 1;
  private musicVolume = 1;
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
  private readonly rivalVoices: RivalVoice[] = [];
  private rivalBus: GainNode | null = null;
  private rivalFilter: BiquadFilterNode | null = null;
  private convolver: ConvolverNode | null = null;
  private reverbSend: GainNode | null = null;
  private reverbHighPass: BiquadFilterNode | null = null;
  private reverbWetGain: GainNode | null = null;
  private readonly impulseResponses = new Map<AudioZone, AudioBuffer>();
  private reverbZone: AudioZone = "open";
  private pendingReverbZone: AudioZone | null = null;
  private reverbSwapAt = 0;
  private reverbCrossfadeEnd = 0;
  private readonly reverbAutomation: StemAutomation = {
    from: AUDIO_ZONE_PROFILES.open.wet,
    target: AUDIO_ZONE_PROFILES.open.wet,
    start: 0,
    end: 0,
  };
  private diagnosticReverbTransitions = 0;
  private spatialSource: RivalSpatialSource | null = null;
  private spatialCamera: THREE.Object3D | null = null;
  private spatialListener: THREE.Vector3 | null = null;
  private rivalProbeOffset: THREE.Vector3 | null = null;
  private readonly rivalPanValues = RIVAL_DETUNE_RATIOS.map(() => 0);
  private readonly playerGainPair: EngineGainPair = { oscillator: 0, harmonic: 0 };
  private readonly rivalGainPair: EngineGainPair = { oscillator: 0, harmonic: 0 };
  private readonly spatialForward = new THREE.Vector3(0, 0, -1);
  private readonly spatialUp = new THREE.Vector3(0, 1, 0);
  private readonly spatialRight = new THREE.Vector3(1, 0, 0);
  private readonly spatialPosition = new THREE.Vector3();
  private readonly spatialVelocity = new THREE.Vector3();
  private readonly spatialDelta = new THREE.Vector3();
  /** Scratch for the lag-compensated position handed to an AudioParam. */
  private readonly spatialLead = new THREE.Vector3();
  /**
   * A1 — the sound field. The beds, the player's air and the extra rival layers
   * are all built and owned by `audio-ambience.ts`; this class only ticks them
   * on the control clock it already runs.
   */
  private ambience: AmbienceField | null = null;
  private playerAir: PlayerAirField | null = null;
  private readonly rivalLayers: RivalVoiceLayers[] = [];
  /**
   * The listener's own velocity, finite-differenced off the live vehicle vector
   * across control ticks. Needed for the Doppler closing speed and available
   * without widening any seam, since the listener position is already bound.
   */
  private readonly listenerVelocity = new THREE.Vector3();
  private readonly previousListener = new THREE.Vector3();
  private hasPreviousListener = false;
  private previousSpatialTime = 0;
  private lastMusicProfile: MusicProfile = {
    trance: 0,
    jungle: 0,
    deep_dnb: 0,
    techstep: 0,
  };
  /**
   * Diagnostics readouts, pre-allocated once. `panners` is read BACK off the
   * `PannerNode` AudioParams and `sources` is sampled from the rival seam on the
   * same tick, so the two are independent enough for the harness to assert one
   * against the other rather than against itself.
   */
  private readonly pannerReadouts = RIVAL_DETUNE_RATIOS.map(() => ({
    x: 0,
    y: 0,
    z: 0,
    gain: 0,
  }));
  private readonly sourceReadouts = RIVAL_DETUNE_RATIOS.map(() => ({
    x: 0,
    y: 0,
    z: 0,
    speed: 0,
    doppler: 1,
    boost: 0,
    brake: 0,
  }));
  private readonly listenerPose = {
    x: 0,
    y: 0,
    z: 0,
    forwardX: 0,
    forwardY: 0,
    forwardZ: -1,
    upX: 0,
    upY: 1,
    upZ: 0,
  };
  private readonly bedLevelReadout: Record<string, number> = {};
  /** Stand-in when a voice has no layer object; never mutated. */
  private readonly idleRivalSignals = { boost: 0, brake: 0 };
  private diagnosticAmbiencePrepareMs = 0;
  private diagnosticBedZone: AudioZone = "open";
  private diagnosticNearestRivalMeters = Number.POSITIVE_INFINITY;
  private diagnosticNearestClosingMps = 0;
  /**
   * The lazily-loaded ambience module. `validate-build.mjs` caps the initial
   * gzip shell and the bed plan plus its baked loops is 5.5 KiB of it, so the
   * whole thing arrives on the same `await` the AudioContext already needs.
   */
  private ambienceModule: typeof import("./audio-ambience.js") | null = null;
  /**
   * H2b — the pit radio, and the one gain node its ambience duck needs.
   *
   * `ambienceBus` is a unity gain between the bed field / player air and the
   * master bus. It exists only so the duck has something to move: `AmbienceField`
   * owns its own bed levels and `PlayerAirField` its own air, and neither should
   * have to know that something occasionally wants them 2 dB quieter. At unity
   * it is transparent, so an `?voice=0` build and a pre-H2b build have
   * bit-identical ambience paths.
   *
   * Null under `?voice=0`. The whole subsystem — the bus, the filters, the
   * fetch and the control-tick poll — is never constructed in that case, which
   * is what makes the switch a genuine kill rather than a mute. The STORED
   * setting is a different thing and is re-read every control tick, so the
   * VOICE row applies live like the two volume sliders rather than behind a
   * relink; see `resolveVoiceEnabled`.
   */
  private radio: PitRadio | null = null;
  private ambienceBus: GainNode | null = null;
  /** The live music duck, so `setMusicVolume` composes with it rather than
   * cancelling it mid-line. 1 whenever no line is playing. */
  private radioMusicScale = 1;

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

    // A1 — the only `await` in the graph build, taken BEFORE the context is
    // created so nothing between here and `this.context = context` can be
    // re-entered. The chunk is small and this runs behind the start button.
    this.ambienceModule = await import("./audio-ambience.js");

    const initializationStartedAt = performance.now();
    const context = new AudioContext();
    const master = context.createGain();
    master.gain.value = MASTER_GAIN_CEILING * this.masterVolume;
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
    const random = seededRandom(IMPULSE_RESPONSE_SEED);
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
    this.installReverb(context, master, filter);
    this.installRivalVoices(context, master);
    this.installMusic(context, master);
    // A1. The player's air is map-independent so it is built here; the beds are
    // not, so they wait for `publishAmbienceCue` to name a map. In practice the
    // frame loop has already published one by the time `start()` runs, which is
    // what keeps the ~60 ms of loop baking inside this one-off cost rather than
    // dropping it on the first control tick of the countdown.
    // H2b — everything ambient goes through one bus so the radio has a single
    // thing to duck. See the field note; at unity this changes no level.
    const ambienceBus = context.createGain();
    ambienceBus.gain.value = 1;
    ambienceBus.connect(master);
    this.ambienceBus = ambienceBus;
    this.playerAir = new this.ambienceModule.PlayerAirField(context, ambienceBus);
    this.ensureAmbience(context, ambienceBus);
    if (!voiceKilled()) {
      this.radio = new PitRadio(context, master, this.applyRadioDuck);
      this.radio.setEnabled(resolveVoiceEnabled());
    }
    this.diagnosticInitializationMs = performance.now() - initializationStartedAt;
  }

  /**
   * The two ducks, applied together.
   *
   * The music scale multiplies the LISTENER's own music volume rather than
   * replacing it, which is the P7 rule about the mix ceiling one level down: a
   * driver who has pulled the music to 40 % still hears it duck by 3 dB under a
   * radio call, and setting `musicVolume` while a line is playing composes
   * rather than fights (`setMusicVolume` re-applies the same product).
   */
  private readonly applyRadioDuck = (
    musicScale: number,
    ambienceScale: number,
  ): void => {
    if (!this.context) return;
    const now = this.context.currentTime;
    this.radioMusicScale = musicScale;
    this.musicBus?.gain.setTargetAtTime(
      this.musicVolume * musicScale,
      now,
      RADIO_DUCK_SECONDS,
    );
    this.ambienceBus?.gain.setTargetAtTime(ambienceScale, now, RADIO_DUCK_SECONDS);
  };

  /**
   * Builds (or rebuilds) the bed field for whatever map the cue names. Cheap
   * and idempotent once the map is stable; a map change disposes the old field
   * rather than leaving two maps' beds summing into the bus.
   */
  private ensureAmbience(context: AudioContext, master: GainNode): void {
    const map = ambienceCue().map;
    if (!map || !this.ambienceModule || this.ambience?.map === map) return;
    this.ambience?.dispose();
    this.ambience = new this.ambienceModule.AmbienceField(
      context,
      master,
      this.reverbSend,
      map,
    );
    this.diagnosticAmbiencePrepareMs = this.ambience.preparationMs;
  }

  /**
   * Binds the spatial field to the live scene once, so the 30 Hz control tick
   * carries no extra arguments and no second tick is ever needed. `listener` is
   * the live vehicle position vector; the ear rides the craft while the chase
   * camera only supplies heading.
   */
  attachSpatialScene(
    source: RivalSpatialSource,
    camera: THREE.Object3D,
    listener: THREE.Vector3,
  ): void {
    this.spatialSource = source;
    this.spatialCamera = camera;
    this.spatialListener = listener;
  }

  /**
   * `?probe=rival-audio` pins the first rival a fixed distance off the player's
   * beam so a headless run can assert the pan axis. The offset is captured from
   * the course frame, never from the camera basis the pan is measured against,
   * or the probe would be proving itself. It is stored relative to the craft so
   * the reading survives the player rolling forward off the line.
   */
  setRivalAudioProbe(right: THREE.Vector3, lateralMeters: number): void {
    this.rivalProbeOffset = new THREE.Vector3().copy(right)
      .normalize()
      .multiplyScalar(lateralMeters);
  }

  update(
    speedRatio: number,
    throttle: number,
    brake: number,
    boost: boolean,
    surfaceGrip: number,
    driftIntensity: number,
    zone: AudioZone = "open",
    racing = false,
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
    const playerGains = playerEngineGains(throttle, speedRatio, boost, this.playerGainPair);
    this.engineGain?.gain.setTargetAtTime(playerGains.oscillator, now, 0.08);
    this.harmonicGain?.gain.setTargetAtTime(playerGains.harmonic, now, 0.06);
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
    this.updateReverbZone(now, zone);
    this.updateRivals(now, racing);
    // A1. Same tick, same clock: the beds, the player's air and the pass-by
    // whoosh all move on the 30 Hz control update rather than adding a timer.
    if (this.ambienceBus) this.ensureAmbience(this.context, this.ambienceBus);
    // H2b — the radio drains its queue on the same tick, after the beds, so a
    // line and the duck it causes are scheduled against one `now`.
    this.radio?.setEnabled(resolveVoiceEnabled());
    this.radio?.tick(now);
    // The beds follow the zone IMMEDIATELY; only the convolver waits for a bar.
    // `bedZone` is recorded separately from `reverbZone` for that reason — they
    // legitimately disagree for up to one bar at every boundary.
    this.diagnosticBedZone = zone;
    this.ambience?.update(now, zone, this.lastMusicProfile);
    this.playerAir?.update(now, speedRatio, boost);
    if (Number.isFinite(this.diagnosticNearestRivalMeters)) {
      this.playerAir?.passBy(
        now,
        this.diagnosticNearestRivalMeters,
        this.diagnosticNearestClosingMps,
      );
    }
    return true;
  }

  setMusicProfile(profile: MusicProfile): void {
    // A1 — latched before the key gate below, because the ambience duck reads
    // the LEVELS, not the transition. A profile that has not changed still has
    // to be visible to the beds on the very first tick.
    this.lastMusicProfile = profile;
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

  /**
   * H2b — the seven radio lines that hang off an existing cue, and why they
   * hang off it rather than off a new call in the race loop.
   *
   * Each of `playGate`, `playMissedGate`, `playCountdown`, `playSlipstreamLock`,
   * `playNearMiss`, `playFinalLap` and `playClassification` is ALREADY called
   * at exactly the edge its line describes, from a race loop that sits on its
   * seam budget with no headroom. A `this.radio?.cue(...)` beside the tone is
   * therefore both the cheapest wiring available and the most honest one: the
   * chime and the words are the same event by construction and cannot come
   * apart in a later edit the way two separate call sites would.
   *
   * The other ten lines are edges the tones do not mark. Five are read off the
   * HUD frame (`pit-radio.ts`), three off the track-event arm serial, and
   * `position_gained` / `position_lost` deliberately do NOT hang off
   * `playPositionChange`, because a position has to HOLD for 1.5 s before it is
   * worth saying and the tone fires on the instant.
   */
  playGate(index: number): void {
    const noteIndex = ((index - 1) % GATE_CHIME_MIDI.length
      + GATE_CHIME_MIDI.length) % GATE_CHIME_MIDI.length;
    const note = GATE_CHIME_MIDI[noteIndex];
    const frequency = frequencyForMidiNote(note);
    this.playTone(frequency, 0.11, 0.038, "square", 0, 1.02);
    this.playTone(frequency * 1.5, 0.15, 0.022, "sine", 0.045, 1.01);
    this.radio?.cue("gate_clear");
  }

  playMissedGate(): void {
    this.playTone(150, 0.2, 0.038, "square", 0, 0.58);
    this.playTone(94, 0.26, 0.03, "sawtooth", 0.08, 0.72);
    this.radio?.cue("gate_missed");
  }

  playCountdown(go: boolean): void {
    this.playTone(go ? 520 : 260, go ? 0.16 : 0.09, go ? 0.045 : 0.028, "square");
    if (go) this.radio?.cue("lights_out");
  }

  playBoost(): void {
    this.playTone(115, 0.2, 0.04, "sawtooth", 0, 2.2);
    this.playTone(460, 0.14, 0.024, "square", 0.04, 1.5);
  }

  /**
   * G1 - the slipstream locking on. Deliberately the quiet inverse of
   * `playBoost`: boost is a low sawtooth shove with a bright spike on top, this
   * is a soft rising sine pair at half the level, because catching a tow is a
   * thing that happens TO the craft rather than something the driver fires. One
   * cue, fired on the lock edge only, so a lap spent drafting does not chatter.
   */
  playSlipstreamLock(): void {
    this.playTone(228, 0.17, 0.018, "sine", 0, 1.42);
    this.playTone(342, 0.22, 0.013, "triangle", 0.05, 1.34);
    this.radio?.cue("slipstream_locked");
  }

  /**
   * G2 near miss. Deliberately in the same register as the drift cash-in - a
   * short square blip and a sine over it - because it is the same event to the
   * player: a risk taken, banked as reserve. Pitched a fifth above the drift's
   * top so the two are still tellable apart in the same corner, and one voice
   * shorter, since a near miss fires mid-overtake when the mix is busiest.
   */
  playNearMiss(): void {
    this.playTone(630, 0.1, 0.02, "square", 0, 0.82);
    this.playTone(945, 0.16, 0.012, "sine", 0.045, 0.9);
    this.radio?.cue("near_miss");
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
    this.radio?.cue("final_lap");
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
    this.radio?.cue("classification_locked");
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

  /**
   * P7 — the two listener volumes. Both are scalars on top of the authored mix
   * rather than replacements for it: `0.34` stays the ceiling the whole game was
   * balanced against, and `1` reproduces the pre-P7 mix exactly. Safe to call
   * before the context exists; the value is applied when it is built.
   */
  setMasterVolume(volume: number): void {
    this.masterVolume = clampVolume(volume, this.masterVolume);
    this.updateMasterGain();
  }

  setMusicVolume(volume: number): void {
    this.musicVolume = clampVolume(volume, this.musicVolume);
    if (!this.context || !this.musicBus) return;
    // H2b — the product, not the setting. Moving the slider while a radio line
    // is playing would otherwise undo the duck for the rest of the sentence.
    this.musicBus.gain.setTargetAtTime(
      this.musicVolume * this.radioMusicScale,
      this.context.currentTime,
      0.045,
    );
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
    this.diagnosticReverbTransitions = 0;
    this.radio?.resetDiagnostics();
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
    rivalPanners: number;
    rivalPanX: number[];
    reverbZone: AudioZone;
    reverbWet: number;
    reverbZoneTransitions: number;
    masterVolume: number;
    musicVolume: number;
    ambience: {
      map: string;
      bedZone: AudioZone;
      beds: number;
      bedLevels: Record<string, number>;
      eventLevels: { windGust: number; squall: number; saltDrop: number };
      preparationMs: number;
      passByWhooshes: number;
      nearestRivalMeters: number;
      spatialSources: { x: number; y: number; z: number; speed: number;
        doppler: number; boost: number; brake: number }[];
      panners: { x: number; y: number; z: number; gain: number }[];
      listenerPose: {
        x: number; y: number; z: number;
        forwardX: number; forwardY: number; forwardZ: number;
        upX: number; upY: number; upZ: number;
      };
    };
    pitRadio: PitRadioDiagnostics;
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
      rivalPanners: this.rivalVoices.length,
      rivalPanX: [...this.rivalPanValues],
      reverbZone: this.reverbZone,
      // Sampled from the scheduled ramp rather than read back off the param, so
      // the number is the same on every engine and is honest mid-crossfade.
      reverbWet: this.context
        ? sampleLinearAutomation(
          this.context.currentTime,
          this.reverbAutomation.from,
          this.reverbAutomation.target,
          this.reverbAutomation.start,
          this.reverbAutomation.end,
        )
        : 0,
      reverbZoneTransitions: this.diagnosticReverbTransitions,
      masterVolume: this.masterVolume,
      musicVolume: this.musicVolume,
      // A1. Copied out here rather than shared, because `diagnostics()` runs
      // about once a second while the readouts below are mutated 30 times a
      // second — handing the report a live reference would make every emitted
      // line disagree with the tick it claims to describe.
      ambience: {
        map: this.ambience?.map ?? "",
        bedZone: this.diagnosticBedZone,
        beds: this.ambience?.bedCount ?? 0,
        bedLevels: { ...this.ambience?.levels(this.bedLevelReadout) },
        eventLevels: { ...ambienceEventLevels() },
        preparationMs: this.diagnosticAmbiencePrepareMs,
        passByWhooshes: this.playerAir?.passByCount ?? 0,
        nearestRivalMeters: Number.isFinite(this.diagnosticNearestRivalMeters)
          ? this.diagnosticNearestRivalMeters
          : -1,
        spatialSources: this.sourceReadouts.map((readout) => ({ ...readout })),
        panners: this.pannerReadouts.map((readout) => ({ ...readout })),
        listenerPose: { ...this.listenerPose },
      },
      // H2b. Reported even with the voice off, so a soak line can tell "the
      // driver turned it off" (loaded 0, linesPlayed 0) from "it is on and
      // nothing fired" (loaded 17, linesPlayed 0), which are different bugs.
      pitRadio: this.radio?.diagnostics()
        ?? { linesPlayed: 0, linesDropped: 0, lastLine: "", queueDepth: 0, loaded: 0 },
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
    for (const voice of this.rivalVoices) {
      voice.gain.disconnect();
      voice.harmonicGain.disconnect();
      voice.panner.disconnect();
    }
    this.rivalVoices.length = 0;
    // A1 — the ambience field owns the only large buffers this phase allocates
    // (about 29 s of baked loops on Bitterpan), so dropping it here is what
    // keeps a disposed race off the heap.
    for (const layers of this.rivalLayers) layers.dispose();
    this.rivalLayers.length = 0;
    this.ambience?.dispose();
    this.ambience = null;
    this.playerAir?.dispose();
    this.playerAir = null;
    this.radio?.dispose();
    this.radio = null;
    this.ambienceBus?.disconnect();
    this.ambienceBus = null;
    this.radioMusicScale = 1;
    this.hasPreviousListener = false;
    this.previousSpatialTime = 0;
    this.listenerVelocity.set(0, 0, 0);
    this.diagnosticAmbiencePrepareMs = 0;
    this.diagnosticBedZone = "open";
    this.diagnosticNearestRivalMeters = Number.POSITIVE_INFINITY;
    this.diagnosticNearestClosingMps = 0;
    this.ambienceModule = null;
    for (const key of Object.keys(this.bedLevelReadout)) {
      delete this.bedLevelReadout[key];
    }
    this.rivalBus?.disconnect();
    this.rivalFilter?.disconnect();
    this.reverbSend?.disconnect();
    this.reverbHighPass?.disconnect();
    this.convolver?.disconnect();
    this.reverbWetGain?.disconnect();
    // The impulse responses are the only large buffers this phase allocates.
    // Dropping them here is what keeps a disposed race off the heap.
    if (this.convolver) this.convolver.buffer = null;
    this.impulseResponses.clear();
    this.rivalBus = null;
    this.rivalFilter = null;
    this.reverbSend = null;
    this.reverbHighPass = null;
    this.convolver = null;
    this.reverbWetGain = null;
    this.spatialSource = null;
    this.spatialCamera = null;
    this.spatialListener = null;
    this.rivalProbeOffset = null;
    this.rivalPanValues.fill(0);
    this.reverbZone = "open";
    this.pendingReverbZone = null;
    this.reverbSwapAt = 0;
    this.reverbCrossfadeEnd = 0;
    this.diagnosticReverbTransitions = 0;
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
    this.musicBus = null;
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

  /**
   * One convolver, one pre-built impulse response per authored room. Building
   * them all at start-up is what keeps a zone change allocation-free: the 5-lap
   * soak crosses ten boundaries and must not grow the heap by doing so. The
   * loop reads the profile table rather than a hardcoded pair, so authoring a
   * room is a data edit — P8's `underpass` needed no change here.
   */
  private installReverb(
    context: AudioContext,
    master: GainNode,
    engineFilter: BiquadFilterNode,
  ): void {
    for (const zone of Object.keys(AUDIO_ZONE_PROFILES) as AudioZone[]) {
      const profile = AUDIO_ZONE_PROFILES[zone];
      const buffer = context.createBuffer(
        2,
        Math.ceil(profile.decaySeconds * context.sampleRate),
        context.sampleRate,
      );
      for (let channel = 0; channel < 2; channel += 1) {
        buffer.copyToChannel(
          createImpulseResponseChannel(
            context.sampleRate,
            profile.decaySeconds,
            IMPULSE_RESPONSE_SEED + channel,
          ),
          channel,
        );
      }
      this.impulseResponses.set(zone, buffer);
    }

    const send = context.createGain();
    send.gain.value = 1;
    const highPass = context.createBiquadFilter();
    highPass.type = "highpass";
    highPass.frequency.value = AUDIO_ZONE_PROFILES.open.highPassHz;
    highPass.Q.value = 0.7;
    const convolver = context.createConvolver();
    convolver.normalize = true;
    convolver.buffer = this.impulseResponses.get("open") ?? null;
    const wet = context.createGain();
    wet.gain.value = AUDIO_ZONE_PROFILES.open.wet;
    send.connect(highPass);
    highPass.connect(convolver);
    convolver.connect(wet);
    wet.connect(master);
    // The engine bed and the rival field feed the room; the music stems do not.
    // Readability-first applies to audio: a 1.9 s tail across the 174 BPM stems
    // is the "muddy" failure the taste gate is watching for.
    engineFilter.connect(send);

    this.reverbSend = send;
    this.reverbHighPass = highPass;
    this.convolver = convolver;
    this.reverbWetGain = wet;
    this.reverbZone = "open";
    this.reverbAutomation.from = AUDIO_ZONE_PROFILES.open.wet;
    this.reverbAutomation.target = AUDIO_ZONE_PROFILES.open.wet;
    this.reverbAutomation.start = context.currentTime;
    this.reverbAutomation.end = context.currentTime;
  }

  /**
   * Three panners, each fed by the same sawtooth + triangle pair the player
   * engine uses, summed through one shared lowpass so the field reads as one
   * pack rather than three separate sirens.
   */
  private installRivalVoices(context: AudioContext, master: GainNode): void {
    const bus = context.createGain();
    bus.gain.value = 1;
    const filter = context.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 1_500;
    filter.Q.value = 0.9;
    bus.connect(filter);
    filter.connect(master);
    if (this.reverbSend) filter.connect(this.reverbSend);
    this.rivalBus = bus;
    this.rivalFilter = filter;

    for (let index = 0; index < RIVAL_AUDIO_VOICES; index += 1) {
      // A1 — the distance model is authored in `ambience-beds.js` now, so the
      // validator and the harness read the SAME numbers the graph is built
      // from rather than a copy of them.
      const panner = context.createPanner();
      panner.panningModel = RIVAL_PANNER.panningModel as PanningModelType;
      panner.distanceModel = RIVAL_PANNER.distanceModel as DistanceModelType;
      panner.refDistance = RIVAL_PANNER.refDistance;
      panner.maxDistance = RIVAL_PANNER.maxDistance;
      panner.rolloffFactor = RIVAL_PANNER.rolloffFactor;
      panner.connect(bus);

      const detune = RIVAL_DETUNE_RATIOS[index];
      const gain = context.createGain();
      gain.gain.value = 0;
      gain.connect(panner);
      const oscillator = context.createOscillator();
      oscillator.type = "sawtooth";
      oscillator.frequency.value = rivalEngineFrequency(0, detune);
      oscillator.connect(gain);
      oscillator.start();

      const harmonicGain = context.createGain();
      harmonicGain.gain.value = 0;
      harmonicGain.connect(panner);
      const harmonic = context.createOscillator();
      harmonic.type = "triangle";
      harmonic.frequency.value = rivalEngineFrequency(0, detune) * 2.03;
      harmonic.connect(harmonicGain);
      harmonic.start();

      this.persistentSources.push(oscillator, harmonic);
      this.rivalVoices.push({ panner, oscillator, harmonic, gain, harmonicGain });
      // A1 — the boost layer and the airbrake hiss go into the SAME panner, so
      // a rival that lights its boost gets louder from where it already is
      // rather than from the middle of the mix.
      if (this.ambienceModule) {
        this.rivalLayers.push(
          new this.ambienceModule.RivalVoiceLayers(context, panner, detune),
        );
      }
    }
  }

  /**
   * Bar-quantized room change. The send closes over the first half of the
   * window, the single convolver swaps its pre-built buffer while it is silent,
   * and the new room opens over the second half. The swap is observed on this
   * same 30 Hz tick, so no second timer is introduced.
   */
  private updateReverbZone(now: number, zone: AudioZone): void {
    const wet = this.reverbWetGain?.gain;
    if (!wet || !this.convolver) return;
    const automation = this.reverbAutomation;
    if (zone !== this.reverbZone && zone !== this.pendingReverbZone) {
      const held = sampleLinearAutomation(
        now,
        automation.from,
        automation.target,
        automation.start,
        automation.end,
      );
      const window = resolveZoneCrossfade(now, this.musicStartTime, BAR_SECONDS);
      wet.cancelScheduledValues(now);
      wet.setValueAtTime(held, now);
      wet.setValueAtTime(held, window.start);
      wet.linearRampToValueAtTime(0, window.mute);
      this.reverbHighPass?.frequency.setTargetAtTime(
        AUDIO_ZONE_PROFILES[zone].highPassHz,
        window.start,
        0.18,
      );
      automation.from = held;
      automation.target = 0;
      automation.start = window.start;
      automation.end = window.mute;
      this.pendingReverbZone = zone;
      this.reverbSwapAt = window.mute;
      this.reverbCrossfadeEnd = window.end;
      this.diagnosticReverbTransitions += 1;
    }
    if (!this.pendingReverbZone || now < this.reverbSwapAt) return;
    const next = this.pendingReverbZone;
    this.convolver.buffer = this.impulseResponses.get(next) ?? null;
    const target = AUDIO_ZONE_PROFILES[next].wet;
    const end = Math.max(this.reverbCrossfadeEnd, now + 0.05);
    wet.cancelScheduledValues(now);
    wet.setValueAtTime(0, now);
    wet.linearRampToValueAtTime(target, end);
    automation.from = 0;
    automation.target = target;
    automation.start = now;
    automation.end = end;
    this.reverbZone = next;
    this.pendingReverbZone = null;
  }

  /**
   * Places the three rival voices in listener space. The listener sits on the
   * craft and takes its heading from the chase camera; rival gain is gated on an
   * active race so the grid is silent through the countdown.
   */
  private updateRivals(now: number, racing: boolean): void {
    const source = this.spatialSource;
    const camera = this.spatialCamera;
    const listener = this.spatialListener;
    if (!this.context || !source || !camera || !listener) return;
    // The chase camera renders unparented, so its world matrix is only rebuilt
    // by the renderer. Rebuilding it here keeps the listener on this frame's
    // heading rather than the previous frame's.
    camera.updateMatrixWorld();
    const basis = camera.matrixWorld.elements;
    this.spatialForward.set(-basis[8], -basis[9], -basis[10]).normalize();
    this.spatialUp.set(basis[4], basis[5], basis[6]).normalize();
    listenerRightVector(this.spatialForward, this.spatialUp, this.spatialRight);
    // A1. The listener's own velocity, finite-differenced across control ticks.
    // Nothing publishes it, and it is needed twice: for the Doppler term, which
    // wants the RELATIVE closing speed rather than the rival's ground speed,
    // and for the lag compensation below. One pole of smoothing on it, because
    // a dropped frame otherwise turns into a velocity spike.
    const step = Math.max(1e-3, now - this.previousSpatialTime);
    if (this.hasPreviousListener) {
      this.spatialDelta.subVectors(listener, this.previousListener)
        .multiplyScalar(1 / step)
        .sub(this.listenerVelocity)
        .multiplyScalar(0.45);
      this.listenerVelocity.add(this.spatialDelta);
    } else {
      this.listenerVelocity.set(0, 0, 0);
    }
    this.previousListener.copy(listener);
    this.hasPreviousListener = true;
    this.previousSpatialTime = now;
    this.applyListener(
      this.context.listener,
      this.leadPosition(listener, this.listenerVelocity),
      now,
    );
    this.diagnosticNearestRivalMeters = Number.POSITIVE_INFINITY;
    this.diagnosticNearestClosingMps = 0;
    this.readListenerPose(listener);

    for (let index = 0; index < this.rivalVoices.length; index += 1) {
      const voice = this.rivalVoices[index];
      const pinned = index === 0 && this.rivalProbeOffset !== null;
      const position = pinned
        ? this.spatialPosition.addVectors(listener, this.rivalProbeOffset!)
        : source.worldPosition(index, this.spatialPosition);
      // A pinned probe source rides the craft, so it is led by the CRAFT's
      // velocity; otherwise the lag compensation would shove it forward at the
      // rival's speed and the probe would stop being a fixed offset.
      const speed = source.worldVelocity(index, this.spatialVelocity).length();
      this.applyPanner(
        voice.panner,
        this.leadPosition(position, pinned ? this.listenerVelocity : this.spatialVelocity),
        now,
      );
      const speedRatio = speed / BOOST_MAX_SPEED;
      this.spatialDelta.subVectors(position, listener);
      const distance = this.spatialDelta.length();
      // Positive when the gap is shrinking. `spatialVelocity` still holds the
      // rival's velocity from the call above, so this costs no extra vector.
      const closing = distance > 1e-4
        ? -(this.spatialVelocity.sub(this.listenerVelocity).dot(this.spatialDelta))
          / distance
        : 0;
      const doppler = dopplerRatio(closing);
      const frequency = rivalEngineFrequency(speedRatio, RIVAL_DETUNE_RATIOS[index])
        * doppler;
      voice.oscillator.frequency.setTargetAtTime(frequency, now, 0.05);
      voice.harmonic.frequency.setTargetAtTime(frequency * 2.03, now, 0.05);
      const gains = rivalEngineGains(speedRatio, this.rivalGainPair);
      voice.gain.gain.setTargetAtTime(racing ? gains.oscillator : 0, now, 0.08);
      voice.harmonicGain.gain.setTargetAtTime(racing ? gains.harmonic : 0, now, 0.08);
      // Returns the layer's own reused signal object; nothing here allocates.
      const layers = this.rivalLayers[index]?.update(now, speed, step, doppler, racing)
        ?? this.idleRivalSignals;
      this.rivalPanValues[index] = listenerPanX(this.spatialDelta, this.spatialRight);
      if (distance < this.diagnosticNearestRivalMeters) {
        this.diagnosticNearestRivalMeters = distance;
        this.diagnosticNearestClosingMps = closing;
      }
      this.readSpatialDiagnostics(index, listener, speed, doppler, layers);
    }
  }

  /**
   * The A1 readouts, taken on the same tick from two different places on
   * purpose: `panners[i]` is read BACK off the `PannerNode`'s own AudioParams
   * (so it carries the smoothing lag and would catch a mis-indexed or stale
   * position), while `spatialSources[i]` is the rival seam sampled directly.
   * The harness asserts one against the other; if they were both derived from
   * the same vector the check would be proving itself.
   *
   * Both are expressed in LISTENER space — right, up, forward — because that is
   * the frame the pan is actually heard in, and each is taken against ITS OWN
   * origin: the panner readback against the AudioListener's smoothed position,
   * the seam sample against the live craft. That distinction is the whole
   * measurement. Both nodes ride the same 18 ms position smoother, and at 90 m/s
   * a shared smoother puts BOTH about 3 m behind the world — but in the same
   * direction, so what the ear actually receives is the difference, which is
   * correct to well under a metre. Measuring a smoothed panner against an
   * unsmoothed listener reports that shared 3 m lag as if it were error, and it
   * is not: it is a 33 ms delay applied uniformly to the whole scene.
   */
  private readSpatialDiagnostics(
    index: number,
    listener: THREE.Vector3,
    speed: number,
    doppler: number,
    layers: { boost: number; brake: number },
  ): void {
    const panner = this.rivalVoices[index].panner;
    const readout = this.pannerReadouts[index];
    const pose = this.listenerPose;
    const x = panner.positionX ? panner.positionX.value : pose.x;
    const y = panner.positionY ? panner.positionY.value : pose.y;
    const z = panner.positionZ ? panner.positionZ.value : pose.z;
    this.spatialDelta.set(x - pose.x, y - pose.y, z - pose.z);
    readout.x = this.spatialDelta.dot(this.spatialRight);
    readout.y = this.spatialDelta.dot(this.spatialUp);
    readout.z = this.spatialDelta.dot(this.spatialForward);
    readout.gain = inverseDistanceGain(this.spatialDelta.length());

    const sourceReadout = this.sourceReadouts[index];
    this.spatialDelta.subVectors(this.spatialPosition, listener);
    sourceReadout.x = this.spatialDelta.dot(this.spatialRight);
    sourceReadout.y = this.spatialDelta.dot(this.spatialUp);
    sourceReadout.z = this.spatialDelta.dot(this.spatialForward);
    sourceReadout.speed = speed;
    sourceReadout.doppler = doppler;
    sourceReadout.boost = layers.boost;
    sourceReadout.brake = layers.brake;
  }

  /**
   * `position + velocity * lead`, clamped. Both the listener and every panner
   * go through this, so the compensation cancels for a pack running together
   * and only shows up where two craft are genuinely diverging. Returns a shared
   * scratch vector: the caller must consume it before the next call.
   */
  private leadPosition(
    position: THREE.Vector3,
    velocity: THREE.Vector3,
  ): THREE.Vector3 {
    this.spatialLead.copy(velocity).multiplyScalar(SPATIAL_LEAD_SECONDS);
    const reach = this.spatialLead.length();
    if (reach > SPATIAL_LEAD_CLAMP_METERS) {
      this.spatialLead.multiplyScalar(SPATIAL_LEAD_CLAMP_METERS / reach);
    }
    return this.spatialLead.add(position);
  }

  /**
   * The AudioListener's own state, read back off its AudioParams once per tick
   * before the rivals are placed against it.
   */
  private readListenerPose(listener: THREE.Vector3): void {
    const node = this.context?.listener;
    if (!node) return;
    const pose = this.listenerPose;
    pose.x = node.positionX ? node.positionX.value : listener.x;
    pose.y = node.positionY ? node.positionY.value : listener.y;
    pose.z = node.positionZ ? node.positionZ.value : listener.z;
    pose.forwardX = node.forwardX ? node.forwardX.value : this.spatialForward.x;
    pose.forwardY = node.forwardY ? node.forwardY.value : this.spatialForward.y;
    pose.forwardZ = node.forwardZ ? node.forwardZ.value : this.spatialForward.z;
    pose.upX = node.upX ? node.upX.value : this.spatialUp.x;
    pose.upY = node.upY ? node.upY.value : this.spatialUp.y;
    pose.upZ = node.upZ ? node.upZ.value : this.spatialUp.z;
  }

  /**
   * Positions ramp with the same `setTargetAtTime` smoothing the engine control
   * uses. A hard jump every 33 ms zippers audibly on a rival going past, and
   * scheduling one automation per tick is the pattern the existing 5-lap soaks
   * already exercise. Safari still ships the deprecated setters instead of the
   * AudioParams, so both paths stay live.
   */
  private applyListener(
    target: AudioListener,
    position: THREE.Vector3,
    now: number,
  ): void {
    if (!target.positionX) {
      target.setPosition(position.x, position.y, position.z);
      target.setOrientation(
        this.spatialForward.x,
        this.spatialForward.y,
        this.spatialForward.z,
        this.spatialUp.x,
        this.spatialUp.y,
        this.spatialUp.z,
      );
      return;
    }
    target.positionX.setTargetAtTime(position.x, now, SPATIAL_SMOOTHING_SECONDS);
    target.positionY.setTargetAtTime(position.y, now, SPATIAL_SMOOTHING_SECONDS);
    target.positionZ.setTargetAtTime(position.z, now, SPATIAL_SMOOTHING_SECONDS);
    target.forwardX.setTargetAtTime(this.spatialForward.x, now, SPATIAL_SMOOTHING_SECONDS);
    target.forwardY.setTargetAtTime(this.spatialForward.y, now, SPATIAL_SMOOTHING_SECONDS);
    target.forwardZ.setTargetAtTime(this.spatialForward.z, now, SPATIAL_SMOOTHING_SECONDS);
    target.upX.setTargetAtTime(this.spatialUp.x, now, SPATIAL_SMOOTHING_SECONDS);
    target.upY.setTargetAtTime(this.spatialUp.y, now, SPATIAL_SMOOTHING_SECONDS);
    target.upZ.setTargetAtTime(this.spatialUp.z, now, SPATIAL_SMOOTHING_SECONDS);
  }

  private applyPanner(
    panner: PannerNode,
    position: THREE.Vector3,
    now: number,
  ): void {
    if (!panner.positionX) {
      panner.setPosition(position.x, position.y, position.z);
      return;
    }
    panner.positionX.setTargetAtTime(position.x, now, SPATIAL_SMOOTHING_SECONDS);
    panner.positionY.setTargetAtTime(position.y, now, SPATIAL_SMOOTHING_SECONDS);
    panner.positionZ.setTargetAtTime(position.z, now, SPATIAL_SMOOTHING_SECONDS);
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
    const musicBus = context.createGain();
    musicBus.gain.value = this.musicVolume;
    musicFilter.connect(musicShelf);
    musicShelf.connect(musicBus);
    musicBus.connect(master);
    this.musicFilter = musicFilter;
    this.musicShelf = musicShelf;
    this.musicBus = musicBus;

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
      this.muted || this.paused ? 0 : MASTER_GAIN_CEILING * this.masterVolume,
      this.context.currentTime,
      0.045,
    );
  }
}
