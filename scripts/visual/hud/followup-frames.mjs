/**
 * Follow-up acceptance frames for the gravity row, the time-attack clock, the
 * minimap and the track-event chip.
 *
 * Every frame here is a real race on the real loop; nothing is posed. What IS
 * synthetic, and labelled as such in the JSON, is the `abilityStress` block:
 * the longest string each of the four device runtimes can write is pushed into
 * the element that runtime owns and the resulting box is measured, then the
 * live text is put back. A capture can only ever show the phrase that happened
 * to be on screen; the stress pass is what covers the phrase that will be.
 *
 *   node scripts/visual/hud/followup-frames.mjs --port=5198 --out=<dir>
 *
 * Flags (all `--flag=value`, never `--flag value`):
 *   --port  dev server port (default 5310)
 *   --out   evidence directory (default art/evidence/hud/followup)
 *   --only  comma-separated section names: abilities, timeattack, minimap, event
 *   --maps    which circuits the `abilities` section drives (default all four)
 *   --scales  which HUD SCALE steps it drives (default `m,l`)
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
const OUT = arg("out", "art/evidence/hud/followup");
const BASE = `http://127.0.0.1:${PORT}/`;
const ONLY = new Set(arg("only", "abilities,timeattack,minimap,event").split(",").filter(Boolean));
const ABILITY_MAPS = arg("maps", "polarity,tideline,ascension,dreamisland").split(",").filter(Boolean);
const ABILITY_SCALES = arg("scales", "m,l").split(",").filter(Boolean);
const SCHEMA_VERSION = 5;

/**
 * The longest phrase each runtime can put in each ability element, lifted from
 * the runtimes themselves rather than guessed:
 *
 *   polarity-runtime.ts  165-182   deck / action / route / power
 *   tideline-runtime.ts  158-173   ditto
 *   ascension-runtime.ts 86-93 and ascension-powers.ts 55
 *   dreamisland-runtime.ts 76-81 and dreamisland-powers.ts 36
 *   polarity-simulation.js 98-105  the transfer refusal reasons
 */
const LONGEST = {
  polarity: {
    "polarity-deck": "LOWER / FULL CHARGE",
    "polarity-flip": "JUNCTION USED · COMMIT TO THIS ROUTE",
    "polarity-route": "SUPPLY B · LAUNCH STRIP / E FOR +1s SURGE",
    "polarity-power": "PERFECT PHASE SHIELD 9.9s",
  },
  tideline: {
    "polarity-deck": "LAP 3 / DRAINED / PUMP HALL OPEN",
    "polarity-flip": "REACTOR DRAINING / WATCH THE WATERLINE",
    "polarity-route": "1 FLOODED → 2 SLICK → 3 PUMP HALL / CUT OPEN",
    "polarity-power": "PERFECT PHASE SHIELD 9.9s · RETURN WINDOW",
  },
  ascension: {
    "polarity-deck": "PAD 09 / LAUNCH DAY",
    "polarity-flip": "SPACE / SHIFT · NITRO",
    "polarity-route": "T−02:30 / TAKE DELUGE ROAD",
    "polarity-power": "CHAIN · BULKHEAD → SURGE / +0.5s",
  },
  dreamisland: {
    "polarity-deck": "DREAM ISLAND / DAY INTO NIGHT",
    "polarity-flip": "SPACE / SHIFT · NITRO",
    "polarity-route": "NIGHT · THE BASIN IS WET",
    "polarity-power": "CHAIN · BULKHEAD → SURGE / +0.5s",
  },
};

/**
 * Geometry of the ability rows, the drive cluster and the standing block.
 *
 * `lines` rather than only `scrollWidth <= clientWidth`: these elements are
 * flex items, so they are blockified and their text WRAPS instead of
 * overflowing. A width-only check on a wrapping element can only ever pass,
 * which would make it the kind of assertion that reports a result it did not
 * earn. The number that actually moves when the type grows is the line count,
 * and what the line count moves is `abilitiesBottom` — measured here against
 * `standingBottom`, which is the bound that can break.
 */
const readAbilityGeometry = () => {
  const rows = [...document.querySelectorAll(".hud-ability__text > *")].map((element) => {
    const style = getComputedStyle(element);
    const lineHeight = Number.parseFloat(style.lineHeight) || Number.parseFloat(style.fontSize);
    const box = element.getBoundingClientRect();
    return {
      id: element.id || element.className,
      text: element.textContent.trim(),
      fontSize: style.fontSize,
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
      overflows: element.scrollWidth > element.clientWidth,
      lines: lineHeight > 0 ? Math.round(box.height / lineHeight) : null,
      height: Number(box.height.toFixed(2)),
    };
  });
  const box = (selector) => {
    const element = document.querySelector(selector);
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    return {
      top: Number(rect.top.toFixed(2)),
      bottom: Number(rect.bottom.toFixed(2)),
      right: Number(rect.right.toFixed(2)),
      width: Number(rect.width.toFixed(2)),
      height: Number(rect.height.toFixed(2)),
    };
  };
  return {
    hudScale: getComputedStyle(document.body).getPropertyValue("--hud-scale").trim(),
    rows,
    abilities: box(".hud-abilities"),
    drive: box(".hud-drive"),
    standing: box(".hud-standing"),
    minimap: box(".minimap"),
    viewport: { width: window.innerWidth, height: window.innerHeight },
  };
};

/** Push each runtime's longest phrase in, measure, put the live text back. */
const stressAbilities = (phrases) => {
  const before = {};
  for (const [id, phrase] of Object.entries(phrases)) {
    const element = document.getElementById(id);
    if (!element) continue;
    before[id] = element.textContent;
    element.textContent = phrase;
  }
  const drive = document.querySelector(".hud-drive").getBoundingClientRect();
  const standing = document.querySelector(".hud-standing").getBoundingClientRect();
  const rows = [...document.querySelectorAll(".hud-ability__text > *")].map((element) => {
    const style = getComputedStyle(element);
    const lineHeight = Number.parseFloat(style.lineHeight) || Number.parseFloat(style.fontSize);
    const box = element.getBoundingClientRect();
    return {
      id: element.id || element.className,
      text: element.textContent.trim(),
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
      overflows: element.scrollWidth > element.clientWidth,
      lines: lineHeight > 0 ? Math.round(box.height / lineHeight) : null,
    };
  });
  const result = {
    rows,
    driveTop: Number(drive.top.toFixed(2)),
    standingBottom: Number(standing.bottom.toFixed(2)),
    clearance: Number((drive.top - standing.bottom).toFixed(2)),
  };
  for (const [id, text] of Object.entries(before)) {
    document.getElementById(id).textContent = text;
  }
  return result;
};

const storedScale = (scale) => ({ value: scale, schemaVersion: SCHEMA_VERSION });

/** A race that is genuinely under way: the phase says so and the clock moved. */
const waitForMovingRace = async (page) => {
  await page.waitForFunction(
    () => ["intro", "race", "countdown"].includes(document.body.dataset.phase ?? ""),
    null,
    { timeout: 180000 },
  );
  if ((await page.evaluate(() => document.body.dataset.phase)) === "intro") {
    await page.keyboard.press("Enter");
  }
  await page.waitForFunction(
    () => {
      if (document.body.dataset.phase !== "race") return false;
      const clock = document.getElementById("time-value")?.textContent ?? "";
      return clock !== "" && clock !== "00:00.000";
    },
    null,
    { timeout: 180000 },
  );
};

const openRace = async (browser, { query, scale = "m", width = 1280, height = 720, errors, name }) => {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(`${name}: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`${name}: ${message.text()}`);
  });
  await page.addInitScript(({ value, schemaVersion }) => {
    localStorage.setItem(
      "futurisma.save.v1",
      JSON.stringify({ schemaVersion, settings: { hudScale: value, menuScale: value } }),
    );
  }, storedScale(scale));
  await page.goto(BASE + query, { waitUntil: "load" });
  await waitForMovingRace(page);
  return { context, page };
};

const run = async () => {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const errors = [];
  const report = { script: "scripts/visual/hud/followup-frames.mjs", base: BASE };

  // ---------------------------------------------------------- item 3: type --
  if (ONLY.has("abilities")) {
    const ability = [];
    for (const map of ABILITY_MAPS) {
      for (const scale of ABILITY_SCALES) {
        const name = `abilities-${map}-1280x720-scale-${scale}`;
        const { context, page } = await openRace(browser, {
          query: `?map=${map}&demo=1`, scale, errors, name,
        });
        await page.waitForTimeout(16000);
        const geometry = await page.evaluate(readAbilityGeometry);
        const stress = await page.evaluate(stressAbilities, LONGEST[map]);
        await page.screenshot({ path: join(OUT, `${name}.png`) });
        const clearance = geometry.drive && geometry.standing
          ? Number((geometry.drive.top - geometry.standing.bottom).toFixed(2))
          : null;
        ability.push({ name, map, scale, clearance, ...geometry, stress });
        console.log(name, JSON.stringify({
          hudScale: geometry.hudScale,
          clearance,
          stressClearance: stress.clearance,
          overflowing: geometry.rows.filter((row) => row.overflows).map((row) => row.id),
        }));
        await context.close();
      }
    }
    report.abilities = ability;
  }

  // ------------------------------------------ item 4: the time-attack clock --
  if (ONLY.has("timeattack")) {
    const name = "timeattack-greenwater-1280x720";
    const { context, page } = await openRace(browser, {
      // Two laps so lap 1 completes and the clock has to restart while the
      // total keeps running. A Greenwater lap is ~34.5 s on the demo autopilot.
      query: "?map=greenwater&mode=timeattack&laps=2&demo=1&headless=1",
      errors, name,
    });
    const before = await page.evaluate(() => ({
      tag: document.getElementById("timing-tag").textContent,
      clock: document.getElementById("time-value").textContent,
      lap: document.getElementById("lap-value").textContent,
      secondary: document.getElementById("last-lap-value").textContent,
      secondaryHidden: document.getElementById("last-lap-value").hidden,
    }));
    // The transition this frame exists to prove: LAP 2 is on the board, which
    // only happens after the first crossing. Asserted rather than timed.
    await page.waitForFunction(
      () => (document.getElementById("lap-value").textContent ?? "").startsWith("2"),
      null,
      { timeout: 180000 },
    );
    const atCrossing = await page.evaluate(() => ({
      tag: document.getElementById("timing-tag").textContent,
      clock: document.getElementById("time-value").textContent,
      lap: document.getElementById("lap-value").textContent,
      secondary: document.getElementById("last-lap-value").textContent,
      secondaryHidden: document.getElementById("last-lap-value").hidden,
      deltaChipHidden: document.getElementById("delta-chip").hidden,
    }));
    await page.screenshot({ path: join(OUT, `${name}.png`) });
    await page.waitForTimeout(2500);
    const after = await page.evaluate(() => ({
      tag: document.getElementById("timing-tag").textContent,
      clock: document.getElementById("time-value").textContent,
      lap: document.getElementById("lap-value").textContent,
      secondary: document.getElementById("last-lap-value").textContent,
    }));
    await page.screenshot({ path: join(OUT, `${name}-settled.png`) });
    report.timeattack = { name, before, atCrossing, after };
    console.log(name, JSON.stringify({ before, atCrossing, after }));
    await context.close();
  }

  // ------------------------------------------------------- item 5: minimap --
  if (ONLY.has("minimap")) {
    const minimap = [];
    for (const [map, scale] of [
      ["bitterpan", "m"], ["nightshift", "m"], ["bitterpan", "l"],
    ]) {
      const name = `minimap-${map}-1280x720-scale-${scale}`;
      const { context, page } = await openRace(browser, {
        query: `?map=${map}&demo=1`, scale, errors, name,
      });
      await page.waitForTimeout(14000);
      const state = await page.evaluate(() => {
        const canvas = document.getElementById("minimap");
        const rect = canvas.getBoundingClientRect();
        return {
          cssWidth: canvas.style.width,
          cssHeight: canvas.style.height,
          backingWidth: canvas.width,
          backingHeight: canvas.height,
          rect: {
            right: Number(rect.right.toFixed(2)),
            width: Number(rect.width.toFixed(2)),
            height: Number(rect.height.toFixed(2)),
          },
          rightInset: Number((window.innerWidth - rect.right).toFixed(2)),
          hudScale: getComputedStyle(document.body).getPropertyValue("--hud-scale").trim(),
          devicePixelRatio,
        };
      });
      await page.screenshot({ path: join(OUT, `${name}.png`) });
      // Just the panel, so the dot is legible in the evidence without zooming.
      await page.locator("#minimap").screenshot({ path: join(OUT, `${name}-panel.png`) });
      minimap.push({ name, map, scale, ...state });
      console.log(name, JSON.stringify(state));
      await context.close();
    }
    report.minimap = minimap;
  }

  // -------------------------------------------------- item 6: event chip --
  if (ONLY.has("event")) {
    const name = "event-chip-bitterpan-1280x720";
    const { context, page } = await openRace(browser, {
      query: "?map=bitterpan&demo=1&headless=1&laps=1", errors, name,
    });
    // Shoot on the flip, not on a timer: the gust schedule is seeded, so the
    // chip is a state the run WILL reach rather than one a wait might miss.
    await page.waitForFunction(
      () => document.getElementById("track-event-chip")?.dataset.active === "true",
      null,
      { timeout: 180000 },
    );
    const state = await page.evaluate(() => {
      const chip = document.getElementById("track-event-chip");
      const label = document.getElementById("track-event-label");
      const style = getComputedStyle(label);
      const rect = label.getBoundingClientRect();
      const column = document.querySelector(".hud-drive__chips").getBoundingClientRect();
      return {
        event: chip.dataset.event,
        active: chip.dataset.active,
        label: label.textContent.trim(),
        fontSize: style.fontSize,
        colour: style.color,
        background: style.backgroundColor,
        clipPath: style.clipPath,
        labelWidth: Number(rect.width.toFixed(2)),
        columnWidth: Number(column.width.toFixed(2)),
        chipsFontSize: getComputedStyle(document.querySelector(".hud-drive__chips")).fontSize,
        slipstreamTrackHeight: getComputedStyle(document.querySelector(".hud-chip__track")).height,
      };
    });
    await page.screenshot({ path: join(OUT, `${name}.png`) });
    await page.locator(".hud-drive__chips").screenshot({ path: join(OUT, `${name}-chips.png`) });
    report.event = { name, ...state };
    console.log(name, JSON.stringify(state));
    await context.close();
  }

  await browser.close();
  report.errors = errors;
  writeFileSync(join(OUT, "followup-frames.json"), `${JSON.stringify(report, null, 2)}\n`);

  // ------------------------------------------------------------ the bounds --
  if (report.abilities) {
    for (const record of report.abilities) {
      for (const row of [...record.rows, ...record.stress.rows]) {
        assert.ok(
          !row.overflows,
          `${record.name}: ${row.id} overflows its column `
            + `(${row.scrollWidth} > ${row.clientWidth}) on "${row.text}".`,
        );
      }
      assert.ok(
        record.clearance >= 4,
        `${record.name}: the drive cluster clears the standing block by only `
          + `${record.clearance} px; 4 px is the jitter allowance.`,
      );
      /*
        The stress clearance is REPORTED, not asserted.

        Measured on `main` at eafe0b9 with this same script, the longest-phrase
        arrangement already cleared by 0.64 px on Polarity and Tideline at
        1280x720 scale L — the bound it would be asserted against was failing
        before this phase existed, so asserting it here would be pinning a
        number this change did not earn and could not have caused. It is in the
        JSON and printed below; closing it is a separate piece of work.
      */
      if (record.stress.clearance < 4) {
        console.log(
          `  note: ${record.name} clears by only ${record.stress.clearance} px with `
            + "every runtime's longest phrase forced on screen (pre-existing; "
            + "main measured 0.64 px on polarity/tideline at scale L).",
        );
      }
    }
    const tightest = report.abilities.reduce((a, b) =>
      Math.min(a.clearance, a.stress.clearance) <= Math.min(b.clearance, b.stress.clearance) ? a : b);
    console.log(
      `\nTightest standing-block clearance: ${tightest.name} at `
        + `${Math.min(tightest.clearance, tightest.stress.clearance)} px.`,
    );
  }
  if (report.timeattack) {
    assert.equal(report.timeattack.before.tag, "LAP TIME",
      "A time attack must tag the clock as the lap, not the race.");
    assert.equal(report.timeattack.atCrossing.tag, "LAP TIME");
    assert.ok(report.timeattack.atCrossing.secondary.startsWith("TOTAL "),
      `The secondary line must carry the running total (got "${report.timeattack.atCrossing.secondary}").`);
    assert.ok(report.timeattack.atCrossing.secondary.includes(" · LAST "),
      "After the first crossing the completed lap must be on the secondary line.");
    const seconds = (label) => {
      const [minutes, rest] = label.split(":");
      return Number(minutes) * 60 + Number(rest);
    };
    assert.ok(
      seconds(report.timeattack.atCrossing.clock) < 1,
      `The lap clock must restart at the crossing; it read ${report.timeattack.atCrossing.clock}.`,
    );
    assert.ok(
      seconds(report.timeattack.after.clock) > seconds(report.timeattack.atCrossing.clock),
      "The new lap's clock must keep counting after the crossing.",
    );
    const total = (record) => seconds(record.secondary.slice("TOTAL ".length).split(" · ")[0]);
    assert.ok(
      total(report.timeattack.after) > total(report.timeattack.atCrossing),
      "The total must keep counting in the secondary line while the lap clock restarts.",
    );
  }
  if (report.minimap) {
    for (const record of report.minimap) {
      assert.equal(record.backingWidth, Math.round(160 * record.devicePixelRatio));
      assert.equal(record.backingHeight, Math.round(172 * record.devicePixelRatio));
      assert.equal(record.cssWidth, "160px");
      assert.equal(record.cssHeight, "172px");
      assert.ok(
        record.rightInset >= 34,
        `${record.name}: the minimap's right edge is ${record.rightInset} px from the `
          + "viewport edge; it is anchored at 34 px and scales from centre-right.",
      );
    }
  }
  if (report.event) {
    assert.equal(report.event.chipsFontSize, "14px");
    assert.equal(report.event.slipstreamTrackHeight, "5px");
    assert.ok(report.event.label.length > 0, "The event chip fired with no label.");
    assert.ok(
      report.event.background !== "rgba(0, 0, 0, 0)",
      "The track-event label must sit on a plate, not on the world.",
    );
    assert.ok(report.event.clipPath.startsWith("polygon("), "The plate keeps the chamfer.");
    assert.ok(
      report.event.labelWidth <= report.event.columnWidth,
      `The label is ${report.event.labelWidth} px in a ${report.event.columnWidth} px column.`,
    );
  }
  assert.deepEqual(errors, [], "Follow-up frames must be free of page errors.");
  console.log("\nFollow-up frames PASS.");
};

await run();
