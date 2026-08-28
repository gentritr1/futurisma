import * as THREE from "three";
import {
  type RaceCourse,
  type CourseSample,
} from "./course";
import type { GreenwaterLivingTextures } from "./environment";

const UPDATE_HZ = 30;
const UPDATE_STEP_SECONDS = 1 / UPDATE_HZ;
const CARD_VERTICES = 4;
const CARD_TRIANGLES = 2;

type CardKind =
  | "mist"
  | "rise"
  | "puff"
  | "rain"
  | "ripple"
  | "flow"
  | "pendulum"
  | "shear"
  | "sequence"
  | "pulse"
  | "blink";
type AlphaKind = "mist" | "rise" | "puff" | "rain" | "ripple" | "flow";
type MotionId =
  | "MIST_WATER_TABLE"
  | "MIST_CANOPY"
  | "STEAM_HANGAR_VENTS"
  | "RAIN_SWEEP"
  | "GLINT_WATER_TABLE"
  | "GLINT_SWEEP_DRAINAGE"
  | "VINE_SWAY_CANOPY"
  | "FROND_SWAY_SWEEP"
  | "PUMP_LAMPS_FUEL_ROW"
  | "CRANE_APEX_BEACON"
  | "MACHINERY_DISTANT";

interface AtlasRect {
  x: number;
  y: number;
  size: number;
  sheetSize: number;
}

interface MotionSpec {
  id: MotionId;
  from: number;
  to: number;
  cards: number;
}

interface LivingCard {
  motionId: MotionId;
  kind: CardKind;
  distance: number;
  side: number;
  lateral: number;
  base: number;
  width: number;
  height: number;
  phase: number;
  speed: number;
  rect: AtlasRect;
  tint: number;
  seed: number;
  amplitude?: number;
  hang?: number;
  alphaKind?: AlphaKind;
  alphaInitial?: number;
  anchorX: number;
  anchorY: number;
  anchorZ: number;
  hangY: number;
  flowSample: CourseSample | null;
}

type LivingCardSeed = Omit<
  LivingCard,
  | "motionId"
  | "anchorX"
  | "anchorY"
  | "anchorZ"
  | "hangY"
  | "flowSample"
>;

interface LivingBatch {
  mesh: THREE.Mesh;
  cards: LivingCard[];
  positions: Float32Array;
  colors: Float32Array;
  positionAttribute: THREE.BufferAttribute;
  colorAttribute: THREE.BufferAttribute;
  hasAnimatedAlpha: boolean;
}

export interface GreenwaterLivingStats {
  drawCalls: 4;
  cards: 155;
  triangles: 310;
  updateHz: 30;
  updateSteps: number;
}

const MOTION: Record<MotionId, MotionSpec> = {
  MIST_WATER_TABLE: { id: "MIST_WATER_TABLE", from: 300, to: 470, cards: 14 },
  MIST_CANOPY: { id: "MIST_CANOPY", from: 1180, to: 1330, cards: 12 },
  STEAM_HANGAR_VENTS: {
    id: "STEAM_HANGAR_VENTS",
    from: 700,
    to: 815,
    cards: 10,
  },
  RAIN_SWEEP: { id: "RAIN_SWEEP", from: 860, to: 1030, cards: 22 },
  GLINT_WATER_TABLE: { id: "GLINT_WATER_TABLE", from: 300, to: 470, cards: 26 },
  GLINT_SWEEP_DRAINAGE: {
    id: "GLINT_SWEEP_DRAINAGE",
    from: 860,
    to: 1030,
    cards: 18,
  },
  VINE_SWAY_CANOPY: { id: "VINE_SWAY_CANOPY", from: 1180, to: 1330, cards: 20 },
  FROND_SWAY_SWEEP: { id: "FROND_SWAY_SWEEP", from: 860, to: 1030, cards: 16 },
  PUMP_LAMPS_FUEL_ROW: {
    id: "PUMP_LAMPS_FUEL_ROW",
    from: 1900,
    to: 2100,
    cards: 9,
  },
  CRANE_APEX_BEACON: { id: "CRANE_APEX_BEACON", from: 760, to: 800, cards: 2 },
  MACHINERY_DISTANT: { id: "MACHINERY_DISTANT", from: 690, to: 820, cards: 6 },
};

const ALPHA_ENVELOPES: Record<AlphaKind, readonly [number, number]> = {
  mist: [0.22, 0.46],
  rise: [0.1, 0.34],
  puff: [0, 0.5],
  rain: [0.08, 0.22],
  ripple: [0, 0.38],
  flow: [0, 0.3],
};

function seededRandom(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6d2b79f5) >>> 0;
    const first = (value ^ (value >>> 15)) * (1 | value);
    const second = (
      value + (((value ^ (value >>> 7)) * (61 | value)) >>> 0)
    ) >>> 0;
    return ((first ^ second) >>> 0) / 0x1_0000_0000;
  };
}

function atlasRect(sheetSize: number, columns: number, slotIndex: number): AtlasRect {
  const size = sheetSize / columns;
  return {
    x: (slotIndex % columns) * size,
    y: Math.floor(slotIndex / columns) * size,
    size,
    sheetSize,
  };
}

const MOTION_RECTS = {
  mist: atlasRect(512, 2, 0),
  steam: atlasRect(512, 2, 1),
  rain: atlasRect(512, 2, 2),
  glint: atlasRect(512, 2, 3),
} as const;
const JUNGLE_RECTS = {
  fern: atlasRect(1024, 4, 3),
  vine: atlasRect(1024, 4, 4),
} as const;
const EMISSIVE_RECTS = {
  amberLamp: atlasRect(512, 4, 0),
  redLamp: atlasRect(512, 4, 2),
} as const;

function makeBatch(
  name: string,
  cards: LivingCard[],
  material: THREE.Material,
): LivingBatch {
  const positions = new Float32Array(cards.length * CARD_VERTICES * 3);
  const uvs = new Float32Array(cards.length * CARD_VERTICES * 2);
  const colors = new Float32Array(cards.length * CARD_VERTICES * 4);
  const indices = new Uint16Array(cards.length * CARD_TRIANGLES * 3);

  for (let cardIndex = 0; cardIndex < cards.length; cardIndex += 1) {
    const card = cards[cardIndex];
    const { rect } = card;
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
  mesh.name = name;
  mesh.frustumCulled = false;
  mesh.userData.alphaChannel = true;
  return {
    mesh,
    cards,
    positions,
    colors,
    positionAttribute,
    colorAttribute,
    hasAnimatedAlpha: cards.some((card) => card.alphaKind !== undefined),
  };
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

export class GreenwaterLivingWorld {
  readonly root = new THREE.Group();
  readonly stats: GreenwaterLivingStats = {
    drawCalls: 4,
    cards: 155,
    triangles: 310,
    updateHz: UPDATE_HZ,
    updateSteps: 0,
  };

  private readonly batches: LivingBatch[];
  private readonly cameraRight = new THREE.Vector3(1, 0, 0);
  private accumulatorSeconds = 0;
  private elapsedSeconds = 0;

  private constructor(
    private readonly course: RaceCourse,
    motionTexture: THREE.Texture,
    textures: GreenwaterLivingTextures,
  ) {
    this.root.name = "GW_LIVING_RUNTIME";
    const random = seededRandom(0x13a7);
    const air: LivingCard[] = [];
    const water: LivingCard[] = [];
    const foliage: LivingCard[] = [];
    const lamps: LivingCard[] = [];

    const spread = (
      spec: MotionSpec,
      target: LivingCard[],
      makeCard: (
        distance: number,
        side: number,
        index: number,
        nextRandom: () => number,
      ) => LivingCardSeed,
    ): void => {
      const span = spec.to - spec.from;
      for (let index = 0; index < spec.cards; index += 1) {
        const distance = spec.from + span * (index + 0.5) / spec.cards;
        const side = index % 2 === 1 ? 1 : -1;
        target.push({
          ...makeCard(distance, side, index, random),
          motionId: spec.id,
          anchorX: 0,
          anchorY: 0,
          anchorZ: 0,
          hangY: 0,
          flowSample: null,
        });
      }
    };

    spread(MOTION.MIST_WATER_TABLE, air, (distance, side, _index, next) => ({
      kind: "mist",
      distance,
      side,
      lateral: 17 + next() * 21,
      base: 2 + next() * 9,
      width: 17 + next() * 17,
      height: 2.2 + next() * 2.3,
      phase: next() * Math.PI * 2,
      speed: 0.55,
      rect: MOTION_RECTS.mist,
      tint: 0xbcd4d0,
      seed: next(),
      alphaKind: "mist",
      alphaInitial: ALPHA_ENVELOPES.mist[0],
    }));
    spread(MOTION.MIST_CANOPY, air, (distance, side, _index, next) => ({
      kind: "rise",
      distance,
      side,
      lateral: 15 + next() * 15,
      base: 3 + next() * 11,
      width: 14 + next() * 11,
      height: 2.4 + next() * 1.8,
      phase: next() * Math.PI * 2,
      speed: 0.28,
      rect: MOTION_RECTS.mist,
      tint: 0x8fae86,
      seed: next(),
      alphaKind: "rise",
      alphaInitial: ALPHA_ENVELOPES.rise[0],
    }));
    spread(MOTION.STEAM_HANGAR_VENTS, air, (distance, _side, index, next) => ({
      kind: "puff",
      distance,
      side: index % 3 !== 0 ? -1 : 1,
      lateral: 9 + (index % 6) * 1.2,
      base: 1.4 + (index % 3) * 0.8,
      width: 3.2,
      height: 3.2,
      phase: index / 10 * Math.PI * 2,
      speed: 1 / 2.4,
      rect: MOTION_RECTS.steam,
      tint: 0xd8cbb2,
      seed: next(),
      alphaKind: "puff",
      alphaInitial: ALPHA_ENVELOPES.puff[0],
    }));
    spread(MOTION.RAIN_SWEEP, air, (distance, side, _index, next) => ({
      kind: "rain",
      distance: distance + (next() - 0.5) * 11,
      side,
      lateral: 24 + next() * 28,
      base: 3 + next() * 16,
      width: 3.4 + next() * 2.4,
      height: 12 + next() * 8,
      phase: next(),
      speed: 14,
      rect: MOTION_RECTS.rain,
      tint: 0xbfd6da,
      seed: next(),
      alphaKind: "rain",
      alphaInitial: ALPHA_ENVELOPES.rain[0],
    }));

    spread(MOTION.GLINT_WATER_TABLE, water, (distance, side, _index, next) => ({
      kind: "ripple",
      distance,
      side,
      lateral: 12 + next() * 32,
      base: 0.15,
      width: 2.4 + next() * 3.1,
      height: 0,
      phase: next() * Math.PI * 2,
      speed: 0.9,
      rect: MOTION_RECTS.glint,
      tint: 0x9fd8cc,
      seed: next(),
      alphaKind: "ripple",
      alphaInitial: ALPHA_ENVELOPES.ripple[0],
    }));
    spread(MOTION.GLINT_SWEEP_DRAINAGE, water, (distance, side, index, next) => ({
      kind: "flow",
      distance,
      side,
      lateral: 11 + (index % 4) * 2.1,
      base: 0.1,
      width: 1.8 + next() * 1.6,
      height: 0,
      phase: next(),
      speed: 3.2,
      rect: MOTION_RECTS.glint,
      tint: 0x8fd4c0,
      seed: next(),
      alphaKind: "flow",
      alphaInitial: ALPHA_ENVELOPES.flow[0],
    }));

    spread(MOTION.VINE_SWAY_CANOPY, foliage, (distance, side, _index, next) => ({
      kind: "pendulum",
      distance,
      side,
      lateral: 8 + next() * 9,
      base: 11,
      hang: 17.4,
      width: 3.4 + next() * 2.2,
      height: 6.4,
      phase: next() * Math.PI * 2,
      speed: Math.PI * 2 / 5.5,
      amplitude: THREE.MathUtils.degToRad(3.2),
      rect: JUNGLE_RECTS.vine,
      tint: 0x6f8f58,
      seed: next(),
    }));
    spread(MOTION.FROND_SWAY_SWEEP, foliage, (distance, side, _index, next) => ({
      kind: "shear",
      distance,
      side,
      lateral: 20 + next() * 16,
      base: 1.2 + next() * 3,
      width: 5 + next() * 3.5,
      height: 4.5 + next() * 3,
      phase: next() * Math.PI * 2,
      speed: Math.PI * 2 / 7.3,
      amplitude: THREE.MathUtils.degToRad(2.4),
      rect: JUNGLE_RECTS.fern,
      tint: 0x5c7a4a,
      seed: next(),
    }));

    spread(MOTION.PUMP_LAMPS_FUEL_ROW, lamps, (distance, side, index, next) => ({
      kind: "sequence",
      distance,
      side,
      lateral: 12 + (index % 5) * 3.1,
      base: 3 + (index % 3) * 0.9,
      width: 0.85,
      height: 0.85,
      phase: (index % 3) / 3,
      speed: 1 / 1.1,
      rect: index === 4 ? EMISSIVE_RECTS.redLamp : EMISSIVE_RECTS.amberLamp,
      tint: index === 4 ? 0xff5a3c : 0xffb45a,
      seed: next(),
    }));
    spread(MOTION.CRANE_APEX_BEACON, lamps, (distance, _side, index, next) => ({
      kind: "pulse",
      distance,
      side: 1,
      lateral: 25.4,
      base: 34 + index * 1.6,
      width: 1.15,
      height: 1.15,
      phase: index * 0.5,
      speed: Math.PI * 2 / 2.6,
      rect: EMISSIVE_RECTS.redLamp,
      tint: 0xff4a34,
      seed: next(),
    }));
    spread(MOTION.MACHINERY_DISTANT, lamps, (distance, _side, index, next) => ({
      kind: "blink",
      distance,
      side: -1,
      lateral: 40 + (index % 3) * 6,
      base: 2.5 + (index % 4) * 2.2,
      width: 0.7,
      height: 0.7,
      phase: (index % 3) * 0.37,
      speed: 1 / (index % 2 !== 0 ? 3.7 : 5.2),
      rect: index % 3 === 2 ? EMISSIVE_RECTS.amberLamp : EMISSIVE_RECTS.redLamp,
      tint: index % 3 === 2 ? 0xffb45a : 0xff4a34,
      seed: next(),
    }));

    const airMaterial = new THREE.MeshBasicMaterial({
      map: motionTexture,
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
      vertexColors: true,
      side: THREE.DoubleSide,
      opacity: 1,
      fog: true,
    });
    const waterMaterial = new THREE.MeshBasicMaterial({
      map: motionTexture,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexColors: true,
      side: THREE.DoubleSide,
      opacity: 1,
      fog: true,
    });
    const foliageMaterial = new THREE.MeshBasicMaterial({
      map: textures.jungle,
      transparent: true,
      alphaTest: 0.5,
      vertexColors: true,
      side: THREE.DoubleSide,
      fog: true,
    });
    const lampMaterial = new THREE.MeshBasicMaterial({
      map: textures.emissive,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexColors: true,
      side: THREE.DoubleSide,
      fog: false,
    });
    this.batches = [
      makeBatch("GW_LIVING_AIR", air, airMaterial),
      makeBatch("GW_LIVING_WATER", water, waterMaterial),
      makeBatch("GW_LIVING_FOLIAGE", foliage, foliageMaterial),
      makeBatch("GW_LIVING_LAMPS", lamps, lampMaterial),
    ];
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
    textures: GreenwaterLivingTextures,
    motionTextureUrl: string,
  ): Promise<GreenwaterLivingWorld> {
    const motionTexture = await new THREE.TextureLoader().loadAsync(motionTextureUrl);
    motionTexture.name = "greenwater_motion_512";
    motionTexture.colorSpace = THREE.SRGBColorSpace;
    motionTexture.magFilter = THREE.NearestFilter;
    motionTexture.minFilter = THREE.NearestFilter;
    motionTexture.generateMipmaps = false;
    motionTexture.needsUpdate = true;
    try {
      return new GreenwaterLivingWorld(course, motionTexture, textures);
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
    this.updateLampColors(this.batches[3]);
    return true;
  }

  private updateCardAlpha(
    batch: LivingBatch,
    cardIndex: number,
    card: LivingCard,
  ): void {
    const alphaKind = card.alphaKind;
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
