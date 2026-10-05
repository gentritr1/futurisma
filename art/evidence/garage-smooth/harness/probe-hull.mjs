// Usage: node --experimental-websocket probe-hull.mjs <base>
// The craft lent to the bay for the warm-up's hidden draw comes back exactly:
// same scene, same index path, same world position.
import { launchChrome, newPage, closePage, RECORDER } from "./cdp.mjs";
const base = process.argv[2] ?? "http://localhost:5196";
const HOOK = `(() => { const hub = window.__THREE_DEVTOOLS__ = new EventTarget(); window.__scenes = new Set();
  hub.addEventListener('observe', (e) => { const r = e.detail; if (r && r.isWebGLRenderer) { const render = r.render.bind(r); r.render = (s, c) => { window.__scenes.add(s); return render(s, c); }; } }); })();`;
const PROBE = `(() => { const scene = [...window.__scenes].find(s => s.name !== 'garage_service_bay'); let node = null; scene.traverse(o => { if (!node && o.name === 'TOTEM_runtime') node = o; });
  const path = []; for (let at = node; at && at.parent; at = at.parent) path.unshift(at.parent.children.indexOf(at));
  node.updateWorldMatrix(true, false); const e = node.matrixWorld.elements; return { path: path.join('.'), world: [e[12], e[13], e[14]].map(v => +v.toFixed(4)), warm: document.getElementById('garage-screen')?.dataset.warm ?? null }; })()`;
const { close } = await launchChrome();
try {
  const page = await newPage(); await page.ready; await page.send("Page.enable"); await page.send("Runtime.enable");
  await page.send("Page.addScriptToEvaluateOnNewDocument", { source: RECORDER });
  await page.send("Page.addScriptToEvaluateOnNewDocument", { source: HOOK });
  await page.send("Page.navigate", { url: `${base}/?map=frostline` });
  await page.waitFor(`document.body.dataset.phase === 'intro' && window.__scenes.size > 0`, 120000);
  const before = await page.eval(PROBE);
  await page.waitFor(`document.getElementById('garage-screen')?.dataset.warm === 'true'`, 60000, "warm");
  await new Promise((r) => setTimeout(r, 300));
  const after = await page.eval(PROBE);
  console.log(JSON.stringify({ before, after, same: before.path === after.path && before.world.join() === after.world.join() }));
  await closePage(page.id);
} finally { await close(); }
