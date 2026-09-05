import {createRequire} from 'node:module';
export async function launchReviewBrowser() {
  const require=createRequire(import.meta.url);
  const puppeteer=await import(process.env.TIDELINE_PUPPETEER??'/tmp/futurisma-v4-harness/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js');
  const executablePath=process.env.TIDELINE_CHROME??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  return puppeteer.default.launch({executablePath,headless:true,pipe:false,debuggingPort:0,defaultViewport:{width:1280,height:720,deviceScaleFactor:1},args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist','--autoplay-policy=no-user-gesture-required','--disable-background-timer-throttling','--disable-renderer-backgrounding','--no-first-run','--no-default-browser-check']});
}
