/** @typedef {import('./polarity-simulation.js').PowerCourseConfig} PowerCourseConfig */

export const TIDELINE_FIELDS = [
  { id: "reactor-grid", progress: .31, lateral: 0, halfWidth: 3.8 },
  { id: "drydock-grid", progress: .53, lateral: -3, halfWidth: 3 },
  { id: "reentry-grid", progress: .905, lateral: 4, halfWidth: 2.5 },
];

/** Same tick/command/snapshot contract as Polarity, with gravity disabled. @type {PowerCourseConfig} */
export const TIDELINE_ABILITY_CONFIG = {
  id: "tideline-tide-v2", allowGravity: false,
  pickups: [
    { id: "reactor-device", progress: .03, lane: 0, lateral: 0, kind: "surge", alternateKind: "shield", charge: 1 },
    { id: "aqueduct-device", progress: .285, lane: 0, lateral: -2, kind: "shield", charge: 1 },
    { id: "lock-device", progress: .335, lane: 0, lateral: 0, kind: "surge", alternateKind: "shield", charge: 1 },
    { id: "quay-turbine", progress: .42, lane: 0, lateral: 0, kind: "surge", charge: 1 },
    { id: "platform-device", progress: .67, lane: 0, lateral: 2, kind: "shield", alternateKind: "surge", charge: 1 },
    { id: "intake-turbine", progress: .72, lane: 0, lateral: 0, kind: "surge", charge: 1 },
    { id: "return-projector", progress: .88, lane: 0, lateral: 0, kind: "shield", charge: 1 },
  ],
  launchZones: [
    { id: "reactor-feed", from: .036, to: .052, lane: 0 },
    { id: "pressure-lock", from: .32, to: .34, lane: 0 },
    { id: "quay", from: .449, to: .471, lane: 0 },
    { id: "intake", from: .736, to: .754, lane: 0 },
  ],
  fieldIds: TIDELINE_FIELDS.map(field => field.id),
};

/** A shared tide phase stays fixed for the whole lap. @param {number} seed @param {number} lap */
export function currentLane(seed, lap) { return ((seed + lap) & 1) === 0 ? -4 : 4; }
/** @param {number} progress */
export function inCurrent(progress) { return progress >= .025 && progress < .205 || progress >= .94 && progress < .995; }
/** @param {number} progress @param {number} lateral @param {number} length */
export function tidelineFieldAt(progress, lateral, length) {
  return TIDELINE_FIELDS.find(field => {
    const distance = Math.abs(((progress - field.progress + 1.5) % 1) - .5) * length;
    return distance < 2.5 && Math.abs(lateral - field.lateral) < field.halfWidth;
  });
}
