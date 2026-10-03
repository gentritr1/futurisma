import * as THREE from 'three';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';

// A wide relay boulevard, an uphill skyline sweep, a terminal chicane and a
// descending return. Equal-distance sampling is shared by physics and art.
const controls=[[0,0,0],[0,0,-100],[-35,0,-210],[-170,4,-270],[-330,20,-180],[-420,36,-20],[-340,44,130],[-190,35,140],[-90,26,245],[-200,14,350],[-370,3,450],[-320,0,610],[-95,0,660],[150,8,540],[255,19,350],[210,12,210],[95,0,220],[0,0,135]];
const curve=new THREE.CatmullRomCurve3(controls.map(p=>new THREE.Vector3(...p)),true,'centripetal');
curve.arcLengthDivisions=12000;curve.updateArcLengths();
const count=960,length=curve.getLength(),step=length/count;
const districts=[{from:0,name:'CHRISTMAS SQUARE'},{from:.16,name:'LANTERN CLIMB'},{from:.34,name:'GONDOLA RIDGE'},{from:.48,name:'FROSTED FOREST'},{from:.64,name:'SILVER LAKE'},{from:.84,name:'MIDNIGHT RETURN'}];
const stations=Array.from({length:count},(_,i)=>{
  const p=curve.getPointAt(i/count),t=curve.getTangentAt(i/count);
  const a=curve.getTangentAt((i+count-1)%count/count),b=curve.getTangentAt((i+1)%count/count);
  const curvature=Math.atan2(a.x*b.z-a.z*b.x,a.x*b.x+a.z*b.z)/(2*step);
  return {p:p.toArray(),t:t.toArray(),curvature,width:26,sector:districts.filter(d=>d.from<=i/count).at(-1).name};
});
const checkpoints=[0,.145,.31,.46,.62,.79,.92];
mkdirSync('src/game/data/frostline',{recursive:true});
writeFileSync('src/game/data/frostline/route.json',JSON.stringify({count,length,controls,stations,checkpoints,districts}));
const atlas=JSON.parse(readFileSync('src/game/launch-atlas.json','utf8'));
const box=new THREE.Box3().setFromPoints(stations.map(s=>new THREE.Vector3(...s.p)));
const scale=170/Math.max(box.max.x-box.min.x,box.max.z-box.min.z);
const project=p=>[+(120+(p.x-(box.min.x+box.max.x)/2)*scale).toFixed(2),+(115+(p.z-(box.min.z+box.max.z)/2)*scale).toFixed(2)];
atlas.frostline={length,laps:3,minLaps:1,maxLaps:9,finish:'the Midnight Arch',startProgress:.002,points:Array.from({length:129},(_,i)=>project(curve.getPointAt((i/128+.002)%1))),gates:checkpoints.slice(1).map(p=>project(curve.getPointAt(p))),branches:[]};
writeFileSync('src/game/launch-atlas.json',JSON.stringify(atlas));
console.log({length,stations:count,maxCurvature:Math.max(...stations.map(s=>Math.abs(s.curvature)))});
