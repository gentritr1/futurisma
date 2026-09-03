// A1 audio harness (review harness, not part of the shipped game).
//
// Node has no Web Audio and `node-web-audio-api` is not a dependency, so the
// four things `scripts/validate-audio-ambience.mjs` CANNOT assert are measured
// here instead, in a real browser:
//
//   1. bed RMS/peak, rendered through the real filters in an
//      `OfflineAudioContext`, six seconds per bed per map;
//   2. the panner-vs-world agreement, in listener space, read out of the LIVE
//      race through the diagnostics line at three sampled ticks per map;
//   3. the pass-by proof: a rival crossing from 20 m behind to 20 m ahead,
//      rendered stereo, with the left/right ratio reported per segment;
//   4. the frame and control-rate cost of the whole thing with the context
//      actually RUNNING, which the headless soaks never see because they run it
//      suspended.
//
// Chromium will not start an AudioContext without a gesture, so this launches
// with --autoplay-policy=no-user-gesture-required and additionally clicks the
// start button and calls resume(). If `audioContextState` still reads
// "suspended" the run aborts rather than reporting zeros as results.
//
// Usage: node scripts/visual/audio-probe.mjs [baseUrl]
//   e.g. node scripts/visual/audio-probe.mjs http://127.0.0.1:5213
import { chromium } from "playwright";

const base = process.argv[2] ?? "http://127.0.0.1:5213";
const MAPS = ["bitterpan", "greenwater"];

const browser = await chromium.launch({
  args: [
    "--autoplay-policy=no-user-gesture-required",
    "--use-angle=metal",
    "--enable-gpu",
    "--ignore-gpu-blocklist",
  ],
});

function decibels(value) {
  return value > 0 ? 20 * Math.log10(value) : -Infinity;
}

/**
 * Renders every bed of one map on its own, in an OfflineAudioContext, through
 * the same `AmbienceField` the game builds. The bed is driven with `immediate`
 * so the render is the authored steady state rather than a 2 s approach to it,
 * and with the score silent so the -9 dB duck is not folded into the number.
 */
async function renderBeds(page, map) {
  return page.evaluate(async (mapId) => {
    const beds = await import("/src/game/ambience-beds.js");
    const ambience = await import("/src/game/audio-ambience.ts");
    const cueModule = await import("/src/game/ambience-cue.ts");
    const lap = mapId === "bitterpan" ? 3_050 : 2_515.982;
    const rows = [];
    // Two renders per bed. `rest` is what the bed sounds like on an ordinary
    // lap — its authored level, no track event, no room boost — and it is the
    // number the acceptance band describes for anything that is audible at
    // rest. `loud` is the same bed with its event at 1 and its room boost
    // applied, which is what the -12 dBFS ceiling has to hold against.
    async function render(bed, events, zone) {
      const context = new OfflineAudioContext(2, 48_000 * 6, 48_000);
      const distance = bed.window
        ? (bed.window.startDistance + bed.window.endDistance) / 2
        : 500;
      cueModule.publishAmbienceCue(
        { kind: mapId, length: lap, audioZoneAt: () => "open" },
        distance / lap,
      );
      cueModule.setEventLevels(events);
      const field = new ambience.AmbienceField(
        context,
        context.destination,
        null,
        mapId,
        { onlyBed: bed.id },
      );
      field.update(0, zone, { trance: 0, jungle: 0, deep_dnb: 0, techstep: 0 }, true);
      const rendered = await context.startRendering();
      // Skip the first 200 ms: filter start-up transients are not the bed.
      const skip = Math.floor(0.2 * rendered.sampleRate);
      let sum = 0;
      let peak = 0;
      let count = 0;
      for (let channel = 0; channel < rendered.numberOfChannels; channel += 1) {
        const data = rendered.getChannelData(channel);
        for (let index = skip; index < data.length; index += 1) {
          sum += data[index] * data[index];
          peak = Math.max(peak, Math.abs(data[index]));
          count += 1;
        }
      }
      field.dispose();
      return { rms: Math.sqrt(sum / count), peak };
    }
    const none = { windGust: 0, squall: 0, saltDrop: 0 };
    const all = { windGust: 1, squall: 1, saltDrop: 1 };
    for (const bed of beds.AMBIENCE_BEDS[mapId]) {
      const rest = await render(bed, none, "open");
      const loud = await render(bed, all, bed.zone ?? "open");
      rows.push({
        id: bed.id,
        kind: bed.kind,
        level: bed.level,
        eventOnly: bed.level === 0,
        rest,
        loud,
      });
    }
    // And the whole field at once, which is the case a per-bed table cannot
    // see: on Bitterpan the wind, the works, the brine and the conveyor can all
    // be up together inside the underpass, with a salt drop on top.
    const worst = { id: "(whole field, worst case)", kind: "sum", level: 0, eventOnly: false };
    const anyWindow = { window: null, zone: null, id: null };
    const context = new OfflineAudioContext(2, 48_000 * 6, 48_000);
    cueModule.publishAmbienceCue(
      { kind: mapId, length: lap, audioZoneAt: () => "open" },
      (mapId === "bitterpan" ? 3_000 : 1_700) / lap,
    );
    cueModule.setEventLevels(all);
    const field = new ambience.AmbienceField(
      context,
      context.destination,
      null,
      mapId,
    );
    field.update(0, mapId === "bitterpan" ? "underpass" : "open", {
      trance: 0,
      jungle: 0,
      deep_dnb: 0,
      techstep: 0,
    }, true);
    const rendered = await context.startRendering();
    const skip = Math.floor(0.2 * rendered.sampleRate);
    let sum = 0;
    let peak = 0;
    let count = 0;
    for (let channel = 0; channel < rendered.numberOfChannels; channel += 1) {
      const data = rendered.getChannelData(channel);
      for (let index = skip; index < data.length; index += 1) {
        sum += data[index] * data[index];
        peak = Math.max(peak, Math.abs(data[index]));
        count += 1;
      }
    }
    field.dispose();
    void anyWindow;
    rows.push({
      ...worst,
      rest: { rms: Math.sqrt(sum / count), peak },
      loud: { rms: Math.sqrt(sum / count), peak },
    });
    cueModule.setEventLevels(none);
    return rows;
  }, map);
}

/**
 * The pass-by, rendered rather than reasoned about. A source is swept past the
 * listener through the SHIPPED panner configuration; the left and right RMS are
 * measured in five segments so the swing can be read as numbers.
 *
 * Two geometries are rendered, because the brief's phrasing admits both and
 * only one of them can swing sign:
 *   `straight` — 3 m off the starboard beam the whole way, 20 m astern to 20 m
 *     ahead. This must NOT swing sign: a rival that stays on your right is on
 *     your right. It is here as the control.
 *   `crossing` — the real overtake: out to port 5 m at 20 m astern, across the
 *     nose, 5 m to starboard at 20 m ahead. This is the one that swings.
 */
async function renderPassBy(page) {
  return page.evaluate(async () => {
    const beds = await import("/src/game/audio-space.js");
    const out = {};
    const cases = [
      ["engine_straight", "engine", 3, 3],
      ["engine_crossing", "engine", -5, 5],
      ["hiss_crossing", "hiss", -5, 5],
    ];
    for (const [name, voice, startX, endX] of cases) {
      const seconds = 4;
      const context = new OfflineAudioContext(2, 48_000 * seconds, 48_000);
      const listener = context.listener;
      // Listener at the origin, facing -Z, up +Y: the Web Audio default, and
      // the same basis `listenerRightVector` assumes.
      if (listener.positionX) {
        listener.positionX.value = 0;
        listener.positionY.value = 0;
        listener.positionZ.value = 0;
        listener.forwardX.value = 0;
        listener.forwardY.value = 0;
        listener.forwardZ.value = -1;
        listener.upX.value = 0;
        listener.upY.value = 1;
        listener.upZ.value = 0;
      } else {
        listener.setPosition(0, 0, 0);
        listener.setOrientation(0, 0, -1, 0, 1, 0);
      }
      const panner = context.createPanner();
      panner.panningModel = beds.RIVAL_PANNER.panningModel;
      panner.distanceModel = beds.RIVAL_PANNER.distanceModel;
      panner.refDistance = beds.RIVAL_PANNER.refDistance;
      panner.maxDistance = beds.RIVAL_PANNER.maxDistance;
      panner.rolloffFactor = beds.RIVAL_PANNER.rolloffFactor;
      panner.connect(context.destination);
      if (voice === "engine") {
        // The rival engine pair: 150 Hz saw, which is where the shipped
        // `rivalEngineFrequency` sits at race pace.
        const oscillator = context.createOscillator();
        oscillator.type = "sawtooth";
        oscillator.frequency.value = 150;
        oscillator.connect(panner);
        oscillator.start();
      } else {
        // The airbrake band: 3.1 kHz noise, which is where the head actually
        // casts a shadow. A 150 Hz tone diffracts around a head, so its level
        // difference between the ears is SUPPOSED to be small — reading the
        // engine's L/R ratio alone would understate the localisation badly.
        const buffer = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
        const channel = buffer.getChannelData(0);
        // The shipped seeded stream, so the hiss case is reproducible too.
        const random = beds.seededRandom(9_311);
        for (let index = 0; index < channel.length; index += 1) {
          channel[index] = random() * 2 - 1;
        }
        const filter = context.createBiquadFilter();
        filter.type = "bandpass";
        filter.frequency.value = 3_100;
        filter.Q.value = 0.8;
        filter.connect(panner);
        const source = context.createBufferSource();
        source.buffer = buffer;
        source.loop = true;
        source.connect(filter);
        source.start();
      }
      // +Z is astern of a listener facing -Z, so the sweep runs +20 -> -20.
      if (panner.positionX) {
        panner.positionX.setValueAtTime(startX, 0);
        panner.positionX.linearRampToValueAtTime(endX, seconds);
        panner.positionY.value = 0;
        panner.positionZ.setValueAtTime(20, 0);
        panner.positionZ.linearRampToValueAtTime(-20, seconds);
      }
      const rendered = await context.startRendering();
      const left = rendered.getChannelData(0);
      const right = rendered.getChannelData(1);
      const segments = [];
      for (let segment = 0; segment < 5; segment += 1) {
        const from = Math.floor(segment / 5 * left.length);
        const to = Math.floor((segment + 1) / 5 * left.length);
        let leftSum = 0;
        let rightSum = 0;
        for (let index = from; index < to; index += 1) {
          leftSum += left[index] * left[index];
          rightSum += right[index] * right[index];
        }
        const count = to - from;
        // The interaural TIME difference, by cross-correlation over +-1 ms.
        // At the pitch a rival engine actually runs, this is the localisation
        // cue that carries; the level ratio above is the one that does not.
        const window = Math.min(to - from, 24_000);
        let bestLag = 0;
        let best = -Infinity;
        for (let lag = -48; lag <= 48; lag += 1) {
          let correlation = 0;
          for (let index = 0; index < window; index += 1) {
            const at = from + index;
            const other = at + lag;
            if (other < 0 || other >= left.length) continue;
            correlation += left[at] * right[other];
          }
          if (correlation > best) {
            best = correlation;
            bestLag = lag;
          }
        }
        segments.push({
          zMeters: 20 - 40 * ((segment + 0.5) / 5),
          xMeters: startX + (endX - startX) * ((segment + 0.5) / 5),
          left: Math.sqrt(leftSum / count),
          right: Math.sqrt(rightSum / count),
          itdMicroseconds: bestLag / rendered.sampleRate * 1e6,
        });
      }
      out[name] = segments;
    }
    return out;
  });
}

const report = { beds: {}, live: {}, passBy: null };

for (const map of MAPS) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error).slice(0, 300)));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text().slice(0, 300));
  });
  await page.goto(
    `${base}/?map=${map}&laps=1&demo=1&diagnostics=1&headless=1`,
    { waitUntil: "networkidle" },
  );
  // demo=1 auto-starts the trial, which is what creates the AudioContext; the
  // launch flag above is what lets it actually run instead of staying suspended.
  await page.waitForTimeout(4_000);
  const resumed = await page.evaluate(async () => {
    const button = document.getElementById("start-button");
    if (button && !button.hidden) button.click();
    return true;
  });
  void resumed;
  await page.waitForTimeout(3_000);

  const read = async () => JSON.parse(
    await page.evaluate(() => {
      const element = document.getElementById("futurisma-diagnostics");
      return element ? element.textContent || "{}" : "{}";
    }),
  );

  let first = await read();
  if (first.current?.audioContextState !== "running") {
    console.log(
      `[${map}] audioContextState is "${first.current?.audioContextState}". `
        + "Every number below would be zero; aborting rather than reporting them.",
    );
    await page.close();
    continue;
  }

  // A whole lap, sampled every 1.2 s. Three of those ticks carry the panner
  // check; all of them feed the bed sweep, which is the only place the sector
  // crossfades are observed on a REAL lap rather than in the node simulation.
  const samples = [];
  const bedPeak = {};
  const bedFloor = {};
  const zonesSeen = new Set();
  let line = first;
  for (let sample = 0; sample < 40; sample += 1) {
    line = await read();
    const audio = line.current.audio;
    if (sample % 13 === 0 && samples.length < 3) samples.push(audio);
    zonesSeen.add(audio.bedZone);
    for (const [id, level] of Object.entries(audio.bedLevels)) {
      bedPeak[id] = Math.max(bedPeak[id] ?? 0, level);
      bedFloor[id] = Math.min(bedFloor[id] ?? Infinity, level);
    }
    if (line.current.phase === "finished" && sample > 8) break;
    await page.waitForTimeout(1_200);
  }
  const last = await read();

  report.live[map] = {
    contextState: last.current.audioContextState,
    controlHz: last.current.audioControlHz,
    controlUpdates: last.current.audioControlUpdates,
    p95FrameMs: last.current.p95FrameMs,
    maxFrameMs: last.current.maxFrameMs,
    lapTimesMs: last.current.lapTimesMs,
    ambiencePreparationMs: last.current.audio.ambiencePreparationMs,
    beds: last.current.audio.beds,
    bedLevels: last.current.audio.bedLevels,
    eventLevels: last.current.audio.eventLevels,
    listenerPose: last.current.audio.listenerPose,
    passByWhooshes: last.current.audio.passByWhooshes,
    bedPeak,
    bedFloor,
    zonesSeen: [...zonesSeen],
    samples,
    errors,
  };

  report.beds[map] = await renderBeds(page, map);
  if (!report.passBy) report.passBy = await renderPassBy(page);
  await page.close();
}

await browser.close();

// The acceptance bands are the SHIPPED ones, imported rather than restated, so
// this harness cannot pass against a table the game does not use.
const {
  AMBIENCE_BEDS: allBeds,
  AMBIENCE_RMS_BANDS: bands,
  AMBIENCE_RMS_CEILING_DBFS: ceiling,
  AMBIENCE_PEAK_CEILING: peakCeiling,
} = await import("../../src/game/ambience-beds.js");
const PANNER_TOLERANCE_METERS = 1;

// ---------------------------------------------------------------------------

const failures = [];

console.log(
  "\n=== bed RMS / peak (rendered, 6 s each, at the ambience bus, music silent) ===",
);
console.log(
  "  rest = authored level, no event, no room boost. "
    + "loud = event at 1 plus room boost.",
);
console.log(
  "map        bed              kind  level  rest dBFS  loud dBFS  loud peak  band            verdict",
);
for (const [map, rows] of Object.entries(report.beds)) {
  for (const row of rows) {
    const band = bands[row.id];
    // An event-only bed is silent at rest by design, so its band describes the
    // event; everything else is banded on the level it sits at all lap.
    const banded = decibels(row.eventOnly ? row.loud.rms : row.rest.rms);
    const loudest = decibels(row.loud.rms);
    const verdict = loudest > ceiling
      ? "OVER CEILING"
      : row.loud.peak >= peakCeiling ? "CLIPPING"
        // The summed field has no band of its own: the ceiling IS its check.
        : row.kind === "sum" ? "pass"
          : !band ? "NO BAND"
            : banded <= -70 ? "SILENT"
              : banded >= band[0] && banded <= band[1] ? "pass" : "OUT OF BAND";
    if (verdict !== "pass") {
      failures.push(`${map}/${row.id}: ${verdict} (${banded.toFixed(2)} dBFS)`);
    }
    console.log(
      `${map.padEnd(10)} ${row.id.padEnd(16)} ${row.kind.padEnd(5)} `
        + `${row.level.toFixed(2)}  ${decibels(row.rest.rms).toFixed(2).padStart(9)}  `
        + `${loudest.toFixed(2).padStart(9)}  ${row.loud.peak.toFixed(4).padStart(9)}  `
        + `${band ? `[${band[0]}, ${band[1]}]`.padEnd(16) : "-".padEnd(16)}${verdict}`,
    );
  }
}

console.log("\n=== panner readback vs rival seam, listener space (metres) ===");
console.log("map        tick rival    panner(x,y,z)              source(x,y,z)              gap");
for (const [map, live] of Object.entries(report.live)) {
  live.samples.forEach((audio, tick) => {
    audio.panners.forEach((panner, rival) => {
      const source = audio.spatialSources[rival];
      const gap = Math.hypot(
        panner.x - source.x,
        panner.y - source.y,
        panner.z - source.z,
      );
      if (gap > PANNER_TOLERANCE_METERS) {
        failures.push(`${map} tick ${tick} rival ${rival}: panner gap ${gap.toFixed(3)} m`);
      }
      console.log(
        `${map.padEnd(10)} ${String(tick).padEnd(4)} ${String(rival).padEnd(8)} `
          + `${[panner.x, panner.y, panner.z].map((v) => v.toFixed(2).padStart(8)).join(",")}  `
          + `${[source.x, source.y, source.z].map((v) => v.toFixed(2).padStart(8)).join(",")}  `
          + `${gap.toFixed(3)}${gap > PANNER_TOLERANCE_METERS ? "  OVER 1.0 m" : ""}`,
      );
    });
  });
}

console.log("\n=== pass-by: 20 m astern -> 20 m ahead ===");
for (const [geometry, segments] of Object.entries(report.passBy ?? {})) {
  console.log(`-- ${geometry}`);
  console.log("  z(m)   x(m)     L rms     R rms   L/R dB    ITD us");
  for (const segment of segments) {
    console.log(
      `  ${segment.zMeters.toFixed(1).padStart(5)}  ${segment.xMeters.toFixed(1).padStart(5)}  `
        + `${segment.left.toFixed(5)}  ${segment.right.toFixed(5)}  `
        + `${decibels(segment.left / segment.right).toFixed(2).padStart(7)}  `
        + `${segment.itdMicroseconds.toFixed(1).padStart(8)}`,
    );
  }
}

console.log("\n=== live race, context RUNNING ===");
for (const [map, live] of Object.entries(report.live)) {
  console.log(
    `${map}: state=${live.contextState} controlHz=${live.controlHz} `
      + `updates=${live.controlUpdates} p95=${live.p95FrameMs} max=${live.maxFrameMs} `
      + `lap=${JSON.stringify(live.lapTimesMs)} beds=${live.beds} `
      + `ambienceBakeMs=${live.ambiencePreparationMs} whooshes=${live.passByWhooshes}`,
  );
  console.log(`  bedLevels (final tick) ${JSON.stringify(live.bedLevels)}`);
  console.log(
    `  bed sweep over the lap, floor -> peak, zones ${JSON.stringify(live.zonesSeen)}`,
  );
  for (const id of Object.keys(live.bedPeak)) {
    const floor = live.bedFloor[id];
    const peak = live.bedPeak[id];
    // A placed bed must both come up and go away again over one lap. A bed
    // stuck at one level is a window that never resolved, which no per-tick
    // snapshot can see.
    const moved = peak > 0.02 && floor < peak * 0.5;
    const placed = peak > 0 && floor === peak;
    console.log(
      `    ${id.padEnd(16)} ${floor.toFixed(4)} -> ${peak.toFixed(4)}`
        + `${moved ? "  (rises and falls)" : placed ? "  (constant)" : ""}`,
    );
    // An event-only bed is SUPPOSED to be silent here: nothing drives
    // `setEventLevels` until the track-event phase lands, and this harness
    // deliberately does not fake it on the live race. Everything else has to
    // actually be heard somewhere on the lap it is authored for.
    const bed = allBeds[map]?.find((entry) => entry.id === id);
    if (bed && bed.level > 0 && peak <= 0.001) {
      failures.push(`${map}/${id}: never audible on a full lap`);
    }
    if (bed && bed.level === 0) console.log("      (awaits a track event)");
  }
  console.log(`  eventLevels ${JSON.stringify(live.eventLevels)}`);
  console.log(`  listenerPose ${JSON.stringify(live.listenerPose)}`);
  console.log(`  console/page errors: ${live.errors.length ? live.errors.join(" | ") : "none"}`);
  if (live.errors.length) failures.push(`${map}: ${live.errors.length} console/page errors`);
  if (live.controlHz < 29 || live.controlHz > 31) {
    failures.push(`${map}: audioControlHz ${live.controlHz} outside 29-31`);
  }
  if (live.contextState !== "running") failures.push(`${map}: context ${live.contextState}`);
}

// The pass-by sign swing, asserted rather than eyeballed off the table above.
for (const [name, expectSwing] of [
  ["engine_straight", false],
  ["engine_crossing", true],
  ["hiss_crossing", true],
]) {
  const segments = report.passBy?.[name];
  if (!segments) continue;
  const first = decibels(segments[0].left / segments[0].right);
  const last = decibels(
    segments[segments.length - 1].left / segments[segments.length - 1].right,
  );
  const swung = Math.sign(first) !== Math.sign(last);
  if (swung !== expectSwing) {
    failures.push(
      `${name}: L/R went ${first.toFixed(2)} -> ${last.toFixed(2)} dB; expected `
        + `${expectSwing ? "a sign swing" : "no sign swing"}`,
    );
  }
}

console.log(
  failures.length === 0
    ? "\nA1 AUDIO PROBE PASS: every bed inside its authored RMS band and under the "
      + "ceiling, no clipping, every panner within 1.0 m of the rival seam in "
      + "listener space, the crossing pass-by swings sign and the straight one "
      + "does not, control loop 29-31 Hz with the context running, no console "
      + "errors."
    : `\nA1 AUDIO PROBE FAIL (${failures.length}):\n  ${failures.join("\n  ")}`,
);
process.exitCode = failures.length === 0 ? 0 : 1;
