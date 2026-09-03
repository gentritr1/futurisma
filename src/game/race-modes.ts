/**
 * G4 — the race format's impure half: the lines `game.ts` cannot afford.
 *
 * `src/game/race-modes-rules.js` owns every decision (which lap count, which
 * pace table, what a delta is and how it prints) and runs under Node.
 * This module is the adapter, and it owns exactly four things the rules cannot:
 * the course's gate distances, the split table for the lap in progress, the two
 * HUD elements the deltas live on, and the save file. `game.ts` sits against a
 * hard seam budget, so everything that could live here does — the race loop
 * keeps six call sites and no state.
 *
 * A module singleton, for the same reason `save` and `ghostRuntime` are: it
 * lets the race loop reach it in one line rather than carrying a field, and
 * {@link RaceModes.attach} resets every piece of state so a second `Game` over
 * the same module starts clean.
 *
 * **Recording cannot perturb the race.** Nothing here writes a simulation
 * value and no method returns anything the fixed step branches on. It reads a
 * clock and a distance, pushes a number into an array on a gate crossing, and
 * writes text into two spans. That is the whole contract, and it is why the
 * `race` soak's lap times have to come back bit-identical with G4 in.
 */
import type { RaceCourse } from "./course";
import { save } from "./persistence";
import { resolveRaceMode, resolveRivalTier } from "./query-probes";
import {
  LIVE_DELTA_INTERVAL_MS,
  applyPaceTier,
  bestRecordKey,
  deltaTone,
  formatDeltaSeconds,
  ghostRecordKey,
  liveDeltaMs,
  modeFieldSize,
  modeHasField,
  modeReversesGrid,
  sectorDeltaMs,
  type GateSplitCurve,
  type RaceMode,
  type RivalTier,
} from "./race-modes-rules.js";
import type { GameUi } from "./ui";

/** What the result screen prints under the classification. */
export interface RaceResultSummary {
  /** This mode and tier's own record fell. Drives the `NEW BEST` flash. */
  newBestLap: boolean;
  /** The lap the record was before this race, or null on a first visit. */
  previousBestLapMs: number | null;
  bestLapMs: number | null;
  nearMisses: number;
  cleanGateChain: number;
  slipstreamSeconds: number;
  topSpeedKph: number;
  mode: RaceMode;
  tier: RivalTier;
}

/** The subsystem read-outs the result screen's stats are composed from. */
export interface RaceResultInputs {
  contact: { nearMisses: number; peakCleanGateChain: number };
  rivals: { slipstreamSeconds: number } | undefined;
  topSpeedMetersPerSecond: number;
}

class RaceModes {
  /** Resolved once, at module evaluation, and then constant for the page. */
  readonly mode: RaceMode = resolveRaceMode();
  readonly tier: RivalTier = resolveRivalTier();

  private ui: GameUi | null = null;
  private mapCode = "";
  /** Lap distance of each timed gate, ascending; empty when unusable. */
  private gateMeters: readonly number[] = [];
  private lapLengthMeters = 0;
  private startProgress = 0;
  /** Splits for the lap in progress. */
  private readonly lapSplitsMs: number[] = [];
  /** Splits of the fastest lap of THIS race, held until the result stores it. */
  private bestOfRaceSplitsMs: number[] = [];
  private bestOfRaceMs: number | null = null;
  /** The stored best lap this race is measured against; null on a first visit. */
  private reference: GateSplitCurve | null = null;
  private nextLiveDeltaAtMs = -Infinity;
  private lastLiveLabel = "";
  /**
   * G4 — what the two delta readouts actually printed, for the soak harness.
   *
   * The chips are the whole point of the phase and they are also the part a
   * headless run cannot see, so the values are recorded as they are written
   * rather than reconstructed afterwards from the splits. A soak that reported
   * "the deltas were computed" would be reporting the model; this reports the
   * strings that reached the DOM.
   */
  private readonly flashedDeltas: string[] = [];
  private liveLabel = "";

  /** Whether this format spawns the field at all. */
  get hasField(): boolean {
    return modeHasField(this.mode);
  }

  /** Classified craft, so `fieldSize` reports 1 in a solo time attack. */
  fieldSize(rivalCount: number): number {
    return modeFieldSize(this.mode, rivalCount);
  }

  /** Whether the field's grid order is reversed; see `reverseGridOrder`. */
  get reversesGrid(): boolean {
    return modeReversesGrid(this.mode);
  }

  /** The record slot this race writes to, and the chip reads from. */
  get recordKey(): string {
    return bestRecordKey(this.mode, this.tier);
  }

  /** The ghost slot this race replays from and stores to. */
  get ghostKey(): string {
    return ghostRecordKey(this.mode);
  }

  /** The pace table the field drives, resolved from the map's authored block. */
  paceFor(pace: object | null | undefined): object | null | undefined {
    return applyPaceTier(pace, this.tier);
  }

  /**
   * Binds the course and the HUD, and derives the gate distances the whole
   * delta system is measured against.
   *
   * The distances are derived from `checkpointProgress` rather than authored,
   * because a split that did not agree with the gate the player actually
   * crossed would be measuring one thing and printing another. Gate 0 is the
   * lap line and is deliberately excluded: it is the lap's own time, which
   * closes the curve rather than sitting inside it.
   *
   * A course whose gates do not come out strictly ascending disables splits
   * entirely rather than storing a table nothing can interpolate. That is a
   * defensive branch, not an expected one — both shipped circuits are ordered —
   * and it fails to "no deltas" rather than to "wrong deltas".
   */
  attach(course: RaceCourse, ui: GameUi): void {
    this.ui = ui;
    this.mapCode = course.mapCode;
    this.lapLengthMeters = course.length;
    this.startProgress = course.startProgress;
    const gates: number[] = [];
    for (let index = 1; index <= course.checkpointCount; index += 1) {
      const progress = course.checkpointProgress(index);
      const fromStart = ((progress - course.startProgress) % 1 + 1) % 1;
      gates.push(fromStart * course.length);
    }
    const ascending = gates.every(
      (metres, index) => metres > 0
        && metres < course.length
        && (index === 0 || metres > gates[index - 1]),
    );
    this.gateMeters = ascending ? gates : [];
    this.reset();
  }

  /**
   * Race reset. Loads the record this race is measured against and throws away
   * whatever the previous run recorded.
   */
  reset(): void {
    this.lapSplitsMs.length = 0;
    this.bestOfRaceSplitsMs = [];
    this.bestOfRaceMs = null;
    this.nextLiveDeltaAtMs = -Infinity;
    this.lastLiveLabel = "";
    this.flashedDeltas.length = 0;
    this.liveLabel = "";
    const stored = save.bestFor(this.mapCode, this.recordKey);
    // A stored time with no splits is a real record with nothing to interpolate
    // — every migrated v2 best arrives that way — so the per-gate flash and the
    // live chip both fall back to `—` while `NEW BEST` still has a bar to clear.
    this.reference = stored.bestLapMs !== null
      && stored.gateSplitsMs.length === this.gateMeters.length
      && this.gateMeters.length > 0
      ? {
        gateMeters: this.gateMeters,
        splitsMs: stored.gateSplitsMs,
        lapMs: stored.bestLapMs,
        lapLengthMeters: this.lapLengthMeters,
      }
      : null;
    this.ui?.setLiveDelta(this.mode === "timeattack" ? "—" : null, "none");
  }

  /**
   * A timed gate was taken cleanly. Records the split and flashes its delta.
   *
   * `gateIndex` is the gate that was just cleared, 1-based, so it indexes the
   * distance table one lower. Out-of-order crossings cannot reach here — the
   * race loop only advances `nextCheckpointIndex` on a clean crossing — but the
   * bounds are still checked, because a course that changed its gate count
   * between a stored lap and this one would otherwise write a split into a slot
   * that means something else.
   */
  crossGate(gateIndex: number, lapElapsedMs: number): void {
    if (this.gateMeters.length === 0) return;
    if (gateIndex < 1 || gateIndex > this.gateMeters.length) return;
    if (this.lapSplitsMs.length !== gateIndex - 1) return;
    this.lapSplitsMs.push(Math.round(lapElapsedMs));
    const delta = sectorDeltaMs(
      lapElapsedMs,
      this.reference?.splitsMs[gateIndex - 1] ?? null,
    );
    if (delta === null) return;
    const label = formatDeltaSeconds(delta);
    // Separated, because `G1` + `0.00` reads as `G10.00` without it and a soak
    // log that cannot be parsed unambiguously is not evidence.
    this.flashedDeltas.push(`G${gateIndex}:${label}`);
    this.ui?.flashSectorDelta(label, deltaTone(delta));
  }

  /**
   * A lap closed. Keeps its splits if it is the fastest of this race.
   *
   * Called on every lap boundary INCLUDING the one that ends the race, from the
   * same place the lap time is pushed, so the final lap's splits are never the
   * ones left open in the buffer. Same reason `ghostRuntime.bestLapRecording`
   * takes the final lap's time rather than deriving it.
   */
  closeLap(lapMs: number): void {
    if (
      this.lapSplitsMs.length === this.gateMeters.length
      && this.gateMeters.length > 0
      && (this.bestOfRaceMs === null || lapMs < this.bestOfRaceMs)
    ) {
      this.bestOfRaceMs = lapMs;
      this.bestOfRaceSplitsMs = [...this.lapSplitsMs];
    }
    this.lapSplitsMs.length = 0;
    this.nextLiveDeltaAtMs = -Infinity;
  }

  /**
   * The live delta chip, held to {@link LIVE_DELTA_INTERVAL_MS}.
   *
   * Time attack only. In a field race the gate flashes already say where the
   * lap stands and a second permanent number beside the position ladder would
   * be the busy HUD chrome PRODUCT.md's anti-references rule out; alone against
   * a clock, it is the only opponent there is.
   *
   * Takes the race loop's own three numbers rather than a lap time and a lap
   * distance, so the conversion into both lives here beside the curve they are
   * measured against — `game.ts` pays one line for this and no arithmetic.
   * `elapsedMs` doubles as the clock the 4 Hz gate is held against, which is
   * deliberate: it is the race's clock, so a paused race does not tick toward
   * the next repaint.
   */
  updateLiveDelta(elapsedMs: number, lapStartElapsedMs: number, progress: number): void {
    if (this.mode !== "timeattack" || !this.ui) return;
    if (elapsedMs < this.nextLiveDeltaAtMs) return;
    this.nextLiveDeltaAtMs = elapsedMs + LIVE_DELTA_INTERVAL_MS;
    const lapMeters = (((progress - this.startProgress) % 1) + 1) % 1 * this.lapLengthMeters;
    const delta = liveDeltaMs(elapsedMs - lapStartElapsedMs, lapMeters, this.reference);
    const label = formatDeltaSeconds(delta);
    if (label === this.lastLiveLabel) return;
    this.lastLiveLabel = label;
    this.liveLabel = label;
    this.ui.setLiveDelta(label, deltaTone(delta));
  }

  /**
   * G4 — what the format is and what its two readouts printed.
   *
   * Contributed straight into `buildDiagnosticsReport` beside
   * `persistenceDiagnostics()`, which is the same shape and there for the same
   * reason: the race loop already sits on its seam budget, and neither of these
   * is anything the race loop owns.
   *
   * `raceMode` and `rivalTier` are the RESOLVED values — what this page load is
   * actually racing — as against `storedFormat` and `storedTier`, which are what
   * the save file holds. A `?mode=` override makes the two differ, and a soak
   * that could not tell them apart would be unable to prove the override
   * reached the race at all.
   */
  diagnostics(): {
    raceMode: string;
    rivalTier: string;
    raceModeBestLapMs: number | null;
    raceModeGateSplitsMs: readonly number[];
    sectorDeltas: readonly string[];
    liveDelta: string;
  } {
    return {
      raceMode: this.mode,
      rivalTier: this.tier,
      raceModeBestLapMs: this.reference?.lapMs ?? null,
      raceModeGateSplitsMs: this.reference?.splitsMs ?? [],
      sectorDeltas: this.flashedDeltas,
      liveDelta: this.liveLabel,
    };
  }

  /**
   * Folds a finished race into the save file and composes the result screen's
   * stats.
   *
   * The `NEW BEST` flash, the stored time, the stored splits and the stored
   * ghost are all decided by ONE comparison inside `applyRaceResult`, which is
   * P7's rule carried forward: the flash and the file can never disagree
   * because there is nothing for them to disagree about.
   *
   * `ghost` is offered rather than stored — `applyRaceResult` keeps it only
   * when the mode record actually fell.
   */
  recordFinish(
    bestLapMs: number | null,
    raceMs: number,
    lapTimesMs: readonly number[],
    ghost: unknown,
    inputs: RaceResultInputs,
  ): RaceResultSummary {
    const applied = save.recordRace(this.mapCode, {
      bestLapMs,
      raceMs,
      laps: lapTimesMs.length,
      ghost,
      modeKey: this.recordKey,
      ghostKey: this.ghostKey,
      gateSplitsMs: this.bestOfRaceSplitsMs,
    });
    return {
      newBestLap: applied.newBestLap,
      previousBestLapMs: applied.previousBestLapMs,
      bestLapMs,
      nearMisses: inputs.contact.nearMisses,
      cleanGateChain: inputs.contact.peakCleanGateChain,
      slipstreamSeconds: inputs.rivals?.slipstreamSeconds ?? 0,
      topSpeedKph: inputs.topSpeedMetersPerSecond * 3.6,
      mode: this.mode,
      tier: this.tier,
    };
  }
}

export const raceModes = new RaceModes();
