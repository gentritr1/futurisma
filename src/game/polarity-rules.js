export const FLIP_SECONDS = 1.05;
export const FLIP_COOLDOWN_SECONDS = 6;
export const CEILING_HEIGHT = 22;
export const SURGE_SECONDS = 3;
export const SHIELD_SECONDS = 5;

/** @typedef {"surge" | "shield"} PowerKind */
/** @typedef {{id:string,from:number,to:number,fromLane:0|1,toLane:0|1,excursion:0|1}} TransferWindow */
/** Four committed decisions, shared by geometry, simulation and signage. @type {readonly TransferWindow[]} */
export const TRANSFER_WINDOWS = [
  { id: "crown-entry", from: .035, to: .09, fromLane: 0, toLane: 1, excursion: 0 },
  { id: "crown-exit", from: .425, to: .49, fromLane: 1, toLane: 0, excursion: 0 },
  { id: "skyline-entry", from: .54, to: .60, fromLane: 0, toLane: 1, excursion: 1 },
  { id: "skyline-exit", from: .925, to: .985, fromLane: 1, toLane: 0, excursion: 1 },
];

/** @param {number} progress @returns {TransferWindow | undefined} */
export function transferWindowAt(progress) {
  const p = ((progress % 1) + 1) % 1;
  return TRANSFER_WINDOWS.find((window) => p >= window.from && p < window.to);
}

/** @param {number} amount */
export function smoothTransfer(amount) {
  const t = Math.max(0, Math.min(1, amount));
  return t * t * (3 - 2 * t);
}

/**
 * A surge adds thrust above the normal limiter; letting go settles smoothly.
 * @param {number} previousSpeed
 * @param {number} normalSpeed Speed after the standard limiter (at most112m/s).
 * @param {number} throttle
 * @param {number} brake
 * @param {boolean} active
 * @param {number} delta
 */
export function integrateSurgeSpeed(previousSpeed, normalSpeed, throttle, brake, active, delta) {
  const step = Math.max(0, Math.min(.05, delta));
  if (active && throttle > .1 && brake < .15) {
    return Math.min(140, Math.max(normalSpeed, previousSpeed + (38 * throttle - 25 * brake) * step));
  }
  return Math.min(normalSpeed, 112) + Math.max(0, previousSpeed - 112) * Math.exp(-(3 + brake * 4) * step);
}

/** @param {number} from @param {number} to @param {number} target */
export function crossedPickup(from, to, target) {
  const delta = ((to - from) % 1 + 1) % 1;
  const ahead = ((target - from) % 1 + 1) % 1;
  return delta > 0 && delta < .05 && ahead > 0 && ahead <= delta;
}
