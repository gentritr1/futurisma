// Phone-as-controller prototype (`npm run dev:phone`) — offline gate.
//
// 1. Tilt maths against PHYSICAL poses: each pose is built by rotating the
//    device axes in world space and reading the up vector off them, so the test
//    checks the formula against geometry rather than restating it.
// 2. The wire sanitiser.
// 3. The game-side merge (PhoneLink.apply via the real InputController) under a
//    DOM/WebSocket stub: precedence, stale release, edge counters, reconnects.
// 4. The relay's security gates on a real TLS server: host/origin checks, local-
//    only endpoints, pairing token, one-pad rule, payload cap, rate limit,
//    re-serialisation into the game's event stream.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { Agent, createServer, request as httpsRequest } from "node:https";
import { tmpdir } from "node:os";
import path from "node:path";
import { transformWithOxc } from "vite";
import {
  PHONE_MAX_PAYLOAD,
  PHONE_MAX_RATE,
  PHONE_MAX_TELEMETRY,
  PHONE_PAD_IDLE_MS,
  PHONE_PATH,
  PHONE_STALE_MS,
  PHONE_STEER_RESPONSE,
  estimateClockOffset,
  percentile,
  sanitizePadState,
} from "../src/phone/phone-protocol.js";
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
} from "../src/phone/tilt-steer.js";
import { readdirSync } from "node:fs";

const G = 9.81;

// ---- 1. tilt maths ---------------------------------------------------------
// World: X = player's right, Y = forward (away from the player), Z = up.
// Steering right = turning the phone clockwise as the player sees it, which is
// a right-handed rotation about +Y.
const rotY = (a, [x, y, z]) => [x * Math.cos(a) + z * Math.sin(a), y, -x * Math.sin(a) + z * Math.cos(a)];
const rotX = (a, [x, y, z]) => [x, y * Math.cos(a) - z * Math.sin(a), y * Math.sin(a) + z * Math.cos(a)];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/**
 * Gravity reading for a pose. `topLeft`: landscape with the top of the phone to
 * the player's left. `lean`: screen tipped back from vertical (0 = upright
 * wheel, PI/2 = flat tray). `steer`: clockwise turn, radians.
 */
function reading({ topLeft, lean, steer, inverted = false }) {
  // Upright, screen facing the player: z_d = -Y. Top-left: y_d = -X, x_d = +Z.
  let xd = topLeft ? [0, 0, 1] : [0, 0, -1];
  let yd = topLeft ? [-1, 0, 0] : [1, 0, 0];
  // Lean back about the X axis (top of the screen away from the player).
  xd = rotX(-lean, xd);
  yd = rotX(-lean, yd);
  xd = rotY(steer, xd);
  yd = rotY(steer, yd);
  const zd = [
    xd[1] * yd[2] - xd[2] * yd[1],
    xd[2] * yd[0] - xd[0] * yd[2],
    xd[0] * yd[1] - xd[1] * yd[0],
  ];
  const up = [0, 0, G];
  const sign = inverted ? -1 : 1;
  return [sign * dot(up, xd), sign * dot(up, yd), sign * dot(up, zd)];
}

function steerFor(pose, screenAngle) {
  const neutralReading = reading({ ...pose, steer: 0 });
  const sign = resolveLandscapeSign(...neutralReading, screenAngle);
  const neutral = tiltAngleDeg(...neutralReading, sign);
  assert.notEqual(neutral, null, `calibration reading is usable for ${JSON.stringify(pose)}`);
  return shapeTiltSteer(tiltAngleDeg(...reading(pose), sign), neutral);
}

const deg = Math.PI / 180;
for (const topLeft of [true, false]) {
  const screenAngle = topLeft ? 90 : -90;
  for (const lean of [0, 30 * deg, 55 * deg, 70 * deg]) {
    for (const inverted of [false, true]) {
      const label = `${topLeft ? "top-left" : "top-right"} lean ${Math.round(lean / deg)}°${inverted ? " inverted platform" : ""}`;
      assert.ok(steerFor({ topLeft, lean, steer: 15 * deg, inverted }, screenAngle) > 0.15, `${label}: clockwise steers right`);
      assert.ok(steerFor({ topLeft, lean, steer: -15 * deg, inverted }, screenAngle) < -0.15, `${label}: anticlockwise steers left`);
      assert.equal(steerFor({ topLeft, lean, steer: 1.5 * deg, inverted }, screenAngle), 0, `${label}: inside deadzone`);
      assert.equal(steerFor({ topLeft, lean, steer: 41 * deg, inverted }, screenAngle), 1, `${label}: saturates at full lock`);
    }
  }
  // Flat tray grip: gravity cannot tell the landscape side, the screen angle does.
  for (const inverted of [false, true]) {
    const flat = { topLeft, lean: 90 * deg, inverted };
    const label = `${topLeft ? "top-left" : "top-right"} flat${inverted ? " inverted platform (iOS)" : ""}`;
    assert.ok(steerFor({ ...flat, steer: 15 * deg }, screenAngle) > 0.15, `${label}: right end down steers right`);
    assert.ok(steerFor({ ...flat, steer: -15 * deg }, screenAngle) < -0.15, `${label}: left end down steers left`);
  }
}
// Calibration offset: a phone held 10° turned at calibration reads that as centre.
{
  const pose = { topLeft: true, lean: 40 * deg };
  const base = reading({ ...pose, steer: 10 * deg });
  const sign = resolveLandscapeSign(...base, 90);
  const neutral = tiltAngleDeg(...base, sign);
  assert.equal(shapeTiltSteer(tiltAngleDeg(...reading({ ...pose, steer: 10 * deg }), sign), neutral), 0);
  assert.ok(shapeTiltSteer(tiltAngleDeg(...reading({ ...pose, steer: 25 * deg }), sign), neutral) > 0.15);
}
// Wheel vs tipping (owner 2026-10-05: "not accurate sometimes when rotating").
// A wheel turn rotates the phone about its own screen axis; tipping rotates it
// about the horizontal axis pointing away from the player. They coincide only
// with the screen upright. asin(gy/|g|) is exact for tipping and reads a wheel
// turn short by cos(lean); atan2 in the screen plane is the reverse. The gyro
// tells the gestures apart, and blendTiltDelta mixes the two readings by it.
{
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const about = (k, a, v) => {
    const c = Math.cos(a), s = Math.sin(a), kv = cross(k, v), kd = dot(k, v);
    return v.map((vi, i) => vi * c + kv[i] * s + k[i] * kd * (1 - c));
  };
  /** Gravity and the gyro axis (device frame) for a gesture of `steer` radians. */
  const gesture = ({ topLeft, lean, steer, model, inverted = false }) => {
    let xd = topLeft ? [0, 0, 1] : [0, 0, -1];
    let yd = topLeft ? [-1, 0, 0] : [1, 0, 0];
    xd = rotX(-lean, xd);
    yd = rotX(-lean, yd);
    const normal = cross(xd, yd);
    // Clockwise as the player sees it: about +Y (world) for tipping, about the
    // screen normal (which faces the player) for the wheel.
    const axis = model === "tip" ? [0, 1, 0] : normal.map((v) => -v);
    xd = about(axis, steer, xd);
    yd = about(axis, steer, yd);
    const zd = cross(xd, yd);
    const up = [0, 0, inverted ? -G : G];
    const rate = { x: dot(axis, xd), y: dot(axis, yd), z: dot(axis, zd) };
    return { g: [dot(up, xd), dot(up, yd), dot(up, zd)], rate };
  };
  const read = (pose, gestureWeight) => {
    const base = gesture({ ...pose, steer: 0 });
    const sign = resolveLandscapeSign(...base.g, pose.topLeft ? 90 : -90);
    const neutral = { tray: tiltAngleDeg(...base.g, sign), wheel: wheelAngleDeg(...base.g, sign) };
    const now = gesture(pose).g;
    return blendTiltDelta({ tray: tiltAngleDeg(...now, sign), wheel: wheelAngleDeg(...now, sign) }, neutral, gestureWeight);
  };
  // The original failure, reproduced: asin alone reads a 20° wheel turn as 14°.
  const asinOnly = read({ topLeft: true, lean: 45 * deg, steer: 20 * deg, model: "wheel" }, 1);
  assert.ok(Math.abs(asinOnly - 14.0) < 0.2, `asin alone undershoots a tipped-back wheel turn (read ${asinOnly.toFixed(1)}°)`);
  for (const topLeft of [true, false]) for (const inverted of [false, true]) for (const lean of [0, 20, 45, 60]) {
    for (const model of ["wheel", "tip"]) {
      const pose = { topLeft, lean: lean * deg, model, inverted };
      // Classify the gesture from the gyro the way the pad does: an EMA of samples.
      let weight = 0.5;
      for (let i = 1; i <= 30; i += 1) {
        const sample = gesture({ ...pose, steer: (i % 15) * 2 * deg });
        const g = sample.g, s = gestureSample(sample.rate, ...g);
        if (s !== null) weight += (s - weight) * 0.15;
      }
      const label = `${model} lean ${lean}° ${topLeft ? "top-left" : "top-right"}${inverted ? " inverted" : ""}`;
      if (lean >= 20) assert.ok(model === "tip" ? weight > 0.9 : weight < 0.1, `${label}: gesture classified (${weight.toFixed(2)})`);
      const reading = read({ ...pose, steer: 20 * deg }, weight);
      assert.ok(Math.abs(reading - 20) < 0.6, `${label}: a 20° turn reads ${reading.toFixed(2)}°`);
      const left = read({ ...pose, steer: -20 * deg }, weight);
      assert.ok(Math.abs(left + 20) < 0.6, `${label}: a -20° turn reads ${left.toFixed(2)}°`);
    }
  }
  assert.equal(wrapDeg(190), -170);
  assert.equal(wrapDeg(-190), 170);
  assert.equal(wheelAngleDeg(0, 0, G, 1), null, "flat phone has no in-plane wheel angle");
}
// Feel presets (first iPhone playtest 2026-10-04: "a bit too hard"). MEDIUM is
// the default and must answer a 15° turn with roughly half of what the
// playtested linear 28° curve gave (0.49).
{
  const at = (degrees, name) => {
    const { fullLockDeg, expo } = TILT_PRESETS[name];
    return shapeTiltSteer(degrees, 0, fullLockDeg, TILT_DEADZONE_DEG, expo);
  };
  const medium15 = at(15, "medium");
  assert.ok(medium15 > 0.18 && medium15 < 0.27, `MEDIUM at 15° is ${medium15.toFixed(3)}, expected ~0.22`);
  assert.equal(shapeTiltSteer(15, 0), medium15, "MEDIUM is the default curve");
  assert.ok(at(15, "soft") < medium15 && medium15 < at(15, "sharp"), "SOFT < MEDIUM < SHARP at 15°");
  for (const name of Object.keys(TILT_PRESETS)) {
    let previous = 0;
    for (let degrees = 0; degrees <= 60; degrees += 0.5) {
      const value = at(degrees, name);
      assert.ok(value >= previous - 1e-12 && value <= 1, `${name} is monotonic and bounded at ${degrees}°`);
      assert.ok(Math.abs(at(-degrees, name) + value) < 1e-12, `${name} is symmetric at ${degrees}°`);
      previous = value;
    }
    assert.equal(at(TILT_PRESETS[name].fullLockDeg, name), 1, `${name} reaches full lock at its full-lock angle`);
  }
}
// Fused gravity: accelerationIncludingGravity minus the gyro-fused user
// acceleration; the raw reading when the fused one is missing.
assert.deepEqual(gravityVector({ x: 1, y: 2, z: 10 }, { x: 0.5, y: -1, z: 0.5 }), { x: 0.5, y: 3, z: 9.5, fused: true });
assert.deepEqual(gravityVector({ x: 1, y: 2, z: 10 }, null), { x: 1, y: 2, z: 10, fused: false });
assert.deepEqual(gravityVector({ x: 1, y: 2, z: 10 }, { x: null, y: null, z: null }), { x: 1, y: 2, z: 10, fused: false });
assert.equal(gravityVector({ x: null, y: 2, z: 10 }, null), null);
// Shaking the phone moves the raw reading but not the fused one.
{
  const still = reading({ topLeft: true, lean: 40 * deg, steer: 10 * deg });
  const shake = [3, -2, 1.5];
  const raw = gravityVector({ x: still[0] + shake[0], y: still[1] + shake[1], z: still[2] + shake[2] }, null);
  const fused = gravityVector({ x: still[0] + shake[0], y: still[1] + shake[1], z: still[2] + shake[2] }, { x: shake[0], y: shake[1], z: shake[2] });
  const sign = resolveLandscapeSign(...still, 90);
  const truth = tiltAngleDeg(...still, sign);
  assert.ok(Math.abs(tiltAngleDeg(fused.x, fused.y, fused.z, sign) - truth) < 1e-9, "fused gravity ignores a hand shake");
  assert.ok(Math.abs(tiltAngleDeg(raw.x, raw.y, raw.z, sign) - truth) > 2, "the raw reading does not (so it needs more smoothing)");
}

// ---- 1b. latency maths -------------------------------------------------------
assert.equal(percentile([], 0.5), 0);
assert.equal(percentile([1, 2, 3, 4], 0.5), 2, "nearest-rank p50 reports a measured value");
assert.equal(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 100], 0.95), 19);
{
  // Phone clock runs 5000 ms behind the relay; one-way legs of 4 and 6 ms,
  // except a slow sample whose asymmetric legs would skew a naive average.
  const offset = 5_000;
  const samples = [
    { sent: 100, received: 110, server: 100 + 4 + offset },
    { sent: 200, received: 260, server: 200 + 50 + offset },
    { sent: 300, received: 309, server: 300 + 4.5 + offset },
  ];
  const estimate = estimateClockOffset(samples);
  assert.ok(Math.abs(estimate.offset - offset) <= estimate.uncertainty, `offset ${estimate.offset} within ±${estimate.uncertainty}`);
  assert.equal(estimate.uncertainty, 4.5, "the minimum-RTT sample sets the bound");
  assert.equal(estimateClockOffset([]), null);
}
assert.equal(resolveLandscapeSign(0, 0, G, 0), 0, "portrait flat has no landscape axis");
assert.equal(tiltAngleDeg(Number.NaN, 0, 0, 1), null, "NaN reading is rejected");
assert.equal(shapeTiltSteer(Number.NaN, 0), 0, "NaN angle steers nowhere");

// ---- 2. sanitiser ----------------------------------------------------------
assert.equal(sanitizePadState(null), null);
assert.equal(sanitizePadState({ t: "x" }), null);
assert.deepEqual(
  sanitizePadState({ t: "s", q: 3, s: 9, g: Number.NaN, b: -2, x: "1", f: -1, p: 1.5, st: 2 ** 40, r: 4, rtt: 12, evil: "<script>" }),
  { t: "s", q: 3, s: 1, g: 0, b: 0, x: 0, f: 0, p: 0, st: 0, r: 4, rtt: 12, a: 0, w: 0, v: 0, ch: 0 },
);
assert.deepEqual(
  (({ a, w, v, ch }) => ({ a, w, v, ch }))(sanitizePadState({ t: "s", a: 1e20, w: -5, v: "9", ch: true })),
  { a: 1e13, w: 0, v: 0, ch: 0 },
  "latency stamps are clamped numbers and ch is strictly 1 or 0",
);

// ---- 3. game-side merge ------------------------------------------------------
const gameRoot = (name) => new URL(`../src/game/${name}`, import.meta.url).href;
const phoneRoot = (name) => new URL(`../src/phone/${name}`, import.meta.url).href;
async function moduleUrl(file, replacements) {
  const url = new URL(file, import.meta.url);
  let { code } = await transformWithOxc(readFileSync(url, "utf8"), url.pathname);
  for (const [specifier, resolved] of Object.entries(replacements)) {
    code = code.replaceAll(`from ${JSON.stringify(specifier)}`, `from ${JSON.stringify(resolved)}`);
  }
  return `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
}
const inputUrl = await moduleUrl("../src/game/input.ts", {
  "./menu-key.js": gameRoot("menu-key.js"),
  "./action-gate": gameRoot("action-gate.js"),
  "./input-shaping": gameRoot("input-shaping.js"),
});
const linkUrl = await moduleUrl("../src/phone/phone-link.ts", {
  "../game/input": inputUrl,
  "./phone-protocol.js": phoneRoot("phone-protocol.js"),
});

class ElementStub extends EventTarget {
  className = ""; textContent = ""; style = {};
  classList = { toggle() {}, add() {}, remove() {} };
  setAttribute() {} append() {} remove() {}
}
const streams = [];
class EventSourceStub extends EventTarget {
  constructor(url) { super(); this.url = url; this.closed = false; streams.push(this); }
  close() { this.closed = true; }
  deliver(message) {
    const event = new Event("message");
    event.data = typeof message === "string" ? message : JSON.stringify(message);
    this.dispatchEvent(event);
  }
}
let clock = 1_000;
const windowStub = new EventTarget();
windowStub.location = { protocol: "https:", host: "localhost:5173" };
windowStub.setInterval = () => 1;
windowStub.clearInterval = () => {};
const telemetryPosts = [];
const originalGlobals = new Map();
for (const [name, value] of Object.entries({
  window: windowStub,
  document: { createElement: () => new ElementStub(), head: { append() {} }, body: { append() {} } },
  navigator: { getGamepads: () => [] },
  EventSource: EventSourceStub,
  fetch: async (url, init) => {
    if (String(url).endsWith("/telemetry")) telemetryPosts.push(JSON.parse(init.body));
    return { json: async () => ({ url: null }) };
  },
  performance: { now: () => clock, timeOrigin: 0 },
})) {
  originalGlobals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
}
const { InputController } = await import(inputUrl);
const { PhoneLink } = await import(linkUrl);
const input = new InputController();
const link = new PhoneLink(input);
const stream = streams[0];
assert.equal(stream.url, `${PHONE_PATH}/events`);
const key = (code, down) => windowStub.dispatchEvent(Object.assign(new Event(down ? "keydown" : "keyup"), { code, key: code, preventDefault() {} }));
let q = 0;
const pad = (fields) => stream.deliver({ t: "s", q: ++q, s: 0, g: 0, b: 0, x: 0, f: 0, p: 0, st: 0, r: 0, rtt: 0, ...fields });

pad({ g: 1, s: 0.8 });
assert.equal(input.read().throttle, 0, "a pad state before the relay announces the pad is ignored");
assert.equal(input.read().steerResponse, undefined, "keyboard/pad steering keeps the game's own response");
stream.deliver({ t: "peer", pad: true, n: 1 });
pad({ g: 1, s: 0.8, st: 5, r: 2 });
let frame = input.read();
assert.equal(frame.throttle, 1, "phone gas drives");
assert.equal(frame.steer, 0.8, "phone steer drives");
assert.equal(frame.steerResponse, PHONE_STEER_RESPONSE, "phone steering gets the phone's faster response");
assert.equal(input.consumeStart(), false, "counters present at connect are adopted, not fired");
assert.equal(input.consumeControlIntent(), true, "first phone driving input is a takeover intent");
pad({ g: 1, s: 0.8, st: 6, r: 2 });
input.read();
assert.equal(input.consumeStart(), true, "START counter edge fires once");
input.read();
assert.equal(input.consumeStart(), false, "and only once");
pad({ g: 1, s: 0.8, st: 6, r: 9 });
input.read();
assert.equal(input.consumeReset(), true, "a jump of several counts is one reset");
stream.deliver({ t: "s", q: q - 3, s: -1, g: 0, b: 1, x: 0, f: 0, p: 0, st: 6, r: 9, rtt: 0 });
assert.equal(input.read().steer, 0.8, "an overtaken (older) state is dropped");
pad({ f: 1, st: 6, r: 9 });
input.read();
assert.equal(input.consumeFlip(), false, "FLIP is ignored where the map has no gravity controls");
input.setGravityControls(true);
pad({ f: 2, st: 6, r: 9 });
input.read();
assert.equal(input.consumeFlip(), true, "FLIP fires where gravity controls are on");
key("KeyA", true);
pad({ s: 0.9, f: 2, st: 6, r: 9 });
frame = input.read();
assert.equal(frame.steer, -1, "a held key beats the phone");
assert.equal(frame.steerResponse, undefined, "and the key keeps the game's own response");
key("KeyA", false);
assert.equal(input.read().steer, 0.9, "phone steers again on release");
pad({ g: 1, s: 0.5, f: 2, st: 6, r: 9 });
clock += PHONE_STALE_MS + 1;
frame = input.read();
assert.deepEqual([frame.throttle, frame.steer], [0, 0], "a stale phone releases throttle and steering");
pad({ g: 1, s: 0.5, f: 2, st: 6, r: 9 });
assert.equal(input.read().throttle, 1, "a fresh packet resumes");
input.suspendActionsUntilRelease();
pad({ st: 7, f: 2, r: 9 });
input.read();
assert.equal(input.consumeStart(), false, "actions are dropped while input is suspended");
stream.deliver({ t: "peer", pad: false, n: 1 });
assert.equal(input.read().throttle, 0, "a disconnected pad contributes nothing");
// A reloaded controller page is a new session: q and counters restart from 1.
stream.deliver({ t: "peer", pad: true, n: 2 });
stream.deliver({ t: "s", q: 1, s: 0.3, g: 1, b: 0, x: 0, f: 0, p: 0, st: 1, r: 0, rtt: 0 });
frame = input.read();
assert.equal(frame.steer, 0.3, "a new pad session is not mistaken for an old state");
assert.equal(input.consumeStart(), false, "a new session's restarted counters do not fire");
// Latency stages: input at a, relay receipt at v, page receipt and first read
// on this page's clock (timeOrigin 0 + the stub clock).
telemetryPosts.length = 0;
link.reportLatency();
clock = 50_000;
stream.deliver({ t: "s", q: 50, s: 0.2, g: 1, b: 0, x: 0, f: 0, p: 0, st: 1, r: 0, rtt: 9, ch: 1, a: 49_970, w: 49_985, v: 49_990 });
clock = 50_008;
input.read();
input.read();
stream.deliver({ t: "s", q: 51, s: 0.2, g: 1, b: 0, x: 0, f: 0, p: 0, st: 1, r: 0, rtt: 9, ch: 0, a: 49_970, w: 50_030, v: 50_035 });
input.read();
link.reportLatency();
const report = telemetryPosts.at(-1);
assert.deepEqual([report.relayToGame.n, report.relayToGame.p50], [1, 10], "relay→game = page receipt − relay receipt");
assert.deepEqual([report.waitForFrame.n, report.waitForFrame.p50], [1, 8], "wait→frame = first read − page receipt, counted once per packet");
assert.deepEqual([report.total.n, report.total.p50], [1, 38], "total = first read − input event; heartbeats (ch 0) are not samples");
assert.equal(report.steerResponse, PHONE_STEER_RESPONSE);
stream.deliver("not json at all");
stream.deliver("x".repeat(600));
link.dispose();
assert.equal(input.remote, null, "dispose detaches the remote");
assert.equal(stream.closed, true, "dispose closes the stream");
input.dispose();
for (const [name, descriptor] of originalGlobals) {
  if (descriptor) Object.defineProperty(globalThis, name, descriptor);
  else delete globalThis[name];
}

// ---- 4. relay security on a real TLS server ----------------------------------
const { ensureDevCertificate, phoneControllerPlugin } = await import("./phone-controller-server.mjs");
const certDir = mkdtempSync(path.join(tmpdir(), "futurisma-phone-"));
const server = createServer(ensureDevCertificate(certDir, null));
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;
const TOKEN = "AAECAwQFBgcICQoLDA0ODw";
const LAN = "192.168.77.10";
const logDirectory = path.join(certDir, "logs");
const logLines = [];
const plugin = phoneControllerPlugin({ lan: LAN, port, token: TOKEN, logDirectory, logEveryMs: 300 });
let middleware = null;
plugin.configureServer({
  httpServer: server,
  middlewares: { use: (fn) => { middleware = fn; } },
  config: { logger: { info: (line) => logLines.push(line) } },
});
server.on("request", (request, response) => middleware(request, response, () => {
  response.statusCode = 404;
  response.end("vite");
}));
const origin = `https://${LAN}:${port}`;
/** Real HTTPS request through the plugin. `host` is the Host header sent. */
// One keep-alive pool, as a phone's browser would hold, so a burst measures the
// relay's rate gate rather than TLS handshake throughput.
const agent = new Agent({ keepAlive: true, maxSockets: 4, rejectUnauthorized: false });
const call = (pathname, { method = "GET", body, host = `localhost:${port}`, from } = {}) => new Promise((resolve, reject) => {
  const headers = { host };
  if (from) headers.origin = from;
  if (body !== undefined) headers["content-type"] = "text/plain";
  const request = httpsRequest({ host: "127.0.0.1", port, path: pathname, method, headers, agent }, (response) => {
    let text = "";
    response.on("data", (chunk) => { text += chunk; });
    response.on("end", () => resolve({ status: response.statusCode, text, headers: response.headers }));
  });
  request.on("error", reject);
  if (body !== undefined) request.write(typeof body === "string" ? body : JSON.stringify(body));
  request.end();
});
/** The plugin's own middleware with a forged remote address (a LAN client). */
const fromLan = (pathname, method = "GET") => new Promise((resolve) => {
  const response = { statusCode: 200, setHeader() {}, end() { resolve(this.statusCode); } };
  middleware({ url: pathname, method, headers: { host: `${LAN}:${port}` }, socket: { remoteAddress: "192.168.77.50" }, on() {} }, response, () => resolve("next"));
});
const padBody = (fields = {}) => ({ k: TOKEN, id: "phoneAAAA1111", t: "s", q: 1, s: 0, g: 0, b: 0, x: 0, f: 0, p: 0, st: 0, r: 0, rtt: 0, ...fields });
const postPad = (fields, options = {}) => call(`${PHONE_PATH}/pad`, { method: "POST", body: padBody(fields), host: `${LAN}:${port}`, from: origin, ...options });

// Game event stream, opened as this machine.
const events = [];
let eventBuffer = "";
const streamResponse = await new Promise((resolve) => {
  httpsRequest({ host: "127.0.0.1", port, path: `${PHONE_PATH}/events`, headers: { host: `localhost:${port}` }, rejectUnauthorized: false }, (response) => {
    response.on("data", (chunk) => {
      eventBuffer += chunk;
      let index;
      while ((index = eventBuffer.indexOf("\n\n")) >= 0) {
        const block = eventBuffer.slice(0, index);
        eventBuffer = eventBuffer.slice(index + 2);
        const line = block.split("\n").find((entry) => entry.startsWith("data: "));
        if (line) events.push(JSON.parse(line.slice(6)));
      }
    });
    resolve(response);
  }).end();
});
const settle = () => new Promise((resolve) => setTimeout(resolve, 60));
await settle();
assert.equal(streamResponse.statusCode, 200, "this machine opens the game stream");
assert.equal(streamResponse.headers["content-type"], "text/event-stream");
assert.deepEqual(events.at(-1), { t: "peer", pad: false, n: 0 }, "the stream opens with the pad status");

assert.equal((await call(`${PHONE_PATH}/info`, { host: `evil.example:${port}` })).status, 403, "foreign Host (DNS rebinding) is refused");
assert.equal((await call(`${PHONE_PATH}/info`, { from: "https://evil.example" })).status, 403, "foreign Origin is refused");
const info = await call(`${PHONE_PATH}/info`);
assert.equal(info.status, 200, "this machine reads pairing info");
assert.equal(info.headers["cache-control"], "no-store", "pairing info is never cached");
assert.equal(new URL(JSON.parse(info.text).url).hash, `#k=${TOKEN}`, "the controller URL carries the token in its fragment");
const qr = await call(`${PHONE_PATH}/qr.svg`);
assert.ok(qr.status === 200 && qr.text.startsWith("<svg"), "this machine gets an SVG QR");
assert.equal(await fromLan(`${PHONE_PATH}/info`), 403, "a LAN client cannot read the pairing info");
assert.equal(await fromLan(`${PHONE_PATH}/qr.svg`), 403, "a LAN client cannot fetch the QR");
assert.equal(await fromLan(`${PHONE_PATH}/events`), 403, "a LAN client cannot open the game stream");
assert.equal(await fromLan("/src/main.ts"), "next", "other paths fall through to Vite");

assert.equal((await postPad({}, { from: undefined })).status, 403, "a pad POST without Origin is refused");
assert.equal((await postPad({}, { from: "https://evil.example" })).status, 403, "a cross-site pad POST is refused");
assert.equal((await postPad({}, { from: "null" })).status, 403, "an opaque `Origin: null` (sandboxed frame) is refused");
assert.equal((await postPad({ k: "AAECAwQFBgcICQoLDA0OAA" })).status, 403, "a wrong pairing token is refused");
assert.equal((await postPad({ k: "short" })).status, 403, "a wrong-length token is refused without throwing");
assert.equal((await postPad({ id: "../../x" })).status, 400, "a malformed pad id is refused");
assert.equal((await call(`${PHONE_PATH}/pad`, { method: "POST", body: "{nope", host: `${LAN}:${port}`, from: origin })).status, 400, "bad JSON is refused");
assert.equal((await call(`${PHONE_PATH}/pad`, { method: "POST", body: "x".repeat(PHONE_MAX_PAYLOAD + 1), host: `${LAN}:${port}`, from: origin })).status, 413, "an oversized body is refused");
await settle();
assert.ok(!events.some((event) => event.t === "s"), "nothing from a refused request reached the game");

// A second game tab must not evict the first: both receive every state.
const secondEvents = [];
const secondStream = await new Promise((resolve) => {
  httpsRequest({ host: "127.0.0.1", port, path: `${PHONE_PATH}/events`, headers: { host: `localhost:${port}` }, rejectUnauthorized: false }, (response) => {
    response.on("data", (chunk) => {
      for (const line of String(chunk).split("\n")) if (line.startsWith("data: ")) secondEvents.push(JSON.parse(line.slice(6)));
    });
    resolve(response);
  }).end();
});
// A trickled body is cut off instead of parked.
const trickle = await new Promise((resolve) => {
  const started = Date.now();
  const request = httpsRequest({ host: "127.0.0.1", port, path: `${PHONE_PATH}/pad`, method: "POST", agent,
    headers: { host: `${LAN}:${port}`, origin, "content-type": "text/plain", "content-length": "200" } }, (response) => {
    response.resume();
    resolve({ status: response.statusCode, ms: Date.now() - started });
  });
  request.on("error", () => resolve({ status: "reset", ms: Date.now() - started }));
  request.write("{");
});
assert.ok(trickle.ms < 3_500, `a trickled body is cut off (${trickle.status} after ${trickle.ms} ms)`);
const beforePost = performance.timeOrigin + performance.now();
const accepted = await postPad({ q: 1, s: 0.4, g: 1, x: 1, rtt: 9, extra: "x".repeat(40), ch: 1, a: beforePost - 20, w: beforePost - 5, v: 1, u: 1.5 });
const afterPost = performance.timeOrigin + performance.now();
assert.equal(accepted.status, 200, "a paired pad is accepted");
const acceptedBody = JSON.parse(accepted.text);
assert.equal(acceptedBody.game, true, "the pad learns the game is open");
assert.ok(acceptedBody.srv >= beforePost && acceptedBody.srv <= afterPost, "the reply carries the relay's receive time for clock sync");
await settle();
assert.deepEqual(events.at(-2), { t: "peer", pad: true, n: 1 }, "the game hears the pad arrive");
const forwarded = events.at(-1);
assert.equal(forwarded.v, acceptedBody.srv, "the relay stamps its own receive time and ignores the phone's v");
assert.deepEqual({ ...forwarded, v: 0 }, { t: "s", q: 1, s: 0.4, g: 1, b: 0, x: 1, f: 0, p: 0, st: 0, r: 0, rtt: 9, a: beforePost - 20, w: beforePost - 5, v: 0, ch: 1 }, "states are rebuilt by the sanitiser (token, id, u and extras stripped)");

// The game's half of the breakdown, then the relay's periodic line and JSONL.
assert.equal((await call(`${PHONE_PATH}/telemetry`, { method: "POST", body: { relayToGame: { n: 3, p50: 0.7, p95: 1.1 }, waitForFrame: { n: 3, p50: 6, p95: 15 }, total: { n: 3, p50: 30, p95: 52 }, steerResponse: 18 } })).status, 204, "this machine posts game-side latency");
assert.equal(await fromLan(`${PHONE_PATH}/telemetry`, "POST"), 403, "a LAN client cannot post latency reports");
// Circuit actions: the pad hides FLIP / POWER the circuit does not have (owner
// 2026-10-05: on Frostline they "did nothing"). Only two booleans pass through.
assert.equal(acceptedBody.caps, null, "before the game reports, the pad is told nothing about actions");
assert.equal((await call(`${PHONE_PATH}/telemetry`, { method: "POST", body: { caps: { flip: false, power: "yes", extra: 1 } } })).status, 204);
const capsBody = JSON.parse((await postPad({ q: 2, s: 0, ch: 0 })).text);
assert.deepEqual(capsBody.caps, { flip: false, power: false }, "caps are rebuilt as strict booleans");
assert.equal((await call(`${PHONE_PATH}/telemetry`, { method: "POST", body: { caps: { flip: true, power: true } } })).status, 204);
assert.deepEqual(JSON.parse((await postPad({ q: 3, s: 0, ch: 0 })).text).caps, { flip: true, power: true }, "a circuit with gravity decks shows both");
assert.equal((await call(`${PHONE_PATH}/telemetry`, { method: "POST", body: "x".repeat(PHONE_MAX_TELEMETRY + 1) })).status, 413, "an oversized report is refused");
await new Promise((resolve) => setTimeout(resolve, 450));
const line = logLines.find((entry) => entry.startsWith("[phone]"));
assert.ok(line, `the relay prints a latency line (${logLines.length} lines logged)`);
for (const stage of ["input→send 15.0/15.0", "wifi↑", "relay→game 0.7/1.1", "wait→frame 6.0/15.0", "TOTAL 30.0/52.0", "steering τ 56 ms"]) {
  assert.ok(line.includes(stage), `the latency line shows "${stage}": ${line}`);
}
const jsonl = readFileSync(path.join(logDirectory, "latency.jsonl"), "utf8").trim().split("\n").map((entry) => JSON.parse(entry));
const logged = jsonl.find((entry) => entry.changed === 1);
assert.ok(logged && logged.inputToSend.p50 === 15 && logged.total.p50 === 30, "latency.jsonl records the same numbers");
assert.ok(readdirSync(logDirectory).length === 1, "one log file");
assert.deepEqual(secondEvents.at(-1), events.at(-1), "a second game tab receives the same state");
assert.equal(streamResponse.destroyed, false, "and the first tab's stream stays open");
secondStream.destroy();
assert.equal((await postPad({ id: "phoneBBBB2222", g: 1 })).status, 409, "a second phone cannot take a live pad's slot");
await new Promise((resolve) => setTimeout(resolve, PHONE_PAD_IDLE_MS + 300));
assert.deepEqual(events.at(-1), { t: "peer", pad: false, n: 1 }, "a silent pad is dropped and the game told");
assert.equal((await postPad({ id: "phoneBBBB2222" })).status, 200, "after the first pad goes silent another may pair");
await settle();
assert.deepEqual(events.at(-2), { t: "peer", pad: true, n: 2 }, "a new pad is a new session");

const floodStarted = Date.now();
const flood = await Promise.all(Array.from({ length: PHONE_MAX_RATE + 60 }, (_, index) => postPad({ id: "phoneBBBB2222", q: index + 2 })));
const floodMs = Date.now() - floodStarted;
const refused = flood.filter((response) => response.status === 429).length;
assert.ok(floodMs < 1_000, `the burst must land inside one rate window to test it (took ${floodMs} ms)`);
assert.ok(refused >= 60 - 5, `a flooding client is rate limited (${refused} of ${flood.length} refused in ${floodMs} ms)`);

streamResponse.destroy();
agent.destroy();
server.closeAllConnections?.();
server.close();
rmSync(certDir, { recursive: true, force: true });
console.log("Phone controller validation passed: tilt poses (2 landscapes x 4 leans x 2 sign conventions + flat both conventions), sanitiser, game merge, relay security gates over TLS.");
process.exit(0);
