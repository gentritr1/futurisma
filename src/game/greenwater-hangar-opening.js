// The accepted GLB merges three adjoining bay walls into one connected
// component. Bay 1 crosses the road, but none of its corners lies on it.
// Open just that panel; keep the roof, ribs, other bays and shared atlas.
const FIRST_TRIANGLE = 296;
const TRIANGLE_COUNT = 12;
const SOURCE_MIN = [-413.294098, 0.5, -261.451263];
const SOURCE_MAX = [-391.131805, 26.5, -239.490601];

// Existing GW_MOD_structure_hangar_mouth_lintel: placement y .5,
// local centre 25.4, half-height 1.6. Reuse its measured underside.
export const HANGAR_OPENING_Y = 24.3;

/** @param {import('three').BufferGeometry} geometry */
export function openHangarRoadBay(geometry) {
  const position = geometry.getAttribute('position');
  const uv = geometry.getAttribute('uv');
  const normal = geometry.getAttribute('normal');
  const index = geometry.index;
  if (!index || !position || !uv || !normal) throw Error('Hangar opening geometry contract is incomplete.');
  const vertices = new Set();
  for (let i = FIRST_TRIANGLE * 3; i < (FIRST_TRIANGLE + TRIANGLE_COUNT) * 3; i++) vertices.add(index.getX(i));
  const ids = [...vertices];
  const minimum = [0, 1, 2].map(axis => Math.min(...ids.map(i => position.getComponent(i, axis))));
  const maximum = [0, 1, 2].map(axis => Math.max(...ids.map(i => position.getComponent(i, axis))));
  if (ids.length !== 24 || minimum.some((v, axis) => Math.abs(v - SOURCE_MIN[axis]) > .001)
    || maximum.some((v, axis) => Math.abs(v - SOURCE_MAX[axis]) > .001)) {
    throw Error('Hangar road bay changed; remeasure the opening before adapting the new asset.');
  }
  let moved = 0;
  for (const i of ids) {
    if (position.getY(i) !== SOURCE_MIN[1]) continue;
    // Crop the vertical atlas faces at the new bottom instead of stretching
    // a full-height wall texture into the retained lintel. Horizontal faces
    // keep their existing cell mapping.
    const top = ids.find(j => position.getY(j) === SOURCE_MAX[1]
      && position.getX(i) === position.getX(j) && position.getZ(i) === position.getZ(j)
      && [0, 1, 2].every(axis => normal.getComponent(i, axis) === normal.getComponent(j, axis)));
    if (top !== undefined) {
      const fraction = (HANGAR_OPENING_Y - SOURCE_MIN[1]) / (SOURCE_MAX[1] - SOURCE_MIN[1]);
      uv.setXY(i, uv.getX(i) + (uv.getX(top) - uv.getX(i)) * fraction,
        uv.getY(i) + (uv.getY(top) - uv.getY(i)) * fraction);
    }
    position.setY(i, HANGAR_OPENING_Y);
    moved++;
  }
  position.needsUpdate = true;
  uv.needsUpdate = true;
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return {movedVertices:moved, openingY:HANGAR_OPENING_Y};
}
