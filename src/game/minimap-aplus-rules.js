/** Pure state decisions for the opt-in A+ renderer. Distances never wrap:
 * a lapped rival can share a map location without becoming a nearby opponent. */

/** @param {{ orderedCheckpointCount: number, checkpointProgress: (i: number) => number }} course */
export function aplusGates(course) {
  return Array.from({ length: course.orderedCheckpointCount }, (_, index) => {
    const progress = course.checkpointProgress(index);
    if (!Number.isFinite(progress) || progress < 0 || progress >= 1) {
      throw new Error(`A+ received an invalid checkpoint at ${index}.`);
    }
    return progress;
  });
}

/** Uses the race's gate verdict, never just a geometric crossing. A missed
 * gate stays a warning and cannot accidentally become a celebration.
 * @param {string} text
 * @param {number} gateCount includes the finish line at index zero
 */
export function aplusGateState(text, gateCount) {
  const clear = /^GATE (\d+) CLEAR$/.exec(text);
  const next = /^NEXT GATE (\d+)/.exec(text);
  const missed = /^GATE (\d+) MISSED/.exec(text);
  const cleared = clear ? Number(clear[1]) : null;
  const index = cleared === null ? Number(next?.[1] ?? missed?.[1] ?? 0) : (cleared + 1) % gateCount;
  return {
    next: Math.min(gateCount - 1, Math.max(0, index)),
    sector: cleared === null ? null : Math.min(gateCount, cleared + 1),
    missed: text.includes("MISSED"),
  };
}

export class AplusRivalFocus {
  /** @type {number[]} */
  previousGaps = [];
  passed = -1;
  holdUntil = 0;

  reset() {
    this.previousGaps.length = 0;
    this.passed = -1;
    this.holdUntil = 0;
  }

  /** @param {number[]} gaps @param {number[]} separations @param {number} now */
  update(gaps, separations, now) {
    let nearest = -1;
    let nearestDistance = 25;
    for (let index = 0; index < gaps.length; index++) {
      const distance = separations[index];
      if (distance <= nearestDistance) { nearest = index; nearestDistance = distance; }
      if (this.previousGaps[index] > 0 && gaps[index] <= 0 && distance <= 25) {
        this.passed = index;
        this.holdUntil = now + 0.9;
      }
      this.previousGaps[index] = gaps[index];
    }
    this.previousGaps.length = gaps.length;
    return now < this.holdUntil && this.passed < gaps.length
      && separations[this.passed] <= 25 ? this.passed : nearest;
  }
}
