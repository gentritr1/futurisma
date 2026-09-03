/**
 * H2b — the pit radio's line table and every decision about WHEN one plays.
 *
 * Plain JavaScript, and deliberately so: `scripts/validate-audio-ambience.mjs`
 * runs under Node, which has no Web Audio, so the only way the queue rules can
 * be attacked by a validator is for them to live outside the graph that plays
 * them. `src/game/pit-radio.ts` owns the AudioContext, the band-pass colour and
 * the duck; this file owns the table, the priorities, the cooldowns and the
 * edge detection, and it never touches a node.
 *
 * The split follows `track-events-rules.js` / `track-events.ts` and
 * `race-modes-rules.js` / `race-modes.ts` for the same reason each of those
 * did it.
 */

/** The encode rate, shared by the preparation script and the served files. */
export const PIT_RADIO_SAMPLE_RATE = 24_000;

/** The served directory, relative to the site root. */
export const PIT_RADIO_DIRECTORY = "/assets/audio/radio/";

/** The served extension. See `scripts/prepare-pit-radio.mjs` for why MP3. */
export const PIT_RADIO_EXTENSION = ".mp3";

/**
 * The seventeen lines, in priority order, highest first.
 *
 * The ordering is a driver-safety ordering, not a drama ordering: the four at
 * the top are things the driver has to act on RIGHT NOW (they are off the deck,
 * pointing the wrong way, have lost a gate, or are about to lose grip), the
 * middle is the weather and the race state, and the bottom is the reward
 * chatter that a busy lap is allowed to swallow. `gate_clear` is last on
 * purpose: it is the most frequent event in the game and the least urgent, so
 * it should be the first thing dropped when anything else wants the bus.
 *
 * `script` is the recorded line, kept here so the trigger table in a review can
 * be read against what the driver actually hears without opening the WAVs.
 *
 * @type {Record<string, { priority: number, script: string }>}
 */
export const PIT_RADIO_LINES = {
  off_course: { priority: 0, script: "Off course. Recovery in three." },
  wrong_way: { priority: 1, script: "Wrong way. Turn around." },
  gate_missed: { priority: 2, script: "Gate missed. Recover and re-cross." },
  squall_sweep: { priority: 3, script: "Squall on the sweep. Thirty seconds." },
  gust_left: { priority: 4, script: "Gust from the left. Brace." },
  gust_right: { priority: 4, script: "Gust from the right. Brace." },
  salt_on_span: { priority: 5, script: "Salt on the span." },
  final_lap: { priority: 6, script: "Final lap." },
  lights_out: { priority: 7, script: "Lights out. Go." },
  classification_locked: { priority: 8, script: "Classification locked." },
  new_best_lap: { priority: 9, script: "New best lap." },
  position_lost: { priority: 10, script: "Position lost." },
  position_gained: { priority: 11, script: "Position gained." },
  slipstream_locked: { priority: 12, script: "Slipstream locked. Make the pass." },
  near_miss: { priority: 13, script: "Near miss. Clean." },
  clean_chain: { priority: 14, script: "Clean chain. Keep it." },
  gate_clear: { priority: 15, script: "Gate clear." },
};

/** Every line id, in priority order. */
export const PIT_RADIO_IDS = Object.keys(PIT_RADIO_LINES)
  .sort((a, b) => PIT_RADIO_LINES[a].priority - PIT_RADIO_LINES[b].priority);

/** The minimum silence between the end of one line and the start of the next. */
export const PIT_RADIO_MIN_GAP_SECONDS = 1.4;

/**
 * `gate_clear` may speak at most this often.
 *
 * Bitterpan has eight gates on a ~38 s lap, so an ungated `gate_clear` would be
 * a line every 4.8 s for the length of the race, which is the "too frequent"
 * failure the listening checklist is watching for. Twenty seconds means the
 * driver hears it about twice a lap — enough that the voice is a presence, not
 * enough that it becomes the metronome.
 */
export const PIT_RADIO_GATE_CLEAR_COOLDOWN_SECONDS = 20;

/** The two clean-gate chain lengths the radio remarks on. */
export const PIT_RADIO_CLEAN_CHAIN_STEPS = [3, 6];

/** A position change must survive this long before it is worth saying. */
export const PIT_RADIO_POSITION_HOLD_SECONDS = 1.5;

/**
 * How long a queued line may wait before it is dropped instead of played.
 *
 * A radio that says "Gate missed" four seconds after the gate is worse than a
 * radio that says nothing: the driver has already recovered and the line now
 * describes a different corner. Everything in the table is a statement about
 * the last second or two of the race, so nothing in it survives three.
 */
export const PIT_RADIO_MAX_QUEUE_AGE_SECONDS = 3;

/**
 * How many lines may wait at once.
 *
 * Deeper than one, because a gust arming during a gate crossing is an ordinary
 * pair and losing the second is a real loss; shallower than the table, because
 * a queue that can hold five lines will eventually play five lines in a row and
 * that is a commentator, not a pit radio.
 */
export const PIT_RADIO_QUEUE_DEPTH = 3;

/** @param {string} id @returns {number} */
export function pitRadioPriority(id) {
  const line = PIT_RADIO_LINES[id];
  return line ? line.priority : Number.POSITIVE_INFINITY;
}

/** @param {string} id @returns {string} The served path for one line. */
export function pitRadioPath(id) {
  return `${PIT_RADIO_DIRECTORY}${id}${PIT_RADIO_EXTENSION}`;
}

/**
 * Whether `gate_clear` may speak again.
 *
 * Here rather than inline in `pit-radio.ts` for the same reason everything else
 * in this file is here: it is the one gate that silences the game's most
 * frequent event, so it is the one most worth a validator being able to run.
 *
 * @param {number} lastSpokenAt Audio-clock seconds, or -Infinity if never.
 * @param {number} nowSeconds
 */
export function gateClearReady(lastSpokenAt, nowSeconds) {
  return nowSeconds - lastSpokenAt >= PIT_RADIO_GATE_CLEAR_COOLDOWN_SECONDS;
}

/**
 * @typedef {object} QueuedLine
 * @property {string} id
 * @property {number} priority
 * @property {number} queuedAt Seconds on the audio clock.
 */

/**
 * Offers a line to the queue.
 *
 * Returns the number of lines DROPPED by the offer, so the caller's diagnostic
 * counter is fed by the same decision that made it rather than by a second
 * guess at it. The queue array is mutated in place — this runs on the 30 Hz
 * control tick and must not allocate.
 *
 * The rules, in the order they apply:
 *   - a line already waiting is not queued twice (the second gust of a pair
 *     replaces nothing and adds nothing);
 *   - a full queue makes room only by evicting something STRICTLY lower
 *     priority, so `gate_clear` can never push `off_course` out;
 *   - the queue stays sorted by priority, then by arrival, so `nextLine` is a
 *     shift rather than a scan.
 *
 * Nothing here can touch a line that is already playing. Pre-emption in this
 * radio means "goes first", never "cuts off" — a half-spoken word is the one
 * artefact that would make the voice read as a bug rather than as a driver aid.
 *
 * @param {QueuedLine[]} queue
 * @param {string} id
 * @param {number} nowSeconds
 * @returns {number} lines dropped (0, 1 for a rejected offer, or 1 for an evictee)
 */
export function admitLine(queue, id, nowSeconds) {
  const priority = pitRadioPriority(id);
  if (!Number.isFinite(priority)) return 1;
  for (const entry of queue) if (entry.id === id) return 1;
  if (queue.length >= PIT_RADIO_QUEUE_DEPTH) {
    const lowest = queue[queue.length - 1];
    if (lowest.priority <= priority) return 1;
    queue.pop();
  }
  let at = queue.length;
  while (at > 0 && queue[at - 1].priority > priority) at -= 1;
  queue.splice(at, 0, { id, priority, queuedAt: nowSeconds });
  return queue.length > PIT_RADIO_QUEUE_DEPTH ? 1 : 0;
}

/**
 * Drops everything that has waited past {@link PIT_RADIO_MAX_QUEUE_AGE_SECONDS}.
 *
 * @param {QueuedLine[]} queue
 * @param {number} nowSeconds
 * @returns {number} how many were dropped
 */
export function expireQueue(queue, nowSeconds) {
  let dropped = 0;
  for (let index = queue.length - 1; index >= 0; index -= 1) {
    if (nowSeconds - queue[index].queuedAt <= PIT_RADIO_MAX_QUEUE_AGE_SECONDS) continue;
    queue.splice(index, 1);
    dropped += 1;
  }
  return dropped;
}

/**
 * The next line to speak, or `""` when the bus is busy, empty or inside the gap.
 *
 * @param {QueuedLine[]} queue
 * @param {number} nowSeconds
 * @param {number} busUntilSeconds When the playing line ends (0 if idle).
 * @returns {string}
 */
export function nextLine(queue, nowSeconds, busUntilSeconds) {
  if (nowSeconds < busUntilSeconds + PIT_RADIO_MIN_GAP_SECONDS) return "";
  const head = queue.shift();
  return head ? head.id : "";
}

/**
 * @typedef {object} RadioFrame
 * @property {boolean} raceActive
 * @property {boolean} wrongWay
 * @property {boolean} recoveryActive The off-course countdown is running.
 * @property {number} cleanGateChain
 * @property {number} position
 * @property {number} racerCount
 * @property {number} lap
 * @property {number} lastLapMs 0 before the first lap closes.
 */

/**
 * @typedef {object} RadioEdgeState
 * @property {boolean} wrongWay
 * @property {boolean} recoveryActive
 * @property {number} cleanGateChain
 * @property {number} position
 * @property {number} pendingPosition -1 when no change is being held.
 * @property {number} pendingPositionAt
 * @property {number} lap
 * @property {number} bestLapMs 0 until a lap has closed.
 */

/** @returns {RadioEdgeState} */
export function radioEdgeState() {
  return {
    wrongWay: false,
    recoveryActive: false,
    cleanGateChain: 0,
    position: 0,
    pendingPosition: -1,
    pendingPositionAt: 0,
    lap: 0,
    bestLapMs: 0,
  };
}

/**
 * The five lines that are read off the HUD frame rather than off an audio cue,
 * resolved as edges against the previous frame.
 *
 * WHY THE HUD FRAME. PRODUCT.md's accessibility rule is that the game must be
 * playable without audio and that critical state is never communicated by sound
 * alone. Driving these five off the exact `HudFrame` the HUD renders makes that
 * true by construction rather than by review: the radio physically cannot say
 * something the HUD is not already showing, because it is reading the same
 * object on the same frame.
 *
 * `state` is mutated in place and `out` is filled rather than returned, because
 * this runs on the control tick.
 *
 * @param {RadioEdgeState} state
 * @param {RadioFrame} frame
 * @param {number} nowSeconds
 * @param {string[]} out Cleared and filled with the ids to queue.
 */
export function resolveFrameLines(state, frame, nowSeconds, out) {
  out.length = 0;
  if (!frame.raceActive) {
    // Between races the edges are re-armed rather than carried, so the first
    // frame of the next race cannot fire a line about the last one.
    state.wrongWay = frame.wrongWay;
    state.recoveryActive = frame.recoveryActive;
    state.cleanGateChain = frame.cleanGateChain;
    state.position = frame.position;
    state.pendingPosition = -1;
    state.lap = frame.lap;
    state.bestLapMs = 0;
    return;
  }

  if (frame.recoveryActive && !state.recoveryActive) out.push("off_course");
  state.recoveryActive = frame.recoveryActive;

  if (frame.wrongWay && !state.wrongWay) out.push("wrong_way");
  state.wrongWay = frame.wrongWay;

  // Only on the way UP, and only onto an authored step. A chain that falls from
  // 7 to 3 has not been rebuilt and there is nothing to keep.
  if (
    frame.cleanGateChain > state.cleanGateChain
    && PIT_RADIO_CLEAN_CHAIN_STEPS.includes(frame.cleanGateChain)
  ) out.push("clean_chain");
  state.cleanGateChain = frame.cleanGateChain;

  // A lap closes when its time appears. The first lap of a race has nothing to
  // beat, so it sets the mark silently.
  if (frame.lastLapMs > 0 && frame.lap > state.lap) {
    if (state.bestLapMs > 0 && frame.lastLapMs < state.bestLapMs) out.push("new_best_lap");
    if (state.bestLapMs === 0 || frame.lastLapMs < state.bestLapMs) {
      state.bestLapMs = frame.lastLapMs;
    }
    state.lap = frame.lap;
  }

  // A change that has not held for PIT_RADIO_POSITION_HOLD_SECONDS is a pass
  // in progress, not a pass made; saying either half of a swap twice is the
  // thing that makes a radio sound like a scoreboard.
  if (frame.racerCount > 1) {
    // 0 is "no position observed yet", not "position zero". Without this the
    // first racing frame reads as a change from 0 to the grid slot and, 1.5 s
    // later, the radio opens every race by announcing a position the driver
    // never lost. Found by the validator below rather than by a playtest, which
    // is the reason these five edges are pure functions.
    if (state.position === 0) {
      state.position = frame.position;
      state.pendingPosition = -1;
    } else if (frame.position !== state.position) {
      if (frame.position !== state.pendingPosition) {
        state.pendingPosition = frame.position;
        state.pendingPositionAt = nowSeconds;
      } else if (
        nowSeconds - state.pendingPositionAt >= PIT_RADIO_POSITION_HOLD_SECONDS
      ) {
        out.push(frame.position < state.position ? "position_gained" : "position_lost");
        state.position = frame.position;
        state.pendingPosition = -1;
      }
    } else {
      state.pendingPosition = -1;
    }
  } else {
    state.position = frame.position;
    state.pendingPosition = -1;
  }
}

/**
 * The three weather lines, resolved off `trackEventState()`.
 *
 * The caller hands the ARM serial rather than the levels, because the voice has
 * to land on the telegraph — 1.2 s before a gust's hold and 3 s before a salt
 * patch is live — and a level-driven trigger necessarily fires at the hold,
 * which is a second too late to be a warning. `armGustSign` is the same signed
 * push `integrateGustVelocity` is about to apply, so the word and the shove
 * agree by construction.
 *
 * THE DIRECTION, spelled out because it is the one thing here that can be got
 * backwards and still look right. `gustChipLabel` in `track-events-rules.js`
 * draws `GUST →` for a positive sign because a positive sign pushes the craft
 * to starboard. The recorded line names where the WIND comes FROM, which is the
 * side opposite the push: a shove to the right is a gust from the left. So a
 * positive sign is `gust_left`, and the arrow and the word deliberately name
 * opposite sides of the same event.
 *
 * @param {{ armSerial: number, lastEvent: string, armGustSign: number }} events
 * @param {number} lastSerial
 * @returns {string} The line id, or "" when nothing armed.
 */
export function resolveEventLine(events, lastSerial) {
  if (events.armSerial === lastSerial) return "";
  if (events.lastEvent === "squall") return "squall_sweep";
  if (events.lastEvent === "salt") return "salt_on_span";
  if (events.lastEvent !== "gust") return "";
  if (events.armGustSign > 0) return "gust_left";
  if (events.armGustSign < 0) return "gust_right";
  return "";
}
