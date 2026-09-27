import type { RaceCourse } from "./course";
import type { MinimapContact } from "./minimap";
import { buildCourseOutline, fitOutlineTransform } from "./minimap-projection.js";
import { playerRaceDistanceOffsetMeters } from "./rival-race.js";
import nightshiftRoute from "./data/nightshift/route.json";
import { fieldLiveries, liveryFor } from "./liveries.js";
import { save } from "./persistence";

/**
 * DEV-ONLY minimap direction "A+" (Circuit Signature, refined), loaded only by
 * `?minimap=aplus` on the Vite dev server — `import.meta.env.DEV` gates the
 * dynamic import in game.ts, so none of this reaches a production bundle.
 * The shipped P6 minimap (`minimap.ts`) stays the default and the comparison.
 *
 * Same rendering approach as P6: one DOM 2D canvas, every static path cached
 * as a `Path2D`, a 30 Hz tick that clears and strokes. Styling goes through
 * CSSOM and the Web Animations API because the shipped CSP (`style-src 'self'`)
 * blocks injected `<style>` in dev.
 *
 * What A+ draws: the whole lap as one cased ribbon (north fixed, the arrow
 * turns), the rest of the lap bright, the road to the next gate cyan, the next
 * gate as a numbered amber bar, rivals solid (ahead) or hollow (behind), and a
 * number on ONE rival only — the one being passed, else the nearest inside
 * 25 m. No position readout: the main HUD owns race position.
 *
 * Gate crossings are announced by temporarily replacing the NEXT GATE strip's
 * own content with a sector plate in that sector's colour, never by stacking a
 * second notification. The trigger is the HUD's own "GATE xx CLEAR" state
 * (`ui.flashGate`), so the announcement follows the race's real gate rules.
 *
 * Wired through `Minimap` (a dev-only delegate) so the race loop in game.ts,
 * which sits exactly on its seam budget, does not grow.
 */

const WIDTH = 220;
const HEIGHT = 200;
const PADDING = 22;
const STATIONS = 256;
const TAG_RANGE_METERS = 25;
const PASS_HOLD_SECONDS = 1.2;
const GATE_HOLD_SECONDS = 1.0;
const RING_SECONDS = 0.5;
const ANNOUNCE_MS = 900;
const TURN_CUE_METERS = 220;
const GATE_LABEL_HIDE_METERS = 60;
const PHONE_QUERY = "(max-height: 520px), (max-width: 700px)";
/** Portrait: the gate strip sits under the turn cue (style.css), so the map goes below both. */
const PORTRAIT_QUERY = "(max-width: 700px) and (min-height: 521px)";

const ACID = "rgb(192,240,0)";
const CYAN = "rgb(77,232,255)";
const AMBER = "rgb(255,162,46)";
const WARN = "rgb(255,101,49)";
const PASS = "rgb(200,255,46)";
const PLATE = "rgba(1,5,6,0.9)";
const ROAD = "rgb(236,244,243)";

/** Sector colours for the gate announcement, keyed by `sectorLabelAt` text. */
const SECTOR_COLOURS: Record<string, string> = {
  "RUNWAY 09": "#d9e4e2", "CRADLE BEND": "#b9d7e0", "WATER TABLE": "#4fc3c9", "LINK APRON": "#8fb3ba",
  "HANGAR SIX": "#e0a043", "HANGAR EXIT": "#d88a4a", "GREENWATER SWEEP": "#7fcf6a", "CANOPY PASSAGE": "#b7c95a",
  "THE ELBOW": "#ef7a45", "FUEL ROW": "#e6d35a", "TOTEM TURN": "#c7a0e8", "HOME STRAIGHT": "#d9e4e2",
};
for (const district of nightshiftRoute.districts) SECTOR_COLOURS[district.name] = district.color;

export interface MinimapAPlusDiagnostics {
  aplusUpdates: number;
  aplusUpdateP95Ms: number;
  aplusTaggedRival: number;
  aplusAnnouncements: number;
  aplusPhoneLayout: boolean;
}

export class MinimapAPlus {
  private labels: readonly string[] = [];
  private labelsFor = "";
  private gateWasCleared = false;

  private readonly context: CanvasRenderingContext2D;
  private readonly points: Float64Array;
  private readonly span: number;
  private readonly offsetMeters: number;
  private readonly gates: number[] = [];
  private readonly phoneQuery: MediaQueryList;
  private ratio = 0;
  private sx = 1;
  private ox = 0;
  private oy = 0;
  private ring = new Path2D();
  private start = new Path2D();
  private gatePaths: Path2D[] = [];
  private scrim: CanvasGradient | null = null;
  private scrimBox = { cx: 0, cy: 0, rx: 0, ry: 0 };

  private prevAhead: boolean[] = [];
  private pass: { index: number; at: number } | null = null;
  private crossed: { gate: number; at: number } | null = null;
  private lastNext = -1;
  private readonly times: number[] = [];
  private updates = 0;
  private tagged = -1;
  private announcements = 0;
  private announceTimer = 0;
  private plate: HTMLElement | null = null;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly course: RaceCourse,
    private readonly reducedMotion: boolean,
  ) {
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) throw new Error("Minimap A+ canvas has no 2D context.");
    this.context = context;
    const outline = buildCourseOutline(course, STATIONS);
    this.points = outline.points;
    this.span = outline.stationCount - 1;
    this.offsetMeters = playerRaceDistanceOffsetMeters(course.startProgress, course.length);
    // Index 0 is the lap line; 1..checkpointCount are the intermediate gates, so a
    // lap has checkpointCount + 1 sectors (the HUD counts only the intermediates).
    for (let index = 0; index <= course.checkpointCount; index += 1) this.gates.push(course.checkpointProgress(index));
    const transform = fitOutlineTransform(outline.bounds, WIDTH, HEIGHT, PADDING);
    this.sx = transform.scale; this.ox = transform.offsetX; this.oy = transform.offsetY;
    const b = outline.bounds;
    this.scrimBox = {
      cx: ((b.minX + b.maxX) / 2) * this.sx + this.ox, cy: ((b.minZ + b.maxZ) / 2) * this.sx + this.oy,
      rx: (b.maxX - b.minX) * this.sx / 2 + 34, ry: (b.maxZ - b.minZ) * this.sx / 2 + 30,
    };
    this.phoneQuery = window.matchMedia(PHONE_QUERY);
    this.phoneQuery.addEventListener("change", () => this.layout());
    this.layout();
    this.rebuild();
  }

  /** CSSOM only: the CSP forbids injected style blocks, not property writes. */
  private layout(): void {
    const style = this.canvas.style;
    style.background = "transparent";
    style.clipPath = "none";
    style.width = `${WIDTH}px`;
    style.height = `${HEIGHT}px`;
    if (this.phoneQuery.matches) {
      // The shipped minimap is display:none here; A+ is new information on phone.
      style.display = "block";
      // Below the turn cue band on every circuit (Dream Island's cue is the widest),
      // above the bottom-right gate strip.
      style.top = window.matchMedia(PORTRAIT_QUERY).matches ? "322px" : "186px";
      style.right = "14px";
      style.transformOrigin = "top right";
      style.transform = "scale(0.6)";
    } else {
      style.display = "";
      style.top = "";
      style.right = "30px";
      style.transformOrigin = "";
      style.transform = "";
    }
  }

  private rebuild(): void {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    this.ratio = ratio;
    this.canvas.width = Math.round(WIDTH * ratio);
    this.canvas.height = Math.round(HEIGHT * ratio);
    const c = this.context;
    c.setTransform(ratio, 0, 0, ratio, 0, 0);
    c.lineJoin = "round";
    c.lineCap = "round";
    const ring = new Path2D();
    for (let index = 0; index <= this.span; index += 1) {
      const x = this.points[index * 2] * this.sx + this.ox, y = this.points[index * 2 + 1] * this.sx + this.oy;
      if (index === 0) ring.moveTo(x, y); else ring.lineTo(x, y);
    }
    this.ring = ring;
    this.start = this.bar(0, 7);
    this.gatePaths = this.gates.map((progress) => this.bar(progress, 5.5));
    const { cx, cy, rx, ry } = this.scrimBox;
    const gradient = c.createRadialGradient(cx, cy, 0, cx, cy, Math.max(rx, ry));
    gradient.addColorStop(0, "rgba(1,5,6,0.6)");
    gradient.addColorStop(0.65, "rgba(1,5,6,0.38)");
    gradient.addColorStop(1, "rgba(1,5,6,0)");
    this.scrim = gradient;
  }

  private at(progress: number): [number, number] {
    const wrapped = progress - Math.floor(progress);
    const scaled = wrapped * this.span;
    const index = Math.min(Math.floor(scaled), this.span - 1);
    const t = scaled - index, p = this.points;
    return [
      (p[index * 2] + (p[index * 2 + 2] - p[index * 2]) * t) * this.sx + this.ox,
      (p[index * 2 + 1] + (p[index * 2 + 3] - p[index * 2 + 1]) * t) * this.sx + this.oy,
    ];
  }

  /** Screen-space unit tangent, smoothed over +-0.4 % of the lap. */
  private tangent(progress: number): [number, number] {
    const a = this.at(progress - 0.004), b = this.at(progress + 0.004);
    const dx = b[0] - a[0], dy = b[1] - a[1], length = Math.hypot(dx, dy) || 1;
    return [dx / length, dy / length];
  }

  private bar(progress: number, half: number): Path2D {
    const [x, y] = this.at(progress), [tx, ty] = this.tangent(progress), path = new Path2D();
    path.moveTo(x + ty * half, y - tx * half);
    path.lineTo(x - ty * half, y + tx * half);
    return path;
  }

  private strokeRun(from: number, to: number): void {
    const c = this.context;
    c.beginPath();
    const [x0, y0] = this.at(from);
    c.moveTo(x0, y0);
    const first = Math.floor(from * this.span) + 1, last = Math.ceil(to * this.span) - 1;
    for (let index = first; index <= last; index += 1) {
      const i = ((index % this.span) + this.span) % this.span;
      c.lineTo(this.points[i * 2] * this.sx + this.ox, this.points[i * 2 + 1] * this.sx + this.oy);
    }
    const [x1, y1] = this.at(to);
    c.lineTo(x1, y1);
    c.stroke();
  }

  update(
    playerRaceDistanceMeters: number,
    playerProgress: number,
    contacts: readonly MinimapContact[],
    contactCount: number,
    nowSeconds: number,
  ): void {
    const started = performance.now();
    this.watchGateFlash(playerProgress);
    // On phones the map shares the screen with transient banners (Dream Island's
    // run wide at 667px): it steps back while one is speaking.
    const speaking = this.phoneQuery.matches
      && document.querySelector('.hud-banner[data-active="true"], .hud-alert[data-active="true"]') !== null;
    const opacity = speaking ? "0.2" : "";
    if (this.canvas.style.opacity !== opacity) this.canvas.style.opacity = opacity;
    // Same rule the fleet uses to dress the field (liveries.js fieldLiveries).
    if (save.livery !== this.labelsFor) {
      this.labelsFor = save.livery;
      this.labels = fieldLiveries(save.livery).map((code) => liveryFor(code).label);
    }
    if (Math.min(window.devicePixelRatio || 1, 2) !== this.ratio) this.rebuild();
    const c = this.context;
    const p = playerProgress - Math.floor(playerProgress);
    const length = this.course.length;
    c.clearRect(0, 0, WIDTH, HEIGHT);

    if (this.scrim) {
      const { cx, cy, rx, ry } = this.scrimBox;
      c.fillStyle = this.scrim;
      c.beginPath();
      c.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      c.fill();
    }
    c.strokeStyle = "rgba(1,5,6,0.8)"; c.lineWidth = 9; c.stroke(this.ring);
    c.strokeStyle = "rgba(226,238,238,0.4)"; c.lineWidth = 3.6; c.stroke(this.ring);

    // Next gate from the course table; the lap line is index 0.
    let next = 0, nearest = 2;
    for (let index = 0; index < this.gates.length; index += 1) {
      let ahead = (this.gates[index] - p) - Math.floor(this.gates[index] - p);
      if (ahead === 0) ahead = 1;
      if (ahead < nearest) { nearest = ahead; next = index; }
    }
    if (this.lastNext !== -1 && next !== this.lastNext) this.crossed = { gate: this.lastNext, at: nowSeconds };
    this.lastNext = next;
    const gateProgress = this.gates[next] === 0 ? 1 : this.gates[next];

    c.strokeStyle = ROAD; this.strokeRun(p, 1);
    c.strokeStyle = CYAN; this.strokeRun(p, gateProgress > p ? gateProgress : gateProgress + 1);
    c.lineWidth = 4; c.strokeStyle = ROAD; c.stroke(this.start);
    c.strokeStyle = "rgb(1,5,6)"; c.setLineDash([2, 2]); c.stroke(this.start); c.setLineDash([]);

    const crossed = this.crossed && nowSeconds - this.crossed.at < GATE_HOLD_SECONDS ? this.crossed : null;
    c.lineWidth = 2; c.strokeStyle = "rgba(1,5,6,0.95)";
    for (let index = 1; index < this.gatePaths.length; index += 1) {
      if (index !== next && (!crossed || index !== crossed.gate)) c.stroke(this.gatePaths[index]);
    }
    if (crossed) {
      const age = nowSeconds - crossed.at, path = this.bar(this.gates[crossed.gate], 9);
      c.globalAlpha = this.reducedMotion ? 1 : Math.max(0, Math.min(1, 1.6 - age * 1.4));
      c.lineWidth = 7.5; c.strokeStyle = "rgb(1,5,6)"; c.stroke(path);
      c.lineWidth = 4.5; c.strokeStyle = PASS; c.stroke(path);
      c.globalAlpha = 1;
      if (!this.reducedMotion && age < RING_SECONDS) {
        const [x, y] = this.at(this.gates[crossed.gate]);
        c.globalAlpha = 1 - age / RING_SECONDS; c.lineWidth = 2; c.strokeStyle = PASS;
        c.beginPath(); c.arc(x, y, 6 + 18 * age / RING_SECONDS, 0, Math.PI * 2); c.stroke();
        c.globalAlpha = 1;
      }
    }

    // Next gate: amber bar and its number, pushed to the outside of the lap.
    const gateBar = this.bar(gateProgress, 8.5);
    c.lineWidth = 7.5; c.strokeStyle = "rgb(1,5,6)"; c.stroke(gateBar);
    c.lineWidth = 4.5; c.strokeStyle = AMBER; c.stroke(gateBar);
    const [gx, gy] = this.at(gateProgress), [gtx, gty] = this.tangent(gateProgress);
    const side = ((gx - this.scrimBox.cx) * -gty + (gy - this.scrimBox.cy) * gtx) >= 0 ? 1 : -1;
    const lx = gx - gty * side * 19, ly = gy + gtx * side * 19;
    // Inside the last 60 m the number would sit on the arrow; the bar and the
    // announcement that is about to fire already say which gate it is.
    if (nearest * length > GATE_LABEL_HIDE_METERS) {
      const label = next === 0 ? "FIN" : next.toString().padStart(2, "0");
      c.font = "700 10.5px ui-monospace, SFMono-Regular, Consolas, monospace";
      c.textAlign = "center"; c.textBaseline = "middle";
      const labelWidth = c.measureText(label).width + 8;
      c.fillStyle = PLATE; c.fillRect(lx - labelWidth / 2, ly - 7.5, labelWidth, 15);
      c.fillStyle = AMBER; c.fillText(label, lx, ly + 0.5);
    }

    // Only a real corner earns a caret, and only on the approach.
    const cue = this.course.turnAhead(p, TURN_CUE_METERS);
    if (cue && cue.distance > 0 && cue.radius < 200) {
      const entry = p + cue.distance / length, [ax, ay] = this.at(entry), [atx, aty] = this.tangent(entry);
      const turn = cue.direction === "RIGHT" ? 1 : -1, nx = aty * turn, ny = -atx * turn;
      c.beginPath();
      c.moveTo(ax + nx * 7, ay + ny * 7);
      c.lineTo(ax + nx * 15 + atx * 4.5, ay + ny * 15 + aty * 4.5);
      c.lineTo(ax + nx * 15 - atx * 4.5, ay + ny * 15 - aty * 4.5);
      c.closePath();
      c.fillStyle = cue.radius < 90 ? WARN : AMBER; c.fill();
      c.lineWidth = 1.5; c.strokeStyle = "rgb(1,5,6)"; c.stroke();
    }

    // Rivals. Ahead solid, behind hollow; one number at most.
    const count = Math.max(0, Math.min(contactCount, contacts.length));
    const playerFrame = playerRaceDistanceMeters + this.offsetMeters;
    let closest = -1, closestGap = Infinity;
    for (let index = 0; index < count; index += 1) {
      const gap = contacts[index].raceDistanceMeters - playerFrame, ahead = gap > 0;
      if (this.prevAhead[index] !== undefined && this.prevAhead[index] !== ahead) this.pass = { index, at: nowSeconds };
      this.prevAhead[index] = ahead;
      if (Math.abs(gap) < closestGap) { closestGap = Math.abs(gap); closest = index; }
    }
    const passing = this.pass && nowSeconds - this.pass.at < PASS_HOLD_SECONDS ? this.pass.index : -1;
    this.tagged = passing >= 0 ? passing : closestGap <= TAG_RANGE_METERS ? closest : -1;
    for (let index = 0; index < count; index += 1) {
      const contact = contacts[index];
      const [x, y] = this.at(contact.raceDistanceMeters / length);
      const ahead = contact.raceDistanceMeters - playerFrame > 0;
      c.beginPath(); c.arc(x, y, 4.6, 0, Math.PI * 2);
      c.fillStyle = ahead ? ROAD : "rgba(1,5,6,0.7)"; c.fill();
      c.lineWidth = 2; c.strokeStyle = ahead ? "rgb(1,5,6)" : ROAD; c.stroke();
      if (index === this.tagged) {
        const gained = passing === index && !ahead;
        c.beginPath(); c.arc(x, y, 10, 0, Math.PI * 2);
        c.lineWidth = 1.6; c.strokeStyle = passing === index ? (gained ? ACID : WARN) : CYAN; c.stroke();
        const number = (this.labels[index] ?? "").split(" ").pop() ?? "";
        c.font = "700 10px ui-monospace, SFMono-Regular, Consolas, monospace";
        c.textAlign = "left"; c.textBaseline = "middle";
        c.lineWidth = 3; c.strokeStyle = "rgb(1,5,6)"; c.strokeText(number, x + 12, y - 9);
        c.fillStyle = ROAD; c.fillText(number, x + 12, y - 9);
      }
    }

    // The player: bigger than P6's dot and than the rivals, ringed dark so it
    // survives both bright and dark scenery.
    const [px, py] = this.at(p), [ptx, pty] = this.tangent(p);
    c.save();
    c.translate(px, py); c.rotate(Math.atan2(pty, ptx));
    c.beginPath(); c.moveTo(14, 0); c.lineTo(-9.5, -10); c.lineTo(-4.5, 0); c.lineTo(-9.5, 10); c.closePath();
    c.lineJoin = "round";
    c.lineWidth = 5.5; c.strokeStyle = "rgba(1,5,6,0.55)"; c.stroke();
    c.lineWidth = 2.4; c.strokeStyle = "rgb(1,5,6)"; c.stroke();
    c.fillStyle = ACID; c.fill();
    c.restore();

    this.updates += 1;
    this.times.push(performance.now() - started);
    if (this.times.length > 600) this.times.shift();
  }

  /** Rising edge of the HUD's own gate-clear state (`ui.flashGate`). */
  private watchGateFlash(progress: number): void {
    const checkpoint = document.getElementById("checkpoint-value");
    const cleared = checkpoint?.dataset.cleared === "true";
    if (cleared && !this.gateWasCleared) {
      const match = /GATE (\d+) CLEAR/.exec(checkpoint?.textContent ?? "");
      if (match) this.announceGate(Number(match[1]), progress);
    }
    this.gateWasCleared = cleared;
  }

  /**
   * Replaces the NEXT GATE strip's own gate/sector text with a coloured sector
   * plate for ANNOUNCE_MS, then hands the strip back.
   */
  private announceGate(clearedIndex: number, progress: number): void {
    const checkpoint = document.getElementById("checkpoint-value");
    const sector = document.getElementById("sector-value");
    const host = checkpoint?.parentElement;
    if (!checkpoint || !sector || !host) return;
    const name = this.course.sectorLabelAt(progress);
    const colour = SECTOR_COLOURS[name] ?? ACID;
    if (!this.plate) {
      const plate = document.createElement("span");
      plate.setAttribute("role", "status");
      Object.assign(plate.style, {
        display: "none", alignItems: "baseline", gap: "10px", padding: "3px 14px 3px 10px",
        transform: "skewX(-10deg)", color: "rgb(6,10,11)", whiteSpace: "nowrap",
        // The strip's dark text-shadow blurs dark-on-colour type; the plate is its own ground.
        textShadow: "none",
      });
      const number = document.createElement("span");
      Object.assign(number.style, { font: "italic 800 20px/1 'Barlow Condensed', sans-serif", transform: "skewX(10deg)", display: "inline-block" });
      const title = document.createElement("span");
      Object.assign(title.style, {
        font: "700 12px/1 var(--mono)", letterSpacing: "0.1em", transform: "skewX(10deg)", display: "inline-block",
        minWidth: "0", overflow: "hidden", textOverflow: "ellipsis",
      });
      plate.append(number, title);
      host.prepend(plate);
      this.plate = plate;
    }
    const plate = this.plate;
    const [number, title] = plate.children as unknown as [HTMLElement, HTMLElement];
    number.textContent = `S${clearedIndex + 1}/${this.course.checkpointCount + 1}`;
    title.textContent = name;
    plate.style.background = colour;
    plate.style.display = "inline-flex";
    // On phones the strip is a two-row grid (style.css); the plate takes the
    // whole first row and never grows past it, so the distance row below and
    // every block around it stay readable for the full announcement.
    const compact = this.phoneQuery.matches;
    plate.style.gridColumn = compact ? "1 / -1" : "";
    plate.style.gridRow = compact ? "1" : "";
    plate.style.maxWidth = compact ? "100%" : "";
    plate.style.boxSizing = "border-box";
    const chain = document.getElementById("clean-chain");
    if (compact && chain) chain.style.visibility = "hidden";
    checkpoint.style.display = "none";
    sector.style.display = "none";
    if (!this.reducedMotion) {
      plate.animate(
        [{ transform: "skewX(-10deg) translateX(22px)", opacity: 0, filter: "brightness(2.2)" },
          { transform: "skewX(-10deg) translateX(0)", opacity: 1, filter: "brightness(2.2)", offset: 0.35 },
          { transform: "skewX(-10deg) translateX(0)", opacity: 1, filter: "brightness(1)" }],
        { duration: 320, easing: "cubic-bezier(0.2, 0.9, 0.2, 1)" },
      );
    }
    this.announcements += 1;
    window.clearTimeout(this.announceTimer);
    // A JS timer, not an animation callback, restores the strip: the hand-back
    // must not depend on an animation finishing (reduced motion runs none).
    this.announceTimer = window.setTimeout(() => {
      plate.style.display = "none";
      checkpoint.style.display = "";
      sector.style.display = "";
      if (chain) chain.style.visibility = "";
    }, ANNOUNCE_MS);
  }

  diagnostics(): MinimapAPlusDiagnostics {
    const sorted = this.times.slice().sort((a, b) => a - b);
    return {
      aplusUpdates: this.updates,
      aplusUpdateP95Ms: sorted.length ? Number(sorted[Math.floor(sorted.length * 0.95)].toFixed(3)) : 0,
      aplusTaggedRival: this.tagged,
      aplusAnnouncements: this.announcements,
      aplusPhoneLayout: this.phoneQuery.matches,
    };
  }
}
