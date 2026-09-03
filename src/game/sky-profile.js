/**
 * P20.5 — the sky stops being the ground.
 *
 * Until this phase the dome's `horizonColor` WAS the sector fog colour, so the
 * whole framed sky (a chase camera sees roughly 0-25 degrees of elevation) was
 * a wash of the same hue as the deck it drove over. On Bitterpan that made the
 * upper sky khaki at 20% saturation — the same pigment as the pan, one value
 * apart — and the frame read as one material. Greenwater had the same coupling;
 * its grey-green fog against a brown deck just hid it better.
 *
 * The fix is authored sky: every sector now declares its own `horizon` (a pale
 * haze band that sits ABOVE the fog) and `zenith`, and the fog colour survives
 * only in the bottom `SKY_FOG_FADE_DEGREES` so distant geometry still melts
 * into it. `blendDegrees` is where the haze has fully resolved into the zenith.
 *
 * Why the tables live here and not in the two course modules:
 * - `course.ts` (Greenwater) is a 253 KiB lazy chunk and
 *   `BITTERPAN_PRODUCTION.json` a 12 KiB one. `atmosphere.ts` is in the initial
 *   shell, which validate-build holds to 226 KiB gzip with under half a KiB of
 *   slack — importing either from the atmosphere would drag a whole map's data
 *   into every first paint.
 * - Bitterpan's numbers are AUTHORED in
 *   `src/game/data/map02/BITTERPAN_PRODUCTION.json` under `lighting.profiles[]`
 *   and mirrored here; Greenwater's sector distances mirror
 *   `SECTOR_PALETTE_DEFINITIONS` in `course.ts`. Both mirrors are pinned by
 *   scripts/validate-lighting.mjs, which fails if the JSON and this file ever
 *   disagree by a single digit. The mirror is the price of the bundle split and
 *   it is not allowed to drift silently.
 *
 * Pure data and pure functions: no three.js here, so the validator can exercise
 * the real numbers in Node.
 */

/** Degrees of elevation over which the sector fog hands over to the haze. */
export const SKY_FOG_FADE_DEGREES = 1.5;
/** Elevation at which the haze plateau ends and the zenith ramp starts. */
export const SKY_HAZE_TOP_DEGREES = 2.4;

/**
 * Greenwater. Humid and overcast: a low sun, a sky with body rather than a
 * clean gradient, and a haze that stays cooler and paler than the sector fog
 * beneath it. Distances mirror `SECTOR_PALETTE_DEFINITIONS` in course.ts.
 */
export const GREENWATER_SKY_ZONES = Object.freeze([
  { sector: "RUNWAY_START", distance: 0, horizon: 0x6f8794, zenith: 0x1b2c36, blendDegrees: 20 },
  { sector: "T1_CRADLE_BEND", distance: 221.998, horizon: 0x6c8491, zenith: 0x1a2b35, blendDegrees: 20 },
  { sector: "WATER_TABLE", distance: 377.997, horizon: 0x63838f, zenith: 0x172a33, blendDegrees: 20 },
  { sector: "LINK_APRON", distance: 587.996, horizon: 0x5e7c88, zenith: 0x16262f, blendDegrees: 19 },
  { sector: "HANGAR_SIX", distance: 617.996, horizon: 0x4e6a76, zenith: 0x111d25, blendDegrees: 18 },
  { sector: "HANGAR_EXIT", distance: 817.994, horizon: 0x547079, zenith: 0x131f28, blendDegrees: 18 },
  { sector: "GREENWATER_SWEEP", distance: 847.994, horizon: 0x5e8085, zenith: 0x15272c, blendDegrees: 20 },
  { sector: "CANOPY_PASSAGE", distance: 1129.992, horizon: 0x5b7d76, zenith: 0x142622, blendDegrees: 21 },
  { sector: "THE_ELBOW", distance: 1481.99, horizon: 0x5e7f78, zenith: 0x152723, blendDegrees: 21 },
  { sector: "FUEL_ROW", distance: 1591.989, horizon: 0x67837e, zenith: 0x172925, blendDegrees: 20 },
  { sector: "T10_TOTEM_TURN", distance: 2121.985, horizon: 0x5c7783, zenith: 0x14222b, blendDegrees: 19 },
  { sector: "RUNWAY_HOME", distance: 2255.984, horizon: 0x6f8794, zenith: 0x1b2c36, blendDegrees: 20 },
]);

/**
 * Bitterpan. A salt pan at noon: pale hot ground under a deep desaturated
 * blue-grey overhead that falls to a pale, slightly COOLER haze at the horizon.
 * Mirrors `lighting.profiles[].sky*` in BITTERPAN_PRODUCTION.json.
 */
export const BITTERPAN_SKY_ZONES = Object.freeze([
  { sector: "S1", distance: 60, horizon: 0x768d9c, zenith: 0x1a2835, blendDegrees: 20 },
  { sector: "S2", distance: 1610, horizon: 0x7a92a1, zenith: 0x1c2b38, blendDegrees: 20 },
  { sector: "S3", distance: 2550, horizon: 0x728b9e, zenith: 0x182634, blendDegrees: 20 },
]);

/**
 * The accent band the dome has drawn at the horizon line since P4. It is the
 * sector rim colour, and against the old fog-coloured sky it was the loudest
 * thing in the frame. It stays — it is a navigation cue — but on Bitterpan it
 * now sits under a pale authored haze it was fighting, so its strength drops to
 * a third. Greenwater keeps most of it: its sky is darker and the band reads as
 * the low sun it always was.
 */
export const SKY_BAND_STRENGTH = Object.freeze({
  greenwater: 0.34,
  bitterpan: 0.19,
});

/**
 * The procedural cloud band, evaluated inside the dome's own fragment shader —
 * zero extra draw calls, zero geometry.
 *
 * - `coverage` the share of the band the puffs cover. The shader stretches the
 *   noise distribution before thresholding so this number means what it says.
 * - `softness` the edge width, in the same units.
 * - `strength` the linear-light contrast added before tone mapping. Tuned to
 *   the brief's +/-14 luma ceiling against the framed sky, NOT guessed: the
 *   measured AgX response near the zenith is ~620 output luma per unit of
 *   linear light, so a peak add of `lit * 0.8 * strength` with a key colour at
 *   ~0.77 linear luma lands at 0.05 -> ~19 luma peak, ~5 luma stdev.
 * - `driftPerSecond` is in TURNS OF AZIMUTH per second, not lattice cells: the
 *   layer rotates. The brief's ceiling is 0.004/s and reduced motion pins the
 *   phase, so it never advances at all.
 * - `azimuthPeriod` the integer number of noise cells around the horizon —
 *   integer so the value-noise lattice wraps and there is no seam at due east.
 *   The two maps use different periods, which is what makes their cloud
 *   arrangements genuinely different rather than the same sky rotated.
 * - `seed` the starting phase, in turns. Fractional on purpose: an integer
 *   would multiply by `azimuthPeriod` into a whole number of lattice cells and
 *   land back on the unseeded pattern.
 *
 * Greenwater is overcast: more coverage, softer edges. Bitterpan is a dust sky:
 * sparse high streaks, harder edges, barely there.
 */
export const CLOUD_PROFILES = Object.freeze({
  greenwater: Object.freeze({
    coverage: 0.52,
    softness: 0.3,
    strength: 0.3,
    driftPerSecond: 0.0035,
    azimuthPeriod: 16,
    lowDegrees: 4,
    highDegrees: 30,
    shadowCool: 0.55,
    seed: 0.37,
  }),
  bitterpan: Object.freeze({
    coverage: 0.28,
    softness: 0.16,
    strength: 0.075,
    driftPerSecond: 0.0022,
    azimuthPeriod: 23,
    lowDegrees: 4,
    highDegrees: 30,
    shadowCool: 0.7,
    seed: 0.71,
  }),
});

/** Hard ceiling from the P20.5 brief; the validator pins both maps under it. */
export const CLOUD_MAX_DRIFT_PER_SECOND = 0.004;

/** @param {"greenwater" | "bitterpan"} kind */
export function skyZonesFor(kind) {
  return kind === "bitterpan" ? BITTERPAN_SKY_ZONES : GREENWATER_SKY_ZONES;
}

/** @param {"greenwater" | "bitterpan"} kind */
export function cloudProfileFor(kind) {
  return kind === "bitterpan" ? CLOUD_PROFILES.bitterpan : CLOUD_PROFILES.greenwater;
}

/** @param {"greenwater" | "bitterpan"} kind */
export function bandStrengthFor(kind) {
  return kind === "bitterpan" ? SKY_BAND_STRENGTH.bitterpan : SKY_BAND_STRENGTH.greenwater;
}

/**
 * @param {number} edge0
 * @param {number} edge1
 * @param {number} value
 */
function smoothstep(edge0, edge1, value) {
  if (edge1 <= edge0) return value < edge0 ? 0 : 1;
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Which two authored zones the sky is between at `distance`, and how far.
 *
 * Deliberately the same shape as `lightingAt`'s crossfade in course.ts — the
 * sky must change sector on the same metre the palette does, or a sector seam
 * becomes two seams. Returns indices rather than colours so the caller can lerp
 * in whatever colour space it owns; this module stays free of three.js.
 *
 * @param {readonly {distance: number}[]} zones
 * @param {number} distance metres around the lap
 * @param {number} lapLength
 * @param {number} crossfadeMetres
 * @param {{index: number, next: number, amount: number}} [target]
 */
export function resolveSkyBlend(zones, distance, lapLength, crossfadeMetres, target = {
  index: 0,
  next: 0,
  amount: 0,
}) {
  const wrapped = lapLength > 0
    ? ((distance % lapLength) + lapLength) % lapLength
    : distance;
  let index = 0;
  for (let i = 1; i < zones.length; i += 1) {
    if (zones[i].distance > wrapped) break;
    index = i;
  }
  const next = (index + 1) % zones.length;
  const zoneEnd = index === zones.length - 1 ? lapLength : zones[next].distance;
  const start = Math.max(zones[index].distance, zoneEnd - crossfadeMetres);
  target.index = index;
  target.next = next;
  target.amount = wrapped <= start ? 0 : smoothstep(start, zoneEnd, wrapped);
  return target;
}
