/** @typedef {import('./ui').HudFrame} HudFrame */
import {DRIFT_REWARD_MINIMUM_CHARGE} from './physics.js';
/** @typedef {{title: string, detail: string, action: 'thrust'|'drift'|'boost'|'release'}} DrivingHint */

/** Lessons are driven by race time and actual actions. Pausing cannot consume
 * a lesson, and a retry starts a fresh introduction without changing a save. */
export class DriverGuidance {
  lastElapsed = 0;
  leftGrid = false;
  leftGridMs = 0;
  usedBoost = false;
  bankedDrift = false;
  previousCharge = 0;

  reset() {
    this.lastElapsed = 0;
    this.leftGrid = false;
    this.leftGridMs = 0;
    this.usedBoost = false;
    this.bankedDrift = false;
    this.previousCharge = 0;
  }

  /** @param {HudFrame} frame @param {boolean} gamepad @returns {DrivingHint|null} */
  update(frame, gamepad) {
    if (frame.elapsedMs < this.lastElapsed) this.reset();
    this.lastElapsed = frame.elapsedMs;
    if (!this.leftGrid && frame.speedKph > 45) { this.leftGrid = true; this.leftGridMs = frame.elapsedMs; }
    if (frame.boostActive) this.usedBoost = true;
    if (this.previousCharge >= DRIFT_REWARD_MINIMUM_CHARGE && !frame.drifting && !frame.recoveryActive) this.bankedDrift = true;
    this.previousCharge = frame.driftCharge;
    if (!frame.raceActive || frame.recoveryActive || frame.wrongWay || frame.edgeWarning
      || frame.missedGate !== null || frame.trackEvent) return null;
    if (!this.leftGrid) {
      return {title: `${gamepad ? 'RT' : 'W / ↑'} · THRUST`, detail: 'Hold to leave the grid. Steer with ' + (gamepad ? 'the left stick.' : 'A / D.'), action: 'thrust'};
    }
    if (frame.boostLocked) {
      return {title: 'BOOST EMPTY', detail: `Release ${gamepad ? 'A' : 'Shift'} to recharge, then press again.`, action: 'release'};
    }
    // Banking is actionable feedback on every lap, not a timed tutorial.
    if (frame.drifting && frame.driftCharge >= DRIFT_REWARD_MINIMUM_CHARGE) {
      return {title: 'DRIFT BANK READY', detail: 'Release the brake to bank extra plasma.', action: 'release'};
    }
    if (frame.lap !== 1 || frame.elapsedMs - this.leftGridMs > 45000) return null;
    if (frame.turnUrgent || frame.lowGrip) return null;
    if (!this.usedBoost && frame.speedKph > 140 && frame.boost > .45 && !frame.braking
      && (!frame.turnDirection || frame.turnDistanceMeters > 220)) {
      return {title: `${gamepad ? 'A' : 'SHIFT'} · BOOST`, detail: 'Hold on a straight. Save some plasma for the exit.', action: 'boost'};
    }
    if (!this.bankedDrift && frame.turnHard && frame.turnDistanceMeters > 140
      && frame.turnDistanceMeters < 300 && frame.speedKph > 120 && !frame.drifting) {
      return {title: `${gamepad ? 'LT + STICK' : 'S + A / D'} · DRIFT`, detail: 'Brake while steering. Release to bank plasma.', action: 'drift'};
    }
    return null;
  }
}
