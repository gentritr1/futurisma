/**
 * P7 — the two places the meta layer touches the running race.
 *
 * `game.ts` sits against a 1,950-line seam budget, so the work behind both of
 * these lives here and the race loop keeps only the call. Both functions are
 * deliberately total: a missing fleet, a decal sheet that will not load, or a
 * course key the save file refuses are all ordinary outcomes, never throws.
 */
import { ghostRuntime } from "./ghost-runtime";
import { bootLiveryToApply, liveryFor } from "./liveries.js";
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
 * P17.1 — puts the stored livery on the craft at boot.
 *
 * `MetaUi.syncFromSave` restores the stored choice into the chip row, and
 * `ChipGroup.setValue` deliberately does not fire `onCommit`. Nothing else
 * applied it, so a reload left the HUD saying `NIGHTFORM 24` over a craft still
 * wearing the works sheet baked into the GLB.
 *
 * WHY THIS IS NOT "JUST MAKE setValue FIRE onCommit". `syncFromSave` drives
 * five chip groups, and `setValue`'s silence is load-bearing for all of them.
 * Read off what each group actually commits:
 *
 *   - **track** commits `dispatchCircuit`, which writes `save.setTrack` and
 *     then either RE-ENTERS `trackGroup.setValue` (when the chip matches the
 *     circuit this session was loaded for, which is exactly the sync case) or
 *     assigns `window.location.search` (when it does not). One re-enters a
 *     method that would now commit; the other navigates. Neither is something a
 *     constructor-time sync may do.
 *   - **motion / quality / render** commit `storeSetting`, a `save.updateSettings`
 *     write plus `refreshPending`. Writing back a value just read is usually a
 *     no-op — but `setValue` resolves an unknown value to index 0
 *     (`index < 0 ? 0 : index`), so a save holding a setting this build's chip
 *     row does not offer would be silently REWRITTEN to the first option
 *     instead of being left alone. Restoring a choice must never be able to
 *     change it.
 *   - **livery** commits `applyRaceLivery`, which needs a loaded
 *     `TotemVehicle`. `MetaUi` is constructed in `main.ts` BEFORE
 *     `game.initialize()` resolves, so at sync time `bodyMaterial()` returns
 *     null, `applyLivery` returns false, and the swap silently does nothing.
 *     Committing there would not have fixed this bug — it would have hidden it
 *     behind a call that looked like it ran.
 *
 * So the restore does not move into the sync, and it does not go through
 * `ChipGroup` at all: none of the four side effects above can fire, because
 * nothing here touches the chip row, the track, or the settings. It runs later,
 * on the boot path, once the vehicle and the fleet exist — the same world state
 * the chip click sees, through the same `applyRaceLivery`. That is the whole
 * guarantee: the P17 wear treatment and the per-livery `uWearScale` compose on
 * this path because it is not a second path.
 *
 * NON-FATAL, like the swap it wraps. `vehicle.applyLivery` already answers a
 * failed sheet fetch by keeping the works decal and returning false. This adds
 * the outer guard for the same reason: a livery that will not load must cost
 * the player their paint, never their race, and rejecting here would reach
 * `main.ts`'s `.catch` and replace the grid with an error screen.
 *
 * The shortfall is not silent. `storedLivery` and `wearScale` are both in the
 * diagnostics payload, and a stored nightform that failed to apply reads as
 * `storedLivery: "nightform"` with `wearScale: 1` — which is exactly the
 * signature this bug was found by.
 *
 * @returns the code it installed, or null when the boot path had nothing to do.
 */
export async function restoreStoredLivery(
  applyLivery: (code: string) => Promise<void>,
): Promise<string | null> {
  const code = bootLiveryToApply(save.livery);
  if (code === null) return null;
  try {
    await applyLivery(code);
  } catch {
    return null;
  }
  return code;
}

/**
 * Folds a finished race into the course's stored record and reports whether the
 * lap that was just set is the fastest this browser has ever seen on it.
 *
 * The return value is what drives the result screen's `NEW BEST` flash, so the
 * flash and the file can never disagree: the same comparison decides both.
 *
 * P10 hung the ghost off the same call for exactly that reason. The recording
 * is offered here and `applyRaceResult` keeps it only when `newBestLap` — one
 * comparison, three consequences: the flash, the stored time, and the replay
 * the next race runs against. They cannot drift apart because there is nothing
 * to drift.
 *
 * `lapTimesMs` arrives whole rather than as a count because the ghost needs the
 * final lap's time: the race ends on the crossing that closes it, so that lap
 * is still open in the recorder when this runs.
 */
export function recordFinishedRace(
  mapCode: string,
  bestLapMs: number | null,
  raceMs: number,
  lapTimesMs: readonly number[],
): boolean {
  return save.recordRace(mapCode, {
    bestLapMs,
    raceMs,
    laps: lapTimesMs.length,
    ghost: ghostRuntime.bestLapRecording(lapTimesMs[lapTimesMs.length - 1] ?? null),
  }).newBestLap;
}

/** The stored best lap for a course, or null when nothing is on file yet. */
export function storedBestLapMs(mapCode: string): number | null {
  return save.recordFor(mapCode).bestLapMs;
}
