import * as THREE from "three";
import { mkdirSync, writeFileSync } from "node:fs";

// A continuous reactor / port circuit. All former flight spans are replaced
// by sheltered quays and a low return gallery; every station has solid road.
const controls = [
  [-300,-18,-210],[-100,-18,-390],[130,-14,-355],[300,4,-220],
  [340,4,-20],[260,4,140],[70,3,205],[-125,-8,170],
  [-305,-16,65],[-395,-18,-95],
].map(p=>new THREE.Vector3(...p));
const path=new THREE.CatmullRomCurve3(controls,true,"centripetal");
path.arcLengthDivisions=8000;
const length=path.getLength(), count=Math.ceil(length/3);
const districts=[
  {id:"REACTOR",name:"DROWNED REACTOR",from:0,color:"#a49b77"},
  {id:"LOCK",name:"PUMP HALL",from:.22,color:"#b39e67"},
  {id:"DOCKS",name:"PORT AFTERLIGHT",from:.34,color:"#b7a17b"},
  {id:"QUAY",name:"THE SERVICE QUAY",from:.52,color:"#ab9b72"},
  {id:"RETURN",name:"INTAKE GALLERY",from:.72,color:"#84947c"},
  {id:"REENTRY",name:"REACTOR RETURN",from:.9,color:"#9a9e76"},
];
function curvatureAt(p) {
 const a=path.getTangentAt((p-.0008+1)%1),b=path.getTangentAt((p+.0008)%1);
 a.y=b.y=0;a.normalize();b.normalize();
 return Math.atan2(a.clone().cross(b).y,a.dot(b))/(length*.0016);
}
const stations=Array.from({length:count},(_,i)=>{
 const progress=i/count,p=path.getPointAt(progress),t=path.getTangentAt(progress).normalize();
 return {d:progress*length,p:p.toArray(),t:t.toArray(),curvature:curvatureAt(progress),width:24,
   sector:districts.findLast(d=>progress>=d.from).id,mode:p.y<-2?"submerged":"surface"};
});
const from=.055,to=.27;
const p0=path.getPointAt(from),p3=path.getPointAt(to);
const cut=new THREE.CubicBezierCurve3(p0,p0.clone().addScaledVector(path.getTangentAt(from),115),
 p3.clone().addScaledVector(path.getTangentAt(to),-115),p3);
cut.arcLengthDivisions=2000;
const cutLength=cut.getLength(),cutCount=Math.ceil(cutLength/2.5);
const shortcut={id:"PUMP_HALL",from,to,width:20,length:cutLength,mainLength:(to-from)*length,
 savings:(to-from)*length-cutLength,opensLap:3,stations:Array.from({length:cutCount+1},(_,i)=>({
 progress:from+(to-from)*i/cutCount,p:cut.getPointAt(i/cutCount).toArray(),t:cut.getTangentAt(i/cutCount).normalize().toArray(),
}))};
const data={name:"Tideline",revision:"tide-2",length,count,waterLevel:0,districts,flightArcs:[],shortcut,
 checkpoints:[0,.295,.395,.505,.615,.73,.84,.93],stations};
const out=new URL("../src/game/data/tideline/",import.meta.url);mkdirSync(out,{recursive:true});
writeFileSync(new URL("route.json",out),JSON.stringify(data));
console.log(`Tideline tide: ${length.toFixed(1)}m, ${count} solid road stations; pump hall saves ${shortcut.savings.toFixed(1)}m.`);
