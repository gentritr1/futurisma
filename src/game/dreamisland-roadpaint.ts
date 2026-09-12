import * as THREE from 'three';
import route from './data/dreamisland/route.json';
import {DREAMISLAND_ABILITY_CONFIG} from './dreamisland-powers-config.js';
import type {DreamIslandCourse} from './dreamisland-course';

/**
 * Phase F §4.1 — the road paint, as ONE vertex-coloured decal mesh.
 *
 * The playtest's first finding was that a 26 m road with nothing on it reads as
 * a runway, not a circuit. This adds the four markings the reference paintings
 * carry, and nothing else:
 *
 *   - white edge lines, 0.25 m wide, at +/-(halfWidth - 0.6 m), the whole lap;
 *   - a dashed white centre line, 3 m of paint and 6 m of gap, everywhere
 *     except the BASIN causeway, which is wet and stays plain;
 *   - red/white kerb blocks, 1.2 m wide and 2 m long, on the INSIDE of every
 *     bend whose curvature exceeds the lap's MEDIAN curvature;
 *   - cyan chevrons 4 m wide every 10 m for 60 m before each of the five
 *     pickups, so the capsule is announced by the road before it is seen.
 *
 * THE THRESHOLD IS MEASURED, NOT CHOSEN. `report.medianCurvature` is the median
 * of |curvature| over all 800 route stations, computed here at build time, and
 * `report.bends` lists exactly what it selected. Nothing in this file contains
 * a curvature number typed by hand.
 *
 * ONE DRAW. Every marking is the same unlit-by-texture, vertex-coloured Lambert
 * material, so red, white and cyan cost one draw between them rather than three.
 * `toneMapped` and `fog` stay at their defaults, as the render-rule audit
 * requires, and `polygonOffset` — not a larger rise — is what stops the z-fight:
 * at 2 cm above a deck seen from 11.5 m back, depth precision, not geometry, is
 * the thing that decides which surface wins.
 *
 * WHERE A KERB RUN EXISTS THE EDGE LINE STOPS. Two coplanar decals 2 cm above
 * the same deck z-fight with each other whatever the polygon offset is, because
 * the offset moves both of them by the same amount. Real circuits do the same
 * thing for the same reason: the kerb replaces the line through the bend.
 */
const RISE=.02;
const EDGE_INSET=.6,EDGE_WIDTH=.25;
const DASH_METRES=3,GAP_METRES=6;
const KERB_WIDTH=1.2,KERB_BLOCK_METRES=2,KERB_EDGE_INSET=.05;
const CHEVRON_WIDTH=4,CHEVRON_SPACING=10,CHEVRON_RUN=60,CHEVRON_DEPTH=2.4,CHEVRON_BAR=.9;
const WHITE=new THREE.Color(0xf2f4f0),RED=new THREE.Color(0xd2402f),CYAN=new THREE.Color(0x35e6ff);
const UP=new THREE.Vector3(0,1,0);

type Bend={from:number;to:number;metres:number;peakCurvature:number;insideSign:number;
 side:'LEFT'|'RIGHT';curvatureSign:number;blocks:number};

export class DreamIslandRoadPaint{
 readonly root=new THREE.Group();
 readonly mesh:THREE.Mesh;
 /** Zero on every field if the module built nothing, which is what makes a
  * silent no-op visible in the diagnostics blob rather than invisible. */
 readonly report={draws:0,triangles:0,medianCurvature:0,curvatureSamples:0,
  edgeSegments:0,dashes:0,kerbBlocks:0,chevrons:0,
  bends:[] as Bend[],chevronRuns:[] as {pickup:string;progress:number;chevrons:number}[],
  /** Every station whose |curvature| is above the median is in a bend; this is
   * how much of the lap that is, so "the median" can be read as a length. */
  bendMetres:0,
  /** Set if the geometric inside of a bend and the sign of `curvature` ever
   * disagree. It should stay zero; if it does not, one of the two is wrong and
   * the kerbs are on the wrong side of the road. */
  insideSignDisagreements:0};
 constructor(course:DreamIslandCourse){
  this.root.name='dreamisland_road_paint';
  const positions:number[]=[],colors:number[]=[],indices:number[]=[];
  const scratch=new THREE.Vector3();
  const sampleAt=(progress:number)=>course.sample(THREE.MathUtils.euclideanModulo(progress,1));
  /** One quad of paint between two progress values and two laterals. */
  const strip=(fromProgress:number,toProgress:number,inner:number,outer:number,
   color:THREE.Color,steps=1)=>{
   const base=positions.length/3;
   for(let i=0;i<=steps;i++){
    const sample=sampleAt(fromProgress+(toProgress-fromProgress)*i/steps);
    for(const lateral of [inner,outer]){
     scratch.copy(sample.position).addScaledVector(sample.right,lateral).addScaledVector(sample.up,RISE);
     positions.push(scratch.x,scratch.y,scratch.z);colors.push(color.r,color.g,color.b);
    }
   }
   for(let i=0;i<steps;i++){
    const k=base+i*2;
    // Winding follows the sign of the lateral span, exactly as the water's
    // ribbons do: a band authored from a larger lateral to a smaller one runs
    // the other way round the quad and would face DOWN under backface culling.
    if(outer<inner)indices.push(k,k+3,k+1,k,k+2,k+3);
    else indices.push(k,k+1,k+3,k,k+3,k+2);
   }
   return (positions.length/3-base)/2-1;
  };
  /** A free triangle in road space, for the chevron heads. */
  const triangle=(points:{progress:number;lateral:number}[],color:THREE.Color)=>{
   const base=positions.length/3;
   for(const point of points){
    const sample=sampleAt(point.progress);
    scratch.copy(sample.position).addScaledVector(sample.right,point.lateral).addScaledVector(sample.up,RISE);
    positions.push(scratch.x,scratch.y,scratch.z);colors.push(color.r,color.g,color.b);
   }
   indices.push(base,base+1,base+2);
  };

  // ---- the measured curvature threshold -------------------------------------
  const magnitudes=route.stations.map(s=>Math.abs(s.curvature)).sort((a,b)=>a-b);
  const median=magnitudes.length%2
   ?magnitudes[(magnitudes.length-1)/2]
   :(magnitudes[magnitudes.length/2-1]+magnitudes[magnitudes.length/2])/2;
  this.report.medianCurvature=median;this.report.curvatureSamples=magnitudes.length;

  // ---- bends: contiguous runs of stations above the median ------------------
  const bends:Bend[]=[];
  const insideSignAt=(index:number)=>{
   // The inside of a bend is the direction the tangent is turning towards, so
   // it is read off the geometry (dT/ds projected on `right`) rather than off a
   // sign convention. The curvature sign is compared against it below.
   const previous=new THREE.Vector3(...route.stations[(index-1+route.count)%route.count].t);
   const next=new THREE.Vector3(...route.stations[(index+1)%route.count].t);
   const tangent=new THREE.Vector3(...route.stations[index].t).normalize();
   const right=tangent.clone().cross(UP).normalize();
   return Math.sign(next.sub(previous).dot(right))||1;
  };
  for(let i=0;i<route.count;i++){
   if(Math.abs(route.stations[i].curvature)<=median)continue;
   let end=i;
   while(end+1<route.count&&Math.abs(route.stations[end+1].curvature)>median)end++;
   let peak=0,peakIndex=i;
   for(let k=i;k<=end;k++){
    if(Math.abs(route.stations[k].curvature)>peak){peak=Math.abs(route.stations[k].curvature);peakIndex=k;}
   }
   const insideSign=insideSignAt(peakIndex);
   const curvatureSign=Math.sign(route.stations[peakIndex].curvature)||1;
   if(insideSign!==-curvatureSign)this.report.insideSignDisagreements++;
   const from=route.stations[i].d,to=route.stations[end].d;
   // A bend one station long is 3 m of road; it cannot hold a 2 m kerb block
   // with any margin, so it is counted as a bend and left unpainted.
   bends.push({from,to,metres:to-from,peakCurvature:peak,insideSign,
    side:insideSign>0?'RIGHT':'LEFT',curvatureSign,blocks:0});
   i=end;
  }

  // ---- 1. edge lines, minus whatever the kerbs cover ------------------------
  /** Metres of road, per side, that a kerb run owns. */
  const kerbSpans:{side:number;from:number;to:number}[]=[];
  for(const bend of bends){
   if(bend.metres<KERB_BLOCK_METRES)continue;
   kerbSpans.push({side:bend.insideSign,from:bend.from,to:bend.to});
  }
  for(const side of [-1,1]){
   const covered=kerbSpans.filter(span=>span.side===side).sort((a,b)=>a.from-b.from);
   let cursor=0;
   const runs:[number,number][]=[];
   for(const span of covered){
    if(span.from>cursor)runs.push([cursor,span.from]);
    cursor=Math.max(cursor,span.to);
   }
   if(cursor<route.length)runs.push([cursor,route.length]);
   for(const [from,to] of runs){
    // One segment per route station keeps the line on a road that is re-sampled
    // 800 times a lap; a coarser strip cuts corners across the bends.
    const steps=Math.max(1,Math.round((to-from)/3));
    const laterals=(progress:number)=>{
     const halfWidth=sampleAt(progress).halfWidth;
     return [side*(halfWidth-EDGE_INSET-EDGE_WIDTH/2),side*(halfWidth-EDGE_INSET+EDGE_WIDTH/2)] as const;
    };
    // Width follows the road, so the strip is built segment by segment rather
    // than as one quad with two laterals: BEACH is 26 m and POINT is 14 m.
    for(let i=0;i<steps;i++){
     const a=(from+(to-from)*i/steps)/route.length,b=(from+(to-from)*(i+1)/steps)/route.length;
     const [innerA,outerA]=laterals(a),[innerB,outerB]=laterals(b);
     const base=positions.length/3;
     for(const [progress,inner,outer] of [[a,innerA,outerA],[b,innerB,outerB]] as const){
      const sample=sampleAt(progress);
      for(const lateral of [inner,outer]){
       scratch.copy(sample.position).addScaledVector(sample.right,lateral).addScaledVector(sample.up,RISE);
       positions.push(scratch.x,scratch.y,scratch.z);colors.push(WHITE.r,WHITE.g,WHITE.b);
      }
     }
     if(side<0)indices.push(base,base+3,base+1,base,base+2,base+3);
     else indices.push(base,base+1,base+3,base,base+3,base+2);
     this.report.edgeSegments++;
    }
   }
  }

  // ---- 2. the dashed centre line, not on the causeway -----------------------
  const causeway=route.districts.findIndex(d=>d.id==='BASIN');
  const causewayFrom=route.districts[causeway].from*route.length;
  const causewayTo=(route.districts[causeway+1]?.from??1)*route.length;
  for(let distance=0;distance+DASH_METRES<route.length;distance+=DASH_METRES+GAP_METRES){
   const end=distance+DASH_METRES;
   if(end>causewayFrom&&distance<causewayTo)continue;
   strip(distance/route.length,end/route.length,-.09,.09,WHITE,2);
   this.report.dashes++;
  }

  // ---- 3. kerb blocks on the inside of the selected bends --------------------
  for(const bend of bends){
   if(bend.metres<KERB_BLOCK_METRES)continue;
   const count=Math.floor(bend.metres/KERB_BLOCK_METRES);
   for(let block=0;block<count;block++){
    const from=(bend.from+block*KERB_BLOCK_METRES)/route.length;
    const to=(bend.from+(block+1)*KERB_BLOCK_METRES)/route.length;
    const half=sampleAt((from+to)/2).halfWidth;
    const outer=bend.insideSign*(half-KERB_EDGE_INSET);
    const inner=bend.insideSign*(half-KERB_EDGE_INSET-KERB_WIDTH);
    strip(from,to,inner,outer,block%2?WHITE:RED,1);
    this.report.kerbBlocks++;bend.blocks++;
   }
   this.report.bendMetres+=bend.metres;
  }
  this.report.bends=bends;

  // ---- 4. chevrons before each pickup ---------------------------------------
  for(const pickup of DREAMISLAND_ABILITY_CONFIG.pickups){
   const at=pickup.progress*route.length;
   let drawn=0;
   for(let back=CHEVRON_RUN;back>0;back-=CHEVRON_SPACING){
    const tip=(at-back)/route.length;
    const tail=(at-back-CHEVRON_DEPTH)/route.length;
    const tailBar=(at-back-CHEVRON_DEPTH-CHEVRON_BAR)/route.length;
    const tipBar=(at-back+CHEVRON_BAR)/route.length;
    const half=CHEVRON_WIDTH/2,lane=pickup.lateral??0;
    // A chevron is an arrowhead: two swept bars meeting on the centre of the
    // lane the capsule hovers over, so the paint points at the thing it means.
    for(const side of [-1,1]){
     triangle([{progress:tip,lateral:lane},{progress:tail,lateral:lane+side*half},
      {progress:tailBar,lateral:lane+side*half}],CYAN);
     triangle([{progress:tip,lateral:lane},{progress:tailBar,lateral:lane+side*half},
      {progress:tipBar,lateral:lane}],CYAN);
    }
    drawn++;this.report.chevrons++;
   }
   this.report.chevronRuns.push({pickup:pickup.id,progress:pickup.progress,chevrons:drawn});
  }

  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const material=new THREE.MeshLambertMaterial({name:'dreamisland_road_paint',vertexColors:true,
   polygonOffset:true,polygonOffsetFactor:-4,polygonOffsetUnits:-8,side:THREE.DoubleSide});
  this.mesh=new THREE.Mesh(geometry,material);
  this.mesh.name='dreamisland_road_paint';
  this.mesh.frustumCulled=false;this.mesh.receiveShadow=false;this.mesh.castShadow=false;
  this.root.add(this.mesh);
  this.report.draws=1;
  this.report.triangles=indices.length/3;
 }
 dispose(){
  this.mesh.geometry.dispose();(this.mesh.material as THREE.Material).dispose();
  this.root.removeFromParent();
 }
}
