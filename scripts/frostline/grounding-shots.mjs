// Frostline demo-race captures at fixed race-clock times (same viewpoints before/after a change).
//   node --experimental-websocket scripts/frostline/grounding-shots.mjs <label> --out=<dir> --times=3.5,19,26 [--base=http://127.0.0.1:5191] [--port=9334]
// Writes <dir>/<label>-<t>s.jpg (1280x720, JPEG 80) and <dir>/<label>.json with the
// race distance, sector and the game's own diagnostics (draw calls, triangles) per shot.
import {mkdirSync,writeFileSync} from 'node:fs';
import {launch} from './cdp.mjs';

const arg = (name, fallback) => process.argv.find(a => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=') ?? fallback;
const label = process.argv[2], out = arg('out', '.'), base = arg('base', 'http://127.0.0.1:5191');
const times = arg('times', '3.5,19').split(',').map(Number).sort((a, b) => a - b);
mkdirSync(out, {recursive: true});
const browser = await launch({port: Number(arg('port', 9334)), timeoutMs: 60000 + times.at(-1) * 4000});
const clock = `(()=>{const t=document.getElementById('time-value')?.textContent?.trim()??'';const m=t.match(/(\\d+):(\\d+)\\.(\\d+)/);return m?+m[1]*60+ +m[2]+ +('0.'+m[3]):-1;})()`;
const diagnostics = `(()=>{try{return JSON.parse(document.getElementById('futurisma-diagnostics')?.textContent||'null');}catch{return null;}})()`;
const shots = [];
try {
  await browser.navigate(`${base}/?map=frostline&demo=1&laps=3&diagnostics=1&music=0&voice=0`);
  await browser.waitFor(`document.body.dataset.phase==='race'||document.body.dataset.phase==='running'`, 45000, 'race phase');
  await browser.waitFor(`${clock}>0`, 30000, 'race clock running');
  for (const target of times) {
    await browser.waitFor(`${clock}>=${target}`, (target + 20) * 1000, 'race clock ' + target);
    const image = await browser.screenshot(80);
    const t = await browser.evaluate(clock), d = await browser.evaluate(diagnostics);
    const name = `${label}-${String(target).replace('.', '_')}s.jpg`;
    writeFileSync(`${out}/${name}`, image);
    shots.push({target, clock: t, file: name, distanceMeters: d?.current?.distanceMeters, sector: d?.current?.sector, calls: d?.current?.calls, triangles: d?.current?.triangles});
    console.log(JSON.stringify(shots.at(-1)));
  }
  const final = await browser.evaluate(diagnostics);
  writeFileSync(`${out}/${label}.json`, JSON.stringify({shots, peak: final?.peak, errors: browser.errors.slice(0, 10)}, null, 1));
  console.log('peak', JSON.stringify(final?.peak), 'page errors', browser.errors.length);
} finally { browser.close(); }
