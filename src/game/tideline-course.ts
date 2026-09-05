import * as THREE from "three";
import { tideRoadMaterial } from "./tideline-materials";
import { tideForLap, tideWaterLevel, tideGrip } from "./tideline-tide.js";
import route from "./data/tideline/route.json";
import rivalPace from "./data/tideline/rival-pace.json";
import { createApronResolution, resolveApron } from "./apron.js";
import { TIDELINE_FIELDS, tidelineFieldAt } from "./tideline-rules.js";
import type { ApronResolution, ApronTable } from "./apron.js";
import type { AudioZone } from "./audio-space.js";
import type { CourseSample, CourseProjection, CourseLightingProfile, FogProfile,
  RaceCourse, TurnCue, MusicProfile } from "./course";

const UP = new THREE.Vector3(0, 1, 0);
// The city kerb is the boundary: there is no drivable apron through shopfronts.
const APRON: ApronTable = {
  deckMarginMetres: 2.05,
  gripFloor: .5,
  edges: {
    A: { label: "City kerb", widthMetres: 0, grip: 1, wall: true,
      wallSpeedMultiplier: .76, wallImpactStrength: .5,
      wallScrubMetresPerSecondSquared: 24, surface: "asphalt" },
  },
  overrides: [],
};
const DISTRICT_COLORS = route.districts.map(d => new THREE.Color(d.color));
const FLOODED_LIGHTING: CourseLightingProfile = {
  sky:new THREE.Color(0x237f88),ground:new THREE.Color(0x05191c),
  key:new THREE.Color(0x60cbd2),rim:new THREE.Color(0x228287),
  hemisphereIntensity:.42,keyIntensity:.48,rimIntensity:.22,
  keyDirection:new THREE.Vector3(.68,.35,-.55).normalize(),
};
const DRAINED_LIGHTING: CourseLightingProfile = {
  sky:new THREE.Color(0x8c7758),ground:new THREE.Color(0x171007),
  key:new THREE.Color(0xf1b765),rim:new THREE.Color(0x707b82),
  hemisphereIntensity:.50,keyIntensity:1.1,rimIntensity:.3,
  keyDirection:FLOODED_LIGHTING.keyDirection,
};
const FLOODED_FOG={color:new THREE.Color(0x1b3537),density:.0032};
const DRAINED_FOG={color:new THREE.Color(0x4c3825),density:.0035};
const PORT_FOG={color:new THREE.Color(0x242f33),density:.0018};
export type TidelineTravelMode = "submerged" | "surface" | "air";
const MUSIC: MusicProfile[] = [
  { trance: 1, jungle: 0, deep_dnb: 2, techstep: 0 },
  { trance: 2, jungle: 1, deep_dnb: 1, techstep: 0 },
  { trance: 0, jungle: 2, deep_dnb: 2, techstep: 1 },
  { trance: 0, jungle: 1, deep_dnb: 1, techstep: 2 },
  { trance: 1, jungle: 1, deep_dnb: 2, techstep: 1 },
  { trance: 2, jungle: 0, deep_dnb: 1, techstep: 1 },
];

export class TidelineCourse implements RaceCourse {
  readonly kind = "tideline" as const;
  readonly group = new THREE.Group();
  readonly length = route.length;
  readonly halfWidth = 12;
  readonly checkpointCount = route.checkpoints.length - 1;
  readonly orderedCheckpointCount = route.checkpoints.length;
  readonly defaultLapCount = 3;
  readonly minimumLapCount = 1;
  readonly maximumLapCount = 9;
  readonly mapName = "Tideline";
  readonly mapCode = "MAP 05";
  readonly finishName = "the Pelagic Reactor";
  readonly startLabel = "DROWNED REACTOR";
  readonly startProgress = .002;
  readonly startLateral = 0;
  readonly recoveryHoldSeconds = 1.1;
  readonly recoverySpeedMps = 34;
  readonly recoveryImmunitySeconds = 1.2;
  readonly surfaceGripRecoverySeconds = .8;
  readonly timeOfDayStops = null;
  readonly rivalPace = rivalPace;
  readonly flightArcs = route.flightArcs;
  readonly shortcut = route.shortcut;
  readonly tide = { lap: 1, elapsed: 0, waterLevel: 0, draining: false, shortcutOpen: false };

  private readonly waterUniform = { value: 0 };
  private readonly effectsTexture = typeof Image === "undefined" ? null : new THREE.TextureLoader().load("/assets/tideline-v3/waterlight.jpg");
  private readonly branchScratch = this.createProjectionScratch();
  private readonly branchPoints = route.shortcut.stations.map(s => new THREE.Vector3(...s.p as [number, number, number]));
  private readonly branchTangents = route.shortcut.stations.map(s => new THREE.Vector3(...s.t as [number, number, number]));
  private readonly roadTexture = typeof Image === "undefined" ? null : new THREE.TextureLoader().load("/assets/tideline-foundry/textures/concrete.jpg");
  private readonly clock = { value: 0 };
  private readonly points = route.stations.map(s => new THREE.Vector3(...s.p as [number, number, number]));
  private readonly tangents = route.stations.map(s => new THREE.Vector3(...s.t as [number, number, number]));
  private readonly gates: THREE.InstancedMesh;
  private readonly turns: { from: number; to: number; radius: number; direction: "LEFT" | "RIGHT" }[] = [];

  constructor() {
    this.group.name = "tideline_street_circuit";
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
    if (this.effectsTexture) this.effectsTexture.colorSpace=THREE.SRGBColorSpace;
    if (this.roadTexture) { this.roadTexture.colorSpace = THREE.SRGBColorSpace; this.roadTexture.anisotropy = 4; }
    this.group.add(this.createStreet(), this.createFurniture());
    const branch = this.createBranchRoad(); this.group.add(branch);
    this.gates = this.createGates();
    this.group.add(this.gates);
    this.setCheckpointProgress(1);
  }

  createSampleScratch(): CourseSample {
    return { position: new THREE.Vector3(), tangent: new THREE.Vector3(0,0,-1),
      right: new THREE.Vector3(1,0,0), up: new THREE.Vector3(0,1,0),
      curvature:0, width:24, halfWidth:12, bank:0, sector:"REACTOR", edgeLeft:"A", edgeRight:"A",
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
    target.bank = 0;
    target.edgeLeft = target.edgeRight = "A";
    target.apronLeft = target.apronRight = 0;
    target.apronGripLeft = target.apronGripRight = 1;
    return target;
  }
  demoSample(progress: number, target = this.createSampleScratch()): CourseSample {
    const cut=route.shortcut;
    return this.tide.shortcutOpen && progress>=cut.from && progress<=cut.to
      ? this.sampleShortcut(progress,target) : this.sample(progress,target);
  }
  rivalLateralAt(position: THREE.Vector3, progress: number): number {
    const main = this.sample(progress, this.branchScratch);
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
    // The cut is physical geometry, mapped monotonically onto the same ordered
    // gate interval. Closed laps never project onto it; the main road stays valid.
    const cut = route.shortcut;
    if (this.tide.shortcutOpen && hintProgress >= cut.from - .015 && hintProgress <= cut.to + .015) {
      let best = nearestDistanceSq;
      for (let i = 0; i < this.branchPoints.length - 1; i++) {
        const a = this.branchPoints[i], b = this.branchPoints[i + 1];
        const dx = b.x - a.x, dz = b.z - a.z;
        const alpha = THREE.MathUtils.clamp(((position.x-a.x)*dx+(position.z-a.z)*dz)/(dx*dx+dz*dz),0,1);
        const distance = (position.x-a.x-dx*alpha)**2+(position.z-a.z-dz*alpha)**2;
        if (distance >= best || distance > (cut.width / 2 + 5)**2) continue;
        // At overlapping mouths, keep the wider road if only it contains the
        // whole craft. A nearer, narrower center line must not create a wall.
        if (distance > (cut.width/2-APRON.deckMarginMetres)**2
          && nearestDistanceSq <= (this.halfWidth-APRON.deckMarginMetres)**2) continue;
        const progress = cut.from + (cut.to-cut.from)*(i+alpha)/(this.branchPoints.length-1);
        if (Math.abs(progress-hintProgress)*this.length > 70) continue;
        best = distance;
        this.sampleShortcut(progress, this.branchScratch);
        Object.assign(target, {progress, width:cut.width, halfWidth:cut.width/2, sector:"PUMP_HALL_CUT", alternateRoad:true});
        target.position.copy(this.branchScratch.position); target.tangent.copy(this.branchScratch.tangent);
        target.right.copy(this.branchScratch.right); target.up.copy(this.branchScratch.up);
        target.lateral = (position.x-target.position.x)*target.right.x+(position.y-target.position.y)*target.right.y+(position.z-target.position.z)*target.right.z;
      }
    }
    return target;
  }

  sampleShortcut(progress: number, target = this.createSampleScratch()): CourseSample {
    const cut=route.shortcut;
    const scaled=THREE.MathUtils.clamp((progress-cut.from)/(cut.to-cut.from),0,1)*(this.branchPoints.length-1);
    const i=Math.min(this.branchPoints.length-2,Math.floor(scaled)), alpha=scaled-i;
    target.position.lerpVectors(this.branchPoints[i],this.branchPoints[i+1],alpha);
    target.tangent.lerpVectors(this.branchTangents[i],this.branchTangents[i+1],alpha).normalize();
    target.right.crossVectors(target.tangent,UP).normalize();target.up.crossVectors(target.right,target.tangent).normalize();
    target.width=cut.width;target.halfWidth=cut.width/2;target.sector="PUMP_HALL_CUT"; target.alternateRoad=true;
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
  travelModeAt(progress: number): TidelineTravelMode {
    const wrapped = THREE.MathUtils.euclideanModulo(progress, 1);
    const index = Math.floor(wrapped * route.count);
    return route.stations[index].p[1] + 1 < this.tide.waterLevel ? "submerged" : "surface";
  }
  fogAt(progress: number): FogProfile {
    if (this.travelModeAt(progress)==="submerged") return FLOODED_FOG;
    return this.tide.lap>=2 && this.sample(progress,this.branchScratch).position.y<-3 ? DRAINED_FOG : PORT_FOG;
  }
  lightingAt(_progress=0): CourseLightingProfile { return this.tide.lap===1 ? FLOODED_LIGHTING : DRAINED_LIGHTING; }
  edgeType(): "A" { return "A"; }
  apronAt(sample: CourseSample, lateral: number,
    target: ApronResolution = createApronResolution()): ApronResolution {
    return resolveApron(APRON, "A", sample.sector, sample.halfWidth, lateral, target);
  }
  surfaceGripAt(progress: number, lateral = 0): number {
    return tideGrip(this.tide.lap, this.points[Math.floor(THREE.MathUtils.euclideanModulo(progress, 1) * route.count)].y, lateral, this.tide.waterLevel);
  }
  cableTripSideAt(progress: number, lateral: number): -1 | 0 | 1 {
    const field = tidelineFieldAt(progress, lateral, this.length);
    return field ? (lateral < field.lateral ? -1 : 1) : 0;
  }
  rivalHazardLaneAt(distance: number, lateral: number): number | null {
    for (const field of TIDELINE_FIELDS) {
      const ahead = THREE.MathUtils.euclideanModulo(
        field.progress * this.length - distance + this.length / 2, this.length,
      ) - this.length / 2;
      // Approach early at the fleet's normal lateral speed, then keep the
      // complete hull clear until it has passed the visible bulkhead.
      if (ahead > 360 || ahead < -20) continue;
      const side = field.lateral === 0 ? (lateral < 0 ? -1 : 1)
        : field.lateral < 0 ? 1 : -1;
      return field.lateral + side * (field.halfWidth + 2.3);
    }
    return null;
  }
  cablePassLateralMeters(): number { return Number.NaN; }
  boostPadLaneAt(): null { return null; }
  isOnBoostPad(): boolean { return false; }
  sectorLabelAt(progress: number): string { return route.districts[this.district(progress)].name; }
  musicAt(progress: number): MusicProfile { return MUSIC[this.district(progress)]; }
  audioZoneAt(progress: number): AudioZone {
    return this.travelModeAt(progress) === "submerged" ? "underpass" : "open";
  }
  updateAtmosphere(elapsed: number, reducedMotion: boolean): boolean {
    const time = reducedMotion ? 0 : Math.floor(elapsed * 30) / 30;
    if (time === this.clock.value) return false;
    this.clock.value = time;
    return true;
  }
  vehicleHoverHeight(_speed: number, boost: boolean): number { return boost ? 1.2 : .96; }
  setLapBoard(lap: number): void {
    if (lap === this.tide.lap) return;
    this.tide.lap = lap; this.tide.elapsed = 0;
    this.tide.shortcutOpen = false;
    this.advanceTide(0);
  }
  advanceTide(delta: number): void {
    // The shared ability clock is 120 Hz; keep exact ticks across render rates.
    this.tide.elapsed = Math.round((this.tide.elapsed + delta) * 120) / 120;
    this.tide.waterLevel = tideWaterLevel(this.tide.lap, this.tide.elapsed);
    this.waterUniform.value = this.tide.waterLevel;
    this.tide.draining = this.tide.lap > 1 && this.tide.lap <= 3 && this.tide.elapsed < 5;
    this.tide.shortcutOpen = tideForLap(this.tide.lap).shortcut;
  }
  recoveryProgressFor(_progress: number, previousCheckpoint: number): number {
    return (route.checkpoints[previousCheckpoint] + .005) % 1;
  }
  rivalGridStart(): null { return null; }
  setCheckpointProgress(next: number): void {
    for (let i = 0; i < route.checkpoints.length; i++) {
      const color = new THREE.Color(i === next ? 0xffc983 : (next === 0 || i < next) ? 0x71afa0 : 0x354954);
      for (let part = 0; part < 2; part++) this.gates.setColorAt(i * 2 + part, color);
    }
    if (this.gates.instanceColor) this.gates.instanceColor.needsUpdate = true;
  }

  private createStreet(): THREE.Mesh {
    const positions:number[] = [], colors:number[] = [], uvs:number[] = [], indices:number[] = [];
    for (let i = 0; i <= route.count; i++) {
      const sample = this.sample(i / route.count);
      const color = DISTRICT_COLORS[this.district(i / route.count)];
      for (const side of [-1,1]) {
        const p = sample.position.clone().addScaledVector(sample.right, sample.halfWidth * side);
        positions.push(p.x, p.y, p.z);
        colors.push(color.r, color.g, color.b);
        uvs.push((side+1)/2, i / route.count * this.length);
      }
      if (i < route.count) {
        const k=i*2; indices.push(k,k+1,k+3,k,k+3,k+2);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position",new THREE.Float32BufferAttribute(positions,3));
    geometry.setAttribute("color",new THREE.Float32BufferAttribute(colors,3));
    geometry.setAttribute("uv",new THREE.Float32BufferAttribute(uvs,2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const material=tideRoadMaterial(this.roadTexture,{time:this.clock,water:this.waterUniform,effects:this.effectsTexture},
      route.checkpoints.map(p=>p*this.length),[.035,.325,.645].map(p=>p*this.length));
    const mesh=new THREE.Mesh(geometry,material); mesh.name="tideline_rain_polished_asphalt";
    return mesh;
  }

  private createFurniture(): THREE.Group {
    const group = new THREE.Group();
    const distances: number[] = [];
    for (let distance = 0; distance < this.length; distance += 7) {
      if (this.travelModeAt(distance / this.length) !== "air") distances.push(distance);
    }
    const kerbs = new THREE.InstancedMesh(new THREE.BoxGeometry(.65, .45, 6.8),
      new THREE.MeshLambertMaterial({ color: 0x6a8185 }), distances.length * 2);
    const lamps = new THREE.InstancedMesh(new THREE.BoxGeometry(.18, .07, 1.3),
      new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), distances.length * 2);
    const transform = new THREE.Object3D(), basis = new THREE.Matrix4();
    const cyan = new THREE.Color(0xcda25f), amber = new THREE.Color(0xe8bc78);
    for (let i = 0; i < distances.length; i++) {
      const sample = this.sampleAtDistance(distances[i]);
      basis.makeBasis(sample.right, sample.up, sample.tangent.clone().negate());
      for (let sideIndex = 0; sideIndex < 2; sideIndex++) {
        const side = sideIndex ? 1 : -1;
        const progress = distances[i] / this.length;
        const branchMouth = side === 1 && (progress > .035 && progress < .105 || progress > .215 && progress < .29);
        transform.scale.setScalar(branchMouth ? 0 : 1);
        transform.position.copy(sample.position).addScaledVector(sample.right, (sample.halfWidth + .4) * side)
          .addScaledVector(sample.up, .13);
        transform.quaternion.setFromRotationMatrix(basis); transform.updateMatrix();
        kerbs.setMatrixAt(i * 2 + sideIndex, transform.matrix);
        transform.position.addScaledVector(sample.up, .26); transform.updateMatrix();
        lamps.setMatrixAt(i * 2 + sideIndex, transform.matrix);
        lamps.setColorAt(i * 2 + sideIndex, sample.position.y < -2 ? cyan : amber);
      }
    }
    kerbs.name = "tideline_solid_road_kerbs";
    group.add(kerbs, lamps);
    return group;
  }

  private createBranchRoad(): THREE.Mesh {
    const vertices: number[]=[], uvs: number[]=[], indices: number[]=[];
    const cut=route.shortcut;
    for (let i=0;i<cut.stations.length;i++) {
      const sample=this.sampleShortcut(cut.stations[i].progress);
      for (const side of [-1,1]) {
        vertices.push(...sample.position.clone().addScaledVector(sample.right,side*cut.width/2));
        uvs.push((side+1)/2, cut.stations[i].progress*this.length);
      }
      if(i<cut.stations.length-1){const k=i*2;indices.push(k,k+1,k+3,k,k+3,k+2);}
    }
    const geometry=new THREE.BufferGeometry();geometry.setAttribute("position",new THREE.Float32BufferAttribute(vertices,3));
    geometry.setAttribute("uv",new THREE.Float32BufferAttribute(uvs,2));geometry.setIndex(indices);geometry.computeVertexNormals();
    const mesh=new THREE.Mesh(geometry,tideRoadMaterial(this.roadTexture,{time:this.clock,water:this.waterUniform,effects:this.effectsTexture},route.checkpoints.map(p=>p*this.length),[.035,.325,.645].map(p=>p*this.length)));
    mesh.name="tideline_pump_hall_shortcut_road";return mesh;
  }
  private createGates(): THREE.InstancedMesh {
    const mesh=new THREE.InstancedMesh(new THREE.BoxGeometry(1,1,1),
      new THREE.MeshBasicMaterial({color:0xffffff,toneMapped:false}),route.checkpoints.length*2);
    const transform=new THREE.Object3D(),basis=new THREE.Matrix4();
    route.checkpoints.forEach((progress,i)=>{
      const s=this.sample(progress); basis.makeBasis(s.right,s.up,s.tangent.clone().negate());
      for(let j=0;j<2;j++) {
        transform.position.copy(s.position).addScaledVector(s.up,2.25);
        transform.position.addScaledVector(s.right,(j===0?-1:1)*(s.halfWidth+1.8));
        transform.scale.set(.32,4.5,.4);
        transform.quaternion.setFromRotationMatrix(basis);transform.updateMatrix();mesh.setMatrixAt(i*2+j,transform.matrix);
      }
    });
    return mesh;
  }
}
