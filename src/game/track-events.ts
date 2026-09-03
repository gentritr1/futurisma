import * as THREE from "three";
import type { RaceCourse } from "./course";
import { integrateGustVelocity } from "./physics";
import { searchParam } from "./query-probes";
import {
  BITTERPAN_WIND_BEARING_DEGREES,
  GUST_END_SECONDS,
  GUST_HOLD_END_SECONDS,
  GUST_HOLD_START_SECONDS,
  GUST_CHIP_LEAD_SECONDS,
  GUST_PEAK_CEILING_MPS2,
  GUST_RIVAL_LANE_BIAS_METERS,
  SALT_PATCH_FROM_METERS,
  SALT_PATCH_SECONDS,
  SALT_PATCH_TO_METERS,
  SALT_WARNING_SECONDS,
  GUST_SCUD_ALPHA_SCALE,
  SQUALL_RAIN_ALPHA_GAIN,
  SQUALL_RAIN_SPEED_GAIN,
  SQUALL_SECONDS,
  buildTrackEventSchedule,
  eventFogMultiplier,
  eventSurfaceGrip,
  gustEnvelope,
  gustScudTraverse,
  saltPatchAlpha,
  squallEnvelope,
} from "./track-events-rules.js";

/**
 * G3 — the world does things during the race.
 *
 * Three authored events, each telegraphed before it costs the driver anything:
 *
 *   WIND GUSTS (Bitterpan). 5-8 a lap on the three open sectors, each a
 *     1.4/1.0/1.6 s ramp-hold-ramp of lateral acceleration on the player,
 *     peaking at 2.0 m/s^2 and 2.4 from lap 3. Telegraphed by the
 *     PAN_SCUD_CROSSING cards, which stop free-running and walk over the racing
 *     line 1.2 s before each hold, and by a `GUST` chip 1.0 s before it.
 *
 *   SALT DROPS (Bitterpan). The OCC2 conveyor tips salt across the deck under
 *     its span, 2-3 times in a five-lap race and never on lap 1. Telegraphed by
 *     UNDERPASS_HAZARD_LAMPS, which drop their chase and hold SOLID for 2.0 s
 *     before the salt lands.
 *
 *   RAIN SQUALL (Greenwater). One per race, lap 2-4, 25 s over WATER_TABLE and
 *     GREENWATER_SWEEP: heavier rain cards, thicker fog, and 0.88 deck grip.
 *
 * WHY THIS IS A MODULE. `scripts/validate-module-seams.mjs` caps `game.ts`, and
 * more importantly this is one concept — the world acting on the race — that
 * shares nothing with the driving model. What `game.ts` gains is wiring: one
 * field, one construct, one `scene.add`, one `reset`, one `step`, one grip
 * argument, one HUD field and one diagnostics contributor.
 *
 * THE AUDIO SEAM, and it is deliberately a seam rather than a call. `audio.ts`
 * is owned by another phase running in parallel, so nothing here touches it.
 * Instead {@link trackEventState} publishes the four numbers an audio phase
 * needs and nothing else:
 *
 *     { windGust: 0..1, squall: 0..1, saltDrop: 0..1, lastEvent: string }
 *
 * `windGust` is the gust's share of the 2.4 m/s^2 ceiling, so a wind bed can be
 * driven straight off it; `squall` and `saltDrop` are the same 0..1 shape.
 * `lastEvent` names the most recent event to arm ("gust", "salt", "squall", or
 * "" before the first one), for a one-shot cue. Read it, do not write it.
 *
 * PUBLISHED STATE, same idiom as `time-of-day.ts` and `render-mode.js`: one
 * module-level snapshot, one writer (the single {@link TrackEvents} the race
 * loop owns), module-level readers with no subscription and no allocation. It
 * is what lets `living-world.ts`, `atmosphere.ts` and `rivals.ts` read an event
 * level without three more constructor arguments through `game.ts`.
 */

interface PublishedTrackEvents {
  /** 0..1 share of the gust ceiling. */
  gust: number;
  /** -1 (course-left) or +1 (course-right); 0 when no gust is live. */
  gustSign: number;
  /** Seconds since the live gust armed, or -1 when none is armed. */
  gustSeconds: number;
  /**
   * Whether the crossing scud is on the event clock at all.
   *
   * False on Greenwater, false with `?events=0`, and false until the first
   * physics step of a Bitterpan race — which is what keeps every pre-G3
   * station screenshot, every menu frame and every `?events=0` soak drawing the
   * free sawtooth `living-world.ts` has always drawn.
   */
  scudDriven: boolean;
  /** 0 or 1: the underpass lamps are holding solid. */
  saltWarn: number;
  /** 0..1 decal alpha for the live salt patch. */
  saltPatch: number;
  /** 0 or 1: the salt patch is costing grip. */
  saltLive: number;
  /** 0..1 squall strength. */
  squall: number;
  /** Course distance the squall is being evaluated at, metres. */
  courseDistanceMeters: number;
  /** The HUD chip label, or "" when no chip is up. */
  chip: string;
  /** "gust" | "salt" | "squall" | "" — the most recent event to arm. */
  lastEvent: string;
}

const published: PublishedTrackEvents = {
  gust: 0,
  gustSign: 0,
  gustSeconds: -1,
  scudDriven: false,
  saltWarn: 0,
  saltPatch: 0,
  saltLive: 0,
  squall: 0,
  courseDistanceMeters: 0,
  chip: "",
  lastEvent: "",
};

/** The read-only view an audio phase wires to. See the file header. */
export function trackEventState(): {
  windGust: number;
  squall: number;
  saltDrop: number;
  lastEvent: string;
} {
  return {
    windGust: published.gust,
    squall: published.squall,
    saltDrop: published.saltPatch,
    lastEvent: published.lastEvent,
  };
}

/**
 * The crossing-scud traverse for one card, for `living-world.ts`.
 *
 * Returns -1 when the cards should keep their own free sawtooth — Greenwater,
 * `?events=0`, or any frame outside a running Bitterpan race — and 0..1 when
 * the gust schedule owns the clock.
 *
 * PARKED AT 0, NOT AT ITS LAST VALUE, and that is the whole reason this returns
 * a number rather than a nullable one. A card parked at progress 0 sits at one
 * far shoulder with `cross` alpha `sin(pi * 0) = 0`; a card parked mid-traverse
 * would sit lit on the racing line between gusts, and re-phasing it when the
 * next gust armed would pop. Both ends of a traverse are alpha 0, so entering
 * and leaving the event clock is continuous by construction.
 */
export function gustScudClockSeconds(): number {
  return published.scudDriven ? published.gustSeconds : Number.NaN;
}

/**
 * The traverse, evaluated against a clock the CALLER latched.
 *
 * Split from the clock deliberately. `living-world.ts` freezes every motion
 * under reduced motion by freezing `elapsedSeconds` and letting each motion
 * recompute the same value from it; an event clock read straight off module
 * state would have kept the crossing scud walking across the road for a driver
 * who asked the whole layer to hold still. Sampling the clock once per tick,
 * behind the same `advanceMotion` gate every other motion is behind, is what
 * puts the gust cards back under that contract.
 */
export function gustScudProgressAt(clockSeconds: number, phase: number): number {
  if (!Number.isFinite(clockSeconds)) return -1;
  if (clockSeconds < 0) return 0;
  const progress = gustScudTraverse(clockSeconds, phase);
  return progress < 0 ? (clockSeconds < GUST_HOLD_START_SECONDS ? 0 : 1) : progress;
}

/**
 * Called by `living-world.ts` when a gust-driven crossing card's own centreline
 * offset changes sign — the moment the picture is actually over the road.
 *
 * The telegraph acceptance is "a crossing card reaches the road 0.8-1.6 s
 * before the hold", and this is what makes that a MEASUREMENT rather than an
 * assertion about the schedule: the lead is latched from the card system's own
 * crossing, at the card system's own 30 Hz tick, and reported per gust in
 * `gustTelegraphLeads`.
 */
export function noteScudRoadCrossing(clockSeconds: number): void {
  scudCrossingSeconds = clockSeconds;
}

let scudCrossingSeconds = -1;

/**
 * The multiplier on a gust-driven crossing card's resolved alpha.
 *
 * 1 when no schedule owns the clock, so the free sawtooth draws exactly what it
 * always did. See GUST_SCUD_ALPHA_SCALE for why it is not 1 when one does.
 */
export function gustScudAlphaScale(): number {
  return published.scudDriven ? GUST_SCUD_ALPHA_SCALE : 1;
}

/** True while the underpass lamps must hold solid instead of chasing. */
export function saltLampsSolid(): boolean {
  return published.saltWarn > 0;
}

/** The multiplier on RAIN_SWEEP card alpha; 1 outside a squall. */
export function squallRainAlphaGain(): number {
  return 1 + (SQUALL_RAIN_ALPHA_GAIN - 1) * published.squall;
}

/** The multiplier on RAIN_SWEEP fall speed; 1 outside a squall. */
export function squallRainSpeedGain(): number {
  return 1 + (SQUALL_RAIN_SPEED_GAIN - 1) * published.squall;
}

/**
 * The fog-density multiplier at the sector the craft is in, for `atmosphere.ts`.
 *
 * A multiplicative term over whatever the sector palette already returned, on
 * the same footing as the time-of-day tint: sector identity survives the
 * squall, it just gets thicker.
 */
export function trackEventFogMultiplier(): number {
  return eventFogMultiplier(published.courseDistanceMeters, published.squall);
}

/**
 * The metres a gust asks a rival to shift its TARGET LANE by, signed.
 *
 * Applied to the desired lane inside `rivalContestLaneMeters`, alongside the
 * G2 cushion yield, so the corridor solver still owns the outcome. Nothing
 * downstream of a target lane reaches a rival's speed — see the note on
 * GUST_RIVAL_LANE_BIAS_METERS — which is why the fleet finishes bit-identical
 * with events on and with `?events=0`.
 */
export function gustRivalLaneBiasMeters(): number {
  return published.gustSign * GUST_RIVAL_LANE_BIAS_METERS * gustHoldShare();
}

/** 1 only during the HOLD; the bias is a shove, not a lean. */
function gustHoldShare(): number {
  const t = published.gustSeconds;
  if (t < GUST_HOLD_START_SECONDS || t > GUST_HOLD_END_SECONDS) return 0;
  return 1;
}

/** The two race-loop values a gust is allowed to move. Mutated in place. */
export interface TrackEventPose {
  lateralMeters: number;
}

/** The pale decal the salt patch draws, lifted clear of the deck. */
const SALT_DECAL_LIFT_METERS = 0.09;
const SALT_DECAL_SEGMENTS = 6;
const SALT_DECAL_COLOUR = 0xe6ded0;
/**
 * The most opaque the salt patch ever draws.
 *
 * NOT a taste number: 0.68 is the ceiling `bitterpan-course.ts` already
 * measured for salt crust over this deck, where it is bounded from above by a
 * 135-luma cap on the opaque core and from below by needing 35 luma of contrast
 * against the deck to telegraph at all. A fresh drop is the same material as an
 * authored drift patch and has no claim to be brighter than one - and at the
 * ~0.95 the first build peaked at, the frame under the OCC2 span read as a
 * white slab laid on the road rather than as salt on it.
 */
const SALT_DECAL_PEAK_ALPHA = 0.68;
/** The patch is drawn inside the deck edge so it never reads as an apron slab. */
const SALT_DECAL_WIDTH_FRACTION = 0.94;

export interface TrackEventDiagnostics {
  trackEventsEnabled: boolean;
  gusts: number;
  gustSeconds: number;
  gustPeakPush: number;
  gustLateralMetres: number;
  gustTelegraphLeads: readonly number[];
  gustNow: number;
  saltDrops: number;
  saltPatchSeconds: number;
  saltWarningLeads: readonly number[];
  saltNow: number;
  squalls: number;
  squallSeconds: number;
  squallStartLap: number;
  squallStartMs: number;
  squallNow: number;
  trackEventChip: string;
  trackEventSchedule: string;
}

type Gust = ReturnType<typeof buildTrackEventSchedule>["gusts"][number];
type SaltDrop = ReturnType<typeof buildTrackEventSchedule>["saltDrops"][number];

export class TrackEvents {
  private readonly enabled: boolean;
  private schedule: ReturnType<typeof buildTrackEventSchedule>;
  readonly group = new THREE.Group();
  private saltDecal: THREE.Mesh | null = null;
  private saltDecalMaterial: THREE.MeshBasicMaterial | null = null;

  /** Race time, seconds. Advanced by `step` and by nothing else. */
  private raceSeconds = 0;
  private nextGustIndex = 0;
  private nextSaltIndex = 0;
  private squallArmed = false;
  /**
   * Whether this race's one squall has already run.
   *
   * SEPARATE from `squallArmed`, and the separation is the whole point. The
   * gusts and the salt drops arm off a forward-only index into their own list,
   * so each fires exactly once by construction; the squall is a single optional
   * event and was armed by a "past the station and not currently running" test,
   * which re-armed it every time it expired - the player is still past the
   * station for the rest of the race. A five-lap Greenwater soak measured FOUR
   * squalls and 89.66 s of rain against the one 25 s squall the phase authors,
   * and every unit assertion in validate-track-events.mjs passed throughout,
   * because the bug was in the ARMING and the schedule was correct.
   */
  private squallFired = false;
  private activeGust: Gust | null = null;
  private activeGustArmedAt = -1;
  private activeSalt: SaltDrop | null = null;
  private activeSaltArmedAt = -1;
  private squallArmedAt = -1;
  private gustLateralVelocity = 0;
  private gustTelegraphLatched = false;

  private gustCount = 0;
  private gustSecondsTotal = 0;
  private gustPeakPush = 0;
  private gustLateralMetres = 0;
  private readonly telegraphLeads: number[] = [];
  private saltCount = 0;
  private saltPatchSecondsTotal = 0;
  private readonly saltWarningLeads: number[] = [];
  private squallCount = 0;
  private squallSecondsTotal = 0;
  private squallStartLap = 0;
  private squallStartMs = 0;

  constructor(
    private readonly course: RaceCourse,
    private readonly totalLaps: number,
    private readonly seed: number,
  ) {
    // `?events=0` is the A side of every acceptance comparison in this phase:
    // the schedule is empty, nothing publishes, nothing is drawn, and the
    // living world keeps its own sawtooth — so the soak has to reproduce the
    // pre-G3 telemetry exactly or the phase changed something it should not
    // have.
    this.enabled = searchParam("events") !== "0";
    this.schedule = this.buildSchedule();
    if (this.enabled && course.kind === "bitterpan") this.buildSaltDecal();
    this.publish();
  }

  private buildSchedule(): ReturnType<typeof buildTrackEventSchedule> {
    if (!this.enabled) {
      return {
        kind: this.course.kind,
        seed: this.seed,
        totalLaps: this.totalLaps,
        gusts: [],
        saltDrops: [],
        squall: null,
      };
    }
    return buildTrackEventSchedule({
      kind: this.course.kind,
      seed: this.seed,
      totalLaps: this.totalLaps,
      courseLengthMeters: this.course.length,
      resolveGustSign: (distance) => this.windSignAt(distance),
    });
  }

  /**
   * Which way the authored 292-degree wind pushes at this station: +1 toward
   * course-right (positive lateral), -1 toward course-left.
   *
   * A compass bearing resolved against the course's OWN right vector, so the
   * wind stays a fixed direction over the pan while the track turns under it.
   * That is the whole reason it is resolved per station rather than authored
   * per gust: a lap that bends 180 degrees has to be pushed the other way on
   * the return leg or it is not a wind, it is a rule.
   */
  private windSignAt(courseDistanceMeters: number): number {
    const radians = (BITTERPAN_WIND_BEARING_DEGREES * Math.PI) / 180;
    // World convention: +X is east, -Z is north, so a bearing theta blows
    // toward (sin theta, 0, -cos theta).
    const windX = Math.sin(radians);
    const windZ = -Math.cos(radians);
    const sample = this.course.sampleAtDistance(courseDistanceMeters);
    return sample.right.x * windX + sample.right.z * windZ >= 0 ? 1 : -1;
  }

  /**
   * The salt patch decal: ONE mesh, one material, one draw call, and only on
   * Bitterpan.
   *
   * Six segments rather than a single quad because the deck under the OCC2 span
   * is not perfectly straight and a flat quad chorded across it would lift off
   * the surface at the ends — visible as a floating slab from the chase camera.
   * Six segments is still one buffer and one draw call.
   */
  private buildSaltDecal(): void {
    const positions = new Float32Array((SALT_DECAL_SEGMENTS + 1) * 2 * 3);
    const indices: number[] = [];
    for (let step = 0; step <= SALT_DECAL_SEGMENTS; step += 1) {
      const distance = SALT_PATCH_FROM_METERS
        + (SALT_PATCH_TO_METERS - SALT_PATCH_FROM_METERS) * (step / SALT_DECAL_SEGMENTS);
      const sample = this.course.sampleAtDistance(distance);
      const half = sample.halfWidth * SALT_DECAL_WIDTH_FRACTION;
      for (const side of [-1, 1]) {
        const offset = (step * 2 + (side < 0 ? 0 : 1)) * 3;
        positions[offset] = sample.position.x
          + sample.right.x * half * side + sample.up.x * SALT_DECAL_LIFT_METERS;
        positions[offset + 1] = sample.position.y
          + sample.right.y * half * side + sample.up.y * SALT_DECAL_LIFT_METERS;
        positions[offset + 2] = sample.position.z
          + sample.right.z * half * side + sample.up.z * SALT_DECAL_LIFT_METERS;
      }
      if (step === 0) continue;
      const a = (step - 1) * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    const material = new THREE.MeshBasicMaterial({
      color: SALT_DECAL_COLOUR,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: true,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = "BP_SALT_DROP_PATCH";
    mesh.frustumCulled = false;
    // Invisible costs nothing: `renderer.info.render.calls` only counts what
    // was submitted, so the +1 draw call is spent for the 6 s a drop is live
    // and for no other frame of the race.
    mesh.visible = false;
    mesh.renderOrder = 2;
    this.saltDecal = mesh;
    this.saltDecalMaterial = material;
    this.group.add(mesh);
  }

  reset(): void {
    this.raceSeconds = 0;
    this.nextGustIndex = 0;
    this.nextSaltIndex = 0;
    this.squallArmed = false;
    this.squallFired = false;
    this.activeGust = null;
    this.activeGustArmedAt = -1;
    this.activeSalt = null;
    this.activeSaltArmedAt = -1;
    this.squallArmedAt = -1;
    this.gustLateralVelocity = 0;
    this.gustTelegraphLatched = false;
    scudCrossingSeconds = -1;
    published.scudDriven = false;
    published.lastEvent = "";
    this.publish();
  }

  resetDiagnostics(): void {
    this.gustCount = 0;
    this.gustSecondsTotal = 0;
    this.gustPeakPush = 0;
    this.gustLateralMetres = 0;
    this.telegraphLeads.length = 0;
    this.saltCount = 0;
    this.saltPatchSecondsTotal = 0;
    this.saltWarningLeads.length = 0;
    this.squallCount = 0;
    this.squallSecondsTotal = 0;
    this.squallStartLap = 0;
    this.squallStartMs = 0;
  }

  /**
   * One physics step.
   *
   * Called from `updateRace` after the move is projected and BEFORE the air
   * cushion and the apron clamp, for the same reason the cushion is: the deck
   * edge has to win. A gust asks for a lateral, the clamp refuses whatever
   * leaves the deck, and the craft is held at the limit exactly as it is
   * against steering input.
   *
   * @returns true when the gust moved the lateral and the caller must rebuild
   *   the world position from the projection.
   */
  step(
    deltaSeconds: number,
    playerRaceDistanceMeters: number,
    courseDistanceMeters: number,
    lap: number,
    pose: TrackEventPose,
    diagnosticsMode: boolean,
  ): boolean {
    if (!this.enabled) return false;
    this.raceSeconds += deltaSeconds;
    published.scudDriven = this.schedule.gusts.length > 0;
    this.armEvents(playerRaceDistanceMeters, lap, diagnosticsMode);
    this.expireEvents(diagnosticsMode);
    published.courseDistanceMeters = courseDistanceMeters;
    this.publish();
    this.updateSaltDecal();
    if (diagnosticsMode) {
      if (published.gust > 0) this.gustSecondsTotal += deltaSeconds;
      if (published.saltLive > 0) this.saltPatchSecondsTotal += deltaSeconds;
      if (published.squall > 0) this.squallSecondsTotal += deltaSeconds;
      this.gustPeakPush = Math.max(
        this.gustPeakPush,
        Math.abs(published.gust * GUST_PEAK_CEILING_MPS2),
      );
    }
    return this.stepGustLateral(pose, deltaSeconds, diagnosticsMode);
  }

  /**
   * The gust's lateral push, integrated onto the player's lateral.
   *
   * `integrateGustVelocity` is a DAMPED first-order lag rather than the
   * cushion's free integration — see the note on it in physics.js. The reason
   * is arithmetic: 2.4 m/s^2 held undamped across a 4 s envelope is more than
   * ten metres of sideways travel, which would take the craft off a 23 m deck
   * whatever the driver did. Damped, the same push settles at
   * `2.4 * 0.35 = 0.84 m/s` and carries the craft about 2 m over a gust, which
   * is a correction the driver makes rather than a fault they suffer.
   */
  private stepGustLateral(
    pose: TrackEventPose,
    deltaSeconds: number,
    diagnosticsMode: boolean,
  ): boolean {
    const push = published.gust * GUST_PEAK_CEILING_MPS2 * published.gustSign;
    const previous = this.gustLateralVelocity;
    this.gustLateralVelocity = integrateGustVelocity(previous, push, deltaSeconds);
    if (this.gustLateralVelocity === 0) return false;
    const travel = this.gustLateralVelocity * deltaSeconds;
    pose.lateralMeters += travel;
    if (diagnosticsMode) this.gustLateralMetres += Math.abs(travel);
    return true;
  }

  private armEvents(
    playerRaceDistanceMeters: number,
    lap: number,
    diagnosticsMode: boolean,
  ): void {
    while (
      this.nextGustIndex < this.schedule.gusts.length
      && playerRaceDistanceMeters >= this.schedule.gusts[this.nextGustIndex].armDistanceMeters
    ) {
      const gust = this.schedule.gusts[this.nextGustIndex];
      this.nextGustIndex += 1;
      // A gust that armed while another was still running REPLACES it rather
      // than summing with it. Summing is how a 2.4 m/s^2 ceiling quietly
      // becomes 4.8: the open sectors are 1550 m and six 4 s gusts a lap do
      // overlap, so this is the common case and not the corner one.
      this.activeGust = gust;
      this.activeGustArmedAt = this.raceSeconds;
      this.gustTelegraphLatched = false;
      scudCrossingSeconds = -1;
      published.lastEvent = "gust";
      if (diagnosticsMode) this.gustCount += 1;
    }
    while (
      this.nextSaltIndex < this.schedule.saltDrops.length
      && playerRaceDistanceMeters
        >= this.schedule.saltDrops[this.nextSaltIndex].armDistanceMeters
    ) {
      this.activeSalt = this.schedule.saltDrops[this.nextSaltIndex];
      this.activeSaltArmedAt = this.raceSeconds;
      this.nextSaltIndex += 1;
      published.lastEvent = "salt";
      if (diagnosticsMode) {
        this.saltCount += 1;
        this.saltWarningLeads.push(SALT_WARNING_SECONDS);
      }
    }
    const squall = this.schedule.squall;
    if (
      squall && !this.squallFired
      && playerRaceDistanceMeters >= squall.armDistanceMeters
    ) {
      this.squallFired = true;
      this.squallArmed = true;
      this.squallArmedAt = this.raceSeconds;
      published.lastEvent = "squall";
      if (diagnosticsMode) {
        this.squallCount += 1;
        this.squallStartLap = lap;
        this.squallStartMs = Math.round(this.raceSeconds * 1000);
      }
    }
  }

  private expireEvents(diagnosticsMode: boolean): void {
    if (this.activeGust) {
      const t = this.raceSeconds - this.activeGustArmedAt;
      // The telegraph lead is latched at the HOLD, from the crossing the card
      // system actually reported — not from the schedule that asked for it.
      if (
        diagnosticsMode && !this.gustTelegraphLatched && t >= GUST_HOLD_START_SECONDS
      ) {
        this.gustTelegraphLatched = true;
        if (scudCrossingSeconds >= 0) {
          this.telegraphLeads.push(
            Number((GUST_HOLD_START_SECONDS - scudCrossingSeconds).toFixed(3)),
          );
        }
      }
      if (t > GUST_END_SECONDS) this.activeGust = null;
    }
    if (
      this.activeSalt
      && this.raceSeconds - this.activeSaltArmedAt
        > SALT_WARNING_SECONDS + SALT_PATCH_SECONDS
    ) this.activeSalt = null;
    if (this.squallArmed && this.raceSeconds - this.squallArmedAt > SQUALL_SECONDS) {
      this.squallArmed = false;
    }
  }

  private publish(): void {
    const gustSeconds = this.activeGust ? this.raceSeconds - this.activeGustArmedAt : -1;
    const gustLevel = this.activeGust ? gustEnvelope(gustSeconds) : 0;
    published.gustSeconds = gustSeconds;
    // Published as a share of the CEILING, not of this gust's own peak, so the
    // number an audio bed or the HUD reads means the same thing on lap 1 and on
    // lap 5 — the tension arc is supposed to be audible, not normalised away.
    published.gust = this.activeGust
      ? gustLevel * this.activeGust.peakMetersPerSecondSquared / GUST_PEAK_CEILING_MPS2
      : 0;
    published.gustSign = this.activeGust && gustLevel > 0 ? this.activeGust.sign : 0;

    const saltSeconds = this.activeSalt ? this.raceSeconds - this.activeSaltArmedAt : -1;
    const dropSeconds = saltSeconds - SALT_WARNING_SECONDS;
    published.saltWarn = this.activeSalt && saltSeconds >= 0 ? 1 : 0;
    published.saltLive = dropSeconds >= 0 && dropSeconds <= SALT_PATCH_SECONDS ? 1 : 0;
    published.saltPatch = saltPatchAlpha(dropSeconds);

    published.squall = this.squallArmed
      ? squallEnvelope(this.raceSeconds - this.squallArmedAt)
      : 0;

    published.chip = this.resolveChip(gustSeconds);
  }

  /**
   * The HUD chip, in the SLIPSTREAM chip's language: one short uppercase word
   * that is on screen only while it means something.
   *
   * The gust chip leads the hold by GUST_CHIP_LEAD_SECONDS and carries an arrow
   * because the direction is the actionable half — "wind" tells the driver
   * nothing they cannot feel a beat later, "wind from the left" tells them
   * which way to lean before it arrives.
   */
  private resolveChip(gustSeconds: number): string {
    if (published.saltWarn > 0) return "SALT";
    if (published.squall > 0) return "SQUALL";
    if (
      this.activeGust
      && gustSeconds >= GUST_HOLD_START_SECONDS - GUST_CHIP_LEAD_SECONDS
      && gustSeconds <= GUST_END_SECONDS
    ) return this.activeGust.sign > 0 ? "GUST →" : "GUST ←";
    return "";
  }

  private updateSaltDecal(): void {
    if (!this.saltDecal || !this.saltDecalMaterial) return;
    const alpha = published.saltPatch * SALT_DECAL_PEAK_ALPHA;
    this.saltDecal.visible = alpha > 0.002;
    this.saltDecalMaterial.opacity = alpha;
  }

  /**
   * The grip an event is asking for at this place, for the race loop's single
   * call to `resolveTargetSurfaceGrip`.
   *
   * Read at the CURRENT progress each step rather than latched by `step`, so
   * the grip the physics integrates and the place the craft is in cannot drift
   * apart by a frame at the patch edge.
   */
  surfaceGripMultiplier(courseDistanceMeters: number): number {
    if (!this.enabled) return 1;
    return eventSurfaceGrip(courseDistanceMeters, published.saltLive, published.squall);
  }

  /** The HUD chip label for this frame. */
  get chipLabel(): string {
    return published.chip;
  }

  diagnostics(): TrackEventDiagnostics {
    return {
      trackEventsEnabled: this.enabled,
      gusts: this.gustCount,
      gustSeconds: Number(this.gustSecondsTotal.toFixed(2)),
      // The acceptance number: the hardest instantaneous push any gust reached,
      // in m/s^2, taken from the published level rather than from the schedule.
      gustPeakPush: Number(this.gustPeakPush.toFixed(3)),
      // What the gusts actually MOVED the craft, summed. `gustSeconds` says the
      // wind blew and `gustPeakPush` says how hard at its best instant; neither
      // says the craft ended up anywhere else, and a damped integrator that
      // never spins up would read healthy on both.
      gustLateralMetres: Number(this.gustLateralMetres.toFixed(3)),
      // Seconds between a crossing card reaching the centreline and the hold
      // starting, one entry per gust, latched from the card system's own
      // crossing report. The telegraph acceptance band is 0.8-1.6 s.
      gustTelegraphLeads: this.telegraphLeads,
      gustNow: Number(published.gust.toFixed(3)),
      saltDrops: this.saltCount,
      saltPatchSeconds: Number(this.saltPatchSecondsTotal.toFixed(2)),
      saltWarningLeads: this.saltWarningLeads,
      saltNow: Number(published.saltPatch.toFixed(3)),
      squalls: this.squallCount,
      squallSeconds: Number(this.squallSecondsTotal.toFixed(2)),
      squallStartLap: this.squallStartLap,
      squallStartMs: this.squallStartMs,
      squallNow: Number(published.squall.toFixed(3)),
      trackEventChip: published.chip,
      // The authored schedule itself, so a soak line can be argued with rather
      // than only counted: [lap, station m, wind sign, peak m/s^2] per gust,
      // the laps the conveyor drops on, and the squall's lap and station.
      trackEventSchedule: this.scheduleDigest(),
    };
  }

  /** The authored schedule, for the soak harness and the validator. */
  scheduleDigest(): string {
    return JSON.stringify({
      gusts: this.schedule.gusts.map((gust) => [
        gust.lap,
        Math.round(gust.courseDistanceMeters),
        gust.sign,
        gust.peakMetersPerSecondSquared,
      ]),
      salt: this.schedule.saltDrops.map((drop) => drop.lap),
      squall: this.schedule.squall
        ? [this.schedule.squall.lap, Math.round(this.schedule.squall.courseDistanceMeters)]
        : null,
    });
  }
}
