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
