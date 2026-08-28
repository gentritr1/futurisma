import type { InputFrame } from "./input";
import { save } from "./persistence";
import { resolveQualityMode } from "./render-quality";
import type { RenderQualityMode } from "./render-quality";

export const RECOVERY_PROBE_DISTANCE_METERS = 900;
export const WRONG_WAY_PROBE_DISTANCE_METERS = 100;
export const WATER_GRIP_PROBE_DISTANCE_METERS = 580;
// FUEL_ROW, A/A edges: the widest authored apron, and the sector the verified
// edge map shows as the biggest offender for the old invisible wall.
export const APRON_PROBE_DISTANCE_METERS = 1700;
export const APRON_PROBE_LATERAL_METERS = 13.5;
export const APRON_PROBE_SPEED_METERS_PER_SECOND = 60;
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
