/**
 * Phase F §4.3 — extend `src/game/data/dreamisland/fish-paths.json` from two
 * shoals to eight.
 *
 *   node scripts/author-dreamisland-shoals.mjs
 *
 * The two shipped shoals are left byte-identical; six more are appended. Each
 * carries four fish, drifts on a closed path that crosses the road, and names
 * `source` — the shipped shoal whose baked geometry it instances, because
 * `painted.glb` is the 3D track's file and cannot grow a new batch in this
 * pass. `dreamisland-fish.ts` reads `source` and puts all six into ONE
 * `InstancedMesh` per material, so six new shoals cost two draws, not twelve.
 *
 * THE FISH OFFSETS ARE THE SOURCE SHOAL'S OWN, in route space. That is not a
 * shortcut: the geometry actually rendered IS the source shoal's cluster, so
 * authoring any other arrangement would make the clearance the validator
 * measures a measurement of something the player never sees. The vertical part
 * of the offset maps one-to-one onto world Y, so the clearance number is exact;
 * only the horizontal footprint rotates with the road, by a few tenths of a
 * metre over a 30 m shoal.
 *
 * Every new shoal declares `minimumDeckClearanceMetres`, which
 * `validate-dreamisland-runtime.mjs` asserts per shoal — that is the 8.85 m
 * corridor rule, applied to the fish that now fly over the road.
 */
import {readFileSync,writeFileSync} from 'node:fs';

const path='src/game/data/dreamisland/fish-paths.json';
const data=JSON.parse(readFileSync(path,'utf8'));
const shipped=data.shoals.filter(shoal=>!shoal.source);
const source=shipped.find(shoal=>shoal.id==='reef-loop');
if(!source)throw Error('reef-loop is the geometry source and is not in fish-paths.json');

/** The six crossings, one line per shoal: where it crosses, how wide the loop
 * is, and how long it takes. The districts are the brief's: GROVE, COURT, REEF
 * and CUT. */
const CROSSINGS=[
 {id:'grove-cross',sector:'GROVE',centre:.170,span:.013,reach:40,period:38},
 {id:'court-cross',sector:'COURT',centre:.575,span:.014,reach:44,period:43},
 {id:'court-arc',sector:'COURT',centre:.622,span:.011,reach:36,period:51},
 {id:'reef-cross',sector:'REEF',centre:.702,span:.013,reach:42,period:47},
 {id:'reef-arc',sector:'REEF',centre:.792,span:.012,reach:38,period:55},
 {id:'cut-cross',sector:'CUT',centre:.908,span:.012,reach:40,period:41},
];
/**
 * The height of the whole loop, in metres above the deck. It is not a taste
 * number: the corridor floor is 8.85 m, the goldfish body hangs 1.507 m below
 * its own origin (measured off the export, `fishLowestPointMetres`), and the
 * lowest fish of the source cluster sits 0.4 m below the shoal origin, so the
 * floor demands 8.85 + 1.507 + 0.4 = 10.757 m. 11.6 leaves 0.84 m for the
 * closed Catmull-Rom to overshoot into, and the validator measures what is
 * left rather than trusting the arithmetic.
 */
const LOOP_RISE=11.6;
const REST_LATERAL=-52,REST_RISE=-6;
const POINTS=16;
const round=(value,places)=>Number(value.toFixed(places));

const added=CROSSINGS.map(crossing=>{
 const restProgress=crossing.centre;
 const rest={progress:round(restProgress,5),lateral:REST_LATERAL,rise:REST_RISE};
 const fish=source.fish.map(entry=>({
  livery:entry.livery,
  progress:round(rest.progress+(entry.progress-source.rest.progress),5),
  lateral:round(rest.lateral+(entry.lateral-source.rest.lateral),3),
  rise:round(rest.rise+(entry.rise-source.rest.rise),3),
  yaw:entry.yaw,
 }));
 const loop=[];
 for(let i=0;i<POINTS;i++){
  const angle=i/POINTS*Math.PI*2;
  loop.push({progress:round(crossing.centre+crossing.span*Math.cos(angle),5),
   lateral:round(crossing.reach*Math.sin(angle),3),rise:LOOP_RISE});
 }
 return {id:crossing.id,batch:'FISH'+crossing.id.toUpperCase().replace(/[^A-Z]/g,''),
  source:source.id,sector:crossing.sector,periodSeconds:crossing.period,
  startHeadingYaw:source.startHeadingYaw,minimumDeckClearanceMetres:8.85,
  rest,fish,path:loop};
});

data.shoals=[...shipped,...added];
data.instancedShoals=added.length;
writeFileSync(path,JSON.stringify(data,null,1)+'\n');
console.log(JSON.stringify({shoals:data.shoals.length,added:added.map(s=>s.id),loopRise:LOOP_RISE}));
