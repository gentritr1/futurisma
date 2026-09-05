import * as THREE from "three";
import { RaceAtmosphere, configureToneMapping } from "./atmosphere";
import { EngineAudio, publishAmbienceCue } from "./audio";
import { DemoAutopilot, alignDirectionToSurface } from "./autopilot";
import { DriftBank } from "./drift-charge";
import {
  calculateDesiredCameraFov,
  calculateImpactShakeOffset,
  integrateCameraFov,
} from "./camera-feedback";
import { hasPlayerControlIntent } from "./control-mode";
import { surfaceHeightAtLateral } from "./apron-profile";
import { type CourseProjection, type RaceCourse, type TurnCue } from "./course";
import { RACE_SEED, RaceDiagnostics } from "./diagnostics";
import { RaceEffects } from "./effects";
import { ghostRuntime } from "./ghost-runtime";
import { disposeObject3DResources } from "./graphics-resources";
import { Minimap } from "./minimap";
import { SceneAssets } from "./scene-assets";
import {
  phasePresentsDrivingInput,
  phaseRunsContinuousPresentation,
  shouldRenderGameFrame,
} from "./frame-scheduling";
import type { InputFrame } from "./input";
import {
  ZERO_INPUT,
  probeSelected,
  probeSpawnLateral,
  resolveProbeSpawn,
  resolveQualityLock,
  resolveReducedMotion,
  resolveLapCount,
  resolveRivalAudioProbeLateral,
  searchFlag,
  searchParam,
} from "./query-probes";
import { InputController } from "./input";
import {
  BOOST_MAX_SPEED,
  calculateDriftIntent,
  calculateGripRate,
  calculateTurnAuthority,
  calculateTurnRate,
  integrateBoostReserve,
  integrateCoastSpeed,
  integrateEdgeScrub,
  integrateSurfaceGrip,
  integrateSteering,
  integrateSpeed,
  resolveBoostLockout,
  resolveDriftActive,
  resolveTargetSurfaceGrip,
} from "./physics";
import {
  accumulateApronTelemetry,
  createApronResolution,
  createApronTelemetry,
} from "./apron.js";
import {
  integrateOcclusionPull,
  occlusionPull,
} from "./camera-occlusion.js";
import {
  angleExcess,
  calculatePresentationAlpha,
  cameraSurfaceClearance,
  chaseDistanceCorrection,
  groundBlobVisible,
  hullClearance,
  lateralFromHorizontalOffset,
  presentationSurfaceLift,
} from "./presentation";
import {
  calculateFinishDistanceMeters,
  calculateRecoveryTelemetry,
  crossedForwardProgress,
  integrateWrongWayEvidence,
  isOpenEdgeWarningActive,
  isTurnCueBeyondFinish,
  isTurnCueUrgent,
  resolveGateMissRecoveryDelay,
  resolveWrongWayActive,
  resolveCountdownStage,
} from "./race-rules";
import {
  minimumPixelRatioFor,
  preferredPixelRatioFor,
  reconcilePixelRatioAfterResize,
} from "./render-quality";
import { configureShadowMap } from "./shadows";
import { applyRaceLivery, recordFinishedRace } from "./meta-runtime";
// G4 - the race FORMAT. Every decision lives in race-modes.ts; six calls here.
import { raceModes } from "./race-modes";
import { save } from "./persistence";
import { playerRaceDistanceMeters as calculatePlayerRaceDistance } from "./rival-race.js";
import { RacingContact, rivalLateralFor } from "./racing-contact";
import { TrackEvents } from "./track-events";
import {
  RivalFleet,
  openingRaceStatus,
  type RivalRaceStatus,
} from "./rivals";
import {
  applyPs2MaterialTreatment,
  ps2TreatmentDiagnostics, prefersMultisampling,
  updatePs2SnapGrid,
  TotemVehicle,
  type TotemVisualState,
} from "./totem";
import { GameUi, type RaceStandingEntry } from "./ui";
import { createCircuitRuntime, type CircuitRuntime } from "./circuit-runtime";


type RacePhase = "standby" | "countdown" | "running" | "paused" | "resuming" | "finished";

const FIXED_STEP = 1 / 120;
const MAX_PHYSICS_BACKLOG = 0.1;
/**
 * H1.2 - floors for the two chase-camera guards, both metres.
 *
 * MINIMUM_CHASE_METRES sits below the DESIRED chase distance on both maps, so
 * the guard is inert on an unbroken frame and only catches the collapse.
 * MINIMUM_CAMERA_SURFACE_CLEARANCE_METRES is a backstop under the existing
 * 2.1 m guard on `desired`: that one runs before damping and the impact shake,
 * this one runs after both.
 */
const MINIMUM_CHASE_METRES = 5.5;
/**
 * H1.4 - the window the hull is held inside, in normalised device coordinates.
 *
 * The review's acceptance window is y in [-0.85, 0.65] and |x| <= 0.8. The
 * guard AIMS at 0.05 inside that on every edge, because it corrects the damped
 * look target once per frame: a guard that aimed exactly at the acceptance edge
 * would leave the measured value sitting on it, and one frame of lag would put
 * it outside. `validate-pose.mjs` asserts these stay inside the ruled window.
 */
const HULL_FRAME_NDC_Y_MIN = -0.8;
const HULL_FRAME_NDC_Y_MAX = 0.6;
const HULL_FRAME_NDC_X_LIMIT = 0.75;
/**
 * H1.5 - the occlusion pull, all metres except the recovery rate.
 *
 * BACK_OFF stops the camera short of the ridge rather than on it, because a
 * camera exactly on a wall renders its inside face across the whole frame.
 * MINIMUM is the floor the pull may not go under: nearer than 3 m the craft
 * fills the view and the cure is worse than the parapet. RECOVERY is outward
 * only - see `integrateOcclusionPull` for why the two directions differ.
 */
const CAMERA_OCCLUSION_BACK_OFF_METRES = 0.35;
const CAMERA_OCCLUSION_MINIMUM_METRES = 3;
const CAMERA_OCCLUSION_RECOVERY_METRES_PER_SECOND = 6;
/**
 * H1.5 - when the sight-line cast is worth its 0.75 ms.
 *
 * The cast is real geometry, measured at 742-772 us against the authored
 * environment group and 2.51 ms against the whole scene, so it cannot run
 * every frame. It does not need to. Occlusion by drawn geometry needs the
 * sight line to DESCEND across something, which needs the camera well above
 * the hull, and it needs the craft off the line the camera is following.
 * Both measured on the residue: the camera sat 3.9-4.0 m above the hull with
 * 5.6-8.1 m of lateral separation. These gates sit under both, and a clean
 * autopilot lap never reaches either.
 */
const CAMERA_OCCLUSION_DROP_METRES = 2.5;
const CAMERA_OCCLUSION_LATERAL_METRES = 3;
const MINIMUM_CAMERA_SURFACE_CLEARANCE_METRES = 1.6;

const RESUME_COUNTDOWN_SECONDS = 2.7;

export class FuturismaGame {
  private circuitRuntime: CircuitRuntime | null = null;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly course: RaceCourse;
  private readonly minimap: Minimap;
  private readonly diagnosticCourseAssemblyMs: number;
  private readonly coursePs2Treatment: ReturnType<typeof applyPs2MaterialTreatment>;
  private readonly sceneAssets: SceneAssets;
  private readonly autopilot: DemoAutopilot;
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
  private readonly atmosphere: RaceAtmosphere;
  private readonly effects: RaceEffects;
  private readonly diagnostics: RaceDiagnostics;
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
  /**
   * H1 - the lateral that goes with `previousPosition` / `presentationPosition`.
   *
   * The simulation's convention is that `position.y` is ALWAYS the centreline
   * height: every writer that offsets by the banked `right` puts the y back.
   * That makes the stored point sit BELOW the banked deck plane by
   * `lateral * tan(bank)`, and re-projecting it returns `lateral * cos^2(bank)`,
   * not `lateral` - so the presentation lift must be driven by the lateral the
   * race loop actually holds, never by a projection of the flattened point.
   */
  private previousLateral = 0;
  private presentationLateral = 0;
  private readonly presentationPosition = new THREE.Vector3();
  private readonly presentationForward = new THREE.Vector3(0, 0, -1);
  private readonly presentationTravelDirection = new THREE.Vector3(0, 0, -1);
  private readonly scratchA = new THREE.Vector3();
  private readonly scratchB = new THREE.Vector3();
  private readonly scratchC = new THREE.Vector3();
  private readonly scratchD = new THREE.Vector3();
  /**
   * H1 - the chase camera's own scratch. `updateCamera` used to borrow
   * `scratchA` for the ground-clearance vector AFTER deriving `vehicleRight`
   * into it, so the impact shake read a vector as long as the craft's lateral
   * offset where a unit basis vector was intended.
   */
  private readonly cameraScratch = new THREE.Vector3();
  /**
   * H1.2 kill switch, in the style of `?cushion=0` and `?shadows=0`: turns both
   * chase-camera guards off so the collapse they exist for can be measured
   * again. Every number `validate-pose.mjs` pins them against - the 7.26 m and
   * 8.76 m desired chase distances and the 4.93 m collapse - was read from a
   * `?camguards=0` run, and stays reproducible because of this line.
   */
  private readonly cameraGuardsEnabled = searchParam("camguards") !== "0";
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
  /**
   * P11. Seconds until a missed gate hands the craft to the recovery flow;
   * negative means none is pending. See `resolveGateMissRecoveryDelay`.
   */
  private gateMissRecoveryCountdown = -1;
  private boostReserve = 1;
  private boostActive = false;
  private boostLockedUntilRelease = false;
  private driftActive = false;
  private readonly driftBank = new DriftBank();
  private driftIntensity = 0;
  private surfaceGrip = 1;
  private readonly beforeMoveApron = createApronResolution();
  private readonly afterMoveApron = createApronResolution();
  private apronTelemetry = createApronTelemetry();
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
  // Contact with the authored boundary itself. `edgeContact` now begins one
  // apron width earlier, and would otherwise suppress the wall impact.
  private wallContact = false;
  private openEdgeWarning = false;
  private wrongWayEvidence = 0;
  private wrongWayActive = false;
  private courseAlignment = 1;
  private offCourseTime = 0;
  private recoveryImmunity = 0;
  private hazardTripCooldown = 0;
  private padBoostTime = 0;
  /** G1 - the tow the fleet measured on the last fixed step, 0..1. */
  private slipstream = 0;
  /** G2 - the cushion, the near miss and the chain, plus the pose they move. */
  private readonly contact: RacingContact;
  /** G3 — the live track events: wind gusts, salt drops, the rain squall. */
  private readonly trackEvents: TrackEvents;
  private readonly contactPose = { lateralMeters: 0, speedMetersPerSecond: 0 };
  private impactShake = 0;
  private physicsAccumulator = 0;
  private adaptiveQualityDebt = 0;
  private adaptiveQualityCredit = 0;
  private nextHudAt = 0;
  private nextFieldOrderAt = 0;
  private diagnosticPhysicsSteps = 0;
  private diagnosticDistanceTravelled = 0;
  private diagnosticBoostSeconds = 0;
  private diagnosticDriftSeconds = 0;
  private diagnosticMinimumSurfaceGrip = 1;
  // H1 - the drawn deck under the craft vs the craft, from the SIM's own
  // (progress, lateral). See `hullClearance` in presentation.js.
  private diagnosticHullClearance = 0;
  private diagnosticMinimumHullClearance = Number.POSITIVE_INFINITY;
  private diagnosticMaximumHullClearance = Number.NEGATIVE_INFINITY;
  // H1.2 - the chase camera's own two numbers. `hullNdcY` is where the craft
  // actually lands on screen; `cameraSurfaceClearance` is how far the camera
  // sits above the drawn surface AT ITS OWN LATERAL.
  private diagnosticCameraSurfaceClearance = 0;
  private diagnosticMinimumCameraSurfaceClearance = Number.POSITIVE_INFINITY;
  private diagnosticChaseMeters = 0;
  private diagnosticMinimumChaseMeters = Number.POSITIVE_INFINITY;
  private diagnosticDesiredChaseMeters = 0;
  private diagnosticCameraLateral = 0;
  /** H1.5 - metres the sight-line guard is currently holding the camera in. */
  private cameraOcclusionPull = 0;
  private diagnosticMaximumCameraOcclusionPull = 0;
  private diagnosticSightCastMicroseconds = 0;
  private diagnosticSightCasts = 0;
  private readonly sightCaster = new THREE.Raycaster();
  private readonly sightHits: THREE.Intersection[] = [];
  private readonly cameraScratchB = new THREE.Vector3();
  private diagnosticCameraLateralLag = 0;
  private diagnosticMaximumCameraLateralLag = 0;
  private diagnosticHullNdcX = 0;
  private diagnosticHullNdcY = 0;
  private diagnosticMinimumHullNdcY = Number.POSITIVE_INFINITY;
  private diagnosticMaximumHullNdcY = Number.NEGATIVE_INFINITY;
  private diagnosticEdgeSeconds = 0;
  private diagnosticWrongWaySeconds = 0;
  private diagnosticWrongWayEntries = 0;
  private diagnosticMinimumCameraFov = 56;
  private diagnosticMaximumCameraFov = 56;
  private diagnosticMaximumBrakeFovCompression = 0;
  private diagnosticImpacts = 0;
  private diagnosticMissedGates = 0;
  private diagnosticRecoveries = 0;
  private diagnosticGateMissRecoveries = 0;
  private diagnosticContextLosses = 0;
  private diagnosticContextRestores = 0;
  private diagnosticRenderedFrames = 0;
  private diagnosticIdleFramesSkipped = 0;
  private diagnosticPresentationProjectionQueries = 0;
  private diagnosticAtmosphereUpdates = 0;
  private diagnosticTopSpeed = 0;
  private diagnosticMaxLateralRatio = 0;
  private diagnosticStartupReadyMs = 0;
  private diagnosticVehicleLoadStartedMs = 0;
  private diagnosticVehicleLoadMs = 0;
  private diagnosticVehicleRequestStartMs: number | null = null;
  private diagnosticVehicleResourceRequests = 0;
  private readonly diagnosticImpactLocations: string[] = [];
  private readonly diagnosticRecoveryLocations: string[] = [];
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
  private readonly qualityOverride = searchParam("quality");
  private readonly qualityMode = resolveQualityLock();
  private preferredPixelRatio = preferredPixelRatioFor(this.qualityMode);
  private minimumPixelRatio = minimumPixelRatioFor(this.qualityMode);
  private renderPixelRatio = this.preferredPixelRatio;
  private readonly demoMode = searchFlag("demo");
  private demoAutopilot = this.demoMode;
  private readonly diagnosticsMode = searchFlag("diagnostics");
  /** G2 - `?cushion=0` puts the race back on the G1 no-contact model. */
  private readonly cushionEnabled = searchParam("cushion") !== "0";
  /**
   * H1.3 — QA scene switch, in the same family as `?cushion=0` and
   * `?camguards=0`, but a runtime call rather than a URL flag because the
   * measurement it exists for needs TWO renders of the SAME frame.
   *
   * `scripts/visual/vehicle-pixels.mjs` pauses the race, screenshots, calls
   * `__futurismaHide(["totem_vehicle_root"])`, screenshots again, and counts the
   * pixels that changed. That difference is the only honest answer to "was the
   * craft drawn": every pose number H1 added says where the craft IS, and the
   * frames this exists for had the hull dead centre of the frame at NDC
   * (0.13, -0.45), 1.26 m of clearance, and zero pixels on screen.
   *
   * Restores everything before hiding, so consecutive calls never compound, and
   * returns the names it walked so a harness can enumerate the scene.
   */
  private readonly hideHook: boolean = ((game: unknown) => {
    (globalThis as unknown as Record<string, unknown>).__futurismaHide = (
      names: string[],
    ) => {
      const self = game as { scene: THREE.Scene; renderRequested: boolean };
      const wanted = new Set(names);
      const seen: string[] = [];
      self.scene.traverse((object) => {
        if (!object.name) return;
        seen.push(object.name);
        object.visible = !wanted.has(object.name);
      });
      self.renderRequested = true;
      return seen;
    };
    return true;
  })(this);
  // Every `?probe=` spawn pose is resolved by query-probes.ts; see ProbeSpawn.
  private readonly rivalAudioProbeLateral = resolveRivalAudioProbeLateral();
  private readonly contextLossProbe = probeSelected("context");
  private readonly focusLossProbe = probeSelected("focus");
  private readonly reducedMotion = resolveReducedMotion();

  constructor(
    canvas: HTMLCanvasElement,
    private readonly input: InputController,
    private readonly ui: GameUi,
    course: RaceCourse,
    courseAssemblyMs = 0,
  ) {
    this.course = course;
    this.minimap = new Minimap(ui.minimapCanvas, course, this.reducedMotion);
    this.camera = new THREE.PerspectiveCamera(
      58,
      1,
      0.1,
      this.course.kind === "bitterpan" ? 1800 : 650,
    );
    this.diagnosticCourseAssemblyMs = courseAssemblyMs;
    this.coursePs2Treatment = applyPs2MaterialTreatment(this.course.group, {
      worldGeometry: true,
    });
    this.autopilot = new DemoAutopilot(this.course);
    this.beforeMoveProjection = this.course.createProjectionScratch();
    this.afterMoveProjection = this.course.createProjectionScratch();
    this.poseProjection = this.course.createProjectionScratch();
    this.cameraProjection = this.course.createProjectionScratch();
    this.cameraSurfaceProjection = this.course.createProjectionScratch();
    this.cameraLookAhead = this.course.createSampleScratch();
    this.totalLaps = resolveLapCount(this.course);
    this.progress = this.course.startProgress;
    this.lateral = this.course.startLateral;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: prefersMultisampling(), // P14. See totem.ts for why ps2 opts out.
      alpha: false,
      powerPreference: "high-performance",
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    configureToneMapping(this.renderer);
    configureShadowMap(this.renderer); // P20.1. See shadows.ts for the kill switch.
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

    void this.hideHook;
    this.scene.add(this.course.group, this.vehicle.root);
    this.effects = new RaceEffects(this.reducedMotion, this.course.kind);
    this.contact = new RacingContact(ui, this.audio, input, this.effects);
    this.trackEvents = new TrackEvents(this.course, this.totalLaps, RACE_SEED);
    this.scene.add(this.trackEvents.group);
    this.camera.add(this.effects.speedLines);
    this.scene.add(this.camera, this.effects.sparkPoints);
    this.atmosphere = new RaceAtmosphere(
      this.scene,
      this.camera,
      this.course,
      this.progress,
      this.vehicle.root,
      this.reducedMotion,
    );
    this.sceneAssets = new SceneAssets(
      this.scene,
      this.camera,
      this.course,
      () => this.disposed,
      () => {
        this.renderRequested = true;
      },
    );
    this.diagnostics = new RaceDiagnostics(this.diagnosticsMode);
    raceModes.attach(this.course, ui); // G4 - gate distances and the delta HUD.
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

  /** P7 — the two listener volumes; the authored mix ceiling stays in audio.ts. */
  readonly setMasterVolume = (volume: number): void => this.audio.setMasterVolume(volume);
  readonly setMusicVolume = (volume: number): void => this.audio.setMusicVolume(volume);

  /** P7 — the meta layer's one hook into the live scene; see `meta-runtime`. */
  readonly applyLivery = async (code: string): Promise<void> => {
    await applyRaceLivery(this.vehicle, this.rivalFleet, code, this.ui);
    this.renderRequested = true;
  };

  private updateTidelineMaterials: (() => void) | null = null;

  async initialize(): Promise<boolean> {
    const {loadVehicleForRace,prepareTidelinePresentation}=await import("./race-presentation-setup");
    const vehicleTiming = await loadVehicleForRace(this.vehicle, this.course.kind);
    this.diagnosticVehicleLoadStartedMs = vehicleTiming.startedAt;
    this.diagnosticVehicleLoadMs = vehicleTiming.elapsed;
    this.diagnosticVehicleResourceRequests = vehicleTiming.requests;
    this.diagnosticVehicleRequestStartMs = vehicleTiming.requestStart;
    if (this.disposed) {
      disposeObject3DResources(this.vehicle.root);
      this.vehicle.root.clear();
      return false;
    }
    this.circuitRuntime = await createCircuitRuntime(this.course, this.input, this.audio, this.ui, this.reducedMotion, () => this.disposed);
    if (this.disposed) { this.circuitRuntime?.dispose(); return false; }
    const rivalFleet = await RivalFleet.create(
      this.circuitRuntime?.course.rivalCourse ?? this.course,
      this.totalLaps,
      this.vehicle,
      () => this.disposed,
      save.livery,
    );
    // G4 - a null fleet is only a failure when the format wanted one; timeattack
    // races solo, and `RivalFleet.create` says so by returning null too.
    if (!rivalFleet && raceModes.hasField) {
      disposeObject3DResources(this.vehicle.root);
      this.vehicle.root.clear();
      return false;
    }
    this.rivalFleet = rivalFleet;
    // G2 kill switch: `?cushion=0` restores the G1 no-contact race exactly.
    this.rivalFleet?.setCushionEnabled(this.cushionEnabled);
    this.scene.add(ghostRuntime.attach(this.course, this.vehicle));
    if (rivalFleet) {
      this.scene.add(rivalFleet.root);
      this.audio.attachSpatialScene(rivalFleet, this.camera, this.vehicle.root.position);
    }
    this.ui.setRaceFormat(
      this.totalLaps,
      this.course.length,
      this.rivalFleet?.gridEntries ?? [],
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
    if (this.course.kind !== "greenwater") {
      await this.sceneAssets.loadAuthoredEnvironment();
      if (this.disposed) return false;
    }
    this.updateTidelineMaterials = await prepareTidelinePresentation(this.course.kind, this.reducedMotion, this.scene, this.rivalFleet, this.vehicle.root, this.course.group, this.effects.speedLines, this.effects.sparkPoints);
    this.running = true;
    this.animationFrame = requestAnimationFrame(this.frame);
    if (this.course.kind === "greenwater") void this.sceneAssets.loadAuthoredEnvironment();
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
    if (this.circuitRuntime?.handleActions(this.phase === "running", this.progress, this.position, this.lateral, this.demoAutopilot)) {
      this.lateral *= -1;
      this.syncPresentationPose();
      this.contact.resetMotion(this.lateral);
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
      this.sceneAssets.authoredEnvironment?.updateVisibility(this.camera);
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
    this.autopilot.setDraft(this.afterMoveProjection.alternateRoad ? null : this.rivalFleet, this.slipstream, FIXED_STEP);
    return this.autopilot.read(
      this.position,
      this.forward,
      this.travelDirection,
      this.progress,
      this.speed,
      this.lap,
      this.nextCheckpointIndex,
      this.elapsedMs,
    );
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
        // Fleet first: `updateRace` reads the tow it measured for this step.
        this.rivalFleet?.step(FIXED_STEP, this.playerRaceDistance(), rivalLateralFor(this.course, this.position, this.progress, this.lateral), this.speed);
        this.updateRace(FIXED_STEP, this.resolveRaceInput(input));
      } else if (this.phase === "finished") {
        this.rivalFleet?.step(FIXED_STEP, this.playerRaceDistance(), rivalLateralFor(this.course, this.position, this.progress, this.lateral), this.speed);
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
    ghostRuntime.updatePresentation(this.physicsAccumulator);

    const presentationInput = phasePresentsDrivingInput(this.phase)
      ? this.demoAutopilot
        ? this.autopilot.input
        : input
      : ZERO_INPUT;
    const presentationProjection = this.updatePose(presentationInput, delta);
    this.updateCamera(
      delta,
      this.steerAmount,
      presentationInput.brake,
      presentationProjection,
    );
    this.effects.updateSpeedLines(
      delta,
      this.speed,
      this.steerAmount,
      this.driftIntensity,
      this.boostActive,
    );
    this.effects.updateImpactSparks(delta);
    this.updateTidelineMaterials?.();
    this.atmosphere.updateFog(delta, this.progress, this.lap, this.totalLaps, this.phase);
    // Reduced motion freezes the effect clock, but the cards still need to face
    // the moving chase camera so the approved still frame remains visible.
    this.sceneAssets.livingWorld?.update(delta, this.camera, !this.reducedMotion);
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
      publishAmbienceCue(this.course, this.progress),
      this.phase === "running",
    );
    if (audioControlUpdated && this.phase !== "finished") {
      this.audio.setMusicProfile(this.course.musicAt(this.progress));
    }
    const now = this.timer.getElapsed();
    if (now >= this.nextHudAt) {
      this.nextHudAt = now + 1 / 30;
      this.refreshRaceStatus(this.phase === "running");
      this.updateHud(presentationInput);
      this.minimap.update(
        this.playerRaceDistance(),
        rivalLateralFor(this.course, this.position, this.progress, this.lateral),
        this.progress,
        this.rivalFleet?.readRadarContacts(this.minimap.contacts) ?? 0,
        now, this.afterMoveProjection.alternateRoad,
      );
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
    alignDirectionToSurface(direction, up, fallback);
  }

  private capturePreviousSimulationPose(): void {
    this.previousLateral = this.lateral;
    this.previousPosition.copy(this.position);
    this.previousForward.copy(this.forward);
    this.previousTravelDirection.copy(this.travelDirection);
  }

  private syncPresentationPose(): void {
    this.capturePreviousSimulationPose();
    this.presentationLateral = this.lateral;
    this.presentationPosition.copy(this.position);
    this.presentationForward.copy(this.forward);
    this.presentationTravelDirection.copy(this.travelDirection);
  }

  private interpolatePresentationPose(alpha: number): void {
    this.presentationLateral = THREE.MathUtils.lerp(
      this.previousLateral,
      this.lateral,
      alpha,
    );
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
    this.circuitRuntime?.step(delta, this.progress, this.lateral, this.lap);
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
    this.boostActive = reserveBoost || this.padBoostTime > 0 || Boolean(this.circuitRuntime?.surgeActive);
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
    const driftReward = this.driftBank.update(this.driftActive, this.driftIntensity, delta);
    if (this.driftActive && !wasDriftActive) {
      this.audio.playDriftEngage();
      this.input.pulse(0.08, 0.18, 75);
    } else if (driftReward > 0) {
      // Straight to the particle buffer, not through emitImpactSparks: a cashed
      // drift is not a collision, so it must not fire the vehicle impact flash
      // or count against the impact-spark telemetry.
      const side = Math.sign(this.lateral) || 1;
      this.audio.playDriftEngage(this.driftBank.releaseCharge);
      this.effects.emitImpactSparks(
        beforeMove, this.position, this.lateral, this.speed, side, 0.22,
      );
      this.input.pulse(0.24, 0.12, 90);
    }
    const slipstream = this.circuitRuntime?.ceiling || beforeMove.alternateRoad ? 0 : this.rivalFleet?.slipstreamStrength ?? 0;
    if (slipstream > 0 && this.rivalFleet?.slipstreamLocked) this.audio.playSlipstreamLock();
    this.slipstream = slipstream;
    const speedBeforeStep = this.speed;
    this.speed = integrateSpeed(
      this.speed,
      input.throttle,
      input.brake,
      this.boostActive,
      driftIntent,
      delta,
      slipstream,
    );
    this.speed = this.circuitRuntime?.applySurge(speedBeforeStep, this.speed, input, delta) ?? this.speed;
    // G4 - out of the guard below: the result screen prints TOP SPEED in
    // ordinary play, and the value is identical, so `topSpeedKph` does not move.
    this.diagnosticTopSpeed = Math.max(this.diagnosticTopSpeed, this.speed);
    if (this.diagnosticsMode) {
      this.diagnosticDistanceTravelled += this.speed * delta;
      if (this.boostActive) this.diagnosticBoostSeconds += delta;
      if (this.driftActive) this.diagnosticDriftSeconds += delta;
    }

    // G2 - the clean-gate chain enters the reserve here, and only as a
    // multiplier on the PASSIVE regen term.
    this.boostReserve = integrateBoostReserve(
      this.boostReserve, reserveBoost, delta,
      driftReward, slipstream, this.contact.regenMultiplier * (this.circuitRuntime?.boostRechargeScale ?? 1),
    );

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

    // The apron's grip cost enters the same integrator as standing water, so
    // leaving the deck reads as a surface change rather than a special case.
    // G3 adds the live-event term on the same footing: the salt patch and the
    // squall reach the craft exactly the way standing water and the apron
    // already do, through one composed target and one integrator.
    const targetSurfaceGrip = resolveTargetSurfaceGrip(
      this.course.surfaceGripAt(this.progress, this.lateral, beforeMove.halfWidth),
      this.course.apronAt(beforeMove, this.lateral, this.beforeMoveApron).grip,
      undefined,
      this.trackEvents.surfaceGripMultiplier(this.progress * this.course.length),
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
    // G2 - both calls sit here, after the move is projected and BEFORE the
    // apron clamp, for the reasons documented in racing-contact.ts.
    this.contactPose.lateralMeters = this.lateral;
    this.contactPose.speedMetersPerSecond = this.speed;
    // G3 - the gust asks for its lateral here, immediately before the cushion
    // and well before the apron clamp, so the deck edge still wins.
    const gustMoved = this.trackEvents.step(
      delta, this.playerRaceDistance(), this.progress * this.course.length,
      this.lap, this.contactPose, this.diagnosticsMode,
    );
    if ((!this.circuitRuntime?.ceiling && !afterMove.alternateRoad && this.contact.stepCushion(
      this.rivalFleet, this.contactPose, this.playerRaceDistance(),
      delta, this.elapsedMs, afterMove, this.position,
      this.course.apronAt(afterMove, this.lateral, this.afterMoveApron).lateralLimit,
    )) || gustMoved) {
      this.lateral = this.contactPose.lateralMeters;
      this.position.copy(afterMove.position).addScaledVector(afterMove.right, this.lateral);
      this.position.y = afterMove.position.y;
    }
    this.speed = this.contactPose.speedMetersPerSecond;
    const reward = this.circuitRuntime?.ceiling || afterMove.alternateRoad ? 0 : this.contact.scorePasses(
      this.rivalFleet, this.course, previousProgress, this.progress,
      this.contactPose, this.lap, this.hazardTripCooldown <= 0, this.diagnosticsMode,
    );
    if (reward > 0) {
      this.boostReserve = integrateBoostReserve(this.boostReserve, false, 0, reward);
    }

    if (this.circuitRuntime?.shieldActive && this.course.cableTripSideAt(this.progress, this.lateral)) {
      this.boostReserve = Math.min(1, this.boostReserve + this.circuitRuntime.onShieldImpact(this.progress, this.lateral));
    }
    const cableTripSide = this.hazardTripCooldown <= 0 && !this.circuitRuntime?.shieldActive
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
      this.ui.flashHazard(this.circuitRuntime ? "PHASE FIELD · USE SHIELD OR CHANGE LANE" : "CABLE STRIKE");
      if (this.diagnosticsMode) {
        this.diagnosticImpacts += 1;
        this.diagnosticImpactLocations.push(
          `CABLE STRIKE@${Math.round(this.progress * this.course.length)}m`,
        );
      }
    }

    // The boundary is authored, not hardcoded: `apron` carries the run-off
    // width, its grip, and whether anything stands at the end of it. Only the
    // hangar interior still clamps at the old deck margin, because that wall is
    // diegetically correct.
    const edgeType = this.course.edgeType(afterMove, this.lateral);
    const apron = this.course.apronAt(afterMove, this.lateral, this.afterMoveApron);
    const openEdge = edgeType === "C";
    this.openEdgeWarning = openEdge && isOpenEdgeWarningActive(
      this.lateral,
      afterMove.halfWidth,
    );
    const beyondRoad = Math.abs(this.lateral) > apron.roadLimit;
    const outside = Math.abs(this.lateral) > apron.lateralLimit;
    const wasEdgeContact = this.edgeContact;
    const wasWallContact = this.wallContact;
    const wasOnApron = this.apronTelemetry.onApron;
    this.apronTelemetry = accumulateApronTelemetry(this.apronTelemetry, apron, delta);
    if (apron.onApron && !wasOnApron && !openEdge) {
      this.ui.flashHazard("RUN-OFF");
      this.audio.playImpact(0.25);
    }
    if (openEdge && beyondRoad && this.recoveryImmunity <= 0) {
      this.offCourseTime += delta;
      this.speed = Math.max(0, this.speed - delta * 8);
    } else {
      this.offCourseTime = 0;
    }
    if (outside) {
      const limit = apron.lateralLimit;
      this.lateral = THREE.MathUtils.clamp(this.lateral, -limit, limit);
      this.position.copy(afterMove.position).addScaledVector(afterMove.right, this.lateral);
      // Keep the sim's centreline-Y convention: the banked `right` added
      // sin(bank)·lateral, which the presentation lift would double-apply.
      this.position.y = afterMove.position.y;
      const outward = this.scratchA
        .copy(afterMove.right)
        .multiplyScalar(Math.sign(afterMove.lateral));
      const outwardMotion = this.travelDirection.dot(outward);
      if (outwardMotion > 0) {
        this.travelDirection.addScaledVector(outward, -outwardMotion * 1.45).normalize();
      }
      if (apron.wall && !wasWallContact && !this.circuitRuntime?.shieldActive) {
        const impactStrength = apron.wallImpactStrength;
        this.speed *= apron.wallSpeedMultiplier;
        this.impactShake = 1;
        this.contact.impactBurst(
          this.vehicle, afterMove, this.position, this.lateral, this.speed,
          Math.sign(this.lateral) || 1, impactStrength, this.diagnosticsMode,
        );
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
      const scrub = this.circuitRuntime?.shieldActive ? 0 : apron.wallScrubMetresPerSecondSquared;
      this.speed = integrateEdgeScrub(this.speed, scrub, delta);
    }
    this.wallContact = outside
      || (wasWallContact && Math.abs(this.lateral) > apron.lateralLimit - 0.12);
    this.edgeContact = beyondRoad
      || (wasEdgeContact && Math.abs(this.lateral) > apron.roadLimit - 0.12);
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
    // P11. A missed gate runs the same recovery after a short grace.
    // `recoveryImmunity` disarms it, which is what stops it looping.
    if (this.gateMissRecoveryCountdown >= 0) {
      if (this.recoveryImmunity > 0) {
        this.gateMissRecoveryCountdown = -1;
      } else {
        this.gateMissRecoveryCountdown -= delta;
        if (this.gateMissRecoveryCountdown < 0) {
          if (this.diagnosticsMode) this.diagnosticGateMissRecoveries += 1;
          this.recoverVehicle("gate-miss");
          return;
        }
      }
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
    // G2 - sampled where the lateral has been through cushion AND apron clamp.
    this.rivalFleet?.measurePlayerSeparation(this.playerRaceDistance(), rivalLateralFor(this.course, this.position, this.progress, this.lateral));
    ghostRuntime.step(this.lap, this.progress, this.lateral, this.speed, this.steerAmount);
    this.updateCheckpointProgress(previousProgress, afterMove.tangent);
  }

  private updateCoast(delta: number): void {
    this.circuitRuntime?.advanceClocks(delta);
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
    // H1 - same convention as every other writer in `updateRace`: the banked
    // `right` just added sin(bank) * lateral, which the presentation lift
    // applies itself. Leaving it in double-applies it on a banked coast.
    this.position.y = projection.position.y;
    this.boostActive = false;
    if (previousSpeed > 0 && this.speed === 0) this.diagnostics.requestImmediateReport();
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
    // G2 - the chain is resolved on EVERY crossing, miss included, before any
    // of the four branches below can return. See racing-contact.ts.
    const gateHalfWidth = this.course.checkpointHalfWidth(this.nextCheckpointIndex);
    const missedGate = Math.abs(this.lateral) > gateHalfWidth;
    this.contact.crossGate(this.lateral, gateHalfWidth, missedGate);
    if (missedGate) {
      if (this.missedGateIndex !== this.nextCheckpointIndex) {
        this.missedGateIndex = this.nextCheckpointIndex;
        if (this.diagnosticsMode) this.diagnosticMissedGates += 1;
        this.ui.flashMissedGate(this.nextCheckpointIndex);
        this.audio.playMissedGate();
        this.input.pulse(0.44, 0.18, 170);
        // P11. `nextCheckpointIndex` still does not advance — the gate has to
        // be cleared for real — but the craft is put back upstream of it.
        if (this.recoveryImmunity <= 0) {
          this.gateMissRecoveryCountdown = resolveGateMissRecoveryDelay(this.speed);
        }
      }
      return;
    }

    this.missedGateIndex = null;
    this.gateMissRecoveryCountdown = -1;

    if (this.nextCheckpointIndex === 0) {
      const completedLapMs = Math.max(0, this.elapsedMs - this.lapStartElapsedMs);
      this.lastLapMs = completedLapMs;
      this.bestLapMs = Math.min(this.bestLapMs ?? completedLapMs, completedLapMs);
      this.lapTimesMs.push(completedLapMs);
      raceModes.closeLap(completedLapMs); // G4 - before the finish check.
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
    // G4 - the split and its delta, on the same crossing the gate flashes on.
    raceModes.crossGate(clearedCheckpoint, this.elapsedMs - this.lapStartElapsedMs);
    this.ui.flashGate(clearedCheckpoint);
    this.audio.playGate(clearedCheckpoint);
    this.input.pulse(0.08, 0.22, 70);
  }

  private recoverVehicle(cause: "off-course" | "gate-miss" = "off-course"): void {
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
    this.circuitRuntime?.recover(this.progress);
    const recovery = this.course.sample(this.progress, this.poseProjection);
    this.position.copy(recovery.position);
    this.forward.copy(recovery.tangent);
    this.travelDirection.copy(recovery.tangent);
    this.lateral = 0;
    this.missedGateIndex = null;
    this.gateMissRecoveryCountdown = -1;
    this.steerAmount = 0;
    this.speed = this.course.recoverySpeedMps;
    this.boostActive = false;
    this.padBoostTime = 0;
    this.wrongWayEvidence = 0;
    this.wrongWayActive = false;
    this.courseAlignment = 1;
    this.edgeContact = false;
    this.wallContact = false;
    this.offCourseTime = 0;
    this.recoveryImmunity = this.course.recoveryImmunitySeconds;
    this.hazardTripCooldown = 0.6;
    this.impactShake = 0.25;
    this.driftActive = false;
    this.driftBank.abandon();
    this.surfaceGrip = 1;
    this.input.pulse(0.42, 0.64, 180);
    this.audio.playRecovery();
    this.ui.flashHazard(
      cause === "gate-miss"
        ? `GATE ${this.nextCheckpointIndex} MISSED · RETRY`
        : automaticRecovery
          ? "COURSE LINK RESTORED"
          : "MANUAL RECOVERY",
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
    // P11 bank plane + P16 apron cross-section; see `presentationSurfaceLift`.
    // `sample` is projected from the un-lifted point on purpose, and this never
    // accumulates: `presentationPosition` is rewritten from the sim each frame.
    // H1 - the lateral is the race loop's own, NOT `sample.lateral`: projecting
    // the centreline-flattened point returns `lateral * cos^2(bank)`, which
    // under-lifts the craft by `lateral * sin(bank) * sin^2(bank)`.
    this.presentationPosition.y += presentationSurfaceLift(
      sample.right.y,
      this.presentationLateral,
      sample.up.y,
      surfaceHeightAtLateral(sample, this.presentationLateral),
    );
    this.circuitRuntime?.present(sample, this.presentationPosition, this.presentationForward, this.vehicleVisualState);
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
    this.vehicleVisualState.boostReserve = this.boostReserve;
    this.vehicle.updateVisual(this.vehicleVisualState);
    // The fleet's shared contact blob uses the existing scratchB/C/D basis.
    // Flight gaps and in-flight gravity transfers have no receiving surface.
    this.rivalFleet?.setPlayerShadow(
      this.presentationPosition,
      vehicleRight,
      vehicleUp,
      this.scratchD,
      this.vehicle.hoverHeightMeters(this.vehicleVisualState),
      groundBlobVisible(!this.circuitRuntime?.isFlipping, this.course.travelModeAt?.(this.progress)),
    );

    if (this.diagnosticsMode && !this.circuitRuntime) this.recordHullClearance(vehiclePosition.y, sample);
    if (delta > 0) this.impactShake = Math.max(0, this.impactShake - delta * 3.6);
    return sample;
  }

  /**
   * H1 - proof that the presentation lift is applied exactly once, per frame.
   *
   * `sample` is the projection taken BEFORE the lift and the lateral is
   * recovered from the presentation point's horizontal offset, so neither input
   * can be moved by a height write. The answer is `hoverHeight * up.y` when the
   * lift is right, and off by `sin(bank) * lateral` for each extra or missing
   * application of it.
   */
  private recordHullClearance(vehicleY: number, sample: CourseProjection): void {
    const lateral = lateralFromHorizontalOffset(
      this.presentationPosition.x - sample.position.x,
      this.presentationPosition.z - sample.position.z,
      sample.right.x,
      sample.right.z,
    );
    this.diagnosticHullClearance = hullClearance(
      vehicleY,
      sample.position.y,
      sample.right.y,
      sample.up.y,
      lateral,
      surfaceHeightAtLateral(sample, lateral),
    );
    if (this.phase !== "running") return;
    this.diagnosticMinimumHullClearance = Math.min(
      this.diagnosticMinimumHullClearance,
      this.diagnosticHullClearance,
    );
    this.diagnosticMaximumHullClearance = Math.max(
      this.diagnosticMaximumHullClearance,
      this.diagnosticHullClearance,
    );
  }

  /**
   * H1.2 (a) - the chase camera may not close inside `MINIMUM_CHASE_METRES` of
   * the hull along the craft's own forward. See `chaseDistanceCorrection`.
   */
  private holdChaseDistance(floor: number): void {
    const back = this.cameraScratch
      .copy(this.cameraTarget)
      .sub(this.vehicle.root.position)
      .dot(this.presentationForward);
    const correction = chaseDistanceCorrection(back, floor);
    if (correction > 0) {
      this.cameraTarget.addScaledVector(this.presentationForward, -correction);
    }
  }

  /**
   * H1.2 (b) - the camera may not sink into the surface it is looking across.
   * Measured at the CAMERA's lateral, so the run-off cross-section counts, and
   * applied to the final position so the impact shake cannot undo it.
   */
  private holdCameraOverSurface(progress: number): void {
    const surface = this.course.project(
      this.camera.position,
      progress,
      this.cameraSurfaceProjection,
    );
    const offsetAlongUp = this.cameraScratch
      .copy(this.camera.position)
      .sub(surface.position)
      .dot(surface.up);
    const clearance = cameraSurfaceClearance(
      offsetAlongUp,
      surfaceHeightAtLateral(surface, surface.lateral),
    );
    if (this.cameraGuardsEnabled
      && clearance < MINIMUM_CAMERA_SURFACE_CLEARANCE_METRES) {
      const lift = MINIMUM_CAMERA_SURFACE_CLEARANCE_METRES - clearance;
      this.camera.position.addScaledVector(surface.up, lift);
      this.cameraTarget.addScaledVector(surface.up, lift);
    }
    if (!this.diagnosticsMode) return;
    this.diagnosticCameraLateral = surface.lateral;
    this.diagnosticCameraSurfaceClearance = this.cameraGuardsEnabled
      ? Math.max(clearance, MINIMUM_CAMERA_SURFACE_CLEARANCE_METRES)
      : clearance;
    this.diagnosticChaseMeters = -this.cameraScratch
      .copy(this.camera.position)
      .sub(this.vehicle.root.position)
      .dot(this.presentationForward);
    if (this.phase !== "running") return;
    this.diagnosticMinimumCameraSurfaceClearance = Math.min(
      this.diagnosticMinimumCameraSurfaceClearance,
      this.diagnosticCameraSurfaceClearance,
    );
    this.diagnosticMinimumChaseMeters = Math.min(
      this.diagnosticMinimumChaseMeters,
      this.diagnosticChaseMeters,
    );
  }

  /**
   * H1.2 - where the hull actually lands on screen, in normalised device
   * coordinates. The whole point of the two guards above, measured directly
   * rather than argued from the offsets that produce it.
   */
  private recordHullNdc(): void {
    this.camera.updateMatrixWorld();
    const ndc = this.cameraScratch
      .copy(this.vehicle.root.position)
      .project(this.camera);
    this.diagnosticHullNdcX = ndc.x;
    this.diagnosticHullNdcY = ndc.y;
    if (this.phase !== "running") return;
    this.diagnosticMinimumHullNdcY = Math.min(
      this.diagnosticMinimumHullNdcY,
      this.diagnosticHullNdcY,
    );
    this.diagnosticMaximumHullNdcY = Math.max(
      this.diagnosticMaximumHullNdcY,
      this.diagnosticHullNdcY,
    );
  }

  /**
   * H1.5 - the camera comes inside anything that would stand between it and the
   * craft.
   *
   * P21 narrowed Greenwater's limits to where drawn surface exists and left one
   * residue: the Sweep's authored concrete carries a parapet 4.36 m over the
   * deck at lateral -12.85, INSIDE the racing surface, and on the bend the
   * chase camera sights the craft across it. Craft at lateral -10.9, legally on
   * the deck, 27 pixels drawn. The limit cannot narrow the racing surface and
   * the art is frozen, so the camera moves.
   *
   * This is the standard third-person answer and it is deliberately the LAST
   * guard to touch the camera: the chase floor has had its say, and where the
   * two disagree the occluder wins, because a camera at a correct distance
   * behind a wall shows nothing.
   *
   * @returns the camera's resulting distance from the hull, for diagnostics.
   */
  private holdCameraClearOfSight(
    right: THREE.Vector3,
    delta: number,
  ): number {
    const hull = this.vehicle.root.position;
    const toCamera = this.cameraScratch.copy(this.cameraTarget).sub(hull);
    const distance = toCamera.length();
    let target = 0;
    if (distance > CAMERA_OCCLUSION_MINIMUM_METRES && this.sightLineWorthCasting(
      this.cameraTarget,
      toCamera.dot(right),
    )) {
      const started = this.diagnosticsMode ? performance.now() : 0;
      const blockedAt = this.castSightLine(toCamera, distance);
      if (this.diagnosticsMode) {
        this.diagnosticSightCastMicroseconds += (performance.now() - started) * 1000;
        this.diagnosticSightCasts += 1;
      }
      target = occlusionPull(
        distance,
        blockedAt,
        CAMERA_OCCLUSION_BACK_OFF_METRES,
        CAMERA_OCCLUSION_MINIMUM_METRES,
      );
    }
    this.cameraOcclusionPull = integrateOcclusionPull(
      this.cameraOcclusionPull,
      target,
      delta,
      CAMERA_OCCLUSION_RECOVERY_METRES_PER_SECOND,
    );
    if (this.cameraOcclusionPull <= 0) return distance;
    const pulled = Math.max(
      CAMERA_OCCLUSION_MINIMUM_METRES,
      distance - this.cameraOcclusionPull,
    );
    this.cameraTarget
      .copy(hull)
      .addScaledVector(toCamera.divideScalar(distance), pulled);
    if (this.diagnosticsMode && this.phase === "running") {
      this.diagnosticMaximumCameraOcclusionPull = Math.max(
        this.diagnosticMaximumCameraOcclusionPull,
        this.cameraOcclusionPull,
      );
    }
    return pulled;
  }

  /**
   * H1.5 - the gate in front of the cast.
   *
   * Cheap enough to run every frame, and false on every frame of a clean lap.
   * Occlusion needs the sight line to descend across something, so the camera
   * has to be well above the hull, AND the craft has to be off the line the
   * camera is trailing, or the only thing between them is the road they are
   * both over.
   */
  private sightLineWorthCasting(
    desired: THREE.Vector3,
    lateralLag: number,
  ): boolean {
    return desired.y - this.vehicle.root.position.y > CAMERA_OCCLUSION_DROP_METRES
      && Math.abs(lateralLag) > CAMERA_OCCLUSION_LATERAL_METRES;
  }

  /**
   * H1.5 - metres along the sight line at which DRAWN geometry stands, or
   * Infinity when it is clear.
   *
   * Against the authored environment only, which is deliberate on both counts.
   * It is where the occluder measurably is: at craft lateral -11 with the
   * camera at -3.5 the first hit is `GW_SECTOR_GREENWATER_SWEEP_concrete`,
   * 2.92 m above the deck at lateral -8.47. And it is what a camera can
   * legitimately be pulled inside of -- cards, decals, water, the sky and the
   * craft's own effects are not things the player would ever describe as being
   * in the way, and casting against them would pull the camera in on a
   * particle.
   *
   * The alternative was a table: P21's corridor sweep already walks this
   * geometry offline. It cannot serve, and the reason is in its own output --
   * for Greenwater it reports `obstacle: 0, overhead: 0`, because it classifies
   * the authored surface against the blockout deck and this occluder IS that
   * disagreement. A table derived from a sweep that cannot see the thing would
   * have shipped a guard that never fires.
   */
  private castSightLine(toCamera: THREE.Vector3, distance: number): number {
    const environment = this.sceneAssets.authoredEnvironment;
    if (!environment) return Number.POSITIVE_INFINITY;
    // FROM THE CAMERA, not from the hull, and this is not a stylistic choice.
    // The authored meshes are `FrontSide`, so a ray travelling up from the
    // craft meets the UNDERSIDE of the road it is under and is skipped as a
    // backface. Cast from the hull, this returned "clear" on frames whose
    // pixel diff said the craft was not drawn at all; cast from the camera it
    // hits the surface the camera is actually looking at.
    this.sightCaster.set(
      this.cameraTarget,
      this.cameraScratchB.copy(toCamera).divideScalar(-distance),
    );
    this.sightCaster.near = CAMERA_OCCLUSION_BACK_OFF_METRES;
    this.sightCaster.far = distance;
    this.sightHits.length = 0;
    this.sightCaster.intersectObject(environment.root, true, this.sightHits);
    const first = this.sightHits.length > 0 ? this.sightHits[0].distance : null;
    this.sightHits.length = 0;
    // `occlusionPull` works outward from the hull, so convert.
    return first === null ? Number.POSITIVE_INFINITY : distance - first;
  }

  /**
   * H1.4 - the hull stays inside the frame.
   *
   * The two H1.2 floors bound how far behind and how high the camera sits.
   * Neither bounds where the craft LANDS on screen, and on Bitterpan's A-edge
   * run-off the measured hull went to NDC y +1.36 with the camera 5.5 m back,
   * 4.55 m over its own surface and its lateral within 0.02 m of the craft's --
   * every other guard healthy, the craft off the top of the frame.
   *
   * So this one is written in the space the acceptance is written in. It
   * measures the hull's angle from the view axis, and when that angle is
   * outside the window it rotates the LOOK TARGET by exactly the excess. The
   * correction is zero inside the window and grows continuously from zero at
   * its edge, so it is a corrective term rather than a snap, and it is applied
   * to `cameraLook` -- the damped state -- so the next frame's lerp starts from
   * the corrected aim instead of fighting it.
   */
  private holdHullInFrame(): void {
    const position = this.camera.position;
    const toLook = this.cameraScratch.copy(this.cameraLook).sub(position);
    const lookDistance = toLook.length();
    if (lookDistance < 0.05) return;
    const forward = this.scratchA.copy(toLook).divideScalar(lookDistance);
    const right = this.scratchB.crossVectors(forward, this.camera.up);
    if (right.lengthSq() < 1e-8) return;
    right.normalize();
    const up = this.scratchC.crossVectors(right, forward).normalize();
    const toHull = this.scratchD
      .copy(this.vehicle.root.position)
      .sub(position);
    if (toHull.lengthSq() < 0.0025) return;
    // `atan2` on the RAW forward component, not a clamped one. A hull behind
    // the camera is at an angle past 90 degrees, and that is the number the
    // correction needs: clamping the denominator caps the measured excess at
    // 90 and leaves a spun-out frame still aimed away from the craft.
    const alongAxis = toHull.dot(forward);
    const tanHalfVertical = Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2);
    const tanHalfHorizontal = tanHalfVertical * this.camera.aspect;
    const pitch = Math.atan2(toHull.dot(up), alongAxis);
    const yaw = Math.atan2(toHull.dot(right), alongAxis);
    const pitchExcess = angleExcess(
      pitch,
      Math.atan(HULL_FRAME_NDC_Y_MIN * tanHalfVertical),
      Math.atan(HULL_FRAME_NDC_Y_MAX * tanHalfVertical),
    );
    const yawLimit = Math.atan(HULL_FRAME_NDC_X_LIMIT * tanHalfHorizontal);
    const yawExcess = angleExcess(yaw, -yawLimit, yawLimit);
    if (pitchExcess === 0 && yawExcess === 0) return;
    // Rotating `forward` about `right` by +a tilts it toward `up`; about `up`
    // by +b tilts it toward `right`. Both move the axis TOWARDS the hull by
    // exactly the amount it overshot, which lands it on the window edge.
    if (pitchExcess !== 0) forward.applyAxisAngle(right, pitchExcess);
    if (yawExcess !== 0) forward.applyAxisAngle(up, yawExcess);
    this.cameraLook.copy(position).addScaledVector(forward, lookDistance);
    this.camera.lookAt(this.cameraLook);
  }

  private updateCamera(
    delta: number,
    steer: number,
    brake: number,
    sample: CourseProjection,
  ): void {
    if (this.circuitRuntime) {
      this.circuitRuntime.updateCamera(this.camera, delta, this.vehicle.root.position, this.presentationForward, this.speed);
      return;
    }
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
    // H1 - `cameraScratch`, not `scratchA`: `vehicleRight` still lives in
    // `scratchA` and the impact shake below reads it. Borrowing it here left
    // the shake multiplying (desired - centreline) - a vector whose length is
    // the craft's lateral offset, up to 17 m on the apron - where a unit
    // right-vector was meant, so the shake scaled with how far off-line the
    // craft was instead of with the impact.
    const cameraClearance = this.cameraScratch.copy(desired)
      .sub(cameraSurface.position)
      .dot(cameraSurface.up);
    if (cameraClearance < 2.1) {
      desired.addScaledVector(cameraSurface.up, 2.1 - cameraClearance);
    }

    const speedRatio = this.speed / BOOST_MAX_SPEED;
    const positionDamping = 1 - Math.exp(-delta * (12 + speedRatio * 8));
    const lookDamping = 1 - Math.exp(-delta * (11 + speedRatio * 5));
    if (this.diagnosticsMode) {
      this.diagnosticDesiredChaseMeters = -this.cameraScratch
        .copy(desired)
        .sub(this.vehicle.root.position)
        .dot(this.presentationForward);
    }
    // H1.5 - last write to `desired`, before the damping sees it, so the pull
    // is smoothed by the same lerp as everything else rather than snapping.
    this.cameraTarget.lerp(desired, positionDamping);
    // H1.2 (a) - the damped camera, not `desired`, is what loses the craft.
    // Written back into `cameraTarget` so the next frame's lerp starts from the
    // corrected point instead of fighting the guard every frame.
    if (this.cameraGuardsEnabled) this.holdChaseDistance(MINIMUM_CHASE_METRES);
    // H1.5 - and last, because a camera at a correct distance behind a wall
    // shows nothing. On the DAMPED camera for the same reason the chase floor
    // is: the sight line that matters runs to where the camera IS, and while
    // the camera lags laterally that is a different line from the one to
    // `desired` - casting along `desired` reported the wall clear on frames
    // where the player could not see the craft at all.
    if (this.cameraGuardsEnabled) {
      this.holdCameraClearOfSight(sample.right, delta);
    }
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

    // H1.2 (b) - the last thing that touches the camera position. After the
    // damping AND after the impact shake, because both can put it under the
    // run-off, and at the camera's own lateral rather than the craft's.
    this.holdCameraOverSurface(sample.progress);
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
    // H1.4 - after the FOV settles, because the window is defined against the
    // projection the player is actually looking through.
    if (this.cameraGuardsEnabled) this.holdHullInFrame();
    if (this.diagnosticsMode) {
      this.recordHullNdc();
      this.diagnosticCameraLateralLag = this.cameraScratch
        .copy(this.camera.position)
        .sub(this.vehicle.root.position)
        .dot(sample.right);
      if (this.phase === "running") {
        this.diagnosticMaximumCameraLateralLag = Math.max(
          this.diagnosticMaximumCameraLateralLag,
          Math.abs(this.diagnosticCameraLateralLag),
        );
      }
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

  private updateHud(input: InputFrame): void {
    this.circuitRuntime?.updateHud(this.progress);
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
    // G4 - the time-attack live delta; held to 4 Hz inside `RaceModes`.
    raceModes.updateLiveDelta(this.elapsedMs, this.lapStartElapsedMs, this.progress);
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
      driftCharge: this.driftBank.charge,
      slipstream: this.slipstream,
      cushionSide: this.contact.glowAt(this.elapsedMs),
      cushionPush: Math.abs(this.rivalFleet?.cushionPushMetersPerSecondSquared ?? 0),
      trackEvent: this.trackEvents.chipLabel,
      cleanGateChain: this.contact.cleanGateChain,
      cleanGateMultiplier: this.contact.regenMultiplier,
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
    this.diagnostics.requestImmediateReport();
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
      // G4 - the stats come from the contributors that already measure them,
      // so nothing new is counted here. See `RaceResultInputs`.
      recordFinishedRace(this.bestLapMs, this.elapsedMs, this.lapTimesMs, {
        contact: this.contact.diagnostics(),
        rivals: this.rivalFleet?.diagnostics(),
        topSpeedMetersPerSecond: this.diagnosticTopSpeed,
      }),
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
    this.circuitRuntime?.reset();
    const spawn = resolveProbeSpawn(this.course);
    this.progress = spawn.progress;
    this.speed = spawn.speedMps;
    this.lateral = 0;
    this.steerAmount = 0;
    this.nextCheckpointIndex = 1;
    this.missedGateIndex = null;
    this.gateMissRecoveryCountdown = -1;
    this.boostReserve = 1;
    this.boostActive = false;
    this.boostLockedUntilRelease = false;
    this.driftActive = false;
    this.driftBank.reset();
    this.driftIntensity = 0;
    this.surfaceGrip = 1;
    this.padBoostTime = 0;
    this.slipstream = 0;
    this.contact.reset();
    this.trackEvents.reset();
    this.autopilot.reset();
    this.lap = 1;
    this.elapsedMs = 0;
    this.lapStartElapsedMs = 0;
    this.lastLapMs = null;
    this.bestLapMs = null;
    this.lapTimesMs.length = 0;
    this.rivalFleet?.reset();
    ghostRuntime.reset();
    raceModes.reset(); // G4 - reloads the record this race is measured against.
    this.raceStatus = openingRaceStatus(
      this.rivalFleet,
      calculatePlayerRaceDistance({
        progress: this.raceProgressFromStart(this.progress),
        lap: 1,
        totalLaps: this.totalLaps,
        courseLengthMeters: this.course.length,
      }),
    );
    this.lastPositionCue = this.raceStatus.position;
    this.lastPositionCueAtMs = -Infinity;
    this.finalStandings = [];
    this.edgeContact = false;
    this.wallContact = false;
    this.apronTelemetry = createApronTelemetry();
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
    this.vehicle.resetEffects();
    this.effects.resetImpactSparks();
    const start = this.course.sample(this.progress, this.poseProjection);
    this.lateral = probeSpawnLateral(spawn, start.halfWidth);
    this.position.copy(start.position).addScaledVector(start.right, this.lateral);
    // H1 - the writer that broke the convention. A `?probe=` spawn with a
    // non-zero lateral on a banked sample kept sin(bank) * lateral in the sim
    // position AND got it again from the presentation lift, burying the craft
    // 3.33 m under GREENWATER SWEEP's 12 degree deck at lateral -16.
    this.position.y = start.position.y;
    this.forward.copy(start.tangent);
    this.travelDirection.copy(start.tangent);
    if (spawn.reversed) {
      this.forward.multiplyScalar(-1);
      this.travelDirection.multiplyScalar(-1);
      this.courseAlignment = -1;
    }
    while (
      spawn.alignCheckpoint
      && this.nextCheckpointIndex < this.course.checkpointCount
      && this.course.checkpointProgress(this.nextCheckpointIndex) <= this.progress
    ) this.nextCheckpointIndex += 1;
    if (this.rivalAudioProbeLateral !== 0) {
      this.audio.setRivalAudioProbe(start.right, this.rivalAudioProbeLateral);
    }
    this.syncPresentationPose();
    this.course.setLapBoard(1, this.totalLaps);
    this.course.setCheckpointProgress(1);
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
    if (!this.diagnosticsMode) return;
    if (!this.diagnostics.sample(delta, this.timer.getElapsed())) return;
    this.diagnostics.report(
      {
        phase: this.phase,
        autopilot: this.demoAutopilot,
        progress: this.progress,
        speed: this.speed,
        lateral: this.lateral,
        steerAmount: this.steerAmount,
        driftActive: this.driftActive,
        driftIntensity: this.driftIntensity,
        surfaceGrip: this.surfaceGrip,
        boostActive: this.boostActive,
        boostLocked: this.boostLockedUntilRelease,
        wrongWayActive: this.wrongWayActive,
        courseAlignment: this.courseAlignment,
        nextCheckpointIndex: this.nextCheckpointIndex,
        elapsedMs: this.elapsedMs,
        racerCount: this.raceStatus.racerCount,
        playerPosition: this.raceStatus.position,
        positionChanges: this.diagnosticPositionChanges,
        positionsGained: this.diagnosticPositionsGained,
        positionsLost: this.diagnosticPositionsLost,
        finalStandings: this.finalStandings,
        distanceTravelled: this.diagnosticDistanceTravelled,
        topSpeed: this.diagnosticTopSpeed,
        lapTimesMs: this.lapTimesMs,
        boostSeconds: this.diagnosticBoostSeconds,
        driftSeconds: this.diagnosticDriftSeconds,
        ...this.driftBank.diagnostics(),
        minimumSurfaceGrip: this.diagnosticMinimumSurfaceGrip,
        hullClearance: this.diagnosticHullClearance,
        minimumHullClearance: this.diagnosticMinimumHullClearance,
        maximumHullClearance: this.diagnosticMaximumHullClearance,
        hoverHeight: this.course.vehicleHoverHeight(this.speed, this.boostActive),
        cameraSurfaceClearance: this.diagnosticCameraSurfaceClearance,
        minimumCameraSurfaceClearance: this.diagnosticMinimumCameraSurfaceClearance,
        chaseMeters: this.diagnosticChaseMeters,
        minimumChaseMeters: this.diagnosticMinimumChaseMeters,
        desiredChaseMeters: this.diagnosticDesiredChaseMeters,
        cameraLateral: this.diagnosticCameraLateral,
        cameraOcclusionPull: this.cameraOcclusionPull,
        maximumCameraOcclusionPull: this.diagnosticMaximumCameraOcclusionPull,
        sightCastMicroseconds: this.diagnosticSightCasts > 0
          ? this.diagnosticSightCastMicroseconds / this.diagnosticSightCasts
          : 0,
        sightCasts: this.diagnosticSightCasts,
        cameraLateralLag: this.diagnosticCameraLateralLag,
        maximumCameraLateralLag: this.diagnosticMaximumCameraLateralLag,
        hullNdcX: this.diagnosticHullNdcX,
        hullNdcY: this.diagnosticHullNdcY,
        minimumHullNdcY: this.diagnosticMinimumHullNdcY,
        maximumHullNdcY: this.diagnosticMaximumHullNdcY,
        edgeSeconds: this.diagnosticEdgeSeconds,
        wrongWaySeconds: this.diagnosticWrongWaySeconds,
        wrongWayEntries: this.diagnosticWrongWayEntries,
        minimumCameraFov: this.diagnosticMinimumCameraFov,
        maximumCameraFov: this.diagnosticMaximumCameraFov,
        maximumBrakeFovCompression: this.diagnosticMaximumBrakeFovCompression,
        impacts: this.diagnosticImpacts,
        missedGates: this.diagnosticMissedGates,
        impactLocations: this.diagnosticImpactLocations,
        ...this.contact.diagnostics(),
        recoveries: this.diagnosticRecoveries,
        gateMissRecoveries: this.diagnosticGateMissRecoveries,
        contextLost: this.contextLost,
        contextLosses: this.diagnosticContextLosses,
        contextRestores: this.diagnosticContextRestores,
        renderedFrames: this.diagnosticRenderedFrames,
        idleFramesSkipped: this.diagnosticIdleFramesSkipped,
        presentationProjectionQueries: this.diagnosticPresentationProjectionQueries,
        atmosphereUpdates: this.diagnosticAtmosphereUpdates,
        recoveryLocations: this.diagnosticRecoveryLocations,
        maxLateralRatio: this.diagnosticMaxLateralRatio,
        physicsSteps: this.diagnosticPhysicsSteps,
        startupReadyMs: this.diagnosticStartupReadyMs,
        courseAssemblyMs: this.diagnosticCourseAssemblyMs,
        vehicleLoadStartedMs: this.diagnosticVehicleLoadStartedMs,
        vehicleLoadMs: this.diagnosticVehicleLoadMs,
        vehicleRequestStartMs: this.diagnosticVehicleRequestStartMs,
        vehicleResourceRequests: this.diagnosticVehicleResourceRequests,
        pixelRatio: this.renderPixelRatio,
        preferredPixelRatio: this.preferredPixelRatio,
        minimumPixelRatio: this.minimumPixelRatio,
        qualityMode: this.qualityMode,
        reducedMotion: this.reducedMotion,
        ps2CourseMaterials: this.coursePs2Treatment.materials,
        ps2CourseTextures: this.coursePs2Treatment.textures,
      },
      {
        course: this.course,
        renderer: this.renderer,
        audio: this.audio.diagnostics(),
        rivals: this.rivalFleet?.diagnostics(),
        apron: this.apronTelemetry,
        assetKit: this.sceneAssets.assetKitDiagnostics(),
        environment: this.sceneAssets.environmentDiagnostics(),
        livingWorld: this.sceneAssets.livingWorldDiagnostics(),
        surfaceCharacter: this.sceneAssets.surfaceCharacterDiagnostics(),
        minimap: this.minimap.diagnostics(),
        atmosphere: this.atmosphere.diagnostics(),
        ghost: ghostRuntime.diagnostics(),
        ps2: ps2TreatmentDiagnostics(),
        trackEvents: this.trackEvents.diagnostics(),
      },
    );
  }

  private resetDiagnosticsPeak(): void {
    this.diagnostics.resetPeak(
      this.phase,
      this.course.sectorLabelAt(this.progress),
      Math.round(this.progress * this.course.length),
    );
    this.diagnosticPhysicsSteps = 0;
    this.diagnosticDistanceTravelled = 0;
    this.diagnosticBoostSeconds = 0;
    this.diagnosticDriftSeconds = 0;
    this.diagnosticMinimumSurfaceGrip = 1;
    this.diagnosticEdgeSeconds = 0;
    this.diagnosticWrongWaySeconds = 0;
    this.diagnosticWrongWayEntries = 0;
    this.diagnosticMinimumCameraFov = this.camera.fov;
    this.diagnosticMaximumCameraFov = this.camera.fov;
    this.diagnosticMaximumBrakeFovCompression = 0;
    this.diagnosticImpacts = 0;
    this.diagnosticMissedGates = 0;
    this.contact.resetDiagnostics();
    this.trackEvents.resetDiagnostics();
    this.diagnosticRecoveries = 0;
    this.diagnosticGateMissRecoveries = 0;
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
    this.diagnosticImpactLocations.length = 0;
    this.diagnosticRecoveryLocations.length = 0;
    this.audio.resetDiagnostics();
  }

  private readonly resize = (): void => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const previousPreferred = this.preferredPixelRatio;
    const nextPreferred = preferredPixelRatioFor(this.qualityMode);
    const nextMinimum = minimumPixelRatioFor(this.qualityMode);
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
    updatePs2SnapGrid(this.renderer.domElement.width, this.renderer.domElement.height);
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
    this.renderRequested = true;
  };

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
    this.circuitRuntime?.dispose();
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
    this.diagnostics.dispose();
  }
}
