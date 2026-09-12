/**
 * Launch-screen acceptance captures.
 *
 * The paddock is the one screen every dispatch passes through, and its
 * hierarchy is the thing this run is checking: eyebrow (brand, index,
 * flavour), h1 (the CIRCUIT, on every map), objective (format, laps, field),
 * then the deck prose. Each record is read back out of the live DOM after the
 * game has said `phase === "intro"` itself, so the labels here are what the
 * page computed rather than what the markup ships.
 *
 * The bound that can actually break: `#start-button` must stay inside the
 * viewport on every circuit. The objective line adds a row to a panel that was
 * already the tallest thing on a 720p screen, and a launch button pushed below
 * the fold is a circuit nobody can start.
 *
 *   node scripts/visual/hud/paddock-captures.mjs --port=5198 --out=<dir>
 *
 * Flags (all `--flag=value`, never `--flag value`):
 *   --port       dev server port (default 5310)
 *   --out        evidence directory (default art/evidence/hud/paddock)
 *   --viewports  `WxH,WxH` (default `1280x720,1920x1080`)
 *   --maps       comma-separated `?map=` values (default: all seven)
 */

import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";

const arg = (name, fallback) => {
  const hit = process.argv.find((value) => value.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const PORT = Number(arg("port", "5310"));
const OUT = arg("out", "art/evidence/hud/paddock");
const BASE = `http://127.0.0.1:${PORT}/`;
const MAPS = arg(
  "maps",
  "greenwater,bitterpan,nightshift,polarity,tideline,ascension,dreamisland",
).split(",").filter(Boolean);
const VIEWPORTS = arg("viewports", "1280x720,1920x1080").split(",").filter(Boolean)
  .map((pair) => {
    const [width, height] = pair.split("x").map(Number);
    return { name: pair, width, height };
  });

/**
 * Read after `phase === "intro"`.
 *
 * TWO facts about the launch button, kept apart because they fail at different
 * viewports and conflating them would let one hide the other:
 *
 * - `launchAboveFold` — the button is wholly inside the viewport with no
 *   scrolling. This is the brief's bound and it is asserted at 1280x720 and
 *   1366x768.
 * - `launchVisible` — the player can actually reach and press it: above the
 *   fold, or inside the launch screen's own scrollable content.
 *
 * They diverge at 1920x1080, where the panel is taller than the viewport on
 * most circuits. That is NOT new: measured on `main` at 1920x1080, Ascension's
 * button sat at 1093.47 against a 1080 viewport, Night Shift at 1078.91 and
 * Dream Island at 1076.88 — and `.screen--intro` did not scroll, so the
 * control was unreachable rather than merely low. Neither number is asserted
 * at that viewport; both are recorded for every capture, and the console
 * prints every above-fold failure whether or not it is fatal.
 */
const readPaddock = () => {
  const text = (selector) => document.querySelector(selector)?.textContent?.trim() ?? null;
  const start = document.getElementById("start-button");
  const box = start?.getBoundingClientRect() ?? null;
  const objective = document.getElementById("intro-objective");
  const objectiveBox = objective?.getBoundingClientRect() ?? null;
  return {
    map: document.body.dataset.map ?? null,
    h1: text(".intro-panel h1"),
    eyebrow: text("#start-screen .intro-code"),
    objective: objective?.textContent?.trim() ?? null,
    objectiveOneLine: objectiveBox
      ? objectiveBox.height <= Number.parseFloat(getComputedStyle(objective).fontSize) * 2
      : null,
    objectiveOverflow: objective
      ? { scrollWidth: objective.scrollWidth, clientWidth: objective.clientWidth }
      : null,
    deck: text("#intro-deck"),
    footer: text("#intro-footer"),
    startButtonTop: box ? Number(box.top.toFixed(2)) : null,
    startButtonBottom: box ? Number(box.bottom.toFixed(2)) : null,
    launchAboveFold: Boolean(
      box && box.height > 0 && box.width > 0
        && box.top >= 0 && box.bottom <= window.innerHeight,
    ),
    launchVisible: Boolean(box && box.height > 0 && box.width > 0 && start
      && (() => {
        const screen = start.closest(".screen");
        if (!screen) return false;
        // Reachable means: laid out inside the screen's scrollable content, and
        // the screen is able to scroll to it. `scrollHeight` is the content the
        // screen owns; a button past it is genuinely gone.
        const scrollable = getComputedStyle(screen).overflowY !== "visible";
        const withinContent = start.offsetTop + start.offsetHeight <= screen.scrollHeight + 1;
        return (box.top >= 0 && box.bottom <= window.innerHeight)
          || (scrollable && withinContent);
      })()),
    viewportHeight: window.innerHeight,
    panelHeight: Number((document.querySelector(".intro-panel")?.getBoundingClientRect().height ?? 0).toFixed(2)),
  };
};

const run = async () => {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const records = [];
  const errors = [];

  for (const viewport of VIEWPORTS) {
    for (const map of MAPS) {
      const name = `${viewport.name}-${map}`;
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        deviceScaleFactor: 1,
      });
      const page = await context.newPage();
      page.on("pageerror", (error) => errors.push(`${name}: ${error.message}`));
      page.on("console", (message) => {
        if (message.type() === "error") errors.push(`${name}: ${message.text()}`);
      });
      // No `demo=1`: the demo autopilot skips the paddock, which is the screen
      // being captured. `main.ts` calls `showReady()` only after `initialize()`
      // has handed the REAL starting grid to `setRaceFormat`, so waiting for
      // the intro phase is also what makes the field segment of the objective
      // line trustworthy rather than a race with the fleet.
      await page.goto(`${BASE}?map=${map}`, { waitUntil: "load" });
      await page.waitForFunction(
        () => document.body.dataset.phase === "intro",
        null,
        { timeout: 180000 },
      );
      const state = await page.evaluate(readPaddock);
      await page.screenshot({ path: join(OUT, `${name}.png`) });
      records.push({ name, map, viewport: viewport.name, ...state });
      console.log(
        name,
        JSON.stringify({
          h1: state.h1,
          objective: state.objective,
          startButtonBottom: state.startButtonBottom,
        }),
      );
      await context.close();
    }
  }
  await browser.close();

  writeFileSync(
    join(OUT, "paddock.json"),
    `${JSON.stringify({ script: "scripts/visual/hud/paddock-captures.mjs", base: BASE, records, errors }, null, 2)}\n`,
  );

  const belowFold = records.filter((record) => !record.launchAboveFold);
  if (belowFold.length > 0) {
    console.log(
      `\nLaunch button below the fold on ${belowFold.length} capture(s):\n`
        + belowFold.map((record) =>
          `  ${record.name}: bottom ${record.startButtonBottom} against `
            + `${record.viewportHeight} (over by `
            + `${(record.startButtonBottom - record.viewportHeight).toFixed(2)} px), `
            + `reachable by scroll: ${record.launchVisible}`).join("\n"),
    );
  }

  for (const record of records) {
    assert.ok(
      record.launchVisible,
      `${record.name}: LAUNCH RACE cannot be reached at all — bottom `
        + `${record.startButtonBottom} against ${record.viewportHeight}, and the `
        + "launch screen does not scroll to it.",
    );
    // The brief's bound, at the two viewports it was written for.
    if (record.viewportHeight <= 768) {
      assert.ok(
        record.launchAboveFold,
        `${record.name}: #start-button bottom ${record.startButtonBottom} exceeds `
          + `${record.viewportHeight}.`,
      );
    }
    assert.ok(
      record.h1 && record.h1 !== "TOTEM",
      `${record.name}: the h1 must be the circuit, not the craft (got ${record.h1}).`,
    );
    assert.ok(
      record.eyebrow?.startsWith("FUTURISMA · MAP "),
      `${record.name}: eyebrow must lead with brand and map index (got ${record.eyebrow}).`,
    );
    assert.ok(
      (record.objective ?? "").split(" · ").length === 3,
      `${record.name}: the objective must carry format, laps and field (got ${record.objective}).`,
    );
    assert.equal(
      record.objectiveOneLine,
      true,
      `${record.name}: the objective wrapped to a second line (${record.objective}).`,
    );
  }
  assert.deepEqual(errors, [], "Paddock captures must be free of page errors.");

  const worst = records.reduce((a, b) =>
    (a.viewportHeight - a.startButtonBottom) <= (b.viewportHeight - b.startButtonBottom) ? a : b);
  console.log(
    `\n${records.length} paddock captures, 0 page errors. Tightest launch-button `
      + `clearance: ${worst.name} at ${(worst.viewportHeight - worst.startButtonBottom).toFixed(2)} px.`,
  );
};

await run();
