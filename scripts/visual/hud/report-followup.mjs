import {readFileSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const arg=(name,fallback)=>process.argv.find(v=>v.startsWith(`--${name}=`))?.slice(name.length+3)??fallback;
const out=arg('out','art/evidence/hud/followup-final');
const read=path=>JSON.parse(readFileSync(path,'utf8'));
const capture=read(out+'/captures/capture.json'),baseline=read('art/evidence/hud/capture-merged.json');
const layouts=[],slots=[];
for(const row of capture.results){
 const previous=baseline.results.find(r=>r.name===row.name);assert.ok(previous,'Missing baseline case '+row.name);
 for(const field of ['hudScale','menuScale','clusterWidth','lapPips','ladderRows'])if(row[field]!==previous[field])layouts.push({name:row.name,field,before:previous[field],after:row[field]});
 if(row.slots.legacyExpected)for(const field of ['device','deck','transfer','kind','fill'])if(row.slots[field]!==row.slots.legacyExpected[field])slots.push({name:row.name,field});
}
const deviceCases=capture.results.filter(r=>r.slots.legacyExpected).length;
const menus=read(out+'/menus/paths.json'),pad=read(out+'/gamepad/gamepad.json'),pause=read(out+'/pause/pause-quit.json');
const finishes=read('art/evidence/hud/followup-4-results/finishes.json');
const scenarioCounts=[
 {name:'menu path observations',expected:8,observed:menus.records.length},
 {name:'pause and quit observations',expected:9,observed:pause.results.length},
 {name:'all prompt nodes across keyboard, pad, disconnect',expected:11*3,observed:pad.allKeyboard.length+pad.allGamepad.length+pad.allDisconnected.length},
 {name:'real finishes: three formats plus previous-record setup',expected:4,observed:finishes.records.length},
].map(row=>({...row,residual:row.observed-row.expected}));
const report={script:'scripts/visual/hud/report-followup.mjs',testCodeExit:Number(readFileSync(out+'/test-code-exit.txt','utf8')),captureReconciliation:{viewports:2,scales:2,cases:6,expected:24,observed:capture.results.length,residual:capture.results.length-24},slotReconciliation:{deviceCircuits:3,viewportScalePairs:4,expected:12,observed:deviceCases,residual:deviceCases-12},layoutDifferences:layouts,slotDifferences:slots,captureErrors:capture.errors,baselineLimitation:'capture-merged.json contains no slot states. Exact state parity is checked against the 2862475 parser at each new sampled frame; baseline layout fields are compared directly. No claim of matching unrecorded historical states.',sampling:'Discrete scenario captures, not a regularly sampled time series. No FPS or p95 comparison.'};
report.scenarioReconciliation=scenarioCounts;
report.scenarioErrors={menus:menus.errors,gamepad:pad.errors,pause:pause.errors,finishes:finishes.errors};
writeFileSync(out+'/reconciliation.json',JSON.stringify(report,null,2)+'\n');
for(const row of scenarioCounts)assert.equal(row.residual,0,row.name);
for(const errors of Object.values(report.scenarioErrors))assert.deepEqual(errors,[]);
assert.equal(report.testCodeExit,0);assert.equal(report.captureReconciliation.residual,0);assert.equal(report.slotReconciliation.residual,0);assert.deepEqual(layouts,[]);assert.deepEqual(slots,[]);assert.deepEqual(capture.errors,[]);
console.log('24 captures and 12 device cases reconciled; layout and legacy-renderer slot parity PASS.');
