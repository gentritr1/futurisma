import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { transformWithOxc } from "vite";
import { simulateRivalField, measuredPacePlayer } from "./lib/rival-field-sim.mjs";
import { applyPaceTier } from "../src/game/race-modes-rules.js";
import { VEHICLE_CLEARANCE_METERS } from "../src/game/rival-race.js";

async function loadCourse(kind) {
  const url = new URL(`../src/game/${kind}-course.ts`, import.meta.url);
  const source = await readFile(url, "utf8");
  let code = (await transformWithOxc(source, url.pathname)).code;
  for (const [name, file] of [["route", "route"], ["rivalPace", "rival-pace"]]) {
    const json = await readFile(new URL(`../src/game/data/${kind}/${file}.json`, import.meta.url), "utf8");
    code = code.replace(`import ${name} from "./data/${kind}/${file}.json";`, `const ${name} = ${json};`);
  }
  code = code.replace('from "three"', `from ${JSON.stringify(import.meta.resolve("three"))}`)
    .replace('from "./apron.js"', `from ${JSON.stringify(new URL("../src/game/apron.js", import.meta.url).href)}`)
    .replace('from "./polarity-rules.js"', `from ${JSON.stringify(new URL("../src/game/polarity-rules.js", import.meta.url).href)}`);
  const module = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
  return {
    course: new module[kind === "polarity" ? "PolarityCourse" : "NightshiftCourse"](),
    barriers: module.POLARITY_BARRIERS ?? [],
  };
}

for (const kind of ["polarity", "nightshift"]) {
  const { course: runtime, barriers } = await loadCourse(kind);
  const scratch = runtime.createSampleScratch();
  const course = {
    kind, length: runtime.length, startProgress: runtime.startProgress,
    startLateral: runtime.startLateral,
    sample(progress) {
      const sample = runtime.sample(progress, scratch);
      return { curvature: sample.curvature, halfWidth: sample.halfWidth };
    },
    rivalHazardLaneAt: runtime.rivalHazardLaneAt?.bind(runtime),
    gridStart: identity => runtime.rivalGridStart(identity),
    boostPadLaneAt: (...args) => runtime.boostPadLaneAt(...args),
    isOnBoostPad: (distance, lateral, halfWidth) => runtime.isOnBoostPad(distance / runtime.length, lateral, halfWidth),
  };
  const bestTimes = [];
  for (const tier of ["rookie", "works", "feral"]) {
    const pace = applyPaceTier(runtime.rivalPace, tier);
    let hazardSamples = 0;
    let minimumHazardClearance = Infinity;
    const observeField = kind !== "polarity" ? undefined : field => {
      for (const state of field) {
        for (const barrier of barriers) {
          if (barrier.lane !== 0) continue;
          const gap = Math.abs(((state.courseDistanceMeters - barrier.progress * course.length
            + course.length / 2) % course.length + course.length) % course.length - course.length / 2);
          if (gap > 7 || state.finished) continue;
          const clearance = Math.abs(state.lateralMeters - barrier.lateral) - barrier.halfWidth;
          minimumHazardClearance = Math.min(minimumHazardClearance, clearance);
          hazardSamples++;
          assert.ok(clearance >= VEHICLE_CLEARANCE_METERS,
            `${kind}/${tier}/${state.id}: hull clips a phase field (${clearance.toFixed(3)} m clear).`);
        }
      }
    };
    const runs = [60, 120, 240].map(hz => simulateRivalField({
      course, pace, totalLaps: 3, renderDeltaSeconds: 1 / hz, maximumSeconds: 150,
      player: measuredPacePlayer(course.length, kind === "polarity" ? 25 : 24),
      observeField,
    }));
    const reference = runs[1];
    if (kind === "polarity") {
      assert.ok(hazardSamples > 100);
      assert.ok(minimumHazardClearance >= 2.2);
    }
    for (const run of runs) {
      assert.ok(run.minimumRivalSeparationMeters >= VEHICLE_CLEARANCE_METERS,
        `${kind}/${tier}: overlapping rivals (${run.minimumRivalSeparationMeters} m).`);
      for (let i = 0; i < run.states.length; i++) {
        const state = run.states[i];
        assert.equal(state.finishTimeSeconds, reference.states[i].finishTimeSeconds,
          `${kind}/${tier}: pace depends on frame rate.`);
        assert.deepEqual(state.lapTimesSeconds, reference.states[i].lapTimesSeconds);
        assert.ok(state.finished && Number.isFinite(state.finishTimeSeconds));
        assert.ok(state.boostSeconds > 5, "Rivals must use their authored reserve boosts.");
      }
    }
    // A player's pace may change lane contests, but it cannot drive rival speed.
    const solo = simulateRivalField({ course, pace, totalLaps: 3, player: null });
    assert.deepEqual(solo.states.map(s => s.finishTimeSeconds), reference.states.map(s => s.finishTimeSeconds));
    const times = reference.states.map(s => s.finishTimeSeconds);
    bestTimes.push(Math.min(...times));
    const hazardReport = hazardSamples ? `, phase-field hull clearance ${minimumHazardClearance.toFixed(2)} m over ${hazardSamples} samples` : "";
    console.log(`${kind}/${tier}: ${times.map(t => t.toFixed(2)).join(" / ")} s, minimum rival separation ${reference.minimumRivalSeparationMeters.toFixed(2)} m${hazardReport}.`);
  }
  assert.ok(bestTimes[0] > bestTimes[1] + 1 && bestTimes[1] > bestTimes[2] + 1,
    `${kind}: field difficulty must measurably change between tiers.`);
}
console.log("City rivals PASS: actual course curvature and authored boost windows, all three tiers deterministic at60/120/240Hz, no rival overlaps and no player-dependent pace.");
