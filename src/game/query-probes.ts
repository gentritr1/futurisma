import type { InputFrame } from "./input";

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
