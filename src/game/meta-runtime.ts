/**
 * P7 — the two places the meta layer touches the running race.
 *
 * `game.ts` sits against a 1,950-line seam budget, so the work behind both of
 * these lives here and the race loop keeps only the call. Both functions are
 * deliberately total: a missing fleet, a decal sheet that will not load, or a
 * course key the save file refuses are all ordinary outcomes, never throws.
 */
import { liveryFor } from "./liveries.js";
import { save } from "./persistence";
import type { RivalFleet } from "./rivals";
import type { TotemVehicle } from "./totem";
import type { GameUi } from "./ui";

/**
 * Swaps the player's decal sheet and re-issues the field's, live, with no
 * reload and no new draw call: the player's body material takes a different
 * texture, and each rival's atlas quadrant offset is rewritten in place so the
 * three field craft still share one instanced draw.
 *
 * The chosen sheet is removed from the field — the rival that would have worn
 * it takes the works sheet instead — so the grid is always four distinct
 * liveries and the player is never looking at their own colours in a mirror.
 */
export async function applyRaceLivery(
  vehicle: TotemVehicle,
  fleet: RivalFleet | null,
  code: string,
  ui: GameUi,
): Promise<void> {
  const livery = liveryFor(code);
  save.setLivery(livery.code);
  await vehicle.applyLivery(livery.texture);
  fleet?.setPlayerLivery(livery.code);
  ui.setPlayerLivery(livery.label, fleet?.gridEntries ?? []);
}

/**
 * Folds a finished race into the course's stored record and reports whether the
 * lap that was just set is the fastest this browser has ever seen on it.
 *
 * The return value is what drives the result screen's `NEW BEST` flash, so the
 * flash and the file can never disagree: the same comparison decides both.
 */
export function recordFinishedRace(
  mapCode: string,
  bestLapMs: number | null,
  raceMs: number,
  laps: number,
): boolean {
  return save.recordRace(mapCode, { bestLapMs, raceMs, laps }).newBestLap;
}

/** The stored best lap for a course, or null when nothing is on file yet. */
export function storedBestLapMs(mapCode: string): number | null {
  return save.recordFor(mapCode).bestLapMs;
}
