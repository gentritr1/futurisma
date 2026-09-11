import {createServer} from 'node:http';
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {resolve, extname, sep} from 'node:path';
import assert from 'node:assert/strict';
import {launchReviewBrowser} from '../tideline-v4/browser.mjs';

const root=process.cwd(),out='art/evidence/dreamisland-v1/heroes';
const chosen=process.argv.find(arg=>arg.startsWith('--asset='))?.split('=')[1];
assert.ok(!chosen || ['clock-tower','watchtower','waterfall-cliff','sea-stack-set'].includes(chosen));
await mkdir(out,{recursive:true});
const server=createServer(async(req,res)=>{
 try{
  const path=resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));
  assert.ok(path.startsWith(root+sep));
  const extension=extname(path),types={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.glb':'model/gltf-binary'};
  res.setHeader('Content-Type',types[extension]??'application/octet-stream');res.end(await readFile(path));
 }catch(error){res.statusCode=404;res.end(String(error));}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;
try{
 browser=await launchReviewBrowser();
 const page=await browser.newPage();await page.setViewport({width:1280,height:960,deviceScaleFactor:1});
 const errors=[];page.on('pageerror',error=>errors.push(String(error)));
 page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
 await page.goto(`http://127.0.0.1:${server.address().port}/scripts/visual/dreamisland-heroes/viewer.html`,{waitUntil:'networkidle0'});
 await page.waitForFunction(()=>window.reviewReady===true,{timeout:30000});
 const report=chosen?JSON.parse(await readFile(out+'/render-check.json','utf8')):{status:'VERIFIED',renderer:'three r184 WebGLRenderer, loaded exported GLBs, shared atlas files',frames:[]};
 if(chosen)report.frames=report.frames.filter(frame=>frame.name!==chosen);
 for(const name of chosen?[chosen]:['clock-tower','watchtower','waterfall-cliff','sea-stack-set']){
  for(const view of ['front','side','back','three-quarter']){
   const frame=await page.evaluate((name,view)=>window.renderHero(name,view),name,view);
   frame.file='webgl-'+name+'-'+view+'.png';await page.screenshot({path:out+'/'+frame.file});report.frames.push(frame);
  }
 }
 for(const [name,distance] of [['clock-tower',40],['watchtower',40],['sea-stack-set',300]]){
  if(chosen && name!==chosen)continue;
  const frame=await page.evaluate((name,distance)=>window.renderDistance(name,distance),name,distance);
  frame.file='webgl-'+name+'-'+distance+'m.png';await page.screenshot({path:out+'/'+frame.file});report.frames.push(frame);
 }
 report.atlasPixelProof=await page.evaluate(()=>window.checkAtlasPixels());
 for(const [index,proof] of report.atlasPixelProof.entries()){
  if(proof.image){
   proof.file='atlas-pixel-'+index+'-'+proof.role+'.png';
   await writeFile(out+'/'+proof.file,Buffer.from(proof.image.split(',')[1],'base64'));
   delete proof.image;
  }
 }
 assert.deepEqual(errors,[],'Browser errors');
 await writeFile(out+'/render-check.json',JSON.stringify(report,null,2)+'\n');
 console.log('VERIFIED',report.frames.length,'exported-GLB frames with metre calibration; atlas pixel proofs',report.atlasPixelProof.length,'browser errors',errors.length);
}finally{
 if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));
}
