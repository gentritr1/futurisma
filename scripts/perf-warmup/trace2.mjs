// Usage: node --experimental-websocket trace2.mjs <base> <map> <label> [demo|menu]
// Cold load traced from navigation (devtools.timeline + gpu + V8 sampling profiler) until
// 2 s after the phase becomes visible (race clock for demo, intro for menu). Every main-thread
// task > 50 ms from 1 s before the phase change on is attributed: CPU-profile self/inclusive
// top, its biggest trace children, and GPU-process events that overlap it.
import { writeFileSync, rmSync } from "node:fs";
import { launchChrome, newPage, closePage, startTrace, stopTrace, sleep, OUT_DIR } from "./cdp.mjs";

const [base, map, label, mode = "demo"] = process.argv.slice(2);
const MARKS = `(() => { const note = () => { try { performance.mark('phase-' + (document.body.dataset.phase || 'none')); } catch {} };
  const start = () => new MutationObserver(note).observe(document.body, { attributes: true, attributeFilter: ['data-phase'] });
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start); })();`;
const c = await launchChrome();
const kill = setTimeout(() => { c.child.kill("SIGKILL"); process.exit(2); }, 200000);
const out = { base, map, label, mode };
try {
  const page = await newPage(); await page.ready;
  await page.send("Page.enable"); await page.send("Runtime.enable");
  await page.send("Page.addScriptToEvaluateOnNewDocument", { source: MARKS });
  await startTrace(page, ["toplevel", "devtools.timeline", "disabled-by-default-devtools.timeline", "blink.user_timing", "gpu", "disabled-by-default-gpu.service", "v8", "disabled-by-default-v8.cpu_profiler", "viz", "cc"]);
  await page.send("Page.navigate", { url: `${base}/?map=${map}&diagnostics=1${mode === "demo" ? "&demo=1&laps=3" : ""}` });
  const phase = mode === "demo" ? "race" : "intro";
  await page.waitFor(`document.body.dataset.phase === '${phase}'`, 150000, phase);
  const shown = await page.eval(`performance.now()`);
  await page.waitFor(`performance.now() > ${shown + 2500}`, 20000, "observe");
  const events = await stopTrace(page);
  await closePage(page.id);
  const threads = new Map();
  for (const e of events) if (e.ph === "M" && e.name === "thread_name") threads.set(`${e.pid}:${e.tid}`, e.args.name);
  const mark = events.filter((e) => e.name === `phase-${phase}`).sort((a, b) => a.ts - b.ts)[0];
  if (!mark) throw new Error("no phase mark in trace");
  const mainKey = `${mark.pid}:${mark.tid}`;
  const main = events.filter((e) => `${e.pid}:${e.tid}` === mainKey && e.ph === "X");
  const tasks = main.filter((e) => (e.name === "ThreadControllerImpl::RunTask" || e.name === "RunTask") && e.dur > 50000 && e.ts + e.dur > mark.ts - 1000000).sort((a, b) => a.ts - b.ts);
  // CPU profile samples for the renderer main thread.
  const nodes = new Map(); const samples = []; const profiles = new Map();
  for (const e of events) {
    if (e.name === "Profile") profiles.set(e.id, { t: e.args.data.startTime, pid: e.pid, tid: e.tid });
    if (e.name !== "ProfileChunk") continue;
    const p = profiles.get(e.id) ?? (profiles.set(e.id, { t: 0, pid: e.pid, tid: e.tid }), profiles.get(e.id));
    const d = e.args.data;
    for (const n of d.cpuProfile?.nodes ?? []) nodes.set(`${e.id}:${n.id}`, { ...n.callFrame, parent: n.parent !== undefined ? `${e.id}:${n.parent}` : null });
    const s = d.cpuProfile?.samples ?? []; const dt = d.timeDeltas ?? [];
    for (let i = 0; i < s.length; i++) { p.t += dt[i] ?? 0; samples.push({ node: `${e.id}:${s[i]}`, ts: p.t, pid: p.pid }); }
  }
  const fmt = (cf) => `${cf.functionName || "(anon)"} ${String(cf.url).replace(/^https?:\/\/[^/]+/, "")}:${cf.lineNumber + 1}:${cf.columnNumber}`;
  out.tasks = tasks.map((t) => {
    const self = {}, incl = {}; let n = 0;
    for (const s of samples) {
      if (s.pid !== t.pid || s.ts < t.ts || s.ts > t.ts + t.dur) continue;
      n++; const leaf = nodes.get(s.node); if (!leaf) continue;
      self[fmt(leaf)] = (self[fmt(leaf)] ?? 0) + 1;
      const seen = new Set();
      for (let cf = leaf; cf; cf = cf.parent ? nodes.get(cf.parent) : null) { const k = fmt(cf); if (seen.has(k)) continue; seen.add(k); incl[k] = (incl[k] ?? 0) + 1; }
    }
    const ms = t.dur / 1000;
    const top = (o, k) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, k).map(([name, c]) => `${(c / Math.max(1, n) * ms).toFixed(0)}ms ${name}`);
    const children = main.filter((e) => e !== t && e.ts >= t.ts && e.ts + e.dur <= t.ts + t.dur && e.dur > 3000 && !/RunTask/.test(e.name)).sort((a, b) => b.dur - a.dur).slice(0, 10).map((e) => `${e.name} ${(e.dur / 1000).toFixed(1)}ms@${((e.ts - t.ts) / 1000).toFixed(0)}`);
    const gpu = events.filter((e) => e.ph === "X" && e.dur > 3000 && e.ts < t.ts + t.dur && e.ts + e.dur > t.ts && /Gpu|GPU|Viz|Compositor/.test(threads.get(`${e.pid}:${e.tid}`) ?? "") && !/RunTask|ThreadControllerImpl/.test(e.name))
      .sort((a, b) => b.dur - a.dur).slice(0, 10).map((e) => `${threads.get(`${e.pid}:${e.tid}`)} ${e.name} ${(e.dur / 1000).toFixed(1)}ms@${((e.ts - t.ts) / 1000).toFixed(0)}`);
    return { atMsFromPhase: Math.round((t.ts - mark.ts) / 1000), ms: Math.round(ms), samples: n, self: top(self, 8), inclusive: top(incl, 14), children, gpu };
  });
} catch (e) { out.error = String(e); console.error(e); }
finally { clearTimeout(kill); c.child.kill("SIGTERM"); await sleep(300); try { rmSync(c.dir, { recursive: true, force: true }); } catch {} }
writeFileSync(`${OUT_DIR}/trace2-${map}-${label}.json`, JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1).slice(0, 9000));
process.exit(0);
