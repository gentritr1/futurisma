import * as THREE from "three";
import type { ApronTelemetry } from "./apron.js";
import type { AtmosphereDiagnostics } from "./atmosphere";
import type { EngineAudio } from "./audio";
import type { RaceCourse } from "./course";
import type { MinimapDiagnostics } from "./minimap";
import type { RivalFleetDiagnostics } from "./rivals";
import type { SceneAssets } from "./scene-assets";
import type { Ps2TreatmentDiagnostics } from "./totem";
import type { RaceStandingEntry } from "./ui";

const FRAME_SAMPLE_WINDOW = 720;
const RACE_SEED = 714;

/**
 * Flat snapshot of the values the race loop itself owns. Every other field in
 * the emitted report comes from a subsystem contributor, so a phase that adds
 * telemetry to a subsystem edits that subsystem's module instead of this one.
 */
export interface DiagnosticsCore {
  phase: string;
  autopilot: boolean;
  progress: number;
  speed: number;
  lateral: number;
  steerAmount: number;
  driftActive: boolean;
  driftIntensity: number;
  surfaceGrip: number;
  boostActive: boolean;
  boostLocked: boolean;
  wrongWayActive: boolean;
  courseAlignment: number;
  nextCheckpointIndex: number;
  elapsedMs: number;
  racerCount: number;
  playerPosition: number;
  positionChanges: number;
  positionsGained: number;
  positionsLost: number;
  finalStandings: readonly RaceStandingEntry[];
  distanceTravelled: number;
  topSpeed: number;
  lapTimesMs: readonly number[];
  boostSeconds: number;
  driftSeconds: number;
  driftEntries: number;
  driftCharge: number;
  driftRewards: number;
  driftRewardTotal: number;
  maxDriftIntensity: number;
  minimumSurfaceGrip: number;
  edgeSeconds: number;
  wrongWaySeconds: number;
  wrongWayEntries: number;
  minimumCameraFov: number;
  maximumCameraFov: number;
  maximumBrakeFovCompression: number;
  impacts: number;
  sparkBursts: number;
  missedGates: number;
  impactLocations: readonly string[];
  recoveries: number;
  contextLost: boolean;
  contextLosses: number;
  contextRestores: number;
  renderedFrames: number;
  idleFramesSkipped: number;
  presentationProjectionQueries: number;
  atmosphereUpdates: number;
  recoveryLocations: readonly string[];
  maxLateralRatio: number;
  physicsSteps: number;
  startupReadyMs: number;
  courseAssemblyMs: number;
  vehicleLoadStartedMs: number;
  vehicleLoadMs: number;
  vehicleRequestStartMs: number | null;
  vehicleResourceRequests: number;
  pixelRatio: number;
  preferredPixelRatio: number;
  minimumPixelRatio: number;
  qualityMode: string;
  reducedMotion: boolean;
  ps2CourseMaterials: number;
  ps2CourseTextures: number;
}

/** Frame-time and heap window owned by {@link RaceDiagnostics}. */
export interface DiagnosticsFrameStats {
  frameMs: number;
  p95FrameMs: number;
  maxFrameMs: number;
  heapMb: number | null;
  maxHeapMb: number | null;
  startHeapMb: number | null;
}

export type DiagnosticsReportInput = DiagnosticsCore & DiagnosticsFrameStats;

/** One flat object per subsystem, contributed by the module that owns it. */
export interface DiagnosticsContributors {
  course: RaceCourse;
  renderer: THREE.WebGLRenderer;
  audio: ReturnType<EngineAudio["diagnostics"]>;
  rivals: RivalFleetDiagnostics | undefined;
  apron: ApronTelemetry;
  assetKit: ReturnType<SceneAssets["assetKitDiagnostics"]>;
  environment: ReturnType<SceneAssets["environmentDiagnostics"]>;
  livingWorld: ReturnType<SceneAssets["livingWorldDiagnostics"]>;
  surfaceCharacter: ReturnType<SceneAssets["surfaceCharacterDiagnostics"]>;
  minimap: MinimapDiagnostics;
  atmosphere: AtmosphereDiagnostics;
  // P4b: `?render=` mode plus the PS2 shader-arming counts. Owned by the
  // material treatment in totem.ts, not by the race loop.
  ps2: Ps2TreatmentDiagnostics;
}

function courseFields(course: RaceCourse) {
  return {
    mapCode: course.mapCode,
    mapName: course.mapName,
    mapKind: course.kind,
    finalMap02NativeBlockoutFreeze: false,
    orderedCheckpointCount: course.orderedCheckpointCount,
  };
}

function renderFields(renderer: THREE.WebGLRenderer) {
  const render = renderer.info.render;
  return {
    calls: render.calls,
    triangles: render.triangles,
    points: render.points,
    lines: render.lines,
    geometries: renderer.info.memory.geometries,
    textures: renderer.info.memory.textures,
  };
}

function rivalFields(
  rivals: RivalFleetDiagnostics | undefined,
  elapsedSeconds: number,
) {
  return {
    rivalDrawCalls: rivals?.drawCalls ?? 0,
    rivalTriangles: rivals?.triangles ?? 0,
    rivalUpdateSteps: rivals?.updateSteps ?? 0,
    rivalUpdateHz: elapsedSeconds > 0
      ? Number(((rivals?.updateSteps ?? 0) / elapsedSeconds).toFixed(1))
      : 0,
    rivalMinimumSeparationMeters: Number(
      (rivals?.minimumSeparationMeters ?? 0).toFixed(2),
    ),
    rivalCatchUpMultiplier: rivals?.catchUpMultiplier ?? 1,
    rivalArticulatedGroups: rivals?.articulatedGroups ?? [],
    // Peak fin deflection seen since the last reset. A soak that leaves this at
    // zero has rivals whose control surfaces never moved, whatever the frame
    // looks like.
    rivalMaximumSteerRadians: Number(
      (rivals?.maximumSteerRadians ?? 0).toFixed(4),
    ),
    rivalArticulation: (rivals?.articulation ?? []).map((entry) => ({
      id: entry.id,
      steerRadians: Number(entry.steerRadians.toFixed(4)),
      brakeRadians: Number(entry.brakeRadians.toFixed(4)),
    })),
    rivals: (rivals?.states ?? []).map((state) => ({
      ...state,
      raceDistanceMeters: Number(state.raceDistanceMeters.toFixed(2)),
      speedKph: Number(state.speedKph.toFixed(1)),
      lateralMeters: Number(state.lateralMeters.toFixed(2)),
      finishTimeMs: state.finishTimeMs === null
        ? null
        : Math.round(state.finishTimeMs),
    })),
  };
}

/**
 * Authored-apron telemetry. `apronSeconds === 0` over a demo soak is the proof
 * that widening the boundary did not move the racing line.
 */
function apronFields(apron: ApronTelemetry) {
  return {
    onApron: apron.onApron,
    apronSeconds: Number(apron.seconds.toFixed(2)),
    apronEntries: apron.entries,
    maxApronDepthMeters: Number(apron.maxDepthMetres.toFixed(2)),
    minimumApronGrip: Number(apron.minimumGrip.toFixed(3)),
  };
}

function audioFields(audio: ReturnType<EngineAudio["diagnostics"]>) {
  return {
    audioContextState: audio.contextState,
    audioControlUpdates: audio.controlUpdates,
    audioControlHz: Number(audio.controlHz.toFixed(1)),
    audioControlTargetHz: audio.controlTargetHz,
    musicTransitions: audio.musicTransitions,
    musicProfileKey: audio.musicProfileKey,
    musicLoopBeats: audio.musicLoopBeats,
    musicLoopSeconds: Number(audio.musicLoopSeconds.toFixed(3)),
    musicSampleRate: audio.musicSampleRate,
    musicKey: audio.musicKey,
    maxMusicLowpassHz: Number(audio.maxMusicLowpassHz.toFixed(1)),
    maxMusicHighShelfDb: Number(audio.maxMusicHighShelfDb.toFixed(1)),
    activeAudioOneShots: audio.activeOneShots,
    peakAudioOneShots: audio.peakActiveOneShots,
    skippedAudioOneShots: audio.skippedOneShots,
    raceEventAudioCues: audio.raceEventCues,
    audioPreparationMs: Number(audio.musicPreparationMs.toFixed(1)),
    audioInitializationMs: Number(audio.initializationMs.toFixed(1)),
    rivalPanners: audio.rivalPanners,
    // Listener-space X per rival: -1 hard left, +1 hard right. The only part of
    // the HRTF chain a headless probe can read back, so it is what the
    // `rival-audio` probe asserts.
    rivalPanX: audio.rivalPanX.map((value) => Number(value.toFixed(3))),
    reverbZone: audio.reverbZone,
    reverbWet: Number(audio.reverbWet.toFixed(3)),
    reverbZoneTransitions: audio.reverbZoneTransitions,
  };
}

function readHeapMb(): number | null {
  const memory = performance as Performance & {
    memory?: { usedJSHeapSize: number };
  };
  return memory.memory ? memory.memory.usedJSHeapSize / (1024 * 1024) : null;
}

/**
 * Composes one `[FUTURISMA_DIAGNOSTICS]` payload from the race-loop core plus
 * each subsystem contributor. The spread order below is the emitted JSON key
 * order — contributors append their own keys, they never rename shared ones.
 */
export function buildDiagnosticsReport(
  core: DiagnosticsReportInput,
  contributors: DiagnosticsContributors,
) {
  const elapsedSeconds = core.elapsedMs / 1000;
  return {
    ...courseFields(contributors.course),
    ...renderFields(contributors.renderer),
    frameMs: Number(core.frameMs.toFixed(2)),
    p95FrameMs: Number(core.p95FrameMs.toFixed(2)),
    maxFrameMs: Number(core.maxFrameMs.toFixed(2)),
    phase: core.phase,
    controlMode: core.autopilot ? "autopilot" : "manual",
    sector: contributors.course.sectorLabelAt(core.progress),
    distanceMeters: Math.round(core.progress * contributors.course.length),
    speedKph: Number((core.speed * 3.6).toFixed(1)),
    lateralMeters: Number(core.lateral.toFixed(2)),
    steer: Number(core.steerAmount.toFixed(3)),
    drifting: core.driftActive,
    driftIntensity: Number(core.driftIntensity.toFixed(2)),
    surfaceGrip: Number(core.surfaceGrip.toFixed(2)),
    boostActive: core.boostActive,
    boostLocked: core.boostLocked,
    wrongWay: core.wrongWayActive,
    courseAlignment: Number(core.courseAlignment.toFixed(2)),
    nextCheckpoint: core.nextCheckpointIndex,
    raceSeed: RACE_SEED,
    fieldSize: core.racerCount,
    playerPosition: core.playerPosition,
    positionChanges: core.positionChanges,
    positionsGained: core.positionsGained,
    positionsLost: core.positionsLost,
    finalClassification: core.finalStandings.map((standing) => ({
      position: standing.position,
      name: standing.name,
      player: standing.player,
      finishTimeMs: Math.round(standing.finishTimeMs),
      gapMs: Math.round(standing.gapMs),
    })),
    ...rivalFields(contributors.rivals, elapsedSeconds),
    ...apronFields(contributors.apron),
    averageSpeedKph: elapsedSeconds > 0
      ? Number((core.distanceTravelled / elapsedSeconds * 3.6).toFixed(1))
      : 0,
    topSpeedKph: Number((core.topSpeed * 3.6).toFixed(1)),
    lapTimesMs: core.lapTimesMs.map((lapTime) => Math.round(lapTime)),
    boostSeconds: Number(core.boostSeconds.toFixed(2)),
    driftSeconds: Number(core.driftSeconds.toFixed(2)),
    driftEntries: core.driftEntries,
    driftCharge: Number(core.driftCharge.toFixed(3)),
    driftRewards: core.driftRewards,
    driftRewardTotal: Number(core.driftRewardTotal.toFixed(2)),
    maxDriftIntensity: Number(core.maxDriftIntensity.toFixed(2)),
    minimumSurfaceGrip: Number(core.minimumSurfaceGrip.toFixed(3)),
    edgeSeconds: Number(core.edgeSeconds.toFixed(2)),
    wrongWaySeconds: Number(core.wrongWaySeconds.toFixed(2)),
    wrongWayEntries: core.wrongWayEntries,
    minimumCameraFov: Number(core.minimumCameraFov.toFixed(2)),
    maximumCameraFov: Number(core.maximumCameraFov.toFixed(2)),
    maximumBrakeFovCompression: Number(
      core.maximumBrakeFovCompression.toFixed(2),
    ),
    impacts: core.impacts,
    impactSparkBursts: core.sparkBursts,
    missedGates: core.missedGates,
    impactLocations: core.impactLocations,
    recoveries: core.recoveries,
    contextLost: core.contextLost,
    contextLosses: core.contextLosses,
    contextRestores: core.contextRestores,
    renderedFrames: core.renderedFrames,
    idleFramesSkipped: core.idleFramesSkipped,
    presentationProjectionQueries: core.presentationProjectionQueries,
    atmosphereUpdates: core.atmosphereUpdates,
    atmosphereHz: elapsedSeconds > 0
      ? Number((core.atmosphereUpdates / elapsedSeconds).toFixed(1))
      : 0,
    recoveryLocations: core.recoveryLocations,
    maxLateralRatio: Number(core.maxLateralRatio.toFixed(2)),
    physicsSteps: core.physicsSteps,
    ...audioFields(contributors.audio),
    startupReadyMs: Number(core.startupReadyMs.toFixed(1)),
    courseAssemblyMs: Number(core.courseAssemblyMs.toFixed(1)),
    vehicleLoadStartedMs: Number(core.vehicleLoadStartedMs.toFixed(1)),
    vehicleLoadMs: Number(core.vehicleLoadMs.toFixed(1)),
    vehicleRequestStartMs: core.vehicleRequestStartMs === null
      ? null
      : Number(core.vehicleRequestStartMs.toFixed(1)),
    vehicleResourceRequests: core.vehicleResourceRequests,
    ...contributors.assetKit,
    ...contributors.environment,
    ...contributors.livingWorld,
    ...contributors.surfaceCharacter,
    ...contributors.minimap,
    ...contributors.atmosphere,
    ...contributors.ps2,
    pixelRatio: Number(core.pixelRatio.toFixed(2)),
    preferredPixelRatio: Number(core.preferredPixelRatio.toFixed(2)),
    minimumPixelRatio: Number(core.minimumPixelRatio.toFixed(2)),
    internalWidth: contributors.renderer.domElement.width,
    internalHeight: contributors.renderer.domElement.height,
    qualityMode: core.qualityMode,
    reducedMotion: core.reducedMotion,
    ps2CourseMaterials: core.ps2CourseMaterials,
    ps2CourseTextures: core.ps2CourseTextures,
    heapMb: core.heapMb === null ? null : Number(core.heapMb.toFixed(1)),
    maxHeapMb: core.maxHeapMb === null
      ? null
      : Number(core.maxHeapMb.toFixed(1)),
    heapGrowthMb: core.heapMb === null || core.startHeapMb === null
      ? null
      : Number((core.heapMb - core.startHeapMb).toFixed(1)),
  };
}

/**
 * Frame-time sampling, the per-race peak window and the emitted
 * `[FUTURISMA_DIAGNOSTICS]` line.
 */
export class RaceDiagnostics {
  private readonly frameSamples = new Float32Array(FRAME_SAMPLE_WINDOW);
  private frameIndex = 0;
  private frameCount = 0;
  private maxFrameMs = 0;
  private smoothedFrameMs = 16.67;
  private nextReportAt = 0;
  private startHeapMb: number | null = null;
  private maxHeapMb: number | null = null;
  private finalReported = false;
  private readonly output: HTMLOutputElement | null = null;
  private readonly peak = {
    calls: 0,
    triangles: 0,
    geometries: 0,
    textures: 0,
    environmentGroups: 0,
    environmentTriangles: 0,
    frameMs: 0,
    phase: "standby",
    sector: "",
    distanceMeters: 0,
  };

  constructor(enabled: boolean) {
    if (!enabled) return;
    this.output = document.createElement("output");
    this.output.id = "futurisma-diagnostics";
    this.output.hidden = true;
    document.body.append(this.output);
  }

  /** Records the frame sample and reports whether a report is due this frame. */
  sample(delta: number, now: number): boolean {
    if (this.finalReported) return false;
    const frameMs = delta * 1000;
    this.frameSamples[this.frameIndex] = frameMs;
    this.frameIndex = (this.frameIndex + 1) % this.frameSamples.length;
    this.frameCount = Math.min(this.frameCount + 1, this.frameSamples.length);
    this.maxFrameMs = Math.max(this.maxFrameMs, frameMs);
    this.smoothedFrameMs = THREE.MathUtils.lerp(this.smoothedFrameMs, frameMs, 0.06);
    if (now < this.nextReportAt) return false;
    this.nextReportAt = now + 1;
    return true;
  }

  /** Forces the next sampled frame to emit a report. */
  requestImmediateReport(): void {
    this.nextReportAt = 0;
  }

  report(core: DiagnosticsCore, contributors: DiagnosticsContributors): void {
    const frameWindow = Array.from(
      this.frameSamples.subarray(0, this.frameCount),
    ).sort((a, b) => a - b);
    const p95FrameMs = frameWindow.length > 0
      ? frameWindow[Math.min(frameWindow.length - 1, Math.floor(frameWindow.length * 0.95))]
      : 0;
    const heapMb = readHeapMb();
    if (heapMb !== null) {
      this.maxHeapMb = Math.max(this.maxHeapMb ?? heapMb, heapMb);
    }
    const report = buildDiagnosticsReport(
      {
        ...core,
        frameMs: this.smoothedFrameMs,
        p95FrameMs,
        maxFrameMs: this.maxFrameMs,
        heapMb,
        maxHeapMb: this.maxHeapMb,
        startHeapMb: this.startHeapMb,
      },
      contributors,
    );
    if (report.calls >= this.peak.calls) {
      this.peak.calls = report.calls;
      this.peak.phase = report.phase;
      this.peak.sector = report.sector;
      this.peak.distanceMeters = report.distanceMeters;
    }
    this.peak.triangles = Math.max(this.peak.triangles, report.triangles);
    this.peak.geometries = Math.max(this.peak.geometries, report.geometries);
    this.peak.textures = Math.max(this.peak.textures, report.textures);
    this.peak.environmentGroups = Math.max(
      this.peak.environmentGroups,
      report.environmentVisibleGroups,
    );
    this.peak.environmentTriangles = Math.max(
      this.peak.environmentTriangles,
      report.environmentVisibleTriangles,
    );
    this.peak.frameMs = Math.max(this.peak.frameMs, report.frameMs);
    if (this.output) {
      this.output.textContent = JSON.stringify({
        current: report,
        peak: this.peak,
      });
    }
    console.info("[FUTURISMA_DIAGNOSTICS]", JSON.stringify(report));
    // Keep diagnostics live through the short finish sting so the final
    // snapshot proves that every transient audio node released. This only
    // affects diagnostics mode; normal result presentation is unchanged.
    if (
      report.phase === "finished"
      && core.speed === 0
      && report.activeAudioOneShots === 0
    ) {
      this.finalReported = true;
    }
  }

  resetPeak(phase: string, sector: string, distanceMeters: number): void {
    this.peak.calls = 0;
    this.peak.triangles = 0;
    this.peak.geometries = 0;
    this.peak.textures = 0;
    this.peak.environmentGroups = 0;
    this.peak.environmentTriangles = 0;
    this.peak.frameMs = 0;
    this.peak.phase = phase;
    this.peak.sector = sector;
    this.peak.distanceMeters = distanceMeters;
    this.frameIndex = 0;
    this.frameCount = 0;
    this.maxFrameMs = 0;
    this.startHeapMb = readHeapMb();
    this.maxHeapMb = this.startHeapMb;
    this.finalReported = false;
  }

  dispose(): void {
    this.output?.remove();
  }
}
