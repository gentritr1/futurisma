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
import { RaceDiagnostics } from "./diagnostics";
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
import { calculatePresentationAlpha, presentationSurfaceLift } from "./presentation";
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
import { save } from "./persistence";
import { playerRaceDistanceMeters as calculatePlayerRaceDistance } from "./rival-race.js";
import { RacingContact } from "./racing-contact";
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

const VEHICLE_MODEL_URL = "/assets/totem/models/totem_runtime.glb";
const RACE_PRESENCE_FX_ATLAS_URL = "/assets/totem/textures/totem_race_presence_fx_256.png";

type RacePhase = "standby" | "countdown" | "running" | "paused" | "resuming" | "finished";

const FIXED_STEP = 1 / 120;
const MAX_PHYSICS_BACKLOG = 0.1;
const RESUME_COUNTDOWN_SECONDS = 2.7;

export class FuturismaGame {
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
  private readonly presentationPosition = new THREE.Vector3();
  private readonly presentationForward = new THREE.Vector3(0, 0, -1);
  private readonly presentationTravelDirection = new THREE.Vector3(0, 0, -1);
  private readonly scratchA = new THREE.Vector3();
  private readonly scratchB = new THREE.Vector3();
  private readonly scratchC = new THREE.Vector3();
  private readonly scratchD = new THREE.Vector3();
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

    this.scene.add(this.course.group, this.vehicle.root);
    this.effects = new RaceEffects(this.reducedMotion, this.course.kind);
    this.contact = new RacingContact(ui, this.audio, input, this.effects);
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
    const rivalFleet = await RivalFleet.create(
      this.course,
      this.totalLaps,
      this.vehicle,
      () => this.disposed,
      save.livery,
    );
    if (!rivalFleet) {
      disposeObject3DResources(this.vehicle.root);
      this.vehicle.root.clear();
      return false;
    }
    this.rivalFleet = rivalFleet;
    // G2 kill switch: `?cushion=0` restores the G1 no-contact race exactly.
    this.rivalFleet.setCushionEnabled(this.cushionEnabled);
    this.scene.add(this.rivalFleet.root, ghostRuntime.attach(this.course, this.vehicle));
    this.audio.attachSpatialScene(rivalFleet, this.camera, this.vehicle.root.position);
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
      await this.sceneAssets.loadAuthoredEnvironment();
      if (this.disposed) return false;
    }
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
    this.autopilot.setDraft(this.rivalFleet, this.slipstream, FIXED_STEP);
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
        this.rivalFleet?.step(FIXED_STEP, this.playerRaceDistance(), this.lateral, this.speed);
        this.updateRace(FIXED_STEP, this.resolveRaceInput(input));
      } else if (this.phase === "finished") {
        this.rivalFleet?.step(FIXED_STEP, this.playerRaceDistance(), this.lateral, this.speed);
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
        this.lateral,
        this.progress,
        this.rivalFleet?.readRadarContacts(this.minimap.contacts) ?? 0,
        now,
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
    const slipstream = this.rivalFleet?.slipstreamStrength ?? 0;
    if (this.rivalFleet?.slipstreamLocked) this.audio.playSlipstreamLock();
    this.slipstream = slipstream;
    this.speed = integrateSpeed(
      this.speed,
      input.throttle,
      input.brake,
      this.boostActive,
      driftIntent,
      delta,
      slipstream,
    );
    if (this.diagnosticsMode) {
      this.diagnosticDistanceTravelled += this.speed * delta;
      this.diagnosticTopSpeed = Math.max(this.diagnosticTopSpeed, this.speed);
      if (this.boostActive) this.diagnosticBoostSeconds += delta;
      if (this.driftActive) this.diagnosticDriftSeconds += delta;
    }

    // G2 - the clean-gate chain enters the reserve here, and only as a
    // multiplier on the PASSIVE regen term.
    this.boostReserve = integrateBoostReserve(
      this.boostReserve, reserveBoost, delta,
      driftReward, slipstream, this.contact.regenMultiplier,
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
    const targetSurfaceGrip = resolveTargetSurfaceGrip(
      this.course.surfaceGripAt(this.progress, this.lateral, beforeMove.halfWidth),
      this.course.apronAt(beforeMove, this.lateral, this.beforeMoveApron).grip,
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
    if (this.contact.stepCushion(
      this.rivalFleet, this.contactPose, this.playerRaceDistance(),
      delta, this.elapsedMs, afterMove, this.position,
      this.course.apronAt(afterMove, this.lateral, this.afterMoveApron).lateralLimit,
    )) {
      this.lateral = this.contactPose.lateralMeters;
      this.position.copy(afterMove.position).addScaledVector(afterMove.right, this.lateral);
      this.position.y = afterMove.position.y;
    }
    this.speed = this.contactPose.speedMetersPerSecond;
    const reward = this.contact.scorePasses(
      this.rivalFleet, this.course, previousProgress, this.progress,
      this.contactPose, this.lap, this.hazardTripCooldown <= 0, this.diagnosticsMode,
    );
    if (reward > 0) {
      this.boostReserve = integrateBoostReserve(this.boostReserve, false, 0, reward);
    }

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
      if (apron.wall && !wasWallContact) {
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
      const scrub = apron.wallScrubMetresPerSecondSquared;
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
    this.rivalFleet?.measurePlayerSeparation(this.playerRaceDistance(), this.lateral);
    ghostRuntime.step(this.lap, this.progress, this.lateral, this.speed, this.steerAmount);
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
    this.contact.crossGate(this.lateral, gateHalfWidth, missedGate, this.diagnosticsMode);
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
    this.presentationPosition.y += presentationSurfaceLift(
      sample.right.y,
      sample.lateral,
      sample.up.y,
      surfaceHeightAtLateral(sample, sample.lateral),
    );
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
    // The player's ground blob rides in the fleet's shared instanced mesh, so
    // it is placed here where the on-surface point and vehicle basis already
    // exist. scratchB/C/D still hold right, up and backward from above.
    this.rivalFleet?.setPlayerShadow(
      this.presentationPosition,
      vehicleRight,
      vehicleUp,
      this.scratchD,
      this.vehicle.hoverHeightMeters(this.vehicleVisualState),
    );

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
      driftCharge: this.driftBank.charge,
      slipstream: this.slipstream,
      cushionSide: this.contact.glowAt(this.elapsedMs),
      cushionPush: Math.abs(this.rivalFleet?.cushionPushMetersPerSecondSquared ?? 0),
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
      recordFinishedRace(
        this.course.mapCode,
        this.bestLapMs,
        this.elapsedMs,
        this.lapTimesMs,
      ),
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
    this.autopilot.reset();
    this.lap = 1;
    this.elapsedMs = 0;
    this.lapStartElapsedMs = 0;
    this.lastLapMs = null;
    this.bestLapMs = null;
    this.lapTimesMs.length = 0;
    this.rivalFleet?.reset();
    ghostRuntime.reset();
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
