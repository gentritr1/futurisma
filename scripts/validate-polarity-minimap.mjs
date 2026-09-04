import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { transformWithOxc } from "vite";
import { buildCourseOutline, buildCourseSegment } from "../src/game/minimap-projection.js";

const routeUrl = new URL("../src/game/data/polarity/route.json", import.meta.url);
const routeText = await readFile(routeUrl, "utf8");
const route = JSON.parse(routeText);
const paceText = await readFile(new URL("../src/game/data/polarity/rival-pace.json", import.meta.url), "utf8");
const courseUrl = new URL("../src/game/polarity-course.ts", import.meta.url);
const courseSource = await readFile(courseUrl, "utf8");
const transformedCourse = await transformWithOxc(courseSource, courseUrl.pathname);
const courseCode = transformedCourse.code
  .replace('from "./polarity-rules.js"', `from ${JSON.stringify(new URL("../src/game/polarity-rules.js", import.meta.url).href)}`)
  .replace('import rivalPace from "./data/polarity/rival-pace.json";', `const rivalPace = ${paceText};`)
  .replace('from "three"', `from ${JSON.stringify(import.meta.resolve("three"))}`)
  .replace('import route from "./data/polarity/route.json";', `const route = ${routeText};`)
  .replace('from "./apron.js"', `from ${JSON.stringify(new URL("../src/game/apron.js", import.meta.url).href)}`);
const { PolarityCourse } = await import(`data:text/javascript;base64,${Buffer.from(courseCode).toString("base64")}`);
const course = new PolarityCourse();
const upperSampler = {
  length: course.length,
  createSampleScratch: () => course.createSampleScratch(),
  sample: (progress, target = course.createSampleScratch()) => course.sampleLane(progress, 1, target),
};
for (const shortcut of route.shortcuts) {
  const segment = buildCourseSegment(upperSampler, shortcut.from, shortcut.to);
  assert.equal(segment.length, 64);
  let length = 0;
  for (let i = 2; i < segment.length; i += 2) {
    length += Math.hypot(segment[i] - segment[i - 2], segment[i + 1] - segment[i - 1]);
  }
  const lowerLength = (shortcut.to - shortcut.from) * route.length;
  assert.ok(Math.abs(lowerLength - length - shortcut.savedMeters) < 1, `Expected ${shortcut.savedMeters}m, measured ${lowerLength-length}m`);
  const start = upperSampler.sample(shortcut.from).position;
  const finish = upperSampler.sample(shortcut.to).position;
  assert.deepEqual(Array.from(segment.slice(0, 2)), [start.x, start.z]);
  assert.deepEqual(Array.from(segment.slice(-2)), [finish.x, finish.z]);
}
assert.equal(course.lane, 0, "Building the upper minimap cannot flip the player.");
assert.equal(course.rivalCourse.lane, 0, "Building the upper minimap cannot flip the rivals.");
assert.throws(() => buildCourseSegment(upperSampler, .5, .2));
assert.throws(() => buildCourseSegment(upperSampler, 0, .5, 1));

// Exercise the real canvas class with a tiny drawing port. The test proves
// the paths stay cached, dashed styling is reset, and the player dot switches
// from the lower detour to the upper bypass without any new course sampling.
const draw = { arcs: [], dashes: [], strokes: 0 };
const context = {
  setTransform() {}, clearRect() {}, beginPath() {}, fill() {},
  setLineDash(value) { draw.dashes.push(value); },
  arc(x, y) { draw.arcs.push([x, y]); },
  stroke() { draw.strokes++; },
};
const previousWindow = globalThis.window;
const previousPath = globalThis.Path2D;
globalThis.window = { devicePixelRatio: 1 };
globalThis.Path2D = class { moveTo() {} lineTo() {} rect() {} };
try {
  const minimapUrl = new URL("../src/game/minimap.ts", import.meta.url);
  const source = await readFile(minimapUrl, "utf8");
  const transformed = await transformWithOxc(source, minimapUrl.pathname);
  const code = transformed.code.replace('from "./minimap-projection.js"',
    `from ${JSON.stringify(new URL("../src/game/minimap-projection.js", import.meta.url).href)}`);
  const { Minimap } = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
  const minimap = new Minimap({ style: {}, getContext: () => context }, course, false, 0);
  const initialOutline = buildCourseOutline(course);
  let queries = 0;
  course.sample = () => { queries++; throw new Error("A cached minimap must not sample during update."); };
  minimap.update(350, 0, .19, 0, 1);
  const lowerDot = draw.arcs.at(-1);
  course.lane = 1;
  minimap.update(350, 0, .19, 0, 2);
  const upperDot = draw.arcs.at(-1);
  assert.ok(Math.hypot(lowerDot[0] - upperDot[0], lowerDot[1] - upperDot[1]) > 3);
  assert.equal(queries, 0);
  assert.deepEqual(draw.dashes, [[2.5, 2], [], [2.5, 2], []]);
  assert.equal(minimap.diagnostics().minimapShortcutPaths, 2);
  assert.equal(minimap.diagnostics().minimapStations, initialOutline.stationCount);
} finally {
  globalThis.window = previousWindow;
  globalThis.Path2D = previousPath;
}
console.log("Polarity minimap PASS: both express routes retain exact junctions and measured distance savings; cached cyan dashed paths reset styling; the player dot follows its selected deck without runtime sampling or lane mutation.");
