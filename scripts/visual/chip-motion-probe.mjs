// Visual review harness (not part of the shipped game).
//
// P20.10 item 2 — "reduced motion: no fade, instant", checked against all three
// of the sources `resolveReducedMotion()` composes rather than only the one the
// stylesheet's media query can see.
//
// `@media (prefers-reduced-motion: reduce)` catches the operating system.
// `?motion=reduce` and the stored setting are the other two, and they reach CSS
// only through the `data-reduced-motion` attribute `ui.ts` stamps on the chip.
// This asserts the resolved `transition-duration` in each case, in the chip's
// LIT state — the base rule and the `[data-active="true"]` override are
// different durations, so checking the idle chip would pass on a broken build.
//
// Usage: node scripts/visual/chip-motion-probe.mjs <baseUrl>
import { chromium } from "playwright";

const base = process.argv[2] ?? "http://127.0.0.1:5215";

const cases = [
  ["default", `${base}/?map=bitterpan&diagnostics=1`, null, "1s"],
  ["?motion=reduce", `${base}/?map=bitterpan&diagnostics=1&motion=reduce`, null, "0s"],
  ["OS prefers-reduced-motion", `${base}/?map=bitterpan&diagnostics=1`, "reduce", "0s"],
];

const browser = await chromium.launch();
let failures = 0;
for (const [name, url, emulate, expected] of cases) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    reducedMotion: emulate ?? "no-preference",
  });
  const page = await context.newPage();
  await page.goto(url, { waitUntil: "domcontentloaded" });
  const measured = await page.evaluate(() => {
    const chip = document.getElementById("track-event-chip");
    chip.dataset.event = "gust";
    chip.dataset.active = "true";
    const style = getComputedStyle(chip);
    return {
      inDuration: style.transitionDuration,
      flag: chip.dataset.reducedMotion,
      // ...and the OUT direction, which is the base rule.
      outDuration: (() => {
        chip.dataset.active = "false";
        chip.dataset.event = "";
        return getComputedStyle(chip).transitionDuration;
      })(),
    };
  });
  const ok = measured.inDuration === expected;
  if (!ok) failures += 1;
  console.log(
    `${name.padEnd(26)} data-reduced-motion=${measured.flag} `
    + `fade-in ${measured.inDuration} (expected ${expected}) `
    + `fade-out ${measured.outDuration}  ${ok ? "PASS" : "FAIL"}`,
  );
  await context.close();
}
await browser.close();
process.exit(failures > 0 ? 1 : 0);
