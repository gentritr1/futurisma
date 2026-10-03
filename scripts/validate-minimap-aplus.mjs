import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { transformWithOxc } from "vite";
import { aplusGates, aplusGateState, AplusRivalFocus } from "../src/game/minimap-aplus-rules.js";
import { buildCourseOutline } from "../src/game/minimap-projection.js";

// The finish gate is index zero, in addition to every authored sector gate.
for (const map of ["nightshift", "polarity", "tideline", "ascension", "dreamisland"]) {
  const route = JSON.parse(readFileSync(new URL(`../src/game/data/${map}/route.json`, import.meta.url)));
  const gates = aplusGates({ orderedCheckpointCount: route.checkpoints.length, checkpointProgress: i => route.checkpoints[i] });
  assert.deepEqual(gates, route.checkpoints, `${map}: retain the final gate`);
  const last = gates.length - 1;
  assert.deepEqual(aplusGateState(`GATE ${last} CLEAR`, gates.length), {next: 0, sector: gates.length, missed: false});
}
const greenwater = JSON.parse(readFileSync(new URL("../src/game/data/greenwater-blockout.json", import.meta.url)));
const greenwaterGates = aplusGates({ orderedCheckpointCount: greenwater.checkpoints.length + 1,
  checkpointProgress: i => i === 0 ? 0 : greenwater.checkpoints[i - 1].distance / greenwater.centreline.lapLength });
assert.equal(greenwaterGates.length, 9);
assert.deepEqual(aplusGateState("GATE 04 MISSED · RECOVER", 9), {next: 4, sector: null, missed: true});
assert.deepEqual(aplusGateState("FINISH MISSED · RECOVER", 9), {next: 0, sector: null, missed: true});
assert.deepEqual(aplusGateState("NEXT GATE 08 / 08", 9), {next: 8, sector: null, missed: false});

const focus = new AplusRivalFocus();
assert.equal(focus.update([8, 3, 3000], [8, 3, 3000], 0), 1, "only the nearest rival earns a label");
assert.equal(focus.update([-2, 1, 3000], [2, 1, 3000], .1), 0, "the just-passed rival takes priority");
assert.equal(focus.update([-4, .5, 3000], [4, .5, 3000], .9), 0, "hold the pass label without flickering");
assert.equal(focus.update([-4, .5, 3000], [4, .5, 3000], 1.01), 1, "return to nearest after the hold");
assert.equal(focus.update([-30, 30, 3000], [30, 30, 3000], 2), -1, "no label outside 25 m or for a lapped rival");
focus.reset();
assert.equal(focus.update([-2, .5], [2, .5], 3), 1, "reset cannot invent a pass");

// Exercise the real renderer with a recording canvas and the existing HUD
// contract. This checks its event lifetime, drawing labels and cached geometry.
class Element {
  dataset = {}; textContent = ""; hidden = false; children = []; clientWidth = 180; clientHeight = 210;
  style = { removeProperty() {}, setProperty() {} };
  append(...children) { this.children.push(...children); }
  setAttribute() {} remove() {}
  closest() { return hud; }
  querySelector() { return left; }
}
const hud = new Element(), left = new Element(), gateStrip = new Element(), checkpoint = new Element();
const draws = { labels: [] };
const context = new Proxy({ measureText: text => ({width: text.length * 7}),
  fillText: text => draws.labels.push(text) }, {get: (target, key) => target[key] ?? (() => {})});
const canvas = new Element(); canvas.getContext = () => context;
const timers = new Map(); let nextTimer = 0;
const original = new Map(["document", "window", "Path2D", "ResizeObserver"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
Object.assign(globalThis, {
  document: { body: {dataset: {phase: "race"}}, head: new Element(), createElement: () => new Element(),
    getElementById: () => checkpoint, querySelector: () => gateStrip },
  window: { devicePixelRatio: 1, setTimeout: (fn, ms) => { timers.set(++nextTimer, {fn, ms}); return nextTimer; },
    clearTimeout: id => timers.delete(id) },
  Path2D: class { moveTo() {} lineTo() {} addPath() {} },
  ResizeObserver: class { observe() {} disconnect() {} },
});
try {
  const url = new URL("../src/game/minimap-aplus.ts", import.meta.url);
  let {code} = await transformWithOxc(readFileSync(url, "utf8"), url.pathname);
  code = code.replace('import { save } from "./persistence";', 'const save = {livery: "works"};');
  code = code.replace('new URL("./minimap-aplus.css", import.meta.url).href', '"/minimap-aplus.css"');
  for (const file of ["minimap-projection.js", "minimap-aplus-rules.js", "rival-race.js", "liveries.js"]) {
    code = code.replace(`from "./${file}"`, `from "${new URL("../src/game/" + file, import.meta.url).href}"`);
  }
  const {installAplusMinimap} = await import("data:text/javascript;base64," + Buffer.from(code).toString("base64"));
  const nightshift = JSON.parse(readFileSync(new URL("../src/game/data/nightshift/route.json", import.meta.url)));
  const course = { kind: "nightshift", startProgress: .002, length: 2000, mapName: "Test", orderedCheckpointCount: 8,
    checkpointProgress: i => nightshift.checkpoints[i],
    sectorLabelAt: p => nightshift.districts.findLast(district => p >= district.from).name,
    sample: p => ({position: {x: Math.cos(p * Math.PI * 2) * 100, z: Math.sin(p * Math.PI * 2) * 100}}) };
  const outline = buildCourseOutline(course);
  course.sample = () => { throw new Error("A+ must not sample the course during a drawing update"); };
  const minimap = {contacts: [{raceDistanceMeters: 205, lateralMeters: 0}]};
  installAplusMinimap(minimap, {canvas, course, outline, upperOutline: null, shortcutPoints: [], reducedMotion: true});
  checkpoint.textContent = "NEXT GATE 01 / 07";
  minimap.update(200, 0, .102, 1, 0);
  assert.equal(minimap.diagnostics().minimapNearestRivalMeters, 1, "player start offset matches the rival distance frame");
  assert.equal(minimap.diagnostics().minimapAnimated, false);
  assert.equal(canvas.dataset.rivalLabels, "1");
  assert.equal(hud.dataset.motion, "reduce");
  assert.equal(gateStrip.dataset.announcing, "false");
  checkpoint.textContent = "GATE 07 CLEAR";
  minimap.update(250, 0, .13, 1, .1);
  const plate = left.children[0];
  assert.equal(plate.children[0].textContent, "S8/8");
  assert.equal(plate.children[1].textContent, "LAST EXIT");
  assert.equal(gateStrip.dataset.announcing, "true");
  assert.equal(timers.size, 1);
  assert.equal([...timers.values()][0].ms, 900);
  minimap.update(251, 0, .131, 1, .2);
  assert.equal(nextTimer, 1, "a held clear verdict must not restart the announcement");
  [...timers.values()][0].fn();
  assert.equal(plate.hidden, true, "timer clears even with no animation frames");
  checkpoint.textContent = "GATE 03 CLEAR";
  minimap.update(254, 0, .3599, 1, .25);
  assert.equal(plate.children[1].textContent, "NORTH TENEMENTS", "gate at .36 names the entered district even before the craft centre crosses it");
  checkpoint.textContent = "GATE 04 MISSED · RECOVER";
  minimap.update(255, 0, .132, 1, .3);
  assert.equal(gateStrip.dataset.announcing, "false");
  assert.equal(canvas.dataset.nextGate, "4");
  checkpoint.textContent = "GATE 04 CLEAR";
  minimap.update(256, 0, .133, 1, .4);
  assert.equal(plate.hidden, false);
  document.body.dataset.phase = "paused";
  minimap.update(256, 0, .133, 1, .5);
  assert.equal(plate.hidden, true);
  document.body.dataset.phase = "race";
  minimap.update(0, 0, .002, 0, .6);
  assert.equal(canvas.dataset.rivalLabels, "0");
  assert.equal(plate.hidden, true, "restart cannot replay the old gate");
} finally {
  for (const [key, descriptor] of original) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete globalThis[key];
  }
}
console.log("A+ PASS: authored final gates, correct rival frame, one rival label, missed gates, 900 ms cleanup without rAF, reduced motion, pause/restart, cached drawing.");
