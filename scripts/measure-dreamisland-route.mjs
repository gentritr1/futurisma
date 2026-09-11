/**
 * Read-only instrument over `src/game/data/dreamisland/route.json`.
 *
 * The route validator reports one global minimum radius; the GROVE esses are a
 * per-district requirement, and a district-level sweeper hides behind a tight
 * chicane somewhere else in the lap. This prints the minimum radius, the
 * signed-curvature sign changes and the resulting alternating turns for EVERY
 * district, so a curvature-schedule revision can be measured rather than argued.
 *
 *   node scripts/measure-dreamisland-route.mjs [--out=path.json]
 *
 * A "turn" here is a maximal run of stations whose |curvature| stays above
 * `--floor` (default .0045 = a 222 m radius) with one sign; the run's tightest
 * station gives its radius. Runs shorter than `--minimum-metres` (default 25 m)
 * are noise from the spline resample and are not counted.
 */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
const flag=(name,fallback)=>{const hit=process.argv.find(a=>a.startsWith('--'+name+'='));return hit===undefined?fallback:hit.slice(name.length+3);};
const FLOOR=Number(flag('floor',.0045)),MINIMUM=Number(flag('minimum-metres',25));
const route=JSON.parse(readFileSync(new URL('../src/game/data/dreamisland/route.json',import.meta.url),'utf8'));
const districts=route.districts.map((district,index)=>({
 id:district.id,name:district.name,width:district.width,
 fromMetres:district.from*route.length,
 toMetres:(route.districts[index+1]?.from??1)*route.length,
}));
for(const district of districts){
 const stations=route.stations.filter(s=>s.d>=district.fromMetres&&s.d<district.toMetres);
 district.lengthMetres=district.toMetres-district.fromMetres;
 district.stations=stations.length;
 district.maximumCurvature=Math.max(...stations.map(s=>Math.abs(s.curvature)));
 district.minimumRadiusMetres=1/district.maximumCurvature;
 district.maximumPitchDegrees=Math.max(...stations.map(s=>Math.abs(Math.asin(s.t[1]))))*180/Math.PI;
 district.foldGuard=district.maximumCurvature*district.width/2;
 const turns=[];
 let run=null;
 for(const station of stations){
  const sign=Math.abs(station.curvature)>FLOOR?Math.sign(station.curvature):0;
  if(sign===0||(run&&run.sign!==sign)){if(run)turns.push(run);run=null;}
  if(sign===0)continue;
  if(!run)run={sign,fromMetres:station.d,toMetres:station.d,peak:0};
  run.toMetres=station.d;run.peak=Math.max(run.peak,Math.abs(station.curvature));
 }
 if(run)turns.push(run);
 district.turns=turns.filter(t=>t.toMetres-t.fromMetres>=MINIMUM).map(t=>({
  direction:t.sign<0?'RIGHT':'LEFT',fromMetres:t.fromMetres,toMetres:t.toMetres,
  lengthMetres:t.toMetres-t.fromMetres,radiusMetres:1/t.peak,
  netTurnDegrees:(t.toMetres-t.fromMetres)*t.peak*(2/Math.PI)*t.sign*180/Math.PI,
 }));
 district.alternations=district.turns.filter((t,i)=>i>0&&t.direction!==district.turns[i-1].direction).length;
}
const report={script:'scripts/measure-dreamisland-route.mjs',
 route:{lengthMetres:route.length,stations:route.count,revision:route.revision},
 turnFloorCurvature:FLOOR,turnFloorRadiusMetres:1/FLOOR,minimumRunMetres:MINIMUM,
 globalMinimumRadiusMetres:1/Math.max(...route.stations.map(s=>Math.abs(s.curvature))),
 districts:districts.map(({fromMetres,toMetres,...rest})=>({fromMetres,toMetres,...rest}))};
const out=flag('out',null);
if(out){mkdirSync(new URL('.',new URL(out,import.meta.url)),{recursive:true});writeFileSync(new URL(out,import.meta.url),JSON.stringify(report,null,2));}
console.log(JSON.stringify(report,(key,value)=>key==='stations'&&Array.isArray(value)?undefined:value,2));
