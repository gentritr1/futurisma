import {ascensionFieldAt} from './ascension-powers-config.js';
import * as THREE from "three";
import {flatIdBatch} from "./ascension-flat-batch";
import { resolveAbilitySeed } from "./ability-seed";
import calibration from "./data/ascension/schedule.json";
import { AscensionSchedule } from "./ascension-schedule.js";
import route from "./data/ascension/route.json";
import rivalPace from "./data/ascension/rival-pace.json";
import { createApronResolution, resolveApron } from "./apron.js";
import type { ApronResolution, ApronTable } from "./apron.js";
import type { AudioZone } from "./audio-space.js";
import type { CourseSample, CourseProjection, CourseLightingProfile, FogProfile,
  RaceCourse, TurnCue, MusicProfile } from "./course";

const UP = new THREE.Vector3(0, 1, 0);
// The concrete kerb is the race boundary; the estuary is not a drivable apron.
const APRON: ApronTable = {
  deckMarginMetres: 2.05,
  gripFloor: .5,
  edges: {
    A: { label: "Concrete kerb", widthMetres: 0, grip: 1, wall: true,
      wallSpeedMultiplier: .76, wallImpactStrength: .5,
      wallScrubMetresPerSecondSquared: 24, surface: "asphalt" },
  },
  overrides: [],
};
const DISTRICT_COLORS = route.districts.map(d => new THREE.Color(d.color));

const MUSIC: MusicProfile[] = [
  { trance: 1, jungle: 0, deep_dnb: 2, techstep: 0 },
  { trance: 2, jungle: 1, deep_dnb: 1, techstep: 0 },
  { trance: 0, jungle: 2, deep_dnb: 2, techstep: 1 },
  { trance: 0, jungle: 1, deep_dnb: 1, techstep: 2 },
  { trance: 1, jungle: 1, deep_dnb: 2, techstep: 1 },
  { trance: 2, jungle: 0, deep_dnb: 1, techstep: 1 },
];

export class AscensionCourse implements RaceCourse {
  readonly kind = "ascension" as const;
  readonly group = new THREE.Group();
  readonly length = route.length;
  readonly halfWidth = 12;
  readonly checkpointCount = route.checkpoints.length - 1;
  readonly orderedCheckpointCount = route.checkpoints.length;
  readonly defaultLapCount = 3;
  readonly minimumLapCount = 1;
  readonly maximumLapCount = 9;
  readonly mapName = "Ascension Pad";
  readonly mapCode = "MAP 06";
  readonly finishName = "Pad 09";
  readonly flavour = "PAD 09 · LAUNCH DAY / DAWN";

  briefing(laps: string): string {
    return `Launch day: trench shortcut or Deluge Road. ${this.scheduleLabel}. ${laps}.`;
  }
  readonly startLabel = "PAD ROAD";
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
  get scheduleLabel(): string { return this.schedule.config?.events.filter(e=>!e.id.includes("klaxon")).map(e=>`${e.id}: ${(e.tick/120).toFixed(2)}s`).join(" · ") ?? "Measuring Works lap"; }
  readonly schedule = new AscensionSchedule(typeof location!=="undefined"&&new URLSearchParams(location.search).has("calibrate")?null:calibration,typeof location === "undefined" ? 3868938316 : resolveAbilitySeed());
  private occupiedTrench = false;
  readonly tide = { lap: 1, elapsed: 0, waterLevel: -30, draining: false, shortcutOpen: true };

  private readonly branchScratch = this.createProjectionScratch();
  private readonly branchPoints = route.shortcut.stations.map(s => new THREE.Vector3(...s.p as [number, number, number]));
  private readonly branchTangents = route.shortcut.stations.map(s => new THREE.Vector3(...s.t as [number, number, number]));
  private readonly clock = { value: 0 };
  private readonly points = route.stations.map(s => new THREE.Vector3(...s.p as [number, number, number]));
  private readonly tangents = route.stations.map(s => new THREE.Vector3(...s.t as [number, number, number]));
  private readonly gates: THREE.InstancedMesh;
  private readonly turns: { from: number; to: number; radius: number; direction: "LEFT" | "RIGHT" }[] = [];

  constructor() {
    this.group.name = "ascension_street_circuit";
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
    this.group.add(this.createFurniture(),this.createStreet(),this.createBranchRoad());
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
    const wrapped=THREE.MathUtils.euclideanModulo(progress,1);
    target.bank=wrapped>.08&&wrapped<.16 ? .04*Math.sin((wrapped-.08)/.08*Math.PI) : 0;
    target.right.applyAxisAngle(target.tangent,target.bank);target.up.crossVectors(target.right,target.tangent).normalize();
    target.edgeLeft = target.edgeRight = "A";
    target.apronLeft = target.apronRight = 0;
    target.apronGripLeft = target.apronGripRight = 1;
    return target;
  }
  // A repeatable fork choice for the production demo controller.
  demoTrench = typeof location === 'undefined' || new URLSearchParams(location.search).get('demoTrench') !== '0';
  demoSample(progress: number, target = this.createSampleScratch()): CourseSample {
    const cut=route.shortcut;
    return this.demoTrench && (this.tide.shortcutOpen || this.occupiedTrench) && progress>=cut.from && progress<=cut.to
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
    // Both physical roads map to the same gate interval. An occupied trench
    // remains projectable at closure so its driver can leave normally.
    const cut = route.shortcut;
    if ((this.tide.shortcutOpen || this.occupiedTrench) && hintProgress >= cut.from - .015 && hintProgress <= cut.to + .015) {
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
        Object.assign(target, {progress, width:this.branchScratch.width, halfWidth:this.branchScratch.halfWidth, sector:"TRENCH", alternateRoad:true});
        target.position.copy(this.branchScratch.position); target.tangent.copy(this.branchScratch.tangent);
        target.right.copy(this.branchScratch.right); target.up.copy(this.branchScratch.up);
        target.lateral = (position.x-target.position.x)*target.right.x+(position.y-target.position.y)*target.right.y+(position.z-target.position.z)*target.right.z;
      }
    }
    this.occupiedTrench = target.alternateRoad === true;
    return target;
  }

  sampleShortcut(progress: number, target = this.createSampleScratch()): CourseSample {
    const cut=route.shortcut;
    const scaled=THREE.MathUtils.clamp((progress-cut.from)/(cut.to-cut.from),0,1)*(this.branchPoints.length-1);
    const i=Math.min(this.branchPoints.length-2,Math.floor(scaled)), alpha=scaled-i;
    target.position.lerpVectors(this.branchPoints[i],this.branchPoints[i+1],alpha);
    target.tangent.lerpVectors(this.branchTangents[i],this.branchTangents[i+1],alpha).normalize();
    target.right.crossVectors(target.tangent,UP).normalize();target.up.crossVectors(target.right,target.tangent).normalize();
    const u=(progress-cut.from)/(cut.to-cut.from);
    target.width=cut.width+4*Math.max(0,1-Math.min(u,1-u)/.22);target.halfWidth=target.width/2;target.sector="TRENCH"; target.alternateRoad=true;
    return target;
  }

  turnAhead(progress: number, maximumDistance = 240, target?: TurnCue): TurnCue | null {
    if(this.demoTrench && this.tide.shortcutOpen && progress>route.shortcut.from-.04 && progress<route.shortcut.from+.06){
      const cue=target??{direction:"RIGHT" as const,followingDirection:null,distance:0,hard:false,radius:150};
      Object.assign(cue,{direction:"RIGHT",followingDirection:null,distance:Math.max(0,(route.shortcut.from-progress)*this.length),hard:false,radius:150});return cue;
    }
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
  travelModeAt(_progress: number): "surface" { return "surface"; }
  fogAt(progress: number): FogProfile {
    const steam = this.schedule.state.steam && progress < .16;
    return {color:new THREE.Color(0x87918a),density:steam ? .004 : .002};
  }
  lightingAt(_progress=0): CourseLightingProfile { return {
    sky:new THREE.Color(0xd0d8cf),ground:new THREE.Color(0x555b42),key:new THREE.Color(0xffdec0),rim:new THREE.Color(0xbac9c5),
    hemisphereIntensity:1.15,keyIntensity:1.3,rimIntensity:.35,keyDirection:new THREE.Vector3(.68,.5,-.55).normalize(),
  }; }
  edgeType(): "A" { return "A"; }
  apronAt(sample: CourseSample, lateral: number,
    target: ApronResolution = createApronResolution()): ApronResolution {
    return resolveApron(APRON, "A", sample.sector, sample.halfWidth, lateral, target);
  }
  surfaceGripAt(progress: number, _lateral = 0): number {
    return this.schedule.grip(this.occupiedTrench ? "TRENCH" : this.sample(progress,this.branchScratch).sector);
  }
  cableTripSideAt(progress: number, lateral: number): -1 | 0 | 1 { const field=ascensionFieldAt(progress,lateral,this.length,this.trenchOccupied);return field?(lateral<field.lateral?-1:1):0; }
  rivalHazardLaneAt(): null { return null; }

  cablePassLateralMeters(): number { return Number.NaN; }
  boostPadLaneAt(): null { return null; }
  isOnBoostPad(): boolean { return false; }
  sectorLabelAt(progress: number): string {
    return this.occupiedTrench ? "TRENCH" : route.districts[this.district(progress)].name;
  }
  musicAt(progress: number): MusicProfile { return MUSIC[this.district(progress) % MUSIC.length]; }
  audioZoneAt(_progress: number): AudioZone { return this.occupiedTrench ? "underpass" : "open"; }
  updateAtmosphere(elapsed: number, reducedMotion: boolean): boolean {
    const time = reducedMotion ? 0 : Math.floor(elapsed * 30) / 30;
    if (time === this.clock.value) return false;
    this.clock.value = time;
    return true;
  }
  vehicleHoverHeight(_speed: number, boost: boolean): number { return boost ? 1.2 : .96; }
  setLapBoard(lap: number): void { this.tide.lap=lap; }
  advanceSchedule(ticks: number): void {
    this.schedule.advanceTicks(ticks,this.tide.lap);
    this.tide.shortcutOpen=this.schedule.state.trenchOpen;
    this.tide.elapsed=this.schedule.tick/120;
  }
  get trenchOccupied(): boolean { return this.occupiedTrench; }
  releaseTrench(): void { this.occupiedTrench=false; }
  resetSchedule(): void {
    this.schedule.reset(); this.occupiedTrench=false; this.tide.lap=1;
    this.tide.shortcutOpen=true; this.tide.elapsed=0;
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

  private createRoadMaterial(): THREE.MeshLambertMaterial {
    const material=new THREE.MeshLambertMaterial({color:0xffffff});
    if(typeof Image!=='undefined') {
      const map=new THREE.TextureLoader().load('/assets/ascension/textures/concrete.jpg');
      map.colorSpace=THREE.SRGBColorSpace;map.anisotropy=8;material.map=map;
      material.onBeforeCompile=shader=>{
        shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',`
          #ifdef USE_MAP
          vec2 continuousUv=vec2(clamp(vMapUv.x,0.,1.),vMapUv.y/12.);
          vec2 roadUv=vec2(continuousUv.x,fract(continuousUv.y));
          vec4 sampledDiffuseColor=textureGrad(map,vec2(.512,.012)+roadUv*.476,dFdx(continuousUv)*.476,dFdy(continuousUv)*.476);
          diffuseColor*=sampledDiffuseColor;
          #endif`);
      };
      material.customProgramCacheKey=()=> 'ascension-painted-road-v1';
    }
    return material;
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
    const material=this.createRoadMaterial();
    const mesh=new THREE.Mesh(geometry,material); mesh.name="ascension_painted_concrete_road";
    return mesh;
  }

  private createFurniture(): THREE.Group {
    const group = new THREE.Group();
    const distances: number[] = [];
    for (let distance = 0; distance < this.length; distance += 7) {
      distances.push(distance);
    }
    const kerbs = new THREE.InstancedMesh(new THREE.BoxGeometry(.65, .45, 6.8),
      new THREE.MeshLambertMaterial({ color: 0x6a8185 }), distances.length * 2);
    if(typeof Image!=='undefined'){
      const texture=new THREE.TextureLoader().load('/assets/ascension/textures/signage.jpg');texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=8;
      (kerbs.material as THREE.MeshLambertMaterial).map=texture;(kerbs.material as THREE.MeshLambertMaterial).color.set(0xffffff);
      const uv=kerbs.geometry.getAttribute('uv');for(let i=0;i<uv.count;i++)uv.setXY(i,.512+uv.getX(i)*.476,.012+uv.getY(i)*.476);
    }
    const lamps = new THREE.InstancedMesh(new THREE.PlaneGeometry(.18,1.1).rotateX(-Math.PI/2),
      new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: .35 }), Math.ceil(distances.length/2) * 2);
    const housingParts=[new THREE.BoxGeometry(.12,.16,1.5).translate(-.15,0,0),new THREE.BoxGeometry(.12,.16,1.5).translate(.15,0,0),new THREE.BoxGeometry(.18,.16,.2).translate(0,0,-.65),new THREE.BoxGeometry(.18,.16,.2).translate(0,0,.65)];
    const housingSource=housingParts.map(geometry=>new THREE.Mesh(geometry,new THREE.MeshLambertMaterial({color:0x555846})));
    const housingGeometry=flatIdBatch(housingSource,'deck_lamp_frame').geometry;
    const housings=new THREE.InstancedMesh(housingGeometry,new THREE.MeshLambertMaterial({color:0x555846}),Math.ceil(distances.length/2)*2);
    housings.name='ascension_recessed_deck_lamp_housings';lamps.name='ascension_recessed_deck_lamp_glass';
    const transform = new THREE.Object3D(), basis = new THREE.Matrix4();
    const cyan = new THREE.Color(0xcda25f), amber = new THREE.Color(0xe8bc78);
    for (let i = 0; i < distances.length; i++) {
      const sample = this.sampleAtDistance(distances[i]);
      basis.makeBasis(sample.right, sample.up, sample.tangent.clone().negate());
      for (let sideIndex = 0; sideIndex < 2; sideIndex++) {
        const side = sideIndex ? 1 : -1;
        const progress = distances[i] / this.length;
        const branchMouth = Math.abs(progress-route.shortcut.from)<.025 || Math.abs(progress-route.shortcut.to)<.025;
        transform.scale.setScalar(branchMouth ? 0 : 1);
        transform.position.copy(sample.position).addScaledVector(sample.right, (sample.halfWidth + .4) * side)
          .addScaledVector(sample.up, .13);
        transform.quaternion.setFromRotationMatrix(basis); transform.updateMatrix();
        kerbs.setMatrixAt(i * 2 + sideIndex, transform.matrix);
        transform.position.addScaledVector(sample.up, .26); transform.updateMatrix();
        if(i%2===0){
          const lampIndex=Math.floor(i/2)*2+sideIndex;
          lamps.setMatrixAt(lampIndex,transform.matrix);
          transform.position.addScaledVector(sample.up,.035);transform.updateMatrix();
          housings.setMatrixAt(lampIndex,transform.matrix);
          lamps.setColorAt(lampIndex,sample.position.y < -2 ? cyan : amber);
        }
      }
    }
    kerbs.name = "ascension_solid_road_kerbs";
    group.add(kerbs, housings, lamps);
    return group;
  }

  private createBranchRoad(): THREE.Mesh {
    const vertices: number[]=[], uvs: number[]=[], indices: number[]=[];
    const cut=route.shortcut;
    for (let i=0;i<cut.stations.length;i++) {
      const sample=this.sampleShortcut(cut.stations[i].progress);
      for (const side of [-1,1]) {
        vertices.push(...sample.position.clone().addScaledVector(sample.right,side*sample.halfWidth));
        uvs.push((side+1)/2, cut.stations[i].progress*this.length);
      }
      if(i<cut.stations.length-1){const k=i*2;indices.push(k,k+1,k+3,k,k+3,k+2);}
    }
    const geometry=new THREE.BufferGeometry();geometry.setAttribute("position",new THREE.Float32BufferAttribute(vertices,3));
    geometry.setAttribute("uv",new THREE.Float32BufferAttribute(uvs,2));geometry.setIndex(indices);geometry.computeVertexNormals();
    const mesh=new THREE.Mesh(geometry,this.createRoadMaterial());
    mesh.name="ascension_trench_road";return mesh;
  }
  private createGates(): THREE.InstancedMesh {
    const mesh=new THREE.InstancedMesh(new THREE.BoxGeometry(1,1,1),
      new THREE.MeshLambertMaterial({color:0xffffff,emissive:0xffffff,emissiveIntensity:.12}),route.checkpoints.length*2);
    (mesh.material as THREE.MeshLambertMaterial).onBeforeCompile=shader=>{shader.fragmentShader=shader.fragmentShader.replace('#include <emissivemap_fragment>','#include <emissivemap_fragment>\n#ifdef USE_COLOR\ntotalEmissiveRadiance*=vColor.rgb;\n#endif');};
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
