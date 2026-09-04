// H3 review harness (not part of the shipped game).
//
// THE NUMBER `STEAM_PUFF_PEAK_ALPHA` COMES FROM.
//
// A puff card's envelope peak is not what the player sees. Six cards leave the
// vent 0.16 s apart and rise at 1.5 m/s, so consecutive cards stand 0.24 m
// apart while they are 1.2-3.2 m across — they overlap almost entirely, and
// transparency composites as `1 - prod(1 - a_i)`. What the plume shows through
// its middle is therefore several times one card's alpha, and "not opaque
// against any background" is a statement about the plume.
//
// So this walks the vent's whole 4 s cycle and the plume's own screen plane,
// running exactly the maths `course.ts` runs — the `sin(pi * age^0.75)`
// envelope, the 1.5 m/s rise, the 1.2 -> 3.2 m growth, the outboard drift and
// the wobble — and composites every live card through the STEAM cell's measured
// radial falloff. It reports the worst pixel in the cycle.
//
// The screen plane is (rise, lateral): the billboard faces the camera, so both
// separate two cards in the frame. The along-track offset does not — head-on it
// is pure depth — so it is deliberately not modelled, which is the conservative
// direction.
//
// Usage: node scripts/visual/steam-puff-stack.mjs [peak] [life] [interval] [count]
// Defaults are the shipped constants. Measured on them:
//
//   peak 0.450 -> plume 0.857    peak 0.300 -> plume 0.700
//   peak 0.220 -> plume 0.574    peak 0.180 -> plume 0.497
//   peak 0.155 -> plume 0.443  <- shipped
//
// `scripts/validate-lighting.mjs` runs the same walk against the constants
// parsed out of `course.ts`, so this script is where a new number is FOUND and
// the validator is where it is HELD.

/** The STEAM cell's measured radial alpha; see the block in `course.ts`. */
const STOPS = [
  1, 0.905, 0.846, 0.77, 0.685, 0.633, 0.55, 0.487,
  0.418, 0.346, 0.297, 0.227, 0.172, 0.11, 0.063, 0.026,
];

export function steamSheetAlpha(radius, stops = STOPS) {
  if (radius >= 1) return 0;
  const scaled = radius * stops.length - 0.5;
  const low = Math.max(0, Math.min(stops.length - 1, Math.floor(scaled)));
  const high = Math.min(stops.length - 1, low + 1);
  const blend = Math.max(0, Math.min(1, scaled - low));
  const value = stops[low] + (stops[high] - stops[low]) * blend;
  return radius > 0.875 ? value * ((1 - radius) / 0.125) : value;
}

/**
 * @param {object} options every constant `course.ts` carries, by its own name.
 * @returns {{ plumeAlpha: number, cardAlpha: number, at: object }}
 */
export function measureSteamPlume(options) {
  const {
    peakAlpha,
    lifeSeconds,
    intervalSeconds,
    puffsPerVent,
    birthMetres,
    deathMetres,
    riseMetresPerSecond,
    baseHeightMetres,
    driftMetresPerSecond,
    telegraphSeconds,
    cycleSeconds,
    stops = STOPS,
  } = options;
  const wobbleMetres = 0.5;
  let plumeAlpha = 0;
  let cardAlpha = 0;
  let at = null;
  const timeSteps = Math.round(cycleSeconds * 1000);
  for (let step = 0; step < timeSteps; step += 1) {
    const time = (step / timeSteps) * cycleSeconds;
    const live = [];
    for (let index = 0; index < puffsPerVent; index += 1) {
      const age = (time - telegraphSeconds - index * intervalSeconds) / lifeSeconds;
      if (age < 0 || age > 1) continue;
      const alpha = Math.sin(Math.PI * age ** 0.75) * peakAlpha;
      cardAlpha = Math.max(cardAlpha, alpha);
      live.push({
        alpha,
        y: baseHeightMetres + age * lifeSeconds * riseMetresPerSecond,
        x: age * lifeSeconds * driftMetresPerSecond
          + Math.sin(age * 8) * age * wobbleMetres,
        radius: (birthMetres + (deathMetres - birthMetres) * age) / 2,
      });
    }
    if (live.length === 0) continue;
    for (let yStep = 0; yStep <= 240; yStep += 1) {
      const y = (yStep / 240) * 6;
      for (let xStep = 0; xStep <= 120; xStep += 1) {
        const x = -1.5 + (xStep / 120) * 4.5;
        let clear = 1;
        for (const card of live) {
          const radius = Math.hypot(y - card.y, x - card.x) / card.radius;
          clear *= 1 - card.alpha * steamSheetAlpha(radius, stops);
        }
        const composite = 1 - clear;
        if (composite > plumeAlpha) {
          plumeAlpha = composite;
          at = {
            cycleSeconds: Number(time.toFixed(3)),
            heightMetres: Number(y.toFixed(2)),
            lateralMetres: Number(x.toFixed(2)),
            liveCards: live.length,
          };
        }
      }
    }
  }
  return { plumeAlpha, cardAlpha, at };
}

/** The shipped constants, mirrored from `course.ts` and the blockout. */
export const SHIPPED_STEAM_PUFF = Object.freeze({
  peakAlpha: 0.155,
  lifeSeconds: 2.1,
  intervalSeconds: 0.16,
  puffsPerVent: 6,
  birthMetres: 1.2,
  deathMetres: 3.2,
  riseMetresPerSecond: 1.5,
  baseHeightMetres: 0.7,
  driftMetresPerSecond: 0.55,
  telegraphSeconds: 1,
  cycleSeconds: 4,
});

const isMain = process.argv[1]
  && import.meta.url.endsWith(process.argv[1].split("/").pop());
if (isMain) {
  const options = {
    ...SHIPPED_STEAM_PUFF,
    peakAlpha: Number(process.argv[2] ?? SHIPPED_STEAM_PUFF.peakAlpha),
    lifeSeconds: Number(process.argv[3] ?? SHIPPED_STEAM_PUFF.lifeSeconds),
    intervalSeconds: Number(process.argv[4] ?? SHIPPED_STEAM_PUFF.intervalSeconds),
    puffsPerVent: Number(process.argv[5] ?? SHIPPED_STEAM_PUFF.puffsPerVent),
  };
  const result = measureSteamPlume(options);
  console.log(JSON.stringify({
    cardPeakAlpha: Number(result.cardAlpha.toFixed(3)),
    plumePeakAlpha: Number(result.plumeAlpha.toFixed(3)),
    at: result.at,
    lastPuffDiesAt: Number(
      (options.telegraphSeconds
        + (options.puffsPerVent - 1) * options.intervalSeconds
        + options.lifeSeconds).toFixed(3),
    ),
    cycleSeconds: options.cycleSeconds,
  }, null, 2));
}
