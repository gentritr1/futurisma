import assert from "node:assert/strict";
import {
  phaseRunsContinuousPresentation,
  shouldRenderGameFrame,
} from "../src/game/frame-scheduling.js";

for (const phase of ["standby", "paused"]) {
  assert.equal(
    phaseRunsContinuousPresentation(phase, 0),
    false,
    `${phase} must not run simulation or presentation work while idle.`,
  );
  assert.equal(
    shouldRenderGameFrame(phase, 0, false, false),
    false,
    `${phase} must reuse its last valid canvas frame.`,
  );
  assert.equal(
    shouldRenderGameFrame(phase, 0, true, false),
    true,
    `${phase} must honor an explicit one-frame redraw.`,
  );
}

for (const phase of ["countdown", "running", "resuming"]) {
  assert.equal(
    phaseRunsContinuousPresentation(phase, 0),
    true,
    `${phase} must continue simulation and presentation work.`,
  );
  assert.equal(
    shouldRenderGameFrame(phase, 0, false, false),
    true,
    `${phase} must render continuously.`,
  );
}

assert.equal(
  phaseRunsContinuousPresentation("finished", 12),
  true,
  "The result must keep presenting while the vehicle visibly coasts.",
);
assert.equal(
  phaseRunsContinuousPresentation("finished", 0),
  false,
  "The result must idle once the vehicle has settled.",
);
assert.equal(
  shouldRenderGameFrame("finished", 0, false, false),
  false,
  "A settled result must reuse its last canvas frame.",
);
assert.equal(
  shouldRenderGameFrame("finished", 0, true, false),
  true,
  "A settled result must honor an explicit one-frame redraw.",
);

assert.equal(
  shouldRenderGameFrame("running", 20, true, true),
  false,
  "A lost WebGL context must block rendering even when a redraw was requested.",
);

console.log("Frame scheduling PASS: idle work is skipped without delaying input polling.");
