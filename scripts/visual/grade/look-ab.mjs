/**
 * Capture the HUD-free world at fixed stations and measure how it looks.
 *
 * Usage: node scripts/visual/grade/look-ab.mjs --out=DIR [--port=5200] [--label=after]
 *
 * Reuses `ascension-review.html`, the same fixture `scripts/visual/ascension/stations.mjs`
 * uses, so these frames carry no HUD and no race state - only the world. It shoots the
 * same eight route stations in both the pre-launch and launch states, then hands every
 * PNG to scripts/visual/grade/measure-frames.py.
 *
 * The point is the DELTA. Run it once before a look change and once after, with the same
 * stations and the same measuring script, and diff the two capture.json files. A single
 * run proves nothing about whether a change helped.
 */
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { chromium } from "playwright";

const run = promisify(execFile);
const arg = (name, fallback) => {
  const hit = process.argv.find((v) => v.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const PORT = Number(arg("port", "5200"));
const OUT = arg("out", null);
const LABEL = arg("label", "run");
if (!OUT) throw new Error("--out=DIR is required (scripts here take --flag=value only)");

// Same source of truth stations.mjs uses, so the two harnesses cannot drift apart.
const route = JSON.parse(await readFile("src/game/data/ascension/route.json", "utf8"));
const schedule = JSON.parse(await readFile("src/game/data/ascension/schedule.json", "utf8"));

const main = async () => {
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));

  // The eight district mid-points plus the trench, matching stations.mjs.
  const districts = route.districts ?? [];
  const stations = districts.map((d, i) => ({
    id: d.id,
    progress: (d.from + (districts[i + 1]?.from ?? 1)) / 2,
  }));
  if (route.shortcut) {
    stations.push({ id: "TRENCH", progress: (route.shortcut.from + route.shortcut.to) / 2, trench: true });
  }
  if (!stations.length) throw new Error("no stations resolved from the route");

  const files = [];
  for (const [phase, tick] of [["base", 0], ["launch", schedule.launchTick + 120]]) {
    for (const s of stations) {
      const url = `http://127.0.0.1:${PORT}/ascension-review.html?progress=${s.progress}&tick=${tick}${s.trench ? "&trench=1" : ""}`;
      await page.goto(url, { waitUntil: "networkidle" });
      // The fixture's state node is a visually hidden <output>. Playwright waits
      // for visibility by default, which never comes; Puppeteer's default was
      // "attached", which is what stations.mjs relied on.
      await page.waitForSelector("#review-state", { state: "attached", timeout: 60_000 });
      await page.waitForFunction(
        () => { try { return !!JSON.parse(document.getElementById("review-state").textContent); } catch { return false; } },
        undefined, { timeout: 60_000 },
      );
      const file = `${phase}-${s.id}.png`;
      await page.screenshot({ path: `${OUT}/${file}` });
      files.push(`${OUT}/${file}`);
    }
  }
  await browser.close();

  // Measure with the SAME script the baseline used. No second implementation.
  const { stdout } = await run("python3", [
    "scripts/visual/grade/measure-frames.py", "--full",
    "--json", `${OUT}/measurements.json`, ...files,
  ]);
  console.log(stdout);

  const rows = JSON.parse(await readFile(`${OUT}/measurements.json`, "utf8"));
  const mean = (k) => Number((rows.reduce((n, r) => n + r[k], 0) / rows.length).toFixed(2));
  const summary = {
    label: LABEL, frames: rows.length, pageErrors: errors,
    chromaMean: mean("chromaMean"), lumaMean: mean("lumaMean"), lumaStd: mean("lumaStd"),
    p99: mean("p99"), whitePct: mean("whitePct"), blackPct: mean("blackPct"),
    framesWithNoHighlight: rows.filter((r) => r.whitePct === 0).length,
  };
  await writeFile(`${OUT}/capture.json`, `${JSON.stringify({ script: "scripts/visual/grade/look-ab.mjs", summary, rows }, null, 2)}\n`);
  console.log(JSON.stringify(summary, null, 2));

  // Diff against the recorded baseline when one is present.
  const BASE = "art/evidence/look/baseline/capture.json";
  if (existsSync(BASE) && !OUT.includes("baseline")) {
    const base = JSON.parse(await readFile(BASE, "utf8")).summary;
    console.log("\ndelta vs baseline");
    for (const k of ["chromaMean", "lumaMean", "lumaStd", "p99", "whitePct"]) {
      const d = Number((summary[k] - base[k]).toFixed(2));
      console.log(`  ${k.padEnd(12)} ${String(base[k]).padStart(8)} -> ${String(summary[k]).padStart(8)}  ${d >= 0 ? "+" : ""}${d}`);
    }
    console.log(`  frames with NO highlight at all: ${base.framesWithNoHighlight} -> ${summary.framesWithNoHighlight} (of ${summary.frames})`);
  }
  if (errors.length) { console.log(`\n${errors.length} page errors`); process.exitCode = 1; }
};
await main();
