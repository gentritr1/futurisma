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
