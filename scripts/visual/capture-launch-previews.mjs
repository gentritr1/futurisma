import { chromium } from 'playwright';
import { createServer } from 'vite';
import { mkdir } from 'node:fs/promises';

const server = await createServer({server:{host:'127.0.0.1',port:5358,strictPort:true},logLevel:'error'});
await server.listen();
const browser = await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--ignore-gpu-blocklist']});
await mkdir('public/assets/launch',{recursive:true});
try {
  for(const map of ['greenwater','bitterpan','nightshift','polarity','tideline','ascension','dreamisland']) {
    const context=await browser.newContext({viewport:{width:1440,height:900},deviceScaleFactor:1});
    await context.route('**/src/game/game.ts',async route=>{
      const response=await route.fetch();
      const body=(await response.text()).replace('this.renderer.render(this.garageView', 'window.__launchRender = {renderer:this.renderer,scene:this.scene,camera:this.camera}; this.renderer.render(this.garageView');
      await route.fulfill({response,body});
    });
    const page=await context.newPage();
    await page.goto(`http://127.0.0.1:5358/?map=${map}&craft=stock&launchCapture=1`,{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>document.body.dataset.phase==='intro'&&window.__launchRender,null,{timeout:300000});
    await page.waitForTimeout(1800);
    await page.evaluate(()=>{
      const {renderer,scene,camera}=window.__launchRender;
      const preview=camera.clone();preview.position.y+=7;
      const forward=camera.getWorldDirection(camera.position.clone());
      preview.position.addScaledVector(forward,-9);
      preview.lookAt(camera.position.clone().addScaledVector(forward,65));
      renderer.render(scene,preview);
    });
    await page.evaluate(()=>{for(const node of document.querySelectorAll('#app > :not(#game-canvas)'))node.style.display='none';});
    await page.locator('#game-canvas').screenshot({path:`public/assets/launch/${map}.jpg`,type:'jpeg',quality:83});
    console.log(`Captured ${map}`);await context.close();
  }
} finally {await browser.close();await server.close();}
