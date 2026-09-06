import * as THREE from 'three';
import {ABILITY_TICK_RATE} from './polarity-simulation.js';
export const CRAWLER_CROSSING_TICKS=6*ABILITY_TICK_RATE;
export const BELT_LENGTH=16+2*Math.PI*1.9;
/** @param {number} distance */
export function beltPose(distance){
 const d=THREE.MathUtils.euclideanModulo(distance,BELT_LENGTH);
 if(d<8)return {y:3.9,z:-4+d,angle:0};
 if(d<8+Math.PI*1.9){const a=Math.PI/2-(d-8)/1.9;return {y:2+1.9*Math.sin(a),z:4+1.9*Math.cos(a),angle:Math.PI/2-a};}
 if(d<16+Math.PI*1.9)return {y:.1,z:4-(d-8-Math.PI*1.9),angle:Math.PI};
 const a=-Math.PI/2-(d-16-Math.PI*1.9)/1.9;return {y:2+1.9*Math.sin(a),z:-4+1.9*Math.cos(a),angle:Math.PI/2-a};
}
/** Shared by rendering and the painted moving-envelope validator. */
export class AscensionEventPose {
 /** @param {{events:{id:string,tick:number}[],launchTick:number,rocketGoneTick:number}} config @param {THREE.Vector3} crawlerOrigin */
 constructor(config,crawlerOrigin){
  this.config=config;this.crossings=config.events.filter(e=>e.id.startsWith('crawler-cross'));
  // Same horizontal 100 m path approved in A, represented as a spline.
  this.spline=new THREE.CatmullRomCurve3([-50,-25,0,25,50].map(x=>crawlerOrigin.clone().add(new THREE.Vector3(x,0,0))),false,'centripetal');
 }
 /** @param {number} tick */
 at(tick){
  let u=0,travel=0,moving=false;
  for(const [i,event] of this.crossings.entries()){
   if(tick<event.tick)break;
   const fraction=THREE.MathUtils.clamp((tick-event.tick)/CRAWLER_CROSSING_TICKS,0,1);
   u=i%2===0?fraction:1-fraction;travel+=(i%2===0?1:-1)*fraction*100;moving=fraction<1;
  }
  const launch=THREE.MathUtils.clamp((tick-this.config.launchTick)/(this.config.rocketGoneTick-this.config.launchTick),0,1);
  const arms=THREE.MathUtils.smoothstep(tick,this.config.launchTick-2*ABILITY_TICK_RATE,this.config.launchTick);
  return {crawler:this.spline.getPoint(u),travel,moving,launch,rocketHeight:1200*launch*launch,armAngle:arms*Math.PI*.48,klaxon:this.crossings.some(e=>tick>=e.tick-3*ABILITY_TICK_RATE&&tick<e.tick)};
 }
}
