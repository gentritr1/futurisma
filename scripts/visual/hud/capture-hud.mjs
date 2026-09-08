/**
 * HUD acceptance captures.
 *
 * Drives the real game in a real browser at a real CSS viewport - the design
 * tool's own preview pane reports a 400x225 viewport behind a device-pixel
 * ratio, which is exactly the sort of thing that makes a HUD look validated
 * when it has not been. Every frame here is the game running its own loop, its
 * own clock and its own input path; nothing is faked or posed.
 *
 *   node scripts/visual/hud/capture-hud.mjs --out art/evidence/hud
 *
 * Flags: --port (default 5310), --out, --url-extra
 */

import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const arg = (name, fallback) => {
  const hit = process.argv.find((value) => value.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const PORT = Number(arg("port", "5310"));
const OUT = arg("out", "art/evidence/hud");
const BASE = `http://127.0.0.1:${PORT}/`;

/** The two viewports the brief names, at a CSS pixel ratio of 1. */
const VIEWPORTS = [
  { name: "1280x720", width: 1280, height: 720 },
  { name: "1920x1080", width: 1920, height: 1080 },
];

/**
 * Each case is a real run: launch the race, let the demo driver actually drive,
 * then read the HUD's own state back out of the DOM so the capture is labelled
 * with what the game believed at that instant rather than with what we hoped.
 */
const CASES = [
  { id: "race", query: "?map=greenwater&demo=1&laps=5", settle: 14000, note: "field race, mid-lap" },
  { id: "race-rivals", query: "?map=greenwater&demo=1&laps=5", settle: 26000, note: "rivals close" },
  { id: "polarity", query: "?map=polarity&demo=1", settle: 16000, note: "gravity decks and device" },
  { id: "tideline", query: "?map=tideline&demo=1", settle: 18000, note: "travel modes" },
  { id: "reduced", query: "?map=greenwater&demo=1&laps=5&motion=reduce", settle: 14000, note: "reduced motion" },
];

const readState = async (page) =>
  page.evaluate(() => {
    const text = (selector) => document.querySelector(selector)?.textContent?.trim() ?? null;
    const style = getComputedStyle(document.body);
    const cluster = document.querySelector(".hud-drive")?.getBoundingClientRect();
    const standing = document.querySelector(".hud-standing")?.getBoundingClientRect();
    return {
      hudScale: style.getPropertyValue("--hud-scale").trim(),
      menuScale: style.getPropertyValue("--menu-scale").trim(),
      viewport: { width: window.innerWidth, height: window.innerHeight, dpr: devicePixelRatio },
      phase: document.body.dataset.phase ?? null,
      speed: text("#speed-value"),
      position: text("#position-value"),
      lap: text("#lap-value"),
      gate: text("#checkpoint-value"),
      ladderRows: document.querySelectorAll("#field-order li").length,
      lapPips: document.querySelectorAll("#lap-pips i").length,
      // The acceptance number from the brief: the cluster must stay inside its
      // footprint and must never reach the standing block.
      clusterWidth: cluster ? Number(cluster.width.toFixed(2)) : null,
      clusterTop: cluster ? Number(cluster.top.toFixed(2)) : null,
      standingBottom: standing ? Number(standing.bottom.toFixed(2)) : null,
      fontLoaded: document.fonts.check('700 92px "Barlow Condensed"'),
    };
  });

const run = async () => {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const results = [];
  const errors = [];

  for (const viewport of VIEWPORTS) {
    for (const scale of ["m", "l"]) {
      for (const testCase of CASES) {
        // HUD SCALE L has to be a stored setting, not a query flag, or the test
        // proves nothing about the path a player actually takes to it.
        const context = await browser.newContext({
          viewport: { width: viewport.width, height: viewport.height },
          deviceScaleFactor: 1,
          reducedMotion: testCase.id === "reduced" ? "reduce" : "no-preference",
        });
        const page = await context.newPage();
        page.on("pageerror", (error) => errors.push(`${testCase.id}: ${error.message}`));
        page.on("console", (message) => {
          if (message.type() === "error") errors.push(`${testCase.id}: ${message.text()}`);
        });
        await page.addInitScript((value) => {
          // The real key, and a real payload: the scale has to arrive the way a
          // player's stored setting arrives, or the capture proves nothing about
          // the path to it.
          const key = "futurisma.save.v1";
          let stored = {};
          try {
            stored = JSON.parse(localStorage.getItem(key) ?? "{}");
          } catch {
            stored = {};
          }
          stored.settings = { ...(stored.settings ?? {}), hudScale: value, menuScale: value };
          localStorage.setItem(key, JSON.stringify(stored));
        }, scale);

        await page.goto(BASE + testCase.query, { waitUntil: "load" });
        // Start the race the way a player does: click the launch control, then
        // wait for the game itself to say it is racing rather than guessing at
        // a timeout. A capture taken during the countdown is not a HUD capture.
        await page.waitForSelector("#start-button:not([hidden])", { timeout: 60000 });
        await page.click("#start-button");
        await page.waitForFunction(() => document.body.dataset.phase === "race", null, {
          timeout: 60000,
        });
        await page.waitForTimeout(testCase.settle);

        const state = await readState(page);
        const name = `${viewport.name}-scale-${scale}-${testCase.id}`;
        await page.screenshot({ path: join(OUT, `${name}.png`) });
        results.push({ name, viewport: viewport.name, scale, case: testCase.id, note: testCase.note, ...state });
        console.log(name, JSON.stringify({ hudScale: state.hudScale, speed: state.speed, clusterWidth: state.clusterWidth }));
        await context.close();
      }
    }
  }

  await browser.close();
  writeFileSync(
    join(OUT, "capture.json"),
    `${JSON.stringify({ script: "scripts/visual/hud/capture-hud.mjs", base: BASE, results, errors }, null, 2)}\n`,
  );
  console.log(`\n${results.length} captures, ${errors.length} console/page errors`);
  if (errors.length) console.log(errors.slice(0, 10).join("\n"));
};

await run();
