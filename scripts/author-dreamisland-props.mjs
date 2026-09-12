/**
 * Phase F §4.2 — author `src/game/data/dreamisland/props.json`.
 *
 *   node scripts/author-dreamisland-props.mjs [--out=PATH]
 *
 * The placements are DERIVED from `route.json` rather than typed, so the count
 * per kind, the spacing and the laterals are all consequences of the route the
 * map actually has, and re-running this regenerates the file byte for byte (the
 * only randomness is a seeded mulberry32, and the seed is in this file).
 *
 * Route space, exactly as `fish-paths.json` uses it: `{kind, progress, lateral,
 * rise, yaw, scale, anchor}`.
 *
 *   anchor "deck"   rise is metres above the road deck at that progress
 *   anchor "ground" rise is metres above the painted ground under the point,
 *                   found by the same downward ray the power-kit feet use
 *   anchor "water"  rise is metres above the sea plane at y = -1.2
 *
 * `anchor` is the one field the brief's list does not name. It exists because
 * the island is not flat: COURT falls 14 m over its own length and BEACH is at
 * zero, so a single rise convention would either bury the beach balls or float
 * the court's. Every other field is the brief's.
 *
 * THE CORRIDOR RULE IS ENFORCED HERE AND AGAIN AT RUNTIME. Nothing is authored
 * over the deck at all: every prop's lateral is outside the road's half width
 * plus its own half extent, except the bollards, which stand on the verge at
 * halfWidth + 1.2 m. `dreamisland-props.ts` re-checks it against the built
 * geometry and throws, and `validate-dreamisland-painted.mjs` checks it a third
 * time from the data alone.
 */
import {readFileSync,writeFileSync} from 'node:fs';

const flag=name=>process.argv.find(a=>a.startsWith('--'+name+'='))?.slice(name.length+3);
const out=flag('out')??'src/game/data/dreamisland/props.json';
const route=JSON.parse(readFileSync('src/game/data/dreamisland/route.json','utf8'));

const mulberry32=seed=>()=>{
 seed|=0;seed=seed+0x6D2B79F5|0;
 let t=Math.imul(seed^seed>>>15,1|seed);
 t=t+Math.imul(t^t>>>7,61|t)^t;
 return ((t^t>>>14)>>>0)/4294967296;
};
const random=mulberry32(0x0d1a1e);
const between=(low,high)=>low+(high-low)*random();
const round=(value,places=4)=>Number(value.toFixed(places));

const halfWidthAt=progress=>{
 const scaled=((progress%1)+1)%1*route.count;
 const i=Math.floor(scaled),j=(i+1)%route.count,alpha=scaled-i;
 return (route.stations[i].width+(route.stations[j].width-route.stations[i].width)*alpha)/2;
};
const sectorAt=progress=>route.stations[Math.floor(((progress%1)+1)%1*route.count)].sector;
const districtSpan=id=>{
 const index=route.districts.findIndex(d=>d.id===id);
 return [route.districts[index].from,route.districts[index+1]?.from??1];
};

const props=[];
const add=(kind,progress,lateral,rise,yaw,scale,anchor)=>props.push({
 kind,progress:round(progress,6),lateral:round(lateral,3),rise:round(rise,3),
 yaw:round(yaw,4),scale:round(scale,3),anchor});

// --- bollards: both edges, every 24 m, at halfWidth + 1.2 m -------------------
const BOLLARD_SPACING=24,BOLLARD_OFFSET=1.2;
for(let distance=0;distance<route.length;distance+=BOLLARD_SPACING){
 const progress=distance/route.length,half=halfWidthAt(progress);
 for(const side of [-1,1])add('PR_bollard',progress,side*(half+BOLLARD_OFFSET),0,0,1,'deck');
}

// --- beach balls and rings ----------------------------------------------------
//
// ROUND 2, item 4. The first pass put every toy 14-34 m from the road centre,
// where the chase camera renders them as dots; the reference painting has them
// at the road's edge. The band below is the brief's: at least 60 % of balls and
// rings inside halfWidth + 1.5 .. + 10 m. This authors 68 % there (30 of 44
// balls, 19 of 28 rings) and leaves the rest in the water, because a beach with
// every ball in a line along the kerb is not a beach.
//
// The near band is anchored to the DECK, not to a ground ray. Beside the road
// the verge is at deck height by construction, and the REEF's verge is water
// two metres out - a downward ray there finds nothing and would drop the toy to
// whatever the fallback was. A deck anchor cannot fail that way.
//
// The minimum offset is 2.0 m rather than the brief's 1.5, and the scales are
// capped, so that the widest toy still clears the road: a ball at scale 2.2 is
// 3.3 m across, so its half-extent is 1.65 m and 2.0 - 1.65 = 0.35 m of the
// deck edge is still free. The bollards stand at halfWidth + 1.2 m with a
// 0.2 m radius, so the toys clear those too.
//
// The band's outer edge and the scales are where they are because of a
// MEASUREMENT, not a preference: at 9.5 m and scale 1.25-1.9 the REEF pose
// produced three toys of 20 px or more against a gate of four (50, 38 and
// 21 px). Pulling the band in to 8 m and the scale up to 1.5-2.2 is what put it
// over. `round-2/toys/toys.json` carries both runs' counts.
const NEAR_MIN=2.0,NEAR_MAX=8.0;
const BALL_SCALE=[1.5,2.2];    // props.glb ball is 1.5 m across at scale 1
const RING_SCALE=[1.15,1.5];   // and the ring 2.2 m
/**
 * THE NEAR BAND IS A GRID, NOT A SCATTER, and that is the whole reason this
 * acceptance is stable.
 *
 * The first three attempts at item 4 scattered the near toys inside each
 * district and then counted how many were 20 px tall or more at one pinned pose
 * per district. Every change to a count re-rolled the seeded generator and
 * re-rolled the answer with it: 4/4/3, then 5/5/3, then 5/3/4, then 4/7/2. That
 * is not a placement being tuned, it is a die being thrown, and a gate passed
 * that way would say nothing about the next pose.
 *
 * So the near toys sit on an even grid of one every NEAR_SPACING metres of
 * road, shared between balls and rings, with no jitter along the road at all.
 * Lateral, scale and yaw stay random. The number of toys in front of the camera
 * is then a property of the spacing and the draw distance, the same everywhere
 * on the lap, and the count at a pose stops depending on the seed.
 */
const NEAR_SPACING=16;
const TOY_ZONES=[
 {district:'BEACH',balls:12,rings:8,water:true,far:[14,30]},
 {district:'COURT',balls:15,rings:10,water:false,far:[15,26]},
 {district:'REEF',balls:17,rings:10,water:true,far:[16,34]},
];
let nearToys=0,farToys=0;
for(const zone of TOY_ZONES){
 const [from,to]=districtSpan(zone.district);
 const metres=(to-from)*route.length;
 const slots=Math.floor(metres/NEAR_SPACING);
 // Balls and rings share the grid in the ratio their counts are in, so a
 // district never runs out of one kind halfway along its own verge.
 const ringEvery=Math.max(2,Math.round((zone.balls+zone.rings)/Math.max(1,zone.rings)));
 let ballsLeft=zone.balls,ringsLeft=zone.rings;
 for(let slot=0;slot<slots;slot++){
  const wantsRing=slot%ringEvery===ringEvery-1;
  const kind=(wantsRing&&ringsLeft>0)||ballsLeft===0?'PR_ring':'PR_ball';
  if(kind==='PR_ring'&&ringsLeft===0)break;
  if(kind==='PR_ball'&&ballsLeft===0)break;
  const progress=from+(to-from)*(slot+.5)/slots;
  const half=halfWidthAt(progress);
  const size=kind==='PR_ball'?between(BALL_SCALE[0],BALL_SCALE[1]):between(RING_SCALE[0],RING_SCALE[1]);
  // The offset carries the toy's OWN reach rather than a constant, so the rule
  // holds at any scale this file authors and does not depend on this script's
  // half-width interpolation agreeing with the course's to the centimetre. The
  // runtime's corridor guard refused an earlier version for exactly that:
  // "PR_ball at progress 0.1061 lateral 14.23 clears the deck by -2.494 m".
  const reach=(kind==='PR_ball'?.75:1.1)*size;
  const side=random()<.5?-1:1;
  const lateral=side*(half+Math.max(NEAR_MIN,reach+.7)+between(0,NEAR_MAX-NEAR_MIN));
  const rise=kind==='PR_ball'?.75*size:.25*size;
  add(kind,progress,lateral,rise,between(0,Math.PI*2),size,'deck');
  if(kind==='PR_ball')ballsLeft--;else ringsLeft--;
  nearToys++;
 }
 // Whatever the grid did not use goes in the water, which is where the painting
 // has the rest of them.
 for(const [kind,left,scale] of [['PR_ball',ballsLeft,BALL_SCALE],['PR_ring',ringsLeft,RING_SCALE]]){
  for(let i=0;i<left;i++){
   const progress=from+(to-from)*((i+.5)/Math.max(1,left)+between(-.22,.22)/Math.max(1,left));
   const half=halfWidthAt(progress);
   const size=between(scale[0],scale[1]);
   const reach=(kind==='PR_ball'?.75:1.1)*size;
   const side=random()<.5?-1:1;
   // The far band is an ABSOLUTE lateral, because it puts toys in the water and
   // the water is where it is; it still cannot reach back over the deck.
   const lateral=side*Math.max(between(zone.far[0],zone.far[1]),half+reach+1.0);
   const rise=zone.water?(kind==='PR_ball'?.1:.0):(kind==='PR_ball'?.75*size:.25*size);
   add(kind,progress,lateral,rise,between(0,Math.PI*2),size,zone.water?'water':'ground');
   farToys++;
  }
 }
}

// --- chrome spheres -----------------------------------------------------------
//
// ROUND 2, item 4: at least a third of them within halfWidth + 2 .. + 12 m at
// 2-6 m of height, where they are the thing the painting has hanging over the
// verge; the rest keep the three heights of the first pass, further out.
const SPHERE_HEIGHTS=[2.4,7.5,15];
const SPHERE_ZONES=[
 {district:'BEACH',count:18,near:8,water:true},
 {district:'REEF',count:18,near:8,water:true},
 {district:'COURT',count:12,near:5,water:false},
 {district:'GROVE',count:6,near:2,water:false},
 {district:'CUT',count:6,near:2,water:false},
];
let nearSpheres=0,farSpheres=0;
for(const zone of SPHERE_ZONES){
 const [from,to]=districtSpan(zone.district);
 for(let i=0;i<zone.count;i++){
  const progress=from+(to-from)*((i+.5)/zone.count+between(-.3,.3)/zone.count);
  const half=halfWidthAt(progress);
  const side=random()<.5?-1:1;
  if(i<zone.near){
   add('PR_sphere',progress,side*(half+between(2,12)),between(2,6),
    between(0,Math.PI*2),between(.9,1.5),'deck');
   nearSpheres++;
  }else{
   add('PR_sphere',progress,side*(half+between(8,26)),SPHERE_HEIGHTS[i%SPHERE_HEIGHTS.length],
    between(0,Math.PI*2),between(.8,1.5),zone.water?'water':'ground');
   farSpheres++;
  }
 }
}

// --- one pipes sculpture per district, on its shore, each on a plinth ---------
for(const district of route.districts){
 const [from,to]=districtSpan(district.id);
 const progress=from+(to-from)*.5;
 const half=halfWidthAt(progress);
 const side=sectorAt(progress)==='REEF'||sectorAt(progress)==='BEACH'?1:-1;
 const lateral=side*(half+between(11,17));
 const yaw=between(0,Math.PI*2);
 // The plinth's own measured height, from props.glb: 1.26 m at scale 1, so the
 // sculpture stands ON it at 1.26 * 1.2 rather than half inside it. Taken from
 // `report.boundsMetres` in the runtime, not from the Blender script.
 add('PR_plinth',progress,lateral,0,yaw,1.2,'ground');
 add('PR_pipes',progress,lateral,1.512,yaw,1,'ground');
}

const counts={};
for(const prop of props)counts[prop.kind]=(counts[prop.kind]??0)+1;
const document_={
 note:'Generated by scripts/author-dreamisland-props.mjs. Do not hand-edit; re-run the script.',
 seed:'0x0d1a1e',
 seaLevelMetres:-1.2,
 /** The corridor rule this data is authored to, re-checked at runtime and in
  * the validator. Nothing may be over the deck below this height. */
 corridorClearanceMetres:8.85,
 bollardSpacingMetres:BOLLARD_SPACING,bollardEdgeOffsetMetres:BOLLARD_OFFSET,
 counts,props,
 /** Round 2, item 4: the fractions the brief sets, computed rather than claimed. */
 placement:{
  nearBandMetres:[NEAR_MIN,NEAR_MAX],
  toysNear:nearToys,toysFar:farToys,
  toysNearFraction:round(nearToys/(nearToys+farToys),4),
  ballDiameterMetresRange:[round(1.5*BALL_SCALE[0],3),round(1.5*BALL_SCALE[1],3)],
  spheresNear:nearSpheres,spheresFar:farSpheres,
  spheresNearFraction:round(nearSpheres/(nearSpheres+farSpheres),4),
 },
};
writeFileSync(out,JSON.stringify(document_,null,1)+'\n');
console.log(JSON.stringify({out,total:props.length,counts}));
