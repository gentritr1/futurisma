import {readFileSync,writeFileSync} from 'node:fs';
const root=process.argv[2]??'art/evidence/ascension-v1/phase-c-revision/visibility';
const report=JSON.parse(readFileSync(root+'/claim.json'));
const beforeThree=report.records.filter(r=>r.secondsAfterT0<=3);
const angular=beforeThree.find(r=>r.columnTopElevationDegrees>=25);
const measured={script:'scripts/visual/ascension/reconcile-launch.mjs',sourceScript:report.script,
 simulation:{windowSeconds:report.windowSeconds,expectedRateHz:report.expectedRateHz,endpointSamples:1,expected:201,observed:report.captured,residual:report.captured-201},
 wallClock:{windowSeconds:report.observedWallWindowSeconds,equivalentExpectedAt10Hz:report.observedWallWindowSeconds*10+1,observed:report.captured,residual:report.captured-(report.observedWallWindowSeconds*10+1),note:'Capture is scheduled on the simulation clock. Synchronous PNG encoding and two extra renders slow wall time; this is not an FPS benchmark.'},
 plume:{frames:report.plumeFrames,total:report.captured,fraction:report.fraction,passes:report.fraction>=.6},
 column:{firstGeometric25DegreesAtSeconds:angular?.secondsAfterT0??null,atThreeSecondsDegrees:beforeThree.at(-1)?.columnTopElevationDegrees,note:'World-space column extent projected relative to the horizon; not an image segmentation estimate of the top.'}};
if(!angular||report.fraction<.6||report.errors.length)throw Error('Launch gate failed');
writeFileSync(root+'/reconciliation.json',JSON.stringify(measured,null,2));console.log(measured);
