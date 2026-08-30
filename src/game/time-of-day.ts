/**
 * The lap's time-of-day drift, published for layers that are not lighting.
 *
 * `RaceAtmosphere` already resolves the drift every frame from the authored
 * 5-stop ramp (`resolveTimeOfDayDrift`), and it is the only thing allowed to
 * decide it. P18 needs the same number in a dynamically-imported art layer —
 * the Bitterpan facade window strips cross-fade from DEAD to DUSK on it — and
 * `game.ts` sits on a hard 1,950-line seam budget, so the value is latched here
 * rather than threaded through another constructor argument.
 *
 * Same shape as `activeRenderMode()` in render-mode.js: one module-level read,
 * no subscription, no allocation, and it reads 0 until the atmosphere has run
 * once — which is the identity stop (HARD_NOON), so a layer that samples early
 * gets the unlit state rather than a guess.
 */

let drift = 0;

/** Called by `RaceAtmosphere.updateFog` and by nothing else. */
export function publishTimeOfDayDrift(value: number): void {
  drift = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

/** The current drift, 0 at stop 0 (HARD_NOON) and 1 at the last stop. */
export function timeOfDayDrift(): number {
  return drift;
}
