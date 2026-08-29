import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  GATE_MISS_RECOVERY_GRACE_SECONDS,
  GATE_MISS_RECOVERY_INSTANT_SPEED_MPS,
  calculateFinishDistanceMeters,
  calculateRecoveryTelemetry,
  checkpointRequiresExtraCircuit,
  crossedForwardProgress,
  forwardProgressDelta,
  integrateWrongWayEvidence,
  isOpenEdgeWarningActive,
  isCircularHazardContact,
  isTurnCueBeyondFinish,
  isTurnCueUrgent,
  resolveGateMissRecoveryDelay,
  resolveWrongWayActive,
  resolveCountdownStage,
} from "../src/game/race-rules.js";
import {
  formatRaceGap,
  formatRacePosition,
  resolveBoostPresentation,
  resolveFinishPresentation,
  resolveInitialRacePresentation,
  resolveRaceStage,
} from "../src/game/hud-presentation.js";

const COURSE_LENGTH = 2_516;

assert.ok(crossedForwardProgress(0.1, 0.13, 0.12));
assert.ok(crossedForwardProgress(0.99, 0.01, 0));
assert.ok(!crossedForwardProgress(0.13, 0.1, 0.12));
assert.ok(!crossedForwardProgress(0.1, 0.11, 0.12));
assert.ok(forwardProgressDelta(0.99, 0.01) > 0);
assert.ok(forwardProgressDelta(0.01, 0.99) < 0);

assert.equal(resolveCountdownStage(3.7), "3");
assert.equal(resolveCountdownStage(3), "2");
assert.equal(resolveCountdownStage(2), "1");
assert.equal(resolveCountdownStage(1), "GO");
assert.equal(resolveCountdownStage(0), "");
assert.equal(resolveCountdownStage(Number.NaN), "");

assert.equal(isTurnCueUrgent(210, 90, true), true);
assert.equal(isTurnCueUrgent(230, 90, true), false);
assert.equal(isTurnCueUrgent(120, 20, true), true);
assert.equal(isTurnCueUrgent(80, 90, false), false);
assert.equal(isTurnCueUrgent(Number.NaN, 90, true), false);

assert.equal(isOpenEdgeWarningActive(6.5, 10), true);
assert.equal(isOpenEdgeWarningActive(6.3, 10), false);
assert.equal(isOpenEdgeWarningActive(-6.5, 10), true);
assert.equal(isOpenEdgeWarningActive(Number.NaN, 10), false);

let wrongWayEvidence120 = 0;
for (let index = 0; index < 78; index += 1) {
  wrongWayEvidence120 = integrateWrongWayEvidence(wrongWayEvidence120, -0.7, 24, 1 / 120);
}
let wrongWayEvidence60 = 0;
for (let index = 0; index < 39; index += 1) {
  wrongWayEvidence60 = integrateWrongWayEvidence(wrongWayEvidence60, -0.7, 24, 1 / 60);
}
assert.ok(resolveWrongWayActive(false, wrongWayEvidence120));
assert.ok(resolveWrongWayActive(false, wrongWayEvidence60));
assert.ok(
  Math.abs(wrongWayEvidence120 - wrongWayEvidence60) < 0.001,
  "Wrong-way evidence must remain stable between 60 Hz and 120 Hz.",
);
assert.equal(
  integrateWrongWayEvidence(0, -1, 7.9, 1),
  0,
  "Low-speed rotation must not trigger wrong-way evidence.",
);
assert.equal(
  integrateWrongWayEvidence(0, -0.34, 40, 1),
  0,
  "Hard-turn heading error must not trigger below the reversal threshold.",
);
assert.equal(resolveWrongWayActive(false, 0.64), false);
assert.equal(resolveWrongWayActive(false, 0.65), true);
assert.equal(resolveWrongWayActive(true, 0.18), true);
assert.equal(resolveWrongWayActive(true, 0.17), false);

assert.equal(isTurnCueBeyondFinish(280, 60, true), true);
assert.equal(isTurnCueBeyondFinish(0, 360, true), false);
assert.equal(isTurnCueBeyondFinish(280, 60, false), false);
assert.equal(isTurnCueBeyondFinish(Number.NaN, 60, true), false);

assert.equal(checkpointRequiresExtraCircuit(0.4, 0.2), true);
assert.equal(checkpointRequiresExtraCircuit(0.2, 0.4), false);
assert.equal(checkpointRequiresExtraCircuit(0.9, null), false);

const cleanFiveLapDistance = calculateFinishDistanceMeters(
  0.25,
  1,
  5,
  COURSE_LENGTH,
  0.4,
);
assert.equal(cleanFiveLapDistance, COURSE_LENGTH * 4.75);

const missedGateDistance = calculateFinishDistanceMeters(
  0.25,
  1,
  5,
  COURSE_LENGTH,
  0.2,
);
assert.equal(missedGateDistance, COURSE_LENGTH * 5.75);

const finishArmedDistance = calculateFinishDistanceMeters(
  0.75,
  5,
  5,
  COURSE_LENGTH,
  null,
);
assert.equal(finishArmedDistance, COURSE_LENGTH * 0.25);

assert.deepEqual(resolveFinishPresentation(COURSE_LENGTH * 5, 1, 5, false), {
  label: "12.6 KM TO FINISH",
  finalLap: false,
  finalApproach: false,
});
assert.deepEqual(resolveFinishPresentation(630, 5, 5, false), {
  label: "630 M TO FINISH",
  finalLap: true,
  finalApproach: false,
});
assert.deepEqual(resolveFinishPresentation(256, 5, 5, true), {
  label: "260 M · THE CRADLE",
  finalLap: true,
  finalApproach: true,
});
assert.deepEqual(resolveFinishPresentation(Number.NaN, 1, 1, false), {
  label: "0 M TO FINISH",
  finalLap: true,
  finalApproach: false,
});
assert.deepEqual(resolveInitialRacePresentation(1, COURSE_LENGTH), {
  totalLaps: 1,
  lapLabel: "LAP 1 / 1",
  finishLabel: "2.5 KM TO FINISH",
});
assert.deepEqual(resolveInitialRacePresentation(5, COURSE_LENGTH), {
  totalLaps: 5,
  lapLabel: "LAP 1 / 5",
  finishLabel: "12.6 KM TO FINISH",
});
assert.deepEqual(resolveInitialRacePresentation(Number.NaN, Number.NaN), {
  totalLaps: 1,
  lapLabel: "LAP 1 / 1",
  finishLabel: "0 M TO FINISH",
});
assert.equal(resolveRaceStage(false, 1, 5), "running");
assert.equal(resolveRaceStage(true, 4, 5), "running");
assert.equal(resolveRaceStage(false, 5, 5), "final");
assert.equal(resolveRaceStage(true, 5, 5), "approach");
assert.equal(formatRacePosition(1, 4), "P1 / 4");
assert.equal(formatRacePosition(2.9, 4), "P2 / 4");
assert.equal(formatRacePosition(12, 4), "P4 / 4");
assert.equal(formatRacePosition(Number.NaN, Number.NaN), "P1 / 1");
assert.equal(formatRaceGap(1, null, 614), "0.61 CLEAR");
assert.equal(formatRaceGap(3, 421, 300), "+0.42 TO P2");
assert.equal(formatRaceGap(4, null, null), "GAP ACQUIRING");
assert.equal(formatRaceGap(1, Number.NaN, Number.NaN), "FIELD LEAD");
assert.deepEqual(resolveBoostPresentation(false, false), {
  label: "PLASMA RESERVE",
  state: "ready",
});
assert.deepEqual(resolveBoostPresentation(true, false), {
  label: "PLASMA DISCHARGE",
  state: "active",
});
assert.deepEqual(resolveBoostPresentation(false, true), {
  label: "BOOST LOCKOUT · RELEASE",
  state: "locked",
});
assert.deepEqual(
  resolveBoostPresentation(true, true),
  { label: "BOOST LOCKOUT · RELEASE", state: "locked" },
  "Manual lockout must remain visible while a course pad supplies boost.",
);

assert.ok(isCircularHazardContact(781.2, -8.4, 781.24, -8.5, COURSE_LENGTH));
assert.ok(isCircularHazardContact(0.8, 7, COURSE_LENGTH - 0.5, 7, COURSE_LENGTH));
assert.ok(!isCircularHazardContact(781.2, 0, 781.24, -8.5, COURSE_LENGTH));
assert.ok(!isCircularHazardContact(790, -8.5, 781.24, -8.5, COURSE_LENGTH));

assert.deepEqual(calculateRecoveryTelemetry(0, 1.4), {
  active: false,
  progress: 0,
  remainingSeconds: 1.4,
});
assert.deepEqual(calculateRecoveryTelemetry(0.7, 1.4), {
  active: true,
  progress: 0.5,
  remainingSeconds: 0.7,
});
assert.deepEqual(calculateRecoveryTelemetry(2, 1.4), {
  active: true,
  progress: 1,
  remainingSeconds: 0,
});
assert.deepEqual(calculateRecoveryTelemetry(Number.NaN, 0), {
  active: false,
  progress: 0,
  remainingSeconds: 0.001,
});

/* ------------------------------------------------------------------ */
/* P11: a missed gate must not be able to softlock the race             */
/* ------------------------------------------------------------------ */

// The failing scenario, from the authored map. A gate is passed when
// |lateral| <= gateWidth/2 at the crossing. Post-P1 the legal lateral limit is
// halfWidth + the authored apron, which on every gate but CP03 is *wider* than
// the gate itself: a player can be legally on the deck's run-off, miss the
// gate, and have nothing in the race loop ever recover them, because the A
// apron never arms the off-course timer. `nextCheckpointIndex` stays frozen and
// the banner stays up for the rest of the race.
const blockout = JSON.parse(
  readFileSync(
    new URL("../src/game/data/greenwater-blockout.json", import.meta.url),
    "utf8",
  ),
);
const stations = blockout.centreline.samples;
const apronWidths = Object.fromEntries(
  Object.entries(blockout.apron.edges).map(([edge, profile]) => [
    edge,
    profile.widthMetres,
  ]),
);
const hangarOverride = blockout.apron.overrides.find(
  (entry) => entry.id === "HANGAR_INTERIOR",
);

function stationAt(distanceMetres) {
  let best = stations[0];
  for (const station of stations) {
    if (Math.abs(station.d - distanceMetres) < Math.abs(best.d - distanceMetres)) {
      best = station;
    }
  }
  return best;
}

let gatesNarrowerThanTheDeck = 0;
for (const checkpoint of blockout.checkpoints) {
  const station = stationAt(checkpoint.distance);
  const inHangar = hangarOverride.sectors.includes(station.sector);
  const legalLateral = station.w / 2
    + (inHangar ? 0 : Math.max(apronWidths[station.edgeL], apronWidths[station.edgeR]));
  if (legalLateral > checkpoint.gateWidth / 2 + 0.01) gatesNarrowerThanTheDeck += 1;
}
assert.ok(
  gatesNarrowerThanTheDeck >= 7,
  `Only ${gatesNarrowerThanTheDeck} of ${blockout.checkpoints.length} gates are `
    + "narrower than the legal lateral limit around them. If this drops to zero "
    + "the softlock is gone by construction and the recovery below is dead code; "
    + "delete it deliberately rather than letting this assertion rot.",
);

// The grace itself. At racing pace the gate is left on screen long enough to be
// read; at a crawl the reset is immediate, because sitting still under a banner
// that never clears is the same softlock by another route.
assert.equal(
  resolveGateMissRecoveryDelay(55),
  GATE_MISS_RECOVERY_GRACE_SECONDS,
  "A miss at racing pace must leave the gate on screen before recovering.",
);
assert.equal(
  resolveGateMissRecoveryDelay(GATE_MISS_RECOVERY_INSTANT_SPEED_MPS),
  GATE_MISS_RECOVERY_GRACE_SECONDS,
  "The instant-recovery band is strictly below the threshold speed.",
);
assert.equal(
  resolveGateMissRecoveryDelay(GATE_MISS_RECOVERY_INSTANT_SPEED_MPS - 0.01),
  0,
  "Below the threshold the craft must be recovered on the next step.",
);
assert.equal(resolveGateMissRecoveryDelay(0), 0);
assert.equal(resolveGateMissRecoveryDelay(Number.NaN), 0);
assert.ok(
  GATE_MISS_RECOVERY_GRACE_SECONDS > 0
    && GATE_MISS_RECOVERY_GRACE_SECONDS <= 2,
  "A grace of 0 s reads as a teleport and one over 2 s reads as a hang.",
);

// The wiring, in the race loop that owns the state machine.
const gameSource = readFileSync(
  new URL("../src/game/game.ts", import.meta.url),
  "utf8",
);
assert.ok(
  gameSource.includes("resolveGateMissRecoveryDelay(this.speed)"),
  "game.ts must arm the gate-miss recovery from the miss branch.",
);
assert.ok(
  gameSource.includes('this.recoverVehicle("gate-miss")'),
  "A missed gate must run the EXISTING recovery flow, not a second placement.",
);
assert.ok(
  /if \(this\.recoveryImmunity > 0\) \{\n\s*this\.gateMissRecoveryCountdown = -1;/
    .test(gameSource),
  "Recovery immunity must disarm a pending gate-miss recovery, or a recovery "
    + "that lands short of the gate can loop.",
);
assert.ok(
  !/recoverVehicle\("gate-miss"\)[\s\S]{0,400}nextCheckpointIndex =/.test(gameSource),
  "The gate-miss recovery must not advance nextCheckpointIndex; the gate has to "
    + "be cleared for real.",
);

console.log(
  "Race rules PASS: countdown, turn urgency, open-edge and hysteretic wrong-way warnings, final-route filtering, forward crossings, wraparound, missed-gate penalty, finish, position, gap and boost presentation, cable contacts, recovery telemetry, "
    + `gate-miss recovery (${gatesNarrowerThanTheDeck} gates narrower than their `
    + `legal lateral, ${GATE_MISS_RECOVERY_GRACE_SECONDS} s grace above `
    + `${GATE_MISS_RECOVERY_INSTANT_SPEED_MPS} m/s).`,
);
