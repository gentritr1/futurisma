/**
 * The pause panel and its hold-to-quit confirm.
 *
 * Owns the DOM and the input bookkeeping; the decision itself lives in
 * `quit-hold.ts` as a pure step so it can be tested without a browser. The game
 * loop calls `step()` once per presentation frame while paused - which is the
 * only place it can live, because the physics loop does not run on a paused
 * frame and so cannot host a timer.
 */

import type { InputController } from "./input";
import {
  createQuitHoldState,
  quitHoldProgress,
  stepQuitHold,
  type QuitHoldState,
} from "./quit-hold.js";

export class PauseMenu {
  private readonly panel = document.getElementById("pause-panel");
  private readonly reason = document.getElementById("pause-reason");
  private readonly resumeButton = document.getElementById("pause-resume");
  private readonly optionsButton = document.getElementById("pause-options");
  private readonly quitButton = document.getElementById("pause-quit");
  private readonly quitFill = this.quitButton?.querySelector<HTMLElement>(".quit-button__fill");
  private readonly optionsScreen = document.getElementById("options-screen");
  private readonly hold: QuitHoldState = createQuitHoldState();
  /**
   * True while a key or pointer press that STARTED on the quit button is still
   * down. Tracked here rather than read from `InputController` because it is a
   * property of the control, not of the keyboard: the same Enter keydown means
   * "confirm this button" here and "resume" when nothing is focused.
   */
  private buttonHeld = false;
  private lastProgress = -1;

  constructor(
    private readonly input: InputController,
    private readonly resume: () => void,
  ) {
    this.resumeButton?.addEventListener("click", () => this.resume());
    // MetaUi owns the terminal and already permits opening it from a paused
    // race, so this routes through the control that exists rather than
    // threading MetaUi through the race loop for one call.
    this.optionsButton?.addEventListener(
      "click",
      () => document.getElementById("options-button")?.click(),
    );

    const quit = this.quitButton;
    if (quit) {
      // A press on the control arms the button source. `click` is deliberately
      // NOT wired: a click is a press and a release, and a release is exactly
      // what must not confirm this.
      quit.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        // Stop the browser turning the keypress into a click on release.
        event.preventDefault();
        this.buttonHeld = true;
      });
      quit.addEventListener("keyup", (event) => {
        if (event.key === "Enter" || event.key === " ") this.buttonHeld = false;
      });
      quit.addEventListener("pointerdown", (event) => {
        this.buttonHeld = true;
        quit.setPointerCapture?.(event.pointerId);
      });
      for (const name of ["pointerup", "pointercancel", "lostpointercapture"] as const) {
        quit.addEventListener(name, () => {
          this.buttonHeld = false;
        });
      }
      /*
        The case this whole class exists to get right: focus Quit, hold Enter,
        Tab away, release. The release lands on whatever Tab moved to, so the
        button's own keyup never fires and an event-latched hold would run to
        completion off-screen. Dropping the source on blur is the first of the
        two guards; the second is in `step`, which re-tests focus every frame
        including the one that completes.
      */
      quit.addEventListener("blur", () => {
        this.buttonHeld = false;
      });
      quit.addEventListener("focusout", () => {
        this.buttonHeld = false;
      });
    }
  }

  setPaused(paused: boolean, reason?: string): void {
    if (this.panel) this.panel.hidden = !paused;
    if (this.reason && paused) this.reason.textContent = reason ?? "PAUSED";
    if (!paused) {
      this.buttonHeld = false;
      this.writeProgress(0);
    } else {
      // Focus the safe route, not the destructive one.
      this.resumeButton?.focus?.();
    }
  }

  /**
   * @param delta Seconds since the last presentation frame.
   * @param paused The race phase is `"paused"`.
   * @returns true on the frame the quit is confirmed.
   */
  step(delta: number, paused: boolean): boolean {
    const fired = stepQuitHold(
      this.hold,
      {
        paused,
        terminalOpen: this.optionsScreen ? !this.optionsScreen.hidden : false,
        actionsSuppressed: this.input.actionsSuppressed,
        escapeHeld: this.input.isHeld("Escape"),
        buttonHeld: this.buttonHeld || this.input.isGamepadCancelHeld(),
        // Re-tested every frame, so the hold cannot outlive the focus that
        // started it even by one frame.
        buttonFocused: document.activeElement === this.quitButton,
      },
      delta,
    );
    this.writeProgress(quitHoldProgress(this.hold));
    if (fired) this.quitToPaddock();
    return fired;
  }

  /**
   * Store-then-reload. The paddock reads its selections back out of the save, so
   * a reload lands on the launch screen with the circuit, format, field and
   * livery the driver had chosen, and nothing of the abandoned run survives to
   * be half-restored. A reload also tears down audio, the renderer and every
   * listener, which is the cheapest correct teardown available.
   */
  private quitToPaddock(): void {
    window.location.reload();
  }

  private writeProgress(progress: number): void {
    if (progress === this.lastProgress) return;
    this.lastProgress = progress;
    if (this.quitFill) this.quitFill.style.transform = `scaleX(${progress})`;
    if (this.quitButton) {
      this.quitButton.dataset.holding = progress > 0 ? "true" : "false";
    }
  }
}
