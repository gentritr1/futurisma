/**
 * P16 task 6 — the measured per-span drivable limit, read at runtime.
 *
 * `resolveApron` sets `lateralLimit = halfWidth + width` for every edge and
 * `game.ts` clamps the craft's lateral to it unconditionally; `apron.wall` only
 * gates the impact FX. Where the art puts a wall closer than that, the craft
 * could be driven straight through its own visible boundary — 5.24 m past it at
 * Cradle Bend, into black void. This table is the world's answer to "how far
 * out does the run-off actually go", measured from the rendered scene by
 * `scripts/derive-drivable-limits.mjs` and committed as data so the runtime
 * never re-derives it.
 *
 * The deck is a floor the table can never cross: every entry is already
 * `>= halfWidth` by construction of the rule, so consuming it can only ever
 * trim run-off and can never narrow the racing surface.
 */

export interface DrivableLimitSide {
  readonly limit: number;
  readonly setBy: string | null;
  readonly tall: number;
}

export interface DrivableLimitEntry {
  readonly distance: number;
  readonly halfWidth: number;
  readonly clamp: number;
  readonly left?: DrivableLimitSide;
  readonly right?: DrivableLimitSide;
}

export interface DrivableLimitTable {
  readonly map: string;
  readonly spanMetres: number;
  readonly hullMarginMetres: number;
  readonly entries: readonly DrivableLimitEntry[];
}

/**
 * A distance-indexed view of one map's table.
 *
 * Built once per course. The lookup is a plain array index rather than a search
 * because it runs twice per fixed step, at 120 Hz, for the whole race.
 */
export class DrivableLimits {
  private readonly bySpan: (DrivableLimitEntry | undefined)[];

  private readonly spanMetres: number;

  constructor(table: DrivableLimitTable, lapLength: number) {
    this.spanMetres = table.spanMetres > 0 ? table.spanMetres : 10;
    const spans = Math.ceil(lapLength / this.spanMetres) + 1;
    this.bySpan = new Array<DrivableLimitEntry | undefined>(spans);
    for (const entry of table.entries) {
      const index = Math.floor(entry.distance / this.spanMetres);
      if (index >= 0 && index < spans) this.bySpan[index] = entry;
    }
  }

  /**
   * The measured limit for this distance and side, or null where nothing tall
   * stands within reach and the authored run-off is unchanged.
   *
   * `lateral` decides the side only: each side is limited by its own geometry,
   * so a wall on the left never narrows the right.
   */
  limitAt(distanceMetres: number, lateral: number): number | null {
    if (!Number.isFinite(distanceMetres)) return null;
    const index = Math.floor(distanceMetres / this.spanMetres);
    const entry = this.bySpan[index];
    if (!entry) return null;
    const side = lateral < 0 ? entry.left : entry.right;
    return side ? side.limit : null;
  }
}
