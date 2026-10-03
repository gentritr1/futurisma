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
 * - under `?motion=reduce` the demo still runs, and the craft cuts to the
 *   demo's framing on the press and stays there until the next move in the
 *   bay, which cuts it back to the still three-quarter;
 * - on RESULT the holds stay disabled while the HUD shows the craft still
 *   coasting, and come back once it reads 000;
 * - the meter opens full; a blur mid-hold ends the demo in the same task and
 *   silences the engine; the demo moves the craft up the track to frame its
 *   plume and puts it back;
 * - on a 390×844 phone the craft shows under the panel and the holds sit at
 *   the foot of the screen;
 * - LANCE's boost centre asks for its smaller flare.
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
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { createServer } from "vite";

const arg = (name, fallback) => process.argv.find((value) => value.startsWith(`--${name}=`))?.split("=")[1] ?? fallback;
const PORT = Number(arg("port", "5321"));
const DAY = 20400;
const shopOnly = process.argv.includes("--shop-only");
const musicOnly = process.argv.includes("--music-only");
const upgradeOnly = process.argv.includes("--upgrade-only");
const serviceOnly = process.argv.includes("--service-only") || upgradeOnly || musicOnly || shopOnly;
const fit = () => ({ parts: { engine: 0, thrusters: 0, stabilisers: 0, skid: 0, plasma: 0 }, glow: "stock", flame: "stock", under: "off", body: "factory", pattern: "steady" });
const SAVE = JSON.stringify({ schemaVersion: 7, garage: {
  credits: 100, chassis: "corona", fleet: Object.fromEntries(["totem", "lance", "sidewinder", "bulwark", "corona", "halo"].map(code => [code, fit()])), paints: ["stock", "off"], schemes: [], patterns: ["steady"], goldLeaf: false,
  daily: [DAY, 0, 0, 0, 0, Math.floor((DAY + 3) / 7), 0, 0, 0], contracts: { next: 12, active: [9, 10, 11], done: 8 }, circuits: [],
} });
const DEG = Math.PI / 180;

/** Runs in the page: the mounted body's airbrakes, the craft's pose, the kit lamp and the gauge's live fill. */
function probe() {
  let body = null;
  let kit = null;
  let hull = null;
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
  for (let at = body; at; at = at.parent) if (at.name === "totem_visual_motion") hull = at;
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
    push: hull ? Math.abs(hull.position.z) : null,
    flare: body?.getObjectByName("FX_boost_center")?.userData.flare ?? null,
  };
}

/** Every probe field an assertion reads must be there: a missing object would otherwise compare as a pass. */
function present(state, ...fields) {
  for (const field of fields) assert.ok(state[field] !== null && state[field] !== undefined, `The probe could not read ${field}.`);
  return state;
}

async function openPage(browser, query, device = {}, save = SAVE) {
  const { width = 1280, height = 720, ...rest } = device;
  const context = await browser.newContext({ viewport: { width, height }, ...rest });
  await context.addInitScript(([key, value]) => {
    if (!sessionStorage.getItem("seeded")) { localStorage.setItem(key, value); sessionStorage.setItem("seeded", "1"); }
    // The showroom engine's context, so its state can be read.
    const NativeAudio = window.Audio;
    window.Audio = function(...args) { const audio = new NativeAudio(...args); window.__garageMusic = audio; return audio; };
    window.Audio.prototype = NativeAudio.prototype;
    const Native = window.AudioContext;
    window.AudioContext = class extends Native { constructor(...args) { super(...args); window.__sound = this; } };
  }, ["futurisma.save.v1", save]);
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
  await tab.waitForFunction(() => document.body.dataset.garage === "true", null, { timeout: 60_000 });
  await tab.locator('[data-key="tab-test"]').click();
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
  if (!serviceOnly) {
  // 1. Hold BOOST through the four quarters, then BRAKE, then let go.
  {
    const { context, tab, errors } = await openPage(browser, "");
    const before = await tab.evaluate(() => JSON.parse(localStorage.getItem("futurisma.save.v1")).garage);
    await openBay(tab);
    const rest = present(await tab.evaluate(probe), "airbrake", "pitch", "bank", "kit", "push", "plume");
    assert.equal(rest.frame, "FRAME_corona", "The TEST bay is not showing the saved CORONA.");
    assert.deepEqual(rest.plume, [0.9, 1, 1.1], `CORONA's jets wear ${rest.plume}, not its plume profile.`);
    assert.equal(rest.meter, 4, "The bay opens with the meter dark over a full reserve.");
    assert.ok(rest.pitch !== null && rest.push !== null, "The probe cannot find the craft's visual group (totem_visual_motion).");
    // Held until the meter has stepped down, not for a fixed time: the demo
    // caps each frame at 0.1 s, so a slow renderer drains it slower in wall time.
    const quarters = (count) => tab.waitForFunction((n) => document.querySelectorAll(".garage__meter i[data-on=true]").length === n, count, { timeout: 30_000 });
    await holdFor(tab, "hold-boost", 200);
    await quarters(3);
    assert.equal((await tab.evaluate(probe)).push, 0, "B2 uses its own camera; the hull must stay on the service apron.");
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
    const after = present(await tab.evaluate(probe), "airbrake", "pitch", "bank", "kit", "fill", "push");
    assert.ok(Math.abs(after.airbrake) < 1e-6 && Math.abs(after.pitch) < 1e-3 && Math.abs(after.bank) < 1e-3,
      `The craft is not at rest after the demo: airbrake ${after.airbrake}, pitch ${after.pitch}, bank ${after.bank}.`);
    assert.ok(after.kit < 0.9 && after.fill === 1, `The lamps are not back at idle (kit ${after.kit}, gauge ${after.fill}).`);
    assert.equal(await tab.evaluate(() => window.__sound?.state), "suspended", "The showroom engine did not go to sleep after the demo.");
    await tab.waitForFunction(() => { let z = null; for (const scene of window.__scenes) scene.traverse((o) => { if (o.name === "totem_visual_motion") z = o.position.z; }); return z !== null && Math.abs(z) < 0.02; }, null, { timeout: 20_000 });
    // Leaving the page mid-hold ends the demo in the same task: a hidden tab runs no frame.
    await holdFor(tab, "hold-boost", 900);
    const left = await tab.evaluate(() => {
      window.dispatchEvent(new Event("blur"));
      let kit = null;
      for (const scene of window.__scenes) scene.traverse((object) => {
        if (object.isMesh && object.material?.name === "TE_boost" && !/^FRAME_/.test(object.parent?.name ?? "")) kit = object.material.emissiveIntensity;
      });
      return { running: document.querySelector(".garage__demo")?.dataset.running, kit };
    });
    await tab.mouse.up();
    assert.equal(left.running, "false", "A blur mid-hold did not end the demo at once.");
    assert.ok(left.kit < 0.9, `A blur mid-hold left the kit firing (${left.kit}).`);
    await tab.waitForTimeout(700);
    assert.equal(await tab.evaluate(() => window.__sound?.state), "suspended", "A blur mid-hold left the showroom engine running.");
    await holdFor(tab, "hold-boost", 900);
    const hidden = await tab.evaluate(() => {
      const raf = window.requestAnimationFrame;
      window.requestAnimationFrame = () => 0;
      Object.defineProperty(document, "hidden", {configurable: true, get: () => true});
      document.dispatchEvent(new Event("visibilitychange"));
      const running = document.querySelector(".garage__demo")?.dataset.running;
      delete document.hidden; window.requestAnimationFrame = raf;
      return running;
    });
    await tab.mouse.up();
    assert.equal(hidden, "false", "A hidden page must settle synchronously with rAF suspended.");
    await tab.waitForTimeout(700);
    assert.equal(await tab.evaluate(() => window.__sound?.state), "suspended");
    // 2. Swap frames mid-hold: the hold ends and both bodies are at rest.
    await tab.focus('[data-key="hold-boost"]');
    await tab.keyboard.down("Space");
    await tab.waitForTimeout(700);
    assert.equal((await tab.evaluate(probe)).held, "hold-boost", "BOOST is not held from the keyboard.");
    await tab.locator('[data-key="tab-craft"]').click();
    await tab.locator('[data-key="frame-lance"]').click();
    await tab.keyboard.up("Space");
    await tab.waitForFunction(() => /^FRAME_lance/.test([...window.__scenes].flatMap((scene) => { const found = []; scene.traverse((o) => { if (/^FRAME_/.test(o.name) && o.parent) found.push(o.name); }); return found; })[0] ?? ""), null, { timeout: 60_000 });
    const swapped = await tab.evaluate(probe);
    assert.equal(swapped.held, null, "A frame swap left the hold on.");
    assert.equal(swapped.meter, 4, "A frame swap left the demo's reserve drained.");
    assert.ok(Math.abs(swapped.airbrake ?? 0) < 1e-6 && Math.abs(swapped.pitch) < 1e-3, "The new frame is not at rest after a swap mid-hold.");
    assert.deepEqual(swapped.plume, [0.72, 0.72, 1.22], `After the swap the jets wear ${swapped.plume}, not LANCE's profile.`);
    assert.deepEqual(swapped.flare, [0.65, 0.55], `LANCE's boost centre asks for ${swapped.flare}, not its smaller flare.`);
    // 3. Close the bay and START: nothing of the demo reaches the race.
    await tab.evaluate(() => document.querySelector('[data-key="frame-corona"]')?.click());
    await tab.waitForTimeout(1500);
    await tab.keyboard.press("Escape");
    await tab.waitForFunction(() => document.body.dataset.garage === "false", null, { timeout: 30_000 });
    const closed = present(await tab.evaluate(probe), "pitch", "push");
    assert.ok(closed.push === 0 && closed.pitch !== null, `A closed bay leaves the craft pushed (${closed.push}) or turned.`);
    const saved = await tab.evaluate(() => JSON.parse(localStorage.getItem("futurisma.save.v1")).garage);
    assert.deepEqual(saved, before, "The demo changed the saved garage.");
    await tab.evaluate(() => document.getElementById("start-button")?.click());
    await tab.waitForFunction(() => document.body.dataset.phase === "race", null, { timeout: 120_000 });
    const race = present(await tab.evaluate(probe), "kit", "airbrake", "push", "plume");
    assert.deepEqual(race.plume, [0.9, 1, 1.1], `CORONA races with ${race.plume}, not its own plume (a swap back must not compound).`);
    assert.equal(await tab.evaluate(() => document.getElementById("boost-value")?.textContent), "100%", "The race starts without a full reserve.");
    assert.ok(race.kit < 1.2 && Math.abs(race.airbrake) < 1e-6, `The race inherits the demo: kit ${race.kit}, airbrake ${race.airbrake}.`);
    assert.equal(race.push, 0, "The race starts with the craft still pushed up the track.");
    assert.deepEqual(errors, [], "Page errors during the showroom demo.");
    await context.close();
    console.log("Hold, release, swap and launch: the demo drives the craft and leaves the race untouched.");
  }
  // 4. Reduced motion: the demo still runs; the craft holds its three-quarter angle.
  {
    const { context, tab, errors } = await openPage(browser, "&motion=reduce");
    await openBay(tab);
    const angle = await tab.evaluate(() => { let hull = null; for (const scene of window.__scenes) scene.traverse((o) => { if (o.name === "totem_visual_motion") hull = o; }); return hull?.rotation.y ?? null; });
    assert.ok(Math.abs(angle) < 1e-6, `Under reduced motion the bay holds ${angle}, not the -0.7 three-quarter.`);
    await holdFor(tab, "hold-boost", 1100);
    const held = await tab.evaluate(probe);
    const yaw = await tab.evaluate(() => { let hull = null; for (const scene of window.__scenes) scene.traverse((o) => { if (o.name === "totem_visual_motion") hull = o; }); return hull?.rotation.y ?? null; });
    assert.ok(held.kit > 1.2, "Under reduced motion BOOST does not fire.");
    // Held still, the demo cuts straight to its framing (no easing between),
    // keeps it when the reserve refills, and cuts back on the next move.
    assert.ok(Math.abs(yaw) < 1e-6 && held.push === 0, `Under reduced motion the demo eased or missed its framing (${yaw}, ${held.push}).`);
    await tab.mouse.up();
    await tab.waitForFunction(() => document.querySelector(".garage__demo")?.dataset.running === "false", null, { timeout: 30_000 });
    await tab.waitForTimeout(500);
    const pose = () => tab.evaluate(() => { let hull = null; for (const scene of window.__scenes) scene.traverse((o) => { if (o.name === "totem_visual_motion") hull = o; }); return hull && [hull.rotation.y, hull.position.z]; });
    const kept = await pose();
    assert.ok(Math.abs(kept[0]) < 1e-6 && kept[1] === 0, `Under reduced motion the craft cut away on its own when the reserve refilled (${kept}).`);
    await tab.evaluate(() => document.querySelector('[data-key="tab-parts"]')?.click());
    const back = await pose();
    assert.ok(Math.abs(back[0]) < 1e-6 && back[1] === 0, `Under reduced motion the next move did not cut the craft back to rest (${back}).`);
    // RESULT: while the race loop still coasts the craft (the HUD is not at
    // 000) the holds are disabled, and they come back once it has stopped. The
    // phase and speed are set here; reaching a real result needs a whole lap.
    await tab.waitForFunction(() => document.querySelector(".garage__demo")?.dataset.running === "false", null, { timeout: 30_000 });
    await tab.evaluate(() => {
      document.body.dataset.phase = "result";
      document.getElementById("speed-value").textContent = "142";
      document.querySelector('[data-key="tab-test"]')?.click();
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
  // 5. A phone held upright: the panel keeps to the top half, the craft shows
  // below it, and the holds sit at the foot of the screen.
  {
    const { context, tab, errors } = await openPage(browser, "", { width: 390, height: 844, hasTouch: true, isMobile: true });
    await openBay(tab);
    const layout = await tab.evaluate(() => {
      const panel = document.querySelector(".garage__header")?.getBoundingClientRect();
      const strip = document.querySelector(".garage__demo")?.getBoundingClientRect();
      return { panel: panel?.bottom, strip: strip && [strip.top, strip.bottom], height: innerHeight, slide: getComputedStyle(document.getElementById("game-canvas")).transform };
    });
    assert.ok(layout.panel <= layout.height * 0.2, `On a phone the panel reaches ${layout.panel} of ${layout.height}: the craft is hidden.`);
    assert.ok(layout.strip[0] >= layout.height * 0.8 && layout.strip[1] <= layout.height, `On a phone the holds sit at ${layout.strip}, not at the foot of the screen.`);
    assert.ok(layout.slide === "none", `On a phone the bay still slides the picture (${layout.slide}).`);
    const box = await tab.locator('[data-key="hold-boost"]').boundingBox();
    assert.ok(box.height >= 44, `On a phone the holds are ${box.height} px tall, not a 44 px thumb target.`);
    await tab.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    await holdFor(tab, "hold-boost", 300);
    await tab.waitForFunction(() => document.querySelectorAll(".garage__meter i[data-on=true]").length < 4, null, { timeout: 30_000 });
    await tab.mouse.up();
    assert.deepEqual(errors, [], "Page errors on a phone.");
    await context.close();
    console.log("Phone: the craft shows under the panel and the holds work at the foot of the screen.");
  }
  // 6. Tideline: the circuit rule reworks the jets' shader for fog as the race
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
  // A gamepad hold is a level, not a synthetic click. It releases on focus
  // loss and cannot restart until A has been physically released.
  {
    const {context,tab,errors}=await openPage(browser,"&craft=stock");
    await openBay(tab);
    assert.equal((await tab.evaluate(probe)).frame,'FRAME_corona','stock QA mode still previews the saved craft in the bay');
    await tab.evaluate(()=>{
      window.__pad={index:0,id:'B2 test pad',connected:true,mapping:'standard',axes:[0,0,0,0],buttons:Array.from({length:17},()=>({pressed:false,touched:false,value:0}))};
      Object.defineProperty(navigator,'getGamepads',{configurable:true,value:()=>[window.__pad]});
    });
    await tab.focus('[data-key="hold-boost"]');
    await tab.evaluate(()=>{window.__pad.buttons[0]={pressed:true,touched:true,value:1};});
    await tab.waitForFunction(()=>document.querySelector('[data-key="hold-boost"]').dataset.held==='true');
    await tab.waitForFunction(()=>document.querySelectorAll('.garage__meter i[data-on=true]').length<4);
    await tab.focus('[data-key="hold-brake"]');
    await tab.waitForTimeout(150);
    assert.equal((await tab.evaluate(probe)).held,null,'focus loss ends a pad hold without arming the next control');
    await tab.evaluate(()=>{window.__pad.buttons[0]={pressed:false,touched:false,value:0};});
    await tab.waitForTimeout(100);
    await tab.locator('#garage-close').click();
    await tab.waitForTimeout(1000);
    assert.equal((await tab.evaluate(probe)).frame,null,'leaving a stock QA bay restores TOTEM instead of keeping the preview');
    assert.deepEqual(errors,[],'stock QA mode and controller hold errors');
    await context.close();console.log('Controller hold and stock-mode bay PASS.');
  }
  }
  if (!upgradeOnly && !musicOnly && !shopOnly) {
  // B2: each authored part on every frame and device composition, with
  // actual rendered anchor coordinates and the work order's real DOM bounds.
  {
    const {context,tab,errors}=await openPage(browser,"&motion=reduce");
    await openBay(tab);
    await mkdir("shots/garage-b2",{recursive:true});
    let views=0;
    for(const frame of ["totem","lance","sidewinder","bulwark","corona","halo"]){
      await tab.locator('[data-key="tab-craft"]').click();
      await tab.locator(`[data-key="frame-${frame}"]`).click();
      const select=tab.locator('[data-key="frame-action"]');
      if(await select.isEnabled())await select.click();
      await tab.locator('[data-key="tab-parts"]').click();
      await tab.waitForFunction(()=>document.getElementById('garage-screen').dataset.loading==='false');
      for(const [width,height] of [[1280,800],[390,844],[844,390]]){
        await tab.setViewportSize({width,height});
        for(const part of ['engine','thrusters','stabilisers','skid','plasma']){
          const key=await tab.locator(`[data-key="switch-${part}"]`).isVisible()?`switch-${part}`:`part-${part}`;
          await tab.locator(`[data-key="${key}"]`).click();
          await tab.waitForTimeout(180);
          const layout=await tab.evaluate(()=>{
            const screen=document.getElementById('garage-screen');
            const anchor=document.querySelector('.garage__anchor').getBoundingClientRect();
            const order=document.querySelector('.garage__work-order').getBoundingClientRect();
            const rect=e=>({left:e.left,right:e.right,top:e.top,bottom:e.bottom});
            return {ready:screen.dataset.modelReady,anchor:rect(anchor),order:rect(order),width:innerWidth,height:innerHeight,background:document.getElementById('start-screen').inert};
          });
          const label=`${frame}/${part} ${width}x${height}`;
          assert.equal(layout.ready,'true',label+' real model ready');
          assert.equal(layout.background,true,label+' background cannot take focus');
          const x=(layout.anchor.left+layout.anchor.right)/2,y=(layout.anchor.top+layout.anchor.bottom)/2;
          assert.ok(x>16&&x<width-16&&y>16&&y<height-16,label+' marker on screen');
          assert.ok(x<layout.order.left||x>layout.order.right||y<layout.order.top||y>layout.order.bottom,label+' part clear of work order');
          if(width<height)assert.ok(y/height>=.4&&y/height<=.45,label+' phone target height');
          await tab.screenshot({path:`shots/garage-b2/${frame}-${part}-${width}x${height}.png`});
          views++;
        }
      }
    }
    assert.deepEqual(errors,[],'B2 all-frame page errors');
    await context.close();console.log(`B2 service views PASS: ${views} renders; real anchors clear of work orders, focus isolation and portrait height.`);
  }
  }
  // Real purchases, safe previews and the final-stage hardware on every frame.
  if (upgradeOnly) {
    const save=JSON.parse(SAVE);save.garage.credits=60000;
    for(const fit of Object.values(save.garage.fleet))for(const part of Object.keys(fit.parts))fit.parts[part]=2;
    const {context,tab,errors}=await openPage(browser,"&map=nightshift",{},JSON.stringify(save));
    await openBay(tab);
    await mkdir('shots/garage-energy',{recursive:true});
    const hardware=async part=>tab.evaluate(part=>{
      let hull;for(const scene of window.__scenes)scene.traverse(o=>{if(o.name==='totem_visual_motion')hull=o;});
      const groups=[];hull?.traverse(o=>{if(o.name===`garage_upgrade_${part}`)groups.push({stage:o.userData.stage,frame:o.userData.frame,parent:o.parent.name,meshes:o.children.length});});
      const devices=['TE_mounted_surge','TE_mounted_shield'].map(name=>hull?.getObjectByName(name)?.visible);
      return {groups,devices};
    },part);
    for(const frame of arg('frames','totem,lance,sidewinder,bulwark,corona,halo').split(',')){
      await tab.setViewportSize({width:1280,height:800});
      await tab.locator('[data-key="tab-craft"]').click();await tab.locator(`[data-key="frame-${frame}"]`).click();
      if(await tab.locator('[data-key="frame-action"]').isEnabled())await tab.locator('[data-key="frame-action"]').click();
      await tab.locator('[data-key="tab-parts"]').click();
      for(const part of ['engine','thrusters','stabilisers','skid','plasma']){
        const key=await tab.locator(`[data-key="switch-${part}"]`).isVisible()?`switch-${part}`:`part-${part}`;
        await tab.locator(`[data-key="${key}"]`).click();
        await tab.waitForFunction(()=>document.getElementById('garage-screen').dataset.loading==='false');
        let state=await hardware(part);
        assert.ok(state.groups.length&&state.groups.every(g=>g.stage===3&&g.frame===frame&&g.meshes>0),`${frame}/${part}: actual next-stage geometry`);
        assert.deepEqual(state.devices,[false,false],'empty pickup devices must be stowed');
        const before=await tab.evaluate(()=>JSON.parse(localStorage.getItem('futurisma.save.v1')).garage);
        await tab.locator('[data-key="preview-fitted"]').click();
        await tab.waitForFunction(()=>document.getElementById('garage-screen').dataset.loading==='false');
        assert.ok((await hardware(part)).groups.every(g=>g.stage===2),'compare restores fitted geometry');
        assert.equal(await tab.evaluate(()=>JSON.parse(localStorage.getItem('futurisma.save.v1')).garage.credits),before.credits,'preview cannot spend');
        await tab.locator('[data-key="preview-next"]').click();
        await tab.waitForFunction(()=>document.getElementById('garage-screen').dataset.loading==='false');
        await tab.waitForTimeout(550);
        await tab.screenshot({path:`shots/garage-energy/${frame}-${part}-preview-1280x800.png`});
        await tab.locator('[data-key="fit-part"]').click();
        await tab.waitForFunction(()=>document.getElementById('garage-screen').dataset.loading==='false');
        const after=await tab.evaluate(()=>JSON.parse(localStorage.getItem('futurisma.save.v1')).garage);
        assert.equal(after.fleet[frame].parts[part],3,'purchase persists exactly one stage');
        assert.equal(before.credits-after.credits,{engine:1500,thrusters:1300,stabilisers:1300,skid:1100,plasma:1300}[part]);
        assert.ok((await hardware(part)).groups.every(g=>g.stage===3),'purchased stage stays on model');
      }
    }
    await tab.setViewportSize({width:390,height:844});
    await tab.waitForTimeout(500);await tab.screenshot({path:'shots/garage-energy/phone-fitted.png'});
    await tab.locator('[data-key="whole"]').click();
    // Rapid mode switches finish at the last input; no delayed transition owns navigation.
    for(const key of ['tab-paint','tab-test','tab-parts','tab-paint'])await tab.locator(`[data-key="${key}"]`).click();
    await tab.waitForTimeout(500);
    assert.equal(await tab.locator('#garage-screen').getAttribute('data-tab'),'paint');
    assert.equal(await tab.evaluate(()=>document.getElementById('garage-screen').getAnimations({subtree:true}).filter(a=>a.playState==='running').length),0);
    assert.deepEqual(errors,[],'upgrades and rapid navigation page errors');
    await tab.locator('#garage-close').click();
    await tab.waitForTimeout(400);
    assert.ok((await hardware('plasma')).groups.every(g=>g.stage===3),'saved hardware survives returning to the grid');
    await tab.locator('#start-button').click();
    await tab.waitForFunction(()=>document.body.dataset.phase==='race');await tab.waitForTimeout(500);
    const racing=await hardware('plasma');assert.ok(racing.groups.length&&racing.groups.every(g=>g.stage===3),'upgraded hardware remains mounted in the race');
    assert.deepEqual(errors,[],'upgraded race launch page errors');await context.close();
    console.log(`Upgrade PASS: ${arg('frames','totem,lance,sidewinder,bulwark,corona,halo').split(',').length*5} final-stage installs, compare without spending, exact prices, race-mounted hardware, stowed pickups, phone and rapid navigation.`);
  }
  if (shopOnly) {
    const save=JSON.parse(SAVE);save.garage.credits=400;save.garage.chassis='totem';
    const {context,tab,errors}=await openPage(browser,"&map=nightshift",{},JSON.stringify(save));await openBay(tab);
    await tab.locator('[data-key="tab-craft"]').click();
    assert.match(await tab.locator('[data-key="upgrade-craft"]').textContent(),/5 READY/);
    await tab.locator('[data-key="upgrade-craft"]').click();
    assert.equal(await tab.locator('.garage__part[data-affordable="true"]').count(),5);
    await tab.waitForTimeout(500);await tab.screenshot({path:'shots/garage-energy/starter-shop.png'});
    await tab.locator('[data-key="part-engine"]').click();
    await tab.locator('[data-key="preview-fitted"]').click();await tab.locator('[data-key="preview-next"]').click();
    assert.equal(await tab.evaluate(()=>JSON.parse(localStorage.getItem('futurisma.save.v1')).garage.credits),400);
    await tab.locator('[data-key="fit-part"]').click();
    assert.equal(await tab.evaluate(()=>JSON.parse(localStorage.getItem('futurisma.save.v1')).garage.credits),50);
    await tab.locator('[data-key="done-part"]').click();
    assert.equal(await tab.locator('.garage__part[data-affordable="true"]').count(),0);
    assert.match(await tab.locator('.garage__card-note').textContent(),/CR 200 TO YOUR NEXT PART/);
    await tab.locator('[data-key="part-thrusters"]').click();
    assert.equal(await tab.locator('[data-key="fit-part"]').isEnabled(),false);
    assert.match(await tab.locator('.garage__balance').textContent(),/NEED CR 250 MORE/);
    await tab.locator('[data-key="cancel-part"]').click();
    await tab.setViewportSize({width:390,height:844});await tab.locator('[data-key="part-skid"]').click();
    await tab.waitForTimeout(600);
    const layout=await tab.evaluate(()=>{
      const anchor=document.querySelector('.garage__anchor').getBoundingClientRect(),body=document.querySelector('.garage__body').getBoundingClientRect();
      const footer=document.querySelector('.garage__footer').getBoundingClientRect();
      return {y:anchor.top,top:body.top,bottom:body.bottom,footerTop:footer.top,buttons:[...document.querySelectorAll('.garage__order-actions button')].map(b=>{const r=b.getBoundingClientRect();return {top:r.top,bottom:r.bottom};})};
    });
    await tab.screenshot({path:'shots/garage-energy/phone-next-upgrade.png'});
    assert.ok(layout.y<layout.top,'phone upgrade stays above the order: '+JSON.stringify(layout));
    assert.ok(layout.buttons.every(b=>b.top>0&&b.bottom<844),'phone actions stay reachable');
    assert.ok(layout.bottom+10<=layout.footerTop,'phone work-order viewport stays clear of the parts row');
    assert.ok(layout.buttons.every(b=>b.bottom<=layout.bottom),'phone action buttons remain inside the work-order viewport');
    await tab.screenshot({path:'shots/garage-energy/phone-next-upgrade.png'});
    await tab.locator('[data-key="earn"]').click();assert.equal(await tab.locator('#garage-screen').getAttribute('data-tab'),'contracts');
    assert.equal(await tab.evaluate(()=>JSON.parse(localStorage.getItem('futurisma.save.v1')).garage.credits),50);
    assert.deepEqual(errors,[],'shop affordability and cancellation page errors');await context.close();
    console.log('Shop PASS: CR 400 offers five choices; ENGINE I costs 350 once; CR 50 leaves exact 200/250 gaps; previews/cancel cost nothing; phone actions and contract handoff.');
  }
  if (musicOnly) {
    const {context,tab,errors}=await openPage(browser,"&map=nightshift");await openBay(tab);
    await tab.waitForFunction(()=>window.__garageMusic&&!window.__garageMusic.paused&&window.__garageMusic.currentTime>.15&&window.__garageMusic.volume>.08);
    const normal=await tab.evaluate(()=>window.__garageMusic.volume);
    await holdFor(tab,'hold-boost',350);
    assert.ok(await tab.evaluate(()=>window.__garageMusic.volume)<normal*.35,'engine test ducks the score');
    const interrupted=await tab.evaluate(()=>{
      const raf=window.requestAnimationFrame;window.requestAnimationFrame=()=>0;
      window.dispatchEvent(new Event('blur'));
      const state={paused:window.__garageMusic.paused,held:document.querySelector('[data-held="true"]')!==null};
      window.requestAnimationFrame=raf;return state;
    });
    assert.deepEqual(interrupted,{paused:true,held:false},'music and hold stop synchronously without a frame');
    await tab.mouse.up();
    await tab.locator('[data-key="tab-craft"]').click();await tab.waitForTimeout(800);
    assert.equal(await tab.evaluate(()=>window.__garageMusic.paused),false,'gesture resumes score');
    await tab.locator('[data-key="sound"]').click();assert.equal(await tab.evaluate(()=>window.__garageMusic.paused),true,'mute pauses media');
    await tab.locator('[data-key="sound"]').click();await tab.waitForTimeout(150);
    assert.equal(await tab.evaluate(()=>window.__garageMusic.paused),false,'unmute resumes media');
    await tab.locator('#garage-close').click();assert.equal(await tab.evaluate(()=>window.__garageMusic.paused),true,'closing garage pauses media');
    assert.deepEqual(errors,[],'music lifecycle page errors');await context.close();
    console.log('Music PASS: recorded score plays, ducks under engine, blur without rAF, resume, mute and close.');
  }
  if (!serviceOnly) console.log("Garage showroom PASS: BOOST through four quarters, BRAKE at 60°, rest, swap, launch, reduced motion, plume profiles and Tideline.");
} finally {
  await browser.close();
  await server.close();
}
