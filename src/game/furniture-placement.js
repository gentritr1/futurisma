/**
 * P13 — road-furniture clearance.
 *
 * One rule, resolved in one place: **nothing with height above the deck may
 * stand inside the deck.** Before this module the rule was three separate
 * per-case decisions in `course.ts`, and P11's hangar clamp broke it — edge
 * furniture authored against the open-air clearances was pulled back to
 * `halfWidth - 0.35` so it would fit inside the shell, but it kept its
 * open-air *heights*. A braking board with its lower edge at 1.41 m and a
 * 0.62 m approach arrow, standing 0.35 m inside the deck edge, is an obstacle
 * drawn on the road. The player report is exactly that: a "100M" board and a
 * tan arrow at deck level on the LINK_APRON approach, and a cluster of low
 * chevrons in Hangar Six.
 *
 * The resolution keys off the **authored apron width**, never off a sector
 * name in code:
 *
 * - `apronWidth === 0` is a barrier/wall span (the hangar interior and
 *   LINK_APRON, where `greenwater-blockout.json` authors HANGAR_INTERIOR with
 *   `widthMetres: 0` because the wall is the boundary). There is no verge to
 *   stand a sign on, so furniture becomes a **wall plaque**: pinned just inside
 *   the wall line and raised until its lower edge clears the plaque band. Its
 *   ground furniture — the post that would hold it up, the low approach arrow
 *   painted on the deck in front of it — is dropped, because both would stand
 *   on the road to serve a sign that no longer does.
 *
 * - `apronWidth > 0` is an open span. The run-off is drivable, so "off the
 *   deck" is not enough: furniture stands clear of the run-off's outer lip as
 *   well, and low approach arrows are allowed because they are off-deck.
 *
 * Everything here is pure and free of `three`, so `validate-furniture.mjs`
 * runs the *same* resolution the runtime does rather than a re-derivation of
 * it. That is the point: the validator cannot pass a placement the game then
 * draws somewhere else.
 */

/**
 * Hard floor. No board, post or arrow may come nearer than this to the deck
 * edge while it is below `PLAQUE_BAND_BOTTOM_METRES`. Matches the
 * `MINIMUM_DECK_CLEARANCE_METRES` that P12's art-pass validator already holds
 * the trackside signage to — one number for one rule, on both layers.
 */
export const DECK_CLEARANCE_METRES = 0.5;

/**
 * Above this height a thing is read as overhead structure rather than as an
 * obstacle on the road, so it may stand over the deck.
 *
 * P13 set this to 3.2 m, which clears the craft's hover band and its canopy.
 * H1 raises it to 4.6 m, because clearing the CRAFT turned out not to be the
 * binding constraint: the chase camera rides a measured 4.09-4.20 m above the
 * deck (`cameraSurfaceClearanceMeters` over a full Greenwater lap), so a plaque
 * whose lower edge sat at 3.2 m was drawn across the player's eye line and read
 * as an obstacle standing in the road rather than as overhead signage. 4.6 m is
 * 0.4 m above the highest camera height measured over that lap and 0.5 m above
 * its typical 4.1 m.
 */
export const PLAQUE_BAND_BOTTOM_METRES = 4.6;

/**
 * How far inside the wall line a plaque is pinned in a barrier span. The
 * hangar shell stands at `halfWidth + 0.9` and the interior's own lateral clamp
 * is `halfWidth - 2.05`, so a plaque here is 1.7 m clear of anything drivable
 * and reads as bolted to the frame.
 */
export const WALL_PLAQUE_INSET_METRES = 0.35;

/**
 * In an open span, furniture clears the *drivable* surface — deck plus authored
 * run-off — by this much. The run-off is a cost, not a stop: a player who
 * slides wide drives across it, so a board standing in it is an object they
 * pass through.
 */
export const RUN_OFF_CLEARANCE_METRES = 1;

/**
 * Flat furniture — route lights, guide lights, warning strips, grid markings —
 * is painted road, not an obstacle, and is exempt from the lateral rule while
 * its top edge stays under this height.
 */
export const FLAT_FURNITURE_MAX_HEIGHT_METRES = 0.3;

/** Authored open-air stand-off for braking boards, before the rules apply. */
export const EDGE_FURNITURE_CLEARANCE_METRES = 4.5;
/** Authored open-air stand-off for turn chevrons — they repeat around bends. */
export const TURN_CHEVRON_CLEARANCE_METRES = 9;
/** Slack on the authored stand-offs so a board never grazes the deck edge. */
export const EDGE_FURNITURE_SAFETY_MARGIN_METRES = 0.25;
/** Minimum stand-off for a checkpoint gate post, measured from the deck edge. */
export const GATE_POST_CLEARANCE_METRES = 0.7;

/**
 * A gate mast is not edge furniture — it IS the gate, and a circuit stands its
 * gate posts at the track edge, not a car's width back from it. So masts answer
 * to a smaller floor than boards do.
 *
 * The number is measured, not chosen: the mast centre stands at
 * `GATE_POST_CLEARANCE_METRES` beyond the deck and the mast section is 0.55 m,
 * so its inner face clears by 0.7 - 0.275 = 0.425 m. That is the tightest of the
 * 21 gate items across both maps (Greenwater CP01-CP08 and the Cradle,
 * Bitterpan CP00-CP11; the loosest is the Cradle at 4.4 m). 0.4 m sits just
 * under the measured minimum: tight enough that a mast drifting onto the deck
 * fails, loose enough that the authored gates pass unchanged.
 */
export const GATE_POST_DECK_CLEARANCE_METRES = 0.4;

/**
 * The resolver places furniture EXACTLY on its own limits — `lateral` is
 * `halfWidth + apronWidth + clearance + footprintHalfWidth`, and the predicate
 * then subtracts `footprintHalfWidth` back off. In binary floating point
 * `(a + b + c + d) - d` is not `a + b + c`, so a placement can miss the rule it
 * was built to satisfy by one unit in the last place. This tolerance is a
 * micrometre — roughly six orders of magnitude below the half-metre clearances
 * being tested, and ten above the ~1e-15 m error it exists to absorb. It can
 * only ever swallow that arithmetic, never a real intrusion.
 */
export const PLACEMENT_EPSILON_METRES = 1e-6;

/**
 * @typedef {object} FurnitureRequest
 * @property {number} halfWidth deck half-width at this distance
 * @property {number} apronWidth authored run-off on the furniture's own side
 * @property {-1 | 1} side
 * @property {number} clearance authored open-air stand-off beyond `halfWidth`
 * @property {number} footprintHalfWidth widest half-extent in the group
 * @property {number} centreHeight authored centre height of the tallest face
 * @property {number} extentHeight that face's vertical extent
 *
 * @typedef {object} FurniturePlacement
 * @property {number} lateral signed lateral for every face in the group
 * @property {number} centreHeight resolved centre height of the face
 * @property {"wall" | "verge"} mode
 * @property {boolean} groundMounted false in a barrier span, where the post and
 *   the low approach arrow are dropped rather than left standing on the deck
 */

/**
 * Resolves one group of edge furniture — a board and everything that shares its
 * lateral — against the corridor it stands in.
 * @param {FurnitureRequest} request
 * @returns {FurniturePlacement}
 */
export function resolveFurniturePlacement(request) {
  const halfWidth = Math.max(0, request.halfWidth);
  const apronWidth = Math.max(0, request.apronWidth);
  const side = request.side < 0 ? -1 : 1;
  const footprintHalfWidth = Math.max(0, request.footprintHalfWidth);
  const extentHeight = Math.max(0, request.extentHeight);

  if (apronWidth <= 0) {
    // Barrier span. There is no verge, so the sign goes on the wall and its
    // ground furniture goes away.
    // The centre height that puts the face's LOWER edge on the band floor.
    const centreOnBandFloor = PLAQUE_BAND_BOTTOM_METRES + extentHeight / 2;
    return {
      lateral: side * Math.max(0, halfWidth - WALL_PLAQUE_INSET_METRES),
      centreHeight: Math.max(request.centreHeight, centreOnBandFloor),
      mode: "wall",
      groundMounted: false,
    };
  }

  // Open span. The authored stand-off is a *preference*; the corridor sets the
  // floor, and the wider of the two wins.
  const authored = halfWidth
    + Math.max(0, request.clearance)
    + EDGE_FURNITURE_SAFETY_MARGIN_METRES
    + footprintHalfWidth;
  const corridorFloor = halfWidth
    + apronWidth
    + RUN_OFF_CLEARANCE_METRES
    + footprintHalfWidth;
  return {
    lateral: side * Math.max(authored, corridorFloor),
    centreHeight: request.centreHeight,
    mode: "verge",
    groundMounted: true,
  };
}

/**
 * Checkpoint gate posts are not edge furniture: they mark the gate, so their
 * lateral is authored against the gate being scored, and pushing them out to
 * the run-off lip would draw a gate half again as wide as the one the player is
 * aiming at. They are held to the deck rule alone — the authored lateral
 * stands unless the deck has grown out past it, in which case the deck edge
 * plus `GATE_POST_CLEARANCE_METRES` wins.
 *
 * Both maps author their own lateral (Greenwater `gateWidth / 2 + 0.7`,
 * Bitterpan the checkpoint's own `half_width_m`) and both pass it here, so the
 * floor binds without either map's authored gate being restyled.
 * @param {number} halfWidth
 * @param {number} authoredLateral unsigned distance from the centreline
 * @param {-1 | 1} side
 * @returns {number} signed lateral
 */
export function resolveGatePostLateral(halfWidth, authoredLateral, side) {
  const outward = Math.max(
    Math.max(0, authoredLateral),
    Math.max(0, halfWidth) + GATE_POST_CLEARANCE_METRES,
  );
  return (side < 0 ? -1 : 1) * outward;
}

/**
 * The rule itself, as a predicate, so the validator and any future caller ask
 * the same question. True when nothing in this footprint stands over the deck
 * below the plaque band.
 * @param {object} item
 * @param {number} item.halfWidth
 * @param {number} item.lateral signed
 * @param {number} item.footprintHalfWidth
 * @param {number} item.bottomHeight lower edge above the deck
 * @param {number} item.topHeight upper edge above the deck
 * @param {number} [clearance] how far past the deck edge this class must stand.
 *   Defaults to the furniture floor; gate masts pass
 *   `GATE_POST_DECK_CLEARANCE_METRES` instead.
 * @returns {boolean}
 */
export function clearsDeck(item, clearance = DECK_CLEARANCE_METRES) {
  // Painted road: flat enough that nothing can be driven into.
  if (item.topHeight <= FLAT_FURNITURE_MAX_HEIGHT_METRES + PLACEMENT_EPSILON_METRES) {
    return true;
  }
  // Overhead structure: high enough that nothing can be driven into.
  if (item.bottomHeight >= PLAQUE_BAND_BOTTOM_METRES - PLACEMENT_EPSILON_METRES) {
    return true;
  }
  const inner = Math.abs(item.lateral) - Math.max(0, item.footprintHalfWidth);
  return inner >= item.halfWidth + clearance - PLACEMENT_EPSILON_METRES;
}

/**
 * True when this footprint also clears the drivable run-off — the standard an
 * open span holds edge furniture to.
 * @param {object} item
 * @param {number} item.halfWidth
 * @param {number} item.apronWidth
 * @param {number} item.lateral signed
 * @param {number} item.footprintHalfWidth
 * @param {number} item.bottomHeight
 * @param {number} item.topHeight
 * @returns {boolean}
 */
export function clearsRunOff(item) {
  if (item.topHeight <= FLAT_FURNITURE_MAX_HEIGHT_METRES + PLACEMENT_EPSILON_METRES) {
    return true;
  }
  if (item.bottomHeight >= PLAQUE_BAND_BOTTOM_METRES - PLACEMENT_EPSILON_METRES) {
    return true;
  }
  const inner = Math.abs(item.lateral) - Math.max(0, item.footprintHalfWidth);
  return inner
    >= item.halfWidth + item.apronWidth + RUN_OFF_CLEARANCE_METRES
      - PLACEMENT_EPSILON_METRES;
}
