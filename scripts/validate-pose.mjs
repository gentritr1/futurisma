/**
 * H1 pose guard — the presentation lift is applied exactly ONCE, at every
 * lateral the craft can reach on every banked sample of both maps.
 *
 * THE BUG THIS PINS. The simulation stores `position.y` at the CENTRELINE
 * height. Every writer that offsets the position by the banked `right` has to
 * put that y back, because `right.y` is `sin(bank)` and the presentation lift
 * adds `sin(bank) * lateral` itself. Two writers did not:
 *
 *   - `resetRaceState` (every `?probe=` spawn with a non-zero lateral)
 *   - `updateCoast` (the post-finish coast, whose lateral clamp rewrites the
 *     position through the banked `right` every step)
 *
 * Measured on GREENWATER SWEEP's 12 degree deck at lateral -16 before the fix:
 * hull clearance -2.064 m, i.e. the craft 3.33 m below where it belonged and
 * 2.06 m under the drawn deck. At +16 it floated at 4.588 m.
 *
 * A third, smaller break was in the lift itself: it took its lateral from
 * `course.project()` of the flattened point, which returns
 * `lateral * cos^2(bank)`, not `lateral`. That under-lifts by
 * `lateral * sin(bank) * sin^2(bank)` — 0.14 m at the Greenwater apron, which
 * is small but is the same class of error and was measurable in every banked
 * frame of a normal race.
 *
 * WHY THE ASSERTIONS BELOW ARE NOT CIRCULAR. `hullClearance` is never given the
 * lateral the lift used. It is given the lateral recovered from the pose's
 * HORIZONTAL offset, which no write to `y` can move — the same instrument the
 * game reports as `hullClearanceMeters`. So a lift applied twice, once too
 * little, or not at all each show up as a clearance that is not
 * `hoverHeight * cos(bank)`. The negative fixtures at the bottom run the two
 * broken writers and require exactly that failure.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  cameraSurfaceClearance,
  chaseDistanceCorrection,
  hullClearance,
  lateralFromHorizontalOffset,
  presentationSurfaceLift,
} from "../src/game/presentation.js";
import { resolveApronProfile } from "../src/game/apron.js";

/**
 * `apron-profile.ts` is TypeScript, so this validator cannot import it. The
 * cross-section is re-stated here and the authored numbers are asserted against
 * that file's source below, so a change to the table fails here rather than
 * silently splitting the two copies.
 */
const APRON_CROSS_SECTION = {
  A: { outerRise: -0.12, innerDrop: 0.04 },
  B: { outerRise: 0.14, innerDrop: 0.02 },
  C: { outerRise: 0, innerDrop: 0.03 },
};

function surfaceHeightAtLateral(sample, lateral) {
  const side = lateral < 0 ? -1 : 1;
  const beyond = Math.abs(lateral) - sample.halfWidth;
  if (beyond <= 0) return 0;
  const apronWidth = side < 0 ? sample.apronLeft : sample.apronRight;
  if (apronWidth <= 0) return 0;
  const edge = side < 0 ? sample.edgeLeft : sample.edgeRight;
  const { outerRise } = APRON_CROSS_SECTION[edge];
  return (outerRise * Math.min(beyond, apronWidth)) / apronWidth;
}

const apronProfileSource = readFileSync(
  new URL("../src/game/apron-profile.ts", import.meta.url),
  "utf8",
);
for (const [edge, { outerRise, innerDrop }] of Object.entries(APRON_CROSS_SECTION)) {
  assert.ok(
    apronProfileSource.includes(
      `${edge}: Object.freeze({ outerRise: ${outerRise}, innerDrop: ${innerDrop} })`,
    ),
    `apron-profile.ts no longer authors edge ${edge} as outerRise ${outerRise} / `
      + `innerDrop ${innerDrop}. Update the copy in this validator too.`,
  );
}

const TOLERANCE_METRES = 0.001;

function readJson(relativePath) {
  return JSON.parse(
    readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8"),
  );
}

/**
 * The basis `course.sample()` builds at a banked station: an orthonormal
 * (right, up) pair with `right.y = sin(bank)` and `up.y = cos(bank)`.
 */
function bankedBasis(headingDegrees, bankDegrees) {
  const heading = (headingDegrees * Math.PI) / 180;
  const bank = (bankDegrees * Math.PI) / 180;
  const flatRightX = Math.cos(heading);
  const flatRightZ = -Math.sin(heading);
  const right = {
    x: flatRightX * Math.cos(bank),
    y: Math.sin(bank),
    z: flatRightZ * Math.cos(bank),
  };
  const up = {
    x: -flatRightX * Math.sin(bank),
    y: Math.cos(bank),
    z: -flatRightZ * Math.sin(bank),
  };
  const dot = right.x * up.x + right.y * up.y + right.z * up.z;
  assert.ok(Math.abs(dot) < 1e-12, "the constructed basis is not orthonormal.");
  return { right, up };
}

/**
 * One step of the real pipeline: a position writer, the presentation lift, the
 * hull placement, and the independent clearance measurement.
 *
 * `flattenY` is the convention under test. `true` is what every writer in
 * `updateRace` does and what `resetRaceState` and `updateCoast` now do; `false`
 * is the pre-fix behaviour of those two, kept so the negative fixtures can run
 * it. `liftLateral` is which lateral the lift is driven by — `"sim"` is the
 * fix, `"projected"` reproduces taking it from `course.project()`.
 */
function drivePose({ centre, sample, basis, lateral, hover, flattenY, liftLateral }) {
  const { right, up } = basis;
  // 1. the writer.
  const position = {
    x: centre.x + right.x * lateral,
    y: centre.y + right.y * lateral,
    z: centre.z + right.z * lateral,
  };
  if (flattenY) position.y = centre.y;

  // 2. the presentation lift.
  const horizontalSq = right.x * right.x + right.z * right.z;
  const projectedLateral = lateral * horizontalSq;
  const liftAt = liftLateral === "projected" ? projectedLateral : lateral;
  position.y += presentationSurfaceLift(
    right.y,
    liftAt,
    up.y,
    surfaceHeightAtLateral(sample, liftAt),
  );

  // 3. the hull.
  const vehicleY = position.y + up.y * hover;

  // 4. the measurement, from the horizontal offset only.
  const measuredLateral = lateralFromHorizontalOffset(
    position.x - centre.x,
    position.z - centre.z,
    right.x,
    right.z,
  );
  const clearance = hullClearance(
    vehicleY,
    centre.y,
    right.y,
    up.y,
    measuredLateral,
    surfaceHeightAtLateral(sample, measuredLateral),
  );
  return { clearance, measuredLateral, projectedLateral };
}

// ---------------------------------------------------------------------------
// The station lists, straight from the authored maps.

const blockout = readJson("src/game/data/greenwater-blockout.json");
const apronTable = blockout.apron;
function widthFor(table, edge, sector) {
  return Math.max(0, resolveApronProfile(table, edge, sector).widthMetres);
}

const greenwaterStations = blockout.centreline.samples.map((s) => ({
  distance: s.d,
  heading: s.hdg,
  bank: s.bank ?? 0,
  y: s.y,
  halfWidth: s.w / 2,
  edgeLeft: s.edgeL,
  edgeRight: s.edgeR,
  apronLeft: widthFor(apronTable, s.edgeL, s.sector),
  apronRight: widthFor(apronTable, s.edgeR, s.sector),
  sector: s.sector,
}));

// Map 02 is authored edge "C" end to end (`BitterpanCourse.edgeType`), and its
// apron table is `BITTERPAN_PRODUCTION.apron`, not Greenwater's.
const bitterpanApron = readJson(
  "src/game/data/map02/BITTERPAN_PRODUCTION.json",
).apron;
const bitterpanStations = readJson(
  "src/game/data/map02/CENTRELINE_STATIONS.json",
).stations.map((s) => ({
  distance: s.s,
  heading: s.heading_deg,
  bank: s.bank_deg ?? 0,
  y: s.y,
  halfWidth: s.width_m / 2,
  edgeLeft: "C",
  edgeRight: "C",
  apronLeft: widthFor(bitterpanApron, "C", s.sector),
  apronRight: widthFor(bitterpanApron, "C", s.sector),
  sector: s.sector,
}));

const MAPS = [
  {
    name: "greenwater",
    apron: apronTable,
    stations: greenwaterStations,
    // Rest / cruise / boost, from `RaceCourse.vehicleHoverHeight`.
    hovers: [0.3 + 0.71, 0.58 + 0.71, 0.74 + 0.71],
  },
  {
    name: "bitterpan",
    apron: bitterpanApron,
    stations: bitterpanStations,
    // From `BitterpanCourse.vehicleHoverHeight`.
    hovers: [1.18, 1.34],
  },
];

/** The widest lateral the clamp can leave the craft at, on each side. */
function apronLimits(table, station) {
  const limits = [];
  const roadLimit = Math.max(0, station.halfWidth - table.deckMarginMetres);
  for (const [side, width] of [[-1, station.apronLeft], [1, station.apronRight]]) {
    limits.push(side * roadLimit);
    limits.push(side * (width > 0 ? station.halfWidth + width : roadLimit));
    // Halfway across the run-off, where the apron cross-section is in play.
    if (width > 0) limits.push(side * (station.halfWidth + width / 2));
  }
  return limits;
}

// ---------------------------------------------------------------------------
// THE INVARIANT: at every banked station of both maps, at both apron limits and
// at every authored hover height, the drawn hull stands exactly
// `hover * cos(bank)` above the drawn surface.

let bankedStations = 0;
let checks = 0;
let steepest = { bank: 0, map: "", sector: "" };

for (const map of MAPS) {
  let mapBanked = 0;
  for (const station of map.stations) {
    if (Math.abs(station.bank) < 1e-9) continue;
    mapBanked += 1;
    bankedStations += 1;
    if (Math.abs(station.bank) > Math.abs(steepest.bank)) {
      steepest = { bank: station.bank, map: map.name, sector: station.sector };
    }
    const basis = bankedBasis(station.heading, station.bank);
    const centre = { x: 0, y: station.y, z: 0 };
    for (const lateral of apronLimits(map.apron, station)) {
      for (const hover of map.hovers) {
        const { clearance, measuredLateral } = drivePose({
          centre,
          sample: station,
          basis,
          lateral,
          hover,
          flattenY: true,
          liftLateral: "sim",
        });
        checks += 1;
        assert.ok(
          Math.abs(measuredLateral - lateral) < 1e-9,
          `${map.name} ${station.sector} @${station.distance} m: the horizontal `
            + `offset recovered ${measuredLateral} m, not the ${lateral} m the `
            + "writer put there. The measurement itself is wrong.",
        );
        const expected = hover * basis.up.y;
        assert.ok(
          Math.abs(clearance - expected) < TOLERANCE_METRES,
          `${map.name} ${station.sector} @${station.distance} m, bank `
            + `${station.bank} deg, lateral ${lateral.toFixed(2)} m, hover `
            + `${hover} m: hull clearance ${clearance.toFixed(4)} m, expected `
            + `${expected.toFixed(4)} m (= hover * cos(bank)). The presentation `
            + `lift is off by ${(clearance - expected).toFixed(4)} m, which is `
            + `${((clearance - expected) / (basis.right.y * lateral)).toFixed(3)} `
            + "extra applications of sin(bank) * lateral.",
        );
      }
    }
  }
  assert.ok(
    mapBanked > 0,
    `${map.name} authors no banked station, so this guard tested nothing on it.`,
  );
}

// ---------------------------------------------------------------------------
// NEGATIVE FIXTURES. Each one is a writer that really shipped; each must fail
// the invariant above, or the invariant is not measuring anything.

const sweep = greenwaterStations.find(
  (s) => Math.abs(s.bank) === 12 && s.sector === "GREENWATER_SWEEP",
);
assert.ok(sweep, "GREENWATER_SWEEP no longer authors a 12 degree station.");
const sweepBasis = bankedBasis(sweep.heading, sweep.bank);
const sweepCentre = { x: 0, y: sweep.y, z: 0 };
const CRUISE_HOVER = 0.58 + 0.71;
const PROBE_LATERAL = -16;

// 1. `resetRaceState` / `updateCoast` before H1: the writer left sin(bank) *
//    lateral in the simulation position and the lift added it again.
const doubled = drivePose({
  centre: sweepCentre,
  sample: sweep,
  basis: sweepBasis,
  lateral: PROBE_LATERAL,
  hover: CRUISE_HOVER,
  flattenY: false,
  liftLateral: "sim",
});
const doubledError = doubled.clearance - CRUISE_HOVER * sweepBasis.up.y;
assert.ok(
  Math.abs(doubledError - sweepBasis.right.y * PROBE_LATERAL) < 1e-9,
  "the double-applied lift no longer errors by exactly sin(bank) * lateral; "
    + `measured ${doubledError.toFixed(4)} m.`,
);
assert.ok(
  doubled.clearance < 0,
  "the pre-H1 probe spawn at lateral -16 on GREENWATER SWEEP put the hull "
    + `UNDER the deck; this fixture now reports ${doubled.clearance.toFixed(3)} m `
    + "of clearance, so it is no longer reproducing the reported bug.",
);
assert.ok(
  Math.abs(doubled.clearance - -2.064) < 0.01,
  "the pre-H1 clearance measured in the browser at "
    + "?probe=boundary-hold&probeDistance=1000&probeLateral=-16 was -2.064 m; "
    + `this model says ${doubled.clearance.toFixed(3)} m. The model and the `
    + "runtime have drifted apart.",
);

// 2. The lift driven by `course.project()`'s lateral instead of the race
//    loop's. Smaller, and present on EVERY banked frame of a normal race.
const projected = drivePose({
  centre: sweepCentre,
  sample: sweep,
  basis: sweepBasis,
  lateral: PROBE_LATERAL,
  hover: CRUISE_HOVER,
  flattenY: true,
  liftLateral: "projected",
});
const projectedError = projected.clearance - CRUISE_HOVER * sweepBasis.up.y;
// The lift landed at `lateral * cos^2(bank)` instead of `lateral`, so the hull
// is short by the bank term over that gap plus whatever the apron
// cross-section does differently at the two laterals.
const expectedProjectedError =
  sweepBasis.right.y * (projected.projectedLateral - PROBE_LATERAL)
  + sweepBasis.up.y * (
    surfaceHeightAtLateral(sweep, projected.projectedLateral)
    - surfaceHeightAtLateral(sweep, PROBE_LATERAL)
  );
assert.ok(
  Math.abs(projectedError - expectedProjectedError) < 1e-9,
  "the projected-lateral lift no longer errors by the bank term over "
    + `lateral - lateral * cos^2(bank); measured ${projectedError.toFixed(5)} m `
    + `against an expected ${expectedProjectedError.toFixed(5)} m.`,
);
assert.ok(
  Math.abs(projectedError) > 0.1,
  "the projected-lateral error at the Greenwater apron measured 0.16 m in this "
    + `model and 0.14-0.17 m in the browser; it is now `
    + `${projectedError.toFixed(3)} m, so the fixture has stopped reproducing.`,
);
assert.ok(
  Math.abs(projectedError) > TOLERANCE_METRES,
  "the projected-lateral error is now inside the tolerance, so the positive "
    + "assertions above would pass with the pre-H1 lift in place.",
);

// ---------------------------------------------------------------------------
// THE CONVENTION, as source text. Every writer that offsets `this.position` by
// a banked `right` must put the centreline y back on the next line. This is the
// half a numeric guard cannot cover: a NEW writer added later would simply not
// be exercised by the invariant above.

const gameSource = readFileSync(
  new URL("../src/game/game.ts", import.meta.url),
  "utf8",
);
const writers = [...gameSource.matchAll(
  /this\.position\.copy\(([A-Za-z.]+)\.position\)\.addScaledVector\(([A-Za-z.]+)\.right, this\.lateral\);/g,
)];
assert.ok(
  writers.length >= 4,
  `expected at least four banked position writers in game.ts, found ${writers.length}. `
    + "If one was removed the pattern below is stale; if the call was reformatted "
    + "this guard has stopped matching and must be updated, not deleted.",
);
for (const writer of writers) {
  const source = writer[1];
  const after = gameSource.slice(writer.index + writer[0].length);
  const restore = `this.position.y = ${source}.position.y;`;
  const nextStatements = after.slice(0, 640);
  assert.ok(
    nextStatements.includes(restore),
    `a writer offsets this.position by ${writer[2]}.right * lateral and does `
      + `not restore the centreline y with \`${restore}\` immediately after. `
      + "The simulation's convention is that position.y is ALWAYS the "
      + "centreline height; the presentation lift adds sin(bank) * lateral "
      + "itself, so leaving it in buries the craft under a banked deck.",
  );
}

// The lift itself must be driven by the race loop's lateral, not a projection.
assert.ok(
  gameSource.includes("this.presentationLateral,")
    && gameSource.includes("surfaceHeightAtLateral(sample, this.presentationLateral)"),
  "the presentation lift must take `this.presentationLateral`. Projecting the "
    + "centreline-flattened position returns lateral * cos^2(bank), which "
    + "under-lifts the craft on every banked frame.",
);

// The chase camera's ground-clearance vector must not borrow `scratchA`, which
// still holds `vehicleRight` for the impact shake further down.
assert.ok(
  gameSource.includes("const cameraClearance = this.cameraScratch.copy(desired)"),
  "updateCamera must use `cameraScratch` for the ground-clearance vector. "
    + "`scratchA` holds `vehicleRight`, which the impact shake reads after this "
    + "point; borrowing it makes the shake scale with the craft's lateral "
    + "offset instead of the impact.",
);

// ---------------------------------------------------------------------------
// H1.2 — the two chase-camera guards.
//
// WHAT IS AND IS NOT PROVED HERE. There is no Node camera model below, on
// purpose: re-implementing `updateCamera` in the validator would pin the
// validator's arithmetic, not the game's, and the first time the two drifted
// this file would go green on a broken camera. What is pinned instead is
// (1) the two pure helpers the guards are built from, exactly, (2) the two
// floors against numbers MEASURED in the browser, so neither can be retuned
// into being either useless or intrusive without this failing, and (3) the
// call sites, because a guard applied to `desired` instead of to the damped
// camera is the exact mistake H1 started from. The framing itself is proved by
// `hullNdcY` / `cameraSurfaceClearanceMeters` in a real run; the numbers from
// those runs are quoted in the assertions below so a future retune has to
// argue with them.
// ---------------------------------------------------------------------------

// Measured with `?camguards=0` over three Greenwater and two Bitterpan
// drive-keys runs (`desiredChaseMeters` / `minimumChaseMeters` in the
// diagnostics).
const DESIRED_CHASE_GREENWATER_METRES = 7.26;
const DESIRED_CHASE_BITTERPAN_METRES = 8.76;
const MEASURED_CHASE_COLLAPSE_METRES = 4.93;

const gameCameraSource = readFileSync(
  new URL("../src/game/game.ts", import.meta.url),
  "utf8",
);
const chaseFloor = Number(
  /const MINIMUM_CHASE_METRES = ([\d.]+);/.exec(gameCameraSource)?.[1],
);
const surfaceFloor = Number(
  /const MINIMUM_CAMERA_SURFACE_CLEARANCE_METRES = ([\d.]+);/
    .exec(gameCameraSource)?.[1],
);
assert.ok(
  Number.isFinite(chaseFloor) && Number.isFinite(surfaceFloor),
  "game.ts no longer declares both camera floors as plain constants.",
);

// 1. The floor has to BIND. If it drops to or below the collapse the guard is
//    decoration: the camera reached 4.93 m behind the hull unaided.
assert.ok(
  chaseFloor > MEASURED_CHASE_COLLAPSE_METRES,
  `MINIMUM_CHASE_METRES is ${chaseFloor} m, at or under the ${MEASURED_CHASE_COLLAPSE_METRES} m `
    + "the damped camera reached on its own in every measured Greenwater run. "
    + "A floor the camera already clears catches nothing.",
);
// 2. And it has to stay INERT on an unbroken frame. Above either map's desired
//    chase distance the guard would be pushing the camera back every frame,
//    which is a feel change nobody asked for -- and on Bitterpan, whose damped
//    camera never once went below its own desired 8.76 m, it would be pure
//    regression.
for (const [map, desired] of [
  ["greenwater", DESIRED_CHASE_GREENWATER_METRES],
  ["bitterpan", DESIRED_CHASE_BITTERPAN_METRES],
]) {
  assert.ok(
    chaseFloor < desired,
    `MINIMUM_CHASE_METRES is ${chaseFloor} m, at or beyond ${map}'s measured `
      + `desired chase distance of ${desired} m. The guard would fire on every `
      + "frame instead of only on the collapse it exists for.",
  );
}
// 3. Same shape for the surface floor: under the 2.1 m the pre-existing guard
//    already holds `desired` to, so it is a backstop for what damping and the
//    impact shake do afterwards rather than a second, competing rule.
assert.ok(
  surfaceFloor > 0 && surfaceFloor < 2.1,
  `MINIMUM_CAMERA_SURFACE_CLEARANCE_METRES is ${surfaceFloor} m; it must sit under `
    + "the 2.1 m `cameraClearance` floor applied to `desired`, or the two guards "
    + "fight over the same frame.",
);

// The helpers themselves.
assert.equal(chaseDistanceCorrection(-chaseFloor, chaseFloor), 0);
assert.equal(chaseDistanceCorrection(-DESIRED_CHASE_GREENWATER_METRES, chaseFloor), 0);
assert.equal(chaseDistanceCorrection(-DESIRED_CHASE_BITTERPAN_METRES, chaseFloor), 0);
assert.equal(
  Number(chaseDistanceCorrection(-MEASURED_CHASE_COLLAPSE_METRES, chaseFloor).toFixed(6)),
  Number((chaseFloor - MEASURED_CHASE_COLLAPSE_METRES).toFixed(6)),
);
// The worst frame the H1 camera survey caught, before the fix: 2.86 m behind
// the hull, which put the craft at NDC y -1.216 -- off the bottom of the frame.
assert.equal(
  Number(chaseDistanceCorrection(-2.86, chaseFloor).toFixed(6)),
  Number((chaseFloor - 2.86).toFixed(6)),
);
// A camera that has somehow got IN FRONT of the hull is pushed back hardest,
// not left alone by a sign slip.
assert.ok(chaseDistanceCorrection(3, chaseFloor) > chaseFloor);
assert.equal(chaseDistanceCorrection(Number.NaN, chaseFloor), 0);
assert.equal(chaseDistanceCorrection(-6, Number.NaN), 0);

// `cameraSurfaceClearance` subtracts the run-off cross-section, which is the
// whole reason it exists: the pre-existing measure took the height above the
// banked PLANE, and the plane is not the drawn surface once the camera is over
// the apron. B rises 0.14 m, A falls 0.12 m, C is flush.
assert.equal(Number(cameraSurfaceClearance(2.1, 0.14).toFixed(6)), 1.96);
assert.equal(Number(cameraSurfaceClearance(2.1, -0.12).toFixed(6)), 2.22);
assert.equal(cameraSurfaceClearance(2.1, 0), 2.1);
assert.equal(cameraSurfaceClearance(Number.NaN, 0), 0);
assert.equal(cameraSurfaceClearance(2.1, Number.NaN), 0);
// Over the widest run-off of either map, at the steepest cross-section, the
// correction is never large enough to be mistaken for the bank term.
const worstCrossSection = Math.max(
  ...Object.values(APRON_CROSS_SECTION).map((edge) => Math.abs(edge.outerRise)),
);
assert.ok(
  worstCrossSection <= 0.14,
  `the apron cross-section now reaches ${worstCrossSection} m; the camera guard's `
    + "reasoning assumed it stays inside 0.15 m.",
);

// The call sites. Both guards act on the camera the player is looking through,
// not on `desired`.
assert.ok(
  /this\.cameraTarget\.lerp\(desired, positionDamping\);\s*\n(?:\s*\/\/[^\n]*\n)*\s*(?:if \(this\.cameraGuardsEnabled\) )?this\.holdChaseDistance\(\);/
    .test(gameCameraSource),
  "`holdChaseDistance` must run immediately after the damping lerp, on "
    + "`cameraTarget`. Applied to `desired` it would do nothing: `desired` was "
    + "measured at a steady 7.26 m (Greenwater) and 8.76 m (Bitterpan) behind "
    + "the hull and was never the thing that collapsed.",
);
// Scoped to `updateCamera` itself: `calculateImpactShakeOffset` also appears in
// the import list at the top of the file, and an index taken from there would
// make this ordering check pass no matter where the guard sat.
const updateCameraBody = gameCameraSource.slice(
  gameCameraSource.indexOf("  private updateCamera("),
);
const shakeIndex = updateCameraBody.indexOf("calculateImpactShakeOffset(elapsed");
const surfaceGuardIndex = updateCameraBody.indexOf(
  "this.holdCameraOverSurface(sample.progress);",
);
const lookAtIndex = updateCameraBody.indexOf("this.camera.lookAt(this.cameraLook);");
assert.ok(
  shakeIndex > 0 && surfaceGuardIndex > 0 && lookAtIndex > 0,
  "updateCamera no longer contains the impact shake, the surface guard and the "
    + "lookAt this ordering rule is written against.",
);
assert.ok(
  surfaceGuardIndex > shakeIndex && lookAtIndex > surfaceGuardIndex,
  "`holdCameraOverSurface` must run AFTER the impact shake and before `lookAt`. "
    + "The shake moves the camera position, so a guard that runs before it can "
    + "be undone by it.",
);
// The numbers above were read with `?camguards=0`. If that switch goes, so does
// the ability to reproduce them, and these assertions become folklore.
assert.ok(
  gameCameraSource.includes('searchParam("camguards") !== "0"'),
  "the `?camguards=0` kill switch is gone. The desired-chase and collapse "
    + "figures this file pins the floors against were measured with it; without "
    + "it nobody can re-measure them.",
);
assert.ok(
  gameCameraSource.includes("surfaceHeightAtLateral(surface, surface.lateral)"),
  "the camera surface guard must evaluate the cross-section at the CAMERA's own "
    + "lateral. `surface` is the projection of the camera position, and unlike "
    + "the simulation's flattened pose it needs no lateral recovery: a real "
    + "world point projects to its own lateral directly.",
);

console.log(
  `Pose PASS: presentation lift applied exactly once across ${checks} checks on `
    + `${bankedStations} banked stations (steepest ${steepest.bank} deg, `
    + `${steepest.map} ${steepest.sector}); both pre-H1 writers still fail the `
    + `invariant (-2.064 m and ${projectedError.toFixed(3)} m); `
    + `${writers.length} banked position writers restore the centreline y. `
    + `H1.2 camera: chase floor ${chaseFloor} m binds over the measured `
    + `${MEASURED_CHASE_COLLAPSE_METRES} m collapse and stays inert under both `
    + `maps' desired chase (${DESIRED_CHASE_GREENWATER_METRES} / `
    + `${DESIRED_CHASE_BITTERPAN_METRES} m); surface floor ${surfaceFloor} m sits `
    + "under the 2.1 m `desired` guard; both guards pinned to the damped camera "
    + "and to the post-shake position by call-site assertions.",
);
