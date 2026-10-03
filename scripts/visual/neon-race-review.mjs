/** Full Works race on each city affected by the optical-material correction. */
import {mkdir, writeFile} from 'node:fs/promises';
import {launchReviewBrowser} from './tideline-v4/browser.mjs';
import {instrument} from './dreamisland/instrument.mjs';

const out = 'art/evidence/map-polish-review/races';
await mkdir(out, {recursive:true});
const browser = await launchReviewBrowser({protocolTimeout:300000});
try {
  for (const map of ['nightshift', 'polarity']) {
    const page = await browser.newPage(), errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    page.on('console', m => {if (m.type() === 'error') errors.push(m.text());});
    await instrument(page);
    await page.evaluateOnNewDocument(() => {
      window.__diCaptureFrame = () => {
        try {
          const c = JSON.parse(document.getElementById('futurisma-diagnostics').textContent).current;
          window.__diFrames.at(-1).phase = c.phase;
        } catch {}
      };
    });
    const url = `http://127.0.0.1:5200/?map=${map}&seed=3868938316&tier=works&demo=1&headless=1&diagnostics=1&start=manual&quality=high&music=0&voice=0`;
    await page.goto(url, {waitUntil:'networkidle0', timeout:60000});
    await page.waitForSelector('#start-button', {visible:true});
    const calibration = await page.evaluate(() => new Promise(resolve => {
      const times = [];
      function tick(t) {
        times.push(t);
        if (times.length < 121) requestAnimationFrame(tick);
        else resolve({samples:120, windowMs:times.at(-1)-times[0], hz:120000/(times.at(-1)-times[0])});
      }
      requestAnimationFrame(tick);
    }));
    await page.click('#start-button');
    await page.waitForFunction(() => {
      try {return JSON.parse(document.getElementById('futurisma-diagnostics').textContent).current.phase === 'finished';}
      catch {return false;}
    }, {timeout:240000});
    const capture = await page.evaluate(() => {
      const optics = [];
      window.__diScene.traverse(o => {
        if (/_neon_(halation|puddles)$/.test(o.name)) optics.push({object:o.name, fog:o.material.fog, toneMapped:o.material.toneMapped});
      });
      return {frames:window.__diFrames.filter(f => f.phase === 'running'), optics,
        diagnostics:JSON.parse(document.getElementById('futurisma-diagnostics').textContent).current};
    });
    if (!capture.frames.length) throw Error(map + ': no racing frames');
    const window = capture.frames.slice(-720), sorted = window.map(f => f.delta).sort((a,b) => a-b);
    const windowMs = window.reduce((sum,f) => sum+f.delta, 0);
    const expected = windowMs/1000*calibration.hz;
    const metrics = {instrument:'scripts/visual/neon-race-review.mjs', map, url, errors, calibration,
      frames:capture.frames.length, windowSamples:window.length, windowMs, expectedSamples:expected,
      sampleResidual:window.length-expected, p95Ms:sorted[Math.floor(sorted.length*.95)],
      peakTotalCalls:Math.max(...capture.frames.map(f => f.mainCalls+f.shadowCalls)),
      peakTotalTriangles:Math.max(...capture.frames.map(f => f.mainTriangles+f.shadowTriangles)),
      lapTimesMs:capture.diagnostics.lapTimesMs, missedGates:capture.diagnostics.missedGates,
      recoveries:capture.diagnostics.recoveries, optics:capture.optics};
    await writeFile(`${out}/${map}.json`, JSON.stringify({metrics, diagnostics:capture.diagnostics, frameWindow:window}, null, 2)+'\n');
    await page.screenshot({path:`${out}/${map}-finish.png`});
    console.log(JSON.stringify(metrics));
    if (errors.length || metrics.lapTimesMs.length !== 3 || metrics.missedGates || metrics.recoveries
      || metrics.optics.length !== 2 || metrics.optics.some(m => !m.fog || !m.toneMapped)) {
      throw Error(map + ': race/material acceptance failed');
    }
    await page.close();
  }
} finally {await browser.close();}
