import * as THREE from "three";
import {
  type RaceCourse,
  type CourseSample,
} from "./course";
import { searchParam } from "./query-probes";
import {
  gustScudAlphaScale,
  gustScudClockSeconds,
  gustScudProgressAt,
  noteScudRoadCrossing,
  saltLampsSolid,
  squallRainAlphaGain,
  squallRainSpeedGain,
} from "./track-events";
import {
  ALPHA_ENVELOPES,
  buildLivingWorld,
  CARD_TRIANGLES,
  LIVING_WORLD_SPECS,
  LIVING_WORLD_UPDATE_HZ,
  type AlphaKind,
  type AtlasRect,
  type AuthoredCard,
  type LivingBatchSpec,
  type LivingWorldSpec,
} from "./living-world-zones.js";

const UPDATE_STEP_SECONDS = 1 / LIVING_WORLD_UPDATE_HZ;
const CARD_VERTICES = 4;
/** A dust devil turns on `card.speed` but climbs on this, shared with its alpha. */
const DEVIL_CLIMB_HZ = 0.11;
/** Heat shimmer breathes on its own slow cycle rather than on the card speed. */
const SHIMMER_PERIOD_SECONDS = 6.5;
/**
 * P20.4. Frustum census rate for `stats.visibleCards`.
 *
 * A diagnostics number, not a render one: it walks every card and builds a
 * bounding sphere per card, so it runs four times a second rather than thirty.
 * Nothing in the frame depends on it — `mesh.frustumCulled` is false on every
 * batch and stays false, because a batch is one buffer and culling it would
 * cull the whole lap.
 */
const VISIBILITY_SAMPLE_HZ = 4;

/**
 * P20.10 — THE CARD THAT WENT THROUGH THE LENS.
 *
 * THE DEFECT, MEASURED. On a Bitterpan demo lap, 91.3% of the world crop
 * (rows 130-560, cols 0-1100 of 1280x720) came back darkened by 25 luma or more
 * against the same race instant with `?living=0`, against a self-difference
 * noise floor of 15.2% — `scripts/visual/slab-census.mjs`, race 7516 ms, pair
 * drift 8 ms. The frame is a dark wall: sky, pan, rigs and rivals all gone.
 *
 * WHERE IT COMES FROM, and it is not where the phase brief assumed. The card
 * responsible at that instant is PAN_REFINERY_FAR — a 59 x 56 m HORIZON
 * silhouette — 1.3 m from the camera. `living-world-zones.js` places a card at
 * `sample.right * (halfWidth + lateral)` from its own station, and the far-field
 * zones author `lateral` at 460-1500 m. Bitterpan is a 3050 m CLOSED LOOP whose
 * footprint is a few hundred metres across, so those offsets do not go to the
 * horizon: they cross the basin and land on the far side of the track. The
 * offender above is authored at station 2390 m, side -1, lateral 871 m, and
 * resolves to world (1.2, 510.9) — on the deck at station ~500, where the craft
 * drives through it once a lap.
 *
 * Five zones on four batches were measured passing inside 6 m of the chase
 * camera on one lap (closest approach, card size at that tick):
 *
 *   PAN_HAZE_BAND         0.09 m   204 x 20 m   horizonAir
 *   PAN_HEAT_SHIMMER_FAR  0.59 m   128 x 10 m   horizonAir
 *   PAN_REFINERY_FAR      0.94 m    59 x 56 m   horizon
 *   PAN_RIG_FIELD_FAR     1.13 m    38 x 19 m   horizon
 *   PAN_SCUD_CROSSING     2.18 m    13 x  3 m   air
 *   BRINE_HAZE_LOW        2.99 m    35 x  3 m   air
 *   PAN_SCUD_NEAR         4.62 m    15 x  8 m   air
 *
 * WHY THE EARLIER FADE MEASURED NOTHING. G3 tried a camera-proximity fade on
 * the crossing scud, saw no change and reverted it. Reproduced here by gating
 * the fade below to PAN_SCUD_CROSSING alone and re-running the census: 94.6%,
 * i.e. the baseline. The crossing card is real and does fly through the camera
 * — it is fourth on that list — but it is 13 x 3 m at an envelope ceiling of
 * 0.32, and the frame-filler beside it is a 59 x 56 m silhouette at alpha 1.
 * A fade scoped to one zone, or to the two near batches, cannot answer this;
 * the rule has to be the layer's.
 *
 * THE RULE. Every camera-facing card on every non-lamp batch fades out as the
 * camera reaches it: alpha x 0 at 6 m and closer, x 1 at 18 m and beyond,
 * smoothstep between. Three things about its shape are load-bearing.
 *
 *   IT IS MEASURED TO THE NEAREST POINT OF THE QUAD, NOT TO ITS CENTRE. A
 *   PAN_SCUD_NEAR card sits 2-8 m outboard of the deck edge and is 8-18 m wide,
 *   so when its near edge is in the camera's lap its centre is still 6-13 m
 *   away — outside any centre-based cutoff that does not also fade cards the
 *   driver is supposed to see. `nearestQuadDistance` clamps the camera offset
 *   onto the quad's own span first, so a wide card starts fading when its EDGE
 *   arrives. This is the other half of why a first attempt can measure nothing.
 *
 *   IT IS APPLIED TO THE RESOLVED ALPHA, alongside the G3 event gains, rather
 *   than to an envelope or an authored ceiling. `ALPHA_ENVELOPES` is pinned by
 *   `validate-living-world.mjs` and the corridor rule is asserted against it; a
 *   fade that moved those numbers would have changed what is authored instead
 *   of what is drawn. Multiplying at the end can only ever LOWER an alpha, so
 *   every corridor and envelope assertion still holds by construction.
 *
 *   THE LAMP BATCHES ARE EXCLUDED. `updateLampColors` rewrites their alpha to 1
 *   after this runs, so a fade there would be dead code — and it must stay dead
 *   code: UNDERPASS_HAZARD_LAMPS passes 13 m from the camera and holding it
 *   SOLID is G3's salt-drop telegraph. Dimming a hazard lamp because the driver
 *   got close to it is the one thing this rule must not do.
 *
 * 18 m keeps every telegraph that matters: PAN_SCUD_CROSSING has to be readable
 * on the road 40-120 m ahead, where the scale is 1, and the horizon silhouettes
 * this removes are only ever removed at ranges no horizon is authored for.
 */
const NEAR_FADE_ZERO_METERS = 6;
const NEAR_FADE_FULL_METERS = 18;

/**
 * ...AND THE HALF OF THE RULE A FIXED 6/18 m BAND CANNOT EXPRESS.
 *
 * 6 m and 18 m are the right numbers for a card the size of a scud - 8-18 m
 * wide, so at 18 m it is a shape on the road rather than a wall. They are the
 * wrong numbers for the far field, and that is arithmetic rather than taste: a
 * PAN_MESA_LINE card is 240-320 m wide, and the horizontal cross-section of a
 * 1280x720 frustum at distance d is about 1.9 d, so a 280 m card STILL FILLS
 * THE FRAME at 70 m - four times outside a fixed 18 m band. Measured: with the
 * flat band applied to every non-lamp batch, the census maximum fell from 91.3%
 * to 64.5%, and hiding `BP_LIVING_HORIZON` at that same frame took the same
 * statistic to 3.2% (shots/p20.10/probe, race 7458 ms). The horizon layer was
 * still the wall.
 *
 * So the band scales with the card: a quad stops covering the frame at roughly
 * its own half-extent, so that is where it comes back to full alpha, and it
 * reaches zero at a quarter of it. The absolute 6/18 m stays as the floor,
 * which is what keeps every near-field card on exactly the band the phase asked
 * for - a scud's half-extent is 4-9 m, under both floors, so nothing about
 * PAN_SCUD_NEAR, PAN_SCUD_CROSSING or BRINE_HAZE_LOW is changed by this line.
 *
 * It only ever removes a card the camera is INSIDE relative to that card's own
 * size. A mesa authored at 1200-1400 m lateral reads at scale 1 wherever it is
 * actually on the horizon; the ones this takes out are the ones the 3050 m
 * closed loop folded back onto the deck.
 */
const NEAR_FADE_ZERO_SPAN_SHARE = 0.25;
const NEAR_FADE_FULL_SPAN_SHARE = 2;

/**
 * Distance from a point to the nearest point of a camera-facing quad, in metres.
 *
 * The quad spans `cameraRight` horizontally and world Y vertically, so in the
 * orthonormal frame {right, n, up} the offset from the centre splits into
 * (along, perpendicular, up) and the nearest point clamps `along` and `up` onto
 * the card's own half-extents while `perpendicular` — the quad has no thickness
 * — is carried whole.
 *
 * `shear` leans the top edge along `right` by `shear * halfHeight`
 * (writeCameraFacingCard), so the horizontal span is widened by that much
 * rather than the parallelogram being solved exactly. That is deliberately the
 * conservative direction: it can only make a sheared card start fading slightly
 * early, never late.
 */
function nearestQuadDistance(
  cameraX: number,
  cameraY: number,
  cameraZ: number,
  centerX: number,
  centerY: number,
  centerZ: number,
  halfWidth: number,
  halfHeight: number,
  rightX: number,
  rightZ: number,
  shear: number,
): number {
  const dx = cameraX - centerX;
  const dy = cameraY - centerY;
  const dz = cameraZ - centerZ;
  const along = dx * rightX + dz * rightZ;
  const perpendicular = dz * rightX - dx * rightZ;
  const halfSpan = halfWidth + Math.abs(shear) * halfHeight;
  const overAlong = along > halfSpan
    ? along - halfSpan
    : along < -halfSpan ? along + halfSpan : 0;
  const overUp = dy > halfHeight
    ? dy - halfHeight
    : dy < -halfHeight ? dy + halfHeight : 0;
  return Math.sqrt(
    overAlong * overAlong + perpendicular * perpendicular + overUp * overUp,
  );
}

/**
 * 0 where the camera is inside the card, 1 where the card is a shape in the
 * world again, smoothstep between. `reachMeters` is the card's own largest
 * half-extent this tick, which is what makes the band mean the same thing to a
 * 13 m scud and to a 300 m mesa.
 */
function nearFadeScale(distanceMeters: number, reachMeters: number): number {
  const full = Math.max(NEAR_FADE_FULL_METERS, reachMeters * NEAR_FADE_FULL_SPAN_SHARE);
  // Written as "not less than" so a card with no camera this tick — the
  // constructor's first update passes none — reads NaN and stays at 1.
  if (!(distanceMeters < full)) return 1;
  const zero = Math.max(NEAR_FADE_ZERO_METERS, reachMeters * NEAR_FADE_ZERO_SPAN_SHARE);
  if (distanceMeters <= zero) return 0;
  const t = (distanceMeters - zero) / (full - zero);
  return t * t * (3 - 2 * t);
}

/**
 * G3 — the three authored zones a live track event drives.
 *
 * Matched on `motionId`, which `buildLivingWorld` already stamps on every card,
 * rather than on a new authored field: `canonicalCard` in
 * `scripts/validate-living-world.mjs` hashes the authored card, so a new field
 * would move three pinned zone digests for no change to what is drawn.
 *
 * Each id is map-exclusive, so the map gating is structural — PAN_SCUD_CROSSING
 * and UNDERPASS_HAZARD_LAMPS exist only on Bitterpan and RAIN_SWEEP only on
 * Greenwater, and neither map can pick up the other's weather by accident.
 */
const GUST_SCUD_ZONE = "PAN_SCUD_CROSSING";
const SALT_LAMP_ZONE = "UNDERPASS_HAZARD_LAMPS";
const SQUALL_RAIN_ZONE = "RAIN_SWEEP";

/**
 * Textures a zone set may ask for by name. `motion` is loaded by `load` from
 * the shared atlas URL; the rest come from an authored environment, so a course
 * whose zones never name them (Bitterpan) does not need to supply them.
 */
export interface LivingWorldTextures {
  jungle?: THREE.Texture;
  emissive?: THREE.Texture;
}

/**
 * The card sheets this module loads for itself, on both maps.
 *
 * `motion` and `motionB` are the two shared motion atlases; P18 adds `horizon`,
 * the distant-silhouette sheet, on the same terms — generic cells, both maps,
 * one more 1024 rather than one more draw call per map.
 */
interface LivingWorldSheets {
  motion: THREE.Texture;
  motionB: THREE.Texture;
  horizon: THREE.Texture;
}

interface LivingCard extends AuthoredCard {
  anchorX: number;
  anchorY: number;
  anchorZ: number;
  hangY: number;
  /**
   * P20.4. The course `right` vector at the card's own station, frozen at load.
   *
   * `cross` walks a card sideways over the deck, which needs the lateral axis
   * of the road under it. `flow` gets that by re-sampling the centreline every
   * tick; a crossing scud does not move ALONG the course at all, so re-sampling
   * would buy nothing and cost a curve evaluation per card per tick.
   */
  rightX: number;
  rightZ: number;
  flowSample: CourseSample | null;
  /**
   * G3. How far outboard of the CENTRELINE this card's anchor sits, metres.
   *
   * `cross` walks the card `amplitude` metres either side of its own anchor,
   * and the anchor is at `halfWidth + lateral` — so where on the deck the
   * traverse actually crosses depends on a half-width the card never stored,
   * and on the widest Bitterpan stations the crossing lands at the very start
   * of the sawtooth where the alpha envelope is still 0. A gust-driven traverse
   * subtracts this and walks symmetrically about the centreline instead, so the
   * card is over the racing line at progress 0.5 — where `cross` alpha peaks.
   */
  crossOffsetMeters: number;
  /** Which side of the centreline the card was on last tick: -1, 0 or 1. */
  crossSide: number;
  /** The traverse progress the motion resolved, for the alpha to reuse. */
  crossProgress: number;
  /** Set once at load: this card is driven by a live track event. */
  eventZone: "" | "gust" | "lamp" | "rain";
  /**
   * P20.10. The camera-proximity multiplier resolved for this tick, 0..1.
   *
   * Written where the quad is written, because that is the only place the
   * card's CURRENT centre, half-extents and shear all exist at once — every
   * motion in the switch above moves or scales at least one of them, and a
   * fade computed from the authored anchor would test a card that is metres
   * from where it is drawn. `updateCardAlpha` then reads it rather than
   * recomputing it, for the same reason the `cross` alpha reads
   * `crossProgress`.
   */
  nearFadeScale: number;
}

interface LivingBatch {
  spec: LivingBatchSpec;
  mesh: THREE.Mesh;
  cards: LivingCard[];
  positions: Float32Array;
  colors: Float32Array;
  positionAttribute: THREE.BufferAttribute;
  colorAttribute: THREE.BufferAttribute;
  hasAnimatedAlpha: boolean;
  /** P20.10. This batch's cards fade out as the camera reaches them. */
  nearFade: boolean;
}

export interface LivingWorldStats {
  drawCalls: number;
  cards: number;
  triangles: number;
  updateHz: number;
  updateSteps: number;
  /**
   * P20.4. How many cards were inside the camera frustum at the last visibility
   * sample. `cards` says what was authored; this says what the driver can
   * actually see, which is the number the "Bitterpan reads as empty" verdict
   * was really about. Sampled at VISIBILITY_SAMPLE_HZ, not every tick.
   */
  visibleCards: number;
}

function makeBatch(
  spec: LivingBatchSpec,
  cards: LivingCard[],
  material: THREE.Material,
): LivingBatch {
  const positions = new Float32Array(cards.length * CARD_VERTICES * 3);
  const uvs = new Float32Array(cards.length * CARD_VERTICES * 2);
  const colors = new Float32Array(cards.length * CARD_VERTICES * 4);
  const indices = new Uint16Array(cards.length * CARD_TRIANGLES * 3);

  for (let cardIndex = 0; cardIndex < cards.length; cardIndex += 1) {
    const card = cards[cardIndex];
    const rect: AtlasRect = card.rect;
    const padding = 1.5;
    const u0 = (rect.x + padding) / rect.sheetSize;
    const v0 = (rect.y + padding) / rect.sheetSize;
    const size = (rect.size - padding * 2) / rect.sheetSize;
    // P20.8 — ONE UV CONVENTION FOR EVERY SHEET THIS MODULE SAMPLES.
    //
    // `atlasRect` measures `rect.y` in PNG rows from the TOP of the sheet, so
    // the quad's TOP edge takes `v0` and its BOTTOM edge `v0 + size`. That is
    // correct if and only if the texture's own V origin is also at the top,
    // i.e. `flipY === false`.
    //
    // Two of the five sources this module draws from already are: `jungle` and
    // `emissive` are material maps lifted out of the Greenwater GLB, and
    // `GLTFLoader` sets `flipY = false` because glTF puts UV (0,0) at the top
    // of the image. The three card sheets are NOT — they were loaded through
    // `TextureLoader` with `flipY` at its default `true`, which put V's origin
    // at the bottom and resolved every card to the vertically MIRRORED row of
    // its atlas grid (a cell in row r of an N-row grid drew row N-1-r, upside
    // down). P20.4 measured that and worked around it per card with `upright`.
    //
    // The fix is on the TEXTURE, not here: `loadMotionAtlas` now sets
    // `flipY = false` on all three card sheets, so all five sources share the
    // GLB's top-origin convention and this one expression is right for every
    // card. Fixing it here instead — computing V from the bottom for every
    // card — would have mirrored the foliage and lamp cards, which were the
    // only ones on this layer that were already correct.
    const vTop = v0;
    const vBottom = v0 + size;
    const uvQuad = [
      [u0, vBottom],
      [u0 + size, vBottom],
      [u0 + size, vTop],
      [u0, vTop],
    ];
    for (let vertex = 0; vertex < CARD_VERTICES; vertex += 1) {
      const uvOffset = (cardIndex * CARD_VERTICES + vertex) * 2;
      uvs[uvOffset] = uvQuad[vertex][0];
      uvs[uvOffset + 1] = uvQuad[vertex][1];
      const colorOffset = (cardIndex * CARD_VERTICES + vertex) * 4;
      colors[colorOffset] = ((card.tint >> 16) & 255) / 255;
      colors[colorOffset + 1] = ((card.tint >> 8) & 255) / 255;
      colors[colorOffset + 2] = (card.tint & 255) / 255;
      colors[colorOffset + 3] = card.alphaInitial ?? 1;
    }
    const vertexOffset = cardIndex * CARD_VERTICES;
    indices.set(
      [
        vertexOffset,
        vertexOffset + 1,
        vertexOffset + 2,
        vertexOffset,
        vertexOffset + 2,
        vertexOffset + 3,
      ],
      cardIndex * 6,
    );
  }

  const geometry = new THREE.BufferGeometry();
  const positionAttribute = new THREE.BufferAttribute(positions, 3);
  const colorAttribute = new THREE.BufferAttribute(colors, 4);
  geometry.setAttribute("position", positionAttribute);
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setAttribute("color", colorAttribute);
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = spec.meshName;
  mesh.frustumCulled = false;
  mesh.userData.alphaChannel = true;
  return {
    spec,
    mesh,
    cards,
    positions,
    colors,
    positionAttribute,
    colorAttribute,
    // P20.10 — a fading batch always rewrites its colours, because the fade is
    // itself an animation even for a card whose authored alpha is a constant
    // (every horizon silhouette, OPENING_BIRD_FLOCK, SALT_DEVIL_CORE). The
    // lamp batches are the exception on both counts: `updateLampColors`
    // already rewrites their whole colour buffer every tick.
    hasAnimatedAlpha: cards.some((card) => card.alphaKind !== undefined)
      || !spec.lamps,
    nearFade: !spec.lamps,
  };
}

function makeMaterial(
  spec: LivingBatchSpec,
  sheets: LivingWorldSheets,
  textures: LivingWorldTextures,
): THREE.MeshBasicMaterial {
  const map = spec.texture === "motion"
    ? sheets.motion
    : spec.texture === "motionB"
      ? sheets.motionB
      : spec.texture === "horizon"
        ? sheets.horizon
        : spec.texture === "jungle"
          ? textures.jungle
          : textures.emissive;
  if (!map) {
    throw new Error(
      `Living-world batch ${spec.meshName} needs the ${spec.texture} texture, `
        + "which this course did not supply.",
    );
  }
  const material = new THREE.MeshBasicMaterial({
    map,
    transparent: true,
    depthWrite: spec.depthWrite,
    blending: spec.blending === "additive"
      ? THREE.AdditiveBlending
      : THREE.NormalBlending,
    vertexColors: true,
    side: THREE.DoubleSide,
    // P20.4 round 2. A transparent DoubleSide material is drawn TWICE by
    // three.js — back faces, then front faces — so that a curved or folded
    // transparent surface sorts against itself. Measured on the pinned station
    // set: 7 living-world batches cost 14 of `renderer.info.render.calls`
    // (64 - 50 at station 150 with `?living=0` as the B side), at every one of
    // the 13 stations.
    //
    // Nothing here needs that sort. Every card is a FLAT quad with
    // `depthWrite: false`; its own back face never occludes its own front face,
    // and cards in a batch already blend in buffer order rather than in depth
    // order. `forceSinglePass` keeps DoubleSide — the quad is still lit and
    // still drawn from behind, which the sky-haze ring and the crossing scud
    // both rely on — and drops the duplicate pass.
    //
    // AND IT IS FREE, WHICH IS NOT OBVIOUS. The two-pass path sets BackSide
    // then FrontSide, and each of those culls the orientation the other draws,
    // so a flat quad was never blended twice — the second pass drew zero
    // triangles for every card facing the camera and the first drew zero for
    // every card facing away. Verified rather than reasoned: the same four
    // Greenwater poses shot before and after this flag differ by 906 / 611 /
    // 6347 / 1305 changed pixels, and TWO RUNS OF THE BUILD WITH THE FLAG ON
    // differ by 659 / 1157 / 6551 / 1460 at the same poses — the change is
    // inside the harness's own noise. Greenwater is the map that can prove it:
    // `flow` and `ripple` write the only living-world quads with a fixed
    // world-space normal (writeFlatCard), 44 of them in GLINT_WATER_TABLE and
    // GLINT_SWEEP_DRAINAGE, and stations 340 and 910 look straight down at
    // them. A lost back face would show there first.
    forceSinglePass: true,
    opacity: 1,
    fog: spec.fog,
  });
  if (spec.alphaTest > 0) material.alphaTest = spec.alphaTest;
  return material;
}

function writeCameraFacingCard(
  positions: Float32Array,
  cardIndex: number,
  centerX: number,
  centerY: number,
  centerZ: number,
  halfWidth: number,
  halfHeight: number,
  cameraRight: THREE.Vector3,
  shear: number,
): void {
  const rightX = cameraRight.x * halfWidth;
  const rightZ = cameraRight.z * halfWidth;
  const upX = shear * cameraRight.x * halfHeight;
  const upZ = shear * cameraRight.z * halfHeight;
  const offset = cardIndex * 12;
  positions[offset] = centerX - rightX - upX;
  positions[offset + 1] = centerY - halfHeight;
  positions[offset + 2] = centerZ - rightZ - upZ;
  positions[offset + 3] = centerX + rightX - upX;
  positions[offset + 4] = centerY - halfHeight;
  positions[offset + 5] = centerZ + rightZ - upZ;
  positions[offset + 6] = centerX + rightX + upX;
  positions[offset + 7] = centerY + halfHeight;
  positions[offset + 8] = centerZ + rightZ + upZ;
  positions[offset + 9] = centerX - rightX + upX;
  positions[offset + 10] = centerY + halfHeight;
  positions[offset + 11] = centerZ - rightZ + upZ;
}

function writeFlatCard(
  positions: Float32Array,
  cardIndex: number,
  centerX: number,
  centerY: number,
  centerZ: number,
  halfX: number,
  halfZ: number,
): void {
  const offset = cardIndex * 12;
  positions[offset] = centerX - halfX;
  positions[offset + 1] = centerY;
  positions[offset + 2] = centerZ - halfZ;
  positions[offset + 3] = centerX + halfX;
  positions[offset + 4] = centerY;
  positions[offset + 5] = centerZ - halfZ;
  positions[offset + 6] = centerX + halfX;
  positions[offset + 7] = centerY;
  positions[offset + 8] = centerZ + halfZ;
  positions[offset + 9] = centerX - halfX;
  positions[offset + 10] = centerY;
  positions[offset + 11] = centerZ + halfZ;
}

/**
 * The card layer, for any course that has an authored zone set.
 *
 * Zones, counts, palettes and motions are data (`living-world-zones.js`); this
 * class owns only the three.js side — one shared `Float32Array` per batch, one
 * draw call per batch, and a fixed 30 Hz update that never allocates. The
 * Greenwater zone set is accepted art and is reproduced bit-for-bit by the zone
 * module, so P9's expansion is additive: it appends cards to the existing
 * batches rather than re-authoring them.
 */
export class LivingWorld {
  readonly root = new THREE.Group();
  readonly stats: LivingWorldStats;

  private readonly batches: LivingBatch[];
  private readonly cameraRight = new THREE.Vector3(1, 0, 0);
  /**
   * P20.10. The camera's own world position, latched once a tick.
   *
   * `cameraRight` was already read off `camera.matrixWorld` here; the near fade
   * needs the translation column of the same matrix, so it costs one more read
   * a tick rather than one per card. Left at NaN when the caller passes no
   * camera, which `nearFadeScale` resolves to "no fade" rather than "invisible".
   */
  private readonly cameraPosition = new THREE.Vector3(
    Number.NaN,
    Number.NaN,
    Number.NaN,
  );
  private accumulatorSeconds = 0;
  private elapsedSeconds = 0;
  /**
   * G3. A SECOND clock, for the Greenwater squall's rain only.
   *
   * The squall asks for rain that falls 1.5x faster. Multiplying `card.speed`
   * where the sawtooth reads `elapsedSeconds * speed` would jump every streak's
   * phase the instant the multiplier moved - 22 rain cards teleporting mid-fall
   * at both ends of the squall. Advancing a clock of its own at the scaled rate
   * keeps the sawtooth continuous through the ramp: the rain speeds up, it does
   * not restart.
   */
  private squallClockSeconds = 0;
  /**
   * G3. The three live-event samples, latched ONCE per tick and only while the
   * layer is advancing.
   *
   * Every motion in this module is a pure function of `elapsedSeconds`, which
   * is what makes `advanceMotion = false` freeze the whole layer for a driver
   * who asked for reduced motion. A track-event level read per card, straight
   * off module state, would have been the one exception - the crossing scud
   * would keep walking over the road and the rain would keep swelling while
   * everything around them stood still. Latching here puts the three back under
   * the same gate, and costs three reads a tick instead of three per card.
   */
  private scudClockSeconds = Number.NaN;
  private scudAlphaScale = 1;
  private squallAlphaGain = 1;
  private lampsSolid = false;
  private visibilityAccumulatorSeconds = 0;
  private readonly visibilityFrustum = new THREE.Frustum();
  private readonly visibilityMatrix = new THREE.Matrix4();
  private readonly visibilitySphere = new THREE.Sphere();

  private constructor(
    private readonly course: RaceCourse,
    spec: LivingWorldSpec,
    sheets: LivingWorldSheets,
    textures: LivingWorldTextures,
  ) {
    this.root.name = spec.rootName;
    const authored = buildLivingWorld(spec);
    this.stats = {
      drawCalls: authored.drawCalls,
      cards: authored.cards,
      triangles: authored.triangles,
      updateHz: LIVING_WORLD_UPDATE_HZ,
      updateSteps: 0,
      visibleCards: 0,
    };
    // P20.4. `?living=0` draws the frame with the card layer switched off and
    // nothing else changed, so a station screenshot can be differenced against
    // the same station with the layer on. That diff is the only honest answer to
    // "is any of this visible from the driver's seat" — the question this phase
    // exists to answer, and the one the P9/P12 Bitterpan set silently failed.
    // The cards are still authored and still stepped, so every diagnostics
    // number stays comparable; only the meshes stop being drawn.
    this.root.visible = searchParam("living") !== "0";

    this.batches = authored.batches.map((batch) => makeBatch(
      batch.spec,
      batch.cards.map((card) => ({
        ...card,
        anchorX: 0,
        anchorY: 0,
        anchorZ: 0,
        hangY: 0,
        rightX: 1,
        rightZ: 0,
        flowSample: null,
        crossOffsetMeters: 0,
        crossSide: 0,
        crossProgress: 0,
        nearFadeScale: 1,
        eventZone: card.motionId === GUST_SCUD_ZONE
          ? "gust"
          : card.motionId === SALT_LAMP_ZONE
            ? "lamp"
            : card.motionId === SQUALL_RAIN_ZONE
              ? "rain"
              : "",
      })),
      makeMaterial(batch.spec, sheets, textures),
    ));
    for (const batch of this.batches) this.root.add(batch.mesh);

    for (const batch of this.batches) {
      for (const card of batch.cards) {
        const sample = this.course.sampleAtDistance(card.distance);
        const offset = sample.halfWidth + card.lateral;
        card.anchorX = sample.position.x + sample.right.x * offset * card.side;
        card.anchorY = sample.position.y + card.base;
        card.anchorZ = sample.position.z + sample.right.z * offset * card.side;
        card.hangY = sample.position.y + (card.hang ?? 0);
        card.rightX = sample.right.x;
        card.rightZ = sample.right.z;
        card.crossOffsetMeters = offset;
        if (card.kind === "flow") card.flowSample = this.course.createSampleScratch();
      }
    }

    this.update(UPDATE_STEP_SECONDS, null);
  }

  /**
   * Loads a motion atlas the way every card sheet wants to be sampled: sRGB,
   * nearest on both filters, no mipmaps. A card is a handful of pixels blown up
   * to metres, so a mip chain only smears the authored dither.
   *
   * P20.8 — `flipY = false` IS THE LOAD-BEARING LINE HERE, not the filtering.
   *
   * `atlasRect` addresses a cell by its PNG row from the TOP of the sheet, and
   * `makeBatch` builds V straight off that number. `TextureLoader` defaults to
   * `flipY = true`, which puts V's origin at the BOTTOM, and the two
   * conventions do not cancel: every card resolved to the mirrored grid row,
   * upside down, on both maps. Bitterpan's mesa line drew Greenwater's
   * treeline; its additive haze band drew a run of pylons; its heat shimmer
   * drew rain. Setting the sampler's origin at the top instead makes these
   * three sheets agree with the two GLB-sourced ones (`jungle`, `emissive`),
   * which `GLTFLoader` already loads `flipY = false`, so ONE UV expression in
   * `makeBatch` is correct for every card on the layer.
   *
   * These are this module's own `THREE.Texture` instances, loaded from these
   * URLs here and nowhere else. `race-presence.ts` and `rivals.ts` build their
   * own atlas textures (and already set `flipY = false` for their own reasons);
   * nothing outside this file samples the objects created below.
   *
   * `scripts/validate-living-world.mjs` pins the pairing — the cell a named
   * rect resolves to in UV space against that cell's rows in the PNG itself —
   * so a future edit cannot silently take one half of it back.
   */
  private static async loadMotionAtlas(
    url: string,
    name: string,
  ): Promise<THREE.Texture> {
    const texture = await new THREE.TextureLoader().loadAsync(url);
    texture.name = name;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.flipY = false;
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;
    return texture;
  }

  static async load(
    course: RaceCourse,
    textures: LivingWorldTextures,
    motionTextureUrl: string,
    motionBTextureUrl: string,
    horizonTextureUrl: string,
  ): Promise<LivingWorld> {
    const spec = LIVING_WORLD_SPECS[course.kind];
    if (!spec) {
      throw new Error(`No living-world zone set is authored for ${course.kind}.`);
    }
    // P18: the horizon sheet takes the identical card contract — sRGB, nearest
    // on both filters, no mip chain. It is a card sheet, not a facade sheet.
    const [motion, motionB, horizon] = await Promise.all([
      LivingWorld.loadMotionAtlas(motionTextureUrl, "living_world_motion_512"),
      LivingWorld.loadMotionAtlas(motionBTextureUrl, "living_world_motion_b_512"),
      LivingWorld.loadMotionAtlas(horizonTextureUrl, "futurisma_horizon_1024"),
    ]);
    try {
      return new LivingWorld(course, spec, { motion, motionB, horizon }, textures);
    } catch (error) {
      motion.dispose();
      motionB.dispose();
      horizon.dispose();
      throw error;
    }
  }

  update(
    deltaSeconds: number,
    camera: THREE.Camera | null,
    advanceMotion = true,
  ): boolean {
    this.accumulatorSeconds += Math.min(deltaSeconds, 0.25);
    if (this.accumulatorSeconds < UPDATE_STEP_SECONDS) return false;
    while (this.accumulatorSeconds >= UPDATE_STEP_SECONDS) {
      this.accumulatorSeconds -= UPDATE_STEP_SECONDS;
      if (advanceMotion) this.elapsedSeconds += UPDATE_STEP_SECONDS;
      if (advanceMotion) {
        this.squallClockSeconds += UPDATE_STEP_SECONDS * squallRainSpeedGain();
      }
      this.stats.updateSteps += 1;
    }
    if (advanceMotion) {
      this.scudClockSeconds = gustScudClockSeconds();
      this.scudAlphaScale = gustScudAlphaScale();
      this.squallAlphaGain = squallRainAlphaGain();
      this.lampsSolid = saltLampsSolid();
    }
    if (camera) {
      camera.updateMatrixWorld();
      this.cameraRight.setFromMatrixColumn(camera.matrixWorld, 0).setY(0).normalize();
      this.cameraPosition.setFromMatrixPosition(camera.matrixWorld);
    } else {
      this.cameraRight.set(1, 0, 0);
      this.cameraPosition.set(Number.NaN, Number.NaN, Number.NaN);
    }

    for (const batch of this.batches) {
      for (let cardIndex = 0; cardIndex < batch.cards.length; cardIndex += 1) {
        const card = batch.cards[cardIndex];
        let x = card.anchorX;
        let y = card.anchorY;
        let z = card.anchorZ;
        let halfWidth = card.width / 2;
        let halfHeight = card.height / 2;
        let shear = 0;
        switch (card.kind) {
          case "mist": {
            const amount = Math.sin(
              this.elapsedSeconds * (Math.PI * 2 / 9) + card.phase,
            );
            x += this.cameraRight.x * amount * card.speed * 9;
            z += this.cameraRight.z * amount * card.speed * 9;
            halfHeight *= 0.9 + 0.1 * amount;
            break;
          }
          case "rise": {
            const amount = (this.elapsedSeconds * card.speed + card.seed) % 1;
            y += amount * 11;
            halfHeight *= 0.7 + 0.5 * (1 - amount);
            break;
          }
          case "puff": {
            const amount = (
              this.elapsedSeconds * card.speed + card.phase / (Math.PI * 2)
            ) % 1;
            y += amount * 4;
            const scale = 0.6 + amount * 1.3;
            halfWidth *= scale;
            halfHeight *= scale;
            break;
          }
          case "rain": {
            // G3: RAIN_SWEEP falls on the squall clock, everything else on the
            // shared one. Outside a squall the two advance at the same rate, so
            // this is the identity it has always been.
            const clock = card.eventZone === "rain"
              ? this.squallClockSeconds
              : this.elapsedSeconds;
            const amount = (clock * card.speed / 26 + card.phase) % 1;
            y = card.anchorY + 16 - amount * 26;
            shear = 0.105;
            break;
          }
          case "ripple": {
            const amount = (this.elapsedSeconds / 3.1 + card.phase) % 1;
            halfWidth = card.width / 2 * (0.25 + amount * 0.9);
            break;
          }
          case "flow": {
            const amount = (this.elapsedSeconds * card.speed / 42 + card.phase) % 1;
            const sample = this.course.sample(
              (card.distance + amount * 42 - 21) / this.course.length,
              card.flowSample ?? undefined,
            );
            const offset = sample.halfWidth + card.lateral;
            x = sample.position.x + sample.right.x * offset * card.side;
            y = sample.position.y + card.base;
            z = sample.position.z + sample.right.z * offset * card.side;
            break;
          }
          case "pendulum": {
            const angle = Math.sin(
              this.elapsedSeconds * card.speed + card.phase,
            ) * (card.amplitude ?? 0);
            const swing = Math.sin(angle) * card.height;
            x += this.cameraRight.x * swing;
            z += this.cameraRight.z * swing;
            y = card.hangY - card.height / 2 * Math.cos(angle);
            break;
          }
          case "cross": {
            // P20.4. The card walks ACROSS the road on the course's own lateral
            // axis, not the camera's: `cameraRight` would make the traverse
            // depend on where the driver is looking, and a scud has to keep
            // crossing the same way while the camera swings through a bend.
            //
            // One traverse per `1 / speed` seconds, `amplitude` metres either
            // side of the anchor. The sawtooth wraps hard, which is invisible
            // because the `cross` alpha envelope reads the SAME sawtooth and is
            // zero at both ends of it.
            //
            // G3. When a gust schedule owns the clock, the traverse is re-timed
            // AND re-centred: `gustScudProgress` returns the schedule's own
            // sawtooth, and the card walks symmetrically about the CENTRELINE
            // rather than about its own anchor, so it is over the racing line
            // at progress 0.5 - which is exactly where the `cross` alpha
            // envelope peaks. `-1` means no schedule owns it (Greenwater,
            // `?events=0`, standby) and the free sawtooth below is unchanged.
            const driven = card.eventZone === "gust"
              ? gustScudProgressAt(this.scudClockSeconds, card.phase)
              : -1;
            const amount = driven >= 0
              ? driven
              : (this.elapsedSeconds * card.speed + card.phase) % 1;
            card.crossProgress = amount;
            const amplitude = card.amplitude ?? 0;
            const travel = driven >= 0
              ? (amount * 2 - 1) * amplitude - card.crossOffsetMeters
              : (amount * 2 - 1) * amplitude;
            x += card.rightX * travel * card.side;
            z += card.rightZ * travel * card.side;
            if (driven > 0 && driven < 1) {
              // The telegraph, MEASURED. A parked card sits at exactly 0 or 1
              // and is excluded above, so only a card genuinely mid-traverse
              // can report a crossing.
              const side = Math.sign((amount * 2 - 1) * amplitude) || card.crossSide;
              if (card.crossSide !== 0 && side !== card.crossSide) {
                noteScudRoadCrossing(this.scudClockSeconds);
              }
              card.crossSide = side;
            }
            break;
          }
          case "shear":
            shear = Math.sin(
              this.elapsedSeconds * card.speed + card.phase,
            ) * Math.tan(card.amplitude ?? 0) * 4;
            break;
          case "devil": {
            // A column of cards orbiting the devil's axis: the orbit widens and
            // the card grows as it climbs, so the four cards of one column read
            // as a single turning body rather than four sprites.
            const spin = this.elapsedSeconds * card.speed + card.phase;
            const climb = (this.elapsedSeconds * DEVIL_CLIMB_HZ + card.seed) % 1;
            const radius = (card.amplitude ?? 0) * (0.55 + 0.45 * climb);
            x += Math.cos(spin) * radius;
            z += Math.sin(spin) * radius;
            y += climb * (card.hang ?? 0);
            const scale = 0.65 + climb * 0.6;
            halfWidth *= scale;
            halfHeight *= scale;
            break;
          }
          default:
            break;
        }

        if (card.kind === "ripple" || card.kind === "flow") {
          writeFlatCard(
            batch.positions,
            cardIndex,
            x,
            y,
            z,
            halfWidth * 1.6,
            halfWidth * 0.42,
          );
          card.nearFadeScale = 1;
        } else {
          // P20.10 — the fade, on the CURRENT quad. `centerY` is the same
          // expression the writer below uses, so the card that is tested and
          // the card that is drawn are the same rectangle. Computed here rather
          // than in `updateCardAlpha` because this is the only place a card's
          // post-motion centre, half-extents and shear all exist at once.
          if (batch.nearFade) {
            const centerY = batch.spec.anchor === "bottom" ? y + halfHeight : y;
            card.nearFadeScale = nearFadeScale(
              nearestQuadDistance(
                this.cameraPosition.x,
                this.cameraPosition.y,
                this.cameraPosition.z,
                x,
                centerY,
                z,
                halfWidth,
                halfHeight,
                this.cameraRight.x,
                this.cameraRight.z,
                shear,
              ),
              Math.max(halfWidth + Math.abs(shear) * halfHeight, halfHeight),
            );
          }
          writeCameraFacingCard(
            batch.positions,
            cardIndex,
            x,
            // P18.1 — bottom anchoring. `writeCameraFacingCard` centres the
            // quad on this Y, which is right for drifting atmosphere and wrong
            // for a ground-standing silhouette: at base 0 a 50 m mesa card
            // spanned -25..+25 m and showed half its authored height. Lifting
            // by the CURRENT half-height (after the motion switch has scaled
            // it) keeps the bottom edge on `base` even for a kind that grows,
            // so a bottom-anchored card grows upward out of the ground rather
            // than sinking into it.
            batch.spec.anchor === "bottom" ? y + halfHeight : y,
            z,
            halfWidth,
            halfHeight,
            this.cameraRight,
            shear,
          );
        }
        // P20.10 — a fading card is written even without an alpha envelope,
        // because the fade is the animation. On a lamp batch this is the
        // condition it has always been, and `updateLampColors` owns the alpha.
        if (card.alphaKind || batch.nearFade) {
          this.updateCardAlpha(batch, cardIndex, card);
        }
      }
      batch.positionAttribute.needsUpdate = true;
      if (batch.hasAnimatedAlpha) batch.colorAttribute.needsUpdate = true;
    }
    for (const batch of this.batches) {
      if (batch.spec.lamps) this.updateLampColors(batch);
    }
    this.visibilityAccumulatorSeconds += deltaSeconds;
    if (
      camera
      && this.visibilityAccumulatorSeconds >= 1 / VISIBILITY_SAMPLE_HZ
    ) {
      this.visibilityAccumulatorSeconds = 0;
      this.stats.visibleCards = this.countVisibleCards(camera);
    }
    return true;
  }

  /**
   * P20.4. How many cards the camera can actually see, right now.
   *
   * Read off the position buffer that was just written rather than off the
   * authored anchors, because half the motions in the set move a card metres
   * from its anchor and two of them (`devil`, `cross`) move it across the road.
   * The test is the card's own bounding sphere, not its centre: a 480 m haze
   * card fills the frame long after its centre has left it, and counting
   * centres would report the horizon ring as invisible exactly when it is
   * covering the sky.
   */
  private countVisibleCards(camera: THREE.Camera): number {
    camera.updateMatrixWorld();
    const projection = (camera as THREE.PerspectiveCamera).projectionMatrix;
    this.visibilityMatrix.multiplyMatrices(projection, camera.matrixWorldInverse);
    this.visibilityFrustum.setFromProjectionMatrix(this.visibilityMatrix);
    let visible = 0;
    for (const batch of this.batches) {
      for (let cardIndex = 0; cardIndex < batch.cards.length; cardIndex += 1) {
        const offset = cardIndex * 12;
        // Vertex 0 is the card's bottom-left corner and vertex 2 its top-right,
        // so their midpoint is the centre and half their separation the radius,
        // for both the camera-facing and the flat writer.
        const x0 = batch.positions[offset];
        const y0 = batch.positions[offset + 1];
        const z0 = batch.positions[offset + 2];
        const x2 = batch.positions[offset + 6];
        const y2 = batch.positions[offset + 7];
        const z2 = batch.positions[offset + 8];
        this.visibilitySphere.center.set((x0 + x2) / 2, (y0 + y2) / 2, (z0 + z2) / 2);
        const dx = (x2 - x0) / 2;
        const dy = (y2 - y0) / 2;
        const dz = (z2 - z0) / 2;
        this.visibilitySphere.radius = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (this.visibilityFrustum.intersectsSphere(this.visibilitySphere)) visible += 1;
      }
    }
    return visible;
  }

  private updateCardAlpha(
    batch: LivingBatch,
    cardIndex: number,
    card: LivingCard,
  ): void {
    const alphaKind: AlphaKind | undefined = card.alphaKind;
    if (!alphaKind) {
      // P20.10 — a card with no envelope still has to answer the camera. Every
      // horizon silhouette is one of these, and they are the zones that put the
      // 59 x 56 m wall in the frame, so this branch is the load-bearing half of
      // the fix rather than a tidy-up: their authored constant is written
      // through the fade instead of being left in the buffer from `makeBatch`.
      const flat = (card.alphaInitial ?? 1) * card.nearFadeScale;
      for (let vertex = 0; vertex < CARD_VERTICES; vertex += 1) {
        batch.colors[(cardIndex * CARD_VERTICES + vertex) * 4 + 3] = flat;
      }
      return;
    }
    let amount = 0;
    switch (alphaKind) {
      case "mist":
        amount = 0.5 + 0.5 * Math.sin(
          this.elapsedSeconds * (Math.PI * 2 / 9) + card.phase,
        );
        break;
      // P20.4 round 2. `scudShoulder` and `brineSwell` are the SAME birth-and-
      // dissolve shape as `rise`; only the envelope's ceiling differs, because
      // the thing that separates them is the corridor rule and not the motion.
      // Sharing the case rather than copying it is deliberate: three copies of
      // this curve would drift apart the first time one of them was tuned.
      case "rise":
      case "scudShoulder":
      case "brineSwell": {
        const progress = (this.elapsedSeconds * card.speed + card.seed) % 1;
        amount = Math.min(1, progress * 4)
          * (1 - Math.max(0, (progress - 0.62) / 0.38));
        break;
      }
      case "puff": {
        const progress = (
          this.elapsedSeconds * card.speed + card.phase / (Math.PI * 2)
        ) % 1;
        amount = 1 - progress;
        break;
      }
      case "rain":
        amount = 0.35 + 0.65 * (
          0.5 + 0.5 * Math.sin(this.elapsedSeconds * 1.7 + card.phase * 6.283)
        );
        break;
      case "ripple": {
        const progress = (this.elapsedSeconds / 3.1 + card.phase) % 1;
        amount = 1 - progress;
        break;
      }
      case "flow": {
        const progress = (this.elapsedSeconds * card.speed / 42 + card.phase) % 1;
        amount = Math.sin(Math.PI * progress);
        break;
      }
      case "devil": {
        // Same climb clock the position uses, so the dust fades exactly where
        // it thins out rather than on a clock of its own.
        const climb = (this.elapsedSeconds * DEVIL_CLIMB_HZ + card.seed) % 1;
        amount = Math.sin(Math.PI * climb);
        break;
      }
      case "shimmer":
        amount = 0.5 + 0.5 * Math.sin(
          this.elapsedSeconds * (Math.PI * 2 / SHIMMER_PERIOD_SECONDS) + card.phase,
        );
        break;
      case "cross": {
        // The SAME sawtooth the `cross` motion advances on, so the card is
        // invisible at both ends of its traverse and the wrap is never seen.
        // Any other clock here puts a hard pop in the middle of the road.
        //
        // G3 reads the progress the motion just resolved rather than
        // recomputing it, because under a gust schedule the motion's clock is
        // no longer a function of `elapsedSeconds` and a second copy of the
        // expression would drift the alpha off the traverse it belongs to.
        amount = Math.sin(Math.PI * card.crossProgress);
        break;
      }
    }
    const envelope = ALPHA_ENVELOPES[alphaKind];
    // G3: the squall gain multiplies the RESOLVED alpha rather than the
    // authored envelope, so the pinned `ALPHA_ENVELOPES` table stays the
    // authored ceiling and the gain is a runtime, ramped, reversible term.
    const gain = card.eventZone === "rain"
      ? this.squallAlphaGain
      : card.eventZone === "gust"
        ? this.scudAlphaScale
        : 1;
    // P20.10: the camera fade multiplies LAST, after the clamp, so it can only
    // ever lower a resolved alpha — the authored envelope and the corridor cap
    // `validate-living-world.mjs` pins are both still the ceiling.
    const alpha = card.nearFadeScale * Math.min(1, gain * (envelope[0]
      + (envelope[1] - envelope[0]) * THREE.MathUtils.clamp(amount, 0, 1)));
    for (let vertex = 0; vertex < CARD_VERTICES; vertex += 1) {
      batch.colors[(cardIndex * CARD_VERTICES + vertex) * 4 + 3] = alpha;
    }
  }

  private updateLampColors(batch: LivingBatch): void {
    for (let cardIndex = 0; cardIndex < batch.cards.length; cardIndex += 1) {
      const card = batch.cards[cardIndex];
      let brightness = 1;
      if (card.eventZone === "lamp" && this.lampsSolid) {
        // G3 - the salt drop's telegraph, and it takes precedence over every
        // motion below. The underpass chase is the map's ambient hazard
        // signature, so it cannot also mean "something is about to happen";
        // dropping the chase and holding every lamp SOLID is the one state the
        // driver has never seen there before.
        brightness = 1;
      } else if (card.kind === "sequence") {
        brightness = (Math.floor(this.elapsedSeconds / 1.1) % 3) / 3 === card.phase
          ? 1
          : 0.12;
      } else if (card.kind === "pulse") {
        brightness = 0.25 + 0.75 * (
          0.5 + 0.5 * Math.sin(this.elapsedSeconds * card.speed + card.phase)
        );
      } else if (card.kind === "blink") {
        brightness = (this.elapsedSeconds * card.speed + card.phase) % 1 < 0.42
          ? 1
          : 0.1;
      } else if (card.kind === "strobe") {
        // A travelling head with a short trail: `phase` is the lamp's place in
        // the chase, `speed` is sweeps per second.
        const head = (this.elapsedSeconds * card.speed) % 1;
        const gap = (head - card.phase + 1) % 1;
        brightness = gap < 0.1 ? 1 : gap < 0.24 ? 0.42 : 0.08;
      }
      const red = ((card.tint >> 16) & 255) / 255 * brightness;
      const green = ((card.tint >> 8) & 255) / 255 * brightness;
      const blue = (card.tint & 255) / 255 * brightness;
      for (let vertex = 0; vertex < CARD_VERTICES; vertex += 1) {
        const offset = (cardIndex * CARD_VERTICES + vertex) * 4;
        batch.colors[offset] = red;
        batch.colors[offset + 1] = green;
        batch.colors[offset + 2] = blue;
        batch.colors[offset + 3] = 1;
      }
    }
    batch.colorAttribute.needsUpdate = true;
  }
}
