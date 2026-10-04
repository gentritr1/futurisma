import * as THREE from 'three';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';

// A wide relay boulevard, an uphill skyline sweep, a terminal chicane and a
// descending return. Equal-distance sampling is shared by physics and art.
const controls=[[0,0,0],[0,0,-85],[0,0,-180],[-100,4,-310],[-300,14,-330],[-450,24,-220],[-460,30,-30],[-350,32,100],[-260,22,220],[-390,12,340],[-310,3,500],[-80,0,520],[130,8,400],[220,16,220],[160,8,180],[60,0,200],[0,0,140]];
const curve=new THREE.CatmullRomCurve3(controls.map(p=>new THREE.Vector3(...p)),true,'centripetal');
curve.arcLengthDivisions=12000;curve.updateArcLengths();
const count=960,length=curve.getLength(),step=length/count;
const districts=[{from:0,name:'RELAY BOULEVARD'},{from:.16,name:'SKYLINE CLIMB'},{from:.34,name:'THE HIGH LINE'},{from:.48,name:'TERMINAL S'},{from:.66,name:'AFTERHOURS QUAY'},{from:.84,name:'RETURN SIGNAL'}];
const stations=Array.from({length:count},(_,i)=>{
  const p=curve.getPointAt(i/count),t=curve.getTangentAt(i/count);
  const a=curve.getTangentAt((i+count-1)%count/count),b=curve.getTangentAt((i+1)%count/count);
  const curvature=Math.atan2(a.x*b.z-a.z*b.x,a.x*b.x+a.z*b.z)/(2*step);
  return {p:p.toArray(),t:t.toArray(),curvature,width:28,sector:districts.filter(d=>d.from<=i/count).at(-1).name};
});
const checkpoints=[0,.145,.31,.46,.62,.79,.92];
mkdirSync('src/game/data/afterglow',{recursive:true});
writeFileSync('src/game/data/afterglow/route.json',JSON.stringify({count,length,controls,stations,checkpoints,districts}));
const atlas=JSON.parse(readFileSync('src/game/launch-atlas.json','utf8'));
const box=new THREE.Box3().setFromPoints(stations.map(s=>new THREE.Vector3(...s.p)));
const scale=170/Math.max(box.max.x-box.min.x,box.max.z-box.min.z);
const project=p=>[+(120+(p.x-(box.min.x+box.max.x)/2)*scale).toFixed(2),+(115+(p.z-(box.min.z+box.max.z)/2)*scale).toFixed(2)];
atlas.afterglow={length,laps:3,minLaps:1,maxLaps:9,finish:'the Relay Line',startProgress:.002,points:Array.from({length:129},(_,i)=>project(curve.getPointAt((i/128+.002)%1))),gates:checkpoints.slice(1).map(p=>project(curve.getPointAt(p))),branches:[]};
writeFileSync('src/game/launch-atlas.json',JSON.stringify(atlas));
console.log({length,stations:count,maxCurvature:Math.max(...stations.map(s=>Math.abs(s.curvature)))});
