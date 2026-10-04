import assert from 'node:assert/strict';
import {mkdir, writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';

const output = 'art/evidence/race-polish';await mkdir(output, {recursive: true});
const browser = await chromium.launch({executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist']});
const report = {};
try {
  const page = await browser.newPage({viewport: {width: 1440, height: 900}});
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    window.__pulses = [];
    window.__pad = {index: 0, id: 'Review pad', connected: true, mapping: 'standard', axes: [0, 0, 0, 0],
      buttons: Array.from({length: 17}, () => ({pressed: false, touched: false, value: 0})),
      vibrationActuator: {playEffect: async (effect, parameters) => {window.__pulses.push({effect, ...parameters});return 'complete';}}};
    Object.defineProperty(navigator, 'getGamepads', {value: () => [window.__pad]});
  });
  await page.route('**/src/game/game.ts*', async route => {
    const response = await route.fetch();
    const body = (await response.text()).replace('this.renderer.outputColorSpace = THREE.SRGBColorSpace;',
      'this.renderer.outputColorSpace = THREE.SRGBColorSpace; window.__game = this;');
    await route.fulfill({response, body});
  });
  await page.goto('http://127.0.0.1:5218/?map=greenwater&music=0&voice=0&quality=high&motion=reduce&laps=1');
  await page.waitForFunction(() => window.__game?.circuitRuntime && document.body.dataset.phase === 'intro');
  await page.locator('#start-button').click();
  await page.waitForFunction(() => window.__game.phase === 'running');
  await page.waitForFunction(() => document.querySelector('.map-hud-condition').textContent.includes('RT'));
  await page.waitForFunction(() => !document.body.dataset.launch);
  assert.equal(await page.locator('.hud').getAttribute('data-theme-motion'), 'reduce');
  const pulses = await page.evaluate(() => window.__pulses);
  assert.ok(pulses.some(p => p.duration === 140 && p.strongMagnitude === .18 && p.weakMagnitude === .32), 'GO haptic dispatched once');
  assert.equal(pulses.filter(p => p.duration === 140).length, 1);
  await page.evaluate(() => Object.assign(window.__pad.buttons[7], {value: 1, pressed: true}));
  await page.waitForFunction(() => window.__game.speed > 20);
  await page.evaluate(() => Object.assign(window.__pad.buttons[0], {value: 1, pressed: true}));
  await page.waitForFunction(() => window.__game.boostActive);
  await page.waitForTimeout(100);
  report.pad = {pulses, snapshot: await page.evaluate(() => window.__game.captureRaceSnapshot())};
  await page.evaluate(() => {
    Object.assign(window.__pad.buttons[7], {value: 0, pressed: false});
    Object.assign(window.__pad.buttons[0], {value: 0, pressed: false});
  });
  await page.keyboard.press('p');await page.waitForFunction(() => window.__game.phase === 'paused');
  for (const [width, height] of [[390, 844], [844, 390]]) {
    await page.setViewportSize({width, height});
    await page.evaluate(() => {
      document.querySelector('#pause-panel').style.display = 'none';
      // Freeze simulation through g.phase, but inspect the actual racing CSS.
      // The garage skin deliberately hides the HUD on paused/result surfaces.
      document.body.dataset.phase = 'race';
      document.querySelector('#countdown').style.visibility = 'hidden';
      const g = window.__game;g.speed = 0;g.elapsedMs = 0;g.boostActive = false;
      g.updatePose({throttle: 0, brake: 0, steer: 0, boost: false}, 0);
      g.updateHud({throttle: 0, brake: 0, steer: 0, boost: false});
      // Exercise the lesson in the racing layout without running simulation.
      const hud = document.querySelector('.map-hud-environment');hud.dataset.guidance = 'true';
      document.querySelector('.map-hud-condition').textContent = 'W / ↑ · THRUST';
      document.querySelector('.map-hud-advice').textContent = 'Hold to leave the grid. Steer with A / D.';
    });
    await page.waitForTimeout(100);
    const bounds = await page.locator('.map-hud-environment').boundingBox();
    const presentation = await page.locator('.map-hud-environment').evaluate(node => ({visibility: getComputedStyle(node).visibility, body: {...document.body.dataset}, hudStyle: document.querySelector('.hud').getAttribute('style')}));
    assert.equal(presentation.visibility, 'visible', `Lesson is actually visible: ${JSON.stringify(presentation)}`);
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width && bounds.y >= 0 && bounds.y + bounds.height <= height, 'Lesson fits narrow viewport');
    await page.screenshot({path: `${output}/guidance-${width}x${height}.png`});
  }
  await page.setViewportSize({width: 1440, height: 900});
  await page.evaluate(() => {document.body.dataset.phase = 'paused';});
  const roundBefore = await page.evaluate(() => window.__game.captureRaceSnapshot());
  await page.evaluate(() => {const g = window.__game;g.phase = 'finished';g.startTrial();});
  await page.waitForFunction(() => window.__game.phase === 'running');
  const roundAfter = await page.evaluate(() => window.__game.captureRaceSnapshot());
  assert.ok(roundAfter.round > roundBefore.round);assert.ok(roundAfter.tick > 0);
  report.retry = {before: roundBefore.round, after: roundAfter.round};
  assert.deepEqual(errors, []);await page.close();

  const fallback = await browser.newPage();const fallbackErrors = [], warnings = [];
  fallback.on('pageerror', error => fallbackErrors.push(error.message));
  fallback.on('console', message => {if (message.type() === 'warning') warnings.push(message.text());});
  await fallback.route('**/timing-kit.glb', route => route.fulfill({contentType: 'model/gltf+json', body: JSON.stringify({asset: {version: '2.0'}, scenes: [{nodes: []}], nodes: [], scene: 0})}));
  await fallback.route('**/assets/circuit-signatures/*.glb', route => route.fulfill({contentType:'model/gltf+json',body:JSON.stringify({asset:{version:'2.0'},scenes:[{nodes:[]}],nodes:[],scene:0})}));
  await fallback.goto('http://127.0.0.1:5218/?map=greenwater&music=0&voice=0');
  await fallback.waitForFunction(() => document.body.dataset.phase === 'intro');
  await fallback.keyboard.press('Enter');await fallback.waitForFunction(() => document.body.dataset.phase === 'race' && !document.body.dataset.launch);
  await fallback.keyboard.down('w');await fallback.waitForTimeout(1600);
  assert.notEqual(await fallback.locator('#speed-value').textContent(), '000');
  assert.ok(warnings.some(warning => warning.includes('Optional timing hardware unavailable')));
  assert.ok(warnings.some(warning=>warning.includes('Optional circuit scene unavailable')));
  assert.deepEqual(fallbackErrors, []);report.fallback = {warnings, errors: fallbackErrors};
  await fallback.close();
} finally {await browser.close();await writeFile(`${output}/systems.json`, JSON.stringify(report, null, 2));}
console.log('Race polish systems PASS: simulated gamepad prompts/throttle/boost/GO pulse; reduced-motion setting; narrow-screen layout; fresh retry round; optional asset fallback.');
