import {launchReviewBrowser} from './browser.mjs';
import {writeFile} from 'node:fs/promises';
const browser=await launchReviewBrowser();
try {
 const page=await browser.newPage();
 page.on('pageerror',error=>console.log('PAGE ERROR',String(error)));
 page.on('console',message=>{if(message.type()==='error'||message.text().startsWith('PROBE'))console.log(message.text());});
 await page.evaluateOnNewDocument(()=>{
  window.__probe=renderer=>{
   const render=renderer.render.bind(renderer);let peak=0,draws=[],frames=0;
   renderer.render=(scene,camera)=>{
    draws=[];
    scene.traverse(object=>{
     if(!object.isMesh||object.userData.probed)return;
     object.userData.probed=true;
     const before=object.onBeforeRender;
     object.onBeforeRender=function(...args){
      before.apply(this,args);
      const material=args[4];
      draws.push({name:this.name,type:material.type,side:material.side,transparent:material.transparent,single:material.forceSinglePass});
     };
    });
    const result=render(scene,camera);
    if(renderer.info.render.calls>peak){peak=renderer.info.render.calls;window.__peak={calls:peak,time:document.getElementById('time-value')?.textContent,draws};}
    if(++frames%120===0)console.log('PROBE '+document.getElementById('time-value')?.textContent);
    return result;
   };
  };
 });
 await page.setRequestInterception(true);
 page.on('request',async request=>{
  if(new URL(request.url()).pathname==='/src/game/game.ts'){
   const response=await fetch(request.url());
   await request.respond({status:200,contentType:'text/javascript',body:(await response.text()).replace('this.renderer.outputColorSpace = THREE.SRGBColorSpace;','this.renderer.outputColorSpace = THREE.SRGBColorSpace;window.__probe(this.renderer);')});
  }else await request.continue();
 });
 await page.goto('http://127.0.0.1:5215/?map=tideline&seed=3868938316&demo=1&headless=1&diagnostics&start=manual&music=0&quality=high',{waitUntil:'networkidle0'});
 await page.click('#start-button');
 try {await page.waitForFunction(()=>JSON.parse(document.getElementById('futurisma-diagnostics').textContent).current.phase==='finished',{timeout:160000});}
 finally {await writeFile('/tmp/tideline-v4-draw-probe.json',JSON.stringify(await page.evaluate(()=>({peak:window.__peak,diagnostics:document.getElementById('futurisma-diagnostics')?.textContent})),null,2));await page.screenshot({path:'/tmp/tideline-v4-draw-probe.png'});}
}finally{await browser.close();}
