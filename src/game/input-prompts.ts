import {INPUT_PROMPTS} from './input-prompt-map.js';
import type {InputController} from './input';

/** Menu edges are routed before the same button can become a race action. */
export function bindInputPrompts(input: InputController): void {
  // Menu-only DOM behavior stays in this lazy module, out of race startup.
  for (const id of ['pause-panel', 'result-screen']) {
    const panel = document.getElementById(id)!;
    panel.addEventListener('keydown', event => {
      if (event.key !== 'Tab') return;
      const targets = Array.from(panel.querySelectorAll<HTMLElement>('button:not(:disabled),summary'))
        .filter(node => node.getClientRects().length > 0);
      const first = targets[0], last = targets[targets.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    });
  }
  const restart = document.getElementById('pause-restart')!;
  let restartArmed = false;
  const resetRestart = () => { restartArmed = false; restart.textContent = 'RESTART RACE'; };
  restart.addEventListener('click', () => {
    if (restartArmed) { resetRestart(); restart.dispatchEvent(new Event('race-restart')); return; }
    restartArmed = true;
    restart.textContent = 'CONFIRM RESTART · RUN WILL BE LOST';
  });
  restart.addEventListener('blur', resetRestart);
  const update=(device:"keyboard"|"gamepad")=>{
    document.body.dataset.inputDevice=device;
    document.querySelectorAll<HTMLElement>('kbd').forEach(node=>{
      const action=node.dataset.prompt as keyof typeof INPUT_PROMPTS;
      if(!INPUT_PROMPTS[action])throw Error('Unmapped keyboard prompt');
      node.textContent=INPUT_PROMPTS[action][device];
    });
  };
  input.onDeviceChange=update;
  update(input.activeDevice);
  const click=(id:string)=>document.getElementById(id)?.click();
  input.onMenuButton=(button)=>{
    const phase=document.body.dataset.phase;
    const options=document.body.dataset.options==='true';
    const controls=document.body.dataset.controls==='true';
    const garage=document.body.dataset.garage==='true';
    if(!options&&!controls&&!garage&&!['intro','paused','result'].includes(phase??''))return false;
    if (document.body.dataset.launch && phase==='intro') return true;
    if(phase==='intro'&&!options&&!controls&&!garage&&(button===4||button===5)){click(button===4?'launch-prev':'launch-next');return true;}
    if(button===0||button===9){
      const focused=document.activeElement;
      if(focused instanceof HTMLButtonElement || focused instanceof HTMLElement && focused.tagName === "SUMMARY") {
        if(focused.id!=='pause-quit')focused.click();
      }
      else if(!options&&!controls&&!garage)click(phase==='intro'?'start-button':phase==='paused'?'pause-resume':'restart-button');
    }else if(button===1){
      if(options)click('options-close');
      else if(controls)click('controls-close');
      else if(phase==='intro'&&document.getElementById('launch-grid-toggle')?.getAttribute('aria-expanded')==='true')click('launch-grid-toggle');
      else if(garage)click(document.getElementById('garage-back')?'garage-back':'garage-close');
      else if(phase==='paused')click('pause-resume');
    }else if(button===3&&!garage)click('options-button');
    else if(button===2&&!garage)click('controls-button');
    else if(button>=12&&button<=15){
      const surface=document.getElementById(options?'options-screen':controls?'controls-screen':garage?'garage-screen':phase==='intro'?'start-screen':phase==='paused'?'pause-panel':'result-screen');
      const header=phase==='intro'&&!options&&!controls&&!garage?document.querySelectorAll<HTMLElement>('.launch-top button'):[];
      const targets=[...Array.from(surface?.querySelectorAll<HTMLElement>('button,input,summary,[role="radio"]')??[]),...header].filter(node=>node.getClientRects().length&&!node.hasAttribute('disabled'));
      const index=targets.indexOf(document.activeElement as HTMLElement),direction=button===12||button===14?-1:1;
      targets[(index+direction+targets.length)%targets.length]?.focus();
    }else return false;
    return true;
  };
}
