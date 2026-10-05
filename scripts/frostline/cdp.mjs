// Minimal Chrome DevTools Protocol driver (no Playwright): launches the
// installed Chrome headless, kills ONLY the PID it started (also on timeout).
// Needs Node 20 with `--experimental-websocket` (or Node 22+).
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const CHROME='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const until=async(check,ms,label)=>{const end=Date.now()+ms;for(;;){const value=await check().catch(()=>null);if(value)return value;if(Date.now()>end)throw new Error('timeout: '+label);await new Promise(r=>setTimeout(r,150));}};

export async function launch({port=9333,width=1280,height=720,timeoutMs=240000}={}){
  const profile=mkdtempSync(join(process.env.FG_TMP??tmpdir(),'fg-chrome-'));
  const child=spawn(CHROME,['--headless=new','--mute-audio','--remote-debugging-port='+port,'--user-data-dir='+profile,'--window-size='+width+','+height,
    '--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist','--autoplay-policy=no-user-gesture-required','--disable-background-timer-throttling',
    '--disable-renderer-backgrounding','--no-first-run','--no-default-browser-check','about:blank'],{stdio:'ignore'});
  let closed=false;
  const close=()=>{if(closed)return;closed=true;try{process.kill(child.pid,'SIGKILL');}catch{}try{rmSync(profile,{recursive:true,force:true});}catch{}};
  const guard=setTimeout(()=>{console.error('CDP guard timeout, killing chrome pid '+child.pid);close();process.exit(3);},timeoutMs);guard.unref();
  process.on('exit',close);process.on('SIGINT',()=>{close();process.exit(130);});
  try{
    await until(()=>fetch(`http://127.0.0.1:${port}/json/version`).then(r=>r.ok&&r.json()),15000,'chrome devtools');
    const targets=await until(()=>fetch(`http://127.0.0.1:${port}/json/list`).then(r=>r.json()).then(list=>list.find(t=>t.type==='page')),5000,'page target');
    const socket=new WebSocket(targets.webSocketDebuggerUrl);await new Promise((ok,fail)=>{socket.onopen=ok;socket.onerror=fail;});
    let id=0;const pending=new Map(),listeners=[];
    socket.onmessage=event=>{const message=JSON.parse(event.data);if(message.id&&pending.has(message.id)){const {ok,fail}=pending.get(message.id);pending.delete(message.id);message.error?fail(new Error(JSON.stringify(message.error))):ok(message.result);}else for(const l of listeners)l(message);};
    const send=(method,params={})=>new Promise((ok,fail)=>{const n=++id;pending.set(n,{ok,fail});socket.send(JSON.stringify({id:n,method,params}));});
    const errors=[];listeners.push(m=>{if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails?.exception?.description??m.params.exceptionDetails?.text);if(m.method==='Runtime.consoleAPICalled'&&m.params.type==='error')errors.push(m.params.args.map(a=>a.value??a.description).join(' '));});
    await send('Runtime.enable');await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
    const evaluate=async(expression)=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description??r.exceptionDetails.text);return r.result.value;};
    const navigate=async url=>{await send('Page.navigate',{url});};
    const waitFor=(expression,ms,label=expression)=>until(()=>evaluate(expression),ms,label);
    const screenshot=async(quality=80)=>Buffer.from((await send('Page.captureScreenshot',{format:'jpeg',quality})).data,'base64');
    return {pid:child.pid,send,evaluate,navigate,waitFor,screenshot,errors,close:()=>{clearTimeout(guard);try{socket.close();}catch{}close();}};
  }catch(error){close();throw error;}
}
