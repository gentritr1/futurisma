import * as THREE from "three";
import {
  type RaceCourse,
  type CourseSample,
} from "./course";
import { searchParam } from "./query-probes";
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
    // P20.4 — `cellsUpright`. See the LivingBatchSpec docs: `rect.y` counts PNG
    // rows from the TOP, three.js uploads these sheets with `flipY` (the
    // default), and V therefore counts from the BOTTOM, so `v0 = rect.y / size`
    // resolves the vertically MIRRORED row of the atlas grid. A batch that opts
    // in gets the row it named; every batch that does not is left exactly as it
    // renders today, because those cards are accepted art.
    const vBottom = spec.cellsUpright
      ? 1 - (rect.y + rect.size - padding) / rect.sheetSize
      : v0 + size;
    const vTop = spec.cellsUpright
      ? 1 - (rect.y + padding) / rect.sheetSize
      : v0;
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
    hasAnimatedAlpha: cards.some((card) => card.alphaKind !== undefined),
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
  private accumulatorSeconds = 0;
  private elapsedSeconds = 0;
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
        if (card.kind === "flow") card.flowSample = this.course.createSampleScratch();
      }
    }

    this.update(UPDATE_STEP_SECONDS, null);
  }

  /**
   * Loads a motion atlas the way every card sheet wants to be sampled: sRGB,
   * nearest on both filters, no mipmaps. A card is a handful of pixels blown up
   * to metres, so a mip chain only smears the authored dither.
   */
  private static async loadMotionAtlas(
    url: string,
    name: string,
  ): Promise<THREE.Texture> {
    const texture = await new THREE.TextureLoader().loadAsync(url);
    texture.name = name;
    texture.colorSpace = THREE.SRGBColorSpace;
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
      this.stats.updateSteps += 1;
    }
    if (camera) {
      camera.updateMatrixWorld();
      this.cameraRight.setFromMatrixColumn(camera.matrixWorld, 0).setY(0).normalize();
    } else {
      this.cameraRight.set(1, 0, 0);
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
            const amount = (this.elapsedSeconds * card.speed / 26 + card.phase) % 1;
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
            const amount = (this.elapsedSeconds * card.speed + card.phase) % 1;
            const travel = (amount * 2 - 1) * (card.amplitude ?? 0);
            x += card.rightX * travel * card.side;
            z += card.rightZ * travel * card.side;
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
        } else {
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
        if (card.alphaKind) this.updateCardAlpha(batch, cardIndex, card);
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
    if (!alphaKind) return;
    let amount = 0;
    switch (alphaKind) {
      case "mist":
        amount = 0.5 + 0.5 * Math.sin(
          this.elapsedSeconds * (Math.PI * 2 / 9) + card.phase,
        );
        break;
      case "rise": {
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
        const progress = (this.elapsedSeconds * card.speed + card.phase) % 1;
        amount = Math.sin(Math.PI * progress);
        break;
      }
    }
    const envelope = ALPHA_ENVELOPES[alphaKind];
    const alpha = envelope[0]
      + (envelope[1] - envelope[0]) * THREE.MathUtils.clamp(amount, 0, 1);
    for (let vertex = 0; vertex < CARD_VERTICES; vertex += 1) {
      batch.colors[(cardIndex * CARD_VERTICES + vertex) * 4 + 3] = alpha;
    }
  }

  private updateLampColors(batch: LivingBatch): void {
    for (let cardIndex = 0; cardIndex < batch.cards.length; cardIndex += 1) {
      const card = batch.cards[cardIndex];
      let brightness = 1;
      if (card.kind === "sequence") {
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
