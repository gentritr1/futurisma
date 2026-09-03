// Visual review harness (not part of the shipped game).
//
// P20.10 item 2 — resolves each chip colour to sRGB and reports the WCAG
// contrast it would give against the backgrounds the three captured events
// actually measured, WITHOUT waiting for a race to produce an event.
//
// The full harness (`shoot-event-chips.mjs`) needs a five-lap race per map to
// catch all three chips; tuning a colour against that loop costs ten minutes a
// try. This forces `data-event` on the chip directly and reads the computed
// colour back, so a candidate can be rejected in two seconds. The measured
// backgrounds below are the 12 px surrounds `chip-contrast.py` reported from
// the real frames, so the numbers here are directly comparable — but they are a
// PREDICTION, and the acceptance is still the pixel measurement off the frames.
//
// Usage: node scripts/visual/chip-colour-probe.mjs <url>
import { chromium } from "playwright";

const url = process.argv[2];

/** 12 px surrounds measured from the captured frames, per event. */
const BACKGROUNDS = {
  gust: [74, 69, 61],
  salt: [57, 69, 69],
  squall: [120, 91, 60],
  // A pale Bitterpan crust, the brightest thing this chip is ever drawn over.
  "salt (pale crust)": [170, 160, 140],
};

const luminance = ([r, g, b]) => {
  const channel = (v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
};
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(url, { waitUntil: "domcontentloaded" });

for (const event of ["gust", "salt", "squall"]) {
  const rgb = await page.evaluate((name) => {
    const chip = document.getElementById("track-event-chip");
    chip.dataset.event = name;
    chip.dataset.active = "true";
    const colour = getComputedStyle(chip).color;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = colour;
    ctx.fillRect(0, 0, 1, 1);
    return [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3);
  }, event);
  const line = Object.entries(BACKGROUNDS)
    .map(([name, bg]) => `${name} ${contrast(rgb, bg).toFixed(2)}:1`)
    .join("  ");
  console.log(`${event.padEnd(7)} rgb(${rgb.join(",")}) L=${luminance(rgb).toFixed(3)}  ${line}`);
}
await browser.close();
