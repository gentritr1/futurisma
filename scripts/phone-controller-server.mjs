// Dev-only relay for the phone controller (`npm run dev:phone`).
//
// The phone POSTs pad states to `/__phone/pad`; the game page on this Mac holds
// a Server-Sent Events stream on `/__phone/events` and receives each state the
// moment it lands. Nothing here is part of the production build: vite.config.mjs
// imports this module only in `--mode phone`. (Why not WebSockets: see the
// header of src/phone/phone-protocol.js.)
//
// Security model, because the dev server is reachable from the Wi-Fi:
//   - The server binds to the Wi-Fi address only (vite.config.mjs), so VPN and
//     tethering interfaces stay closed.
//   - The game stream, the pairing info and the QR code answer only this
//     machine (loopback or its own LAN address — a remote host cannot complete
//     a TCP handshake with a spoofed source address), so the pairing token
//     never leaves the Mac except in the QR on its screen.
//   - Every pad request carries the per-run 128-bit token from the QR's URL
//     fragment, compared in constant time.
//   - Host must be on the allow-list (DNS rebinding) and Origin, when a browser
//     sends one, must be on it too (cross-site request forgery); a pad POST
//     without an Origin is refused outright.
//   - One pad at a time. A second phone is refused while the first is live; it
//     may take over only after the first has been silent PHONE_PAD_IDLE_MS.
//   - Bodies are size-capped and rate-limited, parsed in a try, and rebuilt by
//     the shared sanitiser, so the game never sees a raw phone payload.
//
// Latency log. Every pad state carries the phone's input and send times on the
// relay's clock (see phone-protocol.js); the relay stamps its own receive time
// and the game reports when the state reached it and which frame used it. Every
// LOG_EVERY_MS the relay prints one line per stage, p50/p95 in ms, and appends
// the same numbers as JSON to .phone-logs/latency.jsonl (gitignored):
//   input→send   phone: sensor/touch event to fetch() (main-thread delay)
//   wifi↑        phone fetch() to relay receive (radio + TLS + h2; clock-synced,
//                ± half the best round trip)
//   relay→game   relay receive to the game page's EventSource (same machine)
//   wait→frame   game receipt to the InputController.read() that used it
//   total        input event to that read: everything before physics
// After the read, the game's steering response adds its own time constant,
// printed alongside, and the frame still has to render.

import { execFileSync } from "node:child_process";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { appendFile, mkdir } from "node:fs/promises";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { networkInterfaces } from "node:os";
import path from "node:path";
import QRCode from "qrcode";
import {
  PHONE_MAX_PAYLOAD,
  PHONE_MAX_RATE,
  PHONE_MAX_TELEMETRY,
  PHONE_PAD_IDLE_MS,
  PHONE_PATH,
  PHONE_STEER_RESPONSE,
  isPadId,
  percentile,
  sanitizePadState,
} from "../src/phone/phone-protocol.js";

const BODY_TIMEOUT_MS = 2_000;
const LOG_EVERY_MS = 5_000;
/** Epoch milliseconds with sub-millisecond precision, comparable to a browser's
 * performance.timeOrigin + performance.now() on the same machine. */
const nowMs = () => performance.timeOrigin + performance.now();

/** @param {number[]} values */
function summarise(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  return { n: sorted.length, p50: percentile(sorted, 0.5), p95: percentile(sorted, 0.95), max: sorted.at(-1) ?? 0 };
}

/** @param {{ n: number, p50: number, p95: number }} stage */
function formatStage(stage) {
  return stage.n ? `${stage.p50.toFixed(1)}/${stage.p95.toFixed(1)}` : "-";
}
const MAX_GAME_STREAMS = 8;

/** The Mac's Wi-Fi/Ethernet IPv4, skipping VPN tunnels, bridges and link-local. */
export function lanAddress() {
  const candidates = [];
  for (const [name, addresses] of Object.entries(networkInterfaces())) {
    if (/^(?:utun|bridge|vmnet|docker|awdl|llw|lo)/.test(name)) continue;
    for (const address of addresses ?? []) {
      if (address.family !== "IPv4" || address.internal) continue;
      if (address.address.startsWith("169.254.")) continue;
      candidates.push({ name, address: address.address });
    }
  }
  candidates.sort((a, b) => (a.name === "en0" ? -1 : b.name === "en0" ? 1 : 0));
  return candidates[0]?.address ?? null;
}

/**
 * A self-signed certificate for localhost + the LAN address, regenerated when
 * the address changes or it is within a day of expiring. iOS only exposes
 * motion sensors to secure pages, so the controller cannot be served over http.
 * @param {string} directory gitignored output directory
 * @param {string | null} lan
 */
export function ensureDevCertificate(directory, lan) {
  const keyPath = path.join(directory, "key.pem");
  const certPath = path.join(directory, "cert.pem");
  const metaPath = path.join(directory, "meta.json");
  const hosts = ["localhost", "127.0.0.1", ...(lan ? [lan] : [])];
  let reuse = false;
  if (existsSync(keyPath) && existsSync(certPath) && existsSync(metaPath)) {
    try {
      const meta = JSON.parse(readFileSync(metaPath, "utf8"));
      reuse = meta.hosts?.join(",") === hosts.join(",") && meta.expires - Date.now() > 86_400_000;
    } catch {
      reuse = false;
    }
  }
  if (!reuse) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const days = 30;
    const san = hosts.map((host) => (/^[\d.]+$/.test(host) ? `IP:${host}` : `DNS:${host}`)).join(",");
    execFileSync("openssl", [
      "req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1",
      "-nodes", "-days", String(days), "-subj", "/CN=FUTURISMA dev controller",
      "-addext", `subjectAltName=${san}`,
      "-addext", "extendedKeyUsage=serverAuth",
      "-keyout", keyPath, "-out", certPath,
    ], { stdio: "ignore" });
    writeFileSync(metaPath, JSON.stringify({ hosts, expires: Date.now() + days * 86_400_000 }));
  }
  return { key: readFileSync(keyPath), cert: readFileSync(certPath) };
}

/**
 * @param {{ lan: string | null, port: number, token?: string, logDirectory?: string | null }} options
 *   `token` is for the offline validator only; the dev server always mints one.
 *   `logDirectory` receives latency.jsonl; null turns the file off.
 * @returns {import("vite").Plugin}
 */
export function phoneControllerPlugin({
  lan, port, token = randomBytes(16).toString("base64url"), logDirectory = ".phone-logs", logEveryMs = LOG_EVERY_MS,
}) {
  const tokenBuffer = Buffer.from(token);
  const hostNames = ["localhost", "127.0.0.1", ...(lan ? [lan] : [])];
  const allowedHosts = new Set(hostNames.map((host) => `${host}:${port}`));
  const allowedOrigins = new Set(hostNames.map((host) => `https://${host}:${port}`));
  const controllerUrl = lan ? `https://${lan}:${port}/controller.html#k=${token}` : null;

  /** Every open game tab gets every state; two tabs must not evict each other. */
  /** @type {Set<import("node:http").ServerResponse>} */
  const games = new Set();
  /** @type {{ id: string, lastSeen: number } | null} */
  let pad = null;
  /** Bumped whenever a different pad takes the slot, so the game resets its baselines. */
  let session = 0;
  /** @type {Map<string, { windowStart: number, count: number }>} */
  const rates = new Map();
  /** Stage samples for the current log window. */
  const stages = { packets: 0, changed: 0, inputToSend: [], uplink: [], clockUncertainty: [], rtt: [] };
  /** The latest report from the game page, merged into the next log line. */
  let gameReport = null;

  const isLocal = (address) => address === "127.0.0.1" || address === "::1"
    || address === "::ffff:127.0.0.1" || (lan !== null && (address === lan || address === `::ffff:${lan}`));

  const pushToGame = (message) => {
    const frame = `data: ${JSON.stringify(message)}\n\n`;
    for (const game of games) if (!game.writableEnded) game.write(frame);
  };
  const announcePad = () => pushToGame({ t: "peer", pad: Boolean(pad), n: session });

  /** False once a client exceeds PHONE_MAX_RATE requests in its current second. */
  const withinRate = (key, now) => {
    const entry = rates.get(key) ?? { windowStart: now, count: 0 };
    if (now - entry.windowStart >= 1_000) {
      entry.windowStart = now;
      entry.count = 0;
    }
    entry.count += 1;
    rates.set(key, entry);
    return entry.count <= PHONE_MAX_RATE;
  };

  const reply = (response, status, body) => {
    response.statusCode = status;
    response.setHeader("Cache-Control", "no-store");
    if (body === undefined) {
      response.end();
      return;
    }
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify(body));
  };

  const readBody = (request, limit = PHONE_MAX_PAYLOAD) => new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    let done = false;
    // A peer that trickles a body is cut off rather than parked indefinitely.
    const timer = setTimeout(() => {
      finish(null);
      request.destroy?.();
    }, BODY_TIMEOUT_MS);
    const finish = (value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(value);
    };
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        finish(null);
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => finish(Buffer.concat(chunks).toString("utf8")));
    request.on("error", () => finish(null));
  });

  const handlePad = async (request, response) => {
    const now = Date.now();
    if (request.method !== "POST") return reply(response, 405);
    if (!allowedOrigins.has(request.headers.origin ?? "")) return reply(response, 403, { error: "origin" });
    if (!withinRate(request.socket?.remoteAddress ?? "?", now)) return reply(response, 429);
    const declared = Number(request.headers["content-length"] ?? 0);
    if (declared > PHONE_MAX_PAYLOAD) return reply(response, 413);
    const text = await readBody(request);
    if (text === null) return reply(response, 413);
    let message;
    try {
      message = JSON.parse(text);
    } catch {
      return reply(response, 400);
    }
    const presented = Buffer.from(typeof message?.k === "string" ? message.k : "");
    if (presented.length !== tokenBuffer.length || !timingSafeEqual(presented, tokenBuffer)) {
      return reply(response, 403, { error: "auth" });
    }
    if (!isPadId(message.id)) return reply(response, 400);
    if (pad && pad.id !== message.id && now - pad.lastSeen < PHONE_PAD_IDLE_MS) {
      return reply(response, 409, { error: "busy" });
    }
    const state = sanitizePadState(message);
    if (!state) return reply(response, 400);
    // The relay's own receive time; whatever the phone sent in `v` is dropped.
    state.v = nowMs();
    stages.packets += 1;
    if (state.rtt) stages.rtt.push(state.rtt);
    if (state.ch && state.a && state.w) {
      stages.changed += 1;
      stages.inputToSend.push(state.w - state.a);
      stages.uplink.push(state.v - state.w);
      const uncertainty = Number(message.u);
      if (Number.isFinite(uncertainty) && uncertainty >= 0 && uncertainty < 1_000) stages.clockUncertainty.push(uncertainty);
    }
    const arrived = !pad || pad.id !== message.id;
    if (arrived) session += 1;
    pad = { id: message.id, lastSeen: now };
    if (arrived) announcePad();
    pushToGame(state);
    return reply(response, 200, { game: games.size > 0, srv: state.v });
  };

  const handleTelemetry = async (request, response) => {
    if (request.method !== "POST") return reply(response, 405);
    const declared = Number(request.headers["content-length"] ?? 0);
    if (declared > PHONE_MAX_TELEMETRY) return reply(response, 413);
    const text = await readBody(request, PHONE_MAX_TELEMETRY);
    if (text === null) return reply(response, 413);
    try {
      const report = JSON.parse(text);
      const stage = (value) => ({
        n: Math.max(0, Math.floor(Number(value?.n) || 0)),
        p50: Math.max(0, Number(value?.p50) || 0),
        p95: Math.max(0, Number(value?.p95) || 0),
        max: Math.max(0, Number(value?.max) || 0),
      });
      gameReport = {
        at: Date.now(),
        relayToGame: stage(report.relayToGame),
        waitForFrame: stage(report.waitForFrame),
        total: stage(report.total),
        steerResponse: Number(report.steerResponse) || 0,
      };
    } catch {
      return reply(response, 400);
    }
    return reply(response, 204);
  };

  const flushLog = async (server) => {
    if (!stages.packets) return;
    const inputToSend = summarise(stages.inputToSend);
    const uplink = summarise(stages.uplink);
    const rtt = summarise(stages.rtt);
    const clock = summarise(stages.clockUncertainty);
    const game = gameReport && Date.now() - gameReport.at < Math.max(logEveryMs * 2, 4_000) ? gameReport : null;
    const record = {
      at: new Date().toISOString(),
      windowMs: logEveryMs,
      packets: stages.packets,
      changed: stages.changed,
      ratePerSecond: stages.packets / (logEveryMs / 1_000),
      inputToSend, uplink, clockUncertaintyMs: clock.p50,
      roundTrip: rtt,
      relayToGame: game?.relayToGame ?? null,
      waitForFrame: game?.waitForFrame ?? null,
      total: game?.total ?? null,
      steerTimeConstantMs: game?.steerResponse ? 1_000 / game.steerResponse : null,
    };
    stages.packets = 0;
    stages.changed = 0;
    stages.inputToSend = [];
    stages.uplink = [];
    stages.clockUncertainty = [];
    stages.rtt = [];
    const steer = record.steerTimeConstantMs ? `${record.steerTimeConstantMs.toFixed(0)} ms` : "-";
    server.config.logger.info(
      `[phone] ${record.ratePerSecond.toFixed(0)} msg/s (${record.changed} changes) · p50/p95 ms: `
      + `input→send ${formatStage(inputToSend)} · wifi↑ ${formatStage(uplink)} (clock ±${clock.p50.toFixed(1)}) · `
      + `relay→game ${game ? formatStage(game.relayToGame) : "-"} · wait→frame ${game ? formatStage(game.waitForFrame) : "-"} · `
      + `TOTAL ${game ? formatStage(game.total) : "-"} · round trip ${formatStage(rtt)} · then steering τ ${steer}`,
      { timestamp: true },
    );
    if (logDirectory) {
      try {
        await mkdir(logDirectory, { recursive: true });
        await appendFile(path.join(logDirectory, "latency.jsonl"), `${JSON.stringify(record)}\n`);
      } catch {
        // A log write failure must never take the relay down.
      }
    }
  };

  const handleEvents = (request, response) => {
    if (games.size >= MAX_GAME_STREAMS) return reply(response, 429);
    response.statusCode = 200;
    response.setHeader("Content-Type", "text/event-stream");
    response.setHeader("Cache-Control", "no-store");
    response.flushHeaders?.();
    games.add(response);
    response.write("retry: 1000\n\n");
    announcePad();
    const keepAlive = setInterval(() => {
      if (!response.writableEnded) response.write(": keep-alive\n\n");
    }, 15_000);
    request.on("close", () => {
      clearInterval(keepAlive);
      games.delete(response);
    });
  };

  return {
    name: "futurisma-phone-controller",
    apply: "serve",
    configureServer(server) {
      // A pad that goes quiet (locked phone, Wi-Fi gone) frees the slot.
      const sweep = setInterval(() => {
        const now = Date.now();
        if (pad && now - pad.lastSeen >= PHONE_PAD_IDLE_MS) {
          pad = null;
          announcePad();
        }
        for (const [key, entry] of rates) if (now - entry.windowStart > 5_000) rates.delete(key);
      }, 250);
      sweep.unref?.();
      const logTimer = setInterval(() => void flushLog(server), logEveryMs);
      logTimer.unref?.();
      server.httpServer?.once("close", () => {
        clearInterval(sweep);
        clearInterval(logTimer);
      });

      server.middlewares.use((request, response, next) => {
        const pathname = (request.url ?? "").split("?")[0];
        if (pathname !== PHONE_PATH && !pathname.startsWith(`${PHONE_PATH}/`)) return next();
        const host = request.headers.host ?? request.headers[":authority"] ?? "";
        const origin = request.headers.origin;
        if (!allowedHosts.has(host) || (origin !== undefined && !allowedOrigins.has(origin))) {
          return reply(response, 403);
        }
        if (pathname === `${PHONE_PATH}/pad`) {
          handlePad(request, response).catch(() => reply(response, 500));
          return;
        }
        if (!isLocal(request.socket?.remoteAddress)) return reply(response, 403);
        if (pathname === `${PHONE_PATH}/events`) return handleEvents(request, response);
        if (pathname === `${PHONE_PATH}/telemetry`) {
          handleTelemetry(request, response).catch(() => reply(response, 500));
          return;
        }
        if (pathname === `${PHONE_PATH}/info`) {
          return reply(response, 200, { url: controllerUrl, lan, port, steerResponse: PHONE_STEER_RESPONSE });
        }
        if (pathname === `${PHONE_PATH}/qr.svg` && controllerUrl) {
          QRCode.toString(controllerUrl, { type: "svg", margin: 1, errorCorrectionLevel: "M" })
            .then((svg) => {
              response.setHeader("Content-Type", "image/svg+xml");
              response.setHeader("Cache-Control", "no-store");
              response.end(svg);
            })
            .catch(() => reply(response, 500));
          return;
        }
        return reply(response, 404);
      });

      server.httpServer?.once("listening", () => {
        const where = lan
          ? `open https://${lan}:${port}/?controller=phone on this Mac, then scan the QR with the phone`
          : "no Wi-Fi address found, so no phone can reach this server";
        server.config.logger.info(`\n  phone controller: ${where}\n`);
      });
    },
  };
}
