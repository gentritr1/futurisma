import { FLIP_SECONDS, FLIP_COOLDOWN_SECONDS, SURGE_SECONDS, SHIELD_SECONDS,
  TRANSFER_WINDOWS, crossedPickup, smoothTransfer } from "./polarity-rules.js";

/** @typedef {import('./polarity-rules.js').PowerKind} PowerKind */
/** @typedef {import('./polarity-rules.js').TransferWindow} TransferWindow */
/** @typedef {{id:string,progress:number,lane:0|1,lateral:number,kind:PowerKind,alternateKind?:PowerKind,charge?:number}} AbilityPickup */
/** @typedef {{id:string,from:number,to:number,lane:0|1}} LaunchZone */
/** @typedef {{id:string,allowGravity:boolean,pickups:readonly AbilityPickup[],launchZones:readonly LaunchZone[],transferWindows?:readonly TransferWindow[],fieldIds?:readonly string[]}} PowerCourseConfig */
/** @typedef {{kind:PowerKind,available:boolean,charge:number}} PickupState */
/** @typedef {{id:string,sequence:number,tick:number,type:'flip'|'pickup'|'power'|'absorb'|'recover',lap:number,lane:0|1,index:number,kind:PowerKind|null,perfect:boolean,refund:number}} AbilityEvent */
/** @typedef {{version:1,configId:string,configHash:string,seed:number,tick:number,lap:number,progress:number,lateral:number,lane:0|1,fromLane:0|1,flipStartTick:number,nextFlipTick:number,heldPower:PowerKind|null,heldCharge:number,activePower:PowerKind|null,activeCharge:number,powerStartTick:number,powerUntilTick:number,powerPerfect:boolean,collectedLaps:number[],usedWindowLaps:number[],shieldRewardLaps:Record<string,number>,flips:number,pickups:number,powersUsed:number,perfectActivations:number,shieldAbsorptions:number,upperTicks:number,eventSequence:number,events:AbilityEvent[]}} AbilityState */
/** @typedef {{ok:boolean,reason:string,event?:AbilityEvent}} AbilityResult */

export const ABILITY_TICK_RATE = 120;
export const PERFECT_SHIELD_TICKS = 144;
const FLIP_TICKS = Math.round(FLIP_SECONDS * ABILITY_TICK_RATE);
const COOLDOWN_TICKS = Math.round(FLIP_COOLDOWN_SECONDS * ABILITY_TICK_RATE);

/** @param {string} text */
function hash(text) {
  let value = 2166136261;
  for (let i = 0; i < text.length; i++) value = Math.imul(value ^ text.charCodeAt(i), 16777619);
  return value >>> 0;
}
/** @param {unknown} value @param {number} min @param {number} max */
function integer(value, min, max) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max;
}
/** @param {unknown} value */
function power(value) { return value === null || value === "surge" || value === "shield"; }
/** @param {number} value */
function wrap(value) { return ((value % 1) + 1) % 1; }

/**
 * Pure fixed-tick ability state. It knows no DOM, audio, renderer or wall clock.
 * Commands can be replayed with the same configuration and seed; snapshots are
 * validated before replacing live state. This is the ability protocol only,
 * not a claim that the vehicle physics or online transport is implemented here.
 */
export class PolaritySimulation {
  /** @param {PowerCourseConfig} config @param {number} seed */
  constructor(config, seed = 0x714) {
    if (!validConfig(config) || !integer(seed, 0, 0xffffffff)) throw new Error("Invalid ability configuration or seed.");
    this.config = /** @type {PowerCourseConfig} */ (JSON.parse(JSON.stringify(config)));
    this.configHash = hash(JSON.stringify(config)).toString(16);
    this.windows = this.config.transferWindows ?? [];
    this.fieldIds = this.config.fieldIds ?? [];
    /** @type {AbilityState} */
    this.state = this.createState(seed);
  }

  /** @param {number} seed @returns {AbilityState} */
  createState(seed) {
    return { version: 1, configId: this.config.id, configHash: this.configHash, seed,
      tick: 0, lap: 1, progress: .002, lateral: 0, lane: 0, fromLane: 0,
      flipStartTick: -FLIP_TICKS, nextFlipTick: 0,
      heldPower: null, heldCharge: 0, activePower: null, activeCharge: 0,
      powerStartTick: 0, powerUntilTick: 0, powerPerfect: false,
      collectedLaps: this.config.pickups.map(() => 0), usedWindowLaps: this.windows.map(() => 0),
      shieldRewardLaps: {}, flips: 0, pickups: 0, powersUsed: 0,
      perfectActivations: 0, shieldAbsorptions: 0, upperTicks: 0, eventSequence: 0, events: [] };
  }
  get isFlipping() { return this.state.tick - this.state.flipStartTick < FLIP_TICKS; }
  get blend() { return this.state.fromLane + (this.state.lane - this.state.fromLane)
    * smoothTransfer((this.state.tick - this.state.flipStartTick) / FLIP_TICKS); }
  get cooldownSeconds() { return Math.max(0, this.state.nextFlipTick - this.state.tick) / ABILITY_TICK_RATE; }
  get heldPowerKind() { return this.state.heldPower; }
  get heldPowerCharge() { return this.state.heldCharge; }
  get powerSeconds() { return Math.max(0, this.state.powerUntilTick - this.state.tick) / ABILITY_TICK_RATE; }
  get shieldActive() { return this.state.activePower === "shield"; }
  get surgeActive() { return this.state.activePower === "surge"; }
  get boostRechargeScale() { return this.state.lane === 0 ? 1.15 : .55; }

  /** The two supply manifests are known before the lap starts. @param {number} lap */
  patternForLap(lap) { return (hash(`${this.state.seed}:${this.config.id}:supply`) + lap - 1) % 2; }
  /** One seeded express route per race keeps both deck holds above six seconds. @param {number} _lap */
  demoExcursion(_lap) { return hash(`${this.state.seed}:route`) % 2; }
  /** @param {number} index @param {number} lap @returns {PowerKind} */
  pickupKind(index, lap) {
    const pickup = this.config.pickups[index];
    return this.patternForLap(lap) === 1 && pickup.alternateKind ? pickup.alternateKind : pickup.kind;
  }
  /** @param {number} lap @returns {PickupState[]} */
  getPickupStates(lap = this.state.lap) {
    return this.config.pickups.map((pickup, index) => ({ kind: this.pickupKind(index, lap),
      available: this.state.collectedLaps[index] !== lap, charge: pickup.charge ?? (pickup.lane ? .65 : 1) }));
  }
  /** @param {number} progress */
  launchZoneAt(progress) {
    const p = wrap(progress);
    return this.config.launchZones.find(zone => zone.lane === this.state.lane && p >= zone.from && p < zone.to);
  }
  /** @param {number} progress @param {number} lateral */
  getTransferStatus(progress, lateral = this.state.lateral) {
    const p = wrap(progress);
    const index = this.windows.findIndex(window => p >= window.from && p < window.to);
    const window = this.windows[index];
    let reason = "WAIT FOR A ROUTE JUNCTION";
    if (!this.config.allowGravity) reason = "GRAVITY TRANSFER UNAVAILABLE";
    else if (this.isFlipping) reason = "TRANSFER IN PROGRESS";
    else if (this.cooldownSeconds > 0) reason = `HOLD COURSE ${this.cooldownSeconds.toFixed(1)}s`;
    else if (window && this.state.usedWindowLaps[index] === this.state.lap) reason = "JUNCTION USED · COMMIT TO THIS ROUTE";
    else if (window && window.fromLane !== this.state.lane) reason = this.state.lane ? "STAY UPPER · EXIT AHEAD" : "STAY LOWER · ENTRY AHEAD";
    else if (window && this.state.lane === 0 && Math.abs(lateral) > 5.7) reason = "CENTRE THE SHIP TO TRANSFER";
    else if (window) reason = "READY";
    return { ready: reason === "READY", reason, index, window };
  }
  /** @param {number} progress @param {number} lateral @param {boolean} geometrySafe @returns {AbilityResult} */
  requestFlip(progress, lateral, geometrySafe = true) {
    if (!Number.isFinite(progress) || !Number.isFinite(lateral)) return { ok: false, reason: "INVALID TRANSFER POSITION" };
    const status = this.getTransferStatus(progress, lateral);
    if (!status.ready || !status.window) return { ok: false, reason: status.reason };
    if (!geometrySafe) return { ok: false, reason: "WAIT FOR THE ALIGNED TRANSFER STRIP" };
    const state = this.state;
    state.fromLane = state.lane;
    state.lane = status.window.toLane;
    state.flipStartTick = state.tick;
    state.nextFlipTick = state.tick + COOLDOWN_TICKS;
    state.usedWindowLaps[status.index] = state.lap;
    state.flips++;
    return { ok: true, reason: "TRANSFER", event: this.emit("flip", status.index) };
  }
  /** @param {number} progress @returns {AbilityResult} */
  requestPower(progress = this.state.progress) {
    if (!Number.isFinite(progress)) return { ok: false, reason: "INVALID POWER POSITION" };
    const state = this.state;
    if (!state.heldPower) return { ok: false, reason: "COLLECT A POWER CAPSULE" };
    if (state.activePower) return { ok: false, reason: "POWER ALREADY ACTIVE" };
    state.activePower = state.heldPower;
    state.activeCharge = state.heldCharge;
    state.heldPower = null; state.heldCharge = 0;
    state.powerPerfect = state.activePower === "surge" && Boolean(this.launchZoneAt(progress));
    const seconds = state.activePower === "shield" ? SHIELD_SECONDS
      : SURGE_SECONDS * (.8 + .2 * state.activeCharge) + (state.powerPerfect ? 1 : 0);
    state.powerStartTick = state.tick;
    state.powerUntilTick = state.tick + Math.round(seconds * ABILITY_TICK_RATE);
    state.powersUsed++;
    if (state.powerPerfect) state.perfectActivations++;
    return { ok: true, reason: state.powerPerfect ? "PERFECT LAUNCH" : "POWER ACTIVE",
      event: this.emit("power", -1, state.activePower, state.powerPerfect) };
  }
  /** Exactly one authoritative 120 Hz tick. @param {number} progress @param {number} lateral @param {number} lap */
  step(progress, lateral, lap) {
    if (!Number.isFinite(progress) || !Number.isFinite(lateral) || Math.abs(lateral) > 1000
      || !integer(lap, this.state.lap, Math.min(999, this.state.lap + 1))) throw new Error("Invalid ability step.");
    this.advanceTicks(1);
    const state = this.state, previous = state.progress;
    state.progress = wrap(progress); state.lateral = lateral; state.lap = lap;
    if (state.heldPower || this.isFlipping) return;
    for (let index = 0; index < this.config.pickups.length; index++) {
      const pickup = this.config.pickups[index];
      if (pickup.lane !== state.lane || state.collectedLaps[index] === lap || Math.abs(lateral - pickup.lateral) > 3.2) continue;
      if (!crossedPickup(previous, state.progress, pickup.progress)) continue;
      state.heldPower = this.pickupKind(index, lap);
      state.heldCharge = pickup.charge ?? (pickup.lane ? .65 : 1);
      state.collectedLaps[index] = lap;
      state.pickups++;
      this.emit("pickup", index, state.heldPower);
      break;
    }
  }
  /** Coast advances clocks without collecting or changing race progress. @param {number} count */
  advanceTicks(count) {
    if (!integer(count, 0, 1200)) throw new Error("Invalid ability tick count.");
    const state = this.state;
    state.tick += count;
    if (state.lane) state.upperTicks += count;
    if (state.activePower && state.tick >= state.powerUntilTick) {
      state.activePower = null; state.activeCharge = 0; state.powerPerfect = false;
    }
  }
  /** Award one field/lap; timing the shield's first 1.2 s earns the stronger return. @param {string} fieldId */
  onShieldImpact(fieldId) {
    const state = this.state;
    if (!this.shieldActive || !this.fieldIds.includes(fieldId) || state.shieldRewardLaps[fieldId] === state.lap) return 0;
    const perfect = state.tick - state.powerStartTick <= PERFECT_SHIELD_TICKS;
    const refund = perfect ? .18 : .06;
    state.shieldRewardLaps[fieldId] = state.lap;
    state.shieldAbsorptions++;
    if (perfect) {
      state.perfectActivations++;
      state.powerUntilTick = Math.min(state.powerUntilTick + 2 * ABILITY_TICK_RATE, state.tick + 7 * ABILITY_TICK_RATE);
    }
    this.emit("absorb", this.fieldIds.indexOf(fieldId), "shield", perfect, refund);
    return refund;
  }
  /** @param {number} progress */
  recover(progress) {
    if (!Number.isFinite(progress)) throw new Error("Invalid recovery progress.");
    const state = this.state;
    state.lane = 0; state.fromLane = 0; state.flipStartTick = state.tick - FLIP_TICKS;
    state.nextFlipTick = state.tick + COOLDOWN_TICKS;
    state.activePower = null; state.activeCharge = 0; state.powerPerfect = false; state.powerUntilTick = state.tick;
    state.progress = wrap(progress); state.lateral = 0;
    this.emit("recover");
  }
  /** @param {number} seed */
  reset(seed = this.state.seed) {
    if (!integer(seed, 0, 0xffffffff)) throw new Error("Invalid race seed.");
    this.state = this.createState(seed);
  }
  /** @param {AbilityEvent['type']} type @param {number} index @param {PowerKind|null} kind @param {boolean} perfect @param {number} refund */
  emit(type, index = -1, kind = null, perfect = false, refund = 0) {
    const state = this.state;
    const sequence = ++state.eventSequence;
    const event = { id: `${state.configId}:${state.seed.toString(16)}:${sequence}`, sequence,
      tick: state.tick, type, lap: state.lap, lane: state.lane, index, kind, perfect, refund };
    state.events.push(event);
    if (state.events.length > 32) state.events.shift();
    return event;
  }
  /** @returns {AbilityState} */
  snapshot() { return JSON.parse(JSON.stringify(this.state)); }
  /** Atomic replacement: failed validation leaves the current race intact. @param {unknown} snapshot */
  restore(snapshot) {
    if (!validSnapshot(snapshot, this.config, this.configHash)) throw new Error("Invalid or incompatible ability snapshot.");
    this.state = JSON.parse(JSON.stringify(snapshot));
  }
}

/** Configuration is authored data, but malformed room/map data must fail early. @param {PowerCourseConfig} config */
function validConfig(config) {
  if (!config || typeof config.id !== "string" || !/^[a-z0-9-]{1,80}$/.test(config.id)
    || typeof config.allowGravity !== "boolean" || !Array.isArray(config.pickups) || !Array.isArray(config.launchZones)) return false;
  const ids = new Set();
  for (const pickup of config.pickups) {
    if (!pickup || typeof pickup.id !== "string" || ids.has(pickup.id) || !pickup.id
      || !Number.isFinite(pickup.progress) || pickup.progress < 0 || pickup.progress >= 1
      || !integer(pickup.lane, 0, config.allowGravity ? 1 : 0) || !Number.isFinite(pickup.lateral)
      || !power(pickup.kind) || pickup.kind === null
      || pickup.alternateKind !== undefined && (!power(pickup.alternateKind) || pickup.alternateKind === null)
      || pickup.charge !== undefined && (!Number.isFinite(pickup.charge) || pickup.charge <= 0 || pickup.charge > 1)) return false;
    ids.add(pickup.id);
  }
  for (const zone of config.launchZones) {
    if (!zone || !zone.id || !Number.isFinite(zone.from) || !Number.isFinite(zone.to) || zone.from < 0
      || zone.to > 1 || zone.from >= zone.to || !integer(zone.lane, 0, config.allowGravity ? 1 : 0)) return false;
  }
  const windows = config.transferWindows ?? [];
  if (!Array.isArray(windows) || !config.allowGravity && windows.length > 0) return false;
  for (const window of windows) {
    if (!window || !window.id || !Number.isFinite(window.from) || !Number.isFinite(window.to) || window.from < 0
      || window.to > 1 || window.from >= window.to || !integer(window.fromLane, 0, 1)
      || !integer(window.toLane, 0, 1) || window.fromLane === window.toLane || !integer(window.excursion, 0, 1)) return false;
  }
  const fields = config.fieldIds ?? [];
  return Array.isArray(fields) && fields.every(id => typeof id === "string" && id.length > 0) && new Set(fields).size === fields.length;
}

/** @param {unknown} value @param {PowerCourseConfig} config @param {string} configHash @returns {value is AbilityState} */
function validSnapshot(value, config, configHash) {
  if (!value || typeof value !== "object") return false;
  const s = /** @type {AbilityState} */ (value);
  if (s.version !== 1 || s.configId !== config.id || s.configHash !== configHash) return false;
  if (!integer(s.seed, 0, 0xffffffff) || !integer(s.tick, 0, 1e9) || !integer(s.lap, 1, 999)) return false;
  if (!Number.isFinite(s.progress) || s.progress < 0 || s.progress >= 1 || !Number.isFinite(s.lateral) || Math.abs(s.lateral) > 1000) return false;
  if (!integer(s.lane, 0, config.allowGravity ? 1 : 0) || !integer(s.fromLane, 0, config.allowGravity ? 1 : 0)) return false;
  if (!integer(s.flipStartTick, -FLIP_TICKS, s.tick) || !integer(s.nextFlipTick, 0, s.tick + COOLDOWN_TICKS)) return false;
  if (!power(s.heldPower) || !power(s.activePower) || typeof s.powerPerfect !== "boolean") return false;
  if (![s.heldCharge, s.activeCharge].every(n => Number.isFinite(n) && n >= 0 && n <= 1)) return false;
  if ((s.heldPower === null && s.heldCharge !== 0) || (s.activePower === null && s.activeCharge !== 0)) return false;
  if (s.heldPower !== null && s.heldCharge === 0 || s.activePower !== null && s.activeCharge === 0) return false;
  if (s.powerPerfect && s.activePower !== "surge") return false;
  if (!integer(s.powerStartTick, 0, s.tick) || !integer(s.powerUntilTick, 0, s.tick + 7 * ABILITY_TICK_RATE)) return false;
  if ((s.activePower !== null) !== (s.powerUntilTick > s.tick)) return false;
  for (const [array, length] of [[s.collectedLaps, config.pickups.length], [s.usedWindowLaps, config.transferWindows?.length ?? 0]]) {
    if (!Array.isArray(array) || array.length !== length || !array.every(n => integer(n, 0, s.lap))) return false;
  }
  if (!s.shieldRewardLaps || typeof s.shieldRewardLaps !== "object" || Array.isArray(s.shieldRewardLaps)) return false;
  for (const [id, lap] of Object.entries(s.shieldRewardLaps)) if (!(config.fieldIds ?? []).includes(id) || !integer(lap, 1, s.lap)) return false;
  for (const n of [s.flips, s.pickups, s.powersUsed, s.perfectActivations, s.shieldAbsorptions, s.upperTicks, s.eventSequence]) {
    if (!integer(n, 0, 1e9)) return false;
  }
  if (s.upperTicks > s.tick || !Array.isArray(s.events) || s.events.length > 32) return false;
  let previous = 0;
  for (const event of s.events) {
    if (!event || !integer(event.sequence, previous + 1, s.eventSequence) || !integer(event.tick, 0, s.tick)
      || !integer(event.lap, 1, s.lap) || !integer(event.lane, 0, 1) || !integer(event.index, -1, 1000)
      || !["flip", "pickup", "power", "absorb", "recover"].includes(event.type)
      || !power(event.kind) || typeof event.perfect !== "boolean" || ![0, .06, .18].includes(event.refund)
      || event.id !== `${s.configId}:${s.seed.toString(16)}:${event.sequence}`) return false;
    previous = event.sequence;
  }
  return s.events.length === 0 ? s.eventSequence === 0 : previous === s.eventSequence;
}

/** Stable capsule anchors shared with the scene; variations are telegraphed supply, never surprise hazards. @type {readonly AbilityPickup[]} */
export const POLARITY_PICKUPS = [
  { id: "ground-launch", progress: .035, lane: 0, lateral: 0, kind: "surge", charge: 1 },
  { id: "ground-crown", progress: .18, lane: 0, lateral: -3, kind: "shield", alternateKind: "surge", charge: 1 },
  { id: "ground-return", progress: .36, lane: 0, lateral: 2, kind: "surge", charge: 1 },
  { id: "ground-spine", progress: .54, lane: 0, lateral: 0, kind: "surge", alternateKind: "shield", charge: 1 },
  { id: "ground-home", progress: .73, lane: 0, lateral: -2, kind: "surge", charge: 1 },
  { id: "upper-crown-entry", progress: .095, lane: 1, lateral: 0, kind: "shield", charge: .65 },
  { id: "upper-crown-exit", progress: .255, lane: 1, lateral: 0, kind: "shield", alternateKind: "surge", charge: .65 },
  { id: "upper-spine", progress: .49, lane: 1, lateral: 0, kind: "shield", charge: .65 },
  { id: "upper-skyline", progress: .70, lane: 1, lateral: 0, kind: "shield", alternateKind: "surge", charge: .65 },
  { id: "upper-home", progress: .91, lane: 1, lateral: 0, kind: "shield", charge: .65 },
];
/** @type {PowerCourseConfig} */
export const POLARITY_ABILITY_CONFIG = {
  id: "polarity-abilities-v2", allowGravity: true, pickups: POLARITY_PICKUPS,
  transferWindows: TRANSFER_WINDOWS,
  launchZones: [
    { id: "crown-launch", from: .105, to: .12, lane: 0 },
    { id: "spine-launch", from: .52, to: .538, lane: 0 },
    { id: "home-launch", from: .895, to: .915, lane: 0 },
  ],
  fieldIds: ["phase-0", "phase-1", "phase-2", "phase-3", "phase-4"],
};
