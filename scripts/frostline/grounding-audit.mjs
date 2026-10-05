// Frostline grounding audit. Needs a Vite dev server for THIS checkout:
//   npx vite --port 5191 --strictPort --host 127.0.0.1   (background)
//   node --experimental-websocket scripts/frostline/grounding-audit.mjs [out.json] [--base=http://127.0.0.1:5191] [--port=9333]
// Builds the real FrostlineEnvironment in headless Chrome and prints, per object
// family, how many objects float above the ground (gap = closest bottom probe to
// the ground surface below it; objects resting on another grounded object count 0).
import {writeFileSync} from 'node:fs';
import {launch} from './cdp.mjs';

const arg = (name, fallback) => process.argv.find(a => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=') ?? fallback;
const base = arg('base', 'http://127.0.0.1:5191'), out = process.argv.slice(2).find(a => !a.startsWith('--'));
const browser = await launch({port: Number(arg('port', 9333)), timeoutMs: 180000});
let report;
try {
  await browser.navigate(base + '/assets/frostline/road.png');
  await browser.waitFor('document.readyState==="complete"', 15000);
  report = await browser.evaluate(`import('/scripts/frostline/grounding-audit-page.js').then(m=>m.runAudit())`);
} finally { browser.close(); }
if (out) writeFileSync(out, JSON.stringify(report, null, 1));
const rows = Object.entries(report.families).sort((a, b) => (a[1].role > b[1].role ? 1 : -1) || b[1].maxGap - a[1].maxGap);
const pad = (s, n) => String(s).padEnd(n), num = (s, n) => String(s).padStart(n);
console.log(pad('family', 54) + pad('role', 9) + num('count', 6) + num('float', 7) + num('>0.5', 6) + num('>2', 6) + num('>10', 6) + num('maxGap', 8) + num('buried', 7) + num('contact', 8) + num('loose', 6) + '  floating by lap decile');
for (const [name, f] of rows) console.log(pad(name, 54) + pad(f.role, 9) + num(f.count, 6) + num(f.floating, 7) + num(f.gt05, 6) + num(f.gt2, 6) + num(f.gt10, 6) + num(f.maxGap, 8) + num(f.buried, 7) + num(f.contactOnly ?? 0, 8) + num(f.unattached ?? '-', 6) + '  ' + f.regions.join(' '));
console.log('ground meshes/instances:', JSON.stringify(report.ground), 'ground triangles:', report.groundTriangles);
console.log('excluded (not audited):', JSON.stringify(report.excluded));
console.log(`objects ${report.objects} = audited ${report.audited} + ground ${Object.values(report.ground).reduce((a, b) => a + b, 0)} | excluded drawables ${report.excludedTotal}`);
console.log('GROUNDED PROPS:', JSON.stringify(report.groundedSummary));
console.log('gondola min clearance (m):', report.gondolaMinClearance, '| signature yard ground - origin (m):', JSON.stringify(report.signatureYardGroundMinusOrigin));
console.log('terrain slope:', JSON.stringify(report.terrainSlope), '| buried props:', report.buriedList.length);
console.log('road continuity:', JSON.stringify(report.roadContinuity), 'env stats:', JSON.stringify(report.stats));
