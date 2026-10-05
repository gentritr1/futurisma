// Usage: node --experimental-websocket camera-trace.mjs <base> <tag>
// Samples the bay camera on every rendered garage frame (three's devtools hook
// wraps renderer.render) and characterises each move from the LAST sample
// before the click: first-frame step, peak-speed frame, t90/t99, overshoot.
// Then a rapid retarget (second click 100 ms into a move) for continuity.
import { writeFileSync } from "node:fs";
import { launchChrome, newPage, closePage, RECORDER, OUT, sleep } from "./cdp.mjs";
const [base = "http://localhost:5196", tag = "run"] = process.argv.slice(2);
const HOOK = `(() => { window.__cam = []; const hub = window.__THREE_DEVTOOLS__ = new EventTarget();
  hub.addEventListener('observe', (e) => { const r = e.detail; if (!r || !r.isWebGLRenderer) return; const render = r.render.bind(r);
    r.render = (scene, camera) => { if (scene.name === 'garage_service_bay') { camera.updateMatrixWorld(); const p = camera.position; const v = camera.view; window.__cam.push([performance.now(), p.x, p.y, p.z, v ? v.offsetX : 0, v ? v.offsetY : 0]); } return render(scene, camera); }; }); })();`;
const { close } = await launchChrome();
const out = { base, moves: [], retarget: null };
const dist = (a, b) => Math.hypot(a[1] - b[1], a[2] - b[2], a[3] - b[3]);
try {
  const page = await newPage(); await page.ready; await page.send("Page.enable"); await page.send("Runtime.enable");
  await page.send("Page.addScriptToEvaluateOnNewDocument", { source: RECORDER });
  await page.send("Page.addScriptToEvaluateOnNewDocument", { source: HOOK });
  await page.send("Page.navigate", { url: `${base}/?map=frostline&diagnostics=1` });
  await page.waitFor(`document.body.dataset.phase === 'intro'`, 60000);
  await page.waitFor(`(() => { const f = window.__perf.frames; return f.length > 200 && performance.now() > 6000 && f.slice(-120).every(x => x[1] < 40); })()`, 30000, "menu settled");
  await page.eval(`document.getElementById('garage-button').click(); true`);
  await page.waitFor(`document.getElementById('garage-screen')?.dataset.modelReady === 'true'`, 20000);
  await sleep(1500);
  const click = (key) => page.eval(`(() => { const t = performance.now(); document.querySelector('#garage-screen [data-key="${key}"]')?.click(); return t; })()`);
  const seq = ["tab-test", "tab-paint", "tab-craft", "tab-parts", "part-engine", "switch-plasma", "whole", "tab-craft"];
  for (const pass of ["warm", "measure"]) for (const key of seq) {
    const t = await click(key);
    await sleep(1300);
    if (pass !== "measure") continue;
    const all = await page.eval(`window.__cam`);
    const before = all.filter((c) => c[0] < t).at(-1);
    const s = all.filter((c) => c[0] >= t && c[0] <= t + 1200);
    if (!before || s.length < 3) { out.moves.push({ key, samples: s.length }); continue; }
    const pe = s.at(-1), total = dist(before, pe);
    if (total < 0.05) { out.moves.push({ key, totalM: +total.toFixed(3), note: "no camera move" }); continue; }
    const path = [before, ...s];
    const steps = path.slice(1).map((c, i) => dist(c, path[i]));
    // Times from the click (the bay may have been idle, drawing nothing, before it).
    const at = (share) => { const c = s.find((c) => dist(c, pe) <= (1 - share) * total); return c ? Math.round(c[0] - t) : null; };
    const dir = [pe[1] - before[1], pe[2] - before[2], pe[3] - before[3]].map((v) => v / total);
    const along = Math.max(...s.map((c) => (c[1] - before[1]) * dir[0] + (c[2] - before[2]) * dir[1] + (c[3] - before[3]) * dir[2]));
    const windowMs = s.at(-1)[0] - t;
    out.moves.push({
      key, frames: s.length, expectedFrames: Math.round(windowMs / 16.667), totalM: +total.toFixed(2),
      firstStepPct: +(100 * steps[0] / total).toFixed(2), peakFrame: steps.indexOf(Math.max(...steps)) + 1,
      t90ms: at(0.9), t99ms: at(0.99), overshootPct: +(100 * (along / total - 1)).toFixed(3),
      offsetPx: [Math.round(pe[4] - before[4]), Math.round(pe[5] - before[5])],
      firstOffsetStepPct: Math.abs(pe[4] - before[4]) > 1 ? +(100 * Math.abs(s[0][4] - before[4]) / Math.abs(pe[4] - before[4])).toFixed(2) : null,
      firstFrameAfterClickMs: +(s[0][0] - t).toFixed(1), dtMs: s.slice(1, 7).map((c, i) => +(c[0] - s[i][0]).toFixed(1)),
    });
  }
  // Rapid retarget: PAINT, then TEST 100 ms later (two tab clicks inside 150 ms).
  await click("tab-craft"); await sleep(1300);
  const t1 = await click("tab-paint"); await sleep(100); const t2 = await click("tab-test"); await sleep(1300);
  const all = await page.eval(`window.__cam`);
  const before = all.filter((c) => c[0] < t1).at(-1);
  const s = [before, ...all.filter((c) => c[0] >= t1 && c[0] <= t2 + 1200)];
  const vec = s.slice(1).map((c, i) => [c[1] - s[i][1], c[2] - s[i][2], c[3] - s[i][3]]);
  const len = (v) => Math.hypot(...v);
  const angle = (a, b) => (len(a) && len(b) ? Math.acos(Math.max(-1, Math.min(1, (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (len(a) * len(b))))) * 180 / Math.PI : 0);
  const retargetIndex = s.findIndex((c) => c[0] >= t2) - 1; // first step after the second click
  let worstRatio = 0, worstTurn = 0;
  for (let i = Math.max(1, retargetIndex); i < Math.min(vec.length, retargetIndex + 25); i++) {
    if (len(vec[i]) < 1e-4 && len(vec[i - 1]) < 1e-4) continue;
    worstRatio = Math.max(worstRatio, len(vec[i]) / Math.max(1e-9, len(vec[i - 1])));
    worstTurn = Math.max(worstTurn, angle(vec[i], vec[i - 1]));
  }
  out.retarget = { secondClickAfterMs: Math.round(t2 - t1), retargetStep: retargetIndex, worstStepRatio: +worstRatio.toFixed(2), worstTurnDeg: Math.round(worstTurn),
    stepsMm: vec.slice(Math.max(0, retargetIndex - 3), retargetIndex + 8).map((v) => Math.round(len(v) * 1000)) };
  await closePage(page.id);
} catch (e) { out.error = String(e); console.error(e); } finally { await close(); }
writeFileSync(`${OUT}/camera-${tag}.json`, JSON.stringify(out, null, 1));
for (const m of out.moves) console.log(JSON.stringify(m));
console.log("retarget", JSON.stringify(out.retarget));
