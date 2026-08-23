export interface HudFrame {
  speedKph: number;
  boost: number;
  elapsedMs: number;
  lap: number;
  totalLaps: number;
  progress: number;
  checkpoint: number;
  checkpointCount: number;
  boostActive: boolean;
  braking: boolean;
  skidsDown: boolean;
  edgeWarning: boolean;
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
  private readonly progressFill = requiredElement<HTMLElement>("progress-fill");
  private readonly boostValue = requiredElement<HTMLElement>("boost-value");
  private readonly boostFill = requiredElement<HTMLElement>("boost-fill");
  private readonly edgeWarning = requiredElement<HTMLElement>("edge-warning");
  private readonly countdown = requiredElement<HTMLElement>("countdown");
  private readonly errorPanel = requiredElement<HTMLElement>("error-panel");
  private readonly errorMessage = requiredElement<HTMLElement>("error-message");
  private lastLapLabel = "";
  private lastCheckpointLabel = "";
  private lastDriveLabel = "";
  private lastBoostState = "";
  private lastEdgeState = "";

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

  showResult(elapsedMs: number): void {
    this.resultTime.textContent = formatRaceTime(elapsedMs);
    this.resultDetail.textContent = "TOTEM / WORKS 07 · TWO LAPS LOGGED";
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

  update(frame: HudFrame): void {
    this.speedValue.textContent = Math.round(frame.speedKph).toString().padStart(3, "0");
    this.timeValue.textContent = formatRaceTime(frame.elapsedMs);
    const lapLabel = `LAP ${Math.min(frame.lap, frame.totalLaps)} / ${frame.totalLaps}`;
    const checkpointLabel = `VECTOR ${frame.checkpoint
      .toString()
      .padStart(2, "0")} / ${frame.checkpointCount.toString().padStart(2, "0")}`;
    if (lapLabel !== this.lastLapLabel) {
      this.lapValue.textContent = lapLabel;
      this.lastLapLabel = lapLabel;
    }
    if (checkpointLabel !== this.lastCheckpointLabel) {
      this.checkpointValue.textContent = checkpointLabel;
      this.lastCheckpointLabel = checkpointLabel;
    }
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
      this.lastEdgeState = edgeState;
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
