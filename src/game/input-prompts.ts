import {INPUT_PROMPTS} from './input-prompt-map.js';
import type {InputController} from './input';

/** Menu edges are routed before the same button can become a race action. */
export function bindInputPrompts(input: InputController): void {
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
    if(!options&&!controls&&!['intro','paused','result'].includes(phase??''))return false;
    if(button===0||button===9){
      const focused=document.activeElement;
      if(focused instanceof HTMLButtonElement&&focused.id!=='pause-quit')focused.click();
      else if(!options&&!controls)click(phase==='intro'?'start-button':phase==='paused'?'pause-resume':'restart-button');
    }else if(button===1){
      if(options)click('options-close');
      else if(controls)click('controls-close');
      else if(phase==='paused'&&document.activeElement?.id!=='pause-quit')click('pause-resume');
    }else if(button===3)click('options-button');
    else if(button===2)click('controls-button');
    else if(button>=12&&button<=15){
      const surface=document.getElementById(options?'options-screen':controls?'controls-screen':phase==='intro'?'start-screen':phase==='paused'?'pause-panel':'result-screen');
      const targets=Array.from(surface?.querySelectorAll<HTMLElement>('button,input,[role="radio"]')??[]).filter(node=>node.getClientRects().length&&!node.hasAttribute('disabled'));
      const index=targets.indexOf(document.activeElement as HTMLElement),direction=button===12||button===14?-1:1;
      targets[(index+direction+targets.length)%targets.length]?.focus();
    }else return false;
    return true;
  };
}
