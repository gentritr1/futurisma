// Minimal CDP client over Node 20's experimental WebSocket (run every script
// with `node --experimental-websocket`). No dependencies. Each launch is a
// fresh Chrome profile (an empty GPU shader cache: COLD), removed on close.
import { spawn, execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";

export const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
export const DEBUG_PORT = Number(process.env.DEBUG_PORT ?? 9531);
export const OUT = process.env.OUT ?? "/tmp/garage-smooth";
mkdirSync(OUT, { recursive: true });

export async function launchChrome() {
  if (execSync(`lsof -tiTCP:${DEBUG_PORT} -sTCP:LISTEN || true`).toString().trim()) throw new Error(`port ${DEBUG_PORT} busy before launch`);
  const dir = mkdtempSync(`${OUT}/profile-`);
  const child = spawn(CHROME, [
    "--headless=new", `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${dir}`,
    "--window-size=1280,720", "--enable-gpu", "--use-angle=metal", "--ignore-gpu-blocklist",
    "--no-first-run", "--no-default-browser-check", "--autoplay-policy=no-user-gesture-required", "--mute-audio",
    "about:blank",
  ], { stdio: "ignore", detached: false });
  const close = async () => {
    if (child.exitCode === null) {
      const exited = new Promise((resolve) => child.once("exit", resolve));
      child.kill("SIGTERM");
      await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 5000))]);
    }
    rmSync(dir, { recursive: true, force: true });
  };
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`);
      if (r.ok) {
        // The listener must be OUR Chrome, never another process on the same port.
        const owner = execSync(`lsof -tiTCP:${DEBUG_PORT} -sTCP:LISTEN || true`).toString().trim().split("\n");
        if (!owner.includes(String(child.pid))) { await close(); throw new Error(`port ${DEBUG_PORT} owned by ${owner} not ${child.pid}`); }
        return { child, dir, close };
      }
    } catch (e) { if (String(e).includes("owned by")) throw e; }
    await new Promise((r) => setTimeout(r, 100));
  }
  await close();
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
    // Waits on page state; fails loudly on timeout.
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

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// In-page recorder: rAF deltas, long tasks, LoAF with script attribution.
export const RECORDER = `(() => {
  const rec = window.__perf = { frames: [], longtasks: [], loafs: [] };
  const raf = window.requestAnimationFrame.bind(window);
  let last = 0;
  const tick = (t) => { if (last) rec.frames.push([t, t - last]); last = t; raf(tick); };
  raf(tick);
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) rec.longtasks.push([e.startTime, e.duration]); }).observe({ type: 'longtask', buffered: true }); } catch {}
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) rec.loafs.push({ start: e.startTime, duration: e.duration, render: e.renderStart, style: e.styleAndLayoutStart, scripts: e.scripts.map((s) => ({ d: Math.round(s.duration), fwd: Math.round(s.forcedStyleAndLayoutDuration), inv: s.invoker, fn: s.sourceFunctionName, url: (s.sourceURL || '').replace(location.origin, ''), ch: s.sourceCharPosition })) }); }).observe({ type: 'long-animation-frame', buffered: true }); } catch {}
})();`;

// In-page WebGL hook: counts and times the calls that block the main thread
// (program links and link-status reads, texture uploads), and names every new
// program by its SHADER_NAME.
export const GLHOOK = `(() => {
  const S = { calls: {}, events: [], programs: [] };
  for (const Ctx of [window.WebGL2RenderingContext, window.WebGLRenderingContext]) {
    if (!Ctx) continue;
    const orig = Ctx.prototype.shaderSource;
    Ctx.prototype.shaderSource = function (shader, src) {
      if (src.includes('gl_Position') && S.programs.length < 2000) {
        const m = src.match(/#define SHADER_NAME ([^\\s]+)/);
        S.programs.push([Math.round(performance.now()), m ? m[1] : '']);
      }
      return orig.call(this, shader, src);
    };
  }
  const watch = ['compileShader','linkProgram','getProgramParameter','getShaderParameter','getProgramInfoLog','getShaderInfoLog','texImage2D','texSubImage2D','texStorage2D','generateMipmap','bufferData','readPixels'];
  for (const Ctx of [window.WebGL2RenderingContext, window.WebGLRenderingContext]) {
    if (!Ctx) continue;
    for (const name of watch) {
      const orig = Ctx.prototype[name]; if (!orig || orig.__hooked) continue;
      const wrapped = function (...args) {
        const t = performance.now(); const r = orig.apply(this, args); const d = performance.now() - t;
        const c = S.calls[name] ??= { n: 0, ms: 0 }; c.n++; c.ms += d;
        if (d > 2) S.events.push([Math.round(t), name, +d.toFixed(1)]);
        return r;
      };
      wrapped.__hooked = true; Ctx.prototype[name] = wrapped;
    }
  }
  window.__gl = { reset() { S.calls = {}; S.events = []; S.programs = []; }, summary() {
    const calls = {}; for (const [k, v] of Object.entries(S.calls)) calls[k] = { n: v.n, ms: +v.ms.toFixed(1) };
    return { calls, events: S.events.slice().sort((a, b) => b[2] - a[2]).slice(0, 40), programs: S.programs.slice(0, 300) };
  } };
})();`;

export function stats(values) {
  const v = [...values].sort((a, b) => a - b);
  if (!v.length) return { n: 0 };
  const q = (p) => v[Math.min(v.length - 1, Math.floor(p * v.length))];
  return { n: v.length, p50: +q(0.5).toFixed(2), p95: +q(0.95).toFixed(2), max: +v[v.length - 1].toFixed(2) };
}
