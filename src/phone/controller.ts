// The phone side of the dev-only controller (controller.html). Reads tilt or a
// touch drag plus held/tapped buttons, and POSTs the whole pad state to the dev
// relay the moment anything changes, with a heartbeat while idle so the game
// can tell a still phone from a dead one. Every response doubles as a round-trip
// sample, so the latency readout costs no extra traffic.

import { PHONE_HEARTBEAT_MS, PHONE_PATH, estimateClockOffset } from "./phone-protocol.js";
import {
  TILT_DEADZONE_DEG,
  TILT_PRESETS,
  gravityVector,
  resolveLandscapeSign,
  shapeTiltSteer,
  tiltAngleDeg,
} from "./tilt-steer.js";

type HoldKey = "g" | "b" | "x";
type TapKey = "f" | "p" | "st" | "r";
type Preset = keyof typeof TILT_PRESETS;

const hashParameters = new URLSearchParams(window.location.hash.slice(1));
const token = hashParameters.get("k") ?? "";
const PRESET_ORDER: Preset[] = ["soft", "medium", "sharp"];
const PRESET_LABEL: Record<Preset, string> = { soft: "SOFT", medium: "MED", sharp: "SHARP" };
// The chosen feel lives in the URL fragment beside the pairing key, so a
// reload keeps it without any browser storage.
let preset: Preset = PRESET_ORDER.includes(hashParameters.get("s") as Preset)
  ? hashParameters.get("s") as Preset
  : "medium";
const padElement = document.getElementById("pad")!;
const statusElement = document.getElementById("status")!;
const steerDot = document.getElementById("steer-dot")!;
const modeButton = document.getElementById("mode")!;
const introElement = document.getElementById("intro")!;
const introNote = document.getElementById("intro-note")!;

const held: Record<HoldKey, Set<number>> = { g: new Set(), b: new Set(), x: new Set() };
const taps: Record<TapKey, number> = { f: 0, p: 0, st: 0, r: 0 };
let mode: "tilt" | "touch" = "tilt";
let tiltSteer = 0;
let touchSteer = 0;
let invert = 1;
let neutral = 0;
let landscapeSign: -1 | 0 | 1 = 0;
let needsCalibration = true;
let smoothedAngle: number | null = null;
let motionSeen = false;
/** Epoch ms of the input event behind the current state (sensor or touch). */
let lastInputAt = 0;
const epochNow = (): number => performance.timeOrigin + performance.now();
const eventEpoch = (event: Event): number => performance.timeOrigin + event.timeStamp;

/** Random per page load; lets the relay tell this phone from a second one. */
const padId = Array.from(crypto.getRandomValues(new Uint8Array(12)), (byte) => byte.toString(16).padStart(2, "0")).join("");
/** Requests allowed in flight; beyond this the newest state waits for a slot. */
const MAX_IN_FLIGHT = 6;
let inFlight = 0;
let pending = false;
let paired = false;
let lastOkAt = 0;
let gameOpen = false;
let seq = 0;
let lastSent = 0;
let lastKey = "";
let rtt = 0;
const rttSamples: number[] = [];
/** Recent request timings for the phone→relay clock offset (NTP style). */
const clockSamples: { sent: number; received: number; server: number }[] = [];
let clock: { offset: number; uncertainty: number } | null = null;
let statusOverride = "";

// ---- network -------------------------------------------------------------

function currentSteer(): number {
  return mode === "tilt" ? tiltSteer : touchSteer;
}

function sendState(force = false): void {
  if (!token || statusOverride === "auth") return;
  const steer = Math.round(currentSteer() * 100) / 100;
  const gas = held.g.size ? 1 : 0;
  const brake = held.b.size ? 1 : 0;
  const boost = held.x.size ? 1 : 0;
  const key = `${steer}|${gas}|${brake}|${boost}|${taps.f}|${taps.p}|${taps.st}|${taps.r}`;
  const now = performance.now();
  if (!force && key === lastKey && now - lastSent < PHONE_HEARTBEAT_MS) return;
  if (inFlight >= MAX_IN_FLIGHT) {
    pending = true;
    return;
  }
  const changed = key !== lastKey;
  lastKey = key;
  lastSent = now;
  seq += 1;
  // Latency stamps on the relay's clock; 0 until the first round trip has
  // measured the offset, which the relay then leaves out of its statistics.
  const sentAt = epochNow();
  const shift = clock ? clock.offset : null;
  void post({
    k: token, id: padId, t: "s", q: seq, s: steer, g: gas, b: brake, x: boost,
    f: taps.f, p: taps.p, st: taps.st, r: taps.r, rtt: Math.round(rtt * 10) / 10,
    ch: changed ? 1 : 0,
    a: shift === null || !lastInputAt ? 0 : lastInputAt + shift,
    w: shift === null ? 0 : sentAt + shift,
    u: clock ? Math.round(clock.uncertainty * 10) / 10 : 0,
  }, sentAt);
}

async function post(body: Record<string, unknown>, sentAt: number): Promise<void> {
  inFlight += 1;
  const startedAt = performance.now();
  try {
    const response = await fetch(`${PHONE_PATH}/pad`, {
      method: "POST",
      // text/plain keeps it a "simple" request: no CORS preflight round trip.
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify(body),
      cache: "no-store",
      credentials: "omit",
    });
    if (response.ok) {
      const reply = await response.json() as { game?: unknown; srv?: unknown };
      rtt = performance.now() - startedAt;
      if (typeof reply.srv === "number") {
        clockSamples.push({ sent: sentAt, received: epochNow(), server: reply.srv });
        if (clockSamples.length > 40) clockSamples.shift();
        clock = estimateClockOffset(clockSamples);
      }
      rttSamples.push(rtt);
      if (rttSamples.length > 60) rttSamples.shift();
      paired = true;
      lastOkAt = performance.now();
      gameOpen = reply.game === true;
      statusOverride = "";
    } else if (response.status === 403) {
      const reason = await response.json().catch(() => null) as { error?: unknown } | null;
      statusOverride = reason?.error === "auth" ? "auth" : "origin";
    } else if (response.status === 409) {
      statusOverride = "busy";
    }
  } catch {
    paired = false;
  } finally {
    inFlight -= 1;
    renderStatus();
    if (pending) {
      pending = false;
      sendState(true);
    }
  }
}

window.setInterval(() => sendState(), PHONE_HEARTBEAT_MS / 2);
window.setInterval(() => {
  if (paired && performance.now() - lastOkAt > 1_500) paired = false;
  renderStatus();
}, 500);

function renderStatus(): void {
  if (!token) {
    statusElement.textContent = "no pairing key - scan the QR on the game screen";
  } else if (statusOverride === "auth") {
    statusElement.textContent = "pairing key rejected - rescan the QR on the game screen";
  } else if (statusOverride === "origin") {
    statusElement.textContent = "relay refused this browser's origin - open the QR link directly";
  } else if (statusOverride === "busy") {
    statusElement.textContent = "another phone is driving";
  } else if (!paired) {
    statusElement.textContent = "connecting…";
  } else if (!gameOpen) {
    statusElement.textContent = "open the game with ?controller=phone";
  } else {
    const sorted = [...rttSamples].sort((a, b) => a - b);
    const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
    const p95 = sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] : 0;
    statusElement.textContent = `connected · ${Math.round(median)} ms (p95 ${Math.round(p95)}, n=${sorted.length})`;
  }
  padElement.classList.toggle("pad--live", paired && gameOpen);
}

// ---- tilt ----------------------------------------------------------------

function screenAngle(): number {
  const legacy = (window as unknown as { orientation?: unknown }).orientation;
  if (typeof legacy === "number") return legacy;
  return screen.orientation?.angle ?? 0;
}

function handleMotion(event: DeviceMotionEvent): void {
  const gravity = gravityVector(event.accelerationIncludingGravity, event.acceleration);
  if (!gravity) return;
  motionSeen = true;
  const { x, y, z } = gravity;
  if (needsCalibration) {
    landscapeSign = resolveLandscapeSign(x, y, z, screenAngle());
    const angle = tiltAngleDeg(x, y, z, landscapeSign);
    if (angle === null) return;
    neutral = angle;
    smoothedAngle = angle;
    needsCalibration = false;
    tiltSteer = 0;
  } else {
    const angle = tiltAngleDeg(x, y, z, landscapeSign);
    if (angle === null) return;
    // One-pole smoothing against sensor jitter. Fused gravity is already clean,
    // so it takes 85% of each step (≈ 3 ms of lag at 60 Hz); the raw reading
    // shakes with the hand and takes 60%.
    const follow = gravity.fused ? 0.85 : 0.6;
    smoothedAngle = smoothedAngle === null ? angle : smoothedAngle + (angle - smoothedAngle) * follow;
    const { fullLockDeg, expo } = TILT_PRESETS[preset];
    const next = invert * shapeTiltSteer(smoothedAngle, neutral, fullLockDeg, TILT_DEADZONE_DEG, expo);
    if (Math.round(next * 100) !== Math.round(tiltSteer * 100)) lastInputAt = eventEpoch(event);
    tiltSteer = next;
  }
  renderSteer();
  sendState();
}

function recalibrate(): void {
  needsCalibration = true;
  smoothedAngle = null;
}

async function enableMotion(): Promise<boolean> {
  const motion = window.DeviceMotionEvent as unknown as {
    requestPermission?: () => Promise<"granted" | "denied">;
  } | undefined;
  if (!motion) return false;
  if (typeof motion.requestPermission === "function") {
    try {
      if (await motion.requestPermission() !== "granted") return false;
    } catch {
      return false;
    }
  }
  window.addEventListener("devicemotion", handleMotion);
  return true;
}

// ---- touch ---------------------------------------------------------------

function bindHold(element: HTMLElement, key: HoldKey): void {
  const release = (event: PointerEvent) => {
    if (!held[key].delete(event.pointerId)) return;
    lastInputAt = eventEpoch(event);
    element.classList.toggle("is-down", held[key].size > 0);
    sendState();
  };
  element.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    element.setPointerCapture(event.pointerId);
    lastInputAt = eventEpoch(event);
    held[key].add(event.pointerId);
    element.classList.add("is-down");
    sendState();
  });
  element.addEventListener("pointerup", release);
  element.addEventListener("pointercancel", release);
  element.addEventListener("lostpointercapture", release);
}

function bindTap(element: HTMLElement, key: TapKey): void {
  element.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    lastInputAt = eventEpoch(event);
    taps[key] += 1;
    element.classList.add("is-down");
    navigator.vibrate?.(12);
    sendState();
  });
  const up = () => element.classList.remove("is-down");
  element.addEventListener("pointerup", up);
  element.addEventListener("pointercancel", up);
}

function bindWheel(element: HTMLElement): void {
  let pointer: number | null = null;
  let originX = 0;
  element.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    if (pointer !== null) return;
    pointer = event.pointerId;
    originX = event.clientX;
    element.setPointerCapture(event.pointerId);
  });
  element.addEventListener("pointermove", (event) => {
    if (event.pointerId !== pointer) return;
    const span = Math.max(60, window.innerWidth * 0.16);
    touchSteer = Math.max(-1, Math.min(1, (event.clientX - originX) / span));
    lastInputAt = eventEpoch(event);
    renderSteer();
    sendState();
  });
  const end = (event: PointerEvent) => {
    if (event.pointerId !== pointer) return;
    pointer = null;
    touchSteer = 0;
    renderSteer();
    sendState();
  };
  element.addEventListener("pointerup", end);
  element.addEventListener("pointercancel", end);
  element.addEventListener("lostpointercapture", end);
}

function releaseEverything(): void {
  held.g.clear();
  held.b.clear();
  held.x.clear();
  touchSteer = 0;
  for (const element of document.querySelectorAll(".is-down")) element.classList.remove("is-down");
  sendState(true);
}

function setMode(next: "tilt" | "touch"): void {
  mode = next;
  padElement.classList.toggle("pad--tilt", mode === "tilt");
  padElement.classList.toggle("pad--touch", mode === "touch");
  modeButton.textContent = mode === "tilt" ? "TILT" : "TOUCH";
  if (mode === "tilt") recalibrate();
  renderSteer();
  sendState(true);
}

function renderSteer(): void {
  steerDot.style.transform = `translateX(${(currentSteer() * 50).toFixed(1)}%)`;
}

// ---- wake lock -----------------------------------------------------------

let wakeLock: { release(): Promise<void> } | null = null;
async function keepAwake(): Promise<void> {
  const api = (navigator as unknown as {
    wakeLock?: { request(type: "screen"): Promise<{ release(): Promise<void> }> };
  }).wakeLock;
  if (!api || document.visibilityState !== "visible") return;
  try {
    wakeLock = await api.request("screen");
  } catch {
    wakeLock = null;
  }
}

// ---- wiring --------------------------------------------------------------

for (const element of document.querySelectorAll<HTMLElement>("[data-hold]")) {
  bindHold(element, element.dataset.hold as HoldKey);
}
for (const element of document.querySelectorAll<HTMLElement>("[data-tap]")) {
  bindTap(element, element.dataset.tap as TapKey);
}
bindWheel(document.getElementById("wheel")!);
document.getElementById("center")!.addEventListener("click", recalibrate);
const presetButton = document.getElementById("preset")!;
const renderPreset = () => {
  presetButton.textContent = PRESET_LABEL[preset];
};
presetButton.addEventListener("click", () => {
  preset = PRESET_ORDER[(PRESET_ORDER.indexOf(preset) + 1) % PRESET_ORDER.length];
  hashParameters.set("s", preset);
  history.replaceState(null, "", `#${hashParameters.toString()}`);
  renderPreset();
});
renderPreset();
document.getElementById("invert")!.addEventListener("click", () => {
  invert = -invert;
  recalibrate();
});
modeButton.addEventListener("click", () => {
  if (mode === "touch" && !motionSeen) return;
  setMode(mode === "tilt" ? "touch" : "tilt");
});
document.getElementById("go")!.addEventListener("click", async () => {
  const motion = await enableMotion();
  void keepAwake();
  // Give the sensor a moment to deliver its first sample before deciding.
  window.setTimeout(() => {
    if (!motion || !motionSeen) {
      setMode("touch");
      introNote.textContent = "";
    }
  }, 600);
  introElement.hidden = true;
  if (motion) setMode("tilt");
});

window.addEventListener("orientationchange", recalibrate);
screen.orientation?.addEventListener?.("change", recalibrate);
window.addEventListener("blur", releaseEverything);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    void keepAwake();
  } else {
    releaseEverything();
    void wakeLock?.release().catch(() => undefined);
  }
});
// Stop iOS rubber-banding and pinch-zoom from stealing touches mid-race.
document.addEventListener("touchmove", (event) => event.preventDefault(), { passive: false });
document.addEventListener("gesturestart", (event) => event.preventDefault());

if (!token) {
  introNote.textContent = "No pairing key in this link - scan the QR on the game screen.";
}
renderStatus();
