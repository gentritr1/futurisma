// Names the object behind a late depth-shader compile: wraps Object3D.prototype.onBeforeShadow
// (called right before each shadow draw) and reports the last caster when a depth shader is created.
import { rmSync } from "node:fs";
import { launchChrome, newPage, closePage, sleep } from "./cdp.mjs";
const [base, map, seconds = "25", tries = "8"] = process.argv.slice(2);
const HOOK = `(() => { window.__hits = []; window.__armed = false; let last = null; let hooked = false;
  const path = (o) => { const p = []; for (let x = o; x; x = x.parent) p.push(x.name || x.type); return p.slice(0, 6).join(' < '); };
  const hub = window.__THREE_DEVTOOLS__ = new EventTarget();
  hub.addEventListener('observe', (e) => { const d = e.detail; if (!d || !d.isScene || hooked) return; hooked = true;
    const proto = Object.getPrototypeOf(Object.getPrototypeOf(d)); const orig = proto.onBeforeShadow;
    proto.onBeforeShadow = function (r, object, camera, shadowCamera, geometry, depthMaterial, group) { last = { object: this, depthSide: depthMaterial.side, group }; return orig.apply(this, arguments); }; });
  const src0 = WebGL2RenderingContext.prototype.shaderSource;
  WebGL2RenderingContext.prototype.shaderSource = function (sh, src) {
    if (window.__armed && /SHADER_TYPE MeshDepthMaterial/.test(src) && /gl_Position/.test(src) && last) {
      const o = last.object; const mats = Array.isArray(o.material) ? o.material : [o.material];
      window.__hits.push({ at: Math.round(performance.now()), path: path(o), type: o.type, visible: o.visible, frustumCulled: o.frustumCulled, castShadow: o.castShadow, depthSide: last.depthSide,
        materials: mats.map((m) => ({ type: m.type, name: m.name, side: m.side, shadowSide: m.shadowSide, visible: m.visible })), geometry: { attrs: Object.keys(o.geometry.attributes), groups: o.geometry.groups.length }, userData: Object.keys(o.userData || {}) });
    }
    return src0.call(this, sh, src);
  }; })();`;
for (let i = 0; i < Number(tries); i++) {
  const c = await launchChrome();
  const kill = setTimeout(() => { c.child.kill("SIGKILL"); process.exit(2); }, 150000);
  let hits = [];
  try {
    const page = await newPage(); await page.ready;
    await page.send("Page.enable"); await page.send("Runtime.enable");
    await page.send("Page.addScriptToEvaluateOnNewDocument", { source: HOOK });
    await page.send("Page.navigate", { url: `${base}/?map=${map}&diagnostics=1&demo=1&laps=3` });
    await page.waitFor(`(document.getElementById('time-value')?.textContent ?? '00:00.000') !== '00:00.000'`, 120000, "clock");
    const t0 = await page.eval(`window.__armed = true; performance.now()`);
    await page.waitFor(`performance.now() > ${t0 + Number(seconds) * 1000}`, 60000, "window");
    hits = await page.eval(`window.__hits`);
    console.log(`try ${i}: ${hits.length} late depth shaders`, JSON.stringify(hits.map((h) => ({ ...h, at: h.at - Math.round(t0) })), null, 1).slice(0, 4000));
    await closePage(page.id);
  } catch (e) { console.error(e); }
  finally { clearTimeout(kill); c.child.kill("SIGTERM"); await sleep(300); try { rmSync(c.dir, { recursive: true, force: true }); } catch {} }
  if (hits.length) break;
}
console.log("CATCH5_DONE");
process.exit(0);
