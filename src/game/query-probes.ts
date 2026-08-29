import type { InputFrame } from "./input";
import { save } from "./persistence";
import { resolveQualityMode } from "./render-quality";
import type { RenderQualityMode } from "./render-quality";

export const RECOVERY_PROBE_DISTANCE_METERS = 900;
export const WRONG_WAY_PROBE_DISTANCE_METERS = 100;
export const WATER_GRIP_PROBE_DISTANCE_METERS = 580;
/**
 * P16 — re-derived, not deleted, from the measured drivable limits.
 *
 * It used to spawn at FUEL_ROW d 1700, lateral +13.5. That sector's authored
 * apron is 5 m of A either side, but the measured wall there stands at 13.1 m
 * against an 11.5 m half-width, so the derived limit is 11.5 — exactly the deck
 * edge. There is no drivable apron left at 1700 to test, and the old spawn sat
 * 2 m outside the clamp: the probe could not reach its own precondition.
 *
 * GREENWATER_SWEEP at d 878.7 is where the widest run-off actually survives
 * measurement: half-width 12.0 m, derived limit 16.06 m to starboard, so
 * +14.0 m is 2.0 m onto the apron and 2.06 m inside the clamp.
 */
export const APRON_PROBE_DISTANCE_METERS = 878.7;
export const APRON_PROBE_LATERAL_METERS = 14;
export const APRON_PROBE_SPEED_METERS_PER_SECOND = 60;
/**
 * P11 gate-miss probe. WATER_TABLE, 21.5 m short of CP02 (d 586.519), whose
 * gate is 21 m wide — half-width 10.5 m. The deck is also 10.5 m half-width
 * there, with a 5 m A apron either side, so lateral -12.5 m is *legal* run-off
 * that the gate does not accept, and nothing in the race loop used to recover
 * from it: the A apron never arms the off-course timer, so the banner stayed up
 * and `nextCheckpointIndex` stayed frozen for the rest of the race. Coasting
 * from 55 m/s reaches the gate at ~30 m/s, comfortably inside the grace band.
 *
 * The run-up is 21.5 m, not the 46 m the P11 brief first specified, and the
 * number was measured rather than guessed: with no steering the craft holds a
 * straight line while T3 bends away under it, drifting outward ~2.9 m over the
 * 36 m from d 540. From 540 it reached -15.38 m — 0.12 m off the wall — and
 * scored two wall scrapes before the gate, which is noise a regression gate
 * cannot afford. From 565 it crosses at about -13 m: 2.5 m outside the gate and
 * 2.5 m inside the wall. The one impact the probe still reports, at d 588, is
 * the hangar approach wall and is inherent to missing CP02 wide — LINK_APRON
 * authors no run-off, so its clamp is 2.05 m inside a 9.9 m half-width.
 */
/**
 * P16 — re-derived, not deleted. The scenario is preserved; only the place it
 * can be staged has moved.
 *
 * The CP02 staging above is no longer reachable. P16 derived the drivable limit
 * from the measured world, and at d 565 the wall stands at 12.1 m, giving a
 * limit of 10.5 m — exactly CP02's own gate half-width. There is no lateral
 * there that is both inside the clamp and outside the gate, so the probe
 * spawned 2 m beyond the clamp, was pulled back to the deck edge and sailed
 * through the gate it was written to miss. Measured at runtime rather than
 * assumed: `gateMissRecoveries` went to 0 with `maxLateralRatio` pinned at 1.00,
 * while `test:code` stayed green throughout — `validate-race.mjs` runs its own
 * model of the course and never loads the limit table, so it cannot see this.
 *
 * CP04 (d 900.239, gate 24 m wide, half-width 12.0 m) is the widest surviving
 * margin on the lap: the derived limit 21.5 m short of it is 16.06 m to
 * starboard, so lateral +14.0 m is 2.0 m outside the gate and 2.06 m inside the
 * clamp — legal run-off the gate does not accept, which is exactly the P11
 * scenario. The 21.5 m run-up and the 55 m/s coast are unchanged.
 *
 * STARBOARD, and the side was measured rather than chosen. Port drifts INWARD
 * through this bend: spawned at -13.5 m the craft crossed CP04 cleanly and
 * `gateMissRecoveries` stayed 0. From +14.0 m it misses, and the gate-miss
 * recovery fires at GREENWATER SWEEP@952m — `gateMissRecoveries: 1`.
 */
export const GATE_MISS_PROBE_DISTANCE_METERS = 878.7;
export const GATE_MISS_PROBE_LATERAL_METERS = 14;
export const GATE_MISS_PROBE_SPEED_METERS_PER_SECOND = 55;
// The panner reference distance, so the rival-audio probe sits at unity gain.
export const RIVAL_AUDIO_PROBE_METERS = 4;
export const ZERO_INPUT: InputFrame = {
  throttle: 0,
  brake: 0,
  steer: 0,
  boost: false,
};

// Read once. The query string cannot change without a reload, and the repeated
// re-parse was costing game.ts the seam-budget lines that new phases need.
const SEARCH = new URLSearchParams(window.location.search);

export function searchParam(name: string): string | null {
  return SEARCH.get(name);
}

export function searchFlag(name: string): boolean {
  return SEARCH.has(name);
}

export function readProbeNumber(parameter: string, fallback: number): number {
  const value = Number.parseFloat(SEARCH.get(parameter) ?? "");
  return Number.isFinite(value) ? value : fallback;
}

/** A named diagnostics scenario. Probes only ever arm under `?diagnostics=1`. */
export function probeSelected(name: string): boolean {
  return SEARCH.has("diagnostics") && SEARCH.get("probe") === name;
}

/**
 * P11 — where every probe's spawn pose is decided.
 *
 * This used to be a five-deep ternary plus six `if (this.xProbe)` blocks inside
 * `resetRaceState`, and each new probe grew the race loop by another dozen
 * lines against a hard seam budget. The placement is a query-string decision,
 * so it belongs next to the query string.
 *
 * Lateral resolves in two stages, because half the probes are authored against
 * the deck's own width: `halfWidthScale * halfWidth + lateralMetres`, evaluated
 * by {@link probeSpawnLateral} once the start sample is known.
 */
export interface ProbeSpawn {
  progress: number;
  halfWidthScale: number;
  lateralMetres: number;
  speedMps: number;
  /** The wrong-way probe starts pointing back down the course. */
  reversed: boolean;
  /**
   * Advance `nextCheckpointIndex` past every gate already behind the spawn.
   * Only the gate-miss probe needs it: it starts mid-lap, so leaving the race
   * pointed at CP01 would mean the gate it drives through is never tested.
   */
  alignCheckpoint: boolean;
}

export interface ProbeSpawnCourse {
  length: number;
  startProgress: number;
  startLateral: number;
}

export function resolveProbeSpawn(course: ProbeSpawnCourse): ProbeSpawn {
  const at = (
    distanceMetres: number,
    halfWidthScale: number,
    lateralMetres: number,
    speedMps: number,
    reversed = false,
    alignCheckpoint = false,
  ): ProbeSpawn => ({
    progress: distanceMetres / course.length,
    halfWidthScale,
    lateralMetres,
    speedMps,
    reversed,
    alignCheckpoint,
  });
  const atStart = (
    halfWidthScale: number,
    lateralMetres: number,
    speedMps: number,
  ): ProbeSpawn => ({
    progress: course.startProgress,
    halfWidthScale,
    lateralMetres,
    speedMps,
    reversed: false,
    alignCheckpoint: false,
  });
  // Past the deck edge, so the off-course timer arms and recovery fires.
  if (probeSelected("recovery")) return at(RECOVERY_PROBE_DISTANCE_METERS, 1, 1, 0);
  if (probeSelected("wrong-way")) {
    return at(WRONG_WAY_PROBE_DISTANCE_METERS, 0, 0, 22, true);
  }
  if (probeSelected("water")) return at(WATER_GRIP_PROBE_DISTANCE_METERS, -0.65, 0, 10);
  if (probeSelected("apron")) {
    return at(
      readProbeNumber("probeDistance", APRON_PROBE_DISTANCE_METERS),
      0,
      readProbeNumber("probeLateral", APRON_PROBE_LATERAL_METERS),
      APRON_PROBE_SPEED_METERS_PER_SECOND,
    );
  }
  if (probeSelected("gate-miss")) {
    return at(
      GATE_MISS_PROBE_DISTANCE_METERS,
      0,
      GATE_MISS_PROBE_LATERAL_METERS,
      GATE_MISS_PROBE_SPEED_METERS_PER_SECOND,
      false,
      true,
    );
  }
  // The impact probe keeps the course's own start line and only moves sideways.
  if (probeSelected("impact")) return atStart(1, -1, 22);
  return atStart(0, course.startLateral, 0);
}

/** @param halfWidth the deck half-width at {@link ProbeSpawn.progress}. */
export function probeSpawnLateral(spawn: ProbeSpawn, halfWidth: number): number {
  return spawn.halfWidthScale * halfWidth + spawn.lateralMetres;
}

/**
 * Listener-space offset for the rival-audio probe; `0` when it is not armed.
 * `&probeSide=1` mirrors it to starboard so a headless run can read the pan
 * axis in both directions.
 */
export function resolveRivalAudioProbeLateral(): number {
  return probeSelected("rival-audio")
    ? RIVAL_AUDIO_PROBE_METERS * Math.sign(readProbeNumber("probeSide", -1) || -1)
    : 0;
}

/**
 * P7 — where the URL, the operating system and the stored settings meet.
 *
 * These two used to be inline expressions in the race loop's field list. They
 * moved here because the meta layer gave each of them a third input, and the
 * composition rule is the interesting part rather than the read.
 */

/** `?quality=` is the QA override and wins; otherwise the stored lock applies. */
export function resolveQualityLock(): RenderQualityMode {
  return resolveQualityMode(searchParam("quality"), save.settings.quality);
}

/**
 * **The most restrictive input wins.** `?motion=reduce`, the stored setting and
 * the operating system's `prefers-reduced-motion` are three independent ways of
 * asking for calm, and any one of them is enough. Nothing here can turn motion
 * damping back *off* for someone whose OS asked for it — that would be the one
 * composition rule this must never get wrong.
 */
export function resolveReducedMotion(): boolean {
  return searchParam("motion") === "reduce"
    || save.settings.reducedMotion
    || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
