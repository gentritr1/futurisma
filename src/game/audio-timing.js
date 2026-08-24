export const MUSIC_LOOP_BEATS = 16;
export const MUSIC_STEM_SAMPLE_RATE = 24_000;

/**
 * Returns the current or next rhythmic boundary relative to a shared origin.
 * @param {number} now
 * @param {number} origin
 * @param {number} interval
 */
export function nextQuantizedTime(now, origin, interval) {
  if (interval <= 0) return Math.max(now, origin);
  if (now <= origin) return origin;
  const elapsed = now - origin;
  const boundary = Math.ceil((elapsed - 1e-7) / interval);
  return origin + boundary * interval;
}

/**
 * @param {number} now
 * @param {number} deadline
 * @param {number} interval
 */
export function fixedRateUpdateDue(now, deadline, interval) {
  if (interval <= 0) return true;
  return now + interval * 0.05 >= deadline;
}

/**
 * Advances from the previous deadline so display-frame quantization does not
 * lower the long-run update rate. Large stalls skip backlog instead of bursting.
 * @param {number} now
 * @param {number} deadline
 * @param {number} interval
 */
export function advanceFixedRateDeadline(now, deadline, interval) {
  if (interval <= 0) return now;
  const next = deadline + interval;
  return next <= now ? now + interval : next;
}

/** @param {number} value */
function clampStemLevel(value) {
  return Math.min(3, Math.max(0, Math.round(value)));
}

/**
 * Encodes four validated 0-3 stem levels as a collision-free base-four key.
 * @param {number} trance
 * @param {number} jungle
 * @param {number} deepDnb
 * @param {number} techstep
 */
export function encodeMusicProfileKey(trance, jungle, deepDnb, techstep) {
  return clampStemLevel(trance)
    + clampStemLevel(jungle) * 4
    + clampStemLevel(deepDnb) * 16
    + clampStemLevel(techstep) * 64;
}

/**
 * Samples scheduled linear automation so an interrupted crossfade can hold its
 * audible value instead of jumping to the previous target.
 * @param {number} now
 * @param {number} from
 * @param {number} target
 * @param {number} start
 * @param {number} end
 */
export function sampleLinearAutomation(now, from, target, start, end) {
  if (end <= start || now >= end) return target;
  if (now <= start) return from;
  const amount = (now - start) / (end - start);
  return from + (target - from) * amount;
}
