/**
 * Authored apron resolution (P1 — boundary removal).
 *
 * The lateral boundary used to be one hardcoded rule: `halfWidth - 2.05` for
 * every closed edge and `halfWidth + 5.8` for every open one. Leaving the
 * racing line was a *stop*. The apron table in `greenwater-blockout.json` turns
 * it into a *cost*: each edge type authors how much run-off exists beyond the
 * deck, how much grip that run-off has, and what stands at the end of it.
 *
 * Everything here is pure. The runtime passes a scratch target so the hot path
 * allocates nothing; validators call the same functions without a target and
 * get a fresh object, which is why `scripts/validate-apron.mjs` can assert the
 * table resolves identically over ten thousand samples.
 *
 * @typedef {"A" | "B" | "C"} ApronEdgeType
 *
 * @typedef {object} ApronEdgeProfile
 * @property {string} label
 * @property {number} widthMetres run-off measured outward from `halfWidth`
 * @property {number} grip surface grip multiplier once past the deck margin
 * @property {boolean} wall whether the outer boundary reports an impact
 * @property {number} wallSpeedMultiplier speed kept on the first wall contact
 * @property {number} wallImpactStrength impact/haptics/audio intensity
 * @property {number} wallScrubMetresPerSecondSquared drag while held outside
 * @property {string} surface visual treatment key
 *
 * @typedef {ApronEdgeProfile & {
 *   id?: string,
 *   note?: string,
 *   edges?: string[],
 *   sectors?: string[],
 *   fromDistance?: number,
 *   toDistance?: number,
 * }} ApronOverride
 *
 * @typedef {object} ApronTable
 * @property {number} deckMarginMetres
 * @property {number} gripFloor
 * @property {Record<string, ApronEdgeProfile>} edges
 * @property {ApronOverride[]} overrides
 *
 * @typedef {object} ApronResolution
 * @property {number} width authored run-off width beyond `halfWidth`
 * @property {number} grip effective grip at this lateral (1 on the deck)
 * @property {boolean} wall
 * @property {boolean} onApron
 * @property {number} roadLimit `halfWidth - deckMargin`
 * @property {number} lateralLimit clamp boundary for this edge
 * @property {number} depth metres past `roadLimit`, 0 while on the deck
 * @property {number} wallSpeedMultiplier
 * @property {number} wallImpactStrength
 * @property {number} wallScrubMetresPerSecondSquared
 * @property {string} surface
 *
 * @typedef {object} ApronTelemetry
 * @property {boolean} onApron
 * @property {number} seconds
 * @property {number} entries
 * @property {number} maxDepthMetres
 * @property {number} minimumGrip
 */

/** @param {number} value @param {number} minimum @param {number} maximum */
function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

/**
 * Picks the authored profile for one edge occurrence. Overrides win, and they
 * are matched on authored identity (edge type + sector), never on a magic
 * distance in code — `validate-apron.mjs` cross-checks that each override's
 * sector list covers exactly its authored distance range.
 * @param {ApronTable} table
 * @param {ApronEdgeType | string} edge
 * @param {string} sector
 * @returns {ApronEdgeProfile}
 */
export function resolveApronProfile(table, edge, sector) {
  for (const override of table.overrides ?? []) {
    const edges = override.edges ?? [];
    const sectors = override.sectors ?? [];
    if (edges.length > 0 && !edges.includes(edge)) continue;
    if (sectors.length > 0 && !sectors.includes(sector)) continue;
    return override;
  }
  const profile = table.edges[edge];
  if (!profile) throw new Error(`Unauthored apron edge type: ${String(edge)}.`);
  return profile;
}

/**
 * Resolves the boundary a vehicle is currently subject to.
 *
 * `lateralLimit` keeps the legacy deck-margin clamp whenever no apron is
 * authored (the hangar interior), so removing the boundary somewhere never
 * silently widens it everywhere.
 * @param {ApronTable} table
 * @param {ApronEdgeType | string} edge
 * @param {string} sector
 * @param {number} halfWidthMetres
 * @param {number} lateralMetres
 * @param {ApronResolution} [target]
 * @param {number|null} [derivedLimitMetres] P16 — the measured drivable limit
 * for this span and side, from `DRIVABLE_LIMITS.json`, or null where nothing
 * tall stands within reach. It can only ever pull the clamp IN, and never below
 * `roadLimit`, because the table is generated with the deck as a hard floor.
 * @returns {ApronResolution}
 */
export function resolveApron(
  table,
  edge,
  sector,
  halfWidthMetres,
  lateralMetres,
  target = createApronResolution(),
  derivedLimitMetres = null,
) {
  const profile = resolveApronProfile(table, edge, sector);
  const halfWidth = Number.isFinite(halfWidthMetres)
    ? Math.max(0, halfWidthMetres)
    : 0;
  const lateral = Number.isFinite(lateralMetres) ? Math.abs(lateralMetres) : 0;
  const margin = Math.max(0, table.deckMarginMetres);
  const width = Math.max(0, profile.widthMetres);
  const roadLimit = Math.max(0, halfWidth - margin);
  const onApron = width > 0 && lateral > roadLimit;

  target.width = width;
  target.grip = onApron
    ? clamp(profile.grip, table.gripFloor, 1)
    : 1;
  target.wall = profile.wall === true;
  target.onApron = onApron;
  target.roadLimit = roadLimit;
  const authoredLimit = width > 0 ? halfWidth + width : roadLimit;
  // P16 — the art is the authority on how far the run-off really goes. The
  // authored width said 5 m of shoulder at Cradle Bend while the wall stood
  // 0.24 m off the deck; the craft could be driven through it into void. Never
  // widens, and never crosses the deck edge.
  target.lateralLimit = Number.isFinite(derivedLimitMetres)
    && derivedLimitMetres !== null
    ? Math.max(roadLimit, Math.min(authoredLimit, derivedLimitMetres))
    : authoredLimit;
  target.depth = onApron ? lateral - roadLimit : 0;
  target.wallSpeedMultiplier = clamp(profile.wallSpeedMultiplier, 0, 1);
  target.wallImpactStrength = clamp(profile.wallImpactStrength, 0, 1);
  target.wallScrubMetresPerSecondSquared = Math.max(
    0,
    profile.wallScrubMetresPerSecondSquared,
  );
  target.surface = profile.surface;
  return target;
}

/** @returns {ApronResolution} */
export function createApronResolution() {
  return {
    width: 0,
    grip: 1,
    wall: true,
    onApron: false,
    roadLimit: 0,
    lateralLimit: 0,
    depth: 0,
    wallSpeedMultiplier: 1,
    wallImpactStrength: 0,
    wallScrubMetresPerSecondSquared: 0,
    surface: "none",
  };
}

/** @returns {ApronTelemetry} */
export function createApronTelemetry() {
  return {
    onApron: false,
    seconds: 0,
    entries: 0,
    maxDepthMetres: 0,
    minimumGrip: 1,
  };
}

/**
 * Pure `(state, delta) -> state`. It returns the *same* state object while the
 * vehicle is on the deck and was already on the deck, so the clean racing line
 * costs one comparison per physics step and allocates nothing.
 * @param {ApronTelemetry} state
 * @param {ApronResolution} apron
 * @param {number} deltaSeconds
 * @returns {ApronTelemetry}
 */
export function accumulateApronTelemetry(state, apron, deltaSeconds) {
  if (!apron.onApron && !state.onApron) return state;
  const delta = Number.isFinite(deltaSeconds) ? Math.max(0, deltaSeconds) : 0;
  return {
    onApron: apron.onApron,
    seconds: state.seconds + (apron.onApron ? delta : 0),
    entries: state.entries + (apron.onApron && !state.onApron ? 1 : 0),
    maxDepthMetres: Math.max(state.maxDepthMetres, apron.depth),
    minimumGrip: Math.min(state.minimumGrip, apron.grip),
  };
}
