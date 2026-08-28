import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { ASSET_KIT_PROP_PLACEMENTS } from "./asset-kit-layout";
import { EngineAudio } from "./audio";
import {
  calculateDesiredCameraFov,
  calculateImpactShakeOffset,
  integrateCameraFov,
} from "./camera-feedback";
import { hasPlayerControlIntent } from "./control-mode";
import {
  type CourseProjection,
  type RaceCourse,
  type TurnCue,
} from "./course";
import type {
  GreenwaterEnvironment,
  RaceEnvironment,
} from "./environment";
import { disposeObject3DResources } from "./graphics-resources";
import type { GreenwaterLivingWorld } from "./living-world";
import type { GreenwaterSurfaceCharacter } from "./surface-character";
import {
  phasePresentsDrivingInput,
  phaseRunsContinuousPresentation,
  shouldRenderGameFrame,
} from "./frame-scheduling";
import type { InputFrame } from "./input";
import { InputController } from "./input";
import {
  BOOST_MAX_SPEED,
  calculateDriftIntent,
  calculateGripRate,
  calculateTurnAuthority,
  calculateTurnRate,
  integrateBoostReserve,
  integrateCoastSpeed,
  integrateSurfaceGrip,
  integrateSteering,
  integrateSpeed,
  resolveBoostLockout,
  resolveDriftActive,
} from "./physics";
import {
  calculatePresentationAlpha,
  calculateSpeedStreakLength,
  calculateSpeedStreakOpacity,
} from "./presentation";
import {
  calculateFinishDistanceMeters,
  calculateRecoveryTelemetry,
  crossedForwardProgress,
  integrateWrongWayEvidence,
  isOpenEdgeWarningActive,
  isTurnCueBeyondFinish,
  isTurnCueUrgent,
  resolveWrongWayActive,
  resolveCountdownStage,
} from "./race-rules";
import {
  calculateMinimumPixelRatio,
  calculatePreferredPixelRatio,
  reconcilePixelRatioAfterResize,
} from "./render-quality";
import { playerRaceDistanceMeters as calculatePlayerRaceDistance } from "./rival-race.js";
import {
  RivalFleet,
  loadRivalLiveryTextures,
  type RivalRaceStatus,
} from "./rivals";
import {
  applyPs2MaterialTreatment,
  TotemVehicle,
  type TotemVisualState,
} from "./totem";
import { GameUi, type RaceStandingEntry } from "./ui";

const VEHICLE_MODEL_URL = "/assets/totem/models/totem_runtime.glb";
const RACE_PRESENCE_FX_ATLAS_URL = "/assets/totem/textures/totem_race_presence_fx_256.png";
const ASSET_KIT_MODEL_URL = "/assets/totem/models/futurisma_asset_kit.glb";
const ENVIRONMENT_MODEL_URL = "/assets/greenwater/models/greenwater_environment_runtime.glb";
const LIVING_WORLD_MOTION_URL = "/assets/greenwater/textures/greenwater_motion_512.png";
const SURFACE_CHARACTER_MODEL_URL = "/assets/greenwater/models/greenwater_surface_character_runtime.glb";
const BITTERPAN_TRACK_MODEL_URL = "/assets/map02/models/bitterpan_blockout.glb";
const BITTERPAN_MASSING_MODEL_URL = "/assets/map02/models/bitterpan_massing.glb";

type RacePhase = "standby" | "countdown" | "running" | "paused" | "resuming" | "finished";

const FIXED_STEP = 1 / 120;
const MAX_PHYSICS_BACKLOG = 0.1;
const RECOVERY_PROBE_DISTANCE_METERS = 900;
const WRONG_WAY_PROBE_DISTANCE_METERS = 100;
const WATER_GRIP_PROBE_DISTANCE_METERS = 580;
const RESUME_COUNTDOWN_SECONDS = 2.7;
const ZERO_INPUT: InputFrame = { throttle: 0, brake: 0, steer: 0, boost: false };
const SPEED_LINE_COLOR = new THREE.Color(0x94bdb7);
const BOOST_LINE_COLOR = new THREE.Color(0x78d6de);
const SKY_ZENITH_TINT = new THREE.Color(0x0a1216);
const WHITE = new THREE.Color(0xffffff);
const SUN_DIRECTION = new THREE.Vector3(80, 130, -35).normalize();
const RIM_PRESENCE_BOOST = 1.85;
const HEMISPHERE_TRIM = 0.88;

interface StaticGeometryBucket {
  material: THREE.Material;
  geometries: THREE.BufferGeometry[];
}

function mergeStaticSceneByMaterial(source: THREE.Object3D): THREE.Group {
  source.updateMatrixWorld(true);
  const buckets = new Map<string, StaticGeometryBucket>();
  const fallbackMeshes: THREE.Mesh[] = [];

  source.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    if (Array.isArray(object.material) || object instanceof THREE.InstancedMesh) {
      const fallback = new THREE.Mesh(object.geometry.clone(), object.material);
      fallback.geometry.applyMatrix4(object.matrixWorld);
      fallbackMeshes.push(fallback);
      return;
    }
    const geometry = object.geometry.index
      ? object.geometry.toNonIndexed()
      : object.geometry.clone();
    geometry.applyMatrix4(object.matrixWorld);
    const attributeSignature = Object.keys(geometry.attributes)
      .map((name) => {
        const attribute = geometry.attributes[name] as THREE.BufferAttribute;
        return `${name}:${attribute.itemSize}:${attribute.normalized}`;
      })
      .sort()
      .join("|");
    const key = `${object.material.uuid}|${attributeSignature}`;
    const bucket: StaticGeometryBucket = buckets.get(key) ?? {
      material: object.material,
      geometries: [] as THREE.BufferGeometry[],
    };
    bucket.geometries.push(geometry);
    buckets.set(key, bucket);
  });

  const mergedRoot = new THREE.Group();
  mergedRoot.name = "totem_asset_kit_course_dressing";
  for (const bucket of buckets.values()) {
    const geometry = mergeGeometries(bucket.geometries, false);
    for (const sourceGeometry of bucket.geometries) sourceGeometry.dispose();
    if (!geometry) continue;
    mergedRoot.add(new THREE.Mesh(geometry, bucket.material));
  }
  if (fallbackMeshes.length > 0) mergedRoot.add(...fallbackMeshes);
  return mergedRoot;
}

function placeCourseAlignedObject(
  object: THREE.Object3D,
  sample: ReturnType<RaceCourse["sample"]>,
  lateral: number,
  yaw: number,
  scale: number,
): void {
  object.position.copy(sample.position).addScaledVector(sample.right, lateral);
  object.quaternion.setFromRotationMatrix(
    new THREE.Matrix4().makeBasis(
      sample.right,
      sample.up,
      sample.tangent.clone().multiplyScalar(-1),
    ),
  );
  object.rotateY(yaw);
  object.scale.setScalar(scale);
}

function createNormalizedPropInstance(
  source: THREE.Object3D,
  name: string,
): THREE.Group {
  const template = source.getObjectByName(name);
  if (!template) throw new Error(`Accepted asset kit is missing ${name}.`);
  const prop = template.clone(true);
  const bounds = new THREE.Box3().setFromObject(prop);
  if (bounds.isEmpty()) throw new Error(`Accepted asset kit prop ${name} has no bounds.`);
  const center = bounds.getCenter(new THREE.Vector3());
  prop.position.x -= center.x;
  prop.position.y -= bounds.min.y;
  prop.position.z -= center.z;
  const root = new THREE.Group();
  root.name = `${name}_course_instance`;
  root.add(prop);
  return root;
}

function createAssetKitCourseDressing(
  source: THREE.Object3D,
  course: RaceCourse,
): THREE.Group {
  const dressing = new THREE.Group();
  dressing.name = "totem_asset_kit_course_source";
  for (const placement of ASSET_KIT_PROP_PLACEMENTS) {
    const prop = createNormalizedPropInstance(source, placement.name);
    placeCourseAlignedObject(
      prop,
      course.sampleAtDistance(placement.distance),
      placement.lateral,
      placement.yaw,
      placement.scale,
    );
    dressing.add(prop);
  }

  placeCourseAlignedObject(source, course.sample(0.985), -22, 0, 1);
  dressing.add(source);
  return dressing;
}

export class FuturismaGame {
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly course: RaceCourse;
  private readonly diagnosticCourseAssemblyMs: number;
  private readonly coursePs2Treatment: ReturnType<typeof applyPs2MaterialTreatment>;
  private authoredEnvironment: RaceEnvironment | null = null;
  private livingWorld: GreenwaterLivingWorld | null = null;
  private surfaceCharacter: GreenwaterSurfaceCharacter | null = null;
  private readonly demoProjection: CourseProjection;
  private readonly demoLookAhead: ReturnType<RaceCourse["createSampleScratch"]>;
  private readonly demoTurnCue: TurnCue = {
    direction: "LEFT",
    followingDirection: null,
    distance: 0,
    hard: false,
    radius: 0,
  };
  private readonly hudTurnCue: TurnCue = {
    direction: "LEFT",
    followingDirection: null,
    distance: 0,
    hard: false,
    radius: 0,
  };
  private readonly beforeMoveProjection: CourseProjection;
  private readonly afterMoveProjection: CourseProjection;
  private readonly poseProjection: CourseProjection;
  private readonly cameraProjection: CourseProjection;
  private readonly cameraSurfaceProjection: CourseProjection;
  private readonly cameraLookAhead: ReturnType<RaceCourse["createSampleScratch"]>;
  private readonly totalLaps: number;
  private readonly vehicle = new TotemVehicle();
  private rivalFleet: RivalFleet | null = null;
  private readonly audio = new EngineAudio();
  private readonly timer = new THREE.Timer();
  private readonly hemisphereLight = new THREE.HemisphereLight();
  private readonly keyLight = new THREE.DirectionalLight();
  private readonly rimLight = new THREE.DirectionalLight();
  private readonly skyUniforms = {
    topColor: { value: new THREE.Color(0x1a2226) },
    horizonColor: { value: new THREE.Color(0xa9bbb0) },
    bandColor: { value: new THREE.Color(0xc8ff2e) },
  };
  private readonly skyDome: THREE.Mesh;
  private readonly sunDisc: THREE.Mesh;
  private readonly skyTopTarget = new THREE.Color();
  private readonly skyBandTarget = new THREE.Color();
  private readonly presenceLight = new THREE.PointLight(0xffffff, 0, 26, 1.8);
  private readonly speedLines: THREE.LineSegments;
  private readonly impactSparks: THREE.Points;
  private readonly impactSparkPositions = new Float32Array(48 * 3);
  private readonly impactSparkVelocities = new Float32Array(48 * 3);
  private readonly impactSparkLife = new Float32Array(48);
  private readonly cameraTarget = new THREE.Vector3();
  private readonly cameraLook = new THREE.Vector3();
  private readonly poseMatrix = new THREE.Matrix4();
  private readonly poseQuaternion = new THREE.Quaternion();
  private readonly position = new THREE.Vector3();
  private readonly forward = new THREE.Vector3(0, 0, -1);
  private readonly travelDirection = new THREE.Vector3(0, 0, -1);
  private readonly previousPosition = new THREE.Vector3();
  private readonly previousForward = new THREE.Vector3(0, 0, -1);
  private readonly previousTravelDirection = new THREE.Vector3(0, 0, -1);
  private readonly presentationPosition = new THREE.Vector3();
  private readonly presentationForward = new THREE.Vector3(0, 0, -1);
  private readonly presentationTravelDirection = new THREE.Vector3(0, 0, -1);
  private readonly scratchA = new THREE.Vector3();
  private readonly scratchB = new THREE.Vector3();
  private readonly scratchC = new THREE.Vector3();
  private readonly scratchD = new THREE.Vector3();
  private readonly demoInput: InputFrame = {
    throttle: 1,
    brake: 0,
    steer: 0,
    boost: false,
  };
  private readonly vehicleVisualState: TotemVisualState = {
    steer: 0,
    throttle: 0,
    brake: 0,
    speedRatio: 0,
    boostActive: false,
    driftIntensity: 0,
    lateralLoad: 0,
    surfaceGrip: 1,
    reducedMotion: false,
    elapsed: 0,
    delta: 0,
  };

  private phase: RacePhase = "standby";
  private progress: number;
  private speed = 0;
  private lateral: number;
  private steerAmount = 0;
  private nextCheckpointIndex = 1;
  private missedGateIndex: number | null = null;
  private boostReserve = 1;
  private boostActive = false;
  private boostLockedUntilRelease = false;
  private driftActive = false;
  private driftIntensity = 0;
  private surfaceGrip = 1;
  private lap = 1;
  private elapsedMs = 0;
  private lapStartElapsedMs = 0;
  private lastLapMs: number | null = null;
  private bestLapMs: number | null = null;
  private readonly lapTimesMs: number[] = [];
  private raceStatus: RivalRaceStatus = {
    position: 1,
    racerCount: 4,
    gapToAheadMs: null,
    gapToBehindMs: null,
  };
  private lastPositionCue = 1;
  private lastPositionCueAtMs = -Infinity;
  private diagnosticPositionChanges = 0;
  private diagnosticPositionsGained = 0;
  private diagnosticPositionsLost = 0;
  private finalStandings: RaceStandingEntry[] = [];
  private countdown = 3.7;
  private resumeCountdown = 0;
  private countdownStage = "";
  private pausedBeforeStart = false;
  private edgeContact = false;
  private openEdgeWarning = false;
  private wrongWayEvidence = 0;
  private wrongWayActive = false;
  private courseAlignment = 1;
  private offCourseTime = 0;
  private recoveryImmunity = 0;
  private hazardTripCooldown = 0;
  private padBoostTime = 0;
  private impactShake = 0;
  private impactSparkCursor = 0;
  private physicsAccumulator = 0;
  private adaptiveQualityDebt = 0;
  private adaptiveQualityCredit = 0;
  private smoothedFrameMs = 16.67;
  private nextDiagnosticsAt = 0;
  private nextHudAt = 0;
  private nextFieldOrderAt = 0;
  private readonly diagnosticFrameSamples = new Float32Array(720);
  private diagnosticFrameIndex = 0;
  private diagnosticFrameCount = 0;
  private diagnosticMaxFrameMs = 0;
  private diagnosticPhysicsSteps = 0;
  private diagnosticDistanceTravelled = 0;
  private diagnosticBoostSeconds = 0;
  private diagnosticDriftSeconds = 0;
  private diagnosticDriftEntries = 0;
  private diagnosticMaxDriftIntensity = 0;
  private diagnosticMinimumSurfaceGrip = 1;
  private diagnosticEdgeSeconds = 0;
  private diagnosticWrongWaySeconds = 0;
  private diagnosticWrongWayEntries = 0;
  private diagnosticMinimumCameraFov = 56;
  private diagnosticMaximumCameraFov = 56;
  private diagnosticMaximumBrakeFovCompression = 0;
  private diagnosticImpacts = 0;
  private diagnosticImpactSparkBursts = 0;
  private diagnosticMissedGates = 0;
  private diagnosticRecoveries = 0;
  private diagnosticContextLosses = 0;
  private diagnosticContextRestores = 0;
  private diagnosticRenderedFrames = 0;
  private diagnosticIdleFramesSkipped = 0;
  private diagnosticPresentationProjectionQueries = 0;
  private diagnosticAtmosphereUpdates = 0;
  private diagnosticTopSpeed = 0;
  private diagnosticMaxLateralRatio = 0;
  private diagnosticStartHeapMb: number | null = null;
  private diagnosticMaxHeapMb: number | null = null;
  private diagnosticStartupReadyMs = 0;
  private diagnosticVehicleLoadStartedMs = 0;
  private diagnosticVehicleLoadMs = 0;
  private diagnosticVehicleRequestStartMs: number | null = null;
  private diagnosticVehicleResourceRequests = 0;
  private diagnosticAssetKitLoadMs: number | null = null;
  private diagnosticAssetKitReady = false;
  private diagnosticEnvironmentLoadMs: number | null = null;
  private diagnosticEnvironmentReady = false;
  private diagnosticEnvironmentError: string | null = null;
  private diagnosticLivingWorldLoadMs: number | null = null;
  private diagnosticLivingWorldReady = false;
  private diagnosticLivingWorldError: string | null = null;
  private diagnosticSurfaceCharacterLoadMs: number | null = null;
  private diagnosticSurfaceCharacterReady = false;
  private diagnosticSurfaceCharacterError: string | null = null;
  private readonly diagnosticImpactLocations: string[] = [];
  private readonly diagnosticRecoveryLocations: string[] = [];
  private diagnosticsOutput: HTMLOutputElement | null = null;
  private diagnosticsFinalReported = false;
  private readonly diagnosticsPeak = {
    calls: 0,
    triangles: 0,
    geometries: 0,
    textures: 0,
    environmentGroups: 0,
    environmentTriangles: 0,
    frameMs: 0,
    phase: "standby" as RacePhase,
    sector: "",
    distanceMeters: 0,
  };
  private running = false;
  private disposed = false;
  private contextLost = false;
  private contextPausedRace = false;
  private contextLossProbeStarted = false;
  private focusLossProbeStarted = false;
  private contextRestoreAt = 0;
  private trialStartPending = false;
  private animationFrame = 0;
  private renderRequested = true;
  private readonly qualityOverride = new URLSearchParams(window.location.search).get(
    "quality",
  );
  private readonly qualityMode = this.qualityOverride === "high"
    ? "high"
    : this.qualityOverride === "low"
      ? "low"
      : "adaptive";
  private preferredPixelRatio = this.resolvePreferredPixelRatio();
  private minimumPixelRatio = this.resolveMinimumPixelRatio();
  private renderPixelRatio = this.preferredPixelRatio;
  private readonly demoMode = new URLSearchParams(window.location.search).has("demo");
  private demoAutopilot = this.demoMode;
  private readonly diagnosticsMode = new URLSearchParams(window.location.search).has(
    "diagnostics",
  );
  private readonly recoveryProbe = this.diagnosticsMode
    && new URLSearchParams(window.location.search).get("probe") === "recovery";
  private readonly wrongWayProbe = this.diagnosticsMode
    && new URLSearchParams(window.location.search).get("probe") === "wrong-way";
  private readonly impactProbe = this.diagnosticsMode
    && new URLSearchParams(window.location.search).get("probe") === "impact";
  private readonly waterGripProbe = this.diagnosticsMode
    && new URLSearchParams(window.location.search).get("probe") === "water";
  private readonly contextLossProbe = this.diagnosticsMode
    && new URLSearchParams(window.location.search).get("probe") === "context";
  private readonly focusLossProbe = this.diagnosticsMode
    && new URLSearchParams(window.location.search).get("probe") === "focus";
  private readonly reducedMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches || new URLSearchParams(window.location.search).get("motion") === "reduce";

  constructor(
    canvas: HTMLCanvasElement,
    private readonly input: InputController,
    private readonly ui: GameUi,
    course: RaceCourse,
    courseAssemblyMs = 0,
  ) {
    this.course = course;
    this.camera = new THREE.PerspectiveCamera(
      58,
      1,
      0.1,
      this.course.kind === "bitterpan" ? 1800 : 650,
    );
    this.diagnosticCourseAssemblyMs = courseAssemblyMs;
    this.coursePs2Treatment = applyPs2MaterialTreatment(this.course.group);
    this.demoProjection = this.course.createProjectionScratch();
    this.demoLookAhead = this.course.createSampleScratch();
    this.beforeMoveProjection = this.course.createProjectionScratch();
    this.afterMoveProjection = this.course.createProjectionScratch();
    this.poseProjection = this.course.createProjectionScratch();
    this.cameraProjection = this.course.createProjectionScratch();
    this.cameraSurfaceProjection = this.course.createProjectionScratch();
    this.cameraLookAhead = this.course.createSampleScratch();
    this.totalLaps = this.resolveLapCount();
    this.progress = this.course.startProgress;
    this.lateral = this.course.startLateral;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      alpha: false,
      powerPreference: "high-performance",
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.AgXToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = false;
    this.ui.setRaceFormat(
      this.totalLaps,
      this.course.length,
      [],
      {
        mapName: this.course.mapName,
        mapCode: this.course.mapCode,
        checkpointCount: this.course.checkpointCount,
        finishName: this.course.finishName,
        startLabel: this.course.startLabel,
      },
    );
    this.ui.setDemoAutopilot(this.demoAutopilot);
    this.ui.setGraphicsContextLost(false);
    const initialFog = this.course.fogAt(0);
    this.scene.background = initialFog.color.clone();
    this.scene.fog = new THREE.FogExp2(initialFog.color, initialFog.density);

    this.scene.add(this.course.group, this.vehicle.root);
    this.speedLines = this.createSpeedLines();
    this.impactSparks = this.createImpactSparks();
    this.camera.add(this.speedLines);
    this.scene.add(this.camera, this.impactSparks);
    this.installLighting();
    this.skyDome = this.createSkyBackdrop();
    this.sunDisc = this.createSunDisc();
    this.scene.add(this.skyDome, this.sunDisc);
    this.presenceLight.position.set(0, 2.3, 0.9);
    this.vehicle.root.add(this.presenceLight);
    if (this.diagnosticsMode) {
      this.diagnosticsOutput = document.createElement("output");
      this.diagnosticsOutput.id = "futurisma-diagnostics";
      this.diagnosticsOutput.hidden = true;
      document.body.append(this.diagnosticsOutput);
    }
    this.timer.connect(document);
    this.resize();
    window.addEventListener("resize", this.resize);
    window.addEventListener("blur", this.handleWindowBlur);
    document.addEventListener("visibilitychange", this.handleVisibilityChange);
    this.renderer.domElement.addEventListener("webglcontextlost", this.handleContextLost);
    this.renderer.domElement.addEventListener(
      "webglcontextrestored",
      this.handleContextRestored,
    );
  }

  async initialize(): Promise<boolean> {
    const vehicleLoadStartedAt = performance.now();
    this.diagnosticVehicleLoadStartedMs = vehicleLoadStartedAt;
    await this.vehicle.load(VEHICLE_MODEL_URL, RACE_PRESENCE_FX_ATLAS_URL);
    this.diagnosticVehicleLoadMs = performance.now() - vehicleLoadStartedAt;
    const vehicleResourceUrl = new URL(VEHICLE_MODEL_URL, window.location.href).href;
    const vehicleResources = performance.getEntriesByName(vehicleResourceUrl, "resource");
    const vehicleResource = vehicleResources[0];
    this.diagnosticVehicleResourceRequests = vehicleResources.length;
    this.diagnosticVehicleRequestStartMs = vehicleResource?.startTime ?? null;
    if (this.disposed) {
      disposeObject3DResources(this.vehicle.root);
      this.vehicle.root.clear();
      return false;
    }
    const rivalVisualBatches = this.vehicle.createRivalVisualBatches();
    const disposeRivalVisualBatches = (): void => {
      for (const batch of rivalVisualBatches) {
        batch.geometry.dispose();
        batch.material.dispose();
      }
    };
    let rivalLiveryTextures: THREE.Texture[];
    try {
      rivalLiveryTextures = await loadRivalLiveryTextures();
    } catch (error) {
      disposeRivalVisualBatches();
      throw error;
    }
    if (this.disposed) {
      disposeRivalVisualBatches();
      for (const texture of rivalLiveryTextures) texture.dispose();
      disposeObject3DResources(this.vehicle.root);
      this.vehicle.root.clear();
      return false;
    }
    this.rivalFleet = new RivalFleet(
      this.course,
      this.totalLaps,
      rivalVisualBatches,
      rivalLiveryTextures,
      this.vehicle.effectsAtlas(),
    );
    this.scene.add(this.rivalFleet.root);
    this.ui.setRaceFormat(
      this.totalLaps,
      this.course.length,
      this.rivalFleet.gridEntries,
      {
        mapName: this.course.mapName,
        mapCode: this.course.mapCode,
        checkpointCount: this.course.checkpointCount,
        finishName: this.course.finishName,
        startLabel: this.course.startLabel,
      },
    );
    this.resetRaceState();
    this.updatePose(ZERO_INPUT, 0);
    this.snapCamera();
    if (this.course.kind === "bitterpan") {
      await this.loadAuthoredEnvironment();
      if (this.disposed) return false;
    }
    this.running = true;
    this.animationFrame = requestAnimationFrame(this.frame);
    if (this.course.kind === "greenwater") void this.loadAuthoredEnvironment();
    this.diagnosticStartupReadyMs = performance.now();
    return true;
  }

  async startTrial(): Promise<void> {
    if (!this.canStart()) return;
    this.trialStartPending = true;
    try {
      await this.audio.start().catch(() => undefined);
      if (this.contextLost || this.disposed) return;
      this.audio.setPaused(false);
      this.resetRaceState();
      this.updatePose(ZERO_INPUT, 0);
      this.snapCamera();
      this.phase = "countdown";
      this.countdown = 3.7;
      this.countdownStage = "";
      this.ui.showRace();
    } finally {
      this.trialStartPending = false;
    }
  }

  canStart(): boolean {
    return !this.disposed
      && !this.contextLost
      && !this.trialStartPending
      && (this.phase === "standby" || this.phase === "finished");
  }

  private readonly frame = (timestamp: number): void => {
    if (!this.running) return;
    this.timer.update(timestamp);
    const delta = Math.min(this.timer.getDelta(), 0.05);
    const input = this.input.read();

    if (this.input.consumeStart() && !this.contextLost) {
      if (
        this.phase === "running"
        || this.phase === "countdown"
        || this.phase === "paused"
        || this.phase === "resuming"
      ) this.togglePause();
      else if (this.canStart()) void this.startTrial();
    }
    if (this.input.consumeReset()) {
      if (this.phase === "running" || this.phase === "countdown") this.recoverVehicle();
    }
    if (this.input.consumeMute()) {
      this.ui.setAudioMuted(this.audio.toggleMute());
    }

    this.update(delta, input);
    this.updateAdaptiveQuality(delta);
    this.updateContextLossProbe();
    this.updateFocusLossProbe();
    if (shouldRenderGameFrame(
      this.phase,
      this.speed,
      this.renderRequested,
      this.contextLost,
    )) {
      this.authoredEnvironment?.updateVisibility(this.camera);
      this.renderer.render(this.scene, this.camera);
      this.renderRequested = false;
      this.diagnosticRenderedFrames += 1;
    } else if (!this.contextLost) {
      this.diagnosticIdleFramesSkipped += 1;
    }
    this.reportDiagnostics(delta);
    this.animationFrame = requestAnimationFrame(this.frame);
  };

  private readDemoInput(): InputFrame {
    const projection = this.course.project(
      this.position,
      this.progress,
      this.demoProjection,
    );
    const speedRatio = this.speed / BOOST_MAX_SPEED;
    const turnCue = this.course.turnAhead(
      this.progress,
      220,
      this.demoTurnCue,
    );
    const lookAheadDistance = THREE.MathUtils.lerp(32, 52, speedRatio)
      - (turnCue?.hard ? 4 : 0);
    const lookAhead = this.course.sample(
      this.progress + lookAheadDistance / this.course.length,
      this.demoLookAhead,
    );
    const target = this.scratchA.copy(lookAhead.tangent);
    this.alignDirectionToSurface(target, projection.up, projection.tangent);
    const signedAngle = Math.atan2(
      this.scratchB.crossVectors(this.forward, target).dot(projection.up),
      THREE.MathUtils.clamp(this.forward.dot(target), -1, 1),
    );
    const lateralCorrection = THREE.MathUtils.clamp(
      projection.lateral / Math.max(1, projection.halfWidth),
      -1,
      1,
    );
    const lateralSlip = THREE.MathUtils.clamp(
      this.travelDirection.dot(projection.right),
      -1,
      1,
    );
    const gateProgress = this.course.checkpointProgress(this.nextCheckpointIndex);
    const gateDistance = THREE.MathUtils.euclideanModulo(
      gateProgress - this.progress,
      1,
    ) * this.course.length;
    // Flying laps begin at full speed, so the showcase controller trims its
    // straight-line target after lap one to keep the authored race pace.
    const cleanLineSpeed = this.lap === 1 ? 88 : 73;
    const turnTargetSpeed = turnCue
      ? turnCue.radius <= 50
        ? 52
        : turnCue.radius <= 60
          ? 56
          : turnCue.radius <= 85
            ? 64
            : turnCue.radius <= 110
              ? 72
              : turnCue.radius <= 200
                ? 82
                : cleanLineSpeed
      : cleanLineSpeed;
    const brakingDistance = Math.max(
      0,
      (this.speed * this.speed - turnTargetSpeed * turnTargetSpeed) / 28,
    ) + 30;
    const approachingTurnLimit = Boolean(
      turnCue && turnCue.distance < brakingDistance,
    );
    const desiredSpeed = approachingTurnLimit ? turnTargetSpeed : cleanLineSpeed;
    if (gateDistance < 120 && Math.abs(lateralCorrection) > 0.5) {
      this.demoInput.brake = 0.2;
    } else if (this.speed > desiredSpeed) {
      this.demoInput.brake = THREE.MathUtils.clamp(
        0.12 + (this.speed - desiredSpeed) / 42,
        0.12,
        0.5,
      );
    } else {
      this.demoInput.brake = Math.abs(signedAngle) > 0.62 ? 0.3 : 0;
    }

    this.demoInput.throttle = this.speed > desiredSpeed + 3 ? 0.18 : 1;
    this.demoInput.steer = THREE.MathUtils.clamp(
      -signedAngle * 2.05 - lateralCorrection * 0.72 - lateralSlip,
      -1,
      1,
    );
    this.demoInput.boost = !approachingTurnLimit
      && this.elapsedMs / 1000 % 5 < 0.55
      && this.speed < 88
      && Math.abs(signedAngle) < 0.12
      && Math.abs(lateralCorrection) < 0.24;
    return this.demoInput;
  }

  private update(delta: number, input: InputFrame): void {
    if (!phaseRunsContinuousPresentation(this.phase, this.speed)) {
      this.physicsAccumulator = 0;
      return;
    }

    this.physicsAccumulator = Math.min(
      this.physicsAccumulator + delta,
      MAX_PHYSICS_BACKLOG,
    );
    while (this.physicsAccumulator >= FIXED_STEP) {
      this.capturePreviousSimulationPose();
      if (this.phase === "countdown") this.updateCountdown(FIXED_STEP);
      if (this.phase === "resuming") this.updateResumeCountdown(FIXED_STEP);
      if (this.phase === "running") {
        this.rivalFleet?.step(
          FIXED_STEP,
          this.playerRaceDistance(),
          this.lateral,
        );
        this.updateRace(FIXED_STEP, this.resolveRaceInput(input));
      } else if (this.phase === "finished") {
        this.rivalFleet?.step(
          FIXED_STEP,
          this.playerRaceDistance(),
          this.lateral,
        );
        this.updateCoast(FIXED_STEP);
      }
      this.physicsAccumulator -= FIXED_STEP;
    }

    this.interpolatePresentationPose(
      calculatePresentationAlpha(this.physicsAccumulator, FIXED_STEP),
    );
    this.rivalFleet?.updatePresentation(
      calculatePresentationAlpha(this.physicsAccumulator, FIXED_STEP),
      this.timer.getElapsed(),
    );

    const presentationInput = phasePresentsDrivingInput(this.phase)
      ? this.demoAutopilot
        ? this.demoInput
        : input
      : ZERO_INPUT;
    const presentationProjection = this.updatePose(presentationInput, delta);
    this.updateCamera(
      delta,
      this.steerAmount,
      presentationInput.brake,
      presentationProjection,
    );
    this.updateSpeedLines(delta);
    this.updateImpactSparks(delta);
    this.updateFog(delta);
    // Reduced motion freezes the effect clock, but the cards still need to face
    // the moving chase camera so the approved still frame remains visible.
    this.livingWorld?.update(delta, this.camera, !this.reducedMotion);
    if (this.course.updateAtmosphere(this.elapsedMs / 1000, this.reducedMotion)) {
      this.diagnosticAtmosphereUpdates += 1;
    }
    const audioControlUpdated = this.audio.update(
      this.speed / BOOST_MAX_SPEED,
      presentationInput.throttle,
      presentationInput.brake,
      this.boostActive,
      this.surfaceGrip,
      this.driftIntensity,
    );
    if (audioControlUpdated && this.phase !== "finished") {
      this.audio.setMusicProfile(this.course.musicAt(this.progress));
    }
    const now = this.timer.getElapsed();
    if (now >= this.nextHudAt) {
      this.nextHudAt = now + 1 / 30;
      this.refreshRaceStatus(this.phase === "running");
      this.updateHud(presentationInput);
      if (now >= this.nextFieldOrderAt) {
        this.nextFieldOrderAt = now + 0.25;
        if (this.rivalFleet) {
          this.ui.updateFieldOrder(
            this.rivalFleet.fieldOrder(this.playerRaceDistance(), this.speed),
          );
        }
      }
    }
  }

  private updateCountdown(delta: number): void {
    this.countdown -= delta;
    const nextStage = resolveCountdownStage(this.countdown);
    if (nextStage !== this.countdownStage) {
      this.countdownStage = nextStage;
      this.ui.setCountdown(nextStage);
      if (nextStage) this.audio.playCountdown(nextStage === "GO");
    }
    if (this.countdown <= 0) {
      this.phase = "running";
      this.resetDiagnosticsPeak();
    }
  }

  private resolveRaceInput(input: InputFrame): InputFrame {
    if (!this.demoAutopilot) return input;
    const requestedTakeover = this.input.consumeControlIntent()
      || hasPlayerControlIntent(input);
    if (!requestedTakeover) return this.readDemoInput();

    this.demoAutopilot = false;
    this.ui.setDemoAutopilot(false);
    this.ui.flashHazard("MANUAL CONTROL", 1_200);
    return input;
  }

  private updateResumeCountdown(delta: number): void {
    this.resumeCountdown -= delta;
    const nextStage = resolveCountdownStage(this.resumeCountdown);
    if (nextStage !== this.countdownStage) {
      this.countdownStage = nextStage;
      this.ui.setCountdown(nextStage);
      if (nextStage) this.audio.playCountdown(nextStage === "GO");
    }
    if (this.resumeCountdown <= 0) {
      this.phase = "running";
      this.physicsAccumulator = 0;
      this.ui.setPaused(false);
    }
  }

  private alignDirectionToSurface(
    direction: THREE.Vector3,
    up: THREE.Vector3,
    fallback: THREE.Vector3,
  ): void {
    direction.addScaledVector(up, -direction.dot(up));
    if (direction.lengthSq() < 0.0001) direction.copy(fallback);
    direction.normalize();
  }

  private capturePreviousSimulationPose(): void {
    this.previousPosition.copy(this.position);
    this.previousForward.copy(this.forward);
    this.previousTravelDirection.copy(this.travelDirection);
  }

  private syncPresentationPose(): void {
    this.capturePreviousSimulationPose();
    this.presentationPosition.copy(this.position);
    this.presentationForward.copy(this.forward);
    this.presentationTravelDirection.copy(this.travelDirection);
  }

  private interpolatePresentationPose(alpha: number): void {
    this.presentationPosition.lerpVectors(
      this.previousPosition,
      this.position,
      alpha,
    );
    this.presentationForward.lerpVectors(
      this.previousForward,
      this.forward,
      alpha,
    ).normalize();
    this.presentationTravelDirection.lerpVectors(
      this.previousTravelDirection,
      this.travelDirection,
      alpha,
    ).normalize();
  }

  private updateRace(delta: number, input: InputFrame): void {
    if (this.diagnosticsMode) this.diagnosticPhysicsSteps += 1;
    this.recoveryImmunity = Math.max(0, this.recoveryImmunity - delta);
    this.hazardTripCooldown = Math.max(0, this.hazardTripCooldown - delta);
    const beforeMove = this.course.project(
      this.position,
      this.progress,
      this.beforeMoveProjection,
    );
    if (this.course.isOnBoostPad(this.progress, this.lateral, beforeMove.halfWidth)) {
      this.padBoostTime = 0.38;
    } else {
      this.padBoostTime = Math.max(0, this.padBoostTime - delta);
    }
    const wasBoostActive = this.boostActive;
    this.boostLockedUntilRelease = resolveBoostLockout(
      input.boost,
      this.boostReserve,
      this.boostLockedUntilRelease,
    );
    const reserveBoost = input.boost
      && !this.boostLockedUntilRelease
      && input.throttle > 0.1
      && input.brake < 0.15
      && this.boostReserve > 0;
    this.boostActive = reserveBoost || this.padBoostTime > 0;
    if (this.boostActive && !wasBoostActive) {
      this.audio.playBoost();
      this.input.pulse(0.16, 0.34, 90);
    }
    const speedRatio = this.speed / BOOST_MAX_SPEED;
    const driftIntent = calculateDriftIntent(speedRatio, input.brake, input.steer);
    const wasDriftActive = this.driftActive;
    this.driftActive = resolveDriftActive(wasDriftActive, driftIntent);
    const driftResponse = 1 - Math.exp(
      -delta * (driftIntent > this.driftIntensity ? 8.5 : 4.8),
    );
    this.driftIntensity = THREE.MathUtils.lerp(
      this.driftIntensity,
      driftIntent,
      driftResponse,
    );
    if (this.driftActive && !wasDriftActive) {
      if (this.diagnosticsMode) this.diagnosticDriftEntries += 1;
      this.audio.playDriftEngage();
      this.input.pulse(0.08, 0.18, 75);
    }
    this.speed = integrateSpeed(
      this.speed,
      input.throttle,
      input.brake,
      this.boostActive,
      driftIntent,
      delta,
    );
    if (this.diagnosticsMode) {
      this.diagnosticDistanceTravelled += this.speed * delta;
      this.diagnosticTopSpeed = Math.max(this.diagnosticTopSpeed, this.speed);
      if (this.boostActive) this.diagnosticBoostSeconds += delta;
      if (this.driftActive) this.diagnosticDriftSeconds += delta;
      this.diagnosticMaxDriftIntensity = Math.max(
        this.diagnosticMaxDriftIntensity,
        this.driftIntensity,
      );
    }

    this.boostReserve = integrateBoostReserve(this.boostReserve, reserveBoost, delta);

    this.steerAmount = integrateSteering(
      this.steerAmount,
      input.steer,
      delta,
    );
    const turnAuthority = calculateTurnAuthority(speedRatio);
    const turnRate = calculateTurnRate(speedRatio, driftIntent);
    this.forward.applyAxisAngle(
      beforeMove.up,
      -this.steerAmount * turnRate * turnAuthority * delta,
    );
    this.alignDirectionToSurface(this.forward, beforeMove.up, beforeMove.tangent);

    const targetSurfaceGrip = this.course.surfaceGripAt(
      this.progress,
      this.lateral,
      beforeMove.halfWidth,
    );
    const wasLowGrip = this.surfaceGrip < 0.95;
    this.surfaceGrip = integrateSurfaceGrip(
      this.surfaceGrip,
      targetSurfaceGrip,
      this.course.surfaceGripRecoverySeconds,
      delta,
    );
    if (this.diagnosticsMode) {
      this.diagnosticMinimumSurfaceGrip = Math.min(
        this.diagnosticMinimumSurfaceGrip,
        this.surfaceGrip,
      );
    }
    if (!wasLowGrip && this.surfaceGrip < 0.95) {
      this.input.pulse(0.06, 0.2, 90);
    }
    const gripRate = calculateGripRate(
      speedRatio,
      driftIntent,
      this.surfaceGrip,
      input.brake,
      input.steer,
    );
    const gripResponse = 1 - Math.exp(-delta * gripRate);
    this.travelDirection.lerp(this.forward, gripResponse);
    this.alignDirectionToSurface(
      this.travelDirection,
      beforeMove.up,
      this.forward,
    );

    this.position.addScaledVector(this.travelDirection, this.speed * delta);
    const previousProgress = this.progress;
    const afterMove = this.course.project(
      this.position,
      this.progress,
      this.afterMoveProjection,
    );
    this.progress = afterMove.progress;
    this.lateral = afterMove.lateral;
    this.position.y = afterMove.position.y;

    const cableTripSide = this.hazardTripCooldown <= 0
      ? this.course.cableTripSideAt(this.progress, this.lateral)
      : 0;
    if (cableTripSide !== 0) {
      this.hazardTripCooldown = 0.85;
      this.speed *= 0.58;
      this.forward.applyAxisAngle(afterMove.up, cableTripSide * 0.11);
      this.travelDirection.lerp(this.forward, 0.34).normalize();
      this.impactShake = 0.9;
      this.vehicle.triggerImpactEffect(cableTripSide, 0.88);
      this.audio.playImpact(0.88);
      this.input.pulse(0.68, 0.82, 150);
      this.ui.flashImpact(cableTripSide < 0 ? "LEFT" : "RIGHT");
      this.ui.flashHazard("CABLE STRIKE");
      if (this.diagnosticsMode) {
        this.diagnosticImpacts += 1;
        this.diagnosticImpactLocations.push(
          `CABLE STRIKE@${Math.round(this.progress * this.course.length)}m`,
        );
      }
    }

    const edgeType = this.course.edgeType(afterMove, this.lateral);
    const roadLimit = afterMove.halfWidth - 2.05;
    const openEdge = edgeType === "C";
    this.openEdgeWarning = openEdge && isOpenEdgeWarningActive(
      this.lateral,
      afterMove.halfWidth,
    );
    const lateralLimit = openEdge ? afterMove.halfWidth + 5.8 : roadLimit;
    const beyondRoad = Math.abs(this.lateral) > roadLimit;
    const outside = Math.abs(this.lateral) > lateralLimit;
    const wasEdgeContact = this.edgeContact;
    if (openEdge && beyondRoad && this.recoveryImmunity <= 0) {
      this.offCourseTime += delta;
      this.speed = Math.max(0, this.speed - delta * 8);
    } else {
      this.offCourseTime = 0;
    }
    if (outside) {
      this.lateral = THREE.MathUtils.clamp(this.lateral, -lateralLimit, lateralLimit);
      this.position.copy(afterMove.position).addScaledVector(afterMove.right, this.lateral);
      const outward = this.scratchA
        .copy(afterMove.right)
        .multiplyScalar(Math.sign(afterMove.lateral));
      const outwardMotion = this.travelDirection.dot(outward);
      if (outwardMotion > 0) {
        this.travelDirection.addScaledVector(outward, -outwardMotion * 1.45).normalize();
      }
      if (!wasEdgeContact) {
        const impactStrength = edgeType === "B" ? 1 : edgeType === "A" ? 0.62 : 0.42;
        this.speed *= edgeType === "B" ? 0.6 : edgeType === "A" ? 0.82 : 0.9;
        this.impactShake = 1;
        this.emitImpactSparks(afterMove, Math.sign(this.lateral) || 1, impactStrength);
        this.audio.playImpact(impactStrength);
        this.input.pulse(impactStrength * 0.72, impactStrength, 120);
        this.ui.flashImpact(this.lateral < 0 ? "LEFT" : "RIGHT");
        if (this.diagnosticsMode) {
          this.diagnosticImpacts += 1;
          this.diagnosticImpactLocations.push(
            `${this.course.sectorLabelAt(this.progress)}@${Math.round(
              this.progress * this.course.length,
            )}m`,
          );
        }
      }
      this.speed = Math.max(0, this.speed - delta * (edgeType === "B" ? 22 : 12));
    }
    this.edgeContact = beyondRoad
      || (wasEdgeContact && Math.abs(this.lateral) > roadLimit - 0.12);
    if (this.diagnosticsMode) {
      if (this.edgeContact) this.diagnosticEdgeSeconds += delta;
      this.diagnosticMaxLateralRatio = Math.max(
        this.diagnosticMaxLateralRatio,
        Math.abs(this.lateral) / afterMove.halfWidth,
      );
    }
    if (this.offCourseTime >= this.course.recoveryHoldSeconds) {
      this.recoverVehicle();
      return;
    }
    this.alignDirectionToSurface(this.forward, afterMove.up, afterMove.tangent);
    this.alignDirectionToSurface(
      this.travelDirection,
      afterMove.up,
      this.forward,
    );

    const wasWrongWayActive = this.wrongWayActive;
    this.courseAlignment = this.travelDirection.dot(afterMove.tangent);
    this.wrongWayEvidence = integrateWrongWayEvidence(
      this.wrongWayEvidence,
      this.courseAlignment,
      this.speed,
      delta,
    );
    this.wrongWayActive = resolveWrongWayActive(
      wasWrongWayActive,
      this.wrongWayEvidence,
    );
    if (this.wrongWayActive && !wasWrongWayActive) {
      this.input.pulse(0.12, 0.32, 120);
      if (this.diagnosticsMode) this.diagnosticWrongWayEntries += 1;
    }
    if (this.diagnosticsMode && this.wrongWayActive) {
      this.diagnosticWrongWaySeconds += delta;
    }

    this.elapsedMs += delta * 1000;
    this.updateCheckpointProgress(previousProgress, afterMove.tangent);
  }

  private updateCoast(delta: number): void {
    const previousSpeed = this.speed;
    this.speed = integrateCoastSpeed(this.speed, delta);
    this.position.addScaledVector(this.travelDirection, this.speed * delta);
    const projection = this.course.project(
      this.position,
      this.progress,
      this.afterMoveProjection,
    );
    this.progress = projection.progress;
    this.lateral = THREE.MathUtils.clamp(
      projection.lateral,
      -projection.halfWidth + 2.05,
      projection.halfWidth - 2.05,
    );
    this.position.copy(projection.position).addScaledVector(projection.right, this.lateral);
    this.boostActive = false;
    if (previousSpeed > 0 && this.speed === 0) this.nextDiagnosticsAt = 0;
  }

  private updateCheckpointProgress(
    previousProgress: number,
    courseTangent: THREE.Vector3,
  ): void {
    const targetProgress = this.course.checkpointProgress(this.nextCheckpointIndex);
    if (
      this.travelDirection.dot(courseTangent) < 0.2
      || !crossedForwardProgress(previousProgress, this.progress, targetProgress)
    ) return;
    if (
      Math.abs(this.lateral)
      > this.course.checkpointHalfWidth(this.nextCheckpointIndex)
    ) {
      if (this.missedGateIndex !== this.nextCheckpointIndex) {
        this.missedGateIndex = this.nextCheckpointIndex;
        if (this.diagnosticsMode) this.diagnosticMissedGates += 1;
        this.ui.flashMissedGate(this.nextCheckpointIndex);
        this.audio.playMissedGate();
        this.input.pulse(0.44, 0.18, 170);
      }
      return;
    }

    this.missedGateIndex = null;

    if (this.nextCheckpointIndex === 0) {
      const completedLapMs = Math.max(0, this.elapsedMs - this.lapStartElapsedMs);
      this.lastLapMs = completedLapMs;
      this.bestLapMs = Math.min(this.bestLapMs ?? completedLapMs, completedLapMs);
      this.lapTimesMs.push(completedLapMs);
      this.lapStartElapsedMs = this.elapsedMs;
      this.lap += 1;
      if (this.lap > this.totalLaps) {
        this.finishRace();
        return;
      }
      this.audio.playLap();
      if (this.lap === this.totalLaps) this.audio.playFinalLap();
      this.input.pulse(0.12, 0.3, 110);
      this.ui.flashLap(
        this.lap,
        this.totalLaps,
        completedLapMs,
        this.bestLapMs ?? completedLapMs,
      );
      this.nextCheckpointIndex = 1;
      this.course.setLapBoard(this.lap, this.totalLaps);
      this.course.setCheckpointProgress(1);
      return;
    }

    const clearedCheckpoint = this.nextCheckpointIndex;
    this.nextCheckpointIndex = this.nextCheckpointIndex < this.course.checkpointCount
      ? this.nextCheckpointIndex + 1
      : 0;
    this.course.setCheckpointProgress(this.nextCheckpointIndex);
    this.ui.flashGate(clearedCheckpoint);
    this.audio.playGate(clearedCheckpoint);
    this.input.pulse(0.08, 0.22, 70);
  }

  private recoverVehicle(): void {
    if (this.phase === "countdown") {
      this.resetRaceState();
      this.snapCamera();
      return;
    }
    const automaticRecovery = this.offCourseTime >= this.course.recoveryHoldSeconds;
    if (this.diagnosticsMode && this.phase === "running") {
      this.diagnosticRecoveries += 1;
      this.diagnosticRecoveryLocations.push(
        `${this.course.sectorLabelAt(this.progress)}@${Math.round(
          this.progress * this.course.length,
        )}m`,
      );
    }
    const previousCheckpoint = this.nextCheckpointIndex === 0
      ? this.course.checkpointCount
      : Math.max(0, this.nextCheckpointIndex - 1);
    this.progress = this.course.recoveryProgressFor(
      this.progress,
      previousCheckpoint,
    );
    const recovery = this.course.sample(this.progress, this.poseProjection);
    this.position.copy(recovery.position);
    this.forward.copy(recovery.tangent);
    this.travelDirection.copy(recovery.tangent);
    this.lateral = 0;
    this.missedGateIndex = null;
    this.steerAmount = 0;
    this.speed = this.course.recoverySpeedMps;
    this.boostActive = false;
    this.padBoostTime = 0;
    this.wrongWayEvidence = 0;
    this.wrongWayActive = false;
    this.courseAlignment = 1;
    this.edgeContact = false;
    this.offCourseTime = 0;
    this.recoveryImmunity = this.course.recoveryImmunitySeconds;
    this.hazardTripCooldown = 0.6;
    this.impactShake = 0.25;
    this.driftActive = false;
    this.surfaceGrip = 1;
    this.input.pulse(0.42, 0.64, 180);
    this.audio.playRecovery();
    this.ui.flashHazard(
      automaticRecovery ? "COURSE LINK RESTORED" : "MANUAL RECOVERY",
      1_100,
    );
    this.syncPresentationPose();
    this.updatePose({ throttle: 0, brake: 0, steer: 0, boost: false }, 0);
    this.snapCamera();
  }

  private updatePose(input: InputFrame, delta: number): CourseProjection {
    const sample = this.course.project(
      this.presentationPosition,
      this.progress,
      this.poseProjection,
    );
    if (this.diagnosticsMode) this.diagnosticPresentationProjectionQueries += 1;
    const speedRatio = this.speed / BOOST_MAX_SPEED;
    const vehiclePosition = this.scratchA
      .copy(this.presentationPosition)
      .addScaledVector(
        sample.up,
        this.course.vehicleHoverHeight(this.speed, this.boostActive),
      );
    const vehicleRight = this.scratchB
      .crossVectors(this.presentationForward, sample.up)
      .normalize();
    const vehicleUp = this.scratchC
      .crossVectors(vehicleRight, this.presentationForward)
      .normalize();

    this.poseMatrix.makeBasis(
      vehicleRight,
      vehicleUp,
      this.scratchD.copy(this.presentationForward).multiplyScalar(-1),
    );
    this.poseQuaternion.setFromRotationMatrix(this.poseMatrix);
    this.vehicle.setPose(vehiclePosition, this.poseQuaternion);
    const slip = THREE.MathUtils.clamp(
      this.presentationTravelDirection.dot(vehicleRight) * speedRatio * 2.4,
      -1,
      1,
    );
    this.vehicleVisualState.steer = this.steerAmount;
    this.vehicleVisualState.throttle = input.throttle;
    this.vehicleVisualState.brake = input.brake;
    this.vehicleVisualState.speedRatio = speedRatio;
    this.vehicleVisualState.boostActive = this.boostActive;
    this.vehicleVisualState.driftIntensity = this.driftIntensity;
    this.vehicleVisualState.lateralLoad = this.steerAmount * 0.45 - slip;
    this.vehicleVisualState.surfaceGrip = this.surfaceGrip;
    this.vehicleVisualState.reducedMotion = this.reducedMotion;
    this.vehicleVisualState.elapsed = this.timer.getElapsed();
    this.vehicleVisualState.delta = delta;
    this.vehicle.updateVisual(this.vehicleVisualState);

    if (delta > 0) this.impactShake = Math.max(0, this.impactShake - delta * 3.6);
    return sample;
  }

  private updateCamera(
    delta: number,
    steer: number,
    brake: number,
    sample: CourseProjection,
  ): void {
    const vehicleRight = this.scratchA
      .crossVectors(this.presentationForward, sample.up)
      .normalize();
    const fallback = this.scratchB
      .copy(this.vehicle.root.position)
      .addScaledVector(this.presentationForward, -5)
      .addScaledVector(sample.up, 2.2);
    const anchor = this.vehicle.worldPosition("CAMERA_chase_target", fallback, this.scratchC);
    const bitterpan = this.course.kind === "bitterpan";
    const desired = anchor
      .addScaledVector(this.presentationForward, bitterpan ? -4.2 : -2.7)
      .addScaledVector(sample.up, bitterpan ? 1.8 : 1.25)
      .addScaledVector(
        vehicleRight,
        -steer * (0.45 + this.driftIntensity * 0.55),
      );
    const target = this.scratchD
      .copy(this.vehicle.root.position)
      .addScaledVector(this.presentationForward, 8 + this.speed * 0.075)
      .addScaledVector(this.presentationTravelDirection, this.speed * 0.025)
      .addScaledVector(sample.up, 0.8)
      .addScaledVector(vehicleRight, steer * this.driftIntensity * 0.6);

    if (bitterpan) {
      const lookAheadDistance = 42 + this.speed * 0.42;
      const routeLook = this.course.sample(
        sample.progress + lookAheadDistance / this.course.length,
        this.cameraLookAhead,
      );
      target.lerp(
        routeLook.position.addScaledVector(routeLook.up, 1.35),
        0.58,
      );
    }

    const cameraSurface = this.course.project(
      desired,
      sample.progress,
      this.cameraSurfaceProjection,
    );
    const cameraClearance = this.scratchA.copy(desired)
      .sub(cameraSurface.position)
      .dot(cameraSurface.up);
    if (cameraClearance < 2.1) {
      desired.addScaledVector(cameraSurface.up, 2.1 - cameraClearance);
    }

    const speedRatio = this.speed / BOOST_MAX_SPEED;
    const positionDamping = 1 - Math.exp(-delta * (12 + speedRatio * 8));
    const lookDamping = 1 - Math.exp(-delta * (11 + speedRatio * 5));
    this.cameraTarget.lerp(desired, positionDamping);
    this.cameraLook.lerp(target, lookDamping);
    this.camera.position.copy(this.cameraTarget);
    const desiredCameraUp = this.scratchB.copy(sample.up);
    if (!this.reducedMotion) {
      desiredCameraUp.applyAxisAngle(
        this.presentationForward,
        -steer * (0.035 + this.driftIntensity * 0.045),
      );
    }
    this.camera.up.lerp(
      desiredCameraUp,
      1 - Math.exp(-delta * (this.reducedMotion ? 4 : 7)),
    ).normalize();

    if (this.impactShake > 0 && !this.reducedMotion) {
      const elapsed = this.timer.getElapsed();
      this.camera.position
        .addScaledVector(
          vehicleRight,
          calculateImpactShakeOffset(elapsed, this.impactShake, "lateral"),
        )
        .addScaledVector(
          sample.up,
          calculateImpactShakeOffset(elapsed, this.impactShake, "vertical"),
        );
    }

    this.camera.lookAt(this.cameraLook);
    const desiredFov = calculateDesiredCameraFov(
      this.speed / BOOST_MAX_SPEED,
      this.boostActive,
      this.driftIntensity,
      brake,
      this.reducedMotion,
    );
    const nextFov = integrateCameraFov(
      this.camera.fov,
      desiredFov,
      delta,
    );
    if (Math.abs(nextFov - this.camera.fov) > 0.001) {
      this.camera.fov = nextFov;
      this.camera.updateProjectionMatrix();
    }
    if (this.diagnosticsMode) {
      const freeCameraFov = calculateDesiredCameraFov(
        this.speed / BOOST_MAX_SPEED,
        this.boostActive,
        this.driftIntensity,
        0,
        this.reducedMotion,
      );
      this.diagnosticMinimumCameraFov = Math.min(
        this.diagnosticMinimumCameraFov,
        this.camera.fov,
      );
      this.diagnosticMaximumCameraFov = Math.max(
        this.diagnosticMaximumCameraFov,
        this.camera.fov,
      );
      this.diagnosticMaximumBrakeFovCompression = Math.max(
        this.diagnosticMaximumBrakeFovCompression,
        freeCameraFov - desiredFov,
      );
    }
  }

  private snapCamera(): void {
    const sample = this.course.project(
      this.presentationPosition,
      this.progress,
      this.cameraProjection,
    );
    this.cameraTarget
      .copy(this.vehicle.root.position)
      .addScaledVector(
        this.presentationForward,
        this.course.kind === "bitterpan" ? -10.5 : -9,
      )
      .addScaledVector(sample.up, this.course.kind === "bitterpan" ? 4.6 : 4);
    this.cameraLook
      .copy(this.vehicle.root.position)
      .addScaledVector(this.presentationForward, 10)
      .addScaledVector(sample.up, 0.8);
    this.camera.position.copy(this.cameraTarget);
    this.camera.lookAt(this.cameraLook);
  }

  private updateSpeedLines(delta: number): void {
    const geometry = this.speedLines.geometry;
    const position = geometry.getAttribute("position") as THREE.BufferAttribute;
    const values = position.array as Float32Array;
    const speedRatio = this.speed / BOOST_MAX_SPEED;
    const material = this.speedLines.material as THREE.LineBasicMaterial;
    material.color.lerpColors(
      SPEED_LINE_COLOR,
      BOOST_LINE_COLOR,
      this.boostActive ? 1 : 0,
    );
    material.opacity = calculateSpeedStreakOpacity(
      speedRatio,
      this.driftIntensity,
      this.reducedMotion,
    );
    this.speedLines.visible = material.opacity > 0.005;
    const speedLineRoll = this.reducedMotion
      ? 0
      : -this.steerAmount * this.driftIntensity * 0.12;
    this.speedLines.rotation.z = THREE.MathUtils.lerp(
      this.speedLines.rotation.z,
      speedLineRoll,
      1 - Math.exp(-delta * 7.2),
    );
    if (!this.speedLines.visible) return;

    const streakLength = calculateSpeedStreakLength(
      speedRatio,
      this.boostActive,
      this.reducedMotion,
    );
    const travel = delta * (10 + this.speed * 0.85);
    for (let offset = 0; offset < values.length; offset += 6) {
      let z = values[offset + 2] + travel;
      if (z > -1.5) z -= 80;
      values[offset + 2] = z;
      values[offset + 5] = z - streakLength;
    }
    position.needsUpdate = true;
  }

  private updateHud(input: InputFrame): void {
    const checkpoint = this.nextCheckpointIndex === 0
      ? this.course.checkpointCount
      : this.nextCheckpointIndex;
    const turnLookAheadMeters = THREE.MathUtils.clamp(this.speed * 3.4, 260, 380);
    let turnCue = this.phase === "running"
      ? this.course.turnAhead(this.progress, turnLookAheadMeters, this.hudTurnCue)
      : null;
    const finishDistanceMeters = this.phase === "finished"
      ? 0
      : calculateFinishDistanceMeters(
        this.progress,
        this.lap,
        this.totalLaps,
        this.course.length,
        this.nextCheckpointIndex === 0
          ? null
          : this.course.checkpointProgress(this.nextCheckpointIndex),
      );
    const finalFinishArmed = this.nextCheckpointIndex === 0
      && this.lap === this.totalLaps;
    if (turnCue && isTurnCueBeyondFinish(
      turnCue.distance,
      finishDistanceMeters,
      finalFinishArmed,
    )) {
      turnCue = null;
    }
    const recovery = calculateRecoveryTelemetry(
      this.offCourseTime,
      this.course.recoveryHoldSeconds,
    );
    this.ui.update({
      speedKph: this.speed * 3.6,
      boost: this.boostReserve,
      elapsedMs: this.elapsedMs,
      lastLapMs: this.lastLapMs,
      lap: this.lap,
      totalLaps: this.totalLaps,
      progress: (
        (this.lap - 1) + this.raceProgressFromStart(this.progress)
      ) / this.totalLaps,
      checkpoint,
      checkpointCount: this.course.checkpointCount,
      missedGate: this.missedGateIndex,
      finishArmed: this.nextCheckpointIndex === 0,
      raceActive: this.phase === "running",
      sector: this.course.sectorLabelAt(this.progress),
      finishDistanceMeters,
      turnDirection: turnCue?.direction ?? null,
      turnFollowingDirection: turnCue?.followingDirection ?? null,
      turnDistanceMeters: turnCue?.distance ?? 0,
      turnHard: turnCue?.hard ?? false,
      turnUrgent: turnCue
        ? isTurnCueUrgent(turnCue.distance, this.speed, turnCue.hard)
        : false,
      boostActive: this.boostActive,
      boostLocked: this.boostLockedUntilRelease,
      braking: input.brake > 0.1,
      drifting: this.driftActive,
      skidsDown: this.speed < 11,
      lowGrip: this.surfaceGrip < 0.95,
      wrongWay: this.wrongWayActive,
      edgeWarning: this.edgeContact || this.openEdgeWarning,
      edgeOpen: this.openEdgeWarning,
      edgeCorrection: this.edgeContact || this.openEdgeWarning
        ? this.lateral > 0 ? "LEFT" : "RIGHT"
        : null,
      recoveryActive: recovery.active,
      recoveryProgress: recovery.progress,
      recoverySeconds: recovery.remainingSeconds,
      position: this.raceStatus.position,
      racerCount: this.raceStatus.racerCount,
      gapToAheadMs: this.raceStatus.gapToAheadMs,
      gapToBehindMs: this.raceStatus.gapToBehindMs,
    });
  }

  private finishRace(): void {
    this.phase = "finished";
    this.nextDiagnosticsAt = 0;
    this.boostActive = false;
    const standings = this.rivalFleet?.classification(this.elapsedMs / 1000) ?? [];
    this.finalStandings = standings;
    const playerStanding = standings.find((standing) => standing.player);
    if (playerStanding) {
      this.raceStatus = {
        ...this.raceStatus,
        position: playerStanding.position,
        racerCount: standings.length,
      };
    }
    this.audio.playClassification();
    this.audio.playFinish();
    this.input.pulse(0.3, 0.52, 260);
    this.ui.showResult(
      this.elapsedMs,
      this.totalLaps,
      this.bestLapMs ?? this.elapsedMs,
      this.lapTimesMs,
      this.raceStatus.position,
      this.raceStatus.racerCount,
      standings,
    );
  }

  private playerRaceDistance(): number {
    const raceProgress = this.raceProgressFromStart(this.progress);
    const nextCheckpointProgress = this.nextCheckpointIndex === 0
      ? null
      : this.raceProgressFromStart(
        this.course.checkpointProgress(this.nextCheckpointIndex),
      );
    return calculatePlayerRaceDistance({
      progress: raceProgress,
      lap: this.lap,
      totalLaps: this.totalLaps,
      courseLengthMeters: this.course.length,
      nextCheckpointProgress,
      finished: this.phase === "finished",
    });
  }

  private raceProgressFromStart(progress: number): number {
    return THREE.MathUtils.euclideanModulo(
      progress - this.course.startProgress,
      1,
    );
  }

  private refreshRaceStatus(announceChange: boolean): void {
    if (!this.rivalFleet) return;
    const nextStatus = this.rivalFleet.raceStatus(
      this.playerRaceDistance(),
      this.speed,
      this.phase === "finished",
      this.phase === "finished" ? this.elapsedMs / 1000 : null,
    );
    if (
      announceChange
      && nextStatus.position !== this.lastPositionCue
      && this.elapsedMs - this.lastPositionCueAtMs >= 420
    ) {
      const gained = nextStatus.position < this.lastPositionCue;
      this.audio.playPositionChange(gained);
      this.ui.flashHazard(
        `${gained ? "POSITION GAINED" : "POSITION LOST"} · P${nextStatus.position}`,
        850,
      );
      this.ui.announcePosition(nextStatus.position, gained);
      this.diagnosticPositionChanges += 1;
      if (gained) this.diagnosticPositionsGained += 1;
      else this.diagnosticPositionsLost += 1;
      this.lastPositionCueAtMs = this.elapsedMs;
    }
    this.lastPositionCue = nextStatus.position;
    this.raceStatus = nextStatus;
  }

  private resetRaceState(): void {
    this.progress = this.recoveryProbe
      ? RECOVERY_PROBE_DISTANCE_METERS / this.course.length
      : this.wrongWayProbe
        ? WRONG_WAY_PROBE_DISTANCE_METERS / this.course.length
        : this.waterGripProbe
          ? WATER_GRIP_PROBE_DISTANCE_METERS / this.course.length
          : this.course.startProgress;
    this.speed = 0;
    this.lateral = this.recoveryProbe || this.wrongWayProbe
      || this.impactProbe || this.waterGripProbe
      ? 0
      : this.course.startLateral;
    this.steerAmount = 0;
    this.nextCheckpointIndex = 1;
    this.missedGateIndex = null;
    this.boostReserve = 1;
    this.boostActive = false;
    this.boostLockedUntilRelease = false;
    this.driftActive = false;
    this.driftIntensity = 0;
    this.surfaceGrip = 1;
    this.padBoostTime = 0;
    this.demoInput.throttle = 1;
    this.demoInput.brake = 0;
    this.demoInput.steer = 0;
    this.demoInput.boost = false;
    this.lap = 1;
    this.elapsedMs = 0;
    this.lapStartElapsedMs = 0;
    this.lastLapMs = null;
    this.bestLapMs = null;
    this.lapTimesMs.length = 0;
    this.rivalFleet?.reset();
    this.raceStatus = this.rivalFleet?.raceStatus(
      calculatePlayerRaceDistance({
        progress: this.raceProgressFromStart(this.progress),
        lap: 1,
        totalLaps: this.totalLaps,
        courseLengthMeters: this.course.length,
      }),
      0,
    ) ?? {
      position: 1,
      racerCount: 4,
      gapToAheadMs: null,
      gapToBehindMs: null,
    };
    this.lastPositionCue = this.raceStatus.position;
    this.lastPositionCueAtMs = -Infinity;
    this.finalStandings = [];
    this.edgeContact = false;
    this.offCourseTime = 0;
    this.recoveryImmunity = 0;
    this.hazardTripCooldown = 0;
    this.openEdgeWarning = false;
    this.wrongWayEvidence = 0;
    this.wrongWayActive = false;
    this.courseAlignment = 1;
    this.impactShake = 0;
    this.physicsAccumulator = 0;
    this.resumeCountdown = 0;
    this.pausedBeforeStart = false;
    this.nextHudAt = 0;
    this.nextFieldOrderAt = 0;
    this.resetImpactSparks();
    const start = this.course.sample(this.progress, this.poseProjection);
    this.position.copy(start.position).addScaledVector(start.right, this.lateral);
    if (this.recoveryProbe) {
      this.lateral = start.halfWidth + 1;
      this.position.addScaledVector(start.right, this.lateral);
    }
    this.forward.copy(start.tangent);
    this.travelDirection.copy(start.tangent);
    if (this.wrongWayProbe) {
      this.forward.multiplyScalar(-1);
      this.travelDirection.multiplyScalar(-1);
      this.speed = 22;
      this.courseAlignment = -1;
    }
    if (this.impactProbe) {
      this.lateral = start.halfWidth - 1;
      this.position.copy(start.position).addScaledVector(start.right, this.lateral);
      this.speed = 22;
    }
    if (this.waterGripProbe) {
      this.lateral = -start.halfWidth * 0.65;
      this.position.copy(start.position).addScaledVector(start.right, this.lateral);
      this.speed = 10;
    }
    this.syncPresentationPose();
    this.course.setLapBoard(1, this.totalLaps);
    this.course.setCheckpointProgress(1);
  }

  private installLighting(): void {
    const lighting = this.course.lightingAt(this.progress);
    this.hemisphereLight.color.copy(lighting.sky);
    this.hemisphereLight.groundColor.copy(lighting.ground);
    this.hemisphereLight.intensity = lighting.hemisphereIntensity * HEMISPHERE_TRIM;
    this.keyLight.color.copy(lighting.key);
    this.keyLight.intensity = lighting.keyIntensity;
    this.keyLight.position.set(80, 130, -35);
    this.rimLight.color.copy(lighting.rim);
    this.rimLight.intensity = lighting.rimIntensity * RIM_PRESENCE_BOOST;
    this.rimLight.position.set(-100, 25, -80);
    this.scene.add(this.hemisphereLight, this.keyLight, this.rimLight);
  }

  /**
   * Graded sky dome + horizon accent band. The horizon matches the sector fog
   * colour so geometry melts into it, while the zenith drops toward a cool
   * near-black and a restrained sector-accent band glows at the horizon line.
   */
  private createSkyBackdrop(): THREE.Mesh {
    const radius = this.camera.far * 0.8;
    const geometry = new THREE.SphereGeometry(radius, 24, 12);
    const material = new THREE.ShaderMaterial({
      uniforms: this.skyUniforms,
      side: THREE.BackSide,
      depthWrite: false,
      vertexShader: `
        varying vec3 vDirection;
        void main() {
          vDirection = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 topColor;
        uniform vec3 horizonColor;
        uniform vec3 bandColor;
        varying vec3 vDirection;
        void main() {
          float h = normalize(vDirection).y;
          vec3 color = mix(horizonColor, topColor, smoothstep(0.0, 0.42, h));
          color = mix(color * 0.82, color, smoothstep(-0.12, 0.0, h));
          float band = exp(-pow((h - 0.035) * 16.0, 2.0));
          color += bandColor * band * 0.38;
          gl_FragColor = vec4(color, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    });
    const dome = new THREE.Mesh(geometry, material);
    dome.name = "sky_backdrop";
    dome.frustumCulled = false;
    dome.renderOrder = -1000;
    return dome;
  }

  /** Small additive key-light disc that anchors the sky composition. */
  private createSunDisc(): THREE.Mesh {
    const geometry = new THREE.CircleGeometry(this.camera.far * 0.055, 20);
    const material = new THREE.MeshBasicMaterial({
      color: this.keyLight.color.clone(),
      transparent: true,
      opacity: 0.5,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    });
    const disc = new THREE.Mesh(geometry, material);
    disc.name = "sun_disc";
    disc.renderOrder = -999;
    return disc;
  }

  private createSpeedLines(): THREE.LineSegments {
    const count = 96;
    const positions = new Float32Array(count * 6);
    for (let index = 0; index < count; index += 1) {
      const offset = index * 6;
      const x = ((index * 0.61803398875) % 1 - 0.5) * 22;
      const y = ((index * 0.41421356237) % 1 - 0.5) * 12;
      const z = -3 - ((index * 0.75487766625) % 1) * 78;
      positions[offset] = x;
      positions[offset + 1] = y;
      positions[offset + 2] = z;
      positions[offset + 3] = x;
      positions[offset + 4] = y;
      positions[offset + 5] = z - 1;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const material = new THREE.LineBasicMaterial({
      color: 0xc5f4ff,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const lines = new THREE.LineSegments(geometry, material);
    lines.frustumCulled = false;
    lines.visible = false;
    return lines;
  }

  private createImpactSparks(): THREE.Points {
    for (let index = 0; index < this.impactSparkLife.length; index += 1) {
      this.impactSparkPositions[index * 3 + 1] = -10_000;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.BufferAttribute(this.impactSparkPositions, 3),
    );
    const material = new THREE.PointsMaterial({
      color: 0xffa22e,
      size: 0.16,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const sparks = new THREE.Points(geometry, material);
    sparks.name = "totem_impact_sparks";
    sparks.frustumCulled = false;
    sparks.visible = false;
    return sparks;
  }

  private emitImpactSparks(
    sample: ReturnType<RaceCourse["sample"]>,
    side: number,
    strength: number,
  ): void {
    const count = this.reducedMotion ? 5 : 14;
    for (let emitted = 0; emitted < count; emitted += 1) {
      const particle = this.impactSparkCursor;
      this.impactSparkCursor = (this.impactSparkCursor + 1) % this.impactSparkLife.length;
      const offset = particle * 3;
      const spread = Math.random() - 0.5;
      this.impactSparkPositions[offset] = this.position.x
        + sample.right.x * side * 1.7
        + sample.up.x * 0.35;
      this.impactSparkPositions[offset + 1] = this.position.y
        + sample.right.y * side * 1.7
        + sample.up.y * 0.35;
      this.impactSparkPositions[offset + 2] = this.position.z
        + sample.right.z * side * 1.7
        + sample.up.z * 0.35;
      const outwardSpeed = -(2.5 + Math.random() * 4.5) * side;
      const liftSpeed = 2 + Math.random() * 5;
      const trailSpeed = -2 - Math.random() * (4 + this.speed * 0.05);
      this.impactSparkVelocities[offset] = sample.right.x * outwardSpeed
        + sample.up.x * liftSpeed
        + sample.tangent.x * trailSpeed
        + spread;
      this.impactSparkVelocities[offset + 1] = sample.right.y * outwardSpeed
        + sample.up.y * liftSpeed
        + sample.tangent.y * trailSpeed
        + spread;
      this.impactSparkVelocities[offset + 2] = sample.right.z * outwardSpeed
        + sample.up.z * liftSpeed
        + sample.tangent.z * trailSpeed
        + spread;
      this.impactSparkLife[particle] = (0.22 + Math.random() * 0.28) * strength;
    }
    this.impactSparks.visible = true;
    this.vehicle.triggerImpactEffect(side, strength);
    if (this.diagnosticsMode) this.diagnosticImpactSparkBursts += 1;
    const position = this.impactSparks.geometry.getAttribute("position");
    position.needsUpdate = true;
  }

  private updateImpactSparks(delta: number): void {
    if (!this.impactSparks.visible) return;
    let changed = false;
    let active = false;
    for (let particle = 0; particle < this.impactSparkLife.length; particle += 1) {
      if (this.impactSparkLife[particle] <= 0) continue;
      const offset = particle * 3;
      this.impactSparkLife[particle] = Math.max(
        0,
        this.impactSparkLife[particle] - delta,
      );
      if (this.impactSparkLife[particle] === 0) {
        this.impactSparkPositions[offset + 1] = -10_000;
      } else {
        active = true;
        this.impactSparkPositions[offset] += this.impactSparkVelocities[offset] * delta;
        this.impactSparkPositions[offset + 1] += this.impactSparkVelocities[offset + 1] * delta;
        this.impactSparkPositions[offset + 2] += this.impactSparkVelocities[offset + 2] * delta;
        this.impactSparkVelocities[offset + 1] -= 6.5 * delta;
      }
      changed = true;
    }
    this.impactSparks.visible = active;
    if (changed) {
      this.impactSparks.geometry.getAttribute("position").needsUpdate = true;
    }
  }

  private resetImpactSparks(): void {
    this.vehicle.resetEffects();
    this.impactSparkCursor = 0;
    this.impactSparkLife.fill(0);
    this.impactSparkVelocities.fill(0);
    for (let particle = 0; particle < this.impactSparkLife.length; particle += 1) {
      const offset = particle * 3;
      this.impactSparkPositions[offset] = 0;
      this.impactSparkPositions[offset + 1] = -10_000;
      this.impactSparkPositions[offset + 2] = 0;
    }
    this.impactSparks.visible = false;
    this.impactSparks.geometry.getAttribute("position").needsUpdate = true;
  }

  private async loadAuthoredEnvironment(): Promise<void> {
    const environmentLoadStartedAt = performance.now();
    try {
      if (this.course.kind === "bitterpan") {
        const { BitterpanEnvironment } = await import("./bitterpan-environment");
        const environment = await BitterpanEnvironment.load(
          BITTERPAN_TRACK_MODEL_URL,
          BITTERPAN_MASSING_MODEL_URL,
        );
        this.diagnosticEnvironmentLoadMs = performance.now() - environmentLoadStartedAt;
        if (this.disposed) {
          disposeObject3DResources(environment.root);
          return;
        }
        this.authoredEnvironment = environment;
        this.scene.add(environment.root);
        this.diagnosticEnvironmentReady = true;
        this.renderRequested = true;
        return;
      }

      const {
        GreenwaterEnvironment: GreenwaterEnvironmentRuntime,
        setProceduralEnvironmentVisible,
      } = await import("./environment");
      const environment = await GreenwaterEnvironmentRuntime.load(
        ENVIRONMENT_MODEL_URL,
        this.course,
      );
      this.diagnosticEnvironmentLoadMs = performance.now() - environmentLoadStartedAt;
      if (this.disposed) {
        disposeObject3DResources(environment.root);
        return;
      }
      this.authoredEnvironment = environment;
      setProceduralEnvironmentVisible(this.course.group, false);
      environment.updateVisibility(this.camera);
      this.scene.add(environment.root);
      this.diagnosticEnvironmentReady = true;
      this.renderRequested = true;
      await Promise.all([
        this.loadLivingWorld(environment),
        this.loadSurfaceCharacter(),
      ]);
    } catch (error) {
      this.diagnosticEnvironmentError = error instanceof Error
        ? error.message
        : `Unknown ${this.course.mapName} environment load error`;
      if (this.course.kind === "bitterpan") {
        console.error("Bitterpan accepted blockout environment failed to load.", error);
        throw error;
      }
      console.warn("Greenwater authored environment failed to load; using Phase 1 fallback.", error);
      // The accepted Phase 1 prop dressing remains a recoverable visual fallback.
      await this.loadAssetKit();
    } finally {
      this.diagnosticEnvironmentLoadMs ??= performance.now() - environmentLoadStartedAt;
    }
  }

  private async loadLivingWorld(environment: GreenwaterEnvironment): Promise<void> {
    const loadStartedAt = performance.now();
    try {
      const { GreenwaterLivingWorld } = await import("./living-world");
      const livingWorld = await GreenwaterLivingWorld.load(
        this.course,
        environment.livingTextures,
        LIVING_WORLD_MOTION_URL,
      );
      if (this.disposed) {
        disposeObject3DResources(livingWorld.root);
        return;
      }
      this.livingWorld = livingWorld;
      this.scene.add(livingWorld.root);
      this.diagnosticLivingWorldReady = true;
      this.renderRequested = true;
    } catch (error) {
      this.diagnosticLivingWorldError = error instanceof Error
        ? error.message
        : "Unknown Greenwater living-world load error";
      console.warn("Greenwater living-world layer failed to load.", error);
    } finally {
      this.diagnosticLivingWorldLoadMs = performance.now() - loadStartedAt;
    }
  }

  private async loadSurfaceCharacter(): Promise<void> {
    const loadStartedAt = performance.now();
    try {
      const { GreenwaterSurfaceCharacter } = await import("./surface-character");
      const surfaceCharacter = await GreenwaterSurfaceCharacter.load(
        SURFACE_CHARACTER_MODEL_URL,
      );
      if (this.disposed) {
        disposeObject3DResources(surfaceCharacter.root);
        return;
      }
      this.surfaceCharacter = surfaceCharacter;
      this.scene.add(surfaceCharacter.root);
      this.diagnosticSurfaceCharacterReady = true;
      this.renderRequested = true;
    } catch (error) {
      this.diagnosticSurfaceCharacterError = error instanceof Error
        ? error.message
        : "Unknown Greenwater surface-character load error";
      console.warn("Greenwater surface-character layer failed to load.", error);
    } finally {
      this.diagnosticSurfaceCharacterLoadMs = performance.now() - loadStartedAt;
    }
  }

  private async loadAssetKit(): Promise<void> {
    const assetKitLoadStartedAt = performance.now();
    try {
      const gltf = await new GLTFLoader().loadAsync(
        ASSET_KIT_MODEL_URL,
      );
      if (this.disposed) {
        disposeObject3DResources(gltf.scene);
        return;
      }
      applyPs2MaterialTreatment(gltf.scene);
      const courseDressing = createAssetKitCourseDressing(gltf.scene, this.course);
      const dressingDisplay = mergeStaticSceneByMaterial(courseDressing);
      if (this.disposed) {
        disposeObject3DResources(dressingDisplay);
        return;
      }
      this.scene.add(dressingDisplay);
      const proceduralCables = this.course.group.getObjectByName("cable_trip_hazards");
      if (proceduralCables) proceduralCables.visible = false;
      this.diagnosticAssetKitReady = true;
      this.renderRequested = true;
    } catch {
      // Greenwater retains its procedural cable visuals if optional dressing fails.
    } finally {
      this.diagnosticAssetKitLoadMs = performance.now() - assetKitLoadStartedAt;
    }
  }

  private updateFog(delta: number): void {
    const fog = this.scene.fog;
    if (!(fog instanceof THREE.FogExp2)) return;
    const target = this.course.fogAt(this.progress);
    const response = 1 - Math.exp(-delta * 5.5);
    fog.density = THREE.MathUtils.lerp(fog.density, target.density, response);
    fog.color.lerp(target.color, response);
    if (this.scene.background instanceof THREE.Color) {
      this.scene.background.lerp(target.color, response);
    }
    const lighting = this.course.lightingAt(this.progress);
    const lightingResponse = 1 - Math.exp(-delta * 2.8);
    this.hemisphereLight.color.lerp(lighting.sky, lightingResponse);
    this.hemisphereLight.groundColor.lerp(lighting.ground, lightingResponse);
    this.hemisphereLight.intensity = THREE.MathUtils.lerp(
      this.hemisphereLight.intensity,
      lighting.hemisphereIntensity * HEMISPHERE_TRIM,
      lightingResponse,
    );
    this.keyLight.color.lerp(lighting.key, lightingResponse);
    this.keyLight.intensity = THREE.MathUtils.lerp(
      this.keyLight.intensity,
      lighting.keyIntensity,
      lightingResponse,
    );
    this.rimLight.color.lerp(lighting.rim, lightingResponse);
    this.rimLight.intensity = THREE.MathUtils.lerp(
      this.rimLight.intensity,
      lighting.rimIntensity * RIM_PRESENCE_BOOST,
      lightingResponse,
    );

    // Sky gradient follows the sector palette: the horizon stays glued to the
    // fog colour, the zenith drops cool and dark, and the accent band picks up
    // the sector rim hue so each sector gets a contrasting sky accent.
    this.skyTopTarget.copy(target.color).multiplyScalar(0.3).lerp(SKY_ZENITH_TINT, 0.45);
    this.skyBandTarget.copy(lighting.rim);
    this.skyUniforms.horizonColor.value.lerp(target.color, response);
    this.skyUniforms.topColor.value.lerp(this.skyTopTarget, response);
    this.skyUniforms.bandColor.value.lerp(this.skyBandTarget, response);
    this.skyDome.position.set(this.camera.position.x, 0, this.camera.position.z);
    const sunMaterial = this.sunDisc.material as THREE.MeshBasicMaterial;
    sunMaterial.color.lerp(lighting.key, lightingResponse);
    this.sunDisc.position
      .copy(this.camera.position)
      .addScaledVector(SUN_DIRECTION, this.camera.far * 0.72);
    this.sunDisc.lookAt(this.camera.position);

    // A restrained craft-following light lifts TOTEM off the bright deck and
    // pools a sector-tinted glow beneath it as a grounding cue.
    this.skyBandTarget.copy(lighting.rim).lerp(WHITE, 0.45);
    this.presenceLight.color.lerp(this.skyBandTarget, lightingResponse);
    this.presenceLight.intensity = THREE.MathUtils.lerp(
      this.presenceLight.intensity,
      14,
      lightingResponse,
    );
  }

  private resolveLapCount(): number {
    const requested = Number.parseInt(
      new URLSearchParams(window.location.search).get("laps") ?? "",
      10,
    );
    if (!Number.isFinite(requested)) return this.course.defaultLapCount;
    return THREE.MathUtils.clamp(
      requested,
      this.course.minimumLapCount,
      this.course.maximumLapCount,
    );
  }

  private togglePause(): void {
    if (
      this.phase === "countdown"
      || this.phase === "running"
      || this.phase === "resuming"
    ) {
      this.pauseRace();
      return;
    }
    if (this.phase === "paused") {
      if (this.pausedBeforeStart) {
        this.pausedBeforeStart = false;
        this.phase = "countdown";
        this.countdown = 3.7;
        this.countdownStage = "";
        this.physicsAccumulator = 0;
        this.audio.setPaused(false);
        this.ui.showRace();
        return;
      }
      this.phase = "resuming";
      this.resumeCountdown = RESUME_COUNTDOWN_SECONDS;
      this.countdownStage = "";
      this.physicsAccumulator = 0;
      this.audio.setPaused(false);
      this.ui.setResuming();
    }
  }

  private pauseRace(
    reason?: "FOCUS LOST" | "GRAPHICS LINK LOST",
  ): void {
    if (
      this.phase !== "countdown"
      && this.phase !== "running"
      && this.phase !== "resuming"
    ) return;
    this.pausedBeforeStart = this.phase === "countdown";
    this.phase = "paused";
    this.resumeCountdown = 0;
    this.countdownStage = "";
    this.physicsAccumulator = 0;
    this.audio.setPaused(true);
    this.ui.setPaused(true, reason);
    this.renderRequested = true;
  }

  private readonly handleVisibilityChange = (): void => {
    if (!document.hidden) return;
    this.input.suspendActionsUntilRelease();
    this.pauseRace("FOCUS LOST");
  };

  private readonly handleWindowBlur = (): void => {
    this.input.suspendActionsUntilRelease();
    this.pauseRace("FOCUS LOST");
  };

  private readonly handleContextLost = (event: Event): void => {
    if (this.disposed) return;
    event.preventDefault();
    if (this.contextLost) return;
    this.contextLost = true;
    this.input.suspendActionsUntilRelease();
    this.diagnosticContextLosses += 1;
    this.contextPausedRace = this.phase === "countdown"
      || this.phase === "running"
      || this.phase === "resuming";
    if (this.contextPausedRace) this.pauseRace("GRAPHICS LINK LOST");
    this.ui.setGraphicsContextLost(true);
  };

  private readonly handleContextRestored = (): void => {
    if (this.disposed || !this.contextLost) return;
    this.contextLost = false;
    this.diagnosticContextRestores += 1;
    this.renderer.resetState();
    this.resize();
    this.syncPresentationPose();
    this.updatePose(ZERO_INPUT, 0);
    this.snapCamera();
    this.ui.setGraphicsContextLost(false);
    if (this.contextPausedRace && this.phase === "paused") {
      this.ui.setPaused(true, "GRAPHICS LINK RESTORED");
    }
    this.contextPausedRace = false;
  };

  private updateContextLossProbe(): void {
    if (
      this.contextLossProbe
      && !this.contextLossProbeStarted
      && this.phase === "running"
      && this.elapsedMs >= 1_000
    ) {
      this.contextLossProbeStarted = true;
      this.contextRestoreAt = this.timer.getElapsed() + 0.75;
      this.renderer.forceContextLoss();
      return;
    }
    if (
      this.contextLost
      && this.contextRestoreAt > 0
      && this.timer.getElapsed() >= this.contextRestoreAt
    ) {
      this.contextRestoreAt = 0;
      this.renderer.forceContextRestore();
    }
  }

  private updateFocusLossProbe(): void {
    if (
      !this.focusLossProbe
      || this.focusLossProbeStarted
      || this.phase !== "running"
      || this.elapsedMs < 1_000
    ) return;

    this.focusLossProbeStarted = true;
    this.input.requestStart();
    this.handleWindowBlur();
    this.input.requestStart();
  }

  private reportDiagnostics(delta: number): void {
    if (!this.diagnosticsMode || this.diagnosticsFinalReported) return;
    const frameMs = delta * 1000;
    this.diagnosticFrameSamples[this.diagnosticFrameIndex] = frameMs;
    this.diagnosticFrameIndex = (
      this.diagnosticFrameIndex + 1
    ) % this.diagnosticFrameSamples.length;
    this.diagnosticFrameCount = Math.min(
      this.diagnosticFrameCount + 1,
      this.diagnosticFrameSamples.length,
    );
    this.diagnosticMaxFrameMs = Math.max(this.diagnosticMaxFrameMs, frameMs);
    this.smoothedFrameMs = THREE.MathUtils.lerp(
      this.smoothedFrameMs,
      frameMs,
      0.06,
    );
    const now = this.timer.getElapsed();
    if (now < this.nextDiagnosticsAt) return;
    this.nextDiagnosticsAt = now + 1;
    const render = this.renderer.info.render;
    const frameWindow = Array.from(
      this.diagnosticFrameSamples.subarray(0, this.diagnosticFrameCount),
    ).sort((a, b) => a - b);
    const p95FrameMs = frameWindow.length > 0
      ? frameWindow[Math.min(frameWindow.length - 1, Math.floor(frameWindow.length * 0.95))]
      : 0;
    const elapsedSeconds = this.elapsedMs / 1000;
    const audioDiagnostics = this.audio.diagnostics();
    const rivalDiagnostics = this.rivalFleet?.diagnostics();
    const memory = performance as Performance & {
      memory?: { usedJSHeapSize: number };
    };
    const heapMb = memory.memory
      ? memory.memory.usedJSHeapSize / (1024 * 1024)
      : null;
    if (heapMb !== null) {
      this.diagnosticMaxHeapMb = Math.max(this.diagnosticMaxHeapMb ?? heapMb, heapMb);
    }
    const report = {
      mapCode: this.course.mapCode,
      mapName: this.course.mapName,
      mapKind: this.course.kind,
      finalMap02NativeBlockoutFreeze: false,
      orderedCheckpointCount: this.course.orderedCheckpointCount,
      calls: render.calls,
      triangles: render.triangles,
      points: render.points,
      lines: render.lines,
      geometries: this.renderer.info.memory.geometries,
      textures: this.renderer.info.memory.textures,
      frameMs: Number(this.smoothedFrameMs.toFixed(2)),
      p95FrameMs: Number(p95FrameMs.toFixed(2)),
      maxFrameMs: Number(this.diagnosticMaxFrameMs.toFixed(2)),
      phase: this.phase,
      controlMode: this.demoAutopilot ? "autopilot" : "manual",
      sector: this.course.sectorLabelAt(this.progress),
      distanceMeters: Math.round(this.progress * this.course.length),
      speedKph: Number((this.speed * 3.6).toFixed(1)),
      lateralMeters: Number(this.lateral.toFixed(2)),
      steer: Number(this.steerAmount.toFixed(3)),
      drifting: this.driftActive,
      driftIntensity: Number(this.driftIntensity.toFixed(2)),
      surfaceGrip: Number(this.surfaceGrip.toFixed(2)),
      boostActive: this.boostActive,
      boostLocked: this.boostLockedUntilRelease,
      wrongWay: this.wrongWayActive,
      courseAlignment: Number(this.courseAlignment.toFixed(2)),
      nextCheckpoint: this.nextCheckpointIndex,
      raceSeed: 714,
      fieldSize: this.raceStatus.racerCount,
      playerPosition: this.raceStatus.position,
      positionChanges: this.diagnosticPositionChanges,
      positionsGained: this.diagnosticPositionsGained,
      positionsLost: this.diagnosticPositionsLost,
      finalClassification: this.finalStandings.map((standing) => ({
        position: standing.position,
        name: standing.name,
        player: standing.player,
        finishTimeMs: Math.round(standing.finishTimeMs),
        gapMs: Math.round(standing.gapMs),
      })),
      rivalDrawCalls: rivalDiagnostics?.drawCalls ?? 0,
      rivalTriangles: rivalDiagnostics?.triangles ?? 0,
      rivalUpdateSteps: rivalDiagnostics?.updateSteps ?? 0,
      rivalUpdateHz: elapsedSeconds > 0
        ? Number(((rivalDiagnostics?.updateSteps ?? 0) / elapsedSeconds).toFixed(1))
        : 0,
      rivalMinimumSeparationMeters: Number(
        (rivalDiagnostics?.minimumSeparationMeters ?? 0).toFixed(2),
      ),
      rivalCatchUpMultiplier: rivalDiagnostics?.catchUpMultiplier ?? 1,
      rivals: (rivalDiagnostics?.states ?? []).map((state) => ({
        ...state,
        raceDistanceMeters: Number(state.raceDistanceMeters.toFixed(2)),
        speedKph: Number(state.speedKph.toFixed(1)),
        lateralMeters: Number(state.lateralMeters.toFixed(2)),
        finishTimeMs: state.finishTimeMs === null
          ? null
          : Math.round(state.finishTimeMs),
      })),
      averageSpeedKph: elapsedSeconds > 0
        ? Number((this.diagnosticDistanceTravelled / elapsedSeconds * 3.6).toFixed(1))
        : 0,
      topSpeedKph: Number((this.diagnosticTopSpeed * 3.6).toFixed(1)),
      lapTimesMs: this.lapTimesMs.map((lapTime) => Math.round(lapTime)),
      boostSeconds: Number(this.diagnosticBoostSeconds.toFixed(2)),
      driftSeconds: Number(this.diagnosticDriftSeconds.toFixed(2)),
      driftEntries: this.diagnosticDriftEntries,
      maxDriftIntensity: Number(this.diagnosticMaxDriftIntensity.toFixed(2)),
      minimumSurfaceGrip: Number(this.diagnosticMinimumSurfaceGrip.toFixed(3)),
      edgeSeconds: Number(this.diagnosticEdgeSeconds.toFixed(2)),
      wrongWaySeconds: Number(this.diagnosticWrongWaySeconds.toFixed(2)),
      wrongWayEntries: this.diagnosticWrongWayEntries,
      minimumCameraFov: Number(this.diagnosticMinimumCameraFov.toFixed(2)),
      maximumCameraFov: Number(this.diagnosticMaximumCameraFov.toFixed(2)),
      maximumBrakeFovCompression: Number(
        this.diagnosticMaximumBrakeFovCompression.toFixed(2),
      ),
      impacts: this.diagnosticImpacts,
      impactSparkBursts: this.diagnosticImpactSparkBursts,
      missedGates: this.diagnosticMissedGates,
      impactLocations: this.diagnosticImpactLocations,
      recoveries: this.diagnosticRecoveries,
      contextLost: this.contextLost,
      contextLosses: this.diagnosticContextLosses,
      contextRestores: this.diagnosticContextRestores,
      renderedFrames: this.diagnosticRenderedFrames,
      idleFramesSkipped: this.diagnosticIdleFramesSkipped,
      presentationProjectionQueries: this.diagnosticPresentationProjectionQueries,
      atmosphereUpdates: this.diagnosticAtmosphereUpdates,
      atmosphereHz: elapsedSeconds > 0
        ? Number((this.diagnosticAtmosphereUpdates / elapsedSeconds).toFixed(1))
        : 0,
      recoveryLocations: this.diagnosticRecoveryLocations,
      maxLateralRatio: Number(this.diagnosticMaxLateralRatio.toFixed(2)),
      physicsSteps: this.diagnosticPhysicsSteps,
      audioContextState: audioDiagnostics.contextState,
      audioControlUpdates: audioDiagnostics.controlUpdates,
      audioControlHz: Number(audioDiagnostics.controlHz.toFixed(1)),
      audioControlTargetHz: audioDiagnostics.controlTargetHz,
      musicTransitions: audioDiagnostics.musicTransitions,
      musicProfileKey: audioDiagnostics.musicProfileKey,
      musicLoopBeats: audioDiagnostics.musicLoopBeats,
      musicLoopSeconds: Number(audioDiagnostics.musicLoopSeconds.toFixed(3)),
      musicSampleRate: audioDiagnostics.musicSampleRate,
      musicKey: audioDiagnostics.musicKey,
      maxMusicLowpassHz: Number(audioDiagnostics.maxMusicLowpassHz.toFixed(1)),
      maxMusicHighShelfDb: Number(audioDiagnostics.maxMusicHighShelfDb.toFixed(1)),
      activeAudioOneShots: audioDiagnostics.activeOneShots,
      peakAudioOneShots: audioDiagnostics.peakActiveOneShots,
      skippedAudioOneShots: audioDiagnostics.skippedOneShots,
      raceEventAudioCues: audioDiagnostics.raceEventCues,
      audioPreparationMs: Number(audioDiagnostics.musicPreparationMs.toFixed(1)),
      audioInitializationMs: Number(audioDiagnostics.initializationMs.toFixed(1)),
      startupReadyMs: Number(this.diagnosticStartupReadyMs.toFixed(1)),
      courseAssemblyMs: Number(this.diagnosticCourseAssemblyMs.toFixed(1)),
      vehicleLoadStartedMs: Number(this.diagnosticVehicleLoadStartedMs.toFixed(1)),
      vehicleLoadMs: Number(this.diagnosticVehicleLoadMs.toFixed(1)),
      vehicleRequestStartMs: this.diagnosticVehicleRequestStartMs === null
        ? null
        : Number(this.diagnosticVehicleRequestStartMs.toFixed(1)),
      vehicleResourceRequests: this.diagnosticVehicleResourceRequests,
      assetKitLoadMs: this.diagnosticAssetKitLoadMs === null
        ? null
        : Number(this.diagnosticAssetKitLoadMs.toFixed(1)),
      assetKitReady: this.diagnosticAssetKitReady,
      environmentLoadMs: this.diagnosticEnvironmentLoadMs === null
        ? null
        : Number(this.diagnosticEnvironmentLoadMs.toFixed(1)),
      environmentReady: this.diagnosticEnvironmentReady,
      environmentError: this.diagnosticEnvironmentError,
      environmentMeshes: this.authoredEnvironment?.stats.meshes ?? 0,
      environmentTriangles: this.authoredEnvironment?.stats.triangles ?? 0,
      environmentMaterials: this.authoredEnvironment?.stats.materials ?? 0,
      environmentTextures: this.authoredEnvironment?.stats.textures ?? 0,
      environmentVisibleGroups: this.authoredEnvironment?.stats.visibleGroups ?? 0,
      environmentVisibleTriangles: this.authoredEnvironment?.stats.visibleTriangles ?? 0,
      environmentShaderModel: this.authoredEnvironment?.stats.shaderModel ?? null,
      environmentSignageSource:
        this.authoredEnvironment?.stats.signageSource ?? null,
      environmentContractDrift: this.authoredEnvironment?.stats.contractDrift ?? [],
      livingWorldLoadMs: this.diagnosticLivingWorldLoadMs === null
        ? null
        : Number(this.diagnosticLivingWorldLoadMs.toFixed(1)),
      livingWorldReady: this.diagnosticLivingWorldReady,
      livingWorldError: this.diagnosticLivingWorldError,
      livingWorldDrawCalls: this.livingWorld?.stats.drawCalls ?? 0,
      livingWorldCards: this.livingWorld?.stats.cards ?? 0,
      livingWorldTriangles: this.livingWorld?.stats.triangles ?? 0,
      livingWorldUpdateHz: this.livingWorld?.stats.updateHz ?? 0,
      livingWorldUpdateSteps: this.livingWorld?.stats.updateSteps ?? 0,
      surfaceCharacterLoadMs: this.diagnosticSurfaceCharacterLoadMs === null
        ? null
        : Number(this.diagnosticSurfaceCharacterLoadMs.toFixed(1)),
      surfaceCharacterReady: this.diagnosticSurfaceCharacterReady,
      surfaceCharacterError: this.diagnosticSurfaceCharacterError,
      surfaceCharacterDrawCalls: this.surfaceCharacter?.stats.drawCalls ?? 0,
      surfaceCharacterMeshes: this.surfaceCharacter?.stats.meshes ?? 0,
      surfaceCharacterTriangles: this.surfaceCharacter?.stats.triangles ?? 0,
      surfaceCharacterMaterials: this.surfaceCharacter?.stats.materials ?? 0,
      surfaceCharacterTextures: this.surfaceCharacter?.stats.textures ?? 0,
      surfaceCharacterShaderModel: this.surfaceCharacter?.stats.shaderModel ?? null,
      surfaceCharacterAnimated: this.surfaceCharacter?.stats.animated ?? false,
      pixelRatio: Number(this.renderPixelRatio.toFixed(2)),
      preferredPixelRatio: Number(this.preferredPixelRatio.toFixed(2)),
      minimumPixelRatio: Number(this.minimumPixelRatio.toFixed(2)),
      internalWidth: this.renderer.domElement.width,
      internalHeight: this.renderer.domElement.height,
      qualityMode: this.qualityMode,
      reducedMotion: this.reducedMotion,
      ps2CourseMaterials: this.coursePs2Treatment.materials,
      ps2CourseTextures: this.coursePs2Treatment.textures,
      heapMb: heapMb === null ? null : Number(heapMb.toFixed(1)),
      maxHeapMb: this.diagnosticMaxHeapMb === null
        ? null
        : Number(this.diagnosticMaxHeapMb.toFixed(1)),
      heapGrowthMb: heapMb === null || this.diagnosticStartHeapMb === null
        ? null
        : Number((heapMb - this.diagnosticStartHeapMb).toFixed(1)),
    };
    if (report.calls >= this.diagnosticsPeak.calls) {
      this.diagnosticsPeak.calls = report.calls;
      this.diagnosticsPeak.phase = report.phase;
      this.diagnosticsPeak.sector = report.sector;
      this.diagnosticsPeak.distanceMeters = report.distanceMeters;
    }
    this.diagnosticsPeak.triangles = Math.max(
      this.diagnosticsPeak.triangles,
      report.triangles,
    );
    this.diagnosticsPeak.geometries = Math.max(
      this.diagnosticsPeak.geometries,
      report.geometries,
    );
    this.diagnosticsPeak.textures = Math.max(
      this.diagnosticsPeak.textures,
      report.textures,
    );
    this.diagnosticsPeak.environmentGroups = Math.max(
      this.diagnosticsPeak.environmentGroups,
      report.environmentVisibleGroups,
    );
    this.diagnosticsPeak.environmentTriangles = Math.max(
      this.diagnosticsPeak.environmentTriangles,
      report.environmentVisibleTriangles,
    );
    this.diagnosticsPeak.frameMs = Math.max(this.diagnosticsPeak.frameMs, report.frameMs);
    if (this.diagnosticsOutput) {
      this.diagnosticsOutput.textContent = JSON.stringify({
        current: report,
        peak: this.diagnosticsPeak,
      });
    }
    console.info("[FUTURISMA_DIAGNOSTICS]", JSON.stringify(report));
    // Keep diagnostics live through the short finish sting so the final
    // snapshot proves that every transient audio node released. This only
    // affects diagnostics mode; normal result presentation is unchanged.
    if (
      this.phase === "finished"
      && this.speed === 0
      && report.activeAudioOneShots === 0
    ) {
      this.diagnosticsFinalReported = true;
    }
  }

  private resetDiagnosticsPeak(): void {
    this.diagnosticsPeak.calls = 0;
    this.diagnosticsPeak.triangles = 0;
    this.diagnosticsPeak.geometries = 0;
    this.diagnosticsPeak.textures = 0;
    this.diagnosticsPeak.environmentGroups = 0;
    this.diagnosticsPeak.environmentTriangles = 0;
    this.diagnosticsPeak.frameMs = 0;
    this.diagnosticsPeak.phase = this.phase;
    this.diagnosticsPeak.sector = this.course.sectorLabelAt(this.progress);
    this.diagnosticsPeak.distanceMeters = Math.round(this.progress * this.course.length);
    this.diagnosticFrameIndex = 0;
    this.diagnosticFrameCount = 0;
    this.diagnosticMaxFrameMs = 0;
    this.diagnosticPhysicsSteps = 0;
    this.diagnosticDistanceTravelled = 0;
    this.diagnosticBoostSeconds = 0;
    this.diagnosticDriftSeconds = 0;
    this.diagnosticDriftEntries = 0;
    this.diagnosticMaxDriftIntensity = 0;
    this.diagnosticMinimumSurfaceGrip = 1;
    this.diagnosticEdgeSeconds = 0;
    this.diagnosticWrongWaySeconds = 0;
    this.diagnosticWrongWayEntries = 0;
    this.diagnosticMinimumCameraFov = this.camera.fov;
    this.diagnosticMaximumCameraFov = this.camera.fov;
    this.diagnosticMaximumBrakeFovCompression = 0;
    this.diagnosticImpacts = 0;
    this.diagnosticImpactSparkBursts = 0;
    this.diagnosticMissedGates = 0;
    this.diagnosticRecoveries = 0;
    this.diagnosticContextLosses = 0;
    this.diagnosticContextRestores = 0;
    this.diagnosticRenderedFrames = 0;
    this.diagnosticIdleFramesSkipped = 0;
    this.diagnosticPresentationProjectionQueries = 0;
    this.diagnosticAtmosphereUpdates = 0;
    this.diagnosticTopSpeed = 0;
    this.diagnosticMaxLateralRatio = 0;
    this.diagnosticPositionChanges = 0;
    this.diagnosticPositionsGained = 0;
    this.diagnosticPositionsLost = 0;
    const memory = performance as Performance & {
      memory?: { usedJSHeapSize: number };
    };
    this.diagnosticStartHeapMb = memory.memory
      ? memory.memory.usedJSHeapSize / (1024 * 1024)
      : null;
    this.diagnosticMaxHeapMb = this.diagnosticStartHeapMb;
    this.diagnosticImpactLocations.length = 0;
    this.diagnosticRecoveryLocations.length = 0;
    this.audio.resetDiagnostics();
    this.diagnosticsFinalReported = false;
  }

  private readonly resize = (): void => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const previousPreferred = this.preferredPixelRatio;
    const nextPreferred = this.resolvePreferredPixelRatio();
    const nextMinimum = this.resolveMinimumPixelRatio();
    this.renderPixelRatio = reconcilePixelRatioAfterResize(
      this.renderPixelRatio,
      previousPreferred,
      nextPreferred,
      nextMinimum,
    );
    this.preferredPixelRatio = nextPreferred;
    this.minimumPixelRatio = nextMinimum;
    this.renderer.setPixelRatio(this.renderPixelRatio);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
    this.renderRequested = true;
  };

  private resolvePreferredPixelRatio(): number {
    return calculatePreferredPixelRatio(
      window.innerHeight,
      window.devicePixelRatio,
      this.qualityMode,
    );
  }

  private resolveMinimumPixelRatio(): number {
    return calculateMinimumPixelRatio(
      window.innerHeight,
      window.devicePixelRatio,
      this.qualityMode,
    );
  }

  private updateAdaptiveQuality(delta: number): void {
    if (this.qualityOverride === "high" || this.qualityOverride === "low") return;
    if (this.phase !== "running" || document.hidden) {
      this.adaptiveQualityDebt = Math.max(0, this.adaptiveQualityDebt - delta * 2);
      this.adaptiveQualityCredit = 0;
      return;
    }
    if (delta > 1 / 48) {
      this.adaptiveQualityDebt += delta;
      this.adaptiveQualityCredit = 0;
    } else {
      this.adaptiveQualityDebt = Math.max(0, this.adaptiveQualityDebt - delta * 2);
      this.adaptiveQualityCredit = delta < 1 / 55
        ? this.adaptiveQualityCredit + delta
        : 0;
    }
    if (
      this.adaptiveQualityDebt >= 1.5
      && this.renderPixelRatio > this.minimumPixelRatio
    ) {
      this.adaptiveQualityDebt = 0;
      this.adaptiveQualityCredit = 0;
      this.renderPixelRatio = Math.max(
        this.minimumPixelRatio,
        this.renderPixelRatio - 0.08,
      );
      this.resize();
      return;
    }
    if (
      this.adaptiveQualityCredit >= 8
      && this.renderPixelRatio < this.preferredPixelRatio
    ) {
      this.adaptiveQualityCredit = 0;
      this.renderPixelRatio = Math.min(
        this.preferredPixelRatio,
        this.renderPixelRatio + 0.04,
      );
      this.resize();
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.running = false;
    cancelAnimationFrame(this.animationFrame);
    window.removeEventListener("resize", this.resize);
    window.removeEventListener("blur", this.handleWindowBlur);
    document.removeEventListener("visibilitychange", this.handleVisibilityChange);
    this.renderer.domElement.removeEventListener("webglcontextlost", this.handleContextLost);
    this.renderer.domElement.removeEventListener(
      "webglcontextrestored",
      this.handleContextRestored,
    );
    this.timer.dispose();
    this.audio.dispose();
    this.input.dispose();
    disposeObject3DResources(this.scene);
    this.scene.clear();
    this.renderer.renderLists.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.diagnosticsOutput?.remove();
  }
}
