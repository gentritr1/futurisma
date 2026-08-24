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
  braking: boolean;
  drifting: boolean;
  skidsDown: boolean;
  lowGrip: boolean;
  edgeWarning: boolean;
  edgeOpen: boolean;
  edgeCorrection: "LEFT" | "RIGHT" | null;
  recoveryActive: boolean;
  recoveryProgress: number;
  recoverySeconds: number;
}

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
  private readonly loadingScreen = requiredElement<HTMLElement>("loading-screen");
  private readonly startScreen = requiredElement<HTMLElement>("start-screen");
  private readonly resultScreen = requiredElement<HTMLElement>("result-screen");
  private readonly resultTime = requiredElement<HTMLElement>("result-time");
  private readonly resultDetail = requiredElement<HTMLElement>("result-detail");
  private readonly introDeck = requiredElement<HTMLElement>("intro-deck");
  private readonly systemStatus = requiredElement<HTMLElement>("system-status");
  private readonly speedValue = requiredElement<HTMLElement>("speed-value");
  private readonly driveState = requiredElement<HTMLElement>("drive-state");
  private readonly timeValue = requiredElement<HTMLElement>("time-value");
  private readonly lapValue = requiredElement<HTMLElement>("lap-value");
  private readonly lastLapValue = requiredElement<HTMLElement>("last-lap-value");
  private readonly checkpointValue = requiredElement<HTMLElement>("checkpoint-value");
  private readonly sectorValue = requiredElement<HTMLElement>("sector-value");
  private readonly finishValue = requiredElement<HTMLElement>("finish-value");
  private readonly progressFill = requiredElement<HTMLElement>("progress-fill");
  private readonly boostValue = requiredElement<HTMLElement>("boost-value");
  private readonly boostFill = requiredElement<HTMLElement>("boost-fill");
  private readonly edgeWarning = requiredElement<HTMLElement>("edge-warning");
  private readonly edgeWarningLabel = requiredElement<HTMLElement>("edge-warning-label");
  private readonly edgeWarningFill = requiredElement<HTMLElement>("edge-warning-fill");
  private readonly turnCue = requiredElement<HTMLElement>("turn-cue");
  private readonly turnLabel = requiredElement<HTMLElement>("turn-label");
  private readonly turnArrow = requiredElement<HTMLElement>("turn-arrow");
  private readonly turnDistance = requiredElement<HTMLElement>("turn-distance");
  private readonly countdown = requiredElement<HTMLElement>("countdown");
  private readonly impactFlash = requiredElement<HTMLElement>("impact-flash");
  private readonly errorPanel = requiredElement<HTMLElement>("error-panel");
  private readonly errorMessage = requiredElement<HTMLElement>("error-message");
  private lastLapLabel = "";
  private lastLapTimeLabel = "";
  private lastCheckpointLabel = "";
  private lastDriveLabel = "";
  private lastDriveState = "";
  private lastBoostState = "";
  private lastEdgeState = "";
  private lastEdgeLabel = "";
  private lastTurnState = "";
  private lastRaceStage = "";
  private hazardLabel = "";
  private hazardUntil = 0;
  private gateFlashUntil = 0;
  private impactFlashUntil = 0;
  private systemStatusLabel = "SYSTEM STANDBY";
  private demoAutopilot = false;

  setDemoAutopilot(active: boolean): void {
    this.demoAutopilot = active;
    document.body.dataset.controlMode = active ? "autopilot" : "manual";
    this.setSystemStatus(this.systemStatusLabel);
  }

  setRaceFormat(totalLaps: number): void {
    this.introDeck.textContent = `${totalLaps} ${totalLaps === 1 ? "lap" : "laps"} through Greenwater Strip. Read the amber turn grammar, clear all eight gates, and bring TOTEM home through The Cradle.`;
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
    this.edgeWarning.setAttribute("aria-hidden", "true");
    this.turnCue.dataset.active = "false";
    this.turnCue.setAttribute("aria-hidden", "true");
    this.impactFlash.dataset.active = "false";
    this.hazardUntil = 0;
    this.setSystemStatus("LAUNCH SEQUENCE");
    document.body.dataset.phase = "race";
  }

  showResult(elapsedMs: number, totalLaps: number, bestLapMs: number): void {
    this.resultTime.textContent = formatRaceTime(elapsedMs);
    this.resultDetail.textContent = `TOTEM / WORKS 07 · ${totalLaps} ${
      totalLaps === 1 ? "LAP" : "LAPS"
    } LOGGED · BEST ${formatRaceTime(bestLapMs)}`;
    this.resultScreen.hidden = false;
    this.countdown.textContent = "";
    this.countdown.dataset.paused = "false";
    this.edgeWarning.dataset.active = "false";
    this.edgeWarning.dataset.recovery = "false";
    this.edgeWarning.setAttribute("aria-hidden", "true");
    this.turnCue.dataset.active = "false";
    this.turnCue.setAttribute("aria-hidden", "true");
    this.impactFlash.dataset.active = "false";
    this.setSystemStatus("TRIAL COMPLETE");
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
    this.countdown.textContent = value;
    if (value === "GO") this.setSystemStatus("TRIAL ACTIVE");
  }

  setAudioMuted(muted: boolean): void {
    this.setSystemStatus(muted ? "AUDIO MUTED" : "AUDIO ONLINE");
  }

  setPaused(paused: boolean, reason: "FOCUS LOST" | undefined = undefined): void {
    this.countdown.textContent = paused
      ? `${reason ?? "PAUSED"} · ENTER / START TO RESUME`
      : "";
    this.countdown.dataset.paused = paused ? "true" : "false";
    this.setSystemStatus(paused ? "RACE PAUSED" : "TRIAL ACTIVE");
    document.body.dataset.phase = paused ? "paused" : "race";
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

  flashHazard(label: string, durationMs = 900): void {
    this.hazardLabel = label;
    this.hazardUntil = performance.now() + durationMs;
  }

  update(frame: HudFrame): void {
    if (
      this.impactFlash.dataset.active === "true"
      && performance.now() >= this.impactFlashUntil
    ) {
      this.impactFlash.dataset.active = "false";
    }
    this.speedValue.textContent = Math.round(frame.speedKph).toString().padStart(3, "0");
    this.timeValue.textContent = formatRaceTime(frame.elapsedMs);
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
    const finishDistanceLabel = finishDistance >= 1000
      ? `${(finishDistance / 1000).toFixed(1)} KM TO FINISH`
      : `${Math.ceil(finishDistance / 10) * 10} M TO FINISH`;
    const finalApproach = frame.finishArmed && frame.lap === frame.totalLaps;
    this.finishValue.textContent = finalApproach
      ? `${finishDistanceLabel.replace(" TO FINISH", "")} · THE CRADLE`
      : finishDistanceLabel;
    this.finishValue.dataset.final = frame.lap === frame.totalLaps ? "true" : "false";
    this.finishValue.dataset.approach = finalApproach ? "true" : "false";
    this.progressFill.style.transform = `scaleX(${Math.min(1, Math.max(0, frame.progress))})`;
    this.boostValue.textContent = `${Math.round(frame.boost * 100)}%`;
    this.boostFill.style.transform = `scaleX(${Math.min(1, Math.max(0, frame.boost))})`;
    const boostState = frame.boostActive ? "true" : "false";
    const edgeState = `${frame.edgeWarning}:${frame.edgeOpen}:${frame.recoveryActive}`;
    if (boostState !== this.lastBoostState) {
      this.boostFill.dataset.active = boostState;
      this.lastBoostState = boostState;
    }
    if (edgeState !== this.lastEdgeState) {
      this.edgeWarning.dataset.active = frame.edgeWarning ? "true" : "false";
      this.edgeWarning.dataset.recovery = frame.recoveryActive ? "true" : "false";
      this.edgeWarning.setAttribute("aria-hidden", frame.edgeWarning ? "false" : "true");
      this.lastEdgeState = edgeState;
    }
    const edgeLabel = frame.recoveryActive
      ? `OFF COURSE · AUTO RECOVERY · ${(
        Math.ceil(frame.recoverySeconds * 2) / 2
      ).toFixed(1)} S`
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
    const cueActive = Boolean(frame.turnDirection) || finishCueActive;
    const turnState = frame.turnDirection
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
        this.turnCue.dataset.urgent = "false";
        this.turnArrow.textContent = "◆";
        this.turnLabel.textContent = "THE CRADLE · FINISH";
        this.turnDistance.textContent = `${Math.ceil(finishDistance / 10) * 10} M`;
      }
      this.lastTurnState = turnState;
    }
    const raceStage = frame.finishArmed && frame.lap === frame.totalLaps
      ? "approach"
      : frame.totalLaps > 1 && frame.lap === frame.totalLaps
        ? "final"
        : "running";
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
      : frame.skidsDown
        ? "SKIDS DOWN"
        : frame.boostActive
          ? "PLASMA OVERDRIVE"
          : frame.lowGrip
            ? "SLIP SURFACE"
            : frame.drifting
              ? "DRIFT VECTOR"
              : frame.braking
                ? "AIRBRAKES"
                : "HOVER LOCK";
    const driveState = hazardActive
      ? "hazard"
      : frame.skidsDown
        ? "nominal"
        : frame.boostActive
          ? "boost"
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

  private setSystemStatus(label: string): void {
    this.systemStatusLabel = label;
    this.systemStatus.textContent = this.demoAutopilot
      ? `${label} · AUTOPILOT`
      : label;
  }
}
