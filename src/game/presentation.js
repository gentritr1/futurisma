/**
 * Returns the fixed-step remainder used to interpolate the previous and current
 * simulation poses for rendering.
 * @param {number} accumulator
 * @param {number} fixedStep
 */
export function calculatePresentationAlpha(accumulator, fixedStep) {
  if (!Number.isFinite(accumulator) || !Number.isFinite(fixedStep) || fixedStep <= 0) {
    return 0;
  }
  return Math.min(1, Math.max(0, accumulator / fixedStep));
}

/**
 * P11 — the banked deck's height at a lateral offset.
 *
 * `course.sample()` rotates `right` and `up` by the authored bank, so the
 * drivable surface at lateral `L` is `centre + right * L`. Its world height is
 * therefore the centreline height plus `right.y * L`, and `right.y` is exactly
 * `sin(bank)`. Anything that derives a world pose from (progress, lateral) and
 * takes the centreline `y` alone buries the craft into the high side of a
 * banked corner and floats it over the low side — on the 12 degree
 * GREENWATER_SWEEP that is 0.208 m of error per metre of lateral.
 *
 * Presentation only. The race loop's own `position` is the simulation's state:
 * `course.project()` and the demo autopilot both read it back, so moving its
 * `y` would move progress and lateral on the next fixed step and the lap clock
 * with them. The lift is applied to the interpolated presentation copy instead.
 *
 * @param {number} rightY `sample.right.y`, i.e. sin(bank).
 * @param {number} lateral signed metres from the centreline.
 */
export function bankedSurfaceLift(rightY, lateral) {
  if (!Number.isFinite(rightY) || !Number.isFinite(lateral)) return 0;
  return rightY * lateral;
}

/**
 * P16 — the apron cross-section's contribution to that height. A correctness
 * fix in its own right, and NOT the fix for the run-off report.
 *
 * `bankedSurfaceLift` extrapolates the deck's bank plane at any lateral, which
 * is right on the deck and incomplete past its edge: `createApronDecks` builds
 * the run-off in that same banked plane but then displaces it along `up` by the
 * edge's cross-section — `outerRise`, which is -0.12 m on a gravel shoulder,
 * +0.14 m on a structure rumble and 0 on open run-off. Presentation never added
 * that term, so on the shoulder the craft hovered 0.12 m over the drawn gravel
 * and on the rumble it sank 0.14 m into it.
 *
 * That is worth fixing and worth being honest about: at 0.14 m it is nowhere
 * near the reported symptom, which measured 5.24 m of overshoot past the
 * visible wall. Shipping this as the answer to that report would have been a
 * fix aimed at the wrong order of magnitude.
 *
 * Zero on the deck, so the P11 clamp probe's pinned pose is untouched.
 *
 * @param {number} upY `sample.up.y`, i.e. cos(bank).
 * @param {number} surfaceHeight `surfaceHeightAtLateral(sample, lateral)`.
 */
export function apronSurfaceLift(upY, surfaceHeight) {
  if (!Number.isFinite(upY) || !Number.isFinite(surfaceHeight)) return 0;
  return upY * surfaceHeight;
}

/** @param {number} value @param {number} minimum @param {number} maximum */
function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

/** @param {number} value @param {number} minimum @param {number} maximum */
function smoothstep(value, minimum, maximum) {
  const normalized = clamp((value - minimum) / (maximum - minimum), 0, 1);
  return normalized * normalized * (3 - 2 * normalized);
}

/**
 * Keeps chase-camera streaks absent at low speed and restrained at race pace.
 * @param {number} speedRatio
 * @param {number} driftIntensity
 * @param {boolean} reducedMotion
 */
export function calculateSpeedStreakOpacity(
  speedRatio,
  driftIntensity,
  reducedMotion,
) {
  const speed = Number.isFinite(speedRatio) ? clamp(speedRatio, 0, 1) : 0;
  const drift = Number.isFinite(driftIntensity)
    ? clamp(driftIntensity, 0, 1)
    : 0;
  return Math.min(
    0.36,
    smoothstep(speed, 0.44, 0.94) * (reducedMotion ? 0.07 : 0.26)
      + drift * (reducedMotion ? 0.015 : 0.08),
  );
}

/**
 * Streak length communicates velocity without adding more particles or draws.
 * @param {number} speedRatio
 * @param {boolean} boostActive
 * @param {boolean} reducedMotion
 */
export function calculateSpeedStreakLength(
  speedRatio,
  boostActive,
  reducedMotion,
) {
  const speed = Number.isFinite(speedRatio) ? clamp(speedRatio, 0, 1) : 0;
  if (reducedMotion) return 0.45 + speed * 0.55 + (boostActive ? 0.2 : 0);
  return 0.65 + speed * 2.6 + (boostActive ? 1.6 : 0);
}

/**
 * The full presentation height offset for a pose on the drivable surface: the
 * bank plane plus the apron cross-section. Composed here rather than at the call
 * site because `game.ts` sits on a hard 1,950-line seam budget, and because the
 * two terms are one answer to one question — where is the drawn surface.
 *
 * @param {number} rightY `sample.right.y`.
 * @param {number} lateral signed metres from the centreline.
 * @param {number} upY `sample.up.y`.
 * @param {number} surfaceHeight `surfaceHeightAtLateral(sample, lateral)`.
 */
export function presentationSurfaceLift(rightY, lateral, upY, surfaceHeight) {
  return bankedSurfaceLift(rightY, lateral) + apronSurfaceLift(upY, surfaceHeight);
}

/**
 * H1 - the lateral a presentation point is REALLY at, recovered from its
 * horizontal offset alone.
 *
 * The simulation stores `position.y` at the centreline height, so the stored
 * point sits below the banked deck plane and `course.project()` hands back
 * `lateral * cos^2(bank)` for it. The horizontal offset, though, is untouched
 * by both the flattening and by any height lift, so dividing it by the
 * horizontal length of `right` recovers the true lateral exactly. That is what
 * makes the clearance below a real measurement rather than a restatement of the
 * lift: nothing that writes `y` can move this number.
 *
 * @param {number} offsetX `point.x - sample.position.x`.
 * @param {number} offsetZ `point.z - sample.position.z`.
 * @param {number} rightX `sample.right.x`.
 * @param {number} rightZ `sample.right.z`.
 */
export function lateralFromHorizontalOffset(offsetX, offsetZ, rightX, rightZ) {
  const horizontalSq = rightX * rightX + rightZ * rightZ;
  if (!Number.isFinite(horizontalSq) || horizontalSq <= 1e-9) return 0;
  const projected = offsetX * rightX + offsetZ * rightZ;
  if (!Number.isFinite(projected)) return 0;
  return projected / horizontalSq;
}

/**
 * H1 - the vertical gap between the craft and the DRAWN surface under it.
 *
 * Deliberately independent of `presentationSurfaceLift`: the lateral it is
 * evaluated at comes from `lateralFromHorizontalOffset`, which no height write
 * can influence, so a lift applied twice, once too little, or not at all all
 * show up here. Equals `hoverHeight * upY` exactly when the lift is applied
 * once and only once.
 *
 * @param {number} vehicleY world Y of the placed hull.
 * @param {number} centreY `sample.position.y`.
 * @param {number} rightY `sample.right.y`, i.e. sin(bank).
 * @param {number} upY `sample.up.y`, i.e. cos(bank).
 * @param {number} lateral from `lateralFromHorizontalOffset`.
 * @param {number} surfaceHeight `surfaceHeightAtLateral(sample, lateral)`.
 */
export function hullClearance(vehicleY, centreY, rightY, upY, lateral, surfaceHeight) {
  if (
    !Number.isFinite(vehicleY) || !Number.isFinite(centreY)
    || !Number.isFinite(rightY) || !Number.isFinite(upY)
    || !Number.isFinite(lateral) || !Number.isFinite(surfaceHeight)
  ) return 0;
  return vehicleY - (centreY + rightY * lateral + upY * surfaceHeight);
}
