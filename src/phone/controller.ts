// The phone side of the dev-only controller (controller.html). Reads tilt or a
// touch drag plus held/tapped buttons, and POSTs the whole pad state to the dev
// relay the moment anything changes, with a heartbeat while idle so the game
// can tell a still phone from a dead one. Every response doubles as a round-trip
// sample, so the latency readout costs no extra traffic.

import { PHONE_HEARTBEAT_MS, PHONE_PATH, estimateClockOffset } from "./phone-protocol.js";
import {
  TILT_DEADZONE_DEG,
  TILT_PRESETS,
  blendTiltDelta,
  gestureSample,
  gravityVector,
  resolveLandscapeSign,
  shapeTiltSteer,
  tiltAngleDeg,
  wheelAngleDeg,
  wrapDeg,
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
const stageElement = document.getElementById("stage")!;
const statusElement = document.getElementById("status")!;
const statusText = document.getElementById("status-text")!;
const gaugeNeedle = document.getElementById("gauge-needle")!;
const gaugeValue = document.getElementById("gauge-value")!;
const gaugeNote = document.getElementById("gauge-note")!;
const actionsElement = document.getElementById("actions")!;
const flipButton = document.getElementById("flip")!;
const powerButton = document.getElementById("power")!;
const holdHint = document.getElementById("hold-hint")!;
const modeButton = document.getElementById("mode")!;
const introElement = document.getElementById("intro")!;
const introNote = document.getElementById("intro-note")!;

const held: Record<HoldKey, Set<number>> = { g: new Set(), b: new Set(), x: new Set() };
const taps: Record<TapKey, number> = { f: 0, p: 0, st: 0, r: 0 };
let mode: "tilt" | "touch" = "tilt";
let tiltSteer = 0;
let touchSteer = 0;
let invert = 1;
let landscapeSign: -1 | 0 | 1 = 0;
let needsCalibration = true;
type Angles = { tray: number; wheel: number | null };
/** Neutral readings, averaged over the first CALIBRATION_MS after a recentre. */
let neutral: Angles | null = null;
let calibration: { started: number; samples: Angles[] } | null = null;
const CALIBRATION_MS = 300;
/**
 * The player's steering gesture, learned from the gyroscope: 0 turns the phone
 * in its own screen plane (a wheel), 1 tips one end down (a tray). Each needs a
 * different angle formula once the screen leans back; see tilt-steer.js.
 */
let gesture = 0.5;
let smoothedDelta: number | null = null;
/** Which way the other landscape grip started (event time), for re-grip detection. */
let regripSince = 0;
let motionSeen = false;
/** Epoch ms of the input event behind the current state (sensor or touch). */
let lastInputAt = 0;
const epochNow = (): number => performance.timeOrigin + performance.now();
const eventEpoch = (event: Event): number => performance.timeOrigin + event.timeStamp;

/** Random per page load; lets the relay tell this phone from a second one. */
const padId = Array.from(crypto.getRandomValues(new Uint8Array(12)), (byte) => byte.toString(16).padStart(2, "0")).join("");
/** Requests allowed in flight; beyond this the newest state waits for a slot.
 * 3, not 6: on one HTTP/2 connection a stalled packet holds up every stream
 * behind it, so a deeper queue only delivers older states later. */
const MAX_IN_FLIGHT = 3;
let inFlight = 0;
/** How often a state had to wait for a free slot (shown in the status line). */
let queued = 0;
/** What the current circuit supports, reported by the game through the relay. */
let caps: { flip: boolean; power: boolean } | null = null;
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
  // BOOST and GAS sit under the same thumb, and the game only fires reserve
  // boost with throttle held (game.ts: input.throttle > 0.1), so BOOST drives.
  const gas = held.g.size || held.x.size ? 1 : 0;
  const brake = held.b.size ? 1 : 0;
  const boost = held.x.size ? 1 : 0;
  const key = `${steer}|${gas}|${brake}|${boost}|${taps.f}|${taps.p}|${taps.st}|${taps.r}`;
  const now = performance.now();
  if (!force && key === lastKey && now - lastSent < PHONE_HEARTBEAT_MS) return;
  if (inFlight >= MAX_IN_FLIGHT) {
    if (!pending) queued += 1;
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
      const reply = await response.json() as { game?: unknown; srv?: unknown; caps?: unknown };
      applyCaps(reply.caps);
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
  let text: string;
  let tone: "" | "good" | "ok" | "bad" = "";
  if (!token) {
    text = "no pairing key - scan the QR on the game screen";
  } else if (statusOverride === "auth") {
    text = "pairing key rejected - rescan the QR";
  } else if (statusOverride === "origin") {
    text = "relay refused this browser - open the QR link directly";
  } else if (statusOverride === "busy") {
    text = "another phone is driving";
  } else if (!paired) {
    text = "connecting…";
    tone = "bad";
  } else if (!gameOpen) {
    text = "open the game with ?controller=phone";
    tone = "ok";
  } else {
    const sorted = [...rttSamples].sort((a, b) => a - b);
    const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
    const p95 = sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] : 0;
    tone = p95 < 60 ? "good" : median < 80 ? "ok" : "bad";
    text = `${Math.round(median)} ms · p95 ${Math.round(p95)}${queued ? ` · waited ${queued}` : ""}`;
  }
  statusText.textContent = text;
  statusElement.className = `pad__status${tone ? ` pad__status--${tone}` : ""}`;
  padElement.classList.toggle("pad--live", paired && gameOpen);
}

/** FLIP and POWER only exist on circuits with gravity decks or powers. */
function applyCaps(raw: unknown): void {
  if (!raw || typeof raw !== "object") return;
  const next = { flip: (raw as { flip?: unknown }).flip === true, power: (raw as { power?: unknown }).power === true };
  if (caps && caps.flip === next.flip && caps.power === next.power) return;
  caps = next;
  flipButton.hidden = !next.flip;
  powerButton.hidden = !next.power;
  actionsElement.hidden = !next.flip && !next.power;
}

// ---- tilt ----------------------------------------------------------------

function screenAngle(): number {
  const legacy = (window as unknown as { orientation?: unknown }).orientation;
  if (typeof legacy === "number") return legacy;
  return screen.orientation?.angle ?? 0;
}

function averageAngles(samples: Angles[]): Angles {
  const tray = samples.reduce((sum, sample) => sum + sample.tray, 0) / samples.length;
  if (samples.some((sample) => sample.wheel === null)) return { tray, wheel: null };
  const first = samples[0].wheel as number;
  const offset = samples.reduce((sum, sample) => sum + wrapDeg((sample.wheel as number) - first), 0) / samples.length;
  return { tray, wheel: wrapDeg(first + offset) };
}

function handleMotion(event: DeviceMotionEvent): void {
  const gravity = gravityVector(event.accelerationIncludingGravity, event.acceleration);
  if (!gravity) return;
  motionSeen = true;
  const { x, y, z } = gravity;
  updateHold(x, y, z, event.timeStamp);
  if (needsCalibration) {
    landscapeSign = resolveLandscapeSign(x, y, z, screenAngle());
    calibration = { started: event.timeStamp, samples: [] };
    needsCalibration = false;
    neutral = null;
    smoothedDelta = null;
    regripSince = 0;
  }
  const tray = tiltAngleDeg(x, y, z, landscapeSign);
  if (tray === null) return;
  const angles: Angles = { tray, wheel: wheelAngleDeg(x, y, z, landscapeSign) };
  // Learn the gesture from fast, deliberate rotations only.
  const rate = event.rotationRate;
  if (rate && Number.isFinite(rate.alpha) && Number.isFinite(rate.beta) && Number.isFinite(rate.gamma)
    && Math.hypot(rate.alpha!, rate.beta!, rate.gamma!) > 25) {
    const sample = gestureSample({ x: rate.beta!, y: rate.gamma!, z: rate.alpha! }, x, y, z);
    if (sample !== null) gesture += (sample - gesture) * 0.08;
  }
  // The other landscape grip for 300 ms is a re-grip: recentre for it.
  const magnitude = Math.hypot(x, y, z);
  if (Math.abs(x) / magnitude > 0.6 && Math.sign(x) === -landscapeSign) {
    regripSince ||= event.timeStamp;
    if (event.timeStamp - regripSince > 300) {
      recalibrate();
      return;
    }
  } else {
    regripSince = 0;
  }
  if (calibration) {
    calibration.samples.push(angles);
    tiltSteer = 0;
    if (event.timeStamp - calibration.started >= CALIBRATION_MS) {
      neutral = averageAngles(calibration.samples);
      calibration = null;
    }
    renderSteer();
    sendState();
    return;
  }
  if (!neutral) return;
  const delta = blendTiltDelta(angles, neutral, gesture);
  // One-pole smoothing against sensor jitter. Fused gravity is already clean,
  // so it takes 85% of each step (≈ 3 ms of lag at 60 Hz); the raw reading
  // shakes with the hand and takes 60%.
  const follow = gravity.fused ? 0.85 : 0.6;
  smoothedDelta = smoothedDelta === null ? delta : smoothedDelta + (delta - smoothedDelta) * follow;
  const { fullLockDeg, expo } = TILT_PRESETS[preset];
  const next = invert * shapeTiltSteer(smoothedDelta, 0, fullLockDeg, TILT_DEADZONE_DEG, expo);
  if (Math.round(next * 100) !== Math.round(tiltSteer * 100)) lastInputAt = eventEpoch(event);
  tiltSteer = next;
  renderSteer();
  sendState();
}

function recalibrate(): void {
  needsCalibration = true;
  calibration = null;
  smoothedDelta = null;
}

// ---- holding the phone ---------------------------------------------------
//
// iOS Safari cannot lock rotation, and a hard steer can make it turn the page
// to portrait mid-corner. Instead of a "rotate" cover (and a recentre), the
// stage is counter-rotated so the pad stays put under the player's thumbs.

/** Sign of gx when the top of the phone is to the LEFT: +1 per spec, -1 on iOS. */
let gravityConvention = /iPhone|iPad|iPod/.test(navigator.userAgent) ? -1 : 1;
/** Physical landscape side, from gravity: 90 = top of the phone to the left. */
let holdAngle: 90 | -90 | null = null;
let holdCandidate: 90 | -90 | null = null;
let holdSince = 0;
let stageRotation = 0;
let portraitSince = 0;

function updateHold(gx: number, gy: number, gz: number, at: number): void {
  const magnitude = Math.hypot(gx, gy, gz);
  if (!(magnitude > 0.05)) return;
  const page = screenAngle();
  // Learn the platform's sign convention whenever the page itself is landscape.
  if ((page === 90 || page === -90 || page === 270) && Math.abs(gx) / magnitude > 0.6) {
    const pageAngle = page === 270 ? -90 : page;
    gravityConvention = Math.sign(gx) * (pageAngle === 90 ? 1 : -1);
  }
  if (Math.abs(gx) / magnitude > 0.6) {
    const side: 90 | -90 = Math.sign(gx) * gravityConvention > 0 ? 90 : -90;
    if (side !== holdCandidate) {
      holdCandidate = side;
      holdSince = at;
    }
    if (holdAngle === null || (side !== holdAngle && at - holdSince > 250)) holdAngle = side;
    portraitSince = 0;
  } else if (Math.abs(gy) / magnitude > 0.8) {
    portraitSince ||= at;
  } else {
    portraitSince = 0;
  }
  holdHint.hidden = !(portraitSince && at - portraitSince > 1200);
  applyStageRotation();
}

function applyStageRotation(): void {
  const page = screenAngle();
  const pageAngle = page === 270 ? -90 : page;
  const target = holdAngle === null ? 0 : ((((holdAngle - pageAngle) % 360) + 540) % 360) - 180;
  if (target === stageRotation) return;
  stageRotation = target;
  const style = stageElement.style;
  if (target === 0) {
    style.width = "";
    style.height = "";
    style.left = "";
    style.top = "";
    style.right = "";
    style.bottom = "";
    style.transform = "";
    return;
  }
  const quarter = Math.abs(target) === 90;
  // A quarter turn swaps the stage's width and height.
  style.width = quarter ? "100vh" : "100vw";
  style.height = quarter ? "100vw" : "100vh";
  style.left = "50%";
  style.top = "50%";
  style.right = "auto";
  style.bottom = "auto";
  style.transform = `translate(-50%, -50%) rotate(${target}deg)`;
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
  let originY = 0;
  element.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    if (pointer !== null) return;
    pointer = event.pointerId;
    originX = event.clientX;
    originY = event.clientY;
    element.setPointerCapture(event.pointerId);
  });
  element.addEventListener("pointermove", (event) => {
    if (event.pointerId !== pointer) return;
    const span = Math.max(60, stageElement.getBoundingClientRect().width * 0.16);
    // Along the stage's horizontal, which the counter-rotation may have turned.
    const turn = stageRotation * (Math.PI / 180);
    const along = (event.clientX - originX) * Math.cos(turn) + (event.clientY - originY) * Math.sin(turn);
    touchSteer = Math.max(-1, Math.min(1, along / span));
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
  const steer = currentSteer();
  gaugeNeedle.style.transform = `rotate(${(steer * 80).toFixed(1)}deg)`;
  const amount = Math.round(Math.abs(steer) * 100);
  gaugeValue.textContent = amount === 0 ? "0" : `${steer < 0 ? "L" : "R"} ${amount}`;
  gaugeNote.textContent = mode === "touch"
    ? "drag to steer"
    : calibration || needsCalibration
      ? "centring…"
      : gesture < 0.35 ? "wheel grip" : gesture > 0.65 ? "tilt grip" : "turn like a wheel";
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

// A page rotation is not a re-grip: keep the centre, just counter-rotate.
window.addEventListener("orientationchange", applyStageRotation);
screen.orientation?.addEventListener?.("change", applyStageRotation);
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
