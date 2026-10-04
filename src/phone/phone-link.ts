// Game side of the dev-only phone controller. Loaded lazily from main.ts only
// when `import.meta.env.DEV` and `?controller=phone`, so production never ships
// it. Holds the relay's local-only event stream, keeps the newest sanitised pad
// state, and merges it into InputController's frame each read.

import {
  REMOTE_FLIP,
  REMOTE_INTENT,
  REMOTE_POWER,
  REMOTE_RESET,
  REMOTE_START,
  type InputController,
  type InputFrame,
  type RemoteInput,
} from "../game/input";
import {
  PHONE_PATH,
  PHONE_STALE_MS,
  PHONE_STEER_RESPONSE,
  counterAdvanced,
  percentile,
  sanitizePadState,
} from "./phone-protocol.js";

type PadState = NonNullable<ReturnType<typeof sanitizePadState>>;

/** How often the game posts its half of the latency breakdown to the relay. */
const TELEMETRY_EVERY_MS = 2_000;
/** Epoch ms, sub-millisecond, comparable with the relay's clock on this Mac. */
const epochNow = (): number => performance.timeOrigin + performance.now();

function summarise(values: number[]): { n: number; p50: number; p95: number; max: number } {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  return { n: sorted.length, p50: percentile(sorted, 0.5), p95: percentile(sorted, 0.95), max: sorted.at(-1) ?? 0 };
}

/** Telemetry the runtime check reads; nothing in the game depends on it. */
export interface PhoneLinkStats {
  connected: boolean;
  packets: number;
  lastAgeMs: number | null;
  rttMs: number;
  maxGapMs: number;
  steer: number;
  /** Last two-second window, p50 ms: relay→game, wait→frame, input→read. */
  relayToGameMs: number;
  waitForFrameMs: number;
  totalMs: number;
}

export class PhoneLink implements RemoteInput {
  private stream: EventSource | null = null;
  private state: PadState | null = null;
  private stateAt = 0;
  private consumed: { f: number; p: number; st: number; r: number } | null = null;
  private padConnected = false;
  private session = -1;
  private wasDriving = false;
  private disposed = false;
  readonly stats: PhoneLinkStats = {
    connected: false, packets: 0, lastAgeMs: null, rttMs: 0, maxGapMs: 0, steer: 0,
    relayToGameMs: 0, waitForFrameMs: 0, totalMs: 0,
  };
  /** Epoch ms at which the current state arrived on this page. */
  private stateArrivedAt = 0;
  /** The packet sequence number the last read() already accounted for. */
  private usedSequence = -1;
  private readonly samples = { relayToGame: [] as number[], waitForFrame: [] as number[], total: [] as number[] };
  private telemetryTimer = 0;
  private readonly overlay = new PhoneOverlay();

  constructor(private readonly input: InputController) {
    input.remote = this;
    this.connect();
    void this.overlay.loadPairing();
    this.telemetryTimer = window.setInterval(() => this.reportLatency(), TELEMETRY_EVERY_MS);
  }

  apply(frame: InputFrame, acceptActions: boolean): number {
    const state = this.state;
    const now = performance.now();
    this.stats.lastAgeMs = state ? now - this.stateAt : null;
    if (!state || !this.padConnected || now - this.stateAt > PHONE_STALE_MS) {
      // Stale or gone: contribute nothing, so keyboard/pad keep working and a
      // locked phone or a Wi-Fi drop can never leave the throttle held.
      this.wasDriving = false;
      return 0;
    }
    frame.throttle = Math.max(frame.throttle, state.g);
    frame.brake = Math.max(frame.brake, state.b);
    // Larger magnitude wins: a held key (±1) always beats the phone, and the
    // phone beats a resting stick. While the phone owns the steer the game
    // integrates it with the phone's faster response (phone-protocol.js).
    if (Math.abs(state.s) > Math.abs(frame.steer)) {
      frame.steer = state.s;
      frame.steerResponse = PHONE_STEER_RESPONSE;
    }
    if (state.q !== this.usedSequence) {
      // First read() to see this packet: the end of its journey before physics.
      this.usedSequence = state.q;
      if (state.ch && state.v) {
        const usedAt = epochNow();
        this.samples.relayToGame.push(this.stateArrivedAt - state.v);
        this.samples.waitForFrame.push(usedAt - this.stateArrivedAt);
        if (state.a) this.samples.total.push(usedAt - state.a);
      }
    }
    frame.boost = frame.boost || state.x === 1;
    this.stats.steer = state.s;

    let bits = 0;
    const consumed = this.consumed ?? { f: state.f, p: state.p, st: state.st, r: state.r };
    if (acceptActions && this.consumed) {
      if (counterAdvanced(consumed.st, state.st)) bits |= REMOTE_START;
      if (counterAdvanced(consumed.r, state.r)) bits |= REMOTE_RESET;
      if (counterAdvanced(consumed.f, state.f)) bits |= REMOTE_FLIP | REMOTE_INTENT;
      if (counterAdvanced(consumed.p, state.p)) bits |= REMOTE_POWER | REMOTE_INTENT;
    }
    consumed.f = state.f;
    consumed.p = state.p;
    consumed.st = state.st;
    consumed.r = state.r;
    this.consumed = consumed;

    const driving = state.g > 0.2 || state.b > 0.2 || Math.abs(state.s) > 0.2 || state.x === 1;
    if (driving && !this.wasDriving) bits |= REMOTE_INTENT;
    this.wasDriving = driving;
    return bits;
  }

  dispose(): void {
    this.disposed = true;
    window.clearInterval(this.telemetryTimer);
    if (this.input.remote === this) this.input.remote = null;
    this.stream?.close();
    this.overlay.dispose();
  }

  private connect(): void {
    if (this.disposed) return;
    // EventSource reconnects by itself (the relay sets `retry: 1000`).
    const stream = new EventSource(`${PHONE_PATH}/events`);
    this.stream = stream;
    stream.addEventListener("message", (event) => this.receive((event as MessageEvent).data));
    stream.addEventListener("error", () => {
      this.setPadConnected(false);
      this.overlay.setStatus("relay lost - retrying", false);
    });
  }

  private receive(data: unknown): void {
    if (typeof data !== "string" || data.length > 512) return;
    let message: unknown;
    try {
      message = JSON.parse(data);
    } catch {
      return;
    }
    const state = sanitizePadState(message);
    if (state) {
      // Requests can overtake each other; never step back to an older state.
      if (this.state && state.q !== 0 && state.q < this.state.q) return;
      const now = performance.now();
      if (this.state) this.stats.maxGapMs = Math.max(this.stats.maxGapMs, now - this.stateAt);
      this.state = state;
      this.stateAt = now;
      this.stateArrivedAt = epochNow();
      this.stats.packets += 1;
      this.stats.rttMs = state.rtt;
      this.overlay.setLatency(state.rtt);
      return;
    }
    if (message && typeof message === "object" && (message as { t?: unknown }).t === "peer") {
      const peer = message as { pad?: unknown; n?: unknown };
      this.setPadConnected(peer.pad === true, typeof peer.n === "number" ? peer.n : -1);
    }
  }

  private reportLatency(): void {
    const relayToGame = summarise(this.samples.relayToGame);
    const waitForFrame = summarise(this.samples.waitForFrame);
    const total = summarise(this.samples.total);
    this.samples.relayToGame = [];
    this.samples.waitForFrame = [];
    this.samples.total = [];
    if (!total.n && !relayToGame.n) return;
    this.stats.relayToGameMs = relayToGame.p50;
    this.stats.waitForFrameMs = waitForFrame.p50;
    this.stats.totalMs = total.p50;
    this.overlay.setBreakdown(total, relayToGame, waitForFrame);
    void fetch(`${PHONE_PATH}/telemetry`, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({ relayToGame, waitForFrame, total, steerResponse: PHONE_STEER_RESPONSE }),
      cache: "no-store",
    }).catch(() => undefined);
  }

  private setPadConnected(connected: boolean, session = this.session): void {
    if (connected === this.padConnected && session === this.session) return;
    this.padConnected = connected;
    this.session = session;
    this.stats.connected = connected;
    // A new pad session restarts its counters; adopt them without firing.
    this.consumed = null;
    this.state = null;
    this.stats.maxGapMs = 0;
    this.overlay.setStatus(connected ? "connected" : "waiting for phone", connected);
  }
}

/**
 * The pairing card: QR while waiting, a small status pill once a phone is in.
 * Built with DOM APIs and a same-origin stylesheet link, because the page CSP
 * forbids markup injection and inline styles.
 */
class PhoneOverlay {
  private readonly root = document.createElement("aside");
  private readonly qr = document.createElement("img");
  private readonly url = document.createElement("p");
  private readonly status = document.createElement("p");
  private readonly stylesheet = document.createElement("link");
  private connected = false;
  private latency = "";
  private breakdown = "";
  private statusText = "waiting for phone";

  constructor() {
    this.stylesheet.rel = "stylesheet";
    this.stylesheet.href = "/src/phone/phone-link.css";
    document.head.append(this.stylesheet);
    this.root.className = "phone-link";
    this.root.setAttribute("aria-label", "Phone controller");
    const title = document.createElement("h2");
    title.textContent = "Phone controller";
    this.qr.alt = "QR code that opens the phone controller";
    this.qr.width = 168;
    this.qr.height = 168;
    this.url.className = "phone-link__url";
    this.status.className = "phone-link__status";
    this.root.append(title, this.qr, this.url, this.status);
    this.root.addEventListener("click", () => {
      if (this.connected) this.root.classList.toggle("phone-link--expanded");
    });
    document.body.append(this.root);
    this.render();
  }

  async loadPairing(): Promise<void> {
    try {
      const response = await fetch(`${PHONE_PATH}/info`, { cache: "no-store" });
      const info = await response.json() as { url: string | null };
      if (!info.url) {
        this.url.textContent = "No Wi-Fi address found on this Mac.";
        return;
      }
      this.qr.src = `${PHONE_PATH}/qr.svg`;
      // The token lives in the fragment; show only the address.
      this.url.textContent = info.url.split("#")[0];
    } catch {
      this.url.textContent = "Start the game with `npm run dev:phone`.";
    }
  }

  setStatus(text: string, connected: boolean): void {
    this.statusText = text;
    this.connected = connected;
    if (!connected) this.latency = "";
    this.render();
  }

  /** The game-side view: input event to the read() that used it, p50/p95. */
  setBreakdown(
    total: { n: number; p50: number; p95: number },
    relay: { p50: number },
    wait: { p50: number },
  ): void {
    this.breakdown = total.n
      ? `input→game ${Math.round(total.p50)}/${Math.round(total.p95)} ms (relay ${relay.p50.toFixed(1)}, frame wait ${wait.p50.toFixed(0)})`
      : "";
    this.render();
  }

  setLatency(rttMs: number): void {
    const next = rttMs > 0 ? `${Math.round(rttMs)} ms round trip` : "";
    if (next === this.latency) return;
    this.latency = next;
    this.render();
  }

  dispose(): void {
    this.root.remove();
    this.stylesheet.remove();
  }

  private render(): void {
    this.root.classList.toggle("phone-link--connected", this.connected);
    const parts = [this.statusText, this.latency, this.breakdown].filter(Boolean);
    this.status.textContent = parts.join(" · ");
  }
}

export function attachPhoneLink(input: InputController): PhoneLink {
  const link = new PhoneLink(input);
  (globalThis as unknown as { __futurismaPhone?: PhoneLink }).__futurismaPhone = link;
  return link;
}
