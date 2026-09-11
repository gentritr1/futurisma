// The start screen for each race format, on any circuit, framed tall enough to
// read — and with the starting-grid list read out of the DOM.
//
// `scripts/visual/dreamisland/paddock.mjs` shoots the same panel but is pinned
// to Map 07 and reads only the format chips. The starting grid is what this
// copy adds, because a grid row is exactly the thing a 1280x720 soak cannot
// see: `src/style.css:2225` hides `#grid-order` on any intro screen under
// 900 px tall, so the rows have to be BOTH read from the DOM and shot at a
// viewport that paints them. Nothing here races: it opens the paddock, reads
// the chips and the grid, shoots the panel and closes.
//
//   node scripts/visual/paddock/paddock.mjs --map=ascension --out=/tmp/asc-paddock-after
import {mkdir,writeFile} from 'node:fs/promises';
import {launchReviewBrowser} from '../tideline-v4/browser.mjs';
const flag=name=>process.argv.find(a=>a.startsWith('--'+name+'='))?.slice(name.length+3);
const map=flag('map')??'dreamisland';
const out=flag('out')??('art/evidence/paddock-grid-fix/'+map);
const seed=flag('seed')??'3868938316';
const height=Number(flag('height')??1000),width=Number(flag('width')??1280);
await mkdir(out,{recursive:true});
const browser=await launchReviewBrowser();
const report=[];
try{
 for(const mode of ['race','sprint','timeattack']){
  const page=await browser.newPage(),errors=[];
  page.on('pageerror',e=>{errors.push(String(e));});
  page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.setViewport({width,height,deviceScaleFactor:1});
  const url='http://127.0.0.1:5200/?map='+map+'&seed='+seed+'&tier=works&mode='+mode
   +'&demo=1&headless=1&diagnostics=1&start=manual&quality=high&music=0';
  await page.goto(url,{waitUntil:'networkidle0',timeout:60000});
  await page.waitForSelector('#start-button',{visible:true});
  await page.screenshot({path:out+'/start-'+mode+'.png'});
  report.push({mode,url,errors,...await page.evaluate(()=>({
   introDeck:document.querySelector('.intro-deck')?.textContent??null,
   introFooter:document.querySelector('.intro-footer')?.textContent??null,
   lapValue:document.getElementById('lap-value')?.textContent??null,
   // The defect this harness exists for: the markup ships four placeholder rows
   // and a fieldless format never replaced them. `rowsVisible` is separate from
   // the count because a row CSS has hidden is still a row the JSON would
   // report, and at 1280x720 every one of them is hidden.
   startingGrid:[...document.querySelectorAll('#grid-order li')].map(row=>row.textContent),
   gridRowsVisible:(()=>{const list=document.getElementById('grid-order');
    return list?getComputedStyle(list).display!=='none':false;})(),
   formatChips:[...document.querySelectorAll('#format-select [data-value]')].map(chip=>({
    value:chip.dataset.value,selected:chip.getAttribute('aria-checked')==='true',
    label:chip.querySelector('strong')?.textContent??null,
    note:chip.querySelector('small')?.textContent??null,
    noteVisible:(()=>{const small=chip.querySelector('small');
     return small?getComputedStyle(small).display!=='none':false;})()})),
  }))});
  await page.close();
 }
 await writeFile(out+'/paddock.json',JSON.stringify({script:'scripts/visual/paddock/paddock.mjs',
  map,seed,viewport:{width,height},
  scope:'The start screen only. No race is run, so nothing here is a performance measurement.',
  modes:report},null,2));
 console.log(JSON.stringify(report.map(r=>({mode:r.mode,errors:r.errors.length,
  lapValue:r.lapValue,gridRows:r.startingGrid.length,gridVisible:r.gridRowsVisible,
  grid:r.startingGrid})),null,1));
}finally{await browser.close();}
