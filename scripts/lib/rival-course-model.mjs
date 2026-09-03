/**
 * Headless course model for the rival race, for both shipped maps.
 *
 * `rivals.ts` drives the fleet from `RaceCourse.sample()` and
 * `RaceCourse.isOnBoostPad()`. Node cannot import the TypeScript courses (they
 * pull in three.js and WebGL assembly), so this module reproduces the three
 * course facts the rival model actually consumes — curvature, half width and
 * pad coverage — straight from the same authored JSON the courses read, using
 * the same derivations:
 *
 *   Greenwater  curvature: cross(tangent[i-off], tangent[i+off]).y * 4, clamped
 *               to [-1, 1], with `off = round(8 / sampleSpacing)` and tangents
 *               taken as the normalised centred difference of the centreline
 *               points — `GreenwaterCourse.sampleCurvatures` in course.ts.
 *   Bitterpan   curvature: the authored per-station `curvature`, lerped and
 *               scaled by 70, clamped — `BitterpanCourse.sample` in
 *               bitterpan-course.ts.
 *
 * Fidelity check (scripts/rival-pace-calibration.mjs --verify): the projected
 * five-lap finish times this model produces are compared against the ones the
 * running game printed in its own diagnostics soak. They agree to the
 * millisecond on both maps, which is what makes the pace numbers derived from
 * this harness measurements rather than guesses.
 */
import { readFileSync } from "node:fs";

const readJson = (relativePath) => JSON.parse(
  readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8"),
);

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

/** Greenwater's authored boost pads, mirroring BOOST_PAD_DISTANCES in course.ts. */
const GREENWATER_BOOST_PAD_DISTANCES = [1705, 1815, 1925, 2035];
const GREENWATER_BOOST_PAD_HALF_LENGTH_METRES = 10;

function buildGreenwater() {
  const blockout = readJson("src/game/data/greenwater-blockout.json");
  const samples = blockout.centreline.samples;
  const length = blockout.centreline.lapLength;
  const count = samples.length;
  const wrap = (value) => ((value % count) + count) % count;
  const points = samples.map((sample) => [sample.x, sample.y, sample.z]);
  const tangents = points.map((_, index) => {
    const before = points[wrap(index - 1)];
    const after = points[(index + 1) % count];
    const delta = [after[0] - before[0], after[1] - before[1], after[2] - before[2]];
    const magnitude = Math.hypot(delta[0], delta[1], delta[2]) || 1;
    return [delta[0] / magnitude, delta[1] / magnitude, delta[2] / magnitude];
  });
  const sampleSpacing = length / count;
  const offset = Math.max(1, Math.round(8 / sampleSpacing));
  const curvatures = tangents.map((_, index) => {
    const before = tangents[wrap(index - offset)];
    const after = tangents[(index + offset) % count];
    // cross(before, after).dot(0, 1, 0)
    return clamp((before[2] * after[0] - before[0] * after[2]) * 4, -1, 1);
  });
  return {
    kind: "greenwater",
    mapCode: "MAP 01",
    length,
    turns: blockout.turns,
    sample(progress) {
      const scaled = (((progress % 1) + 1) % 1) * count;
      const index = Math.floor(scaled) % count;
      const next = (index + 1) % count;
      const alpha = scaled - Math.floor(scaled);
      const mix = (a, b) => a + (b - a) * alpha;
      return {
        curvature: mix(curvatures[index], curvatures[next]),
        halfWidth: mix(samples[index].w, samples[next].w) / 2,
      };
    },
    isOnBoostPad(courseDistanceMeters, lateral, halfWidth) {
      if (lateral < halfWidth * 0.12 || lateral > halfWidth * 0.78) return false;
      const distance = ((courseDistanceMeters % length) + length) % length;
      return GREENWATER_BOOST_PAD_DISTANCES.some(
        (pad) => Math.abs(distance - pad) <= GREENWATER_BOOST_PAD_HALF_LENGTH_METRES,
      );
    },
    boostPadLaneAt(courseDistanceMeters, halfWidth, approachMeters) {
      const distance = ((courseDistanceMeters % length) + length) % length;
      let best = null;
      let bestGap = Infinity;
      for (const pad of GREENWATER_BOOST_PAD_DISTANCES) {
        const gap = ((pad - distance + length / 2) % length + length) % length - length / 2;
        if (gap > approachMeters || gap < -GREENWATER_BOOST_PAD_HALF_LENGTH_METRES) continue;
        if (Math.abs(gap) >= bestGap) continue;
        bestGap = Math.abs(gap);
        best = 0.45 * halfWidth;
      }
      return best;
    },
    /** Grid offsets come from the profiles on Greenwater; the course authors none. */
    gridStart: () => null,
  };
}

function buildBitterpan() {
  const centreline = readJson("src/game/data/map02/CENTRELINE_STATIONS.json");
  const production = readJson("src/game/data/map02/BITTERPAN_PRODUCTION.json");
  const sectors = readJson("src/game/data/map02/SECTORS_AND_SEQUENCES.json");
  const gridAndRecovery = readJson("src/game/data/map02/GRID_AND_RECOVERY.json");
  const stations = centreline.stations;
  const count = stations.length;
  const length = centreline.total_length_m;
  const pads = production.boostPads;
  const turns = sectors.authored_primitives
    .filter((primitive) => primitive.kind === "arc" && primitive.radius_m !== null)
    .map((primitive) => ({
      entryDistance: primitive.from_m,
      exitDistance: primitive.to_m,
      radius: primitive.radius_m,
    }))
    .filter((turn) => turn.radius < 600);
  return {
    kind: "bitterpan",
    mapCode: "MAP 02",
    length,
    turns,
    sample(progress) {
      const scaled = (((progress % 1) + 1) % 1) * count;
      const index = Math.floor(scaled) % count;
      const next = (index + 1) % count;
      const alpha = scaled - Math.floor(scaled);
      const mix = (a, b) => a + (b - a) * alpha;
      return {
        curvature: clamp(
          mix(stations[index].curvature, stations[next].curvature) * 70,
          -1,
          1,
        ),
        halfWidth: mix(stations[index].width_m, stations[next].width_m) / 2,
      };
    },
    isOnBoostPad(courseDistanceMeters, lateral, halfWidth) {
      const distance = ((courseDistanceMeters % length) + length) % length;
      for (const pad of pads.pads) {
        const along = Math.abs(
          (((distance - pad.distance + length / 2) % length) + length) % length
            - length / 2,
        );
        if (along > pads.halfLengthMetres) continue;
        const centre = pad.lateralFraction * halfWidth;
        if (Math.abs(lateral - centre) <= pads.lateralHalfFraction * halfWidth) return true;
      }
      return false;
    },
    boostPadLaneAt(courseDistanceMeters, halfWidth, approachMeters) {
      const distance = ((courseDistanceMeters % length) + length) % length;
      let best = null;
      let bestGap = Infinity;
      for (const pad of pads.pads) {
        const gap = ((pad.distance - distance + length / 2) % length + length) % length
          - length / 2;
        if (gap > approachMeters || gap < -pads.halfLengthMetres) continue;
        if (Math.abs(gap) >= bestGap) continue;
        bestGap = Math.abs(gap);
        best = pad.lateralFraction * halfWidth;
      }
      return best;
    },
    gridStart(identity) {
      const transform = gridAndRecovery.grid.transforms.find(
        (candidate) => candidate.identity === identity,
      );
      if (!transform || identity === "WORKS 07") return null;
      const raceDistanceMeters = transform.station_m === 0
        ? 0
        : transform.station_m - length;
      return {
        raceDistanceMeters,
        lateralMeters: -transform.lateral_offset_m,
      };
    },
  };
}

export function loadCourseModel(kind) {
  if (kind === "greenwater") return buildGreenwater();
  if (kind === "bitterpan") return buildBitterpan();
  throw new Error(`Unknown course kind ${kind}.`);
}

export function loadRivalPace(kind) {
  if (kind === "greenwater") {
    return readJson("src/game/data/greenwater-rival-pace.json").rivals;
  }
  if (kind === "bitterpan") {
    return readJson("src/game/data/map02/BITTERPAN_PRODUCTION.json").rivals;
  }
  throw new Error(`Unknown course kind ${kind}.`);
}
