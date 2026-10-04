import atlas from './launch-atlas.json';
import type { MapSelection } from './map-selection';
import { resolveModeLapCount, type RaceMode } from './race-modes-rules.js';

export const CIRCUIT_COLOURS: Record<MapSelection, string> = {
  greenwater:'#95c46b', bitterpan:'#f5a524', nightshift:'#ff4fa3', polarity:'#7c7dff', tideline:'#20c2a0', ascension:'#ff6f4f', dreamisland:'#3cc8ff', afterglow:'#b3a1ec', frostline:'#b7dce8',
};
const guides = {
  frostline: {title:'MIDNIGHT IN THE MOUNTAINS',note:'Follow cleared snow tracks and collect cyan stabilizers. A big lead attracts snowballs. Final lap brings midnight fireworks.',time:'23:58 · NEW YEAR’S EVE',from:.64,to:.78,feature:'SILVER LAKE / ICE'},
  afterglow: {title:'LAST TRAIN HOME',note:'Sweep past the relay dish, climb the high line and brake for the terminal S. The quay stays wet.',time:'19:48 · BLUE HOUR',from:.48,to:.62,feature:'TERMINAL S'},
  greenwater: {title:'WATER AND STEAM',note:'Standing water takes grip from the left of the track. Steam vents mark Hangar Six; keep your line through the squall.',time:'OVERCAST → DUSK',from:432.271/2515.982,to:586.519/2515.982,feature:'STANDING WATER · LEFT THIRD'},
  bitterpan: {title:'SALT AND CROSSWINDS',note:'Crosswinds sweep the open pans. From lap 2, watch the conveyor lamps: falling salt reduces grip.',time:'NOON → EVENING',from:3005/3050,to:3040/3050,feature:'CONVEYOR SALT DROP'},
  nightshift: {title:'PURE STREET RACING',note:'Tight kerb walls through six neon districts and under the expressway. Just the line.',time:'02:17 · RAIN',from:.515,to:.62,feature:'EXPRESSWAY UNDERPASS'},
  polarity: {title:'GRAVITY FLIP',note:'Flip at marked junctions. Upper road: shorter and tighter. Lower road: faster device recharge.',time:'02:14 · NIGHT',from:.12,to:.29,feature:'UPPER EXPRESS'},
  tideline: {title:'THE TIDE TURNS',note:'Flooded on lap 1. Damp on lap 2. On lap 3, the drained pump hall opens a shorter line.',time:'BLUE HOUR',from:.22,to:.32,feature:'PUMP HALL · LAP 3'},
  ascension: {title:'LAUNCH DAY',note:'Take the trench while it is open. As the rocket launches, follow Deluge Road around the plume.',time:'DAWN',from:.4,to:.53,feature:'TRENCH / DELUGE ROAD'},
  dreamisland: {title:'THE CLOCK STRIKES',note:'Day turns to night on the final lap. The causeway goes wet: prepare for less grip.',time:'DAY → NIGHT',from:47/120,to:62/120,feature:'WET CAUSEWAY'},
} satisfies Record<MapSelection,{title:string;note:string;time:string;from:number;to:number;feature:string}>;

export function launchFacts(track: MapSelection, mode: RaceMode) {
  const data = atlas[track];
  const requested = new URLSearchParams(location.search).get('laps');
  const laps = resolveModeLapCount(mode, {defaultLapCount:data.laps,minimumLapCount:data.minLaps,maximumLapCount:data.maxLaps}, requested === null ? NaN : Number(requested));
  const guide = {...guides[track]};
  if(track === 'tideline' && laps < 3) {guide.note = 'Flooded on lap 1, damp on lap 2. This race ends before the pump hall opens.';guide.feature='PUMP HALL · CLOSED';}
  if(track === 'dreamisland') guide.note = `The clock strikes on lap ${laps}. Night falls and the causeway goes wet: prepare for less grip.`;
  return {data,laps,guide,distance:(data.length*laps/1000).toFixed(1)};
}

const NS = document.querySelector('svg')?.namespaceURI ?? '';
function svgNode(name:string, attributes:Record<string,string>) {
  const node=document.createElementNS(NS,name);
  for(const [key,value] of Object.entries(attributes))node.setAttribute(key,value);
  return node;
}
function path(points:number[][]):string {return points.map((p,i)=>`${i?'L':'M'}${p[0]},${p[1]}`).join(' ');}

/** Real XZ geometry; branch overlays share the outline's projection. */
export function drawLaunchMap(host:HTMLElement,track:MapSelection,mode:RaceMode):void {
  const {data,guide}=launchFacts(track,mode);
  const svg=svgNode('svg',{viewBox:'0 0 240 230',role:'img','aria-label':`${track} track, ${data.gates.length} gates. ${guide.feature}.`});
  const d=path(data.points);
  svg.append(svgNode('path',{d,class:'launch-map__base'}),svgNode('path',{d,pathLength:'1',class:'launch-map__line'}));
  data.gates.forEach((p,i)=>{
    const gate=svgNode('g',{class:'launch-map__gate'}) as SVGElement;
    gate.style.animationDelay=`${i/data.gates.length*500}ms`;
    const nearest=data.points.reduce((best,q,index)=>Math.hypot(q[0]-p[0],q[1]-p[1])<Math.hypot(data.points[best][0]-p[0],data.points[best][1]-p[1])?index:best,0);
    const before=data.points[(nearest+127)%128],after=data.points[(nearest+1)%128];
    const length=Math.hypot(after[0]-before[0],after[1]-before[1])||1;
    const x=(after[1]-before[1])/length*5,y=-(after[0]-before[0])/length*5;
    gate.append(svgNode('path',{d:`M${p[0]-x},${p[1]-y}L${p[0]+x},${p[1]+y}`,class:'launch-map__tick'}));
    const label=svgNode('text',{x:String(p[0]+7),y:String(p[1]-4)});label.textContent=String(i+1);gate.append(label);svg.append(gate);
  });
  const branches=data.branches.filter(b=>b.points.length>1);
  const from=Math.floor(((guide.from-data.startProgress+1)%1)*128);
  const count=Math.ceil((guide.to-guide.from)*128)+1;
  const features=branches.length ? branches.map(b=>b.points) : [Array.from({length:count},(_,i)=>data.points[(from+i)%128])];
  for(const feature of features)svg.append(svgNode('path',{d:path(feature),class:'launch-map__feature','data-closed':String(track==='tideline'&&launchFacts(track,mode).laps<3)}));
  const target=features[0][Math.floor(features[0].length/2)];
  const labels:Record<MapSelection,string[]>={greenwater:['STANDING WATER','LEFT THIRD'],bitterpan:['SALT DROP','LAP 2+'],nightshift:['UNDERPASS','EXPRESSWAY'],polarity:['UPPER','EXPRESS'],tideline:['PUMP HALL',guide.feature.includes('CLOSED')?'CLOSED':'LAP 3'],ascension:['TRENCH','DELUGE ROAD'],dreamisland:['WET','CAUSEWAY'],afterglow:['TERMINAL','S-BEND'],frostline:['ICE','OUTSIDE LINE']};
  const labelX=target[0]>120?155:2,labelY=Math.max(12,Math.min(181,target[1]-16));
  const callout=svgNode('g',{class:'launch-map__callout'});
  callout.append(svgNode('path',{d:`M${target[0]},${target[1]}H${labelX>target[0]?labelX:labelX+83}`,class:'launch-map__leader'}));
  callout.append(svgNode('rect',{x:String(labelX),y:String(labelY),width:'83',height:'34'}));
  labels[track].forEach((line,i)=>{const text=svgNode('text',{x:String(labelX+6),y:String(labelY+13+i*13)});text.textContent=line;callout.append(text);});
  svg.append(callout);
  const start=data.points[0];
  const finish=svgNode('text',{x:String(Math.min(185,start[0]+9)),y:String(start[1]+12),class:'launch-map__finish'});finish.textContent='FINISH';svg.append(finish);
  const finishName=svgNode('text',{x:String(Math.min(160,start[0]+9)),y:String(start[1]+21),class:'launch-map__finish-name'});finishName.textContent=data.finish.toUpperCase();svg.append(finishName);
  svg.append(svgNode('rect',{x:String(start[0]-4),y:String(start[1]-3),width:'8',height:'6',class:'launch-map__start'}));
  const pen=svgNode('circle',{r:'3',class:'launch-map__pen'});
  const motion=svgNode('animateMotion',{dur:'.5s',path:d,fill:'freeze'});pen.append(motion);svg.append(pen);
  host.replaceChildren(svg);
}
