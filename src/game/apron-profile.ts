/**
 * The run-off cross-section, on its own so that reading it costs nothing.
 *
 * This lived in `course.ts` until P16 needed it on the presentation path.
 * `game.ts` had only TYPE imports from `course.ts` — all erased at build — so
 * the whole course builder, both map implementations and their dependencies
 * stayed out of the initial bundle and loaded lazily. Importing one function
 * from it for the apron lift pulled all of that in and took the initial
 * JavaScript from 829.2 KiB to 1,037.7 KiB against a 950 KiB budget.
 *
 * A leaf module fixes that without duplicating the table, which matters more
 * than the bytes: `createApronDecks` draws these surfaces, the P12 decals lie on
 * them, and now the presentation lift reads them. Three consumers, one table.
 * `course.ts` re-exports both so every existing import keeps working.
 */

export type EdgeType = "A" | "B" | "C";

/**
 * The drawn cross-section of each run-off surface, in metres, relative to the
 * deck edge at `halfWidth`. `outerRise` is the height at the OUTER lip and
 * interpolates linearly across the apron's authored width; `innerDrop` is the
 * step down at the deck edge itself.
 *
 * P11 notes preserved: A's outward fall was 0.35 m, which read as a cliff edge
 * at a 0.89-1.31 m hover height; 0.12 m keeps the gravel-vs-rumble cue without
 * the craft appearing to drive off a ledge. C is flush because what follows its
 * run-off is the drop to the water, not a step.
 */
export const APRON_EDGE_CROSS_SECTION: Readonly<
  Record<EdgeType, { readonly outerRise: number; readonly innerDrop: number }>
> = Object.freeze({
  A: Object.freeze({ outerRise: -0.12, innerDrop: 0.04 }),
  B: Object.freeze({ outerRise: 0.14, innerDrop: 0.02 }),
  C: Object.freeze({ outerRise: 0, innerDrop: 0.03 }),
});

/** The fields of a course sample this profile needs. Structural, so a full
 * `CourseSample` satisfies it without `course.ts` being imported here. */
export interface ApronProfileSample {
  readonly halfWidth: number;
  readonly apronLeft: number;
  readonly apronRight: number;
  readonly edgeLeft: EdgeType;
  readonly edgeRight: EdgeType;
}

/**
 * Height of the drawn surface at `lateral`, relative to `sample.position`, along
 * `sample.up`. Inside the deck this is 0; past `halfWidth` it follows the apron
 * cross-section above, clamped at the apron's outer lip.
 */
export function surfaceHeightAtLateral(
  sample: ApronProfileSample,
  lateral: number,
): number {
  const side = lateral < 0 ? -1 : 1;
  const beyond = Math.abs(lateral) - sample.halfWidth;
  if (beyond <= 0) return 0;
  const apronWidth = side < 0 ? sample.apronLeft : sample.apronRight;
  if (apronWidth <= 0) return 0;
  const edge = side < 0 ? sample.edgeLeft : sample.edgeRight;
  const { outerRise } = APRON_EDGE_CROSS_SECTION[edge];
  return outerRise * Math.min(beyond, apronWidth) / apronWidth;
}
