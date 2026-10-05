// Usage: node --experimental-websocket envhash.mjs <base> <query> <label>
// Loads Greenwater, waits for the authored environment, then hashes every position
// attribute under greenwater_authored_environment (FNV-1a over float32 bytes) and reads
// the diagnostics corridor-relocation stats. Compares runtime vs baked relocation.
import { writeFileSync, rmSync } from "node:fs";
import { launchChrome, newPage, closePage, sleep, OUT_DIR } from "./cdp.mjs";

const [base, query, label] = process.argv.slice(2);
const HOOK = `(() => { const hub = window.__THREE_DEVTOOLS__ = new EventTarget(); window.__scenes = [];
  hub.addEventListener('observe', (e) => { if (e.detail && e.detail.isScene) window.__scenes.push(e.detail); }); })();`;
const c = await launchChrome();
const kill = setTimeout(() => { c.child.kill("SIGKILL"); process.exit(2); }, 120000);
const out = { base, query, label };
try {
  const page = await newPage(); await page.ready;
  await page.send("Page.enable"); await page.send("Runtime.enable");
  const logs = [];
  page.on("Runtime.consoleAPICalled", (p) => { const t = p.args.map((a) => a.value ?? a.description).join(" "); if (/CORRIDOR|WARMUP|drift|relocation/i.test(t)) logs.push(t.slice(0, 300)); });
  await page.send("Page.addScriptToEvaluateOnNewDocument", { source: HOOK });
  await page.send("Page.navigate", { url: `${base}/?map=greenwater&diagnostics=1${query}` });
  await page.waitFor(`(() => { for (const s of window.__scenes) { if (s.getObjectByName('greenwater_authored_environment')) return true; } return false; })()`, 90000, "environment");
  await page.waitFor(`document.body.dataset.phase === 'intro'`, 90000, "intro");
  Object.assign(out, await page.eval(`(() => {
    let root = null; for (const s of window.__scenes) { root = s.getObjectByName('greenwater_authored_environment') ?? root; }
    let h = 0x811c9dc5 >>> 0, vertices = 0, meshes = 0; const per = {};
    root.traverse((o) => { if (!o.isMesh) return; meshes++; const a = o.geometry.getAttribute('position'); const b = new Uint8Array(a.array.buffer, a.array.byteOffset, a.array.byteLength);
      let m = 0x811c9dc5 >>> 0; for (let i = 0; i < b.length; i++) { h = Math.imul(h ^ b[i], 16777619) >>> 0; m = Math.imul(m ^ b[i], 16777619) >>> 0; } per[o.name] = m.toString(16); vertices += a.count; });
    return { hash: h.toString(16), vertices, meshes, per };
  })()`));
  await sleep(1500);
  out.diag = await page.eval(`(() => { const el = document.getElementById('futurisma-diagnostics'); const t = el ? (el.value || el.textContent) : ''; const j = t ? JSON.parse(t) : null; const find = (o) => { if (!o || typeof o !== 'object') return null; if ('corridorRelocated' in o) return o; for (const v of Object.values(o)) { const r = find(v); if (r) return r; } return null; }; const r = find(j); return r ? { corridorRelocated: r.corridorRelocated, maxShift: r.corridorRelocationMaxShift, list: (r.corridorRelocationList || []).length, listHash: JSON.stringify(r.corridorRelocationList).length } : null; })()`);
  out.logs = logs;
  await closePage(page.id);
} catch (e) { out.error = String(e); }
finally { clearTimeout(kill); c.child.kill("SIGTERM"); await sleep(300); try { rmSync(c.dir, { recursive: true, force: true }); } catch {} }
writeFileSync(`${OUT_DIR}/envhash-${label}.json`, JSON.stringify(out, null, 1));
console.log(JSON.stringify({ label, hash: out.hash, vertices: out.vertices, meshes: out.meshes, diag: out.diag, logs: out.logs, error: out.error }));
process.exit(0);
