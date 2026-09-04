import * as THREE from "three";
import { resolveAbilitySeed } from "./ability-seed";
import type { EngineAudio } from "./audio";
import type { CourseProjection } from "./course";
import type { InputController, InputFrame } from "./input";
import { POLARITY_BARRIERS, type PolarityCourse } from "./polarity-course";
import { CEILING_HEIGHT, FLIP_SECONDS, integrateSurgeSpeed } from "./polarity-rules.js";
import { ABILITY_TICK_RATE, POLARITY_ABILITY_CONFIG, PolaritySimulation } from "./polarity-simulation.js";
import { PolarityWorld } from "./polarity-world";
import type { TotemVisualState } from "./totem";
import type { GameUi } from "./ui";

/** Render/audio adapter around the deterministic ability state. */
export class PolarityRuntime {
  readonly world: PolarityWorld;
  readonly simulation: PolaritySimulation;
  private tickRemainder = 0;
  private handledSequence = 0;
  private cameraReady = false;
  private cameraDeck = 0;
  private readonly cameraPosition = new THREE.Vector3();
  private readonly cameraLook = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly target = new THREE.Vector3();
  private readonly look = new THREE.Vector3();
  private readonly hud = document.getElementById("polarity-hud")!;
  private readonly deckLabel = document.getElementById("polarity-deck")!;
  private readonly flipLabel = document.getElementById("polarity-flip")!;
  private readonly powerLabel = document.getElementById("polarity-power")!;
  private readonly routeLabel = document.getElementById("polarity-route")!;
  private readonly chargeFill = document.getElementById("power-charge-fill");
  private readonly veil = document.getElementById("gravity-veil");
  private readonly diagnosticsOutput: HTMLOutputElement | null;

  constructor(readonly course: PolarityCourse, private readonly input: InputController,
    private readonly audio: EngineAudio, private readonly ui: GameUi, private readonly reducedMotion: boolean,
    seed = resolveAbilitySeed()) {
    this.simulation = new PolaritySimulation(POLARITY_ABILITY_CONFIG, seed);
    input.setGravityControls(true);
    this.world = new PolarityWorld(course);
    course.group.add(this.world.root);
    this.hud.hidden = false;
    this.diagnosticsOutput = new URLSearchParams(location.search).has("diagnostics") ? document.createElement("output") : null;
    if (this.diagnosticsOutput) {
      this.diagnosticsOutput.id = "polarity-diagnostics";
      this.diagnosticsOutput.hidden = true;
      document.body.append(this.diagnosticsOutput);
    }
    this.updateHud(course.startProgress);
  }

  get ready(): Promise<void> { return this.world.ready; }
  get isFlipping(): boolean { return this.simulation.isFlipping; }
  get ceiling(): boolean { return this.simulation.state.lane === 1; }
  get blend(): number { return this.simulation.blend; }
  get surgeActive(): boolean { return this.simulation.surgeActive; }
  get shieldActive(): boolean { return this.simulation.shieldActive; }
  get boostRechargeScale(): number { return this.simulation.boostRechargeScale; }
  get heldPowerKind(): "surge" | "shield" | null { return this.simulation.heldPowerKind; }
  get heldPowerCharge(): number { return this.simulation.heldPowerCharge; }
  get flips(): number { return this.simulation.state.flips; }
  get pickups(): number { return this.simulation.state.pickups; }
  get powersUsed(): number { return this.simulation.state.powersUsed; }
  get upperSeconds(): number { return this.simulation.state.upperTicks / ABILITY_TICK_RATE; }
  private get presentationBlend(): number { return this.reducedMotion ? (this.blend < .5 ? 0 : 1) : this.blend; }

  handleActions(running: boolean, progress: number, position: THREE.Vector3, lateral: number, demo: boolean): boolean {
    const flip = this.input.consumeFlip();
    const power = this.input.consumePower();
    if (!running) return false;
    if (power) this.usePower(progress);
    if (demo && this.heldPowerKind && !this.simulation.state.activePower) {
      const fieldAhead = POLARITY_BARRIERS.some(field => field.lane === this.simulation.state.lane
        && field.progress - progress > 0 && field.progress - progress < .027);
      const launch = this.simulation.launchZoneAt(progress);
      // The demo saves ground Surge for painted strips, and shields for visible fields.
      if (this.heldPowerKind === "shield" ? fieldAhead : launch || this.ceiling && progress > .2) this.usePower(progress);
    }
    const status = this.simulation.getTransferStatus(progress, lateral);
    const demoFlip = demo && status.ready && status.window
      && (this.ceiling || status.window.excursion === this.simulation.demoExcursion(this.simulation.state.lap));
    if (!flip && !demoFlip) return false;
    const result = this.simulation.requestFlip(progress, lateral, this.course.transferAvailable(progress));
    if (!result.ok) {
      if (flip) { this.audio.playPowerDenied(); this.ui.flashHazard(result.reason, 1200); }
      return false;
    }
    this.course.lane = this.simulation.state.lane;
    position.y = this.course.lane * CEILING_HEIGHT;
    this.dispatchEvents();
    return true;
  }

  step(delta: number, progress: number, lateral: number, lap: number): void {
    const ticks = this.takeTicks(delta);
    for (let i = 0; i < ticks; i++) this.simulation.step(progress, lateral, lap);
    this.dispatchEvents();
  }
  /** Continue in-flight powers and transfer during the finish coast, without collecting. */
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
    const index = POLARITY_BARRIERS.findIndex(field => field.lane === this.simulation.state.lane
      && Math.abs(progress - field.progress) * this.course.length < 2.5
      && Math.abs(lateral - field.lateral) <= field.halfWidth);
    const refund = index < 0 ? 0 : this.simulation.onShieldImpact(`phase-${index}`);
    this.dispatchEvents();
    return refund;
  }

  present(sample: CourseProjection, position: THREE.Vector3, forward: THREE.Vector3, state: TotemVisualState): void {
    const blend = this.presentationBlend;
    const simulation = this.simulation.state;
    position.y = CEILING_HEIGHT * blend;
    sample.up.set(0, 1, 0).applyAxisAngle(forward, Math.PI * blend);
    sample.right.crossVectors(forward, sample.up).normalize();
    const flipProgress = Math.min(1, (simulation.tick - simulation.flipStartTick) / (FLIP_SECONDS * ABILITY_TICK_RATE));
    state.gravitySign = this.ceiling ? -1 : 1;
    state.gravityTransition = this.isFlipping ? Math.sin(Math.PI * flipProgress) : 0;
    state.shieldActive = this.shieldActive;
    state.overdriveActive = this.surgeActive;
    state.powerReady = this.heldPowerKind !== null;
    state.heldPowerKind = this.heldPowerKind;
    state.powerCharge = simulation.activePower ? simulation.activeCharge : this.heldPowerCharge;
    state.powerActivation = simulation.activePower
      ? Math.min(1, (simulation.tick - simulation.powerStartTick) / (ABILITY_TICK_RATE * .22)) : 0;
    // A reduced-motion transfer hides the instantaneous deck cut inside a held black frame.
    if (this.veil) this.veil.style.opacity = this.reducedMotion && this.isFlipping
      ? String(Math.max(0, Math.min(1, flipProgress / .3, (1 - flipProgress) / .3))) : "0";
    this.world.update(simulation.tick / ABILITY_TICK_RATE, this.reducedMotion, simulation.collectedLaps,
      simulation.lap, this.simulation.getPickupStates(), simulation.progress);
  }

  updateCamera(camera: THREE.PerspectiveCamera, delta: number, position: THREE.Vector3, forward: THREE.Vector3, speed: number): void {
    const blend = this.presentationBlend;
    if (this.reducedMotion && this.cameraDeck !== blend) this.cameraReady = false;
    this.cameraDeck = blend;
    this.up.set(0, 1, 0).applyAxisAngle(forward, Math.PI * blend);
    this.target.copy(position).addScaledVector(forward, -10.5).addScaledVector(this.up, 4.6);
    this.look.copy(position).addScaledVector(forward, 12 + speed * .06).addScaledVector(this.up, 1.05);
    const response = this.cameraReady ? 1 - Math.exp(-delta * 12) : 1;
    this.cameraPosition.lerp(this.target, response);
    this.cameraLook.lerp(this.look, response);
    camera.position.copy(this.cameraPosition);
    camera.up.copy(this.up);
    camera.lookAt(this.cameraLook);
    const fov = this.reducedMotion ? 62 : 57 + Math.min(1, speed / 140) * 12;
    camera.fov = THREE.MathUtils.lerp(camera.fov, fov, response);
    camera.updateProjectionMatrix();
    this.cameraReady = true;
  }

  updateHud(progress: number): void {
    const simulation = this.simulation.state;
    const status = this.simulation.getTransferStatus(progress);
    const available = status.ready && this.course.transferAvailable(progress);
    this.deckLabel.textContent = this.isFlipping ? "TRANSFERRING" : this.ceiling ? "UPPER EXPRESS" : "LOWER / FULL CHARGE";
    this.flipLabel.textContent = available ? `SPACE / ${this.ceiling ? "EXIT EXPRESS" : "TAKE EXPRESS"}`
      : this.isFlipping || this.simulation.cooldownSeconds > 0 || status.window ? status.reason
      : `JUNCTION IN ${Math.round(this.course.nextTransferDistance(progress))}m`;
    const perfectReady = this.heldPowerKind === "surge" && Boolean(this.simulation.launchZoneAt(progress));
    const label = (simulation.activePower ?? this.heldPowerKind) === "surge" ? "SURGE" : "PHASE SHIELD";
    this.powerLabel.textContent = simulation.activePower ? `${simulation.powerPerfect ? "PERFECT " : ""}${label} ${this.simulation.powerSeconds.toFixed(1)}s`
      : this.heldPowerKind ? `E / ${label}${perfectReady ? " · PERFECT NOW" : ""}` : "COLLECT A POWER CAPSULE";
    if (this.chargeFill) this.chargeFill.style.transform = `scaleX(${simulation.activePower ? simulation.activeCharge : this.heldPowerCharge})`;
    const shortcut = this.course.shortcutAt(progress);
    const supply = `SUPPLY ${this.simulation.patternForLap(simulation.lap) ? "B" : "A"}`;
    this.routeLabel.textContent = `${supply} · ${this.ceiling && shortcut ? `${shortcut.name} / −${Math.round(shortcut.savedMeters)}m`
      : perfectReady ? "LAUNCH STRIP / E FOR +1s SURGE" : "SHIFT / NITRO"}`;
    this.hud.dataset.deck = this.ceiling ? "upper" : "lower";
    this.hud.dataset.ready = this.heldPowerKind ? "true" : "false";
    if (this.diagnosticsOutput) this.diagnosticsOutput.textContent = JSON.stringify({
      lane: simulation.lane, blend: this.blend, flips: this.flips, pickups: this.pickups,
      powersUsed: this.powersUsed, activePower: simulation.activePower, heldPower: this.heldPowerKind,
      heldCharge: this.heldPowerCharge, powerTime: this.simulation.powerSeconds, cooldown: this.simulation.cooldownSeconds,
      upperSeconds: this.upperSeconds, transferAvailable: available, ceilingHeight: CEILING_HEIGHT,
      tick: simulation.tick, seed: simulation.seed, supply: this.simulation.patternForLap(simulation.lap),
      perfectActivations: simulation.perfectActivations, shieldAbsorptions: simulation.shieldAbsorptions,
      eventSequence: simulation.eventSequence,
    });
  }

  recover(progress: number): void {
    this.simulation.recover(progress);
    this.course.lane = 0; this.cameraReady = false;
    this.handledSequence = this.simulation.state.eventSequence;
    if (this.veil) this.veil.style.opacity = "0";
  }
  reset(): void {
    this.simulation.reset(); this.course.lane = 0;
    this.tickRemainder = 0; this.handledSequence = 0; this.cameraReady = false;
    this.input.consumeFlip(); this.input.consumePower();
    if (this.veil) this.veil.style.opacity = "0";
  }
  dispose(): void {
    this.world.dispose(); this.diagnosticsOutput?.remove(); this.hud.hidden = true;
    if (this.veil) this.veil.style.opacity = "0";
  }
  private usePower(progress: number): void {
    const result = this.simulation.requestPower(progress);
    if (!result.ok) { this.audio.playPowerDenied(); return; }
    this.dispatchEvents();
  }
  private dispatchEvents(): void {
    for (const event of this.simulation.state.events) {
      if (event.sequence <= this.handledSequence) continue;
      this.handledSequence = event.sequence;
      if (event.type === "flip") {
        this.audio.playGravityFlip(event.lane === 1); this.input.pulse(.35, .6, 180);
        this.ui.flashHazard(event.lane ? "UPPER EXPRESS · COMMIT TO YOUR LINE" : "LOWER POWER LINE · FULL RECHARGE", 1500);
      } else if (event.type === "pickup") {
        this.audio.playPowerPickup();
        this.ui.flashHazard(`${event.kind === "surge" ? "SURGE" : "PHASE SHIELD"} ACQUIRED · PRESS E`, 1700);
      } else if (event.type === "power" && event.kind) {
        this.audio.playPowerActivate(event.kind); this.input.pulse(.3, .5, 130);
        this.ui.flashHazard(event.perfect ? "PERFECT LAUNCH · +1s SURGE" : event.kind === "surge" ? "SURGE · HOLD THRUST" : "PHASE SHIELD ONLINE", 1400);
      } else if (event.type === "absorb") {
        this.audio.playPowerPickup();
        this.ui.flashHazard(event.perfect ? "PERFECT SHIELD · +2s / NITRO RETURNED" : "FIELD ABSORBED · NITRO RETURNED", 1600);
      }
    }
  }
}
