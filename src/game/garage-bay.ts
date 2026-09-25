/**
 * Garage — the single lazy entry for everything the garage draws.
 *
 * `main.ts` (the bay and the craft's look) and `meta-runtime.ts` (the purse)
 * all import THIS module, so the showroom, the look, the purse, the catalog and
 * the economy arrive as one chunk on one request, warmed once after the grid
 * is up. Three separate dynamic imports would each carry their own preload
 * glue in the entry chunk, which has about a kilobyte of headroom.
 *
 * THE STYLESHEET IS LINKED, NOT IMPORTED — for the reason `dreamisland-hud.ts`
 * found the hard way: Vite serves an imported stylesheet in DEV as an injected
 * `<style>`, which the shipped `style-src 'self'` refuses, so the bay would be
 * unstyled on `npm run dev` and fine in a build. `new URL(…, import.meta.url)`
 * is a same-origin file in both, and evaluating this module is exactly when
 * the bay or the purse first needs it.
 */
const sheet = document.createElement("link");
sheet.rel = "stylesheet";
sheet.href = new URL("./style-garage.css", import.meta.url).href;
document.head.append(sheet);

export { GarageScreen } from "./garage-ui";
export { applyCraftLook } from "./garage-look";
export { settleFinish } from "./garage-purse";
