import * as THREE from 'three';
import type {CourseKind, RaceCourse} from './course';

export interface CircuitSignatureSite {
  progress: number;
  side: number;
  radius: number;
  title: string;
  subtitle: string;
  signHeight: number;
  signFront: number;
  signWidth: number;
  accent: number;
  scale?: number;
}

/** One composed place per map, in a district where its job makes sense.
 * Supports and working parts share a reserved footprint; no random scatter. */
export const CIRCUIT_SIGNATURE_SITES: Record<CourseKind, CircuitSignatureSite> = {
  greenwater: {progress:.222,side:-1,radius:20,title:'MARSH AIR SERVICE',subtitle:'SURVEY / RESCUE / FLOATPLANE DOCK',signHeight:1.8,signFront:11.96,signWidth:7,accent:0xe8b979},
  bitterpan: {progress:.42,side:1,radius:19,title:'SALT RECLAIMER 04',subtitle:'BUCKET WHEEL / RECOVERY LINE',signHeight:2.4,signFront:10.76,signWidth:8,accent:0xdcc59b},
  nightshift: {progress:.745,side:1,radius:16,title:'MERIDIAN WASH',subtitle:'NIGHT CREW / OPEN 24 HOURS',signHeight:9,signFront:6.26,signWidth:15,accent:0xe4a2b9},
  polarity: {progress:.18,side:-1,radius:17,title:'VECTOR BALANCE',subtitle:'LOWER POWER / UPPER EXPRESS',signHeight:2.5,signFront:8.96,signWidth:9,accent:0x8fc9c8},
  tideline: {progress:.805,side:-1,radius:17,title:'INTAKE SURVEY',subtitle:'REMOTE INSPECTION / RECOVERY CRADLE',signHeight:8,signFront:9.06,signWidth:13,accent:0x91b9b6},
  ascension: {progress:.918,side:1,radius:19,title:'DELUGE RESERVE',subtitle:'PAD 09 / GRAVITY FEED / SERVICE ONLY',signHeight:2,signFront:9.26,signWidth:9,accent:0xc7cec1},
  dreamisland: {progress:.345,side:-1,radius:22,title:'POINT OBSERVATORY',subtitle:'DAY SHELTER / NIGHT SKY / REEF WATCH',signHeight:1.8,signFront:9.76,signWidth:8,accent:0xdbb8ad},
  afterglow: {progress:.914,side:-1,radius:18,title:'RELAY EXCHANGE 03',subtitle:'CAPACITOR BANK / SKYLINK FEED',signHeight:2,signFront:8.96,signWidth:10,accent:0xb9b3d4},
  frostline: {progress:.566,side:1,radius:19,title:'RIDGE ROAD CREW',subtitle:'GROOMER / THERMAL STORE / WINTER SERVICE',signHeight:7,signFront:10.26,signWidth:13,accent:0xb7cfd4},
};

/** Low information boards stand beside the 3.5 m crew entrance. */
export function circuitSignatureSignX(site:CircuitSignatureSite):number {
  return site.signHeight<3 ? -site.signWidth/2-1.75 : 0;
}

/** Reserve the same authored parcel before the procedural neighborhood builds.
 * This keeps a service entrance clear without deleting scenery after loading. */
export function circuitSignatureOrigin(course:RaceCourse):THREE.Vector3 {
  const site=CIRCUIT_SIGNATURE_SITES[course.kind],sample=course.sample(site.progress);
  const apron=site.side<0?sample.apronLeft:sample.apronRight;
  return sample.position.clone().addScaledVector(sample.right,site.side*(sample.halfWidth+apron+site.radius+8));
}

export function overlapsCircuitSignature(course:RaceCourse,position:THREE.Vector3,radius:number):boolean {
  const site=CIRCUIT_SIGNATURE_SITES[course.kind],origin=circuitSignatureOrigin(course);
  if(Math.hypot(position.x-origin.x,position.z-origin.z)<site.radius+radius+3)return true;
  const sample=course.sample(site.progress),apron=site.side<0?sample.apronLeft:sample.apronRight;
  const end=sample.position.clone().addScaledVector(sample.right,site.side*(sample.halfWidth+apron+5));
  const dx=end.x-origin.x,dz=end.z-origin.z;
  const t=THREE.MathUtils.clamp(((position.x-origin.x)*dx+(position.z-origin.z)*dz)/(dx*dx+dz*dz),0,1);
  return Math.hypot(position.x-origin.x-dx*t,position.z-origin.z-dz*t)<radius+3;
}
