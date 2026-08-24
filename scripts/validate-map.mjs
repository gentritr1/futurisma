import { readFileSync } from "node:fs";

const blockout = JSON.parse(
  readFileSync(new URL("../src/game/data/greenwater-blockout.json", import.meta.url), "utf8"),
);
const validation = JSON.parse(
  readFileSync(new URL("../src/game/data/greenwater-validation.json", import.meta.url), "utf8"),
);

function assert(condition, message) {
  if (!condition) throw new Error(`Greenwater validation failed: ${message}`);
}

const samples = blockout.centreline.samples;
assert(blockout.format === "FUTURISMA_MAP_BLOCKOUT", "unexpected format");
assert(blockout.centreline.closed === true, "centreline must be closed");
assert(samples.length === blockout.centreline.sampleCount, "sample count mismatch");
assert(blockout.checkpoints.length === 8, "eight checkpoints are required");
for (const checkpoint of blockout.checkpoints) {
  assert(checkpoint.gateWidth > 0, `${checkpoint.id} must have a positive gate width`);
}
assert(blockout.race.lapCountConfigurable === true, "lap count must remain configurable");
assert(blockout.race.lapCount >= 1 && blockout.race.lapCount <= 9, "default lap count is invalid");
assert(validation.overall === "PASS", "source validation is not PASS");
assert(
  Math.abs(validation.centrelineLength.value - blockout.centreline.lapLength) < 0.001,
  "validation and runtime lap lengths differ",
);

const numericFields = ["d", "x", "y", "z", "hdg", "w", "bank"];
for (let index = 0; index < samples.length; index += 1) {
  const sample = samples[index];
  for (const field of numericFields) {
    assert(Number.isFinite(sample[field]), `sample ${index} has invalid ${field}`);
  }
  assert(sample.w >= 19 && sample.w <= 24, `sample ${index} width is outside 19-24 m`);
  assert(["A", "B", "C"].includes(sample.edgeL), `sample ${index} left edge is invalid`);
  assert(["A", "B", "C"].includes(sample.edgeR), `sample ${index} right edge is invalid`);
  if (index > 0) assert(sample.d > samples[index - 1].d, `sample ${index} is not ordered`);
}

for (let index = 1; index < blockout.checkpoints.length; index += 1) {
  assert(
    blockout.checkpoints[index].distance > blockout.checkpoints[index - 1].distance,
    `checkpoint ${index + 1} is out of order`,
  );
}

for (const trigger of blockout.music.triggers) {
  for (const stem of ["trance", "jungle", "deep_dnb", "techstep"]) {
    assert(
      Number.isInteger(trigger.levels[stem])
        && trigger.levels[stem] >= 0
        && trigger.levels[stem] <= 3,
      `${trigger.sector} has an invalid ${stem} level`,
    );
  }
}

const finalSample = samples.at(-1);
const closureSegment = Math.hypot(
  finalSample.x - samples[0].x,
  finalSample.y - samples[0].y,
  finalSample.z - samples[0].z,
);
assert(closureSegment < 2.01, "final sample does not close to the start");

console.log(
  `Greenwater PASS: ${samples.length} samples, ${blockout.centreline.lapLength.toFixed(3)} m, ${blockout.checkpoints.length} gates, ${blockout.music.triggers.length} music states.`,
);
