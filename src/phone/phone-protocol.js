// Phone-as-controller wire format (dev-only prototype, `npm run dev:phone`).
//
// Shared by three parties so they cannot drift: the controller page that runs
// on the phone, the dev-server relay in scripts/phone-controller-server.mjs, and
// the game-side link in src/phone/phone-link.ts. Plain JS so Node imports it
// unchanged.
//
// Transport: the phone POSTs each pad state to the relay, the relay pushes it
// to the game over Server-Sent Events. Not WebSockets: iOS Safari refuses wss
// to a self-signed dev certificate even after the page's certificate warning
// has been accepted, while fetch and EventSource go through the page loader
// that honours that exception. So no root CA ever has to be installed on the
// phone.

export const PHONE_PATH = "/__phone";
/** The pad resends an unchanged state this often. Steady traffic also keeps the
 * iPhone's Wi-Fi radio out of power save, which otherwise adds 40-200 ms spikes. */
export const PHONE_HEARTBEAT_MS = 50;
/** A pad state older than this is treated as released: no stuck throttle. */
export const PHONE_STALE_MS = 200;
/** A pad silent this long has left; another phone may then take the slot. */
export const PHONE_PAD_IDLE_MS = 1_000;
/** Largest request body the relay accepts. A state is ~170 bytes. */
export const PHONE_MAX_PAYLOAD = 512;
/** Requests per second per client before the relay starts refusing. */
export const PHONE_MAX_RATE = 300;
/** Largest latency report the game page may post to the relay. */
export const PHONE_MAX_TELEMETRY = 2_048;
/**
 * Steering response the game uses while the phone owns the steer, per second
 * (game.ts's integrateSteering). Keyboard and pad keep the game's own 6.2/8.5:
 * a key jumps 0 -> 1 and needs that smoothing, but a hand turning a phone is
 * already a smooth signal, so the same 160 ms time constant only added lag.
 * 18/s is a 56 ms time constant.
 */
export const PHONE_STEER_RESPONSE = 18;

/** @param {number} value @param {number} minimum @param {number} maximum */
function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

/** @param {unknown} value @param {number} minimum @param {number} maximum */
function finite(value, minimum, maximum) {
  return typeof value === "number" && Number.isFinite(value)
    ? clamp(value, minimum, maximum)
    : 0;
}

/** @param {unknown} value */
function counter(value) {
  return Number.isInteger(value) && /** @type {number} */ (value) >= 0
    && /** @type {number} */ (value) <= 0x7fffffff
    ? /** @type {number} */ (value)
    : 0;
}

/** An epoch-millisecond timestamp, or 0. Clamped to a sane window. */
const MAX_EPOCH_MS = 1e13;

/**
 * The only shape a pad state may take once it leaves the relay. Every field is
 * rebuilt from scratch, so nothing the phone sends beyond these reaches the game.
 *
 * Latency stamps, all epoch milliseconds on the RELAY's clock (the phone shifts
 * its own by a measured offset before sending): `a` the input event that
 * produced this state, `w` when the phone sent it, `v` when the relay received
 * it (set by the relay, never trusted from the phone). `ch` is 1 when the state
 * changed since the previous packet; heartbeats carry 0 and are left out of the
 * stage statistics because their `a` is old by design.
 * @param {unknown} raw
 * @returns {{t: "s", q: number, s: number, g: number, b: number, x: 0 | 1,
 *   f: number, p: number, st: number, r: number, rtt: number,
 *   a: number, w: number, v: number, ch: 0 | 1} | null}
 */
export function sanitizePadState(raw) {
  if (!raw || typeof raw !== "object") return null;
  const message = /** @type {Record<string, unknown>} */ (raw);
  if (message.t !== "s") return null;
  return {
    t: "s",
    q: counter(message.q),
    s: finite(message.s, -1, 1),
    g: finite(message.g, 0, 1),
    b: finite(message.b, 0, 1),
    x: message.x === 1 ? 1 : 0,
    f: counter(message.f),
    p: counter(message.p),
    st: counter(message.st),
    r: counter(message.r),
    rtt: finite(message.rtt, 0, 10_000),
    a: finite(message.a, 0, MAX_EPOCH_MS),
    w: finite(message.w, 0, MAX_EPOCH_MS),
    v: finite(message.v, 0, MAX_EPOCH_MS),
    ch: message.ch === 1 ? 1 : 0,
  };
}

/**
 * Nearest-rank percentile of an ascending array (no interpolation, so a
 * reported number is always one that was actually measured).
 * @param {number[]} sorted @param {number} p in [0, 1]
 */
export function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))];
}

/**
 * Clock offset from request/response pairs, NTP style: the relay's receive
 * time minus the midpoint of the phone's send and receive. The minimum-RTT
 * sample has the least room for asymmetry, so its offset wins; its error is
 * bounded by half that RTT.
 * @param {{ sent: number, received: number, server: number }[]} samples
 * @returns {{ offset: number, uncertainty: number } | null}
 */
export function estimateClockOffset(samples) {
  let best = null;
  for (const sample of samples) {
    const rtt = sample.received - sample.sent;
    if (!(rtt >= 0)) continue;
    if (!best || rtt < best.rtt) best = { rtt, offset: sample.server - (sample.sent + sample.received) / 2 };
  }
  return best ? { offset: best.offset, uncertainty: best.rtt / 2 } : null;
}

/** A pad id is a client-minted random handle: short, URL-safe, nothing else.
 * @param {unknown} value */
export function isPadId(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{8,32}$/.test(value);
}

/**
 * Edge counters only ever fire on an increase, once per packet however large
 * the jump, so a dropped packet cannot lose a press and a forged jump cannot
 * fire a burst. A decrease (pad reload) just resynchronises.
 * @param {number} previous
 * @param {number} next
 */
export function counterAdvanced(previous, next) {
  return next > previous;
}
