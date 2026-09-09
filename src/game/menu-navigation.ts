import {isMenuOnlyKey} from './menu-key.js';

/** Loaded on the first menu request. Owns modal origins and focus, never race state. */
export class MenuNavigation {
  private readonly options=document.getElementById('options-screen')!;
  private readonly controls=document.getElementById('controls-screen')!;
  private readonly optionsClose=document.getElementById('options-close')!;
  private readonly controlsClose=document.getElementById('controls-close')!;
  private readonly controlsOptions=document.getElementById('controls-options')!;
  private surface:'options'|'controls'|null=null;
  private returnTo='intro';
  private returnFocus:HTMLElement|null=null;
  private controlsReturnFocus:HTMLElement|null=null;

  constructor(private readonly suspendInput:()=>void){
    this.optionsClose.addEventListener('click',this.close);
    this.controlsClose.addEventListener('click',this.close);
    this.controlsOptions.addEventListener('click',this.openOptions);
    window.addEventListener('keydown',this.keyDown,{capture:true});
    this.options.addEventListener('keydown',this.panelKeyDown);
    this.controls.addEventListener('keydown',this.panelKeyDown);
  }

  show(surface:'options'|'controls'):void {
    if(this.surface===surface||this.surface==='options'&&surface==='controls')return;
    if(surface==='options'){
      this.returnTo=this.surface==='controls'?'controls':document.body.dataset.phase??'intro';
      this.returnFocus=document.activeElement as HTMLElement|null;
      this.options.dataset.returnTo=this.returnTo;
    }else{
      this.controlsReturnFocus=document.activeElement as HTMLElement|null;
      this.controls.dataset.returnTo=document.body.dataset.phase??'intro';
    }
    this.surface=surface;this.sync();
    (surface==='options'?document.getElementById('option-master'):this.controlsClose)?.focus();
  }

  private readonly openOptions=():void=>this.show('options');
  private readonly close=():void=>{
    if(this.surface==='options'){
      this.surface=this.returnTo==='controls'?'controls':null;
      this.sync();this.returnFocus?.focus();this.returnFocus=null;
    }else if(this.surface==='controls'){
      this.surface=null;this.sync();this.controlsReturnFocus?.focus();this.controlsReturnFocus=null;
    }
  };
  private sync():void {
    this.options.hidden=this.surface!=='options';this.controls.hidden=this.surface!=='controls';
    document.body.dataset.options=String(this.surface==='options');document.body.dataset.controls=String(this.surface==='controls');
    this.suspendInput();
  }
  private readonly keyDown=(event:KeyboardEvent):void=>{
    if(!this.surface||isMenuOnlyKey(event.code,event.key))return;
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();this.close();return;}
    const panel=this.surface==='options'?this.options:this.controls;
    if(event.target instanceof Node&&panel.contains(event.target))return;
    event.preventDefault();event.stopPropagation();
  };
  private readonly panelKeyDown=(event:KeyboardEvent):void=>{
    if(event.key!=='Tab')event.stopPropagation();
  };
  dispose():void {
    this.optionsClose.removeEventListener('click',this.close);this.controlsClose.removeEventListener('click',this.close);
    this.controlsOptions.removeEventListener('click',this.openOptions);
    window.removeEventListener('keydown',this.keyDown,{capture:true});
    this.options.removeEventListener('keydown',this.panelKeyDown);this.controls.removeEventListener('keydown',this.panelKeyDown);
  }
}
