import type {Settlement,RaceFacts} from './garage-economy.js';
import type {TrackEntry} from './map-selection';

function element<K extends keyof HTMLElementTagNameMap>(tag:K,className:string,text:string):HTMLElementTagNameMap[K]{
  const node=document.createElement(tag);node.className=className;node.textContent=text;return node;
}

/** Read settled facts only. This presentation never awards or writes progress. */
export function renderRaceDebrief(settlement:Settlement,facts:RaceFacts,tracks:readonly TrackEntry[]):void {
  const purse=document.getElementById('result-purse');
  if(!purse||settlement.demo||!tracks.length)return;
  purse.querySelector('.race-debrief')?.remove();
  const completed=tracks.filter(track=>settlement.garage.circuits.includes(track.selection));
  const current=tracks.findIndex(track=>track.selection===facts.track);
  const ordered=[...tracks.slice(current+1),...tracks.slice(0,current+1)];
  const next=ordered.find(track=>!settlement.garage.circuits.includes(track.selection));
  const bonus=settlement.lines.find(line=>line.code==='circuit');
  const section=element('section','race-debrief','');section.setAttribute('aria-label','Circuit progress and next race');
  const title=element('h3','race-debrief__title',!next?'TOUR COMPLETE':bonus?'NEW CIRCUIT LOGGED':'CIRCUIT TOUR');
  const progress=element('p','race-debrief__progress',`${completed.length} / ${tracks.length} CIRCUITS${bonus?` · +CR ${bonus.amount} INCLUDED IN PURSE`:''}`);
  const lesson=element('p','race-debrief__lesson',facts.driftCashes===0
    ? 'Try a drift: brake while steering to build charge. Release the brake once the drift meter is ready to bank plasma.'
    : facts.cleanGateChain<4?'Next challenge: cross four gates through the center. A clean chain builds faster plasma recharge.'
    : 'Keep the clean chain through the next sector. Save boost for the corner exit.');
  section.append(title,progress,lesson);
  if(next){
    const action=element('button','ghost-button race-debrief__next',`EXPLORE ${next.label}`);action.type='button';
    action.addEventListener('click',()=>{
      const url=new URL(window.location.href);url.searchParams.set('map',next.selection);
      url.searchParams.set('mode',facts.mode);url.searchParams.set('tier',facts.tier);
      url.searchParams.delete('demo');url.searchParams.delete('start');
      window.location.assign(url.href);
    });
    section.append(action);
  }
  purse.append(section);
}
