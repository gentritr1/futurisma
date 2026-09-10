import * as THREE from "three";
import { resolveAbilitySeed } from "./ability-seed";
import calibration from "./data/dreamisland/schedule.json";
import { DreamIslandSchedule } from "./dreamisland-schedule.js";
import route from "./data/dreamisland/route.json";
import rivalPace from "./data/dreamisland/rival-pace.json";
import { createApronResolution, resolveApron } from "./apron.js";
import { DREAMISLAND_ABILITY_CONFIG, DREAMISLAND_FIELDS } from "./dreamisland-powers-config.js";
import { CELL } from "./dreamisland-materials";
import type { ApronResolution, ApronTable } from "./apron.js";
import type { AudioZone } from "./audio-space.js";
import type { CourseSample, CourseProjection, CourseLightingProfile, FogProfile,
  RaceCourse, TurnCue, MusicProfile } from "./course";

const UP = new THREE.Vector3(0, 1, 0);
// The coral kerb is the race boundary; the surf and the shallows are not a
// drivable apron. Same table the two modern maps ship.
const APRON: ApronTable = {
  deckMarginMetres: 2.05,
  gripFloor: .5,
  edges: {
    A: { label: "Coral kerb", widthMetres: 0, grip: 1, wall: true,
      wallSpeedMultiplier: .76, wallImpactStrength: .5,
      wallScrubMetresPerSecondSquared: 24, surface: "asphalt" },
  },
  overrides: [],
};
const DISTRICT_COLORS = route.districts.map(d => new THREE.Color(d.color));
const COURT_FROM = route.districts[4].from, COURT_TO = route.districts[5].from;
/** Peak bank across the Clock Court, in RADIANS (3.15 degrees), applied by
 * rotating the road basis about the tangent exactly as Ascension does. */
const COURT_BANK = .055;
/** Where the road runs through the watchtower bore. */
const BORE_FROM = .325, BORE_TO = .350;

const DAY_LIGHTING: CourseLightingProfile = {
  sky:new THREE.Color(0xbfe4ef),ground:new THREE.Color(0x6f8a52),
  key:new THREE.Color(0xfff0cf),rim:new THREE.Color(0xa8d8e8),
  hemisphereIntensity:1.2,keyIntensity:1.35,rimIntensity:.3,
  keyDirection:new THREE.Vector3(.55,.62,-.55).normalize(),
};
// Phase A night. The key does NOT go to zero: `castShadow` is armed once in
// installLighting and never re-armed, so a near-black key would still pay a full
// shadow pass and draw shadows from nothing. It drops to a moon, and the shadow
// cost is measured in both states rather than assumed away.
const NIGHT_LIGHTING: CourseLightingProfile = {
  sky:new THREE.Color(0x16233c),ground:new THREE.Color(0x08111c),
  key:new THREE.Color(0x9fc8ff),rim:new THREE.Color(0x2ad9d2),
  hemisphereIntensity:.40,keyIntensity:.30,rimIntensity:.38,
  keyDirection:DAY_LIGHTING.keyDirection,
};
const DAY_FOG={color:new THREE.Color(0xb9dbe4),density:.0016};
const NIGHT_FOG={color:new THREE.Color(0x0b1524),density:.0034};
// One kerb box, as eight corners in the road basis and twelve triangles.
const KERB_CORNERS: readonly [number, number, number][] = [
  [-.325,-.225,-3.4],[.325,-.225,-3.4],[.325,.225,-3.4],[-.325,.225,-3.4],
  [-.325,-.225,3.4],[.325,-.225,3.4],[.325,.225,3.4],[-.325,.225,3.4],
];
/** The kerb box as six QUADS rather than twelve triangles: every face needs its
 * own four corners so the cyan stripe can run along the kerb on all of them. */
const BOX_FACES: readonly [number, number, number, number][] = [
  [0,3,2,1],[4,5,6,7],[0,1,5,4],[3,7,6,2],[1,2,6,5],[0,4,7,3],
];
/** Where each corner of a kerb face lands in the kerb quadrant. The stripe runs
 * up the middle of the cell in V, so V is the along-the-kerb axis. */
const KERB_FACE_UV: readonly [number, number][] = [[0,0],[1,0],[1,1],[0,1]];
/** Stations of road that share one road-sand tile. At 3 m a station and a deck
 * 14-26 m wide, four stations is the tile that reads closest to square. */
const DECK_STATIONS = 4;
const LAUNCH_STRIPS = DREAMISLAND_ABILITY_CONFIG.launchZones.map(z => [z.from, z.to] as const);
const STRIP_DISTANCES = LAUNCH_STRIPS.flatMap(([from, to]) => {
  const marks: number[] = [];
  for (let d = Math.ceil(from * route.length); d < to * route.length; d += 7) marks.push(d);
  return marks;
});
/** Device marker tints. Availability is also carried by the marker going dark,
 * never by hue alone. */
export const DEVICE_COLORS: Record<string, THREE.Color> = {
  surge: new THREE.Color(0xffc36a), shield: new THREE.Color(0x7fd8ff), spent: new THREE.Color(0x2c3a40),
};
const MUSIC: MusicProfile[] = [
  { trance: 2, jungle: 1, deep_dnb: 0, techstep: 0 },
  { trance: 1, jungle: 2, deep_dnb: 1, techstep: 0 },
  { trance: 1, jungle: 1, deep_dnb: 2, techstep: 0 },
  { trance: 2, jungle: 0, deep_dnb: 2, techstep: 0 },
  { trance: 1, jungle: 1, deep_dnb: 2, techstep: 1 },
  { trance: 0, jungle: 2, deep_dnb: 2, techstep: 1 },
  { trance: 0, jungle: 2, deep_dnb: 1, techstep: 2 },
];

export class DreamIslandCourse implements RaceCourse {
  readonly kind = "dreamisland" as const;
  readonly group = new THREE.Group();
  readonly length = route.length;
  readonly halfWidth = 12;
  readonly checkpointCount = route.checkpoints.length - 1;
  readonly orderedCheckpointCount = route.checkpoints.length;
  readonly defaultLapCount = 3;
  readonly minimumLapCount = 1;
  readonly maximumLapCount = 9;
  readonly mapName = "Dream Island";
  readonly mapCode = "MAP 07";
  readonly finishName = "the Strike Line";
  readonly startLabel = "BEACH STRAIGHT";
  readonly startProgress = .002;
  readonly startLateral = 0;
  readonly recoveryHoldSeconds = 1.1;
  readonly recoverySpeedMps = 34;
  readonly recoveryImmunitySeconds = 1.2;
  readonly surfaceGripRecoverySeconds = .8;
  readonly timeOfDayStops = null;
  readonly rivalPace = rivalPace;
  readonly flightArcs = route.flightArcs;
  get scheduleLabel(): string { return this.schedule.config?.events.map(e=>`${e.id}: ${(e.tick/120).toFixed(2)}s`).join(" · ") ?? "Measuring Works lap"; }
  // A bootstrap schedule carries null ticks; the class treats that exactly as no
  // calibration, so the cast never hides a live config with the wrong shape.
  readonly schedule = new DreamIslandSchedule(typeof location!=="undefined"&&new URLSearchParams(location.search).has("calibrate")?null:calibration as unknown as ConstructorParameters<typeof DreamIslandSchedule>[0],typeof location === "undefined" ? 3868938316 : resolveAbilitySeed());
  /** Decision 6: the night still happens under `?motion=reduce` — it is gameplay
   * and it changes grip — but it arrives as a step at the strike instead of a
   * 12 s ramp, so the grip change lands on the same tick in both modes. */
  readonly reducedMotion = typeof location !== "undefined" && new URLSearchParams(location.search).get("motion") === "reduce";
  /** See `nightBlend`. Null unless BOTH `?diagnostics` and a finite `?nightBlend=`
   * in [0, 1] are present, so the pin cannot exist outside a review capture. */
  private readonly pinnedNightBlend: number | null = DreamIslandCourse.readPinnedNightBlend();
  private static readPinnedNightBlend(): number | null {
    if (typeof location === "undefined") return null;
    const query = new URLSearchParams(location.search);
    if (!query.has("diagnostics")) return null;
    const raw = query.get("nightBlend");
    if (raw === null) return null;
    const value = Number(raw);
    return Number.isFinite(value) ? THREE.MathUtils.clamp(value, 0, 1) : null;
  }
  readonly tide = { lap: 1, elapsed: 0, waterLevel: -30, draining: false, shortcutOpen: false };

  private readonly scratch = this.createProjectionScratch();
  private readonly clock = { value: 0 };
  private readonly points = route.stations.map(s => new THREE.Vector3(...s.p as [number, number, number]));
  private readonly tangents = route.stations.map(s => new THREE.Vector3(...s.t as [number, number, number]));
  private readonly lighting: CourseLightingProfile = {
    sky:new THREE.Color(),ground:new THREE.Color(),key:new THREE.Color(),rim:new THREE.Color(),
    hemisphereIntensity:0,keyIntensity:0,rimIntensity:0,keyDirection:new THREE.Vector3(),
  };
  private readonly fog: FogProfile = { color: new THREE.Color(), density: 0 };
  /** Gates, launch strips, phase-field posts and device markers, in that order,
   * as ONE emissive instanced draw. Everything on this road that is a lit marker
   * shares a material, so the blockout spends three draws in total. */
  readonly markers: THREE.InstancedMesh;
  readonly deviceMarkerOffset: number;
  private readonly turns: { from: number; to: number; radius: number; direction: "LEFT" | "RIGHT" }[] = [];

  constructor() {
    this.group.name = "dreamisland_island_circuit";
    for (let i = 1; i < route.count - 1; i++) {
      const s = route.stations[i];
      if (Math.abs(s.curvature) < .003) continue;
      const from = s.d;
      const sign = Math.sign(s.curvature);
      let peak = Math.abs(s.curvature);
      while (i < route.count - 2 && Math.sign(route.stations[i+1].curvature) === sign
        && Math.abs(route.stations[i+1].curvature) > .0025) {
        i++;
        peak = Math.max(peak, Math.abs(route.stations[i].curvature));
      }
      this.turns.push({ from, to: route.stations[i].d, radius: 1 / peak,
        direction: sign < 0 ? "RIGHT" : "LEFT" });
    }
    this.group.add(this.createStreet());
    this.deviceMarkerOffset = (route.checkpoints.length + STRIP_DISTANCES.length + DREAMISLAND_FIELDS.length) * 2;
    this.markers = this.createMarkers();
    this.group.add(this.markers);
    this.setCheckpointProgress(1);
  }

  createSampleScratch(): CourseSample {
    return { position: new THREE.Vector3(), tangent: new THREE.Vector3(0,0,-1),
      right: new THREE.Vector3(1,0,0), up: new THREE.Vector3(0,1,0),
      curvature:0, width:26, halfWidth:13, bank:0, sector:"BEACH", edgeLeft:"A", edgeRight:"A",
      apronLeft:0, apronRight:0, apronGripLeft:1, apronGripRight:1 };
  }
  createProjectionScratch(): CourseProjection {
    return { ...this.createSampleScratch(), progress:0, lateral:0 };
  }
  sample(progress: number, target = this.createSampleScratch()): CourseSample {
    const scaled = THREE.MathUtils.euclideanModulo(progress, 1) * route.count;
    const i = Math.floor(scaled), j = (i + 1) % route.count, alpha = scaled - i;
    target.position.lerpVectors(this.points[i], this.points[j], alpha);
    target.tangent.lerpVectors(this.tangents[i], this.tangents[j], alpha).normalize();
    target.right.crossVectors(target.tangent, UP).normalize();
    target.up.crossVectors(target.right, target.tangent).normalize();
    target.width = THREE.MathUtils.lerp(route.stations[i].width, route.stations[j].width, alpha);
    target.halfWidth = target.width / 2;
    target.curvature = THREE.MathUtils.clamp(route.stations[i].curvature * 70, -1, 1);
    target.sector = route.stations[i].sector;
    target.alternateRoad = false;
    const wrapped = THREE.MathUtils.euclideanModulo(progress, 1);
    target.bank = wrapped > COURT_FROM && wrapped < COURT_TO
      ? COURT_BANK * Math.sin((wrapped - COURT_FROM) / (COURT_TO - COURT_FROM) * Math.PI) : 0;
    target.right.applyAxisAngle(target.tangent, target.bank);
    target.up.crossVectors(target.right, target.tangent).normalize();
    target.edgeLeft = target.edgeRight = "A";
    target.apronLeft = target.apronRight = 0;
    target.apronGripLeft = target.apronGripRight = 1;
    return target;
  }
  rivalLateralAt(position: THREE.Vector3, progress: number): number {
    const main = this.sample(progress, this.scratch);
    return (position.x-main.position.x)*main.right.x + (position.z-main.position.z)*main.right.z;
  }
  sampleAtDistance(distance: number): CourseSample { return this.sample(distance / this.length); }
  checkpointProgress(index: number): number { return route.checkpoints[index]; }
  checkpointHalfWidth(index: number): number { return this.sample(route.checkpoints[index]).halfWidth; }

  project(
    position: THREE.Vector3,
    hintProgress: number,
    target: CourseProjection = this.createProjectionScratch(),
  ): CourseProjection {
    const segmentCount = this.points.length;
    const hintIndex = Math.round(
      THREE.MathUtils.euclideanModulo(hintProgress, 1) * segmentCount,
    );
    const localRadius = 42;
    let nearestDistanceSq = Number.POSITIVE_INFINITY;
    let nearestProgress = hintProgress;
    const globalSearchThresholdSq = (this.halfWidth + 24) ** 2;

    for (let pass = 0; pass < 2; pass += 1) {
      const globalSearch = pass === 1;
      if (globalSearch && nearestDistanceSq <= globalSearchThresholdSq) break;
      const first = globalSearch ? 0 : -localRadius;
      const last = globalSearch ? segmentCount - 1 : localRadius;
      for (let searchIndex = first; searchIndex <= last; searchIndex += 1) {
        const rawIndex = globalSearch ? searchIndex : hintIndex + searchIndex;
        const index = THREE.MathUtils.euclideanModulo(rawIndex, segmentCount);
        const nextIndex = (index + 1) % segmentCount;
        const start = this.points[index];
        const end = this.points[nextIndex];
        const segmentX = end.x - start.x;
        const segmentZ = end.z - start.z;
        const lengthSq = segmentX * segmentX + segmentZ * segmentZ;
        const along = lengthSq > 0
          ? THREE.MathUtils.clamp(
            (
              (position.x - start.x) * segmentX
              + (position.z - start.z) * segmentZ
            ) / lengthSq,
            0,
            1,
          )
          : 0;
        const nearestX = start.x + segmentX * along;
        const nearestZ = start.z + segmentZ * along;
        const distanceSq = (nearestX - position.x) ** 2
          + (nearestZ - position.z) ** 2;
        if (distanceSq >= nearestDistanceSq) continue;
        nearestDistanceSq = distanceSq;
        nearestProgress = THREE.MathUtils.euclideanModulo(
          (index + along) / segmentCount,
          1,
        );
      }
    }

    this.sample(nearestProgress, target);
    target.progress = nearestProgress;
    target.lateral = (position.x - target.position.x) * target.right.x
      + (position.y - target.position.y) * target.right.y
      + (position.z - target.position.z) * target.right.z;
    return target;
  }

  turnAhead(progress: number, maximumDistance = 240, target?: TurnCue): TurnCue | null {
    const d = THREE.MathUtils.euclideanModulo(progress, 1) * this.length;
    let nearest = maximumDistance + 1;
    let selected: typeof this.turns[number] | undefined;
    for (const turn of this.turns) {
      const ahead = d >= turn.from && d <= turn.to ? 0
        : THREE.MathUtils.euclideanModulo(turn.from - d, this.length);
      if (ahead < nearest) { selected = turn; nearest = ahead; }
    }
    if (!selected || nearest > maximumDistance) return null;
    const cue = target ?? {direction:"LEFT", followingDirection:null, distance:0, hard:false, radius:0};
    cue.direction = selected.direction;
    cue.followingDirection = null;
    cue.distance = nearest;
    cue.hard = selected.radius < 100;
    cue.radius = selected.radius;
    return cue;
  }
  private district(progress: number): number {
    const wrapped = THREE.MathUtils.euclideanModulo(progress, 1);
    for (let i = route.districts.length - 1; i > 0; i--) {
      if (wrapped >= route.districts[i].from) return i;
    }
    return 0;
  }
  /**
   * The day->night turn, normalised. The course owns this interpolation because
   * `atmosphere.ts` smooths lights at `1 - exp(-delta * 2.8)` — 95% inside about
   * a second — so returning two frozen profiles would produce a 1 s crossfade,
   * not the authored 12 s one. Returning an already-blended profile every frame
   * gives the atmosphere a curve it simply tracks.
   */
  /** Published so a capture's own evidence records whether the review pin was
   * in force, rather than the harness asserting it from the URL it typed. */
  get nightBlendPinned(): number | null { return this.pinnedNightBlend; }
  get nightBlend(): number {
    // Review-only pin. `scripts/visual/dreamisland/crossfade-profile.mjs` has to
    // photograph ONE pose at five points on the ramp, and the ramp is driven by
    // an integer clock it cannot rewind. `?nightBlend=` freezes the blend so the
    // five captures differ by the blend and nothing else. It is honoured ONLY
    // alongside `?diagnostics`, which no played race carries, and it is visual
    // only: grip still comes from `schedule.grip(sector, tick)`, so a pinned
    // blend cannot move a lap time or a gate.
    if (this.pinnedNightBlend !== null) return this.pinnedNightBlend;
    const config = this.schedule.config;
    if (!config) return 0;
    if (this.reducedMotion) return this.schedule.tick >= config.strikeTick ? 1 : 0;
    const t = THREE.MathUtils.clamp((this.schedule.tick - config.strikeTick) / config.nightRampTicks, 0, 1);
    return t * t * (3 - 2 * t);
  }
  travelModeAt(_progress: number): "surface" { return "surface"; }
  fogAt(_progress: number): FogProfile {
    const blend = this.nightBlend;
    this.fog.color.lerpColors(DAY_FOG.color, NIGHT_FOG.color, blend);
    this.fog.density = THREE.MathUtils.lerp(DAY_FOG.density, NIGHT_FOG.density, blend);
    return this.fog;
  }
  lightingAt(_progress = 0): CourseLightingProfile {
    const blend = this.nightBlend, out = this.lighting;
    out.sky.lerpColors(DAY_LIGHTING.sky, NIGHT_LIGHTING.sky, blend);
    out.ground.lerpColors(DAY_LIGHTING.ground, NIGHT_LIGHTING.ground, blend);
    out.key.lerpColors(DAY_LIGHTING.key, NIGHT_LIGHTING.key, blend);
    out.rim.lerpColors(DAY_LIGHTING.rim, NIGHT_LIGHTING.rim, blend);
    out.hemisphereIntensity = THREE.MathUtils.lerp(DAY_LIGHTING.hemisphereIntensity, NIGHT_LIGHTING.hemisphereIntensity, blend);
    out.keyIntensity = THREE.MathUtils.lerp(DAY_LIGHTING.keyIntensity, NIGHT_LIGHTING.keyIntensity, blend);
    out.rimIntensity = THREE.MathUtils.lerp(DAY_LIGHTING.rimIntensity, NIGHT_LIGHTING.rimIntensity, blend);
    out.keyDirection.lerpVectors(DAY_LIGHTING.keyDirection, NIGHT_LIGHTING.keyDirection, blend).normalize();
    return out;
  }
  edgeType(): "A" { return "A"; }
  apronAt(sample: CourseSample, lateral: number,
    target: ApronResolution = createApronResolution()): ApronResolution {
    return resolveApron(APRON, "A", sample.sector, sample.halfWidth, lateral, target);
  }
  surfaceGripAt(progress: number, _lateral = 0): number {
    return this.schedule.grip(this.sample(progress, this.scratch).sector, this.schedule.tick, this.tide.lap);
  }
  cableTripSideAt(): 0 { return 0; }
  rivalHazardLaneAt(): null { return null; }
  cablePassLateralMeters(): number { return Number.NaN; }
  boostPadLaneAt(): null { return null; }
  isOnBoostPad(): boolean { return false; }
  sectorLabelAt(progress: number): string { return route.districts[this.district(progress)].name; }
  musicAt(progress: number): MusicProfile { return MUSIC[this.district(progress) % MUSIC.length]; }
  audioZoneAt(progress: number): AudioZone {
    const wrapped = THREE.MathUtils.euclideanModulo(progress, 1);
    return wrapped >= BORE_FROM && wrapped <= BORE_TO ? "underpass" : "open";
  }
  updateAtmosphere(elapsed: number, reducedMotion: boolean): boolean {
    const time = reducedMotion ? 0 : Math.floor(elapsed * 30) / 30;
    if (time === this.clock.value) return false;
    this.clock.value = time;
    return true;
  }
  vehicleHoverHeight(_speed: number, boost: boolean): number { return boost ? 1.2 : .96; }
  setLapBoard(lap: number): void { this.tide.lap = lap; }
  advanceSchedule(ticks: number): void {
    this.schedule.advanceTicks(ticks, this.tide.lap);
    this.tide.elapsed = this.schedule.tick / 120;
  }
  resetSchedule(): void { this.schedule.reset(); this.tide.lap = 1; this.tide.elapsed = 0; }
  recoveryProgressFor(_progress: number, previousCheckpoint: number): number {
    return (route.checkpoints[previousCheckpoint] + .005) % 1;
  }
  rivalGridStart(): null { return null; }
  setCheckpointProgress(next: number): void {
    for (let i = 0; i < route.checkpoints.length; i++) {
      const color = new THREE.Color(i === next ? 0xffc983 : (next === 0 || i < next) ? 0x71afa0 : 0x354954);
      for (let part = 0; part < 2; part++) this.markers.setColorAt(i * 2 + part, color);
    }
    if (this.markers.instanceColor) this.markers.instanceColor.needsUpdate = true;
  }

  /**
   * Road ribbon and kerbs in ONE mesh. Draw calls are the binding budget on this
   * project, so the kerbs are merged into the road's own buffers with their own
   * flat vertex colour rather than left as a second instanced draw.
   *
   * Phase B re-skins both onto the painted concrete atlas: the deck samples the
   * road-sand quadrant and the kerbs sample the cyan-kerb quadrant, from ONE
   * texture and one draw. That is why the ribbon is authored per quad rather
   * than as a shared strip - an atlas quadrant has nowhere to wrap to, so the
   * repeat has to live in the UVs, and a repeat in the UVs needs the vertex at
   * the wrap to exist twice. `dreamisland-painted-environment.ts` supplies the
   * map; without it the material is exactly the phase-A vertex-coloured Lambert.
   */
  private createStreet(): THREE.Mesh {
    const positions:number[] = [], colors:number[] = [], uvs:number[] = [], indices:number[] = [];
    const push = (point: THREE.Vector3, color: THREE.Color, cell: readonly number[], s: number, t: number) => {
      positions.push(point.x, point.y, point.z);
      colors.push(color.r, color.g, color.b);
      uvs.push(cell[0] + cell[2] * s, cell[1] + cell[3] * t);
    };
    const edge = new THREE.Vector3();
    for (let i = 0; i < route.count; i++) {
      const color = DISTRICT_COLORS[this.district(i / route.count)];
      const base = positions.length / 3;
      // DECK_STATIONS stations of road share one road-sand tile, so a 26 m wide
      // deck carries a roughly square piece of surface rather than a smear.
      for (const step of [0, 1]) {
        const sample = this.sample((i + step) / route.count);
        const v = ((i % DECK_STATIONS) + step) / DECK_STATIONS;
        for (const side of [-1, 1]) {
          push(edge.copy(sample.position).addScaledVector(sample.right, sample.halfWidth * side),
            color, CELL.roadSand, (side + 1) / 2, v);
        }
      }
      indices.push(base, base+1, base+3, base, base+3, base+2);
    }
    const kerb = new THREE.Color(0xd8d2c0), corner = new THREE.Vector3();
    for (let distance = 0; distance < this.length; distance += 7) {
      const sample = this.sampleAtDistance(distance);
      for (const side of [-1,1]) {
        // Each face carries its own four corners: the cyan stripe has to run
        // along the kerb on every face, which shared corners cannot express.
        for (const face of BOX_FACES) {
          const base = positions.length / 3;
          for (const [index, vertex] of face.entries()) {
            const [lateral, rise, along] = KERB_CORNERS[vertex];
            corner.copy(sample.position)
              .addScaledVector(sample.right, (sample.halfWidth + .4) * side + lateral)
              .addScaledVector(sample.up, .13 + rise)
              .addScaledVector(sample.tangent, along);
            push(corner, kerb, CELL.kerbCyan, KERB_FACE_UV[index][0], KERB_FACE_UV[index][1]);
          }
          indices.push(base, base+1, base+2, base, base+2, base+3);
        }
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position",new THREE.Float32BufferAttribute(positions,3));
    geometry.setAttribute("color",new THREE.Float32BufferAttribute(colors,3));
    geometry.setAttribute("uv",new THREE.Float32BufferAttribute(uvs,2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true }));
    mesh.name = "dreamisland_blockout_road";
    return mesh;
  }

  /** Phase B hands the course its painted atlases. The road and the markers keep
   * their phase-A geometry and draw counts and gain a map; called once, from
   * `dreamisland-painted-environment.ts`, after the textures have loaded. */
  applyPaintedAtlases(concrete: THREE.Texture, metal: THREE.Texture): number {
    let skinned = 0;
    for (const [object, texture] of [[this.group.getObjectByName("dreamisland_blockout_road"), concrete],
      [this.markers, metal]] as const) {
      const material = (object as THREE.Mesh | undefined)?.material as THREE.MeshLambertMaterial | undefined;
      if (!material) continue;
      material.map = texture;
      material.needsUpdate = true;
      skinned += 1;
    }
    return skinned;
  }

  /**
   * Ordered gates, the two launch strips, the watchtower phase-field posts and
   * the five device markers. One box geometry, one emissive material multiplied
   * by the per-instance colour, one draw.
   */
  private createMarkers(): THREE.InstancedMesh {
    const fields = DREAMISLAND_FIELDS, pickups = DREAMISLAND_ABILITY_CONFIG.pickups;
    const count = (route.checkpoints.length + STRIP_DISTANCES.length + fields.length) * 2 + pickups.length;
    // The marker box's own UVs are 0..1 per face; squeezing them into the metal
    // rail quadrant is what lets phase B re-skin all of them with one map.
    const box = new THREE.BoxGeometry(1,1,1), boxUv = box.attributes.uv;
    for (let i = 0; i < boxUv.count; i++) {
      boxUv.setXY(i, CELL.rail[0] + CELL.rail[2] * boxUv.getX(i), CELL.rail[1] + CELL.rail[3] * boxUv.getY(i));
    }
    const mesh = new THREE.InstancedMesh(box,
      new THREE.MeshLambertMaterial({color:0xffffff,emissive:0xffffff,emissiveIntensity:.12}), count);
    (mesh.material as THREE.MeshLambertMaterial).onBeforeCompile=shader=>{shader.fragmentShader=shader.fragmentShader.replace('#include <emissivemap_fragment>','#include <emissivemap_fragment>\n#ifdef USE_COLOR\ntotalEmissiveRadiance*=vColor.rgb;\n#endif');};
    const transform=new THREE.Object3D(),basis=new THREE.Matrix4();
    const place=(sample:CourseSample,index:number,lateral:number,rise:number,scale:[number,number,number],color?:THREE.Color)=>{
      basis.makeBasis(sample.right,sample.up,sample.tangent.clone().negate());
      transform.position.copy(sample.position).addScaledVector(sample.up,rise).addScaledVector(sample.right,lateral);
      transform.scale.set(...scale);
      transform.quaternion.setFromRotationMatrix(basis);transform.updateMatrix();
      mesh.setMatrixAt(index,transform.matrix);
      if(color)mesh.setColorAt(index,color);
    };
    route.checkpoints.forEach((progress,i)=>{
      const s=this.sample(progress);
      for(let j=0;j<2;j++)place(s,i*2+j,(j===0?-1:1)*(s.halfWidth+1.8),2.25,[.32,4.5,.4]);
    });
    let cursor=route.checkpoints.length*2;
    const stripColor=new THREE.Color(0xffc46b);
    STRIP_DISTANCES.forEach(distance=>{
      const s=this.sampleAtDistance(distance);
      for(let j=0;j<2;j++)place(s,cursor++,(j===0?-1:1)*(s.halfWidth-1.4),.06,[.5,.06,6.8],stripColor);
    });
    // The bulkhead reads as two posts standing on the field's own bounds: a
    // translucent pane would be a fourth draw and a softer read at speed.
    const fieldColor=new THREE.Color(0x6fe4ff);
    for(const field of fields){
      const s=this.sample(field.progress);
      for(let j=0;j<2;j++)place(s,cursor++,field.lateral+(j===0?-1:1)*field.halfWidth,2.4,[.34,4.8,.34],fieldColor);
    }
    for(const pickup of pickups){
      const s=this.sample(pickup.progress);
      place(s,cursor++,pickup.lateral,2.2,[1.6,1.6,1.6],DEVICE_COLORS[pickup.kind]);
    }
    mesh.name="dreamisland_blockout_markers";
    return mesh;
  }
}
