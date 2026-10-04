import assert from 'node:assert/strict';
import {mkdir, writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';

const fullLap = process.argv.includes('--laps');
const reduce = process.argv.includes('--reduce');
const maps = process.argv.slice(2).filter(value => !value.startsWith('--'));
if (!maps.length) maps.push('greenwater', 'nightshift', 'frostline');
const kitMaps = new Set(['greenwater', 'bitterpan', 'nightshift', 'afterglow']);
const output = 'art/evidence/race-polish';
await mkdir(output, {recursive: true});
const browser = await chromium.launch({executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist']});
const report = [];
try {
  for (const map of maps) {
    const page = await browser.newPage({viewport: {width: 1440, height: 900}});
    // Development edits must not reload a multi-minute regression lap.
    await page.routeWebSocket('**',socket=>socket.send(JSON.stringify({type:'connected'})));
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {if (message.type() === 'error') errors.push(message.text());});
    // Development interception only. No globals are added to shipped source.
    await page.route('**/src/game/game.ts*', async route => {
      const response = await route.fetch();
      const body = (await response.text()).replace('this.renderer.outputColorSpace = THREE.SRGBColorSpace;',
        'this.renderer.outputColorSpace = THREE.SRGBColorSpace; window.__game = this;');
      await route.fulfill({response, body});
    });
    await page.goto(`http://127.0.0.1:5218/?map=${map}&quality=high&render=agx&music=0&voice=0&laps=1&diagnostics=1${fullLap ? '&demo=1' : ''}${reduce ? '&motion=reduce' : ''}`);
    await page.waitForFunction(() => window.__game?.circuitRuntime && (document.body.dataset.phase === 'intro' || window.__game.phase === 'running'), null, {timeout: 60000});
    await page.waitForTimeout(800);
    await page.screenshot({path: `${output}/${map}-menu.png`});
    const hardware = await page.evaluate(() => {
      const root = window.__game.course.group.getObjectByName('race_timing_hardware');
      return root ? {instances: root.userData.instances, draws: root.userData.drawCalls,
        geometry: root.children.filter(n => n.isInstancedMesh).map(n => ({name: n.name, count: n.count}))} : null;
    });
    assert.equal(Boolean(hardware), kitMaps.has(map), `${map}: intended timing hardware`);
    if (hardware) assert.equal(hardware.draws, 4);
    if (fullLap) {
      await page.waitForFunction(() => window.__game.phase === 'finished', null, {timeout: 180000});
      const result = await page.evaluate(async () => ({phase: window.__game.phase, recoveries: window.__game.diagnosticRecoveries,
        missedGates: window.__game.diagnosticMissedGates, snapshot: await window.__game.captureRaceSnapshot(),
        diagnostics: JSON.parse(document.getElementById('futurisma-diagnostics')?.textContent || '{}').current}));
      assert.equal(result.missedGates, 0, 'Full lap clears every gate');
      assert.equal(result.recoveries, 0, 'Full lap needs no recovery');
      assert.deepEqual(errors, []);
      await page.screenshot({path: `${output}/${map}-finish.png`});
      report.push({map, hardware, result, errors});await page.close();continue;
    }
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.__game.phase === 'running', null, {timeout: 20000});
    await page.waitForTimeout(400);
    assert.equal(await page.locator('.map-hud-environment').getAttribute('data-guidance'), 'true', 'Grid has a throttle lesson');
    assert.match(await page.locator('.map-hud-condition').textContent(), /THRUST/);
    await page.screenshot({path: `${output}/${map}-grid.png`});
    await page.keyboard.down('w');
    await page.waitForTimeout(2000);
    await page.keyboard.down('Shift');
    await page.waitForTimeout(700);
    const driving = await page.evaluate(async () => ({speed: window.__game.speed,
      boost: window.__game.boostActive, snapshot: await window.__game.captureRaceSnapshot('review-player')}));
    assert.ok(driving.speed > 10, 'Manual throttle moves craft');
    assert.equal(driving.boost, true, 'Manual boost works');
    assert.equal(driving.snapshot.version, 1);assert.ok(driving.snapshot.tick > 0);
    assert.equal(driving.snapshot.circuit, map);assert.equal(driving.snapshot.playerId, 'review-player');
    assert.doesNotMatch(await page.locator('.map-hud-condition').textContent(), /THRUST/, 'Learned throttle clears; later lessons may still appear');
    await page.screenshot({path: `${output}/${map}-boost.png`});
    await page.keyboard.up('Shift');await page.keyboard.up('w');
    await page.keyboard.press('p');
    await page.waitForFunction(() => window.__game.phase === 'paused');
    const paused = await page.evaluate(() => window.__game.captureRaceSnapshot());
    await page.waitForTimeout(350);
    const pausedAgain = await page.evaluate(() => window.__game.captureRaceSnapshot());
    assert.equal(paused.tick, pausedAgain.tick, 'Pause freezes session tick');
    assert.deepEqual(paused.position, pausedAgain.position, 'Pause freezes simulation pose');
    const lights = hardware ? await page.evaluate(() => {
      const g = window.__game, lens = g.course.group.getObjectByName('timing_lens_field');
      g.course.setCheckpointProgress(2);
      return {first: Array.from(lens.instanceColor.array.slice(6, 9)), second: Array.from(lens.instanceColor.array.slice(12, 15))};
    }) : null;
    if (lights) assert.notDeepEqual(lights.first, lights.second, 'Cleared and target gates use distinct lights');
    // Compose a roadside close-up with the actual imported model and race lights.
    if (hardware) await page.evaluate(() => {
      const g = window.__game, gate = 1;
      const s = g.course.sample(g.course.checkpointProgress(gate));
      const lateral = Math.max(s.halfWidth + s.apronRight, g.course.checkpointHalfWidth(gate)) + 2.4;
      const target = s.position.clone().addScaledVector(s.right, lateral).addScaledVector(s.up, 2.4);
      g.camera.position.copy(target).addScaledVector(s.tangent, -8).addScaledVector(s.right, -4).addScaledVector(s.up, 1.4);
      g.camera.lookAt(target);g.camera.fov = 48;g.camera.updateProjectionMatrix();
      g.sceneAssets.authoredEnvironment?.updateVisibility(g.camera);g.renderer.render(g.scene, g.camera);
      document.querySelector('#pause-panel').style.display = 'none';
      document.querySelector('.hud').style.visibility = 'hidden';
    });
    if (hardware) await page.screenshot({path: `${output}/${map}-timing-kit.png`});
    // Dispose only our art; restore course method and release instance buffers.
    const disposal = await page.evaluate(() => {
      const g = window.__game;g.circuitRuntime.dispose();
      return !g.course.group.getObjectByName('race_timing_hardware');
    });
    assert.equal(disposal, true);
    assert.deepEqual(errors, [], `${map}: browser errors`);
    report.push({map, hardware, driving, lights, pausedTick: paused.tick, errors});
    await page.close();
  }
} finally {await browser.close();await writeFile(`${output}/${fullLap ? 'full-laps' : reduce ? 'reduced-motion' : 'browser-report'}.json`, JSON.stringify(report, null, 2));}
console.log(`Race polish browser PASS: ${report.map(row => row.map).join(', ')}; manual driving, boost, guidance, snapshots, pause, gate lights and disposal.`);
