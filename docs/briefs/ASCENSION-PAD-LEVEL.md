# Ascension Pad — Map 06, complete level brief

## Context (you have no access to the conversation that produced this)

Repo: `/Users/gentlegen/Desktop/futurisma-race/polarity_work`. Branch `work/ascension-pad` from the tip of `work/tideline-tide` (after the Tideline v4 polish if it has landed; otherwise from `054d013`). Dev server: `npm run dev -- --host 127.0.0.1 --port 5200`. Before any node script: `export PATH=$HOME/.nvm/versions/node/v20.19.4/bin:$PATH`. Use your own headless browser (puppeteer-core on your own port), never the shared Browser pane. Read `docs/briefs/TIDELINE-V4-POLISH.md` first: its render rule, sheet prompt template, acceptance style and evidence format apply here unchanged.

The user approved this concept from five generated mood frames in `art/references/ascension/` (see its README). Build the whole level: route, schedule, blockout, painted art, events, ambience, validators, evidence.

Product rules (PRODUCT.md): speed must stay readable; every effect has a racing purpose; humid organic space against repaired aerospace machinery; the PS2 era is the memory, not the method; no rubber-banding, no player collision, no route obstruction by rivals; never communicate state by colour alone; `?motion=reduce` respected. Anti-references: clean sci-fi, neon cyberpunk, photoreal PBR, bloom. **The rocket is an original design: no real space-agency vehicle silhouette, no real logos, no shuttle.** Signage stays at human scale (letters ≤ 0.6 m) except the countdown boards, which are gameplay.

## Concept

A working rocket launch complex in a jungle estuary, raced at dawn on launch day. The lap crosses the launch apron under a countdown board, dives into the flame trench beneath the pad, climbs out past the deluge tanks, passes under the crawlerway, and returns along the estuary causeway with the pad on the horizon. Palette: grey concrete, rust red, off-white, olive steel, sodium amber, swamp green, mist. Three scheduled set pieces the whole race counts down toward.

## Route

Closed loop 2,400–2,800 m, 8 ordered gates, three laps. Sections in order:

| # | Section | Character | Width |
|---|---|---|---|
| 1 | Pad Road | start/finish straight along the apron, countdown board 1 at 150 m, mobile launch platform on the right | 24 m |
| 2 | Apron Sweep | long banked curve around the pad perimeter fence, service tower overhead | 24 m |
| 3 | **Trench** (fork A) | the shortcut: dives under the pad through the flame trench, scorched walls, deluge pipes, sodium lamps, one blind crest at the deflector ramp | 20 m |
| 3b | Deluge Road (fork B) | the long way: around the deluge water towers on the surface, always open | 24 m |
| 4 | Crawlerway | crosses under the crawler-transporter's gravel track; gravel grip on the crossing strip | 24 m |
| 5 | Mangrove Cut | esses through mangroves on low concrete piers, water both sides, egrets | 22 m |
| 6 | Causeway | flat-out straight on the estuary causeway, countdown board 2, the pad in full view ahead | 26 m |
| 7 | Tank Farm | tight left-right past the propellant tanks and a vent stack, back to Pad Road | 22 m |

Fork rules follow Tideline's pump hall: both branches cross the same ordered gates, closed mouths are marked by painted retractable rails, projection stays on the main road when the branch is closed. Trench saving over Deluge Road: 3–6 s, measured on the demo controller, reported with the script.

## The published schedule

All events run on the seeded 120 Hz clock from `tideline-tide.js` (reuse or extract a shared scheduler; snapshot/restore compatible with the ability protocol). Times are in race seconds and are **computed from the measured Works lap time L** by the build script, never typed by hand. The menu and HUD publish the schedule the way Tideline publishes the tide.

| Event | When | Racing effect |
|---|---|---|
| Crawler crossing 1 | 0.55 L | Crawler-transporter crosses over the Crawlerway sector, road passes beneath (clearance ≥ 9 m, never intersects the corridor). Klaxon 3 s before. Treads shed gravel: grip 0.90 on the crossing strip until lap end. |
| Crawler crossing 2 | 1.60 L | Same, opposite direction. |
| Deluge test | 1.25 L | 4 s water sheet across the trench mouth: grip 0.80 in the trench for 10 s. Rehearsal for the real one; audible from the apron. |
| **T-0 launch** | 2.45 L | Pad ignition. Sound arrives after distance / 343 m/s. Trench closes (rails lower) for 20 s while the deluge fires, then reopens flooded: grip 0.72 in the trench until race end. Steam wall crosses Apron Sweep and Pad Road: fog distance halved on those sectors for 0.5 L. Rocket climbs and is gone by 2.70 L; the smoke column stays on the horizon. |

The decision: laps one and two the trench is the fast line. On lap three the boards count down and the driver chooses: trench before T-0 and risk being inside when the rails drop (the driver is never trapped: a craft inside at closure exits normally, the rails only refuse entry), or Deluge Road and watch the launch.

## Powers and handling

Space/Shift nitro, E for the held device, same Surge and Phase Shield rules as Tideline, gravity off, no tide. Two launch strips (Causeway and Pad Road) and two phase bulkheads (trench exit, Tank Farm). Drift-charge active on the Crawlerway gravel and the Mangrove Cut. Rivals use powers visibly.

## Ambience

Dawn overcast with one warm break on the pad side; mist over the mangroves; egrets rising at the Mangrove Cut on every lap; sodium lamps still on; drips and echo in the trench; pad chatter and the countdown on pit radio ("T minus sixty", "deluge armed", "clear the trench"); klaxon before each crawler crossing; the launch: ignition rumble with distance delay, steam hiss, birds scattering, lamps flickering as the pressure wave passes. Music: the user's private mixes, the drop aligned to T-0 if the bar quantiser allows; otherwise the music ducks for 4 s at T-0.

## Phases and deliverables

**A. Route, schedule, blockout.** `scripts/build-ascension-route.mjs` → `src/game/data/ascension/route.json`; `ascension-course.ts` implementing `RaceCourse` with the fork; `ascension-schedule.js`; a flat-material-ID blockout GLB with lamp anchors; `validate:ascension` and `validate:ascension-runtime`; a three-lap demo with measured fork timings. Acceptance as in the Blastworks concept brief (continuity, no gate bypass, fork savings measured, tiers separate across three seeds, budgets with 2x headroom, reduced motion).

**B. Art.** Focal assets: mobile launch platform with rocket and service tower, crawler-transporter, countdown board, flame-trench wall module (sheets already in the kit), plus deluge water tower, propellant tank, vent stack, crawlerway gravel bed, mangrove pier, egret card set, service-tower swing arm (animated). For each: GPT Image 2 sheet → hero at chase height (the four focal heroes and two Tripo maquettes are already in the kit, made with Higgsfield by the orchestrator; Codex has no Higgsfield access and makes any secondary hero with GPT Image 2 from `hero_prompt_template`) → GPT Image 2 material-ID pass → low-poly Blender model on the six painted atlases, using a maquette for silhouette only where one exists. Signage manifest and generation.json as in Tideline. Sky: one 4096x1024 panorama, one lighting state, luma range ≤ 2x, profile script before acceptance; horizon haze blend in the sky shader.

**C. Events and effects.** Crawler-transporter as an animated authored mesh on a spline with tread rotation, beacon and klaxon; deluge water sheets and trench flooding; launch sequence: engine glow, flame column, steam wall as camera-facing volumetric cards through fog, rocket ascent, smoke column persisting; gravel shed decals; lamp flicker. Every effect through the shared lighting/fog/tone mapping (the render rule). Reduced motion: no shake, no flicker; steam and launch still visible.

**D. Audio.** Pit radio lines, klaxon, deluge, launch with distance delay and a 4 s music duck, egrets, trench drips. Record 20 s at T-0 and 10 s in the trench as evidence.

**E. Evidence and delivery.** `art/evidence/ascension-v1/`: hero-versus-model side-by-sides for every focal asset (five shared details each), phase pairs at three stations before and after T-0, a 24-frame sky turntable with its profile, the pasted-on test beside the countdown board at three fog distances, the material walk asserting no `toneMapped:false` on gameplay objects, single-frame legibility of both boards at ≥ 150 m, determinism at a fixed seed, budgets before/after with reconciled sample counts, a reduced-motion run, and the audio captures. Commit per phase, push `work/ascension-pad` to origin, then from `/Users/gentlegen/Desktop/Projects/futurisma-race` push it to GitHub.

## Acceptance (whole level)

1. Three laps at the review seed with zero missed gates, recoveries or console errors, on both fork choices.
2. Fork savings and every schedule time reported with the script that measured them; T-0 lands between 2.35 L and 2.55 L of the measured Works lap.
3. A stranger shown ten random frames names the lap phase (before T-0 / after T-0) correctly every time.
4. Every focal asset passes the five-detail side-by-side; the rocket passes an "is this a real vehicle?" check (no).
5. Crawler clearance over the corridor ≥ 9 m at every frame of both crossings, measured by the corridor sweep.
6. Budgets within `docs/PERFORMANCE_BASELINE.md`; shadow draws counted.
7. All validators pass; `npm test` remains blocked only by the pre-existing missing Greenwater archive.

## Non-goals

No multiplayer. No changes to other maps. No free flight. Stop and report if the crawler or the launch cannot be made to satisfy the no-obstruction rule with clearance, or if the launch steam cannot keep speed readable on the apron.

## Residuals carried from Tideline v4 (added 2026-09-05 after review of d1b2bc9)

These are acceptance items for this map, not optional notes:

1. **Road-luma floor per sector.** Measure road luma at the chase camera's road patch for every sector on the finished map, at every schedule phase, with `frame-metrics.py`. Record the base first, then pin a floor from it; no sector may read darker than the darkest accepted Tideline tunnel frame. Tideline's port sectors went near-black after the lighting pass and nothing caught it.
2. **Device fidelity.** Every device and cradle carries emissive glass in its lamp, rivet-scale bolts (not hex nuts), and a metal base. Hero-versus-model still needs five shared details, and additionally a reviewer must not call the model "cruder than a PS2 asset".
3. **Deck lamps are housings.** Launch-strip lamps are recessed in a housing with a lit lens; flat pale rectangles fail.
4. **CHAIN observed live.** A demo flag forces one bulkhead-absorb-then-Surge chain in the evidence run; the HUD line and reward are captured on video.
