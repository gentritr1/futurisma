/**
 * H1.5 — the chase camera's sight-line pull, as two pure functions.
 *
 * (Named for what survived. This began as `edge-ridge.js` with a table and a
 * polyline test; the measurement below is why neither is here.)
 *
 * WHAT THIS IS NOT. The first version of this module carried an edge-ridge
 * table and a 2D polyline test, on the premise that the occluder was a parapet
 * running along the deck edge. Measurement said otherwise: at craft lateral
 * -11.0 with the camera at -3.5 the first thing on the sight line is
 * `GW_SECTOR_GREENWATER_SWEEP_concrete` at lateral -8.47, 2.92 m above the
 * deck — inside the racing surface, not at its edge. A table derived from
 * P21's corridor sweep could not have found it either: that sweep reports
 * `obstacle: 0, overhead: 0` for Greenwater, because it classifies the authored
 * surface against the blockout deck and this occluder IS that disagreement.
 *
 * So the test is a real raycast against the authored environment, gated so it
 * runs on the few frames that can occlude (see `castSightLine` in game.ts) and cast
 * from the CAMERA, because the authored meshes are `FrontSide` and a ray
 * travelling up from the craft meets their undersides as backfaces and reports
 * clear. What is left here is the arithmetic either approach would need: how far to
 * pull in, and how fast to let go.
 */

/**
 * How far to pull the camera in, given where the sight line is blocked.
 *
 * Zero when nothing blocks, so the guard is inert on every clear frame. The
 * result never takes the camera nearer than `minimumDistance`: past that the
 * craft fills the frame and the cure is worse than a parapet.
 *
 * @param {number} cameraDistance metres from the hull to the desired camera
 * @param {number} blockedAt metres along that segment where the ridge stands
 * @param {number} backOff how far short of the ridge to stop
 * @param {number} minimumDistance floor on the resulting camera distance
 */
export function occlusionPull(cameraDistance, blockedAt, backOff, minimumDistance) {
  if (!Number.isFinite(cameraDistance) || !Number.isFinite(blockedAt)) return 0;
  if (blockedAt >= cameraDistance) return 0;
  const wanted = Math.max(minimumDistance, blockedAt - backOff);
  if (wanted >= cameraDistance) return 0;
  return cameraDistance - wanted;
}

/**
 * One step of the pull's rate limit.
 *
 * Pulling IN is immediate: the frame that discovers the parapet is the frame
 * the craft would otherwise vanish in, and easing into the correction would
 * ship exactly the bug this guard exists to remove. Letting the camera back OUT
 * is rate limited, because that is where a pop would be visible — the sight
 * line clears in one frame and an unlimited recovery would snap the camera
 * several metres backwards.
 *
 * @param {number} current metres currently pulled in
 * @param {number} target metres wanted this frame
 * @param {number} delta seconds
 * @param {number} recoveryRate metres per second, outward only
 */
export function integrateOcclusionPull(current, target, delta, recoveryRate) {
  if (!Number.isFinite(current) || !Number.isFinite(target)) return 0;
  if (target >= current) return target;
  if (!Number.isFinite(delta) || delta <= 0) return current;
  return Math.max(target, current - recoveryRate * delta);
}
