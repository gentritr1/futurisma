// Lists the shadow depth/distance program keys resident right after the warm-up log.
// Usage: node --experimental-websocket keys.mjs <base> <map>
import { rmSync } from "node:fs";
import { launchChrome, newPage, closePage, sleep } from "./cdp.mjs";
const [base, map] = process.argv.slice(2);
const HOOK = `(() => { const hub = window.__THREE_DEVTOOLS__ = new EventTarget();
  hub.addEventListener('observe', (e) => { if (e.detail && e.detail.isWebGLRenderer) window.__renderer = window.__renderer ?? e.detail; });
  const info = console.info; console.info = function (...a) { if (String(a[0]).includes('FUTURISMA_WARMUP')) {
    window.__keys = window.__renderer.info.programs.filter((p) => /MeshDepthMaterial|MeshDistanceMaterial/.test(p.type || '')).map((p) => { const k = p.cacheKey.split(','); return p.type + ' uv=' + (k[5] || '-') + ' ' + k.slice(-4, -2).join(','); });
    window.__log = a[0]; } return info.apply(this, a); }; })();`;
const c = await launchChrome();
const kill = setTimeout(() => { c.child.kill("SIGKILL"); process.exit(2); }, 150000);
try {
  const page = await newPage(); await page.ready;
  await page.send("Page.enable"); await page.send("Runtime.enable");
  await page.send("Page.addScriptToEvaluateOnNewDocument", { source: HOOK });
  await page.send("Page.navigate", { url: `${base}/?map=${map}&diagnostics=1` });
  await page.waitFor(`window.__keys`, 120000, "warm-up");
  const r = await page.eval(`({ keys: window.__keys, log: window.__log })`);
  console.log(r.log); console.log(r.keys.length, "depth/distance programs:"); for (const k of r.keys.sort()) console.log("  " + k);
  await closePage(page.id);
} catch (e) { console.error(e); }
finally { clearTimeout(kill); c.child.kill("SIGTERM"); await sleep(300); try { rmSync(c.dir, { recursive: true, force: true }); } catch {} }
process.exit(0);
