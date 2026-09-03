// H1.3 review harness: how many pixels of the frame the CRAFT actually paints.
//
// Every pose metric H1 added says where the craft IS. None of them says whether
// it was DRAWN: the frames this harness exists for had hull clearance 1.26 m,
// chase 7.4 m and the hull at NDC (0.107, -0.45) -- dead centre -- with no craft
// anywhere in the image. So the measurement is a pixel diff: screenshot, hide
// the vehicle, screenshot again, count the pixels that changed. The game is
// PAUSED across the pair, so the craft is the only thing that can differ.
//
// `?hide=` names extra layers to test the same way, each reported as the pixel
// count that layer is responsible for in the craft-less frame -- so a frame that
// fails can say WHICH layer painted over the craft without a second run.
//
// Usage:
//   node scripts/visual/vehicle-pixels.mjs <url> <outDir> [steerKey|-] \
//     [steerFrom] [shotFrom] [shotTo] [shots] [layer,layer,...]
// With `-` as the steer key it pauses as soon as the race is running, which is
// what the `?probe=` static poses want.
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";

const [url, outDir] = [process.argv[2], process.argv[3]];
const steerKey = process.argv[4] && process.argv[4] !== "-" ? process.argv[4] : null;
const steerFrom = Number(process.argv[5] ?? 0);
const shotFrom = Number(process.argv[6] ?? 0);
const shotTo = Number(process.argv[7] ?? Number.POSITIVE_INFINITY);
const wantShots = Number(process.argv[8] ?? 6);
const layers = (process.argv[9] ?? "").split(",").filter(Boolean);
// Optional lateral gate, e.g. "<=-12" or ">=12". Pausing costs about a second
// of wall clock per frame, so without this the run crawls and never reaches the
// deep apron laterals the failure lives at.
const latGate = process.argv[10] ?? null;
const passesLatGate = (lat) => {
  if (!latGate || !Number.isFinite(lat)) return true;
  const bound = Number(latGate.slice(2));
  return latGate.startsWith("<=") ? lat <= bound : lat >= bound;
};

const browser = await chromium.launch({
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 200)));
await page.goto(url, { waitUntil: "networkidle" });
mkdirSync(outDir, { recursive: true });

const read = () => page.evaluate(() => {
  try {
    const c = JSON.parse(
      document.getElementById("futurisma-diagnostics")?.textContent || "{}",
    ).current || {};
    return {
      d: c.distanceMeters, lat: c.lateralMeters, v: c.speedKph, phase: c.phase,
      apron: c.onApron, sector: c.sector, hull: c.hullClearanceMeters,
      ndcX: c.hullNdcX, ndc: c.hullNdcY, chase: c.chaseMeters,
      camClear: c.cameraSurfaceClearanceMeters, camLat: c.cameraLateralMeters,
    };
  } catch { return null; }
});
const hide = (names) =>
  page.evaluate((n) => globalThis.__futurismaHide?.(n) ?? null, names);
const shoot = async (path) => {
  await page.waitForTimeout(220);
  writeFileSync(path, await page.screenshot());
  return path;
};
const diff = (a, b) =>
  Number(execFileSync("python3", ["scripts/visual/frame-pixel-diff.py", a, b])
    .toString().trim());

await page.waitForSelector("#start-button", { timeout: 60_000 });
for (let attempt = 0; attempt < 40; attempt += 1) {
  const r = await read();
  if (r && r.phase && r.phase !== "standby") break;
  await page.evaluate(() => document.getElementById("start-button")?.click());
  await page.waitForTimeout(500);
}
if (steerKey) await page.keyboard.down("KeyW");

const rows = [];
let steering = false, armed = !steerKey, shots = 0;
for (let i = 0; i < 4000 && shots < wantShots; i += 1) {
  const r = await read();
  if (!r || r.phase !== "running") { await page.waitForTimeout(40); continue; }
  if (steerKey) {
    if (!armed) {
      // Bitterpan's grid sits at progress ~1, so `distanceMeters` starts at the
      // lap length; wait for it to come round before arming anything.
      if (r.d < Math.min(shotFrom, steerFrom)) armed = true;
      else { await page.waitForTimeout(40); continue; }
    }
    if (!steering && r.d >= steerFrom) {
      await page.keyboard.down(steerKey);
      steering = true;
    }
    if (r.d > shotTo) break;
    if (r.d < shotFrom) { await page.waitForTimeout(40); continue; }
  }
  if (!passesLatGate(r.lat)) { await page.waitForTimeout(40); continue; }
  const frozen = await read();
  await page.keyboard.press("KeyP");
  await page.waitForTimeout(500);
  const tag = `${outDir}/p${String(shots).padStart(2, "0")}`;
  await hide([]);
  const withCraft = await shoot(`${tag}.png`);
  await hide(["totem_vehicle_root"]);
  const withoutCraft = await shoot(`${tag}-nocraft.png`);
  const vehicleVisiblePixels = diff(withCraft, withoutCraft);
  const layerPixels = {};
  for (const layer of layers) {
    // The craft's pixel count with THAT LAYER REMOVED. If a layer is painting
    // over the craft, taking it away is what makes the craft appear -- so this
    // number jumping from 0 to tens of thousands names the occluder outright.
    await hide([layer]);
    const craftNoLayer = await shoot(`${tag}-no-${layer}.png`);
    await hide(["totem_vehicle_root", layer]);
    const bareNoLayer = await shoot(`${tag}-no-${layer}-nocraft.png`);
    layerPixels[layer] = diff(craftNoLayer, bareNoLayer);
  }
  await hide([]);
  await page.waitForTimeout(150);
  const row = { ...frozen, vehicleVisiblePixels, ...layerPixels };
  rows.push(row);
  console.log(`p${shots}`, JSON.stringify(row));
  shots += 1;
  await page.keyboard.press("KeyP");
  await page.waitForTimeout(700);
}
const worst = rows.reduce(
  (a, b) => (a === null || b.vehicleVisiblePixels < a.vehicleVisiblePixels ? b : a),
  null,
);
console.log(
  "frames", rows.length,
  "minVehicleVisiblePixels", worst ? worst.vehicleVisiblePixels : "n/a",
);
if (worst) console.log("worst", JSON.stringify(worst));
await browser.close();
