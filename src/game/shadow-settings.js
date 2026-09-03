import { activeRenderMode } from "./render-mode.js";

/**
 * P20.1 — directional shadow mapping from the key light.
 *
 * Before this module the renderer ran with `shadowMap.enabled = false`, so every
 * structure on the Bitterpan salt pan met the ground with no contact edge and
 * the craft hovered with no cue that it was hovering. This owns the whole
 * decision surface for the one shadow-casting light in the game: whether
 * shadows run at all, how big the map is, where the orthographic shadow frustum
 * sits, and how it is snapped so it does not shimmer under a 300 km/h camera.
 *
 * Everything here is presentation. Nothing in this module is visible to
 * physics, lap timing or the HUD, and `?shadows=0` must restore the pre-phase
 * frame exactly.
 *
 * Authored as `.js` for the same reason `render-quality.js` and
 * `lighting-motion.js` are: `scripts/validate-shadows.mjs` executes this maths
 * under Node, which it cannot do to a `.ts` file. No runtime `three` import
 * either — the vector functions only read and write vectors handed to them —
 * and no `window` at module scope; the query is read lazily and guarded.
 *
 * The three-dependent half is shadows.ts, imported only by game.ts and
 * atmosphere.ts. The cast flags on the world families are NOT gated on
 * `shadowsEnabled()`, because `renderer.shadowMap.enabled = false` makes
 * three's shadow pass return before it reads a single `castShadow` and emits
 * shader programs with no `USE_SHADOWMAP` define, so the flags are already
 * inert under the kill switch. One switch beats ten. It is also what keeps this
 * module out of the shared-chunk hot path: when seven lazy modules imported it,
 * Rollup made it the most-shared module in the graph, moved 350 KiB of `three`
 * behind it and cost the initial shell 1.7 KiB gzip for nothing.
 */

/**
 * The default map size. 2048 over a 140 m box is a 6.8 cm texel — fine enough
 * that the craft's stabiliser ring reads as a ring rather than a blob, which is
 * the whole point of the contact cue. 1024 halves that and was measured against
 * it; see docs/PERFORMANCE_BASELINE.md.
 */
export const SHADOW_MAP_SIZE = 2048;
/** Legal map sizes for the `?shadowMap=` A/B lever. Powers of two only. */
export const SHADOW_MAP_SIZES = [512, 1024, 2048, 4096];
/**
 * Side of the orthographic shadow box, in metres. 140 m covers the corridor
 * plus the trackside massing that shadows it; wider trades texel density for
 * structures whose shadows never reach the road anyway.
 */
export const SHADOW_BOX_METRES = 140;
/**
 * How far ahead of the chase camera the box is centred, along the camera's own
 * forward. The camera sits behind and above the craft, so centring on the
 * camera itself would spend a third of the box on road already driven.
 */
export const SHADOW_LOOKAHEAD_METRES = 45;
/**
 * Distance from the box centre back along the key direction to the light. Must
 * match `KEY_LIGHT_DISTANCE` in atmosphere.ts: a DirectionalLight only reads the
 * direction, so this number decides nothing about the lighting, only where the
 * shadow camera's near plane sits relative to the casters.
 */
export const SHADOW_LIGHT_DISTANCE_METRES = 160;
/**
 * Near/far of the shadow camera, measured from the light. The tallest authored
 * massing on either map is under 70 m, and a 140 m box seen from a 56-74 degree
 * sun spans about 80 m along the light axis, so [40, 280] clears both ends with
 * margin while keeping the depth range tight enough for the bias below.
 */
export const SHADOW_CAMERA_NEAR_METRES = 40;
export const SHADOW_CAMERA_FAR_METRES = 280;
/**
 * Depth bias, in shadow-map depth units. Small and negative: the normal bias
 * below does the acne work, and a large depth bias is what detaches a shadow
 * from the object casting it.
 */
export const SHADOW_BIAS = -0.0004;
/**
 * World-space offset along the receiving surface normal, in metres. At the
 * 2048 map size this is 1.2 texels — enough to kill acne on the near-flat deck
 * without moving the craft's shadow out from under the craft.
 */
export const SHADOW_NORMAL_BIAS = 0.085;
/**
 * How dark a fully shadowed sample gets on an authored-absolute unlit surface
 * (see {@link createShadowedUnlitMaterial}), as a linear multiplier. Lit
 * surfaces do not use this: they lose the key contribution and keep the
 * hemisphere fill, and that is what decides their shadow value.
 *
 * Measured, not guessed. `BP_PAN_FLOOR` is Lambert and sits alongside the deck,
 * so it is the reference: under the conveyor span at Bitterpan 2900 m its lit
 * luma is ~130 and its shadowed luma ~86 (30x30 crops, Rec.709, 8-bit), which
 * is 0.223 -> 0.094 in linear, a ratio of 0.42. The deck is given the same
 * ratio so the shadow does not change value where it crosses from pan to deck.
 * See scripts/visual/crop-luma.py for the measurement.
 */
export const SHADOW_UNLIT_FLOOR = 0.42;

/**
 * Memo so the query is parsed once, like `activeRenderMode()`.
 * @type {boolean | null}
 */
let cachedEnabled = null;
/** @type {number | null} */
let cachedMapSize = null;

/**
 * `?shadows=0` (or `=off`/`=false`) is the kill switch. `?render=ps2` forces
 * shadows off whatever the flag says: that mode's contract is era-accuracy, and
 * a 2048 PCF soft shadow is the single most anachronistic thing this renderer
 * could put on screen.
 *
 * Pure so the validator can assert the truth table without a browser.
 */
/**
 * @param {string | null | undefined} raw the `?shadows=` value
 * @param {string} mode the active render mode
 * @returns {boolean}
 */
export function resolveShadowsEnabled(raw, mode) {
  if (mode === "ps2") return false;
  const value = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (value === "0" || value === "off" || value === "false" || value === "no") {
    return false;
  }
  return true;
}

/** Parses `?shadowMap=`; anything unknown falls back to the default. */
/**
 * @param {string | null | undefined} raw
 * @returns {number}
 */
export function resolveShadowMapSize(raw) {
  const value = Number.parseInt(typeof raw === "string" ? raw : "", 10);
  return SHADOW_MAP_SIZES.includes(value) ? value : SHADOW_MAP_SIZE;
}

/**
 * @param {string} name
 * @returns {string | null}
 */
function searchValue(name) {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get(name);
}

/** Whether this page load renders shadows at all. Memoized on first read. */
/** @returns {boolean} */
export function shadowsEnabled() {
  if (cachedEnabled === null) {
    cachedEnabled = resolveShadowsEnabled(
      searchValue("shadows"),
      activeRenderMode(),
    );
  }
  return cachedEnabled;
}

/** The shadow map edge in texels for this page load. Memoized on first read. */
/** @returns {number} */
export function shadowMapSize() {
  if (cachedMapSize === null) {
    cachedMapSize = resolveShadowMapSize(searchValue("shadowMap"));
  }
  return cachedMapSize;
}

/** World size of one shadow-map texel, in metres. */
/**
 * @param {number} [mapSize]
 * @returns {number}
 */
export function shadowTexelMetres(mapSize = shadowMapSize()) {
  return SHADOW_BOX_METRES / mapSize;
}



/**
 * The light-space basis the shadow camera will build for itself.
 *
 * This has to match `Object3D.lookAt` exactly, because the snapping below only
 * removes shimmer if it rounds in the *same* grid the shadow camera rasterises
 * in. `lookAt` with the default up gives z = normalize(eye - target), which for
 * a light placed along `direction` from the target is `direction` itself, then
 * x = normalize(up x z) and y = z x x.
 *
*/
/**
 * @param {import("three").Vector3} direction unit vector from the box centre
 *   toward the light
 * @param {import("three").Vector3} right written with the light-space X axis
 * @param {import("three").Vector3} up written with the light-space Y axis
 */
export function shadowBasis(direction, right, up) {
  right.set(0, 1, 0).cross(direction);
  if (right.lengthSq() === 0) {
    // Straight overhead: `up x z` collapses. `Matrix4.lookAt` handles this by
    // nudging the LOOK axis by 1e-4, not the up vector, and this reproduces
    // that exactly rather than approximating it — a basis that disagrees with
    // the shadow camera's own by even a rotation would make the texel snapping
    // below round in the wrong grid, which buys nothing and is invisible in a
    // still. Neither map's sun reaches 89 degrees, so this branch exists only
    // so the function is total; `scripts/validate-shadows.mjs` drives it.
    up.copy(direction);
    up.z += 0.0001;
    up.normalize();
    right.set(0, 1, 0).cross(up).normalize();
    up.cross(right).normalize();
    return;
  }
  right.normalize();
  up.copy(direction).cross(right).normalize();
}

/**
 * Rounds the shadow box centre onto the texel grid so the shadow map samples
 * the same world points from frame to frame. Without this the whole map
 * resamples every frame as the camera translates and every shadow edge crawls —
 * the classic moving-cascade shimmer, and very visible at 300 km/h.
 *
 * The depth component is deliberately left unsnapped: it does not affect which
 * texel a world point lands in.
 */
/**
 * @param {import("three").Vector3} centre the unsnapped box centre
 * @param {import("three").Vector3} direction unit vector toward the light
 * @param {number} texelMetres world size of one shadow-map texel
 * @param {import("three").Vector3} right scratch, written with the X axis
 * @param {import("three").Vector3} up scratch, written with the Y axis
 * @param {import("three").Vector3} out receives the snapped centre
 * @returns {import("three").Vector3} `out`
 */
export function snapShadowCentre(centre, direction, texelMetres, right, up, out) {
  shadowBasis(direction, right, up);
  const x = Math.round(centre.dot(right) / texelMetres) * texelMetres;
  const y = Math.round(centre.dot(up) / texelMetres) * texelMetres;
  const z = centre.dot(direction);
  return out
    .set(0, 0, 0)
    .addScaledVector(right, x)
    .addScaledVector(up, y)
    .addScaledVector(direction, z);
}

