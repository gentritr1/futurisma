// Folds final.log (two interleaved cold rounds per build) into a per-circuit before/after table.
import { readFileSync, writeFileSync } from "node:fs";
const rows = readFileSync(process.argv[2], "utf8").split("\n").filter((l) => l.startsWith("{")).map((l) => JSON.parse(l));
const pick = (map, build) => rows.filter((r) => r.map === map && r.label.startsWith(build));
const both = (list, f) => list.map(f);
const out = {};
for (const map of ["greenwater", "frostline", "nightshift", "dreamisland"]) {
  out[map] = {};
  for (const build of ["base", "new"]) {
    const l = pick(map, build);
    out[map][build] = {
      rounds: l.length,
      menuVisibleMs: both(l, (r) => r.menu?.visible),
      menuStraddleFrameMs: both(l, (r) => r.menu?.straddle),
      menuStallsAfterVisibleMaxMs: both(l, (r) => r.menu?.stallsMax),
      menuStallsOver50: both(l, (r) => r.menu?.stallsOver50),
      menuFramesIn5s: both(l, (r) => r.menu?.frames),
      raceClockColdMs: both(l, (r) => r.cold?.clock),
      raceClockWarmMs: both(l, (r) => r.warm?.clock),
      countdownMaxColdMs: both(l, (r) => r.cold?.countdownMax),
      window20sFramesVsExpected: both(l, (r) => r.cold?.win),
      worstFrame20sColdMs: both(l, (r) => r.cold?.max),
      worstFrame20sWarmMs: both(l, (r) => r.warm?.max),
      midRaceProgramsCold: both(l, (r) => r.cold?.progs),
      midRaceProgramsWarm: both(l, (r) => r.warm?.progs),
      rendererProgramsAtClockAndEnd: both(l, (r) => r.cold?.diag),
      warmupMsMenuColdDriveWarm: both(l, (r) => [r.menu?.warmupMs, r.cold?.warmupMs, r.warm?.warmupMs]),
    };
  }
}
writeFileSync(process.argv[3], JSON.stringify(out, null, 1));
for (const [map, v] of Object.entries(out)) {
  console.log(map);
  for (const [k] of Object.entries(v.base)) if (k !== "rounds") console.log(`  ${k}: base ${JSON.stringify(v.base[k])} | new ${JSON.stringify(v.new[k])}`);
}
