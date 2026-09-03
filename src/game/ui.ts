import {
  formatRaceGap,
  formatRacePosition,
  resolveBoostPresentation,
  resolveFinishPresentation,
  resolveInitialRacePresentation,
  resolveRaceStage,
} from "./hud-presentation.js";
import { DRIFT_REWARD_MINIMUM_CHARGE, SLIPSTREAM_LOCK_THRESHOLD } from "./physics";
import { resolveReducedMotion } from "./query-probes";

/**
 * G2 round 2 - where the contact glow steps from a brush to a firm lean.
 * Roughly 40% of CUSHION_PEAK_PUSH_MPS2: below it the cushion is grazing, above
 * it the craft is genuinely being moved.
 */
const CUSHION_FIRM_PUSH_MPS2 = 6;

/**
 * P20.10 — puts the COMPOSED reduced-motion answer where CSS can read it.
 *
 * `@media (prefers-reduced-motion: reduce)` sees only the operating system.
 * `resolveReducedMotion()` composes that with `?motion=reduce` and with the
 * stored setting, and the composition rule is "the most restrictive input
 * wins" — so a driver who ticked the box in the options panel was still being
 * shown a chip that faded in. Stamping the answer on the element is what lets
 * one selector honour all three.
 *
 * Read once, at element resolution, which is the same moment `game.ts` reads
 * it for the world; a mid-session change of the stored setting needs a relink
 * either way.
 */
function markReducedMotion<T extends HTMLElement>(element: T): T {
  element.dataset.reducedMotion = resolveReducedMotion() ? "true" : "false";
  return element;
}

export interface HudFrame {
  speedKph: number;
  boost: number;
  elapsedMs: number;
  lastLapMs: number | null;
  lap: number;
  totalLaps: number;
  progress: number;
  checkpoint: number;
  checkpointCount: number;
  missedGate: number | null;
  finishArmed: boolean;
  raceActive: boolean;
  sector: string;
  finishDistanceMeters: number;
  turnDirection: "LEFT" | "RIGHT" | null;
  turnFollowingDirection: "LEFT" | "RIGHT" | null;
  turnDistanceMeters: number;
  turnHard: boolean;
  turnUrgent: boolean;
  boostActive: boolean;
  boostLocked: boolean;
  driftCharge: number;
  /** G1 - tow strength from the craft ahead, 0..1. */
  slipstream: number;
  /** G2 - which edge the air cushion is pushing from, null when clear. */
  cushionSide: "LEFT" | "RIGHT" | null;
  /** G2 round 2 - how hard, m/s^2, so the glow can read as a lean or a shove. */
  cushionPush: number;
  /**
   * G3 - the live track event chip, or "" when the world is quiet.
   *
   * A LABEL rather than a level, because the HUD's job here is the one word the
   * driver can read at 300 km/h. The 0..1 levels the picture and the physics
   * ride are published by track-events.ts to the layers that need them; the
   * chip only has to say which of the three is happening and, for a gust, which
   * way.
   */
  trackEvent: string;
  /** G2 - consecutive gates taken clean. */
  cleanGateChain: number;
  /** G2 - the passive-regen multiplier that chain is currently paying. */
  cleanGateMultiplier: number;
  braking: boolean;
  drifting: boolean;
  skidsDown: boolean;
  lowGrip: boolean;
  wrongWay: boolean;
  edgeWarning: boolean;
  edgeOpen: boolean;
  edgeCorrection: "LEFT" | "RIGHT" | null;
  recoveryActive: boolean;
  recoveryProgress: number;
  recoverySeconds: number;
  position: number;
  racerCount: number;
  gapToAheadMs: number | null;
  gapToBehindMs: number | null;
}

export interface RaceGridEntry {
  position: number;
  name: string;
  team: string;
  player: boolean;
}

export interface RaceStandingEntry extends RaceGridEntry {
  finishTimeMs: number;
  gapMs: number;
}

export interface FieldOrderEntry {
  position: number;
  name: string;
  player: boolean;
}

export interface RaceCoursePresentation {
  mapName: string;
  mapCode: string;
  checkpointCount: number;
  finishName: string;
  startLabel: string;
}

type PauseReason = "FOCUS LOST" | "GRAPHICS LINK LOST" | "GRAPHICS LINK RESTORED";

function requiredElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing required UI element: #${id}`);
  return element as T;
}

export function formatRaceTime(milliseconds: number): string {
  const safe = Math.max(0, Math.floor(milliseconds));
  const minutes = Math.floor(safe / 60_000);
  const seconds = Math.floor((safe % 60_000) / 1_000);
  const millis = safe % 1_000;
  return `${minutes.toString().padStart(2, "0")}:${seconds
    .toString()
    .padStart(2, "0")}.${millis.toString().padStart(3, "0")}`;
}

export class GameUi {
  readonly startButton = requiredElement<HTMLButtonElement>("start-button");
  readonly restartButton = requiredElement<HTMLButtonElement>("restart-button");
  /** Owned here so DOM lookups stay in the UI module; drawn by `Minimap`. */
  readonly minimapCanvas = requiredElement<HTMLCanvasElement>("minimap");
  private readonly loadingScreen = requiredElement<HTMLElement>("loading-screen");
  private readonly startScreen = requiredElement<HTMLElement>("start-screen");
  private readonly resultScreen = requiredElement<HTMLElement>("result-screen");
  private readonly resultTime = requiredElement<HTMLElement>("result-time");
  private readonly resultDetail = requiredElement<HTMLElement>("result-detail");
  private readonly resultBest = requiredElement<HTMLElement>("result-best");
  private readonly dispatchRecord = requiredElement<HTMLElement>("dispatch-record");
  private readonly resultLaps = requiredElement<HTMLOListElement>("result-laps");
  private readonly gridOrder = requiredElement<HTMLOListElement>("grid-order");
  private readonly fieldOrder = requiredElement<HTMLOListElement>("field-order");
  private readonly introDeck = requiredElement<HTMLElement>("intro-deck");
  private readonly introFooter = requiredElement<HTMLElement>("intro-footer");
  private readonly courseName = requiredElement<HTMLElement>("course-name");
  private readonly systemStatus = requiredElement<HTMLElement>("system-status");
  private readonly speedValue = requiredElement<HTMLElement>("speed-value");
  private readonly driveState = requiredElement<HTMLElement>("drive-state");
  private readonly timeValue = requiredElement<HTMLElement>("time-value");
  private readonly lapValue = requiredElement<HTMLElement>("lap-value");
  private readonly lastLapValue = requiredElement<HTMLElement>("last-lap-value");
  private readonly positionValue = requiredElement<HTMLElement>("position-value");
  private readonly gapValue = requiredElement<HTMLElement>("gap-value");
  private readonly checkpointValue = requiredElement<HTMLElement>("checkpoint-value");
  private readonly sectorValue = requiredElement<HTMLElement>("sector-value");
  private readonly finishValue = requiredElement<HTMLElement>("finish-value");
  private readonly progressFill = requiredElement<HTMLElement>("progress-fill");
  private readonly boostMeter = requiredElement<HTMLElement>("boost-meter");
  private readonly boostLabel = requiredElement<HTMLElement>("boost-label");
  private readonly boostValue = requiredElement<HTMLElement>("boost-value");
  private readonly boostFill = requiredElement<HTMLElement>("boost-fill");
  private readonly driftChargeFill = requiredElement<HTMLElement>("drift-charge");
  private readonly slipstreamChip = requiredElement<HTMLElement>("slipstream-chip");
  private readonly slipstreamLabel = requiredElement<HTMLElement>(
    "slipstream-chip",
  ).querySelector<HTMLElement>(".slipstream__label")!;
  private readonly slipstreamFill = requiredElement<HTMLElement>("slipstream-fill");
  private readonly edgeWarning = requiredElement<HTMLElement>("edge-warning");
  private readonly edgeWarningLabel = requiredElement<HTMLElement>("edge-warning-label");
  private readonly edgeWarningFill = requiredElement<HTMLElement>("edge-warning-fill");
  private readonly turnCue = requiredElement<HTMLElement>("turn-cue");
  private readonly turnLabel = requiredElement<HTMLElement>("turn-label");
  private readonly turnArrow = requiredElement<HTMLElement>("turn-arrow");
  private readonly turnDistance = requiredElement<HTMLElement>("turn-distance");
  private readonly lapEvent = requiredElement<HTMLElement>("lap-event");
  private readonly lapEventLabel = requiredElement<HTMLElement>("lap-event-label");
  private readonly lapEventTime = requiredElement<HTMLElement>("lap-event-time");
  private readonly countdown = requiredElement<HTMLElement>("countdown");
  private readonly impactFlash = requiredElement<HTMLElement>("impact-flash");
  /** G2 - the air cushion's edge glow and the clean-gate counter. */
  private readonly cushionGlow = requiredElement<HTMLElement>("cushion-glow");
  /** G3 - the live track event chip. */
  private readonly trackEventChip = markReducedMotion(
    requiredElement<HTMLElement>("track-event-chip"),
  );
  private readonly trackEventLabel = requiredElement<HTMLElement>("track-event-label");
  private lastTrackEvent = "";
  private readonly cleanChain = requiredElement<HTMLElement>("clean-chain");
  private lastCushionState = "";
  private lastCleanChainLabel = "";
  private readonly errorPanel = requiredElement<HTMLElement>("error-panel");
  private readonly errorMessage = requiredElement<HTMLElement>("error-message");
  private lastLapLabel = "";
  private lastLapTimeLabel = "";
  private lastPositionLabel = "";
  private lastGapLabel = "";
  private lastCheckpointLabel = "";
  private lastDriveLabel = "";
  private lastDriveState = "";
  private lastBoostState = "";
  private lastDriftArmed: boolean | null = null;
  private lastSlipstreamState = "";
  private lastEdgeState = "";
  private lastEdgeLabel = "";
  private lastTurnState = "";
  private lastRaceStage = "";
  private hazardLabel = "";
  private hazardUntil = 0;
  private gateFlashUntil = 0;
  private lapEventUntil = 0;
  private impactFlashUntil = 0;
  private systemStatusLabel = "SYSTEM STANDBY";
  private demoAutopilot = false;
  private lastFieldOrderKey = "";
  /** P7 — the issue the player is racing under; drives every label that used
   * to read a hard-coded `WORKS 07`. */
  private playerLiveryLabel = "WORKS 07";
  /** The course half of the intro footer, kept so a livery swap can rebuild it
   * without re-running `setRaceFormat`. */
  private courseFooterLabel = "GREENWATER FIELD RACE";
  private readonly reducedMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches;

  setDemoAutopilot(active: boolean): void {
    this.demoAutopilot = active;
    document.body.dataset.controlMode = active ? "autopilot" : "manual";
    this.setSystemStatus(this.systemStatusLabel);
  }

  setRaceFormat(
    totalLaps: number,
    courseLengthMeters: number,
    grid: readonly RaceGridEntry[] = [],
    course: RaceCoursePresentation = {
      mapName: "Greenwater Strip",
      mapCode: "MAP 01",
      checkpointCount: 8,
      finishName: "The Cradle",
      startLabel: "RUNWAY 09",
    },
  ): void {
    const presentation = resolveInitialRacePresentation(
      totalLaps,
      courseLengthMeters,
    );
    const lapLabel = `${presentation.totalLaps} ${
      presentation.totalLaps === 1 ? "lap" : "laps"
    }`;
    this.introDeck.textContent = course.mapCode === "MAP 01"
      ? `Four ships. ${lapLabel} through Greenwater Strip. Follow the amber turn markers, clear all eight gates, and bring TOTEM home through The Cradle.`
      : `Four ships. ${lapLabel} through ${course.mapName}. Follow the amber turn markers, clear all ${course.checkpointCount} sector gates, and bring TOTEM home through ${course.finishName}.`;
    this.courseName.textContent = `${course.mapName.toUpperCase()} / ${course.mapCode}`;
    this.courseFooterLabel = `${course.mapName.toUpperCase()} FIELD RACE`;
    this.introFooter.textContent = `${this.playerLiveryLabel} · ${this.courseFooterLabel}`;
    document.title = `FUTURISMA · ${course.mapName}`;
    this.checkpointValue.textContent = `NEXT GATE 01 / ${course.checkpointCount
      .toString()
      .padStart(2, "0")}`;
    this.sectorValue.textContent = course.startLabel;
    this.lapValue.textContent = presentation.lapLabel;
    this.finishValue.textContent = presentation.finishLabel;
    this.lastLapValue.hidden = true;
    this.progressFill.style.transform = "scaleX(0)";
    if (grid.length > 0) {
      this.updateGrid(grid);
      this.updateFieldOrder(grid);
    }
  }

  /**
   * P7 — the livery the player is racing under. Rewrites the intro footer, the
   * starting-grid list and the classification line so the whole panel follows
   * the chosen issue instead of naming a works car that is no longer on track.
   */
  setPlayerLivery(label: string, grid: readonly RaceGridEntry[]): void {
    this.playerLiveryLabel = label;
    this.introFooter.textContent = `${label} · ${this.courseFooterLabel}`;
    if (grid.length > 0) {
      this.updateGrid(grid);
      this.updateFieldOrder(grid);
    }
  }

  /**
   * P7 — the stored best lap for the dispatched circuit, shown on the start
   * screen. `null` is a first visit, not an error, and reads as such.
   */
  setStoredBest(bestLapMs: number | null, courseLabel: string): void {
    this.dispatchRecord.textContent = bestLapMs === null
      ? `${courseLabel} · NO CLASSIFIED LAP ON FILE`
      : `${courseLabel} · BEST LAP ${formatRaceTime(bestLapMs)}`;
    this.dispatchRecord.dataset.recorded = bestLapMs === null ? "false" : "true";
  }

  updateFieldOrder(entries: readonly FieldOrderEntry[]): void {
    const key = entries.map((entry) => `${entry.player ? "Y" : "N"}${entry.name}`).join("|");
    if (key === this.lastFieldOrderKey) return;
    this.lastFieldOrderKey = key;
    const fragment = document.createDocumentFragment();
    for (const entry of entries) {
      const row = document.createElement("li");
      const position = document.createElement("span");
      const name = document.createElement("span");
      name.className = "n";
      position.textContent = `P${entry.position}${entry.player ? " · YOU" : ""}`;
      name.textContent = entry.name;
      row.dataset.best = entry.player ? "true" : "false";
      row.append(position, name);
      fragment.append(row);
    }
    this.fieldOrder.replaceChildren(fragment);
  }

  showReady(): void {
    this.loadingScreen.hidden = true;
    this.startScreen.hidden = false;
    this.resultScreen.hidden = true;
    this.setSystemStatus("TOTEM READY");
    document.body.dataset.phase = "intro";
    this.startButton.focus({ preventScroll: true });
  }

  showRace(): void {
    this.loadingScreen.hidden = true;
    this.startScreen.hidden = true;
    this.resultScreen.hidden = true;
    this.countdown.textContent = "3";
    this.countdown.dataset.paused = "false";
    this.edgeWarning.dataset.active = "false";
    this.edgeWarning.dataset.recovery = "false";
    this.edgeWarning.dataset.wrongWay = "false";
    this.edgeWarning.setAttribute("aria-hidden", "true");
    this.turnCue.dataset.active = "false";
    this.turnCue.setAttribute("aria-hidden", "true");
    this.hideLapEvent();
    this.impactFlash.dataset.active = "false";
    // G2 - a cushion contact or a chain in flight must not survive a phase
    // change; both are race state, and the result screen is not a race.
    this.clearRaceEventState();
    this.hazardUntil = 0;
    document.body.dataset.boost = "false";
    this.setSystemStatus("LAUNCH SEQUENCE");
    document.body.dataset.phase = "race";
  }

  showResult(
    elapsedMs: number,
    totalLaps: number,
    bestLapMs: number,
    lapTimesMs: readonly number[],
    position = 1,
    racerCount = 1,
    standings: readonly RaceStandingEntry[] = [],
    newBestLap = false,
  ): void {
    this.resultTime.textContent = formatRaceTime(elapsedMs);
    this.resultDetail.textContent = `${formatRacePosition(position, racerCount)} · TOTEM / ${
      this.playerLiveryLabel
    } · ${totalLaps} ${
      totalLaps === 1 ? "LAP" : "LAPS"
    } LOGGED · BEST ${formatRaceTime(bestLapMs)}`;
    // P7 — the flash and the file are decided by one comparison in the save
    // layer, so a `NEW BEST` that is not on record is impossible.
    this.resultBest.hidden = !newBestLap;
    this.resultBest.dataset.active = newBestLap ? "true" : "false";
    this.updateResultClassification(standings, lapTimesMs, bestLapMs);
    this.resultScreen.hidden = false;
    this.countdown.textContent = "";
    this.countdown.dataset.paused = "false";
    this.edgeWarning.dataset.active = "false";
    this.edgeWarning.dataset.recovery = "false";
    this.edgeWarning.dataset.wrongWay = "false";
    this.edgeWarning.setAttribute("aria-hidden", "true");
    this.turnCue.dataset.active = "false";
    this.turnCue.setAttribute("aria-hidden", "true");
    this.hideLapEvent();
    this.impactFlash.dataset.active = "false";
    // G2 - a cushion contact or a chain in flight must not survive a phase
    // change; both are race state, and the result screen is not a race.
    this.clearRaceEventState();
    this.setSystemStatus("CLASSIFICATION LOCKED");
    document.body.dataset.phase = "result";
    this.restartButton.focus({ preventScroll: true });
  }

  showError(message: string): void {
    this.loadingScreen.hidden = true;
    this.errorMessage.textContent = message;
    this.errorPanel.hidden = false;
    this.setSystemStatus("ASSEMBLY FAILURE");
  }

  setCountdown(value: string): void {
    const countable = value === "GO" || /^[0-9]$/.test(value);
    if (countable) this.countdown.dataset.value = value === "GO" ? "go" : "count";
    if (countable && value !== this.countdown.textContent && !this.reducedMotion) {
      this.countdown.animate(
        [
          { transform: "translate(-50%, -50%) skewX(-7deg) scale(1.3)", opacity: 0.3 },
          { transform: "translate(-50%, -50%) skewX(-7deg) scale(1)", opacity: 1 },
        ],
        { duration: 240, easing: "cubic-bezier(0.23, 1, 0.32, 1)" },
      );
    }
    this.countdown.textContent = value;
    if (value === "GO") this.setSystemStatus("RACE ACTIVE");
  }

  setAudioMuted(muted: boolean): void {
    this.setSystemStatus(muted ? "AUDIO MUTED" : "AUDIO ONLINE");
  }

  setPaused(paused: boolean, reason: PauseReason | undefined = undefined): void {
    this.countdown.textContent = paused
      ? reason === "GRAPHICS LINK LOST"
        ? "GRAPHICS LINK LOST · WAITING FOR RESTORE"
        : `${reason ?? "PAUSED"} · ENTER / START TO RESUME`
      : "";
    this.countdown.dataset.paused = paused ? "true" : "false";
    this.setSystemStatus(paused ? "RACE PAUSED" : "RACE ACTIVE");
    document.body.dataset.phase = paused ? "paused" : "race";
  }

  setGraphicsContextLost(lost: boolean): void {
    document.body.dataset.graphicsContext = lost ? "lost" : "ready";
    if (lost) {
      this.setSystemStatus("GRAPHICS LINK LOST");
      return;
    }

    const phase = document.body.dataset.phase;
    if (!phase) this.setSystemStatus("SYSTEM STANDBY");
    else if (phase === "intro") this.setSystemStatus("TOTEM READY");
    else if (phase === "result") this.setSystemStatus("CLASSIFICATION LOCKED");
    else if (phase === "paused") this.setSystemStatus("RACE PAUSED");
    else if (phase === "resuming") this.setSystemStatus("RESUME SEQUENCE");
    else this.setSystemStatus("RACE ACTIVE");
  }

  setResuming(): void {
    this.countdown.textContent = "";
    this.countdown.dataset.paused = "false";
    this.setSystemStatus("RESUME SEQUENCE");
    document.body.dataset.phase = "resuming";
  }

  flashGate(index: number): void {
    this.gateFlashUntil = performance.now() + 620;
    this.checkpointValue.textContent = `GATE ${index.toString().padStart(2, "0")} CLEAR`;
    this.checkpointValue.dataset.cleared = "true";
    this.checkpointValue.dataset.missed = "false";
  }

  flashMissedGate(index: number): void {
    this.gateFlashUntil = 0;
    this.checkpointValue.textContent = index === 0
      ? "FINISH MISSED · RECOVER"
      : `GATE ${index.toString().padStart(2, "0")} MISSED · RECOVER`;
    this.checkpointValue.dataset.cleared = "false";
    this.checkpointValue.dataset.missed = "true";
  }

  flashImpact(side: "LEFT" | "RIGHT"): void {
    this.impactFlashUntil = performance.now() + 150;
    this.impactFlash.dataset.active = "true";
    this.impactFlash.dataset.side = side.toLowerCase();
  }

  flashLap(
    lap: number,
    totalLaps: number,
    completedLapMs: number,
    bestLapMs: number,
  ): void {
    const isFinalLap = lap === totalLaps;
    const isSessionBest = completedLapMs <= bestLapMs + 0.5;
    this.lapEventLabel.textContent = isFinalLap
      ? "FINAL LAP"
      : `LAP ${lap} / ${totalLaps}`;
    this.lapEventTime.textContent = `LAST ${formatRaceTime(completedLapMs)}${
      isSessionBest ? " · SESSION BEST" : ""
    }`;
    this.lapEvent.dataset.final = isFinalLap ? "true" : "false";
    this.lapEvent.dataset.active = "true";
    this.lapEvent.setAttribute("aria-hidden", "false");
    this.lapEventUntil = performance.now() + 1_500;
  }

  /**
   * G2 — a one-off race event in the lap-event slot.
   *
   * Reuses the lap banner rather than adding a third centre-screen element:
   * it is the established "something just happened, here is what" idiom, it is
   * already cyan by default (`data-final` is what turns it acid), and two
   * overlapping panels in the middle of the screen would be worse than one that
   * is briefly interrupted. A near miss lasts 900 ms against the lap banner's
   * 1500, so a pass on the line still hands the screen back to the lap.
   */
  flashRaceEvent(label: string, detail: string, durationMs = 900): void {
    this.lapEventLabel.textContent = label;
    this.lapEventTime.textContent = detail;
    this.lapEvent.dataset.final = "false";
    this.lapEvent.dataset.active = "true";
    this.lapEvent.setAttribute("aria-hidden", "false");
    this.lapEventUntil = performance.now() + durationMs;
  }

  flashHazard(label: string, durationMs = 900): void {
    this.hazardLabel = label;
    this.hazardUntil = performance.now() + durationMs;
  }

  announcePosition(position: number, gained: boolean): void {
    this.setSystemStatus(`${gained ? "POSITION GAINED" : "POSITION LOST"} · P${position}`);
  }

  update(frame: HudFrame): void {
    if (
      this.lapEvent.dataset.active === "true"
      && performance.now() >= this.lapEventUntil
    ) {
      this.hideLapEvent();
    }
    if (
      this.impactFlash.dataset.active === "true"
      && performance.now() >= this.impactFlashUntil
    ) {
      this.impactFlash.dataset.active = "false";
    }
    this.speedValue.textContent = Math.round(frame.speedKph).toString().padStart(3, "0");
    this.timeValue.textContent = formatRaceTime(frame.elapsedMs);
    const positionLabel = formatRacePosition(frame.position, frame.racerCount);
    const gapLabel = formatRaceGap(
      frame.position,
      frame.gapToAheadMs,
      frame.gapToBehindMs,
    );
    if (positionLabel !== this.lastPositionLabel) {
      this.positionValue.textContent = positionLabel;
      this.lastPositionLabel = positionLabel;
    }
    if (gapLabel !== this.lastGapLabel) {
      this.gapValue.textContent = gapLabel;
      this.lastGapLabel = gapLabel;
    }
    const lapLabel = `LAP ${Math.min(frame.lap, frame.totalLaps)} / ${frame.totalLaps}`;
    const lastLapTimeLabel = frame.lastLapMs === null
      ? ""
      : ` · LAST ${formatRaceTime(frame.lastLapMs)}`;
    const checkpointLabel = frame.missedGate === null
      ? frame.finishArmed
        ? frame.lap === frame.totalLaps
          ? "FINISH VECTOR ARMED"
          : "LAP GATE ARMED"
        : `NEXT GATE ${frame.checkpoint
          .toString()
          .padStart(2, "0")} / ${frame.checkpointCount.toString().padStart(2, "0")}`
      : frame.missedGate === 0
        ? "FINISH MISSED · RECOVER"
        : `GATE ${frame.missedGate.toString().padStart(2, "0")} MISSED · RECOVER`;
    if (lapLabel !== this.lastLapLabel) {
      this.lapValue.textContent = lapLabel;
      this.lastLapLabel = lapLabel;
    }
    if (lastLapTimeLabel !== this.lastLapTimeLabel) {
      this.lastLapValue.textContent = lastLapTimeLabel;
      this.lastLapValue.hidden = lastLapTimeLabel.length === 0;
      this.lastLapTimeLabel = lastLapTimeLabel;
    }
    if (performance.now() >= this.gateFlashUntil && checkpointLabel !== this.lastCheckpointLabel) {
      this.checkpointValue.textContent = checkpointLabel;
      this.checkpointValue.dataset.cleared = "false";
      this.checkpointValue.dataset.missed = frame.missedGate === null ? "false" : "true";
      this.lastCheckpointLabel = checkpointLabel;
    }
    this.sectorValue.textContent = frame.sector;
    const finishDistance = Math.max(0, frame.finishDistanceMeters);
    const finishPresentation = resolveFinishPresentation(
      finishDistance,
      frame.lap,
      frame.totalLaps,
      frame.finishArmed,
    );
    const { finalApproach } = finishPresentation;
    this.finishValue.textContent = finishPresentation.label;
    this.finishValue.dataset.final = finishPresentation.finalLap ? "true" : "false";
    this.finishValue.dataset.approach = finalApproach ? "true" : "false";
    this.progressFill.style.transform = `scaleX(${Math.min(1, Math.max(0, frame.progress))})`;
    this.boostValue.textContent = `${Math.round(frame.boost * 100)}%`;
    this.boostFill.style.transform = `scaleX(${Math.min(1, Math.max(0, frame.boost))})`;
    const driftCharge = Math.min(1, Math.max(0, frame.driftCharge));
    this.driftChargeFill.style.transform = `scaleX(${driftCharge})`;
    // The armed state is the glanceable half of the bank, so it only touches the
    // DOM on the threshold crossing rather than every frame.
    const driftArmed = driftCharge >= DRIFT_REWARD_MINIMUM_CHARGE;
    if (driftArmed !== this.lastDriftArmed) {
      this.boostMeter.dataset.charge = driftArmed ? "armed" : "idle";
      this.lastDriftArmed = driftArmed;
    }
    // The chip's fill tracks every frame; its state words only touch the DOM on
    // a threshold crossing, the same discipline the boost meter uses.
    const slipstream = Math.min(1, Math.max(0, frame.slipstream));
    this.slipstreamFill.style.transform = `scaleX(${slipstream})`;
    const slipstreamState = slipstream <= 0
      ? "idle"
      : slipstream >= SLIPSTREAM_LOCK_THRESHOLD
        ? "locked"
        : "active";
    if (slipstreamState !== this.lastSlipstreamState) {
      this.slipstreamChip.dataset.active = slipstreamState === "idle" ? "false" : "true";
      this.slipstreamChip.dataset.locked = slipstreamState === "locked" ? "true" : "false";
      this.slipstreamChip.setAttribute(
        "aria-hidden",
        slipstreamState === "idle" ? "true" : "false",
      );
      this.slipstreamLabel.textContent = slipstreamState === "locked"
        ? "SLIPSTREAM · LOCK"
        : "SLIPSTREAM";
      this.lastSlipstreamState = slipstreamState;
    }
    // G2 — the cushion glow and the clean-gate counter. Both touch the DOM only
    // on a state change, the same discipline the slipstream chip and the boost
    // meter above are held to; the cushion in particular can be armed for
    // several seconds at a time and must not write a style every frame.
    // Two strengths, not a continuous fade: a firm lean and a brush look
    // different at a glance, and a value that changed every frame would write
    // an inline style 30 times a second for a cue that is on for a third of one.
    const cushionStrength = frame.cushionPush >= CUSHION_FIRM_PUSH_MPS2
      ? "firm"
      : "soft";
    const cushionState = `${frame.cushionSide ?? "none"}:${cushionStrength}`;
    if (cushionState !== this.lastCushionState) {
      this.cushionGlow.dataset.active = frame.cushionSide ? "true" : "false";
      if (frame.cushionSide) {
        this.cushionGlow.dataset.side = frame.cushionSide.toLowerCase();
        this.cushionGlow.dataset.strength = cushionStrength;
      }
      this.lastCushionState = cushionState;
    }
    // Hidden below the first chain that actually pays. A counter reading "x1"
    // through every clean lap would be a permanent HUD element that says
    // nothing, which is exactly the busy chrome the anti-references rule out.
    // G3 - the track-event chip, held to the same discipline: it touches the DOM
    // only when the label itself changes, which for a gust is twice per event
    // rather than 120 times a second.
    if (frame.trackEvent !== this.lastTrackEvent) {
      const active = frame.trackEvent.length > 0;
      this.trackEventLabel.textContent = frame.trackEvent;
      this.trackEventChip.dataset.active = active ? "true" : "false";
      this.trackEventChip.dataset.event = frame.trackEvent.startsWith("GUST")
        ? "gust"
        : frame.trackEvent === "SALT"
          ? "salt"
          : frame.trackEvent === "SQUALL"
            ? "squall"
            : "";
      this.trackEventChip.setAttribute("aria-hidden", active ? "false" : "true");
      this.lastTrackEvent = frame.trackEvent;
    }
    const chainLabel = frame.cleanGateMultiplier > 1
      ? `CLEAN ×${frame.cleanGateChain}`
      : "";
    if (chainLabel !== this.lastCleanChainLabel) {
      this.cleanChain.textContent = chainLabel;
      this.cleanChain.hidden = chainLabel.length === 0;
      this.cleanChain.setAttribute(
        "aria-hidden",
        chainLabel.length === 0 ? "true" : "false",
      );
      this.lastCleanChainLabel = chainLabel;
    }
    const boostPresentation = resolveBoostPresentation(frame.boostActive, frame.boostLocked);
    const boostState = boostPresentation.state;
    const edgeActive = frame.edgeWarning || frame.wrongWay;
    const edgeState = `${frame.edgeWarning}:${frame.edgeOpen}:${frame.recoveryActive}:${frame.wrongWay}`;
    if (boostState !== this.lastBoostState) {
      this.boostMeter.dataset.state = boostState;
      this.boostLabel.textContent = boostPresentation.label;
      this.boostFill.dataset.active = boostState === "active" ? "true" : "false";
      document.body.dataset.boost = boostState === "active" ? "true" : "false";
      this.lastBoostState = boostState;
    }
    if (edgeState !== this.lastEdgeState) {
      this.edgeWarning.dataset.active = edgeActive ? "true" : "false";
      this.edgeWarning.dataset.recovery = frame.recoveryActive ? "true" : "false";
      this.edgeWarning.dataset.wrongWay = frame.wrongWay ? "true" : "false";
      this.edgeWarning.setAttribute("aria-hidden", edgeActive ? "false" : "true");
      this.lastEdgeState = edgeState;
    }
    const edgeLabel = frame.recoveryActive
      ? `OFF COURSE · AUTO RECOVERY · ${(
        Math.ceil(frame.recoverySeconds * 2) / 2
      ).toFixed(1)} S`
      : frame.wrongWay
        ? "WRONG WAY · TURN AROUND / R RECOVER"
        : frame.edgeWarning && frame.edgeOpen && frame.edgeCorrection
          ? `OPEN EDGE · STEER ${frame.edgeCorrection}`
          : frame.edgeWarning && frame.edgeCorrection
            ? `COURSE EDGE · STEER ${frame.edgeCorrection}`
            : "COURSE EDGE";
    if (edgeLabel !== this.lastEdgeLabel) {
      this.edgeWarningLabel.textContent = edgeLabel;
      this.lastEdgeLabel = edgeLabel;
    }
    this.edgeWarningFill.style.transform = `scaleX(${Math.min(
      1,
      Math.max(0, frame.recoveryProgress),
    )})`;
    const finishCueActive = finalApproach
      && finishDistance <= 700
      && !frame.turnDirection;
    const cueActive = !frame.wrongWay && (Boolean(frame.turnDirection) || finishCueActive);
    const turnState = frame.wrongWay
      ? "wrong-way"
      : frame.turnDirection
        ? `${frame.turnDirection}:${frame.turnFollowingDirection}:${frame.turnHard}:${frame.turnUrgent}:${Math.round(frame.turnDistanceMeters / 10)}:${finalApproach}`
        : finishCueActive
          ? `finish:${Math.round(finishDistance / 10)}`
          : "none";
    if (turnState !== this.lastTurnState) {
      this.turnCue.dataset.active = cueActive ? "true" : "false";
      this.turnCue.setAttribute("aria-hidden", cueActive ? "false" : "true");
      if (frame.turnDirection) {
        const primaryArrow = frame.turnDirection === "LEFT" ? "←" : "→";
        const followingArrow = frame.turnFollowingDirection === "LEFT"
          ? "←"
          : frame.turnFollowingDirection === "RIGHT"
            ? "→"
            : "";
        const sequenceLabel = frame.turnFollowingDirection
          ? `${frame.turnDirection} → ${frame.turnFollowingDirection}`
          : frame.turnDirection;
        this.turnCue.dataset.mode = "turn";
        this.turnCue.dataset.direction = frame.turnDirection.toLowerCase();
        this.turnCue.dataset.follow = frame.turnFollowingDirection?.toLowerCase() ?? "none";
        this.turnCue.dataset.urgent = frame.turnUrgent ? "true" : "false";
        this.turnArrow.textContent = `${primaryArrow}${followingArrow ? ` ${followingArrow}` : ""}`;
        this.turnLabel.textContent = finalApproach
          ? `FINAL TURN · ${frame.turnHard ? "HARD " : ""}${sequenceLabel}`
          : `${frame.turnUrgent ? "BRAKE · " : ""}${frame.turnHard ? "HARD " : "TURN "}${sequenceLabel}`;
        this.turnDistance.textContent = frame.turnDistanceMeters < 12
          ? "NOW"
          : `${Math.ceil(frame.turnDistanceMeters / 10) * 10} M`;
      } else if (finishCueActive) {
        this.turnCue.dataset.mode = "finish";
        this.turnCue.dataset.direction = "finish";
        this.turnCue.dataset.follow = "none";
        this.turnCue.dataset.urgent = "false";
        this.turnArrow.textContent = "◆";
        this.turnLabel.textContent = "THE CRADLE · FINISH";
        this.turnDistance.textContent = `${Math.ceil(finishDistance / 10) * 10} M`;
      }
      this.lastTurnState = turnState;
    }
    const raceStage = resolveRaceStage(
      frame.finishArmed,
      frame.lap,
      frame.totalLaps,
    );
    if (!frame.raceActive) {
      this.lastRaceStage = "";
    } else if (raceStage !== this.lastRaceStage) {
      if (raceStage === "approach") this.setSystemStatus("FINAL APPROACH");
      else if (raceStage === "final") this.setSystemStatus("FINAL LAP");
      this.lastRaceStage = raceStage;
    }
    const hazardActive = performance.now() < this.hazardUntil;
    const driveLabel = hazardActive
      ? this.hazardLabel
      : frame.wrongWay
        ? "WRONG WAY"
        : frame.skidsDown
          ? "SKIDS DOWN"
          : frame.boostActive
            ? "PLASMA OVERDRIVE"
            : frame.boostLocked
              ? "RELEASE BOOST"
              : frame.lowGrip
                ? "SLIP SURFACE"
                : frame.drifting
                  ? "DRIFT VECTOR"
                  : frame.braking
                    ? "AIRBRAKES"
                    : "HOVER LOCK";
    const driveState = hazardActive
      ? "hazard"
      : frame.wrongWay
        ? "hazard"
        : frame.skidsDown
          ? "nominal"
          : frame.boostActive
            ? "boost"
            : frame.boostLocked
              ? "lockout"
              : frame.lowGrip
                ? "low-grip"
                : frame.drifting
                  ? "drift"
                  : frame.braking
                    ? "braking"
                    : "nominal";
    if (driveLabel !== this.lastDriveLabel) {
      this.driveState.textContent = driveLabel;
      this.lastDriveLabel = driveLabel;
    }
    if (driveState !== this.lastDriveState) {
      this.driveState.dataset.state = driveState;
      this.lastDriveState = driveState;
    }
  }

  /**
   * G2 — puts the cushion glow and the clean-gate counter back to nothing.
   *
   * The cached `last*` strings are cleared with them, or the next frame would
   * see "no change" against a DOM that had already been reset behind it and
   * leave the glow off through a real contact.
   */
  private clearRaceEventState(): void {
    this.cushionGlow.dataset.active = "false";
    this.lastCushionState = "";
    this.cleanChain.textContent = "";
    this.cleanChain.hidden = true;
    this.cleanChain.setAttribute("aria-hidden", "true");
    this.lastCleanChainLabel = "";
  }

  private hideLapEvent(): void {
    this.lapEvent.dataset.active = "false";
    this.lapEvent.setAttribute("aria-hidden", "true");
    this.lapEventUntil = 0;
  }

  private updateGrid(grid: readonly RaceGridEntry[]): void {
    const fragment = document.createDocumentFragment();
    for (const entry of grid) {
      const row = document.createElement("li");
      const position = document.createElement("span");
      const name = document.createElement("span");
      name.className = "n";
      const team = document.createElement("strong");
      position.textContent = `P${entry.position}${entry.player ? " · YOU" : ""}`;
      name.textContent = entry.name;
      team.textContent = entry.team;
      row.dataset.best = entry.player ? "true" : "false";
      row.append(position, name, team);
      fragment.append(row);
    }
    this.gridOrder.replaceChildren(fragment);
  }

  private updateResultClassification(
    standings: readonly RaceStandingEntry[],
    lapTimesMs: readonly number[],
    bestLapMs: number,
  ): void {
    this.resultLaps.replaceChildren();
    this.resultLaps.hidden = standings.length === 0 && lapTimesMs.length <= 1;
    if (this.resultLaps.hidden) return;

    const fragment = document.createDocumentFragment();
    if (standings.length > 0) {
      for (const entry of standings) {
        const row = document.createElement("li");
        const position = document.createElement("span");
        const name = document.createElement("span");
        name.className = "n";
        const gap = document.createElement("strong");
        position.textContent = `P${entry.position}${entry.player ? " · YOU" : ""}`;
        name.textContent = entry.name;
        gap.textContent = entry.position === 1
          ? formatRaceTime(entry.finishTimeMs)
          : `+${formatRaceTime(entry.gapMs)}`;
        row.dataset.best = entry.player ? "true" : "false";
        row.append(position, name, gap);
        fragment.append(row);
      }
      this.resultLaps.append(fragment);
      return;
    }
    lapTimesMs.forEach((lapTimeMs, index) => {
      const row = document.createElement("li");
      const lap = document.createElement("span");
      const time = document.createElement("time");
      const status = document.createElement("strong");
      const isBest = lapTimeMs <= bestLapMs + 0.5;

      lap.textContent = `LAP ${(index + 1).toString().padStart(2, "0")}`;
      time.textContent = formatRaceTime(lapTimeMs);
      status.textContent = isBest
        ? "BEST"
        : `+${formatRaceTime(Math.max(0, lapTimeMs - bestLapMs))}`;
      row.dataset.best = isBest ? "true" : "false";
      row.append(lap, time, status);
      fragment.append(row);
    });
    this.resultLaps.append(fragment);
  }

  private setSystemStatus(label: string): void {
    this.systemStatusLabel = label;
    this.systemStatus.textContent = this.demoAutopilot
      ? `${label} · AUTOPILOT`
      : label;
  }
}
