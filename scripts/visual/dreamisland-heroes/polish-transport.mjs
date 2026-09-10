/** Transport-only adapter for the unchanged race.mjs, which pins port 5200.
 * Keep another process's listener untouched; route page navigation to our own
 * Vite instance. No frame, physics, browser option or instrument is changed. */
import puppeteer from '/tmp/futurisma-v4-harness/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
export default {...puppeteer,launch:async options=>{
 const browser=await puppeteer.launch(options),newPage=browser.newPage.bind(browser),close=browser.close.bind(browser);
 browser.close=async()=>{
  let timer;
  try{await Promise.race([close(),new Promise(resolve=>{timer=setTimeout(()=>{browser.disconnect();browser.process()?.kill('SIGTERM');resolve();},10000);})]);}
  finally{clearTimeout(timer);}
 };
 browser.newPage=async()=>{
  const page=await newPage(),goto=page.goto.bind(page);
  page.goto=async(url,options)=>{
   const effective=url.replace('http://127.0.0.1:5200/','http://127.0.0.1:5217/');
   if(effective===url)return goto(url,options);
   const out=process.argv.find(a=>a.startsWith('--out='))?.slice(6);
   assert.ok(out?.startsWith('art/evidence/dreamisland-v1/polish/soak-'));
   await mkdir(out,{recursive:true});await writeFile(out+'/transport.json',JSON.stringify({adapter:'scripts/visual/dreamisland-heroes/polish-transport.mjs',instrument:'scripts/visual/dreamisland/race.mjs',requestedUrl:url,effectiveUrl:effective,reason:'Port 5200 was already occupied. Only page navigation is redirected to this task’s private server.'},null,2)+'\n');
   return goto(effective,options);
  };
  return page;
 };
 return browser;
}};
