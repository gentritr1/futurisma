# B2 garage implementation

Branch: `codex/b2-garage`, based on the compact A+ handoff `53237a5`.
The A+ minimap stays behind its existing development flag.

## Delivered

- A real service apron, ribbed hangar, work light, team floor markings, independent camera, and actual craft in the existing renderer.
- Fleet, upgrades, paint and test modes; contracts/daily jobs remain on the secondary JOBS board.
- All six frames have five surface anchors and dedicated service compositions. Selecting a part collapses the craft slab and parts list. The work order follows the projected anchor.
- Portrait targets land at 42.7% screen height; landscape phones have a separate layout. Keyboard focus stays in the garage; Escape/B back out of a purchase or part before leaving.
- Explicit local-credit purchase confirmations, disabled unaffordable actions, fitted state, and consistent 0–100 ratings.
- Pointer, keyboard and controller holds; same-task hidden/blur cleanup and full initial reserve.
- Calm pause with resume focus and a single course/lap/position context. Results show affordable, short and owned states, open the relevant craft, and offer an expandable payout breakdown.

## Ownership and cost

`garage-scene.ts` owns the bay and camera and temporarily reparents the actual visual group. It restores the original parent, position and rotation on close/disposal. It never disposes the borrowed model. Part locations are explicit per-frame entries in `garage-anchors.ts`.

The bay/UI/reward code stays behind `garage-bay.ts`; no new dependencies. The bay streams the existing original score on first use. The renderer seam in `game.ts` remains within the existing 2,584-line ceiling. The clean-lockfile review build measures 281.72 KiB gzip for the initial shell, below the unchanged 282 KiB ceiling (see LAUNCH-MENU.md). New scene lighting has no shadow maps.

The authored hulls are preserved. All five upgrade types now add stage I–III hardware, kept for racing: engine collars/liners, servo/fin braces, skid shoes and plasma cooling/conductors. Hardware is fitted to each frame's actual nodes; fin attachments use a surface ray instead of a bounding-box corner. Moving parts inherit their parent's animation. Geometry is merged by attachment/material, cached for unchanged fits and disposed on refit. Fully upgraded hardware peaks at 16 draws and 2,184 added triangles. No extra texture or model download is required.

Empty surge/shield pickup devices now stow instead of standing permanently above every hull. Loaded-frame hardpoints are seated against opaque deck geometry. Equipped powers still deploy in races; they are independent of purchased performance parts.

## Motion, music and the shop

- Interruptible 180–260 ms card/fitting feedback, press responses and distinct paint/test camera compositions; reduced motion removes travel. Whole-craft idle hover is 3.5 cm and stops for close-ups or backgrounding.
- Upgrade cards list current/next 0–100 ratings, exact cost or shortfall, and a three-stage indicator. The work order explains the driving benefit and physical part supplied. FITTED / PREVIEW toggles compare actual hardware without spending; cancel, mode changes and close restore the saved build.
- The fleet view points to affordable upgrades. Credits do not move until purchase succeeds, and stage III shows a completed build rather than another offer.
- Garage music streams the shipped Meridian Afterimage at 0.12 × master × music volume, ducked to 22% during engine tests. It pauses synchronously on blur, visibility loss, mute and close, and resumes on focus/interaction. The race mix is paused while the bay owns the craft. Selection/fitting cues use the existing lazy showroom voice.
- Continuous 3D hover intentionally costs redraws while the bay is visible. Close-ups settle to on-demand rendering. No shadow maps or animation package were added.

## Review

Run the game locally and open GARAGE. For compact A+, append `?map=nightshift&minimap=aplus`.

- `npm run validate:garage-b2`: real GLB geometry, material-sided occlusion, all 90 part/device projections, apron clearance, pose restoration, purchase/reward invariants.
- `npm run check:garage-showroom`: actual rendered models, 90 service screenshots, reserve/airbrakes, hidden/blur with suspended frame requests, stock QA mode, controller focus loss, frame swaps and race return.
- `npm run check:garage-framing -- --full --screens=1280x800,390x844,844x390`: every frame's actual plume and brake geometry, UI clearance and mid-hold rotation.
- `npm run check:garage-showroom -- --upgrade-only`: all 30 final-stage purchases, actual fitted vs preview meshes, no preview spending, prices/persistence, stowed pickups, phone and rapid tab switching. Evidence under `shots/garage-energy/`.
- `npm run check:garage-showroom -- --shop-only`: starter CR 400 affordability, single debit, exact shortfalls, safe cancellation, phone actions and contract handoff.
- `npm run check:garage-showroom -- --music-only`: actual media playback, engine ducking, blur with suspended frame requests, resume, mute and close.
- Images are generated under ignored `shots/garage-b2/`.
- `scripts/visual/garage-b2-fixture.html` seeds an isolated local test origin through the real save API.
- `scripts/visual/garage-b2-results.html` renders deterministic test race data through the real results/purse modules, using an in-memory store. `?state=short` and `?state=owned` show the other offer states.

The full `npm run test:code` gate passes with a fresh lockfile install. The three previously missing art inputs were excluded by the local sparse checkout, not missing from the repository. The review checkout includes the Tideline references/textures and Dream Island calibration. Generated historical Dream Island reports are restored after validation and are not part of this change.

Phone service layout reserves separate grid rows for the scrolling work order and parts switcher, with a 12 px gap. It overrides the legacy 300 px minimum height and keeps the order actions inside the scrolling viewport. The shop browser check covers every part at 390×844 and 390×680, including whether each button owns its touch target.
