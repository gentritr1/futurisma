/**
 * P20.6 — the macro colour and surface features painted into the Bitterpan pan.
 *
 * Authored as `.js` rather than `.ts` for the same reason as
 * `shadow-settings.js`: `scripts/validate-art-pass.mjs` executes this file
 * under Node and re-runs the generator, so the mean-preservation claim is a
 * number the suite computes rather than a comment. Nothing here imports
 * `three`; the generator returns plain typed arrays the caller hands to
 * `BufferAttribute`s.
 *
 * The problem it solves: the pan floor is one 256 px crust tile repeated every
 * 12 m over a 6,048 m plane. At 2-20 m that is a crack pattern; past ~50 m it
 * collapses to a single khaki value, so the ground has no distance cue and the
 * map reads as a wash.
 *
 * ## Why round 1 did not fix it, and what changed
 *
 * Round 1 put a smooth two-octave noise field into vertex colours. It was
 * measurable (4.8 luma of blurred-diff against a 1.1 luma noise floor) and it
 * was invisible: a smooth gradient multiplied into a bright texture under AgX
 * flattens to nothing, and even at 4x the amplitude the contact sheet showed
 * one wash. A plain does not read as a plain because of gradients. It reads
 * because of FEATURES WITH EDGES — wind streaks running to the horizon, and
 * brine flats with shorelines.
 *
 * So the work moved into the fragment stage, where an edge can exist:
 *
 * 1. **Wind streaks** (fragment). Anisotropic ridged noise stretched 25:1 along
 *    the authored 292 degree wind, TERRACED into two bright bands (salt bloom,
 *    up to 1.22:1) and one sparser dark band (scour, 0.85:1). Terracing is the
 *    point: each streak gets a readable edge instead of a soft falloff, and on
 *    a flat plain those edges converge toward the horizon, which is the
 *    strongest depth cue a plain has.
 * 2. **Brine flats** (fragment). A thresholded region field, cool and darker,
 *    with a 2 m shoreline and a 3 m dried-salt rim just inside it. The
 *    shoreline and rim are measured in METRES on the ground, not in noise
 *    units, so they read the same size at 40 m and at 400 m.
 * 3. **Vertex colour** (this file). Two smooth octaves at ~189 m and ~47 m, now
 *    only +/-8% because the features carry the read. It is what stops the pan
 *    between features from being flat.
 * 4. **Tile break and distance fades**, unchanged from round 1: two more
 *    samples of the same crust tile at 1/37 and 1/23, and a fade of the crust
 *    detail toward the tile mean past 300 m.
 *
 * ## Aliasing, and why the features may run to the horizon
 *
 * Every threshold in the fragment stage is widened to the PIXEL FOOTPRINT
 * (`fwidth`), so a streak edge that is crisp at 50 m averages to its own mean
 * at 900 m instead of sparkling. That is what lets the streaks keep their edges
 * where they read and dissolve where they would alias, with no LOD popping and
 * no hand-tuned cutoff.
 *
 * ## Why 128 segments and not the 96 the brief suggested
 *
 * A 6,048 m plane at 96 segments has a 63 m vertex spacing, and a 63 m grid
 * cannot represent a ~45 m field at all — it aliases it into noise at the grid
 * frequency. 128 segments puts the spacing at 47.25 m, which makes both
 * authored scales exact multiples of it: 189 m (4 spacings) and 47.25 m (1).
 * The cost is 32,768 triangles on a mesh that stays ONE mesh, ONE material and
 * ONE draw call.
 *
 * ## Mean preservation
 *
 * The vertex field is mean-zero by construction and the validator re-runs it to
 * prove it. The FEATURES are not mean-zero — a brine flat is darker than what
 * it replaces — so they carry {@link PAN_FLOOR_FEATURE_TRIM}, a single lift
 * measured off race-time-matched frames rather than guessed. The bound that
 * matters is on screen: mean luma per station within +/-8 of base.
 */

/** Plane subdivision. See the Nyquist note above. */
export const PAN_FLOOR_SEGMENTS = 128;

/** Seeds the whole macro field. Pinned by the validator; changing it re-rolls
 *  the entire pan, which is an art decision, not a refactor. */
export const PAN_FLOOR_MACRO_SEED = 206_101;

/** The two authored scales, in metres. Both are exact multiples of the 47.25 m
 *  vertex spacing at {@link PAN_FLOOR_SEGMENTS}. */
export const PAN_FLOOR_COARSE_METRES = 189;
export const PAN_FLOOR_FINE_METRES = 47.25;

/**
 * Peak brightness swing of the smooth vertex field, as a multiplier deviation.
 * The field's RMS is 0.323 of this.
 *
 * Round 1 shipped 0.18 because the vertex field was the only mechanism and it
 * still did not read. With the streaks and the brine flats carrying the read,
 * this drops to 0.08 — it is now the thing that keeps the pan BETWEEN features
 * from being flat, not the feature itself.
 */
export const PAN_FLOOR_BRIGHTNESS_AMPLITUDE = 0.12;

/**
 * The hue axis, as a per-channel multiplier deviation at hue = +/-1.
 *
 * Derived, not eyeballed: warm crust #d9c9a8 and cool brine #b8bdb6 are each
 * divided by their own channel mean (so the axis carries no brightness), and
 * the half-difference is taken. The three components sum to ~0, which is why
 * swinging along this axis moves colour without moving luma.
 */
export const PAN_FLOOR_WARM_CRUST = 0xd9c9a8;
export const PAN_FLOOR_COOL_BRINE = 0xb8bdb6;

/**
 * The two authored colours, each divided by its own channel mean.
 * @param {number} hex
 * @returns {number[]}
 */
function chromaOf(hex) {
  const channels = [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255].map((v) => v / 255);
  const mean = (channels[0] + channels[1] + channels[2]) / 3;
  return channels.map((v) => v / mean);
}

export const PAN_FLOOR_HUE_DIRECTION = Object.freeze(
  chromaOf(PAN_FLOOR_WARM_CRUST).map(
    (warm, channel) => (warm - chromaOf(PAN_FLOOR_COOL_BRINE)[channel]) / 2,
  ),
);

/** Clamps, so a rare stacked extreme cannot post a garish vertex. */
export const PAN_FLOOR_BRIGHTNESS_LIMIT = 0.16;
export const PAN_FLOOR_HUE_LIMIT = 1.15;

// ---------------------------------------------------------------------------
// Where the brine flats go. The generator turns this into ONE extra float per
// vertex — `brineWeight` — and the fragment stage uses it to lower the pool
// threshold. Nothing about a pool's SHAPE is decided here: shape is procedural
// and per-pixel, because a shoreline authored on a 47 m grid is not a
// shoreline.
// ---------------------------------------------------------------------------

/** WET PAN BEND (2548 m) through BRINE CUT (2960 m), per
 *  `src/game/data/map02/CENTRELINE_STATIONS.json#intervals`. The wet sectors,
 *  where the pools are meant to be obvious. */
export const PAN_FLOOR_BRINE_FROM_METRES = 2548;
export const PAN_FLOOR_BRINE_TO_METRES = 2960;
export const PAN_FLOOR_BRINE_RAMP_METRES = 130;

/** THE LONG BASIN — S2's stretch, where a few isolated pans are wanted rather
 *  than a field of them. Weighted down by {@link PAN_FLOOR_BASIN_WEIGHT}. */
export const PAN_FLOOR_BASIN_FROM_METRES = 1_150;
export const PAN_FLOOR_BASIN_TO_METRES = 2_100;
export const PAN_FLOOR_BASIN_RAMP_METRES = 200;
export const PAN_FLOOR_BASIN_WEIGHT = 0.32;

/** How much of the pool weight the low side of the ribbon carries on its own,
 *  anywhere on the lap. */
export const PAN_FLOOR_LOW_SIDE_WEIGHT = 0.55;

/** How far off the ribbon a sector weight still reaches, in metres. */
export const PAN_FLOOR_CORRIDOR_INNER_METRES = 80;
export const PAN_FLOOR_CORRIDOR_OUTER_METRES = 340;

/** Curvature at which "the low side of the ribbon" is fully one side. Below
 *  it the term fades out, so a straight — where no side is the low one — gets
 *  no weight and no sign flicker. */
export const PAN_FLOOR_LOW_SIDE_CURVATURE = 1 / 400;

// ---------------------------------------------------------------------------
// The fragment-stage features. Every number the GLSL carries is declared here,
// so the validator can assert it and a taste pass can dial it in one place.
// ---------------------------------------------------------------------------

/**
 * The authored wind, in compass degrees, and the unit vector it becomes.
 *
 * 292 degrees is west-north-west; on a salt pan the streaks lie ALONG it. The
 * vector is (sin, cos) of the bearing in the XZ plane, matching the map's own
 * `heading_deg` convention in `CENTRELINE_STATIONS.json`.
 */
export const PAN_FLOOR_WIND_DEGREES = 292;
export const PAN_FLOOR_WIND_VECTOR = Object.freeze([
  Math.sin((PAN_FLOOR_WIND_DEGREES * Math.PI) / 180),
  Math.cos((PAN_FLOOR_WIND_DEGREES * Math.PI) / 180),
]);

/**
 * Streak geometry, in metres, and the 25:1 stretch it produces.
 *
 * A ridged noise cell 250 m along the wind by 10 m across it puts individual
 * streaks in the authored 150-400 m by 6-14 m band — the ridge transform makes
 * each crest a filament roughly a third of a cell wide, and the two thresholds
 * below cut that filament into a wide weak band and a narrow bright core.
 */
export const PAN_FLOOR_STREAK_LENGTH_METRES = 250;
export const PAN_FLOOR_STREAK_WIDTH_METRES = 10;

/**
 * The coarse streak octave, as a multiple of the fine one.
 *
 * A deliberate, disclosed addition to the authored 150-400 m by 6-14 m streak.
 * That streak is real and it reads — from about 20 m to about 120 m. Past that
 * a 10 m width is sub-pixel from a camera 1.5 m above the deck, and no amount
 * of filtering brings it back; the coarse octave (3.6x, so bands tens of metres
 * across over roughly a kilometre) is what actually converges toward the
 * horizon. Same bearing and same terrace thresholds, so the two never read as
 * two patterns.
 *
 * 8x, not the 3.6x first tried: a band has to be tens of metres across to
 * survive the 9x9 blur the acceptance metric applies, and at 3.6x it was not.
 */
export const PAN_FLOOR_STREAK_OCTAVE_SCALE = 8;

/**
 * The terrace thresholds and the steps they carry, on a ridge field in [0, 1].
 *
 * Two bright bands and one sparser dark band, so a streak has a readable EDGE
 * rather than a soft falloff. The steps are sized to the accepted contrast
 * ratios: 1 + 0.12 + 0.10 = 1.22:1 for a salt-bloom core against the crust, and
 * 1 - 0.15 = 0.85:1 for a scour streak.
 *
 * The thresholds are QUANTILES of the shipped field, not guesses. Ridged value
 * noise is not uniform — it piles up near 1, and the first cut of this pass
 * used 0.58/0.82, which fired over 90% and 40% of the ground and turned the
 * whole pan into one brighter wash.
 *
 * Measured ON SCREEN, and that distinction cost a round: a JS mirror of this
 * GLSL was written to sample the quantiles offline, and it was wrong — it put
 * the brine field's coverage at 10-20% where the frame measured 37-81%, because
 * a float32 GLSL hash and a float64 JS one do not share a distribution. The
 * mirror was deleted. To re-derive after moving a scale, render the band masks
 * straight to the framebuffer (replace the `diffuseColor.rgb *= panCrust` line
 * with `vec3( panPool, panBand( a, panStreak ), panBand( b, panStreak ) )`),
 * shoot `?floorprobe=1`, and count the channels over the pan band. At the
 * shipped values that reads 10-25% for the weak band and 3-9% for the core.
 */
export const PAN_FLOOR_STREAK_BANDS = Object.freeze([
  { threshold: 0.896, step: 0.66 },
  { threshold: 0.963, step: 0.62 },
]);
export const PAN_FLOOR_SCOUR_THRESHOLD = 0.955;
export const PAN_FLOOR_SCOUR_STEP = 0.44;
/** The scour field is the same shape at a different beat, so the dark streaks
 *  lie along the same wind without sitting on top of the bright ones. */
export const PAN_FLOOR_SCOUR_STRETCH = Object.freeze([0.71, 1.37]);

/** Brine flat region scale, in metres. Pools land in the authored 40-200 m
 *  band: a 110 m cell thresholded high leaves islands well inside its own
 *  size. */
export const PAN_FLOOR_BRINE_SCALE_METRES = 110;

/**
 * The pool threshold, from "almost never" where the pan is dry to "common" in
 * the wet sectors.
 *
 * Measured on screen the same way as the streak bands, and for the same
 * reason — the offline mirror of this field was wrong by a factor of three.
 * At the shipped values the pan band reads 12-35% pool coverage across the
 * four stations sampled, against 37-81% before they were raised.
 */
export const PAN_FLOOR_BRINE_THRESHOLD_DRY = 0.761;
export const PAN_FLOOR_BRINE_THRESHOLD_WET = 0.697;

/** Shoreline softness and the dried-salt rim inside it, in METRES on the
 *  ground — not in noise units, so they read the same size at 40 m and 400 m. */
export const PAN_FLOOR_SHORE_METRES = 2;
export const PAN_FLOOR_RIM_METRES = 3;

/**
 * What a brine flat does to the colour under it.
 *
 * `LUMA` is a multiplier in LINEAR light and the spec's "-22 luma" is a
 * DISPLAY number, so the two are not the same and the conversion was measured
 * rather than assumed. Rendering the pool over the whole pan at linear x0.795
 * moved the band's median by -7.35 display luma at two separate stations
 * (150.8 -> 143.5 and 140.9 -> 133.6). AgX is close to logarithmic over this
 * range, so that fixes the constant at 32 luma per natural log: -22 display
 * luma needs exp(-22/32) = 0.50, and +8 for the rim needs exp(8/32) = 1.284.
 *
 * The streak ratios are read the other way round, as the spec's own words
 * suggest — "light salt bloom streaks on the darker crust" is an albedo ratio,
 * so 1.22:1 and 0.85:1 are applied as LINEAR multipliers. Stated because the
 * two readings differ by a factor of three and only one of them can be right
 * per constant.
 *
 * `TINT` is #b0b8b4 divided by its own channel mean, so it carries the cool
 * cast and no brightness of its own.
 */
export const PAN_FLOOR_BRINE_COLOUR = 0xb0b8b4;
export const PAN_FLOOR_BRINE_LUMA = 0.50;

/**
 * The deeper middle of a brine flat, and how far inside the shore it takes to
 * get there.
 *
 * A salt pan's flats are not one flat tone: the rim is damp crust and the
 * middle is standing brine. Here that is also what carries the phase's own
 * floor-only metric — with a single -22 luma step the layer measured 2.10x
 * against its flat control against a 3.0x target, and the shortfall is
 * amplitude, not area (pool coverage is already ~25% and the stdev of a binary
 * field peaks at 50%). Deepening the middle raises the variation the metric
 * reads WITHOUT touching the -22 the spec pins at the shoreline.
 *
 * exp(-52/32) on the same measured AgX constant as {@link PAN_FLOOR_BRINE_LUMA}
 * — 52 display luma under the crust at the centre of a large flat. Standing
 * brine on a white pan really is that much darker than the crust around it.
 */
export const PAN_FLOOR_BRINE_DEEP_LUMA = 0.197;
export const PAN_FLOOR_BRINE_DEEP_NEAR_METRES = 4;
export const PAN_FLOOR_BRINE_DEEP_FAR_METRES = 30;
export const PAN_FLOOR_BRINE_TINT = Object.freeze(chromaOf(PAN_FLOOR_BRINE_COLOUR));
/** The dried salt edge, as a multiplier lift on the rim band. */
export const PAN_FLOOR_RIM_LIFT = 0.284;

/**
 * A single lift applied to the whole feature product, so the features do not
 * darken the pan on average.
 *
 * The streaks are net positive and the pools are much more net negative, and
 * they do not cancel on their own. Measured, not guessed: without it the
 * per-station mean-luma drift ran from -9.0 to +0.9 against the flat control.
 * 0.912 is exp(-3.0/33) on the same AgX constant as the brine constants above
 * — a -3.0 display luma cut, which centres that spread inside the accepted
 * +/-8 band. See the phase report for the station table.
 */
export const PAN_FLOOR_FEATURE_TRIM = 0.912;

/**
 * Shader-side constants, consumed by the injection in `bitterpan-surface.ts`.
 *
 * The two extra samples are taken at 1/37 and 1/23 of the base UV. Both are
 * prime, so the beat between them and the 12 m tile is 37 * 23 * 12 = 10,212 m
 * — longer than the plane, which is the point: no repeat is identifiable.
 * 1/37 puts one tile across 444 m, 1/23 across 276 m.
 */
export const PAN_FLOOR_SECONDARY_SCALE = 1 / 37;
export const PAN_FLOOR_ROTATED_SCALE = 1 / 23;
export const PAN_FLOOR_SECONDARY_BLEND = 0.42;

/**
 * Linear-space mean of `bitterpan_crust_tile_256.png`.
 *
 * The two macro samples are divided by this before they multiply the base
 * sample, which is what keeps the blend mean-preserving rather than a darken.
 * The texture is uploaded as sRGB, so `texture2D` returns linear values and
 * this is the LINEAR mean, not the 8-bit one.
 *
 * `scripts/validate-art-pass.mjs` decodes the PNG and recomputes it, so this
 * cannot drift away from the asset it describes.
 */
export const PAN_FLOOR_TILE_MEAN_LINEAR = Object.freeze([0.82285, 0.79343, 0.70993]);

/** Where the near-field opt-out ramps in, in metres of view depth. Inside
 *  {@link PAN_FLOOR_MACRO_RAMP_NEAR} the floor is bit-for-bit what it was
 *  before this phase: the 0-25 m crack pattern is not what was broken. */
export const PAN_FLOOR_MACRO_RAMP_NEAR = 16;
export const PAN_FLOOR_MACRO_RAMP_FAR = 52;

/** Where the crust detail fades toward the tile mean, in metres of view
 *  depth. Past this the pan carries macro colour only, which is what stops the
 *  far band aliasing. */
export const PAN_FLOOR_DETAIL_FADE_NEAR = 300;
export const PAN_FLOOR_DETAIL_FADE_FAR = 900;

/**
 * Where the macro colour field itself fades back out, in metres of view depth.
 *
 * A ground plane compresses vertically under perspective, so a 47 m field cell
 * that is 60 px wide at 800 m is one or two SCANLINES tall. Carried to the
 * horizon it becomes exactly the high-frequency energy this phase set out to
 * remove — measured over 13 race-time-matched stations, an unfaded field
 * raised far-band high-pass energy at 13 of them. Fog is already doing this
 * work out there (48% at 900 m in S1), so the field hands over to it.
 */
export const PAN_FLOOR_MACRO_FADE_NEAR = 500;
export const PAN_FLOOR_MACRO_FADE_FAR = 1_400;

/**
 * Where the FEATURES fade, in metres of view depth.
 *
 * Much later than the vertex field, because the streaks running toward the
 * horizon are the depth cue this round exists to deliver, and they only cost
 * the last stretch before `camera.far`.
 *
 * A cost this does NOT buy back, stated rather than implied: the far band's
 * frame-to-frame high-pass swing goes from 0.47 luma on the pre-phase build to
 * 1.22 with these features, and pulling this fade in to 700 m changed that to
 * 1.216 — i.e. not at all. The extra swing comes from the 300-700 m range,
 * where the features are supposed to read, not from the last few hundred
 * metres. It is the price of anisotropic thresholds (see `panBand`): keeping a
 * streak edge crisp along the view is the same decision as letting it flicker
 * a little as the camera moves. Fixing it means softening the edges, which is
 * the thing round 1 was rejected for.
 */
export const PAN_FLOOR_FEATURE_FADE_NEAR = 1_150;
export const PAN_FLOOR_FEATURE_FADE_FAR = 1_800;

/**
 * One node of the centreline polyline the sector biases are measured against.
 * @typedef {object} PanRibbonNode
 * @property {number} x world X
 * @property {number} z world Z
 * @property {number} rightX unit lateral, world X component
 * @property {number} rightZ unit lateral, world Z component
 * @property {number} distance metres around the lap
 * @property {number} curvature signed, 1/metres
 */

/**
 * @param {number} edge0
 * @param {number} edge1
 * @param {number} x
 * @returns {number}
 */
function smoothstep(edge0, edge1, x) {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * 32-bit integer hash. Deterministic in any JS engine: every step is
 * `Math.imul` or a shift, so nothing runs through a double.
 * @param {number} ix
 * @param {number} iy
 * @param {number} seed
 * @returns {number}
 */
function hash2(ix, iy, seed) {
  let h = Math.imul(ix | 0, 0x27d4eb2d) ^ Math.imul(iy | 0, 0x165667b1)
    ^ Math.imul(seed | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4_294_967_296;
}

/**
 * Seeded value noise on a metre grid, in [-1, 1], mean 0.
 * @param {number} x
 * @param {number} z
 * @param {number} cellMetres
 * @param {number} seed
 * @returns {number}
 */
export function panValueNoise(x, z, cellMetres, seed) {
  const fx = x / cellMetres;
  const fz = z / cellMetres;
  const ix = Math.floor(fx);
  const iz = Math.floor(fz);
  const tx = smoothstep(0, 1, fx - ix);
  const tz = smoothstep(0, 1, fz - iz);
  const c00 = hash2(ix, iz, seed);
  const c10 = hash2(ix + 1, iz, seed);
  const c01 = hash2(ix, iz + 1, seed);
  const c11 = hash2(ix + 1, iz + 1, seed);
  const low = c00 + (c10 - c00) * tx;
  const high = c01 + (c11 - c01) * tx;
  return (low + (high - low) * tz) * 2 - 1;
}

/**
 * A plateau with smooth shoulders, on a lap that wraps.
 * @param {number} distance
 * @param {number} from
 * @param {number} to
 * @param {number} ramp
 * @param {number} lapLength
 * @returns {number}
 */
function lapWindow(distance, from, to, ramp, lapLength) {
  const centre = (from + to) / 2;
  const half = (to - from) / 2;
  let delta = distance - centre;
  if (lapLength > 0) {
    delta -= Math.round(delta / lapLength) * lapLength;
  }
  return 1 - smoothstep(half, half + ramp, Math.abs(delta));
}

/**
 * The ribbon's bounding box, grown by the corridor's outer reach.
 *
 * Every vertex outside it has a corridor weight of exactly zero, so it can
 * skip the nearest-node scan entirely. That matters: the track box is about
 * 590 x 1,210 m inside a 6,048 m plane, so this retires ~93% of the 16,641
 * vertices and turns a ten-million-iteration scan into a sub-million one.
 * @param {ReadonlyArray<PanRibbonNode>} ribbon
 * @returns {{minX: number, maxX: number, minZ: number, maxZ: number}}
 */
function ribbonBounds(ribbon) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const node of ribbon) {
    if (node.x < minX) minX = node.x;
    if (node.x > maxX) maxX = node.x;
    if (node.z < minZ) minZ = node.z;
    if (node.z > maxZ) maxZ = node.z;
  }
  const reach = PAN_FLOOR_CORRIDOR_OUTER_METRES;
  return { minX: minX - reach, maxX: maxX + reach, minZ: minZ - reach, maxZ: maxZ + reach };
}

/**
 * Nearest point on the ribbon, by brute force over the supplied polyline.
 *
 * A spatial index would be faster and would be the third thing in this file
 * that has to be right; with {@link ribbonBounds} in front of it, brute force
 * is a few milliseconds once at load.
 * @param {ReadonlyArray<PanRibbonNode>} ribbon
 * @param {number} x
 * @param {number} z
 * @returns {PanRibbonNode}
 */
function nearestRibbonNode(ribbon, x, z) {
  let best = 0;
  let bestDistanceSquared = Infinity;
  for (let index = 0; index < ribbon.length; index += 1) {
    const node = ribbon[index];
    const dx = x - node.x;
    const dz = z - node.z;
    const squared = dx * dx + dz * dz;
    if (squared < bestDistanceSquared) {
      bestDistanceSquared = squared;
      best = index;
    }
  }
  return ribbon[best];
}

/**
 * Builds the per-vertex colour buffer for the pan floor.
 *
 * @param {object} options
 * @param {number} options.segments      plane subdivision, per axis
 * @param {number} options.sizeMetres    plane extent, per axis
 * @param {number} options.centreXMetres plane centre in world X
 * @param {number} options.centreZMetres plane centre in world Z
 * @param {number} options.seed
 * @param {number} options.lapLengthMetres
 * @param {ReadonlyArray<PanRibbonNode>} [options.ribbon]
 *   the centreline, for the sector biases. Omit it and the field is pure
 *   noise — which is what the validator's second run uses to bracket the mean.
 * @returns {{colors: Float32Array, brineWeights: Float32Array, vertices: number,
 *   mean: number[], extremes: {brightness: number, hue: number},
 *   biasedVertices: number, brineWeightMean: number}}
 */
export function generatePanFloorColours(options) {
  const segments = options.segments;
  const size = options.sizeMetres;
  const ribbon = options.ribbon ?? null;
  const lapLength = options.lapLengthMetres ?? 0;
  const seed = options.seed;
  const perAxis = segments + 1;
  const colors = new Float32Array(perAxis * perAxis * 3);
  const brineWeights = new Float32Array(perAxis * perAxis);
  const step = size / segments;
  const totals = [0, 0, 0];
  const bounds = ribbon ? ribbonBounds(ribbon) : null;
  let peakBrightness = 0;
  let peakHue = 0;
  let biased = 0;
  let brineTotal = 0;

  for (let row = 0; row <= segments; row += 1) {
    // PlaneGeometry runs its rows from +height/2 downward in local Y, and the
    // mesh is rotated -90 degrees about X, so local +Y is world -Z.
    const localY = size / 2 - row * step;
    const worldZ = options.centreZMetres - localY;
    for (let column = 0; column <= segments; column += 1) {
      const worldX = options.centreXMetres + (-size / 2 + column * step);

      const coarseBrightness = panValueNoise(
        worldX, worldZ, PAN_FLOOR_COARSE_METRES, seed,
      );
      const fineBrightness = panValueNoise(
        worldX, worldZ, PAN_FLOOR_FINE_METRES, seed + 1,
      );
      const coarseHue = panValueNoise(worldX, worldZ, PAN_FLOOR_COARSE_METRES, seed + 2);
      const fineHue = panValueNoise(worldX, worldZ, PAN_FLOOR_FINE_METRES, seed + 3);

      let brightness = PAN_FLOOR_BRIGHTNESS_AMPLITUDE
        * (0.68 * coarseBrightness + 0.32 * fineBrightness);
      let hue = 0.62 * coarseHue + 0.38 * fineHue;

      let brineWeight = 0;
      if (
        ribbon && bounds && worldX >= bounds.minX && worldX <= bounds.maxX
        && worldZ >= bounds.minZ && worldZ <= bounds.maxZ
      ) {
        biased += 1;
        const node = nearestRibbonNode(ribbon, worldX, worldZ);
        const lateral = (worldX - node.x) * node.rightX + (worldZ - node.z) * node.rightZ;
        const corridor = 1 - smoothstep(
          PAN_FLOOR_CORRIDOR_INNER_METRES,
          PAN_FLOOR_CORRIDOR_OUTER_METRES,
          Math.abs(lateral),
        );
        // "The low side of the ribbon" is the inside of the bend, and it fades
        // out on a straight rather than flickering between sides on the sign
        // of a curvature that is numerically zero there.
        const lowSideAxis = Math.max(
          -1,
          Math.min(1, node.curvature / PAN_FLOOR_LOW_SIDE_CURVATURE),
        );
        const lowSide = corridor * Math.max(0, lowSideAxis * (lateral >= 0 ? 1 : -1));
        const wet = lapWindow(
          node.distance,
          PAN_FLOOR_BRINE_FROM_METRES,
          PAN_FLOOR_BRINE_TO_METRES,
          PAN_FLOOR_BRINE_RAMP_METRES,
          lapLength,
        );
        const basin = lapWindow(
          node.distance,
          PAN_FLOOR_BASIN_FROM_METRES,
          PAN_FLOOR_BASIN_TO_METRES,
          PAN_FLOOR_BASIN_RAMP_METRES,
          lapLength,
        );
        brineWeight = Math.min(
          1,
          corridor * (wet + PAN_FLOOR_BASIN_WEIGHT * basin)
            + PAN_FLOOR_LOW_SIDE_WEIGHT * lowSide,
        );
      }
      brineWeights[row * perAxis + column] = brineWeight;
      brineTotal += brineWeight;

      brightness = Math.max(
        -PAN_FLOOR_BRIGHTNESS_LIMIT,
        Math.min(PAN_FLOOR_BRIGHTNESS_LIMIT, brightness),
      );
      hue = Math.max(-PAN_FLOOR_HUE_LIMIT, Math.min(PAN_FLOOR_HUE_LIMIT, hue));
      peakBrightness = Math.max(peakBrightness, Math.abs(brightness));
      peakHue = Math.max(peakHue, Math.abs(hue));

      const vertex = (row * perAxis + column) * 3;
      for (let channel = 0; channel < 3; channel += 1) {
        const value = 1 + brightness + hue * PAN_FLOOR_HUE_DIRECTION[channel];
        colors[vertex + channel] = value;
        totals[channel] += value;
      }
    }
  }

  const vertices = perAxis * perAxis;
  return {
    colors,
    brineWeights,
    vertices,
    mean: totals.map((total) => total / vertices),
    extremes: { brightness: peakBrightness, hue: peakHue },
    biasedVertices: biased,
    brineWeightMean: brineTotal / vertices,
  };
}
