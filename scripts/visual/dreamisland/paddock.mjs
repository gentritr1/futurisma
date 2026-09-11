// Phase D — the start screen for each race format, framed tall enough to read.
//
// `race.mjs` already shoots `start.png` before it clicks, but it runs at the
// 1280x720 the draw-call instrument is calibrated for, and `style.css:2224`
// hides `.chip small` on any intro screen under 900 px tall (seven circuits
// need two rows, so the deck lines are the first thing dropped). The FORMAT
// row's deck lines ARE the phase-D menu work, so proving they exist needs a
// viewport that shows them. Nothing here races: it opens the paddock, reads
// the chips out of the DOM, shoots the panel and closes.
//
//   node scripts/visual/dreamisland/paddock.mjs --out=art/evidence/dreamisland-v1/phase-d/paddock
import {mkdir,writeFile} from 'node:fs/promises';
import {launchReviewBrowser} from '../tideline-v4/browser.mjs';
const flag=name=>process.argv.find(a=>a.startsWith('--'+name+'='))?.slice(name.length+3);
const out=flag('out')??'art/evidence/dreamisland-v1/phase-d/paddock';
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
  const url='http://127.0.0.1:5200/?map=dreamisland&seed=3868938316&tier=works&mode='+mode
   +'&demo=1&headless=1&diagnostics=1&start=manual&quality=high&music=0';
  await page.goto(url,{waitUntil:'networkidle0',timeout:60000});
  await page.waitForSelector('#start-button',{visible:true});
  await page.screenshot({path:out+'/start-'+mode+'.png'});
  report.push({mode,url,errors,...await page.evaluate(()=>({
   introDeck:document.querySelector('.intro-deck')?.textContent??null,
   introFooter:document.querySelector('.intro-footer')?.textContent??null,
   lapValue:document.getElementById('lap-value')?.textContent??null,
   // Both halves of every chip, and whether the deck line is actually painted
   // at this viewport — a note in the DOM that CSS has hidden is not a note the
   // player can read, and that distinction is the whole reason this file exists.
   formatChips:[...document.querySelectorAll('#format-select [data-value]')].map(chip=>({
    value:chip.dataset.value,selected:chip.getAttribute('aria-checked')==='true',
    label:chip.querySelector('strong')?.textContent??null,
    note:chip.querySelector('small')?.textContent??null,
    noteVisible:(()=>{const small=chip.querySelector('small');
     return small?getComputedStyle(small).display!=='none':false;})()})),
  }))});
  await page.close();
 }
 await writeFile(out+'/paddock.json',JSON.stringify({script:'scripts/visual/dreamisland/paddock.mjs',
  viewport:{width,height},
  scope:'The start screen only. No race is run, so nothing here is a performance measurement.',
  modes:report},null,2));
 console.log(JSON.stringify(report.map(r=>({mode:r.mode,errors:r.errors.length,
  lapValue:r.lapValue,notesVisible:r.formatChips.filter(c=>c.noteVisible).length+'/'+r.formatChips.length,
  deck:r.introDeck}))));
}finally{await browser.close();}
