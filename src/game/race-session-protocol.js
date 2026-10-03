export const RACE_PROTOCOL_VERSION = 1;
export const RACE_TICK_RATE = 120;
export const RACE_SNAPSHOT_RATE = 20;

/** @typedef {import('./input').InputFrame} InputFrame */
/** @typedef {{version: 1, tick: number, sequence: number, input: InputFrame}} RaceInputPacket */
/** @typedef {{version: 1, circuit: string, seed: number, tick: number, round: number, elapsedMs: number, phase: string,
 * playerId: string, position: readonly number[], forward: readonly number[],
 * progress: number, lateral: number, speed: number, steer: number, boost: number,
 * boostActive: boolean, lap: number, nextCheckpoint: number,
 * ceiling: boolean, alternateRoad: boolean}} RaceSnapshot */

/** @param {unknown} value @param {number} minimum @param {number} maximum */
function axis(value, minimum, maximum) {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(minimum, Math.min(maximum, value)) : 0;
}

/** Network input is untrusted. A malformed packet has no authority to move a
 * craft. Sequence/tick acceptance belongs to a server's input timeline. */
/** @param {unknown} value @returns {RaceInputPacket|null} */
export function decodeRaceInput(value) {
  if (!value || typeof value !== 'object') return null;
  const packet = /** @type {Partial<RaceInputPacket>} */ (value);
  if (packet.version !== RACE_PROTOCOL_VERSION || !Number.isSafeInteger(packet.tick)
    || !Number.isSafeInteger(packet.sequence) || packet.tick === undefined || packet.tick < 0
    || packet.sequence === undefined || packet.sequence < 0 || !packet.input || typeof packet.input !== 'object') return null;
  return {version: 1, tick: packet.tick, sequence: packet.sequence,
    input: {throttle: axis(packet.input.throttle, 0, 1), brake: axis(packet.input.brake, 0, 1),
      steer: axis(packet.input.steer, -1, 1), boost: packet.input.boost === true}};
}

/** Holds at most two seconds of inputs and rejects replay, past/future ticks,
 * or a client attempting to replace an already accepted tick. A stalled input
 * releases throttle after 100ms rather than leaving boost stuck on. */
export class RaceInputTimeline {
  /** @type {Map<number, RaceInputPacket>} */
  packets = new Map();
  lastSequence = -1;
  lastConsumedTick = -1;
  lastReceivedTick = -1;
  /** @type {InputFrame} */
  held = {throttle: 0, brake: 0, steer: 0, boost: false};

  /** @param {unknown} raw @param {number} serverTick */
  accept(raw, serverTick) {
    const packet = decodeRaceInput(raw);
    if (!packet || !Number.isSafeInteger(serverTick) || serverTick < 0
      || packet.sequence <= this.lastSequence || packet.tick <= this.lastConsumedTick
      || packet.tick < serverTick || packet.tick > serverTick + RACE_TICK_RATE * 2
      || this.packets.has(packet.tick) || this.packets.size >= RACE_TICK_RATE * 2) return false;
    this.packets.set(packet.tick, packet);this.lastSequence = packet.sequence;
    return true;
  }

  /** @param {number} tick @returns {InputFrame} */
  consume(tick) {
    if (!Number.isSafeInteger(tick) || tick < 0 || tick <= this.lastConsumedTick) throw new Error('Race input ticks must advance');
    const packet = this.packets.get(tick);
    if (packet) {this.held = packet.input;this.lastReceivedTick = tick;}
    for (const queued of this.packets.keys()) if (queued <= tick) this.packets.delete(queued);
    this.lastConsumedTick = tick;
    if (this.lastReceivedTick < 0 || tick - this.lastReceivedTick >= RACE_TICK_RATE / 10) {
      this.held = {throttle: 0, brake: 0, steer: 0, boost: false};
    }
    return {...this.held};
  }
}

/** A copied, immutable render snapshot, never a mutable Three.js vector. This
 * is not a save/rollback state: circuit powers and event state need a separate
 * authoritative serializer before online racing is enabled. */
/** @param {Omit<RaceSnapshot, 'version'>} state @returns {RaceSnapshot} */
export function createRaceSnapshot(state) {
  return Object.freeze({...state, version: 1,
    position: Object.freeze([...state.position]), forward: Object.freeze([...state.forward])});
}

/** @param {RaceSnapshot} snapshot @param {{circuit: string, seed: number}} race */
export function compatibleRaceSnapshot(snapshot, race) {
  return snapshot.version === RACE_PROTOCOL_VERSION && snapshot.circuit === race.circuit && snapshot.seed === race.seed;
}
