import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  GHOST_FIELDS_PER_FRAME,
  GhostRecorder,
  MAX_GHOST_FRAMES,
} from "../src/game/ghost.js";
import {
  BAKED_LIVERY_CODE,
  bootLiveryToApply,
  liveryFor,
} from "../src/game/liveries.js";
import {
  DEFAULT_LIVERY,
  DEFAULT_RACE_MODE,
  DEFAULT_RIVAL_TIER,
  DEFAULT_TRACK,
  LIVERY_CODES,
  PRESENTATION_MODES,
  QUALITY_MODES,
  RACE_MODES,
  RIVAL_TIERS,
  TRACK_CODES,
  applyRaceResult,
  createSaveStore,
  defaultRecord,
  defaultSave,
  defaultSettings,
  normalizeVolume,
  parseSave,
  serializeSave,
} from "../src/game/save-schema.js";

/**
 * P7 — the save file must never be able to break the game.
 *
 * `src/game/persistence.ts` owns `localStorage` (the single-file exemption the
 * security validator enforces) and delegates every decision to
 * `src/game/save-schema.js`, which is plain JS so it can be attacked here under
 * Node with a stubbed port. The invariant this file proves is blunt: for any
 * input at all — truncated JSON, a 5 MB string, a schema from the future, a
 * storage object that throws — the game gets a usable save and no exception.
 */

const persistenceSource = await readFile(
  new URL("../src/game/persistence.ts", import.meta.url),
  "utf8",
);

// The shipped version constant is the one the fixtures are run against, so this
// suite cannot drift from the file the browser actually loads.
const SCHEMA_VERSION = Number(
  persistenceSource.match(/\bSCHEMA_VERSION\s*=\s*(\d+)\b/)?.[1],
);
assert.ok(
  Number.isInteger(SCHEMA_VERSION) && SCHEMA_VERSION >= 1,
  "src/game/persistence.ts must declare an integer SCHEMA_VERSION.",
);
// P10 bumped the shape to v2 and added the first migration; G4 bumped it to v3.
// If this ever drops back, the v1 and v2 fixtures below stop exercising a
// migration and start exercising an identity — silently, which is the failure
// mode worth an assertion.
assert.ok(
  SCHEMA_VERSION >= 4,
  `SCHEMA_VERSION is ${SCHEMA_VERSION}; v2 introduced the best-lap ghost, v3 the `
    + "per-mode ghost map and per-mode/tier best laps, and v4 the pit radio's "
    + "VOICE setting. This suite proves the whole v1 -> v4 walk is lossless.",
);

// The exemption is only defensible while the exempt file stays thin: one key,
// read and write, and no decisions of its own.
const storageCalls = persistenceSource.match(/\blocalStorage\s*\.\s*\w+\s*\(/g) ?? [];
assert.equal(
  storageCalls.length,
  2,
  `src/game/persistence.ts makes ${storageCalls.length} storage calls; it may make `
    + "exactly two (one getItem, one setItem). Anything else belongs in save-schema.js.",
);
assert.ok(
  /catch\s*\{/.test(persistenceSource),
  "src/game/persistence.ts must guard storage access with try/catch.",
);

// ---------------------------------------------------------------------------
// Shape guards
// ---------------------------------------------------------------------------

function assertUsableSettings(settings, label) {
  assert.ok(settings && typeof settings === "object", `${label}: settings missing.`);
  for (const key of ["masterVolume", "musicVolume"]) {
    const value = settings[key];
    assert.equal(typeof value, "number", `${label}: ${key} is not a number.`);
    assert.ok(Number.isFinite(value), `${label}: ${key} is not finite.`);
    assert.ok(value >= 0 && value <= 1, `${label}: ${key} escaped 0..1 (${value}).`);
  }
  assert.equal(
    typeof settings.reducedMotion,
    "boolean",
    `${label}: reducedMotion is not a boolean.`,
  );
  assert.ok(
    QUALITY_MODES.includes(settings.quality),
    `${label}: quality "${settings.quality}" is not an authored mode.`,
  );
  assert.ok(
    PRESENTATION_MODES.includes(settings.renderMode),
    `${label}: renderMode "${settings.renderMode}" is not an authored mode.`,
  );
}

/**
 * P10 — a record's ghost is either absent or fully-formed. There is no third
 * state: a half-trusted ghost would be interpolated into a pose and drawn.
 */
function assertUsableGhost(ghost, label) {
  assert.ok(
    ghost === null || (typeof ghost === "object" && !Array.isArray(ghost)),
    `${label}: ghost is ${String(ghost)}; it must be null or an object.`,
  );
  if (ghost === null) return;
  assert.equal(ghost.version, 1, `${label}: ghost.version is not the shipped format.`);
  assert.ok(
    Number.isInteger(ghost.sampleHz) && ghost.sampleHz > 0,
    `${label}: ghost.sampleHz is ${String(ghost.sampleHz)}.`,
  );
  assert.ok(
    Number.isInteger(ghost.lapMs) && ghost.lapMs > 0,
    `${label}: ghost.lapMs is ${String(ghost.lapMs)}.`,
  );
  assert.ok(Array.isArray(ghost.frames), `${label}: ghost.frames is not an array.`);
  assert.equal(
    ghost.frames.length % GHOST_FIELDS_PER_FRAME,
    0,
    `${label}: ghost.frames is not a whole number of frames.`,
  );
  assert.ok(
    ghost.frames.length <= MAX_GHOST_FRAMES * GHOST_FIELDS_PER_FRAME,
    `${label}: ghost.frames is past the frame ceiling.`,
  );
  for (const value of ghost.frames) {
    assert.ok(
      Number.isInteger(value),
      `${label}: ghost frame value ${value} is not an integer.`,
    );
  }
}

function assertUsableSave(save, label) {
  assert.ok(save && typeof save === "object", `${label}: save missing.`);
  assert.equal(save.schemaVersion, SCHEMA_VERSION, `${label}: wrong schemaVersion.`);
  assertUsableSettings(save.settings, label);
  assert.ok(
    save.records && typeof save.records === "object" && !Array.isArray(save.records),
    `${label}: records is not a plain object.`,
  );
  for (const [key, record] of Object.entries(save.records)) {
    assert.match(key, /^[A-Z0-9 _-]{1,16}$/, `${label}: record key "${key}" is free-form.`);
    for (const field of ["bestLapMs", "bestRaceMs"]) {
      const value = record[field];
      assert.ok(
        value === null || (typeof value === "number" && Number.isFinite(value) && value > 0),
        `${label}: ${key}.${field} is ${String(value)}.`,
      );
    }
    assert.ok(
      Number.isInteger(record.laps) && record.laps >= 0,
      `${label}: ${key}.laps is ${String(record.laps)}.`,
    );
    // G4 — one ghost per format, and every key has to be a format this build
    // can actually replay. A ghost filed under a name the game does not know is
    // storage that will never be read, which is how a payload ceiling gets
    // spent on nothing.
    assert.ok(
      record.ghosts && typeof record.ghosts === "object" && !Array.isArray(record.ghosts),
      `${label}: ${key}.ghosts is not a plain object.`,
    );
    for (const [mode, ghost] of Object.entries(record.ghosts)) {
      assert.ok(RACE_MODES.includes(mode), `${label}: ${key}.ghosts has mode "${mode}".`);
      assertUsableGhost(ghost, `${label}: ${key}.${mode}`);
    }
    // G4 — the `"<mode>:<tier>"` slots. A slot that exists must hold a real
    // time: the delta chip reads `bestLapMs === null` as "nothing on file", so
    // an empty slot and an absent one have to be the same thing.
    assert.ok(
      record.bests && typeof record.bests === "object" && !Array.isArray(record.bests),
      `${label}: ${key}.bests is not a plain object.`,
    );
    for (const [slot, best] of Object.entries(record.bests)) {
      const [mode, tier] = slot.split(":");
      assert.ok(
        RACE_MODES.includes(mode) && RIVAL_TIERS.includes(tier),
        `${label}: ${key}.bests has slot "${slot}".`,
      );
      assert.ok(
        typeof best.bestLapMs === "number" && Number.isFinite(best.bestLapMs)
          && best.bestLapMs > 0,
        `${label}: ${key}.bests.${slot}.bestLapMs is ${String(best.bestLapMs)}.`,
      );
      assert.ok(
        Array.isArray(best.gateSplitsMs),
        `${label}: ${key}.bests.${slot}.gateSplitsMs is not an array.`,
      );
      // Strictly ascending and all inside the lap. A curve that fails this is
      // refused by `bestLapTimeAtDistanceMs`, so storing one would be storing a
      // chip that silently never works.
      let previous = 0;
      for (const split of best.gateSplitsMs) {
        assert.ok(
          Number.isInteger(split) && split > previous && split < best.bestLapMs,
          `${label}: ${key}.bests.${slot} split ${String(split)} is out of order `
            + `or outside its ${best.bestLapMs} ms lap.`,
        );
        previous = split;
      }
    }
  }
  assert.ok(
    LIVERY_CODES.includes(save.livery),
    `${label}: livery "${save.livery}" is not a shipped decal sheet.`,
  );
  assert.ok(
    TRACK_CODES.includes(save.track),
    `${label}: track "${save.track}" is not an authored circuit.`,
  );
  assert.ok(
    RACE_MODES.includes(save.mode),
    `${label}: mode "${save.mode}" is not a shipped race format.`,
  );
  assert.ok(
    RIVAL_TIERS.includes(save.tier),
    `${label}: tier "${save.tier}" is not a shipped field strength.`,
  );
}

// ---------------------------------------------------------------------------
// Round trip
// ---------------------------------------------------------------------------

/**
 * A ghost the way the game makes one: driven through the real recorder at the
 * real fixed step rather than hand-written, so these fixtures cannot drift from
 * the shape `ghost.js` actually emits.
 */
function recordedGhost(lapMs) {
  const recorder = new GhostRecorder();
  const steps = Math.round(lapMs / (1000 / 120));
  let meters = 0;
  for (let step = 0; step < steps; step += 1) {
    const speed = 70 + 20 * Math.sin(step / 400);
    meters += speed / 120;
    recorder.step(meters, 6 * Math.sin(step / 260), speed, Math.cos(step / 260));
  }
  const recording = recorder.toRecording(lapMs);
  assert.ok(recording, "The persistence fixtures need a recordable lap.");
  return recording;
}

const authored = {
  schemaVersion: SCHEMA_VERSION,
  settings: {
    masterVolume: 0.2,
    musicVolume: 0.55,
    reducedMotion: true,
    quality: "low",
    renderMode: "ps2",
    // H2b, v4. Deliberately the NON-default value: a fixture that round-trips
    // `true` would pass identically against a normalizer that dropped the field
    // and let the default fill it back in.
    voice: false,
  },
  records: {
    // One course with a stored replay, one without — the mixed case is the one
    // that catches a normalizer that only handles the shape it was written for.
    // G4: also one course with several `"<mode>:<tier>"` slots and one with a
    // slot carrying no splits, because a migrated best arrives exactly that way.
    "MAP 01": {
      bestLapMs: 34_512,
      bestRaceMs: 172_640,
      laps: 25,
      ghosts: { race: recordedGhost(34_512) },
      bests: {
        "race:works": {
          bestLapMs: 34_512,
          gateSplitsMs: [4_100, 9_050, 13_800, 18_200, 22_400, 26_100, 29_900, 32_500],
        },
        "timeattack:works": { bestLapMs: 34_010, gateSplitsMs: [] },
      },
    },
    "MAP 02": {
      bestLapMs: 51_004,
      bestRaceMs: null,
      laps: 5,
      ghosts: {},
      bests: { "sprint:feral": { bestLapMs: 51_004, gateSplitsMs: [] } },
    },
  },
  livery: "nightform",
  track: "bitterpan",
  mode: "timeattack",
  tier: "feral",
};
const roundTripped = parseSave(serializeSave(authored), SCHEMA_VERSION);
assert.deepEqual(
  roundTripped,
  authored,
  "A valid v1 payload must round-trip byte-for-byte through parse/serialize.",
);
assertUsableSave(roundTripped, "round trip");

// A default save must itself survive a round trip, or a first run would rewrite
// a file it cannot read back.
assert.deepEqual(
  parseSave(serializeSave(defaultSave(SCHEMA_VERSION)), SCHEMA_VERSION),
  defaultSave(SCHEMA_VERSION),
  "The default save must round-trip.",
);

// ---------------------------------------------------------------------------
// Hostile fixtures. Every one of these must return a usable default save and
// must not throw.
// ---------------------------------------------------------------------------

const hugeString = `"${"A".repeat(5 * 1024 * 1024)}"`;
assert.ok(hugeString.length > 5_000_000, "The oversized fixture must exceed 5 MB.");

const hostile = [
  ["null", null],
  ["undefined", undefined],
  ["empty string", ""],
  ["truncated object", "{"],
  ["json array", "[]"],
  ["json null", "null"],
  ["json number", "42"],
  ["json string", '"greenwater"'],
  ["schema from the future", '{"schemaVersion":99,"settings":{"masterVolume":0.1}}'],
  ["schema as a string", '{"schemaVersion":"1"}'],
  ["missing schema version", '{"settings":{"masterVolume":0.1}}'],
  ["null settings", `{"schemaVersion":${SCHEMA_VERSION},"settings":null}`],
  ["array settings", `{"schemaVersion":${SCHEMA_VERSION},"settings":[]}`],
  [
    "wrong-typed settings",
    `{"schemaVersion":${SCHEMA_VERSION},"settings":{"masterVolume":"loud",`
      + '"musicVolume":true,"reducedMotion":"yes","quality":"ultra","renderMode":7}}',
  ],
  [
    "out-of-range volumes",
    `{"schemaVersion":${SCHEMA_VERSION},"settings":{"masterVolume":9000,"musicVolume":-4}}`,
    // A finite number is a real preference expressed badly, so it clamps rather
    // than resetting; it is the one fixture that legitimately keeps a value.
    "clamps",
  ],
  ["array records", `{"schemaVersion":${SCHEMA_VERSION},"records":[1,2,3]}`],
  [
    "poisoned record values",
    `{"schemaVersion":${SCHEMA_VERSION},"records":{"MAP 01":`
      + '{"bestLapMs":-5,"bestRaceMs":1e308,"laps":"many"}}}',
    // The key is authored, so it survives; every value inside it is scrubbed.
    "scrubs",
  ],
  [
    "free-form record keys",
    `{"schemaVersion":${SCHEMA_VERSION},"records":{"<script>":{"laps":1},`
      + '"a course key far too long to be authored":{"laps":1}}}',
  ],
  [
    "prototype pollution attempt",
    `{"schemaVersion":${SCHEMA_VERSION},"__proto__":{"polluted":true},`
      + '"records":{"__proto__":{"laps":1}}}',
  ],
  ["unknown livery", `{"schemaVersion":${SCHEMA_VERSION},"livery":"stolen"}`],
  ["unknown track", `{"schemaVersion":${SCHEMA_VERSION},"track":"monaco"}`],
  ["livery as an object", `{"schemaVersion":${SCHEMA_VERSION},"livery":{"code":"works"}}`],
  ["oversized payload", hugeString],
  ["oversized valid payload", `{"schemaVersion":${SCHEMA_VERSION},"pad":${hugeString}}`],
  ["binary noise", " �{}\uD800"],
];

assert.ok(hostile.length >= 12, "The hostile fixture set must cover at least 12 inputs.");

for (const [label, payload] of hostile) {
  let save;
  assert.doesNotThrow(() => {
    save = parseSave(payload, SCHEMA_VERSION);
  }, `parseSave threw on ${label}.`);
  assertUsableSave(save, label);
}

// Nothing above may have reached Object.prototype.
assert.equal({}.polluted, undefined, "A fixture polluted Object.prototype.");
assert.equal(defaultRecord().polluted, undefined, "A fixture polluted a record.");

// Every hostile payload except the deliberately-clamping one must land exactly
// on defaults: a rejected field is replaced, never partially trusted.
for (const [label, payload, behaviour] of hostile) {
  if (behaviour === "clamps" || behaviour === "scrubs") continue;
  assert.deepEqual(
    parseSave(payload, SCHEMA_VERSION),
    defaultSave(SCHEMA_VERSION),
    `${label} produced something other than a clean default save.`,
  );
}
// The clamping fixture still has to land inside the legal range at both ends.
const clamped = parseSave(
  `{"schemaVersion":${SCHEMA_VERSION},"settings":{"masterVolume":9000,"musicVolume":-4}}`,
  SCHEMA_VERSION,
);
assert.equal(clamped.settings.masterVolume, 1);
assert.equal(clamped.settings.musicVolume, 0);
// The scrubbing fixture keeps its authored course key and nothing else.
const scrubbed = parseSave(
  `{"schemaVersion":${SCHEMA_VERSION},"records":{"MAP 01":`
    + '{"bestLapMs":-5,"bestRaceMs":1e308,"laps":"many"}}}',
  SCHEMA_VERSION,
);
assert.deepEqual(Object.keys(scrubbed.records), ["MAP 01"]);
assert.deepEqual(scrubbed.records["MAP 01"], defaultRecord());

// ---------------------------------------------------------------------------
// Volume normalization
// ---------------------------------------------------------------------------

assert.equal(normalizeVolume(0.2, 1), 0.2);
assert.equal(normalizeVolume(Number.NaN, 0.5), 0.5);
assert.equal(normalizeVolume(Number.POSITIVE_INFINITY, 0.5), 0.5);
assert.equal(normalizeVolume("0.4", 0.5), 0.5);
assert.equal(normalizeVolume(-3, 0.5), 0);
assert.equal(normalizeVolume(4, 0.5), 1);
// The slider grid has to survive a JSON round trip exactly, or a reload would
// show a value the user never chose.
for (let step = 0; step <= 20; step += 1) {
  const value = normalizeVolume(step / 20, 1);
  assert.equal(
    normalizeVolume(JSON.parse(JSON.stringify(value)), 1),
    value,
    `Volume ${value} did not survive a JSON round trip.`,
  );
}

// ---------------------------------------------------------------------------
// Record folding
// ---------------------------------------------------------------------------

// G4 — every run below declares the slot it was set in, because that is what
// the game does now. `newBestLap` is the MODE record falling and `newOutrightLap`
// is the course's; the two are different comparisons and the suite below is
// mostly about proving they stay different.
const RACE_WORKS = { modeKey: "race:works", ghostKey: "race" };

const firstRun = applyRaceResult(defaultRecord(), {
  ...RACE_WORKS,
  bestLapMs: 40_000,
  raceMs: 205_000,
  laps: 5,
});
assert.equal(firstRun.newBestLap, true, "A first lap time must be a new best.");
assert.equal(firstRun.newBestRace, true, "A first race time must be a new best.");
assert.deepEqual(firstRun.record, {
  bestLapMs: 40_000,
  bestRaceMs: 205_000,
  laps: 5,
  ghosts: {},
  bests: { "race:works": { bestLapMs: 40_000, gateSplitsMs: [] } },
});

const slower = applyRaceResult(firstRun.record, {
  ...RACE_WORKS,
  bestLapMs: 41_000,
  raceMs: 210_000,
  laps: 5,
});
assert.equal(slower.newBestLap, false, "A slower lap must not be a new best.");
assert.equal(slower.newBestRace, false, "A slower race must not be a new best.");
assert.deepEqual(slower.record, {
  bestLapMs: 40_000,
  bestRaceMs: 205_000,
  laps: 10,
  ghosts: {},
  bests: { "race:works": { bestLapMs: 40_000, gateSplitsMs: [] } },
});

const faster = applyRaceResult(slower.record, {
  ...RACE_WORKS,
  bestLapMs: 39_500,
  raceMs: 220_000,
  laps: 5,
});
assert.equal(faster.newBestLap, true, "A faster lap must be a new best.");
assert.equal(faster.newBestRace, false, "Only the faster half may be a new best.");
assert.equal(faster.record.bestLapMs, 39_500);
assert.equal(faster.record.bestRaceMs, 205_000);

// A retired race reports no time; the counter still moves, the records do not.
const retired = applyRaceResult(faster.record, {
  ...RACE_WORKS,
  bestLapMs: null,
  raceMs: null,
  laps: 2,
});
assert.equal(retired.newBestLap, false);
assert.equal(retired.newBestRace, false);
assert.equal(retired.record.bestLapMs, 39_500);
assert.equal(retired.record.laps, 17);

// A poisoned run cannot poison a record.
const poisoned = applyRaceResult(faster.record, {
  ...RACE_WORKS,
  bestLapMs: Number.NaN,
  raceMs: -1,
  laps: Number.POSITIVE_INFINITY,
});
assert.equal(poisoned.record.bestLapMs, 39_500);
assert.equal(poisoned.record.bestRaceMs, 205_000);
assert.equal(poisoned.record.laps, 15);

// ---------------------------------------------------------------------------
// G4 — the mode record and the outright record are different comparisons
//
// This is the assertion the whole per-mode schema exists for. A lap that is
// slower than the circuit's outright best can still be a personal best in the
// format it was set in, and the result screen has to flash for it — a player
// who never beats their `works` time would otherwise never see `NEW BEST`
// again, whatever they did in `rookie`.
// ---------------------------------------------------------------------------

{
  // 39,500 outright on this course, set in race:works above.
  const rookieFirst = applyRaceResult(faster.record, {
    modeKey: "race:rookie",
    ghostKey: "race",
    bestLapMs: 42_000,
    raceMs: 215_000,
    laps: 5,
    gateSplitsMs: [5_000, 11_000, 17_000, 24_000],
  });
  assert.equal(
    rookieFirst.newBestLap,
    true,
    "A first lap in a new mode/tier slot must be that slot's best, even though "
      + "it is slower than the course's outright record.",
  );
  assert.equal(
    rookieFirst.newOutrightLap,
    false,
    "A slower lap moved the course's outright record.",
  );
  assert.equal(
    rookieFirst.record.bestLapMs,
    39_500,
    "The outright record was overwritten by a slower mode record.",
  );
  assert.equal(rookieFirst.record.bests["race:rookie"].bestLapMs, 42_000);
  assert.deepEqual(
    rookieFirst.record.bests["race:rookie"].gateSplitsMs,
    [5_000, 11_000, 17_000, 24_000],
    "A new mode best did not store the splits it was set with.",
  );
  assert.equal(
    rookieFirst.record.bests["race:works"].bestLapMs,
    39_500,
    "Writing one slot disturbed another.",
  );
  assert.equal(
    rookieFirst.previousBestLapMs,
    null,
    "A first lap in a slot reported a previous best.",
  );

  // And the reverse: a lap that beats the outright record but not this slot's.
  const seeded = applyRaceResult(rookieFirst.record, {
    modeKey: "sprint:works",
    ghostKey: "sprint",
    bestLapMs: 38_000,
    raceMs: 80_000,
    laps: 2,
  });
  assert.equal(seeded.newOutrightLap, true);
  assert.equal(seeded.record.bestLapMs, 38_000);
  const sprintSlower = applyRaceResult(seeded.record, {
    modeKey: "sprint:works",
    ghostKey: "sprint",
    bestLapMs: 38_500,
    raceMs: 79_000,
    laps: 2,
  });
  assert.equal(sprintSlower.newBestLap, false);
  assert.equal(
    sprintSlower.previousBestLapMs,
    38_000,
    "The result screen was handed the wrong previous best to measure against.",
  );

  // Splits that do not describe the lap they arrive with are dropped, and the
  // TIME still lands. Losing a split table must never cost a personal best.
  const badSplits = applyRaceResult(defaultRecord(), {
    modeKey: "race:works",
    ghostKey: "race",
    bestLapMs: 30_000,
    raceMs: 150_000,
    laps: 5,
    gateSplitsMs: [5_000, 4_000, 40_000],
  });
  assert.equal(badSplits.newBestLap, true, "Bad splits cost a real best lap.");
  assert.deepEqual(
    badSplits.record.bests["race:works"].gateSplitsMs,
    [],
    "A non-ascending split table was stored.",
  );

  // A run that names no slot writes no slot, and cannot flash NEW BEST.
  const unslotted = applyRaceResult(defaultRecord(), {
    bestLapMs: 31_000,
    raceMs: 150_000,
    laps: 5,
  });
  assert.equal(unslotted.newBestLap, false);
  assert.deepEqual(unslotted.record.bests, {});
  assert.equal(
    unslotted.record.bestLapMs,
    31_000,
    "The outright record is not slot-gated and must still move.",
  );

  // An unauthored slot name is refused rather than written.
  const forged = applyRaceResult(defaultRecord(), {
    modeKey: "race:cheat",
    ghostKey: "race",
    bestLapMs: 20_000,
    raceMs: 100_000,
    laps: 5,
  });
  assert.deepEqual(forged.record.bests, {}, "An unauthored mode/tier slot was written.");
}

// ---------------------------------------------------------------------------
// The store, against stubbed storage ports
// ---------------------------------------------------------------------------

function memoryPort(initial = null) {
  const cell = { text: initial, writes: 0 };
  return {
    cell,
    port: {
      read: () => cell.text,
      write: (text) => {
        cell.text = text;
        cell.writes += 1;
      },
    },
  };
}

{
  const { cell, port } = memoryPort();
  const store = createSaveStore(port, SCHEMA_VERSION);
  assert.equal(store.mode, "storage", "A working port must report storage mode.");
  assert.deepEqual(store.settings, defaultSettings());
  assert.equal(store.livery, DEFAULT_LIVERY);

  store.updateSettings({ masterVolume: 0.2 });
  assert.equal(store.settings.masterVolume, 0.2);
  assert.ok(cell.writes > 0, "A settings change must write through.");

  store.setLivery("needle");
  store.setTrack("bitterpan");
  store.setRaceMode("sprint");
  store.setTier("feral");
  const result = store.recordRace("MAP 01", {
    ...RACE_WORKS,
    bestLapMs: 34_000,
    raceMs: 170_000,
    laps: 5,
    gateSplitsMs: [4_000, 9_000, 15_000, 22_000, 28_000],
  });
  assert.equal(result.newBestLap, true);

  // The reload: a fresh store over the same cell must see everything back.
  const reloaded = createSaveStore(port, SCHEMA_VERSION);
  assert.equal(reloaded.settings.masterVolume, 0.2, "masterVolume did not survive a reload.");
  assert.equal(reloaded.livery, "needle", "The livery did not survive a reload.");
  assert.equal(reloaded.track, "bitterpan", "The track did not survive a reload.");
  // G4 — the dispatched format and field, which a bare reload has to land on.
  assert.equal(reloaded.raceMode, "sprint", "The race format did not survive a reload.");
  assert.equal(reloaded.tier, "feral", "The rival tier did not survive a reload.");
  assert.deepEqual(
    reloaded.bestFor("MAP 01", "race:works").gateSplitsMs,
    [4_000, 9_000, 15_000, 22_000, 28_000],
    "The gate splits did not survive a reload.",
  );
  assert.equal(
    reloaded.bestFor("MAP 01", "race:feral").bestLapMs,
    null,
    "An unraced slot reported a best lap.",
  );
  assert.equal(reloaded.recordFor("MAP 01").bestLapMs, 34_000, "The best lap did not survive.");
  assert.equal(reloaded.recordFor("MAP 02").bestLapMs, null, "An untouched course must be blank.");
  assertUsableSave(JSON.parse(cell.text), "written payload");
}

{
  // Quota exceeded on the very first write: the store degrades and keeps going.
  const store = createSaveStore(
    {
      read: () => null,
      write: () => {
        const error = new Error("QuotaExceededError");
        error.name = "QuotaExceededError";
        throw error;
      },
    },
    SCHEMA_VERSION,
  );
  assert.equal(store.mode, "storage", "The store cannot know about quota before it writes.");
  assert.doesNotThrow(
    () => store.updateSettings({ musicVolume: 0.5 }),
    "A quota-exceeded write must not throw into the game.",
  );
  assert.equal(store.mode, "memory", "A refused write must degrade to memory mode.");
  assert.equal(store.writeFailures, 1);
  // In-memory state still works, and no further writes are attempted.
  assert.equal(store.settings.musicVolume, 0.5);
  assert.doesNotThrow(() => store.setLivery("privateer"));
  assert.equal(store.livery, "privateer");
  assert.equal(store.writeFailures, 1, "The store must stop retrying a dead port.");
}

{
  // Reading throws (storage revoked / blocked site data): start fresh, in mode
  // storage, because a write may still succeed.
  const store = createSaveStore(
    {
      read: () => {
        throw new Error("SecurityError");
      },
      write: () => undefined,
    },
    SCHEMA_VERSION,
  );
  assert.deepEqual(store.settings, defaultSettings());
  assert.equal(store.mode, "storage");
}

{
  // No port at all: the browser refused to hand over a storage object.
  const store = createSaveStore(null, SCHEMA_VERSION);
  assert.equal(store.mode, "memory", "A missing port must report memory mode.");
  assert.doesNotThrow(() => store.updateSettings({ quality: "high" }));
  assert.equal(store.settings.quality, "high");
  assert.deepEqual(store.recordFor("MAP 01"), defaultRecord());
}

{
  // A hostile payload already sitting in storage must not stop a clean session.
  for (const [label, payload] of hostile) {
    const { port } = memoryPort(typeof payload === "string" ? payload : null);
    let store;
    assert.doesNotThrow(() => {
      store = createSaveStore(port, SCHEMA_VERSION);
    }, `createSaveStore threw on stored ${label}.`);
    assertUsableSettings(store.settings, `stored ${label}`);
    assert.equal(store.livery, DEFAULT_LIVERY, `stored ${label} leaked a livery.`);
    assert.equal(store.track, DEFAULT_TRACK, `stored ${label} leaked a track.`);
    assert.deepEqual(
      store.recordFor("MAP 01"),
      defaultRecord(),
      `stored ${label} leaked a course record.`,
    );
    assert.doesNotThrow(
      () => store.recordRace("MAP 01", { bestLapMs: 1, raceMs: 2, laps: 1 }),
      `recordRace threw after stored ${label}.`,
    );
  }
}

{
  // An unauthored course key is refused rather than written.
  const { cell, port } = memoryPort();
  const store = createSaveStore(port, SCHEMA_VERSION);
  store.recordRace("../../etc/passwd", { bestLapMs: 1, raceMs: 2, laps: 1 });
  assert.equal(cell.writes, 0, "An unauthored course key must not reach storage.");
}

// ---------------------------------------------------------------------------
// P10 / G4 — the migration ladder
//
// v1 → v2 added an optional best-lap ghost to each course record. Additive
// migrations are the easy case and are still where files get lost, because the
// temptation is to write the new shape to a new key and leave the old one
// stranded. What follows proves the opposite: every v1 field arrives with its
// value intact, and nothing about the read path depends on the ghost.
//
// G4's v2 → v3 is the harder case, and it is proved separately below: it
// RELOCATES a field rather than adding one. The v1 fixture now walks BOTH rungs
// in one parse, which is the walk a player who has not opened the game since
// P10 actually performs.
// ---------------------------------------------------------------------------

const v1Payload = {
  schemaVersion: 1,
  settings: {
    masterVolume: 0.35,
    musicVolume: 0.7,
    reducedMotion: true,
    quality: "high",
    renderMode: "ps2",
  },
  records: {
    "MAP 01": { bestLapMs: 33_101, bestRaceMs: 168_402, laps: 42 },
    "MAP 02": { bestLapMs: 50_777, bestRaceMs: null, laps: 7 },
  },
  livery: "needle",
  track: "bitterpan",
};

const migrated = parseSave(JSON.stringify(v1Payload), SCHEMA_VERSION);
assertUsableSave(migrated, "v1 migration");
assert.equal(migrated.schemaVersion, SCHEMA_VERSION, "The migration did not stamp v2.");

// Field by field, because "it looks the same" is how a migration quietly drops
// the one setting nobody tests for. The two volumes are compared through the
// slider grid rather than raw: snapping to it is v1 behaviour that predates the
// migration and is proven separately above, so measuring against it here keeps
// this assertion about the migration and nothing else.
const VOLUME_KEYS = new Set(["masterVolume", "musicVolume"]);
for (const [key, expected] of Object.entries(v1Payload.settings)) {
  const want = VOLUME_KEYS.has(key) ? normalizeVolume(expected, -1) : expected;
  assert.equal(
    migrated.settings[key],
    want,
    `The v1 -> v2 migration lost settings.${key}: `
      + `${String(migrated.settings[key])} != ${String(want)}.`,
  );
}
assert.equal(migrated.livery, v1Payload.livery, "The migration lost the livery.");
assert.equal(migrated.track, v1Payload.track, "The migration lost the track.");
assert.deepEqual(
  Object.keys(migrated.records).sort(),
  Object.keys(v1Payload.records).sort(),
  "The migration lost a course record.",
);
for (const [key, expected] of Object.entries(v1Payload.records)) {
  const actual = migrated.records[key];
  assert.equal(actual.bestLapMs, expected.bestLapMs, `${key}: bestLapMs did not migrate.`);
  assert.equal(actual.bestRaceMs, expected.bestRaceMs, `${key}: bestRaceMs did not migrate.`);
  assert.equal(actual.laps, expected.laps, `${key}: laps did not migrate.`);
  // The field v2 adds. A v1 file has no ghost, and inventing one would be worse
  // than having none: the player would race a lap they never drove.
  assert.deepEqual(actual.ghosts, {}, `${key}: the migration invented a ghost.`);
  // The fields v3 adds. The v1 best lap was necessarily set in `race` at the
  // `works` pace — neither of the other choices existed — so the slot it
  // belongs in is knowable rather than guessable, and seeding it is what keeps
  // `NEW BEST` honest for a returning player. The splits are EMPTY rather than
  // invented: v1 never recorded any, and a fabricated curve would print deltas
  // against a lap nobody drove.
  assert.deepEqual(
    actual.bests,
    { "race:works": { bestLapMs: expected.bestLapMs, gateSplitsMs: [] } },
    `${key}: the v1 best lap did not land in the race:works slot.`,
  );
}
// The file-level fields v3 adds. A v1 file names no format, and the defaults
// are the two a v1 build raced, so the upgrade lands the player where they left.
assert.equal(migrated.mode, DEFAULT_RACE_MODE, "The migration invented a race format.");
assert.equal(migrated.tier, DEFAULT_RIVAL_TIER, "The migration invented a rival tier.");
// H2b — and the field v4 adds. A v1 file predates the pit radio entirely, so
// the only honest answer is the default a fresh install gets. Asserted against
// `defaultSettings()` rather than against a literal `true`, so flipping the
// default later moves this with it instead of leaving a fixture that pins a
// value the game no longer ships.
assert.equal(
  migrated.settings.voice,
  defaultSettings().voice,
  "The v1 -> v4 walk did not land settings.voice on the shipped default.",
);

// The migration is not a one-way door out of the game: what it produces must
// itself round-trip, or the next reload would migrate a v2 file all over again.
assert.deepEqual(
  parseSave(serializeSave(migrated), SCHEMA_VERSION),
  migrated,
  "A migrated save did not round-trip as v2.",
);

// A v1 file loaded through the store writes itself back as v2, on the same key,
// with everything still readable. This is the actual upgrade a player performs.
{
  const { cell, port } = memoryPort(JSON.stringify(v1Payload));
  const store = createSaveStore(port, SCHEMA_VERSION);
  assert.equal(store.recordFor("MAP 01").bestLapMs, 33_101, "The upgrade lost a best lap.");
  assert.equal(store.livery, "needle", "The upgrade lost the livery.");
  store.setTrack("greenwater");
  const written = JSON.parse(cell.text);
  assert.equal(written.schemaVersion, SCHEMA_VERSION, "The upgrade wrote the old version.");
  assert.equal(
    written.records["MAP 01"].bestLapMs,
    33_101,
    "The upgrade wrote a file that had lost the v1 best lap.",
  );
  const reloaded = createSaveStore(port, SCHEMA_VERSION);
  assert.equal(reloaded.recordFor("MAP 01").laps, 42, "The upgraded file did not reload.");
  assert.equal(reloaded.recordFor("MAP 02").bestLapMs, 50_777);
}

// Versions the ladder does not reach are still discarded whole, exactly as
// before the ladder existed.
for (const version of [0, -1, 1.5, SCHEMA_VERSION + 1, 99, "1", null, true]) {
  const payload = JSON.stringify({ ...v1Payload, schemaVersion: version });
  assert.deepEqual(
    parseSave(payload, SCHEMA_VERSION),
    defaultSave(SCHEMA_VERSION),
    `Schema version ${String(version)} was migrated instead of discarded.`,
  );
}

// ---------------------------------------------------------------------------
// G4 — v2 → v3, the RELOCATING migration
//
// Every other rung on this ladder has been additive. This one moves a field:
// `records[course].ghost` becomes `records[course].ghosts.race`. A relocation
// is where a migration actually loses something, because the old field simply
// stops being read and nothing fails — the player just quietly has no replay
// any more, which reads as a wipe even though every lap TIME survived.
//
// So the ghost is compared frame for frame, not merely checked for presence.
// ---------------------------------------------------------------------------

{
  const v2Ghost = recordedGhost(34_512);
  const v2Payload = {
    schemaVersion: 2,
    settings: {
      masterVolume: 0.65,
      musicVolume: 0.4,
      reducedMotion: true,
      quality: "low",
      renderMode: "ps2",
    },
    records: {
      "MAP 01": { bestLapMs: 34_512, bestRaceMs: 171_000, laps: 31, ghost: v2Ghost },
      "MAP 02": { bestLapMs: 49_880, bestRaceMs: null, laps: 8, ghost: null },
    },
    livery: "privateer",
    track: "bitterpan",
  };
  const upgraded = parseSave(JSON.stringify(v2Payload), SCHEMA_VERSION);
  assertUsableSave(upgraded, "v2 migration");

  // Nothing v2 already had may move.
  assert.equal(upgraded.livery, "privateer", "The v2 -> v3 migration lost the livery.");
  assert.equal(upgraded.track, "bitterpan", "The v2 -> v3 migration lost the track.");
  assert.equal(upgraded.settings.quality, "low", "The v2 -> v3 migration lost a setting.");
  assert.equal(
    upgraded.settings.renderMode,
    "ps2",
    "The v2 -> v3 migration lost the image pipeline.",
  );
  for (const [key, expected] of Object.entries(v2Payload.records)) {
    assert.equal(upgraded.records[key].bestLapMs, expected.bestLapMs, `${key}: best lap lost.`);
    assert.equal(upgraded.records[key].laps, expected.laps, `${key}: lap count lost.`);
  }

  // The relocation itself, frame for frame.
  assert.deepEqual(
    upgraded.records["MAP 01"].ghosts.race,
    v2Ghost,
    "The v2 -> v3 migration did not carry the stored ghost into ghosts.race.",
  );
  assert.deepEqual(
    upgraded.records["MAP 02"].ghosts,
    {},
    "The migration invented a ghost for a course that had none.",
  );
  assert.equal(
    upgraded.records["MAP 01"].ghost,
    undefined,
    "The old per-course ghost field survived the migration; it must be moved, "
      + "not duplicated, or the payload pays for the same replay twice.",
  );

  // The v2 best lap seeds the slot it was necessarily set in.
  assert.deepEqual(
    upgraded.records["MAP 01"].bests,
    { "race:works": { bestLapMs: 34_512, gateSplitsMs: [] } },
    "The v2 best lap did not seed race:works.",
  );

  // A migrated v3 file has to round-trip, or every reload would migrate again.
  assert.deepEqual(
    parseSave(serializeSave(upgraded), SCHEMA_VERSION),
    upgraded,
    "A migrated v2 save did not round-trip as v3.",
  );

  // The upgrade a player actually performs: load a v2 file through the store,
  // write once, reload. The replay and the livery both have to be there after.
  const { cell, port } = memoryPort(JSON.stringify(v2Payload));
  const store = createSaveStore(port, SCHEMA_VERSION);
  assert.equal(store.livery, "privateer", "The v2 upgrade lost the livery.");
  assert.ok(store.ghostFor("MAP 01", "race"), "The v2 upgrade lost the stored replay.");
  store.setTier("feral");
  const written = JSON.parse(cell.text);
  assert.equal(written.schemaVersion, SCHEMA_VERSION, "The upgrade wrote the old version.");
  const reloaded = createSaveStore(port, SCHEMA_VERSION);
  assert.deepEqual(
    reloaded.ghostFor("MAP 01", "race"),
    v2Ghost,
    "The replay did not survive the v2 upgrade's own write.",
  );
  assert.equal(
    reloaded.bestFor("MAP 01", "race:works").bestLapMs,
    34_512,
    "The v2 best lap did not survive the upgrade's own write.",
  );
  assert.equal(reloaded.livery, "privateer", "The livery did not survive the upgrade.");
  assert.equal(reloaded.tier, "feral");
  // A v2 ghost is only reachable under the mode it was actually set in.
  assert.equal(
    reloaded.ghostFor("MAP 01", "timeattack"),
    null,
    "A v2 race ghost was offered as a time-attack replay.",
  );
}

// ---------------------------------------------------------------------------
// H2b — v3 → v4, the cheapest rung, tested anyway
//
// The step is an identity: v4 adds `settings.voice` and nothing moves. The
// reason it still gets a fixture is that "purely additive" is exactly the claim
// that goes wrong silently — a normalizer that rejects the whole settings
// object when it meets an unknown shape, or a ladder entry wired to the wrong
// `from`, produces a defaulted save that LOOKS fine and has quietly thrown away
// a returning player's levels, their livery and their record line.
//
// So this asserts the boring thing loudly: every v3 field arrives with its own
// value, and the one new field arrives with the shipped default.
// ---------------------------------------------------------------------------

{
  const v3Ghost = recordedGhost(33_400);
  const v3Payload = {
    schemaVersion: 3,
    settings: {
      masterVolume: 0.45,
      musicVolume: 0.15,
      reducedMotion: true,
      quality: "high",
      renderMode: "ps2",
    },
    records: {
      "MAP 01": {
        bestLapMs: 33_400,
        bestRaceMs: 169_100,
        laps: 17,
        ghosts: { timeattack: v3Ghost },
        bests: {
          "timeattack:feral": { bestLapMs: 33_400, gateSplitsMs: [4_000, 9_000, 14_000] },
        },
      },
    },
    livery: "needle",
    track: "greenwater",
    mode: "timeattack",
    tier: "feral",
  };
  const upgraded = parseSave(JSON.stringify(v3Payload), SCHEMA_VERSION);
  assertUsableSave(upgraded, "v3 migration");
  assert.equal(upgraded.schemaVersion, SCHEMA_VERSION);

  for (const [key, expected] of Object.entries(v3Payload.settings)) {
    const want = VOLUME_KEYS.has(key) ? normalizeVolume(expected, -1) : expected;
    assert.equal(
      upgraded.settings[key],
      want,
      `The v3 -> v4 migration lost settings.${key}.`,
    );
  }
  assert.equal(upgraded.livery, "needle", "The v3 -> v4 migration lost the livery.");
  assert.equal(upgraded.track, "greenwater", "The v3 -> v4 migration lost the track.");
  assert.equal(upgraded.mode, "timeattack", "The v3 -> v4 migration lost the format.");
  assert.equal(upgraded.tier, "feral", "The v3 -> v4 migration lost the tier.");
  assert.equal(
    upgraded.settings.voice,
    defaultSettings().voice,
    "The v3 -> v4 migration did not default settings.voice.",
  );
  // The replay and the per-mode best are the two things a wipe would take, so
  // they are compared rather than counted.
  assert.deepEqual(
    upgraded.records["MAP 01"].ghosts.timeattack,
    v3Ghost,
    "The v3 -> v4 migration lost the stored replay.",
  );
  assert.deepEqual(
    upgraded.records["MAP 01"].bests["timeattack:feral"],
    { bestLapMs: 33_400, gateSplitsMs: [4_000, 9_000, 14_000] },
    "The v3 -> v4 migration lost a per-mode best lap or its splits.",
  );
  assert.deepEqual(
    parseSave(serializeSave(upgraded), SCHEMA_VERSION),
    upgraded,
    "A migrated v3 save did not round-trip as v4.",
  );

  // A stored `voice: false` is a CHOICE and must survive the walk, which is the
  // half an identity step could still get wrong if `normalizeSettings` gained
  // its guard before the ladder gained its rung.
  const quiet = parseSave(
    JSON.stringify({ ...v3Payload, settings: { ...v3Payload.settings, voice: false } }),
    SCHEMA_VERSION,
  );
  assert.equal(quiet.settings.voice, false, "A stored VOICE=OFF did not survive the walk.");
  // ...and a hostile one is refused rather than coerced.
  for (const hostile of ["false", 0, null, {}, []]) {
    const poisoned = parseSave(
      JSON.stringify({ ...v3Payload, settings: { ...v3Payload.settings, voice: hostile } }),
      SCHEMA_VERSION,
    );
    assert.equal(
      poisoned.settings.voice,
      defaultSettings().voice,
      `settings.voice accepted ${JSON.stringify(hostile)} instead of defaulting.`,
    );
  }
}

// ---------------------------------------------------------------------------
// P10 — a bad ghost costs a replay, never a lap time
// ---------------------------------------------------------------------------

const goodGhost = recordedGhost(34_010);

function saveWithGhost(ghost) {
  return JSON.stringify({
    schemaVersion: SCHEMA_VERSION,
    settings: defaultSettings(),
    records: {
      "MAP 01": {
        bestLapMs: 34_010,
        bestRaceMs: 170_500,
        laps: 9,
        // G4 — a SECOND, good replay sits beside the hostile one. A guard that
        // scrubbed the whole ghost map on one bad entry would pass every
        // assertion below without this: a corrupted sprint replay must not take
        // the time-attack one down with it.
        ghosts: { race: ghost, timeattack: goodGhost },
        bests: { "race:works": { bestLapMs: 34_010, gateSplitsMs: [] } },
      },
    },
    livery: DEFAULT_LIVERY,
    track: DEFAULT_TRACK,
    mode: DEFAULT_RACE_MODE,
    tier: DEFAULT_RIVAL_TIER,
  });
}

const hostileGhosts = [
  ["a truncated ghost", { ...goodGhost, frames: goodGhost.frames.slice(0, 37) }],
  ["an empty-frame ghost", { ...goodGhost, frames: [] }],
  ["a ghost from a future format", { ...goodGhost, version: 7 }],
  ["a ghost with no version", { sampleHz: 20, lapMs: 34_010, frames: goodGhost.frames }],
  ["a ghost with a NaN frame", { ...goodGhost, frames: goodGhost.frames.map(() => null) }],
  ["a ghost whose frames are a string", { ...goodGhost, frames: "0,0,0,0" }],
  ["a ghost that is an array", [1, 2, 3]],
  ["a ghost that is a number", 42],
  ["a ghost that is a string", "34.010"],
  ["a ghost that is true", true],
  ["a ghost with a zero lap time", { ...goodGhost, lapMs: 0 }],
  ["a ghost that runs backwards", {
    ...goodGhost,
    frames: goodGhost.frames.map((value, index) => (index === 4 ? -900 : value)),
  }],
  ["a ghost past the frame ceiling", {
    ...goodGhost,
    frames: new Array((MAX_GHOST_FRAMES + 1) * GHOST_FIELDS_PER_FRAME).fill(3),
  }],
];

for (const [label, ghost] of hostileGhosts) {
  let save;
  assert.doesNotThrow(() => {
    save = parseSave(saveWithGhost(ghost), SCHEMA_VERSION);
  }, `parseSave threw on ${label}.`);
  assertUsableSave(save, label);
  const record = save.records["MAP 01"];
  assert.ok(record, `${label} took the whole course record with it.`);
  assert.equal(record.ghosts.race, undefined, `${label} was accepted.`);
  // G4 — and the good replay beside it is untouched.
  assert.deepEqual(
    record.ghosts.timeattack,
    goodGhost,
    `${label} took a healthy replay in another mode slot with it.`,
  );
  // The point of the whole exercise: the times either side of the bad ghost.
  assert.equal(record.bestLapMs, 34_010, `${label} cost the player their best lap.`);
  assert.equal(record.bestRaceMs, 170_500, `${label} cost the player their best race.`);
  assert.equal(record.laps, 9, `${label} cost the player their lap count.`);
}

// A good ghost survives the same path intact.
{
  const save = parseSave(saveWithGhost(goodGhost), SCHEMA_VERSION);
  assert.deepEqual(
    save.records["MAP 01"].ghosts.race,
    goodGhost,
    "A valid ghost did not survive.",
  );
}

// G4 — a ghost filed under a mode this build does not know is dropped, and the
// record it sat on survives. The same rule course keys have always had: storage
// this build cannot name is storage it will never read back.
{
  const save = parseSave(JSON.stringify({
    schemaVersion: SCHEMA_VERSION,
    settings: defaultSettings(),
    records: {
      "MAP 01": {
        bestLapMs: 34_010,
        bestRaceMs: 170_500,
        laps: 9,
        ghosts: { championship: goodGhost, race: goodGhost },
        bests: { "championship:works": { bestLapMs: 1 }, "race:works": { bestLapMs: 34_010 } },
      },
    },
    livery: DEFAULT_LIVERY,
    track: DEFAULT_TRACK,
  }), SCHEMA_VERSION);
  assertUsableSave(save, "unknown mode slot");
  assert.equal(
    save.records["MAP 01"].ghosts.championship,
    undefined,
    "A ghost under an unshipped mode was kept.",
  );
  assert.deepEqual(save.records["MAP 01"].ghosts.race, goodGhost);
  assert.equal(
    save.records["MAP 01"].bests["championship:works"],
    undefined,
    "A best-lap slot under an unshipped mode was kept.",
  );
  assert.equal(save.records["MAP 01"].bests["race:works"].bestLapMs, 34_010);
  assert.equal(save.records["MAP 01"].bestLapMs, 34_010, "The record was scrubbed.");
}

// ---------------------------------------------------------------------------
// P10 — the ghost always matches the lap time it belongs to
// ---------------------------------------------------------------------------

{
  const fresh = applyRaceResult(defaultRecord(), {
    ...RACE_WORKS,
    bestLapMs: 34_010,
    raceMs: 170_500,
    laps: 5,
    ghost: goodGhost,
  });
  assert.equal(fresh.newBestLap, true);
  assert.deepEqual(
    fresh.record.ghosts.race,
    goodGhost,
    "A new best lap did not store its ghost.",
  );

  // A slower race leaves both the time and the replay alone.
  const slowerRun = applyRaceResult(fresh.record, {
    ...RACE_WORKS,
    bestLapMs: 35_000,
    raceMs: 180_000,
    laps: 5,
    ghost: recordedGhost(35_000),
  });
  assert.equal(slowerRun.newBestLap, false);
  assert.deepEqual(
    slowerRun.record.ghosts.race,
    goodGhost,
    "A slower lap overwrote the stored replay.",
  );

  // A faster lap replaces it.
  const faster = recordedGhost(33_400);
  const fasterRun = applyRaceResult(fresh.record, {
    ...RACE_WORKS,
    bestLapMs: 33_400,
    raceMs: 175_000,
    laps: 5,
    ghost: faster,
  });
  assert.equal(fasterRun.newBestLap, true);
  assert.deepEqual(fasterRun.record.ghosts.race, faster, "A faster lap kept the old replay.");

  // A new best with no recording clears the old one rather than leaving a ghost
  // that claims to be a lap the board says was already beaten.
  const unrecorded = applyRaceResult(fresh.record, {
    ...RACE_WORKS,
    bestLapMs: 33_900,
    raceMs: 175_000,
    laps: 5,
  });
  assert.equal(unrecorded.newBestLap, true);
  assert.equal(
    unrecorded.record.ghosts.race,
    undefined,
    "A new best lap with no recording left the previous lap's ghost on file, "
      + "so the stored replay no longer matches the stored bestLapMs.",
  );

  // A corrupt recording offered by a live race is refused at the same gate as
  // one read off disk, and takes nothing with it.
  const poisoned = applyRaceResult(fresh.record, {
    ...RACE_WORKS,
    bestLapMs: 33_000,
    raceMs: 175_000,
    laps: 5,
    ghost: { version: 1, sampleHz: 20, lapMs: 33_000, frames: "nope" },
  });
  assert.equal(poisoned.record.bestLapMs, 33_000, "A bad ghost cost a real best lap.");
  assert.equal(poisoned.record.ghosts.race, undefined, "A bad ghost was written.");

  // G4 — a best lap in ANOTHER format must not disturb this one's replay. The
  // per-mode map exists for exactly this: a time attack that sets a record on a
  // circuit cannot be allowed to reach into the race-mode ghost slot.
  const otherMode = applyRaceResult(fresh.record, {
    modeKey: "timeattack:works",
    ghostKey: "timeattack",
    bestLapMs: 33_000,
    raceMs: 165_000,
    laps: 5,
    ghost: recordedGhost(33_000),
  });
  assert.equal(otherMode.newBestLap, true);
  assert.deepEqual(
    otherMode.record.ghosts.race,
    goodGhost,
    "A time-attack best overwrote the race-mode replay.",
  );
  assert.equal(otherMode.record.ghosts.timeattack.lapMs, 33_000);
}

// ---------------------------------------------------------------------------
// P10 — the written file must stay inside the ceiling it is read back through
//
// The failure this guards is total: a save the game writes but refuses to parse
// on the next load reads as a wipe. Ghosts are the first field big enough to
// get near it, so the budget is asserted against the real recorder's output.
// ---------------------------------------------------------------------------

{
  const { cell, port } = memoryPort();
  const store = createSaveStore(port, SCHEMA_VERSION);
  store.recordRace("MAP 01", {
    ...RACE_WORKS,
    bestLapMs: 34_010,
    raceMs: 170_000,
    laps: 5,
    ghost: goodGhost,
  });
  store.recordRace("MAP 02", {
    ...RACE_WORKS,
    bestLapMs: 50_400,
    raceMs: 254_000,
    laps: 5,
    ghost: recordedGhost(50_400),
  });
  const written = cell.text;
  assert.ok(
    written.length < 64 * 1024,
    `Two ghosts wrote a ${written.length}-character save; parseSave refuses anything `
      + "over 64 KB, so the next load would wipe every record.",
  );
  const reloaded = createSaveStore(port, SCHEMA_VERSION);
  assert.ok(
    reloaded.ghostFor("MAP 01", "race"),
    "The Greenwater ghost did not survive a reload.",
  );
  assert.ok(
    reloaded.ghostFor("MAP 02", "race"),
    "The Bitterpan ghost did not survive a reload.",
  );
  assert.deepEqual(
    reloaded.ghostFor("MAP 01", "race"),
    goodGhost,
    "The reloaded ghost is not the one that was stored.",
  );
  assert.equal(
    reloaded.ghostFor("MAP 03", "race"),
    null,
    "An untouched course reported a ghost.",
  );

  // A third course cannot push the file past the ceiling: the course just raced
  // keeps its replay and the budget sheds an older one.
  store.recordRace("MAP 03", {
    ...RACE_WORKS,
    bestLapMs: 41_000,
    raceMs: 205_000,
    laps: 5,
    ghost: recordedGhost(41_000),
  });
  const withThree = JSON.parse(cell.text);
  const countGhosts = (file) => Object.values(file.records)
    .reduce((total, record) => total + Object.keys(record.ghosts ?? {}).length, 0);
  assert.ok(
    countGhosts(withThree) <= 2,
    `${countGhosts(withThree)} ghosts were written; the budget allows two.`,
  );
  assert.ok(
    withThree.records["MAP 03"].ghosts.race,
    "The course that just set a best lap lost its replay to the budget.",
  );
  assert.ok(cell.text.length < 64 * 1024, "The three-course file passed the read ceiling.");
  for (const record of Object.values(withThree.records)) {
    assert.ok(record.bestLapMs > 0, "The ghost budget took a lap time with it.");
  }
}

// ---------------------------------------------------------------------------
// G4 — the same ceiling, now spent across (course, mode) slots
//
// This is the new wipe risk the phase introduces, stated plainly: v2 could hold
// at most two ghosts because it held one per course and shipped two courses.
// v3 holds one per course AND mode, which is six possible slots — at 16 KB each
// that is 96 KB, and `parseSave` refuses anything over 64 KB. A build that let
// all six be written would write a file it then refused on the next load, which
// is a total wipe of every record the player had.
//
// The budget therefore stayed at two and became GLOBAL. What follows races
// three formats on ONE circuit and proves the file never holds more than two
// replays, that the format just raced always keeps its own, and — the part that
// matters most — that every lap TIME survives the shedding. A time is eight
// bytes and a replay is sixteen kilobytes; the player loses the cheap thing.
// ---------------------------------------------------------------------------

{
  const { cell, port } = memoryPort();
  const store = createSaveStore(port, SCHEMA_VERSION);
  const modes = ["race", "sprint", "timeattack"];
  modes.forEach((mode, index) => {
    store.recordRace("MAP 01", {
      modeKey: `${mode}:works`,
      ghostKey: mode,
      bestLapMs: 34_000 + index * 100,
      raceMs: 170_000 + index * 1_000,
      laps: 5,
      ghost: recordedGhost(34_000 + index * 100),
      gateSplitsMs: [4_000, 9_000, 15_000, 22_000, 28_000],
    });
    const file = JSON.parse(cell.text);
    const stored = Object.keys(file.records["MAP 01"].ghosts);
    assert.ok(
      stored.length <= 2,
      `After racing ${index + 1} formats the file held ${stored.length} replays; `
        + "the global budget allows two.",
    );
    assert.ok(
      stored.includes(mode),
      `The format just raced (${mode}) lost its own replay to the budget.`,
    );
    assert.ok(
      cell.text.length < 64 * 1024,
      `A ${cell.text.length}-character save was written; parseSave refuses over 64 KB.`,
    );
  });

  // Every slot's TIME and SPLITS survived, whatever happened to the replays.
  const reloaded = createSaveStore(port, SCHEMA_VERSION);
  modes.forEach((mode, index) => {
    const best = reloaded.bestFor("MAP 01", `${mode}:works`);
    assert.equal(
      best.bestLapMs,
      34_000 + index * 100,
      `The ghost budget took the ${mode} best lap with it.`,
    );
    assert.deepEqual(
      best.gateSplitsMs,
      [4_000, 9_000, 15_000, 22_000, 28_000],
      `The ghost budget took the ${mode} gate splits with it.`,
    );
  });

  // And a file that ARRIVES holding six is read back inside the budget rather
  // than being refused: the read side's ceiling has to equal the write side's,
  // or a save written by some future build would wipe this one's records.
  const overstuffed = JSON.stringify({
    schemaVersion: SCHEMA_VERSION,
    settings: defaultSettings(),
    records: Object.fromEntries(["MAP 01", "MAP 02"].map((key) => [key, {
      bestLapMs: 34_000,
      bestRaceMs: 170_000,
      laps: 5,
      ghosts: Object.fromEntries(modes.map((mode) => [mode, goodGhost])),
      bests: { "race:works": { bestLapMs: 34_000, gateSplitsMs: [] } },
    }])),
    livery: DEFAULT_LIVERY,
    track: DEFAULT_TRACK,
  });
  const trimmed = parseSave(overstuffed, SCHEMA_VERSION);
  assertUsableSave(trimmed, "overstuffed ghost map");
  const total = Object.values(trimmed.records)
    .reduce((sum, record) => sum + Object.keys(record.ghosts).length, 0);
  assert.ok(total <= 2, `A six-ghost file was read back with ${total} replays.`);
  for (const record of Object.values(trimmed.records)) {
    assert.equal(record.bestLapMs, 34_000, "Trimming the ghost map cost a lap time.");
  }
}

// ---------------------------------------------------------------------------
// P17.1 — a stored livery has to reach the CRAFT, not just the chip row.
//
// THE BUG. Everything above proves the save file survives anything and hands
// the game a usable livery code. None of it proved the code was ever put on the
// vehicle. `MetaUi.syncFromSave` restores the choice with `ChipGroup.setValue`,
// which deliberately does not fire `onCommit`, and nothing else applied it — so
// after a reload the HUD read `NIGHTFORM 24` over a craft still wearing the
// works sheet baked into the GLB. A stored value that never reaches the runtime
// is a persistence failure even though the file was perfect, which is why the
// assertion lives here.
//
// Two halves, because the bug had two halves: a decision nobody could test, and
// a call nobody made.
// ---------------------------------------------------------------------------

const BAKED_LIVERY_FLIP_MATCH = {
  works: 100,
  privateer: 91.859,
  nightform: 91.253,
  needle: 77.852,
};

assert.equal(
  BAKED_LIVERY_CODE,
  DEFAULT_LIVERY,
  "The livery baked into totem_runtime.glb and the save file's default must be "
    + "the same sheet, or a fresh save boots wearing paint it does not claim.",
);
assert.ok(
  LIVERY_CODES.includes(BAKED_LIVERY_CODE),
  `BAKED_LIVERY_CODE is ${BAKED_LIVERY_CODE}, which is not a shipped livery.`,
);
// The constant is a MEASURED fact, recorded in liveries.js: the GLB's embedded
// TOTEM_body.map was extracted and compared pixel-for-pixel against all four
// served sheets under the vertical flip the glTF/served flipY conventions imply.
// Exactly one matched, and not marginally. Re-measuring here would mean decoding
// two 1024x1024 PNGs on every run; the guard against the constant going stale is
// that a re-exported GLB moves its sha256, which validate-art-pass.mjs pins
// through TOTEM_DECAL_CELLS.json.
assert.equal(
  Object.entries(BAKED_LIVERY_FLIP_MATCH)
    .filter(([, percent]) => percent === 100)
    .map(([code]) => code)
    .join(),
  BAKED_LIVERY_CODE,
  "The recorded GLB pixel measurement names a different sheet than "
    + "BAKED_LIVERY_CODE. One of the two was edited without the other.",
);

// --- Half one: the decision, driven with real inputs ------------------------
assert.equal(
  bootLiveryToApply("nightform"),
  "nightform",
  "A stored non-default livery must be applied at boot. This is the bug: it was "
    + "restored into the chip row and never put on the craft.",
);
for (const code of LIVERY_CODES) {
  assert.equal(
    bootLiveryToApply(code),
    code === BAKED_LIVERY_CODE ? null : code,
    `bootLiveryToApply(${code}) must apply every livery except the one already `
      + "baked into the GLB.",
  );
}
assert.equal(
  bootLiveryToApply(BAKED_LIVERY_CODE),
  null,
  "The boot path must do NOTHING for the baked livery. Swapping in pixels that "
    + "are already on the model would put a fetch and a texture replacement on "
    + "the default no-save path, which this fix is required to leave unchanged.",
);
// A save file is hostile input everywhere else in this suite; it is here too.
for (const rubbish of ["", "WORKS", "nightform ", "__proto__", "../works", "0"]) {
  assert.equal(
    bootLiveryToApply(rubbish),
    null,
    `A stored token of ${JSON.stringify(rubbish)} must collapse to the baked `
      + "livery and fetch nothing. A boot path that trusted it would request a "
      + "decal sheet that does not exist.",
  );
}

// --- Half two: the call, which is what was actually missing -----------------
//
// The decision function can be perfect and the bug still ship, because the bug
// WAS that nothing called it. So pin the wiring: main.ts must await the restore
// after initialize() resolves and before the grid is shown or the demo starts.
const mainSource = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");
assert.match(
  mainSource,
  /await\s+restoreStoredLivery\s*\(/,
  "src/main.ts must AWAIT restoreStoredLivery on the boot path. Without the "
    + "await the grid can be shown, or the demo started, against the works sheet "
    + "while the real livery is still being fetched.",
);
const restoreAt = mainSource.indexOf("await restoreStoredLivery");
for (const [what, needle] of [
  ["the ready screen", "ui.showReady()"],
  ["the demo start", "game.startTrial()"],
]) {
  const at = mainSource.indexOf(needle, restoreAt);
  assert.ok(
    at > restoreAt,
    `src/main.ts reaches ${what} before restoring the stored livery, so the boot `
      + "path can present a craft wearing the wrong paint.",
  );
}
// The restore has to go through the SAME entry point the chip click uses, or the
// P17 wear treatment and the per-livery uWearScale stop being guaranteed to
// compose the same way on both paths.
const metaRuntimeSource = await readFile(
  new URL("../src/game/meta-runtime.ts", import.meta.url),
  "utf8",
);
assert.match(
  metaRuntimeSource,
  /export async function restoreStoredLivery/,
  "restoreStoredLivery must live in meta-runtime.ts, beside applyRaceLivery.",
);
assert.match(
  mainSource,
  /restoreStoredLivery\(\s*\(code\)\s*=>\s*game\.applyLivery\(code\)\s*\)/,
  "The boot restore must call game.applyLivery — the same hook MetaUi's livery "
    + "chip commits to. A second swap path would be a second place for the wear "
    + "treatment to compose differently.",
);

// --- NEGATIVE TEST ----------------------------------------------------------
//
// Every assertion above passes against the shipped code, which proves only that
// the shipped code is self-consistent. The rule that matters is "a stored
// non-default livery is applied at boot", and the way it broke was silent. So
// re-run the SAME predicate over the two implementations that would reintroduce
// it, and require both to fail.
{
  // (a) The pre-fix behaviour: nothing is ever applied.
  const neverApplies = () => null;
  assert.throws(
    () => assert.equal(
      neverApplies("nightform"),
      "nightform",
      "A stored non-default livery must be applied at boot.",
    ),
    assert.AssertionError,
    "A boot path that applies NOTHING passed the stored-livery rule. The rule "
      + "cannot fail, so it never proved anything about the fix.",
  );
  // (b) The over-correction: applying the baked livery too, which puts a fetch
  //     and a texture swap on the default path this fix must not touch.
  const alwaysApplies = (code) => liveryFor(code).code;
  assert.throws(
    () => assert.equal(
      alwaysApplies(BAKED_LIVERY_CODE),
      null,
      "The boot path must do NOTHING for the baked livery.",
    ),
    assert.AssertionError,
    "A boot path that swaps the baked livery in over itself passed the "
      + "default-path rule, so the rule does not protect the default path.",
  );
  // And the wiring half: a main.ts that calls without awaiting must fail.
  const unawaited = mainSource.replace(
    "await restoreStoredLivery",
    "void restoreStoredLivery",
  );
  assert.throws(
    () => assert.match(unawaited, /await\s+restoreStoredLivery\s*\(/),
    assert.AssertionError,
    "A fire-and-forget restore passed the await check, so the check would not "
      + "catch the grid being shown against an unfinished livery swap.",
  );
}

console.log(
  `Persistence PASS: v4 round trip with per-mode ghosts and mode/tier best laps, `
    + `v1 -> v4, v2 -> v4 and v3 -> v4 migrated field by field (the v2 ghost RELOCATED into `
    + `ghosts.race, not dropped), the global two-replay budget held across `
    + `${RACE_MODES.length} formats on one circuit with every lap time and split `
    + `surviving; ${hostile.length} hostile payloads `
    + `absorbed to defaults, v1 -> v2 migrated field by field with nothing lost, `
    + `settings.voice defaulted on every rung and 5 hostile values refused, `
    + `${hostileGhosts.length} corrupt ghosts dropped while their course records survived, `
    + "ghost follows bestLapMs, write budget inside the 64 KB read ceiling, volume grid "
    + "stable across JSON, record folding correct, quota-exceeded and absent ports "
    + "degrade to memory without throwing; the stored livery reaches the CRAFT — "
    + `${LIVERY_CODES.length - 1} of ${LIVERY_CODES.length} applied at boot, `
    + `${BAKED_LIVERY_CODE} skipped as already baked into the GLB, 6 hostile tokens `
    + "collapsed to it, main.ts awaits the restore ahead of the grid and the demo, "
    + "3 negative fixtures rejected.",
);
