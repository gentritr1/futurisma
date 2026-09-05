import * as THREE from 'three';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
// Clockwise apron loop. The deluge detour makes the fork a meaningful decision.
const controls=[[-340,4,-240],[-80,4,-380],[240,4,-310],[440,4,-110],[430,4,150],[210,4,310],[-50,4,300],[-210,4,240],[-360,4,120],[-430,4,-30]].map(p=>new THREE.Vector3(...p));
let path=new THREE.CatmullRomCurve3(controls,true,'centripetal');path.arcLengthDivisions=10000;
const scale=2600/path.getLength();for(const p of controls){p.x*=scale;p.z*=scale;}
path=new THREE.CatmullRomCurve3(controls,true,'centripetal');path.arcLengthDivisions=10000;
// Two shallow direction changes through the mangroves and a tighter tank-farm
// left-right. Reparameterize after displacement so gates stay distance based.
const basePath=path;
const shaped=Array.from({length:500},(_,i)=>{
 const u=i/500,p=basePath.getPointAt(u),right=basePath.getTangentAt(u).cross(new THREE.Vector3(0,1,0)).normalize();
 for(const [from,to,amplitude] of [[.67,.78,6],[.89,.98,5]])if(u>from&&u<to){const x=(u-from)/(to-from);p.addScaledVector(right,amplitude*Math.sin(x*Math.PI*4)*Math.sin(x*Math.PI)**2);}
 return p;
});
path=new THREE.CatmullRomCurve3(shaped,true,'centripetal');path.arcLengthDivisions=10000;
const correction=2600/path.getLength();for(const p of shaped){p.x*=correction;p.z*=correction;}
path=new THREE.CatmullRomCurve3(shaped,true,'centripetal');path.arcLengthDivisions=10000;
const length=path.getLength(),count=Math.ceil(length/3);
const districts=[['PAD_ROAD','PAD ROAD',0,24],['APRON_SWEEP','APRON SWEEP',.08,24],['DELUGE_ROAD','DELUGE ROAD',.16,24],['CRAWLERWAY','CRAWLERWAY',.62,24],['MANGROVE_CUT','MANGROVE CUT',.67,22],['CAUSEWAY','CAUSEWAY',.78,26],['TANK_FARM','TANK FARM',.89,22]].map(([id,name,from,width])=>({id,name,from,width,color:'#a5a18e'}));
const stations=Array.from({length:count},(_,i)=>{const u=i/count,a=path.getTangentAt((u-.0008+1)%1),b=path.getTangentAt((u+.0008)%1),district=districts.findLast(d=>u>=d.from);return {d:u*length,p:path.getPointAt(u).toArray(),t:path.getTangentAt(u).toArray(),curvature:Math.atan2(a.clone().cross(b).y,a.dot(b))/(length*.0016),width:district.width,sector:district.id};});
const from=.16,to=.635,a=path.getPointAt(from),b=path.getPointAt(to);
const cut=new THREE.CubicBezierCurve3(a,a.clone().addScaledVector(path.getTangentAt(from),260),b.clone().addScaledVector(path.getTangentAt(to),-260),b);cut.arcLengthDivisions=4000;
const cutCount=Math.ceil(cut.getLength()/2.5);
const cutPoints=Array.from({length:cutCount+1},(_,i)=>{const u=i/cutCount,p=cut.getPointAt(u);p.y-=12*Math.sin(Math.PI*u)**2;return p;});
let cutLength=0;for(let i=1;i<cutPoints.length;i++)cutLength+=cutPoints[i].distanceTo(cutPoints[i-1]);
const shortcut={id:'TRENCH',from,to,width:20,length:cutLength,mainLength:(to-from)*length,savings:(to-from)*length-cutLength,stations:cutPoints.map((p,i)=>({progress:from+(to-from)*i/cutCount,p:p.toArray(),t:cutPoints[Math.min(i+1,cutCount)].clone().sub(cutPoints[Math.max(0,i-1)]).normalize().toArray()}))};
const out=new URL('../src/game/data/ascension/',import.meta.url);mkdirSync(out,{recursive:true});
const data={name:'Ascension Pad',revision:'blockout-a',length,count,districts,flightArcs:[],shortcut,checkpoints:[0,.08,.15,.64,.70,.78,.87,.95],stations};
writeFileSync(new URL('route.json',out),JSON.stringify(data));
console.log(JSON.stringify({script:'scripts/build-ascension-route.mjs',length,shortcutMetres:cutLength,detourMetres:shortcut.mainLength}));
const calibrationFile=process.argv.find(a=>a.startsWith('--calibration='))?.slice(14);
if(calibrationFile){
 const race=JSON.parse(readFileSync(calibrationFile,'utf8'));
 if(race.errors.length)throw Error('Calibration contains browser errors');
 const laps=race.diagnostics.current.lapTimesMs;
 if(laps.length!==3)throw Error('Calibration must complete three laps');
 const L=(laps[1]+laps[2])/2000,tick=factor=>Math.round(factor*L*120);
 const config={script:'scripts/build-ascension-route.mjs',measurementScript:race.script,measurement:calibrationFile,worksLapSeconds:L,definition:'Mean of flying laps two and three in the full Works demo before schedule activation',launchTick:tick(2.45),reopenTick:tick(2.45)+20*120,steamEndTick:tick(2.95),rocketGoneTick:tick(2.70),testTick:tick(1.25),events:[
  {id:'crawler-klaxon-1',tick:tick(.55)-3*120},{id:'crawler-cross-1',tick:tick(.55)},
  {id:'deluge-test',tick:tick(1.25)},
  {id:'crawler-klaxon-2',tick:tick(1.60)-3*120},{id:'crawler-cross-2',tick:tick(1.60)},
  {id:'launch',tick:tick(2.45)},{id:'rocket-gone',tick:tick(2.70)},{id:'steam-clear',tick:tick(2.95)},{id:'trench-reopen',tick:tick(2.45)+20*120},
 ].sort((a,b)=>a.tick-b.tick)};
 writeFileSync(new URL('schedule.json',out),JSON.stringify(config,null,2));console.log(JSON.stringify(config,null,2));
}
