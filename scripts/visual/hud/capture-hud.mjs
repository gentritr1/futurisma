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
/**
 * Kept in step with `persistence.ts` by the assertion below rather than by
 * hope: if the schema moves and this payload stops parsing, every capture lands
 * on the default scale and the run fails loudly.
 */
const SCHEMA_VERSION = 5;
const USER_STEP = { s: 0.88, m: 1, l: 1.2 };
const viewportTerm = (height) =>
  Math.min(1.35, Math.max(1, Math.sqrt(height / 720)));

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
        /*
          The scale arrives as a STORED setting, the way it does for a returning
          player. It has to be a payload `parseSave` accepts: the first run of
          this script wrote one with no `schemaVersion`, the parser correctly
          refused it, and every "L" capture was silently an "M". The assertion
          after the settle is what makes that failure loud instead of quiet -
          never trust the fixture, check the value the page actually computed.

          (Reachability of the setting is proven separately, by clicking the
          terminal rows in `options-interface.png`; the terminal cannot be
          opened mid-race, and these cases are all mid-race.)
        */
        await page.addInitScript(
          ({ value, schemaVersion }) => {
            localStorage.setItem(
              "futurisma.save.v1",
              JSON.stringify({ schemaVersion, settings: { hudScale: value, menuScale: value } }),
            );
          },
          { value: scale, schemaVersion: SCHEMA_VERSION },
        );
        page.on("console", (message) => {
          if (message.type() === "error") errors.push(`${testCase.id}: ${message.text()}`);
        });
        await page.goto(BASE + testCase.query, { waitUntil: "load" });


        // Start the race the way a player does, then wait for the GAME to say
        // it is racing rather than guessing at a timeout - a frame taken during
        // the countdown is not a HUD capture. Enter is the launch key and, with
        // the focus rule, it activates the launch control when that control has
        // focus and reaches the race when nothing does; both paths land here.
        // Wait for the game to settle on a screen, then only press Enter if it
        // is actually waiting to be launched. `demo=1` with a stored save skips
        // the paddock and starts racing on its own - and Enter on a race that is
        // already running PAUSES it, which is how this script previously hung
        // waiting for a phase it had just left.
        await page.waitForFunction(
          () => ["intro", "race", "countdown"].includes(document.body.dataset.phase ?? ""),
          null,
          { timeout: 90000 },
        );
        if ((await page.evaluate(() => document.body.dataset.phase)) === "intro") {
          await page.keyboard.press("Enter");
        }
        await page.waitForFunction(() => document.body.dataset.phase === "race", null, {
          timeout: 90000,
        });
        await page.waitForTimeout(testCase.settle);

        const state = await readState(page);
        const expected = (USER_STEP[scale] * viewportTerm(viewport.height)).toFixed(4);
        if (state.hudScale !== expected) {
          errors.push(
            `${testCase.id} @ ${viewport.name} scale ${scale}: --hud-scale is `
              + `${state.hudScale}, expected ${expected}. The stored setting did not arrive.`,
          );
        }
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
