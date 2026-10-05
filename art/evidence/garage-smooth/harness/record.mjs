// Usage: node --experimental-websocket record.mjs <base> <out.mp4>
// Cold profile (fresh Chrome --user-data-dir). Records the page with CDP
// Page.startScreencast while a human-paced garage tour plays: open, PAINT,
// UPGRADE, a part, FLEET, LANCE. Frames keep their real timestamps (an ffconcat
// list with per-frame durations), so a stalled frame shows as a held frame.
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { launchChrome, newPage, closePage, RECORDER, OUT, sleep } from "./cdp.mjs";

const [base = "http://localhost:5196", out = `${OUT}/garage.mp4`] = process.argv.slice(2);
const dir = `${out}.frames`;
rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
const { close } = await launchChrome();
const frames = [];
try {
  const page = await newPage(); await page.ready;
  await page.send("Page.enable"); await page.send("Runtime.enable");
  await page.send("Page.addScriptToEvaluateOnNewDocument", { source: RECORDER });
  await page.send("Page.navigate", { url: `${base}/?map=frostline` });
  await page.waitFor(`document.body.dataset.phase === 'intro'`, 120000, "intro");
  await page.waitFor(`(() => { const f = window.__perf.frames; return f.length > 200 && performance.now() > 6000 && f.slice(-120).every(x => x[1] < 40); })()`, 30000, "menu settled");
  // The warm-up, where the build has one (the screen exists before the first open).
  if (await page.eval(`!!document.getElementById('garage-screen')`)) await page.waitFor(`document.getElementById('garage-screen').dataset.warm === 'true'`, 30000, "warm");
  page.on("Page.screencastFrame", (p) => {
    frames.push({ t: p.metadata.timestamp, data: p.data });
    void page.send("Page.screencastFrameAck", { sessionId: p.sessionId }).catch(() => undefined);
  });
  await page.send("Page.startScreencast", { format: "jpeg", quality: 85, maxWidth: 1280, maxHeight: 720, everyNthFrame: 1 });
  await sleep(800);
  const click = (js) => page.eval(`(() => { ${js}; return true; })()`);
  const key = (k) => `document.querySelector('#garage-screen [data-key="${k}"]').click()`;
  await click(`document.getElementById('garage-button').click()`);
  await page.waitFor(`document.getElementById('garage-screen')?.dataset.modelReady === 'true'`, 20000, "open");
  await sleep(2200);
  for (const [step, wait] of [["tab-paint", 2000], ["tab-parts", 1800], ["part-engine", 2200], ["tab-craft", 2000], ["frame-lance", 2600]]) {
    await click(key(step));
    await sleep(wait);
  }
  await page.send("Page.stopScreencast");
  await closePage(page.id);
} finally { await close(); }
// Real timing: each frame lasts until the next one arrived.
let list = "ffconcat version 1.0\n";
frames.forEach((f, i) => {
  const name = `${String(i).padStart(5, "0")}.jpg`;
  writeFileSync(`${dir}/${name}`, Buffer.from(f.data, "base64"));
  const next = frames[i + 1]?.t ?? f.t + 1 / 60;
  list += `file '${name}'\nduration ${Math.max(0.001, next - f.t).toFixed(4)}\n`;
});
list += `file '${String(frames.length - 1).padStart(5, "0")}.jpg'\n`;
writeFileSync(`${dir}/list.ffconcat`, list);
const span = frames.at(-1).t - frames[0].t;
const gaps = frames.slice(1).map((f, i) => f.t - frames[i].t);
console.log(`frames ${frames.length} over ${span.toFixed(2)} s (${(frames.length / span).toFixed(1)} fps captured; 60 Hz would be ${Math.round(span * 60)}), longest gap ${(Math.max(...gaps) * 1000).toFixed(0)} ms`);
execFileSync(process.env.FFMPEG ?? "/opt/homebrew/bin/ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", `${dir}/list.ffconcat`,
  "-vf", "fps=60,scale=1280:720:flags=bicubic,format=yuv420p", "-c:v", "libx264", "-preset", "slow", "-crf", "30", "-movflags", "+faststart", out]);
rmSync(dir, { recursive: true, force: true });
console.log("wrote", out);
