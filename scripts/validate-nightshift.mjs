import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { transformWithOxc } from "vite";
import { parseGlb } from "./lib/greenwater-package-validator.mjs";
import { createSaveStore } from "../src/game/save-schema.js";
import { buildTrackEventSchedule } from "../src/game/track-events-rules.js";
import { skyZonesFor, cloudProfileFor, bandStrengthFor } from "../src/game/sky-profile.js";

const courseUrl = new URL("../src/game/nightshift-course.ts", import.meta.url);
const routeText = await readFile(new URL("../src/game/data/nightshift/route.json", import.meta.url), "utf8");
const route = JSON.parse(routeText);
const paceText = await readFile(new URL("../src/game/data/nightshift/rival-pace.json", import.meta.url), "utf8");
const assets = new URL("../public/assets/nightshift/", import.meta.url);
const bytes = await readFile(new URL("nightshift_city.glb", assets));
const { json } = parseGlb(bytes, "Night Shift city");
const manifest = JSON.parse(await readFile(new URL("manifest.json", assets), "utf8"));
const lamps = JSON.parse(await readFile(new URL("lights.json", assets), "utf8"));

assert.equal(route.count, route.stations.length);
assert.ok(route.length > 1900 && route.length < 2050);
assert.equal(route.checkpoints[0], 0);
assert.equal(route.districts.length, 6);
for (let i = 0; i < route.checkpoints.length; i++) {
  const next = route.checkpoints[i + 1] ?? 1;
  assert.ok(next > route.checkpoints[i]);
  assert.ok((next - route.checkpoints[i]) * route.length < 280, "Gates must stay close enough to guide the player.");
}
for (let i = 0; i < route.count; i++) {
  const s = route.stations[i];
  const next = route.stations[(i + 1) % route.count];
  assert.ok([...s.p, ...s.t, s.curvature, s.d, s.width].every(Number.isFinite));
  assert.ok(Math.abs(Math.hypot(...s.t) - 1) < 1e-6);
  assert.ok(Math.hypot(...s.p.map((value, axis) => value - next.p[axis])) < 3.05, "The street must join continuously, including the finish seam.");
  assert.ok(Math.abs(s.t[1]) < .08, "Road grades must be comfortable at racing speed.");
  assert.ok(Math.abs(s.curvature) * s.width / 2 < .4, "Inside road edges must not fold through a corner.");
  assert.ok(s.width >= 23 && s.width <= 26);
  // Ignore neighbouring stations; unrelated route sections must remain separated.
  for (let j = i + 35; j < route.count; j += 5) {
    if (route.count - j + i < 35) continue;
    const other = route.stations[j];
    assert.ok(Math.hypot(s.p[0] - other.p[0], s.p[2] - other.p[2]) > 35,
      `Unrelated streets overlap near station ${i}/${j}.`);
  }
}

// Execute the actual course implementation through the same TS transformer as Vite.
// Only its runtime imports are resolved here, so this needs no DOM or WebGL context.
const source = await readFile(courseUrl, "utf8");
const transformed = await transformWithOxc(source, courseUrl.pathname);
const executable = transformed.code
  .replace('import rivalPace from "./data/nightshift/rival-pace.json";', `const rivalPace = ${paceText};`)
  .replace('from "three"', `from ${JSON.stringify(import.meta.resolve("three"))}`)
  .replace('import route from "./data/nightshift/route.json";', `const route = ${routeText};`)
  .replace('from "./apron.js"', `from ${JSON.stringify(new URL("../src/game/apron.js", import.meta.url).href)}`);
const { NightshiftCourse } = await import(`data:text/javascript;base64,${Buffer.from(executable).toString("base64")}`);
const course = new NightshiftCourse();
assert.equal(course.apronAt(course.sample(0), 20).wall, true);
assert.equal(course.apronAt(course.sample(0), 20).lateralLimit, course.halfWidth - 2.05);
assert.equal(course.audioZoneAt(.56), "underpass");
assert.equal(course.audioZoneAt(.8), "open");
assert.equal(course.timeOfDayStops, null);
assert.equal(Object.keys(course.rivalPace.profiles).length, 3);
assert.equal(course.boostPadLaneAt(), null);
assert.ok(Number.isNaN(course.cablePassLateralMeters()));
assert.ok(Math.abs(course.lightingAt().keyDirection.length() - 1) < 1e-7);

// New circuit choices and their records survive reloads independently.
let stored = null;
const port = { read: () => stored, write: text => { stored = text; } };
for (const [track, code] of [["nightshift", "MAP 03"], ["polarity", "MAP 04"]]) {
  const events = buildTrackEventSchedule({ kind: track, seed: 314, totalLaps: 5, courseLengthMeters: 2000 });
  assert.deepEqual(events.gusts, []);
  assert.deepEqual(events.saltDrops, []);
  assert.equal(events.squall, null, "New maps cannot inherit hazards from another circuit.");
  const save = createSaveStore(port, 4);
  save.setTrack(track);
  save.recordRace(code, { bestLapMs: 51_234, raceMs: 160_456, laps: 3 });
  const reloaded = createSaveStore(port, 4);
  assert.equal(reloaded.track, track);
  assert.equal(reloaded.recordFor(code).bestLapMs, 51_234);
  assert.ok(bandStrengthFor(track) < .02, "Night maps must keep the horizon glow restrained.");
  assert.ok(skyZonesFor(track)[0].zenith < 0x101020);
  assert.ok(cloudProfileFor(track).strength < .05);
}
const selectionUrl = new URL("../src/game/map-selection.ts", import.meta.url);
const selectionSource = await readFile(selectionUrl, "utf8");
const selectionTransform = await transformWithOxc(selectionSource, selectionUrl.pathname);
const selectionCode = selectionTransform.code.replace(
  'import { save } from "./persistence";', 'const save = { track: "polarity" };');
const selectionModule = await import(`data:text/javascript;base64,${Buffer.from(selectionCode).toString("base64")}`);
assert.equal(selectionModule.resolveMapSelection(""), "polarity");
for (const track of ["greenwater", "bitterpan", "nightshift", "polarity", "tideline"]) {
  assert.equal(selectionModule.resolveMapSelection(`?map=${track}`), track);
}
assert.equal(selectionModule.resolveMapSelection("?map=unknown"), "greenwater");
assert.equal(selectionModule.resolveMapSelection("?map=NIGHTSHIFT"), "nightshift");
assert.equal(selectionModule.TRACKS.length, 5);
assert.equal(course.orderedCheckpointCount, 8);
assert.equal(course.checkpointCount, 7);
assert.equal(course.defaultLapCount, 3);
const sample = course.createSampleScratch();
const projection = course.createProjectionScratch();
for (let i = 0; i < route.count; i += 3) {
  const progress = i / route.count;
  course.sample(progress, sample);
  assert.ok(Math.abs(sample.tangent.dot(sample.right)) < 1e-7);
  assert.ok(Math.abs(sample.up.length() - 1) < 1e-7);
  for (const lateral of [-8, 0, 8]) {
    const position = sample.position.clone().addScaledVector(sample.right, lateral);
    course.project(position, progress, projection);
    assert.ok(Math.abs(projection.lateral - lateral) < .04);
    assert.ok(Math.min(Math.abs(projection.progress - progress), 1 - Math.abs(projection.progress - progress)) * route.length < .3);
  }
}
course.sample(.71, sample);
course.project(sample.position, .1, projection);
assert.ok(Math.abs(projection.progress - .71) < .0002, "Recovery projection must find the street even from a stale hint.");
for (let i = 0; i < course.orderedCheckpointCount; i++) {
  const recovery = course.recoveryProgressFor(.99, i);
  const next = route.checkpoints[i + 1] ?? 1;
  assert.ok(recovery > route.checkpoints[i] && recovery < next, "Recovery cannot skip the next required gate.");
}
assert.ok(bytes.length < 12 * 1024 * 1024, "The complete city must stay under 12 MiB.");
assert.equal(json.animations, undefined);
assert.equal(json.cameras, undefined);
assert.equal(json.skins, undefined);
assert.equal(json.extensionsRequired, undefined, "The city should require no extra geometry decoder.");
assert.ok(json.images.every(image => image.bufferView !== undefined), "City textures must be embedded.");
for (const name of ["NS_concrete", "NS_old_brick"]) {
  const material = json.materials.find(material => material.name === name);
  assert.ok(material.pbrMetallicRoughness.baseColorFactor?.slice(0, 3).every(channel => channel < .4),
    `${name} lost its authored pigment during Blender export.`);
}
let triangles = 0;
let primitives = 0;
for (const mesh of json.meshes) {
  for (const primitive of mesh.primitives) {
    assert.equal(primitive.mode ?? 4, 4);
    const positions = json.accessors[primitive.attributes.POSITION];
    assert.ok([...positions.min, ...positions.max].every(Number.isFinite));
    triangles += json.accessors[primitive.indices].count / 3;
    primitives++;
  }
}
assert.equal(triangles, manifest.triangles);
assert.ok(triangles < 180_000);
assert.ok(primitives <= 60);
assert.ok(manifest.buildings >= 200);
assert.equal(lamps.length, manifest.lightAnchors);
for (const lamp of lamps) {
  assert.ok([...lamp.p, lamp.size, lamp.ground].every(Number.isFinite));
  assert.ok(lamp.p[1] > lamp.ground && lamp.p[1] - lamp.ground < 13);
}
console.log(`Night Shift PASS: ${route.length.toFixed(1)} m, 8 gates, route projection and recovery, ${manifest.buildings} Blender buildings, ${triangles} triangles / ${primitives} primitives / ${(bytes.length / 1024 / 1024).toFixed(1)} MiB.`);
