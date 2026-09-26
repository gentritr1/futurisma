/**
 * Garage binding acceptance: a saved frame body takes the power kit, whatever
 * order the kit and the body load in.
 *
 * main.ts refits the craft before `initialize()` and again after it. The body
 * can therefore mount before TOTEM's model exists, or after the model but
 * before the kit, or after both. In every case the body's lamps must end up as
 * the kit's live lamps, and CORONA's gauge must follow the kit's boost lamp
 * idle and firing. A string pin cannot catch a load-order bug; this can.
 *
 * Run it after any change to `TotemVehicle.load`, `mountBody`, `anchorTo`,
 * main.ts `refitCraft` or garage-look's `fitCellGauge`:
 *
 *   npm run check:garage-binding            # normal and slow-kit loads
 *   npm run check:garage-binding -- --all   # and a slow-body load
 *
 * It starts its own Vite dev server. It reads the live scene through the
 * page's own three.js, which it finds by Vite's dev dependency URL, so it runs
 * against the dev server only, never a production build. It is not in
 * `test:code`, which is node-only.
 *
 * Flags: --port (default 5320), --all
 */
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { createServer } from "vite";

const arg = (name, fallback) => process.argv.find((value) => value.startsWith(`--${name}=`))?.split("=")[1] ?? fallback;
const PORT = Number(arg("port", "5320"));
const MODES = process.argv.includes("--all") ? ["normal", "kit-slow", "body-slow"] : ["normal", "kit-slow"];
const SLOW = { "kit-slow": "**/totem-evolution/totem_evolution.glb", "body-slow": "**/garage/frames/corona.glb" };
const DAY = 20400;
const fit = () => ({ parts: { engine: 0, thrusters: 0, stabilisers: 0, skid: 0, plasma: 0 }, glow: "stock", flame: "stock", under: "off", body: "factory", pattern: "steady" });
const SAVE = JSON.stringify({ schemaVersion: 7, garage: {
  credits: 100, chassis: "corona", fleet: { totem: fit(), corona: fit() }, paints: ["stock", "off"], schemes: [], patterns: ["steady"], goldLeaf: false,
  daily: [DAY, 0, 0, 0, 0, Math.floor((DAY + 3) / 7), 0, 0, 0], contracts: { next: 12, active: [9, 10, 11], done: 8 }, circuits: [],
} });

/** Runs in the page: the body, whether its brake lamp is the kit's, and the gauge against the kit's boost lamp. */
function probe() {
  let body = null;
  let kitBoost = null;
  const gauges = [];
  const brakes = new Map();
  for (const scene of window.__scenes) scene.traverse((object) => { if (/^FRAME_corona/.test(object.name)) body = object; });
  const inBody = (object) => { for (let at = object; at; at = at.parent) if (at === body) return true; return false; };
  for (const scene of window.__scenes) scene.traverse((object) => {
    const material = object.isMesh && !Array.isArray(object.material) ? object.material : null;
    if (!material) return;
    if (material.name === "TE_boost_gauge") gauges.push(material);
    if (material.name === "TE_boost" && !inBody(object)) kitBoost = material;
    if (material.name === "TE_brake") brakes.set(material, [...(brakes.get(material) ?? []), inBody(object)]);
  });
  const bodyBrake = [...brakes.values()].find((owners) => owners.includes(true));
  return {
    mounted: Boolean(body?.parent),
    kitAnchored: Boolean(bodyBrake?.includes(false)),
    gauges: gauges.length,
    gauge: gauges[0]?.emissiveIntensity ?? null,
    kit: kitBoost?.emissiveIntensity ?? null,
    tracks: Boolean(gauges.length && kitBoost && gauges.every((gauge) => gauge.emissiveIntensity === kitBoost.emissiveIntensity && gauge.emissive.equals(kitBoost.emissive))),
  };
}

const server = await createServer({ server: { host: "127.0.0.1", port: PORT, strictPort: true }, logLevel: "error" });
await server.listen();
const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] });
try {
  for (const mode of MODES) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    await context.addInitScript(([key, value]) => {
      if (!sessionStorage.getItem("seeded")) { localStorage.setItem(key, value); sessionStorage.setItem("seeded", "1"); }
    }, ["futurisma.save.v1", SAVE]);
    const tab = await context.newPage();
    const errors = [];
    tab.on("pageerror", (error) => errors.push(String(error)));
    // A shader that fails to compile is only a console error; it still counts.
    tab.on("console", (message) => { if (message.type() === "error") errors.push(message.text().slice(0, 300)); });
    if (SLOW[mode]) await tab.route(SLOW[mode], async (route) => { await new Promise((resolve) => setTimeout(resolve, 9000)); await route.continue(); });
    await tab.goto(`http://127.0.0.1:${PORT}/?map=greenwater&laps=1&day=${DAY}`, { waitUntil: "domcontentloaded" });
    await tab.waitForFunction(() => document.body.dataset.phase === "intro" && !document.getElementById("start-screen")?.hidden, null, { timeout: 300_000 });
    // Every scene the page updates, through its own three.js (no debug hook in the shell).
    await tab.evaluate(async () => {
      const url = performance.getEntriesByType("resource").map((entry) => entry.name).find((name) => /\/node_modules\/\.vite\/deps\/three\.js/.test(name));
      const THREE = await import(url);
      const update = THREE.Object3D.prototype.updateMatrixWorld;
      window.__scenes = new Set();
      THREE.Scene.prototype.updateMatrixWorld = function (force) { window.__scenes.add(this); return update.call(this, force); };
    });
    await tab.waitForTimeout(2500);
    await tab.evaluate(() => document.getElementById("start-button")?.click());
    await tab.waitForFunction(() => document.body.dataset.phase === "race", null, { timeout: 120_000 });
    await tab.keyboard.down("KeyW");
    await tab.waitForFunction(() => Number(document.getElementById("speed-value")?.textContent) > 150, null, { timeout: 240_000 });
    const idle = await tab.evaluate(probe);
    await tab.keyboard.down("ShiftLeft");
    await tab.waitForTimeout(700);
    const firing = await tab.evaluate(probe);
    await tab.keyboard.up("ShiftLeft");
    await context.close();
    for (const [phase, state] of [["idle", idle], ["firing", firing]]) {
      assert.ok(state.mounted, `${mode}/${phase}: CORONA's body is not mounted.`);
      assert.ok(state.kitAnchored, `${mode}/${phase}: the body's lamps are the GLB's, not the kit's; the kit never anchored to it.`);
      assert.equal(state.gauges, 1, `${mode}/${phase}: ${state.gauges} gauge materials, not one.`);
      assert.ok(state.tracks, `${mode}/${phase}: the gauge (${state.gauge}) does not follow the kit's boost lamp (${state.kit}).`);
    }
    assert.ok(firing.kit > idle.kit, `${mode}: the kit's boost lamp did not rise while firing (${idle.kit} -> ${firing.kit}).`);
    assert.deepEqual(errors, [], `${mode}: page errors.`);
    console.log(`${mode}: kit anchored; gauge follows the kit lamp ${idle.kit.toFixed(2)} idle, ${firing.kit.toFixed(2)} firing.`);
  }
  console.log(`Garage binding PASS: ${MODES.join(", ")}.`);
} finally {
  await browser.close();
  await server.close();
}
