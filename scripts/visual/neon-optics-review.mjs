/** Compare the city's optical layer at one held pose, with the actual shared render rule. */
import {mkdir, writeFile} from 'node:fs/promises';
import {launchReviewBrowser} from './tideline-v4/browser.mjs';
import {instrument} from './dreamisland/instrument.mjs';
import {readFileSync} from 'node:fs';

const out = process.argv.find(a => a.startsWith('--out='))?.slice(6)
  ?? 'art/evidence/map-polish-review/optics-trial';
const shipped = process.argv.includes('--shipped');
await mkdir(out, {recursive:true});
const browser = await launchReviewBrowser();
const captures = [];
try {
  for (const map of ['nightshift', 'polarity']) {
    const length = JSON.parse(readFileSync(`src/game/data/${map}/route.json`)).length;
    const page = await browser.newPage(), errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    page.on('console', m => {if (m.type() === 'error') errors.push(m.text());});
    await instrument(page);
    const url = `http://127.0.0.1:5200/?map=${map}&diagnostics=1&headless=1&quality=high&music=0&voice=0&probe=boundary-hold&probeDistance=${length*.08}&probeLateral=0&motion=reduce&start=manual`;
    await page.goto(url, {waitUntil:'networkidle0', timeout:60000});
    await page.waitForFunction(() => !!window.__diScene && !!document.getElementById('futurisma-diagnostics')?.textContent);
    await new Promise(r => setTimeout(r, 2200));
    await page.evaluate(() => {
      for (const node of document.querySelectorAll('#app > *')) {
        if (node.id !== 'game-canvas' && !node.classList.contains('image-treatment')) node.style.display = 'none';
      }
    });
    const draw = async file => {
      await page.evaluate(() => {window.dispatchEvent(new Event('resize'));});
      await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
      await page.screenshot({path:out + '/' + file});
    };
    const read = () => page.evaluate(() => {
      const materials = [];
      window.__diScene.traverse(o => {
        if (!/_neon_(halation|puddles)$/.test(o.name)) return;
        const m = o.material;
        materials.push({object:o.name, fog:m.fog, toneMapped:m.toneMapped,
          fogChunk:m.fragmentShader.includes('fog_fragment'), toneChunk:m.fragmentShader.includes('tonemapping_fragment'),
          instances:o.count});
      });
      return {materials, rendered:window.__diFrames.at(-1),
        diagnostics:JSON.parse(document.getElementById('futurisma-diagnostics').textContent).current};
    });
    await draw(map + '-before.png');
    const before = await read();
    await draw(map + '-repeat.png');
    if (!shipped) await page.evaluate(async () => {
      const {applyTidelineRenderRule} = await import('/src/game/tideline-render-rule.ts');
      const optics = [];
      window.__diScene.traverse(o => {if (/_neon_(halation|puddles)$/.test(o.name)) optics.push(o);});
      applyTidelineRenderRule(...optics);
    });
    await draw(map + '-after.png');
    const after = await read();
    if (after.materials.length !== 2 || after.materials.some(m => !m.fog || !m.toneMapped || !m.fogChunk || !m.toneChunk)) {
      throw Error(map + ': optical materials do not use shared fog and tone mapping');
    }
    captures.push({map, url, errors, before, after});
    await writeFile(out + '/captures.json', JSON.stringify({instrument:'scripts/visual/neon-optics-review.mjs', shipped, captures}, null, 2) + '\n');
    if (errors.length) throw Error(errors.join('\n'));
    console.log(map, 'shared optical material checks PASS');
    await page.close();
  }
} finally {await browser.close();}
