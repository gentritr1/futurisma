import * as THREE from 'three';
import route from './data/frostline/route.json';
import {WinterRoad} from './frostline-snow';
import {createApronResolution,resolveApron} from './apron.js';
import type {ApronResolution,ApronTable} from './apron.js';
import type {CourseSample,CourseProjection,CourseLightingProfile,RaceCourse,TurnCue} from './course';

const UP=new THREE.Vector3(0,1,0);
const APRON:ApronTable={deckMarginMetres:2.05,gripFloor:.6,edges:{A:{label:'Snow rail',widthMetres:0,grip:1,wall:true,wallSpeedMultiplier:.76,wallImpactStrength:.5,wallScrubMetresPerSecondSquared:24,surface:'asphalt'}},overrides:[]};
const LIGHT:CourseLightingProfile={sky:new THREE.Color(0x899bdd),ground:new THREE.Color(0x4f6081),key:new THREE.Color(0xffd7a5),rim:new THREE.Color(0x83b9eb),hemisphereIntensity:1.05,keyIntensity:1.25,rimIntensity:.7,keyDirection:new THREE.Vector3(-.6,.65,.35).normalize()};

/** The authored route is the single source for racing, road geometry and scenery. */
export class FrostlineCourse implements RaceCourse {
  readonly kind='frostline' as const;
  readonly group=new THREE.Group();
  readonly length=route.length;
  readonly halfWidth=13;
  readonly checkpointCount=route.checkpoints.length-1;
  readonly orderedCheckpointCount=route.checkpoints.length;
  readonly defaultLapCount=3;readonly minimumLapCount=1;readonly maximumLapCount=9;
  readonly mapName='Frostline';readonly mapCode='MAP 09';
  readonly finishName='the Midnight Arch';readonly flavour='MIDNIGHT IN THE MOUNTAINS';
  readonly startLabel='CHRISTMAS SQUARE';readonly startProgress=.002;readonly startLateral=0;
  readonly recoveryHoldSeconds=1.1;readonly recoverySpeedMps=34;readonly recoveryImmunitySeconds=1.2;
  readonly surfaceGripRecoverySeconds=.8;readonly timeOfDayStops=null;
  readonly rivalPace={cornerSpeedGain:.3,cornerSpeedFloor:.65,noBlockSide:-1,driftCurvature:.55,straightCurvature:.13,profiles:{
    'rival-privateer':{cruiseSpeedMetersPerSecond:83,padUse:false,boostWindows:[]},
    'rival-nightform':{cruiseSpeedMetersPerSecond:81,padUse:false,boostWindows:[]},
    'rival-needle':{cruiseSpeedMetersPerSecond:79,padUse:false,boostWindows:[]},
  },tiers:{
    rookie:{profiles:{'rival-privateer':{cruiseSpeedMetersPerSecond:74,padUse:false,boostWindows:[]},'rival-nightform':{cruiseSpeedMetersPerSecond:72,padUse:false,boostWindows:[]},'rival-needle':{cruiseSpeedMetersPerSecond:70,padUse:false,boostWindows:[]}}},
    feral:{profiles:{'rival-privateer':{cruiseSpeedMetersPerSecond:90,padUse:false,boostWindows:[]},'rival-nightform':{cruiseSpeedMetersPerSecond:88,padUse:false,boostWindows:[]},'rival-needle':{cruiseSpeedMetersPerSecond:86,padUse:false,boostWindows:[]}}},
  }};
  readonly points=route.stations.map(s=>new THREE.Vector3(...s.p as [number,number,number]));
  private readonly tangents=route.stations.map(s=>new THREE.Vector3(...s.t as [number,number,number]));
  private readonly fog={color:new THREE.Color(0x687eac),density:.0012};
  private readonly music={trance:2,jungle:1,deep_dnb:2,techstep:0};
  private readonly scratch=this.createSampleScratch();
  private readonly turns:{from:number;to:number;radius:number;direction:'LEFT'|'RIGHT'}[]=[];
  readonly winter = new WinterRoad();
  readonly craftPosition = new THREE.Vector3();
  readonly craftForward = new THREE.Vector3(0,0,-1);
  visualTime=0;
  get minimapInterference(){return this.lap>=this.totalLaps?.62:0;}
  lap=1;
  raceProgress=0;
  totalLaps=3;
  nextCheckpoint=1;
  constructor(){
    this.group.name='frostline_circuit';
    for(let i=0;i<route.count;i++){
      const s=route.stations[i];if(Math.abs(s.curvature)<.003)continue;
      const from=i/route.count,sign=Math.sign(s.curvature);let peak=Math.abs(s.curvature);
      while(i+1<route.count&&Math.sign(route.stations[i+1].curvature)===sign&&Math.abs(route.stations[i+1].curvature)>.0025){i++;peak=Math.max(peak,Math.abs(route.stations[i].curvature));}
      this.turns.push({from,to:i/route.count,radius:1/peak,direction:sign<0?'LEFT':'RIGHT'});
    }
  }
  briefing(laps:string,craft:string,solo:boolean){return `Follow the lanterns through the Christmas market, over the gondola ridge and across Silver Lake. Snow pushes the craft sideways: follow the cleared wheel tracks, collect cyan stabilizers or amber thermal boosts. Midnight brings the fireworks. ${laps}${solo?'': ' against three rivals'} in ${craft}.`;}
  createSampleScratch():CourseSample{return {position:new THREE.Vector3(),tangent:new THREE.Vector3(0,0,-1),right:new THREE.Vector3(1,0,0),up:new THREE.Vector3(0,1,0),curvature:0,width:26,halfWidth:13,bank:0,sector:'CHRISTMAS SQUARE',edgeLeft:'A',edgeRight:'A',apronLeft:0,apronRight:0,apronGripLeft:1,apronGripRight:1};}
  createProjectionScratch():CourseProjection{return {...this.createSampleScratch(),progress:0,lateral:0};}
  sample(progress:number,target=this.createSampleScratch()):CourseSample{
    const p=THREE.MathUtils.euclideanModulo(progress,1)*route.count,i=Math.floor(p),j=(i+1)%route.count,a=p-i;
    target.position.lerpVectors(this.points[i],this.points[j],a);
    target.tangent.lerpVectors(this.tangents[i],this.tangents[j],a).normalize();
    target.right.crossVectors(target.tangent,UP).normalize();target.up.crossVectors(target.right,target.tangent).normalize();
    target.curvature=THREE.MathUtils.clamp(THREE.MathUtils.lerp(route.stations[i].curvature,route.stations[j].curvature,a)*70,-1,1);
    target.width=26;target.halfWidth=13;target.bank=0;target.sector=route.stations[i].sector;target.alternateRoad=false;
    target.edgeLeft=target.edgeRight='A';target.apronLeft=target.apronRight=0;target.apronGripLeft=target.apronGripRight=1;
    return target;
  }
  sampleAtDistance(distance:number){return this.sample(distance/this.length);}
  checkpointProgress(index:number){return route.checkpoints[index];}
  checkpointHalfWidth(){return this.halfWidth;}
  project(position:THREE.Vector3,hint:number,target=this.createProjectionScratch()):CourseProjection{
    const count=this.points.length,center=Math.round(THREE.MathUtils.euclideanModulo(hint,1)*count);
    let best=Infinity,progress=hint;
    for(let pass=0;pass<2;pass++){
      if(pass&&best<38*38)break;
      for(let k=pass?0:-42;k<(pass?count:43);k++){
        const i=THREE.MathUtils.euclideanModulo(pass?k:center+k,count),a=this.points[i],b=this.points[(i+1)%count];
        const x=b.x-a.x,z=b.z-a.z;
        const t=THREE.MathUtils.clamp(((position.x-a.x)*x+(position.z-a.z)*z)/(x*x+z*z),0,1);
        const distance=(position.x-a.x-t*x)**2+(position.z-a.z-t*z)**2;
        if(distance<best){best=distance;progress=(i+t)/count%1;}
      }
    }
    this.sample(progress,target);target.progress=progress;
    target.lateral=(position.x-target.position.x)*target.right.x+(position.y-target.position.y)*target.right.y+(position.z-target.position.z)*target.right.z;
    return target;
  }
  turnAhead(progress:number,maximumDistance=240,target?:TurnCue):TurnCue|null{
    const p=THREE.MathUtils.euclideanModulo(progress,1);let nearest=maximumDistance+1,selected:typeof this.turns[number]|undefined;
    for(const turn of this.turns){const d=(p>=turn.from&&p<=turn.to)?0:THREE.MathUtils.euclideanModulo(turn.from-p,1)*this.length;if(d<nearest){nearest=d;selected=turn;}}
    if(!selected||nearest>maximumDistance)return null;
    const out=target??{direction:'LEFT',followingDirection:null,distance:0,hard:false,radius:0};
    out.direction=selected.direction;out.followingDirection=null;out.distance=nearest;out.hard=selected.radius<95;out.radius=selected.radius;return out;
  }
  fogAt(){return this.fog;}lightingAt(){return LIGHT;}edgeType(){return 'A' as const;}
  apronAt(sample:CourseSample,lateral:number,target:ApronResolution=createApronResolution()){return resolveApron(APRON,'A',sample.sector,sample.halfWidth,lateral,target);}
  surfaceGripAt(progress:number,lateral=0){return this.winter.gripAt(progress,lateral);}
  lateralDriftAt(progress:number,lateral:number,speed:number){return this.winter.driftAt(progress,lateral,speed);}
  cableTripSideAt(){return 0 as const;}cablePassLateralMeters(){return NaN;}
  isOnBoostPad(){return false;}boostPadLaneAt(){return null;}
  sectorLabelAt(progress:number){return this.sample(progress,this.scratch).sector;}
  musicAt(){return this.music;}
  audioZoneAt(){return 'open' as const;}
  updateAtmosphere(elapsed:number,reducedMotion:boolean){this.visualTime=reducedMotion?0:elapsed;return true;}
  vehicleHoverHeight(_speed:number,boost:boolean){return boost?1.2:.96;}
  setCheckpointProgress(next:number){this.nextCheckpoint=next;}
  selectRaceFormat(_mode:string,totalLaps:number){this.totalLaps=totalLaps;}
  setLapBoard(lap:number,totalLaps:number){this.lap=lap;this.totalLaps=totalLaps;}
  recoveryProgressFor(_progress:number,previous:number){return (route.checkpoints[previous]+.005)%1;}
  rivalGridStart(){return null;}
}
