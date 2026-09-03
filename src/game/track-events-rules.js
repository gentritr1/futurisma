/**
 * G3 — LIVE TRACK EVENTS, the pure half.
 *
 * Three authored events give the world consequences during a race: Bitterpan's
 * wind gusts, the conveyor's salt drops, and Greenwater's rain squall. This
 * module owns the SCHEDULE and the ENVELOPES and nothing else — no THREE, no
 * course, no DOM — so `scripts/validate-track-events.mjs` can build and replay a
 * whole race's worth of events in node without a browser.
 *
 * THE DETERMINISM CONTRACT, which every function here is written to keep:
 *
 *   1. A schedule is built ONCE, at race start, from (map kind, race seed,
 *      lap count). Nothing here reads a clock, `Math.random`, or any live
 *      state. `buildTrackEventSchedule` called twice with the same inputs
 *      returns deeply equal output; called with a different seed it does not.
 *
 *   2. Every event ARMS on the player's own RACE DISTANCE crossing an authored
 *      station, and then plays out on RACE TIME measured from that arming.
 *      Race distance is monotone and the physics step is fixed at 120 Hz
 *      (`FIXED_STEP` in game.ts), so the render rate cannot move an event: a
 *      60 Hz frame is two of the same sub-steps a 120 Hz frame takes one of.
 *
 *   3. Nothing an event does is allowed to reach a rival's SPEED. The gust
 *      biases a rival's TARGET LANE and stops there — see
 *      `GUST_RIVAL_LANE_BIAS_METERS` and the note on it.
 *
 * The arming indirection is not incidental. The gust has to TELEGRAPH: a scud
 * card has to be walking over the road 1.2 s before the push arrives, and a
 * schedule that fired the push at the moment the player reached a station could
 * not have drawn anything 1.2 s earlier without predicting the player's speed.
 * Arming early and running the whole cue chain — scud, HUD chip, ramp, hold —
 * on one fixed time offset from the arming instant is what makes the telegraph
 * a fact of the schedule instead of a guess about the driver.
 */

/**
 * The gust envelope, measured from the arming instant in seconds.
 *
 * ARM ....... 1.1 ramp starts ... 2.5 hold starts ... 3.5 hold ends ... 5.1 done
 *                 ^ 1.4 s ramp-in     ^ 1.0 s hold        ^ 1.6 s ramp-out
 *
 * The scud traverse is centred on 1.3 s and the HUD chip lights at 1.5 s, so
 * the picture leads the push by 1.2 s and the words by 1.0 s.
 */
export const GUST_RAMP_IN_SECONDS = 1.4;
export const GUST_HOLD_SECONDS = 1;
export const GUST_RAMP_OUT_SECONDS = 1.6;
export const GUST_HOLD_START_SECONDS = 2.5;
export const GUST_RAMP_START_SECONDS = GUST_HOLD_START_SECONDS - GUST_RAMP_IN_SECONDS;
export const GUST_HOLD_END_SECONDS = GUST_HOLD_START_SECONDS + GUST_HOLD_SECONDS;
export const GUST_END_SECONDS = GUST_HOLD_END_SECONDS + GUST_RAMP_OUT_SECONDS;
/** How far ahead of the hold a crossing scud card is on the racing line. */
export const GUST_TELEGRAPH_SECONDS = 1.2;
/** How far ahead of the hold the `GUST` chip lights. */
export const GUST_CHIP_LEAD_SECONDS = 1;
/** One crossing-scud traverse, arm-relative, centred on the telegraph instant. */
export const GUST_SCUD_TRAVERSE_SECONDS = 2.6;
/**
 * How far a card's own `phase` may shift its traverse off the centre, as a
 * fraction of the traverse.
 *
 * The whole zone crossing in perfect lockstep reads as a wipe rather than as
 * weather, so the twenty cards are spread. The spread is bounded because the
 * acceptance criterion is bounded: the road crossing has to precede the hold by
 * 0.8-1.6 s for EVERY card, and +/- 0.08 of a 2.6 s traverse is +/- 0.208 s
 * around 1.2 s, so the population lands in [0.99, 1.41] with margin at both
 * ends rather than sitting on the limit.
 */
export const GUST_SCUD_SPREAD_FRACTION = 0.08;

/**
 * What a gust-driven crossing card's alpha is scaled BY.
 *
 * Re-centring the traverse on the deck centreline moved the card's brightest
 * instant onto the racing line. Under the free sawtooth the two did not
 * coincide: `cross` alpha peaks at traverse progress 0.5, where the card sits
 * at its own anchor - `halfWidth + lateral`, i.e. 19.5-25.5 m off the
 * centreline on every authored station - and the card reached the centreline at
 * progress 0.11-0.21, where `sin(pi * p)` of the 0.32 envelope is 0.11-0.19. So
 * the ON-ROAD alpha this map has always shipped is ~0.145, not 0.32.
 *
 * Unscaled, re-centring would therefore have raised it by 2.2x as a SIDE EFFECT
 * of a timing change. That is the thing this constant exists to refuse. G3 is
 * entitled to strengthen the telegraph - the whole point of driving the zone
 * from the schedule is a cue the driver can act on - but it should do so by a
 * number somebody chose, not by whatever falls out of moving the peak.
 *
 * 0.625 puts the on-road alpha at 0.32 * 0.625 = 0.20: a deliberate 38% over
 * the 0.145 the map already draws there, and still under the 0.35 corridor
 * ceiling `validate-living-world.mjs` holds every card on the racing line to.
 * `validate-track-events.mjs` recomputes the 0.11-0.19 band from the authored
 * geometry and asserts both sides, so neither half can drift.
 *
 * The scale is applied at RUNTIME to the resolved alpha, never to
 * `ALPHA_ENVELOPES.cross`, so the authored ceiling does not move and the free
 * sawtooth - `?events=0`, Greenwater, standby - draws exactly what it did.
 *
 * NOT WHAT THIS FIXES, and the distinction cost a wrong commit message to
 * establish: a crossing card whose station is at the craft's own passes THROUGH
 * the chase camera and its quad covers the whole frame, which reads as a
 * rendering fault. That is real, it is visible in this build, and it is NOT
 * G3's - it reproduces frame for frame with `?events=0` at the same race time
 * (shots/g3-bitterpan/gust-*.png against a `?events=0` burst at 7.4-7.7 s), so
 * the free sawtooth has always done it. A proximity fade was written for it,
 * measured to change nothing, and reverted.
 */
export const GUST_SCUD_ALPHA_SCALE = 0.625;

/**
 * The alpha a crossing card actually reaches over the racing line under the
 * FREE sawtooth, which is the number GUST_SCUD_ALPHA_SCALE is set against.
 *
 * Derived, not copied: the card's anchor sits `offset = halfWidth + lateral`
 * off the centreline and the traverse walks `amplitude` metres either side of
 * it, so the centreline is reached at progress `(1 - offset / amplitude) / 2`.
 * With the authored `amplitude` of 34 m and the widest Bitterpan half-width of
 * 11.5 m against the zone's 8-14 m lateral, `offset` runs 19.5-25.5 m and the
 * crossing lands at progress 0.106-0.213 - alpha `sin(pi * p) * 0.32` of 0.106
 * to 0.192. `validate-track-events.mjs` recomputes this band rather than
 * trusting the midpoint quoted here.
 */
export const FREE_SAWTOOTH_ON_ROAD_ALPHA = 0.145;

/**
 * Peak lateral acceleration, m/s^2, before the tension arc.
 *
 * 2.0 rather than the 2.4 ceiling because the arc multiplies it: from lap 3 a
 * gust peaks at 2.0 * 1.2 = 2.4, which IS the ceiling. Authoring the base at
 * the ceiling and then multiplying would have shipped a gust 20% over the
 * number the phase is allowed to spend.
 */
export const GUST_BASE_PEAK_MPS2 = 2;
/** The hard ceiling, asserted rather than assumed. */
export const GUST_PEAK_CEILING_MPS2 = 2.4;
/** First lap of the tension arc: +20% peak and one extra gust. */
export const TENSION_ARC_FIRST_LAP = 3;
export const GUST_TENSION_GAIN = 1.2;
/**
 * How far a gust may move a rival's TARGET LANE, metres.
 *
 * A lane bias and nothing else. `stepRivalState` integrates `lateralMeters`
 * toward this target and `driveTargetSpeed` never reads either, so a gust
 * cannot reach a rival's speed however hard it blows — which is what keeps
 * rival lap and finish times bit-identical with events on and with `?events=0`.
 */
export const GUST_RIVAL_LANE_BIAS_METERS = 0.9;

/**
 * The conveyor salt drop, all distances in metres of course distance.
 *
 * The patch is the OCC2 span's own footprint: 3005-3040 m is the deck under the
 * trestle, and 0.74 is `HZ_SALT_DRIFT_SWEEP`'s authored grip multiplier — the
 * map's own salt-drift value, not a new number.
 */
export const SALT_PATCH_FROM_METERS = 3005;
export const SALT_PATCH_TO_METERS = 3040;
export const SALT_PATCH_GRIP = 0.74;
export const SALT_PATCH_SECONDS = 6;
/** The lamps go solid this long before the salt lands. */
export const SALT_WARNING_SECONDS = 2;
/**
 * Where the drop arms, metres of course distance.
 *
 * 165 m short of the patch, which is ~2.0 s at the ~82 m/s the demo carries
 * through the works — so the craft reaches the span at about the instant the
 * salt does, having watched the lamps hold solid the whole way in.
 */
export const SALT_ARM_DISTANCE_METERS = SALT_PATCH_FROM_METERS - 165;
/** Lap 1's pass is always clean: a first-time driver learns the track first. */
export const SALT_FIRST_ELIGIBLE_LAP = 2;

/** The Greenwater squall: one per race, on WATER_TABLE -> GREENWATER_SWEEP. */
export const SQUALL_FROM_METERS = 378;
export const SQUALL_TO_METERS = 1128;
export const SQUALL_SECONDS = 25;
export const SQUALL_RAMP_SECONDS = 2;
export const SQUALL_GRIP = 0.88;
export const SQUALL_FOG_GAIN = 1.18;
export const SQUALL_RAIN_ALPHA_GAIN = 2.2;
export const SQUALL_RAIN_SPEED_GAIN = 1.5;
export const SQUALL_FIRST_ELIGIBLE_LAP = 2;
export const SQUALL_LAST_ELIGIBLE_LAP = 4;

/**
 * The open Bitterpan sectors a gust may arm in, metres.
 *
 * THE LONG PAN, CONE ROW SWEEP and RETURN LEG — the three stretches with
 * nothing standing beside the deck, which is both where a crosswind is
 * physically plausible and where the driver has room to be pushed. The works,
 * the underpass and the technical chicane are excluded on purpose: a lateral
 * shove between the harvester rigs would be a cheap shot rather than weather.
 */
export const GUST_WINDOWS = Object.freeze([
  Object.freeze({ from: 160, to: 630 }),
  Object.freeze({ from: 1000, to: 1600 }),
  Object.freeze({ from: 1640, to: 2120 }),
]);

/**
 * Gusts per lap before the arc adds one.
 *
 * The brief authors 5-8 per lap; the arc adds one from lap 3, so the base is
 * seeded in 5..7 and the late laps land in 6..8. Over five laps that is
 * 2*base + 3*(base+1) = 5*base + 3, i.e. 28 / 33 / 38 — inside the 27-40 band
 * the acceptance asks for at every seed rather than at the one that was run.
 */
export const GUST_MINIMUM_PER_LAP = 5;
export const GUST_MAXIMUM_BASE_PER_LAP = 7;

/**
 * The authored Bitterpan wind, degrees.
 *
 * Not chosen here: `BITTERPAN_PRODUCTION.json` already says the salt drift is
 * "banked by a steady 292-degree wind", and the WIND_salt_drift massing family
 * is laid out against it. The gust is that same wind gusting, so it resolves to
 * course-right or course-left per station from the same bearing rather than
 * flipping on a coin.
 */
export const BITTERPAN_WIND_BEARING_DEGREES = 292;

/**
 * mulberry32. The same generator shape `living-world-zones.js` uses for its own
 * seeded card layout: integer state, one multiply-xor round, no globals.
 *
 * @param {number} seed
 * @returns {() => number}
 */
export function seededRandom(seed) {
  let state = (Math.floor(seed) || 1) >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/** @param {number} value @param {number} minimum @param {number} maximum */
function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

/**
 * The gust's share of its peak, 0..1, `seconds` after arming.
 *
 * Piecewise linear on purpose. A smoothstep was the alternative and it is the
 * wrong shape for this cue: the ramp-in is what the driver feels arrive, and a
 * curve that starts flat delays the arrival past the telegraph it was supposed
 * to answer.
 *
 * @param {number} seconds since the gust armed
 * @returns {number} 0..1
 */
export function gustEnvelope(seconds) {
  const t = Number.isFinite(seconds) ? seconds : -1;
  if (t <= GUST_RAMP_START_SECONDS || t >= GUST_END_SECONDS) return 0;
  if (t < GUST_HOLD_START_SECONDS) {
    return (t - GUST_RAMP_START_SECONDS) / GUST_RAMP_IN_SECONDS;
  }
  if (t <= GUST_HOLD_END_SECONDS) return 1;
  return 1 - (t - GUST_HOLD_END_SECONDS) / GUST_RAMP_OUT_SECONDS;
}

/**
 * The crossing-scud traverse for one card, 0..1, or -1 when the card is outside
 * its window and should be parked.
 *
 * `phase` spreads the zone's twenty cards across GUST_SCUD_SPREAD_FRACTION of
 * the traverse. The runtime holds a parked card at progress 0, where the `cross`
 * alpha envelope is 0 — see the note in track-events.ts on why the parked value
 * matters more than it looks.
 *
 * @param {number} seconds since the gust armed
 * @param {number} phase the card's own 0..1 phase
 */
export function gustScudTraverse(seconds, phase) {
  const centre = GUST_HOLD_START_SECONDS - GUST_TELEGRAPH_SECONDS
    + (clamp(Number.isFinite(phase) ? phase : 0, 0, 1) - 0.5)
      * 2 * GUST_SCUD_SPREAD_FRACTION * GUST_SCUD_TRAVERSE_SECONDS;
  const start = centre - GUST_SCUD_TRAVERSE_SECONDS / 2;
  const progress = (seconds - start) / GUST_SCUD_TRAVERSE_SECONDS;
  if (!Number.isFinite(progress) || progress < 0 || progress > 1) return -1;
  return progress;
}

/**
 * The lead a card of this phase gives, in seconds: how long before the hold
 * starts its traverse puts it on the centreline.
 *
 * The acceptance number, written as a function so the validator asserts the
 * same expression the runtime draws with rather than a copy of it.
 *
 * @param {number} phase
 */
export function gustTelegraphLeadSeconds(phase) {
  return GUST_TELEGRAPH_SECONDS
    - (clamp(Number.isFinite(phase) ? phase : 0, 0, 1) - 0.5)
      * 2 * GUST_SCUD_SPREAD_FRACTION * GUST_SCUD_TRAVERSE_SECONDS;
}

/**
 * The gust peak this lap may reach, m/s^2.
 * @param {number} lap
 */
export function gustPeakForLap(lap) {
  const gain = lap >= TENSION_ARC_FIRST_LAP ? GUST_TENSION_GAIN : 1;
  return Math.min(GUST_PEAK_CEILING_MPS2, GUST_BASE_PEAK_MPS2 * gain);
}

/**
 * How many gusts a lap carries, given the race's seeded base count.
 * @param {number} baseCount @param {number} lap
 */
export function gustCountForLap(baseCount, lap) {
  return baseCount + (lap >= TENSION_ARC_FIRST_LAP ? 1 : 0);
}

/**
 * The squall's share of its full strength, 0..1, `seconds` after arming.
 *
 * Ramped at both ends rather than switched. The rain-card alpha gain, the fog
 * multiplier and the deck grip all ride this number, and a step change in any
 * of the three is a visible pop; the grip in particular would arrive as a
 * steering fault rather than as weather.
 *
 * @param {number} seconds
 */
export function squallEnvelope(seconds) {
  const t = Number.isFinite(seconds) ? seconds : -1;
  if (t < 0 || t > SQUALL_SECONDS) return 0;
  if (t < SQUALL_RAMP_SECONDS) return t / SQUALL_RAMP_SECONDS;
  const fromEnd = SQUALL_SECONDS - t;
  if (fromEnd < SQUALL_RAMP_SECONDS) return fromEnd / SQUALL_RAMP_SECONDS;
  return 1;
}

/**
 * The salt patch's decal alpha, 0..1, `seconds` after the salt lands.
 *
 * Fast in, slow out: salt hits the deck and then blows off it. The grip window
 * is a hard 6 s either way — the picture fading is not allowed to make the
 * hazard ambiguous, so `saltPatchGrip` reads the window and not this.
 *
 * @param {number} seconds since the drop landed
 */
export function saltPatchAlpha(seconds) {
  const t = Number.isFinite(seconds) ? seconds : -1;
  if (t < 0 || t > SALT_PATCH_SECONDS) return 0;
  return clamp(t / 0.3, 0, 1) * (1 - t / SALT_PATCH_SECONDS);
}

/**
 * Builds one race's worth of events.
 *
 * @param {{
 *   kind: "greenwater" | "bitterpan",
 *   seed: number,
 *   totalLaps: number,
 *   courseLengthMeters: number,
 *   resolveGustSign?: (courseDistanceMeters: number) => number,
 * }} input
 */
export function buildTrackEventSchedule(input) {
  const kind = input.kind;
  const totalLaps = Math.max(1, Math.floor(input.totalLaps) || 1);
  const length = Number.isFinite(input.courseLengthMeters) && input.courseLengthMeters > 0
    ? input.courseLengthMeters
    : 1;
  const random = seededRandom(input.seed);
  const resolveSign = typeof input.resolveGustSign === "function"
    ? input.resolveGustSign
    : () => 1;

  /** @type {{ id: string, lap: number, armDistanceMeters: number, sign: number, peakMetersPerSecondSquared: number, courseDistanceMeters: number }[]} */
  const gusts = [];
  /** @type {{ id: string, lap: number, armDistanceMeters: number }[]} */
  const saltDrops = [];
  /** @type {{ id: string, lap: number, armDistanceMeters: number, courseDistanceMeters: number } | null} */
  let squall = null;

  if (kind === "bitterpan") {
    // The base count is drawn ONCE for the race, not per lap: the arc is the
    // only thing allowed to change how many gusts a lap carries, so a lap that
    // happened to roll low would otherwise read as the arc going backwards.
    const baseCount = GUST_MINIMUM_PER_LAP
      + Math.floor(random() * (GUST_MAXIMUM_BASE_PER_LAP - GUST_MINIMUM_PER_LAP + 1));
    const windowSpan = GUST_WINDOWS.reduce((total, w) => total + (w.to - w.from), 0);
    for (let lap = 1; lap <= totalLaps; lap += 1) {
      const count = gustCountForLap(baseCount, lap);
      const peak = gustPeakForLap(lap);
      for (let index = 0; index < count; index += 1) {
        // Even spread over the CONCATENATED open windows, then jittered inside
        // its own slot. Even-then-jitter rather than `count` free draws: free
        // draws clump, and two gusts 30 m apart is one long gust with a dead
        // spot in the middle rather than two events.
        const slot = windowSpan * (index + 0.25 + random() * 0.5) / count;
        let remaining = slot;
        /** @type {number} */
        let station = GUST_WINDOWS[0].from;
        for (const window of GUST_WINDOWS) {
          const span = window.to - window.from;
          if (remaining <= span) {
            station = window.from + remaining;
            break;
          }
          remaining -= span;
          station = window.to;
        }
        gusts.push({
          id: `gust-L${lap}-${index}`,
          lap,
          courseDistanceMeters: station,
          armDistanceMeters: (lap - 1) * length + station,
          sign: resolveSign(station) >= 0 ? 1 : -1,
          peakMetersPerSecondSquared: peak,
        });
      }
    }

    // 2 or 3 drops, drawn from the laps that are allowed to carry one. Lap 1 is
    // never eligible, which is the whole "nothing happens on lap 1" rule made
    // structural rather than checked after the fact.
    const eligible = [];
    for (let lap = SALT_FIRST_ELIGIBLE_LAP; lap <= totalLaps; lap += 1) eligible.push(lap);
    const wanted = Math.min(eligible.length, 2 + Math.floor(random() * 2));
    for (let picked = 0; picked < wanted; picked += 1) {
      const at = Math.floor(random() * eligible.length);
      const lap = eligible.splice(at, 1)[0];
      saltDrops.push({
        id: `salt-L${lap}`,
        lap,
        armDistanceMeters: (lap - 1) * length + SALT_ARM_DISTANCE_METERS,
      });
    }
    saltDrops.sort((a, b) => a.armDistanceMeters - b.armDistanceMeters);
  }

  if (kind === "greenwater") {
    const lastLap = Math.min(SQUALL_LAST_ELIGIBLE_LAP, totalLaps);
    if (lastLap >= SQUALL_FIRST_ELIGIBLE_LAP) {
      const lap = SQUALL_FIRST_ELIGIBLE_LAP
        + Math.floor(random() * (lastLap - SQUALL_FIRST_ELIGIBLE_LAP + 1));
      const station = SQUALL_FROM_METERS
        + random() * (SQUALL_TO_METERS - SQUALL_FROM_METERS) * 0.5;
      squall = {
        id: `squall-L${lap}`,
        lap,
        courseDistanceMeters: station,
        armDistanceMeters: (lap - 1) * length + station,
      };
    }
  }

  return { kind, seed: input.seed, totalLaps, gusts, saltDrops, squall };
}

/**
 * Is this course distance inside the salt patch footprint?
 * @param {number} courseDistanceMeters
 */
export function isInsideSaltPatch(courseDistanceMeters) {
  return courseDistanceMeters >= SALT_PATCH_FROM_METERS
    && courseDistanceMeters <= SALT_PATCH_TO_METERS;
}

/**
 * Is this course distance inside the squall's two sectors?
 * @param {number} courseDistanceMeters
 */
export function isInsideSquallSectors(courseDistanceMeters) {
  return courseDistanceMeters >= SQUALL_FROM_METERS
    && courseDistanceMeters <= SQUALL_TO_METERS;
}

/**
 * The deck grip an event asks for at this place and these levels.
 *
 * ONE multiplier for both events, and the smaller of the two wins where they
 * could ever overlap (they cannot — one is Bitterpan, the other Greenwater —
 * but a rule that depends on two maps never sharing a hazard is a rule waiting
 * to be broken by map 3). It leaves this module as a number and enters the
 * physics through `resolveTargetSurfaceGrip`'s event term, so the salt patch
 * and the squall reach the craft the same way standing water already does.
 *
 * @param {number} courseDistanceMeters
 * @param {number} saltPatchLevel 0 or 1 — the patch is live or it is not
 * @param {number} squallLevel 0..1
 */
export function eventSurfaceGrip(courseDistanceMeters, saltPatchLevel, squallLevel) {
  let grip = 1;
  if (saltPatchLevel > 0 && isInsideSaltPatch(courseDistanceMeters)) {
    grip = Math.min(grip, SALT_PATCH_GRIP);
  }
  if (squallLevel > 0 && isInsideSquallSectors(courseDistanceMeters)) {
    grip = Math.min(grip, 1 - (1 - SQUALL_GRIP) * clamp(squallLevel, 0, 1));
  }
  return grip;
}

/**
 * The fog-density multiplier the squall asks for at this place.
 * @param {number} courseDistanceMeters
 * @param {number} squallLevel 0..1
 */
export function eventFogMultiplier(courseDistanceMeters, squallLevel) {
  if (squallLevel <= 0 || !isInsideSquallSectors(courseDistanceMeters)) return 1;
  return 1 + (SQUALL_FOG_GAIN - 1) * clamp(squallLevel, 0, 1);
}
