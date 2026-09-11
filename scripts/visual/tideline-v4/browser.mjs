import {createRequire} from 'node:module';
/** `userDataDir` keeps localStorage across two launches, which is the only way
 * a ghost recorded by one race can be proved to replay in the next one: without
 * it every launch gets a fresh temporary profile and the save is empty again.
 *
 * `protocolTimeout` bounds a SINGLE CDP call, not the whole session, and
 * puppeteer defaults it to 180 s. A `waitForFunction` is one such call, so any
 * wait longer than that dies with `Runtime.callFunctionOn timed out` however
 * generous the wait's own `timeout` was — which is what a nine-lap `?laps=9`
 * race (~293 s of driving) hit. Left undefined by default so no existing
 * harness changes behaviour; a caller that waits longer than three minutes has
 * to say so. */
export async function launchReviewBrowser({userDataDir,protocolTimeout}={}) {
  const require=createRequire(import.meta.url);
  const puppeteer=await import(process.env.TIDELINE_PUPPETEER??'/tmp/futurisma-v4-harness/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js');
  const executablePath=process.env.TIDELINE_CHROME??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  return puppeteer.default.launch({executablePath,headless:true,...(userDataDir?{userDataDir}:{}),...(protocolTimeout?{protocolTimeout}:{}),pipe:false,debuggingPort:0,defaultViewport:{width:1280,height:720,deviceScaleFactor:1},args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist','--autoplay-policy=no-user-gesture-required','--disable-background-timer-throttling','--disable-renderer-backgrounding','--no-first-run','--no-default-browser-check']});
}
