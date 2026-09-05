import * as THREE from "three";
import { resolveAbilitySeed } from "./ability-seed";
import type { EngineAudio } from "./audio";
import type { CircuitRuntime } from "./circuit-runtime";
import type { CourseProjection } from "./course";
import type { InputController, InputFrame } from "./input";
import { integrateSurgeSpeed } from "./polarity-rules.js";
import { ABILITY_TICK_RATE, PolaritySimulation } from "./polarity-simulation.js";
import type { TidelineCourse, TidelineTravelMode } from "./tideline-course";
import { TIDELINE_ABILITY_CONFIG, TIDELINE_FIELDS, currentLane, inCurrent, tidelineFieldAt } from "./tideline-rules.js";
import { tideForLap } from "./tideline-tide.js";
import { TidelineWorld } from "./tideline-world";
import type { TotemVisualState } from "./totem";
import type { GameUi } from "./ui";

/** Stable horizon and shared power rules through the submerged reactor and port road. */
export class TidelineRuntime implements CircuitRuntime {
  readonly simulation: PolaritySimulation;
  readonly world: TidelineWorld;
  readonly ceiling = false;
  readonly isFlipping = false;
  private tickRemainder = 0;
  private handledSequence = 0;
  private cameraReady = false;
  private announcedLap = 1;
  private onShortcut = false;
  private shortcutSeconds = 0;
  private mode: TidelineTravelMode = "submerged";
  private readonly modeSeconds = { submerged: 0, surface: 0, air: 0 };
  private readonly cameraPosition = new THREE.Vector3();
  private readonly cameraLook = new THREE.Vector3();
  private readonly target = new THREE.Vector3();
  private readonly look = new THREE.Vector3();
  private readonly sample;
  private readonly hud = document.getElementById("polarity-hud")!;
  private readonly modeLabel = document.getElementById("polarity-deck")!;
  private readonly travelLabel = document.getElementById("polarity-flip")!;
  private readonly powerLabel = document.getElementById("polarity-power")!;
  private readonly routeLabel = document.getElementById("polarity-route")!;
  private readonly chargeFill = document.getElementById("power-charge-fill");
  private readonly diagnosticsOutput: HTMLOutputElement | null;

  constructor(readonly course: TidelineCourse, private readonly input: InputController,
    private readonly audio: EngineAudio, private readonly ui: GameUi, private readonly reducedMotion: boolean,
    seed = resolveAbilitySeed()) {
    this.simulation = new PolaritySimulation(TIDELINE_ABILITY_CONFIG, seed);
    this.sample = course.createSampleScratch();
    input.setPowerControls(true);
    this.world = new TidelineWorld(course);
    course.group.add(this.world.root);
    this.hud.hidden = false;
    this.diagnosticsOutput = new URLSearchParams(location.search).has("diagnostics") ? document.createElement("output") : null;
    if (this.diagnosticsOutput) {
      this.diagnosticsOutput.id = "tideline-diagnostics";
      this.diagnosticsOutput.hidden = true;
      document.body.append(this.diagnosticsOutput);
    }
    this.updateHud(course.startProgress);
  }

  get ready(): Promise<void> { return this.world.ready; }
  get surgeActive(): boolean { return this.simulation.surgeActive; }
  get shieldActive(): boolean { return this.simulation.shieldActive; }
  private get ridingCurrent(): boolean {
    const s = this.simulation.state;
    return tideForLap(s.lap).current && inCurrent(s.progress) && Math.abs(s.lateral - currentLane(s.seed, s.lap)) < 2.2;
  }
  get boostRechargeScale(): number { return this.ridingCurrent ? 1.85 : 1; }

  handleActions(running: boolean, progress: number, _position: THREE.Vector3, _lateral: number, demo: boolean): boolean {
    const power = this.input.consumePower();
    if (!running) return false;
    if (power) this.usePower(progress);
    if (demo && this.simulation.heldPowerKind && !this.simulation.state.activePower) {
      const fieldAhead = TIDELINE_FIELDS.some(field => field.progress > progress && field.progress - progress < .025);
      if (this.simulation.heldPowerKind === "shield" ? fieldAhead : this.simulation.launchZoneAt(progress)) this.usePower(progress);
    }
    return false;
  }

  step(delta: number, progress: number, lateral: number, lap: number): void {
    const ticks = this.takeTicks(delta);
    this.course.setLapBoard(lap);
    this.course.advanceTide(ticks / ABILITY_TICK_RATE);
    if (lap !== this.announcedLap) {
      this.announcedLap = lap;
      this.audio.playTideDrain();
      this.ui.flashHazard(lap === 2 ? "TIDE FALLING · DAMP CHAMBER DECK / LOWER GRIP" : "TIDE DRAINED · PUMP HALL SHORTCUT OPEN", 4200);
    }
    this.mode = this.course.travelModeAt(progress);
    this.modeSeconds[this.mode] += ticks / ABILITY_TICK_RATE;
    if (this.onShortcut) this.shortcutSeconds += ticks / ABILITY_TICK_RATE;
    for (let i = 0; i < ticks; i++) this.simulation.step(progress, lateral, lap);
    this.dispatchEvents();
  }
  advanceClocks(delta: number): void { this.simulation.advanceTicks(this.takeTicks(delta)); }
  private takeTicks(delta: number): number {
    this.tickRemainder += Math.max(0, Math.min(delta, .25)) * ABILITY_TICK_RATE;
    const ticks = Math.floor(this.tickRemainder + 1e-7);
    this.tickRemainder = Math.max(0, this.tickRemainder - ticks);
    return ticks;
  }
  applySurge(previous: number, normal: number, input: InputFrame, delta: number): number {
    return integrateSurgeSpeed(previous, normal, input.throttle, input.brake, this.surgeActive, delta);
  }
  onShieldImpact(progress: number, lateral: number): number {
    const field = tidelineFieldAt(progress, lateral, this.course.length);
    const refund = field ? this.simulation.onShieldImpact(field.id) : 0;
    this.dispatchEvents();
    return refund;
  }

  present(_sample: CourseProjection, _position: THREE.Vector3, _forward: THREE.Vector3, state: TotemVisualState): void {
    const s = this.simulation.state;
    this.onShortcut = _sample.alternateRoad === true;
    state.gravitySign = 1; state.gravityTransition = 0;
    state.shieldActive = this.shieldActive; state.overdriveActive = this.surgeActive;
    state.powerReady = this.simulation.heldPowerKind !== null;
    state.heldPowerKind = this.simulation.heldPowerKind;
    state.powerCharge = s.activePower ? s.activeCharge : this.simulation.heldPowerCharge;
    state.powerActivation = s.activePower ? Math.min(1, (s.tick - s.powerStartTick) / (ABILITY_TICK_RATE * .22)) : 0;
    this.world.update(s.tick / ABILITY_TICK_RATE, this.reducedMotion, this.simulation.getPickupStates(), s.progress, s.seed, s.lap);
  }

  updateCamera(camera: THREE.PerspectiveCamera, delta: number, position: THREE.Vector3, forward: THREE.Vector3, speed: number): void {
    this.target.copy(position).addScaledVector(forward, -11.5); this.target.y += 4.8;
    this.look.copy(position).addScaledVector(forward, 15 + speed * .04); this.look.y += 1.15;
    const response = this.cameraReady ? 1 - Math.exp(-delta * 8) : 1;
    this.cameraPosition.lerp(this.target, response); this.cameraLook.lerp(this.look, response);
    camera.position.copy(this.cameraPosition); camera.up.set(0, 1, 0); camera.lookAt(this.cameraLook);
    camera.fov = THREE.MathUtils.lerp(camera.fov, this.reducedMotion ? 62 : 59 + Math.min(1, speed / 140) * 7, response);
    camera.updateProjectionMatrix(); this.cameraReady = true;
    this.world.sky.update(camera, this.course.tide.waterLevel, this.reducedMotion ? 0 : this.course.tide.elapsed);
  }

  updateHud(progress: number): void {
    const s = this.simulation.state;
    const mode = this.course.travelModeAt(progress);
    const height = this.course.sample(progress, this.sample).position.y;
    const perfectReady = this.simulation.heldPowerKind === "surge" && Boolean(this.simulation.launchZoneAt(progress));
    const label = (s.activePower ?? this.simulation.heldPowerKind) === "surge" ? "SURGE" : "PHASE SHIELD";
    this.modeLabel.textContent = `LAP ${s.lap} / ${tideForLap(s.lap).label}`;
    this.travelLabel.textContent = mode === "submerged"
      ? this.ridingCurrent ? "CURRENT HARVEST / 1.85× RECHARGE" : tideForLap(s.lap).current ? "LIT CURRENT / FASTER RECHARGE" : "REACTOR DRAINING / WATCH THE WATERLINE"
      : s.lap === 2 && height < -3 ? "DAMP DECK / BRAKE BEFORE TURNING" : "SPACE / NITRO";
    this.powerLabel.textContent = s.activePower ? `${s.powerPerfect ? "PERFECT " : ""}${label} ${this.simulation.powerSeconds.toFixed(1)}s`
      : this.simulation.heldPowerKind ? `E / ${label}${perfectReady ? " · PERFECT NOW" : ""}` : "COLLECT A POWER CAPSULE";
    if (this.chargeFill) this.chargeFill.style.transform = `scaleX(${s.activePower ? s.activeCharge : this.simulation.heldPowerCharge})`;
    const tide = tideForLap(s.lap);
    this.routeLabel.textContent = perfectReady ? "SURGE WINDOW / E FOR +1s"
      : `1 FLOODED → 2 SLICK → 3 PUMP HALL${tide.shortcut ? " / CUT OPEN" : ""}`;
    this.hud.dataset.deck = "lower"; this.hud.dataset.ready = this.simulation.heldPowerKind ? "true" : "false";
    if (this.diagnosticsOutput) this.diagnosticsOutput.textContent = JSON.stringify({
      tide: this.course.tide, onShortcut: this.onShortcut, shortcutSeconds: this.shortcutSeconds, grip: this.course.surfaceGripAt(progress, s.lateral), mode, height, modeSeconds: this.modeSeconds, seed: s.seed, tick: s.tick, pickups: s.pickups, powersUsed: s.powersUsed,
      perfectActivations: s.perfectActivations, shieldAbsorptions: s.shieldAbsorptions, activePower: s.activePower,
      heldPower: this.simulation.heldPowerKind, powerTime: this.simulation.powerSeconds, ridingCurrent: this.ridingCurrent,
      rechargeScale: this.boostRechargeScale, supply: this.simulation.patternForLap(s.lap), currentLane: currentLane(s.seed, s.lap),
    });
  }

  recover(progress: number): void {
    this.simulation.recover(progress); this.handledSequence = this.simulation.state.eventSequence;
    this.mode = this.course.travelModeAt(progress); this.cameraReady = false;
  }
  reset(): void {
    this.simulation.reset(); this.tickRemainder = 0; this.handledSequence = 0; this.cameraReady = false;
    this.onShortcut = false; this.shortcutSeconds = 0;
    this.announcedLap = 1; this.course.setLapBoard(1); this.course.tide.elapsed = 0; this.course.advanceTide(0);
    this.mode = "submerged"; this.modeSeconds.submerged = 0; this.modeSeconds.surface = 0; this.modeSeconds.air = 0;
    this.input.consumePower();
  }
  dispose(): void { this.world.dispose(); this.diagnosticsOutput?.remove(); this.hud.hidden = true; }
  private usePower(progress: number): void {
    if (!this.simulation.requestPower(progress).ok) { this.audio.playPowerDenied(); return; }
    this.dispatchEvents();
  }
  private dispatchEvents(): void {
    for (const event of this.simulation.state.events) {
      if (event.sequence <= this.handledSequence) continue;
      this.handledSequence = event.sequence;
      if (event.type === "pickup") {
        this.audio.playPowerPickup(); this.ui.flashHazard(`${event.kind === "surge" ? "SURGE TURBINE" : "PHASE PROJECTOR"} ACQUIRED · PRESS E`, 1700);
      } else if (event.type === "power" && event.kind) {
        this.audio.playPowerActivate(event.kind); this.input.pulse(.3, .5, 130);
        this.ui.flashHazard(event.perfect ? "PERFECT LAUNCH · +1s SURGE" : event.kind === "surge" ? "SURGE · HOLD THRUST" : "PHASE SHIELD ONLINE", 1400);
      } else if (event.type === "absorb") {
        this.audio.playPowerPickup();
        this.ui.flashHazard(event.perfect ? "PERFECT SHIELD · +2s / NITRO RETURNED" : "BULKHEAD ABSORBED · NITRO RETURNED", 1600);
      }
    }
  }
}
