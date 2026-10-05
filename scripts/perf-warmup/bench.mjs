// Usage: node --experimental-websocket bench.mjs <base> <map> <tag> [menu|drive|both]
// COLD = fresh --user-data-dir per browser. Runs:
//   menu-cold : ?map=X&diagnostics=1            -> time to phase intro, long frames in the 5 s after it
//   drive-cold: ?map=X&diagnostics=1&demo=1&laps=3 -> time to race clock, 20 s window after it
//   drive-warm: same browser as drive-cold, second navigation (HTTP + GPU program cache warm)
import { writeFileSync, rmSync } from "node:fs";
import { launchChrome, newPage, closePage, RECORDER, sleep, stats, OUT_DIR } from "./cdp.mjs";
import { GLHOOK } from "./analyze.mjs";

const [base, map, tag = "x", which = "both"] = process.argv.slice(2);
const OUT = `${OUT_DIR}/${map}-${tag}.json`;
const PHASES = `(() => { const rec = window.__phases = []; const note = () => rec.push([document.body?.dataset.phase ?? '', Math.round(performance.now())]);
  const start = () => { note(); new MutationObserver(note).observe(document.body, { attributes: true, attributeFilter: ['data-phase'] }); };
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
  const hub = window.__THREE_DEVTOOLS__ = new EventTarget(); window.__renderers = [];
  hub.addEventListener('observe', (e) => { if (e.detail && e.detail.isWebGLRenderer) window.__renderers.push(e.detail); }); })();`;

let current = null;
const hardStop = setTimeout(() => { console.error("bench hard timeout"); try { current?.child.kill("SIGKILL"); } catch {} process.exit(2); }, 240000);

async function session(fn) {
  current = await launchChrome();
  try { return await fn(); } finally { current.child.kill("SIGTERM"); await sleep(300); try { rmSync(current.dir, { recursive: true, force: true }); } catch {} }
}

async function open() {
  const page = await newPage(); await page.ready;
  await page.send("Page.enable"); await page.send("Runtime.enable");
  const logs = [], errors = [];
  page.on("Runtime.consoleAPICalled", (p) => { const text = p.args.map((a) => a.value ?? a.description).join(" "); if (/WARMUP|CORRIDOR/.test(text)) logs.push(text.slice(0, 400)); if (p.type === "error") errors.push(text.slice(0, 200)); });
  page.on("Runtime.exceptionThrown", (p) => errors.push(p.exceptionDetails.exception?.description?.slice(0, 200)));
  await page.send("Page.addScriptToEvaluateOnNewDocument", { source: RECORDER });
  await page.send("Page.addScriptToEvaluateOnNewDocument", { source: GLHOOK });
  await page.send("Page.addScriptToEvaluateOnNewDocument", { source: PHASES });
  return { page, logs, errors };
}

const DIAG = `(() => { const r = window.__renderers[0]; if (!r) return null; return { programs: r.info.programs.length, textures: r.info.memory.textures, geometries: r.info.memory.geometries, renderers: window.__renderers.length }; })()`;
// Which LoAF contains the first draw call: the first-render block.
const FIRST_RENDER = `(() => { const draws = window.__gl.raw.events; const loafs = window.__perf.loafs; const f = window.__firstDraw; if (!f) return null; const l = loafs.find((x) => x.start <= f && f <= x.start + x.duration); return { firstDrawAt: Math.round(f), loafMs: l ? Math.round(l.duration) : null, loafAt: l ? Math.round(l.start) : null }; })()`;
const FIRST_DRAW_HOOK = `(() => { for (const C of [WebGL2RenderingContext]) { for (const n of ['drawElements','drawArrays','drawElementsInstanced','drawArraysInstanced']) { const o = C.prototype[n]; C.prototype[n] = function (...a) { if (!window.__firstDraw) window.__firstDraw = performance.now(); return o.apply(this, a); }; } } })();`;

async function menuRun() {
  return session(async () => {
    const { page, logs, errors } = await open();
    await page.send("Page.addScriptToEvaluateOnNewDocument", { source: FIRST_DRAW_HOOK });
    await page.send("Page.navigate", { url: `${base}/?map=${map}&diagnostics=1` });
    await page.waitFor(`document.body.dataset.phase === 'intro'`, 120000, "intro");
    const shownMs = await page.eval(`window.__phases.find(p => p[0] === 'intro')[1]`);
    await page.waitFor(`performance.now() > ${shownMs + 5000}`, 15000, "5 s after intro");
    const r = await page.eval(`({ frames: window.__perf.frames, loafs: window.__perf.loafs, phases: window.__phases })`);
    const after = r.frames.filter((f) => f[0] > shownMs && f[0] <= shownMs + 5000);
    // The DOM change is painted in the rendering update of the first rAF frame at/after it;
    // the frame that ENDS there straddles the switch (loading screen frozen while it runs).
    const firstAfter = r.frames.find((f) => f[0] >= shownMs);
    const visibleMs = firstAfter ? Math.round(firstAfter[0]) : null;
    const straddleMs = firstAfter ? Math.round(firstAfter[1]) : null;
    const visible5s = r.frames.filter((f) => f[0] - f[1] >= (firstAfter?.[0] ?? Infinity) - 0.5 && f[0] <= (firstAfter?.[0] ?? 0) + 5000);
    const out = {
      shownMs, visibleMs, straddleMs,
      stallsAfterVisible: { frames: visible5s.length, expectedAt60: Math.round(5000 / 16.667), over50: visible5s.filter((f) => f[1] > 50).map((f) => [Math.round(f[0] - f[1] - visibleMs), Math.round(f[1])]), max: Math.round(Math.max(0, ...visible5s.map((f) => f[1]))) },
      firstRender: await page.eval(FIRST_RENDER),
      afterShown: { frames: after.length, expectedAt60: Math.round(5000 / 16.667), over50: after.filter((f) => f[1] > 50).map((f) => [Math.round(f[0] - shownMs), Math.round(f[1])]), max: Math.round(Math.max(0, ...after.map((f) => f[1]))) },
      loafsAfterShown: r.loafs.filter((l) => l.start + l.duration > shownMs && l.start < shownMs + 5000 && l.duration > 50).map((l) => ({ at: Math.round(l.start - shownMs), d: Math.round(l.duration), block: Math.round(l.blocking), render: l.render ? Math.round(l.start + l.duration - l.render) : 0, style: l.style ? Math.round(l.start + l.duration - l.style) : 0, scripts: l.scripts })),
      loafsOver50BeforeShown: r.loafs.filter((l) => l.start < shownMs && l.duration > 50).map((l) => [Math.round(l.start), Math.round(l.duration)]),
      diag: await page.eval(DIAG), logs, errors: errors.slice(0, 8),
    };
    await closePage(page.id);
    return out;
  });
}

async function driveOnce(page, logs) {
  await page.send("Page.navigate", { url: `${base}/?map=${map}&diagnostics=1&demo=1&laps=3` });
  await page.waitFor(`(document.getElementById('time-value')?.textContent ?? '00:00.000') !== '00:00.000'`, 150000, "race clock");
  const clockMs = Math.round(await page.eval(`performance.now()`));
  const d0 = await page.eval(DIAG);
  const allFrames = await page.eval(`window.__perf.frames.map(f => [f[0], f[1]])`);
  const pre = await page.eval(`({ phases: window.__phases, longBefore: window.__perf.frames.filter(f => f[1] > 50).map(f => [Math.round(f[0]), Math.round(f[1])]), loafs: window.__perf.loafs.filter(l => l.duration > 50).map(l => ({ at: Math.round(l.start), d: Math.round(l.duration), render: l.render ? Math.round(l.start + l.duration - l.render) : 0, style: l.style ? Math.round(l.start + l.duration - l.style) : 0, scripts: l.scripts })) })`);
  await page.eval(`window.__perf.frames.length = 0; window.__perf.loafs.length = 0; window.__gl.reset(); true`);
  const t0 = await page.eval(`performance.now()`);
  await page.waitFor(`performance.now() > ${t0 + 20000}`, 30000, "20 s window");
  const d1 = await page.eval(DIAG);
  const perf = await page.eval(`({ frames: window.__perf.frames, loafs: window.__perf.loafs, gl: window.__gl.summary(), clock: document.getElementById('time-value').textContent })`);
  const deltas = perf.frames.map((f) => f[1]);
  const windowMs = perf.frames.length ? perf.frames.at(-1)[0] - perf.frames[0][0] + deltas[0] : 0;
  const raceShown = pre.phases.find((p) => p[0] === "race")?.[1] ?? null;
  const firstAfter = allFrames.find((f) => raceShown !== null && f[0] >= raceShown);
  const raceVisibleMs = firstAfter ? Math.round(firstAfter[0]) : null;
  const countdown = allFrames.filter((f) => firstAfter && f[0] - f[1] >= firstAfter[0] - 0.5 && f[0] <= clockMs);
  return {
    raceShownMs: raceShown, raceVisibleMs, straddleMs: firstAfter ? Math.round(firstAfter[1]) : null, clockMs,
    countdownStalls: { frames: countdown.length, over50: countdown.filter((f) => f[1] > 50).map((f) => [Math.round(f[0] - f[1] - raceVisibleMs), Math.round(f[1])]), max: Math.round(Math.max(0, ...countdown.map((f) => f[1]))) },
    longFramesShownToClock: pre.longBefore.filter((f) => raceShown !== null && f[0] > raceShown),
    loafsShownToClock: pre.loafs.filter((l) => raceShown !== null && l.at + l.d > raceShown),
    longFramesBeforeShown: pre.longBefore.filter((f) => raceShown === null || f[0] <= raceShown),
    window: { ms: Math.round(windowMs), frames: deltas.length, expectedAt60: Math.round(windowMs / 16.667), frameMs: stats(deltas), over33: deltas.filter((x) => x > 33.4).length, over50: deltas.filter((x) => x > 50).length, longFrames: perf.frames.filter((f) => f[1] > 33.4).map((f) => [Math.round(f[0] - t0), Math.round(f[1])]) },
    programsDiag: [d0?.programs, d1?.programs], texturesDiag: [d0?.textures, d1?.textures],
    programsCompiledInWindow: perf.gl.programs.length, programKinds: perf.gl.programs.map((p) => `${p[1]}|${p[2]}|${p[3]}|${p[4]}`),
    glHeavy: Object.fromEntries(Object.entries(perf.gl.calls).filter(([k]) => /link|Program|Shader|tex|Mipmap/.test(k))), glEvents: perf.gl.events.slice(0, 10),
    worstLoafs: perf.loafs.sort((a, b) => b.duration - a.duration).slice(0, 3).map((l) => ({ at: Math.round(l.start - t0), d: Math.round(l.duration), render: Math.round(l.render ? l.start + l.duration - l.render : 0), scripts: l.scripts.slice(0, 3) })),
    clockAtEnd: perf.clock, logs: logs.splice(0),
  };
}

async function driveRuns() {
  return session(async () => {
    const { page, logs, errors } = await open();
    const cold = await driveOnce(page, logs);
    const warm = await driveOnce(page, logs);
    await closePage(page.id);
    return { cold, warm, errors: errors.slice(0, 8) };
  });
}

const result = { base, map, tag, at: new Date().toISOString() };
try {
  if (which !== "drive") result.menu = await menuRun();
  if (which !== "menu") result.drive = await driveRuns();
} catch (e) { result.error = String(e); console.error(e); }
clearTimeout(hardStop);
writeFileSync(OUT, JSON.stringify(result, null, 1));
const m = result.menu, c = result.drive?.cold, w = result.drive?.warm;
const warmup = (logs) => { const l = (logs ?? []).find((x) => x.includes("FUTURISMA_WARMUP")); return l ? JSON.parse(l.slice(l.indexOf("{"))).totalMs : null; };
const drv = (d) => d && { raceVisible: d.raceVisibleMs, straddle: d.straddleMs, clock: d.clockMs, countdownMax: d.countdownStalls.max, countdownOver50: d.countdownStalls.over50, win: [d.window.frames, d.window.expectedAt60], max: d.window.frameMs.max, over50: d.window.over50, progs: d.programsCompiledInWindow, diag: d.programsDiag, warmupMs: warmup(d.logs) };
console.log(JSON.stringify({ map, label: tag, error: result.error,
  menu: m && { visible: m.visibleMs, straddle: m.straddleMs, stallsMax: m.stallsAfterVisible.max, stallsOver50: m.stallsAfterVisible.over50, frames: [m.stallsAfterVisible.frames, m.stallsAfterVisible.expectedAt60], warmupMs: warmup(m.logs) },
  cold: drv(c), warm: drv(w) }));
process.exit(0);
