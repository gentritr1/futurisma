import type * as THREE from "three";
import type { RaceCourse } from "./course";
import type { RaceEffects } from "./effects";
import type { EngineAudio } from "./audio";
import type { InputController } from "./input";
import type { RivalFleet } from "./rivals";
import type { GameUi } from "./ui";
import { BOOST_MAX_SPEED, integrateCushionVelocity } from "./physics";
import {
  cleanGateRegenMultiplier,
  resolveCleanGateChain,
  resolveNearMiss,
} from "./race-rules";

/**
 * G2 — everything that happens when the craft touches, or nearly touches,
 * another body on the deck.
 *
 * The race loop owns speed, position and the course; this owns the three
 * things G2 adds on top of them and the state each needs to persist between
 * steps:
 *
 *   - the AIR CUSHION, a soft lateral spring between the player and a rival,
 *     which needs a lateral velocity of its own because it is an acceleration
 *     and `lateral` is derived from position;
 *   - the NEAR MISS, which needs the pass events the fleet detected and the
 *     coil crossing the course reports, and pays reserve for both;
 *   - the CLEAN-GATE CHAIN, which needs to survive from gate to gate.
 *
 * It exists as a module rather than as another region of `game.ts` because
 * `scripts/validate-module-seams.mjs` caps the race loop, and because these
 * three share exactly one concept - contact, and the reward for coming close
 * to it without making it - while sharing nothing with the driving model.
 *
 * The cues live here too. A near miss is a flash plus a tone plus a pad pulse,
 * and splitting the decision from its feedback across a module boundary is how
 * a reward ends up paying silently.
 */

/** The two race-loop values the cushion is allowed to move. Mutated in place. */
export interface ContactPose {
  lateralMeters: number;
  speedMetersPerSecond: number;
}

/**
 * Spark strength on first cushion contact.
 *
 * A wall impact runs at 0.88-1.0 and a cashed drift at 0.22. A lean sits below
 * the drift on purpose: it fires whenever two craft touch, and a full impact
 * burst every time would read as a crash the player did not have.
 */
const CUSHION_SPARK_STRENGTH = 0.16;
/** How long the contact glow holds after the cushion releases, milliseconds. */
const CUSHION_GLOW_HOLD_MS = 260;

export interface RacingContactDiagnostics {
  cushionTravelMeters: number;
  cushionLongestContactSeconds: number;
  sparkBursts: number;
  nearMisses: number;
  hazardNearMisses: number;
  nearMissReward: number;
  cushionRewardBlocked: number;
  nearMissLocations: readonly string[];
  peakCleanGateChain: number;
  cleanGateChain: number;
}

export class RacingContact {
  /**
   * The cushion's own lateral velocity. Without one there is no honest way to
   * spend an m/s^2 on a position-derived lateral: a faked per-step
   * displacement would be rate dependent, which is the one thing every other
   * integrator in this game is pinned against.
   */
  private cushionLateralVelocity = 0;
  /** The player's lateral last step, for the cushion's closing-speed term. */
  private previousLateral = 0;
  private contactActive = false;
  private glowSide: "LEFT" | "RIGHT" | null = null;
  private glowUntilMs = 0;
  private chain = 0;
  private nearMisses = 0;
  private hazardNearMisses = 0;
  private nearMissReward = 0;
  private rewardBlocked = 0;
  private peakChain = 0;
  private sparkBursts = 0;
  /**
   * How far the cushion has actually moved the craft, summed over the race.
   *
   * The direct answer to "did the cushion do anything", and the one number that
   * cannot be argued with: `cushionSeconds` says the envelope was entered,
   * `cushionPeakPush` says how hard it pushed at its best instant, and neither
   * tells you whether the craft ended up anywhere else. A contact short enough
   * that the damped integrator never spins up moves the craft by centimetres
   * while both of those read healthy.
   */
  private cushionTravelMeters = 0;
  private longestContactSeconds = 0;
  private currentContactSeconds = 0;
  private readonly locations: string[] = [];

  constructor(
    private readonly ui: GameUi,
    private readonly audio: EngineAudio,
    private readonly input: InputController,
    private readonly effects: RaceEffects,
  ) {}

  reset(): void {
    this.cushionLateralVelocity = 0;
    this.previousLateral = 0;
    this.contactActive = false;
    this.glowSide = null;
    this.glowUntilMs = 0;
    this.chain = 0;
  }

  resetDiagnostics(): void {
    this.nearMisses = 0;
    this.hazardNearMisses = 0;
    this.nearMissReward = 0;
    this.rewardBlocked = 0;
    this.peakChain = 0;
    this.sparkBursts = 0;
    this.cushionTravelMeters = 0;
    this.longestContactSeconds = 0;
    this.currentContactSeconds = 0;
    this.locations.length = 0;
  }

  /** Consecutive gates taken inside the clean band. */
  get cleanGateChain(): number {
    return this.chain;
  }

  /** The passive-regen multiplier that chain currently pays. */
  get regenMultiplier(): number {
    return cleanGateRegenMultiplier(this.chain);
  }

  /** Which edge the HUD glow lights, or null once the hold has expired. */
  glowAt(elapsedMs: number): "LEFT" | "RIGHT" | null {
    return elapsedMs < this.glowUntilMs ? this.glowSide : null;
  }

  diagnostics(): RacingContactDiagnostics {
    return {
      cushionTravelMeters: Number(this.cushionTravelMeters.toFixed(3)),
      cushionLongestContactSeconds: Number(this.longestContactSeconds.toFixed(3)),
      sparkBursts: this.sparkBursts,
      nearMisses: this.nearMisses,
      hazardNearMisses: this.hazardNearMisses,
      nearMissReward: Number(this.nearMissReward.toFixed(3)),
      // The honesty half of the near miss: passes made INSIDE the cushion,
      // which pay nothing. A soak where every pass is a near miss has a band
      // that is too wide.
      cushionRewardBlocked: this.rewardBlocked,
      nearMissLocations: this.locations,
      peakCleanGateChain: this.peakChain,
      cleanGateChain: this.chain,
    };
  }

  /**
   * The air cushion, applied to the PLAYER only.
   *
   * Called from `updateRace` immediately after the move is projected and
   * BEFORE the apron clamp, so a lean can never push the craft through an
   * authored boundary: the deck edge still wins, exactly as it does against
   * steering input.
   *
   * The rival is not moved here at all. Its half of the contact is a lateral
   * request to the lane solver, made by the fleet on its next step - see
   * RIVAL_CUSHION_YIELD_METERS.
   *
   * @returns true when the lateral moved and the caller must rebuild the world
   *   position from the projection.
   */
  stepCushion(
    fleet: RivalFleet | null,
    pose: ContactPose,
    raceDistanceMeters: number,
    deltaSeconds: number,
    elapsedMs: number,
    projection: ReturnType<RaceCourse["project"]>,
    position: THREE.Vector3,
  ): boolean {
    const lateralSpeed = deltaSeconds > 0
      ? (pose.lateralMeters - this.previousLateral) / deltaSeconds
      : 0;
    this.previousLateral = pose.lateralMeters;
    const cushion = fleet?.resolveCushion(
      raceDistanceMeters,
      pose.lateralMeters,
      lateralSpeed,
      deltaSeconds,
    );
    this.cushionLateralVelocity = integrateCushionVelocity(
      this.cushionLateralVelocity,
      cushion?.lateralPush ?? 0,
      deltaSeconds,
    );
    const moved = this.cushionLateralVelocity !== 0;
    if (moved) {
      const travel = this.cushionLateralVelocity * deltaSeconds;
      pose.lateralMeters += travel;
      this.cushionTravelMeters += Math.abs(travel);
    }
    if (cushion && cushion.speedScrub > 0) {
      // A share of CURRENT speed per second, so the cost of leaning scales with
      // how fast the lean was worth making. Linear in delta, so 60 Hz and
      // 120 Hz scrub the same over the same contact.
      pose.speedMetersPerSecond = Math.max(
        0,
        pose.speedMetersPerSecond
          - pose.speedMetersPerSecond * cushion.speedScrub * deltaSeconds,
      );
    }
    const active = fleet?.cushionActive ?? false;
    const side = (fleet?.cushionSide ?? 1) >= 0 ? 1 : -1;
    if (active && !this.contactActive) {
      // First contact only, and deliberately NOT through `impactBurst` below:
      // a lean is not an impact, so it must not fire the vehicle's impact flash
      // and must not move the impact-spark telemetry.
      this.effects.emitImpactSparks(
        projection,
        position,
        pose.lateralMeters,
        pose.speedMetersPerSecond,
        side,
        CUSHION_SPARK_STRENGTH,
      );
      this.audio.playImpact(CUSHION_SPARK_STRENGTH);
      this.input.pulse(0.18, 0.26, 90);
    }
    this.currentContactSeconds = active ? this.currentContactSeconds + deltaSeconds : 0;
    this.longestContactSeconds = Math.max(
      this.longestContactSeconds,
      this.currentContactSeconds,
    );
    this.contactActive = active;
    if (active) {
      // The rival sits at higher lateral, so the contact is on the craft's
      // RIGHT and the glow lights that edge.
      this.glowSide = side >= 0 ? "RIGHT" : "LEFT";
      this.glowUntilMs = elapsedMs + CUSHION_GLOW_HOLD_MS;
    } else if (elapsedMs >= this.glowUntilMs) {
      this.glowSide = null;
    }
    return moved;
  }

  /**
   * Scores every pass completed on this step, plus any cable coil the craft
   * just left standing, and returns the reserve it earned.
   *
   * The reward is returned rather than applied, so it joins the drift payout in
   * the race loop's single call to `integrateBoostReserve` and the reserve keeps
   * exactly one place it can be written.
   */
  scorePasses(
    fleet: RivalFleet | null,
    course: RaceCourse,
    previousProgress: number,
    progress: number,
    pose: ContactPose,
    lap: number,
    hazardArmed: boolean,
    diagnosticsMode: boolean,
  ): number {
    let reward = 0;
    const speedRatio = pose.speedMetersPerSecond / BOOST_MAX_SPEED;
    const where = `${Math.round(progress * course.length)}m/L${lap}`;
    const passes = fleet?.passesThisStep ?? 0;
    for (let index = 0; index < passes; index += 1) {
      const gap = fleet?.passLateralGapMeters(index) ?? 0;
      const id = fleet?.passRivalId(index) ?? "";
      const scored = resolveNearMiss(gap, speedRatio);
      if (scored.outcome === "near-miss") {
        reward += scored.reward;
        this.announce(
          `${id.replace("rival-", "").toUpperCase()} · ${Math.abs(gap).toFixed(1)} M`,
          0.2,
        );
        if (diagnosticsMode) {
          this.nearMisses += 1;
          this.nearMissReward += scored.reward;
          this.locations.push(`${id}@${where}/${Math.abs(gap).toFixed(2)}m`);
        }
      } else if (scored.outcome === "contact" && diagnosticsMode) {
        this.rewardBlocked += 1;
      }
    }
    const coilGap = course.cablePassLateralMeters(
      previousProgress,
      progress,
      pose.lateralMeters,
    );
    if (Number.isNaN(coilGap) || !hazardArmed) return reward;
    const scored = resolveNearMiss(coilGap, speedRatio, "hazard");
    if (scored.outcome !== "near-miss") return reward;
    reward += scored.reward;
    this.announce(`CABLE COIL · ${coilGap.toFixed(1)} M`, 0.14);
    if (diagnosticsMode) {
      this.hazardNearMisses += 1;
      this.nearMissReward += scored.reward;
      this.locations.push(`coil@${where}/${coilGap.toFixed(2)}m`);
    }
    return reward;
  }

  /**
   * Advances the clean-gate chain across one gate crossing.
   *
   * Called on EVERY crossing of the armed gate, including the one that misses
   * it, and before any of the race loop's own gate branches return - a lap gate
   * has to score the same way a sector gate does.
   */
  crossGate(
    lateralMeters: number,
    gateHalfWidthMeters: number,
    missed: boolean,
    diagnosticsMode: boolean,
  ): void {
    this.chain = resolveCleanGateChain(this.chain, {
      lateralMeters,
      gateHalfWidthMeters,
      missed,
    }).chain;
    if (diagnosticsMode) this.peakChain = Math.max(this.peakChain, this.chain);
  }

  /**
   * The HARD contact burst: sparks, the vehicle's own impact flash, and the
   * telemetry that counts them.
   *
   * It lives beside the cushion's burst on purpose. The two are the same
   * effect at opposite ends of one scale - a wall at 0.88-1.0 against a lean at
   * CUSHION_SPARK_STRENGTH - and the difference that matters (a lean never
   * fires the vehicle flash and never moves `sparkBursts`) is only obvious
   * when both are written in one place.
   */
  impactBurst(
    vehicle: { triggerImpactEffect(side: number, strength: number): void },
    projection: ReturnType<RaceCourse["project"]>,
    position: THREE.Vector3,
    lateralMeters: number,
    speedMetersPerSecond: number,
    side: number,
    strength: number,
    diagnosticsMode: boolean,
  ): void {
    this.effects.emitImpactSparks(
      projection, position, lateralMeters, speedMetersPerSecond, side, strength,
    );
    vehicle.triggerImpactEffect(side, strength);
    if (diagnosticsMode) this.sparkBursts += 1;
  }

  private announce(detail: string, pulseStrength: number): void {
    this.ui.flashRaceEvent("NEAR MISS", detail);
    this.audio.playNearMiss();
    this.input.pulse(pulseStrength, 0.13, 78);
  }
}
