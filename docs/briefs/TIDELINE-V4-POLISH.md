# Tideline v4 — sky, power layer, and final polish

## Context (you have no access to the conversation that produced this)

Repo: `/Users/gentlegen/Desktop/futurisma-race/polarity_work`, branch `work/tideline-tide`, start from commit `054d013`. Dev server: `npm run dev -- --host 127.0.0.1 --port 5200`. Before any node script run `export PATH=$HOME/.nvm/versions/node/v20.19.4/bin:$PATH` (the default shell resolves to Node 14 and every validator dies). Review seed: `?map=tideline&seed=3868938316&demo=1&headless=1`. Use your own headless browser (puppeteer-core on your own port); never drive the shared Browser pane.

The lighting and ambience pass in 054d013 is accepted: tunnel phases read blind 10/10, lamp under/between ratio went 1.04 to 2.05, the refinery horizon and moving port work. Direction is locked: "a beautifully remembered PS2 racer" made of painted 1024 atlases on honest geometry, restrained palette (warm concrete, oxidised steel, sodium amber, swamp green), fog for depth, never bloom. PRODUCT.md anti-references apply: no clean sci-fi, no neon cyberpunk, no photoreal PBR. Product rules: no rubber-banding, no route obstruction by rivals, never communicate state by colour alone, respect `?motion=reduce`.

Review of 054d013 found these defects. Fix all of them.

**D1 Sky reads as cut in half.** `src/game/tideline-sky.ts` wraps one 1536x768 painting (`public/assets/tideline-v3/horizon.jpg`) on a 360° sphere: 4.3 texels/degree, so the 75° chase view magnifies it 4x. The warm flare sector is 55° wide against ~305° of near-black cloud; steepest change 0.11 (R−B) over 10°; sky-band luma range 3.5x. The edges wrap fine (mismatch 5.5/255) so this is the painting, not the seam. A moon on one side and a sunset on the other reads as two times of day.

**D2 Every gameplay object is pasted on.** Pickups, launch strips (`addRibbon`, 0xd0e798 at 36%), lit current lanes (0x5ed6c3), phase bulkheads (0xffb48d box + 0xffc39b frame) in `src/game/tideline-world.ts` and the device kit in `src/game/power-kit.ts` are `MeshBasicMaterial`, `toneMapped:false`, ignoring fog and AgX. They sit on top of the frame instead of in it.

**D3 The devices are the wrong fiction.** The power kit (`art/references/power-kit/multiview-refinement.png`, `art/blender/power_kit.blend`, `public/assets/power-kit/power_kit.glb`) is clean grey-blue sci-fi with a lilac crystal. The Phase Shield reads as "a flower" and is mounted on the craft for most of the race, so it is in nearly every frame.

**D4 Port phases are only readable side by side.** The blind reviewer rated port frames at 60–75% confidence alone.

**D5 Unverified areas.** The demo driver never takes the pump-hall shortcut, so its visuals have no evidence. Audio (pump throb, drain, creaks) has no recording.

**D6 Contract debt.** `public/assets/tideline/manifest.json` still lists `pelagicCrowns: 1` and `flightLenses: 4`. The main repo's loaders throw on exact counts.

## Non-goals

No route, gate, grip, tide schedule or rival pace changes. No new maps. No multiplayer. No new HUD chrome. Do not touch Greenwater, Bitterpan, Night Shift or Polarity.

## Work packages

### A. Sky (D1)
1. Regenerate the panorama at 4096x1024, one lighting state: blue hour, layered storm cloud, the refinery flare and its glow spanning about 140° and fading to night over the rest with no step. No moon. Soft cloud edges. Sky-band luma range ≤ 2x. Chimneys, tanks and one crane as silhouettes in the lower quarter, as now.
2. In `tideline-sky.ts` blend the painting toward the scene fog colour as the view direction approaches the horizon (a horizon haze band), so painted edges dissolve into fog.
3. The flare direction must exist in the world: a warm rim on the flare-side silhouettes and a faint warm tint on wet quay surfaces facing it.
4. Reduced motion: no cloud scroll.

### B. One render rule (D2)
Every gameplay object renders through the same lighting, fog and tone mapping as the world. Brightness comes from emissive maps, never from `toneMapped:false` or fog exclusion. Apply to pickups, devices, strips, lanes, fields, gate markers.

### C. Devices as port hardware (D3)
Re-author Surge and Phase Shield in Blender from a new reference triplet (orthographic sheet, hero at chase-camera height, material-ID pass), stored under `art/references/power-kit-v2/`. Fiction: salvaged pump-works equipment. Chipped olive and grey paint from the metal atlas, stencils, bolted plates, one caged lamp each: amber for Surge, cyan for Shield. No crystals, no petals. Keep the existing animated pivots (turbine spin, iris open). Same six material roles. Budget: ≤ 4,000 triangles for both.

### D. Pickups become cradles
The pickup is a cradle lowered from an overhead rail or a crane hook, swinging slightly, with a rotating hazard beacon and a painted "DEVICE" stencil. Nothing floats. On collect: cradle springs open, a spark burst, a metallic clunk, the rail retracts. Reduced motion: no swing.

### E. Launch strips and current lanes
- Launch strip: paint it into the road as worn chevrons with a faded stencil, plus a row of flush deck lamps chasing in sequence toward the exit. Firing Surge inside flashes the row white once.
- Lit current lane: a submerged cable tray under glass with lamps pulsing in the travel direction and bubbles streaming along it. Both must survive both gradings (flooded and drained).

### F. Bulkheads become doors
A hazard-striped iris ring in the pump-hall vocabulary, a membrane inside it with slight refraction and scan lines, warning strobes and a klaxon on approach (audible ≥ 2 s before arrival). Shield absorb: membrane bursts into droplets, ring lamps go green, the HUD confirms. Without Shield the existing rule applies unchanged.

### G. Activation feedback and field
- Surge: field-of-view kick, heat-haze cone behind the hull, deck lamps flare as the craft passes. Surge ready but unfired inside a strip: the strip lamps pulse.
- Shield: iris opens, a thin hex-cell dome in sodium tint wraps the hull. The 1.2 s refund window is visible: the dome pulses brighter while open, dull after.
- Rivals fire Surge and Shield visibly with the same effects, using their existing seeded schedules if any; if rivals have no power logic, add a deterministic seeded use per lap and record it in the race JSON.
- Chain reward: absorbing a bulkhead and firing Surge within 2 s grants +0.5 s Surge and a HUD "CHAIN" line. Never through colour alone.

### H. Port phases readable alone (D4)
Add a painted waterline band with algae fringe on every quay wall at the lap-2 and lap-3 levels, exposed ladders and mooring rings below the line, and a beached hull on lap 3. Water surface height must be visibly different against the foundations from the chase camera.

### I. Evidence for the shortcut and audio (D5)
Add a demo-driver flag that takes the pump hall on lap 3 and produce frames through it at three stations. Record 20 s of audio at the drain transition and 10 s in the pump hall with the headless driver's audio capture or ffmpeg from the browser; store as `art/evidence/tideline-v4/audio/*.wav`.

### J. Contract cleanup (D6)
Regenerate `public/assets/tideline/manifest.json` from the actual GLB. Add a validator assertion that manifest counts equal loaded counts.

## Acceptance (all must hold, in this order)

1. **Sky profile.** A script writes a per-column warmth (R−B) and luma profile of the new panorama: no 10° window changes warmth by more than 0.05; sky-band luma max/min ≤ 2.0. Then a 24-frame turntable from the chase camera at station 3 lap 3: no frame contains a luma step above 2x across any 10% of its width in the sky region.
2. **Pasted-on test.** Every gameplay object screenshotted beside the Tidal Pump Gantry from the same camera at three fog distances. A reviewer without source access must not be able to say which object bypasses fog. Additionally a `renderer` walk asserts no gameplay material has `toneMapped === false` or `fog === false`.
3. **Device match.** Hero-versus-model side by side for both devices, reviewer names five shared details each.
4. **Phase blind test repeated** with ten new frames, five of them port. Target: 10/10 with stated confidence ≥ 90% on every frame. Reviewer must not see the key.
5. **Feature legibility at speed.** A 2 s burst at 300 km/h approaching a cradle, a strip, a lane and a bulkhead: a reviewer names each object from a single frame taken ≥ 120 m out.
6. **Determinism.** Three-lap demo at the review seed finishes with the same classification and lap times as before your change unless package G deliberately changes them; if so, state old and new times and why.
7. **Budgets.** Peak main-pass draws, shadow draws and triangles measured with the existing diagnostics against `docs/PERFORMANCE_BASELINE.md`; report before and after. Frame p95 at 1280x720 with the sample count reconciled against window × expected rate.
8. **Validators.** `validate:tideline`, `validate:tideline-runtime`, `validate:tideline-environment`, `validate:tideline-foundry`, `validate:power-kit`, `validate:build` all pass; `npm test` remains blocked only by the pre-existing missing Greenwater archive.
9. **Reduced motion** run at the same seed produces the same result with no swing, scroll, dome pulse or strobe.

## Delivery

Commit per package with messages naming the defect (D1–D6). Evidence under `art/evidence/tideline-v4/` with a README listing every frame, script, command and hash. Push to `origin work/tideline-tide` (the local main repo) and then from `/Users/gentlegen/Desktop/Projects/futurisma-race` run `git push origin work/tideline-tide` to GitHub. Final report: per package, what you executed and observed versus what you inferred, plus the open-gaps list. Any number you quote must name the script that produced it. Do not report "tests pass" as evidence for a visual.
