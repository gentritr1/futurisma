import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as THREE from "three";
import { transformWithOxc } from "vite";
import {
  FLIP_SECONDS, FLIP_COOLDOWN_SECONDS, CEILING_HEIGHT, SURGE_SECONDS, SHIELD_SECONDS,
  smoothTransfer, integrateSurgeSpeed, crossedPickup, TRANSFER_WINDOWS, transferWindowAt,
} from "../src/game/polarity-rules.js";
import { crossedForwardProgress } from "../src/game/race-rules.js";
import { disposeObject3DResources } from "../src/game/graphics-resources.js";

const courseUrl = new URL("../src/game/polarity-course.ts", import.meta.url);
const routeText = await readFile(new URL("../src/game/data/polarity/route.json", import.meta.url), "utf8");
const route = JSON.parse(routeText);
const source = await readFile(courseUrl, "utf8");
const paceText = await readFile(new URL("../src/game/data/polarity/rival-pace.json", import.meta.url), "utf8");
const transformed = await transformWithOxc(source, courseUrl.pathname);
const executable = transformed.code
  .replace('from "three"', `from ${JSON.stringify(import.meta.resolve("three"))}`)
  .replace('import route from "./data/polarity/route.json";', `const route = ${routeText};`)
  .replace('import rivalPace from "./data/polarity/rival-pace.json";', `const rivalPace = ${paceText};`)
  .replace('from "./apron.js"', `from ${JSON.stringify(new URL("../src/game/apron.js", import.meta.url).href)}`)
  .replace('from "./polarity-rules.js"', `from ${JSON.stringify(new URL("../src/game/polarity-rules.js", import.meta.url).href)}`);
const { PolarityCourse, POLARITY_BARRIERS } = await import(`data:text/javascript;base64,${Buffer.from(executable).toString("base64")}`);
const course = new PolarityCourse();
const circularGap = (a, b) => Math.abs(((a - b + 1.5) % 1) - .5);
const close = (actual, expected, tolerance, label) => assert.ok(
  Math.abs(actual - expected) <= tolerance,
  `${label}: expected ${expected} +/- ${tolerance}, received ${actual}.`,
);
const positionAt = (stations, progress) => {
  const n = ((progress % 1 + 1) % 1) * route.count;
  const index = Math.floor(n);
  return new THREE.Vector3(...stations[index].p).lerp(
    new THREE.Vector3(...stations[(index + 1) % route.count].p), n - index,
  );
};
// Integrate the shipped polyline exactly, including section boundaries that lie
// between stations. This tests real geometry instead of repeating the generator.
function distanceBetween(stations, from, to) {
  let previous = positionAt(stations, from);
  let distance = 0;
  for (let index = Math.floor(from * route.count) + 1; index < to * route.count; index += 1) {
    const current = new THREE.Vector3(...stations[index % route.count].p);
    distance += previous.distanceTo(current);
    previous = current;
  }
  return distance + previous.distanceTo(positionAt(stations, to));
}

assert.equal(route.count, route.stations.length);
assert.equal(route.count, route.upper.length);
assert.equal(route.ceilingHeight, CEILING_HEIGHT);
assert.equal(course.ceilingHeight, CEILING_HEIGHT);
assert.ok(route.length > 2000 && route.length < 2600);
assert.ok(route.upperLength < route.length - 100, "The alternate deck must materially shorten the circuit.");
assert.equal(route.shortcuts.length, 2);
assert.equal(course.checkpointCount, 7);
assert.equal(course.orderedCheckpointCount, 8);
assert.equal(course.defaultLapCount, 3);
assert.equal(route.checkpoints[0], 0);
assert.ok(FLIP_SECONDS > 0 && FLIP_COOLDOWN_SECONDS > FLIP_SECONDS);
assert.ok(SURGE_SECONDS > 0 && SHIELD_SECONDS > SURGE_SECONDS);

const lengths = [];
const sample = course.createSampleScratch();
const projection = course.createProjectionScratch();
const worldPosition = new THREE.Vector3();
let projections = 0;
let maxProjectionError = 0;
let transferStations = 0;
for (const lane of [0, 1]) {
  course.lane = lane;
  const stations = lane === 0 ? route.stations : route.upper;
  const actualLength = distanceBetween(stations, 0, 1);
  lengths.push(actualLength);
  close(actualLength, lane ? route.upperLength : route.length, 1.0, `Deck ${lane} physical length`);
  for (let index = 0; index < route.count; index += 1) {
    const station = stations[index];
    const next = stations[(index + 1) % route.count];
    assert.ok([...station.p, ...station.t, station.d, station.curvature, station.width].every(Number.isFinite));
    close(Math.hypot(...station.t), 1, 1e-6, `Deck ${lane} tangent ${index}`);
    close(station.p[1], lane * CEILING_HEIGHT, 1e-6, `Deck ${lane} elevation ${index}`);
    close(station.d, index / route.count * route.length, 1e-6, `Shared checkpoint metric ${index}`);
    const stationGap = Math.hypot(...station.p.map((coordinate, axis) => coordinate - next.p[axis]));
    assert.ok(stationGap > .2 && stationGap < 3.1, `Deck ${lane} has a broken road seam at ${index}: ${stationGap} m.`);
    assert.ok(Math.abs(station.curvature) * station.width / 2 < .9,
      `Deck ${lane} inner edge folds at station ${index}.`);
    const progress = (index + .37) / route.count;
    course.sample(progress, sample);
    close(sample.tangent.length(), 1, 1e-7, "Unit tangent");
    close(sample.right.length(), 1, 1e-7, "Unit right");
    close(sample.up.length(), 1, 1e-7, "Unit up");
    close(sample.tangent.dot(sample.right), 0, 1e-7, "Tangent/right orthogonality");
    close(sample.tangent.dot(sample.up), 0, 1e-7, "Tangent/up orthogonality");
    close(sample.right.dot(sample.up), 0, 1e-7, "Right/up orthogonality");
    assert.ok(sample.up.y * (lane ? -1 : 1) > .999, "The ceiling craft's local up must face away from its road.");
    const orientation = new THREE.Matrix4().makeBasis(sample.right, sample.up, sample.tangent.clone().negate());
    close(orientation.determinant(), 1, 1e-7, "Craft basis must remain a rotation, not a mirror");
    close(sample.halfWidth, lane ? 8 : 12, 1e-7, "Lane half width");
    // Test both signs in the craft's own frame: screen-left/right reverse in
    // world space on the ceiling but steering must remain local to the craft.
    for (const lateral of [-sample.halfWidth + 2.1, 0, sample.halfWidth - 2.1]) {
      worldPosition.copy(sample.position).addScaledVector(sample.right, lateral).addScaledVector(sample.up, .96);
      course.project(worldPosition, progress, projection);
      close(projection.lateral, lateral, .10, `Deck ${lane} lateral projection ${index}`);
      const error = circularGap(projection.progress, progress) * route.length;
      maxProjectionError = Math.max(maxProjectionError, error);
      assert.ok(error < .65, `Deck ${lane} projection drifts ${error} m at station ${index}.`);
      projections += 1;
    }
    const apron = course.apronAt(sample, sample.halfWidth + 2);
    assert.equal(apron.wall, true);
    close(apron.lateralLimit, sample.halfWidth - 2.05, 1e-7, "Each deck's collision edge follows its own width");
  }
  const atStart = course.sample(0);
  const atWrapped = course.sample(1);
  close(atStart.position.distanceTo(atWrapped.position), 0, 1e-7, "Closed position seam");
  close(atStart.tangent.distanceTo(atWrapped.tangent), 0, 1e-7, "Closed tangent seam");
  for (const progress of [.001, .21, .47, .73, .999]) {
    course.sample(progress, sample);
    course.project(sample.position, (progress + .45) % 1, projection);
    assert.ok(circularGap(projection.progress, progress) * route.length < .1, "Projection must recover from a stale hint.");
  }
  // Recovery must leave the exact next gate pending on either surface.
  for (let index = 0; index < course.orderedCheckpointCount; index += 1) {
    const checkpoint = route.checkpoints[index];
    const next = route.checkpoints[index + 1] ?? 1;
    assert.ok(next > checkpoint);
    close(course.checkpointProgress(index), checkpoint, 1e-12, "Checkpoint identity");
    close(course.checkpointHalfWidth(index), lane ? 8 : 12, 1e-7, "Checkpoint width follows active deck");
    for (const strayProgress of [-.2, .04, .54, .999, 2]) {
      const recovered = course.recoveryProgressFor(strayProgress, index);
      close(recovered, checkpoint + .005, 1e-12, "Recovery position");
      assert.ok(recovered > checkpoint && recovered < next, "Recovery must not skip a required checkpoint.");
      assert.equal(crossedForwardProgress(recovered, recovered + .001, next % 1), false);
      assert.equal(crossedForwardProgress(next - .001, next + .001, next % 1), true);
    }
  }
}

let measuredSaving = 0;
for (const shortcut of route.shortcuts) {
  assert.ok(shortcut.from > 0 && shortcut.to > shortcut.from && shortcut.to < 1);
  const lower = distanceBetween(route.stations, shortcut.from, shortcut.to);
  const upper = distanceBetween(route.upper, shortcut.from, shortcut.to);
  const saving = lower - upper;
  assert.ok(saving > 45, `${shortcut.name} must provide a meaningful geometric shortcut.`);
  close(saving, shortcut.savedMeters, 1.0, `${shortcut.name} stated saving`);
  measuredSaving += saving;
  assert.equal(course.shortcutAt((shortcut.from + shortcut.to) / 2)?.name, shortcut.name);
  for (const progress of [shortcut.from, shortcut.to]) {
    const lowerPoint = positionAt(route.stations, progress);
    const upperPoint = positionAt(route.upper, progress);
    close(Math.hypot(lowerPoint.x - upperPoint.x, lowerPoint.z - upperPoint.z), 0, 1.2,
      `${shortcut.name} entrance and exit align for transfer`);
  }
}
close(lengths[0] - lengths[1], measuredSaving, 1.0, "All route savings belong to declared shortcuts");
for (let index = 0; index < route.count; index += 1) {
  const progress = (index + .5) / route.count;
  const available = course.transferAvailable(progress);
  if (!available) continue;
  transferStations += 1;
  const lower = route.stations[index];
  const upper = route.upper[index];
  assert.ok(Math.hypot(lower.p[0] - upper.p[0], lower.p[2] - upper.p[2]) < .201,
    "Gravity transfer is offered only beneath the matching road.");
  const window = transferWindowAt(progress);
  assert.ok(window, "Transfers only occur in an authored route junction.");
  assert.ok(Math.abs(lower.curvature) < (window.fromLane === 0 ? .00501 : .00701), "Transfers must avoid the sharp switchbacks.");
}
assert.equal(TRANSFER_WINDOWS.length, 4, "Two deliberate entry/exit pairs replace repeated flip prompts.");
assert.equal(FLIP_COOLDOWN_SECONDS, 6, "A route choice has at least six seconds to settle.");
for (const window of TRANSFER_WINDOWS) {
  let usable = 0;
  for (let progress = window.from + .001; progress < window.to; progress += .001) {
    if (course.transferAvailable(progress)) usable++;
  }
  assert.ok(usable >= 45, `${window.id} needs a clearly usable strip, not a single lucky station.`);
  course.lane = window.fromLane;
  assert.equal(course.nextTransferDistance((window.from + window.to) / 2), 0);
}
assert.ok(transferStations > 120 && transferStations < route.count * .28, "Four bounded junctions must remain usable and deliberate.");

// At the allowed lateral extremes, test the destination projection between
// stations too. A transfer window must leave the complete ship inside the
// narrower upper road, even where the two paths begin to separate.
let minimumLandingMargin = Infinity;
for (let index = 0; index < route.count; index += 1) {
  for (const fraction of [.01, .25, .5, .75, .99]) {
    const progress = (index + fraction) / route.count;
    if (!course.transferAvailable(progress)) continue;
    for (const lateral of [-5.7, 5.7]) {
      course.lane = 0;
      course.sample(progress, sample);
      worldPosition.copy(sample.position).addScaledVector(sample.right, lateral);
      worldPosition.y = CEILING_HEIGHT;
      course.lane = 1;
      course.project(worldPosition, progress, projection);
      const margin = projection.halfWidth - 2.05 - Math.abs(projection.lateral);
      minimumLandingMargin = Math.min(minimumLandingMargin, margin);
      assert.ok(margin > .2, "An eligible flip must land inside the narrower road without an instant wall strike.");
    }
  }
}

// The rival must remain on its independent lower course while markers sample
// either deck and the player changes deck repeatedly.
const rival = course.rivalCourse;
assert.ok(rival);
assert.equal(rival.rivalCourse, null);
assert.equal(rival.lane, 0);
const rivalSnapshots = [.02, .19, .42, .61, .83].map(progress => ({ progress, sample: rival.sample(progress) }));
for (let round = 0; round < 20; round += 1) {
  course.lane = round % 2;
  for (const snapshot of rivalSnapshots) {
    const marker = course.createSampleScratch();
    course.sampleLane(snapshot.progress, (round + 1) % 2, marker);
    assert.equal(course.lane, round % 2, "Marker sampling must not change the player lane.");
    assert.equal(rival.lane, 0, "Marker sampling must restore the independent rival lane.");
    const current = rival.sample(snapshot.progress);
    close(current.position.distanceTo(snapshot.sample.position), 0, 1e-10, "Player lane must not move rival geometry");
    close(current.right.distanceTo(snapshot.sample.right), 0, 1e-10, "Player lane must not mirror rival steering");
  }
}

// Barriers leave a navigable side corridor and affect only their own deck.
for (const barrier of POLARITY_BARRIERS) {
  course.lane = barrier.lane;
  const width = course.sample(barrier.progress).halfWidth - 2.05;
  const leftGap = width + barrier.lateral - barrier.halfWidth;
  const rightGap = width - barrier.lateral - barrier.halfWidth;
  assert.ok(Math.max(leftGap, rightGap) > 3.4, "A barrier must leave room for the 3.4 m craft.");
  assert.notEqual(course.cableTripSideAt(barrier.progress, barrier.lateral), 0);
  assert.equal(course.cableTripSideAt(barrier.progress + 8 / route.length, barrier.lateral), 0);
  course.lane = barrier.lane === 0 ? 1 : 0;
  assert.equal(course.cableTripSideAt(barrier.progress, barrier.lateral), 0, "A barrier on the opposite road cannot hit the player.");
}

// Inspect generated geometry, not just logical widths. Kerbs must clear the
// full vehicle envelope at the collision boundary; gate posts stay outside the
// ribbon, with their overhead bars above the hovercraft on both surfaces.
const streetMeshes = course.group.children.filter(child => child.isMesh && !child.isInstancedMesh);
const furnitureGroups = course.group.children.filter(child => child.isGroup);
const gateMeshes = course.group.children.filter(child => child.isInstancedMesh);
assert.equal(streetMeshes.length, 2);
assert.equal(furnitureGroups.length, 2);
assert.equal(gateMeshes.length, 2);
const instanceMatrix = new THREE.Matrix4();
const vertex = new THREE.Vector3();
const a = new THREE.Vector3();
const b = new THREE.Vector3();
const c = new THREE.Vector3();
const edge = new THREE.Vector3();
let minimumKerbClearance = Infinity;
for (const lane of [0, 1]) {
  course.lane = lane;
  const street = streetMeshes[lane];
  const positions = street.geometry.getAttribute("position");
  const indices = street.geometry.index;
  assert.equal(positions.count, (route.count + 1) * 2);
  for (const side of [0, 1]) {
    a.fromBufferAttribute(positions, side);
    b.fromBufferAttribute(positions, route.count * 2 + side);
    close(a.distanceTo(b), 0, 1e-5, "Both physical road edges close across the finish seam");
  }
  for (let index = 0; index < indices.count; index += 3) {
    a.fromBufferAttribute(positions, indices.getX(index));
    b.fromBufferAttribute(positions, indices.getX(index + 1));
    c.fromBufferAttribute(positions, indices.getX(index + 2));
    edge.subVectors(c, a);
    b.sub(a).cross(edge);
    assert.ok(b.y * (lane ? -1 : 1) > .1, "Road triangles must face the correct surface and never fold.");
  }
  const furniture = furnitureGroups[lane];
  for (const mesh of furniture.children) {
    assert.ok(mesh.isInstancedMesh);
    const corners = mesh.geometry.getAttribute("position");
    for (let instance = 0; instance < mesh.count; instance += 1) {
      const progress = Math.floor(instance / 2) * 7 / route.length;
      mesh.getMatrixAt(instance, instanceMatrix);
      for (let index = 0; index < corners.count; index += 1) {
        vertex.fromBufferAttribute(corners, index).applyMatrix4(instanceMatrix);
        course.project(vertex, progress, projection);
        // The accepted craft is 3.4 m wide. Its centre's wall boundary plus
        // its 1.7 m half-width is the complete driveable vehicle envelope.
        const envelope = projection.halfWidth - 2.05 + 1.7;
        const clearance = Math.abs(projection.lateral) - envelope;
        minimumKerbClearance = Math.min(minimumKerbClearance, clearance);
        assert.ok(clearance > .08,
          `Deck ${lane} furniture enters the craft envelope at instance ${instance}: ${clearance.toFixed(3)} m.`);
      }
    }
  }
  const gate = gateMeshes[lane];
  assert.equal(gate.count, route.checkpoints.length * 3);
  for (let checkpoint = 0; checkpoint < route.checkpoints.length; checkpoint += 1) {
    course.sample(route.checkpoints[checkpoint], sample);
    for (let part = 0; part < 3; part += 1) {
      gate.getMatrixAt(checkpoint * 3 + part, instanceMatrix);
      const corners = gate.geometry.getAttribute("position");
      for (let index = 0; index < corners.count; index += 1) {
        vertex.fromBufferAttribute(corners, index).applyMatrix4(instanceMatrix).sub(sample.position);
        if (part < 2) {
          assert.ok(Math.abs(vertex.dot(sample.right)) >= sample.halfWidth + 1.60,
            "Gate posts must leave the whole road clear.");
        } else {
          assert.ok(vertex.dot(sample.up) > 8.8, "Gate beams must clear the hovercraft on either surface.");
        }
      }
    }
  }
}
const actualColor = new THREE.Color();
for (const next of [0, 1, 4, 7]) {
  course.setCheckpointProgress(next);
  for (const gate of gateMeshes) {
    for (let checkpoint = 0; checkpoint < route.checkpoints.length; checkpoint += 1) {
      const expected = new THREE.Color(checkpoint === next ? 0xffc983 : (next === 0 || checkpoint < next) ? 0x71afa0 : 0x354954);
      for (let part = 0; part < 3; part += 1) {
        gate.getColorAt(checkpoint * 3 + part, actualColor);
        close(actualColor.r, expected.r, 1e-6, "Gate signal red");
        close(actualColor.g, expected.g, 1e-6, "Gate signal green");
        close(actualColor.b, expected.b, 1e-6, "Gate signal blue");
      }
    }
  }
}

// Gravity interpolation must be monotone and settle without a velocity kick.
assert.equal(smoothTransfer(-1), 0);
assert.equal(smoothTransfer(0), 0);
assert.equal(smoothTransfer(1), 1);
assert.equal(smoothTransfer(2), 1);
let previous = 0;
for (let index = 0; index <= 1000; index += 1) {
  const value = smoothTransfer(index / 1000);
  assert.ok(value >= previous && value >= 0 && value <= 1);
  close(value + smoothTransfer(1 - index / 1000), 1, 1e-12, "Symmetric gravity transfer");
  previous = value;
}
assert.ok(smoothTransfer(.001) < .00001);
assert.ok(1 - smoothTransfer(.999) < .00001);

// Power pickup crossings cannot repeat while parked, run backward, or award a
// pickup when a reset/recovery jumps across a large part of the course.
assert.equal(crossedPickup(.10, .11, .105), true);
assert.equal(crossedPickup(.10, .11, .12), false);
assert.equal(crossedPickup(.10, .10, .10), false);
assert.equal(crossedPickup(.11, .10, .105), false);
assert.equal(crossedPickup(.99, .01, 0), true);
assert.equal(crossedPickup(.99, .01, .999), true);
assert.equal(crossedPickup(.1, .4, .2), false);
assert.equal(crossedPickup(.105, .11, .105), false);

const surgeSpeeds = [];
for (const frequency of [30, 60, 120]) {
  let speed = 80;
  for (let frame = 0; frame < frequency * SURGE_SECONDS; frame += 1) {
    speed = integrateSurgeSpeed(speed, Math.min(speed, 112), 1, 0, true, 1 / frequency);
    assert.ok(speed >= 80 && speed <= 140, "Surge speed must remain capped.");
  }
  close(speed, 140, 1e-6, "A full surge reaches its bounded top speed");
  for (let frame = 0; frame < frequency; frame += 1) {
    const next = integrateSurgeSpeed(speed, 112, 1, 0, false, 1 / frequency);
    assert.ok(next <= speed && next >= 112, "Released surge speed settles toward the normal limiter.");
    speed = next;
  }
  surgeSpeeds.push(speed);
}
close(Math.max(...surgeSpeeds), Math.min(...surgeSpeeds), 1e-8, "Released surge is rate independent");
assert.ok(integrateSurgeSpeed(112, 100, 0, 0, true, 1 / 60) <= 112, "A surge without throttle cannot add thrust.");
assert.ok(integrateSurgeSpeed(112, 100, 1, 1, true, 1 / 60) <= 112, "Braking must override surge thrust.");

disposeObject3DResources(course.group);
console.log(`Polarity PASS: ${lengths[0].toFixed(1)} m floor / ${lengths[1].toFixed(1)} m ceiling, ${measuredSaving.toFixed(1)} m shortcut savings, ${projections} deck projections (max ${maxProjectionError.toFixed(3)} m), ${minimumKerbClearance.toFixed(3)} m minimum kerb clearance beyond full craft envelope, ${minimumLandingMargin.toFixed(3)} m transfer landing margin, 8 required gates per deck, independent rival geometry, gravity/power rules.`);
