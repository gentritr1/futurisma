import type { AudioZone } from "./audio-space.js";

/**
 * A1 — the two module-level latches the ambience field reads, and nothing else.
 *
 * This file is deliberately tiny and deliberately separate from
 * `audio-ambience.ts`. That module carries the bed plan and about 29 s of baked
 * loop synthesis, and it is DYNAMICALLY imported by `audio.ts` so none of it
 * lands in the initial bundle — `validate-build.mjs` holds the shell to a gzip
 * ceiling and A1 went 5.5 KiB over it on the first attempt. What cannot be
 * lazy is `publishAmbienceCue`, because the race loop calls it synchronously on
 * every frame, so it lives here on its own.
 */

export type AmbienceMapId = "greenwater" | "bitterpan" | "nightshift" | "polarity" | "tideline";

export interface AmbienceEventLevels {
  windGust: number;
  squall: number;
  saltDrop: number;
}

export interface AmbienceCue {
  map: AmbienceMapId | null;
  distanceMeters: number;
  lapLengthMeters: number;
  submerged: boolean;
}

const cue: AmbienceCue = { map: null, distanceMeters: 0, lapLengthMeters: 1, submerged: false };

const eventLevels: AmbienceEventLevels = { windGust: 0, squall: 0, saltDrop: 0 };

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/**
 * The one seam the race loop touches, and the reason it costs no lines.
 *
 * `game.ts` already called `this.course.audioZoneAt(this.progress)` inside the
 * `audio.update(...)` argument list. That call is replaced by this one, which
 * returns exactly the same `AudioZone` and additionally latches the lap
 * distance and map the beds need — the `time-of-day.ts` publish idiom, for the
 * same reason: `game.ts` sits exactly on a 1975-line seam budget with zero
 * headroom, and a wider `update()` signature would have cost argument lines at
 * that call site.
 *
 * No allocation, no subscription. Until it has run once the beds have no map
 * and stay silent, which is the correct pre-race state anyway.
 */
export function publishAmbienceCue(
  course: {
    kind: string;
    length: number;
    audioZoneAt(progress: number): AudioZone;
    travelModeAt?(progress: number): string;
  },
  progress: number,
): AudioZone {
  cue.map = course.kind === "bitterpan" || course.kind === "greenwater"
    || course.kind === "nightshift" || course.kind === "polarity" || course.kind === "tideline"
    ? course.kind
    : null;
  cue.lapLengthMeters = course.length > 0 ? course.length : 1;
  const wrapped = Number.isFinite(progress) ? ((progress % 1) + 1) % 1 : 0;
  cue.distanceMeters = wrapped * cue.lapLengthMeters;
  cue.submerged = course.travelModeAt?.(wrapped) === "submerged";
  return course.audioZoneAt(progress);
}

/** The live cue. Read by the audio control tick and by nothing else. */
export function ambienceCue(): Readonly<AmbienceCue> {
  return cue;
}

/**
 * The seam the track-event phase writes to. It is deliberately a latch rather
 * than an import: `track-events.ts` is being built in parallel, and wiring it
 * up once both land is three lines at its own call site — the ambience never
 * has to know that it exists.
 */
export function setEventLevels(levels: Partial<AmbienceEventLevels>): void {
  eventLevels.windGust = clamp01(levels.windGust ?? 0);
  eventLevels.squall = clamp01(levels.squall ?? 0);
  eventLevels.saltDrop = clamp01(levels.saltDrop ?? 0);
}

/** The live track-event levels, for the beds and for diagnostics. */
export function ambienceEventLevels(): Readonly<AmbienceEventLevels> {
  return eventLevels;
}
