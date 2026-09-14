import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {launchReviewBrowser} from '../../../../scripts/visual/tideline-v4/browser.mjs';
const label=process.argv[2]??'before',out=`art/evidence/dreamisland-v1/vs-design/ball-${label}`;await mkdir(out,{recursive:true});
const browser=await launchReviewBrowser();try{
const page=await browser.newPage();
if(label==='before'){await page.setRequestInterception(true);page.on('request',async request=>{if(new URL(request.url()).pathname==='/assets/dreamisland/props.glb')await request.respond({status:200,contentType:'model/gltf-binary',body:await readFile('/tmp/di-b59-props.glb')});else await request.continue();});}
page.on('pageerror',e=>console.log(String(e)));
await page.goto('http://127.0.0.1:5200/art/evidence/dreamisland-v1/vs-design/ball.html?kind=PR_ball&distance=8',{waitUntil:'networkidle0'});
await page.waitForFunction(()=>window.__assetReady);const data=await page.evaluate(()=>({images:window.__images,proof:window.__assetProof}));
for(const [name,url] of Object.entries(data.images))await writeFile(`${out}/${name}.png`,Buffer.from(url.split(',')[1],'base64'));
await writeFile(`${out}/proof.json`,JSON.stringify(data.proof,null,2));
}finally{await browser.close();}
