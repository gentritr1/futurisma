import * as THREE from "three";
import {
  type RaceCourse,
  type CourseSample,
} from "./course";
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
 * Textures a zone set may ask for by name. `motion` is loaded by `load` from
 * the shared atlas URL; the rest come from an authored environment, so a course
 * whose zones never name them (Bitterpan) does not need to supply them.
 */
export interface LivingWorldTextures {
  jungle?: THREE.Texture;
  emissive?: THREE.Texture;
}

interface LivingCard extends AuthoredCard {
  anchorX: number;
  anchorY: number;
  anchorZ: number;
  hangY: number;
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
    const uvQuad = [
      [u0, v0 + size],
      [u0 + size, v0 + size],
      [u0 + size, v0],
      [u0, v0],
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
  motionTexture: THREE.Texture,
  textures: LivingWorldTextures,
): THREE.MeshBasicMaterial {
  const map = spec.texture === "motion"
    ? motionTexture
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

  private constructor(
    private readonly course: RaceCourse,
    spec: LivingWorldSpec,
    motionTexture: THREE.Texture,
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
    };

    this.batches = authored.batches.map((batch) => makeBatch(
      batch.spec,
      batch.cards.map((card) => ({
        ...card,
        anchorX: 0,
        anchorY: 0,
        anchorZ: 0,
        hangY: 0,
        flowSample: null,
      })),
      makeMaterial(batch.spec, motionTexture, textures),
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
        if (card.kind === "flow") card.flowSample = this.course.createSampleScratch();
      }
    }

    this.update(UPDATE_STEP_SECONDS, null);
  }

  static async load(
    course: RaceCourse,
    textures: LivingWorldTextures,
    motionTextureUrl: string,
  ): Promise<LivingWorld> {
    const spec = LIVING_WORLD_SPECS[course.kind];
    if (!spec) {
      throw new Error(`No living-world zone set is authored for ${course.kind}.`);
    }
    const motionTexture = await new THREE.TextureLoader().loadAsync(motionTextureUrl);
    motionTexture.name = "living_world_motion_512";
    motionTexture.colorSpace = THREE.SRGBColorSpace;
    motionTexture.magFilter = THREE.NearestFilter;
    motionTexture.minFilter = THREE.NearestFilter;
    motionTexture.generateMipmaps = false;
    motionTexture.needsUpdate = true;
    try {
      return new LivingWorld(course, spec, motionTexture, textures);
    } catch (error) {
      motionTexture.dispose();
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
            y,
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
    return true;
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
