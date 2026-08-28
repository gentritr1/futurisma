import { integrateDriftCharge, resolveDriftRelease } from "./physics";

/**
 * P5 drift bank. Holds the charge state and the release accounting behind one
 * seam so the race loop only forwards drift state it already tracks and applies
 * the payout it gets back. All of the integration is the pure physics pair —
 * this class stores, it does not compute a rate of its own.
 */
export class DriftBank {
  /** Current bank, 0..1. Read by the HUD and by diagnostics. */
  charge = 0;
  /** Drift entries. The bank already sees the edge, so it owns the count. */
  entries = 0;
  /** Peak smoothed drift intensity, which the bank is fed every step. */
  maximumIntensity = 0;
  /** Releases that cleared the minimum charge and paid out. */
  rewards = 0;
  /** Total reserve paid out by those releases. */
  rewardTotal = 0;
  /**
   * The bank the most recent rewarded release paid out from. `charge` is zeroed
   * by that release, so the feedback layer reads this instead to pitch its cue.
   */
  releaseCharge = 0;
  private wasDrifting = false;

  reset(): void {
    this.charge = 0;
    this.entries = 0;
    this.maximumIntensity = 0;
    this.rewards = 0;
    this.rewardTotal = 0;
    this.releaseCharge = 0;
    this.wasDrifting = false;
  }

  /**
   * Clears the bank without touching its counters. Used when the race loop
   * teleports the vehicle back onto the course: the drift ends because of a
   * recovery, not because the player released it, so it must not pay out.
   */
  abandon(): void {
    this.charge = 0;
    this.wasDrifting = false;
  }

  /**
   * Diagnostics contribution, spread into the race snapshot. `driftEntries`
   * stays first so the emitted key order is unchanged from before P5.
   */
  diagnostics(): {
    driftEntries: number;
    maxDriftIntensity: number;
    driftCharge: number;
    driftRewards: number;
    driftRewardTotal: number;
  } {
    return {
      driftEntries: this.entries,
      maxDriftIntensity: this.maximumIntensity,
      driftCharge: this.charge,
      driftRewards: this.rewards,
      driftRewardTotal: this.rewardTotal,
    };
  }

  /**
   * Advances the bank one step and returns the reserve payout for this step,
   * which is zero on every step that is not a rewarded drift release.
   */
  update(driftActive: boolean, driftIntensity: number, delta: number): number {
    if (driftActive && !this.wasDrifting) this.entries += 1;
    this.maximumIntensity = Math.max(this.maximumIntensity, driftIntensity);
    const release = resolveDriftRelease(this.charge, this.wasDrifting, driftActive);
    if (release.consumed) {
      this.releaseCharge = this.charge;
      this.charge = 0;
      this.rewards += 1;
      this.rewardTotal += release.reward;
    }
    this.charge = integrateDriftCharge(
      this.charge,
      driftActive ? driftIntensity : 0,
      delta,
    );
    this.wasDrifting = driftActive;
    return release.reward;
  }
}
