import * as THREE from "three";
import route from "./data/polarity/route.json";
import rivalPace from "./data/polarity/rival-pace.json";
import { createApronResolution, resolveApron } from "./apron.js";
import { transferWindowAt, TRANSFER_WINDOWS } from "./polarity-rules.js";
import type { ApronResolution, ApronTable } from "./apron.js";
import type { AudioZone } from "./audio-space.js";
import type { CourseSample, CourseProjection, CourseLightingProfile, FogProfile,
  RaceCourse, TurnCue, MusicProfile } from "./course";

const UP = new THREE.Vector3(0, 1, 0);
export const POLARITY_BARRIERS = [
  { progress: .22, lane: 0, lateral: 0, halfWidth: 4.5 },
  { progress: .60, lane: 0, lateral: -2, halfWidth: 4 },
  { progress: .77, lane: 0, lateral: 2, halfWidth: 4 },
  { progress: .43, lane: 1, lateral: -3.8, halfWidth: 2.6 },
  { progress: .83, lane: 1, lateral: 3.8, halfWidth: 2.6 },
] as const;
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
const LIGHTING: CourseLightingProfile = {
  sky: new THREE.Color(0x7298ba), ground: new THREE.Color(0x293148),
  key: new THREE.Color(0x93aacc), rim: new THREE.Color(0x8cbabf),
  hemisphereIntensity: 1.05, keyIntensity: .75, rimIntensity: 1.25,
  keyDirection: new THREE.Vector3(.35, .8, -.48).normalize(),
};
const FOG: FogProfile = { color: new THREE.Color(0x263548), density: .0022 };
const MUSIC: MusicProfile[] = [
  { trance: 1, jungle: 0, deep_dnb: 2, techstep: 0 },
  { trance: 2, jungle: 1, deep_dnb: 1, techstep: 0 },
  { trance: 0, jungle: 2, deep_dnb: 2, techstep: 1 },
  { trance: 0, jungle: 1, deep_dnb: 1, techstep: 2 },
  { trance: 1, jungle: 1, deep_dnb: 2, techstep: 1 },
  { trance: 2, jungle: 0, deep_dnb: 1, techstep: 1 },
];

export class PolarityCourse implements RaceCourse {
  readonly kind = "polarity" as const;
  readonly group = new THREE.Group();
  readonly length = route.length;
  readonly halfWidth = 12;
  readonly checkpointCount = route.checkpoints.length - 1;
  readonly orderedCheckpointCount = route.checkpoints.length;
  readonly defaultLapCount = 3;
  readonly minimumLapCount = 1;
  readonly maximumLapCount = 9;
  readonly mapName = "Polarity";
  readonly mapCode = "MAP 04";
  readonly finishName = "Vector Exchange";
  readonly startLabel = "VECTOR EXCHANGE";
  readonly startProgress = .002;
  readonly startLateral = 0;
  readonly recoveryHoldSeconds = 1.1;
  readonly recoverySpeedMps = 34;
  readonly recoveryImmunitySeconds = 1.2;
  readonly surfaceGripRecoverySeconds = .8;
  readonly timeOfDayStops = null;
  readonly rivalPace = rivalPace;
  private readonly floorPoints = route.stations.map(s => new THREE.Vector3(...s.p as [number, number, number]));
  private readonly floorTangents = route.stations.map(s => new THREE.Vector3(...s.t as [number, number, number]));
  readonly ceilingHeight = route.ceilingHeight;
  readonly shortcuts = route.shortcuts;
  readonly rivalCourse: PolarityCourse | null;
  lane: 0 | 1 = 0;
  private readonly upperPoints = route.upper.map(s => new THREE.Vector3(...s.p as [number, number, number]));
  private readonly upperTangents = route.upper.map(s => new THREE.Vector3(...s.t as [number, number, number]));
  private readonly gates: THREE.InstancedMesh[] = [];
  private readonly laneTurns: { from: number; to: number; radius: number; direction: "LEFT" | "RIGHT" }[][] = [[], []];
  private get stations() { return this.lane ? route.upper : route.stations; }
  private get points() { return this.lane ? this.upperPoints : this.floorPoints; }
  private get tangents() { return this.lane ? this.upperTangents : this.floorTangents; }
  private get turns() { return this.laneTurns[this.lane]; }

  constructor(buildScene = true) {
    this.group.name = "polarity_street_circuit";
    for (const lane of [0, 1] as const) {
    this.lane = lane;
    for (let i = 1; i < route.count - 1; i++) {
      const s = this.stations[i];
      if (Math.abs(s.curvature) < .003) continue;
      const from = s.d;
      const sign = Math.sign(s.curvature);
      let peak = Math.abs(s.curvature);
      while (i < route.count - 2 && Math.sign(this.stations[i+1].curvature) === sign
        && Math.abs(this.stations[i+1].curvature) > .0025) {
        i++;
        peak = Math.max(peak, Math.abs(this.stations[i].curvature));
      }
      this.turns.push({ from, to: this.stations[i].d, radius: 1 / peak,
        direction: sign < 0 ? "RIGHT" : "LEFT" });
    }
    if (buildScene) {
      this.group.add(this.createStreet(), this.createFurniture());
      const gate = this.createGates();
      this.gates.push(gate);
      this.group.add(gate);
    }
    }
    this.lane = 0;
    this.rivalCourse = buildScene ? new PolarityCourse(false) : null;
    this.setCheckpointProgress(1);
  }

  createSampleScratch(): CourseSample {
    return { position: new THREE.Vector3(), tangent: new THREE.Vector3(0,0,-1),
      right: new THREE.Vector3(1,0,0), up: new THREE.Vector3(0,1,0),
      curvature:0, width:26, halfWidth:13, bank:0, sector:"MOTEL", edgeLeft:"A", edgeRight:"A",
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
    if (this.lane) { target.right.negate(); target.up.negate(); }
    target.width = THREE.MathUtils.lerp(this.stations[i].width, this.stations[j].width, alpha);
    target.halfWidth = target.width / 2;
    target.curvature = THREE.MathUtils.clamp(this.stations[i].curvature * 70 * (this.lane ? -1 : 1), -1, 1);
    target.sector = this.stations[i].sector;
    target.bank = 0;
    target.edgeLeft = target.edgeRight = "A";
    target.apronLeft = target.apronRight = 0;
    target.apronGripLeft = target.apronGripRight = 1;
    return target;
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
        const segmentY = end.y - start.y;
        const segmentZ = end.z - start.z;
        const lengthSq = segmentX * segmentX + segmentY * segmentY + segmentZ * segmentZ;
        const along = lengthSq > 0
          ? THREE.MathUtils.clamp(
            (
              (position.x - start.x) * segmentX
              + (position.y - start.y) * segmentY
              + (position.z - start.z) * segmentZ
            ) / lengthSq,
            0,
            1,
          )
          : 0;
        const nearestX = start.x + segmentX * along;
        const nearestY = start.y + segmentY * along;
        const nearestZ = start.z + segmentZ * along;
        const distanceSq = (nearestX - position.x) ** 2
          + (nearestY - position.y) ** 2
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
    cue.direction = this.lane ? selected.direction === "LEFT" ? "RIGHT" : "LEFT" : selected.direction;
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
  fogAt(): FogProfile { return FOG; }
  lightingAt(): CourseLightingProfile { return LIGHTING; }
  edgeType(): "A" { return "A"; }
  apronAt(sample: CourseSample, lateral: number,
    target: ApronResolution = createApronResolution()): ApronResolution {
    return resolveApron(APRON, "A", sample.sector, sample.halfWidth, lateral, target);
  }
  surfaceGripAt(): number { return 1; }
  cableTripSideAt(progress: number, lateral: number): -1 | 0 | 1 {
    for (const barrier of POLARITY_BARRIERS) {
      const gap = Math.abs(THREE.MathUtils.euclideanModulo(progress - barrier.progress + .5, 1) - .5) * this.length;
      if (barrier.lane === this.lane && gap < 2.5 && Math.abs(lateral - barrier.lateral) < barrier.halfWidth) {
        return lateral < barrier.lateral ? -1 : 1;
      }
    }
    return 0;
  }
  rivalHazardLaneAt(distance: number, lateral: number): number | null {
    for (const barrier of POLARITY_BARRIERS) {
      if (barrier.lane !== this.lane) continue;
      const ahead = THREE.MathUtils.euclideanModulo(
        barrier.progress * this.length - distance + this.length / 2, this.length,
      ) - this.length / 2;
      // The fleet needs several seconds to traverse a lane at its normal
      // lateral speed, and holds the safe line until the full hull is clear.
      if (ahead > 360 || ahead < -20) continue;
      const side = barrier.lateral === 0 ? (lateral < 0 ? -1 : 1)
        : barrier.lateral < 0 ? 1 : -1;
      return barrier.lateral + side * (barrier.halfWidth + 2.3);
    }
    return null;
  }
  cablePassLateralMeters(): number { return Number.NaN; }
  boostPadLaneAt(): null { return null; }
  isOnBoostPad(): boolean { return false; }
  sectorLabelAt(progress: number): string { return route.districts[this.district(progress)].name; }
  musicAt(progress: number): MusicProfile { return MUSIC[this.district(progress)]; }
  audioZoneAt(progress: number): AudioZone {
    const wrapped = THREE.MathUtils.euclideanModulo(progress, 1);
    return wrapped >= .515 && wrapped <= .62 ? "underpass" : "open";
  }
  updateAtmosphere(): boolean { return false; }
  vehicleHoverHeight(_speed: number, boost: boolean): number { return boost ? 1.2 : .96; }
  setLapBoard(): void {}
  recoveryProgressFor(_progress: number, previousCheckpoint: number): number {
    return (route.checkpoints[previousCheckpoint] + .005) % 1;
  }
  rivalGridStart(): null { return null; }
  setCheckpointProgress(next: number): void {
    for (const gate of this.gates) {
    for (let i = 0; i < route.checkpoints.length; i++) {
      const color = new THREE.Color(i === next ? 0xffc983 : (next === 0 || i < next) ? 0x71afa0 : 0x354954);
      for (let part = 0; part < 3; part++) gate.setColorAt(i * 3 + part, color);
    }
    if (gate.instanceColor) gate.instanceColor.needsUpdate = true;
    }
  }

  transferAvailable(progress: number): boolean {
    const window = transferWindowAt(progress);
    if (!window) return false;
    const i = Math.floor(THREE.MathUtils.euclideanModulo(progress, 1) * route.count);
    const floor = route.stations[i], upper = route.upper[i];
    return Math.hypot(floor.p[0] - upper.p[0], floor.p[2] - upper.p[2]) < .2
      && Math.abs(floor.curvature) < (window.fromLane === 0 ? .005 : .007);
  }

  nextTransferDistance(progress: number): number {
    const p = THREE.MathUtils.euclideanModulo(progress, 1);
    const current = transferWindowAt(p);
    if (current?.fromLane === this.lane && this.transferAvailable(p)) return 0;
    return Math.min(...TRANSFER_WINDOWS.filter(window => window.fromLane === this.lane)
      .map(window => THREE.MathUtils.euclideanModulo(window.from - p, 1))) * this.length;
  }

  shortcutAt(progress: number): typeof route.shortcuts[number] | undefined {
    return route.shortcuts.find(shortcut => progress >= shortcut.from && progress < shortcut.to);
  }

  /** Independent samples for world markers; never change the player's selected deck. */
  sampleLane(progress: number, lane: 0 | 1, target: CourseSample): CourseSample {
    if (lane === this.lane) return this.sample(progress, target);
    // The alternate surface view owns its own lane state and has no scene geometry.
    const view = this.rivalCourse;
    if (!view) throw new Error("Alternate-deck sampling requires the rendered course.");
    const previous = view.lane;
    view.lane = lane;
    const result = view.sample(progress, target);
    view.lane = previous;
    return result;
  }

  private createStreet(): THREE.Mesh {
    const positions:number[] = [], colors:number[] = [], uvs:number[] = [], indices:number[] = [];
    for (let i = 0; i <= route.count; i++) {
      const sample = this.sample(i / route.count);
      const color = this.lane ? new THREE.Color(0x57cdd6) : DISTRICT_COLORS[this.district(i / route.count)];
      for (const side of [-1,1]) {
        const p = sample.position.clone().addScaledVector(sample.right, sample.halfWidth * side);
        positions.push(p.x, p.y, p.z);
        colors.push(color.r, color.g, color.b);
        uvs.push((side+1)/2, i / route.count * this.length);
      }
      if (i < route.count) { const k=i*2; indices.push(k,k+1,k+3,k,k+3,k+2); }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position",new THREE.Float32BufferAttribute(positions,3));
    geometry.setAttribute("color",new THREE.Float32BufferAttribute(colors,3));
    geometry.setAttribute("uv",new THREE.Float32BufferAttribute(uvs,2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const material = new THREE.ShaderMaterial({
      uniforms:THREE.UniformsUtils.clone(THREE.UniformsLib.fog), vertexColors:true, fog:true, side:THREE.DoubleSide,
      vertexShader:`
        varying vec2 vUv; varying vec3 vTint; varying vec3 vWorld;
        #include <fog_pars_vertex>
        void main() {
          vUv=uv; vTint=color; vWorld=(modelMatrix*vec4(position,1.0)).xyz;
          vec4 mvPosition=modelViewMatrix*vec4(position,1.0);
          gl_Position=projectionMatrix*mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader:`
        varying vec2 vUv; varying vec3 vTint; varying vec3 vWorld;
        #include <fog_pars_fragment>
        float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
        float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
          return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
        void main(){
          float grain=noise(vWorld.xz*3.0);
          float puddle=smoothstep(.42,.7,noise(vWorld.xz*.12));
          float lamp=pow(.5+.5*cos(vUv.y*6.283185/55.0),6.0);
          float side=pow(abs(vUv.x-.5)*2.0,2.0);
          float reflection=pow(.5+.5*sin(vUv.y*3.1+grain*2.0),4.0);
          vec3 color=vec3(.019,.028,.037)*(0.84+grain*.2-puddle*.24);
          color+=vTint*(lamp*.08+side*.055);
          color+=vTint*puddle*(.03+reflection*.055)*(.25+side);
          // Worn central lane paint and narrow yellow edge markings.
          float dash=(1.0-smoothstep(.005,.012,abs(vUv.x-.5)))*step(.58,fract(vUv.y/18.0));
          float edge=1.0-smoothstep(.002,.006,abs(abs(vUv.x-.5)-.473));
          color=mix(color,vec3(.19,.22,.21),dash*.7);
          color=mix(color,vec3(.24,.17,.075),edge*.7);
          gl_FragColor=vec4(color,1.0);
          #include <fog_fragment>
          #include <colorspace_fragment>
        }`,
    });
    const mesh=new THREE.Mesh(geometry,material); mesh.name="polarity_rain_polished_asphalt";
    return mesh;
  }

  private createFurniture(): THREE.Group {
    const group=new THREE.Group();
    const count=Math.floor(this.length/7);
    const kerbs=new THREE.InstancedMesh(new THREE.BoxGeometry(1.1,.65,6.85),
      new THREE.MeshLambertMaterial({color:0x526068}),count*2);
    const lamps=new THREE.InstancedMesh(new THREE.BoxGeometry(.22,.07,1.5),
      new THREE.MeshBasicMaterial({color:this.lane ? 0x65dbea : 0xffbe73,toneMapped:false}),count*2);
    const transform=new THREE.Object3D(),basis=new THREE.Matrix4();
    for(let i=0;i<count;i++) {
      const s=this.sampleAtDistance(i*7);
      basis.makeBasis(s.right,s.up,s.tangent.clone().negate());
      for(let j=0;j<2;j++) {
        const side=j===0?-1:1;
        transform.position.copy(s.position).addScaledVector(s.right,(s.halfWidth+.55)*side);
        transform.position.addScaledVector(s.up,.18);
        transform.quaternion.setFromRotationMatrix(basis); transform.updateMatrix();
        kerbs.setMatrixAt(i*2+j,transform.matrix);
        transform.position.addScaledVector(s.up,.35); transform.updateMatrix(); lamps.setMatrixAt(i*2+j,transform.matrix);
      }
    }
    group.add(kerbs,lamps);
    return group;
  }
  private createGates(): THREE.InstancedMesh {
    const mesh=new THREE.InstancedMesh(new THREE.BoxGeometry(1,1,1),
      new THREE.MeshBasicMaterial({color:0xffffff,toneMapped:false}),route.checkpoints.length*3);
    const transform=new THREE.Object3D(),basis=new THREE.Matrix4();
    route.checkpoints.forEach((progress,i)=>{
      const s=this.sample(progress); basis.makeBasis(s.right,s.up,s.tangent.clone().negate());
      for(let j=0;j<3;j++) {
        transform.position.copy(s.position).addScaledVector(s.up,j===2?9:4.5);
        if(j<2)transform.position.addScaledVector(s.right,(j===0?-1:1)*(s.halfWidth+1.8));
        transform.scale.set(j===2?s.width+4:.3,j===2?.22:9,.35);
        transform.quaternion.setFromRotationMatrix(basis);transform.updateMatrix();mesh.setMatrixAt(i*3+j,transform.matrix);
      }
    });
    return mesh;
  }
}
