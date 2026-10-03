import {rounds, validateResult, standingsFor, cupTarget, formatLap} from './cup.js';
const byId = id => document.getElementById(id);
const results = [];
let sampleMode = false;
let activeToken = null;
let finishPending = false;
let timeout;
const frame = byId('race');

function render() {
  const complete = results.length === rounds.length;
  const round = rounds[Math.min(results.length, rounds.length-1)];
  byId('scene').src = '/art/evidence/map-polish-review/' + round.image;
  byId('scene').alt = `${round.name} captured in the current game`;
  byId('stage-label').textContent = complete ? 'GRAND TOUR · CLASSIFICATION LOCKED' : `GRAND TOUR · ${results.length ? 'UP NEXT' : 'OPENING ROUND'}`;
  byId('tour-title').textContent = complete ? 'CUP COMPLETE' : round.name;
  byId('deck').textContent = complete ? 'Every round counted. Your final classification is recorded below.' : round.detail;
  byId('round-label').textContent = complete ? 'CUP COMPLETE' : `ROUND 0${results.length+1} / 03`;
  byId('round-count').textContent = results.length ? `${results.length} / 3 ROUNDS LOGGED` : 'BEFORE ROUND 01';
  byId('launch').replaceChildren(document.createTextNode(complete ? 'START A NEW CUP' : `RACE ${round.name}`));
  const arrow = document.createElement('span'); arrow.textContent='↗'; arrow.setAttribute('aria-hidden','true'); byId('launch').append(arrow);
  byId('launch').disabled = sampleMode;
  byId('race-note').textContent = complete ? 'Another run. A clean slate.' : results.length ? round.detail : 'Your opening round.';
  const rows = standingsFor(results);
  const target = cupTarget(results);
  byId('verdict').textContent = target.headline;
  byId('verdict-detail').textContent = target.detail;
  byId('standings').replaceChildren();
  for (const row of rows.length ? rows : [{name:'TOTEM',player:true},{name:'FIELD DRIVER'},{name:'FIELD DRIVER'},{name:'FIELD DRIVER'}]) {
    const tr = document.createElement('tr'); if (row.player) tr.className='player';
    for (const value of [row.cupPosition ? String(row.cupPosition).padStart(2,'0') : '—', row.name, row.points ?? '—']) {
      const td = document.createElement('td'); td.textContent=String(value); tr.append(td);
    }
    if (row.player) { const you = document.createElement('small'); you.textContent='YOU'; tr.children[1].append(you); }
    byId('standings').append(tr);
  }
  byId('rounds').replaceChildren();
  rounds.forEach((item,index) => {
    const li = document.createElement('li'); if(index===results.length) {li.className='current';li.setAttribute('aria-current','step');}
    const img=document.createElement('img');img.src='/art/evidence/map-polish-review/'+item.image;img.alt='';
    const text=document.createElement('div');const number=document.createElement('p');number.className='number';number.textContent=`0${index+1} / ${index===2?'FINAL':'ROUND'}`;
    const name=document.createElement('strong');name.textContent=item.name;
    const status=document.createElement('span');status.className='status';
    const finish=results[index]?.standings.find(row=>row.player);
    status.textContent=finish?`P${finish.position} · +${5-finish.position} POINTS`:index===results.length?'UP NEXT':'TO COME';
    text.append(number,name,status);
    const lap = formatLap(results[index]?.bestLapMs);
    if (lap) {const best = document.createElement('span');best.className='status';best.textContent=`BEST ${lap}`;text.append(best);}
    li.append(img,text);byId('rounds').append(li);
  });
  byId('sample-label').hidden=!sampleMode;
  byId('reset').hidden=!results.length;
  byId('sample').hidden=complete || (!sampleMode && results.length>0);
  byId('sample').textContent=sampleMode?'Preview next finish →':'Preview a finish →';
}
function closeRace() {
  clearTimeout(timeout); activeToken=null;finishPending=false;frame.inert=false;frame.removeAttribute('src');
  byId('continue').hidden=true;byId('leave').hidden=false;byId('race-shell').classList.remove('finished');
  byId('race-shell').hidden=true;byId('tour').inert=false;document.body.style.overflow='';byId('launch').focus();
}
function reset() {results.length=0;sampleMode=false;byId('feedback').textContent='';render();byId('launch').focus();}
byId('launch').addEventListener('click',()=>{
  if(results.length===rounds.length){reset();return;}
  const round=rounds[results.length];activeToken=crypto.randomUUID();
  const params=new URLSearchParams({map:round.map,mode:'race',tier:'works',tourToken:activeToken});
  // Only explicit review URLs enable the existing autopilot; ordinary preview races are human-driven.
  if(new URLSearchParams(location.search).get('autopilot')==='1') {params.set('demo','1');params.set('headless','1');params.set('diagnostics','1');}
  frame.src='./race.html?'+params;
  byId('race-heading').textContent=`GRAND TOUR / ${results.length+1} OF 3 / ${round.name}`;
  // Keep the menu painted under the opaque race view. Removing it from layout
  // and restoring it caused missing text after frame disposal in local Chrome.
  byId('tour').inert=true;document.body.style.overflow='hidden';byId('race-shell').hidden=false;byId('feedback').textContent='';
  timeout=setTimeout(()=>{closeRace();byId('feedback').textContent='The race took too long to load. Try this round again.';},60000);
});
window.addEventListener('message',event=>{
  if(event.origin!==location.origin || event.source!==frame.contentWindow || !activeToken || event.data?.token!==activeToken) return;
  if(event.data.type==='tour-ready'){clearTimeout(timeout);frame.focus();}
  if(event.data.type==='tour-error'){closeRace();byId('feedback').textContent=event.data.message;}
  if(event.data.type==='tour-finish' && !finishPending) {
    try {
      validateResult(event.data.result,results);
      results.push(event.data.result);
      finishPending=true;clearTimeout(timeout);frame.inert=true;
      const player = event.data.result.standings.find(row => row.player);
      const next = rounds[results.length];
      byId('race-heading').textContent=`${rounds[results.length-1].name} · ${player.position === 1 ? 'ROUND WON' : `FINISH P${player.position}`} · +${5-player.position} PTS${next ? ` · NEXT: ${next.name}` : ' · FINAL ROUND'}`;
      byId('leave').hidden=true;byId('continue').hidden=false;byId('race-shell').classList.add('finished');
      byId('continue').textContent=next ? 'CONTINUE TO CUP' : 'VIEW FINAL STANDINGS';
      byId('continue').focus();
    }
    catch(error){closeRace();byId('feedback').textContent=error.message;}
  }
});
byId('continue').addEventListener('click',()=>{
  if (!finishPending) return;
  closeRace();render();byId('verdict').setAttribute('tabindex','-1');byId('verdict').focus();
});
byId('leave').addEventListener('click',()=>byId('leave-dialog').showModal());
byId('stay').addEventListener('click',()=>{byId('leave-dialog').close();frame.focus();});
byId('confirm-leave').addEventListener('click',()=>{byId('leave-dialog').close();closeRace();});
byId('reset').addEventListener('click',reset);
byId('sample').addEventListener('click',()=>{
  sampleMode=true;
  const field=[{name:'TOTEM',team:'WORKS 07',player:true},{name:'FIELD A',team:'SAMPLE',player:false},{name:'FIELD B',team:'SAMPLE',player:false},{name:'FIELD C',team:'SAMPLE',player:false}];
  const orders=[[1,0,2,3],[0,2,1,3],[0,1,3,2]];
  const result={racerCount:4,standings:orders[results.length].map((index,position)=>({...field[index],position:position+1}))};
  validateResult(result,results);results.push(result);render();
});
render();
