import {renderAmbienceLoop} from './ambience-beds.js';
import profiles from './data/dreamisland/bed-profile.json' with {type:'json'};

export const DREAMISLAND_AUDIO_RATE=24000;
export const DREAMISLAND_BED_SECONDS=8;

/** The existing seeded brine, air and insect synthesis, equalised against the
 * supplied references by scripts/visual/dreamisland/bed-match.py.
 * Profiles are measured filter parameters, never samples from the references.
 * @param {'surf'|'night'} kind @param {number[][]} profile */
export function renderDreamIslandBed(kind,profile=profiles[kind]){
 const rate=DREAMISLAND_AUDIO_RATE,length=rate*DREAMISLAND_BED_SECONDS;
 const water=renderAmbienceLoop('brine_lap',rate),air=renderAmbienceLoop('noise',rate);
 const insects=kind==='night'?renderAmbienceLoop('canopy_chirp',rate):null;
 const output=new Float32Array(length);
 for(let i=0;i<length;i++){
  const swell=.65+.35*Math.cos(2*Math.PI*i/length*2);
  output[i]=kind==='surf'?(water[i%water.length]*.6+air[i%air.length]*.15)*swell
   :water[i%water.length]*.25+air[i%air.length]*.015+(insects?insects[i%insects.length]*.2:0);
 }
 // Peaking equalizers, the Audio EQ Cookbook transfer function. Warm the
 // delay state with one full loop before keeping its periodic steady state.
 for(const [frequency,db,q] of profile){
  const a=10**(db/40),omega=2*Math.PI*frequency/rate;
  const alpha=Math.sin(omega)/(2*q),a0=1+alpha/a;
  const b0=(1+alpha*a)/a0,b1=-2*Math.cos(omega)/a0,b2=(1-alpha*a)/a0;
  const a1=b1,a2=(1-alpha/a)/a0;
  let x1=0,x2=0,y1=0,y2=0;
  for(let i=0;i<length*2;i++){
   const j=i%length,x=output[j],y=b0*x+b1*x1+b2*x2-a1*y1-a2*y2;
   x2=x1;x1=x;y2=y1;y1=y;
   if(i>=length)output[j]=y;
  }
 }
 return output;
}
