import type { RaceCourse } from "./course";
import type { PolarityCourse } from "./polarity-course";
import {
  OUTLINE_STATION_COUNT,
  RADAR_ALERT_RANGE_METERS,
  RADAR_LATERAL_RANGE_METERS,
  RADAR_LONGITUDINAL_RANGE_METERS,
  buildCourseOutline,
  buildCourseSegment,
  fitOutlineTransform,
  projectRivalToRadar,
  radarSeparationMeters,
} from "./minimap-projection.js";

/**
 * P6 minimap / radar. A DOM 2D canvas overlay, deliberately **not** a WebGL
 * render target: it costs zero draw calls, needs no second camera or render
 * pass, and inherits the CSS scanline treatment for free.
 *
 * Two elements share one canvas: the cached course outline with a player dot
 * and eight gate ticks on top, and a short-range rival radar underneath. Every
 * static path is built once (construction, or a device-pixel-ratio change);
 * the 30 Hz tick only clears, strokes three cached `Path2D`s and fills at most
 * four dots.
 */

/** CSS pixel footprint. Small on purpose — see PRODUCT.md's HUD anti-reference. */
const CANVAS_WIDTH = 120;
const CANVAS_HEIGHT = 128;

const OUTLINE_HEIGHT = 74;
const OUTLINE_PADDING = 9;

const RADAR_WIDTH = 46;
const RADAR_HEIGHT = 44;
const RADAR_LEFT = (CANVAS_WIDTH - RADAR_WIDTH) / 2;
const RADAR_TOP = 82;

const GATE_TICK_LENGTH = 3.5;
const GATE_TICK_COUNT = 8;

/**
 * sRGB mirrors of the `--acid` / `--cyan` / `--muted` / `--dim` oklch tokens in
 * `src/style.css`. Hard-coded rather than read back through `getComputedStyle`
 * because `oklch()` assignment to a canvas `fillStyle` fails silently on
 * engines that do not parse it, which would leave the previous colour in place
 * instead of raising. Keep these in step with the CSS tokens.
 */
const ACID = "192, 240, 0";
const CYAN = "77, 232, 255";
const MUTED = "147, 169, 172";
const DIM = "97, 118, 120";

/** Idle is deliberately low contrast; proximity is what earns brightness. */
const IDLE_OUTLINE_ALPHA = 0.3;
const IDLE_CONTACT_ALPHA = 0.55;
const ALERT_CONTACT_ALPHA = 0.95;

/** One live rival, read straight off the fleet with no allocation. */
export interface MinimapContact {
  raceDistanceMeters: number;
  lateralMeters: number;
}

export interface MinimapDiagnostics {
  /** False under `prefers-reduced-motion` / `?motion=reduce`: no pulse. */
  minimapAnimated: boolean;
  minimapStations: number;
  minimapContacts: number;
  minimapNearestRivalMeters: number | null;
  minimapAlert: boolean;
  minimapDrawOps: number;
  minimapShortcutPaths: number;
}

function rgba(channels: string, alpha: number): string {
  return `rgba(${channels}, ${alpha})`;
}

export class Minimap {
  /**
   * Reused contact buffer. The fleet fills it in place each tick so the radar
   * allocates nothing at 30 Hz.
   */
  readonly contacts: MinimapContact[];

  private readonly context: CanvasRenderingContext2D;
  private readonly outline: ReturnType<typeof buildCourseOutline>;
  private readonly upperOutline: ReturnType<typeof buildCourseOutline> | null;
  private readonly polarity: PolarityCourse | null;
  private readonly shortcutPoints: Float64Array[] = [];
  private shortcutPath = new Path2D();
  private readonly gateProgress: number[] = [];

  private outlinePath = new Path2D();
  private gatePath = new Path2D();
  private radarPath = new Path2D();
  private outlineTransform = { scale: 1, offsetX: 0, offsetY: 0 };
  private pixelRatio = 0;

  private contactCount = 0;
  private nearestRivalMeters: number | null = null;
  private drawOps = 0;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    course: RaceCourse,
    private readonly reducedMotion: boolean,
    fieldSize = 3,
  ) {
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) throw new Error("Minimap canvas has no 2D context.");
    this.context = context;

    this.contacts = Array.from({ length: Math.max(0, fieldSize) }, () => ({
      raceDistanceMeters: 0,
      lateralMeters: 0,
    }));

    this.polarity = course.kind === "polarity" ? course as PolarityCourse : null;
    this.outline = buildCourseOutline(course, OUTLINE_STATION_COUNT);
    this.upperOutline = null;
    if (this.polarity) {
      const polarity = this.polarity;
      const upperSampler = {
        length: course.length,
        createSampleScratch: () => course.createSampleScratch(),
        sample: (progress: number, target = course.createSampleScratch()) =>
          polarity.sampleLane(progress, 1, target),
      };
      this.upperOutline = buildCourseOutline(upperSampler, OUTLINE_STATION_COUNT);
      for (const shortcut of polarity.shortcuts) {
        this.shortcutPoints.push(buildCourseSegment(upperSampler, shortcut.from, shortcut.to));
      }
    }

    // Gate ticks come from the course's own checkpoint table so both maps mark
    // their real gates. Greenwater and Bitterpan both publish eight.
    const gateCount = Math.min(GATE_TICK_COUNT, course.checkpointCount);
    for (let index = 0; index < gateCount; index += 1) {
      this.gateProgress.push(course.checkpointProgress(index));
    }

    this.rebuild();
  }

  /**
   * Rebuilds every cached path. Called once at construction and again only if
   * the device pixel ratio changes, never per tick.
   */
  private rebuild(): void {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    this.pixelRatio = ratio;
    this.canvas.width = Math.round(CANVAS_WIDTH * ratio);
    this.canvas.height = Math.round(CANVAS_HEIGHT * ratio);
    this.canvas.style.width = `${CANVAS_WIDTH}px`;
    this.canvas.style.height = `${CANVAS_HEIGHT}px`;
    // Draw in CSS pixels from here on.
    this.context.setTransform(ratio, 0, 0, ratio, 0, 0);
    this.context.lineJoin = "round";
    this.context.lineCap = "round";

    const bounds = { ...this.outline.bounds };
    if (this.upperOutline) {
      bounds.minX = Math.min(bounds.minX, this.upperOutline.bounds.minX);
      bounds.maxX = Math.max(bounds.maxX, this.upperOutline.bounds.maxX);
      bounds.minZ = Math.min(bounds.minZ, this.upperOutline.bounds.minZ);
      bounds.maxZ = Math.max(bounds.maxZ, this.upperOutline.bounds.maxZ);
    }
    const transform = fitOutlineTransform(
      bounds,
      CANVAS_WIDTH,
      OUTLINE_HEIGHT,
      OUTLINE_PADDING,
    );

    const outlinePath = new Path2D();
    for (let index = 0; index < this.outline.stationCount; index += 1) {
      const x = this.outline.points[index * 2] * transform.scale + transform.offsetX;
      const y = this.outline.points[index * 2 + 1] * transform.scale + transform.offsetY;
      if (index === 0) outlinePath.moveTo(x, y);
      else outlinePath.lineTo(x, y);
    }
    this.outlinePath = outlinePath;

    const shortcutPath = new Path2D();
    for (const points of this.shortcutPoints) {
      for (let index = 0; index < points.length; index += 2) {
        const x = points[index] * transform.scale + transform.offsetX;
        const y = points[index + 1] * transform.scale + transform.offsetY;
        if (index === 0) shortcutPath.moveTo(x, y);
        else shortcutPath.lineTo(x, y);
      }
    }
    this.shortcutPath = shortcutPath;

    // Gate ticks: a short stroke normal to the centreline at each checkpoint.
    const gatePath = new Path2D();
    for (const progress of this.gateProgress) {
      const here = this.outlinePointAt(progress, transform);
      const ahead = this.outlinePointAt(progress + 0.004, transform);
      let dx = ahead.x - here.x;
      let dy = ahead.y - here.y;
      const magnitude = Math.hypot(dx, dy);
      if (magnitude < 1e-6) continue;
      dx /= magnitude;
      dy /= magnitude;
      // Normal of the screen-space tangent.
      gatePath.moveTo(here.x - dy * GATE_TICK_LENGTH, here.y + dx * GATE_TICK_LENGTH);
      gatePath.lineTo(here.x + dy * GATE_TICK_LENGTH, here.y - dx * GATE_TICK_LENGTH);
    }
    this.gatePath = gatePath;

    // Radar frame: the box plus a centre lane hairline the player sits on.
    const radarPath = new Path2D();
    radarPath.rect(RADAR_LEFT, RADAR_TOP, RADAR_WIDTH, RADAR_HEIGHT);
    radarPath.moveTo(RADAR_LEFT + RADAR_WIDTH / 2, RADAR_TOP + 2);
    radarPath.lineTo(RADAR_LEFT + RADAR_WIDTH / 2, RADAR_TOP + RADAR_HEIGHT - 2);
    this.radarPath = radarPath;

    this.outlineTransform = transform;
  }

  /**
   * Interpolates the cached outline ring instead of re-sampling the course, so
   * the player dot costs two array reads rather than a spline evaluation.
   */
  private outlinePointAt(
    progress: number,
    transform: { scale: number; offsetX: number; offsetY: number },
    outline = this.outline,
  ): { x: number; y: number } {
    const span = outline.stationCount - 1;
    const wrapped = progress - Math.floor(progress);
    const scaled = wrapped * span;
    const index = Math.min(Math.floor(scaled), span - 1);
    const alpha = scaled - index;
    const points = outline.points;
    const x0 = points[index * 2];
    const z0 = points[index * 2 + 1];
    const x1 = points[(index + 1) * 2];
    const z1 = points[(index + 1) * 2 + 1];
    return {
      x: (x0 + (x1 - x0) * alpha) * transform.scale + transform.offsetX,
      y: (z0 + (z1 - z0) * alpha) * transform.scale + transform.offsetY,
    };
  }

  /**
   * The 30 Hz tick. Clears, strokes three cached paths and fills the dots.
   *
   * @param playerRaceDistanceMeters cumulative race distance, matching the
   *   rivals' own `raceDistanceMeters` so a lapped car falls out of range
   *   naturally instead of wrapping onto the player's tail.
   */
  update(
    playerRaceDistanceMeters: number,
    playerLateralMeters: number,
    playerProgress: number,
    contactCount: number,
    elapsedSeconds: number,
  ): void {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    if (ratio !== this.pixelRatio) this.rebuild();

    const context = this.context;
    let ops = 0;
    this.contactCount = Math.max(0, Math.min(contactCount, this.contacts.length));

    context.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    ops += 1;

    // Nearest rival decides the whole panel's contrast, so resolve it first.
    let nearest = Infinity;
    for (let index = 0; index < this.contactCount; index += 1) {
      const contact = this.contacts[index];
      const separation = radarSeparationMeters(
        contact.raceDistanceMeters - playerRaceDistanceMeters,
        contact.lateralMeters - playerLateralMeters,
      );
      if (separation < nearest) nearest = separation;
    }
    this.nearestRivalMeters = Number.isFinite(nearest) ? nearest : null;
    const alert = nearest <= RADAR_ALERT_RANGE_METERS;

    // A slow pulse only while a rival is genuinely close, and never under
    // reduced motion — diagnostics reports this as `minimapAnimated`.
    const pulse = alert && !this.reducedMotion
      ? 0.5 + 0.5 * Math.sin(elapsedSeconds * 5.2)
      : 0;

    context.lineWidth = 1;
    context.strokeStyle = rgba(MUTED, IDLE_OUTLINE_ALPHA);
    context.stroke(this.outlinePath);
    ops += 3;

    context.strokeStyle = rgba(DIM, 0.6);
    context.stroke(this.gatePath);
    ops += 2;

    if (this.shortcutPoints.length > 0) {
      context.strokeStyle = rgba(CYAN, .55);
      context.setLineDash([2.5, 2]);
      context.stroke(this.shortcutPath);
      context.setLineDash([]);
      ops += 4;
    }

    // The upper player's dot follows its bypass instead of the lower detour.
    const playerOutline = this.polarity?.lane === 1 && this.upperOutline
      ? this.upperOutline : this.outline;
    const player = this.outlinePointAt(playerProgress, this.outlineTransform, playerOutline);
    context.fillStyle = rgba(ACID, 0.92);
    context.beginPath();
    context.arc(player.x, player.y, 2.1, 0, Math.PI * 2);
    context.fill();
    ops += 4;

    // Radar frame.
    context.strokeStyle = rgba(MUTED, alert ? 0.42 : 0.24);
    context.stroke(this.radarPath);
    ops += 2;

    // Rival dots.
    for (let index = 0; index < this.contactCount; index += 1) {
      const contact = this.contacts[index];
      const longitudinal = contact.raceDistanceMeters - playerRaceDistanceMeters;
      const lateral = contact.lateralMeters - playerLateralMeters;
      const placed = projectRivalToRadar(longitudinal, lateral);
      if (!placed) continue;
      const close = radarSeparationMeters(longitudinal, lateral)
        <= RADAR_ALERT_RANGE_METERS;
      const alpha = close
        ? ALERT_CONTACT_ALPHA - 0.18 * pulse
        : IDLE_CONTACT_ALPHA;
      context.fillStyle = rgba(close ? CYAN : MUTED, alpha);
      context.beginPath();
      context.arc(
        RADAR_LEFT + placed.x * RADAR_WIDTH,
        RADAR_TOP + placed.y * RADAR_HEIGHT,
        close ? 2.3 : 1.7,
        0,
        Math.PI * 2,
      );
      context.fill();
      ops += 4;
    }

    this.drawOps = ops;
  }

  diagnostics(): MinimapDiagnostics {
    return {
      minimapAnimated: !this.reducedMotion,
      minimapStations: this.outline.stationCount,
      minimapContacts: this.contactCount,
      minimapNearestRivalMeters: this.nearestRivalMeters === null
        ? null
        : Number(this.nearestRivalMeters.toFixed(1)),
      minimapAlert: this.nearestRivalMeters !== null
        && this.nearestRivalMeters <= RADAR_ALERT_RANGE_METERS,
      minimapDrawOps: this.drawOps,
      minimapShortcutPaths: this.shortcutPoints.length,
    };
  }
}

export {
  RADAR_LATERAL_RANGE_METERS,
  RADAR_LONGITUDINAL_RANGE_METERS,
  buildCourseOutline,
  projectRivalToRadar,
};
