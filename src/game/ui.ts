export interface HudFrame {
  speedKph: number;
  boost: number;
  elapsedMs: number;
  lap: number;
  totalLaps: number;
  progress: number;
  checkpoint: number;
  checkpointCount: number;
  sector: string;
  finishDistanceMeters: number;
  turnDirection: "LEFT" | "RIGHT" | null;
  turnDistanceMeters: number;
  turnHard: boolean;
  boostActive: boolean;
  braking: boolean;
  skidsDown: boolean;
  edgeWarning: boolean;
  edgeCorrection: "LEFT" | "RIGHT" | null;
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
  private readonly systemStatus = requiredElement<HTMLElement>("system-status");
  private readonly speedValue = requiredElement<HTMLElement>("speed-value");
  private readonly driveState = requiredElement<HTMLElement>("drive-state");
  private readonly timeValue = requiredElement<HTMLElement>("time-value");
  private readonly lapValue = requiredElement<HTMLElement>("lap-value");
  private readonly checkpointValue = requiredElement<HTMLElement>("checkpoint-value");
  private readonly sectorValue = requiredElement<HTMLElement>("sector-value");
  private readonly finishValue = requiredElement<HTMLElement>("finish-value");
  private readonly progressFill = requiredElement<HTMLElement>("progress-fill");
  private readonly boostValue = requiredElement<HTMLElement>("boost-value");
  private readonly boostFill = requiredElement<HTMLElement>("boost-fill");
  private readonly edgeWarning = requiredElement<HTMLElement>("edge-warning");
  private readonly turnCue = requiredElement<HTMLElement>("turn-cue");
  private readonly turnLabel = requiredElement<HTMLElement>("turn-label");
  private readonly turnArrow = requiredElement<HTMLElement>("turn-arrow");
  private readonly turnDistance = requiredElement<HTMLElement>("turn-distance");
  private readonly countdown = requiredElement<HTMLElement>("countdown");
  private readonly errorPanel = requiredElement<HTMLElement>("error-panel");
  private readonly errorMessage = requiredElement<HTMLElement>("error-message");
  private lastLapLabel = "";
  private lastCheckpointLabel = "";
  private lastDriveLabel = "";
  private lastBoostState = "";
  private lastEdgeState = "";
  private lastTurnState = "";
  private lastRaceStage = "";
  private gateFlashUntil = 0;

  showReady(): void {
    this.loadingScreen.hidden = true;
    this.startScreen.hidden = false;
    this.resultScreen.hidden = true;
    this.systemStatus.textContent = "TOTEM READY";
    document.body.dataset.phase = "intro";
    this.startButton.focus({ preventScroll: true });
  }

  showRace(): void {
    this.loadingScreen.hidden = true;
    this.startScreen.hidden = true;
    this.resultScreen.hidden = true;
    this.countdown.textContent = "3";
    this.systemStatus.textContent = "LAUNCH SEQUENCE";
    document.body.dataset.phase = "race";
  }

  showResult(elapsedMs: number, totalLaps: number): void {
    this.resultTime.textContent = formatRaceTime(elapsedMs);
    this.resultDetail.textContent = `TOTEM / WORKS 07 · ${totalLaps} ${
      totalLaps === 1 ? "LAP" : "LAPS"
    } LOGGED`;
    this.resultScreen.hidden = false;
    this.countdown.textContent = "";
    this.systemStatus.textContent = "TRIAL COMPLETE";
    document.body.dataset.phase = "result";
    this.restartButton.focus({ preventScroll: true });
  }

  showError(message: string): void {
    this.loadingScreen.hidden = true;
    this.errorMessage.textContent = message;
    this.errorPanel.hidden = false;
    this.systemStatus.textContent = "ASSEMBLY FAILURE";
  }

  setCountdown(value: string): void {
    this.countdown.textContent = value;
    if (value === "GO") this.systemStatus.textContent = "TRIAL ACTIVE";
  }

  setAudioMuted(muted: boolean): void {
    this.systemStatus.textContent = muted ? "AUDIO MUTED" : "AUDIO ONLINE";
  }

  setPaused(paused: boolean): void {
    this.countdown.textContent = paused ? "PAUSED" : "";
    this.countdown.dataset.paused = paused ? "true" : "false";
    this.systemStatus.textContent = paused ? "RACE PAUSED" : "TRIAL ACTIVE";
    document.body.dataset.phase = paused ? "paused" : "race";
  }

  flashGate(index: number): void {
    this.gateFlashUntil = performance.now() + 620;
    this.checkpointValue.textContent = `GATE ${index.toString().padStart(2, "0")} CLEAR`;
    this.checkpointValue.dataset.cleared = "true";
  }

  update(frame: HudFrame): void {
    this.speedValue.textContent = Math.round(frame.speedKph).toString().padStart(3, "0");
    this.timeValue.textContent = formatRaceTime(frame.elapsedMs);
    const lapLabel = `LAP ${Math.min(frame.lap, frame.totalLaps)} / ${frame.totalLaps}`;
    const checkpointLabel = `NEXT GATE ${frame.checkpoint
      .toString()
      .padStart(2, "0")} / ${frame.checkpointCount.toString().padStart(2, "0")}`;
    if (lapLabel !== this.lastLapLabel) {
      this.lapValue.textContent = lapLabel;
      this.lastLapLabel = lapLabel;
    }
    if (performance.now() >= this.gateFlashUntil && checkpointLabel !== this.lastCheckpointLabel) {
      this.checkpointValue.textContent = checkpointLabel;
      this.checkpointValue.dataset.cleared = "false";
      this.lastCheckpointLabel = checkpointLabel;
    }
    this.sectorValue.textContent = frame.sector;
    const finishDistance = Math.max(0, frame.finishDistanceMeters);
    this.finishValue.textContent = finishDistance >= 1000
      ? `${(finishDistance / 1000).toFixed(1)} KM TO FINISH`
      : `${Math.ceil(finishDistance / 10) * 10} M TO FINISH`;
    this.finishValue.dataset.final = frame.lap === frame.totalLaps ? "true" : "false";
    this.progressFill.style.transform = `scaleX(${Math.min(1, Math.max(0, frame.progress))})`;
    this.boostValue.textContent = `${Math.round(frame.boost * 100)}%`;
    this.boostFill.style.transform = `scaleX(${Math.min(1, Math.max(0, frame.boost))})`;
    const boostState = frame.boostActive ? "true" : "false";
    const edgeState = frame.edgeWarning ? "true" : "false";
    if (boostState !== this.lastBoostState) {
      this.boostFill.dataset.active = boostState;
      this.lastBoostState = boostState;
    }
    if (edgeState !== this.lastEdgeState) {
      this.edgeWarning.dataset.active = edgeState;
      this.edgeWarning.setAttribute("aria-hidden", frame.edgeWarning ? "false" : "true");
      this.lastEdgeState = edgeState;
    }
    if (frame.edgeWarning && frame.edgeCorrection) {
      this.edgeWarning.textContent = `COURSE EDGE · STEER ${frame.edgeCorrection}`;
    }
    const turnState = frame.turnDirection
      ? `${frame.turnDirection}:${frame.turnHard}:${Math.round(frame.turnDistanceMeters / 10)}`
      : "none";
    if (turnState !== this.lastTurnState) {
      this.turnCue.dataset.active = frame.turnDirection ? "true" : "false";
      this.turnCue.setAttribute("aria-hidden", frame.turnDirection ? "false" : "true");
      if (frame.turnDirection) {
        this.turnArrow.textContent = frame.turnDirection === "LEFT" ? "←" : "→";
        this.turnLabel.textContent = `${frame.turnHard ? "HARD " : "TURN "}${frame.turnDirection}`;
        this.turnDistance.textContent = frame.turnDistanceMeters < 12
          ? "NOW"
          : `${Math.ceil(frame.turnDistanceMeters / 10) * 10} M`;
      }
      this.lastTurnState = turnState;
    }
    const raceStage = frame.lap === frame.totalLaps ? "final" : "running";
    if (raceStage !== this.lastRaceStage) {
      if (raceStage === "final") this.systemStatus.textContent = "FINAL LAP";
      this.lastRaceStage = raceStage;
    }
    const driveLabel = frame.skidsDown
      ? "SKIDS DOWN"
      : frame.boostActive
        ? "PLASMA OVERDRIVE"
        : frame.braking
          ? "AIRBRAKES"
          : "HOVER LOCK";
    if (driveLabel !== this.lastDriveLabel) {
      this.driveState.textContent = driveLabel;
      this.lastDriveLabel = driveLabel;
    }
  }
}
