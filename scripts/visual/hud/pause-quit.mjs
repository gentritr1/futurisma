/**
 * The pause → countdown → resume transition, and the quit hold, driven live.
 *
 * Everything here happens through the real keyboard and pointer path against a
 * real running race. The four cancellation cases are the point: each one is a
 * hold that MUST NOT quit, and the only honest way to show that is to leave the
 * key down for longer than the hold and observe that the race is still running.
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
const URL = `http://127.0.0.1:${PORT}/?map=polarity&demo=1`;
/*
  The quit case drops `demo=1` deliberately. Quitting reloads to the paddock,
  and a reload that still carries the demo flag drives straight back into a demo
  race - which would read as "the quit did nothing" when in fact it worked. The
  navigation counter below is the actual evidence either way.
*/
const QUIT_URL = `http://127.0.0.1:${PORT}/?map=polarity`;

/** Hold longer than the 0.9s confirm, so a failure to cancel is unmissable. */
const OVER_HOLD_MS = 1600;

const state = (page) =>
  page.evaluate(() => ({
    phase: document.body.dataset.phase ?? null,
    panelUp: !document.getElementById("pause-panel")?.hidden,
    onPaddock: !document.getElementById("start-screen")?.hidden,
    holdProgress: document.querySelector(".quit-button__fill")?.style.transform ?? "",
    focused: document.activeElement?.id ?? null,
  }));

const run = async () => {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const results = [];
  const errors = [];

  const fresh = async (url = URL) => {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    let navigations = 0;
    page.on("load", () => {
      navigations += 1;
    });
    page.navigations = () => navigations;
    await page.goto(url, { waitUntil: "load" });
    await page.waitForTimeout(2500);
    await page.keyboard.press("Enter");
    // Wait for the race, not for a clock on the wall. Under a loaded dev server
    // Polarity can still be streaming nine seconds in, and an Escape that lands
    // before the clock runs pauses a race that has not started - the panel then
    // opens with focus on RESUME and the quit hold never begins. That is the
    // trap capture-hud.mjs already closed; this is the same wait.
    await page.waitForFunction(
      () => {
        const clock = document.getElementById("time-value")?.textContent ?? "";
        return /\d/.test(clock) && clock.trim() !== "00:00.000";
      },
      undefined,
      { timeout: 90_000 },
    );
    await page.waitForTimeout(1500);
    return { context, page };
  };

  const record = async (page, id, expectation) => {
    const observed = await state(page);
    results.push({ id, expectation, ...observed });
    console.log(id.padEnd(34), JSON.stringify(observed));
    return observed;
  };

  /* 1. Pause, the panel, the resume countdown, and racing again. ---------- */
  {
    const { context, page } = await fresh();
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(OUT, "pause-panel.png") });
    const up = await record(page, "pause/panel-up", "phase paused, panel up");
    if (up.phase !== "paused" || !up.panelUp) errors.push(`pause/panel-up: phase ${up.phase}, panelUp ${up.panelUp}`);

    // A device is live here, so this frame is also the evidence that the
    // ability slot survives the pause without recomputing from a wall clock.
    await page.keyboard.press("Enter");
    await page.waitForTimeout(600);
    await page.screenshot({ path: join(OUT, "pause-countdown.png") });
    const countdown = await record(page, "pause/countdown", "phase resuming, panel down");
    if (countdown.phase !== "resuming" || countdown.panelUp) errors.push(`pause/countdown: phase ${countdown.phase}, panelUp ${countdown.panelUp}`);

    // The countdown is 2.7 s of simulation time, not wall time: a slow frame
    // stretches it, and a fixed 2.6 s wait once recorded "resumed" while the
    // body still said `resuming`. Wait for the phase itself, and fail if the
    // race does not come back within a generous bound.
    const resumedAt = Date.now();
    await page
      .waitForFunction(() => document.body.dataset.phase === "race", undefined, { timeout: 15_000 })
      .catch(() => undefined);
    const resumed = await record(page, "pause/resumed", "phase race");
    results[results.length - 1].resumeWaitMs = Date.now() - resumedAt;
    if (resumed.phase !== "race") errors.push(`pause/resumed: phase is ${resumed.phase}, not race`);
    await context.close();
  }

  /* 2. The four cancellations. Each must leave the race paused, not quit. -- */
  const cancellations = [
    {
      id: "cancel/tab-away-mid-hold",
      note: "hold Enter on QUIT, Tab away, keep holding",
      async run(page) {
        await page.focus("#pause-quit");
        await page.keyboard.down("Enter");
        await page.waitForTimeout(400);
        // Focus moves; the key is still physically down.
        await page.keyboard.press("Tab");
        await page.waitForTimeout(OVER_HOLD_MS);
        await page.keyboard.up("Enter");
      },
    },
    {
      id: "cancel/escape-into-options",
      note: "hold Escape, open the options terminal",
      async run(page) {
        await page.keyboard.press("Escape");
        await page.waitForTimeout(120);
        await page.keyboard.down("Escape");
        await page.waitForTimeout(300);
        await page.click("#pause-options");
        await page.waitForTimeout(OVER_HOLD_MS);
        await page.keyboard.up("Escape");
      },
    },
    {
      id: "cancel/escape-not-armed",
      note: "the Escape that paused must not also quit",
      async run(page) {
        // Never released between pausing and holding.
        await page.keyboard.down("Escape");
        await page.waitForTimeout(OVER_HOLD_MS + 600);
        await page.keyboard.up("Escape");
      },
      skipPause: true,
    },
    {
      id: "cancel/pointer-release",
      note: "press QUIT with the pointer, release early",
      async run(page) {
        const box = await page.locator("#pause-quit").boundingBox();
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        await page.waitForTimeout(400);
        await page.mouse.up();
        await page.waitForTimeout(OVER_HOLD_MS);
      },
    },
  ];

  for (const testCase of cancellations) {
    const { context, page } = await fresh();
    if (!testCase.skipPause) {
      await page.keyboard.press("Escape");
      await page.waitForTimeout(400);
    }
    await testCase.run(page);
    await page.waitForTimeout(300);
    const observed = await record(page, testCase.id, `${testCase.note} — must NOT quit`);
    if (observed.onPaddock) errors.push(`${testCase.id} QUIT when it must not`);
    await context.close();
  }

  /* 3. The hold that must work. ------------------------------------------- */
  {
    const { context, page } = await fresh(QUIT_URL);
    const before = page.navigations();
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
    await page.focus("#pause-quit");
    await page.keyboard.down("Enter");
    await page.waitForTimeout(500);
    await page.screenshot({ path: join(OUT, "quit-holding.png") });
    await record(page, "quit/mid-hold", "fill is visible, still paused");
    await page.waitForTimeout(700);
    await page.keyboard.up("Enter");
    await page.waitForTimeout(3000);
    const observed = await record(page, "quit/completed", "an uninterrupted hold quits");
    const reloaded = page.navigations() > before;
    results[results.length - 1].reloaded = reloaded;
    await page.screenshot({ path: join(OUT, "quit-paddock.png") });
    if (!observed.onPaddock || !reloaded) {
      errors.push("quit/completed did NOT reach the paddock");
    }
    await context.close();
  }

  await browser.close();
  writeFileSync(
    join(OUT, "pause-quit.json"),
    `${JSON.stringify({ script: "scripts/visual/hud/pause-quit.mjs", url: URL, overHoldMs: OVER_HOLD_MS, results, errors }, null, 2)}\n`,
  );
  console.log(`\n${results.length} observations, ${errors.length} failures`);
  if (errors.length) {
    console.log(errors.join("\n"));
    process.exitCode = 1;
  }
};

await run();
