/**
 * P21.3 — the local relief that keeps Bitterpan's pan floor under the ribbon.
 *
 * THE DEFECT. `GROUND_Y_METRES` is a flat -1.95 m, chosen (its own comment says
 * so) as 0.078 m below the ribbon's CENTRELINE low point of -1.872 m. The ribbon
 * banks 2.5 degrees, so its lowest DRAWN surface is not the centreline: the deck
 * edge reaches -2.4916 m and the C-edge run-off lip -2.7446 m, both at s=1100.
 * The plane meant to sit under everything is a quarter of a metre above it, and
 * the pan is drawn OVER the racing surface on 53 of 1,220 station-sides — up to
 * 12.42 m of a 14 m half-width.
 *
 * WHY THIS IS PURE AND FREE OF `three`. `bitterpan-surface.ts` applies it to the
 * rendered plane and `scripts/validate-corridor.mjs` re-evaluates it under Node
 * to assert the coverage is zero. Two consumers, one model — the same reason
 * `furniture-placement.js` is shaped this way. A validator that re-derived the
 * relief from its own copy of the arithmetic could pass a floor the game draws
 * somewhere else.
 *
 * THE ONE NUMBER THAT IS NOT MEASURED. `PAN_FLOOR_RELIEF_FULL_MARGIN_METRES` is
 * the plane's own vertex spacing, and it is a correctness requirement rather
 * than a taste choice. The grid is 6,048 m over 128 segments = 47.25 m between
 * vertices, and the drawn ribbon is only ~40 m wide, so a station usually has
 * NO vertex over its road at all. Dropping only the vertices inside the drawn
 * extent would leave the interpolated surface between them riding up over the
 * road exactly where there is no vertex to pull it down. Extending the full drop
 * one whole cell past the run-off lip guarantees that every vertex of every
 * triangle spanning the road is dropped, so the interpolated surface is too.
 */

/** The clearance the pan keeps under the lowest drawn ribbon surface. Matches
 * the margin `GROUND_Y_METRES` was originally chosen with. */
export const PAN_FLOOR_CLEARANCE_METRES = 0.078;

/** Vertex spacing of the pan floor grid: 6,048 m / 128 segments. */
export const PAN_FLOOR_RELIEF_FULL_MARGIN_METRES = 47.25;

/** How far past that the drop eases back to zero. */
export const PAN_FLOOR_RELIEF_BLEND_METRES = 60;

/**
 * @typedef {object} PanReliefNode
 * @property {number} x world X of the centreline at this station
 * @property {number} z world Z
 * @property {number} rightX unit lateral axis, X component (flattened)
 * @property {number} rightZ unit lateral axis, Z component
 * @property {number} lowestDrawnY world Y of the LOWEST drawn surface at this
 *   station — deck edges and run-off lips, both sides, whichever is lowest
 * @property {number} drawnHalfExtent half-width plus the wider run-off, metres
 */

/** @param {number} edge0 @param {number} edge1 @param {number} value */
function smoothstep(edge0, edge1, value) {
  if (edge1 <= edge0) return value >= edge1 ? 1 : 0;
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Widens each station's requirement to the deepest one within a grid cell of it.
 *
 * WHY THE RAW PER-STATION NUMBER IS NOT ENOUGH. The displaced plane is not the
 * continuous function below — it is the bilinear interpolation of a 47.25 m
 * grid. Two adjacent grid vertices can resolve to two different stations, and if
 * one of them needs no drop the blend across the triangle between them rides
 * back up over the road. Taking the running minimum of `lowestDrawnY` over a
 * cell of lap distance either side means every vertex that can participate in a
 * triangle over the road is already asking for at least the drop that road
 * needs. It only ever deepens, so it cannot reintroduce coverage.
 *
 * @param {readonly PanReliefNode[]} nodes ordered by lap distance
 * @param {number} spacingMetres distance between consecutive nodes
 * @returns {PanReliefNode[]}
 */
export function prepareReliefNodes(nodes, spacingMetres) {
  const reach = Math.max(1, Math.ceil(
    PAN_FLOOR_RELIEF_FULL_MARGIN_METRES / Math.max(1e-6, spacingMetres),
  ));
  const count = nodes.length;
  return nodes.map((node, index) => {
    let lowest = node.lowestDrawnY;
    let extent = node.drawnHalfExtent;
    for (let step = -reach; step <= reach; step += 1) {
      // The lap is a loop, so the window wraps rather than clamping - the start
      // line is not a discontinuity in the ground.
      const neighbour = nodes[((index + step) % count + count) % count];
      lowest = Math.min(lowest, neighbour.lowestDrawnY);
      extent = Math.max(extent, neighbour.drawnHalfExtent);
    }
    return { ...node, lowestDrawnY: lowest, drawnHalfExtent: extent };
  });
}

/**
 * Nearest station to a world point. Linear over ~610 nodes, run once per pan
 * vertex at build time and never again.
 * @param {readonly PanReliefNode[]} nodes
 * @param {number} x @param {number} z
 * @returns {PanReliefNode}
 */
export function nearestReliefNode(nodes, x, z) {
  let best = nodes[0];
  let bestSquared = Infinity;
  for (const node of nodes) {
    const dx = x - node.x;
    const dz = z - node.z;
    const squared = dx * dx + dz * dz;
    if (squared < bestSquared) {
      bestSquared = squared;
      best = node;
    }
  }
  return best;
}

/**
 * How far DOWN the pan floor moves at one world point, metres, never negative.
 *
 * Zero wherever the ribbon already rides above the plane, which is most of the
 * lap: this only carves where the road would otherwise be swallowed.
 * @param {readonly PanReliefNode[]} nodes
 * @param {number} x @param {number} z
 * @param {number} groundY the undisplaced plane height, world Y
 * @returns {number}
 */
export function panFloorDropAt(nodes, x, z, groundY) {
  const node = nearestReliefNode(nodes, x, z);
  const required = node.lowestDrawnY - PAN_FLOOR_CLEARANCE_METRES;
  const drop = groundY - required;
  if (drop <= 0) return 0;
  const lateral = Math.abs((x - node.x) * node.rightX + (z - node.z) * node.rightZ);
  const full = node.drawnHalfExtent + PAN_FLOOR_RELIEF_FULL_MARGIN_METRES;
  const fade = full + PAN_FLOOR_RELIEF_BLEND_METRES;
  return drop * (1 - smoothstep(full, fade, lateral));
}

/**
 * The height of the displaced pan surface at one world point, world Y.
 * @param {readonly PanReliefNode[]} nodes
 * @param {number} x @param {number} z @param {number} groundY
 */
export function panFloorHeightAt(nodes, x, z, groundY) {
  return groundY - panFloorDropAt(nodes, x, z, groundY);
}
