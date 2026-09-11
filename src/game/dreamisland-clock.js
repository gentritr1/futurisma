/** Clockwise radians viewed from the face. Exact zero at/after the strike.
 * No accumulated rotation: replay, restore and every render rate agree.
 * @param {number} tick @param {number|null} strikeTick */
export function dreamIslandClockAngles(tick, strikeTick) {
  const fraction = strikeTick && strikeTick > 0 ? Math.max(0, Math.min(1, tick / strikeTick)) : 0;
  return {
    minute: fraction === 1 ? 0 : fraction * Math.PI * 2,
    hour: fraction === 1 ? 0 : (fraction - 1) * Math.PI / 2,
  };
}
