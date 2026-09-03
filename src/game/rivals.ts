import * as THREE from "three";
import type { RaceCourse } from "./course";
import {
  RIVAL_CUSHION_YIELD_BLOCKED_METERS,
  RIVAL_CUSHION_YIELD_METERS,
  RIVAL_DEFENCE_LOOKAHEAD_METERS,
  RIVAL_DRIFT_AIRBRAKE_GAIN,
  RIVAL_FIXED_STEP_SECONDS,
  RIVAL_FINISH_RUN_OUT_SECONDS,
  RIVAL_FREE_DECK_FRACTION,
  RIVAL_LANE_CLEARANCE_METERS,
  RIVAL_LANE_CONTEST_GAP_METERS,
  RIVAL_EVASIVE_LATERAL_GAIN,
  RIVAL_NO_BLOCK_MARGIN_FRACTION,
  RIVAL_NO_BLOCK_WINDOW_METERS,
  RIVAL_PLAYER_AVOID_GAP_METERS,
  RIVAL_PAD_APPROACH_METERS,
  RIVAL_PROFILES,
  VEHICLE_CLEARANCE_METERS,
  calculateRivalBankRadians,
  calculateRaceGaps,
  createRivalState,
  freeDeckTargetFraction,
  isInsideBoostWindow,
  measureFreeDeckFraction,
  rankRaceEntries,
  resetRivalState,
  resolveRivalPace,
  rivalBrakeSignal,
  resolveEvasiveSide,
  rivalContestLaneMeters,
  rivalCourseSpeedFactor,
  rivalDriftSignal,
  rivalFinishRunOutDistanceMeters,
  rivalGlowSignal,
  playerRaceDistanceOffsetMeters,
  rivalPaceLaneMeters,
  spreadGridLaterals,
  rivalSteerSignal,
  rivalThrottleSignal,
  stepRivalField,
} from "./rival-race.js";
import {
  BOOST_MAX_SPEED,
  CUSHION_TOW_CONTACT_SEPARATION_METERS,
  SLIPSTREAM_LOCK_THRESHOLD,
  calculateCushion,
  calculateSlipstream,
} from "./physics.js";
import {
  LIVERY_ATLAS_ORDER,
  fieldLiveries,
  liveryFor,
} from "./liveries.js";
import type { MinimapContact } from "./minimap";
import { raceModes } from "./race-modes";
import { reverseGridOrder } from "./race-modes-rules.js";
import { composeShaderInjection } from "./totem";
import type {
  TotemRivalArticulationGroup,
  TotemRivalArticulationSlot,
  TotemRivalVisualBatch,
} from "./totem";
import type { FieldOrderEntry, RaceGridEntry, RaceStandingEntry } from "./ui";

const PLAYER_ID = "player";

/**
 * G2 — how long a rival keeps giving up its extra RIVAL_CUSHION_YIELD_METERS
 * after the air cushion has let go of the player.
 *
 * Measured against the problem it solves: a contact in the five-lap demo soaks
 * averages 0.22 s, and a rival's lateral rate limit means a 0.22 s request
 * moves it a few centimetres. Holding the request for 0.6 s is what turns it
 * into an actual line change without letting a single brush of contact hand the
 * player a lane for the rest of the straight.
 */
const CUSHION_YIELD_HOLD_SECONDS = 0.6;

/**
 * Hull-centre separation at which two TOTEMs stop overlapping. A craft is
 * ~2.2 m across, so this is the line between "leaning" and "intersecting", and
 * it is what `cushionPeakClearPush` is measured against.
 */
const CUSHION_HULL_CLEAR_SEPARATION_METERS = 2.2;
const RIVAL_COUNT = RIVAL_PROFILES.length;
const RIVAL_ROLL_AXIS = new THREE.Vector3(0, 0, 1);
const DEG = Math.PI / 180;

/**
 * Authored travel for each articulated group, matching the ranges the player's
 * own vehicle uses in `TotemVehicle.updateVisual` so a rival and the player
 * read as the same machine.
 */
const ARTICULATION_TRAVEL_RADIANS: Record<TotemRivalArticulationGroup, number> = {
  hull: 0,
  steering_fins: 20 * DEG,
  airbrakes: 60 * DEG,
};

const LOCAL_ROTATION_AXES = {
  x: new THREE.Vector3(1, 0, 0),
  y: new THREE.Vector3(0, 1, 0),
  z: new THREE.Vector3(0, 0, 1),
} as const;

/**
 * The four liveries packed into the runtime atlas, in quadrant order. The three
 * default rivals take the first three; `works` fills the fourth, which is what
 * lets P7's livery select hand the player any sheet and give the displaced
 * rival the works sheet in exchange — no new texture, no new draw call.
 */
const RIVAL_LIVERY_URLS = LIVERY_ATLAS_ORDER.map((code) => liveryFor(code).texture);

const LIVERY_SOURCE_PIXELS = 1024;
const LIVERY_ATLAS_PIXELS = LIVERY_SOURCE_PIXELS * 2;
/**
 * Half a source texel. Clamping every vertex UV inside this inset keeps each
 * quadrant's interpolated UVs inside its own quarter of the atlas, so a livery
 * can never sample its neighbour along a seam. Clamping per vertex is enough:
 * UV interpolation is affine, so it cannot leave the clamped hull.
 */
const LIVERY_UV_INSET = 0.5 / LIVERY_SOURCE_PIXELS;

/** Quadrant origin in atlas UV space, in the same order as the URLs above. */
const LIVERY_ATLAS_OFFSETS: readonly (readonly [number, number])[] = [
  [0, 0],
  [0.5, 0],
  [0, 0.5],
  [0.5, 0.5],
];

const SHADOW_BLOB_COUNT = RIVAL_COUNT + 1;
const PLAYER_BLOB_INDEX = RIVAL_COUNT;
const SHADOW_BLOB_WIDTH_METERS = 3.1;
const SHADOW_BLOB_LENGTH_METERS = 6.1;
const SHADOW_BLOB_AFT_OFFSET_METERS = 0.28;
const SHADOW_BLOB_LIFT_METERS = 0.02;
const SHADOW_BLOB_MAX_OPACITY = 0.18;
const SHADOW_BLOB_MIN_OPACITY = 0.11;
const SHADOW_BLOB_LOW_HOVER_METERS = 0.18;
const SHADOW_BLOB_HIGH_HOVER_METERS = 0.6;
/** Nominal hover a rival is treated as holding, for blob size and weight. */
const RIVAL_NOMINAL_HOVER_METERS = 0.45;

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

function createAccelerationExhaustGeometry(): THREE.PlaneGeometry {
  const geometry = new THREE.PlaneGeometry(1, 1, 1, 1);
  const uv = geometry.getAttribute("uv") as THREE.BufferAttribute;
  for (let index = 0; index < uv.count; index += 1) {
    uv.setXY(
      index,
      0.5 + uv.getX(index) * 0.5,
      0.25 - uv.getY(index) * 0.25,
    );
  }
  uv.needsUpdate = true;
  return geometry;
}

/**
 * A flat quad in the craft's local ground plane. Two triangles; the disc shape
 * comes from a radial alpha falloff in the material, so no texture is needed.
 */
function createShadowBlobGeometry(): THREE.PlaneGeometry {
  const geometry = new THREE.PlaneGeometry(1, 1, 1, 1);
  geometry.rotateX(-Math.PI / 2);
  return geometry;
}

/**
 * The FX atlas has no radial slot to borrow — its eight cells are plumes,
 * chevrons, sprays and sparks — so the blob's falloff is generated in the
 * shader instead. Same one draw call and two triangles, and no atlas texel is
 * spent on it.
 */
function createShadowBlobMaterial(): THREE.MeshBasicMaterial {
  const material = new THREE.MeshBasicMaterial({
    color: 0x07100c,
    transparent: true,
    opacity: 1,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
    fog: true,
  });
  material.name = "TOTEM_shadow_blob";
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nvarying vec2 vBlobUv;",
      )
      .replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\n\tvBlobUv = uv;",
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        "#include <common>\nvarying vec2 vBlobUv;",
      )
      .replace(
        "#include <alphamap_fragment>",
        "#include <alphamap_fragment>\n"
          + "\tdiffuseColor.a *= 1.0 - smoothstep( 0.30, 0.5, length( vBlobUv - 0.5 ) );\n"
          + "\t#ifdef USE_COLOR\n"
          // The instance colour carries per-craft opacity, not a tint, so put
          // the material's own colour back after `color_fragment` scaled it.
          + "\t\tdiffuseColor.a *= vColor.r;\n"
          + "\t\tdiffuseColor.rgb = diffuse;\n"
          + "\t#endif",
      );
  };
  return material;
}

/**
 * Packs the four liveries into a single 2048 canvas so every rival body can be
 * drawn by one instanced mesh instead of one mesh per livery texture. Built at
 * runtime from the shipped 1024 PNGs, so no new asset enters the served set and
 * no hash contract has to be re-baselined.
 *
 * **P15.1 — each quadrant is drawn upside down, on purpose.**
 *
 * The atlas keeps `flipY = false`, because that is what the hull UVs and the
 * quadrant offsets in `LIVERY_ATLAS_OFFSETS` were authored against: the sheet
 * baked into `totem_runtime.glb` is loaded that way by `GLTFLoader`, and it is
 * stored PRE-FLIPPED to suit. The served PNGs are not — they are stored the way
 * `totem/MANIFEST.json` describes them, origin at the top. Painting them into
 * the canvas the obvious way put the hull's paint-chip row on image row 76
 * instead of row 948, so every rival body sampled the mirrored strip: two of
 * the field rendered in flat acid paint and the third in transparent black.
 *
 * The player's own swap fixes this by flipping the SAMPLER (`flipY = true`, see
 * `TotemVehicle.applyLivery`). The atlas cannot: `flipY` here would also invert
 * which half of the canvas each quadrant offset addresses, so the field would
 * wear the wrong liveries and disagree with the grid list. So the pixels are
 * flipped instead, per quadrant, inside its own 1024 block — the quadrant
 * table, the UV inset and `setPlayerLivery`'s buffer rewrite are all untouched.
 */
export async function loadRivalLiveryAtlas(): Promise<THREE.Texture> {
  const loader = new THREE.ImageLoader();
  const images = await Promise.all(
    RIVAL_LIVERY_URLS.map((url) => loader.loadAsync(url)),
  );
  const canvas = document.createElement("canvas");
  canvas.width = LIVERY_ATLAS_PIXELS;
  canvas.height = LIVERY_ATLAS_PIXELS;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Rival livery atlas requires a 2D canvas context.");
  context.imageSmoothingEnabled = false;
  for (let index = 0; index < images.length; index += 1) {
    const [offsetU, offsetV] = LIVERY_ATLAS_OFFSETS[index];
    const originX = offsetU * LIVERY_ATLAS_PIXELS;
    const originY = offsetV * LIVERY_ATLAS_PIXELS;
    // Mirror about this quadrant's own horizontal centre line, so the block
    // lands pre-flipped exactly like the GLB's sheet and the quadrant keeps its
    // place in the atlas.
    context.save();
    context.translate(originX, originY + LIVERY_SOURCE_PIXELS);
    context.scale(1, -1);
    context.drawImage(images[index], 0, 0, LIVERY_SOURCE_PIXELS, LIVERY_SOURCE_PIXELS);
    context.restore();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.name = "totem_liveries_2048_runtime";
  // Identical treatment to the per-rival textures this replaces, so the atlas
  // cannot change how a livery reads at any distance.
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.flipY = false;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestMipmapLinearFilter;
  texture.anisotropy = 1;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

export interface RivalRaceStatus {
  position: number;
  racerCount: number;
  gapToAheadMs: number | null;
  gapToBehindMs: number | null;
}

/**
 * The status a race shows before anyone has moved. A solo session has no fleet
 * at all, so the race loop needs a defined standing either way; extracted here
 * in P11 because the fallback shape belongs with the type that defines it.
 */
export function openingRaceStatus(
  fleet: { raceStatus: RivalFleet["raceStatus"] } | null | undefined,
  playerRaceDistanceMeters: number,
): RivalRaceStatus {
  return fleet?.raceStatus(playerRaceDistanceMeters, 0)
    // G4 — the fallback now asks the format how many craft are classified.
    // `race` and `sprint` still answer 4, exactly as the hard-coded number did;
    // `timeattack` answers 1, and it is this line that makes `fieldSize` report
    // a solo run honestly rather than claiming three rivals that were never
    // spawned.
    ?? {
      position: 1,
      racerCount: raceModes.fieldSize(RIVAL_PROFILES.length),
      gapToAheadMs: null,
      gapToBehindMs: null,
    };
}

export interface RivalFleetDiagnostics {
  drawCalls: number;
  triangles: number;
  updateSteps: number;
  minimumSeparationMeters: number;
  minimumRivalSeparationMeters: number;
  /** G2 - the player half only, sampled after the cushion has moved the craft. */
  playerRivalMinimumSeparationMeters: number;
  cushionSeconds: number;
  cushionPeakPush: number;
  cushionContacts: number;
  cushionPushNow: number;
  cushionGapNow: number;
  cushionSeparationNow: number;
  cushionYieldNow: number;
  cushionPeakClearPush: number;
  cushionSeparationAtPeakClearPush: number;
  closestPlayerContact: {
    id: string;
    longitudinalMeters: number;
    lateralMeters: number;
    lap: number;
    courseDistanceMeters: number;
    cushionActive: boolean;
    cushionPush: number;
    towLocked: boolean;
  };
  closestApproach: {
    id: string;
    longitudinalMeters: number;
    lateralMeters: number;
    courseDistanceMeters: number;
    lap: number;
    targetLateralMeters: number;
    rivalLateralMeters: number;
    playerLateralMeters: number;
  };
  catchUpMultiplier: number;
  articulatedGroups: string[];
  maximumSteerRadians: number;
  /** G1 - the free-deck rule (PRODUCT.md principle 5), measured live. */
  minimumFreeDeckFraction: number;
  minimumClearFreeDeckFraction: number;
  minimumFreeDeckTargetFraction: number;
  freeDeckSamples: number;
  freeDeckAlongsideSamples: number;
  leadChanges: number;
  /** G1 - the player's tow, accumulated by the fleet that supplies it. */
  slipstream: number;
  slipstreamRival: string;
  slipstreamAheadMeters: number;
  slipstreamLateralMeters: number;
  slipstreamWorldMeters: number;
  slipstreamMaxPositionMismatchMeters: number;
  slipstreamSeconds: number;
  slipstreamPeak: number;
  slipstreamLocks: number;
  articulation: Array<{
    id: string;
    steerRadians: number;
    brakeRadians: number;
    driftSignal: number;
  }>;
  states: Array<{
    id: string;
    name: string;
    lap: number;
    raceDistanceMeters: number;
    speedKph: number;
    lateralMeters: number;
    finishTimeMs: number | null;
    recoveries: number;
    lapTimesMs: number[];
    boostSeconds: number;
    boostReserve: number;
    padHits: number;
    driftEntries: number;
    driftSeconds: number;
  }>;
}

type RivalState = ReturnType<typeof createRivalState>;

interface RivalVisual {
  mesh: THREE.InstancedMesh;
  group: TotemRivalArticulationGroup;
  slots: readonly TotemRivalArticulationSlot[];
}

export class RivalFleet {
  readonly root = new THREE.Group();
  /** Rebuilt by {@link setPlayerLivery}, so the grid list follows the choice. */
  gridEntries: readonly RaceGridEntry[] = [];
  /** Livery code per rival slot, in `RIVAL_PROFILES` order. */
  private fieldLiveryCodes: readonly string[];
  /** The in-fiction issue each rival is announced as, same order. */
  private liveryLabels: readonly string[];
  /** One entry per instanced body batch: the atlas-quadrant offset buffer. */
  private readonly liveryOffsetBuffers: {
    attribute: THREE.InstancedBufferAttribute;
    slotCount: number;
  }[] = [];
  private readonly states: RivalState[];
  private readonly previousDistances = new Float64Array(RIVAL_COUNT);
  private readonly previousLaterals = new Float32Array(RIVAL_COUNT);
  /**
   * G2 round 3 - the side of the player each rival has committed to avoiding
   * on, and how long it has been committed. See `resolveEvasiveSide`; without
   * this a rival re-picks its side every frame from the player's current
   * lateral and sweeps through it when the player crosses its centreline.
   */
  private readonly evasiveSides = new Float32Array(RIVAL_COUNT);
  private readonly evasiveHeldSeconds = new Float32Array(RIVAL_COUNT);
  private readonly evasiveScratch = { side: 0, heldSeconds: 0 };
  private readonly steerSignals = new Float32Array(RIVAL_COUNT);
  private readonly brakeSignals = new Float32Array(RIVAL_COUNT);
  private readonly throttleSignals = new Float32Array(RIVAL_COUNT);
  private readonly glowSignals = new Float32Array(RIVAL_COUNT);
  private readonly driftSignals = new Float32Array(RIVAL_COUNT);
  /** G1 - the authored pace for this map, resolved once per rival at assembly. */
  private readonly paces: ReturnType<typeof resolveRivalPace>[];
  private readonly noBlockSide: number;
  /**
   * Metres to add to an incoming player race distance to put it in the rivals'
   * frame. See {@link playerRaceDistanceOffsetMeters}: the player's distance is
   * measured from the start line and a rival's from station zero, and every
   * comparison between them was out by this much until it was measured.
   */
  private readonly playerDistanceOffset: number;
  private readonly driftCurvature: number;
  /**
   * One drive-input scratch per rival. `stepRivalField` writes `deltaSeconds`
   * straight into whatever the resolver returns, so a whole race allocates
   * nothing in the rival loop.
   */
  private readonly driveScratch: Record<string, unknown>[];
  private readonly freeDeckScratch: number[] = [];
  private readonly neighbourScratch: number[] = [];
  private readonly closestApproach = {
    id: "",
    longitudinalMeters: 0,
    lateralMeters: 0,
    courseDistanceMeters: 0,
    lap: 0,
    targetLateralMeters: 0,
    rivalLateralMeters: 0,
    playerLateralMeters: 0,
  };
  private fieldRemainderSeconds = 0;
  private readonly visuals: RivalVisual[] = [];
  private readonly engineGlow: THREE.InstancedMesh;
  private readonly shadowBlobs: THREE.InstancedMesh;
  private readonly sample;
  private readonly lookAheadSample;
  private readonly poseMatrix = new THREE.Matrix4();
  private readonly slotMatrix = new THREE.Matrix4();
  private readonly articulationMatrix = new THREE.Matrix4();
  private readonly poseQuaternion = new THREE.Quaternion();
  private readonly bankQuaternion = new THREE.Quaternion();
  private readonly posePosition = new THREE.Vector3();
  private readonly poseScale = new THREE.Vector3(1, 1, 1);
  private readonly backward = new THREE.Vector3();
  private readonly blobPosition = new THREE.Vector3();
  private readonly blobScale = new THREE.Vector3();
  private readonly blobBasis = new THREE.Matrix4();
  private readonly blobQuaternion = new THREE.Quaternion();
  private readonly blobMatrix = new THREE.Matrix4();
  private readonly blobColor = new THREE.Color();
  private readonly glowScale = new THREE.Vector3();
  private readonly glowColor = new THREE.Color();
  private readonly glowTints: THREE.Color[];
  private readonly engineLocalMatrix = new THREE.Matrix4();
  private readonly engineScaledMatrix = new THREE.Matrix4();
  private readonly engineWorldMatrix = new THREE.Matrix4();
  private readonly finishVisualAges = new Float32Array(RIVAL_COUNT);
  private readonly finishRunOutSpeeds = new Float32Array(RIVAL_COUNT);
  private readonly worldPositions: THREE.Vector3[];
  private readonly worldVelocities: THREE.Vector3[];
  private readonly articulatedGroups: string[] = [];
  private updateSteps = 0;
  private minimumSeparationMeters = Infinity;
  private minimumRivalSeparationMeters = Infinity;
  private maximumSteerRadians = 0;
  private minimumFreeDeckFraction = 1;
  private minimumClearFreeDeckFraction = 1;
  private minimumFreeDeckTargetFraction = 1;
  private freeDeckSamples = 0;
  private freeDeckAlongsideSamples = 0;
  private leadChanges = 0;
  private previousLeader = -1;
  /**
   * G1 - the player's tow. The fleet owns it because the fleet already has the
   * three race distances and laterals it is computed from; `game.ts` reads
   * `slipstreamStrength` back on the same fixed step.
   */
  private slipstream = 0;
  /**
   * Which rival is supplying the tow and the two numbers the physics read for
   * it, plus the world-space separation the SAME frame actually rendered.
   *
   * The pair exists to answer one question that a screenshot cannot: when the
   * chip says LOCK, is the craft it is drafting really where the race-distance
   * model thinks it is? `slipstreamAhead`/`slipstreamLateralGap` are the model;
   * `slipstreamWorld` is measured off the composed instance matrices against
   * the player's own on-surface point. They should agree to within the hover
   * offset (~0.8 m of height the flat model does not carry), and
   * `slipstreamMaxPositionMismatch` is the worst disagreement over the race.
   */
  private slipstreamRivalIndex = -1;
  private slipstreamAhead = 0;
  private slipstreamLateralGap = 0;
  private slipstreamWorld = 0;
  private slipstreamMaxPositionMismatch = 0;
  /** Nearest rival ahead of the player, and how far off its line the player is. */
  private draftDistance = Number.POSITIVE_INFINITY;
  private draftLateral = Number.POSITIVE_INFINITY;
  private slipstreamSeconds = 0;
  private slipstreamPeak = 0;
  private slipstreamLocks = 0;
  private slipstreamLockedThisStep = false;
  /**
   * G2 air cushion. The fleet resolves it because the fleet already holds the
   * race-distance frame both craft are compared in; the race loop applies the
   * result to the player and never sees a rival's state.
   *
   * `cushionResult` is the single scratch handed to `calculateCushion`, so a
   * whole race allocates nothing here. `cushionRivalIndex` is the craft being
   * leaned on, and it is the only rival the extra yield reaches.
   */
  private readonly cushionResult = { lateralPush: 0, speedScrub: 0, contact: false };
  private cushionRivalIndex = -1;
  private cushionYieldSign = 0;
  private cushionYieldHold = 0;
  private heldCushionRivalIndex = -1;
  private heldCushionYieldSign = 0;
  /**
   * Set by the race loop when the apron clamp refused the cushion's push. The
   * player is pinned against the deck edge, so the rival takes the whole
   * separation instead of half of it.
   */
  private cushionPlayerBlocked = false;
  /**
   * Live, this-step contact telemetry, for the state-triggered screenshot
   * harness. A soak total says a contact happened somewhere; these say what the
   * frame on screen is actually showing, which is what a screenshot has to be
   * argued from.
   */
  private cushionPushNow = 0;
  private cushionPeakClearPush = 0;
  private cushionSeparationAtPeakClearPush = 0;
  private cushionGapNow = 0;
  private cushionSeparationNow = 0;
  private cushionSeconds = 0;
  private cushionPeakPush = 0;
  private cushionContacts = 0;
  private cushionContactSide = 0;
  private cushionActiveLastStep = false;
  private cushionEnabled = true;
  /**
   * Player-versus-rival separation ONLY, and measured after the cushion has
   * moved the player rather than before. `minimumSeparationMeters` mixes this
   * with the rival-versus-rival pairs, so it can never fall below the fleet's
   * own 3.5 m floor and cannot show what the cushion did.
   */
  private playerRivalMinimumSeparationMeters = Infinity;
  private readonly closestPlayerContact = {
    id: "",
    longitudinalMeters: 0,
    lateralMeters: 0,
    lap: 0,
    courseDistanceMeters: 0,
    cushionActive: false,
    cushionPush: 0,
    towLocked: false,
  };
  /**
   * G2 pass detection. The player's race distance last step, so a crossing
   * from behind to ahead can be spotted without the race loop keeping a second
   * copy of the frame conversion.
   */
  private previousPlayerRaceDistance = 0;
  private hasPreviousPlayerRaceDistance = false;
  /** Passes completed on THIS step, at most one per rival. Reused, never grown. */
  private readonly passScratch = RIVAL_PROFILES.map(() => ({
    id: "",
    lateralGapMeters: 0,
  }));
  private passCount = 0;

  readonly stats: {
    drawCalls: number;
    triangles: number;
  };

  /**
   * Assemble a fleet from the loaded vehicle: builds the rival visual batches,
   * loads the livery atlas, and owns cleanup when the game is disposed while
   * the atlas is still in flight. Returns null when disposed mid-assembly.
   *
   * G4 — null now has a second meaning: the race format spawns no field. The
   * check is FIRST, before the batches are built and before the livery atlas is
   * fetched, so a time attack costs neither — "the fleet is absent" has to mean
   * absent in the draw calls, the texture count and the network tab, not just
   * in the scene graph. The caller tells the two nulls apart with
   * `raceModes.hasField`, which is the same question asked before the work
   * rather than after it.
   */
  static async create(
    course: RaceCourse,
    totalLaps: number,
    vehicle: {
      createRivalVisualBatches(): TotemRivalVisualBatch[];
      effectsAtlas(): THREE.Texture;
    },
    isDisposed: () => boolean,
    playerLivery = "works",
  ): Promise<RivalFleet | null> {
    if (!raceModes.hasField) return null;
    const visualBatches = vehicle.createRivalVisualBatches();
    const disposeBatches = (): void => {
      for (const batch of visualBatches) {
        batch.geometry.dispose();
        batch.material.dispose();
      }
    };
    let liveryAtlas: THREE.Texture;
    try {
      liveryAtlas = await loadRivalLiveryAtlas();
    } catch (error) {
      disposeBatches();
      throw error;
    }
    if (isDisposed()) {
      disposeBatches();
      liveryAtlas.dispose();
      return null;
    }
    return new RivalFleet(
      course,
      totalLaps,
      visualBatches,
      liveryAtlas,
      vehicle.effectsAtlas(),
      playerLivery,
    );
  }

  constructor(
    private readonly course: RaceCourse,
    private readonly totalLaps: number,
    visualBatches: readonly TotemRivalVisualBatch[],
    liveryAtlas: THREE.Texture,
    effectsAtlas: THREE.Texture,
    playerLivery = "works",
  ) {
    if (visualBatches.length < 3) {
      throw new Error(
        `Rival fleet requires at least three TOTEM batches; received ${visualBatches.length}.`,
      );
    }
    this.root.name = "totem_rival_fleet";
    // P7 — the field's three liveries, given what the player took. The chosen
    // sheet is swapped one-for-one with the works sheet, so the grid is always
    // four distinct liveries and no rival ever wears the player's.
    this.fieldLiveryCodes = fieldLiveries(playerLivery);
    this.liveryLabels = this.fieldLiveryCodes.map((code) => liveryFor(code).label);
    this.states = RIVAL_PROFILES.map((profile) => (
      createRivalState(profile.id, course.length, totalLaps)
    ));
    this.sample = course.createSampleScratch();
    this.lookAheadSample = course.createSampleScratch();
    // G4 — the tier's table, resolved from the map's authored block before
    // anything reads a cruise speed. Resolved once here rather than per step,
    // for the same reason the works table always was: the pace a rival drives
    // is authored data, and a per-step lookup would be an invitation to make it
    // depend on something.
    const pace = raceModes.paceFor(course.rivalPace) as typeof course.rivalPace;
    this.paces = RIVAL_PROFILES.map((profile) => resolveRivalPace(pace, profile.id));
    this.noBlockSide = pace && Number.isFinite(pace.noBlockSide) ? pace.noBlockSide : -1;
    this.playerDistanceOffset = playerRaceDistanceOffsetMeters(
      course.startProgress,
      course.length,
    );
    this.driftCurvature = pace && Number.isFinite(pace.driftCurvature)
      ? pace.driftCurvature
      : Number.POSITIVE_INFINITY;
    this.driveScratch = RIVAL_PROFILES.map(() => ({
      deltaSeconds: RIVAL_FIXED_STEP_SECONDS,
    }));
    this.worldPositions = RIVAL_PROFILES.map(() => new THREE.Vector3());
    this.worldVelocities = RIVAL_PROFILES.map(() => new THREE.Vector3());
    this.glowTints = RIVAL_PROFILES.map(
      (profile) => new THREE.Color(profile.engineTint),
    );

    for (const batch of visualBatches) {
      const slotCount = batch.slots.length;
      const instanceCount = RIVAL_COUNT * slotCount;
      const mesh = new THREE.InstancedMesh(
        batch.geometry,
        batch.material,
        instanceCount,
      );
      mesh.name = `rival_${batch.role.toLowerCase()}_${batch.group}`;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      // P20.1. An InstancedMesh casts every instance from one depth draw, so
      // the whole field costs one extra call in the shadow pass. Receiving is
      // still off: the rivals carry their own emissive read and a shadow across
      // a rival hull at 300 km/h is noise, not information.
      mesh.castShadow = true;
      mesh.receiveShadow = false;
      mesh.frustumCulled = false;
      if (batch.role === "TOTEM_body") {
        // One atlas, one material, one draw call: the livery a body instance
        // wears is chosen by its quadrant offset rather than by its texture.
        const material = batch.material;
        if (!(material instanceof THREE.MeshStandardMaterial)) {
          throw new Error("TOTEM body rival batch requires a standard material.");
        }
        if (material.map !== liveryAtlas) {
          material.map = liveryAtlas;
          material.color.set(0xffffff);
          // Composed rather than assigned. `material.onBeforeCompile = fn`
          // would drop the PS2 grade and P15's wear multiply that totem.ts
          // already armed on this clone — and leave their cache key behind, so
          // the material would then reuse a program carrying NEITHER this
          // quadrant offset nor the injections it just deleted.
          composeShaderInjection(material, "livery-atlas", (shader) => {
            shader.vertexShader = shader.vertexShader
              .replace(
                "#include <common>",
                "#include <common>\nattribute vec2 aLiveryOffset;",
              )
              .replace(
                "#include <uv_vertex>",
                "#include <uv_vertex>\n"
                  + "\t#ifdef USE_MAP\n"
                  + `\t\tvMapUv = clamp( vMapUv, ${LIVERY_UV_INSET.toFixed(10)}, `
                  + `${(1 - LIVERY_UV_INSET).toFixed(10)} ) * 0.5 + aLiveryOffset;\n`
                  + "\t#endif",
              );
          });
        }
        const offsets = new Float32Array(instanceCount * 2);
        for (let index = 0; index < instanceCount; index += 1) {
          const rival = Math.floor(index / slotCount);
          const [offsetU, offsetV] = LIVERY_ATLAS_OFFSETS[
            LIVERY_ATLAS_ORDER.indexOf(this.fieldLiveryCodes[rival])
          ];
          offsets[index * 2] = offsetU;
          offsets[index * 2 + 1] = offsetV;
          // Restores the authored mean brightness of the side this instance
          // stands for, since both sides share one baked vertex-shading buffer.
          mesh.setColorAt(
            index,
            this.blobColor.setScalar(batch.slots[index % slotCount].shadingScale),
          );
        }
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        const attribute = new THREE.InstancedBufferAttribute(offsets, 2);
        batch.geometry.setAttribute("aLiveryOffset", attribute);
        // Kept so P7's livery select can re-issue the field in place: the swap
        // is a rewrite of this buffer, not a rebuild of the instanced mesh.
        this.liveryOffsetBuffers.push({ attribute, slotCount });
      } else {
        for (let index = 0; index < instanceCount; index += 1) {
          const tint = new THREE.Color(RIVAL_PROFILES[Math.floor(index / slotCount)].tint);
          if (batch.role === "TOTEM_glass") tint.lerp(new THREE.Color(0x99afb0), 0.55);
          mesh.setColorAt(index, tint);
        }
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      }
      if (batch.group !== "hull") this.articulatedGroups.push(batch.group);
      this.visuals.push({ mesh, group: batch.group, slots: batch.slots });
      this.root.add(mesh);
    }

    const glowGeometry = createAccelerationExhaustGeometry();
    const glowMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      map: effectsAtlas,
      transparent: true,
      opacity: 0.52,
      depthWrite: false,
      blending: THREE.NormalBlending,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    this.engineGlow = new THREE.InstancedMesh(
      glowGeometry,
      glowMaterial,
      RIVAL_COUNT,
    );
    this.engineGlow.name = "rival_engine_glow";
    this.engineGlow.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.engineGlow.frustumCulled = false;
    for (let index = 0; index < RIVAL_COUNT; index += 1) {
      this.engineGlow.setColorAt(index, this.glowTints[index]);
    }
    if (this.engineGlow.instanceColor) {
      this.engineGlow.instanceColor.needsUpdate = true;
    }
    this.root.add(this.engineGlow);
    this.engineLocalMatrix.compose(
      new THREE.Vector3(0, 0.15, 3.05),
      new THREE.Quaternion(),
      new THREE.Vector3(1.35, 0.9, 1),
    );

    const blobGeometry = createShadowBlobGeometry();
    this.shadowBlobs = new THREE.InstancedMesh(
      blobGeometry,
      createShadowBlobMaterial(),
      SHADOW_BLOB_COUNT,
    );
    this.shadowBlobs.name = "totem_shadow_blobs";
    this.shadowBlobs.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.shadowBlobs.frustumCulled = false;
    this.shadowBlobs.renderOrder = 1;
    // Every blob starts collapsed. The rivals are filled in by the reset below;
    // the player's slot stays hidden until the first pose update places it,
    // so an untouched identity matrix can never leave a blob at the origin.
    this.blobMatrix.compose(
      this.blobPosition.set(0, 0, 0),
      this.blobQuaternion.identity(),
      this.blobScale.setScalar(0.00001),
    );
    for (let index = 0; index < SHADOW_BLOB_COUNT; index += 1) {
      this.shadowBlobs.setMatrixAt(index, this.blobMatrix);
      this.shadowBlobs.setColorAt(index, this.blobColor.setScalar(1));
    }
    this.shadowBlobs.instanceMatrix.needsUpdate = true;
    if (this.shadowBlobs.instanceColor) {
      this.shadowBlobs.instanceColor.needsUpdate = true;
    }
    this.root.add(this.shadowBlobs);

    const visualTriangles = visualBatches.reduce(
      (total, batch) => total + batch.triangles * RIVAL_COUNT * batch.slots.length,
      0,
    );
    const perInstanceTriangles = (geometry: THREE.BufferGeometry) => (
      (geometry.index?.count ?? geometry.getAttribute("position").count) / 3
    );
    this.stats = {
      drawCalls: this.visuals.length + 2,
      triangles: visualTriangles
        + perInstanceTriangles(glowGeometry) * RIVAL_COUNT
        + perInstanceTriangles(blobGeometry) * SHADOW_BLOB_COUNT,
    };
    // Also builds `gridEntries`; the constructor and a later swap take exactly
    // the same path, so the grid list cannot drift from what the field wears.
    this.setPlayerLivery(playerLivery);
    this.reset();
  }

  reset(): void {
    // The grid is fanned once, here, before anyone moves: the authored slots on
    // both maps put two craft closer than a field can hold station in, and the
    // launch now depends on every craft keeping the slot it was given.
    this.course.sample(this.course.startProgress, this.sample);
    const gridLaterals = spreadGridLaterals(
      this.course.startLateral,
      RIVAL_PROFILES.map((profile) => (
        this.course.rivalGridStart(profile.name)?.lateralMeters
          ?? profile.startingLateralMeters
      )),
      Math.max(0, this.sample.halfWidth - VEHICLE_CLEARANCE_METERS),
    );
    // G4 — the field's longitudinal slots, gathered before they are assigned so
    // the sprint can hand them out back to front. `reverseGridOrder` permutes
    // the slots the map authored rather than inventing new ones, so the spacing
    // between them is whatever the circuit already said it should be, and the
    // lateral fan above is untouched: it is computed from the profiles' lanes,
    // which do not move. See `reverseGridOrder` for why this reverses the FIELD
    // rather than the whole grid.
    const authoredSlots = RIVAL_PROFILES.map((profile) => {
      const gridStart = this.course.rivalGridStart(profile.name);
      return gridStart ?? {
        raceDistanceMeters: profile.gridOffsetMeters,
        courseDistanceMeters: profile.gridOffsetMeters,
      };
    });
    const slots = raceModes.reversesGrid
      ? reverseGridOrder(authoredSlots)
      : authoredSlots;
    this.states.forEach((state, index) => {
      resetRivalState(state, this.course.length, this.totalLaps);
      state.raceDistanceMeters = slots[index].raceDistanceMeters;
      state.courseDistanceMeters = slots[index].courseDistanceMeters;
      state.lastSafeDistanceMeters = slots[index].raceDistanceMeters;
      state.lateralMeters = gridLaterals[index];
      // The player-free lane starts on the grid slot too, or the first pad
      // lookup would be resolved against the profile's nominal lane instead.
      state.paceLateralMeters = gridLaterals[index];
      state.lastSafeLateralMeters = gridLaterals[index];
      this.previousDistances[index] = state.raceDistanceMeters;
      this.previousLaterals[index] = state.lateralMeters;
      this.finishVisualAges[index] = 0;
      this.finishRunOutSpeeds[index] = 0;
      this.steerSignals[index] = 0;
      this.brakeSignals[index] = 0;
      this.throttleSignals[index] = 0;
      this.glowSignals[index] = 0;
      this.driftSignals[index] = 0;
    });
    this.updateSteps = 0;
    this.fieldRemainderSeconds = 0;
    this.minimumSeparationMeters = Infinity;
    this.minimumRivalSeparationMeters = Infinity;
    this.closestApproach.id = "";
    this.closestApproach.longitudinalMeters = 0;
    this.closestApproach.lateralMeters = 0;
    this.closestApproach.courseDistanceMeters = 0;
    this.closestApproach.lap = 0;
    this.closestApproach.targetLateralMeters = 0;
    this.closestApproach.rivalLateralMeters = 0;
    this.closestApproach.playerLateralMeters = 0;
    this.maximumSteerRadians = 0;
    this.minimumFreeDeckFraction = 1;
    this.minimumClearFreeDeckFraction = 1;
    this.minimumFreeDeckTargetFraction = 1;
    this.freeDeckSamples = 0;
    this.freeDeckAlongsideSamples = 0;
    this.leadChanges = 0;
    this.previousLeader = -1;
    this.slipstream = 0;
    this.slipstreamRivalIndex = -1;
    this.slipstreamAhead = 0;
    this.slipstreamLateralGap = 0;
    this.slipstreamWorld = 0;
    this.slipstreamMaxPositionMismatch = 0;
    this.draftDistance = Number.POSITIVE_INFINITY;
    this.draftLateral = Number.POSITIVE_INFINITY;
    this.slipstreamSeconds = 0;
    this.slipstreamPeak = 0;
    this.slipstreamLocks = 0;
    this.slipstreamLockedThisStep = false;
    this.cushionResult.lateralPush = 0;
    this.cushionResult.speedScrub = 0;
    this.cushionResult.contact = false;
    this.cushionRivalIndex = -1;
    this.cushionYieldSign = 0;
    this.cushionYieldHold = 0;
    this.heldCushionRivalIndex = -1;
    this.heldCushionYieldSign = 0;
    this.cushionPlayerBlocked = false;
    this.evasiveSides.fill(0);
    this.evasiveHeldSeconds.fill(0);
    this.cushionPushNow = 0;
    this.cushionPeakClearPush = 0;
    this.cushionSeparationAtPeakClearPush = 0;
    this.cushionGapNow = 0;
    this.cushionSeparationNow = 0;
    this.cushionSeconds = 0;
    this.cushionPeakPush = 0;
    this.cushionContacts = 0;
    this.cushionContactSide = 0;
    this.cushionActiveLastStep = false;
    this.playerRivalMinimumSeparationMeters = Infinity;
    this.closestPlayerContact.id = "";
    this.closestPlayerContact.cushionActive = false;
    this.closestPlayerContact.cushionPush = 0;
    this.closestPlayerContact.towLocked = false;
    this.previousPlayerRaceDistance = 0;
    this.hasPreviousPlayerRaceDistance = false;
    this.passCount = 0;
    this.updatePresentation(1, 0);
  }

  /** `?cushion=0`. Off, the fleet behaves exactly as it did in G1. */
  setCushionEnabled(enabled: boolean): void {
    this.cushionEnabled = enabled;
    if (!enabled) {
      this.cushionResult.lateralPush = 0;
      this.cushionResult.speedScrub = 0;
      this.cushionRivalIndex = -1;
      this.cushionYieldSign = 0;
      this.cushionYieldHold = 0;
      this.cushionActiveLastStep = false;
    }
  }

  /**
   * Puts a player race distance - measured from the start line - into the frame
   * a rival's race distance is measured in. Every comparison between the two
   * goes through here; see {@link playerRaceDistanceOffsetMeters}.
   */
  private rivalFrameDistance(playerDistanceFromStart: number): number {
    return playerDistanceFromStart + this.playerDistanceOffset;
  }

  /**
   * G1 - the player's tow, 0..1, refreshed on the fixed step this fleet was
   * last advanced on. Read by `game.ts` in the same step.
   */
  get slipstreamStrength(): number {
    return this.slipstream;
  }

  /** True only on the step the tow crossed {@link SLIPSTREAM_LOCK_THRESHOLD}. */
  get slipstreamLocked(): boolean {
    return this.slipstreamLockedThisStep;
  }

  /** Metres to the nearest rival ahead of the player, Infinity when there is none. */
  get draftDistanceMeters(): number {
    return this.draftDistance;
  }

  /** Signed lateral offset from that rival's line. */
  get draftLateralMeters(): number {
    return this.draftLateral;
  }

  /**
   * G2 — the cushion the player is currently inside, resolved against every
   * rival and reported for the strongest.
   *
   * Called by the race loop from `updateRace`, with the player's post-move
   * lateral, so the push answers where the craft actually is this step rather
   * than where it was when the fleet was advanced. Returns the fleet's own
   * scratch: read it, do not keep it.
   *
   * @param playerDistanceFromStart player race distance, start-line frame
   * @param playerLateralMeters player lateral, after this step's move
   * @param playerLateralSpeed player's lateral rate, m/s, signed
   * @param deltaSeconds the step, used for the rivals' own lateral rate
   */
  resolveCushion(
    playerDistanceFromStart: number,
    playerLateralMeters: number,
    playerLateralSpeed: number,
    deltaSeconds: number,
  ): { lateralPush: number; speedScrub: number } {
    this.cushionResult.lateralPush = 0;
    this.cushionResult.speedScrub = 0;
    this.cushionRivalIndex = -1;
    this.cushionYieldSign = 0;
    if (!this.cushionEnabled) {
      this.cushionActiveLastStep = false;
      return this.cushionResult;
    }
    const playerRaceDistanceMeters = this.rivalFrameDistance(playerDistanceFromStart);
    const step = deltaSeconds > 0 ? deltaSeconds : RIVAL_FIXED_STEP_SECONDS;
    let strongest = 0;
    let strongestPush = 0;
    let strongestScrub = 0;
    let strongestIndex = -1;
    let strongestSign = 0;
    let strongestGap = 0;
    let strongestSeparation = 0;
    let strongestContact = false;
    for (let index = 0; index < this.states.length; index += 1) {
      const state = this.states[index];
      if (state.finished) continue;
      // A craft the player is correctly DRAFTING is not a craft the player is
      // leaning on, and the cushion must not break the one mechanic G1 built.
      //
      // The two windows overlap almost completely: a full tow runs from 4 m
      // behind and the cushion reaches 5.5 m, both inside ~2.5 m of lateral, so
      // every properly slotted wake also sits in the cushion. Measured: the
      // Greenwater demo soak went from 13 slipstream locks to 4 the moment the
      // cushion was armed, because the push was shoving the driver sideways out
      // of its own tow. A locked tow is the one case where being that close is
      // the game working, so it is excluded.
      const lateralGap = state.lateralMeters - playerLateralMeters;
      const longitudinalGap = state.raceDistanceMeters - playerRaceDistanceMeters;
      // ... but a tow that has closed to within CUSHION_TOW_CONTACT_SEPARATION_
      // METERS is not a tow any more, it is a rear-end, so the lock is dropped
      // in `measureSlipstream` and the cushion re-arms here.
      if (
        index === this.slipstreamRivalIndex
        && this.slipstream >= SLIPSTREAM_LOCK_THRESHOLD
        && Math.hypot(longitudinalGap, lateralGap)
          >= CUSHION_TOW_CONTACT_SEPARATION_METERS
      ) continue;
      // Positive when the gap is shrinking. The rival's own lateral rate is
      // taken from the step it just ran, so a craft already sliding away is not
      // treated as diving in.
      const rivalLateralSpeed = (state.lateralMeters - this.previousLaterals[index]) / step;
      const closing = -Math.sign(lateralGap || 1)
        * (rivalLateralSpeed - playerLateralSpeed);
      const cushion = calculateCushion(
        lateralGap,
        longitudinalGap,
        closing,
        this.cushionResult,
      );
      const magnitude = Math.abs(cushion.lateralPush);
      if (magnitude > strongest) {
        strongest = magnitude;
        strongestPush = cushion.lateralPush;
        strongestScrub = cushion.speedScrub;
        strongestIndex = index;
        strongestSign = lateralGap >= 0 ? 1 : -1;
        strongestGap = lateralGap;
        strongestSeparation = Math.hypot(longitudinalGap, lateralGap);
        strongestContact = cushion.contact;
      }
    }
    this.cushionResult.lateralPush = strongestPush;
    this.cushionResult.speedScrub = strongestScrub;
    // ACTIVE means contact, not merely "the pre-lean is bleeding closure off".
    // The glow, the spark burst, the contact counters and the rival's extra
    // yield all hang off this, and a craft 4 m away being nudged is not a craft
    // the player is leaning on - counting it would redefine every number round
    // 2 was accepted on.
    const active = strongestContact;
    this.cushionPushNow = strongestPush;
    // Latched over the whole race, on the PHYSICS step rather than on the
    // diagnostics report. The report writes its DOM node once a second and a
    // contact lasts about a third of one, so anything polled from outside the
    // page samples this at roughly one frame in sixty - a screenshot harness
    // reading `cushionPushNow` measured a 0.22 m/s^2 "peak" on a race whose
    // real peak was 13.4. These two are the honest answer to "how hard does the
    // cushion push while the hulls are still clear of each other".
    if (active && strongestSeparation >= CUSHION_HULL_CLEAR_SEPARATION_METERS
      && strongest > this.cushionPeakClearPush) {
      this.cushionPeakClearPush = strongest;
      this.cushionSeparationAtPeakClearPush = strongestSeparation;
    }
    this.cushionGapNow = active ? strongestGap : 0;
    this.cushionSeparationNow = active ? strongestSeparation : 0;
    // The YIELD outlives the contact by CUSHION_YIELD_HOLD_SECONDS, and the
    // push does not.
    //
    // A rival has a lateral rate limit; a contact in the demo soaks lasts about
    // 0.2 s, which is not enough time for the lane solver to move a craft
    // anywhere at all. Without the hold the extra yield was a request that was
    // withdrawn before it could be acted on - measured as a soak where the
    // rival lateral was indistinguishable from the cushion-off control. The
    // hold is on the RIVAL's request only: the player stops being pushed the
    // instant the contact ends, which is what keeps this a lean.
    if (active) {
      this.cushionRivalIndex = strongestIndex;
      this.cushionYieldSign = strongestSign;
      this.cushionYieldHold = CUSHION_YIELD_HOLD_SECONDS;
    } else if (this.cushionYieldHold > 0) {
      this.cushionYieldHold -= Math.max(0, deltaSeconds);
      if (this.cushionYieldHold > 0) {
        this.cushionRivalIndex = this.heldCushionRivalIndex;
        this.cushionYieldSign = this.heldCushionYieldSign;
      }
    }
    this.heldCushionRivalIndex = this.cushionRivalIndex;
    this.heldCushionYieldSign = this.cushionYieldSign;
    if (active) {
      this.cushionSeconds += Math.max(0, deltaSeconds);
      this.cushionPeakPush = Math.max(this.cushionPeakPush, strongest);
      this.cushionContactSide = strongestSign;
      if (!this.cushionActiveLastStep) this.cushionContacts += 1;
    }
    this.cushionActiveLastStep = active;
    return this.cushionResult;
  }

  /** True while the player is inside a rival's cushion. Drives the HUD glow. */
  get cushionActive(): boolean {
    return this.cushionActiveLastStep;
  }

  /**
   * The race loop reports back whether the apron clamp ate the push. When it
   * did, the rival is asked for the whole separation rather than its half.
   */
  setCushionPlayerBlocked(blocked: boolean): void {
    this.cushionPlayerBlocked = blocked;
  }

  private cushionYieldMeters(): number {
    return this.cushionPlayerBlocked
      ? RIVAL_CUSHION_YIELD_BLOCKED_METERS
      : RIVAL_CUSHION_YIELD_METERS;
  }

  /** Live contact telemetry for the screenshot harness. See the fields. */
  get cushionPushMetersPerSecondSquared(): number {
    return this.cushionPushNow;
  }

  get cushionLateralGapMeters(): number {
    return this.cushionGapNow;
  }

  get cushionSeparationMeters(): number {
    return this.cushionSeparationNow;
  }

  get cushionYieldRequestMeters(): number {
    return this.cushionRivalIndex >= 0 ? this.cushionYieldMeters() : 0;
  }

  /** Which side the contact is on: +1 when the rival sits at higher lateral. */
  get cushionSide(): number {
    return this.cushionContactSide;
  }

  /** Passes completed on the last step. Read with {@link passLateralGapMeters}. */
  get passesThisStep(): number {
    return this.passCount;
  }

  /** Lateral gap at the crossing for pass `index` of `passesThisStep`. */
  passLateralGapMeters(index: number): number {
    return this.passScratch[index]?.lateralGapMeters ?? 0;
  }

  /** Which craft was passed, for the diagnostics log. */
  passRivalId(index: number): string {
    return this.passScratch[index]?.id ?? "";
  }

  /**
   * The separation that G2 is judged on, sampled AFTER the race loop has
   * applied the cushion. `measureSeparation` runs before the player moves and
   * mixes the rival-versus-rival pairs in, so it can never show what the
   * cushion bought.
   */
  measurePlayerSeparation(
    playerDistanceFromStart: number,
    playerLateralMeters: number,
  ): void {
    const playerRaceDistanceMeters = this.rivalFrameDistance(playerDistanceFromStart);
    // Same exclusion `measureSeparation` uses: once the player's distance is
    // frozen on the finish line the field drives through it to take the flag,
    // and that is not a near miss.
    const raceDistance = this.course.length * this.totalLaps;
    if (playerRaceDistanceMeters >= raceDistance - 1e-6) return;
    for (const state of this.states) {
      if (state.finished) continue;
      const longitudinal = state.raceDistanceMeters - playerRaceDistanceMeters;
      const lateral = state.lateralMeters - playerLateralMeters;
      const separation = Math.hypot(longitudinal, lateral);
      if (separation >= this.playerRivalMinimumSeparationMeters) continue;
      this.playerRivalMinimumSeparationMeters = separation;
      // WHERE the worst moment was, and whether the cushion was even awake for
      // it. A bare minimum cannot distinguish "the cushion pushed as hard as it
      // could and lost" from "the cushion was not armed at all", and those want
      // opposite fixes - round 2 spent a soak finding that out the slow way.
      this.closestPlayerContact.id = state.id;
      this.closestPlayerContact.longitudinalMeters = longitudinal;
      this.closestPlayerContact.lateralMeters = lateral;
      this.closestPlayerContact.lap = state.lap;
      this.closestPlayerContact.courseDistanceMeters = state.courseDistanceMeters;
      this.closestPlayerContact.cushionActive = this.cushionActiveLastStep;
      this.closestPlayerContact.cushionPush = this.cushionPushNow;
      this.closestPlayerContact.towLocked = this.slipstream >= SLIPSTREAM_LOCK_THRESHOLD;
    }
  }


  /**
   * The drive input for one rival for one sub-step.
   *
   * Everything longitudinal here reads only the rival's own state and the
   * course: pace lane, pad coverage, boost window, corner scrub and drift are
   * all resolved before the player is considered. The player enters exactly
   * once, in `rivalContestLaneMeters`, and only as a lateral target. That
   * separation is what `scripts/validate-rivals.mjs` proves end to end by
   * racing the same field twice - once against a moving player and once
   * against a player left on the grid - and comparing lap times bit for bit.
   */
  private resolveDrive(
    state: RivalState,
    field: readonly RivalState[],
    playerRaceDistanceMeters: number,
    playerLateralMeters: number,
    sample = this.sample,
    lookAhead = this.lookAheadSample,
    scratch = this.driveScratch,
  ): Record<string, unknown> {
    const index = field.indexOf(state);
    const entry = this.paces[index];
    this.course.sample(state.courseDistanceMeters / this.course.length, sample);
    const halfWidthMeters = sample.halfWidth;
    const laneHalfWidthMeters = Math.max(0, halfWidthMeters - VEHICLE_CLEARANCE_METERS);
    const padLaneMeters = entry.padUse
      ? this.course.boostPadLaneAt(
        state.courseDistanceMeters,
        halfWidthMeters,
        RIVAL_PAD_APPROACH_METERS,
      )
      : null;
    const paceLane = rivalPaceLaneMeters(state, {
      curvature: sample.curvature,
      laneHalfWidthMeters,
      padLaneMeters,
      padUse: entry.padUse,
    });
    const neighbourLaterals = this.neighbourScratch;
    neighbourLaterals.length = 0;
    for (const other of field) {
      if (other === state || other.finished) continue;
      if (
        Math.abs(state.raceDistanceMeters - other.raceDistanceMeters)
          < RIVAL_LANE_CONTEST_GAP_METERS
      ) neighbourLaterals.push(other.lateralMeters);
    }
    this.course.sample(
      (state.courseDistanceMeters + RIVAL_DEFENCE_LOOKAHEAD_METERS) / this.course.length,
      lookAhead,
    );
    const insideSign = Math.abs(lookAhead.curvature) >= this.driftCurvature
      ? Math.sign(lookAhead.curvature)
      : 0;
    const drive = scratch[index];
    drive.deltaSeconds = RIVAL_FIXED_STEP_SECONDS;
    const playerGap = state.raceDistanceMeters - playerRaceDistanceMeters;
    drive.targetLateralMeters = rivalContestLaneMeters(paceLane, {
      lateralMeters: state.lateralMeters,
      playerGapMeters: playerGap,
      playerLateralMeters,
      rivalId: state.id,
      neighbourLaterals,
      insideSign,
      sideSign: this.noBlockSide,
      halfWidthMeters,
      laneHalfWidthMeters,
      // G2 — only the craft actually being leaned on gives up the extra road,
      // and only laterally. A rival two lanes away is untouched by a contact it
      // is not part of.
      cushionYieldMeters: index === this.cushionRivalIndex
        ? this.cushionYieldMeters()
        : 0,
      cushionYieldSign: index === this.cushionRivalIndex ? this.cushionYieldSign : 0,
      evasiveSideMeters: this.evasiveSides[index],
    });
    drive.paceLateralMeters = paceLane;
    drive.laneHalfWidthMeters = laneHalfWidthMeters;
    drive.courseSpeedFactor = rivalCourseSpeedFactor(
      this.course.rivalPace,
      sample.curvature,
    );
    drive.cruiseSpeedMetersPerSecond = entry.cruiseSpeedMetersPerSecond;
    drive.boostWindowActive = isInsideBoostWindow(
      entry.boostWindows,
      state.courseDistanceMeters,
    );
    // Pad coverage is resolved against the PLAYER-FREE lane, so no amount of
    // tailgating can deny a rival a pad it had committed to. The craft yields
    // laterally while still banking that pad; the alternative is a longitudinal
    // reaction to the player, which is exactly what principle 5 forbids.
    drive.onBoostPad = entry.padUse
      && this.course.isOnBoostPad(
        state.courseDistanceMeters / this.course.length,
        state.paceLateralMeters,
        halfWidthMeters,
      );
    drive.curvatureMagnitude = Math.abs(sample.curvature);
    drive.driftCurvature = this.driftCurvature;
    drive.lateralSpeedScale = Math.abs(playerGap) <= RIVAL_PLAYER_AVOID_GAP_METERS
      && Math.abs(state.lateralMeters - playerLateralMeters) < RIVAL_LANE_CLEARANCE_METERS
      ? RIVAL_EVASIVE_LATERAL_GAIN
      : 1;
    return drive;
  }

  step(
    deltaSeconds: number,
    playerDistanceFromStart: number,
    playerLateralMeters: number,
    playerSpeedMetersPerSecond = 0,
  ): void {
    const playerRaceDistanceMeters = this.rivalFrameDistance(playerDistanceFromStart);
    for (let index = 0; index < this.states.length; index += 1) {
      this.previousDistances[index] = this.states[index].raceDistanceMeters;
      this.previousLaterals[index] = this.states[index].lateralMeters;
      if (this.states[index].finished) {
        this.finishVisualAges[index] += Math.max(0, deltaSeconds);
      }
    }
    this.updateEvasiveSides(playerRaceDistanceMeters, playerLateralMeters, deltaSeconds);
    const crossingSpeeds = this.states.map((state) => state.speedMetersPerSecond);
    const wasFinished = this.states.map((state) => state.finished);

    this.fieldRemainderSeconds = stepRivalField(this.states, {
      deltaSeconds,
      remainderSeconds: this.fieldRemainderSeconds,
      resolveSubStepInput: (state, field) => this.resolveDrive(
        state,
        field,
        playerRaceDistanceMeters,
        playerLateralMeters,
      ) as never,
    });

    for (let index = 0; index < this.states.length; index += 1) {
      const state = this.states[index];
      if (state.finished) {
        if (!wasFinished[index]) {
          this.finishVisualAges[index] = 0;
          this.finishRunOutSpeeds[index] = crossingSpeeds[index];
        }
        this.steerSignals[index] = 0;
        this.brakeSignals[index] = 0;
        this.throttleSignals[index] = 0;
        this.glowSignals[index] = 0;
        this.driftSignals[index] = 0;
        continue;
      }
      // The pose is read AFTER the step from the state the step produced, and
      // is a pure function of that state, so it stays rate independent.
      const poseInput = this.resolveDrive(
        state,
        this.states,
        playerRaceDistanceMeters,
        playerLateralMeters,
      ) as never;
      const steer = rivalSteerSignal(state, poseInput);
      this.steerSignals[index] = steer;
      this.brakeSignals[index] = rivalBrakeSignal(state, poseInput);
      this.throttleSignals[index] = rivalThrottleSignal(state, poseInput);
      this.glowSignals[index] = rivalGlowSignal(state, poseInput);
      this.driftSignals[index] = rivalDriftSignal(state);
      this.maximumSteerRadians = Math.max(
        this.maximumSteerRadians,
        Math.abs(steer) * ARTICULATION_TRAVEL_RADIANS.steering_fins,
      );
    }
    this.updateSteps += 1;
    this.measurePasses(playerRaceDistanceMeters, playerLateralMeters);
    this.measureSeparation(playerRaceDistanceMeters, playerLateralMeters);
    this.measureFreeDeck(playerRaceDistanceMeters, playerLateralMeters);
    this.measureLeadChanges();
    this.measureSlipstream(
      playerRaceDistanceMeters,
      playerLateralMeters,
      playerSpeedMetersPerSecond,
      deltaSeconds,
    );
  }

  /**
   * G2 round 3 — advances each rival's committed evasive side.
   *
   * Runs once per fleet step, before the field is advanced, from the player
   * position the step was handed. The sub-steps inside `stepRivalField` all see
   * the same committed side, which is what makes it deterministic: the latch
   * is a function of the step's inputs and its own previous value, never of how
   * many sub-steps happened to run.
   */
  private updateEvasiveSides(
    playerRaceDistanceMeters: number,
    playerLateralMeters: number,
    deltaSeconds: number,
  ): void {
    for (let index = 0; index < this.states.length; index += 1) {
      const state = this.states[index];
      const longitudinal = state.raceDistanceMeters - playerRaceDistanceMeters;
      const lateral = state.lateralMeters - playerLateralMeters;
      this.evasiveScratch.side = this.evasiveSides[index];
      this.evasiveScratch.heldSeconds = this.evasiveHeldSeconds[index];
      const next = resolveEvasiveSide(this.evasiveScratch, {
        engaged: !state.finished
          && Math.abs(longitudinal) <= RIVAL_PLAYER_AVOID_GAP_METERS,
        lateralGapMeters: lateral,
        separationMeters: Math.hypot(longitudinal, lateral),
        deltaSeconds,
      });
      this.evasiveSides[index] = next.side;
      this.evasiveHeldSeconds[index] = next.heldSeconds;
    }
  }

  /**
   * G2 — every rival the player got past on this step.
   *
   * A pass is a race-distance crossing from behind to ahead, read off the two
   * frames the fleet already keeps: `previousDistances` for the rivals and one
   * scalar for the player. It is deliberately NOT a position-table change -
   * the table is sorted output and would report a pass the player never made
   * when a third craft finishes or recovers.
   *
   * The lateral gap recorded is the one at the crossing step, which is what
   * `resolveNearMiss` scores. A pass completed while a rival is lapping is
   * still a pass; the near-miss band, not this, decides whether it pays.
   */
  private measurePasses(
    playerRaceDistanceMeters: number,
    playerLateralMeters: number,
  ): void {
    this.passCount = 0;
    if (this.hasPreviousPlayerRaceDistance) {
      for (let index = 0; index < this.states.length; index += 1) {
        const state = this.states[index];
        if (state.finished) continue;
        const previousGap = this.previousDistances[index] - this.previousPlayerRaceDistance;
        const gap = state.raceDistanceMeters - playerRaceDistanceMeters;
        if (previousGap <= 0 || gap > 0) continue;
        const entry = this.passScratch[this.passCount];
        entry.id = state.id;
        entry.lateralGapMeters = state.lateralMeters - playerLateralMeters;
        this.passCount += 1;
      }
    }
    this.previousPlayerRaceDistance = playerRaceDistanceMeters;
    this.hasPreviousPlayerRaceDistance = true;
  }

  /**
   * Strongest tow over the three rivals. No allocation: it walks the states
   * already held and the race-distance fields already tracked.
   */
  private measureSlipstream(
    playerRaceDistanceMeters: number,
    playerLateralMeters: number,
    playerSpeedMetersPerSecond: number,
    deltaSeconds: number,
  ): void {
    const speedRatio = playerSpeedMetersPerSecond / BOOST_MAX_SPEED;
    let strongest = 0;
    let nearestAhead = Number.POSITIVE_INFINITY;
    let nearestLateral = Number.POSITIVE_INFINITY;
    this.slipstreamRivalIndex = -1;
    for (let index = 0; index < this.states.length; index += 1) {
      const state = this.states[index];
      if (state.finished) continue;
      const ahead = state.raceDistanceMeters - playerRaceDistanceMeters;
      const lateralGap = state.lateralMeters - playerLateralMeters;
      // G2 round 2 - a "tow" that has closed inside
      // CUSHION_TOW_CONTACT_SEPARATION_METERS is a contact, and a contact does
      // not lock. Capping it just under the threshold rather than zeroing it
      // keeps the chip's fill continuous as the player closes in - the bar
      // stops short of LOCK instead of vanishing - and re-arms the cushion,
      // which reads that same threshold.
      const separation = Math.hypot(ahead, lateralGap);
      const rawTow = calculateSlipstream(ahead, lateralGap, speedRatio);
      const tow = separation < CUSHION_TOW_CONTACT_SEPARATION_METERS
        ? Math.min(rawTow, SLIPSTREAM_LOCK_THRESHOLD - 1e-6)
        : rawTow;
      if (tow > strongest) {
        strongest = tow;
        this.slipstreamRivalIndex = index;
        this.slipstreamAhead = ahead;
        this.slipstreamLateralGap = lateralGap;
      }
      if (ahead > 0 && ahead < nearestAhead) {
        nearestAhead = ahead;
        nearestLateral = lateralGap;
      }
    }
    this.draftDistance = nearestAhead;
    this.draftLateral = nearestLateral;
    this.slipstreamLockedThisStep = strongest >= SLIPSTREAM_LOCK_THRESHOLD
      && this.slipstream < SLIPSTREAM_LOCK_THRESHOLD;
    if (this.slipstreamLockedThisStep) this.slipstreamLocks += 1;
    if (strongest > 0) this.slipstreamSeconds += Math.max(0, deltaSeconds);
    if (strongest > this.slipstreamPeak) this.slipstreamPeak = strongest;
    this.slipstream = strongest;
  }

  /**
   * PRODUCT.md principle 5, measured rather than assumed: the widest strip of
   * deck left clear by every rival sitting within
   * {@link RIVAL_NO_BLOCK_WINDOW_METERS} ahead of the player.
   */
  private measureFreeDeck(
    playerRaceDistanceMeters: number,
    playerLateralMeters: number,
  ): void {
    this.freeDeckScratch.length = 0;
    let narrowestHalfWidth = Infinity;
    // A sample only answers the question "does the player have a route past"
    // when the player is somewhere the question means something: outside the
    // strip reserved for it to pass through, and not sitting on a rival's own
    // line, where the craft is already sliding out of the way. Both cases are
    // counted and reported rather than dropped.
    let conclusive = true;
    const reserved = RIVAL_FREE_DECK_FRACTION + RIVAL_NO_BLOCK_MARGIN_FRACTION;
    for (const state of this.states) {
      if (state.finished) continue;
      const gap = state.raceDistanceMeters - playerRaceDistanceMeters;
      if (gap < 0 || gap > RIVAL_NO_BLOCK_WINDOW_METERS) continue;
      this.freeDeckScratch.push(state.lateralMeters);
      this.course.sample(state.courseDistanceMeters / this.course.length, this.sample);
      const halfWidth = this.sample.halfWidth;
      narrowestHalfWidth = Math.min(narrowestHalfWidth, halfWidth);
      const inner = halfWidth * (2 * reserved - 1) + VEHICLE_CLEARANCE_METERS;
      if (this.noBlockSide * playerLateralMeters >= inner) conclusive = false;
      if (
        Math.abs(state.lateralMeters - playerLateralMeters) < RIVAL_LANE_CLEARANCE_METERS
      ) conclusive = false;
    }
    if (this.freeDeckScratch.length === 0) return;
    this.freeDeckSamples += 1;
    const fraction = measureFreeDeckFraction(this.freeDeckScratch, narrowestHalfWidth);
    this.minimumFreeDeckFraction = Math.min(this.minimumFreeDeckFraction, fraction);
    this.minimumFreeDeckTargetFraction = Math.min(
      this.minimumFreeDeckTargetFraction,
      freeDeckTargetFraction(narrowestHalfWidth),
    );
    if (!conclusive) this.freeDeckAlongsideSamples += 1;
    else {
      this.minimumClearFreeDeckFraction = Math.min(
        this.minimumClearFreeDeckFraction,
        fraction,
      );
    }
  }

  /** How often the rivals swap the lead among themselves over a race. */
  private measureLeadChanges(): void {
    let leader = 0;
    for (let index = 1; index < this.states.length; index += 1) {
      if (
        this.states[index].raceDistanceMeters > this.states[leader].raceDistanceMeters
      ) leader = index;
    }
    if (this.previousLeader >= 0 && leader !== this.previousLeader) this.leadChanges += 1;
    this.previousLeader = leader;
  }

  updatePresentation(alpha: number, elapsedSeconds: number): void {
    const interpolation = THREE.MathUtils.clamp(alpha, 0, 1);
    for (let index = 0; index < this.states.length; index += 1) {
      const state = this.states[index];
      let distance = THREE.MathUtils.lerp(
        this.previousDistances[index],
        state.raceDistanceMeters,
        interpolation,
      );
      const lateral = THREE.MathUtils.lerp(
        this.previousLaterals[index],
        state.lateralMeters,
        interpolation,
      );
      const finishVisualAge = this.finishVisualAges[index];
      if (state.finished) {
        distance = state.raceDistanceMeters + rivalFinishRunOutDistanceMeters(
          finishVisualAge,
          this.finishRunOutSpeeds[index],
        );
      }
      const visible = !state.finished
        || finishVisualAge < RIVAL_FINISH_RUN_OUT_SECONDS;
      this.course.sample(distance / this.course.length, this.sample);
      const bob = Math.sin(elapsedSeconds * 4.1 + index * 1.7) * 0.035;
      this.posePosition.copy(this.sample.position)
        .addScaledVector(this.sample.right, lateral)
        .addScaledVector(this.sample.up, 0.82 + bob);
      this.backward.copy(this.sample.tangent).multiplyScalar(-1);
      this.poseMatrix.makeBasis(this.sample.right, this.sample.up, this.backward);
      this.poseQuaternion.setFromRotationMatrix(this.poseMatrix);
      const bank = calculateRivalBankRadians(
        this.previousLaterals[index],
        state.lateralMeters,
        this.sample.curvature,
        this.driftSignals[index],
      );
      this.bankQuaternion.setFromAxisAngle(RIVAL_ROLL_AXIS, bank);
      this.poseQuaternion.multiply(this.bankQuaternion);
      this.poseScale.setScalar(visible ? 1 : 0.00001);
      this.poseMatrix.compose(this.posePosition, this.poseQuaternion, this.poseScale);

      this.worldPositions[index].copy(this.posePosition);
      this.worldVelocities[index]
        .copy(this.sample.tangent)
        .multiplyScalar(state.speedMetersPerSecond)
        .addScaledVector(
          this.sample.right,
          this.steerSignals[index] * RIVAL_PROFILES[index].lateralSpeedMetersPerSecond,
        );

      for (const visual of this.visuals) {
        const travel = ARTICULATION_TRAVEL_RADIANS[visual.group];
        const angle = visual.group === "steering_fins"
          ? this.steerSignals[index] * travel
          : visual.group === "airbrakes"
            // G1 - a committed drift flares the airbrakes past what the pace
            // model alone asks for. It rides the batches that already exist, so
            // the drift costs zero extra draw calls: no spark emitter, no new
            // instanced mesh, nothing added to the fleet's seven calls.
            ? Math.min(
              1,
              this.brakeSignals[index]
                + this.driftSignals[index] * RIVAL_DRIFT_AIRBRAKE_GAIN,
            ) * travel
            : 0;
        for (let slot = 0; slot < visual.slots.length; slot += 1) {
          const instance = index * visual.slots.length + slot;
          if (visual.group === "hull") {
            visual.mesh.setMatrixAt(instance, this.poseMatrix);
            continue;
          }
          const definition = visual.slots[slot];
          // pose * pivot * rotation(axis, angle) — the same composition the
          // player's hierarchy performs in `TotemVehicle.setRotation`, with the
          // pivot's neutral transform reapplied here because the batch geometry
          // was baked pivot-local so both sides could share it.
          this.articulationMatrix.makeRotationAxis(
            LOCAL_ROTATION_AXES[definition.axis],
            angle,
          );
          this.slotMatrix
            .multiplyMatrices(this.poseMatrix, definition.pivotMatrix)
            .multiply(this.articulationMatrix);
          visual.mesh.setMatrixAt(instance, this.slotMatrix);
        }
      }

      const glow = this.glowSignals[index];
      this.engineScaledMatrix.copy(this.engineLocalMatrix).scale(
        this.glowScale.setScalar(0.78 + glow * 0.44),
      );
      this.engineWorldMatrix.multiplyMatrices(
        this.poseMatrix,
        this.engineScaledMatrix,
      );
      this.engineGlow.setMatrixAt(index, this.engineWorldMatrix);
      this.engineGlow.setColorAt(
        index,
        this.glowColor
          .copy(this.glowTints[index])
          .multiplyScalar(0.5)
          .lerp(this.glowTints[index], glow),
      );

      this.composeShadowBlob(
        index,
        this.sample.position,
        this.sample.right,
        this.sample.up,
        this.backward,
        lateral,
        RIVAL_NOMINAL_HOVER_METERS + bob,
        visible,
      );
    }
    for (const visual of this.visuals) {
      visual.mesh.instanceMatrix.needsUpdate = true;
    }
    this.engineGlow.instanceMatrix.needsUpdate = true;
    if (this.engineGlow.instanceColor) this.engineGlow.instanceColor.needsUpdate = true;
    this.shadowBlobs.instanceMatrix.needsUpdate = true;
    if (this.shadowBlobs.instanceColor) this.shadowBlobs.instanceColor.needsUpdate = true;
  }

  /**
   * Places the player's ground blob in the shared instanced mesh. Called from
   * the pose update, which is where the player's on-surface point and basis are
   * already computed.
   */
  setPlayerShadow(
    surfacePosition: THREE.Vector3,
    right: THREE.Vector3,
    up: THREE.Vector3,
    backward: THREE.Vector3,
    hoverMeters: number,
    visible = true,
  ): void {
    // Same-frame check of the tow's geometry: the rival instances were composed
    // by `updatePresentation` earlier this frame and the player's on-surface
    // point has just been derived, so this compares the model the physics used
    // with the positions this frame is about to draw.
    if (this.slipstreamRivalIndex >= 0 && this.slipstream > 0) {
      this.slipstreamWorld = this.worldPositions[this.slipstreamRivalIndex]
        .distanceTo(surfacePosition);
      this.slipstreamMaxPositionMismatch = Math.max(
        this.slipstreamMaxPositionMismatch,
        Math.abs(this.slipstreamWorld - Math.hypot(
          this.slipstreamAhead,
          this.slipstreamLateralGap,
        )),
      );
    }
    this.composeShadowBlob(
      PLAYER_BLOB_INDEX,
      surfacePosition,
      right,
      up,
      backward,
      0,
      hoverMeters,
      visible,
    );
    this.shadowBlobs.instanceMatrix.needsUpdate = true;
    if (this.shadowBlobs.instanceColor) this.shadowBlobs.instanceColor.needsUpdate = true;
  }

  /** Live world position of a rival, for the spatial-audio phase. */
  worldPosition(index: number, target: THREE.Vector3): THREE.Vector3 {
    const source = this.worldPositions[index];
    if (!source) return target.set(0, 0, 0);
    return target.copy(source);
  }

  /**
   * Live world velocity of a rival, for the spatial-audio phase. Derived from
   * the authored speed and the pure steer signal, never from a frame delta.
   */
  worldVelocity(index: number, target: THREE.Vector3): THREE.Vector3 {
    const source = this.worldVelocities[index];
    if (!source) return target.set(0, 0, 0);
    return target.copy(source);
  }

  raceStatus(
    playerDistanceFromStart: number,
    playerSpeedMetersPerSecond: number,
    playerFinished = false,
    playerFinishTimeSeconds: number | null = null,
  ): RivalRaceStatus {
    // Position and gap are a comparison against the field, so they need the
    // player's distance in the field's frame like everything else does.
    const gaps = calculateRaceGaps([
      {
        id: PLAYER_ID,
        raceDistanceMeters: this.rivalFrameDistance(playerDistanceFromStart),
        speedMetersPerSecond: playerSpeedMetersPerSecond,
        finished: playerFinished,
        finishTimeSeconds: playerFinishTimeSeconds,
      },
      ...this.states,
    ], PLAYER_ID);
    return {
      position: gaps.position,
      racerCount: gaps.racerCount,
      gapToAheadMs: gaps.gapToAheadMs,
      gapToBehindMs: gaps.gapToBehindMs,
    };
  }

  /**
   * Zero-allocation spatial read for the P6 minimap radar: fills `out` in
   * place with each rival's live race distance and lane offset and returns how
   * many slots were written. Read-only by construction — the radar cannot
   * perturb the field it is drawing.
   */
  readRadarContacts(out: MinimapContact[]): number {
    const count = Math.min(out.length, this.states.length);
    for (let index = 0; index < count; index += 1) {
      const state = this.states[index];
      const slot = out[index];
      slot.raceDistanceMeters = state.raceDistanceMeters;
      slot.lateralMeters = state.lateralMeters;
    }
    return count;
  }

  /** Live field ranking for the HUD position ladder. */
  fieldOrder(
    playerDistanceFromStart: number,
    playerSpeedMetersPerSecond: number,
  ): FieldOrderEntry[] {
    const { ordered } = calculateRaceGaps([
      {
        id: PLAYER_ID,
        raceDistanceMeters: this.rivalFrameDistance(playerDistanceFromStart),
        speedMetersPerSecond: playerSpeedMetersPerSecond,
        finished: false,
        finishTimeSeconds: null,
      },
      ...this.states,
    ], PLAYER_ID);
    return ordered.map((entry, index) => ({
      position: index + 1,
      name: entry.id === PLAYER_ID
        ? "TOTEM"
        : RIVAL_PROFILES.find((profile) => profile.id === entry.id)?.name ?? entry.id,
      player: entry.id === PLAYER_ID,
    }));
  }

  classification(playerFinishTimeSeconds: number): RaceStandingEntry[] {
    const totalDistance = this.course.length * this.totalLaps;
    const projectedFinishes = this.projectFinishTimes();
    const entries = [
      {
        id: PLAYER_ID,
        name: "TOTEM",
        team: "WORKS 07",
        player: true,
        raceDistanceMeters: totalDistance,
        finished: true,
        finishTimeSeconds: playerFinishTimeSeconds,
      },
      ...this.states.map((state, index) => ({
        id: state.id,
        name: this.liveryLabels[index],
        team: "FIELD TOTEM",
        player: false,
        raceDistanceMeters: totalDistance,
        finished: true,
        finishTimeSeconds: projectedFinishes[index],
      })),
    ];
    const ordered = rankRaceEntries(entries);
    const winnerTime = ordered[0].finishTimeSeconds ?? playerFinishTimeSeconds;
    return ordered.map((entry, index) => ({
      position: index + 1,
      name: entry.name,
      team: entry.team,
      player: entry.player,
      finishTimeMs: (entry.finishTimeSeconds ?? playerFinishTimeSeconds) * 1000,
      gapMs: Math.max(
        0,
        ((entry.finishTimeSeconds ?? playerFinishTimeSeconds) - winnerTime) * 1000,
      ),
    }));
  }

  /**
   * P7 — re-issues the field for a new player livery, live.
   *
   * Costs one rewrite of each body batch's `aLiveryOffset` buffer: three
   * instances' worth of two floats per slot, no geometry rebuild, no new
   * texture, no change to the draw-call count. The grid list is rebuilt from
   * the same assignment so the start screen and the craft can never disagree.
   */
  setPlayerLivery(playerLivery: string): void {
    this.fieldLiveryCodes = fieldLiveries(playerLivery);
    this.liveryLabels = this.fieldLiveryCodes.map((code) => liveryFor(code).label);
    for (const { attribute, slotCount } of this.liveryOffsetBuffers) {
      const offsets = attribute.array as Float32Array;
      for (let index = 0; index * 2 < offsets.length; index += 1) {
        const [offsetU, offsetV] = LIVERY_ATLAS_OFFSETS[
          LIVERY_ATLAS_ORDER.indexOf(this.fieldLiveryCodes[Math.floor(index / slotCount)])
        ];
        offsets[index * 2] = offsetU;
        offsets[index * 2 + 1] = offsetV;
      }
      attribute.needsUpdate = true;
    }
    this.gridEntries = [
      {
        position: 1,
        name: "TOTEM",
        team: liveryFor(playerLivery).label,
        player: true,
      },
      ...this.liveryLabels.map((label, index) => ({
        position: index + 2,
        name: label,
        team: "FIELD TOTEM",
        player: false,
      })),
    ];
  }

  diagnostics(): RivalFleetDiagnostics {
    return {
      drawCalls: this.stats.drawCalls,
      triangles: this.stats.triangles,
      updateSteps: this.updateSteps,
      minimumSeparationMeters: Number.isFinite(this.minimumSeparationMeters)
        ? this.minimumSeparationMeters
        : 0,
      minimumRivalSeparationMeters: Number.isFinite(this.minimumRivalSeparationMeters)
        ? this.minimumRivalSeparationMeters
        : 0,
      // G2. Reported as 0 only when the race never sampled it at all - the
      // same convention the two above use for an unstarted run.
      playerRivalMinimumSeparationMeters:
        Number.isFinite(this.playerRivalMinimumSeparationMeters)
          ? this.playerRivalMinimumSeparationMeters
          : 0,
      cushionSeconds: this.cushionSeconds,
      cushionPeakPush: this.cushionPeakPush,
      cushionContacts: this.cushionContacts,
      cushionPushNow: this.cushionPushNow,
      cushionGapNow: this.cushionGapNow,
      cushionSeparationNow: this.cushionSeparationNow,
      cushionYieldNow: this.cushionYieldRequestMeters,
      cushionPeakClearPush: this.cushionPeakClearPush,
      cushionSeparationAtPeakClearPush: this.cushionSeparationAtPeakClearPush,
      closestPlayerContact: { ...this.closestPlayerContact },
      closestApproach: { ...this.closestApproach },
      catchUpMultiplier: 1,
      articulatedGroups: [...this.articulatedGroups],
      maximumSteerRadians: this.maximumSteerRadians,
      minimumFreeDeckFraction: this.minimumFreeDeckFraction,
      minimumClearFreeDeckFraction: this.minimumClearFreeDeckFraction,
      minimumFreeDeckTargetFraction: this.minimumFreeDeckTargetFraction,
      freeDeckSamples: this.freeDeckSamples,
      freeDeckAlongsideSamples: this.freeDeckAlongsideSamples,
      leadChanges: this.leadChanges,
      slipstream: this.slipstream,
      slipstreamRival: this.slipstreamRivalIndex >= 0
        ? this.states[this.slipstreamRivalIndex].id
        : "",
      slipstreamAheadMeters: this.slipstreamAhead,
      slipstreamLateralMeters: this.slipstreamLateralGap,
      slipstreamWorldMeters: this.slipstreamWorld,
      slipstreamMaxPositionMismatchMeters: this.slipstreamMaxPositionMismatch,
      slipstreamSeconds: this.slipstreamSeconds,
      slipstreamPeak: this.slipstreamPeak,
      slipstreamLocks: this.slipstreamLocks,
      articulation: this.states.map((state, index) => ({
        id: state.id,
        steerRadians: this.steerSignals[index]
          * ARTICULATION_TRAVEL_RADIANS.steering_fins,
        brakeRadians: this.brakeSignals[index]
          * ARTICULATION_TRAVEL_RADIANS.airbrakes,
        driftSignal: this.driftSignals[index],
      })),
      states: this.states.map((state, index) => ({
        id: state.id,
        name: this.liveryLabels[index],
        lap: state.lap,
        raceDistanceMeters: state.raceDistanceMeters,
        speedKph: state.speedMetersPerSecond * 3.6,
        lateralMeters: state.lateralMeters,
        finishTimeMs: state.finishTimeSeconds === null
          ? null
          : state.finishTimeSeconds * 1000,
        recoveries: state.recoveryCount,
        lapTimesMs: state.lapTimesSeconds.map((lap) => lap * 1000),
        boostSeconds: state.boostSeconds,
        boostReserve: state.boostReserve,
        padHits: state.padHits,
        driftEntries: state.driftEntries,
        driftSeconds: state.driftSeconds,
      })),
    };
  }

  private composeShadowBlob(
    instance: number,
    surfacePosition: THREE.Vector3,
    right: THREE.Vector3,
    up: THREE.Vector3,
    backward: THREE.Vector3,
    lateralMeters: number,
    hoverMeters: number,
    visible: boolean,
  ): void {
    const hover = clamp01(
      (hoverMeters - SHADOW_BLOB_LOW_HOVER_METERS)
        / (SHADOW_BLOB_HIGH_HOVER_METERS - SHADOW_BLOB_LOW_HOVER_METERS),
    );
    const spread = 1 + hover * 0.18;
    this.blobPosition.copy(surfacePosition)
      .addScaledVector(right, lateralMeters)
      .addScaledVector(up, SHADOW_BLOB_LIFT_METERS)
      .addScaledVector(backward, SHADOW_BLOB_AFT_OFFSET_METERS);
    this.blobBasis.makeBasis(right, up, backward);
    this.blobQuaternion.setFromRotationMatrix(this.blobBasis);
    this.blobScale.set(
      visible ? SHADOW_BLOB_WIDTH_METERS * spread : 0.00001,
      1,
      visible ? SHADOW_BLOB_LENGTH_METERS * spread : 0.00001,
    );
    this.blobMatrix.compose(this.blobPosition, this.blobQuaternion, this.blobScale);
    this.shadowBlobs.setMatrixAt(instance, this.blobMatrix);
    this.shadowBlobs.setColorAt(
      instance,
      this.blobColor.setScalar(
        SHADOW_BLOB_MAX_OPACITY
          - hover * (SHADOW_BLOB_MAX_OPACITY - SHADOW_BLOB_MIN_OPACITY),
      ),
    );
  }

  /**
   * Finish times for a field that has not finished yet, so the classification
   * can be shown the moment the player crosses.
   *
   * It runs the REAL model forward - the same pace block, pads, boost windows,
   * drift and lane contest the race itself used - with no player in the world.
   * That is exactly legitimate here, because nothing longitudinal in the model
   * reads the player: a rival's remaining lap time is the same whether the
   * player is alongside or already in the pits.
   */
  private projectFinishTimes(): number[] {
    const projected: RivalState[] = this.states.map((state) => ({
      ...state,
      lapTimesSeconds: [...state.lapTimesSeconds],
    }));
    const sample = this.course.createSampleScratch();
    const lookAhead = this.course.createSampleScratch();
    const scratch: Record<string, unknown>[] = projected.map(() => ({
      deltaSeconds: RIVAL_FIXED_STEP_SECONDS,
    }));
    // No player in the world: an infinite gap disarms the corridor and the
    // player's lateral room, and leaves everything longitudinal untouched -
    // which is the whole reason projecting a rival's remaining laps is legal.
    const resolve = (state: RivalState, field: readonly RivalState[]) => this.resolveDrive(
      state,
      field,
      Number.NEGATIVE_INFINITY,
      0,
      sample,
      lookAhead,
      scratch,
    );
    const maximumSteps = Math.ceil(
      this.totalLaps * this.course.length / 20 / RIVAL_FIXED_STEP_SECONDS,
    );
    let remainder = 0;
    for (
      let step = 0;
      step < maximumSteps && projected.some((state) => !state.finished);
      step += 1
    ) {
      remainder = stepRivalField(projected, {
        deltaSeconds: RIVAL_FIXED_STEP_SECONDS,
        remainderSeconds: remainder,
        resolveSubStepInput: resolve as never,
      });
    }
    return projected.map((state, index) => {
      if (state.finishTimeSeconds === null) {
        throw new Error(
          `Rival ${this.states[index].id} did not reach its projected finish.`,
        );
      }
      return state.finishTimeSeconds;
    });
  }

  private measureSeparation(
    playerRaceDistanceMeters: number,
    playerLateralMeters: number,
  ): void {
    // Once the PLAYER has crossed, its race distance is frozen on the finish
    // line while the rest of the field drives through it to take the flag. That
    // is not a near miss - the result overlay is up and the craft is coasting
    // into the run-off - but it is the smallest number this metric will ever
    // see, and it was reading 0.09 m on a race the field never came near the
    // player in.
    const raceDistance = this.course.length * this.totalLaps;
    const playerFinished = playerRaceDistanceMeters >= raceDistance - 1e-6;
    for (let index = 0; index < this.states.length; index += 1) {
      const state = this.states[index];
      // A finished rival is parked on the line and its visual is retired, so it
      // is not a separation hazard - counting it would report the whole field
      // stacked on the finish as a near miss.
      if (state.finished) continue;
      if (!playerFinished) {
        const longitudinal = state.raceDistanceMeters - playerRaceDistanceMeters;
        const lateral = state.lateralMeters - playerLateralMeters;
        const separation = Math.hypot(longitudinal, lateral);
        if (separation < this.minimumSeparationMeters) {
          this.minimumSeparationMeters = separation;
          // Where it happened, not just how close. A bare minimum says nothing
          // about whether the field crowded the player or the player drove into
          // the field, and those want opposite fixes.
          this.closestApproach.id = state.id;
          this.closestApproach.longitudinalMeters = longitudinal;
          this.closestApproach.lateralMeters = lateral;
          this.closestApproach.courseDistanceMeters = state.courseDistanceMeters;
          this.closestApproach.lap = state.lap;
          // The lane the craft was ASKING for at that instant. A target a full
          // clearance away says the rules fired and the craft was in transit; a
          // target on top of the player says they did not.
          this.closestApproach.targetLateralMeters = Number(
            this.driveScratch[index].targetLateralMeters ?? 0,
          );
          this.closestApproach.rivalLateralMeters = state.lateralMeters;
          this.closestApproach.playerLateralMeters = playerLateralMeters;
        }
      }
      for (let otherIndex = index + 1; otherIndex < this.states.length; otherIndex += 1) {
        const other = this.states[otherIndex];
        if (other.finished) continue;
        const separation = Math.hypot(
          state.raceDistanceMeters - other.raceDistanceMeters,
          state.lateralMeters - other.lateralMeters,
        );
        this.minimumSeparationMeters = Math.min(
          this.minimumSeparationMeters,
          separation,
        );
        this.minimumRivalSeparationMeters = Math.min(
          this.minimumRivalSeparationMeters,
          separation,
        );
      }
    }
  }
}
