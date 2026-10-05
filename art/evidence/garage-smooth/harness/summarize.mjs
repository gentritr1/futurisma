// Usage: node summarize.mjs <actions-*.json>...
// Worst frame (ms) per action family, links (program builds) and programs per
// round, from garage-actions.mjs output. Frame counts are reconciled against
// the window: `frames/expected` is printed for every family.
import { readFileSync } from "node:fs";
const families = [
  ["open", (n) => n === "open garage"],
  ["first UPGRADE tab", (n) => n === "r1 tab-parts"],
  ["first part (engine)", (n) => n === "r1 part-engine"],
  ["other parts, first", (n) => /^r1 switch-/.test(n)],
  ["first PAINT tab + slots", (n) => /^r1 (tab-paint|slot-)/.test(n)],
  ["first LIGHTS hover", (n) => /^r1 hover paint-glow/.test(n)],
  ["first underglow hover", (n) => /^r1 hover paint-under/.test(n)],
  ["first body-paint hover", (n) => /^r1 hover body-/.test(n)],
  ["first TEST / JOBS / DAILY", (n) => /^r1 (tab-test|jobs|daily)$/.test(n)],
  ["first FLEET tab", (n) => n === "r1 tab-craft"],
  ["first LANCE", (n) => n === "r1 frame-lance"],
  ["first CORONA", (n) => n === "r1 frame-corona"],
  ["rounds 2-3 (repeat switches)", (n) => /^r[23] /.test(n)],
  ["close", (n) => n === "close garage"],
];
for (const file of process.argv.slice(2)) {
  for (const run of JSON.parse(readFileSync(file, "utf8"))) {
    if (run.error) { console.log(file, "ERROR", run.error); continue; }
    console.log(`\n${file} [${run.pass}] menu: worst ${run.menu.max.toFixed(1)} ms, long tasks ${JSON.stringify(run.menu.longtasks)}, warm-up done ${run.menu.warmMs ?? "-"} ms after the menu appeared`);
    for (const [label, match] of families) {
      const acts = run.actions.filter((a) => match(a.name));
      if (!acts.length) continue;
      const worst = Math.max(...acts.map((a) => a.frameMs.max));
      const frames = acts.reduce((s, a) => s + a.frames, 0), expected = acts.reduce((s, a) => s + a.expected, 0);
      const links = acts.reduce((s, a) => s + a.links, 0);
      console.log(`  ${label.padEnd(30)} worst ${worst.toFixed(1).padStart(7)} ms  links ${String(links).padStart(3)}  frames ${frames}/${expected}  (${acts.length} action${acts.length > 1 ? "s" : ""})`);
    }
    const late = run.actions.filter((a) => /^r[23] /.test(a.name)).reduce((s, a) => s + a.links, 0);
    console.log(`  programs after rounds 1/2/3: ${run.rounds.join("/")}; links in rounds 2-3: ${late}; actions ${run.actions.length}; errors ${run.errors?.length ?? 0}`);
  }
}
