/**
 * P6 minimap geometry. Everything here is pure and dependency-free so
 * `scripts/validate-minimap.mjs` can exercise the exact code the runtime draws
 * with, without a TypeScript build, a DOM or a WebGL context. `minimap.ts`
 * owns the canvas; this module owns the maths.
 */

/** Stations sampled around the lap for the cached course outline. */
export const OUTLINE_STATION_COUNT = 128;

/** Radar half-depth: a rival further ahead/behind than this is not shown. */
export const RADAR_LONGITUDINAL_RANGE_METERS = 80;

/** Radar half-width: a rival further off-lane than this is not shown. */
export const RADAR_LATERAL_RANGE_METERS = 20;

/** Inside this separation the radar leaves its low-contrast idle state. */
export const RADAR_ALERT_RANGE_METERS = 25;

/**
 * @typedef {{ minX: number; maxX: number; minZ: number; maxZ: number }} OutlineBounds
 */

/**
 * @typedef {{
 *   stationCount: number;
 *   points: Float64Array;
 *   bounds: OutlineBounds;
 * }} CourseOutline
 */

/**
 * @typedef {{
 *   length: number;
 *   sample: (progress: number, target?: any) => { position: { x: number; z: number } };
 *   createSampleScratch?: () => any;
 * }} OutlineSampler
 */

/**
 * Clamps into [0, 1]. Written as a negated comparison so a NaN input lands on
 * 0 instead of leaking through as NaN and silently drawing off-canvas.
 * @param {number} value
 */
function clamp01(value) {
  if (!(value > 0)) return 0;
  return value < 1 ? value : 1;
}

/**
 * Samples the shared `RaceCourse` interface into a flat XZ point ring.
 *
 * Stations are spaced `i / (stationCount - 1)`, so the final station lands on
 * progress 1.0 which every course implementation wraps back onto progress 0.
 * That makes the ring explicitly closed — first and last points coincide — and
 * lets the canvas stroke the outline without a separate `closePath()`.
 *
 * Only `length` and `sample()` are touched, so this works unchanged on both
 * `GreenwaterCourse` and `BitterpanCourse`.
 *
 * @param {OutlineSampler} course
 * @param {number} [stationCount]
 * @returns {CourseOutline}
 */
export function buildCourseOutline(course, stationCount = OUTLINE_STATION_COUNT) {
  if (!Number.isInteger(stationCount) || stationCount < 4) {
    throw new Error(
      `Minimap outline needs at least 4 integer stations; got ${stationCount}.`,
    );
  }
  const points = new Float64Array(stationCount * 2);
  const scratch = typeof course.createSampleScratch === "function"
    ? course.createSampleScratch()
    : undefined;
  const span = stationCount - 1;
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let index = 0; index < stationCount; index += 1) {
    const sample = course.sample(index / span, scratch);
    const x = sample.position.x;
    const z = sample.position.z;
    if (!Number.isFinite(x) || !Number.isFinite(z)) {
      throw new Error(`Minimap outline station ${index} sampled a non-finite point.`);
    }
    points[index * 2] = x;
    points[index * 2 + 1] = z;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  return { stationCount, points, bounds: { minX, maxX, minZ, maxZ } };
}

/**
 * Samples an open route branch including its exact junctions. Cached once by
 * the minimap; the default is enough for a short bypass without a per-frame
 * course query.
 * @param {OutlineSampler} course
 * @param {number} from
 * @param {number} to
 * @param {number} [stationCount]
 * @returns {Float64Array}
 */
export function buildCourseSegment(course, from, to, stationCount = 32) {
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from
    || !Number.isInteger(stationCount) || stationCount < 2) {
    throw new Error("Minimap branch needs an ordered span and at least two stations.");
  }
  const points = new Float64Array(stationCount * 2);
  const scratch = course.createSampleScratch?.();
  for (let index = 0; index < stationCount; index++) {
    const progress = from + (to - from) * index / (stationCount - 1);
    const position = course.sample(progress, scratch).position;
    if (!Number.isFinite(position.x) || !Number.isFinite(position.z)) {
      throw new Error(`Minimap branch station ${index} sampled a non-finite point.`);
    }
    points[index * 2] = position.x;
    points[index * 2 + 1] = position.z;
  }
  return points;
}

/**
 * @typedef {{ scale: number; offsetX: number; offsetY: number }} OutlineTransform
 */

/**
 * Uniform aspect-preserving fit of a course bounding box into a padded panel.
 * Greenwater is near-square (1.03:1) and Bitterpan is tall (0.47:1), so the
 * scale is taken from whichever axis binds first and the result is centred.
 *
 * @param {OutlineBounds} bounds
 * @param {number} width
 * @param {number} height
 * @param {number} [padding]
 * @returns {OutlineTransform}
 */
export function fitOutlineTransform(bounds, width, height, padding = 0) {
  const spanX = Math.max(bounds.maxX - bounds.minX, 1e-6);
  const spanZ = Math.max(bounds.maxZ - bounds.minZ, 1e-6);
  const innerWidth = Math.max(width - padding * 2, 1);
  const innerHeight = Math.max(height - padding * 2, 1);
  const scale = Math.min(innerWidth / spanX, innerHeight / spanZ);
  return {
    scale,
    offsetX: padding + (innerWidth - spanX * scale) / 2 - bounds.minX * scale,
    offsetY: padding + (innerHeight - spanZ * scale) / 2 - bounds.minZ * scale,
  };
}

/**
 * Places a rival on the short-range radar in normalised panel coordinates.
 *
 * `x` runs 0 (20 m to the player's left) to 1 (20 m right); `y` runs 0 (80 m
 * ahead) to 1 (80 m behind) so that "ahead" is up on screen. Returns `null`
 * for anything outside the box — the caller draws nothing rather than pinning
 * a misleading dot to the rim.
 *
 * @param {number} longitudinalMeters positive ahead of the player
 * @param {number} lateralMeters positive to the player's right
 * @returns {{ x: number; y: number } | null}
 */
export function projectRivalToRadar(longitudinalMeters, lateralMeters) {
  if (!Number.isFinite(longitudinalMeters) || !Number.isFinite(lateralMeters)) {
    return null;
  }
  if (Math.abs(longitudinalMeters) > RADAR_LONGITUDINAL_RANGE_METERS) return null;
  if (Math.abs(lateralMeters) > RADAR_LATERAL_RANGE_METERS) return null;
  return {
    x: clamp01(
      (lateralMeters + RADAR_LATERAL_RANGE_METERS)
        / (RADAR_LATERAL_RANGE_METERS * 2),
    ),
    y: clamp01(
      (RADAR_LONGITUDINAL_RANGE_METERS - longitudinalMeters)
        / (RADAR_LONGITUDINAL_RANGE_METERS * 2),
    ),
  };
}

/**
 * Straight-line separation used for the 25 m alert threshold. Kept beside the
 * projection so the radar's "is anyone close" test and its dot placement can
 * never disagree about what the two offsets mean.
 *
 * @param {number} longitudinalMeters
 * @param {number} lateralMeters
 */
export function radarSeparationMeters(longitudinalMeters, lateralMeters) {
  if (!Number.isFinite(longitudinalMeters) || !Number.isFinite(lateralMeters)) {
    return Infinity;
  }
  return Math.hypot(longitudinalMeters, lateralMeters);
}
