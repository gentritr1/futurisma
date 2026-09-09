/**
 * Offline closure solver for the Dream Island curvature schedule.
 *
 * `scripts/build-dreamisland-route.mjs` integrates a curvature schedule whose
 * six section net turns are pinned constants. Those constants are NOT free: the
 * loop has to come back to its own start in position AND in heading, and the
 * authored design intent (30/90/30/130/40/40 degrees) does not do that on its
 * own. This script is the measurement that produces them, so the builder can
 * stay an integrator.
 *
 * It solves, for the shape given by `--grove-lobes` and `--grove-amplitude`:
 *
 *   minimise |T - Tstart|^2  subject to  closeX(T)=0, closeZ(T)=0, sum(T)=360
 *
 * by iterated minimum-norm Gauss-Newton steps from `Tstart`. Phase B revises an
 * ALREADY ACCEPTED route, so `Tstart` defaults to the phase-A constants rather
 * than to the original 30/90/30/130/40/40 design intent: the smallest correction
 * that restores closure is the one that disturbs the other six districts least.
 * `--from=intent` re-runs the original construction instead.
 *
 *   node scripts/design/solve-dreamisland-closure.mjs --grove-lobes=5 --grove-amplitude=0.0172
 */
const flag=(name,fallback)=>{const hit=process.argv.find(a=>a.startsWith('--'+name+'='));return hit===undefined?fallback:Number(hit.slice(name.length+3));};
const LOBES=flag('grove-lobes',3),AMPLITUDE=flag('grove-amplitude',.011);
/** The phase-A shipped constants, read off `scripts/build-dreamisland-route.mjs`. */
const PHASE_A={GROVE:58.765125,POINT:69.246402,BASIN:-7.745486,COURT:108.855401,REEF:53.52966,CUT:77.348893};
const DESIGN_INTENT={GROVE:30,POINT:90,BASIN:30,COURT:130,REEF:40,CUT:40};
const INTENT=process.argv.includes('--from=intent')?DESIGN_INTENT:PHASE_A;
const KEYS=Object.keys(INTENT);
const LENGTH=2400,STEPS=48000,step=LENGTH/STEPS;
const smooth=t=>t<=0?0:t>=1?1:t*t*(3-2*t),rad=deg=>deg*Math.PI/180;
const height=s=>s<300?0:s<810?22*smooth((s-300)/510):s<940?22-8*smooth((s-810)/130)
 :s<1240?14:s<1580?14-14*smooth((s-1240)/340):0;
/** The same curvature schedule the builder integrates, with GROVE parameterised. */
function curvature(s,T){
 if(s<300)return 0;
 if(s<680){const t=(s-300)/380;return rad(T.GROVE)/380+AMPLITUDE*(Math.sin(LOBES*Math.PI*t)-(LOBES%2?2/(LOBES*Math.PI):0));}
 if(s<940){const t=(s-680)/260;return rad(T.POINT)*Math.PI/(2*260)*Math.sin(Math.PI*t);}
 if(s<1240)return rad(T.BASIN)/300;
 if(s<1580)return rad(T.COURT)/340;
 if(s<2040)return rad(T.REEF)/460;
 const t=(s-2040)/360;return rad(T.CUT)/360-.017*Math.sin(2*Math.PI*t);
}
/** Closure residual: where the integrated polyline ends, and its net heading. */
function residual(values){
 const T=Object.fromEntries(KEYS.map((k,i)=>[k,values[i]]));
 let heading=0,x=0,z=0;
 for(let i=0;i<STEPS;i++){
  const mid=(i+.5)*step;
  const rise=height(mid+step/2)-height(mid-step/2);
  const plan=Math.sqrt(Math.max(0,step*step-rise*rise));
  x+=Math.cos(heading)*plan;z+=Math.sin(heading)*plan;heading+=curvature(mid,T)*step;
 }
 return [x,z,heading-2*Math.PI];
}
/** Minimum-norm Gauss-Newton: delta = J^T (J J^T)^-1 (-r), iterated to closure. */
function solve(){
 let values=KEYS.map(k=>INTENT[k]);
 for(let iteration=0;iteration<24;iteration++){
  const r=residual(values);
  if(Math.max(Math.abs(r[0]),Math.abs(r[1]),Math.abs(r[2])*1000)<1e-9)break;
  const J=r.map(()=>new Array(values.length).fill(0));
  for(let column=0;column<values.length;column++){
   const nudged=values.slice();nudged[column]+=1e-4;
   const shifted=residual(nudged);
   for(let row=0;row<3;row++)J[row][column]=(shifted[row]-r[row])/1e-4;
  }
  // 3x3 normal system on J J^T, solved by Gauss elimination with partial pivoting.
  const A=[0,1,2].map(i=>[...[0,1,2].map(j=>J[i].reduce((s,v,k)=>s+v*J[j][k],0)),-r[i]]);
  for(let i=0;i<3;i++){
   let pivot=i;for(let k=i+1;k<3;k++)if(Math.abs(A[k][i])>Math.abs(A[pivot][i]))pivot=k;
   [A[i],A[pivot]]=[A[pivot],A[i]];
   for(let k=0;k<3;k++){if(k===i)continue;const factor=A[k][i]/A[i][i];for(let j=i;j<4;j++)A[k][j]-=factor*A[i][j];}
  }
  const lambda=[0,1,2].map(i=>A[i][3]/A[i][i]);
  values=values.map((value,column)=>value+lambda.reduce((s,l,row)=>s+l*J[row][column],0));
 }
 return values;
}
const values=solve(),r=residual(values);
const turns=Object.fromEntries(KEYS.map((k,i)=>[k,values[i]]));
console.log(JSON.stringify({script:'scripts/design/solve-dreamisland-closure.mjs',
 groveLobes:LOBES,groveAmplitude:AMPLITUDE,startDegrees:INTENT,turnDegrees:turns,
 turnDegreesSum:values.reduce((a,b)=>a+b,0),
 correctionDegrees:Object.fromEntries(KEYS.map((k,i)=>[k,values[i]-INTENT[k]])),
 closure:{xMetres:r[0],zMetres:r[1],headingRadians:r[2]},
 // The analytic extremes of the GROVE wave, before the spline resamples it.
 groveAnalytic:{baseCurvature:rad(turns.GROVE)/380-(LOBES%2?AMPLITUDE*2/(LOBES*Math.PI):0),
  peakCurvature:rad(turns.GROVE)/380-(LOBES%2?AMPLITUDE*2/(LOBES*Math.PI):0)+AMPLITUDE,
  troughCurvature:rad(turns.GROVE)/380-(LOBES%2?AMPLITUDE*2/(LOBES*Math.PI):0)-AMPLITUDE,
  tightestRadiusMetres:1/Math.max(Math.abs(rad(turns.GROVE)/380-(LOBES%2?AMPLITUDE*2/(LOBES*Math.PI):0)+AMPLITUDE),
   Math.abs(rad(turns.GROVE)/380-(LOBES%2?AMPLITUDE*2/(LOBES*Math.PI):0)-AMPLITUDE)),
  alternatingTurns:LOBES}},null,2));
