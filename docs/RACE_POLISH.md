# Race feel and 3D polish — 2 October 2026

Work is in `minimap-aplus-handoff/`, the current nine-circuit build. Existing
local map, garage and minimap edits were preserved.

The following environment pass adds nine original map-specific working places,
with shared art direction, race-state animation, crew access and local sound.
See [CIRCUIT_SIGNATURES.md](CIRCUIT_SIGNATURES.md) for the map-by-map rationale,
runtime bounds, reproduction and captured gallery.

## Play

Start with `npm ci`, then `npm run dev -- --host 127.0.0.1 --port 5218`.
Open http://127.0.0.1:5218/?map=greenwater or choose any circuit in the menu.
Enter launches. Hold W to accelerate; A/D steer; S brakes; Shift boosts.
Brake while steering to build a drift bank, then release the brake to cash it.
P pauses, R recovers. Standard gamepads use RT, left stick, LT and A.

## Implemented

- The first launch teaches throttle at the point a new player needs it. The
  same instrument offers straight-line boost, drift-bank and empty-reserve
  advice. Lessons stop once used, expire with race time, respect hazard priority
  and change to gamepad labels. Retry resets them; pause does not consume them.
- Boost expands the chase lens at 8.2/s instead of 4.8/s, while settling retains
  the gentler 4.8/s response. FOV limits, reduced-motion limits and physics are
  preserved. A short controller pulse marks GO.
- Original Blender timing pylons dress Greenwater, Bitterpan, Night Shift and
  Afterglow. Large gate numbers, amber target lights, green cleared
  lights, start lights, sun hoods, vents and below-deck supports make them read
  as track equipment. The five other circuits retain their authored gate kits.
  Frostline's large snow-warning structures occupy these approaches; avoiding
  that overlap preserves the actual weather cues and its winter composition.
- Shared geometry and materials reduce the entire new timing field to four
  draw calls. The kit is 924 triangles and 329,724 bytes, with an embedded JPEG
  atlas. It loads lazily, adds no lights or collision bodies, clears the sampled
  deck/run-off/gate envelope, and restores the course method on disposal. A
  missing optional kit leaves the race playable.
- Live render snapshots now expose an immutable copy of the current craft,
  route/branch, lap, gate, reserve, phase, round and fixed simulation tick.
  Tick advances through countdown, driving and finish coast; it freezes during
  pause. A restart increments round and resets tick.

![Timing hardware in Greenwater](../art/evidence/race-polish/greenwater-timing-kit.png)

## Multiplayer foundation and remaining work

`FuturismaGame.captureRaceSnapshot(playerId)` is the integration point. Its
module loads on demand. Protocol version 1 uses 120 simulation ticks per second;
20 snapshots per second is the proposed transport rate, not a running service.
Input packets contain version, tick, sequence and the four continuous controls.
The input timeline clamps axes, rejects replay/duplicates/past/far-future ticks,
bounds queued inputs to two seconds and releases controls after 100ms of silence.

This is a render/input contract, **not online multiplayer or rollback**. An
authoritative server must own the clock, checkpoint validation, fitted handling,
rewards and every circuit's power/hazard state. Discrete recovery, power and
gravity actions need a separate ticked event stream. Add a per-lobby session ID
and verify protocol, map/asset/handling versions, seed and round on every packet.
Use fresh input timelines for each round. Never accept a client's finish position
or credit payout. Then connect remote craft interpolation and test two real
clients under latency, loss, reconnection and background-tab throttling.

Tradeoff: this pass prepares a narrow transport boundary without replacing the
existing race simulation or introducing a speculative server framework.

## Original art and reproduction

The **built-in image generation tool** produced the material atlas. It does not
expose a selectable model version, so this work cannot claim use of “Image Gen
2.5”. Generated paint is a texture source; the actual 3D mesh and UV mapping are
authored in the Blender script.

- Original generation: `art/references/race-polish/timing-kit-atlas.png`
- Editable scene: `art/blender/race_timing_kit.blend`
- Runtime mesh: `public/assets/race-polish/timing-kit.glb`
- Compressed atlas: `public/assets/race-polish/timing-atlas.jpg`
- Rebuild: `blender --background --python scripts/race-polish/build_timing_kit.py`
- Exact generation prompt: [race-polish-prompt.txt](race-polish-prompt.txt)

## Validation

`node scripts/race-polish/validate.mjs` tests malformed inputs, replay, duplicate
ticks, queue limits, control timeout, snapshot immutability/compatibility,
hazard/lesson priority, the actual drift threshold, camera response and GLB budget.

Browser review uses Playwright and an installed Google Chrome, with a development
response interceptor exposing the game only to the test. Install Playwright with
`npm install --no-save --package-lock=false playwright` if needed.

```
node scripts/race-polish/review.mjs greenwater bitterpan nightshift afterglow frostline polarity tideline ascension dreamisland
node scripts/race-polish/review.mjs --laps greenwater nightshift frostline
node scripts/race-polish/review.mjs --reduce greenwater
node scripts/race-polish/systems.mjs
npm run build
npm run validate:build
npm run validate:camera
npm run validate:physics
npm run validate:race
npm run validate:presentation
npm run validate:control
npm run validate:hud
npm run validate:seams
```

Raw browser reports and screenshots are in `art/evidence/race-polish/`. The
production shell stays within the existing 287 KiB gzip limit; the model has its
own lazy download. The public snapshot API adds no production debug global.

The final smoke check covers all nine circuits. Complete one-lap checks on
Greenwater, Night Shift and Frostline finish with zero missed gates and zero
recoveries. The controller check uses a simulated standard pad: prompts,
throttle, boost and the single GO pulse pass; this does not substitute for a
physical controller comfort test. Narrow-screen captures freeze simulation
while displaying the racing layout. The optional-asset check supplies an
incomplete glTF and confirms that the original race still loads and drives.

## Highest-value next improvements

1. **Road and craft contact.** Match roughness, edge wear, ground contact and
   reflections across the older circuits. Favor a few carefully authored
   repeated pieces over more scattered detail. Test from the driving camera.
2. **Course composition.** Give each older circuit a clear approach, memorable
   landmark and contrasting exit. Night Shift's long facade runs and the exposed
   wetland horizon are stronger candidates than adding more HUD decoration.
3. **New-player tuning.** Run observed first-time sessions for turn anticipation,
   drift rewards and the first race length. The new lessons solve the grid gap;
   they do not prove steering/difficulty is ideal for everyone.
4. **Storefront evidence.** Capture a clean trailer and screenshots from the
   playable build, showing a full start, overtake, environmental change and
   finish. Use generated art as supporting art with an honest visual match.
5. **Online vertical slice.** Start with one map, stock handling and two players.
   Establish authoritative fairness and reconnection before carrying all nine
   circuits' changing hazards into online sessions.
