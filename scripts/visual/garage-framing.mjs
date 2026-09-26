/**
 * Showroom framing acceptance: under a BOOST or BRAKE hold, every craft's
 * plume and airbrakes land on screen, clear of the garage panel, the hold
 * strip and the screen's edges, on each of the bay's layouts (wide, column and
 * upright; see style-garage.css).
 *
 * It projects what matters rather than eyeballing a screenshot: every vertex
 * of the kit's four exhaust layers (the jet's own shape scaled by the frame's
 * plume profile, so the nozzle ring as well as the tail), through each layer's
 * instance matrix, the page's own camera and the canvas's CSS placement, and
 * both airbrake pivots; each must be at least 16 px from the panel, the holds
 * and every edge. Where the holds are pinned it checks they are 44 px and
 * clear of the panel, and it turns a phone from upright to sideways mid-hold
 * to check the craft reframes for the new layout.
 *
 *   npm run check:garage-framing             # the frames that bound it: LANCE
 *                                            # (longest plume), SIDEWINDER and
 *                                            # BULWARK (widest), BULWARK's airbrakes
 *   npm run check:garage-framing -- --quick  # LANCE only; run on any layout change
 *   npm run check:garage-framing -- --full   # all six, BOOST and BRAKE; before a sign-off
 *
 * Like the other garage checks it starts its own Vite dev server and reads the
 * live scene through the page's three.js, so it is dev-server only and not part
 * of the node-only `test:code`. Under a software renderer the full run is slow.
 *
 * Flags: --port (default 5322), --quick, --full, --screens=1280x720,390x844
 */
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { createServer } from "vite";

const arg = (name, fallback) => process.argv.find((value) => value.startsWith(`--${name}=`))?.split("=")[1] ?? fallback;
const PORT = Number(arg("port", "5322"));
const ALL = ["lance", "sidewinder", "bulwark", "corona", "halo", "totem"];
/** [frame, measure BOOST, measure BRAKE]. TOTEM carries no airbrakes. */
const RUNS = process.argv.includes("--quick") ? [["lance", true, true]]
  : process.argv.includes("--full") ? ALL.map((code) => [code, true, code !== "totem"])
    : [["lance", true, false], ["sidewinder", true, false], ["bulwark", true, true]];
/** Wide, column (phones on their side, tablets) and upright (phones, tablets). */
const SCREENS = arg("screens", "1280x720,1280x800,1024x768,1180x820,844x390,667x375,800x600,390x844,768x1024").split(",").map((size) => size.split("x").map(Number));
const CLEAR = 16;
const DAY = 20400;
const fit = () => ({ parts: { engine: 0, thrusters: 0, stabilisers: 0, skid: 0, plasma: 0 }, glow: "stock", flame: "stock", under: "off", body: "factory", pattern: "steady" });
const save = (chassis) => JSON.stringify({ schemaVersion: 7, garage: {
  credits: 100, chassis, fleet: Object.fromEntries(["totem", "lance", "sidewinder", "bulwark", "corona", "halo"].map((code) => [code, fit()])),
  paints: ["stock", "off"], schemes: [], patterns: ["steady"], goldLeaf: false,
  daily: [DAY, 0, 0, 0, 0, Math.floor((DAY + 3) / 7), 0, 0, 0], contracts: { next: 12, active: [9, 10, 11], done: 8 }, circuits: [],
} });

/** Runs in the page: screen points for the plume tips and airbrakes, and their clearance (px, negative = overlapped). */
function measure() {
  const THREE = window.__THREE;
  let jets = null;
  let body = null;
  for (const scene of window.__scenes) scene.traverse((object) => {
    if (object.name === "TE_twin_layered_exhaust") jets = object;
    if (/^FRAME_/.test(object.name) && object.parent) body = object;
  });
  const canvas = document.getElementById("game-canvas").getBoundingClientRect();
  const camera = [...window.__cameras].find((candidate) => Math.abs(candidate.aspect - canvas.width / canvas.height) < 0.05);
  const box = (selector) => {
    const element = document.querySelector(selector);
    return element && !element.hidden ? element.getBoundingClientRect() : null;
  };
  const panel = box(".garage");
  const strip = box(".garage__demo");
  const away = (rect, x, y) => rect ? Math.max(rect.left - x, x - rect.right, rect.top - y, y - rect.bottom) : Infinity;
  const point = (what, world) => {
    const projected = world.clone().project(camera);
    const x = canvas.left + (projected.x + 1) / 2 * canvas.width;
    const y = canvas.top + (1 - projected.y) / 2 * canvas.height;
    return { what, x: Math.round(x), y: Math.round(y), clearance: Math.round(Math.min(away(panel, x, y), away(strip, x, y), x, y, innerWidth - x, innerHeight - y)) };
  };
  const points = [];
  if (jets && camera) {
    // As the jet shader places them: position × uProfile × instance × model.
    jets.updateMatrixWorld(true);
    const profile = jets.material.uniforms.uProfile?.value ?? new THREE.Vector3(1, 1, 1);
    const shape = jets.geometry.attributes.position;
    const matrix = new THREE.Matrix4();
    for (let index = 0; index < jets.count; index += 1) {
      jets.getMatrixAt(index, matrix);
      for (let vertex = 0; vertex < shape.count; vertex += 1) {
        const local = new THREE.Vector3().fromBufferAttribute(shape, vertex).multiply(profile);
        const where = local.z < 0.01 ? "nozzle" : local.z > profile.z - 0.01 ? "tip" : "body";
        points.push(point(`plume ${where} ${index}`, local.applyMatrix4(matrix).applyMatrix4(jets.matrixWorld)));
      }
    }
  }
  for (const name of ["airbrake_L_pivot", "airbrake_R_pivot"]) {
    const node = body?.getObjectByName(name);
    if (node && camera) points.push(point(name, node.getWorldPosition(new THREE.Vector3())));
  }
  const holds = [...document.querySelectorAll(".garage__hold")].map((hold) => hold.getBoundingClientRect().height);
  const pinned = Boolean(strip) && getComputedStyle(document.querySelector(".garage__demo")).position === "fixed";
  const overlap = panel && strip ? Math.min(panel.right, strip.right) > Math.max(panel.left, strip.left) && Math.min(panel.bottom, strip.bottom) > Math.max(panel.top, strip.top) : false;
  const inside = strip ? strip.left >= 0 && strip.top >= 0 && strip.right <= innerWidth && strip.bottom <= innerHeight : false;
  return { camera: Boolean(camera), jets: Boolean(jets), frame: body?.name ?? "TOTEM", points, layout: { holds, pinned, overlap, inside } };
}

async function openBay(browser, chassis, width, height) {
  const phone = width < 1100;
  const context = await browser.newContext({ viewport: { width, height }, hasTouch: phone, isMobile: phone, deviceScaleFactor: 1 });
  await context.addInitScript(([key, value]) => {
    if (!sessionStorage.getItem("seeded")) { localStorage.setItem(key, value); sessionStorage.setItem("seeded", "1"); }
  }, ["futurisma.save.v1", save(chassis)]);
  const tab = await context.newPage();
  const errors = [];
  tab.on("pageerror", (error) => errors.push(String(error)));
  tab.on("console", (message) => { if (message.type() === "error") errors.push(message.text().slice(0, 300)); });
  await tab.goto(`http://127.0.0.1:${PORT}/?map=greenwater&laps=1&day=${DAY}`, { waitUntil: "domcontentloaded" });
  await tab.waitForFunction(() => document.body.dataset.phase === "intro" && !document.getElementById("start-screen")?.hidden, null, { timeout: 300_000 });
  await tab.evaluate(async () => {
    const url = performance.getEntriesByType("resource").map((entry) => entry.name).find((name) => /\/node_modules\/\.vite\/deps\/three\.js/.test(name));
    const THREE = await import(url);
    window.__THREE = THREE;
    const update = THREE.Object3D.prototype.updateMatrixWorld;
    window.__scenes = new Set();
    THREE.Scene.prototype.updateMatrixWorld = function (force) { window.__scenes.add(this); return update.call(this, force); };
    const updateCamera = THREE.PerspectiveCamera.prototype.updateMatrixWorld;
    window.__cameras = new Set();
    THREE.PerspectiveCamera.prototype.updateMatrixWorld = function (force) { window.__cameras.add(this); return updateCamera.call(this, force); };
  });
  await tab.waitForTimeout(1500);
  await tab.keyboard.press("KeyG");
  await tab.waitForFunction(() => document.body.dataset.garage === "true" && !document.querySelector(".garage__demo")?.hidden, null, { timeout: 60_000 });
  await tab.waitForTimeout(2000);
  return { context, tab, errors };
}

/** Holds a button until the craft has eased into its demo framing, then measures. */
async function held(tab, key) {
  const box = await tab.locator(`[data-key="${key}"]`).boundingBox();
  await tab.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await tab.mouse.down();
  await tab.waitForFunction(() => {
    let hull = null;
    for (const scene of window.__scenes) scene.traverse((object) => { if (object.name === "totem_visual_motion") hull = object; });
    return hull && -hull.position.z > 3.8;
  }, null, { timeout: 60_000 });
  await tab.waitForTimeout(600);
  return tab.evaluate(measure);
}

function assertClear(result, kind, label) {
  const points = result.points.filter((point) => point.what.startsWith(kind));
  assert.ok(result.camera, `${label}: the chase camera could not be found.`);
  assert.ok(points.length > 0, `${label}: no ${kind} to measure.`);
  const worst = points.reduce((low, point) => point.clearance < low.clearance ? point : low);
  assert.ok(worst.clearance >= CLEAR, `${label}: ${worst.what} lands at (${worst.x}, ${worst.y}), ${worst.clearance} px from the panel, the holds or an edge (needs ${CLEAR}).`);
  return `${worst.clearance} px (${worst.what.replace(/ \d+$/, "")})`;
}

/** Pinned holds are thumb-sized, on screen and off the panel. */
function assertLayout({ layout }, label) {
  if (!layout.pinned) return "in the panel";
  assert.ok(layout.holds.length === 2 && layout.holds.every((height) => height >= 44), `${label}: pinned holds of ${layout.holds} px; they need 44.`);
  assert.ok(layout.inside && !layout.overlap, `${label}: the pinned holds leave the screen or cover the panel.`);
  return "pinned";
}

const server = await createServer({ server: { host: "127.0.0.1", port: PORT, strictPort: true }, logLevel: "error" });
await server.listen();
const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] });
try {
  for (const [width, height] of SCREENS) {
    const { context, tab, errors } = await openBay(browser, RUNS[0][0], width, height);
    for (const [index, [frame, boosting, braking]] of RUNS.entries()) {
      if (index > 0) {
        await tab.evaluate((code) => document.querySelector(`[data-key="frame-${code}"]`)?.click(), frame);
        await tab.waitForTimeout(6000);
      }
      const label = `${width}×${height} ${frame.toUpperCase()}`;
      const notes = [];
      for (const [go, key, kind] of [[boosting, "hold-boost", "plume"], [braking, "hold-brake", "airbrake"]]) {
        if (!go) continue;
        const result = await held(tab, key);
        await tab.mouse.up();
        notes.push(`${kind} ${assertClear(result, kind, `${label} ${key.slice(5).toUpperCase()}`)}`);
        if (index === 0 && kind === "plume") notes.push(`holds ${assertLayout(result, label)}`);
        await tab.waitForFunction(() => document.querySelector(".garage__demo")?.dataset.running === "false", null, { timeout: 60_000 });
      }
      console.log(`${label}: ${notes.join(", ")}.`);
    }
    assert.deepEqual(errors, [], `${width}×${height}: page errors.`);
    await context.close();
  }
  // Turning the phone mid-hold: the craft reframes for the new layout and stays clear.
  {
    const { context, tab, errors } = await openBay(browser, "lance", 390, 844);
    await held(tab, "hold-boost");
    await tab.setViewportSize({ width: 844, height: 390 });
    await tab.waitForTimeout(2500);
    const turned = await tab.evaluate(measure);
    assertClear(turned, "plume", "Upright → sideways mid-hold");
    await tab.mouse.up();
    assert.deepEqual(errors, [], "Page errors turning the phone.");
    await context.close();
    console.log("Turning the phone mid-hold reframes the craft for the new layout.");
  }
  console.log(`Garage framing PASS: ${RUNS.length} craft on ${SCREENS.length} screens, plumes and airbrakes at least ${CLEAR} px clear.`);
} finally {
  await browser.close();
  await server.close();
}
