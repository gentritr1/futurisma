/**
 * HUD acceptance captures.
 *
 * Drives the real game in a real browser at a real CSS viewport - the design
 * tool's own preview pane reports a 400x225 viewport behind a device-pixel
 * ratio, which is exactly the sort of thing that makes a HUD look validated
 * when it has not been. Every frame here is the game running its own loop, its
 * own clock and its own input path; nothing is faked or posed.
 *
 *   node scripts/visual/hud/capture-hud.mjs --out=art/evidence/hud
 *
 * Flags: --port (default 5310), --out, --url-extra
 */

import {execFileSync} from "node:child_process";
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const arg = (name, fallback) => {
  const hit = process.argv.find((value) => value.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

// Historical renderer is a test oracle only; it is never loaded by the game.
const legacySource=execFileSync('git',['show','2862475:src/game/ability-text.js'],{encoding:'utf8'});
const legacy=await import('data:text/javascript;base64,'+Buffer.from(legacySource).toString('base64'));
const PORT = Number(arg("port", "5310"));
const OUT = arg("out", "art/evidence/hud");
/** `--only=1280x720-scale-m-race,1920x1080-scale-l-ascension` re-runs named captures. */
const ONLY = new Set(arg("only", "").split(",").filter(Boolean));
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
  { id: "ascension", query: "?map=ascension&demo=1", settle: 18000, note: "deckless pad, launch day" },
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
      slots: {
        device: document.querySelector('.hud-device')?.getAttribute('data-device'),
        deck: document.querySelector('.hud-gravity')?.getAttribute('data-deck'),
        transfer: document.querySelector('.hud-gravity')?.getAttribute('data-transfer'),
        power: {...document.getElementById('polarity-power')?.dataset},
        powerText: text('#polarity-power'), deckText:text('#polarity-deck'), actionText:text('#polarity-flip'),
      },
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
        const name = `${viewport.name}-scale-${scale}-${testCase.id}`;
        if (ONLY.size > 0 && !ONLY.has(name)) continue;
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
        /*
          `phase === "race"` is set when the countdown STARTS, and on the heavier
          circuits the environment is still streaming at that point - a Tideline
          capture taken on that signal caught the GO card with the clock still on
          00:00.000. Waiting for the race clock to have actually advanced is the
          honest condition: it can only be true once the race is under way.
        */
        await page.waitForFunction(
          () => {
            if (document.body.dataset.phase !== "race") return false;
            const clock = document.getElementById("time-value")?.textContent ?? "";
            return clock !== "" && clock !== "00:00.000";
          },
          null,
          { timeout: 120000 },
        );
        await page.waitForTimeout(testCase.settle);

        const state = await readState(page);
        if(['polarity','tideline','ascension'].includes(testCase.id)){
          const expectedSlots={device:legacy.readDeviceState(state.slots.powerText??''),deck:legacy.readDeck(state.slots.deckText??''),transfer:(state.slots.actionText??'').includes('/')?'ready':'wait'};
          state.slots.legacyExpected=expectedSlots;
          for(const key of ['device','deck','transfer'])if(state.slots[key]!==expectedSlots[key])errors.push(`${name}: ${key} differs from baseline renderer`);
        }
        const expected = (USER_STEP[scale] * viewportTerm(viewport.height)).toFixed(4);
        if (state.hudScale !== expected) {
          errors.push(
            `${testCase.id} @ ${viewport.name} scale ${scale}: --hud-scale is `
              + `${state.hudScale}, expected ${expected}. The stored setting did not arrive.`,
          );
        }
        // A frame is only evidence if it is a moving race. A page reload (Vite
        // HMR, a crash) leaves `phase` null and a stalled craft reads 000, and
        // an earlier run recorded three such frames as passes.
        if (state.phase !== "race" || state.speed === "000") {
          errors.push(`${name}: not a moving race at capture (phase=${state.phase}, speed=${state.speed})`);
        }
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
  process.exitCode = errors.length ? 1 : 0;
};

await run();
