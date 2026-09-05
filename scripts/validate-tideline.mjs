import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as THREE from "three";
import { transformWithOxc } from "vite";
import { simulateRivalField } from "./lib/rival-field-sim.mjs";
import { applyPaceTier } from "../src/game/race-modes-rules.js";
import { VEHICLE_CLEARANCE_METERS } from "../src/game/rival-race.js";
import { TIDELINE_FIELDS, tidelineFieldAt } from "../src/game/tideline-rules.js";
import { disposeObject3DResources } from "../src/game/graphics-resources.js";

const courseUrl = new URL("../src/game/tideline-course.ts", import.meta.url);
const routeText = await readFile(new URL("../src/game/data/tideline/route.json", import.meta.url), "utf8");
const route = JSON.parse(routeText);
const paceText = await readFile(new URL("../src/game/data/tideline/rival-pace.json", import.meta.url), "utf8");
const source = await readFile(courseUrl, "utf8");
const materialFile = new URL("../src/game/tideline-materials.ts", import.meta.url);
const materialCode = (await transformWithOxc(await readFile(materialFile,"utf8"),materialFile.pathname)).code.replace('from "three"',`from ${JSON.stringify(import.meta.resolve("three"))}`);
const materialUrl = `data:text/javascript;base64,${Buffer.from(materialCode).toString("base64")}`;
const code = (await transformWithOxc(source, courseUrl.pathname)).code
  .replace('from "./tideline-materials"', `from ${JSON.stringify(materialUrl)}`)
  .replace('from "./tideline-tide.js"', `from ${JSON.stringify(new URL("../src/game/tideline-tide.js", import.meta.url).href)}`)
  .replace('from "./tideline-rules.js"', `from ${JSON.stringify(new URL("../src/game/tideline-rules.js", import.meta.url).href)}`)
  .replace('from "three"', `from ${JSON.stringify(import.meta.resolve("three"))}`)
  .replace('import route from "./data/tideline/route.json";', `const route = ${routeText};`)
  .replace('import rivalPace from "./data/tideline/rival-pace.json";', `const rivalPace = ${paceText};`)
  .replace('from "./apron.js"', `from ${JSON.stringify(new URL("../src/game/apron.js", import.meta.url).href)}`);
async function courseForEdition(foundry) {
  const styleUrl = `data:text/javascript;base64,${Buffer.from(`export const isFoundryEdition = ${foundry};`).toString("base64")}`;
  const editionCode = code.replace('from "./tideline-style"', `from ${JSON.stringify(styleUrl)}`);
  return (await import(`data:text/javascript;base64,${Buffer.from(editionCode).toString("base64")}`)).TidelineCourse;
}
const TidelineCourse = await courseForEdition(false);
const FoundryCourse = await courseForEdition(true);
const course = new TidelineCourse();
const foundry = new FoundryCourse();
// Test the production selector independently of the fixed values used to
// instantiate both visual branches side-by-side in this one Node process.
const styleFile = new URL("../src/game/tideline-style.ts", import.meta.url);
const styleCode = (await transformWithOxc(await readFile(styleFile, "utf8"), styleFile.pathname)).code;
const styleSelector = new Function("location", styleCode.replace("export const isFoundryEdition", "const isFoundryEdition") + "\nreturn isFoundryEdition;");
assert.equal(styleSelector(undefined), false);
for (const [search, expected] of [["?map=tideline", false], ["?map=tideline&edition=foundry", true], ["?edition=Foundry", false], ["?edition=unknown", false]]) {
  assert.equal(styleSelector({ search }), expected);
}
assert.equal(foundry.mapName, course.mapName, "Legacy edition links resolve to the rebuilt Tideline.");
for (const key of ["kind", "length", "halfWidth", "checkpointCount", "orderedCheckpointCount", "defaultLapCount", "minimumLapCount",
  "maximumLapCount", "mapCode", "finishName", "startLabel", "startProgress", "startLateral", "recoveryHoldSeconds", "recoverySpeedMps",
  "recoveryImmunitySeconds", "surfaceGripRecoverySeconds", "flightArcs", "rivalPace"]) {
  assert.deepEqual(foundry[key], course[key], `${key} must remain identical across visual editions.`);
}
const circularGap = (a, b) => Math.abs(((a - b + 1.5) % 1) - .5);
const close = (actual, expected, tolerance, label) => assert.ok(
  Math.abs(actual - expected) <= tolerance, `${label}: ${actual} versus ${expected}.`,
);
assert.equal(route.stations.length, route.count);
assert.ok(route.length >= 2000 && route.length <= 2200);
assert.equal(course.orderedCheckpointCount, 8);
assert.equal(course.checkpointCount, 7);
assert.equal(course.defaultLapCount, 3);
assert.equal(course.flightArcs.length, 0);
assert.equal(course.kind, "tideline");
assert.equal(course.mapCode, "MAP 05");
const sample = course.createSampleScratch();
const projection = course.createProjectionScratch();
const foundrySample = foundry.createSampleScratch();
const foundryProjection = foundry.createProjectionScratch();
const point = new THREE.Vector3();
let maximumProjectionError = 0;
let physicalLength = 0;
let maximumPitch = 0;
let solidSegments = 0;
let submergedSegments = 0;
let airSegments = 0;
for (let index = 0; index < route.count; index++) {
  const station = route.stations[index];
  const next = route.stations[(index + 1) % route.count];
  assert.ok([...station.p, ...station.t, station.d, station.width, station.curvature].every(Number.isFinite));
  const gap = Math.hypot(...station.p.map((value, axis) => value - next.p[axis]));
  assert.ok(gap > 2.8 && gap < 3.1, `Broken route seam at ${index}: ${gap} m.`);
  physicalLength += gap;
  close(Math.hypot(...station.t), 1, 1e-6, "Normalized route tangent");
  maximumPitch = Math.max(maximumPitch, Math.abs(Math.asin(station.t[1])));
  assert.ok(Math.abs(station.curvature) * station.width / 2 < .8, "Road inner edge folds.");
  const progress = (index + .37) / route.count;
  course.sample(progress, sample);
  foundry.sample(progress, foundrySample);
  assert.deepEqual(foundrySample, sample, "Style changes cannot move or reshape the sampled road/flight path.");
  close(sample.tangent.length(), 1, 1e-7, "Unit tangent");
  close(sample.right.length(), 1, 1e-7, "Unit right");
  close(sample.up.length(), 1, 1e-7, "Unit up");
  close(sample.tangent.dot(sample.right), 0, 1e-7, "Tangent/right orthogonality");
  close(sample.tangent.dot(sample.up), 0, 1e-7, "Tangent/up orthogonality");
  close(sample.right.dot(sample.up), 0, 1e-7, "Right/up orthogonality");
  close(sample.right.y, 0, 1e-7, "The circuit never forces a roll");
  close(sample.bank, 0, 1e-7, "Zero bank");
  assert.ok(sample.up.y > .98, "The road pitch is too steep for a stable horizon.");
  close(new THREE.Matrix4().makeBasis(sample.right, sample.up, sample.tangent.clone().negate()).determinant(),
    1, 1e-7, "Craft basis remains a rotation");
  for (const lateral of [-7.5, 0, 7.5]) for (const vertical of [-20, .96, 20]) {
    // Height lag during the guided glide must not distort the nearest XZ route.
    point.copy(sample.position).addScaledVector(sample.right, lateral);
    point.y += vertical;
    course.project(point, progress, projection);
    foundry.project(point, progress, foundryProjection);
    assert.deepEqual(foundryProjection, projection, "Projection must be exactly edition-independent, including height lag and lateral offsets.");
    close(projection.lateral, lateral, .08, "Lateral projection");
    const error = circularGap(projection.progress, progress) * route.length;
    maximumProjectionError = Math.max(maximumProjectionError, error);
    assert.ok(error < .35, `Projection drifts ${error} m at ${index}.`);
    close(projection.position.y, sample.position.y, .07, "Projection restores slope height");
  }
  const mode = course.travelModeAt((index + .5) / route.count);
  assert.equal(foundry.travelModeAt((index + .5) / route.count), mode);
  for (const lateral of [-11, -4, 0, 4, 11]) {
    assert.deepEqual(foundry.apronAt(foundrySample, lateral), course.apronAt(sample, lateral));
    assert.equal(foundry.surfaceGripAt(progress, lateral, sample.halfWidth), course.surfaceGripAt(progress, lateral, sample.halfWidth));
    assert.equal(foundry.isOnBoostPad(progress, lateral, sample.halfWidth), course.isOnBoostPad(progress, lateral, sample.halfWidth));
    assert.equal(foundry.cableTripSideAt(progress, lateral), course.cableTripSideAt(progress, lateral));
    assert.equal(foundry.rivalHazardLaneAt(progress * course.length, lateral), course.rivalHazardLaneAt(progress * course.length, lateral));
  }
  assert.deepEqual(foundry.turnAhead(progress, 180), course.turnAhead(progress, 180));
  assert.equal(foundry.boostPadLaneAt(progress * course.length, sample.halfWidth, 120), course.boostPadLaneAt(progress * course.length, sample.halfWidth, 120));
  for (const speed of [0, 80, 112, 140]) for (const boost of [false, true]) {
    assert.equal(foundry.vehicleHoverHeight(speed, boost), course.vehicleHoverHeight(speed, boost));
  }
  if (mode === "air") airSegments++; else solidSegments++;
  if (mode === "submerged") submergedSegments++;
}
close(physicalLength, route.length, 1, "Physical route length");
assert.ok(maximumPitch * 180 / Math.PI < 10.5);
assert.ok(submergedSegments > route.count * .45 && airSegments === 0);
assert.ok(Math.min(...route.stations.map(s => s.p[1])) <= -18);
assert.ok(Math.max(...route.stations.map(s => s.p[1])) > 4);
for (const progress of [.001, .15, .29, .49, .69, .81, .999]) {
  const sample = course.sample(progress);
  course.project(sample.position, (progress + .4) % 1, projection);
  assert.ok(circularGap(projection.progress, progress) * route.length < .1, "A stale hint must recover globally.");
}
const road = course.group.getObjectByName("tideline_rain_polished_asphalt");
const foundryRoad = foundry.group.getObjectByName("tideline_rain_polished_asphalt");
assert.ok(road?.isMesh);
assert.ok(foundryRoad?.isMesh);
assert.deepEqual(foundryRoad.geometry.index.array, road.geometry.index.array, "Flight-gap topology stays identical.");
for (const attribute of ["position", "normal"]) {
  assert.deepEqual(foundryRoad.geometry.attributes[attribute].array, road.geometry.attributes[attribute].array,
    `Road ${attribute} data is identical between editions.`);
}
assert.ok(road.material.isMeshLambertMaterial && foundryRoad.material.isMeshLambertMaterial, "Painted roads must respond to the real lamp lights.");
assert.deepEqual(foundry.fogAt(.1), course.fogAt(.1));
assert.equal(road.geometry.index.count, solidSegments * 6);
for (let i = 0; i < road.geometry.index.count; i += 6) {
  const segment = road.geometry.index.getX(i) / 2;
  assert.notEqual(course.travelModeAt((segment + .5) / route.count), "air", "Road triangles must stop at flight gaps.");
}
for (const arc of course.flightArcs) {
  assert.ok(arc.from > 0 && arc.from < arc.to && arc.to < 1);
  assert.equal(course.travelModeAt(arc.from), "air");
  assert.notEqual(course.travelModeAt(arc.to), "air");
  assert.ok(arc.length > 300 && arc.maximumHeight > 40);
  assert.ok(route.checkpoints.some(checkpoint => checkpoint > arc.from && checkpoint < arc.to),
    "Each glide retains an ordered checkpoint, preventing shortcuts across the ocean.");
}
for (let i = 0; i < route.checkpoints.length; i++) {
  const checkpoint = route.checkpoints[i];
  const next = route.checkpoints[i + 1] ?? 1;
  const recovered = course.recoveryProgressFor(.99, i);
  close(course.checkpointProgress(i), checkpoint, 1e-12, "Gate identity");
  assert.equal(foundry.checkpointProgress(i), course.checkpointProgress(i));
  assert.equal(foundry.checkpointHalfWidth(i), course.checkpointHalfWidth(i));
  for (const progress of [-.2, .1, .55, .99, 1.7]) {
    assert.equal(foundry.recoveryProgressFor(progress, i), course.recoveryProgressFor(progress, i));
  }
  assert.ok(recovered > checkpoint && recovered < next, "Recovery cannot skip the next required checkpoint.");
}
for (const field of TIDELINE_FIELDS) {
  assert.notEqual(course.travelModeAt(field.progress), "air", "Bulkheads must sit on solid road.");
  for (const offset of [-3, 0, 3]) for (const lateral of [-11, -7, -3, 0, 4, 8, 11]) {
    const progress = field.progress + offset / course.length;
    const contact = tidelineFieldAt(progress, lateral, course.length);
    assert.equal(course.cableTripSideAt(progress, lateral), contact ? (lateral < field.lateral ? -1 : 1) : 0,
      "Collision checks must share the visible field's authored bounds.");
  }
}
const fieldCourseFor = edition => ({
  kind: edition.kind, length: edition.length, startProgress: edition.startProgress, startLateral: edition.startLateral,
  sample(progress) {
    const s = edition.sample(progress, sample);
    return { curvature: s.curvature, halfWidth: s.halfWidth };
  },
  gridStart: identity => edition.rivalGridStart(identity),
  boostPadLaneAt: (...args) => edition.boostPadLaneAt(...args),
  isOnBoostPad: () => false,
  rivalHazardLaneAt: (...args) => edition.rivalHazardLaneAt(...args),
});
const fieldCourse = fieldCourseFor(course);
const times = [];
for (const tier of ["rookie", "works", "feral"]) {
  const pace = applyPaceTier(course.rivalPace, tier);
  let hazardSamples = 0;
  let minimumHazardClearance = Infinity;
  const observeField = states => {
    for (const state of states) for (const field of TIDELINE_FIELDS) {
      if (state.finished) continue;
      const gap = circularGap(state.courseDistanceMeters / course.length, field.progress) * course.length;
      if (gap > 7) continue;
      const clearance = Math.abs(state.lateralMeters - field.lateral) - field.halfWidth;
      minimumHazardClearance = Math.min(minimumHazardClearance, clearance);
      hazardSamples++;
      assert.ok(clearance >= VEHICLE_CLEARANCE_METERS,
        `${tier}/${state.id} clips ${field.id}: hull clearance ${clearance.toFixed(3)} m.`);
    }
  };
  const runs = [60, 120, 240].map(hz => simulateRivalField({ course: fieldCourse, pace, totalLaps: 3,
    renderDeltaSeconds: 1 / hz, maximumSeconds: 150, observeField }));
  const reference = runs[1];
  const styledRun = simulateRivalField({ course: fieldCourseFor(foundry), pace: applyPaceTier(foundry.rivalPace, tier),
    totalLaps: 3, renderDeltaSeconds: 1 / 120, maximumSeconds: 150 });
  assert.deepEqual(styledRun.states, reference.states, `${tier}: visual edition must preserve every rival's final simulation state and finish time exactly.`);
  assert.equal(styledRun.minimumRivalSeparationMeters, reference.minimumRivalSeparationMeters);
  for (const run of runs) {
    assert.ok(run.minimumRivalSeparationMeters >= VEHICLE_CLEARANCE_METERS, `${tier}: rival hulls overlap.`);
    assert.deepEqual(run.states.map(s => s.finishTimeSeconds), reference.states.map(s => s.finishTimeSeconds));
    for (const state of run.states) assert.ok(state.finished && Number.isFinite(state.finishTimeSeconds));
  }
  assert.ok(hazardSamples > 100);
  times.push(Math.min(...reference.states.map(s => s.finishTimeSeconds)));
  console.log(`Tideline ${tier}: ${reference.states.map(s => s.finishTimeSeconds.toFixed(2)).join(" / ")} s; fleet separation ${reference.minimumRivalSeparationMeters.toFixed(2)} m; minimum field clearance ${minimumHazardClearance.toFixed(2)} m across ${hazardSamples} samples.`);
}
assert.ok(times[0] > times[1] + 1 && times[1] > times[2] + 1);
disposeObject3DResources(course.group);
disposeObject3DResources(foundry.group);
console.log(`Tideline course PASS: ${route.length.toFixed(1)} m, 8 ordered gates, continuous road and a real pump-hall branch; max pitch ${(maximumPitch * 180 / Math.PI).toFixed(2)} degrees, no roll; ${route.count * 9} height-independent projections, worst error ${maximumProjectionError.toFixed(3)} m; all pace tiers deterministic at 60/120/240 Hz; original/Foundry geometry, projection, gates, recovery, physics inputs and rival results exactly identical.`);
