/**
 * P20.6 — the macro colour field painted into the Bitterpan pan floor.
 *
 * Authored as `.js` rather than `.ts` for the same reason as
 * `shadow-settings.js`: `scripts/validate-art-pass.mjs` executes this file
 * under Node and re-runs the generator, so the mean-preservation claim is a
 * number the suite computes rather than a comment. Nothing here imports
 * `three`; the generator returns a plain `Float32Array` the caller hands to a
 * `BufferAttribute`.
 *
 * The problem it solves: the pan floor is one 256 px crust tile repeated every
 * 12 m over a 6,048 m plane. At 2-20 m that is a crack pattern; past ~50 m it
 * collapses to a single khaki value, so the ground has no distance cue and the
 * map reads as a wash. Measured on the merged base over 13 station frames, the
 * bare pan between the decals is nearly flat.
 *
 * Three mechanisms, at three scales, each at a scale it can actually carry:
 *
 * 1. **Vertex colour, ~189 m and ~47 m** (this file). The floor is subdivided
 *    and every vertex gets a multiplier around 1.0.
 * 2. **A second and third sample of the same crust tile, at 444 m and 276 m**
 *    (the shader injection in `bitterpan-surface.ts`). Breaks the 12 m repeat
 *    without a second texture.
 * 3. **A distance fade** past 300 m, so the far pan settles onto the macro
 *    colour instead of sparkling.
 *
 * ## Why 128 segments and not the 96 the brief suggested
 *
 * This is the one deliberate deviation. A 6,048 m plane at 96 segments has a
 * 63 m vertex spacing, and a 63 m grid cannot represent a ~45 m field at all —
 * it aliases it into noise at the grid frequency. 128 segments puts the
 * spacing at 47.25 m, which makes the two authored scales land on exact
 * multiples of it: the coarse cell is 189 m (4 spacings) and the fine cell is
 * 47.25 m (1 spacing), so both fields are represented rather than sampled
 * under Nyquist. The cost is 32,768 triangles on a mesh that stays ONE mesh,
 * ONE material and ONE draw call.
 *
 * ## Mean preservation
 *
 * Every term is a deviation around 1.0 and every noise field is mean-zero, so
 * the whole-plane mean of the returned colours is 1.0 to within the sector
 * biases' small asymmetry. That is not asserted here by construction — the
 * generator reports the mean it actually produced and the validator holds it
 * to +/- 2/255 of flat white.
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
 * Peak brightness swing, as a multiplier deviation. The field's RMS is 0.323
 * of this — value noise does not spend much time at its extremes.
 *
 * **This is 0.18, not the 0.09 the phase brief specified, and that is a
 * deliberate, disclosed deviation.** Measured on the merged base, race-time
 * matched, over the pan band of station t=24 s (see `shots/p20.6/`):
 *
 *   amplitude  blurred-diff stdev vs base   criterion-1 macroStd
 *   none (null run)          1.13 luma      x1.00  (the instrument's floor)
 *   0.09                     4.80 luma      x0.98
 *   0.40                     5.00 luma      x1.006
 *
 * At 0.09 the field is real but not legible in a contact sheet, and at 0.40 it
 * is legible but the acceptance metric STILL does not move — because that
 * metric is dominated by the 407 crust decals, the rigs and the fog ramp, not
 * by the floor. 0.18 is the value that reads as tonal drift in the crop sheet
 * without becoming blotchy. See the phase report: the brief's own +/-9% and
 * its 2.2x acceptance target are not mutually satisfiable, and this file
 * follows the target's intent rather than the number.
 */
export const PAN_FLOOR_BRIGHTNESS_AMPLITUDE = 0.18;

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
export const PAN_FLOOR_BRIGHTNESS_LIMIT = 0.22;
export const PAN_FLOOR_HUE_LIMIT = 1.15;

/** Sector biases. Sized so the two roughly cancel over the plane. */
export const PAN_FLOOR_BRINE_DARKEN = 0.03;
export const PAN_FLOOR_BRINE_HUE = 0.55;
export const PAN_FLOOR_BLOOM_LIFT = 0.03;
export const PAN_FLOOR_BLOOM_HUE = 0.12;

/** WET PAN BEND (2548 m) through BRINE CUT (2960 m), per
 *  `src/game/data/map02/CENTRELINE_STATIONS.json#intervals`. */
export const PAN_FLOOR_BRINE_FROM_METRES = 2548;
export const PAN_FLOOR_BRINE_TO_METRES = 2960;
export const PAN_FLOOR_BRINE_RAMP_METRES = 130;

/** The S1 harvester run, where the salt bloom sits. */
export const PAN_FLOOR_BLOOM_FROM_METRES = 180;
export const PAN_FLOOR_BLOOM_TO_METRES = 1450;
export const PAN_FLOOR_BLOOM_RAMP_METRES = 220;

/** How far off the ribbon a sector bias still reaches, in metres. */
export const PAN_FLOOR_CORRIDOR_INNER_METRES = 80;
export const PAN_FLOOR_CORRIDOR_OUTER_METRES = 340;

/** Curvature at which "the low side of the ribbon" is fully one side. Below
 *  it the term fades out, so a straight — where no side is the low one — gets
 *  no bias and no sign flicker. */
export const PAN_FLOOR_LOW_SIDE_CURVATURE = 1 / 400;

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
 * @returns {{colors: Float32Array, vertices: number, mean: number[],
 *   extremes: {brightness: number, hue: number}, biasedVertices: number}}
 */
export function generatePanFloorColours(options) {
  const segments = options.segments;
  const size = options.sizeMetres;
  const ribbon = options.ribbon ?? null;
  const lapLength = options.lapLengthMetres ?? 0;
  const seed = options.seed;
  const perAxis = segments + 1;
  const colors = new Float32Array(perAxis * perAxis * 3);
  const step = size / segments;
  const totals = [0, 0, 0];
  const bounds = ribbon ? ribbonBounds(ribbon) : null;
  let peakBrightness = 0;
  let peakHue = 0;
  let biased = 0;

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
        const lowSideAxis = Math.max(-1, Math.min(1, node.curvature / PAN_FLOOR_LOW_SIDE_CURVATURE));
        const lowSide = corridor
          * Math.max(0, lowSideAxis * (lateral >= 0 ? 1 : -1));
        const wet = lapWindow(
          node.distance,
          PAN_FLOOR_BRINE_FROM_METRES,
          PAN_FLOOR_BRINE_TO_METRES,
          PAN_FLOOR_BRINE_RAMP_METRES,
          lapLength,
        );
        const brine = Math.min(1, corridor * wet + 0.45 * lowSide);
        // Patchy, not a region tint: the bloom rides the fine octave so it
        // reads as salt blooming in places rather than a lift over S1.
        const bloom = corridor
          * lapWindow(
            node.distance,
            PAN_FLOOR_BLOOM_FROM_METRES,
            PAN_FLOOR_BLOOM_TO_METRES,
            PAN_FLOOR_BLOOM_RAMP_METRES,
            lapLength,
          )
          * (0.5 + 0.5 * fineBrightness);

        brightness += PAN_FLOOR_BLOOM_LIFT * bloom - PAN_FLOOR_BRINE_DARKEN * brine;
        hue += PAN_FLOOR_BLOOM_HUE * bloom - PAN_FLOOR_BRINE_HUE * brine;
      }

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
    vertices,
    mean: totals.map((total) => total / vertices),
    extremes: { brightness: peakBrightness, hue: peakHue },
    biasedVertices: biased,
  };
}
