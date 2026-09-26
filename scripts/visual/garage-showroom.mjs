/**
 * Showroom demo acceptance: hold BOOST and BRAKE in the garage, then race.
 * (It also checks each frame's plume profile follows the swaps.)
 *
 * With a saved CORONA it opens the bay, holds BOOST through all four quarters
 * of the demo's reserve, then holds BRAKE, and lets go. It checks:
 * - the kit fires and the gauge's fill steps down with the bay's meter;
 * - an empty reserve reads RECHARGING and stops firing;
 * - the airbrakes stand at 60° while BRAKE is held;
 * - the showroom engine is running while a hold is on;
 * - after release the craft is back at rest: airbrakes, pitch, bank and
 *   lamps, with the gauge full;
 * - swapping frames mid-hold releases the hold and leaves both bodies at rest;
 * - closing the bay and STARTing leaves nothing of the demo in the race (the
 *   reserve is 100 %, nothing is firing, the airbrakes are down) and the
 *   save's garage is untouched;
 * - under `?motion=reduce` the demo still runs, and the craft holds its
 *   three-quarter angle;
 * - on RESULT the holds stay disabled while the HUD shows the craft still
 *   coasting, and come back once it reads 000.
 *
 *   npm run check:garage-showroom
 *
 * Like `check:garage-binding`, it starts its own Vite dev server and reads the
 * live scene through the page's own three.js, so it is dev-server only and not
 * part of the node-only `test:code`.
 *
 * Flags: --port (default 5321)
 */
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { createServer } from "vite";

const arg = (name, fallback) => process.argv.find((value) => value.startsWith(`--${name}=`))?.split("=")[1] ?? fallback;
const PORT = Number(arg("port", "5321"));
const DAY = 20400;
const fit = () => ({ parts: { engine: 0, thrusters: 0, stabilisers: 0, skid: 0, plasma: 0 }, glow: "stock", flame: "stock", under: "off", body: "factory", pattern: "steady" });
const SAVE = JSON.stringify({ schemaVersion: 7, garage: {
  credits: 100, chassis: "corona", fleet: { totem: fit(), lance: fit(), corona: fit() }, paints: ["stock", "off"], schemes: [], patterns: ["steady"], goldLeaf: false,
  daily: [DAY, 0, 0, 0, 0, Math.floor((DAY + 3) / 7), 0, 0, 0], contracts: { next: 12, active: [9, 10, 11], done: 8 }, circuits: [],
} });
const DEG = Math.PI / 180;

/** Runs in the page: the mounted body's airbrakes, the craft's pose, the kit lamp and the gauge's live fill. */
function probe() {
  let body = null;
  let kit = null;
  let hull;
  for (const scene of window.__scenes) scene.traverse((object) => {
    if (/^FRAME_/.test(object.name) && object.parent) body = object;
  });
  for (const scene of window.__scenes) scene.traverse((object) => {
    if (object.isMesh && object.material?.name === "TE_boost" && !object.material.isShaderMaterial) {
      let inside = false;
      for (let at = object; at; at = at.parent) if (at === body) inside = true;
      if (!inside) kit = object.material;
    }
  });
  // The body mounts on TOTEM's model, inside the visual group the showroom turns.
  hull = body?.parent?.parent ?? null;
  const brake = body?.getObjectByName("airbrake_L_pivot");
  const jets = hull?.getObjectByName("TE_twin_layered_exhaust");
  const meter = [...document.querySelectorAll(".garage__meter i")].filter((bar) => bar.dataset.on === "true").length;
  return {
    frame: body?.name ?? null,
    airbrake: brake ? brake.rotation.x : null,
    pitch: hull ? hull.rotation.x : null,
    bank: hull ? hull.rotation.z : null,
    kit: kit?.emissiveIntensity ?? null,
    fill: window.__fill ?? null,
    meter,
    label: document.querySelector('[data-key="hold-boost"] strong')?.textContent ?? null,
    held: document.querySelector('[data-held="true"]')?.dataset.key ?? null,
    sound: window.__sound?.state ?? null,
    plume: jets?.material.uniforms.uProfile?.value.toArray().map((value) => Math.round(value * 100) / 100) ?? null,
  };
}

async function openPage(browser, query) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await context.addInitScript(([key, value]) => {
    if (!sessionStorage.getItem("seeded")) { localStorage.setItem(key, value); sessionStorage.setItem("seeded", "1"); }
    // The showroom engine's context, so its state can be read.
    const Native = window.AudioContext;
    window.AudioContext = class extends Native { constructor(...args) { super(...args); window.__sound = this; } };
  }, ["futurisma.save.v1", SAVE]);
  const tab = await context.newPage();
  const errors = [];
  tab.on("pageerror", (error) => errors.push(String(error)));
  tab.on("console", (message) => { if (message.type() === "error") errors.push(message.text().slice(0, 300)); });
  await tab.goto(`http://127.0.0.1:${PORT}/?laps=1&day=${DAY}${query.includes("map=") ? "" : "&map=greenwater"}${query}`, { waitUntil: "domcontentloaded" });
  await tab.waitForFunction(() => document.body.dataset.phase === "intro" && !document.getElementById("start-screen")?.hidden, null, { timeout: 300_000 });
  await tab.evaluate(async () => {
    const url = performance.getEntriesByType("resource").map((entry) => entry.name).find((name) => /\/node_modules\/\.vite\/deps\/three\.js/.test(name));
    const THREE = await import(url);
    const update = THREE.Object3D.prototype.updateMatrixWorld;
    window.__scenes = new Set();
    THREE.Scene.prototype.updateMatrixWorld = function (force) { window.__scenes.add(this); return update.call(this, force); };
    // The gauge's live fill, as the renderer uploads it.
    const render = THREE.Mesh.prototype.onBeforeRender;
    window.__watchGauge = () => {
      for (const scene of window.__scenes) scene.traverse((object) => {
        if (!object.isMesh || object.material?.name !== "TE_boost_gauge" || object.__watched) return;
        const original = object.onBeforeRender;
        object.onBeforeRender = function (renderer, ...rest) {
          original.call(this, renderer, ...rest);
          const uniforms = renderer.properties.get(this.material).uniforms;
          if (uniforms?.uFill) window.__fill = uniforms.uFill.value;
        };
        object.__watched = true;
      });
      return render;
    };
  });
  await tab.waitForTimeout(2500);
  return { context, tab, errors };
}

async function openBay(tab) {
  await tab.keyboard.press("KeyG");
  await tab.waitForFunction(() => document.body.dataset.garage === "true" && !document.querySelector(".garage__demo")?.hidden, null, { timeout: 60_000 });
  await tab.waitForTimeout(1500);
  await tab.evaluate(() => window.__watchGauge());
}

async function holdFor(tab, key, milliseconds) {
  const box = await tab.locator(`[data-key="${key}"]`).boundingBox();
  await tab.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await tab.mouse.down();
  await tab.waitForTimeout(milliseconds);
}

const server = await createServer({ server: { host: "127.0.0.1", port: PORT, strictPort: true }, logLevel: "error" });
await server.listen();
const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required"] });
try {
  // 1. Hold BOOST through the four quarters, then BRAKE, then let go.
  {
    const { context, tab, errors } = await openPage(browser, "");
    const before = await tab.evaluate(() => JSON.parse(localStorage.getItem("futurisma.save.v1")).garage);
    await openBay(tab);
    const rest = await tab.evaluate(probe);
    assert.equal(rest.frame, "FRAME_corona", "The bay is not showing the saved CORONA.");
    assert.deepEqual(rest.plume, [0.9, 1, 1.1], `CORONA's jets wear ${rest.plume}, not its plume profile.`);
    // Held until the meter has stepped down, not for a fixed time: the demo
    // caps each frame at 0.1 s, so a slow renderer drains it slower in wall time.
    const quarters = (count) => tab.waitForFunction((n) => document.querySelectorAll(".garage__meter i[data-on=true]").length === n, count, { timeout: 30_000 });
    await holdFor(tab, "hold-boost", 200);
    await quarters(3);
    // The gauge's fill is what the renderer last uploaded, a frame behind the
    // meter (a slow renderer's frame can be 0.4 s): wait for it to follow.
    await tab.waitForFunction(() => window.__fill <= 0.75, null, { timeout: 10_000 });
    const quarter = await tab.evaluate(probe);
    assert.equal(quarter.held, "hold-boost", "BOOST is not held under the pointer.");
    assert.ok(quarter.kit > 1.2, `The kit is not firing on BOOST (lamp ${quarter.kit}).`);
    assert.ok(quarter.fill > 0.5 && quarter.fill <= 0.75, `The gauge's fill is ${quarter.fill} with the meter at three quarters.`);
    assert.equal(quarter.sound, "running", "The showroom engine is not running during a hold.");
    await quarters(0);
    await tab.waitForFunction(() => window.__fill < 0.05, null, { timeout: 10_000 });
    const empty = await tab.evaluate(probe);
    assert.equal(empty.label, "RECHARGING", "An empty reserve does not read RECHARGING.");
    assert.ok(empty.fill < 0.05, `The gauge is at ${empty.fill} with the demo's reserve empty.`);
    let settled = false;
    for (let poll = 0; poll < 20 && !settled; poll += 1) {
      await tab.waitForTimeout(300);
      settled = (await tab.evaluate(probe)).kit < 1.2;
    }
    assert.ok(settled, "The kit keeps firing on an empty reserve.");
    await tab.mouse.up();
    await holdFor(tab, "hold-brake", 900);
    const braking = await tab.evaluate(probe);
    assert.ok(Math.abs(braking.airbrake - 60 * DEG) < 1e-3, `The airbrakes stand at ${(braking.airbrake / DEG).toFixed(1)}°, not 60°, under BRAKE.`);
    await tab.mouse.up();
    // Refilled and back at rest: the strip says when the demo has let go.
    await tab.waitForFunction(() => document.querySelector(".garage__demo")?.dataset.running === "false", null, { timeout: 30_000 });
    await tab.waitForFunction(() => window.__fill === 1, null, { timeout: 10_000 });
    await tab.waitForTimeout(600);
    const after = await tab.evaluate(probe);
    assert.ok(Math.abs(after.airbrake) < 1e-6 && Math.abs(after.pitch) < 1e-3 && Math.abs(after.bank) < 1e-3,
      `The craft is not at rest after the demo: airbrake ${after.airbrake}, pitch ${after.pitch}, bank ${after.bank}.`);
    assert.ok(after.kit < 0.9 && after.fill === 1, `The lamps are not back at idle (kit ${after.kit}, gauge ${after.fill}).`);
    assert.equal(await tab.evaluate(() => window.__sound?.state), "suspended", "The showroom engine did not go to sleep after the demo.");
    // 2. Swap frames mid-hold: the hold ends and both bodies are at rest.
    await tab.focus('[data-key="hold-boost"]');
    await tab.keyboard.down("Space");
    await tab.waitForTimeout(700);
    assert.equal((await tab.evaluate(probe)).held, "hold-boost", "BOOST is not held from the keyboard.");
    await tab.evaluate(() => document.querySelector('[data-key="frame-lance"]')?.click());
    await tab.keyboard.up("Space");
    await tab.waitForFunction(() => /^FRAME_lance/.test([...window.__scenes].flatMap((scene) => { const found = []; scene.traverse((o) => { if (/^FRAME_/.test(o.name) && o.parent) found.push(o.name); }); return found; })[0] ?? ""), null, { timeout: 60_000 });
    const swapped = await tab.evaluate(probe);
    assert.equal(swapped.held, null, "A frame swap left the hold on.");
    assert.equal(swapped.meter, 4, "A frame swap left the demo's reserve drained.");
    assert.ok(Math.abs(swapped.airbrake ?? 0) < 1e-6 && Math.abs(swapped.pitch) < 1e-3, "The new frame is not at rest after a swap mid-hold.");
    assert.deepEqual(swapped.plume, [0.72, 0.72, 1.22], `After the swap the jets wear ${swapped.plume}, not LANCE's profile.`);
    // 3. Close the bay and START: nothing of the demo reaches the race.
    await tab.evaluate(() => document.querySelector('[data-key="frame-corona"]')?.click());
    await tab.waitForTimeout(1500);
    await tab.keyboard.press("Escape");
    await tab.waitForFunction(() => document.body.dataset.garage === "false", null, { timeout: 30_000 });
    const saved = await tab.evaluate(() => JSON.parse(localStorage.getItem("futurisma.save.v1")).garage);
    assert.deepEqual(saved, before, "The demo changed the saved garage.");
    await tab.evaluate(() => document.getElementById("start-button")?.click());
    await tab.waitForFunction(() => document.body.dataset.phase === "race", null, { timeout: 120_000 });
    const race = await tab.evaluate(probe);
    assert.deepEqual(race.plume, [0.9, 1, 1.1], `CORONA races with ${race.plume}, not its own plume (a swap back must not compound).`);
    assert.equal(await tab.evaluate(() => document.getElementById("boost-value")?.textContent), "100%", "The race starts without a full reserve.");
    assert.ok(race.kit < 1.2 && Math.abs(race.airbrake) < 1e-6, `The race inherits the demo: kit ${race.kit}, airbrake ${race.airbrake}.`);
    assert.deepEqual(errors, [], "Page errors during the showroom demo.");
    await context.close();
    console.log("Hold, release, swap and launch: the demo drives the craft and leaves the race untouched.");
  }
  // 4. Reduced motion: the demo still runs; the craft holds its three-quarter angle.
  {
    const { context, tab, errors } = await openPage(browser, "&motion=reduce");
    await openBay(tab);
    const angle = await tab.evaluate(() => { let hull = null; for (const scene of window.__scenes) scene.traverse((o) => { if (/^FRAME_/.test(o.name) && o.parent) hull = o.parent.parent; }); return hull?.rotation.y ?? null; });
    await holdFor(tab, "hold-boost", 1100);
    const held = await tab.evaluate(probe);
    const yaw = await tab.evaluate(() => { let hull = null; for (const scene of window.__scenes) scene.traverse((o) => { if (/^FRAME_/.test(o.name) && o.parent) hull = o.parent.parent; }); return hull?.rotation.y ?? null; });
    assert.ok(held.kit > 1.2, "Under reduced motion BOOST does not fire.");
    assert.ok(Math.abs(yaw - angle) < 1e-6, `Under reduced motion the craft turned (${angle} -> ${yaw}).`);
    await tab.mouse.up();
    // RESULT: while the race loop still coasts the craft (the HUD is not at
    // 000) the holds are disabled, and they come back once it has stopped. The
    // phase and speed are set here; reaching a real result needs a whole lap.
    await tab.waitForFunction(() => document.querySelector(".garage__demo")?.dataset.running === "false", null, { timeout: 30_000 });
    await tab.evaluate(() => {
      document.body.dataset.phase = "result";
      document.getElementById("speed-value").textContent = "142";
      document.querySelector('[data-key="tab-paint"]')?.click();
    });
    await tab.waitForTimeout(400);
    const rolling = await tab.evaluate(() => [...document.querySelectorAll(".garage__hold")].map((hold) => [hold.disabled, hold.querySelector("small")?.textContent]));
    assert.ok(rolling.every(([disabled, prompt]) => disabled && prompt === "CRAFT STILL ROLLING"), `The holds are live while the craft coasts: ${JSON.stringify(rolling)}.`);
    await tab.evaluate(() => { document.getElementById("speed-value").textContent = "000"; });
    await tab.waitForFunction(() => [...document.querySelectorAll(".garage__hold")].every((hold) => !hold.disabled), null, { timeout: 5_000 });
    assert.deepEqual(errors, [], "Page errors under reduced motion.");
    await context.close();
    console.log("Reduced motion: the demo runs and the craft holds still.");
  }
  // 5. Tideline: the circuit rule reworks the jets' shader for fog as the race
  // loads, after the bay taught it the plume profile; both must hold.
  {
    const { context, tab, errors } = await openPage(browser, "&map=tideline");
    await tab.evaluate(() => document.getElementById("start-button")?.click());
    await tab.waitForFunction(() => document.body.dataset.phase === "race", null, { timeout: 120_000 });
    const jets = await tab.evaluate(() => {
      let found = null;
      for (const scene of window.__scenes) scene.traverse((object) => { if (object.name === "TE_twin_layered_exhaust") found = object.material; });
      return found && { profile: found.uniforms.uProfile?.value.toArray().map((value) => Math.round(value * 100) / 100), shader: found.vertexShader };
    });
    assert.deepEqual(jets?.profile, [0.9, 1, 1.1], `On Tideline CORONA's jets wear ${jets?.profile}, not its plume.`);
    assert.ok(jets.shader.includes("position * uProfile") && jets.shader.includes("fog_pars_vertex"),
      "On Tideline the jets' shader lost the plume profile or the fog rule.");
    assert.deepEqual(errors, [], "Page errors on Tideline.");
    await context.close();
    console.log("Tideline: the plume profile and the fog rule share the jets' shader.");
  }
  console.log("Garage showroom PASS: BOOST through four quarters, BRAKE at 60°, rest, swap, launch, reduced motion, plume profiles and Tideline.");
} finally {
  await browser.close();
  await server.close();
}
