/**
 * The one-station sector label lag, measured rather than asserted.
 *
 *   node scripts/visual/dreamisland/label-lag.mjs
 *
 * `sample().sector` reads `route.stations[floor(progress * count)].sector` and
 * `sectorLabelAt()` reads the district table by `progress >= district.from`.
 * The two disagree at exactly one station out of 800, because
 * `euclideanModulo(227/800, 1) * 800` is 226.99999999999997 and floors to 226,
 * so the sample takes the PREVIOUS district's name for one 3 m station while
 * the HUD has already moved on.
 *
 * It is left alone. The same shape is in `tideline-course.ts` and
 * `ascension-course.ts` and fixing it here would put this map's sampling out of
 * step with both; nothing on this map turns on it either, because grip differs
 * only in BASIN and the seam in question is GROVE into POINT. This script exists
 * so the claim "one station" stays a measurement.
 */
import {readFileSync} from 'node:fs';
import {sourceModule} from './modules.mjs';
const route=JSON.parse(readFileSync('src/game/data/dreamisland/route.json','utf8'));
const {DreamIslandCourse}=await import(await sourceModule('dreamisland-course.ts'));
const course=new DreamIslandCourse();
const ID=Object.fromEntries(route.districts.map(district=>[district.name,district.id]));
const rows=[];
for(let index=0;index<route.count;index++){
 const progress=index/route.count;
 const sampled=course.sample(progress).sector,labelled=ID[course.sectorLabelAt(progress)];
 if(sampled!==labelled)rows.push({station:index,progress:+progress.toFixed(5),
  sampleSector:sampled,hudLabel:labelled,stationSector:route.stations[index].sector,
  gripDiffers:sampled==='BASIN'||labelled==='BASIN'});
}
console.log(JSON.stringify({script:'scripts/visual/dreamisland/label-lag.mjs',
 stations:route.count,disagreements:rows.length,
 gameplayAffected:rows.some(row=>row.gripDiffers),rows},null,1));
