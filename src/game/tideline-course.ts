import * as THREE from "three";
import { isFoundryEdition } from "./tideline-style";
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
const LIGHTING: CourseLightingProfile = {
  sky: new THREE.Color(0x758cca), ground: new THREE.Color(0x302148),
  key: new THREE.Color(0xa7b7dd), rim: new THREE.Color(0x5bdde3),
  hemisphereIntensity: 1.05, keyIntensity: 1.05, rimIntensity: 1.35,
  keyDirection: new THREE.Vector3(.35, .8, -.48).normalize(),
};
const FOG: Record<TidelineTravelMode, FogProfile> = {
  submerged: { color: new THREE.Color(0x0f465e), density: .006 },
  surface: { color: new THREE.Color(0x243557), density: .0013 },
  air: { color: new THREE.Color(0x26395f), density: .0011 },
};
const FOUNDRY_LIGHTING: CourseLightingProfile = {
  ...LIGHTING, sky: new THREE.Color(0x879783), ground: new THREE.Color(0x3d3c2d),
  key: new THREE.Color(0xc3b998), rim: new THREE.Color(0xa39767),
  hemisphereIntensity: 1.12, keyIntensity: .92, rimIntensity: .65,
};
const FOUNDRY_FOG: Record<TidelineTravelMode, FogProfile> = {
  submerged: { color: new THREE.Color(0x314d3e), density: .0055 },
  surface: { color: new THREE.Color(0x535b4c), density: .0017 },
  air: { color: new THREE.Color(0x51594e), density: .0015 },
};
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
  readonly mapName = isFoundryEdition ? "Tideline / Foundry" : "Tideline";
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
    this.group.add(this.createStreet(), this.createFurniture(), this.createFlightGuides());
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
  travelModeAt(progress: number): TidelineTravelMode {
    const wrapped = THREE.MathUtils.euclideanModulo(progress, 1);
    for (const arc of route.flightArcs) {
      if (wrapped >= arc.from && wrapped < arc.to) return "air";
    }
    const index = Math.floor(wrapped * route.count);
    return route.stations[index].p[1] < -2 ? "submerged" : "surface";
  }
  fogAt(progress: number): FogProfile { return (isFoundryEdition ? FOUNDRY_FOG : FOG)[this.travelModeAt(progress)]; }
  lightingAt(): CourseLightingProfile { return isFoundryEdition ? FOUNDRY_LIGHTING : LIGHTING; }
  edgeType(): "A" { return "A"; }
  apronAt(sample: CourseSample, lateral: number,
    target: ApronResolution = createApronResolution()): ApronResolution {
    return resolveApron(APRON, "A", sample.sector, sample.halfWidth, lateral, target);
  }
  surfaceGripAt(): number { return 1; }
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
  setLapBoard(): void {}
  recoveryProgressFor(_progress: number, previousCheckpoint: number): number {
    return (route.checkpoints[previousCheckpoint] + .005) % 1;
  }
  rivalGridStart(): null { return null; }
  setCheckpointProgress(next: number): void {
    for (let i = 0; i < route.checkpoints.length; i++) {
      const color = new THREE.Color(i === next ? 0xffc983 : (next === 0 || i < next) ? 0x71afa0 : 0x354954);
      for (let part = 0; part < 3; part++) this.gates.setColorAt(i * 3 + part, color);
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
      if (i < route.count && this.travelModeAt((i + .5) / route.count) !== "air") {
        const k=i*2; indices.push(k,k+1,k+3,k,k+3,k+2);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position",new THREE.Float32BufferAttribute(positions,3));
    geometry.setAttribute("color",new THREE.Float32BufferAttribute(colors,3));
    geometry.setAttribute("uv",new THREE.Float32BufferAttribute(uvs,2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const material = new THREE.ShaderMaterial({
      uniforms:{ ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), tidelineTime: this.clock, foundry: { value: isFoundryEdition ? 1 : 0 } }, vertexColors:true, fog:true, side:THREE.DoubleSide,
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
        uniform float tidelineTime; uniform float foundry;
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
          vec3 color=vec3(.048,.054,.085)*(0.80+grain*.35-puddle*.20);
          float panel=step(.975,fract(vUv.y/6.0));
          float rib=step(.72,fract(vUv.y*2.0));
          float service=step(.35,abs(vUv.x-.5));
          color*=1.0-panel*.62-service*rib*.36;
          color+=vec3(.015,.021,.030)*pow(noise(vWorld.xz*15.),3.0);
          color+=vTint*(lamp*.075+side*.026);
          color+=vTint*puddle*(.03+reflection*.055)*(.25+side);
          vec2 flow=vWorld.xz*.19+vec2(tidelineTime*.07,-tidelineTime*.05);
          float interference=abs(sin(flow.x+sin(flow.y)))*abs(sin(flow.y+sin(flow.x*.7)));
          float caustic=pow(1.0-interference,12.0)*(1.0-smoothstep(-2.0,1.0,vWorld.y));
          color+=vec3(.025,.12,.13)*caustic;
          // Broad concrete repairs and damp deposits replace the metal panels.
          float slab=step(.023,fract(vUv.y/9.0));
          float repair=step(.64,noise(floor(vec2(vUv.x*8.0,vUv.y/9.0))));
          vec3 concrete=vec3(.18,.172,.13)*(0.73+grain*.35+repair*.19);
          concrete*=.68+slab*.32;
          float algae=side*smoothstep(.39,.72,noise(vWorld.xz*.19));
          concrete=mix(concrete,vec3(.037,.067,.028),algae*.64);
          concrete+=vec3(.05,.039,.009)*lamp*side;
          color=mix(color,concrete,foundry);
          // Worn central lane paint and narrow yellow edge markings.
          float dash=(1.0-smoothstep(.005,.012,abs(vUv.x-.5)))*step(.58,fract(vUv.y/18.0));
          float edge=1.0-smoothstep(.002,.006,abs(abs(vUv.x-.5)-.473));
          float hazard=step(.447,abs(vUv.x-.5))*(1.0-step(.465,abs(vUv.x-.5)));
          float stripe=step(.5,fract(vUv.y*.65+vUv.x*14.0));
          color=mix(color,mix(vec3(.009,.012,.025),vec3(.53,.34,.036),stripe),hazard*.88);
          color=mix(color,vec3(.19,.22,.21),dash*.7);
          color=mix(color,vec3(.48,.31,.045),edge*.85);
          gl_FragColor=vec4(color,1.0);
          #include <fog_fragment>
          #include <colorspace_fragment>
        }`,
    });
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
    const cyan = new THREE.Color(isFoundryEdition ? 0xcda25f : 0x84e0dc), amber = new THREE.Color(0xe8bc78);
    for (let i = 0; i < distances.length; i++) {
      const sample = this.sampleAtDistance(distances[i]);
      basis.makeBasis(sample.right, sample.up, sample.tangent.clone().negate());
      for (let sideIndex = 0; sideIndex < 2; sideIndex++) {
        const side = sideIndex ? 1 : -1;
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

  private createFlightGuides(): THREE.Group {
    const group = new THREE.Group();
    group.name = "tideline_guided_glide_beacons";
    const progress: number[] = [];
    for (const arc of this.flightArcs) {
      const count = Math.ceil(arc.length / 19);
      for (let i = 0; i <= count; i++) progress.push(arc.from + (arc.to - arc.from) * i / count);
    }
    const markers = new THREE.InstancedMesh(new THREE.OctahedronGeometry(.55),
      new THREE.MeshBasicMaterial({ color: isFoundryEdition ? 0xe3b972 : 0x88e7ef, toneMapped: false }), progress.length * 2);
    const transform = new THREE.Object3D();
    progress.forEach((p, index) => {
      const sample = this.sample(p);
      for (const side of [-1, 1]) {
        transform.position.copy(sample.position).addScaledVector(sample.right, side * 10.8)
          .addScaledVector(sample.up, .6);
        transform.updateMatrix(); markers.setMatrixAt(index * 2 + (side === 1 ? 1 : 0), transform.matrix);
      }
    });
    markers.name = "tideline_glide_edge_lights";
    group.add(markers);
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
