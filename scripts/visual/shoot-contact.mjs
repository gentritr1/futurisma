// Visual review harness (not part of the shipped game).
//
// G2 — captures the three racing-contact HUD states the moment each one is
// live, rather than hoping a timed burst lands on one.
//
// A near-miss flash lasts 900 ms and a cushion glow 260 ms, and both fire at
// times nobody can predict from outside the race: on the Bitterpan demo soak
// the two near misses land at about 75 s and 112 s. `shoot.mjs` at 350 ms
// intervals would have to be lucky twice. This polls the DOM at 50 ms and
// shoots on the transition, so the evidence is deterministic even though the
// event is not.
//
// Usage: node scripts/visual/shoot-contact.mjs <url> <outDir> [maxSeconds]
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const url = process.argv[2];
const outDir = process.argv[3] || "shots/g2-contact";
const maxSeconds = Number(process.argv[4] || 240);

const browser = await chromium.launch({
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on("pageerror", (event) => console.log("[pageerror]", String(event).slice(0, 300)));
page.on("console", (message) => {
  if (message.type() === "error") console.log("[console.error]", message.text().slice(0, 300));
});
await page.goto(url, { waitUntil: "networkidle" });
mkdirSync(outDir, { recursive: true });

/** What the HUD is showing right now, read straight off the elements. */
const readHud = () => page.evaluate(() => {
  const lapEvent = document.getElementById("lap-event");
  const glow = document.getElementById("cushion-glow");
  const chain = document.getElementById("clean-chain");
  const chainText = chain?.textContent ?? "";
  const chainMatch = /(\d+)/.exec(chainText);
  const diagnostics = document.getElementById("futurisma-diagnostics");
  let phase = "";
  try {
    phase = JSON.parse(diagnostics?.textContent || "{}").current?.phase ?? "";
  } catch { /* not JSON yet */ }
  return {
    nearMiss: lapEvent?.dataset.active === "true"
      && (document.getElementById("lap-event-label")?.textContent ?? "") === "NEAR MISS",
    nearMissDetail: document.getElementById("lap-event-time")?.textContent ?? "",
    glow: glow?.dataset.active === "true",
    glowSide: glow?.dataset.side ?? "",
    chain: chainMatch ? Number(chainMatch[1]) : 0,
    chainText,
    phase,
  };
});

const captured = new Set();
const shoot = async (name, note) => {
  if (captured.has(name)) return;
  captured.add(name);
  await page.screenshot({ path: `${outDir}/${name}.png` });
  console.log(`captured ${name}: ${note}`);
};

const deadline = Date.now() + maxSeconds * 1000;
while (Date.now() < deadline && captured.size < 3) {
  const hud = await readHud();
  if (hud.nearMiss) await shoot("near-miss", `lap-event "NEAR MISS" / ${hud.nearMissDetail}`);
  if (hud.glow) await shoot("cushion-glow", `contact glow on the ${hud.glowSide}`);
  if (hud.chain >= 3) await shoot("clean-chain", `gate counter reads "${hud.chainText}"`);
  if (hud.phase === "finished") break;
  await page.waitForTimeout(50);
}

for (const name of ["near-miss", "cushion-glow", "clean-chain"]) {
  if (!captured.has(name)) console.log(`MISSED ${name}: never went live inside the window`);
}
await browser.close();
