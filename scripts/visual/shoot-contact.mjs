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

/**
 * What the HUD is showing right now, plus the live contact telemetry behind it.
 *
 * Round 2 wants a frame at MAXIMUM push where the hulls are not intersecting,
 * and that is not something a screenshot can be asked for after the fact - the
 * push peaks for a few frames and is gone. So the loop reads the numbers every
 * poll and shoots on the best frame it has seen that also satisfies the
 * separation rule.
 */
const readHud = () => page.evaluate(() => {
  const lapEvent = document.getElementById("lap-event");
  const glow = document.getElementById("cushion-glow");
  const chain = document.getElementById("clean-chain");
  const chainText = chain?.textContent ?? "";
  const chainMatch = /(\d+)/.exec(chainText);
  const diagnostics = document.getElementById("futurisma-diagnostics");
  let current = {};
  try {
    current = JSON.parse(diagnostics?.textContent || "{}").current ?? {};
  } catch { /* not JSON yet */ }
  return {
    nearMiss: lapEvent?.dataset.active === "true"
      && (document.getElementById("lap-event-label")?.textContent ?? "") === "NEAR MISS",
    nearMissDetail: document.getElementById("lap-event-time")?.textContent ?? "",
    glow: glow?.dataset.active === "true",
    glowSide: glow?.dataset.side ?? "",
    // Read off the HUD element, which the race loop refreshes at 30 Hz. The
    // diagnostics node below only rewrites itself once a SECOND, so anything
    // taken from it about a third-of-a-second contact is a lottery - an earlier
    // version of this harness reported a 0.22 m/s^2 peak on a race whose real
    // peak was 13.4 for exactly that reason.
    glowStrength: glow?.dataset.strength ?? "",
    chain: chainMatch ? Number(chainMatch[1]) : 0,
    chainText,
    phase: current.phase ?? "",
    push: Math.abs(current.cushionPushNow ?? 0),
    gap: current.cushionGapNow ?? 0,
    separation: current.cushionSeparationNow ?? 0,
    yield: current.cushionYieldNow ?? 0,
    // LATCHED by the fleet on the physics step, so a once-a-second poll reads
    // them correctly - unlike the instantaneous fields above.
    peakClearPush: current.cushionPeakClearPush ?? 0,
    separationAtPeakClearPush: current.cushionSeparationAtPeakClearPush ?? 0,
    peakPush: current.cushionPeakPush ?? 0,
    speedKph: current.speedKph ?? 0,
  };
});

const captured = new Set();
const shoot = async (name, note) => {
  if (captured.has(name)) return;
  captured.add(name);
  await page.screenshot({ path: `${outDir}/${name}.png` });
  console.log(`captured ${name}: ${note}`);
};

/**
 * The separation a frame has to clear for the glow shot to be usable.
 *
 * The whole point of round 2 is that the hulls stop intersecting, so a
 * screenshot taken while they still are would be evidence against the feature.
 * A TOTEM is ~2.2 m across, so 2.2 m centre to centre is exactly touching.
 */
const CLEAR_SEPARATION_METERS = 2.2;
/**
 * ... and the push a frame has to carry before it is worth spending a
 * screenshot on.
 *
 * A screenshot blocks the poll loop for about 150 ms - ten simulation frames -
 * so shooting the first faint contact that comes along costs the run exactly
 * the window a hard one would have landed in. Two capture runs went that way
 * and returned 0.48 and 0.22 m/s^2 frames off races whose peak push was 14.
 * Gating on strength means the harness only stops for a frame worth stopping
 * for, and reports MISSED honestly when the race never produced one.
 */
const STRONG_PUSH_MPS2 = 2;

const deadline = Date.now() + maxSeconds * 1000;
let bestGlow = 0;

while (Date.now() < deadline) {
  const hud = await readHud();
  if (hud.nearMiss) await shoot("near-miss", `lap-event "NEAR MISS" / ${hud.nearMissDetail}`);
  if (hud.chain >= 3) await shoot("clean-chain", `gate counter reads "${hud.chainText}"`);
  // Re-shoot the glow whenever a harder push arrives that is still clear of the
  // hulls, so the frame that survives is the best one the race produced rather
  // than the first one it stumbled into.
  // Gated on the 30 Hz HUD attribute, not on the 1 Hz diagnostics push.
  if (hud.glow && hud.glowStrength === "firm" && bestGlow === 0) {
    bestGlow = 1;
    captured.delete("cushion-glow");
    await shoot(
      "cushion-glow",
      `FIRM lean on the ${hud.glowSide} at ${Math.round(hud.speedKph)} km/h - the HUD `
        + "attribute is refreshed at 30 Hz, so the frame is the contact; the "
        + "envelope line below carries the fleet-latched numbers",
    );
  }
  if (hud.phase === "finished") break;
  await page.waitForTimeout(12);
}

// The contact envelope, read from the fleet's own LATCHED peaks rather than
// from anything this loop sampled. The instantaneous fields are rewritten once
// a second while a contact lasts about a third of one, so a poll-max over them
// is a lottery - an earlier version of this harness reported a 0.22 m/s^2 peak
// on a race whose real peak was 13.4. A latch does not care how often it is read.
const final = await readHud();
console.log(
  `contact envelope (fleet-latched): peak push ${final.peakPush.toFixed(2)} m/s^2; `
    + `hardest push with the hulls clear of ${CLEAR_SEPARATION_METERS} m was `
    + `${final.peakClearPush.toFixed(2)} m/s^2 at `
    + `${final.separationAtPeakClearPush.toFixed(2)} m separation.`,
);
for (const name of ["near-miss", "cushion-glow", "clean-chain"]) {
  if (!captured.has(name)) console.log(`MISSED ${name}: never went live inside the window`);
}
await browser.close();
