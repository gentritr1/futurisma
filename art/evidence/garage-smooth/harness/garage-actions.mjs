// Usage: [WARM_REPEAT=1] node --experimental-websocket garage-actions.mjs <base> <tag>
// The full garage action sequence (open; then 3 rounds of UPGRADE, every part,
// WHOLE CRAFT, PAINT with three slots and a hovered chip each, TEST, JOBS,
// DAILY, FLEET, LANCE, CORONA, TOTEM; close), COLD (fresh Chrome profile => an
// empty GPU shader cache, what iOS Safari sees on every visit). With
// WARM_REPEAT=1 the same profile reloads and measures once more (warm).
// Per action: rAF deltas over a 1.4 s window, WebGL program links, LoAFs, and
// renderer.info.programs.length (renderer grabbed through three's devtools hook).
import { writeFileSync } from "node:fs";
import { launchChrome, newPage, closePage, RECORDER, GLHOOK, OUT, sleep, stats } from "./cdp.mjs";

const [base, tag = "run"] = process.argv.slice(2);
const out = `${OUT}/actions-${tag}.json`;
const RENDERER_HOOK = `(() => { const hub = window.__THREE_DEVTOOLS__ = new EventTarget();
  hub.addEventListener('observe', (e) => { const r = e.detail; if (r && r.isWebGLRenderer) window.__renderer = r; }); })();`;
const WINDOW = 1400;
const { close } = await launchChrome();
const runs = [];
try {
  const page = await newPage(); await page.ready;
  await page.send("Page.enable"); await page.send("Runtime.enable");
  await page.send("Page.addScriptToEvaluateOnNewDocument", { source: RECORDER });
  await page.send("Page.addScriptToEvaluateOnNewDocument", { source: GLHOOK });
  await page.send("Page.addScriptToEvaluateOnNewDocument", { source: RENDERER_HOOK });
  // When the warm-up marks the bay ready (data-warm), to the frame.
  await page.send("Page.addScriptToEvaluateOnNewDocument", { source: `new MutationObserver((list, observer) => { for (const m of list) if (m.target.id === 'garage-screen' && m.target.dataset.warm === 'true') { window.__warmAt = performance.now(); observer.disconnect(); } }).observe(document, { subtree: true, attributes: true, attributeFilter: ['data-warm'] });` });
  for (const pass of process.env.WARM_REPEAT ? ["cold", "warm"] : ["cold"]) {
    const result = { pass, actions: [], rounds: [] };
    runs.push(result);
    const errors = [];
    const onErr = (p) => errors.push(p.exceptionDetails.exception?.description?.slice(0, 200));
    page.on("Runtime.exceptionThrown", onErr);
    await page.send("Page.navigate", { url: `${base}/?map=frostline&diagnostics=1` });
    await page.waitFor(`document.body.dataset.phase === 'intro'`, 120000, "intro");
    const introAt = await page.eval(`performance.now()`);
    // OPEN_EARLY=1: the impatient driver, who opens the bay half a second
    // after the menu appears, before any warm-up can have finished.
    if (process.env.OPEN_EARLY) await sleep(500);
    // Otherwise the menu settles (as the original harness), and the warm-up finishes if this build has one.
    else await page.waitFor(`(() => { const f = window.__perf.frames; return f.length > 200 && performance.now() > 6000 && f.slice(-120).every(x => x[1] < 40); })()`, 30000, "menu settled");
    const hasWarm = await page.eval(`typeof document.getElementById('garage-screen') !== 'undefined' && !!document.getElementById('garage-screen')`);
    let warmMs = null;
    if (hasWarm && !process.env.OPEN_EARLY) try { await page.waitFor(`document.getElementById('garage-screen')?.dataset.warm === 'true'`, 30000, "warm"); warmMs = Math.round((await page.eval(`window.__warmAt`)) - introAt); } catch { warmMs = null; }
    if (!process.env.OPEN_EARLY) await page.waitFor(`(() => { const f = window.__perf.frames; return f.slice(-60).every(x => x[1] < 40); })()`, 30000, "menu settled again");
    const menu = await page.eval(`(() => { const t = ${introAt}; const fr = window.__perf.frames.filter(f => f[0] > t).map(f => f[1]); const lt = window.__perf.longtasks.filter(l => l[0] > t); const lo = window.__perf.loafs.filter(l => l.start > t && l.duration > 50).map(l => ({ at: Math.round(l.start - t), d: Math.round(l.duration), scripts: l.scripts.filter(s => s.d >= 5).slice(0, 4).map(s => s.inv + ' ' + s.fn + ' ' + s.url + ':' + s.ch + ' ' + s.d + 'ms') })); return { frames: fr.length, windowMs: Math.round(performance.now() - t), max: Math.max(...fr), over33: fr.filter(d => d > 33.4).length, longtasks: lt.map(l => Math.round(l[1])), loafs: lo }; })()`);
    result.menu = { ...menu, warmMs, hasScreenBeforeOpen: hasWarm };
    console.log(`[${pass}] menu since intro: ${menu.frames} frames / ${menu.windowMs} ms (expected ${Math.round(menu.windowMs / 16.667)}), worst ${menu.max.toFixed(1)} ms, >33: ${menu.over33}, long tasks ${JSON.stringify(menu.longtasks)}; warm-up done ${warmMs} ms after the menu appeared`);

    async function act(name, js, waitJs = `document.getElementById('garage-screen')?.dataset.loading !== 'true'`) {
      const t = await page.eval(`(() => { window.__gl.reset(); const t = performance.now(); ${js}; return t; })()`);
      try { await page.waitFor(waitJs, 20000, name); } catch (e) { errors.push(String(e)); }
      const settledAt = await page.eval(`performance.now()`);
      await sleep(Math.max(0, WINDOW - (settledAt - t)));
      const w = await page.eval(`(() => { const t = ${t}; const end = performance.now();
        const fr = window.__perf.frames.filter(f => f[0] > t && f[0] <= end);
        const lo = window.__perf.loafs.filter(l => l.start + l.duration > t && l.start < end);
        return { fr: fr.map(f => +f[1].toFixed(1)), lo, gl: window.__gl.summary(), end, programs: window.__renderer?.info.programs?.length ?? -1 }; })()`);
      const deltas = w.fr;
      const entry = {
        name, readyMs: Math.round(settledAt - t), windowMs: Math.round(w.end - t), frames: deltas.length, expected: Math.round((w.end - t) / 16.667),
        frameMs: stats(deltas), over33: deltas.filter((d) => d > 33.4).length, first5: deltas.slice(0, 5),
        links: w.gl.calls.linkProgram?.n ?? 0, linkWaitMs: w.gl.calls.getProgramInfoLog?.ms ?? 0, programsTotal: w.programs,
        newPrograms: (w.gl.programs ?? []).map((p) => p[1] || "?"),
        glEvents: (w.gl.events ?? []).slice(0, 8), texUploadMs: +(((w.gl.calls.texSubImage2D?.ms ?? 0) + (w.gl.calls.texImage2D?.ms ?? 0) + (w.gl.calls.texStorage2D?.ms ?? 0))).toFixed(1),
        glTop: Object.entries(w.gl.calls).filter(([, v]) => v.ms > 3).map(([k, v]) => `${k}:${v.n}/${v.ms}ms`),
        loafs: w.lo.filter((l) => l.duration > 50).map((l) => ({ d: Math.round(l.duration), renderPhase: l.render ? Math.round(l.start + l.duration - l.render) : 0, styleLayout: l.style ? Math.round(l.start + l.duration - l.style) : 0, scripts: l.scripts.filter((s) => s.d >= 5).slice(0, 4).map((s) => `${s.inv} ${s.fn} ${s.url}:${s.ch} ${s.d}ms fwd${s.fwd}`) })),
      };
      result.actions.push(entry);
      console.log(`[${pass}] ${name.padEnd(26)} ready ${String(entry.readyMs).padStart(5)}ms frames ${entry.frames}/${entry.expected} max ${entry.frameMs.max} >33:${entry.over33} links ${entry.links} progs ${entry.programsTotal} ${entry.newPrograms.length ? "new:" + entry.newPrograms.join(",") : ""}`);
    }
    const click = (key) => `document.querySelector('#garage-screen [data-key="${key}"]').click()`;
    const hover = (key) => `document.querySelector('#garage-screen [data-key="${key}"]').dispatchEvent(new PointerEvent('pointerenter', { bubbles: false, pointerType: 'mouse' }))`;
    const has = (key) => page.eval(`!!document.querySelector('#garage-screen [data-key="${key}"]')`);
    const ready = `document.getElementById('garage-screen') && !document.getElementById('garage-screen').hidden && document.getElementById('garage-screen').dataset.modelReady === 'true' && document.getElementById('garage-screen').dataset.loading !== 'true'`;

    await act("open garage", `document.getElementById('garage-button').click()`, ready);
    for (let round = 1; round <= 3; round++) {
      await act(`r${round} tab-parts`, click("tab-parts"));
      const first = await page.eval(`document.querySelector('#garage-screen [data-key^="part-"]')?.dataset.key`);
      if (first) {
        await act(`r${round} ${first}`, click(first));
        for (const part of ["thrusters", "stabilisers", "skid", "plasma"]) if (await has(`switch-${part}`)) await act(`r${round} switch-${part}`, click(`switch-${part}`));
        await act(`r${round} back-whole`, `(document.querySelector('#garage-screen [data-key="whole"]') || document.querySelector('#garage-screen [data-key="cancel-part"]')).click()`);
      }
      await act(`r${round} tab-paint`, click("tab-paint"));
      for (const slot of ["slot-glow", "slot-under", "slot-body"]) {
        if (!(await has(slot))) continue;
        await act(`r${round} ${slot}`, click(slot));
        const chip = await page.eval(`[...document.querySelectorAll('#garage-screen [data-key^="paint-"], #garage-screen [data-key^="body-"]')].map(e => e.dataset.key).filter(k => !k.endsWith('stock') && !k.endsWith('off') && !k.endsWith('factory'))[${round}]`);
        if (chip) await act(`r${round} hover ${chip}`.slice(0, 40), hover(chip));
      }
      await act(`r${round} tab-test`, click("tab-test"));
      await act(`r${round} jobs`, click("jobs"));
      if (await has("daily")) await act(`r${round} daily`, click("daily"));
      await act(`r${round} tab-craft`, click("tab-craft"));
      for (const f of ["frame-lance", "frame-corona", "frame-totem"]) if (await has(f)) await act(`r${round} ${f}`, click(f));
      result.rounds.push(await page.eval(`window.__renderer?.info.programs?.length ?? -1`));
    }
    await act("close garage", `document.getElementById('garage-close').click()`, `document.getElementById('garage-screen').hidden`);
    result.errors = errors;
    page.off("Runtime.exceptionThrown", onErr);
    const worst = result.actions.filter((a) => a.name !== "close garage").reduce((m, a) => Math.max(m, a.frameMs.max), 0);
    console.log(`[${pass}] programs after rounds 1/2/3: ${result.rounds.join("/")}; worst action frame ${worst} ms; actions ${result.actions.length}; errors ${errors.length}`);
  }
  await closePage(page.id);
} catch (e) { runs.push({ error: String(e) }); console.error(e); }
finally { await close(); }
writeFileSync(out, JSON.stringify(runs, null, 1));
console.log("wrote", out);
