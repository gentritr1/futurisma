import type { RaceCourse } from "./course";
import type { Minimap, MinimapContact } from "./minimap";
import type { PolarityCourse } from "./polarity-course";
import { fitOutlineTransform, type CourseOutline } from "./minimap-projection.js";
import { aplusGates, aplusGateState, AplusRivalFocus } from "./minimap-aplus-rules.js";
import { playerRaceDistanceOffsetMeters } from "./rival-race.js";
import { fieldLiveries, liveryFor } from "./liveries.js";
import { save } from "./persistence";

// Match the garage's external stylesheet loading: the game's CSP deliberately
// rejects Vite's injected inline <style> elements.
const stylesheet = document.createElement("link");
stylesheet.rel = "stylesheet";
stylesheet.href = new URL("./minimap-aplus.css", import.meta.url).href;
document.head.append(stylesheet);
import.meta.hot?.dispose(() => stylesheet.remove());

interface AplusOptions {
  canvas: HTMLCanvasElement;
  course: RaceCourse;
  reducedMotion: boolean;
  outline: CourseOutline;
  upperOutline: CourseOutline | null;
  shortcutPoints: Float64Array[];
}

const INK = "#edf4ef";
const CASING = "#071014";
const ACID = "#c0f000";
const CYAN = "#4de8ff";
const AMBER = "#ffb47c";
// District accents are secondary to the number and name. The darker authored
// night hues are lifted for legible dark lettering on a small gate plate.
const SECTOR_ACCENTS: Record<string, string> = {
  "MOTEL MILE": "#f19bb0", "CLOSED ARCADE": "#80d8da",
  "NORTH TENEMENTS": "#e1b880", "THE UNDERPASS": "#91bfdd",
  "SERVICE QUAY": "#e4b17c", "LAST EXIT": "#da9ab6",
  "HANGAR SIX": "#e6bb80", "GREENWATER SWEEP": "#bcdd96",
  "CANOPY PASSAGE": "#a8d7b1", "FUEL ROW": "#e6bb80",
};

type Point = { x: number; y: number; angle: number };

/** The approved default renderer, using the race's existing minimap seam. */
export function installAplusMinimap(minimap: Minimap, options: AplusOptions): void {
  const renderer = new AplusMinimap(options, minimap.contacts);
  minimap.update = renderer.update.bind(renderer);
  minimap.diagnostics = renderer.diagnostics.bind(renderer);
}

class AplusMinimap {
  private readonly context: CanvasRenderingContext2D;
  private readonly gates: number[];
  private readonly focus = new AplusRivalFocus();
  private readonly checkpoint = document.getElementById("checkpoint-value")!;
  private readonly gateStrip = document.querySelector<HTMLElement>(".hud-gate")!;
  private readonly plate = document.createElement("span");
  private readonly plateNumber = document.createElement("b");
  private readonly plateName = document.createElement("span");
  private readonly observer: ResizeObserver;
  private readonly playerOffset: number;
  private readonly gaps: number[] = [];
  private readonly separations: number[] = [];
  private readonly player: Point = { x: 0, y: 0, angle: 0 };
  private readonly point: Point = { x: 0, y: 0, angle: 0 };
  private transform = { scale: 1, offsetX: 0, offsetY: 0 };
  private outlinePath = new Path2D();
  private shortcutPath = new Path2D();
  private width = 180;
  private height = 210;
  private pixelRatio = 1;
  private count = 0;
  private nearest: number | null = null;
  private lastPhase = "";
  private lastClear = "";
  private lastRaceDistance = Number.NaN;
  private plateTimer = 0;
  private livery = "";
  private rivalNumbers: string[] = [];
  private drawOps = 0;
  private interference = 0;
  private signalTime = 0;
  private previousNow = 0;
  private fogGradient!: CanvasGradient;

  constructor(private readonly options: AplusOptions, private readonly contacts: MinimapContact[]) {
    const { canvas, course, reducedMotion } = options;
    this.context = canvas.getContext("2d", { alpha: true })!;
    this.gates = aplusGates(course);
    this.playerOffset = playerRaceDistanceOffsetMeters(course.startProgress, course.length);
    const hud = canvas.closest<HTMLElement>(".hud")!;
    hud.dataset.minimap = "aplus";
    hud.dataset.motion = reducedMotion ? "reduce" : "full";
    canvas.style.removeProperty("width");
    canvas.style.removeProperty("height");
    canvas.setAttribute("aria-label", `${course.mapName} circuit map. Lime arrow: you. Amber bar: next gate.`);
    canvas.dataset.variant = "aplus";
    canvas.dataset.gates = String(this.gates.length);
    this.plate.className = "aplus-gate-plate";
    this.plate.hidden = true;
    this.plate.append(this.plateNumber, this.plateName);
    this.gateStrip.querySelector(".hud-gate__left")!.append(this.plate);
    this.rebuild();
    this.observer = new ResizeObserver(() => this.rebuild());
    this.observer.observe(canvas);
    // The game's page owns one minimap. On a Vite hot replacement release its
    // observer and timer so repeated edits do not leave extra active renderers.
    import.meta.hot?.dispose(() => {
      this.observer.disconnect();
      window.clearTimeout(this.plateTimer);
      this.plate.remove();
      delete hud.dataset.minimap;
      delete this.gateStrip.dataset.announcing;
    });
  }

  private rebuild(): void {
    const { canvas, outline, upperOutline } = this.options;
    this.width = canvas.clientWidth || 180;
    this.height = canvas.clientHeight || 210;
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(this.width * this.pixelRatio);
    canvas.height = Math.round(this.height * this.pixelRatio);
    this.context.setTransform(this.pixelRatio, 0, 0, this.pixelRatio, 0, 0);
    this.context.lineJoin = "round";
    this.context.lineCap = "round";
    this.fogGradient = this.context.createRadialGradient(0, 0, 0, 0, 0, 1);
    this.fogGradient.addColorStop(0, "rgba(53,72,89,.98)");
    this.fogGradient.addColorStop(.55, "rgba(43,61,77,.88)");
    this.fogGradient.addColorStop(1, "rgba(31,49,65,0)");
    const bounds = { ...outline.bounds };
    if (upperOutline) {
      bounds.minX = Math.min(bounds.minX, upperOutline.bounds.minX);
      bounds.maxX = Math.max(bounds.maxX, upperOutline.bounds.maxX);
      bounds.minZ = Math.min(bounds.minZ, upperOutline.bounds.minZ);
      bounds.maxZ = Math.max(bounds.maxZ, upperOutline.bounds.maxZ);
    }
    this.transform = fitOutlineTransform(bounds, this.width, this.height, 20);
    this.outlinePath = this.pathFor(outline.points);
    this.shortcutPath = new Path2D();
    for (const points of this.options.shortcutPoints) this.shortcutPath.addPath(this.pathFor(points));
  }

  private pathFor(points: Float64Array): Path2D {
    const path = new Path2D();
    const { scale, offsetX, offsetY } = this.transform;
    for (let index = 0; index < points.length; index += 2) {
      const x = points[index] * scale + offsetX, y = points[index + 1] * scale + offsetY;
      if (index === 0) path.moveTo(x, y);
      else path.lineTo(x, y);
    }
    return path;
  }

  private pointAt(progress: number, out: Point, outline = this.options.outline): void {
    const span = outline.stationCount - 1;
    const scaled = (progress - Math.floor(progress)) * span;
    const index = Math.min(Math.floor(scaled), span - 1);
    const alpha = scaled - index, points = outline.points;
    const x = points[index * 2], y = points[index * 2 + 1];
    const dx = points[(index + 1) * 2] - x, dy = points[(index + 1) * 2 + 1] - y;
    out.x = (x + dx * alpha) * this.transform.scale + this.transform.offsetX;
    out.y = (y + dy * alpha) * this.transform.scale + this.transform.offsetY;
    out.angle = Math.atan2(dy, dx);
  }

  private stroke(color: string, width: number, path?: Path2D): void {
    this.context.strokeStyle = color;
    this.context.lineWidth = width;
    if (path) this.context.stroke(path);
    else this.context.stroke();
    this.drawOps++;
  }

  private segment(from: number, to: number, color: string): void {
    if (to <= from) return;
    const context = this.context, span = this.options.outline.stationCount - 1;
    context.beginPath();
    this.pointAt(from, this.point);
    context.moveTo(this.point.x, this.point.y);
    for (let station = Math.floor(from * span) + 1; station < to * span; station++) {
      this.pointAt(station / span, this.point);
      context.lineTo(this.point.x, this.point.y);
    }
    this.pointAt(to, this.point);
    context.lineTo(this.point.x, this.point.y);
    this.stroke(color, 3);
  }

  private arrow(point: Point, size: number, color: string, filled: boolean): void {
    const context = this.context;
    context.save();
    context.translate(point.x, point.y);
    context.rotate(point.angle);
    context.beginPath();
    context.moveTo(size, 0);
    context.lineTo(-size * .65, -size * .58);
    context.lineTo(-size * .35, 0);
    context.lineTo(-size * .65, size * .58);
    context.closePath();
    this.stroke(CASING, size > 5 ? 4 : 3);
    context.fillStyle = filled ? color : CASING;
    context.fill();
    this.stroke(color, 1.2);
    context.restore();
  }

  private label(text: string, x: number, y: number, color: string): void {
    const context = this.context;
    context.font = "700 11px monospace";
    context.textAlign = "left";
    context.textBaseline = "middle";
    x = Math.max(3, Math.min(this.width - context.measureText(text).width - 3, x));
    y = Math.max(8, Math.min(this.height - 8, y));
    context.strokeStyle = CASING;
    context.lineWidth = 3.5;
    context.strokeText(text, x, y);
    context.fillStyle = color;
    context.fillText(text, x, y);
  }

  private drawGate(index: number, next: number): void {
    this.pointAt(this.gates[index], this.point);
    const normalX = -Math.sin(this.point.angle), normalY = Math.cos(this.point.angle);
    const half = index === next ? 6 : 3;
    const context = this.context;
    context.beginPath();
    context.moveTo(this.point.x - normalX * half, this.point.y - normalY * half);
    context.lineTo(this.point.x + normalX * half, this.point.y + normalY * half);
    this.stroke(CASING, index === next ? 6 : 3);
    this.stroke(index === next ? AMBER : index === 0 ? INK : "#657272", index === next ? 3 : 1);
  }

  /** Fog obscures route detail, never moves the true player or next gate.
   * Slow drift and a displaced echo suggest a failing receiver without flashes. */
  private drawInterference(): void {
    if (this.interference < .01) return;
    const context = this.context, strength = this.interference, time = this.signalTime;
    context.save();
    context.globalAlpha = strength * .3;
    context.translate(Math.sin(time * .8) * 2.5, Math.cos(time * .6) * 1.5);
    this.stroke("#83b1cb", 2, this.outlinePath);
    context.restore();
    for (let cloud = 0; cloud < 3; cloud++) {
      context.save();
      context.translate(this.width * (.3 + cloud * .2 + Math.sin(time * .23 + cloud * 2) * .12),
        this.height * (.22 + cloud * .27 + Math.cos(time * .19 + cloud) * .07));
      context.scale(this.width * .64, this.height * .31);
      context.globalAlpha = strength;
      context.fillStyle = this.fogGradient;
      context.fillRect(-1, -1, 2, 2);
      context.restore();
    }
    context.save();
    context.fillStyle = "#92a8b8";
    context.globalAlpha = strength * .16;
    const sweep = (time * 5) % 7;
    for (let y = sweep; y < this.height - 19; y += 7) context.fillRect(5, y, this.width - 10, 1);
    context.globalAlpha = .9;
    context.fillStyle = CASING;
    context.fillRect(3, this.height - 18, this.width - 6, 16);
    context.restore();
    this.label("SIGNAL DEGRADED", 8, this.height - 10, "#a9c2d0");
  }

  private hideAnnouncement(): void {
    window.clearTimeout(this.plateTimer);
    this.plate.hidden = true;
    this.gateStrip.dataset.announcing = "false";
  }

  private announce(sector: number): void {
    // Gate acceptance can precede the craft centre crossing the boundary.
    // Name the entered sector at the gate, independent of tick timing.
    const progress = (this.gates[sector - 1] + 1e-6) % 1;
    const name = this.options.course.sectorLabelAt(progress);
    this.plateNumber.textContent = `S${sector}/${this.gates.length}`;
    this.plateName.textContent = name;
    this.plate.style.setProperty("--sector-accent", SECTOR_ACCENTS[name] ?? "#b8dca2");
    this.plate.hidden = false;
    this.gateStrip.dataset.announcing = "true";
    window.clearTimeout(this.plateTimer);
    this.plateTimer = window.setTimeout(() => this.hideAnnouncement(), 900);
  }

  update(distance: number, lateral: number, progress: number, count: number, now: number, alternateRoad = false): void {
    const { canvas, course, outline, upperOutline } = this.options;
    if (this.pixelRatio !== Math.min(window.devicePixelRatio || 1, 2)) this.rebuild();
    const phase = document.body.dataset.phase ?? "intro";
    const reset = phase !== this.lastPhase || Math.abs(distance - this.lastRaceDistance) > course.length * .15;
    if (reset) { this.focus.reset(); this.hideAnnouncement(); this.lastClear = ""; }
    const requestedInterference = phase === "race" ? course.minimapInterference ?? 0 : 0;
    const strength = Number.isFinite(requestedInterference) ? Math.max(0, Math.min(1, requestedInterference)) : 0;
    const delta = Math.max(0, Math.min(.1, now - this.previousNow));
    this.previousNow = now;
    // Restart and leaving the race clear immediately; attack phases ease in.
    this.interference = strength === 0 ? 0 : this.interference + (strength - this.interference) * (1 - Math.exp(-delta * 3));
    if (!this.options.reducedMotion && phase === "race") this.signalTime += delta;
    if (strength === 0) this.signalTime = 0;
    canvas.dataset.signal = this.interference >= .01 ? "degraded" : "clear";
    this.lastPhase = phase;
    this.lastRaceDistance = distance;
    const gateText = this.checkpoint.textContent ?? "";
    const gate = aplusGateState(gateText, this.gates.length);
    if (phase === "race" && !reset && gate.sector !== null && gateText !== this.lastClear) {
      this.announce(gate.sector);
    }
    this.lastClear = gate.sector === null ? "" : gateText;
    if (phase !== "race" || gate.missed) this.hideAnnouncement();

    const livery = save.livery;
    if (livery !== this.livery) {
      this.livery = livery;
      this.rivalNumbers = fieldLiveries(livery).map(code => liveryFor(code).label.split(" ").at(-1)!);
    }
    this.count = Math.max(0, Math.min(count, this.contacts.length));
    this.gaps.length = this.separations.length = this.count;
    let nearest = Infinity;
    for (let index = 0; index < this.count; index++) {
      const contact = this.contacts[index];
      this.gaps[index] = contact.raceDistanceMeters - distance - this.playerOffset;
      this.separations[index] = Math.hypot(this.gaps[index], contact.lateralMeters - lateral);
      nearest = Math.min(nearest, this.separations[index]);
    }
    this.nearest = Number.isFinite(nearest) ? nearest : null;
    const focus = this.focus.update(this.gaps, this.separations, now);
    canvas.dataset.rivalLabels = focus === -1 ? "0" : "1";
    canvas.dataset.nextGate = String(gate.next);

    const context = this.context;
    this.drawOps = 0;
    context.clearRect(0, 0, this.width, this.height);
    context.save();
    context.globalAlpha = 1 - this.interference * .35;
    this.stroke(CASING, 7, this.outlinePath);
    this.stroke("#657272", 2.5, this.outlinePath);
    this.segment(progress, 1, INK);
    const target = this.gates[gate.next];
    if (target > progress) this.segment(progress, target, CYAN);
    else if (gate.next === 0) this.segment(progress, 1, CYAN);
    if (this.options.shortcutPoints.length) {
      context.setLineDash([3, 3]);
      this.stroke(CYAN, 2, this.shortcutPath);
      context.setLineDash([]);
    }
    // All authored gates, including the last one. Zero is the finish stripe.
    for (let index = 0; index < this.gates.length; index++) this.drawGate(index, gate.next);
    for (let index = 0; index < this.count; index++) {
      this.pointAt(this.contacts[index].raceDistanceMeters / course.length, this.point);
      const offset = Math.max(-5, Math.min(5, this.contacts[index].lateralMeters * .45));
      this.point.x -= Math.sin(this.point.angle) * offset;
      this.point.y += Math.cos(this.point.angle) * offset;
      this.arrow(this.point, 3.8, index === focus ? AMBER : "#f09880", this.gaps[index] > 0);
      if (index === focus) this.label(this.rivalNumbers[index] ?? "?", this.point.x + 10, this.point.y - 11, INK);
    }
    context.restore();
    this.drawInterference();
    // The next gate and player remain accurate and crisp above the fog.
    if (this.interference >= .01) this.drawGate(gate.next, gate.next);
    const upper = (course.kind === "polarity" && (course as PolarityCourse).lane === 1) || alternateRoad;
    this.pointAt(progress, this.player, upper && upperOutline ? upperOutline : outline);
    const distanceToGate = ((target - progress + 1) % 1) * course.length;
    this.pointAt(target, this.point);
    // Both a world-distance and a pixel clearance guard keep labels off the
    // player on compact maps, including the very short phone drawing.
    if (distanceToGate > 60 && Math.hypot(this.point.x - this.player.x, this.point.y - this.player.y) > 19) {
      this.label(gate.next === 0 ? "FIN" : String(gate.next).padStart(2, "0"), this.point.x + 9, this.point.y, AMBER);
    }
    this.arrow(this.player, this.width < 150 ? 7.5 : 8.5, ACID, true);
  }

  diagnostics() {
    return {
      minimapAnimated: !this.options.reducedMotion,
      minimapInterference: Number(this.interference.toFixed(3)),
      minimapInterferenceTime: Number(this.signalTime.toFixed(3)),
      minimapStations: this.options.outline.stationCount,
      minimapContacts: this.count,
      minimapNearestRivalMeters: this.nearest === null ? null : Number(this.nearest.toFixed(1)),
      minimapAlert: this.nearest !== null && this.nearest <= 25,
      minimapDrawOps: this.drawOps,
      minimapShortcutPaths: this.options.shortcutPoints.length,
    };
  }
}
