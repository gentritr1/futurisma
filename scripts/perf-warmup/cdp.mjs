// Minimal CDP client over Node 20's experimental WebSocket (run node with
// --experimental-websocket). No dependencies; drives the installed Google Chrome.
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";

export const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
export const DEBUG_PORT = Number(process.env.DEBUG_PORT ?? 9431);
/** Results, Chrome profiles and the pid file go here (never into the repo). */
export const OUT_DIR = process.env.PERF_OUT ?? "/tmp/futurisma-perf-warmup";
mkdirSync(OUT_DIR, { recursive: true });
import { execSync } from "node:child_process";

export async function launchChrome() {
  if (execSync(`lsof -tiTCP:${DEBUG_PORT} -sTCP:LISTEN || true`).toString().trim()) throw new Error(`port ${DEBUG_PORT} busy before launch`);
  const dir = mkdtempSync(`${OUT_DIR}/profile-`);
  const child = spawn(CHROME, [
    "--headless=new", `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${dir}`,
    "--window-size=1280,720", "--enable-gpu", "--use-angle=metal", "--ignore-gpu-blocklist",
    "--no-first-run", "--no-default-browser-check", "--autoplay-policy=no-user-gesture-required", "--mute-audio",
    "about:blank",
  ], { stdio: "ignore", detached: false });
  writeFileSync(`${OUT_DIR}/chrome.pid`, String(child.pid));
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`);
      if (r.ok) {
        // The listener must be OUR Chrome, never another agent's on the same port.
        const owner = execSync(`lsof -tiTCP:${DEBUG_PORT} -sTCP:LISTEN || true`).toString().trim().split("\n");
        if (!owner.includes(String(child.pid))) { child.kill("SIGTERM"); throw new Error(`port ${DEBUG_PORT} owned by ${owner} not ${child.pid}`); }
        return { child, dir, version: await r.json() };
      }
    } catch (e) { if (String(e).includes("owned by")) throw e; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("chrome did not start");
}

export async function newPage() {
  const r = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/new?about:blank`, { method: "PUT" });
  const target = await r.json();
  return connect(target.webSocketDebuggerUrl, target.id);
}

export async function closePage(id) {
  await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/close/${id}`).catch(() => undefined);
}

export function connect(url, id) {
  const ws = new WebSocket(url);
  let seq = 0;
  const pending = new Map();
  const listeners = new Map();
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id !== undefined) {
      const p = pending.get(msg.id); pending.delete(msg.id);
      if (!p) return;
      if (msg.error) p.reject(new Error(`${p.method}: ${msg.error.message}`)); else p.resolve(msg.result);
    } else {
      for (const fn of listeners.get(msg.method) ?? []) fn(msg.params);
      for (const fn of listeners.get("*") ?? []) fn(msg);
    }
  };
  const api = {
    id,
    ready: new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; }),
    send(method, params = {}) {
      const mid = ++seq;
      ws.send(JSON.stringify({ id: mid, method, params }));
      return new Promise((resolve, reject) => pending.set(mid, { resolve, reject, method }));
    },
    on(method, fn) { if (!listeners.has(method)) listeners.set(method, []); listeners.get(method).push(fn); },
    off(method, fn) { const l = listeners.get(method); if (l) listeners.set(method, l.filter((f) => f !== fn)); },
    async eval(expression, awaitPromise = true) {
      const r = await api.send("Runtime.evaluate", { expression, awaitPromise, returnByValue: true });
      if (r.exceptionDetails) throw new Error(`eval failed: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
      return r.result.value;
    },
    // Wait on page state; fails loudly on timeout.
    async waitFor(expression, timeoutMs = 60000, label = expression) {
      const started = Date.now();
      while (Date.now() - started < timeoutMs) {
        let v; try { v = await api.eval(expression); } catch { v = undefined; }
        if (v) return v;
        await new Promise((r) => setTimeout(r, 100));
      }
      throw new Error(`timeout waiting for ${label}`);
    },
    close() { ws.close(); },
  };
  return api;
}

// Trace capture streamed back through IO.read.
export async function startTrace(page, categories) {
  await page.send("Tracing.start", { transferMode: "ReturnAsStream", traceConfig: { includedCategories: categories, recordMode: "recordAsMuchAsPossible" } });
}
export async function stopTrace(page) {
  const done = new Promise((resolve) => page.on("Tracing.tracingComplete", resolve));
  await page.send("Tracing.end");
  const { stream } = await done;
  let data = "";
  for (;;) {
    const chunk = await page.send("IO.read", { handle: stream, size: 4 << 20 });
    data += chunk.base64Encoded ? Buffer.from(chunk.data, "base64").toString() : chunk.data;
    if (chunk.eof) break;
  }
  await page.send("IO.close", { handle: stream });
  const parsed = JSON.parse(data);
  return Array.isArray(parsed) ? parsed : parsed.traceEvents;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// In-page recorder: rAF deltas, long tasks, LoAF with script attribution.
export const RECORDER = `(() => {
  const rec = window.__perf = { frames: [], longtasks: [], loafs: [], marks: [] };
  const raf = window.requestAnimationFrame.bind(window);
  let last = 0;
  const tick = (t) => { if (last) rec.frames.push([t, t - last]); last = t; raf(tick); };
  raf(tick);
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) rec.longtasks.push([e.startTime, e.duration]); }).observe({ type: 'longtask', buffered: true }); } catch {}
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) rec.loafs.push({ start: e.startTime, duration: e.duration, blocking: e.blockingDuration, render: e.renderStart, style: e.styleAndLayoutStart, scripts: e.scripts.map((s) => ({ d: Math.round(s.duration), fwd: Math.round(s.forcedStyleAndLayoutDuration), inv: s.invoker, fn: s.sourceFunctionName, url: (s.sourceURL || '').replace(location.origin, ''), ch: s.sourceCharPosition })) }); }).observe({ type: 'long-animation-frame', buffered: true }); } catch {}
  rec.mark = (name) => rec.marks.push([name, performance.now()]);
})();`;

export function stats(values) {
  const v = [...values].sort((a, b) => a - b);
  if (!v.length) return { n: 0 };
  const q = (p) => v[Math.min(v.length - 1, Math.floor(p * v.length))];
  const sum = v.reduce((a, b) => a + b, 0);
  return { n: v.length, mean: +(sum / v.length).toFixed(2), p50: +q(0.5).toFixed(2), p95: +q(0.95).toFixed(2), p99: +q(0.99).toFixed(2), max: +v[v.length - 1].toFixed(2) };
}
