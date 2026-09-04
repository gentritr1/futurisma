import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import {
  admitLine,
  expireQueue,
  gateClearReady,
  nextLine,
  pitRadioPath,
  PIT_RADIO_CLEAN_CHAIN_STEPS,
  PIT_RADIO_EXTENSION,
  PIT_RADIO_GATE_CLEAR_COOLDOWN_SECONDS,
  PIT_RADIO_IDS,
  PIT_RADIO_LINES,
  PIT_RADIO_MAX_QUEUE_AGE_SECONDS,
  PIT_RADIO_MIN_GAP_SECONDS,
  PIT_RADIO_POSITION_HOLD_SECONDS,
  PIT_RADIO_QUEUE_DEPTH,
  radioEdgeState,
  resolveEventLine,
  resolveFrameLines,
} from "../src/game/pit-radio-lines.js";
import { gustChipLabel } from "../src/game/track-events-rules.js";
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
  cityAmbienceBeds,
  tidelineAmbienceBeds,
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

for (const map of ["nightshift", "polarity", "tideline"]) {
  for (const length of [1_958.9, 2_400]) {
    const beds = map === "tideline" ? tidelineAmbienceBeds(length) : cityAmbienceBeds(map, length);
    assert.equal(beds.length, map === "tideline" ? 6 : 5, `${map} needs its authored ambience layers.`);
    assert.equal(new Set(beds.map((bed) => bed.id)).size, beds.length);
    for (const bed of beds) {
      assert.equal(bed.event, null, "City atmosphere must not inherit salt or squall event gain.");
      assert.equal(bed.eventGain, 0);
      assert.ok(bed.level > 0 && bed.level < .2, `${map}/${bed.id} must stay below the craft.`);
      if (bed.kind === "loop") assert.ok(AMBIENCE_LOOP_SECONDS[bed.id]);
      if (bed.window) {
        assert.ok(bed.window.startDistance >= 0 && bed.window.endDistance < length);
        assert.ok(bed.window.endDistance > bed.window.startDistance);
      }
      const at = bed.window ? (bed.window.startDistance + bed.window.endDistance) / 2 : 0;
      assert.ok(bedTargetGain(bed, {
        distanceMeters: at, lapLengthMeters: length, zone: "open", events: {},
      }) > 0, `${map}/${bed.id} must be audible in its district.`);
    }
  }
}
console.log("City ambience PASS: five restrained beds per night map, "
  + "windows scale with lap length; no inherited squall or salt events.");

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
// P20.10 — THE TRACK EVENTS ARE AUDIBLE, which until this phase they were not.
//
// A1 authored `dry_wind.event`, `wetland.event`, `salt_patter.event` and
// `rain_patter.event` against `setEventLevels`; G3 published `trackEventState()`
// and, because `audio.ts` was owned by a phase running beside it, deliberately
// called nothing. So the latch every assertion above exercises was never
// written by a race: a gust changed the picture and not the sound, and every
// check in this file still passed, because they all drive `bedTargetGain` with
// events this file makes up.
//
// The three blocks below are what a re-break would now have to get past.
// ---------------------------------------------------------------------------

// 1. THE SEAM EXISTS. A source read rather than a call, because `track-events.ts`
// is TypeScript and node cannot import it — the same reason this file's header
// gives for measuring the graph in a browser. It is the cheapest assertion here
// and it is the one that would have caught the gap.
const trackEventsSource = readFileSync(
  new URL("../src/game/track-events.ts", import.meta.url),
  "utf8",
);
assert.match(
  trackEventsSource,
  /setEventLevels\s*\(/,
  "track-events.ts must hand its published levels to the ambience latch; "
    + "without that call every event bed below is authored and unreachable.",
);
assert.match(
  trackEventsSource,
  /from "\.\/ambience-cue\.js"/,
  "The ambience latch must be imported from ambience-cue.js, not from audio.ts: "
    + "audio.ts carries the whole engine graph and would pull it into the "
    + "track-event chunk.",
);
// ...and it must not allocate to do it. A fresh object literal inside the
// argument list is 120 allocations a second for the length of a race.
assert.doesNotMatch(
  trackEventsSource,
  /setEventLevels\(\s*\{/,
  "setEventLevels must be handed a reused object, not a literal built per step.",
);

// 2. EVERY EVENT-DRIVEN BED ACTUALLY SWELLS, in decibels rather than in
// "eventGain is greater than zero". The rise is what a listener notices, and a
// 0.02 eventGain on a 0.30 bed is a change of 0.6 dB that nobody would hear.
const EVENT_SWELL_FLOOR_DB = 3;
const eventBeds = Object.values(AMBIENCE_BEDS)
  .flat()
  .filter((bed) => bed.event && bed.eventGain > 0);
assert.ok(eventBeds.length >= 4, "Both maps must carry event-driven beds.");
const eventSwell = [];
for (const bed of eventBeds) {
  const at = (level) => bedTargetGain(bed, {
    distanceMeters: bed.window ? (bed.window.startDistance + bed.window.endDistance) / 2 : 500,
    lapLengthMeters: bed.window ? 3_050 : 3_050,
    zone: "open",
    events: { ...noEvents, [bed.event]: level },
  });
  const rest = at(0);
  const loud = at(1);
  assert.ok(loud > rest, `${bed.id} does not rise with ${bed.event}.`);
  if (rest === 0) {
    // An event-only bed. Its whole existence is the event, so the assertion is
    // that it is silent without one — `AMBIENCE_RMS_BANDS` already describes
    // what it renders at event 1.
    eventSwell.push([bed.id, bed.event, "silent", loud.toFixed(3)]);
    continue;
  }
  const swellDb = 20 * Math.log10(loud / rest);
  assert.ok(
    swellDb >= EVENT_SWELL_FLOOR_DB,
    `${bed.id} swells ${swellDb.toFixed(2)} dB on a full ${bed.event}; under `
      + `${EVENT_SWELL_FLOOR_DB} dB that is a change nobody hears.`,
  );
  eventSwell.push([bed.id, bed.event, `${rest.toFixed(3)}`, `+${swellDb.toFixed(2)} dB`]);
}

// 3. THE TWO EVENT-ONLY LOOPS FIRE, at a level this file can compute for itself.
//
// A looping buffer into a gain is exactly `loop x gain`, and both halves are
// pure JS, so `salt_patter` on a salt drop and `rain_patter` in a squall can be
// put in decibels here rather than only in a browser.
//
// AND THE NUMBER IS AN UPPER BOUND, NOT THE RENDERED LEVEL, which is the whole
// reason this block does not simply assert against `AMBIENCE_RMS_BANDS`. The
// bands were measured through the real graph, and the real graph plays a 24 kHz
// buffer into a 48 kHz context: the resample costs broadband content real
// energy. Measured on 2026-09-03 with `node scripts/visual/audio-probe.mjs`,
// against this same arithmetic — salt_patter node -24.69 vs rendered -26.69
// (2.00 dB), rain_patter node -23.80 vs rendered -25.66 (1.86 dB). So the
// assertion is one-sided: the computed level must not fall BELOW the band (an
// event bed that has gone quiet), and it must sit inside the resample
// allowance ABOVE it rather than being silently accepted anywhere in range.
// The rendered figure remains the browser probe's to own.
const RESAMPLE_ALLOWANCE_DB = 3;
for (const [map, id, event] of [
  ["bitterpan", "salt_patter", "saltDrop"],
  ["greenwater", "rain_patter", "squall"],
]) {
  const bed = AMBIENCE_BEDS[map].find((entry) => entry.id === id);
  const state = {
    distanceMeters: 500,
    lapLengthMeters: lapLength[map],
    zone: "open",
    events: { ...noEvents, [event]: 1 },
  };
  assert.equal(
    bedTargetGain(bed, { ...state, events: noEvents }),
    0,
    `${id} must be silent with no ${event}.`,
  );
  const gain = bedTargetGain(bed, state);
  const loop = renderAmbienceLoop(id, AMBIENCE_LOOP_SAMPLE_RATE);
  const bound = channelRmsDbfs(loop) + 20 * Math.log10(gain);
  const [low, high] = AMBIENCE_RMS_BANDS[id];
  assert.ok(
    bound >= low,
    `${id} at ${event} 1 computes ${bound.toFixed(2)} dBFS, under its authored `
      + `floor of ${low} dBFS before the resample has taken anything: the bed `
      + "has gone quiet.",
  );
  assert.ok(
    bound <= high + RESAMPLE_ALLOWANCE_DB,
    `${id} at ${event} 1 computes ${bound.toFixed(2)} dBFS, more than `
      + `${RESAMPLE_ALLOWANCE_DB} dB over its authored ceiling of ${high} dBFS.`,
  );
  eventSwell.push([id, event, "silent", `${bound.toFixed(2)} dBFS pre-resample`]);
}

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
  "Track events -> ambience PASS: "
    + eventSwell.map((row) => `${row[0]} on ${row[1]} ${row[2]} -> ${row[3]}`).join("; ")
    + ".",
);

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

// ===========================================================================
// H2b — the pit radio
//
// WHAT THIS SECTION CAN AND CANNOT DO, on the same terms as the file header
// above. Node has no Web Audio, so nothing here touches the graph: the
// band-pass, the duck and the click envelope live in `src/game/pit-radio.ts`
// and are measured in a browser by `node scripts/visual/pit-radio-probe.mjs
// <url>`, which is the harness that produces the `linesPlayed` figure a review
// quotes. What IS here is everything that decides WHEN a line plays — the
// table, the priorities, the cooldown, the queue and the two edge resolvers —
// because all of it was put in a plain-JS module for exactly that reason.
// ===========================================================================

const RADIO_DIRECTORY = new URL("../public/assets/audio/radio/", import.meta.url);

// --- the table -------------------------------------------------------------
//
// The priority order is a driver-safety order and is asserted as a LIST rather
// than as a set of inequalities, because "off_course outranks gate_clear" is
// the easy half; the interesting half is that nobody silently reshuffles the
// middle. This is the shipped order and a change to it has to be a change here.

assert.deepEqual(
  PIT_RADIO_IDS,
  [
    "off_course",
    "wrong_way",
    "gate_missed",
    "squall_sweep",
    "gust_left",
    "gust_right",
    "salt_on_span",
    "final_lap",
    "lights_out",
    "classification_locked",
    "new_best_lap",
    "position_lost",
    "position_gained",
    "slipstream_locked",
    "near_miss",
    "clean_chain",
    "gate_clear",
  ],
  "The pit-radio priority order moved. It is the order the driver is protected "
    + "in, not a display order; changing it changes which line is dropped when "
    + "two events land in the same second.",
);
assert.equal(PIT_RADIO_IDS.length, 17, "The voice session recorded 17 lines.");
assert.equal(
  PIT_RADIO_LINES.gust_left.priority,
  PIT_RADIO_LINES.gust_right.priority,
  "The two gust lines must rank equally; a gust is a gust whichever side it is "
    + "from, and ranking one above the other would make the radio's choice "
    + "between them depend on the wind rather than on the queue.",
);
for (const [id, line] of Object.entries(PIT_RADIO_LINES)) {
  assert.match(id, /^[a-z][a-z0-9_]*$/, `Line id "${id}" is not a served filename.`);
  assert.ok(
    typeof line.script === "string" && line.script.trim().length > 0,
    `Line ${id} has no script. The script is what makes the trigger table `
      + "reviewable without opening the audio.",
  );
  assert.ok(
    line.script.endsWith("."),
    `Line ${id}'s script is not a finished sentence: "${line.script}".`,
  );
}

// --- every queued id maps to a served file ---------------------------------
//
// The failure this catches is silent in the browser: an id with no file is a
// `fetch` that 404s, a clip that never lands in the map, and a `speak()` that
// counts a drop. The radio keeps working and one event simply never speaks.

const servedRadioFiles = readdirSync(RADIO_DIRECTORY).sort();
assert.deepEqual(
  servedRadioFiles,
  [...PIT_RADIO_IDS].sort().map((id) => `${id}${PIT_RADIO_EXTENSION}`),
  "The served pit-radio files and the queueable line ids disagree.",
);
let radioServedBytes = 0;
for (const id of PIT_RADIO_IDS) {
  assert.equal(
    pitRadioPath(id),
    `/assets/audio/radio/${id}${PIT_RADIO_EXTENSION}`,
    `pitRadioPath("${id}") does not resolve to the served location.`,
  );
  radioServedBytes += statSync(
    new URL(`${id}${PIT_RADIO_EXTENSION}`, RADIO_DIRECTORY),
  ).size;
}

// --- the queue -------------------------------------------------------------

{
  // A higher priority goes first even when it arrives second. This is what
  // "pre-empts a lower one that has not started" means in a radio that never
  // cuts a line off: it changes the ORDER, not the playback.
  const queue = [];
  assert.equal(admitLine(queue, "gate_clear", 0), 0);
  assert.equal(admitLine(queue, "off_course", 0.1), 0);
  assert.deepEqual(queue.map((entry) => entry.id), ["off_course", "gate_clear"]);

  // The same line twice is one line. A second `near_miss` inside a corner is
  // the same statement, and queueing it would make the radio stutter.
  assert.equal(admitLine(queue, "off_course", 0.2), 1, "A duplicate was queued.");
  assert.deepEqual(queue.map((entry) => entry.id), ["off_course", "gate_clear"]);

  // Equal priorities keep their arrival order.
  assert.equal(admitLine(queue, "gust_left", 0.3), 0);
  assert.deepEqual(
    queue.map((entry) => entry.id),
    ["off_course", "gust_left", "gate_clear"],
  );

  // The queue is full at three. A higher-priority offer evicts the TAIL rather
  // than growing the queue, so `gate_clear` — the lowest line in the table and
  // the most frequent event in the game — is the one that gives way.
  assert.equal(queue.length, PIT_RADIO_QUEUE_DEPTH);
  assert.equal(admitLine(queue, "wrong_way", 0.5), 0);
  assert.deepEqual(
    queue.map((entry) => entry.id),
    ["off_course", "wrong_way", "gust_left"],
    "A higher-priority line did not displace the lowest one.",
  );
  assert.equal(queue.length, PIT_RADIO_QUEUE_DEPTH);

  // ...and an offer no better than the tail is refused outright, rather than
  // displacing something equally urgent that has already been waiting.
  assert.equal(
    admitLine(queue, "salt_on_span", 0.6),
    1,
    "A full queue evicted a line for one no more urgent than its tail.",
  );
  assert.deepEqual(
    queue.map((entry) => entry.id),
    ["off_course", "wrong_way", "gust_left"],
  );
  assert.equal(
    admitLine(queue, "gate_clear", 0.7),
    1,
    "A full queue took the lowest line in the table.",
  );

  // Nothing plays inside the gap after a line ends, and the gap is measured
  // from the END of the last line rather than from its start.
  assert.equal(nextLine(queue, 10, 10), "", "A line spoke inside the minimum gap.");
  assert.equal(
    nextLine(queue, 10 + PIT_RADIO_MIN_GAP_SECONDS - 0.01, 10),
    "",
    "The minimum gap is short by a hair.",
  );
  assert.equal(nextLine(queue, 10 + PIT_RADIO_MIN_GAP_SECONDS, 10), "off_course");
  assert.equal(queue.length, 2);
}

{
  // A line that has waited out its window is dropped, not spoken late.
  const queue = [];
  admitLine(queue, "gate_missed", 1);
  admitLine(queue, "gate_clear", 2);
  assert.equal(expireQueue(queue, 1 + PIT_RADIO_MAX_QUEUE_AGE_SECONDS), 0);
  assert.equal(
    expireQueue(queue, 1 + PIT_RADIO_MAX_QUEUE_AGE_SECONDS + 0.001),
    1,
    "A stale line survived its expiry window.",
  );
  assert.deepEqual(queue.map((entry) => entry.id), ["gate_clear"]);
  assert.equal(nextLine([], 1_000, 0), "", "An empty queue produced a line.");
}

// --- the gate-clear cooldown ----------------------------------------------
//
// Bitterpan authors 8 gates on a lap the headless benchmark runs in 38.05 s, so
// an ungated `gate_clear` is a line every 4.8 s for five laps. Asserted against
// that measured lap rather than against a comment.

{
  const gatesPerLap = 8;
  const bitterpanLapSeconds = 38.05;
  const ungatedInterval = bitterpanLapSeconds / gatesPerLap;
  assert.ok(
    PIT_RADIO_GATE_CLEAR_COOLDOWN_SECONDS > ungatedInterval * 3,
    `The gate-clear cooldown is ${PIT_RADIO_GATE_CLEAR_COOLDOWN_SECONDS} s against a `
      + `gate every ${ungatedInterval.toFixed(1)} s on Bitterpan; that is not a `
      + "cooldown, it is a rounding error.",
  );
  assert.equal(
    gateClearReady(Number.NEGATIVE_INFINITY, 0),
    true,
    "The first gate of a session is silent.",
  );
  assert.equal(gateClearReady(0, PIT_RADIO_GATE_CLEAR_COOLDOWN_SECONDS - 0.001), false);
  assert.equal(gateClearReady(0, PIT_RADIO_GATE_CLEAR_COOLDOWN_SECONDS), true);
}

// --- the five HUD-frame edges ---------------------------------------------
//
// Read off the same `HudFrame` the HUD paints, which is what makes PRODUCT.md's
// "never communicate critical state by audio alone" structural. Asserted as
// EDGES rather than levels: a radio that fires on a level repeats itself for as
// long as the condition holds, which is the failure that would make the voice
// unbearable inside three seconds of running wide.

function radioFrame(patch) {
  return {
    raceActive: true,
    wrongWay: false,
    recoveryActive: false,
    cleanGateChain: 0,
    position: 2,
    racerCount: 4,
    lap: 1,
    lastLapMs: 0,
    ...patch,
  };
}

{
  const state = radioEdgeState();
  const out = [];
  // The first running frame arms the edges and says nothing.
  resolveFrameLines(state, radioFrame({}), 0, out);
  assert.deepEqual(out, [], "The first racing frame spoke without an edge.");

  // Wrong way: once, on the rise, and not again while it holds.
  resolveFrameLines(state, radioFrame({ wrongWay: true }), 0.1, out);
  assert.deepEqual(out, ["wrong_way"]);
  resolveFrameLines(state, radioFrame({ wrongWay: true }), 0.2, out);
  assert.deepEqual(out, [], "wrong_way repeated while the condition held.");
  resolveFrameLines(state, radioFrame({ wrongWay: false }), 0.3, out);
  assert.deepEqual(out, []);

  // Off course: the same shape, on the recovery COUNTDOWN rather than on the
  // recovery itself, because the line is "Recovery in three".
  resolveFrameLines(state, radioFrame({ recoveryActive: true }), 0.4, out);
  assert.deepEqual(out, ["off_course"]);
  resolveFrameLines(state, radioFrame({ recoveryActive: true }), 0.5, out);
  assert.deepEqual(out, []);
  resolveFrameLines(state, radioFrame({ recoveryActive: false }), 0.6, out);

  // The clean-gate chain speaks at 3 and at 6 and at nothing else, on the way
  // UP only. Walking it 1..8 and collecting is a stronger assertion than
  // poking at 3: it catches an off-by-one and an `includes` on the wrong side.
  const spokenAt = [];
  for (let chain = 1; chain <= 8; chain += 1) {
    resolveFrameLines(state, radioFrame({ cleanGateChain: chain }), 1 + chain, out);
    if (out.includes("clean_chain")) spokenAt.push(chain);
  }
  assert.deepEqual(
    spokenAt,
    PIT_RADIO_CLEAN_CHAIN_STEPS,
    "The clean-chain line does not speak at exactly the authored steps.",
  );
  // A chain that collapses and is rebuilt speaks again; a chain that falls
  // through 3 on the way down does not.
  resolveFrameLines(state, radioFrame({ cleanGateChain: 0 }), 20, out);
  assert.deepEqual(out, [], "clean_chain spoke on the way down.");
  resolveFrameLines(state, radioFrame({ cleanGateChain: 3 }), 21, out);
  assert.deepEqual(out, ["clean_chain"], "A rebuilt chain did not speak.");
}

{
  // Position: a change has to HOLD. A swap that reverses inside the window must
  // produce nothing at all, which is the case a naive edge gets wrong by
  // announcing both halves of a fight for one corner.
  const state = radioEdgeState();
  const out = [];
  resolveFrameLines(state, radioFrame({ position: 3 }), 0, out);
  resolveFrameLines(state, radioFrame({ position: 2 }), 1, out);
  assert.deepEqual(out, [], "A position change spoke before it held.");
  resolveFrameLines(state, radioFrame({ position: 3 }), 1.2, out);
  assert.deepEqual(out, [], "A reversed swap announced itself.");
  resolveFrameLines(
    state,
    radioFrame({ position: 3 }),
    1.2 + PIT_RADIO_POSITION_HOLD_SECONDS,
    out,
  );
  assert.deepEqual(out, [], "The radio announced a position it never left.");

  // Held long enough, gained and lost are named the right way round: a LOWER
  // number is a better position.
  resolveFrameLines(state, radioFrame({ position: 2 }), 10, out);
  resolveFrameLines(
    state,
    radioFrame({ position: 2 }),
    10 + PIT_RADIO_POSITION_HOLD_SECONDS,
    out,
  );
  assert.deepEqual(out, ["position_gained"], "A move up the order was called a loss.");
  resolveFrameLines(state, radioFrame({ position: 4 }), 20, out);
  resolveFrameLines(
    state,
    radioFrame({ position: 4 }),
    20 + PIT_RADIO_POSITION_HOLD_SECONDS,
    out,
  );
  assert.deepEqual(out, ["position_lost"], "A move down the order was called a gain.");

  // Alone against the clock there are no positions to change.
  const solo = radioEdgeState();
  resolveFrameLines(solo, radioFrame({ racerCount: 1, position: 1 }), 0, out);
  resolveFrameLines(solo, radioFrame({ racerCount: 1, position: 1 }), 5, out);
  assert.deepEqual(out, [], "Time attack announced a position change.");
}

{
  // New best lap: the first lap of a race sets the mark in silence, because
  // there is nothing yet to beat. Everything after is measured against it.
  const state = radioEdgeState();
  const out = [];
  resolveFrameLines(state, radioFrame({ lap: 1 }), 0, out);
  resolveFrameLines(state, radioFrame({ lap: 2, lastLapMs: 38_400 }), 40, out);
  assert.deepEqual(out, [], "The first lap of a race claimed a new best.");
  resolveFrameLines(state, radioFrame({ lap: 3, lastLapMs: 38_600 }), 80, out);
  assert.deepEqual(out, [], "A slower lap claimed a new best.");
  resolveFrameLines(state, radioFrame({ lap: 4, lastLapMs: 38_050 }), 120, out);
  assert.deepEqual(out, ["new_best_lap"]);
  resolveFrameLines(state, radioFrame({ lap: 5, lastLapMs: 38_050 }), 160, out);
  assert.deepEqual(out, [], "An equalled lap claimed a new best.");

  // Between races every edge is re-armed, so the first frame of the next race
  // cannot speak about the last one.
  resolveFrameLines(state, radioFrame({ raceActive: false, wrongWay: true }), 200, out);
  assert.deepEqual(out, [], "A line fired outside a running race.");
  resolveFrameLines(state, radioFrame({ wrongWay: true }), 201, out);
  assert.deepEqual(out, [], "The new race inherited the old race's wrong-way edge.");
}

// --- the three weather lines ----------------------------------------------
//
// The direction is the assertion worth having, and it is cross-checked against
// the OTHER end of the same invariant rather than against a comment: the HUD's
// arrow is drawn by `gustChipLabel`, `validate-track-events.mjs` already pins
// that arrow against the real integrator's displacement, and the recorded line
// names the side the wind comes FROM. So a positive sign must be a right-arrow
// AND the word "left", and asserting the two together is what stops a later
// edit from flipping one of them alone.

{
  assert.equal(resolveEventLine({ armSerial: 4, lastEvent: "gust", armGustSign: 0 }, 4), "");
  assert.equal(
    resolveEventLine({ armSerial: 5, lastEvent: "gust", armGustSign: 1 }, 4),
    "gust_left",
  );
  assert.equal(
    resolveEventLine({ armSerial: 5, lastEvent: "gust", armGustSign: -1 }, 4),
    "gust_right",
  );
  assert.equal(gustChipLabel(1), "GUST →");
  assert.equal(gustChipLabel(-1), "GUST ←");
  assert.equal(
    resolveEventLine({ armSerial: 6, lastEvent: "salt", armGustSign: 0 }, 5),
    "salt_on_span",
  );
  assert.equal(
    resolveEventLine({ armSerial: 7, lastEvent: "squall", armGustSign: 0 }, 6),
    "squall_sweep",
  );
  assert.equal(resolveEventLine({ armSerial: 1, lastEvent: "", armGustSign: 0 }, 0), "");

  // A gust that arms while its envelope is still at zero must still name a
  // side. This is the whole reason `armGustSign` exists beside `gustSign`, and
  // the SOURCE is asserted rather than a value, because the failure mode is
  // somebody "simplifying" the two fields back into one.
  const trackEventsSource = readFileSync(
    new URL("../src/game/track-events.ts", import.meta.url),
    "utf8",
  );
  assert.ok(
    /published\.armGustSign\s*=\s*gust\.sign/.test(trackEventsSource),
    "track-events.ts must latch `armGustSign` at the ARM. `gustSign` is gated on "
      + "`gustLevel > 0` and is therefore 0 at the telegraph, which is exactly "
      + "when the voice has to name a direction.",
  );
  assert.ok(
    /published\.armSerial\s*=\s*0;/.test(trackEventsSource),
    "track-events.ts must zero `armSerial` on reset, or the first event of the "
      + "second race matches the radio's stored serial and never speaks.",
  );
}

// --- the frame the radio reads is the frame the HUD paints ------------------
//
// A structural assertion, not a behavioural one. If a field the radio triggers
// on ever stops being part of `HudFrame`, the radio starts speaking about state
// the HUD is not showing and PRODUCT.md's accessibility rule quietly stops
// holding. Cheaper to catch here than in a playtest.

{
  const uiSource = readFileSync(new URL("../src/game/ui.ts", import.meta.url), "utf8");
  const hudFrame = uiSource.slice(
    uiSource.indexOf("export interface HudFrame {"),
    uiSource.indexOf("export interface RaceGridEntry {"),
  );
  for (const field of [
    "raceActive",
    "wrongWay",
    "recoveryActive",
    "cleanGateChain",
    "position",
    "racerCount",
    "lap",
    "lastLapMs",
  ]) {
    assert.ok(
      new RegExp(`\\n  ${field}[?]?:`).test(hudFrame),
      `HudFrame no longer carries \`${field}\`, which the pit radio triggers on. `
        + "The radio may only say things the HUD is already showing.",
    );
  }
  assert.ok(
    uiSource.includes("publishRadioFrame(frame);"),
    "ui.ts must publish the HUD frame to the pit radio; that publish is the "
      + "reason the race loop pays no seam-budget lines for this phase.",
  );
}

console.log(
  `Pit radio PASS: ${PIT_RADIO_IDS.length} lines served as `
    + `${(radioServedBytes / 1024).toFixed(1)} KiB, priority order pinned, queue `
    + `depth ${PIT_RADIO_QUEUE_DEPTH} with eviction and dedupe, `
    + `${PIT_RADIO_MIN_GAP_SECONDS} s minimum gap, `
    + `${PIT_RADIO_MAX_QUEUE_AGE_SECONDS} s expiry, gate_clear held to one per `
    + `${PIT_RADIO_GATE_CLEAR_COOLDOWN_SECONDS} s against a gate every 4.8 s, chain `
    + `steps ${PIT_RADIO_CLEAN_CHAIN_STEPS.join(" and ")}, position changes held `
    + `${PIT_RADIO_POSITION_HOLD_SECONDS} s, and the gust word asserted against the `
    + "HUD arrow it deliberately opposes.",
);
