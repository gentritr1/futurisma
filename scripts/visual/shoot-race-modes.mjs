// G4 acceptance harness (not part of the shipped game).
//
// Two jobs, one browser context each, because the second one depends on the
// first having written to localStorage:
//
//   `shots`   the four screenshots the phase has to be judged on: the paddock
//             with the format and field selectors, a sector-delta flash, the
//             time-attack live chip, and the result screen with its stats.
//   `attack`  the two consecutive time-attack runs. The first sets a best lap
//             and a ghost on an empty profile; the second is reloaded into the
//             SAME context so the save file is there, and reports the delta
//             chip's value at three gates plus whether the ghost came back.
//
// The context is the load-bearing detail in both. A fresh Playwright context
// has empty storage, which is what makes run one a genuine first visit; reusing
// it is what makes run two a genuine return.
//
// Usage:
//   node scripts/visual/shoot-race-modes.mjs shots  [baseUrl]
//   node scripts/visual/shoot-race-modes.mjs attack [baseUrl]
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const job = process.argv[2] ?? "shots";
const base = process.argv[3] ?? "http://127.0.0.1:5214";
const outputDirectory = new URL("../../shots/g4/", import.meta.url);
await mkdir(outputDirectory, { recursive: true });

const browser = await chromium.launch({
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"],
});
const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });

/** The diagnostics line, parsed, or null while it is not JSON yet. */
async function diagnostics(page) {
  const text = await page.evaluate(() => {
    const element = document.getElementById("futurisma-diagnostics");
    return element ? element.textContent || "" : "";
  });
  try {
    return JSON.parse(text || "{}").current ?? null;
  } catch {
    return null;
  }
}

/** Polls the diagnostics line until `predicate` holds, or gives up. */
async function until(page, predicate, seconds, label) {
  for (let tick = 0; tick < seconds * 4; tick += 1) {
    await page.waitForTimeout(250);
    const current = await diagnostics(page);
    if (current && predicate(current)) return current;
  }
  throw new Error(`Timed out waiting for ${label}.`);
}

async function shoot(page, name) {
  const path = new URL(`${name}.png`, outputDirectory);
  await page.screenshot({ path: path.pathname });
  console.log(`  wrote shots/g4/${name}.png`);
}

if (job === "shots") {
  // 1. The paddock. No `?demo`, so the start screen stays up and the format and
  //    field chip rows can be read at rest. `?mode=`/`?tier=` are passed so the
  //    shot also proves the chips follow the RESOLVED values rather than the
  //    save file — see `MetaUi.syncFromSave`.
  const paddock = await context.newPage();
  await paddock.goto(`${base}/?map=greenwater&mode=sprint&tier=feral`, {
    waitUntil: "networkidle",
  });
  await paddock.waitForSelector("#start-screen:not([hidden])", { timeout: 60_000 });
  await paddock.waitForTimeout(1_200);
  await shoot(paddock, "paddock-format-and-field");
  await paddock.close();

  // 2. A sector-delta flash. It only exists once there is a record to measure
  //    against, so this races twice in one context: the first run puts a lap on
  //    file, the second is caught mid-flash. The catch is state-triggered off
  //    the diagnostics line rather than timed, because a 1.2 s flash inside a
  //    35 s lap is not something a sleep can hit reliably.
  const delta = await context.newPage();
  const raceUrl = `${base}/?map=greenwater&laps=2&demo=1&diagnostics=1&headless=1`
    + "&mode=race&tier=works";
  await delta.goto(raceUrl, { waitUntil: "networkidle" });
  await until(delta, (d) => d.phase === "finished", 180, "the seeding race to finish");
  await delta.goto(raceUrl, { waitUntil: "networkidle" });
  await until(
    delta,
    (d) => d.sectorDeltas.length > 0,
    180,
    "a sector delta to be flashed",
  );
  // The flash holds 1.2 s and the diagnostics line lands at most 1 s stale, so
  // the screenshot is taken immediately and the DOM is asserted with it.
  const flashed = await delta.evaluate(() => {
    const element = document.getElementById("sector-delta");
    return element
      ? { hidden: element.hidden, text: element.textContent, tone: element.dataset.tone }
      : null;
  });
  console.log("  sector-delta element:", JSON.stringify(flashed));
  await shoot(delta, "sector-delta-flash");
  await delta.close();

  // 3. The time-attack live chip, and 4. the result screen with its stats.
  //    Same context again, so the lap the seeding race just filed is on record
  //    and the chip has something to print.
  const attack = await context.newPage();
  const attackUrl = `${base}/?map=greenwater&laps=2&demo=1&diagnostics=1&headless=1`
    + "&mode=timeattack&tier=works";
  await attack.goto(attackUrl, { waitUntil: "networkidle" });
  await until(attack, (d) => d.phase === "finished", 180, "the seeding time attack");
  await attack.goto(attackUrl, { waitUntil: "networkidle" });
  // A NON-ZERO delta, at racing speed. The chip legitimately reads `0.00` on
  // the grid — the lap has not started, so it is level with the record by
  // definition — and a screenshot of that proves the element exists rather than
  // that it works. Waiting for a real value is the difference.
  await until(
    attack,
    (d) => d.liveDelta !== "—" && d.liveDelta !== "" && d.liveDelta !== "0.00"
      && d.speedKph > 150,
    180,
    "the live delta chip to read a non-zero value at racing speed",
  );
  const chip = await attack.evaluate(() => {
    const element = document.getElementById("delta-chip");
    return element
      ? {
        hidden: element.hidden,
        text: element.textContent?.replace(/\s+/g, " ").trim(),
        tone: element.dataset.tone,
      }
      : null;
  });
  console.log("  delta-chip element:", JSON.stringify(chip));
  await shoot(attack, "timeattack-live-delta");

  const finished = await until(attack, (d) => d.phase === "finished", 180, "the result");
  await attack.waitForSelector("#result-screen:not([hidden])", { timeout: 30_000 });
  await attack.waitForTimeout(900);
  const stats = await attack.evaluate(() => (
    [...document.querySelectorAll("#result-stats div")]
      .map((row) => `${row.querySelector("dt")?.textContent}=${
        row.querySelector("dd")?.textContent}`)
  ));
  console.log("  result stats:", JSON.stringify(stats));
  console.log(`  result mode/tier: ${finished.raceMode}/${finished.rivalTier}`);
  await shoot(attack, "result-screen-stats");
  await attack.close();
}

if (job === "attack") {
  // Two consecutive time-attack runs in ONE context, which is what makes the
  // second one a return visit rather than a second first visit.
  const page = await context.newPage();
  const url = `${base}/?map=${process.argv[4] ?? "greenwater"}`
    + "&laps=5&demo=1&diagnostics=1&headless=1&mode=timeattack&tier=works";

  await page.goto(url, { waitUntil: "networkidle" });
  const first = await until(page, (d) => d.phase === "finished", 300, "run 1 to finish");
  console.log(JSON.stringify({
    run: 1,
    raceMode: first.raceMode,
    rivalTier: first.rivalTier,
    fieldSize: first.fieldSize,
    calls: first.calls,
    rivalDrawCalls: first.rivalDrawCalls,
    textures: first.textures,
    p95FrameMs: first.p95FrameMs,
    lapTimesMs: first.lapTimesMs,
    // Null on a first visit: there was nothing on file to measure against.
    referenceBestLapMs: first.raceModeBestLapMs,
    sectorDeltas: first.sectorDeltas,
    liveDelta: first.liveDelta,
    ghostActive: first.ghostActive,
    ghostDrawCalls: first.ghostDrawCalls,
  }, null, 2));

  // What run 1 actually put on file, read back through the save the game wrote.
  const stored = await page.evaluate(() => {
    try {
      return JSON.parse(localStorage.getItem("futurisma.save.v1") ?? "null");
    } catch {
      return null;
    }
  });
  const record = stored?.records?.["MAP 01"] ?? null;
  console.log(JSON.stringify({
    storedSchemaVersion: stored?.schemaVersion ?? null,
    storedBests: record ? Object.fromEntries(
      Object.entries(record.bests).map(([slot, best]) => [slot, {
        bestLapMs: best.bestLapMs,
        gateSplitsMs: best.gateSplitsMs,
      }]),
    ) : null,
    storedGhostModes: record ? Object.keys(record.ghosts) : null,
    storedGhostFrames: record?.ghosts?.timeattack
      ? record.ghosts.timeattack.frames.length / 4
      : 0,
    savedBytes: stored ? JSON.stringify(stored).length : 0,
  }, null, 2));

  await page.goto(url, { waitUntil: "networkidle" });
  const second = await until(page, (d) => d.phase === "finished", 300, "run 2 to finish");
  console.log(JSON.stringify({
    run: 2,
    referenceBestLapMs: second.raceModeBestLapMs,
    referenceSplitsMs: second.raceModeGateSplitsMs,
    // The acceptance line: what the delta readouts printed, gate by gate.
    sectorDeltas: second.sectorDeltas,
    liveDelta: second.liveDelta,
    lapTimesMs: second.lapTimesMs,
    ghostActive: second.ghostActive,
    ghostDrawCalls: second.ghostDrawCalls,
    ghostLapMs: second.ghostLapMs,
    calls: second.calls,
    p95FrameMs: second.p95FrameMs,
    fieldSize: second.fieldSize,
  }, null, 2));
  await page.close();
}

await context.close();
await browser.close();
