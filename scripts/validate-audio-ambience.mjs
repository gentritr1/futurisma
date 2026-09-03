import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  AMBIENCE_BEDS,
  AMBIENCE_DUCK_DB,
  AMBIENCE_LOOP_SAMPLE_RATE,
  AMBIENCE_LOOP_SECONDS,
  AMBIENCE_LOOP_SEEDS,
  AMBIENCE_PEAK_CEILING,
  AMBIENCE_RMS_BANDS,
  AMBIENCE_RMS_CEILING_DBFS,
  AMBIENCE_SMOOTHING_SECONDS,
  airFilterHz,
  airLayerGain,
  airTearGain,
  ambienceBedIds,
  ambienceDuck,
  bedTargetGain,
  bedWindowGain,
  channelPeak,
  channelRmsDbfs,
  PASS_BY_RELEASE_METERS,
  PASS_BY_TRIGGER_METERS,
  renderAmbienceLoop,
} from "../src/game/ambience-beds.js";
import {
  AUDIO_ZONE_PROFILES,
  DOPPLER_LIMIT,
  dopplerRatio,
  inverseDistanceGain,
  RIVAL_PANNER,
  rivalBoostSignal,
  rivalBrakeSignal,
  SPATIAL_LEAD_CLAMP_METERS,
  spatialLeadSeconds,
  SPEED_OF_SOUND_MPS,
} from "../src/game/audio-space.js";

/**
 * A1 — the ambience bed plan, the level solver, the rival distance/Doppler
 * model and the baked loops themselves.
 *
 * WHAT THIS FILE CANNOT DO, stated up front so nobody reads it as more than it
 * is: node has no Web Audio, and `node-web-audio-api` is not a dependency of
 * this project. Every assertion below is on the SAMPLES and the NUMBERS that
 * feed the graph, never on the graph. The rendered output of the graph itself —
 * per-bed RMS through the real filters, the panner-vs-world agreement and the
 * pass-by L/R swing — is measured in a browser `OfflineAudioContext` by
 * `node scripts/visual/audio-probe.mjs <url>`, which is also the script that
 * produced the `AMBIENCE_RMS_BANDS` numbers this file cross-checks.
 */

const greenwater = JSON.parse(
  readFileSync(
    new URL("../src/game/data/greenwater-blockout.json", import.meta.url),
    "utf8",
  ),
);
const bitterpan = JSON.parse(
  readFileSync(
    new URL("../src/game/data/map02/BITTERPAN_PRODUCTION.json", import.meta.url),
    "utf8",
  ),
);
const lapLength = {
  greenwater: greenwater.centreline.lapLength,
  bitterpan: 3_050,
};

// ---------------------------------------------------------------------------
// The plan itself. A bed with no id, no level and no way of ever being audible
// is the failure this catches — a table entry that reads fine and plays nothing.
// ---------------------------------------------------------------------------

assert.deepEqual(
  Object.keys(AMBIENCE_BEDS).sort(),
  ["bitterpan", "greenwater"],
  "Both shipped maps must author a bed field.",
);

const seenIds = new Set();
for (const [map, beds] of Object.entries(AMBIENCE_BEDS)) {
  assert.ok(beds.length >= 4, `${map} authors only ${beds.length} beds.`);
  for (const bed of beds) {
    assert.ok(bed.id && !seenIds.has(bed.id), `Duplicate bed id ${bed.id}.`);
    seenIds.add(bed.id);
    assert.ok(bed.note.length > 20, `${bed.id} has no authoring note.`);
    assert.ok(
      bed.level > 0 || (bed.event && bed.eventGain > 0),
      `${bed.id} can never be heard: level 0 and no event drives it.`,
    );
    assert.ok(bed.level <= 0.4, `${bed.id} is authored at ${bed.level}; the bus cap is 0.4.`);
    assert.ok(bed.reverbSend >= 0 && bed.reverbSend <= 1);
    if (bed.zone) {
      assert.ok(
        AUDIO_ZONE_PROFILES[bed.zone],
        `${bed.id} boosts inside "${bed.zone}", which is not an authored room.`,
      );
      assert.ok(bed.zoneGain > 1, `${bed.id} declares a zone but does not change in it.`);
    }
    if (bed.kind === "wind") {
      assert.ok(bed.wind, `${bed.id} is a wind bed with no wind profile.`);
      assert.ok(bed.wind.highHz > bed.wind.lowHz);
      assert.ok(bed.wind.lowLfoHz < 0.2 && bed.wind.highLfoHz < 0.2,
        `${bed.id} wanders faster than 0.2 Hz; that is a tremolo, not weather.`);
    } else {
      assert.equal(bed.wind, null);
      assert.ok(
        AMBIENCE_LOOP_SECONDS[bed.id],
        `${bed.id} is a loop bed with no baked loop.`,
      );
      assert.ok(AMBIENCE_LOOP_SEEDS[bed.id], `${bed.id} has no authored seed.`);
    }
    // Every window must be inside its own lap, or a bed silently never plays.
    if (bed.window) {
      assert.ok(bed.window.endDistance > bed.window.startDistance, bed.id);
      assert.ok(
        bed.window.endDistance <= lapLength[map] + 1e-6,
        `${bed.id} runs to ${bed.window.endDistance} m on a ${lapLength[map]} m lap.`,
      );
      assert.ok(bed.window.fadeMeters >= 40, `${bed.id} snaps on in under 40 m.`);
    }
  }
}

// The RMS band table must cover the plan exactly, in both directions.
assert.deepEqual(
  ambienceBedIds().sort(),
  Object.keys(AMBIENCE_RMS_BANDS).sort(),
  "AMBIENCE_RMS_BANDS must name every authored bed and no others.",
);
for (const [id, [low, high]] of Object.entries(AMBIENCE_RMS_BANDS)) {
  assert.ok(high > low, `${id} has an inverted RMS band.`);
  assert.ok(
    high <= AMBIENCE_RMS_CEILING_DBFS,
    `${id} is allowed up to ${high} dBFS; the ambience ceiling is `
      + `${AMBIENCE_RMS_CEILING_DBFS} dBFS.`,
  );
  assert.ok(low > -70, `${id} is allowed to be silent.`);
}

// The Bitterpan windows are authored against the map's own sequences, so pin
// them to the map file rather than to a comment: the conveyor bed must cover
// the authored `underpass` room, and the works bed must start where the score's
// first basin trigger does.
const underpass = bitterpan.audio.zones.find((zone) => zone.startDistance > 1_000);
const conveyor = AMBIENCE_BEDS.bitterpan.find((bed) => bed.id === "conveyor_rattle");
assert.ok(
  conveyor.window.startDistance <= underpass.startDistance
    && conveyor.window.endDistance >= underpass.endDistance,
  `The conveyor bed [${conveyor.window.startDistance}, ${conveyor.window.endDistance}] `
    + `must cover the authored underpass [${underpass.startDistance}, `
    + `${underpass.endDistance}].`,
);
assert.equal(conveyor.zone, "underpass");
const works = AMBIENCE_BEDS.bitterpan.find((bed) => bed.id === "works_hum");
const firstBasinTrigger = bitterpan.music.triggers.find((t) => t.sector === "S1");
assert.equal(
  works.window.startDistance,
  firstBasinTrigger.distance,
  "The works bed must start at the first HARVEST BASIN music trigger.",
);

// Greenwater's two placed beds are authored against sector boundaries, not
// round numbers. If a sector moves, this fails instead of the bed drifting off
// the thing it is supposed to be the sound of.
for (const [id, sector] of [
  ["canopy_chirp", "CANOPY_PASSAGE"],
  ["pump_thrum", "FUEL_ROW"],
]) {
  const bed = AMBIENCE_BEDS.greenwater.find((entry) => entry.id === id);
  const authored = greenwater.sectors.find((entry) => entry.name === sector);
  assert.equal(bed.window.startDistance, authored.startDistance, `${id} start`);
  assert.equal(bed.window.endDistance, authored.endDistance, `${id} end`);
}

// ---------------------------------------------------------------------------
// The level solver.
// ---------------------------------------------------------------------------

const window = { startDistance: 100, endDistance: 200, fadeMeters: 50 };
assert.equal(bedWindowGain(150, 1_000, window), 1);
assert.equal(bedWindowGain(100, 1_000, window), 1);
assert.equal(bedWindowGain(200, 1_000, window), 1);
assert.equal(bedWindowGain(225, 1_000, window), 0.5);
assert.equal(bedWindowGain(250, 1_000, window), 0);
assert.equal(bedWindowGain(75, 1_000, window), 0.5);
assert.equal(bedWindowGain(50, 1_000, window), 0);
assert.equal(bedWindowGain(600, 1_000, window), 0);
assert.equal(bedWindowGain(500, 1_000, null), 1);
assert.equal(bedWindowGain(Number.NaN, 1_000, window), 0);
// The wrap. Bitterpan's conveyor window ends ON the lap seam, so the approach
// ramp for the NEXT lap has to be reachable from the last metres of this one.
const seam = { startDistance: 2_980, endDistance: 3_050, fadeMeters: 70 };
assert.equal(bedWindowGain(3_000, 3_050, seam), 1);
assert.equal(bedWindowGain(0, 3_050, seam), 1);
assert.equal(bedWindowGain(2_945, 3_050, seam), 0.5);
assert.equal(bedWindowGain(2_910, 3_050, seam), 0);
assert.equal(bedWindowGain(2_800, 3_050, seam), 0);

// The duck. -9 dB under a full score, unity under a silent one, monotonic in
// between — a bed that got LOUDER as the music came up would be the bug.
const silent = { trance: 0, jungle: 0, deep_dnb: 0, techstep: 0 };
const full = { trance: 3, jungle: 3, deep_dnb: 3, techstep: 3 };
assert.equal(ambienceDuck(silent), 1);
assert.ok(
  Math.abs(20 * Math.log10(ambienceDuck(full)) - AMBIENCE_DUCK_DB) < 1e-9,
  `A full score ducks the beds by ${(20 * Math.log10(ambienceDuck(full))).toFixed(2)} dB; `
    + `the authored figure is ${AMBIENCE_DUCK_DB} dB.`,
);
let previousDuck = Infinity;
for (let level = 0; level <= 3; level += 0.25) {
  const duck = ambienceDuck({
    trance: level,
    jungle: level,
    deep_dnb: level,
    techstep: level,
  });
  assert.ok(duck < previousDuck, "The duck must fall monotonically with the score.");
  previousDuck = duck;
}
// One loud stem must not duck the field as hard as four.
assert.ok(ambienceDuck({ ...silent, trance: 3 }) > ambienceDuck(full));

// The zone boost and the event term.
const noEvents = { windGust: 0, squall: 0, saltDrop: 0 };
const inside = {
  distanceMeters: 3_000,
  lapLengthMeters: 3_050,
  zone: "underpass",
  events: noEvents,
};
const outsideRoom = { ...inside, zone: "open" };
assert.ok(
  Math.abs(bedTargetGain(conveyor, inside) - conveyor.level * conveyor.zoneGain) < 1e-9,
);
assert.ok(Math.abs(bedTargetGain(conveyor, outsideRoom) - conveyor.level) < 1e-9);
const salt = AMBIENCE_BEDS.bitterpan.find((bed) => bed.id === "salt_patter");
assert.equal(
  bedTargetGain(salt, { ...outsideRoom, events: noEvents }),
  0,
  "The salt bed must be silent with no salt drop.",
);
assert.ok(
  Math.abs(
    bedTargetGain(salt, { ...outsideRoom, events: { ...noEvents, saltDrop: 1 } })
      - salt.eventGain,
  ) < 1e-9,
);
// An event level the track-event phase has not published yet reads as zero, not
// as NaN into an AudioParam.
assert.equal(bedTargetGain(salt, { ...outsideRoom, events: {} }), 0);
assert.equal(
  bedTargetGain(salt, { ...outsideRoom, events: { saltDrop: Number.NaN } }),
  0,
);

// ---------------------------------------------------------------------------
// The crossfade, simulated rather than asserted on the constant.
//
// This is the "beds crossfade within 2.5 s of a sector boundary" criterion. It
// runs the ACTUAL first-order smoother the graph uses, driven by the ACTUAL
// window gain against lap distance at race pace, across the real boundary of a
// real bed — not a step response of the time constant on its own.
// ---------------------------------------------------------------------------

const RACE_PACE_MPS = 85;
const CONTROL_HZ = 30;

function traverse(bed, lap, boundaryMeters, rising) {
  const step = 1 / CONTROL_HZ;
  const alpha = 1 - Math.exp(-step / AMBIENCE_SMOOTHING_SECONDS);
  const state = { distanceMeters: 0, lapLengthMeters: lap, zone: "open", events: noEvents };
  // Settle well before the boundary so the run starts from steady state.
  let distance = boundaryMeters - RACE_PACE_MPS * 6;
  let value = rising ? 0 : bed.level;
  for (let tick = 0; tick < CONTROL_HZ * 6; tick += 1) {
    state.distanceMeters = distance;
    value += (bedTargetGain(bed, state) - value) * alpha;
    distance += RACE_PACE_MPS * step;
  }
  const settled = value;
  const target = rising ? bed.level : 0;
  let elapsed = 0;
  let seconds = Infinity;
  let reached = settled;
  for (let tick = 0; tick < CONTROL_HZ * 12; tick += 1) {
    state.distanceMeters = distance;
    value += (bedTargetGain(bed, state) - value) * alpha;
    distance += RACE_PACE_MPS * step;
    elapsed += step;
    if (rising) reached = Math.max(reached, value);
    else reached = Math.min(reached, value);
    if (
      seconds === Infinity
      && Math.abs(value - target) <= Math.abs(target - settled) * 0.05
    ) {
      seconds = elapsed;
    }
  }
  return { seconds, fraction: bed.level > 0 ? reached / bed.level : 0 };
}

const crossfades = [];
for (const [map, beds] of Object.entries(AMBIENCE_BEDS)) {
  for (const bed of beds) {
    if (!bed.window) continue;
    const lap = lapLength[map];
    const windowSeconds = (bed.window.endDistance - bed.window.startDistance)
      / RACE_PACE_MPS;
    const rise = traverse(bed, lap, bed.window.startDistance - bed.window.fadeMeters, true);
    const fall = traverse(bed, lap, bed.window.endDistance, false);
    crossfades.push([bed.id, rise.seconds, fall.seconds, rise.fraction]);
    assert.ok(
      fall.seconds <= 2.5,
      `${bed.id} takes ${fall.seconds.toFixed(2)} s to leave at ${RACE_PACE_MPS} m/s; `
        + "the crossfade budget is 2.5 s.",
    );
    assert.ok(
      fall.seconds >= 0.6,
      `${bed.id} leaves in ${fall.seconds.toFixed(2)} s; that is a cut, not a crossfade.`,
    );
    if (windowSeconds >= 2.5) {
      assert.ok(
        rise.seconds <= 2.5 && rise.seconds >= 0.6,
        `${bed.id} arrives in ${rise.seconds.toFixed(2)} s; the budget is [0.6, 2.5] s.`,
      );
    } else {
      // Bitterpan's underpass is 85 m — one second at race pace. A bed on a
      // stretch shorter than the crossfade budget cannot reach steady state
      // inside it, and forcing it to would mean cutting it in. The falsifiable
      // claim for a short stretch is that it is clearly PRESENT rather than a
      // suggestion, so assert how far it actually gets.
      assert.ok(
        rise.fraction >= 0.6,
        `${bed.id} only reaches ${(rise.fraction * 100).toFixed(0)} % of its level `
          + `across a ${windowSeconds.toFixed(2)} s stretch; the floor is 60 %.`,
      );
    }
  }
}

const shortStretch = crossfades.filter((row) => row[1] === Infinity);
const measured = crossfades
  .flatMap((row) => (row[1] === Infinity ? [row[2]] : [row[1], row[2]]))
  .filter((value) => Number.isFinite(value));

// ---------------------------------------------------------------------------
// The rival distance model, the Doppler term and the boost/brake signals.
// ---------------------------------------------------------------------------

assert.equal(RIVAL_PANNER.refDistance, 6);
assert.equal(RIVAL_PANNER.maxDistance, 90);
assert.equal(RIVAL_PANNER.distanceModel, "inverse");
assert.equal(inverseDistanceGain(RIVAL_PANNER.refDistance), 1);
assert.equal(inverseDistanceGain(0), 1);
const at15 = inverseDistanceGain(15);
const at60 = inverseDistanceGain(60);
assert.ok(
  at15 > 0.28,
  `A rival 15 m astern reads ${at15.toFixed(3)}; the phase wants it clearly audible.`,
);
assert.ok(
  at60 < 0.1 && at60 > 0.03,
  `A rival at 60 m reads ${at60.toFixed(3)}; the phase wants a whisper, not silence.`,
);
assert.ok(
  20 * Math.log10(at15 / at60) > 10,
  "15 m and 60 m must be more than 10 dB apart or the field has no depth.",
);
// Past `maxDistance` the model must clamp rather than keep falling, which is
// what stops a lapped rival on the far side of the pan from being -80 dB and
// then jumping back in.
assert.equal(inverseDistanceGain(200), inverseDistanceGain(RIVAL_PANNER.maxDistance));
assert.equal(inverseDistanceGain(Number.NaN), 0);

assert.equal(dopplerRatio(0), 1);
assert.ok(dopplerRatio(10) > 1, "Closing must raise the pitch.");
assert.ok(dopplerRatio(-10) < 1, "Opening must lower it.");
assert.ok(Math.abs(dopplerRatio(10) - (1 + 10 / SPEED_OF_SOUND_MPS)) < 1e-12);
assert.equal(dopplerRatio(1_000), 1 + DOPPLER_LIMIT);
assert.equal(dopplerRatio(-1_000), 1 - DOPPLER_LIMIT);
assert.equal(dopplerRatio(Number.NaN), 1);
// The cap has to bite inside the speed range the game actually produces, or it
// is decoration: two craft closing at 40 m/s is an ordinary overtake.
assert.equal(dopplerRatio(40), 1 + DOPPLER_LIMIT);

assert.equal(rivalBoostSignal(0), 0);
assert.equal(rivalBoostSignal(4), 0, "Corner scrub must not read as a boost.");
assert.ok(rivalBoostSignal(13) > 0.4, "A rival boost must be clearly audible.");
assert.equal(rivalBoostSignal(40), 1);
assert.equal(rivalBoostSignal(-20), 0);
assert.equal(rivalBrakeSignal(0), 0);
assert.equal(rivalBrakeSignal(-6), 0, "Lifting off must not hiss.");
assert.ok(rivalBrakeSignal(-20) > 0.6);
assert.equal(rivalBrakeSignal(-40), 1);
assert.equal(rivalBrakeSignal(20), 0);
assert.equal(rivalBoostSignal(Number.NaN), 0);
assert.equal(rivalBrakeSignal(Number.NaN), 0);

// The pass-by hysteresis. Trigger and release must not be the same number or a
// side-by-side pair chatters the cue for a whole corner.
assert.ok(PASS_BY_RELEASE_METERS > PASS_BY_TRIGGER_METERS * 1.5);

// The lag compensation. Both terms have to be in it — a lead built from the
// smoother alone still leaves half a control tick, which at 90 m/s is 1.5 m and
// on its own blows the 1.0 m panner budget the harness asserts.
assert.equal(spatialLeadSeconds(0.018, 1 / 30), 0.018 + 1 / 60);
assert.ok(spatialLeadSeconds(0.018, 1 / 30) * 90 < SPATIAL_LEAD_CLAMP_METERS);
assert.equal(spatialLeadSeconds(Number.NaN, Number.NaN), 0);
assert.equal(spatialLeadSeconds(-1, -1), 0);

// The player's air rises in band as well as in level; a bed that only got
// louder is the "invisible change" this phase was explicitly told to avoid.
assert.ok(airFilterHz(1) > airFilterHz(0) * 3);
assert.ok(airFilterHz(1) < 4_000, "The player's own air must not become a whistle.");
assert.equal(airLayerGain(0), 0);
assert.ok(airLayerGain(1) > airLayerGain(0.5) * 3, "Air must be superlinear in speed.");
assert.equal(airTearGain(1, false), 0, "The tear exists only under boost.");
assert.ok(airTearGain(1, true) > airTearGain(0, true));

// ---------------------------------------------------------------------------
// The baked loops. This is the part node CAN measure directly: the samples the
// graph plays are generated by this module, so their level, their determinism
// and their loop seam are all checkable here.
// ---------------------------------------------------------------------------

const bakeReport = [];
let bakeMs = 0;
for (const id of Object.keys(AMBIENCE_LOOP_SECONDS)) {
  const startedAt = performance.now();
  const channel = renderAmbienceLoop(id, AMBIENCE_LOOP_SAMPLE_RATE);
  bakeMs += performance.now() - startedAt;
  const again = renderAmbienceLoop(id, AMBIENCE_LOOP_SAMPLE_RATE);
  assert.deepEqual(channel, again, `${id} is not deterministic.`);
  assert.equal(
    channel.length,
    Math.ceil(AMBIENCE_LOOP_SECONDS[id] * AMBIENCE_LOOP_SAMPLE_RATE),
    `${id} length`,
  );
  for (const sample of channel) {
    assert.ok(Number.isFinite(sample), `${id} baked a non-finite sample.`);
  }
  const peak = channelPeak(channel);
  const rms = channelRmsDbfs(channel);
  bakeReport.push([id, rms, peak]);
  assert.ok(
    Math.abs(peak - 0.9) < 1e-6,
    `${id} peaks at ${peak.toFixed(3)}; every loop is normalised to 0.9 so the `
      + "authored bed levels stay comparable.",
  );
  assert.ok(peak < AMBIENCE_PEAK_CEILING, `${id} clips.`);
  assert.ok(rms > -40, `${id} is effectively silent at ${rms.toFixed(1)} dBFS.`);
  // A loop whose head and tail disagree clicks once per period, which on a
  // 2 s conveyor loop is a tick every two seconds for the whole lap. Comparing
  // the two end SAMPLES would be meaningless on a noise bed — two independent
  // noise samples differ by anything — so compare the two ENVELOPES, which is
  // what a listener hears jump, plus the DC offset that a slow random walk can
  // leave behind.
  const fadeSamples = Math.min(
    Math.floor(channel.length / 4),
    Math.floor(0.024 * AMBIENCE_LOOP_SAMPLE_RATE),
  );
  // At the end of the crossfade the tail is (all but one part in `fadeSamples`)
  // the head, so the last sample must land on the head's own value there. That
  // is a structural check: it fails if the crossfade is ever dropped, and it
  // does not depend on the content, unlike comparing two noise samples.
  const seam = Math.abs(channel[channel.length - 1] - channel[fadeSamples - 1]);
  assert.ok(
    seam < 0.02,
    `${id} does not crossfade into its own head: the last sample is ${seam.toFixed(4)} `
      + "away from where the loop restarts.",
  );
  // A slow random walk can leave a DC offset behind, which a looping source
  // turns into a thump once per period.
  let dc = 0;
  for (const sample of channel) dc += sample;
  dc /= channel.length;
  assert.ok(Math.abs(dc) < 0.02, `${id} carries ${dc.toFixed(4)} of DC.`);
}

// A different seed must produce a different bed. Two beds sharing a seed by
// copy-paste is the failure that makes the frogs and the rain the same noise.
assert.equal(
  new Set(Object.values(AMBIENCE_LOOP_SEEDS)).size,
  Object.keys(AMBIENCE_LOOP_SEEDS).length,
  "Every baked loop must have its own seed.",
);

// The start-up cost, per map, because it lands on the main thread between the
// start button and the countdown.
const perMap = {};
for (const [map, beds] of Object.entries(AMBIENCE_BEDS)) {
  const ids = ["noise", ...beds.filter((bed) => bed.kind === "loop").map((bed) => bed.id)];
  const startedAt = performance.now();
  for (const id of ids) renderAmbienceLoop(id, AMBIENCE_LOOP_SAMPLE_RATE);
  perMap[map] = performance.now() - startedAt;
  assert.ok(
    perMap[map] < 200,
    `${map} bakes its beds in ${perMap[map].toFixed(0)} ms; that is a visible `
      + "hitch before the countdown.",
  );
}

console.log(
  "Audio ambience PASS: "
    + `${ambienceBedIds().length} beds across two maps, windows pinned to the `
    + "authored sectors and rooms, -9 dB music duck monotonic and exact, "
    + `sector crossfades ${measured.length > 0 ? Math.min(...measured).toFixed(2) : "n/a"}`
    + `-${measured.length > 0 ? Math.max(...measured).toFixed(2) : "n/a"} s `
    + `at 85 m/s (budget 2.5 s; the ${shortStretch.length} stretch(es) shorter than `
    + "that reach "
    + `${shortStretch.map((row) => `${(row[3] * 100).toFixed(0)} %`).join(", ")} `
    + "instead), inverse distance 6/90 m giving "
    + `${(20 * Math.log10(at15 / at60)).toFixed(1)} dB between 15 m and 60 m, `
    + `Doppler capped at +-${(DOPPLER_LIMIT * 100).toFixed(0)} %, and `
    + `${bakeReport.length} deterministic seeded loops baked in `
    + `${bakeMs.toFixed(0)} ms (bitterpan ${perMap.bitterpan.toFixed(0)} ms, `
    + `greenwater ${perMap.greenwater.toFixed(0)} ms).`,
);
