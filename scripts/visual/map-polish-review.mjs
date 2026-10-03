/** Pinned chase views of every shipped map; no production or physics overrides. */
import {mkdir, writeFile} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {launchReviewBrowser} from './tideline-v4/browser.mjs';
import {instrument} from './dreamisland/instrument.mjs';

const out = process.argv.find(a => a.startsWith('--out='))?.slice(6)
  ?? 'art/evidence/map-polish-review';
const selected = process.argv.find(a => a.startsWith('--maps='))?.slice(7).split(',');
const maps = ['greenwater', 'bitterpan', 'nightshift', 'polarity', 'tideline', 'ascension', 'dreamisland'];
const report = {instrument: 'scripts/visual/map-polish-review.mjs',
  revision: execFileSync('git', ['rev-parse', 'HEAD'], {encoding:'utf8'}).trim(),
  note: 'Static chase-pose coverage, not full-race performance or human-playtest acceptance. Shared image-treatment retained.', captures: []};
await mkdir(out, {recursive:true});
const browser = await launchReviewBrowser();
try {
  for (const map of maps.filter(m => !selected || selected.includes(m))) {
    const length = map === 'greenwater'
      ? JSON.parse(readFileSync('src/game/data/greenwater-blockout.json')).centreline.lapLength
      : map === 'bitterpan' ? 3050 : JSON.parse(readFileSync(`src/game/data/${map}/route.json`)).length;
    for (const blend of map === 'dreamisland' ? [0, 1] : [null]) {
      for (const progress of [.08, .30, .55, .80]) {
        const page = await browser.newPage(), errors = [];
        page.on('pageerror', e => errors.push(String(e)));
        page.on('console', m => {if (m.type() === 'error') errors.push(m.text());});
        await instrument(page);
        const params = new URLSearchParams({map, diagnostics:'1', headless:'1', quality:'high',
          music:'0', voice:'0', probe:'boundary-hold', probeDistance:String(progress * length),
          probeLateral:'0', motion:'reduce', start:'manual'});
        if (blend !== null) params.set('nightBlend', String(blend));
        const url = 'http://127.0.0.1:5200/?' + params;
        await page.goto(url, {waitUntil:'networkidle0', timeout:60000});
        await page.waitForFunction(() => !!window.__diScene && !!document.getElementById('futurisma-diagnostics')?.textContent);
        await new Promise(r => setTimeout(r, 2200));
        await page.evaluate(() => {
          for (const node of document.querySelectorAll('#app > *')) {
            if (node.id !== 'game-canvas' && !node.classList.contains('image-treatment')) node.style.display = 'none';
          }
          window.dispatchEvent(new Event('resize'));
        });
        await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
        const file = `${map}${blend === null ? '' : blend ? '-night' : '-day'}-${Math.round(progress * 100)}.png`;
        await page.screenshot({path:out + '/' + file});
        const observed = await page.evaluate(() => {
          const scene = window.__diScene, materials = new Map(), roots = [];
          scene.traverse(o => {
            if (o.name && /blender|painted|environment/.test(o.name)) roots.push(o.name);
            for (const m of Array.isArray(o.material) ? o.material : o.material ? [o.material] : []) {
              if (!materials.has(m.uuid)) materials.set(m.uuid, {name:m.name, type:m.type, fog:m.fog, toneMapped:m.toneMapped});
            }
          });
          const last = window.__diFrames.at(-1);
          return {diagnostics:JSON.parse(document.getElementById('futurisma-diagnostics').textContent).current,
            rendered:last, roots, materialExceptions:[...materials.values()].filter(m => m.fog === false || m.toneMapped === false)};
        });
        report.captures.push({map, length, progress, blend, file, url, errors, ...observed});
        await writeFile(out + '/captures.json', JSON.stringify(report, null, 2) + '\n');
        console.log(file, 'draws', observed.rendered.mainCalls + observed.rendered.shadowCalls, 'errors', errors.length);
        await page.close();
      }
    }
  }
} finally {await browser.close();}
if (report.captures.some(c => c.errors.length)) throw Error('Browser errors recorded; inspect captures.json');
